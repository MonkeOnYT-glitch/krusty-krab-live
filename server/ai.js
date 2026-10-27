// Local GPT-OSS client (Ollama /api/chat with JSON-schema structured output).
// Runs on its own job queue so slow inference never blocks gift reactions or rendering.
// There is deliberately no cloud fallback.
import { settings } from './settings.js';
import { state, log, changed } from './hub.js';

export const DECISIONS = ['CALL YOU LATER', 'DENIED', 'ACCEPTED'];
const INTENTS = ['apply', 'provide_info', 'status_check', 'raise_request', 'question_to_krabs', 'other'];

const queue = []; // { kind, priority, run, resolve, reject }
let busy = false;

function setStatus(patch) { Object.assign(state.status.ai, patch, { pending: queue.length + (busy ? 1 : 0) }); changed(); }

export function pendingChatJobs() { return queue.filter(j => j.kind === 'chat').length; }

function enqueue(kind, priority, run) {
  return new Promise((resolve, reject) => {
    if (kind === 'chat') {
      // Bound the chat backlog: drop the oldest chat interpretation instead of growing without limit.
      while (pendingChatJobs() >= settings.ai.maxPendingChats) {
        const idx = queue.findIndex(j => j.kind === 'chat');
        const [dropped] = queue.splice(idx, 1);
        dropped.reject(new Error('dropped: AI chat backlog full'));
      }
    }
    queue.push({ kind, priority, run, resolve, reject });
    queue.sort((a, b) => b.priority - a.priority);
    setStatus({});
    pump();
  });
}

async function pump() {
  if (busy) return;
  const job = queue.shift();
  if (!job) { setStatus({}); return; }
  busy = true; setStatus({});
  try { job.resolve(await job.run()); } catch (e) { job.reject(e); }
  busy = false; setStatus({});
  setImmediate(pump);
}

async function chatJSON(system, user, schema, { maxTokens = 1200 } = {}) { // room for gpt-oss reasoning + the JSON
  const cfg = settings.ai;
  let lastErr;
  let useFormat = true;
  for (let attempt = 0; attempt <= cfg.retries + 1; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutSec * 1000);
    const t0 = Date.now();
    try {
      const res = await fetch(cfg.endpoint.replace(/\/$/, '') + '/api/chat', {
        method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cfg.model, stream: false, think: /gpt-oss/i.test(cfg.model) ? cfg.think : false, // only gpt-oss takes low/medium/high; skip reasoning on others for speed
          keep_alive: cfg.keepAlive, ...(useFormat ? { format: schema } : {}),
          options: { temperature: cfg.temperature, num_ctx: cfg.numCtx, num_predict: maxTokens },
          messages: [{ role: 'system', content: useFormat ? system : `${system}\nReply with ONLY one JSON object with these keys: ${Object.keys(schema.properties).join(', ')}. No other text.` }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = await res.json();
      const parsed = extractJSON(body.message?.content || '');
      setStatus({ state: 'ok', model: cfg.model, detail: 'Responding', latencyMs: Date.now() - t0 });
      return parsed;
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error(`timed out after ${cfg.timeoutSec}s`) : e;
      // Ollama's harmony parser sometimes rejects gpt-oss output in structured mode; retry in plain mode.
      if (/error parsing tool call|invalid character|Unexpected token|JSON/i.test(lastErr.message)) useFormat = false;
      else if (attempt >= cfg.retries) break;
      log('warn', `AI attempt ${attempt + 1} failed: ${lastErr.message}`);
    } finally { clearTimeout(timer); }
  }
  setStatus({ state: 'error', detail: lastErr.message });
  throw lastErr;
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('model returned no JSON');
  return JSON.parse(text.slice(a, b + 1));
}

const PERSONA = `You voice Mr. Krabs, owner of the Krusty Krab, who is running a hiring office on a family-friendly TikTok LIVE.
Personality: greedy, money-obsessed, sarcastic, theatrical, secretly soft-hearted, nautical slang ("me boy", "ye", "arr").
Rules: keep it PG and kind; no profanity, insults about real traits, politics or adult content; never say you are an AI; never promise money.`;

const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: INTENTS },
    name: { type: 'string' }, role: { type: 'string' }, experience: { type: 'string' }, pitch: { type: 'string' },
    reply: { type: 'string' }, followup_question: { type: 'string' },
  },
  required: ['intent', 'name', 'role', 'experience', 'pitch', 'reply', 'followup_question'],
};

