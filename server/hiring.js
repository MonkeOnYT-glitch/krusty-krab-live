// Hiring office: natural-language applications, follow-ups, priority queue, and the review → stamp loop.
// Invariant: an application gets exactly one decision; `decide()` is the only place that sets it.
import { settings } from './settings.js';
import { state, log, changed, scene, pushCapped } from './hub.js';
import { interpretChat, reviewApplication, decideRaise, spongeLine, quickReact, characterReply, pendingChatJobs, DECISIONS } from './ai.js';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './settings.js';
import { speak, estimateSeconds } from './voice.js';

const apps = new Map(); // id -> application

// Payroll: everyone Mr. Krabs accepts becomes an employee who can ask for raises (saved across restarts).
const PAYROLL_FILE = path.join(DATA_DIR, 'employees.json');
let employees = {};
try { employees = JSON.parse(fs.readFileSync(PAYROLL_FILE, 'utf8')); } catch { employees = {}; }
const savePayroll = () => { try { fs.writeFileSync(PAYROLL_FILE, JSON.stringify(employees, null, 1)); } catch { /* best effort */ } };
const RAISE_COOLDOWN_MS = 120000;
const money = (c) => '$' + (c / 100).toFixed(2);
let queueOrder = []; // ids of applications waiting (collecting | queued), front first
const history = []; // decided applications, newest last
let seq = 0;
let lastChatReply = 0;
let review = null; // { app, manual: resolve fn }

const RELEVANT = /(job|hire|hiring|work|apply|applic|employ|krab|cook|chef|cashier|register|manager|janitor|position|accept|denied|resume|my name|interview|career|salary|pay|fry|patty|patties|boss|sir|captain|money|skill|experience|good at)/i;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Hold: big events (the Galaxy) freeze the hiring office; a review in progress resumes where it stopped.
let holdUntil = 0;
export function hold(ms) { holdUntil = Math.max(holdUntil, Date.now() + ms); state.hiring.held = true; changed(); }
async function waitHold() {
  if (Date.now() >= holdUntil) return;
  const prev = state.hiring.phase; state.hiring.phase = 'paused (Galaxy)'; changed();
  while (Date.now() < holdUntil) await sleep(250);
  state.hiring.held = false; state.hiring.phase = prev; changed();
}
export const userKey = (evt) => `${evt.source}:${evt.user.userId || evt.user.uniqueId}`;

export function activeAppFor(key) { for (const id of queueOrder) { const a = apps.get(id); if (a.userKey === key) return a; } if (review && review.app.userKey === key && !review.app.decision) return review.app; return null; }
function lastDecidedFor(key) { for (let i = history.length - 1; i >= 0; i--) if (history[i].userKey === key) return history[i]; return null; }

export function hiringSnapshot() {
  state.hiringQueueLength = queueOrder.length;
  return {
    queue: queueOrder.map(id => apps.get(id)),
    current: review ? review.app : null,
    history: history.slice(-40).reverse(),
    phase: state.hiring.phase, paused: state.hiring.paused, awaitingManual: !!review?.awaitingManual,
    counts: Object.fromEntries(DECISIONS.map(d => [d, history.filter(h => h.decision === d).length])),
    employees: Object.values(employees).sort((a, b) => b.wageCents - a.wageCents).slice(0, 50),
  };
}

function createApp(evt) {
  const app = {
    id: `app${++seq}`, userKey: userKey(evt), source: evt.source, uniqueId: evt.user.uniqueId, nickname: evt.user.nickname || evt.user.uniqueId,
    avatar: evt.user.avatar || '', name: '', role: '', assignedRole: '', experience: '', pitch: '', messages: [],
    status: 'collecting', priority: 0, priorityReasons: [], followups: 0, followupDeadline: 0,
    createdAt: Date.now(), decision: null, explanation: '', announcement: '', decidedAt: 0, decidedBy: null,
  };
  apps.set(app.id, app);
  queueOrder.push(app.id);
  if (queueOrder.length > settings.hiring.maxQueue) {
    // Drop the oldest non-priority collecting application to keep the queue bounded.
    const victim = queueOrder.map(id => apps.get(id)).find(a => a.status === 'collecting' && a.priority === 0) || apps.get(queueOrder[0]);
    removeApp(victim.id, 'queue full');
  }
  return app;
}

