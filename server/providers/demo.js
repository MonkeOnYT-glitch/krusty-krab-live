// Demo provider: builds simulated events (always source:'demo', visibly labeled in every UI).
// Only usable while the app is in Demo Mode, so simulated events never mix into a real LIVE session.
import crypto from 'node:crypto';
import { getCatalog } from '../gifts.js';

const uid = () => crypto.randomBytes(6).toString('hex');
const user = (name) => ({ userId: 'demo-' + String(name).toLowerCase(), uniqueId: String(name), nickname: String(name), avatar: '' });

export function demoChat(username, text) {
  return { id: 'demo:' + uid(), source: 'demo', type: 'chat', user: user(username || 'demo_viewer'), text: String(text).slice(0, 300) };
}

/** A completed gift (streak already ended). `id` may be passed to simulate a duplicate delivery. */
export function demoGift(username, giftName, count = 1, id = null) {
  const c = getCatalog().gifts.find(g => g.name.toLowerCase() === String(giftName).toLowerCase());
  return {
    id: id || 'demo:' + uid(), source: 'demo', type: 'gift', user: user(username || 'demo_gifter'),
    gift: { id: c?.id ?? null, name: c?.name || giftName, giftType: 1, diamonds: c?.coins ?? null, repeatCount: Math.max(1, count | 0), repeatEnd: true, groupId: uid(), image: c?.image || '' },
  };
}

/** A gift streak: progress updates (repeatEnd=false) then the final event, like TikTok sends. */
export function demoStreak(username, giftName, count) {
  const groupId = uid(), base = demoGift(username, giftName, 1);
  const evts = [];
  for (let i = 1; i <= count; i++) evts.push({ ...base, id: `demo:${groupId}:${i}`, gift: { ...base.gift, groupId, repeatCount: i, repeatEnd: false } });
  evts.push({ ...base, id: `demo:${groupId}:end`, gift: { ...base.gift, groupId, repeatCount: count, repeatEnd: true } });
  return evts;
}

export function demoSimple(type, username, extra = {}) { return { id: 'demo:' + uid(), source: 'demo', type, user: user(username || 'demo_viewer'), ...extra }; }
export function demoFollow(username) { return { id: 'demo:' + uid(), source: 'demo', type: 'follow', user: user(username || 'demo_follower') }; }
export function demoCustom(name, username) { return { id: 'demo:' + uid(), source: 'demo', type: 'custom', name, user: user(username || 'operator') }; }
