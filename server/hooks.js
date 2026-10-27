// Dead-air hooks: when chat goes quiet, Mr. Krabs grabs attention with a fresh AI-written call to action
// (camera push-in + banner + animation). Never runs during events, reviews or other speech.
import { settings } from './settings.js';
import { state, scene, log, changed } from './hub.js';
import { speak } from './voice.js';
import { idleHook } from './ai.js';

const FALLBACK = [
  ['Chat is quieter than Squidward\'s fan club! Type why ye want a job and I might hire ye!', 'TYPE WHY YOU WANT A JOB'],
  ['One Galaxy and this whole restaurant goes KA-BOOM. Don\'t tempt me!', 'GALAXY = KA-BOOM'],
  ['I\'m hirin\' RIGHT NOW. First one to type gets me undivided, money-lovin\' attention!', 'APPLY IN CHAT NOW'],
  ['Send a Donut and watch SpongeBob lose his mind!', 'DONUT = DANCE PARTY'],
];

let lastHookAt = 0, running = false, fb = 0;
const recent = [];

function quietFor() { return (Date.now() - Math.max(state.lastChatAt || state.startedAt, lastHookAt)) / 1000; }

export async function runHook() {
  if (running) return false;
  running = true;
  try {
    let line, banner;
    try {
      const gs = state.giftStats || {}, gl = settings.goal;
      const ask = () => idleHook({
        queue: state.hiringQueueLength || 0, lastDecision: state.lastDecision || null, recent: recent.slice(-6),
        goal: gl?.enabled ? { label: gl.label, have: gs.goalCoins || 0, target: gl.targetCoins } : null,
        top: gs.top ? { name: gs.top.name, coins: gs.top.coins } : null,
        lastGift: gs.lastGift && Date.now() - gs.lastGift.t < 10 * 60000 ? gs.lastGift : null,
      });
      ({ line, banner } = await ask().catch(() => ask())); // one fresh retry if a line is rejected
    } catch (e) {
      log('warn', `Hook line from AI failed (${e.message}); using a stock hook`);
      [line, banner] = FALLBACK[fb++ % FALLBACK.length];
    }
    recent.push(line); if (recent.length > 12) recent.shift();
    scene('camera', { shot: 'krabs_close', duration: 5 });
    scene('krabs', { anim: Math.random() < 0.5 ? 'excited' : 'greedy', duration: 3 });
    scene('sfx', { sound: 'whoosh', intensity: 1 });
    if (banner) scene('banner', { text: banner, color: '#e11d48', duration: 5 });
    if (Math.random() < 0.35) scene('sponge', { anim: 'wave', duration: 2.5 });
    await speak('krabs', line, { priority: 1, tag: 'hook' });
    return true;
  } finally { lastHookAt = Date.now(); running = false; changed(); }
}

setInterval(() => {
  const h = settings.hooks;
  if (!h?.enabled || !state.running || running) return;
  if (quietFor() < (lastHookAt > (state.lastChatAt || 0) ? h.repeatSec : h.quietSec)) return;
  const v = state.status.voice;
  const busy = v.speaking || v.queue > 0 || state.stage.nuke || (state.groove?.phase && state.groove.phase !== 'idle')
    || state.reactions.active.length > 0 || state.reactions.queued.length > 0 || state.hiring.phase !== 'idle';
  if (!busy) runHook().catch(e => log('warn', 'Hook failed: ' + e.message));
}, 1000).unref();
