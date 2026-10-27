// TikTok LIVE provider adapter (unofficial `tiktok-live-connector`, Euler Stream signing).
// Emits normalized events through `onEvent`. Never fabricates events or a connected state.
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
import { settings, getSecret } from '../settings.js';
import { state, log, changed } from '../hub.js';
import { mergeCatalog } from '../gifts.js';

let conn = null, onEvent = () => {}, reconnectTimer = null, attempts = 0, wantConnected = false;

function setStatus(s, detail = '') { state.status.tiktok = { ...state.status.tiktok, state: s, detail, username: settings.tiktok.username }; changed(); }

// The connector decodes TikTok's v3 protobufs (user.id / user.displayId, chat.content, gift.gift.*);
// older v1 field names (userId / uniqueId, comment, giftDetails.*) are kept as fallbacks.
const img = (m) => m?.urlList?.[0] || m?.urls?.[0] || m?.url?.[0] || '';
const normUser = (u) => {
  const handle = u?.displayId || u?.uniqueId || u?.specialId || '';
  return { userId: String(u?.id || u?.userId || handle || 'unknown'), uniqueId: handle || u?.nickname || 'viewer', nickname: u?.nickname || handle || 'viewer', avatar: img(u?.avatarThumb) || img(u?.profilePicture) };
};
const msgId = (d) => d?.common?.msgId || d?.event?.msgId || d?.common?.msg_id || '';
const chatText = (d) => String(d?.content ?? d?.comment ?? '');
function giftInfo(d) {
  const g = d.gift || {}, det = d.giftDetails || {}, ext = d.extendedGiftInfo || {};
  const id = String(d.giftId || g.id || '');
  return {
    id, name: g.name || det.giftName || ext.name || `Gift ${id}`,
    giftType: g.type ?? det.giftType ?? ext.type, combo: g.combo,
    diamonds: g.diamondCount ?? det.diamondCount ?? ext.diamond_count,
    image: img(g.image) || img(g.icon) || det.giftImage?.giftPictureUrl || ext.image?.url_list?.[0] || '',
  };
}

export function setEventHandler(fn) { onEvent = fn; }

const learned = new Set();
function learnGift(g) {
  if (!g.name || g.name.startsWith('Gift ') || learned.has(g.id)) return;
  learned.add(g.id);
  try { mergeCatalog([{ id: g.id, name: g.name, diamond_count: g.diamonds, type: g.giftType, image: { url_list: [g.image].filter(Boolean) } }]); changed(); log('info', `Learned gift from TikTok: ${g.name} (${g.diamonds} coins)`); }
  catch (e) { log('warn', 'Could not record gift ' + g.name + ': ' + e.message); }
}
let rawLogged = 0;

function build() {
  // enableExtendedGiftInfo downloads the gift list through Euler's Business-plan signing route, so it stays off;
  // the catalog is filled from real gift events instead (they carry name, coins and artwork).
  const opts = { enableExtendedGiftInfo: false, processInitialData: false };
  const key = getSecret('eulerStreamApiKey');
  if (key) opts.signApiKey = key;
  const c = new TikTokLiveConnection(settings.tiktok.username, opts);

  c.on(WebcastEvent.CHAT, (d) => {
    const user = normUser(d.user), text = chatText(d);
    if (rawLogged < 2 && !text) { rawLogged++; log('warn', 'Chat event without text; fields: ' + Object.keys(d || {}).join(',')); }
    onEvent({ id: 'tt:' + (msgId(d) || `chat:${user.userId}:${text}:${Date.now()}`), source: 'live', type: 'chat', user, text });
  });
  c.on(WebcastEvent.GIFT, (d) => {
    const g = giftInfo(d), user = normUser(d.user);
    learnGift(g);
    const repeatEnd = Boolean(d.repeatEnd);
    // Streakable ("combo") gifts send progress updates, then a final repeatEnd event.
    const streakable = g.combo === true || g.giftType === 1;
    onEvent({
      // Streak updates share msgIds on some versions; key on streak state so each update is distinct but true resends dedupe.
      id: `tt:gift:${msgId(d)}:${user.userId}:${g.id}:${d.groupId}:${d.repeatCount}:${repeatEnd}`,
      source: 'live', type: 'gift', user,
      gift: { id: g.id, name: g.name, giftType: streakable ? 1 : 0, diamonds: g.diamonds, repeatCount: Number(d.repeatCount) || 1, repeatEnd, groupId: d.groupId, image: g.image },
    });
  });
  c.on(WebcastEvent.MEMBER, (d) => onEvent({ id: 'tt:join:' + (msgId(d) || normUser(d.user).userId + ':' + Date.now()), source: 'live', type: 'join', user: normUser(d.user) }));
  c.on(WebcastEvent.LIKE, (d) => onEvent({ id: 'tt:like:' + (msgId(d) || normUser(d.user).userId + ':' + Date.now()), source: 'live', type: 'like', user: normUser(d.user), count: Number(d.count ?? d.likeCount) || 1 }));
  c.on(WebcastEvent.SHARE, (d) => onEvent({ id: 'tt:share:' + (msgId(d) || normUser(d.user).userId + ':' + Date.now()), source: 'live', type: 'share', user: normUser(d.user) }));
  c.on(WebcastEvent.FOLLOW, (d) => onEvent({ id: 'tt:follow:' + (msgId(d) || d.user?.userId), source: 'live', type: 'follow', user: normUser(d.user) }));
  c.on(WebcastEvent.STREAM_END, () => { log('warn', 'TikTok reports the stream ended'); setStatus('disconnected', 'Stream ended'); wantConnected = false; });
  c.on(ControlEvent.DISCONNECTED, ({ reason } = {}) => {
    if (!wantConnected) { setStatus('disconnected', 'Disconnected'); return; }
    scheduleReconnect(`Connection lost${reason ? ': ' + reason : ''}`);
  });
  c.on(ControlEvent.ERROR, ({ info, exception } = {}) => log('warn', `TikTok error: ${info || ''} ${exception?.message || ''}`));
  return c;
}

