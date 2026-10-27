// Checks that ordinary chat gets an intent that Mr. Krabs answers, with a reply: node tests/reply-check.mjs
import { interpretChat } from '../server/ai.js';
const msgs = ['hi', 'lol', '🔥🔥🔥', 'whats up mr krabs', 'this stream is fire', 'where are you from?', 'spongebob is my favorite', 'gg', 'asdfghjkl', 'Call me a good boy'];
let answered = 0;
for (const m of msgs) {
  const r = await interpretChat({ viewer: 'jacob', message: m, application: null });
  const ok = r.intent !== 'other' || !!r.reply;
  if (r.reply) answered++;
  console.log(`${r.reply ? 'REPLY ' : 'SILENT'} ${JSON.stringify(m).padEnd(30)} ${r.intent.padEnd(18)} ${r.reply}`);
}
console.log(`${answered}/${msgs.length} answered`);
process.exit(0);