function merge(app, r) {
  if (r.name) app.name = r.name;
  if (r.role) app.role = r.role;
  if (r.experience) app.experience = app.experience ? `${app.experience}; ${r.experience}`.slice(-240) : r.experience;
  if (r.pitch) app.pitch = r.pitch;
}

function markQueued(app) { if (app.status === 'collecting') { app.status = 'queued'; log('info', `Application ${app.id} (${app.nickname}) queued${app.pitch ? ': ' + app.pitch.slice(0, 60) : ''}`); } }

export async function handleChat(evt) {
  const key = userKey(evt);
  // Messages aimed at other viewers ("@sam LMAOO") aren't for Mr. Krabs.
  const mentions = [...evt.text.matchAll(/(?:^|\s)@([\w.]+)/g)].map(m => m[1].toLowerCase());
  const host = String(settings.tiktok.username || '').replace(/^@/, '').toLowerCase();
  if (mentions.length && mentions.every(m => m !== host && !/krabs/.test(m))) return;
  let app = activeAppFor(key);
  const decided = !app && lastDecidedFor(key); // already stamped: Mr. Krabs knows their result when replying
  if (settings.ai.prefilter && !app && !RELEVANT.test(evt.text)) return;
  let r;
  try { r = await interpretChat({ busy: pendingChatJobs() + (state.status.voice.queue || 0) >= 3, viewer: evt.user.nickname || evt.user.uniqueId, message: evt.text, application: app, past: decided ? { decision: decided.decision, position: decided.assignedRole } : null }); }
  catch (e) { if (!/dropped/.test(e.message)) log('warn', `Chat not interpreted (${evt.user.uniqueId}): ${e.message}`); return; }
  if (r.intent === 'other' && !r.reply) { // emoji spam, keyboard mashes etc. still deserve a reaction unless inappropriate
    try { const r2 = await interpretChat({ viewer: evt.user.nickname || evt.user.uniqueId, message: evt.text + '\n(Note: this is harmless chat like emojis or a keyboard mash; react to it funnily as question_to_krabs. Only if it is inappropriate, leave reply empty.)', application: app }); if (r2.reply) r = { ...r2, intent: 'question_to_krabs' }; }
    catch { /* keep silent */ }
    // Still nothing for an emoji-only message or a keyboard mash: dedicated quick reaction.
    const noWords = !/[a-z]{2,}s+[a-z]{2,}/i.test(evt.text) && evt.text.length <= 40;
    if (!r.reply && noWords) { try { r = { ...r, intent: 'question_to_krabs', reply: await quickReact(evt.user.nickname || evt.user.uniqueId, evt.text) }; } catch { /* inappropriate or failed */ } }
  }
  evt.intent = r.intent; changed();
  app = activeAppFor(key); // may have changed while the model was thinking
  const reapply = decided && !app && r.intent === 'apply';
  const who = r.name || app?.name || evt.user.nickname || evt.user.uniqueId;

  if (r.intent === 'apply' || (app && app.status !== 'reviewing' && (r.intent === 'provide_info' || r.intent === 'question_to_krabs'))) {
    if (app && !r.pitch && !r.experience && r.intent !== 'apply') r.experience = evt.text.slice(0, 160);
    const isNew = !app;
    if (isNew) app = createApp(evt);
    if (app.status !== 'reviewing') {
      if (r.intent === 'apply' && !r.pitch && !r.experience && !app.pitch && evt.text.split(/\s+/).length > 3) r.pitch = evt.text.slice(0, 200);
      merge(app, r);
      app.messages.push(evt.text.slice(0, 200));
      markQueued(app);
    }
    if (reapply) await sayKrabs('Reapplying, huh? Okay, here ye go!', 3, true);
    else if (r.reply) await sayKrabs(r.reply, 3, true);
    if (app.status === 'collecting') {
      if (app.followups < settings.hiring.maxFollowups) {
        app.followups++;
        app.followupDeadline = Date.now() + settings.hiring.followupTimeoutSec * 1000;
        sayKrabs(r.followup_question || `And why do ye want to work at the Krusty Krab, ${who}? Convince me!`, 3, true);
      } else markQueued(app);
    }
    changed();
    return;
  }
  if (r.intent === 'raise_request') { await handleRaise(evt, key, who, r); return; }
  if (r.intent === 'status_check') {
    const pos = app ? queueOrder.indexOf(app.id) + 1 : 0;
    const last = lastDecidedFor(key);
    let line;
    if (app?.status === 'reviewing') line = `I'm lookin' at yer paperwork right now, ${who}! Patience!`;
    else if (app) line = `Ye're number ${pos} in line, ${who}. Want to skip ahead? Roses work wonders.`;
    else if (last) line = `Yer application got stamped ${last.decision}${last.assignedRole ? ' for ' + last.assignedRole : ''}, ${who}! Me stamp has spoken.`;
    else line = `Ye haven't even applied, ${who}! Just tell me what job ye want.`;
    sayKrabs(line, 3, true);
    return;
  }
  // Talking to or about SpongeBob / Squidward? Then he answers himself instead of Mr. Krabs.
  if (r.intent === 'question_to_krabs' || r.intent === 'other') {
    const t = evt.text.toLowerCase();
    const iSq = t.search(/squid(ward|dy)?|squiddy/), iSp = t.search(/sponge ?bob|sponge|spongy/);
    const target = iSq < 0 && iSp < 0 ? null : iSp < 0 || (iSq >= 0 && iSq < iSp) ? 'squidward' : 'spongebob';
    if (target) {
      try {
        const line = await characterReply(target, who, evt.text);
        scene(target === 'squidward' ? 'squid' : 'sponge', { anim: target === 'squidward' ? 'talk' : 'wave', duration: 3 });
        speak(target, line, { priority: 2, tag: 'chat' });
        return;
      } catch (e) { if (!/skipped/.test(e.message)) log('warn', `${target} reply failed: ${e.message}`); else return; }
    }
  }
  if ((r.intent === 'question_to_krabs' || r.intent === 'other') && r.reply) sayKrabs(r.reply, 2, false);
  else if (r.intent !== 'other' && !r.reply) log('debug', `No reply written for ${who}`);
}

