// Voice engine: Fish Audio (cloud TTS, user-configured) or Windows SAPI (local), with a single
// speaking channel so lines never overlap. Synthesis starts at enqueue time so the next line is
// usually ready when the previous one finishes. Failures degrade to subtitles-only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { settings, getSecret, ROOT } from './settings.js';
import { state, log, changed, scene } from './hub.js';

export const TTS_DIR = path.join(ROOT, 'cache', 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });

const queue = [];
let speaking = null;

function setStatus(patch) { Object.assign(state.status.voice, patch, { queue: queue.length, provider: settings.voice.provider }); changed(); }

export function estimateSeconds(text) { return Math.min(14, 0.7 + text.split(/\s+/).length * 0.36); }

// --- duration parsing -----------------------------------------------------------------------
export function mp3Duration(buf) {
  const BR = [[0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let i = 0, secs = 0, frames = 0;
  if (buf.slice(0, 3).toString() === 'ID3') i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, bri = buf[i + 2] >> 4, sri = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const sr = SR[ver][sri];
    const kbps = ver === 3 ? BR[3 - layer][bri] : (layer === 3 ? BR[0][bri] : BR2[bri]);
    const spf = layer === 3 ? 384 : (layer === 2 || ver === 3 ? 1152 : 576);
    const len = layer === 3 ? Math.floor((12 * kbps * 1000 / sr + pad) * 4) : Math.floor(spf / 8 * kbps * 1000 / sr + pad);
    if (len < 4) { i++; continue; }
    secs += spf / sr; frames++; i += len;
  }
  return frames ? secs : null;
}
export function wavDuration(buf) {
  const byteRate = buf.readUInt32LE(28);
  let i = 12;
  while (i + 8 <= buf.length) { const id = buf.toString('ascii', i, i + 4), sz = buf.readUInt32LE(i + 4); if (id === 'data') return sz / byteRate; i += 8 + sz; }
  return null;
}

// --- providers ----------------------------------------------------------------------------
// Fish Audio drops parallel connections from one key, so requests go out strictly one at a time.
let fishChain = Promise.resolve();
function fishTTS(text, refId) {
  const job = fishChain.then(() => fishWithRetry(text, refId));
  fishChain = job.catch(() => {});
  return job;
}

async function fishWithRetry(text, refId) {
  const key = getSecret('fishAudioApiKey');
  if (!key) throw new Error('Fish Audio API key not set (Settings → Voice)');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 700 * attempt));
    try {
      const res = await fishRequest(text, refId, key);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastErr = new Error(`Fish Audio HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      if (res.status < 500 && res.status !== 429) break; // auth / bad request: retrying won't help
    } catch (e) {
      lastErr = new Error(`${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`);
      // Some Fish Audio edge servers send an incomplete certificate chain. Windows' curl (Schannel)
      // fetches the missing intermediate itself, so use it instead of giving up on the voice.
      if (/CERT|SIGNATURE|ISSUER|SELF_SIGNED/i.test(e.cause?.code || '')) {
        try { return await fishViaCurl(text, refId, key); } catch (e2) { lastErr = new Error(`${lastErr.message}; curl: ${e2.message}`); }
      }
    }
  }
  throw lastErr;
}

function fishViaCurl(text, refId, key) {
  const id = crypto.randomBytes(6).toString('hex');
  const body = path.join(TTS_DIR, `req-${id}.json`), out = path.join(TTS_DIR, `res-${id}.mp3`);
  fs.writeFileSync(body, JSON.stringify({ text, reference_id: refId, format: 'mp3' }));
  // Headers go through stdin (-K -) so the API key never appears on a command line.
  const cfg = `header = "Authorization: Bearer ${key}"\nheader = "Content-Type: application/json"\nheader = "model: ${settings.voice.fishModel}"\n`;
  return new Promise((resolve, reject) => {
    const p = execFile(process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'curl.exe') : 'curl', ['-sS', '--fail-with-body', '-m', '30', '-K', '-', '--data-binary', `@${body}`, '-o', out, 'https://api.fish.audio/v1/tts'],
      { windowsHide: true, timeout: 35000 }, (err) => {
        try {
          if (err) return reject(new Error(err.message.split('\n')[0]));
          resolve(fs.readFileSync(out));
        } finally { fs.rmSync(body, { force: true }); fs.rmSync(out, { force: true }); }
      });
    p.stdin.end(cfg);
  });
}

function fishRequest(text, refId, key) {
  return fetch('https://api.fish.audio/v1/tts', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: settings.voice.fishModel },
    body: JSON.stringify({ text, reference_id: refId, format: 'mp3' }),
  });
}

// --- live streaming ---------------------------------------------------------------------------
// Each streamed line is buffered in memory while it downloads; any number of overlays can attach to
// /tts-live/<id>.mp3 and receive what has arrived so far, then the rest as it comes in.
const live = new Map(); // id -> { chunks, done, listeners:Set<res> }

async function fishStream(text, refId, hash, file) {
  const key = getSecret('fishAudioApiKey');
  if (!key) throw new Error('Fish Audio API key not set');
  const res = await fishRequest(text, refId, key);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const id = hash + '-' + crypto.randomBytes(3).toString('hex');
  const entry = { chunks: [], done: false, listeners: new Set() };
  live.set(id, entry);
  const reader = res.body.getReader();
  const first = await reader.read(); // only report success once audio is actually flowing
  if (first.done) { live.delete(id); throw new Error('empty audio stream'); }
  const push = (c) => { const b = Buffer.from(c); entry.chunks.push(b); for (const l of entry.listeners) l.write(b); };
  push(first.value);
  const finished = (async () => {
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; push(value); } }
    catch (e) { log('warn', 'Fish stream interrupted: ' + e.message); }
    entry.done = true;
    for (const l of entry.listeners) l.end();
    entry.listeners.clear();
    const buf = Buffer.concat(entry.chunks);
    try { fs.writeFileSync(file, buf); } catch { /* cache is optional */ }
    setTimeout(() => live.delete(id), 120000);
    return { duration: mp3Duration(buf) || estimateSeconds(text) };
  })();
  return { url: `/tts-live/${id}.mp3`, duration: estimateSeconds(text), finished };
}

/** HTTP handler for /tts-live/<id>.mp3 (progressive MP3, plays while it downloads). */
export function serveLive(id, res) {
  const entry = live.get(id);
  if (!entry) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  for (const c of entry.chunks) res.write(c);
  if (entry.done) { res.end(); return; }
  entry.listeners.add(res);
  res.on('close', () => entry.listeners.delete(res));
}

function sapiTTS(text, voice, rate, file) {
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;
try { $s.SelectVoice($env:KK_VOICE) } catch {}; $s.Rate = [int]$env:KK_RATE; $s.SetOutputToWaveFile($env:KK_FILE); $s.Speak($env:KK_TEXT); $s.Dispose()`;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 20000, windowsHide: true, env: { ...process.env, KK_TEXT: text, KK_VOICE: voice, KK_RATE: String(rate || 0), KK_FILE: file },
    }, (err) => (err ? reject(err) : resolve()));
  });
}