export function interpretChat({ viewer, message, application, past = null, busy = false }) {
  const system = `${PERSONA}
Task: classify ONE viewer chat message and extract job-application details.
intent values:
- "apply": the viewer wants a job or to be hired, or says why they want to work here ("can I get a job", "hire me", "I need money for a new bike", "I love Krabby Patties"). Any wish to work at the Krusty Krab is "apply", even if they already applied.
- "provide_info": the viewer already has an application (shown below) and is telling details about themselves: name, skills, experience, or why they want the job ("I'm a good cook").
- "status_check": asks about their application result or place in line ("did I get accepted?").
- "raise_request": asks Mr. Krabs for a raise, more pay, a bonus, or a promotion ("can I get a raise?", "I deserve more money", "promote me").
- "question_to_krabs": ANY other normal chat: greetings, jokes, comments about the stream, questions, compliments, talking to other characters. Mr. Krabs reacts to these.
- "other": ONLY spam, gibberish, or inappropriate content. Greetings, jokes, emojis, compliments and random comments are "question_to_krabs".
Extraction: name only if the viewer states it ("my name is Alex"); role = a job title ONLY if they explicitly ask for one, else "" (viewers don't need to pick: Mr. Krabs assigns positions); experience = skills/experience they mention; pitch = why they want to work here / why hire them. Use "" for anything not in THIS message.
reply: ALWAYS write one (only leave it empty for spam/inappropriate). One in-character Mr. Krabs line, max ${busy ? 12 : 25} words, starting with or including the viewer's name, reacting directly to what this viewer said (use their name if known). Empty string if intent is "other".
followup_question: if intent is "apply" and neither this message nor the existing application gives any reason or skill (pitch and experience empty), a short in-character question asking WHY they want to work at the Krusty Krab; otherwise "". Never ask which job they want.`;
  const user = `Viewer display name: ${JSON.stringify(viewer)}
Existing application: ${application ? JSON.stringify({ name: application.name, role: application.role, experience: application.experience, status: application.status }) : 'none'}
Already stamped earlier: ${past ? JSON.stringify(past) + ' (ACCEPTED = they now work for Mr. Krabs, talk to them like his employee; DENIED = tease them; CALL YOU LATER = keep them dangling). Only use intent "apply" if they clearly want to apply again.' : 'no'}
Chat message: ${JSON.stringify(message)}`;
  return enqueue('chat', 1, async () => validateChat(await chatJSON(system, user, CHAT_SCHEMA)));
}

export function validateChat(o) {
  if (!o || typeof o !== 'object' || !INTENTS.includes(o.intent)) throw new Error('invalid AI chat output: bad intent');
  const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return { intent: o.intent, name: s(o.name, 40), role: s(o.role, 40), experience: s(o.experience, 160), pitch: s(o.pitch, 200), reply: s(o.reply, 220), followup_question: s(o.followup_question, 160) };
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: { decision: { type: 'string', enum: DECISIONS }, position: { type: 'string' }, explanation: { type: 'string' }, announcement: { type: 'string' } },
  required: ['decision', 'position', 'explanation', 'announcement'],
};

export function reviewApplication(app, recentDecisions = [], forcedDecision = null) {
  const system = `${PERSONA}
Task: review one job application at the hiring desk, choose EXACTLY ONE decision: "CALL YOU LATER", "DENIED", or "ACCEPTED", and decide which position fits them.
position: the Krusty Krab job YOU place them in based on their reasons and skills (fry cook, cashier, janitor, dishwasher, waiter, delivery boy, assistant manager, or a funny made-up one like "Chief Penny Counter"), 2-4 words. Ignore the job they asked for if it doesn't fit. For "DENIED" use "".
Judge on the application itself in a funny way (enthusiasm, relevant skills, how much money they might make you). Gifts and priority do NOT buy acceptance.
Vary outcomes; avoid repeating the same decision many times in a row.
explanation: max 30 words, funny, in character, spoken BEFORE the stamp. It MUST clearly justify the decision you chose: ACCEPTED = impressed, DENIED = a playful roast of why not, CALL YOU LATER = unsure/stalling. Never praise someone you deny.
Write fresh lines every time; never reuse stock phrases.
announcement: max 14 words, spoken AFTER the stamp, includes the applicant's name and, unless denied, the position.`;
  const user = `Application: ${JSON.stringify({ name: app.name || app.nickname, requested_job: app.role || 'none', reasons: app.pitch, skills: app.experience, chat: app.messages.slice(-4) })}
Recent decisions (oldest→newest): ${JSON.stringify(recentDecisions.slice(-5))}${forcedDecision ? `\nThe decision is ALREADY MADE: "${forcedDecision}". Use exactly that decision and write the lines for it.` : ''}`;
  const schema = forcedDecision ? { ...REVIEW_SCHEMA, properties: { ...REVIEW_SCHEMA.properties, decision: { type: 'string', enum: [forcedDecision] } } } : REVIEW_SCHEMA;
  return enqueue('review', forcedDecision ? 7 : 5, async () => {
    const r = validateReview(await chatJSON(system, user, schema));
    if (forcedDecision && r.decision !== forcedDecision) throw new Error('model ignored the fixed decision');
    return r;
  });
}

