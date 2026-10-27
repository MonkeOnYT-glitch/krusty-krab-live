// Shared application state, logging, and broadcast to every connected UI (control panel + overlays).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './settings.js';

const LOG_FILE = path.join(DATA_DIR, 'app.log');
const clients = new Set();

export const state = {
  startedAt: Date.now(),
  running: true,
  status: {
    tiktok: { state: 'disconnected', detail: '', username: '' },
    ai: { state: 'unknown', model: '', detail: 'Not tested yet', latencyMs: null, pending: 0 },
    voice: { state: 'idle', provider: '', detail: '', queue: 0, speaking: null },
  },
  chat: [], gifts: [], streaks: {},
  characters: { krabs: 'idle', spongebob: 'idle', squidward: 'idle' },
  reactions: { active: [], queued: [] },
  stage: { light: 'normal', paper: null, nuke: false },
  errors: [], logs: [],
  hiring: { paused: false, currentId: null, phase: 'idle' },
};

export function pushCapped(arr, item, cap) { arr.push(item); if (arr.length > cap) arr.splice(0, arr.length - cap); }

export function log(level, msg, extra) {
  const entry = { t: Date.now(), level, msg: String(msg).slice(0, 500) };
  pushCapped(state.logs, entry, 200);
  if (level === 'error') pushCapped(state.errors, entry, 40);
  const line = `${new Date(entry.t).toISOString()} [${level}] ${entry.msg}${extra ? ' ' + JSON.stringify(extra).slice(0, 400) : ''}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* disk issues must not crash */ }
  if (level !== 'debug') console.log(line.trimEnd());
  changed();
}

// --- client registry & broadcast ----------------------------------------------------------
let snapshotFn = () => state;
export function setSnapshot(fn) { snapshotFn = fn; }
export function addClient(ws) { clients.add(ws); }
export function removeClient(ws) { clients.delete(ws); }
export function clientCount() { return clients.size; }

function sendAll(obj) {
  const data = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1 && ws.bufferedAmount < 4e6) ws.send(data); // skip stalled clients rather than buffer forever
  }
}
export function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

// Scene commands are sent immediately (timing matters); state snapshots are throttled.
export function scene(cmd, data = {}) { sendAll({ t: 'scene', cmd, ...data, at: Date.now() }); }

let pending = null;
export function changed() {
  if (pending) return;
  pending = setTimeout(() => { pending = null; sendAll({ t: 'state', state: snapshotFn() }); }, 120);
}
export function snapshot() { return snapshotFn(); }