export async function synthesize(character, text, { stream = true } = {}) {
  const v = settings.voice, c = v.characters[character] || v.characters.krabs;
  if (v.provider === 'none') return { url: null, duration: estimateSeconds(text) };
  const id = v.provider === 'fish' ? `fish|${v.fishModel}|${c.fishReferenceId}|${text}` : `sapi|${c.sapiVoice}|${c.sapiRate}|${text}`;
  const hash = crypto.createHash('sha1').update(id).digest('hex').slice(0, 20);
  const ext = v.provider === 'fish' ? 'mp3' : 'wav';
  const file = path.join(TTS_DIR, `${hash}.${ext}`);
  if (!fs.existsSync(file)) {
    if (v.provider === 'fish') {
      // Fast path: stream Fish Audio's MP3 straight to the overlay so speech starts after ~0.7 s
      // instead of waiting ~4 s for the whole file. Falls back to the buffered/curl/Windows paths.
      if (stream) try { return await fishStream(text, c.fishReferenceId, hash, file); }
      catch (e) { log('warn', `Fish streaming unavailable (${e.message}); using buffered request`); }
      try { fs.writeFileSync(file, await fishTTS(text, c.fishReferenceId)); }
      catch (e) {
        // Never go silent: speak this line with the local Windows voice instead.
        log('warn', `Fish Audio failed (${e.message}); using Windows voice for this line`);
        const wav = path.join(TTS_DIR, `${hash}.sapi.wav`);
        if (!fs.existsSync(wav)) await sapiTTS(text, c.sapiVoice, c.sapiRate, wav);
        const wb = fs.readFileSync(wav);
        return { url: `/tts/${hash}.sapi.wav`, duration: wavDuration(wb) || estimateSeconds(text), fallback: true };
      }
    } else await sapiTTS(text, c.sapiVoice, c.sapiRate, file);
  }
  const buf = fs.readFileSync(file);
  const duration = (ext === 'mp3' ? mp3Duration(buf) : wavDuration(buf)) || estimateSeconds(text);
  return { url: `/tts/${hash}.${ext}`, duration };
}

