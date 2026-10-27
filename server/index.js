// Krusty Krab LIVE — local server: static UI, WebSocket hub, and wiring of all subsystems.
import http from 'node:http';
import tls from 'node:tls';
// Trust the Windows certificate store too (as curl/Edge do); some TTS edge servers need it.
try { tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]); } catch { /* older Node: bundled CAs only */ }
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ROOT, settings, updateSettings, setSecret, secretStatus, listPresets, savePreset, restorePreset } from './settings.js';
import { state, log, changed, addClient, removeClient, send, setSnapshot, snapshot, scene, clientCount } from './hub.js';
import { ACTION_TYPES, KRABS_ANIMS, SPONGE_ANIMS, SOUNDS, PARTICLES, LIGHT_MODES, CAMERA_SHOTS, TRANSITIONS, MUSIC } from './defaults.js';
import * as ai from './ai.js';
import { speak, clearVoiceQueue, synthesize, TTS_DIR, serveLive } from './voice.js';
import * as hiring from './hiring.js';
import { ingest, trigger, normGift, GROOVE_LINE, groove, countdownVoice } from './engine.js';
import * as tiktok from './providers/tiktok.js';
import * as demo from './providers/demo.js';
import { getCatalog } from './gifts.js';
import { runBanter } from './banter.js';
import { runHook } from './hooks.js';
import { resetStats } from './money.js';

const PORT = Number(process.env.KK_PORT || 7777);

process.on('uncaughtException', (e) => log('error', 'Uncaught: ' + (e.stack || e.message)));
process.on('unhandledRejection', (e) => log('error', 'Unhandled rejection: ' + (e?.stack || e)));

function gate(evt) {
  if (!state.running) { log('info', `Stopped — ignored ${evt.type} from ${evt.user?.uniqueId}`); return { stopped: true }; }
  if (evt.source === 'live' && settings.mode !== 'live') return { ignored: 'not in LIVE mode' };
  if (evt.source === 'demo' && settings.mode !== 'demo') throw new Error('Demo events are only allowed in Demo Mode');
  return ingest(evt);
}
tiktok.setEventHandler((evt) => { try { gate(evt); } catch (e) { log('error', 'Event error: ' + e.message); } });

setSnapshot(() => ({
  ...state,
  mode: settings.mode,
  hiring: hiring.hiringSnapshot(),
  settings,
  secrets: secretStatus(),
  catalog: getCatalog(),
  presets: Object.keys(listPresets()),
  options: { ACTION_TYPES, KRABS_ANIMS, SPONGE_ANIMS, SOUNDS, PARTICLES, LIGHT_MODES, CAMERA_SHOTS, TRANSITIONS, MUSIC },
  clients: clientCount(),
}));

async function setMode(mode) {
  if (!['demo', 'live'].includes(mode)) throw new Error('bad mode');
  updateSettings({ mode });
  if (mode === 'demo') { await tiktok.disconnect(); state.status.tiktok = { ...state.status.tiktok, state: 'demo', detail: 'Demo Mode — simulated events only' }; }
  else state.status.tiktok = { ...state.status.tiktok, state: 'disconnected', detail: 'LIVE mode — press Connect' };
  log('info', `Mode switched to ${mode.toUpperCase()}`);
  changed();
}

function giftNameForKey(key) {
  const k = key.replace(/^gift:/, '');
  return getCatalog().gifts.find(g => g.key === k)?.name || k.replace(/_/g, ' ');
}

