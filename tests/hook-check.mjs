// Generates several dead-air hooks with the local model and shows which pass validation: node tests/hook-check.mjs
import { idleHook } from '../server/ai.js';
const recent = [];
for (let i = 0; i < 6; i++) {
  try { const h = await idleHook({ queue: 0, lastDecision: null, recent }); recent.push(h.line); console.log('OK      ', h.banner.padEnd(26), '|', h.line); }
  catch (e) { console.log('REJECTED', e.message); }
}
process.exit(0);
