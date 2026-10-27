// Overlay page: renders the stage and HUD, follows server state and executes scene commands.
import { Stage } from './stage.js';
import { AudioEngine } from './audio.js';
import { connect } from './ws.js';

const q = new URLSearchParams(location.search);
const PREVIEW = q.get('preview') === '1';
if (PREVIEW) document.body.classList.add('preview');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let S = null; // latest server state
let overlayCfg = {};
const audio = new AudioEngine(!PREVIEW && q.get('audio') !== '0');
const stage = new Stage($('c'), { quality: q.get('quality') || 'high', onProgress: (label, k) => { $('load-text').textContent = `Loading ${label}… ${Math.round(k * 100)}%`; } });
stage.audio = audio;
window.stage = stage; // debugging hook
$('c').addEventListener('webglcontextlost', (e) => { e.preventDefault(); setTimeout(() => location.reload(), 1500); });

// Browsers (not OBS) block audio until a user gesture.
if (audio.enabled) {
  const unlock = () => { audio.ensure(); $('hint').classList.add('hidden'); };
  addEventListener('pointerdown', unlock, { once: true });
  setTimeout(() => { if (!audio.ctx || audio.ctx.state !== 'running') { try { audio.ensure(); } catch { } if (audio.ctx?.state !== 'running') $('hint').classList.remove('hidden'); } }, 1500);
  $('hint').onclick = unlock;
}

let ready = false; const backlog = [];
const conn = connect({
  onState: (st) => { S = st; if (ready) renderHUD(); else maybeInit(); },
  onScene: (m) => { if (ready) handle(m); else if (backlog.length < 50) backlog.push(m); },
});

let initStarted = false;
async function maybeInit() {
  if (initStarted || !S) return; initStarted = true;
  const errs = await stage.load(S.settings.scene.models);
  stage.applySettings(S.settings.scene);
  if (q.get('quality')) stage.setQuality(q.get('quality'));
  overlayCfg = S.settings.overlay;
  if (PREVIEW && overlayCfg.previewAudioInControl && q.get('audio') === '1') { audio.setEnabled(true); addEventListener('pointerdown', () => audio.ensure(), { once: true }); window.parent?.addEventListener?.('pointerdown', () => audio.ensure(), { once: true }); }
  if (errs.length) { $('load-text').textContent = 'Missing assets: ' + errs.join('; '); console.error(errs); }
  stage.start();
  $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 900);
  ready = true; window.ready = true;
  syncBgm();
  renderHUD();
  if (S.stage?.paper) stage.paperCmd('pickup', S.stage.paper); // join mid-review
  if (S.stage?.light && S.stage.light !== 'normal') stage.setLighting(S.stage.light, 5);
  if (S.groove?.phase === 'dancing') stage.setSpongeDance(true, S.groove.endsAt);
  backlog.splice(0).forEach(handle);
}

// Background music only plays where audio is on (the stream page / link), never in silent previews.
function syncBgm() {
  if (!audio.enabled) return;
  const on = overlayCfg.bgmEnabled !== false, vol = overlayCfg.bgmVolume ?? 0.35;
  if (on && !audio.bgm) { audio.startBgm(vol); if (!audio.ctx || audio.ctx.state !== 'running') addEventListener('pointerdown', () => { audio.ensure(); }, { once: true }); }
  else if (!on && audio.bgm) audio.stopBgm();
  else audio.setBgmVolume(vol);
}