function scheduleReconnect(why) {
  clearTimeout(reconnectTimer);
  if (!settings.tiktok.autoReconnect || attempts >= settings.tiktok.maxReconnectAttempts) { setStatus('error', `${why}. Auto-reconnect exhausted — press Reconnect.`); return; }
  attempts++;
  const delay = Math.min(60000, 2000 * 2 ** (attempts - 1));
  setStatus('reconnecting', `${why}. Retry ${attempts}/${settings.tiktok.maxReconnectAttempts} in ${Math.round(delay / 1000)}s`);
  reconnectTimer = setTimeout(() => connect(true), delay);
}

export async function connect(isRetry = false) {
  if (!settings.tiktok.username) { setStatus('error', 'Set your TikTok username in Settings → TikTok'); return { ok: false, error: 'No username' }; }
  if (!isRetry) attempts = 0;
  wantConnected = true;
  await disconnectQuiet();
  setStatus(isRetry ? 'reconnecting' : 'connecting', `Connecting to @${settings.tiktok.username}…`);
  conn = build();
  try {
    const st = await conn.connect();
    attempts = 0;
    setStatus('connected', `Room ${st.roomId} — waiting for events`);
    log('info', `Connected to TikTok LIVE @${settings.tiktok.username} (room ${st.roomId})`);
    const gifts = conn.availableGifts;
    if (gifts) { const n = mergeCatalog(Array.isArray(gifts) ? gifts : gifts.gifts || []); log('info', `Gift catalog refreshed from TikTok (${n} gifts)`); }
    return { ok: true };
  } catch (e) {
    const msg = e?.message || String(e);
    log('error', `TikTok connect failed: ${msg}`);
    if (/offline|not live|UserOffline/i.test(msg + e?.constructor?.name)) { wantConnected = false; setStatus('error', `@${settings.tiktok.username} is not live right now`); }
    else if (/sign|api key|401|403|rate/i.test(msg)) { wantConnected = false; setStatus('error', `Signing failed — add/check your Euler Stream API key. (${msg.slice(0, 120)})`); }
    else scheduleReconnect(`Connect failed: ${msg.slice(0, 120)}`);
    return { ok: false, error: msg };
  }
}

async function disconnectQuiet() { if (conn) { const c = conn; conn = null; c.removeAllListeners?.(); try { await c.disconnect(); } catch { /* ignore */ } } }

export async function disconnect() {
  wantConnected = false; clearTimeout(reconnectTimer);
  await disconnectQuiet();
  setStatus('disconnected', 'Disconnected by operator');
}

/** Gift catalog refresh without a full connection (still requires the user to be live, since TikTok scopes gifts to a room). */
export async function refreshCatalog() {
  if (!settings.tiktok.username) throw new Error('Set your TikTok username first');
  const opts = {}; const key = getSecret('eulerStreamApiKey'); if (key) opts.signApiKey = key;
  const c = conn || new TikTokLiveConnection(settings.tiktok.username, opts);
  if (!c.roomId) await c.fetchRoomId();
  try {
    const gifts = await c.fetchAvailableGifts();
    return mergeCatalog(Array.isArray(gifts) ? gifts : gifts.gifts || []);
  } catch (e) {
    if (/Business plan/i.test(e.message)) throw new Error('Downloading the full gift list needs a paid Euler Stream Business plan. Gifts are added to the library automatically as viewers send them during your LIVE.');
    throw e;
  }
}
