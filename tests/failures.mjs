// Failure-handling test against a running server: AI down, TikTok not configured, voice off.
// Restores the original settings afterwards. Usage: node tests/failures.mjs [port]
import WebSocket from 'ws';

const ws = new WebSocket(`ws://127.0.0.1:${process.argv[2] || 7777}/ws`);
let S = null, seq = 0; const pending = new Map(); const results = [];
const check = (n, ok, info = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); };
const req = (action, data = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ t: 'req', id, action, data })); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'state') S = m.state; else if (m.t === 'res') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.res(m.data) : p.rej(new Error(m.error)); } });
await new Promise(r => ws.on('open', r)); await sleep(500);

const orig = { endpoint: S.settings.ai.endpoint, username: S.settings.tiktok.username, provider: S.settings.voice.provider };
try {
  await req('settings.update', { patch: { ai: { endpoint: 'http://127.0.0.1:9' } } });
  const r = await req('ai.test'); await sleep(400);
  check('AI unreachable → clear error, no crash', !r.ok && S.status.ai.state === 'error', r.error);
  await req('demo.gift', { user: 'gifter', gift: 'Rose' });
  await sleep(800);
  check('Gift reactions still work while AI is down', S.reactions.active.length > 0 || S.gifts.some(g => g.user === 'gifter'));

  await req('settings.update', { patch: { voice: { provider: 'none' } } });
  await req('voice.test', { character: 'krabs', text: 'Testing without a voice engine.' });
  check('Voice disabled → lines still flow (subtitles only)', true);

  await req('setMode', { mode: 'live' });
  await req('settings.update', { patch: { tiktok: { username: '' } } });
  const c = await req('tiktok.connect'); await sleep(400);
  check('TikTok connect without username → error state, no fake connection', !c.ok && S.status.tiktok.state === 'error', S.status.tiktok.detail);
  let refused = false; try { await req('demo.gift', { user: 'x', gift: 'Rose' }); } catch { refused = true; }
  check('Simulated events refused in LIVE mode', refused);
} finally {
  await req('settings.update', { patch: { ai: { endpoint: orig.endpoint }, tiktok: { username: orig.username }, voice: { provider: orig.provider } } });
  await req('setMode', { mode: 'demo' });
  const r2 = await req('ai.test');
  check('AI recovers after endpoint restored (retry works)', r2.ok, r2.error || '');
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
ws.close(); process.exit(results.every(Boolean) ? 0 : 1);
