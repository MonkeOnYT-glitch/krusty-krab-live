# Krusty Krab LIVE — AI hiring-office TikTok LIVE simulator

Local Windows app: Mr. Krabs runs a hiring desk inside the Krusty Krab, viewers apply in plain chat,
local **GPT-OSS** (Ollama) reads applications and decides, and TikTok gifts drive real-time events.

## Start / stop

| | |
|---|---|
| Start | double-click **`Start-KrustyLive.cmd`** (starts the server, opens the control panel as an Edge app window) |
| Stop | **`Stop-KrustyLive.cmd`**, or close the minimized "Krusty Krab LIVE server" window |
| Control panel | http://localhost:7777/ |
| OBS overlay | http://localhost:7777/overlay.html — Browser source **1080×1920**, tick *Control audio via OBS* |

Requirements: Windows, Node 24+, [Ollama](https://ollama.com) with a local model (`gemma4` recommended for speed, `gpt-oss:20b` also supported), Blender 4.2+ (only to convert the models).

## Setup
```
npm install
```
1. **API keys** go in the app (Settings), never in code: a Fish Audio key for voices (optional, Windows voices work without it) and a free Euler Stream key for TikTok LIVE. They are stored locally in `data/secrets.json`, which is git-ignored.
2. **3D models** (not included, see below).
3. `npm run app` (desktop app) or `npm start` (server only, then open http://localhost:7777).

## Getting the 3D models
The models are fan-made assets from Sketchfab and are **not** included in this repo. Download each as *original format* (FBX), then convert:

| File | Sketchfab model | License |
|---|---|---|
| `krusty_krab.glb` | "The Krusty Krab" by Mrlunettes | CC BY-NC |
| `mr_krabs.glb` | "Mr Krabs (Spongebob)" by Yanez-Designs | CC BY |
| `spongebob.glb` | "Spongebob SquarePants" by Jamefan2004 | CC BY |
| `squidward.glb` | "Squidward (Spongebob)" by Yanez-Designs | CC BY |

```
blender -b --factory-startup -P tools/convert.py -- <in.fbx> public/models/<name>.glb <texture folder> char 512
blender -b --factory-startup -P tools/convert.py -- "The Krusty Krab.fbx" public/models/krusty_krab.glb <texture folder> env 1024
```
(Use a short folder path on Windows; Blender can't read textures from paths over 260 characters.)
SpongeBob characters are owned by Paramount/Nickelodeon; this is a fan project.

## Quick demo (no TikTok needed)
1. Dashboard → **Demo Mode** (default).
2. Type a chat line as any viewer, e.g. *"My name is Alex and I need money for a new bike."* — no commands.
   Chat **is** the application: it goes straight into the hiring line. Viewers only say why they want to work;
   Mr. Krabs picks the position (fry cook, cashier, "Chief Penny Counter"…) when he stamps it.
3. Watch Mr. Krabs take the paper, inspect it, explain, physically stamp it, and announce the result.
   He reads each application aloud with a close-up on the paper, answers normal chat (not @replies, and not people he's already stamped unless they reapply),
   and when chat goes quiet for 30 s he hooks viewers with a fresh AI-written call to action. Squidward complains every minute or two ("I wanna go home").
   Gift events play one at a time and nothing (banter, chat replies, reviews) talks over them.
4. Press **🌹 Rose** (skip the line), **🍩 Donut** (dance party + SpongeBob's "I feel a groove coming on" dance) and
   **🌌 Galaxy** (voiced countdown → the Krusty Krab blows apart → sped-up timelapse rebuild → back in business).

The top of the overlay has a scrolling 2D ticker explaining what each gift does; it is built from your gift mappings
(set the text per gift in the Reaction Editor → *Ticker text*). Captions are off by default (Stream Overlay tab).

Everything simulated is labeled DEMO / SIMULATED and is refused while in LIVE mode.

## How it is built
```
server/  index.js      HTTP + WebSocket hub, request handlers
         ai.js         GPT-OSS via Ollama /api/chat (JSON-schema output, own job queue, timeouts, retries, no cloud fallback)
         hiring.js     applications, follow-ups, priority queue, review → stamp loop (exactly one decision per app)
         engine.js     event ingest (dedupe, gift streaks), reaction mappings, cooldowns, concurrency limits, SpongeBob groove
         banter.js     Squidward/Krabs background banter
         voice.js      Fish Audio or Windows SAPI TTS, single speaking channel, local cache (cache/tts)
         providers/    tiktok.js (tiktok-live-connector adapter), demo.js (simulated events)
         gifts.js      gift catalog (official data only from TikTok)
public/  control.*     desktop control panel      overlay.*  9:16 stream overlay
         js/stage.js   three.js Krusty Krab scene, desk/paper/stamp, camera, lights, Galaxy cinematic
         js/characters.js  procedural animation on the models' own rigs   js/fx.js particles   js/audio.js synth SFX/music
data/    settings.json, secrets.json (API keys; never sent to the UI), presets.json, gift-catalog.json, app.log
tools/   convert.py    Blender FBX→GLB converter (decimates the Krusty Krab 2.1M→0.56M faces, textures ≤1024px)
```
AI inference, voice synthesis and gift reactions run independently: a slow model never delays a gift. A review that
the model can't finish in time gets a labeled automatic fallback decision, so the hiring line never stalls.

## Tests
- `npm test` — unit tests (decision validation, streak handling, MP3 duration, groove line).
- `npm run e2e` — full Demo-Mode run against the running server (GPT-OSS, stamping, Rose/Donut/Galaxy, dedupe, cooldowns, banter).
- `node tests/failures.mjs` — AI down, voice off, TikTok not configured; checks nothing crashes and settings are restored.

## What you still need to set up
- **TikTok LIVE**: Settings → TikTok: your username + a free **Euler Stream API key** (eulerstream.com; the unofficial
  connector signs through it). Then switch to LIVE mode and press Connect *while you are live*. The integration is
  unofficial and can break whenever TikTok changes things.
- **Gift catalog**: official gift names, coin values and artwork load from TikTok once connected (or Gift Library →
  Refresh while live). Until then Rose/Donut/Galaxy show as *unverified* — nothing is invented.

## Honest limitations
- **Character assets**: fan-made Sketchfab models (Mr. Krabs & Squidward by Yanez-Designs, SpongeBob by Jamefan2004 —
  CC BY; The Krusty Krab by Mrlunettes — **CC BY-NonCommercial**). Credit the authors on stream. The NC license may not
  allow a stream that earns gift revenue, and the characters themselves are owned by Paramount/Nickelodeon.
- **Animations are procedural**, driven on each model's real skeleton/part hierarchy (the models ship with no usable
  animation clips). Mr. Krabs and Squidward are rigid-part models, so there is no facial animation; SpongeBob's jaw moves.
- **Voices**: Fish Audio voice IDs you selected are community voice models, not official character voices. Requests
  that fail are retried once, then that line is spoken with the local Windows voice (David/Zira) so nothing goes silent.
  The dashboard preview plays audio; in a normal browser click the page once to allow sound (OBS needs no click).
- **VRAM**: gpt-oss:20b (13 GB) doesn't fit in 8 GB, so Ollama splits it GPU/CPU (~20 tok/s, 5–15 s per decision).
