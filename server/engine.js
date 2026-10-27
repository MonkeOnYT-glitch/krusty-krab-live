// Event + reaction engine. Normalized events from any provider (TikTok LIVE or Demo) enter `ingest()`.
// Gift reactions run independently of AI inference; concurrency, queueing, cooldowns and dedupe are bounded.
import { settings } from './settings.js';
import { state, log, changed, scene, pushCapped } from './hub.js';
import { speak } from './voice.js';
import { handleChat, boostPriority, activeAppFor, userKey, hold } from './hiring.js';
import { recordGift } from './money.js';
import { onJoin, onLike, onShare } from './greetings.js';
import { spongeLine } from './ai.js';

export const GROOVE_LINE = 'I feel a groove coming on'; // must be spoken verbatim before the dance
export const countdownVoice = { urls: [] }; // Mr. Krabs saying "Three!" "Two!" "One!", synthesized at startup

const seen = new Set(); const seenOrder = [];
function isDuplicate(id) {
  if (!id) return false;
  if (seen.has(id)) return true;
  seen.add(id); seenOrder.push(id);
  if (seenOrder.length > 5000) seen.delete(seenOrder.shift());
  return false;
}

export const normGift = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function mappingKeyFor(evt) {
  if (evt.type === 'gift') {
    const k = 'gift:' + normGift(evt.gift.name);
    if (settings.mappings[k]) return k;
    const byId = Object.entries(settings.mappings).find(([, m]) => m.giftId && String(m.giftId) === String(evt.gift.id));
    return byId ? byId[0] : 'gift:*';
  }
  if (evt.type === 'follow') return 'event:follow';
  if (evt.type === 'custom') return 'custom:' + normGift(evt.name);
  return null;
}

// ------------------------------------------------------------------------------------------
export function ingest(evt) {
  if (isDuplicate(evt.id)) { log('debug', `Duplicate event ignored: ${evt.id}`); evt.duplicate = true; return { duplicate: true }; }
  evt.receivedAt = Date.now();
  if (evt.source === 'live' && state.status.tiktok.state === 'connected') { state.status.tiktok.state = 'live_active'; changed(); }
  switch (evt.type) {
    case 'chat':
      if (!String(evt.text || '').trim()) return { ignored: 'empty chat' };
      state.lastChatAt = Date.now();
      pushCapped(state.chat, { id: evt.id, source: evt.source, user: evt.user.uniqueId, nick: evt.user.nickname, text: evt.text, t: evt.receivedAt }, 80);
      changed();
      handleChat(evt).catch(e => log('error', 'Chat handler error: ' + e.message));
      return { ok: true };
    case 'gift': {
      const g = evt.gift;
      const streakKey = `${evt.source}:${evt.user.userId}:${g.id}:${g.groupId || ''}`;
      if (g.giftType === 1 && !g.repeatEnd) { // streak in progress: show only
        state.streaks[streakKey] = { user: evt.user.uniqueId, gift: g.name, count: g.repeatCount, t: Date.now(), source: evt.source };
        changed();
        return { streak: true };
      }
      delete state.streaks[streakKey];
      try { recordGift(evt); } catch (e) { log('warn', 'Gift stats error: ' + e.message); }
      { // SpongeBob cheers about half of the gifts (not ones that start his dance or the Galaxy event)
        const m = settings.mappings[mappingKeyFor(evt)];
        const busySponge = m?.actions?.some(a => a.type === 'spongebob_groove' || a.type === 'nuke');
        if (!busySponge && Math.random() < 0.5) spongeLine('gift', { who: evt.user.nickname || evt.user.uniqueId, gift: g.name, count: g.repeatCount || 1 })
          .then(line => { scene('sponge', { anim: 'cheer', duration: 2.5 }); speak('spongebob', line, { priority: 8, tag: 'gift' }); })
          .catch(e => log('debug', 'SpongeBob gift cheer skipped: ' + e.message));
      }
      pushCapped(state.gifts, { id: evt.id, source: evt.source, user: evt.user.uniqueId, nick: evt.user.nickname, gift: g.name, count: g.repeatCount || 1, diamonds: g.diamonds, image: g.image, t: evt.receivedAt }, 60);
      changed();
      return trigger(mappingKeyFor(evt), evt);
    }
    case 'join': onJoin(evt); return { ok: true };
    case 'like': onLike(evt); return { ok: true };
    case 'share': onShare(evt); return { ok: true };
    case 'follow': case 'custom':
      return trigger(mappingKeyFor(evt), evt);
    default: return { ignored: true };
  }
}

// --- reaction scheduling ------------------------------------------------------------------
const lastFired = new Map(); // key -> ts ; `${key}|${user}` -> ts
let rid = 0;
const active = []; const waiting = [];

function syncState() {
  state.reactions.active = active.map(r => ({ id: r.id, key: r.key, label: r.label, user: r.user, source: r.source, endsAt: r.endsAt }));
  state.reactions.queued = waiting.map(r => ({ id: r.id, key: r.key, label: r.label, user: r.user, source: r.source }));
  changed();
}