// --- HUD ---------------------------------------------------------------------------------------
function renderHUD() {
  if (!S) return;
  const b = $('badge');
  if (!S.running) { b.textContent = '⏹ STOPPED'; b.className = 'badge off'; }
  else if (S.mode === 'demo') { b.textContent = 'DEMO MODE'; b.className = 'badge demo'; }
  else { const st = S.status.tiktok.state; const live = st === 'live_active' || st === 'connected'; b.textContent = live ? '● LIVE' : st.toUpperCase(); b.className = 'badge ' + (live ? 'live' : 'off'); }
  b.classList.toggle('hidden', overlayCfg.showStatusBadge === false);

  renderTicker();
  renderGoal();
  const qEl = $('queue'), h = S.hiring;
  qEl.classList.toggle('hidden', overlayCfg.showQueue === false);
  const list = h.queue.slice(0, 3);
  qEl.querySelector('ol').innerHTML = list.map((a, i) => `<li><span class="n">${i + 1}</span><span class="nm">${esc(a.name || a.nickname)}</span><span class="rl">${a.status === 'collecting' ? '<span class="col">filling out…</span>' : esc(a.pitch || a.experience || '')}</span>${a.priority > 0 ? `<span class="pr">🌹 PRIORITY</span>` : ''}${a.source === 'demo' ? '<span class="dm">DEMO</span>' : ''}</li>`).join('') + (h.queue.length > 3 ? `<li><span class="col">+${h.queue.length - 3} more waiting</span></li>` : '');
  qEl.querySelector('.empty').classList.toggle('hidden', h.queue.length > 0);

  const streaks = Object.values(S.streaks || {}).filter(s => Date.now() - s.t < 15000);
  $('streaks').innerHTML = streaks.map(s => `<div class="chip">🔥 ${esc(s.user)} • ${esc(s.gift)} x${s.count}${s.source === 'demo' ? ' (demo)' : ''}</div>`).join('');

  const cur = h.current;
  if (cur && overlayCfg.showApplication !== false) {
    $('card').classList.remove('hidden');
    $('card-name').textContent = cur.name || cur.nickname;
    $('card-role').textContent = cur.assignedRole ? `Position: ${cur.assignedRole}` : 'Position: Mr. Krabs decides…';
    $('card-detail').textContent = cur.pitch || cur.experience ? `“${[cur.pitch, cur.experience].filter(Boolean).join(' • ')}”` : `@${cur.uniqueId}`;
    $('card-src').textContent = (cur.priority > 0 ? '🌹 PRIORITY  ' : '') + (cur.source === 'demo' ? 'DEMO' : '');
    $('card-phase').textContent = { 'paused (Galaxy)': 'ON HOLD — EMERGENCY!', pickup: 'TAKING PAPERWORK', inspecting: 'INSPECTING…', awaiting_manual: 'THINKING…', explaining: 'VERDICT', stamping: 'STAMPING!', outcome: 'DECISION' }[h.phase] || 'REVIEWING';
  } else if (!stampShowing) $('card').classList.add('hidden');
}

// --- gift ticker: built from the live gift mappings, so editing reactions updates it automatically
const TICKER_EMOJI = { rose: '🌹', donut: '🍩', galaxy: '🌌', follow: '⚓' };
let tickerKey = '';
function renderTicker() {
  const el = $('ticker');
  el.classList.toggle('hidden', overlayCfg.showTicker === false);
  const items = [{ em: '💬', name: 'Chat', what: 'Type why you want a job to apply!' }];
  for (const [key, m] of Object.entries(S.settings.mappings)) {
    if (!m.enabled || key === 'gift:*' || key.startsWith('custom:')) continue;
    const gk = key.replace(/^(gift|event):/, '');
    const g = S.catalog.gifts.find(x => x.key === gk);
    const what = (m.tickerText || m.label.split(/\s+[—-]\s+/).slice(1).join(' — ') || m.label).trim();
    const groove = m.actions.some(a => a.type === 'spongebob_groove') && !/groove|spongebob/i.test(what) ? ' + SpongeBob dance' : '';
    items.push({ img: g?.verified ? g.image : '', em: TICKER_EMOJI[gk] || '🎁', name: g?.name || (gk === 'follow' ? 'Follow' : gk), what: what + groove });
  }
  const key = JSON.stringify(items);
  if (key === tickerKey) return;
  tickerKey = key;
  const seg = '<div class="seg">' + items.map(i => `<span class="it">${i.img ? `<img src="${esc(i.img)}" referrerpolicy="no-referrer" alt="">` : `<span class="em">${i.em}</span>`}<span class="gn">${esc(i.name)}</span><span class="ar">→</span>${esc(i.what)}</span><span class="dot">✦</span>`).join('') + '</div>';
  const track = $('ticker-track');
  track.innerHTML = seg + seg; // duplicated for a seamless loop
  track.style.setProperty('--dur', Math.max(18, items.length * 7) + 's');
}

function renderGoal() {
  const gl = S.settings.goal, gs = S.giftStats || {};
  const on = gl?.enabled && overlayCfg.showGoal !== false;
  $('goal').classList.toggle('hidden', !on);
  if (on) {
    $('goal-label').textContent = '🎯 ' + (gl.label || 'GOAL');
    $('goal-num').textContent = `${gs.goalCoins || 0} / ${gl.targetCoins} 🪙`;
    $('goal-fill').style.width = Math.min(100, (100 * (gs.goalCoins || 0)) / gl.targetCoins) + '%';
  }
  const top = gs.top;
  $('crown').classList.toggle('hidden', !top || overlayCfg.showCrown === false);
  if (top) $('crown-name').textContent = `${top.name} · ${top.coins} 🪙`;
}

