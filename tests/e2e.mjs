// End-to-end Demo Mode test against a running server (node tests/e2e.mjs [port]).
// Uses the real pipeline: GPT-OSS, voice, reaction engine. Prints PASS/FAIL per check.
import WebSocket from 'ws';

const PORT = process.argv[2] || 7777;
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
let S = null, seq = 0; const pending = new Map(); const scene = [];
const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const req = (action, data = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ t: 'req', id, action, data })); });
async function until(fn, ms, step = 250) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(step); } return null; }
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'state') S = m.state;
  else if (m.t === 'scene') scene.push({ ...m, rx: Date.now() });
  else if (m.t === 'res') { const p = pending.get(m.id); pending.delete(m.id); m.ok ? p.res(m.data) : p.rej(new Error(m.error)); }
});
await new Promise(r => ws.on('open', r));
await until(() => S, 5000);

await req('setMode', { mode: 'demo' });
await req('system.start');
check('Demo Mode active', (await until(() => S.mode === 'demo' && S.status.tiktok.state === 'demo', 3000)) != null);

// GPT-OSS detection
const t = await req('ai.test');
check('GPT-OSS backend detected & responding', t.ok, t.ok ? S.status.ai.detail : t.error);

// Natural-language application (no commands)
await req('hiring.pause', { paused: true }); // applications are reviewed instantly otherwise
const u = 'alex_e2e_' + Date.now() % 10000;
const histBefore = S.hiring.history.length;
await req('demo.chat', { user: u, text: 'My name is Alex and I need money for a new bike.' });
const app = await until(() => [...S.hiring.queue, S.hiring.current].find(a => a && a.uniqueId === u), 120000);
check('Chat message created an application (no commands)', !!app, app ? `name=${app.name} reason=${app.pitch} status=${app.status}` : '');
check('Name and reason extracted, queued right away', app && /alex/i.test(app.name) && !!(app.pitch || app.experience) && app.status !== 'collecting');

// Follow-up question flow
const u2 = 'sam_e2e_' + Date.now() % 10000;
await req('hiring.pause', { paused: true });
await req('demo.chat', { user: u2, text: 'Hire me!' });
const app2 = await until(() => S.hiring.queue.find(a => a.uniqueId === u2), 120000);
check('"Hire me!" is an application immediately (chat IS the application)', app2 && app2.status === 'queued', app2 ? `status=${app2.status}` : 'none');
await req('demo.chat', { user: u2, text: "I'm great with money and I love counting coins." });
const app2b = await until(() => { const a = S.hiring.queue.find(x => x.uniqueId === u2); return a && (a.pitch || a.experience) && a; }, 120000);
check('Extra chat adds details to the same application', !!app2b && S.hiring.queue.filter(x => x.uniqueId === u2).length === 1, app2b?.pitch || app2b?.experience);

// Rose → priority
const before = S.hiring.queue.findIndex(a => a.uniqueId === u2);
await req('demo.gift', { user: u2, gift: 'Rose', count: 1 });
const boosted = await until(() => { const a = S.hiring.queue.find(x => x.uniqueId === u2); return a && a.priority > 0 && a; }, 5000);
const after = S.hiring.queue.findIndex(a => a.uniqueId === u2);
check('Rose raises queue priority', !!boosted, `priority=${boosted?.priority} position ${before + 1}→${after + 1}`);
check('Rose plays banner + petals + voice', !!(await until(() => scene.find(c => c.cmd === 'banner' && /PRIORITY/.test(c.text)) && scene.find(c => c.cmd === 'particles' && c.kind === 'petals'), 4000)));

// Duplicate delivery
const dup = await req('demo.duplicate', { user: 'dupe_tester', gift: 'Rose' });
check('Duplicate gift delivery ignored', dup.second?.duplicate === true);

