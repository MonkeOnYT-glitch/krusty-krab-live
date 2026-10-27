// Gift stats for this stream: a shared coin goal and the Top Tipper ("Employee of the Month").
// Both are classic, honest engagement drivers: a visible group target and public recognition.
import { settings } from './settings.js';
import { state, scene, log, changed } from './hub.js';
import { speak } from './voice.js';
import { shoutout } from './ai.js';

state.giftStats = { total: 0, byUser: {}, top: null, goalCoins: 0, goalsReached: 0, lastGift: null };

const coinsOf = (evt) => {
  const each = Number(evt.gift?.diamonds);
  return (Number.isFinite(each) && each > 0 ? each : evt.source === 'demo' ? 1 : 0) * Math.max(1, Number(evt.gift?.repeatCount) || 1);
};

async function say(kind, ctx, fallback) {
  let line = fallback;
  try { line = await shoutout(kind, ctx); } catch (e) { log('warn', `Shout-out line failed (${e.message}); using a stock line`); }
  speak('krabs', line, { priority: 8, tag: 'gift' });
}

/** Called for every completed gift (after streaks end). */
export function recordGift(evt) {
  const g = state.giftStats, coins = coinsOf(evt), cfg = settings.goal;
  const who = evt.user.nickname || evt.user.uniqueId;
  g.lastGift = { user: who, gift: evt.gift.name, count: evt.gift.repeatCount || 1, t: Date.now() };
  if (!coins) { changed(); return; }
  g.total += coins;
  const u = (g.byUser[evt.user.userId] ||= { name: who, coins: 0 });
  u.coins += coins; u.name = who;

  // Top Tipper: announce when the crown changes hands (not for every gift from the current holder).
  if (!g.top || (u.coins > g.top.coins && g.top.id !== evt.user.userId)) {
    const prev = g.top?.name;
    g.top = { id: evt.user.userId, name: who, coins: u.coins };
    scene('banner', { text: `👑 NEW TOP TIPPER: ${who}`, color: '#f59e0b', duration: 4, demo: evt.source === 'demo' });
    scene('sfx', { sound: 'chime' });
    say('top', { name: who, coins: u.coins, previous: prev }, `${who} is me new Employee of the Month! Who's brave enough to take that crown?`);
  } else if (g.top.id === evt.user.userId) g.top.coins = u.coins;

  // Shared goal
  if (cfg?.enabled && cfg.targetCoins > 0) {
    g.goalCoins += coins;
    if (g.goalCoins >= cfg.targetCoins) {
      g.goalsReached++;
      g.goalCoins -= cfg.targetCoins;
      log('info', `Gift goal reached (#${g.goalsReached})`);
      scene('goalReached', { label: cfg.label, n: g.goalsReached });
      scene('particles', { kind: 'coins', duration: 5, intensity: 1.4 });
      scene('music', { track: 'fanfare', duration: 5 });
      scene('krabs', { anim: 'excited', duration: 4 });
      say('goal', { label: cfg.label, target: cfg.targetCoins, top: g.top?.name }, `GOAL REACHED! Ye beautiful barnacles! Next goal starts NOW!`);
    }
  }
  changed();
}

export function resetStats() { state.giftStats = { total: 0, byUser: {}, top: null, goalCoins: 0, goalsReached: 0, lastGift: null }; changed(); }