async function handleRaise(evt, key, who, r) {
  const emp = employees[key];
  if (!emp) {
    await sayKrabs(r.reply || `A raise? Ye don't even work here, ${who}! Tell me why ye want a job first.`, 3, true);
    return;
  }
  const tooSoon = Date.now() - (emp.lastAsk || 0) < RAISE_COOLDOWN_MS;
  emp.lastAsk = Date.now();
  let res;
  // Small models nearly always say no, so the odds are rolled here and the AI writes the matching line.
  const roll = Math.random(), forced = tooSoon ? 'DENIED' : roll < 0.55 ? 'DENIED' : roll < 0.88 ? 'PENNY RAISE' : 'PROMOTED';
  try { res = await decideRaise({ name: emp.name, position: emp.position, wageCents: emp.wageCents, raises: emp.raises, message: evt.text, tooSoon, forced }); }
  catch (e) {
    log('warn', 'Raise decision failed: ' + e.message);
    res = { outcome: 'DENIED', cents: 0, newPosition: '', line: `A raise? Me wallet just fainted, ${emp.name}. DENIED!` };
  }
  if (res.outcome !== 'DENIED') { emp.wageCents += res.cents; emp.raises++; }
  if (res.newPosition) emp.position = res.newPosition;
  savePayroll();
  const look = {
    'DENIED': { text: `💸 RAISE DENIED — ${emp.name}`, color: '#dc2626', sfx: 'beep', anim: 'annoyed' },
    'PENNY RAISE': { text: `🪙 +${res.cents}¢ RAISE — ${emp.name} now makes ${money(emp.wageCents)}/hr`, color: '#ca8a04', sfx: 'cash', anim: 'greedy' },
    'PROMOTED': { text: `⭐ PROMOTED — ${emp.name} is now ${emp.position}!`, color: '#16a34a', sfx: 'chime', anim: 'excited' },
  }[res.outcome];
  log('info', `Raise request from ${emp.name}: ${res.outcome}${res.cents ? ' +' + res.cents + '¢' : ''}${res.newPosition ? ' → ' + res.newPosition : ''}`);
  scene('banner', { text: look.text, color: look.color, duration: 4.5, demo: evt.source === 'demo' });
  scene('sfx', { sound: look.sfx });
  scene('krabs', { anim: look.anim, duration: 2.5, layered: true });
  changed();
  await sayKrabs(res.line, 3, true);
}