// --- speaking queue ---------------------------------------------------------------------
/** Queue a line. priority: 0 normal chatter, 5 hiring, 9 gift/sequence lines (jump the queue).
 *  Resolves after the line has finished playing (or immediately if dropped). */
export function speak(character, text, { priority = 0, tag = '' } = {}) {
  text = String(text || '').trim();
  if (!text) return Promise.resolve({ dropped: true });
  return new Promise((resolve) => {
    const job = { character, text, priority, tag, resolve, synth: null };
    job.synth = synthesize(character, text).catch((e) => {
      log('warn', `Voice synthesis failed (${character}): ${e.message} — showing subtitles only`);
      setStatus({ state: 'error', detail: e.message });
      return { url: null, duration: estimateSeconds(text), error: e.message };
    });
    // Bound the queue: drop the lowest-priority, newest item when full.
    if (queue.length >= settings.voice.maxQueue) {
      const lowest = [...queue].sort((a, b) => a.priority - b.priority)[0];
      if (lowest.priority <= priority) { queue.splice(queue.indexOf(lowest), 1); lowest.resolve({ dropped: true }); log('info', `Voice queue full; dropped: "${lowest.text.slice(0, 40)}"`); }
      else { resolve({ dropped: true }); return; }
    }
    const idx = queue.findIndex(j => j.priority < priority);
    if (idx === -1) queue.push(job); else queue.splice(idx, 0, job);
    setStatus({});
    pump();
  });
}

export const eventActive = () => state.reactions.active.length > 0 || !!state.stage.nuke;

async function pump() {
  if (speaking) return;
  if (queue.length && queue[0].priority < 7 && eventActive()) { setTimeout(pump, 300); return; } // never interrupt an event
  const job = queue.shift();
  if (!job) { setStatus({ speaking: null, state: state.status.voice.state === 'error' ? 'error' : 'idle' }); return; }
  speaking = job;
  const r = await job.synth;
  setStatus({ speaking: { character: job.character, text: job.text }, state: r.error ? 'error' : 'speaking' });
  state.characters[job.character] = 'talking';
  scene('speak', { character: job.character, text: job.text, url: r.url, duration: r.duration, volume: settings.voice.volume, tag: job.tag });
  const started = Date.now();
  let duration = r.duration;
  if (r.finished) duration = (await r.finished).duration; // streamed line: real length known once download ends
  // Extra margin: the overlay starts a streamed line a moment after this command, so don't queue the next one early.
  await new Promise(res => setTimeout(res, Math.max(0, duration * 1000 + (r.finished ? 700 : 300) - (Date.now() - started))));
  scene('speakEnd', { character: job.character });
  if (state.characters[job.character] === 'talking') state.characters[job.character] = 'idle';
  speaking = null;
  job.resolve({ duration, url: r.url });
  setTimeout(pump, 120);
}

export function clearVoiceQueue() { while (queue.length) queue.shift().resolve({ dropped: true }); setStatus({}); }
