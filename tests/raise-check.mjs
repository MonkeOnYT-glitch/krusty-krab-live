// Quick check of the raise feature against the local model (no server needed): node tests/raise-check.mjs
import { interpretChat, decideRaise } from '../server/ai.js';
const msgs = ['Mr Krabs can I get a raise?', "I've flipped 10,000 patties, I deserve more money", 'promote me to manager pls'];
for (const m of msgs) {
  const t0 = Date.now();
  const i = await interpretChat({ viewer: 'sam', message: m, application: null, past: { decision: 'ACCEPTED', position: 'Fry Cook' } });
  const r = await decideRaise({ name: 'Sam', position: 'Fry Cook', wageCents: 150, raises: 0, message: m, tooSoon: false, forced: ['DENIED', 'PENNY RAISE', 'PROMOTED'][msgs.indexOf(m)] });
  console.log(`intent=${i.intent.padEnd(14)} → ${r.outcome}${r.cents ? ' +' + r.cents + '¢' : ''}${r.newPosition ? ' as ' + r.newPosition : ''} (${Date.now() - t0}ms) | ${r.line}`);
}
const again = await decideRaise({ name: 'Sam', position: 'Fry Cook', wageCents: 151, raises: 1, message: 'raise again??', tooSoon: true });
console.log(`asked again too soon → ${again.outcome} | ${again.line}`);
process.exit(0);