const HOOK_SCHEMA = { type: 'object', properties: { line: { type: 'string' }, banner: { type: 'string' } }, required: ['line', 'banner'] };

/** Fresh attention-grabbing line for when chat goes quiet. */
export function idleHook({ queue, lastDecision, recent, goal = null, top = null, lastGift = null }) {
  // Pick this hook's angle in code so lines rotate (small models otherwise always fall back to "apply").
  const angles = [
    goal && { w: 3, t: `FOCUS: the shared gift goal, only ${goal.target - goal.have} coins to go (${goal.have}/${goal.target}); rally chat to finish it together with any gift.` },
    { w: 2, t: top ? `FOCUS: friendly rivalry: dare viewers to dethrone ${top.name}, the Employee of the Month with ${top.coins} coins.` : 'FOCUS: the Employee of the Month crown is empty; the next gifter claims it.' },
    { w: 2, t: 'FOCUS: one concrete payoff: Rose skips the hiring line, Donut makes SpongeBob dance, Galaxy blows up the Krusty Krab. Pick one and make it sound fun.' },
    lastGift && { w: 2, t: `FOCUS: social proof: thank ${lastGift.user} for the ${lastGift.gift} and hype what it did.` },
    { w: 2, t: 'FOCUS: get people applying: type in chat why they want a job.' },
  ].filter(Boolean);
  let r = Math.random() * angles.reduce((n, x) => n + x.w, 0), focus = angles[0].t;
  for (const x of angles) { if ((r -= x.w) <= 0) { focus = x.t; break; } }
  const system = `${PERSONA}
Task: chat has gone quiet on the live stream. Write ONE short attention-grabbing line Mr. Krabs shouts to hook viewers and get them typing.
Styles to rotate between: a bold challenge, roasting the silent chat, a fake "breaking news" announcement, a dare, bragging about the Krusty Krab.
Real features (nothing else exists): applying = typing in chat why you want a job; hired employees can ask for a raise; a Rose skips the hiring line; a Donut makes SpongeBob dance; a Galaxy blows up the Krusty Krab; any gift adds coins to the shared goal bar, and filling the bar triggers a big on-screen celebration (nothing else).
The line's call to action must match the FOCUS given by the user message and nothing else (do not add an "apply" sentence unless the FOCUS is applying).
NEVER invent code words, keywords, commands, secret phrases, polls, votes, games or "type X to ..." mechanics; no cliffhangers that promise something more.
Persuasion that works (use the live context below, pick ONE per line): social proof (name someone who just gifted and what it did), a shared goal ("only N coins until the goal!"), friendly status rivalry (challenge viewers to dethrone the Top Tipper / Employee of the Month), concrete fun payoff (what a gift makes happen on screen), playful greed (Mr. Krabs loves money, as a joke).
Never: guilt-trip, beg, pressure, imply anyone owes anything, fake urgency or fake limited-time offers, target kids, promise rewards, or lie about what a gift does. Gifts are always optional fun.
line: max 22 words, punchy, funny, PG, ends with ONE clear call to action that matches the FOCUS. Must be completely different from the recent lines. NEVER promise prizes, giveaways, rewards, money or "first N people get" anything; never ask for follows/likes in exchange for something.
banner: max 5 words, ALL CAPS, the call to action.`;
  const user = `${focus}
Applicants waiting: ${queue}. Last decision: ${JSON.stringify(lastDecision)}.
Gift goal: ${goal ? `${goal.label}: ${goal.have}/${goal.target} coins (${goal.target - goal.have} to go)` : 'none'}. Top Tipper / Employee of the Month: ${top ? `${top.name} with ${top.coins} coins` : 'nobody yet — the crown is up for grabs'}. Last gift: ${lastGift ? `${lastGift.user} sent ${lastGift.gift} x${lastGift.count}` : 'none yet'}.
Recent lines (do NOT repeat or paraphrase): ${JSON.stringify(recent)}`;
  return enqueue('hook', 0, async () => {
    const o = await chatJSON(system, user, HOOK_SCHEMA);
    const line = String(o.line || '').trim().slice(0, 200);
    // Reject invented mechanics like "type SPATULA to hear more": only real calls to action are allowed.
    const typed = line.match(/(?:type|say|spam|drop|comment|write)s+["'“‘]?([A-Za-z]+)/i);
    if (typed && !/^(why|your|you|what|in|a|an|the|it|me|something|yer|ye|how|reasons?|now|out)$/i.test(typed[1])) throw new Error(`hook invented a keyword ("${typed[1]}")`);
    if (/to (hear|see|find out|learn|unlock) (more|what)|secret|code ?word|keyword|password/i.test(line)) throw new Error('hook invented a mechanic');
    if (!/applying/.test(focus) && /want a job/i.test(line)) throw new Error('hook drifted off its focus');
    if (/(goal|coins).{0,40}(blow|explod|nuke|boom)/i.test(line)) throw new Error('hook misdescribed the goal');
    if (!line) throw new Error('empty hook');
    return { line, banner: String(o.banner || '').trim().toUpperCase().slice(0, 40) };
  });
}

const RAISE_OUTCOMES = ['DENIED', 'PENNY RAISE', 'PROMOTED'];
const RAISE_SCHEMA = { type: 'object', properties: { outcome: { type: 'string', enum: RAISE_OUTCOMES }, cents: { type: 'integer' }, new_position: { type: 'string' }, line: { type: 'string' } }, required: ['outcome', 'cents', 'new_position', 'line'] };

/** An employee asks for a raise. Greedy Mr. Krabs judges the pitch. */
export function decideRaise({ name, position, wageCents, raises, message, tooSoon, forced = null }) {
  const system = `${PERSONA}
Task: your employee asks for a raise. You are extremely greedy. Choose ONE outcome:
- "DENIED" (most of the time, ~60%),
- "PENNY RAISE": an insultingly tiny raise, cents between 1 and 5 (~30%),
- "PROMOTED": only for a genuinely funny or clever pitch (~10%): a funny new job title as new_position and cents between 5 and 25.
cents must be 0 for DENIED. new_position is "" unless PROMOTED.
line: max 28 words, spoken by Mr. Krabs, reacting directly to their pitch and naming the outcome; fresh wording every time, never reuse stock phrases.${tooSoon ? '\nThey JUST asked a moment ago: the outcome MUST be "DENIED" and you are outraged they asked again so soon.' : forced ? `
The outcome is ALREADY DECIDED: "${forced}". Use exactly it and write a line that fits it.` : ''}`;
  const user = `Employee: ${JSON.stringify({ name, position, current_wage: '$' + (wageCents / 100).toFixed(2) + '/hr', raises_so_far: raises })}
Their message: ${JSON.stringify(message)}`;
  const fixed = tooSoon ? 'DENIED' : forced;
  const schema = fixed ? { ...RAISE_SCHEMA, properties: { ...RAISE_SCHEMA.properties, outcome: { type: 'string', enum: [fixed] } } } : RAISE_SCHEMA;
  return enqueue('chat', 2, async () => {
    const o = await chatJSON(system, user, schema);
    const outcome = fixed || (RAISE_OUTCOMES.includes(String(o.outcome).toUpperCase()) ? String(o.outcome).toUpperCase() : 'DENIED');
    const cents = outcome === 'DENIED' ? 0 : Math.max(1, Math.min(outcome === 'PROMOTED' ? 25 : 5, Math.round(Number(o.cents) || 1)));
    const line = String(o.line || '').trim().slice(0, 240);
    if (!line) throw new Error('empty raise line');
    return { outcome, cents, newPosition: outcome === 'PROMOTED' ? String(o.new_position || '').trim().slice(0, 40) || 'Assistant to the Manager' : '', line };
  });
}

/** Fresh line for a new Top Tipper or a reached gift goal. */
export function shoutout(kind, ctx) {
  const task = kind === 'top'
    ? `${ctx.name} just became the Top Tipper ("Employee of the Month") with ${ctx.coins} coins${ctx.previous ? `, taking the crown from ${ctx.previous}` : ''}. Celebrate them by name and playfully dare others to take the crown.`
    : `Chat just completed the gift goal "${ctx.label}" (${ctx.target} coins)${ctx.top ? `; the Top Tipper is ${ctx.top}` : ''}. Celebrate everyone hugely and announce the next goal has started.`;
  const system = `${PERSONA}\nTask: ${task}\nline: max 24 words, hype, funny, PG, fresh wording. No guilt, no pressure, no promises of rewards.`;
  return enqueue('chat', 6, async () => {
    const o = await chatJSON(system, 'Write the line.', { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] });
    const line = String(o.line || '').trim().slice(0, 220);
    if (!line) throw new Error('empty shout-out');
    return line;
  });
}

const VOICES = {
  spongebob: 'SpongeBob SquarePants: endlessly cheerful, enthusiastic fry cook who loves his job, Krabby Patties and his friends; says things like "I\'m ready!", laughs a lot.',
  squidward: 'Squidward Tentacles: grumpy, sarcastic, bored cashier who hates his job and wants to go home to play clarinet.',
  krabs: 'Mr. Krabs: greedy, money-obsessed boss, nautical slang ("me boy", "arr").',
};
// SpongeBob's "groove" line belongs only to the gift-triggered dance sequence.
const noGroove = (t) => { if (/groove/i.test(t)) throw new Error('reserved groove line'); return t; };

/** SpongeBob or Squidward answering a viewer who talked to / about them. */
export function characterReply(character, viewer, message) {
  const system = `You voice ${VOICES[character]}
A live-stream viewer named ${viewer} just said this in chat about or to you. Reply in character, directly to what they said, using their name.
Family-friendly. Never mention being an AI. Never use the word "groove".
line: max 20 words, fresh wording. If the message is rude or inappropriate, line must be exactly SKIP.`;
  return enqueue('chat', 2, async () => {
    const o = await chatJSON(system, JSON.stringify(message), { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] });
    const line = String(o.line || '').trim().slice(0, 200);
    if (!line || /^skip$/i.test(line)) throw new Error('skipped');
    return noGroove(line);
  });
}

