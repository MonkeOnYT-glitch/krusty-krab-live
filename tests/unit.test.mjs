// Unit tests for pure logic (node --test tests/).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateReview, validateChat, DECISIONS } from '../server/ai.js';
import { mp3Duration, TTS_DIR } from '../server/voice.js';
import { demoStreak, demoGift } from '../server/providers/demo.js';
import { normGift, GROOVE_LINE } from '../server/engine.js';

test('review output must be exactly one of the three decisions', () => {
  for (const d of DECISIONS) assert.equal(validateReview({ decision: d, explanation: 'x', announcement: 'y' }).decision, d);
  assert.equal(validateReview({ decision: 'accepted', explanation: 'x', announcement: '' }).decision, 'ACCEPTED');
  assert.throws(() => validateReview({ decision: 'MAYBE', explanation: 'x' }));
  assert.throws(() => validateReview({ decision: 'DENIED', explanation: '' }));
  assert.throws(() => validateReview(null));
});

test('chat output validation trims and rejects unknown intents', () => {
  const r = validateChat({ intent: 'apply', name: ' Alex ', role: 'fry cook', experience: '', pitch: '', reply: 'Arr', followup_question: '' });
  assert.equal(r.name, 'Alex');
  assert.throws(() => validateChat({ intent: 'hack' }));
});

test('demo streak mirrors TikTok: progress events then one final repeatEnd', () => {
  const ev = demoStreak('v', 'Rose', 5);
  assert.equal(ev.length, 6);
  assert.equal(ev.filter(e => e.gift.repeatEnd).length, 1);
  assert.equal(ev.at(-1).gift.repeatCount, 5);
  assert.ok(ev.every(e => e.source === 'demo'));
  assert.equal(new Set(ev.map(e => e.id)).size, 6);
});

test('gift name normalization and demo gifts', () => {
  assert.equal(normGift('Rose'), 'rose');
  assert.equal(normGift('Finger Heart'), 'finger_heart');
  assert.equal(demoGift('a', 'Donut').gift.name, 'Donut');
});

test('groove line is exact', () => assert.equal(GROOVE_LINE, 'I feel a groove coming on'));

test('mp3 duration parser reads cached Fish Audio files', (t) => {
  const f = fs.readdirSync(TTS_DIR).find(x => x.endsWith('.mp3'));
  if (!f) return t.skip('no cached mp3 yet');
  const d = mp3Duration(fs.readFileSync(path.join(TTS_DIR, f)));
  assert.ok(d > 0.3 && d < 30, `duration ${d}`);
});