export function trigger(key, evt, { preview = false } = {}) {
  const m = settings.mappings[key];
  if (!m) return { ignored: 'no mapping' };
  if (!m.enabled) { log('info', `Reaction ${key} disabled; ${evt.user?.uniqueId} acknowledged only`); return { disabled: true }; }
  const qty = Math.max(1, Number(evt.gift?.repeatCount) || 1);
  const ctx = { key, evt, qty, label: m.label, user: evt.user?.nickname || evt.user?.uniqueId || 'someone', boosted: null };

  // State-changing actions always apply (cooldowns only throttle the show, not the queue rules).
  for (const act of m.actions) if (act.type === 'priority_boost' && evt.type === 'gift') {
    const per = act.params?.amount ?? settings.hiring.roseBoostPerGift;
    ctx.boosted = boostPriority(userKey(evt), act.params?.scaleWithQuantity === false ? per : per * qty, `${evt.gift.name} x${qty}`);
  }

  const now = Date.now(), uk = `${key}|${evt.user?.userId}`;
  if (!preview && (now - (lastFired.get(key) || 0) < m.cooldownSec * 1000 || now - (lastFired.get(uk) || 0) < (m.userCooldownSec || 0) * 1000)) {
    log('info', `Reaction ${key} on cooldown — ${ctx.user}'s gift counted, show skipped`);
    return { cooldown: true, boosted: !!ctx.boosted };
  }
  lastFired.set(key, now); lastFired.set(uk, now);

  const repeats = m.quantityMode === 'repeat' ? Math.min(qty, m.maxRepeats || 1) : 1;
  for (let i = 0; i < repeats; i++) schedule({ id: ++rid, key, m, ctx, label: m.label, user: ctx.user, source: evt.source });
  return { ok: true, repeats, boosted: !!ctx.boosted };
}

function schedule(r) {
  const sameActive = active.some(a => a.key === r.key);
  if (sameActive && r.m.overlap === 'skip') { log('info', `Reaction ${r.key} skipped (already running)`); return; }
  if ((sameActive && r.m.overlap === 'queue') || active.length >= settings.engine.maxConcurrentReactions) {
    if (waiting.length >= settings.engine.maxQueuedReactions) { log('warn', `Reaction queue full; dropped ${r.key} from ${r.user}`); return; }
    waiting.push(r); syncState(); return;
  }
  run(r);
}

function pumpWaiting() {
  for (let i = 0; i < waiting.length && active.length < settings.engine.maxConcurrentReactions; i++) {
    const r = waiting[i];
    if (r.m.overlap === 'queue' && active.some(a => a.key === r.key)) continue;
    waiting.splice(i, 1); i--; run(r);
  }
  syncState();
}

function fill(text, ctx) {
  const g = ctx.evt.gift;
  return String(text || '').replace(/\{user\}/g, ctx.user).replace(/\{gift\}/g, g?.name || '')
    .replace(/\{count\}/g, String(ctx.qty)).replace(/\{xcount\}/g, ctx.qty > 1 ? ` x${ctx.qty}` : '');
}

function run(r) {
  const { m, ctx } = r;
  const evDur = m.durationSec;
  let end = 0;
  r.timers = [];
  for (const act of m.actions) {
    const dur = act.duration ?? evDur;
    end = Math.max(end, (act.delay || 0) / 1000 + (act.type === 'voice' || act.type === 'spongebob_groove' ? 0 : dur));
    r.timers.push(setTimeout(() => execute(act, dur, ctx), act.delay || 0));
  }
  r.startedAt = Date.now(); r.endsAt = r.startedAt + end * 1000 + 300;
  hold(r.endsAt - r.startedAt);
  active.push(r); syncState();
  log('info', `Reaction ${r.key} started for ${r.user}${r.source === 'demo' ? ' [DEMO]' : ''}`);
  // A reaction that started SpongeBob's groove holds its slot until he has finished dancing,
  // so the next gift never starts on top of it (capped so a stuck sequence can't block forever).
  const hasGroove = m.actions.some(a => a.type === 'spongebob_groove');
  const release = () => {
    if (hasGroove && groove.phase !== 'idle' && Date.now() - r.startedAt < 60000) { hold(600); setTimeout(release, 300); return; }
    active.splice(active.indexOf(r), 1); pumpWaiting();
  };
  setTimeout(release, r.endsAt - r.startedAt);
}

