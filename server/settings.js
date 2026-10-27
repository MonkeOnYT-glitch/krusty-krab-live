// Persistent settings (data/settings.json) and secrets (data/secrets.json).
// Secrets are never sent to clients or written to logs; clients only learn whether a key is set.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultMappings } from './defaults.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.KK_DATA_DIR || path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const DEFAULTS = {
  mode: 'demo', // 'demo' | 'live'
  ai: {
    endpoint: 'http://127.0.0.1:11434',
    model: 'gpt-oss:20b',
    think: 'low', // gpt-oss reasoning effort: low | medium | high
    temperature: 0.8,
    numCtx: 4096,
    timeoutSec: 60,
    retries: 1,
    keepAlive: '30m',
    prefilter: false, // true = only send chat that plausibly concerns the hiring office to the model
    maxPendingChats: 25,
    chatReplyCooldownSec: 4,
    failurePolicy: 'random', // 'random' = automatic fallback decision (labeled) | 'manual' = wait for operator stamp (max manualWaitSec)
    manualWaitSec: 45,
  },
  tiktok: { username: '', autoReconnect: true, maxReconnectAttempts: 8 },
  voice: {
    provider: 'fish', // 'fish' | 'sapi' | 'none'
    fishModel: 's2.1-pro-free',
    volume: 0.9,
    maxQueue: 16,
    characters: {
      krabs: { fishReferenceId: '24d7553855bc45b7985c19d63f759bb9', sapiVoice: 'Microsoft David Desktop', sapiRate: 1 },
      spongebob: { fishReferenceId: '0051da373e0a4ac282399909d1d31b69', sapiVoice: 'Microsoft Zira Desktop', sapiRate: 3 },
      squidward: { fishReferenceId: '549dc86f83e44b0fa15f6c0842486178', sapiVoice: 'Microsoft David Desktop', sapiRate: -2 },
    },
  },
  hiring: {
    autoReview: true,
    followupTimeoutSec: 60,
    maxFollowups: 1,
    pauseBetweenSec: 2,
    maxQueue: 50,
    roseRule: 'boost', // 'boost' adds priority per coin value | 'front' moves the sender to the front
    roseBoostPerGift: 10,
    maxPriority: 100,
  },
  engine: {
    maxConcurrentReactions: 1, // gift shows play one after another, never on top of each other
    maxQueuedReactions: 20,
    groovePolicy: 'queue', // 'ignore' | 'queue' | 'extend'
    grooveMaxQueue: 2,
    grooveDanceSec: 9,
    grooveExtendSec: 5,
    grooveMaxDanceSec: 25,
  },
  scene: {
    quality: 'high', // low | medium | high
    showKrabs: true, showSpongebob: true, showSquidward: true,
    camera: { preset: 'desk', fov: 50, x: 0, y: 0, z: 0 },
    brightness: 1.0,
    layout: {
      desk: { x: 0, z: 0, rot: 0 },
      spongebob: { x: 0, z: 0, rot: 0 },
      squidward: { x: 0, z: 0, rot: 0 },
    },
    models: {
      environment: '/models/krusty_krab.glb',
      krabs: '/models/mr_krabs.glb',
      spongebob: '/models/spongebob.glb',
      squidward: '/models/squidward.glb',
    },
  },
  banter: { enabled: true, minSec: 75, maxSec: 160 },
  hooks: { enabled: true, quietSec: 30, repeatSec: 45 },
  greet: { joins: true, likes: true, shares: true, joinEverySec: 20, likeEverySec: 30 },
  goal: { enabled: true, label: 'KRUSTY KRAB GOAL', targetCoins: 1000 },
  overlay: { bgmEnabled: true, bgmVolume: 0.35, showTicker: true, showQueue: true, showApplication: true, showSubtitles: false, showBanners: true, showStatusBadge: true, previewAudioInControl: true },
  mappings: defaultMappings(),
};

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = (k in base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null && k !== 'mappings')
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

export const settings = deepMerge(DEFAULTS, readJson(SETTINGS_FILE, {}));
const secrets = { fishAudioApiKey: '', eulerStreamApiKey: '', ...readJson(SECRETS_FILE, {}) };

export function saveSettings() { writeJsonAtomic(SETTINGS_FILE, settings); }
export function updateSettings(patch) {
  const merged = deepMerge(settings, patch);
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, merged);
  saveSettings();
  return settings;
}
export function getSecret(name) { return secrets[name] || ''; }
export function setSecret(name, value) {
  if (!(name in secrets)) throw new Error('Unknown secret ' + name);
  secrets[name] = String(value || '').trim();
  writeJsonAtomic(SECRETS_FILE, secrets);
}
export function secretStatus() {
  return Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v ? 'set' : 'not set']));
}

export function listPresets() { return readJson(PRESETS_FILE, {}); }
export function savePreset(name) {
  const p = listPresets(); p[name] = { savedAt: Date.now(), mappings: settings.mappings };
  writeJsonAtomic(PRESETS_FILE, p);
}
export function restorePreset(name) {
  if (name === '__defaults__') { settings.mappings = defaultMappings(); saveSettings(); return; }
  const p = listPresets()[name];
  if (!p) throw new Error('No preset named ' + name);
  settings.mappings = p.mappings; saveSettings();
}