/** A short SpongeBob line for a moment on stream. */
export function spongeLine(kind, ctx) {
  const task = kind === 'welcome'
    ? `Mr. Krabs just hired ${ctx.name} as ${ctx.position || 'a new employee'}. Welcome your new coworker by name, super excited.`
    : `${ctx.who} just sent a ${ctx.gift}${ctx.count > 1 ? ` x${ctx.count}` : ''} on the live stream. React with pure joy and thank them by name.`;
  const system = `You voice ${VOICES.spongebob}\nFamily-friendly. Never mention being an AI. Never use the word "groove".\nTask: ${task}\nline: max 18 words, fresh wording.`;
  return enqueue('chat', 4, async () => {
    const o = await chatJSON(system, 'Write the line.', { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] });
    const line = String(o.line || '').trim().slice(0, 180);
    if (!line) throw new Error('empty line');
    return noGroove(line);
  });
}

/** A short background exchange between restaurant characters, written fresh each time. */
export function banterExchange({ cast, context, recent }) {
  const system = `Write a short, funny, family-friendly exchange between characters working at the Krusty Krab during a live stream.
Characters: ${cast.map(c => `${c}: ${VOICES[c]}`).join('\n')}
Rules: exactly ${cast.length === 3 ? 3 : 2} lines, in this speaker order: ${cast.join(', ')}. Each line max 18 words. Never use the word "groove". Don't mention being an AI. Don't repeat recent topics.`;
  const user = `What's happening: ${context}\nRecent exchanges (avoid): ${JSON.stringify(recent)}`;
  const schema = { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: { character: { type: 'string', enum: cast }, text: { type: 'string' } }, required: ['character', 'text'] } } }, required: ['lines'] };
  return enqueue('hook', 0, async () => {
    const o = await chatJSON(system, user, schema);
    const lines = (o.lines || []).filter(l => cast.includes(l.character) && String(l.text || '').trim()).slice(0, 3)
      .map(l => ({ character: l.character, text: noGroove(String(l.text).trim().slice(0, 180)) }));
    if (lines.length < 2) throw new Error('banter too short');
    return lines;
  });
}