let subTimer = null, stampShowing = false;
function subtitle(who, text, dur) {
  if (overlayCfg.showSubtitles === false) return;
  const el = $('subtitle'); el.className = who;
  $('sub-who').textContent = { krabs: 'MR. KRABS', spongebob: 'SPONGEBOB', squidward: 'SQUIDWARD' }[who] || who.toUpperCase();
  $('sub-text').textContent = text;
  clearTimeout(subTimer); subTimer = setTimeout(() => el.classList.add('hidden'), dur * 1000 + 600);
}
function banner(text, color = '#ffd166', dur = 4, demo = false, small = false) {
  if (overlayCfg.showBanners === false) return;
  const box = $('banners');
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement('div'); el.className = 'banner' + (small ? ' small' : '');
  el.style.background = `linear-gradient(180deg, ${color}, ${shade(color)})`;
  el.innerHTML = esc(text) + (demo ? '<span class="demo-tag">SIMULATED</span>' : '');
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, Math.max(1.5, dur) * 1000);
}
function shade(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, (v * 0.6) | 0); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
function flash(ms = 500, el = 'flash', peak = 1) { const f = $(el); f.style.transition = 'none'; f.style.opacity = peak; requestAnimationFrame(() => { f.style.transition = `opacity ${ms}ms ease-out`; f.style.opacity = 0; }); }
function transition(style, dur = 1) {
  if (style === 'flash') flash(dur * 600);
  else if (style === 'fade') { const f = $('fade'); f.style.transition = `opacity ${dur * 400}ms`; f.style.opacity = 1; setTimeout(() => { f.style.opacity = 0; }, dur * 500); }
  else if (style === 'wipe') { const w = $('wipe'); w.style.transition = 'none'; w.style.transform = 'translateX(-100%)'; requestAnimationFrame(() => { w.style.transition = `transform ${dur * 500}ms ease-in-out`; w.style.transform = 'translateX(0)'; setTimeout(() => { w.style.transform = 'translateX(100%)'; }, dur * 550); }); }
}
function cine(text, cls = '', dur = 2) { const c = $('cine'); c.className = cls; c.textContent = text; c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; clearTimeout(c._t); c._t = setTimeout(() => c.classList.add('hidden'), dur * 1000); }