// Resume reviews; wait for both applications to be stamped
await req('hiring.pause', { paused: false });
const decided = await until(() => S.hiring.history.length >= histBefore + 2 && S.hiring.history.slice(0, 2), 400000, 500);
check('Applications reviewed and stamped', !!decided, decided?.map(a => `${a.nickname}:${a.decision}`).join(', '));
const seqOk = ['paper', 'stamp', 'outcome'].every(c => scene.some(x => x.cmd === c));
check('Review sequence: pickup → stamp → outcome commands', seqOk);
check('Mr. Krabs reads the application aloud with a paper close-up', scene.some(c => c.cmd === 'speak' && /Let's see here/.test(c.text)) && scene.some(c => c.cmd === 'camera' && c.shot === 'paper'));
check('Rose sender (u2) reviewed before Alex (priority)', decided && S.hiring.history.find(a => a.uniqueId === u2)?.decidedAt <= S.hiring.history.find(a => a.uniqueId === u)?.decidedAt);
const assigned = S.hiring.history.filter(a => [u, u2].includes(a.uniqueId));
check('Mr. Krabs assigns a position (unless denied)', assigned.every(a => a.decision === 'DENIED' ? !a.assignedRole : !!a.assignedRole), assigned.map(a => `${a.decision}${a.assignedRole ? ' as ' + a.assignedRole : ''}`).join(', '));

// Decided applicants are not answered (unless they reapply); @replies are ignored
const tq = Date.now();
await req('demo.chat', { user: u, text: 'lol this stream is so funny' });
await req('demo.chat', { user: 'replier', text: '@' + u2 + ' LMAOO!!' });
await sleep(25000);
const replies = scene.filter(c => c.cmd === 'speak' && c.tag === 'chat' && c.rx > tq);
check('Stamped viewers still get replies; @replies are ignored', replies.length === 1, replies.map(c => c.text).join(' | '));
await req('hiring.pause', { paused: true });
await req('demo.chat', { user: u, text: "I'd like to reapply, I've been practicing flipping patties all week!" });
const re = await until(() => scene.find(c => c.cmd === 'speak' && /reapplying/i.test(c.text)), 120000);
check('Reapplying works: "Reapplying, huh? Okay, here ye go!"', !!re && S.hiring.queue.some(a => a.uniqueId === u), re?.text);
const reApp = S.hiring.queue.find(a => a.uniqueId === u); if (reApp) await req('hiring.remove', { id: reApp.id });
await req('hiring.pause', { paused: false });

// Status check (for someone still waiting)
await req('hiring.pause', { paused: true });
await req('demo.chat', { user: 'waiter_' + u, text: 'Hire me please, I make the best kelp shakes in town.' });
await until(() => S.hiring.queue.find(a => a.uniqueId === 'waiter_' + u), 120000);
await req('demo.chat', { user: 'waiter_' + u, text: 'Did I get accepted?' });
const tStatus = Date.now();
const st = await until(() => scene.find(c => c.cmd === 'speak' && c.tag === 'chat' && c.rx > tStatus && /stamped (ACCEPTED|DENIED|CALL YOU LATER)|number \d+ in line|paperwork right now/.test(c.text)), 90000);
check('"Did I get accepted?" answered from real records', !!st && !/number 0/.test(st.text), st?.text);
{ const w = S.hiring.queue.find(a => a.uniqueId === 'waiter_' + u); if (w) await req('hiring.remove', { id: w.id }); await req('hiring.pause', { paused: false }); }

// Manual decisions: all three
for (const d of ['DENIED', 'ACCEPTED', 'CALL YOU LATER']) {
  await req('hiring.pause', { paused: true });
  const uu = 'manual_' + d.split(' ')[0].toLowerCase() + Date.now() % 1000;
  await req('demo.chat', { user: uu, text: 'My name is Pat and I want to work here because I love the smell of grease.' });
  const a = await until(() => S.hiring.queue.find(x => x.uniqueId === uu && x.status === 'queued'), 120000);
  await until(() => !S.hiring.current, 180000); // a stamp can only start when no other review is running
  if (a) { try { await req('hiring.decide', { decision: d, id: a.id }); } catch (e) { console.log('   decide error:', e.message); } }
  const h = await until(() => S.hiring.history.find(x => x.uniqueId === uu), 60000);
  check(`Manual stamp ${d} (AI writes fresh lines)`, h?.decision === d && h?.decidedBy === 'operator' && !/gut says no|maybe" pile|flip a patty without/.test(h?.explanation || ''), h?.explanation);
}
await req('hiring.pause', { paused: false });
const counts = S.hiring.counts;
check('All three decision types occurred', Object.values(counts).every(v => v > 0), JSON.stringify(counts));

// Donut → party + SpongeBob groove (line before dance)
scene.length = 0;
await req('demo.gift', { user: 'donut_fan', gift: 'Donut', count: 1 });
const party = await until(() => scene.find(c => c.cmd === 'lighting' && c.mode === 'party') && scene.find(c => c.cmd === 'krabs' && c.anim === 'dance'), 5000);
check('Donut triggers dance party (lights + Krabs dance)', !!party);
const line = await until(() => scene.find(c => c.cmd === 'speak' && c.character === 'spongebob'), 30000);
check('SpongeBob says exactly "I feel a groove coming on"', line?.text === 'I feel a groove coming on', JSON.stringify(line?.text));
const dance = await until(() => scene.find(c => c.cmd === 'spongeDance' && c.on), 30000);
check('Dance starts only after the line finished', dance && line && dance.rx >= line.rx + line.duration * 1000, `line ${line?.duration?.toFixed(2)}s, dance after ${dance && line ? ((dance.rx - line.rx) / 1000).toFixed(2) : '?'}s`);
await req('demo.gift', { user: 'donut_fan2', gift: 'Donut', count: 1 }); // while dancing → policy (queue by default)
await sleep(500);
check('Repeat groove trigger handled by policy (no overlap)', S.groove?.pending <= S.settings.engine.grooveMaxQueue, `phase=${S.groove?.phase} pending=${S.groove?.pending}`);
const danceOff = await until(() => scene.find(c => c.cmd === 'spongeDance' && c.on === false), 60000);
check('SpongeBob returns to idle after dancing', !!danceOff);

// Galaxy
scene.length = 0;
await req('demo.gift', { user: 'big_spender', gift: 'Galaxy', count: 1 });
check('Galaxy waits its turn, then triggers the cinematic event', !!(await until(() => scene.find(c => c.cmd === 'nuke'), 90000)));
check('Mr. Krabs: "Wait… what is that?"', !!(await until(() => scene.find(c => c.cmd === 'speak' && /what is that/i.test(c.text)), 15000)));
check('Hiring office on hold during the Galaxy', S.hiring.phase === 'paused (Galaxy)' || S.hiring.current == null);
const g2 = await req('demo.gift', { user: 'big_spender2', gift: 'Galaxy', count: 1 });
check('Second Galaxy respects cooldown', g2?.cooldown === true);

// Spam / cooldown & bounded queue
await req('demo.spam', { user: 'spam', gift: 'Rose', n: 10 });
await sleep(2500);
check('Reaction queue stays bounded under spam', S.reactions.active.length <= S.settings.engine.maxConcurrentReactions && S.reactions.queued.length <= S.settings.engine.maxQueuedReactions, `active=${S.reactions.active.length} queued=${S.reactions.queued.length}`);

// Squidward banter
await until(() => S.reactions.active.length === 0 && S.reactions.queued.length === 0 && !S.stage.nuke, 120000);
const tb = Date.now();
await req('banter.now');
const sq = scene.find(c => c.cmd === 'speak' && c.character === 'squidward' && c.rx >= tb && c.tag === 'banter');
const kr = scene.find(c => c.cmd === 'speak' && c.character === 'krabs' && c.rx >= tb && c.tag === 'banter');
check('Squidward complains and Mr. Krabs answers', !!sq && !!kr && kr.rx > sq.rx, `${sq?.text} / ${kr?.text}`);

// Dead-air hook: fresh AI line + banner + camera push-in
const th = Date.now();
await req('hook.now');
const hk = scene.find(c => c.cmd === 'speak' && c.tag === 'hook' && c.rx >= th);
check('Dead-air hook: AI line, banner and camera push-in', !!hk && scene.some(c => c.cmd === 'banner' && c.rx >= th) && scene.some(c => c.cmd === 'camera' && c.shot === 'krabs_close' && c.rx >= th), hk?.text);

// SpongeBob dance cannot be started manually
let refused = false; try { await req('scene.test', { target: 'sponge', anim: 'dance' }); } catch { refused = true; }
check('Manual SpongeBob dance request is refused', refused);
let refused2 = false; try { await req('voice.test', { character: 'spongebob', text: 'I feel a groove coming on' }); } catch { refused2 = true; }
check('Groove line cannot be spoken outside the gift sequence', refused2);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
ws.close();
process.exit(failed.length ? 1 : 0);