function sayKrabs(text, priority, force) { // every viewer gets answered; nothing is skipped on a timer
  lastChatReply = Date.now();
  return speak('krabs', text, { priority, tag: 'chat' });
}

// --- priority (Rose) --------------------------------------------------------------------
export function boostPriority(key, amount, reason) {
  const app = activeAppFor(key);
  if (!app || app.status === 'reviewing') return null;
  const h = settings.hiring;
  if (h.roseRule === 'front') app.priority = Math.min(h.maxPriority, Math.max(app.priority, ...queueOrder.map(id => apps.get(id).priority)) + 1);
  else app.priority = Math.min(h.maxPriority, app.priority + amount);
  app.priorityReasons.push(reason);
  // Re-insert after every application with priority >= its own (stable FIFO among equals).
  queueOrder = queueOrder.filter(id => id !== app.id);
  let idx = queueOrder.findIndex(id => apps.get(id).priority < app.priority);
  if (idx === -1) idx = queueOrder.length;
  queueOrder.splice(idx, 0, app.id);
  log('info', `Priority boost for ${app.nickname}: now ${app.priority} (position ${idx + 1})`);
  changed();
  return { app, position: idx + 1 };
}

// --- manual queue controls ----------------------------------------------------------------
export function moveApp(id, dir) {
  const i = queueOrder.indexOf(id), j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= queueOrder.length) return;
  [queueOrder[i], queueOrder[j]] = [queueOrder[j], queueOrder[i]];
  changed();
}
export function removeApp(id, why = 'removed by operator') {
  queueOrder = queueOrder.filter(x => x !== id);
  const a = apps.get(id); if (a) { a.status = 'removed'; apps.delete(id); log('info', `Application ${id} removed (${why})`); }
  changed();
}
export function forceQueued(id) { const a = apps.get(id); if (a) { markQueued(a); changed(); } }
export function setPaused(p) { state.hiring.paused = !!p; changed(); }

/** Operator stamp. Applies to the application under review, or to a queued one (which is then reviewed immediately). */
export function manualDecision(decision, id) {
  if (!DECISIONS.includes(decision)) throw new Error('invalid decision');
  if (review && (!id || review.app.id === id)) { review.manual?.(decision); return { ok: true, target: review.app.id }; }
  const app = apps.get(id || queueOrder.map(x => apps.get(x)).find(a => a.status === 'queued')?.id);
  if (!app) throw new Error('No application to stamp');
  if (review) throw new Error('Another application is being reviewed — wait for it to finish');
  markQueued(app);
  runReview(app, decision);
  return { ok: true, target: app.id };
}

export function returnCurrentToQueue() {
  if (!review || review.app.decision) return;
  review.abort?.();
}

// --- review loop ------------------------------------------------------------------------
const CANNED = {
  'ACCEPTED': ['Ye look like ye could flip a patty without flippin\' out. Welcome aboard!'],
  'DENIED': ['Me gut says no, and me gut has never lost me a penny.'],
  'CALL YOU LATER': ['Interesting… very interesting. I\'ll keep yer paper in the "maybe" pile.'],
};

const JOBS = ['Fry Cook', 'Cashier', 'Janitor', 'Dishwasher', 'Waiter', 'Chief Penny Counter', 'Mop Specialist', 'Patty Flipper'];
async function freshResult(app, decision, by) {
  try { return { ...(await reviewApplication(app, history.slice(-5).map(h => h.decision), decision)), by }; }
  catch (e) { log('warn', `AI couldn't write lines for ${decision} (${e.message}); using stock lines`); return { ...cannedResult(app, decision), by }; }
}

