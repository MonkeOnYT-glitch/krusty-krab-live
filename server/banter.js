// Background banter: every so often Squidward complains and Mr. Krabs fires back.
// Lowest voice priority, and it waits for a quiet moment so it never talks over hiring or gifts.
import { settings } from './settings.js';
import { state, scene, log } from './hub.js';
import { speak } from './voice.js';
import { banterExchange } from './ai.js';

const PAIRS = [
  ['I wanna go home.', "Ye can go home when the register's empty, Mr. Squidward. Which is never!"],
  ['Is my shift over yet?', "Yer shift ends when I say it ends. And I haven't said it."],
  ['Why do I even work here?', 'Because I pay ye! Barely, but I pay ye!'],
  ['Another applicant. Wonderful. Just wonderful.', 'Smile, Squidward! New hires mean more money!'],
  ['I could be practicing my clarinet right now.', 'And I could be dockin\' yer pay right now!'],
  ['Can I get a raise?', 'A raise? Ha! Ye just raised me blood pressure!'],
  ['My feet hurt.', 'Ye have six of them, lad. Rotate!'],
  ['This job is crushing my soul.', 'Souls are free, Mr. Squidward. Wages are not.'],
  ['Do we really need more employees?', 'More employees, more customers, more MONEY! Arr arr arr!'],
  ['I need a vacation.', "Ye just had one! Ye blinked for three whole seconds!"],
];

let nextAt = 0, last = -1, running = false;
const recentBanter = [];
const schedule = () => { const b = settings.banter; nextAt = Date.now() + (b.minSec + Math.random() * Math.max(0, b.maxSec - b.minSec)) * 1000; };
schedule();

export async function runBanter() {
  if (running) return false;
  running = true;
  try {
    const CASTS = [['squidward', 'krabs'], ['spongebob', 'squidward'], ['spongebob', 'krabs'], ['spongebob', 'squidward', 'krabs'], ['squidward', 'spongebob']];
    const cast = CASTS[Math.floor(Math.random() * CASTS.length)];
    const gs = state.giftStats || {};
    const context = [state.lastDecision ? `Latest hire decision: ${state.lastDecision.name} → ${state.lastDecision.decision}${state.lastDecision.position ? ' as ' + state.lastDecision.position : ''}` : 'No hires yet today',
      gs.lastGift ? `Last gift: ${gs.lastGift.user} sent ${gs.lastGift.gift}` : 'Quiet shift', `${state.hiringQueueLength || 0} applicants waiting`].join('. ');
    let lines;
    try { lines = await banterExchange({ cast, context, recent: recentBanter.slice(-4) }); }
    catch (e) {
      log('warn', `Banter from AI failed (${e.message}); using a stock exchange`);
      let i; do { i = Math.floor(Math.random() * PAIRS.length); } while (i === last && PAIRS.length > 1);
      last = i; lines = [{ character: 'squidward', text: PAIRS[i][0] }, { character: 'krabs', text: PAIRS[i][1] }];
    }
    recentBanter.push(lines.map(l => l.text).join(' / ')); if (recentBanter.length > 8) recentBanter.shift();
    const anim = { squidward: ['squid', 'annoyed'], spongebob: ['sponge', 'cheer'], krabs: ['krabs', 'annoyed'] };
    for (const l of lines) {
      state.characters[l.character] = 'talking';
      const [cmd, a] = anim[l.character]; scene(cmd, { anim: a, duration: 2.5, layered: true });
      await speak(l.character, l.text, { priority: 0, tag: 'banter' });
      state.characters[l.character] = 'idle';
    }
    return true;
  } catch (e) { log('warn', 'Banter failed: ' + e.message); return false; }
  finally { running = false; schedule(); }
}

setInterval(() => {
  const b = settings.banter;
  if (!b?.enabled || !state.running || Date.now() < nextAt) return;
  const v = state.status.voice;
  const busy = v.speaking || v.queue > 0 || state.stage.nuke || (state.groove?.phase && state.groove.phase !== 'idle')
    || state.reactions.active.length > 0 || state.reactions.queued.length > 0 || state.hiring.phase !== 'idle';
  if (busy) { nextAt = Date.now() + 5000; return; } // try again shortly
  runBanter();
}, 1000).unref();
