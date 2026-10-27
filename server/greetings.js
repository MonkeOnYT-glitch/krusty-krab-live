// Viewer appreciation: welcome people who join, thank likers in batches, thank every share.
// Joins and likes are batched so a busy room never floods the voice queue; shares are thanked right away.
import { settings } from './settings.js';
import { state, scene, log } from './hub.js';
import { speak } from './voice.js';
import { greetLine } from './ai.js';

const joins = new Map(); // userId -> name (most recent first when read)
const likes = new Map(); // userId -> { name, count }
const welcomed = new Set(); // don't welcome the same person twice per stream
let lastJoinAt = 0, lastLikeAt = 0, busyLine = false;

const cfg = () => settings.greet || {};

async function sayGreeting(kind, names, extra, fallback, priority) {
  let line = fallback;
  try { line = await greetLine(kind, names, extra); } catch (e) { log('debug', `Greeting line fell back (${e.message})`); }
  return speak('krabs', line, { priority, tag: 'greet' });
}

export function onJoin(evt) {
  if (!cfg().joins) return;
  const id = evt.user.userId;
  if (welcomed.has(id)) return;
  joins.delete(id); joins.set(id, evt.user.nickname || evt.user.uniqueId);
  while (joins.size > 12) joins.delete(joins.keys().next().value); // keep the most recent arrivals
}

export function onLike(evt) {
  if (!cfg().likes) return;
  const u = likes.get(evt.user.userId) || { name: evt.user.nickname || evt.user.uniqueId, count: 0 };
  u.count += Math.max(1, Number(evt.count) || 1);
  likes.set(evt.user.userId, u);
}

export function onShare(evt) {
  if (!cfg().shares) return;
  const who = evt.user.nickname || evt.user.uniqueId;
  scene('banner', { text: `🔁 ${who} shared the stream!`, color: '#22c55e', duration: 3.5, demo: evt.source === 'demo', small: true });
  scene('krabs', { anim: 'excited', duration: 2, layered: true });
  sayGreeting('share', [who], null, `Thanks for sharin' the Krusty Krab, ${who}! More customers, more money!`, 3);
}

// Batched welcomes / like-thanks, only when nothing more important is happening.
setInterval(() => {
  if (!state.running || busyLine) return;
  const v = state.status.voice;
  if (v.queue > 1 || state.stage.nuke || state.reactions.active.length) return;
  const now = Date.now();
  if (joins.size && now - lastJoinAt > (cfg().joinEverySec || 20) * 1000) {
    const names = [...joins.values()].slice(-3).reverse();
    for (const [id, n] of [...joins]) if (names.includes(n)) { welcomed.add(id); joins.delete(id); }
    joins.clear(); // older arrivals beyond the 3 named are folded into "and everyone else"
    lastJoinAt = now; busyLine = true;
    sayGreeting('join', names, null, `Welcome aboard, ${names.join(', ')}! Type why ye want a job!`, 1).finally(() => { busyLine = false; });
    return;
  }
  if (likes.size && now - lastLikeAt > (cfg().likeEverySec || 30) * 1000) {
    const top = [...likes.values()].sort((a, b) => b.count - a.count).slice(0, 3);
    const total = [...likes.values()].reduce((n, u) => n + u.count, 0);
    likes.clear();
    lastLikeAt = now; busyLine = true;
    sayGreeting('like', top.map(u => u.name), { total }, `Thanks for the likes, ${top.map(u => u.name).join(' and ')}! Keep tappin'!`, 1).finally(() => { busyLine = false; });
  }
}, 2000).unref();

export function resetGreetings() { joins.clear(); likes.clear(); welcomed.clear(); }