function cannedResult(app, decision) {
  const position = decision === 'DENIED' ? '' : (app.role || JOBS[Math.floor(Math.random() * JOBS.length)]);
  const who = app.name || app.nickname;
  const announcement = decision === 'DENIED' ? `DENIED! Better luck next time, ${who}!`
    : decision === 'ACCEPTED' ? `ACCEPTED! Welcome aboard, ${who}, ye're me new ${position}!` : `I'll call ye later about the ${position} job, ${who}.`;
  return { decision, position, explanation: CANNED[decision][0], announcement, by: 'operator' };
}

function readAloud(app) {
  const who = app.name || app.nickname;
  const why = (app.pitch || app.experience || '').replace(/\s+/g, ' ').trim();
  const cut = why.length > 150 ? why.slice(0, 150).replace(/\s+\S*$/, '') + '…' : why;
  return cut ? `Let's see here. Applicant: ${who}. Why do ye want to work here? "${cut}"` : `Let's see here. Applicant: ${who}. Reason for wantin' the job… blank! Hmm.`;
}

function paperView(app) { return { id: app.id, name: app.name || app.nickname, user: app.uniqueId, role: app.role || 'Unspecified', experience: app.experience, pitch: app.pitch, priority: app.priority, source: app.source }; }
function phase(p) { state.hiring.phase = p; changed(); }

async function runReview(app, forcedDecision = null) {
  queueOrder = queueOrder.filter(x => x !== app.id);
  app.status = 'reviewing';
  let manualResolve, abortResolve;
  const manualP = new Promise(r => { manualResolve = r; });
  const abortP = new Promise(r => { abortResolve = r; });
  review = { app, manual: manualResolve, abort: () => abortResolve('abort'), awaitingManual: false };
  state.hiring.currentId = app.id;
  try {
    phase('pickup');
    state.stage.paper = paperView(app);
    scene('paper', { action: 'pickup', paper: state.stage.paper });
    scene('krabs', { anim: 'inspect', duration: 4 });
    state.characters.krabs = 'reviewing paperwork';
    const aiP = forcedDecision ? null : reviewApplication(app, history.slice(-5).map(h => h.decision)).then(v => ({ v }), e => ({ e }));
    await sleep(1600);
    await waitHold();
    phase('inspecting');
    scene('paper', { action: 'inspect' });
    // Read the application aloud while the camera zooms in on the paper.
    const reading = readAloud(app);
    scene('camera', { shot: 'paper', duration: 2 + estimateSeconds(reading) });
    await speak('krabs', reading, { priority: 6, tag: 'review' });

    let result;
    if (forcedDecision) result = await freshResult(app, forcedDecision, 'operator');
    else {
      const thinking = setInterval(() => scene('krabs', { anim: 'suspicious', duration: 2.5 }), 5000);
      // Hard cap so one stuck model call can never stall the hiring line.
      const cap = sleep((settings.ai.timeoutSec * (settings.ai.retries + 1) + 15) * 1000).then(() => ({ e: new Error('review timed out') }));
      const first = await Promise.race([aiP, cap, manualP.then(d => ({ manual: d })), abortP.then(() => ({ abort: true }))]);
      clearInterval(thinking);
      if (first.abort) throw new Error('returned to queue');
      if (first.manual) result = await freshResult(app, first.manual, 'operator');
      else if (first.v) result = { ...first.v, by: 'ai' };
      else {
        log('error', `AI review failed for ${app.id}: ${first.e.message}`);
        if (settings.ai.failurePolicy === 'random') {
          const d = DECISIONS[Math.floor(Math.random() * 3)];
          result = await freshResult(app, d, 'auto-fallback');
        } else {
          phase('awaiting_manual');
          review.awaitingManual = true; changed();
          speak('krabs', 'Hmm, me thinkin\' cap is stuck. Give me a moment, lad.', { priority: 5 });
          const second = await Promise.race([manualP.then(d => ({ manual: d })), abortP.then(() => ({ abort: true })), sleep((settings.ai.manualWaitSec || 45) * 1000).then(() => ({ timeout: true }))]);
          if (second.abort) throw new Error('returned to queue');
          if (second.timeout) { const d = DECISIONS[Math.floor(Math.random() * 3)]; log('warn', `No operator stamp for ${app.id}; automatic fallback decision`); result = await freshResult(app, d, 'auto-fallback'); }
          else result = await freshResult(app, second.manual, 'operator');
        }
      }
    }
    review.awaitingManual = false;

    await waitHold();
    phase('explaining');
    scene('krabs', { anim: 'talk', duration: 3 });
    await speak('krabs', result.explanation, { priority: 6, tag: 'review' });

    await waitHold();
    phase('stamping');
    decide(app, result);
    scene('stamp', { decision: app.decision, appId: app.id, position: app.assignedRole });
    state.characters.krabs = 'stamping';
    await sleep(1700);
    await waitHold();
    phase('outcome');
    scene('outcome', { decision: app.decision, position: app.assignedRole, name: app.name || app.nickname, user: app.uniqueId, source: app.source });
    scene('krabs', { anim: app.decision === 'ACCEPTED' ? 'excited' : app.decision === 'DENIED' ? 'annoyed' : 'suspicious', duration: 2.5 });
    await speak('krabs', result.announcement, { priority: 6, tag: 'review' });
    if (app.decision === 'ACCEPTED') { // SpongeBob greets his new coworker
      try { scene('sponge', { anim: 'wave', duration: 3 }); await speak('spongebob', await spongeLine('welcome', { name: app.name || app.nickname, position: app.assignedRole }), { priority: 6, tag: 'review' }); }
      catch (e) { log('warn', 'SpongeBob welcome line skipped: ' + e.message); }
    }
    await sleep(settings.hiring.pauseBetweenSec * 1000);
  } catch (e) {
    if (!app.decision) {
      app.status = 'queued';
      queueOrder.push(app.id);
      log('warn', `Review of ${app.id} interrupted: ${e.message}`);
    }
  } finally {
    scene('paper', { action: 'file' });
    state.stage.paper = null;
    review = null;
    state.hiring.currentId = null;
    state.characters.krabs = 'idle';
    phase('idle');
  }
}