// --- request handlers ------------------------------------------------------------------------
const handlers = {
  getState: () => snapshot(),
  setMode: ({ mode }) => setMode(mode),
  'system.start': () => { state.running = true; log('info', 'Event processing started'); if (settings.mode === 'live') tiktok.connect(); changed(); },
  'system.stop': async () => { state.running = false; await tiktok.disconnect(); if (settings.mode === 'demo') state.status.tiktok.state = 'demo'; clearVoiceQueue(); log('info', 'Event processing stopped'); changed(); },
  'tiktok.connect': () => { if (settings.mode !== 'live') throw new Error('Switch to LIVE mode first'); return tiktok.connect(); },
  'tiktok.disconnect': () => tiktok.disconnect(),
  'tiktok.refreshCatalog': async () => ({ count: await tiktok.refreshCatalog() }),
  'ai.test': () => ai.testConnection(),
  'ai.models': () => ai.listModels(),
  'voice.test': ({ character, text }) => {
    if (String(text).toLowerCase().includes('groove coming on')) throw new Error('That line is reserved for the gift-triggered sequence');
    return speak(character, text, { priority: 9, tag: 'test' });
  },
  'voice.clear': () => clearVoiceQueue(),
  'demo.chat': ({ user, text }) => gate(demo.demoChat(user, text)),
  'demo.gift': ({ user, gift, count = 1, streak = false }) => {
    if (streak) { const evts = demo.demoStreak(user, gift, count); evts.forEach((e, i) => setTimeout(() => { try { gate(e); } catch (err) { log('error', err.message); } }, i * 250)); return { streakEvents: evts.length }; }
    return gate(demo.demoGift(user, gift, count));
  },
  'demo.duplicate': ({ user, gift }) => { const e = demo.demoGift(user, gift, 1); const a = gate(e); const b = gate({ ...e }); return { first: a, second: b }; },
  'demo.spam': ({ user, gift, n = 10 }) => { for (let i = 0; i < n; i++) setTimeout(() => { try { gate(demo.demoGift(`${user || 'spammer'}${i % 3}`, gift, 1)); } catch (e) { log('error', e.message); } }, i * 120); return { sent: n }; },
  'demo.follow': ({ user }) => gate(demo.demoFollow(user)),
  'demo.join': ({ user }) => gate(demo.demoSimple('join', user)),
  'demo.like': ({ user, count = 15 }) => gate(demo.demoSimple('like', user, { count })),
  'demo.share': ({ user }) => gate(demo.demoSimple('share', user)),
  'demo.custom': ({ name, user }) => gate(demo.demoCustom(name, user)),
  'settings.update': ({ patch }) => { if (patch.mappings) throw new Error('use mappings.save'); updateSettings(patch); changed(); scene('settings', { scene: settings.scene, overlay: settings.overlay }); },
  'secrets.set': ({ name, value }) => { setSecret(name, value); log('info', `Secret ${name} updated`); changed(); },
  'mappings.save': ({ key, mapping }) => {
    if (!/^(gift:[a-z0-9_*]+|event:follow|custom:[a-z0-9_]+)$/.test(key)) throw new Error('Invalid mapping key');
    for (const a of mapping.actions || []) {
      if (!ACTION_TYPES[a.type]) throw new Error('Unknown action ' + a.type);
      if (a.type === 'spongebob_groove' && !key.startsWith('gift:')) throw new Error('SpongeBob\'s groove can only be assigned to gifts');
    }
    settings.mappings[key] = mapping; updateSettings({}); changed();
  },
  'mappings.delete': ({ key }) => { if (key === 'gift:*') throw new Error('Cannot delete the fallback mapping'); delete settings.mappings[key]; updateSettings({}); changed(); },
  'presets.save': ({ name }) => { savePreset(name); changed(); },
  'presets.restore': ({ name }) => { restorePreset(name); changed(); },
  'reaction.preview': ({ key }) => {
    if (settings.mode === 'demo') {
      if (key.startsWith('gift:')) return gate(demo.demoGift('preview_viewer', key === 'gift:*' ? 'Mystery Gift' : giftNameForKey(key), 1));
      if (key === 'event:follow') return gate(demo.demoFollow('preview_viewer'));
      return gate(demo.demoCustom(key.replace(/^custom:/, ''), 'preview_viewer'));
    }
    // LIVE mode: play the visual show only, flagged as a preview; no gift = no groove and no queue change.
    return trigger(key, { id: 'preview:' + Date.now(), source: 'preview', type: 'preview', user: { userId: 'preview', uniqueId: 'preview', nickname: 'PREVIEW' } }, { preview: true });
  },
  'hiring.move': ({ id, dir }) => hiring.moveApp(id, dir),
  'hiring.remove': ({ id }) => hiring.removeApp(id),
  'hiring.forceQueued': ({ id }) => hiring.forceQueued(id),
  'hiring.pause': ({ paused }) => hiring.setPaused(paused),
  'hiring.reviewNow': () => hiring.reviewNow(),
  'hiring.decide': ({ decision, id }) => hiring.manualDecision(decision, id),
  'hiring.returnToQueue': () => hiring.returnCurrentToQueue(),
  'hiring.stampTest': ({ decision }) => { hiring.stampTest(decision).catch(e => log('warn', e.message)); },
  'scene.test': ({ target, anim }) => {
    if (target === 'krabs' && KRABS_ANIMS.includes(anim)) scene('krabs', { anim, duration: 3 });
    else if (target === 'sponge' && SPONGE_ANIMS.includes(anim) && groove.phase === 'idle') scene('sponge', { anim, duration: 3 });
    else if (target === 'squid') scene('squid', { anim, duration: 3 });
    else throw new Error('Animation not available' + (target === 'sponge' ? ' (SpongeBob\'s dance only starts from a qualifying gift)' : ''));
  },
  'banter.now': () => runBanter(),
  'hook.now': () => runHook(),
  'stats.reset': () => resetStats(),
  'logs.get': () => state.logs,
};