/** Quick in-character reaction to emoji-only messages / keyboard mashes (classifier tends to skip those). */
export function quickReact(viewer, message) {
  const system = `${PERSONA}
A viewer named ${viewer} typed only this in chat. React to it in ONE funny Mr. Krabs line, max 16 words, using their name. If it is suggestive or rude, the line must be exactly SKIP.`;
  return enqueue('chat', 1, async () => {
    const o = await chatJSON(system, JSON.stringify(message), { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] });
    const line = String(o.line || '').trim().slice(0, 180);
    if (!line || /^skip$/i.test(line)) throw new Error('skipped');
    return line;
  });
}

/** Welcome joiners / thank likers / thank a sharer, naming them. */
export function greetLine(kind, names, extra) {
  const who = names.join(', ');
  const task = kind === 'join' ? `Welcome these viewers who just joined the stream by name: ${who}. Warm, funny, and invite them to type in chat why they want a job.`
    : kind === 'like' ? `Thank these viewers by name for liking the stream: ${who}${extra?.total ? ` (${extra.total} likes recently)` : ''}. Playful, grateful.`
    : `Thank ${who} by name for sharing the stream. Big, genuine gratitude (more customers = more money).`;
  const system = `${PERSONA}\nTask: ${task}\nline: max 22 words, fresh wording, no guilt, no pressure, no promised rewards.`;
  return enqueue('hook', kind === 'share' ? 3 : 0, async () => {
    const o = await chatJSON(system, 'Write the line.', { type: 'object', properties: { line: { type: 'string' } }, required: ['line'] });
    const line = String(o.line || '').trim().slice(0, 220);
    if (!line) throw new Error('empty greeting');
    return line;
  });
}