function decide(app, r) {
  if (app.decision) throw new Error(`${app.id} already decided`);
  if (!DECISIONS.includes(r.decision)) throw new Error('invalid decision');
  Object.assign(app, { decision: r.decision, assignedRole: r.position || '', explanation: r.explanation, announcement: r.announcement, decidedBy: r.by, decidedAt: Date.now(), status: 'decided' });
  apps.delete(app.id);
  pushCapped(history, app, 200);
  state.lastDecision = { name: app.name || app.nickname, decision: app.decision, position: app.assignedRole };
  if (app.decision === 'ACCEPTED') { employees[app.userKey] = { name: app.name || app.nickname, user: app.uniqueId, position: app.assignedRole || 'Fry Cook', wageCents: 150, raises: 0, hiredAt: Date.now(), lastAsk: 0 }; savePayroll(); }
  log('info', `Application ${app.id} (${app.nickname}) → ${app.decision}${app.assignedRole ? ' as ' + app.assignedRole : ''} [${r.by}]`);
  changed();
}

/** Stamp test with a dummy paper; never touches the real queue. */
export async function stampTest(decision = 'ACCEPTED') {
  if (review) throw new Error('Wait for the current review to finish');
  const paper = { id: 'test', name: 'TEST APPLICANT', user: 'stamp-test', role: '', experience: 'Animation test', pitch: '', priority: 0, source: 'test' };
  scene('paper', { action: 'pickup', paper });
  await sleep(1400);
  scene('stamp', { decision, appId: 'test', position: decision === 'DENIED' ? '' : 'Test Position' });
  await sleep(1800);
  scene('outcome', { decision, name: 'TEST', user: 'stamp-test', source: 'test' });
  await sleep(1500);
  scene('paper', { action: 'file' });
}

export function reviewNow() { if (!review) tick(true); }

function tick(force = false) {
  const now = Date.now();
  for (const id of queueOrder) { const a = apps.get(id); if (a.status === 'collecting' && a.followupDeadline && now > a.followupDeadline) markQueued(a); }
  if (review || Date.now() < holdUntil || (!force && (state.hiring.paused || !settings.hiring.autoReview))) return;
  if (state.hiring.held) { state.hiring.held = false; changed(); }
  const next = queueOrder.map(id => apps.get(id)).find(a => a.status === 'queued');
  if (next) runReview(next);
}
setInterval(() => tick(), 1000).unref();