// --- scene commands ----------------------------------------------------------------------------
const C = stage.chars;
function handle(m) {
  try {
    switch (m.cmd) {
      case 'speak':
        audio.playVoice(m.url, m.volume);
        C[m.character]?.talk(m.duration);
        subtitle(m.character, m.text, m.duration);
        break;
      case 'speakEnd': C[m.character] && (C[m.character].talkingUntil = 0); break;
      case 'paper': stage.paperCmd(m.action, m.paper); if (m.action === 'file') { stampShowing = false; setTimeout(renderHUD, 50); } break;
      case 'stamp': stage.stampCmd(m.decision, m.position); break;
      case 'outcome': {
        if (m.position) $('card-role').textContent = `Position: ${m.position}`;
        const st = $('card-stamp'); st.textContent = m.decision; st.className = 'stamp ' + m.decision.split(' ')[0];
        stampShowing = true; $('card').classList.remove('hidden');
        audio.sfx(m.decision === 'ACCEPTED' ? 'chime' : m.decision === 'DENIED' ? 'beep' : 'pop');
        if (m.decision === 'ACCEPTED') stage.particles.stream('coins', 1.5, 0.8);
        setTimeout(() => { st.className = 'stamp hidden'; stampShowing = false; renderHUD(); }, 5500);
        break;
      }
      case 'krabs': C.krabs?.play(m.anim, m.duration || 2); break;
      case 'krabsGlance': C.krabs?.layer('glance_' + m.mood, 2.8); break;
      case 'sponge': C.spongebob?.play(m.anim, m.duration || 2); if (m.anim === 'notice') stage.particles.emit('sparks', 6, C.spongebob.root.position.clone().setY(0.2)); break;
      case 'squid': C.squidward?.play(m.anim, m.duration || 2); break;
      case 'spongeDance':
        stage.setSpongeDance(m.on, m.until);
        if (m.on && !stage.nuke) stage.setShot('wide', Math.max(2, (m.until - Date.now()) / 1000), 1.0); // two-shot: SpongeBob dancing + Krabs at the desk
        $('groove').classList.toggle('hidden', !m.on);
        if (m.on && !audio.music) audio.startMusic('party', Math.max(2, (m.until - Date.now()) / 1000));
        else if (m.on) audio.extendMusic((m.until - Date.now()) / 1000);
        if (m.on) { clearInterval(stage._notes); stage._notes = setInterval(() => stage.chars.spongebob?.mode === 'dance' ? stage.particles.emit('notes', 2) : clearInterval(stage._notes), 400); }
        break;
      case 'sfx': audio.sfx(m.sound, m.intensity); break;
      case 'music': audio.startMusic(m.track, m.duration); break;
      case 'particles': stage.particles.stream(m.kind, m.duration, m.intensity); if (m.kind === 'petals') stage.particles.emit('petals', 40); break;
      case 'lighting': stage.setLighting(m.mode, m.duration); break;
      case 'camera': stage.setShot(m.shot, m.duration, 0.8); break;
      case 'transition': transition(m.style, m.duration); break;
      case 'banner': banner(m.text, m.color, m.duration, m.demo, m.small); break;
      case 'nuke': runNuke(m); break;
      case 'goalReached': { const g = $('goal'); g.classList.remove('pop'); void g.offsetWidth; g.classList.add('pop'); banner(`🎯 GOAL REACHED! ${m.label || ''} #${m.n}`, '#f59e0b', 5); flash(500); break; }
      case 'settings': overlayCfg = m.overlay || overlayCfg; syncBgm(); if (PREVIEW && q.get('audio') === '1') audio.setEnabled(!!overlayCfg.previewAudioInControl); stage.applySettings(m.scene); renderHUD(); break;
    }
  } catch (e) { console.error('scene command failed', m.cmd, e); }
}

function runNuke({ duration = 24, intensity = 1, user = '', countdown = [] }) {
  const D = Math.max(8, duration);
  const v = $('vignette');
  audio.sfx('horn', intensity); audio.startMusic('tension', 3.4);
  cine('⚠ GALAXY INCOMING ⚠', '', 1.4);
  v.className = 'alert';
  C.krabs?.play('surprised', 1.5); C.squidward?.play('annoyed', 3);
  let n = 3;
  const cd = $('countdown');
  const tick = () => { cd.classList.remove('hidden', 'tick'); cd.textContent = n; void cd.offsetWidth; cd.classList.add('tick'); audio.sfx('hit', 1); const url = countdown[3 - n]; if (url) audio.playVoice(url, 1); n--; };
  setTimeout(() => { tick(); const iv = setInterval(() => { if (n > 0) tick(); else { clearInterval(iv); cd.classList.add('hidden'); } }, 700); }, 1300);
  stage.startNuke(D, intensity, {
    onStage(st) {
      if (st === 'boom') {
        flash(1400, 'flash', 1); audio.stopMusic(); audio.sfx('boom', intensity);
        cine('KA-BOOM!', 'boom', 2.2);
        v.className = 'soot';
        C.krabs?.play('shocked', D - 4); C.spongebob?.play('shocked', D - 4.5); C.squidward?.play('shocked', D - 4.5);
        setTimeout(() => cine('THE KRUSTY KRAB IS… GONE', 'after', 2.6), 2200);
      }
      if (st === 'rebuild') {
        transition('fade', 0.8); v.className = '';
        document.body.classList.add('timelapse'); $('tl').classList.remove('hidden');
        audio.startMusic('timelapse', 30);
        let day = 1; clearInterval(window._tlDay); window._tlDay = setInterval(() => { day += 1 + Math.floor(Math.random() * 3); $('tl-day').textContent = 'DAY ' + day; }, 120);
        C.krabs?.play('greedy', 6);
      }
      if (st === 'restore') {
        clearInterval(window._tlDay); audio.stopMusic();
        flash(900); document.body.classList.remove('timelapse'); $('tl').classList.add('hidden');
        banner('🦀 BACK IN BUSINESS!', '#16a34a', 3.5);
        audio.sfx('chime'); C.krabs?.play('excited', 2.5); C.spongebob?.play('cheer', 2.5);
      }
    },
  });
}