export function validateReview(o) {
  if (!o || typeof o !== 'object') throw new Error('invalid AI review output');
  const decision = typeof o.decision === 'string' ? o.decision.trim().toUpperCase() : '';
  if (!DECISIONS.includes(decision)) throw new Error(`invalid AI decision "${o.decision}"`);
  const explanation = String(o.explanation || '').trim().slice(0, 240);
  if (!explanation) throw new Error('AI review missing explanation');
  let position = decision === 'DENIED' ? '' : String(o.position || '').trim().slice(0, 40);
  if (decision !== 'DENIED' && !position) position = ['Fry Cook', 'Cashier', 'Janitor', 'Dishwasher', 'Waiter', 'Chief Penny Counter'][Math.floor(Math.random() * 6)];
  return { decision, position, explanation, announcement: String(o.announcement || '').trim().slice(0, 140) || decision + '!' };
}

export async function listModels() {
  const res = await fetch(settings.ai.endpoint.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return (await res.json()).models.map(m => ({ name: m.name, size: m.size, family: m.details?.family, params: m.details?.parameter_size, quant: m.details?.quantization_level }));
}

export async function testConnection() {
  setStatus({ state: 'testing', detail: 'Contacting Ollama…' });
  try {
    const models = await listModels();
    const m = models.find(x => x.name === settings.ai.model);
    if (!m) throw new Error(`Model "${settings.ai.model}" not installed. Available: ${models.map(x => x.name).join(', ')}`);
    setStatus({ state: 'testing', detail: `Found ${m.name} (${m.params}, ${m.quant}); loading/warming up…` });
    const t0 = Date.now();
    const out = await enqueue('test', 9, () => chatJSON('Reply with JSON {"ok":true}.', 'ping', { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, { maxTokens: 200 }));
    if (out.ok !== true) throw new Error('unexpected test response');
    setStatus({ state: 'ok', model: m.name, detail: `${m.name} ready (${m.params} ${m.quant}) — test round trip ${(Date.now() - t0) / 1000}s`, latencyMs: Date.now() - t0 });
    return { ok: true, models };
  } catch (e) {
    setStatus({ state: 'error', detail: e.message });
    log('error', 'AI connection test failed: ' + e.message);
    return { ok: false, error: e.message };
  }
}