// --- HTTP static ------------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wasm': 'application/wasm' };
const MUSIC_DIR = process.env.KK_MUSIC_DIR || path.join(ROOT, 'public', 'music');
const MOUNTS = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/tts/', TTS_DIR],
  ...(process.env.KK_MODELS_DIR ? [['/models/', process.env.KK_MODELS_DIR]] : []),
  ['/music/', MUSIC_DIR],
  ['/', path.join(ROOT, 'public')],
];
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (url === '/') url = '/control.html';
  if (url === '/api/music') {
    let files = [];
    try { files = fs.readdirSync(MUSIC_DIR).filter(f => /\.(mp3|ogg|m4a|wav)$/i.test(f)); } catch { /* no folder */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ files })); return;
  }
  const liveTts = url.match(/^\/tts-live\/([\w-]+)\.mp3$/);
  if (liveTts) { serveLive(liveTts[1], res); return; }
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.normalize(path.join(dir, url.slice(prefix.length)));
    if (!file.startsWith(dir)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': prefix === '/' && /\.(html|js|css)$/.test(file) ? 'no-cache' : 'max-age=3600' });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });
wss.on('connection', (ws, req) => {
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress)) { ws.close(1008, 'local only'); return; }
  addClient(ws);
  send(ws, { t: 'state', state: snapshot() });
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t !== 'req') return;
    const h = handlers[msg.action];
    try {
      if (!h) throw new Error('Unknown action ' + msg.action);
      const data = await h(msg.data || {});
      send(ws, { t: 'res', id: msg.id, ok: true, data: data ?? null });
    } catch (e) {
      send(ws, { t: 'res', id: msg.id, ok: false, error: e.message });
    }
  });
  ws.on('close', () => removeClient(ws));
  ws.on('error', () => removeClient(ws));
});

server.listen(PORT, '127.0.0.1', async () => {
  log('info', `Krusty Krab LIVE running — control panel http://localhost:${PORT}/  overlay http://localhost:${PORT}/overlay.html`);
  if (settings.mode === 'demo') state.status.tiktok = { state: 'demo', detail: 'Demo Mode — simulated events only', username: settings.tiktok.username };
  else state.status.tiktok.detail = 'LIVE mode — press Connect';
  changed();
  // Warm-up in the background: AI check and pre-synthesize the groove line so the sequence starts instantly.
  ai.testConnection();
  Promise.all(['Three!', 'Two!', 'One!'].map(x => synthesize('krabs', x, { stream: false }))).then(r => { countdownVoice.urls = r.map(x => x.url); log('info', 'Galaxy countdown voice ready'); }, e => log('warn', 'Countdown voice failed: ' + e.message));
  synthesize('spongebob', GROOVE_LINE, { stream: false }).then(r => log('info', `Groove line voice ready (${r.duration?.toFixed(2)}s)`), e => log('warn', 'Groove line pre-synthesis failed: ' + e.message));
});

async function shutdown() {
  log('info', 'Shutting down…');
  try { await tiktok.disconnect(); } catch { /* ignore */ }
  for (const ws of wss.clients) ws.close(1001, 'server shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