function execute(act, dur, ctx) {
  const p = act.params || {}, demo = ctx.evt.source === 'demo', I = act.intensity ?? 1;
  try {
    switch (act.type) {
      case 'priority_boost':
        if (ctx.boosted) scene('banner', { text: `⭐ ${ctx.user} moved to #${ctx.boosted.position} in the hiring line`, color: '#ffd166', duration: 3.5, demo, small: true });
        break;
      case 'invite_apply':
        if (!ctx.boosted && ctx.evt.type === 'gift' && !activeAppFor(userKey(ctx.evt)))
          speak('krabs', `${ctx.user}, ye haven't applied yet! Tell me what job ye want and I'll look at yer paperwork.`, { priority: 7, tag: 'gift' });
        break;
      case 'voice': speak(p.character || 'krabs', fill(p.text, ctx), { priority: 8, tag: 'gift' }); break;
      case 'krabs_anim': scene('krabs', { anim: p.anim, duration: dur, layered: true }); break;
      case 'sponge_anim': if (groove.phase === 'idle') scene('sponge', { anim: p.anim === 'dance' ? 'cheer' : p.anim, duration: dur }); break;
      case 'spongebob_groove': if (ctx.evt.type === 'gift') groove.request(ctx); break;
      case 'sfx': scene('sfx', { sound: p.sound, intensity: I }); break;
      case 'music': scene('music', { track: p.track, duration: dur, intensity: I }); break;
      case 'particles': scene('particles', { kind: p.kind, duration: dur, intensity: I }); break;
      case 'lighting': setStage('light', p.mode, dur); scene('lighting', { mode: p.mode, duration: dur, intensity: I }); break;
      case 'camera': scene('camera', { shot: p.shot, duration: dur }); break;
      case 'transition': scene('transition', { style: p.style, duration: Math.min(dur, 3) }); break;
      case 'banner': scene('banner', { text: fill(p.text, ctx), color: p.color, duration: dur, demo }); break;
      case 'nuke':
        hold(dur * 1000); // the hiring office stops while the Krusty Krab is destroyed and rebuilt
        speak('krabs', 'Wait… what is that?', { priority: 10, tag: 'gift' });
        scene('krabs', { anim: 'suspicious', duration: 2.5 });
        setStage('nuke', true, dur); scene('nuke', { duration: dur, intensity: I, user: ctx.user, demo, countdown: countdownVoice.urls }); state.characters.krabs = 'panicking'; break;
      default: log('warn', 'Unknown action ' + act.type);
    }
  } catch (e) { log('error', `Action ${act.type} failed: ${e.message}`); }
}

const stageTimers = {};
function setStage(k, v, dur) {
  state.stage[k] = v; changed();
  clearTimeout(stageTimers[k]);
  stageTimers[k] = setTimeout(() => { state.stage[k] = k === 'light' ? 'normal' : false; if (k === 'nuke') state.characters.krabs = 'idle'; changed(); }, dur * 1000);
}

// --- SpongeBob groove sequence (gift-only) --------------------------------------------------
export const groove = {
  phase: 'idle', pending: [], endsAt: 0, startedAt: 0,
  request(ctx) {
    const e = settings.engine;
    if (this.phase === 'idle') { this.start(ctx); return 'started'; }
    if (e.groovePolicy === 'extend') {
      const base = this.phase === 'dancing' ? this.endsAt : Date.now() + e.grooveDanceSec * 1000;
      const cap = (this.startedAt || Date.now()) + e.grooveMaxDanceSec * 1000;
      this.extra = Math.min((this.extra || 0) + e.grooveExtendSec * 1000, Math.max(0, cap - base));
      if (this.phase === 'dancing') { this.endsAt = Math.min(this.endsAt + e.grooveExtendSec * 1000, cap); scene('spongeDance', { on: true, until: this.endsAt }); }
      log('info', `Groove extended by ${ctx.user}`); return 'extended';
    }
    if (e.groovePolicy === 'queue' && this.pending.length < e.grooveMaxQueue) { this.pending.push(ctx); log('info', `Groove queued for ${ctx.user}`); this.sync(); return 'queued'; }
    log('info', `Groove trigger from ${ctx.user} ignored (already dancing)`); return 'ignored';
  },
  sync() { state.characters.spongebob = this.phase === 'idle' ? 'idle (background)' : this.phase; state.groove = { phase: this.phase, pending: this.pending.length, endsAt: this.endsAt }; changed(); },
  async start(ctx) {
    const e = settings.engine;
    this.extra = 0;
    this.phase = 'noticing'; this.sync();
    scene('sponge', { anim: 'notice', duration: 1.2, user: ctx.user });
    await new Promise(r => setTimeout(r, 1100));
    this.phase = 'speaking'; this.sync();
    await speak('spongebob', GROOVE_LINE, { priority: 10, tag: 'groove' });
    this.phase = 'dancing';
    this.startedAt = Date.now();
    this.endsAt = Math.min(Date.now() + e.grooveDanceSec * 1000 + (this.extra || 0), this.startedAt + e.grooveMaxDanceSec * 1000);
    this.sync();
    scene('spongeDance', { on: true, until: this.endsAt, user: ctx.user });
    scene('krabsGlance', { mood: ['annoyed', 'amused', 'confused'][Math.floor(Math.random() * 3)] });
    while (Date.now() < this.endsAt) await new Promise(r => setTimeout(r, Math.min(250, this.endsAt - Date.now() + 5)));
    scene('spongeDance', { on: false });
    this.phase = 'idle'; this.startedAt = 0; this.sync();
    const next = this.pending.shift();
    if (next) setTimeout(() => { if (this.phase === 'idle') this.start(next); }, 1500);
    this.sync();
  },
};
