// Samples the AI-written lines (shout-outs, SpongeBob, banter, gift hooks) from the local model: node tests/voice-lines-check.mjs
import { shoutout, spongeLine, banterExchange, idleHook } from '../server/ai.js';
const show = async (label, p) => { try { const v = await p; console.log(label.padEnd(18), '|', typeof v === 'string' ? v : JSON.stringify(v)); } catch (e) { console.log(label.padEnd(18), '| FAILED', e.message); } };
await show('new top tipper', shoutout('top', { name: 'demo_viewer', coins: 30, previous: 'sam' }));
await show('goal reached', shoutout('goal', { label: 'KRUSTY KRAB GOAL', target: 1000, top: 'demo_viewer' }));
await show('sponge welcome', spongeLine('welcome', { name: 'Alex', position: 'Fry Cook' }));
await show('sponge gift', spongeLine('gift', { who: 'demo_viewer', gift: 'Rose', count: 5 }));
await show('banter 3-way', banterExchange({ cast: ['spongebob', 'squidward', 'krabs'], context: 'Latest hire decision: Alex → ACCEPTED as Fry Cook. Last gift: jacob sent Rose', recent: [] }).then(l => l.map(x => `${x.character}: ${x.text}`).join('  //  ')));
for (let i = 0; i < 3; i++) await show('gift hook', idleHook({ queue: 2, lastDecision: null, recent: [], goal: { label: 'KRUSTY KRAB GOAL', have: 880, target: 1000 }, top: { name: 'demo_viewer', coins: 300 }, lastGift: { user: 'sam', gift: 'Donut', count: 1 } }).then(h => `${h.banner} — ${h.line}`));
process.exit(0);
