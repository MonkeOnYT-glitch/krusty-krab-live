// Control panel. Live lists re-render from server state; forms render once per visit so typing is never clobbered.
import { connect } from './ws.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`; };
const time = (t) => new Date(t).toLocaleTimeString();

let S = null, tab = 'dashboard', selectedApp = null, editorKey = 'gift:rose', editorDraft = null;
const formsRendered = new Set();

const api = connect({
  onState: (st) => { S = st; render(); },
  onStatus: (ok) => { const c = $('#conn'); c.className = 'conn ' + (ok ? 'ok' : 'bad'); c.textContent = ok ? 'server connected' : 'server offline — retrying…'; },
});
async function call(action, data, okMsg) {
  try { const r = await api.req(action, data); if (okMsg) toast(okMsg, 'ok'); return r; }
  catch (e) { toast(e.message, 'err'); throw e; }
}
function toast(msg, kind = '') { const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg; $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500); }

$$('#nav button').forEach(b => b.onclick = () => { tab = b.dataset.tab; unmountPreviews(); $$('#nav button').forEach(x => x.classList.toggle('active', x === b)); $$('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + tab)); formsRendered.delete(tab); render(); });
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) actions[el.dataset.act]?.(el, e); });

const stateClass = (s) => ({ ok: 's-ok', connected: 's-ok', live_active: 's-ok', speaking: 's-info', idle: 's-ok', demo: 's-warn', testing: 's-warn', connecting: 's-warn', reconnecting: 's-warn', unknown: '', disconnected: '', error: 's-err' }[s] ?? '');

function render() {
  if (!S) return;
  renderStatusbar();
  const fn = { dashboard: renderDashboard, gifts: renderGifts, editor: renderEditor, hiring: renderHiring, scene: renderScene, overlay: renderOverlay, settings: renderSettings }[tab];
  fn?.();
  mountPreview();
}

// Only ONE live 3D preview exists at a time (each one is a full copy of the scene on the GPU).
// Inside the desktop app the stream window carries the audio, so previews stay silent there.
const IN_APP = /Electron/i.test(navigator.userAgent);
function unmountPreviews() { for (const f of $$('iframe.preview-frame')) { f.src = 'about:blank'; f.remove(); } }
function mountPreview() {
  const slot = $('#tab-' + tab + ' .preview-slot');
  if (!slot || slot.querySelector('iframe')) return;
  if (!slot.dataset.on) {
    if (!slot.querySelector('button')) slot.innerHTML = '<button class="b" data-act="showPreview" style="width:100%;aspect-ratio:9/16">▶ Show live 3D preview<br><span class="small muted">Off by default so your stream gets the full GPU</span></button>';
    return;
  }
  slot.innerHTML = '';
  const f = document.createElement('iframe');
  f.className = 'preview-frame'; f.allow = 'autoplay';
  f.src = IN_APP ? slot.dataset.src.replace('&audio=1', '') : slot.dataset.src;
  slot.appendChild(f);
}

function renderStatusbar() {
  const t = S.status.tiktok, a = S.status.ai, v = S.status.voice;
  $('#statusbar').innerHTML = `
    <span class="pill ${S.mode === 'demo' ? 's-warn' : 's-err'}"><span class="dot"></span><b>Mode</b>${S.mode === 'demo' ? 'DEMO' : 'LIVE'}${S.running ? '' : ' (stopped)'}</span>
    <span class="pill ${stateClass(t.state)}"><span class="dot"></span><b>TikTok</b>${esc(t.state.replace('_', ' '))}</span>
    <span class="pill ${stateClass(a.state)}"><span class="dot"></span><b>GPT-OSS</b>${esc(a.state)}${a.pending ? ` · ${a.pending} pending` : ''}</span>
    <span class="pill ${stateClass(v.state)}"><span class="dot"></span><b>Voice</b>${esc(v.provider)} · ${esc(v.state)}${v.queue ? ` · ${v.queue} queued` : ''}</span>
    <span class="pill"><b>Queue</b>${S.hiring.queue.length} waiting</span>
    <span class="pill"><b>Hiring</b>${S.hiring.paused ? 'paused' : esc(S.hiring.phase)}</span>
    <span class="pill"><b>SpongeBob</b>${esc(S.characters.spongebob)}</span>
    <span class="pill"><b>Overlays</b>${S.clients} connected</span>`;
}

// ------------------------------------------------------------------------------------- DASHBOARD
const EXAMPLES = ['Mr Krabs, can I get a job?', 'Hire me!', "My name is Alex and I need money for a new bike.", "I love Krabby Patties more than anything!", "I'm a good cook.", 'Why should you hire me?', 'Did I get accepted?'];
function renderDashboard() {
  const el = $('#tab-dashboard');
  if (!formsRendered.has('dashboard')) {
    formsRendered.add('dashboard');
    el.innerHTML = `
    <div class="dash-layout"><div>
      <div class="grid g3">
        <div class="card"><h3>Mode &amp; Controls</h3>
          <div class="row"><button class="b" data-act="mode" data-mode="demo">🧪 Demo Mode</button><button class="b" data-act="mode" data-mode="live">🔴 LIVE Mode</button></div>
          <div class="row"><button class="b green" data-act="start">▶ Start</button><button class="b red" data-act="stop">⏹ Stop</button><button class="b" data-act="pauseHiring" id="pauseBtn">⏸ Pause hiring</button></div>
          <div class="row"><button class="b" data-act="connect">🔌 Connect / Reconnect</button><button class="b" data-act="disconnect">Disconnect</button></div>
          <div class="small muted" id="d-tiktok"></div>
        </div>
        <div class="card"><h3>AI &amp; Voice</h3><div class="kv" id="d-aivoice"></div>
          <div class="row" style="margin-top:8px"><button class="b" data-act="aiTest">Test GPT-OSS</button><button class="b" data-act="voiceClear">Clear voice queue</button></div></div>
        <div class="card"><h3>💰 This stream</h3><div class="kv" id="d-money"></div></div>
        <div class="card"><h3>Character activity</h3><div class="kv" id="d-chars"></div><h3 style="margin-top:10px">Active reactions</h3><div id="d-reactions" class="small"></div></div>
      </div>
      <div class="card" id="demoCard" style="margin-top:14px"><h3>🧪 Demo Mode — simulated events (marked SIMULATED everywhere)</h3>
        <div class="row"><input id="demoUser" value="alex_demo" placeholder="viewer name" style="width:150px"><input id="demoMsg" placeholder="Type a chat message as that viewer… (no commands needed)" style="flex:1"><button class="b primary" data-act="demoChat">Send chat</button></div>
        <div class="chips" style="margin-bottom:10px">${EXAMPLES.map(x => `<span class="chip" data-act="demoExample">${esc(x)}</span>`).join('')}</div>
        <div class="row">
          <button class="b" data-act="demoGift" data-gift="Rose">🌹 Rose</button>
          <button class="b" data-act="demoGift" data-gift="Rose" data-count="5" data-streak="1">🌹 Rose x5 streak</button>
          <button class="b" data-act="demoGift" data-gift="Donut">🍩 Donut</button>
          <button class="b" data-act="demoGift" data-gift="Galaxy">🌌 Galaxy</button>
          <select id="demoOtherGift"></select><button class="b" data-act="demoOther">Send gift</button>
        </div>
        <div class="row">
          <button class="b sm" data-act="demoDup">Duplicate-delivery test</button>
          <button class="b sm" data-act="demoSpam">Spam 10 roses (cooldown test)</button>
          <button class="b sm" data-act="demoFollow">Follow</button>
          <button class="b sm" data-act="demoJoin">Join</button><button class="b sm" data-act="demoLike">Likes</button><button class="b sm" data-act="demoShare">Share</button>
          <input id="demoCustom" placeholder="custom event name" style="width:150px"><button class="b sm" data-act="demoCustomBtn">Fire custom event</button>
        </div>
        <div class="small muted" id="demoHint"></div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>Incoming chat</h3><div class="feed" id="d-chat"></div></div>
        <div class="card"><h3>Recent gifts</h3><div class="feed" id="d-gifts"></div></div>
        <div class="card"><h3>Application queue</h3><div class="feed" id="d-queue"></div></div>
        <div class="card"><h3>Errors &amp; diagnostics</h3><div class="feed" id="d-errors"></div></div>
      </div>
    </div>
    <div class="card"><h3>Live overlay preview</h3><div class="preview-slot" data-src="/overlay.html?preview=1&audio=1&quality=low"></div><div class="small muted" style="margin-top:6px">Plays voices &amp; effects (toggle in Stream Overlay). Click the page once if your browser blocks sound. OBS uses <code>/overlay.html</code>.</div></div></div>`;
    $('#demoMsg').addEventListener('keydown', e => { if (e.key === 'Enter') actions.demoChat(); });
  }
  const t = S.status.tiktok, a = S.status.ai, v = S.status.voice;
  $('#d-tiktok').textContent = `TikTok: ${t.state} — ${t.detail || ''}${t.username ? ` (@${t.username})` : ''}`;
  $('#pauseBtn').textContent = S.hiring.paused ? '▶ Resume hiring' : '⏸ Pause hiring';
  $('#d-aivoice').innerHTML = `<div>GPT-OSS</div><div>${esc(a.state)} — ${esc(a.detail)}</div><div>Model</div><div>${esc(S.settings.ai.model)}${a.latencyMs ? ` · last ${(a.latencyMs / 1000).toFixed(1)}s` : ''}</div><div>AI jobs</div><div>${a.pending} pending</div>
    <div>Voice</div><div>${esc(v.provider)} — ${esc(v.state)}${v.detail && v.state === 'error' ? ' — ' + esc(v.detail) : ''}</div><div>Speaking</div><div>${v.speaking ? esc(v.speaking.character + ': ' + v.speaking.text) : '—'}</div>`;
  { const gs = S.giftStats || {}, gl = S.settings.goal; const m = $('#d-money'); if (m) m.innerHTML = `<div>Coins received</div><div>${gs.total || 0} 🪙</div><div>Goal</div><div>${gl.enabled ? `${gs.goalCoins || 0} / ${gl.targetCoins} (${gs.goalsReached || 0} reached)` : 'off'}</div><div>Top Tipper</div><div>${gs.top ? esc(gs.top.name) + ' · ' + gs.top.coins + ' 🪙' : '—'}</div>`; }
  $('#d-chars').innerHTML = `<div>Mr. Krabs</div><div>${esc(S.characters.krabs)}</div><div>SpongeBob</div><div>${esc(S.characters.spongebob)}${S.groove?.pending ? ` (+${S.groove.pending} queued)` : ''}</div><div>Squidward</div><div>${esc(S.characters.squidward)}</div><div>Lighting</div><div>${esc(S.stage.light)}${S.stage.nuke ? ' · GALAXY EVENT' : ''}</div>`;
  $('#d-reactions').innerHTML = (S.reactions.active.map(r => `<div>▶ ${esc(r.label)} — ${esc(r.user)} ${r.source === 'demo' ? '<span class="tag demo">DEMO</span>' : ''}</div>`).join('') + S.reactions.queued.map(r => `<div class="muted">⏳ ${esc(r.label)} — ${esc(r.user)}</div>`).join('')) || '<span class="muted">none</span>';
  const isDemo = S.mode === 'demo';
  $$('#demoCard button, #demoCard input, #demoCard select').forEach(b => b.disabled = !isDemo);
  $('#demoHint').textContent = isDemo ? 'Demo events go through the same pipeline as real ones (dedupe, streaks, cooldowns, AI).' : 'Simulated events are disabled in LIVE mode so they can never be mixed with real viewers.';
  const sel = $('#demoOtherGift'); const opts = S.catalog.gifts.map(g => g.name);
  if (sel.options.length !== opts.length) sel.innerHTML = opts.map(n => `<option>${esc(n)}</option>`).join('');
  $('#d-chat').innerHTML = S.chat.slice().reverse().map(c => `<div class="it"><span class="tag ${c.source}">${c.source === 'demo' ? 'DEMO' : 'LIVE'}</span><b>${esc(c.nick || c.user)}</b>: ${esc(c.text)} <span class="muted small">${time(c.t)}</span></div>`).join('') || '<span class="muted">No chat yet</span>';
  $('#d-gifts').innerHTML = [...Object.values(S.streaks).map(s => `<div class="it">🔥 streak: ${esc(s.user)} ${esc(s.gift)} x${s.count}</div>`), ...S.gifts.slice().reverse().map(g => `<div class="it"><span class="tag ${g.source}">${g.source === 'demo' ? 'DEMO' : 'LIVE'}</span><b>${esc(g.nick || g.user)}</b> sent ${esc(g.gift)} x${g.count} ${g.diamonds != null ? `<span class="muted">(${g.diamonds} coins each)</span>` : ''} <span class="muted small">${time(g.t)}</span></div>`)].join('') || '<span class="muted">No gifts yet</span>';
  $('#d-queue').innerHTML = [S.hiring.current ? `<div class="it">🔎 <b>${esc(S.hiring.current.name || S.hiring.current.nickname)}</b> under review (${esc(S.hiring.phase)})</div>` : '', ...S.hiring.queue.map((a, i) => `<div class="it">${i + 1}. <b>${esc(a.name || a.nickname)}</b> — ${esc((a.pitch || a.experience || '(reason?)').slice(0, 50))} ${a.priority ? `<span class="tag pri">★${a.priority}</span>` : ''}${a.source === 'demo' ? '<span class="tag demo">DEMO</span>' : ''}<span class="muted small">${a.status}</span></div>`)].join('') || '<span class="muted">Queue empty</span>';
  $('#d-errors').innerHTML = S.logs.slice(-60).reverse().filter(l => l.level !== 'debug').map(l => `<div class="it lv-${l.level}">${time(l.t)} [${l.level}] ${esc(l.msg)}</div>`).join('');
}

// ------------------------------------------------------------------------------------- GIFT LIBRARY
const EMOJI = { rose: '🌹', donut: '🍩', galaxy: '🌌' };
function mappingFor(key) { return S.settings.mappings['gift:' + key] ? ['gift:' + key, S.settings.mappings['gift:' + key]] : ['gift:*', S.settings.mappings['gift:*']]; }
function renderGifts() {
  const el = $('#tab-gifts');
  if (!formsRendered.has('gifts')) {
    formsRendered.add('gifts');
    el.innerHTML = `<h2>Gift Library</h2>
      <div class="note">Official gift names, coin values and artwork are loaded only from TikTok's own gift list (via the LIVE connector). Gifts marked <b>unverified</b> are placeholders until you connect while live or press Refresh — no values are invented.</div>
      <div class="row"><input id="giftSearch" placeholder="Search gifts…" style="width:260px"><button class="b" data-act="refreshCatalog">⟳ Refresh catalog from TikTok</button><span class="small muted" id="catInfo"></span></div>
      <div class="tiles" id="giftTiles"></div>`;
    $('#giftSearch').oninput = () => drawTiles();
  }
  $('#catInfo').textContent = S.catalog.fetchedAt ? `Catalog fetched ${new Date(S.catalog.fetchedAt).toLocaleString()} · ${S.catalog.gifts.length} gifts` : 'Not yet fetched from TikTok (needs a live room + connection)';
  drawTiles();
}
function drawTiles() {
  const q = ($('#giftSearch')?.value || '').toLowerCase();
  const gifts = S.catalog.gifts.filter(g => !q || g.name.toLowerCase().includes(q)).slice(0, 300);
  $('#giftTiles').innerHTML = gifts.map(g => {
    const [key, m] = mappingFor(g.key);
    const own = key !== 'gift:*';
    const hasGroove = own && m.actions.some(a => a.type === 'spongebob_groove');
    return `<div class="tile ${own && !m.enabled ? 'off' : ''}">
      <div class="art">${g.image ? `<img src="${esc(g.image)}" alt="" referrerpolicy="no-referrer">` : (EMOJI[g.key] || '🎁')}</div>
      <div class="nm">${esc(g.name)}</div>
      <div class="${g.verified ? 'coins' : 'unv'}">${g.verified ? `🪙 ${g.coins ?? '?'} coins · id ${g.id}` : 'unverified — artwork & coins load from TikTok'}</div>
      <div class="re">${own ? `<b>${esc(m.label)}</b><br>${m.actions.length} actions · cooldown ${m.cooldownSec}s` : `Uses fallback: ${esc(S.settings.mappings['gift:*'].label)}`}</div>
      <div class="row" style="margin:0">${own ? `<label class="small"><input type="checkbox" data-act="toggleMap" data-key="${key}" ${m.enabled ? 'checked' : ''}> enabled</label>` : ''}
        <label class="small" title="SpongeBob says 'I feel a groove coming on' then dances"><input type="checkbox" data-act="toggleGroove" data-gkey="${g.key}" ${hasGroove ? 'checked' : ''}> 🕺 groove</label></div>
      <div class="row" style="margin:0"><button class="b sm" data-act="previewKey" data-key="${own ? key : 'gift:' + g.key}">▶ Preview</button><button class="b sm" data-act="editKey" data-key="${'gift:' + g.key}">✎ Configure</button></div>
    </div>`;
  }).join('') || '<span class="muted">No gifts match</span>';
}

// ------------------------------------------------------------------------------------- REACTION EDITOR
function blankMapping(label) { return { label, enabled: true, durationSec: 5, cooldownSec: 5, userCooldownSec: 0, overlap: 'parallel', quantityMode: 'once', maxRepeats: 1, actions: [] }; }
function paramFields(a, i) {
  const O = S.options, p = a.params || {};
  const sel = (name, list, v) => `<select data-pi="${i}" data-pn="${name}">${list.map(x => `<option ${x === v ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const txt = (name, v, ph = '') => `<input data-pi="${i}" data-pn="${name}" value="${esc(v ?? '')}" placeholder="${ph}">`;
  switch (a.type) {
    case 'voice': return sel('character', ['krabs', 'spongebob', 'squidward'], p.character) + txt('text', p.text, 'Line — {user} {gift} {count}');
    case 'krabs_anim': return sel('anim', O.KRABS_ANIMS, p.anim);
    case 'sponge_anim': return sel('anim', O.SPONGE_ANIMS, p.anim);
    case 'sfx': return sel('sound', O.SOUNDS, p.sound);
    case 'music': return sel('track', O.MUSIC, p.track);
    case 'particles': return sel('kind', O.PARTICLES, p.kind);
    case 'lighting': return sel('mode', O.LIGHT_MODES, p.mode);
    case 'camera': return sel('shot', O.CAMERA_SHOTS, p.shot);
    case 'transition': return sel('style', O.TRANSITIONS, p.style);
    case 'banner': return txt('text', p.text, '{user} {gift} {xcount}') + `<input type="color" data-pi="${i}" data-pn="color" value="${esc(p.color || '#ffcc00')}">`;
    case 'priority_boost': return txt('amount', p.amount ?? '', 'default per gift') + `<label class="small"><input type="checkbox" data-pi="${i}" data-pn="scaleWithQuantity" ${p.scaleWithQuantity !== false ? 'checked' : ''}> × quantity</label>`;
    case 'spongebob_groove': return `<span class="small muted">Says exactly "I feel a groove coming on", then dances. Gift-triggered only; overlap policy in Settings.</span>`;
    case 'nuke': return `<span class="small muted">Countdown → flash → fireball, shockwave, shake, aftermath. Uses event duration & intensity.</span>`;
    default: return '<span class="small muted">no options</span>';
  }
}
function renderEditor(force = false) {
  const el = $('#tab-editor');
  if (formsRendered.has('editor') && !force) return;
  formsRendered.add('editor');
  const M = S.settings.mappings;
  if (!editorDraft) editorDraft = structuredClone(M[editorKey] || blankMapping(editorKey));
  const d = editorDraft, O = S.options;
  const giftKeys = S.catalog.gifts.map(g => 'gift:' + g.key);
  const keys = [...new Set([...Object.keys(M), ...giftKeys, 'event:follow', editorKey])];
  const isGift = editorKey.startsWith('gift:');
  el.innerHTML = `<h2>Reaction Editor</h2>
    <div class="card"><div class="row">
      <label class="f">Gift or event<select id="edKey">${keys.map(k => `<option value="${k}" ${k === editorKey ? 'selected' : ''}>${k}${M[k] ? '' : ' (not configured)'}</option>`).join('')}</select></label>
      <label class="f">New custom event<span class="row" style="margin:0"><input id="edNewCustom" placeholder="e.g. big_hype"><button class="b sm" data-act="edNewCustom">Create</button></span></label>
    </div>
    <div class="form">
      <label class="f">Label<input id="edLabel" value="${esc(d.label)}"></label>
      <label class="f">Ticker text (top bar)<input id="edTicker" value="${esc(d.tickerText || '')}" placeholder="defaults to the part after —"></label>
      <label class="f">Enabled<select id="edEnabled"><option value="1" ${d.enabled ? 'selected' : ''}>yes</option><option value="0" ${!d.enabled ? 'selected' : ''}>no</option></select></label>
      <label class="f">Event duration (s)<input id="edDur" type="number" min="1" max="60" value="${d.durationSec}"></label>
      <label class="f">Cooldown (s, global)<input id="edCd" type="number" min="0" value="${d.cooldownSec}"></label>
      <label class="f">Cooldown per viewer (s)<input id="edUcd" type="number" min="0" value="${d.userCooldownSec || 0}"></label>
      <label class="f">If already running<select id="edOverlap">${['queue', 'skip', 'parallel'].map(x => `<option ${d.overlap === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="f">Quantity / combos<select id="edQty"><option value="once" ${d.quantityMode === 'once' ? 'selected' : ''}>play once (quantity scales boosts)</option><option value="repeat" ${d.quantityMode === 'repeat' ? 'selected' : ''}>repeat per gift</option></select></label>
      <label class="f">Max repeats<input id="edMaxRep" type="number" min="1" max="10" value="${d.maxRepeats || 1}"></label>
    </div></div>
    <div class="card" style="margin-top:12px"><h3>Actions (run in order of delay)</h3>
      <div class="small muted" style="margin-bottom:6px">Columns: order · type · delay ms · duration s (blank = event duration) · intensity · options</div>
      <div id="edActions">${d.actions.map((a, i) => `<div class="act">
        <div class="row" style="margin:0;flex-direction:column;gap:2px"><button class="b sm" data-act="edMove" data-i="${i}" data-d="-1">↑</button><button class="b sm" data-act="edMove" data-i="${i}" data-d="1">↓</button></div>
        <select data-ai="${i}" data-af="type">${Object.entries(O.ACTION_TYPES).filter(([t]) => isGift || (t !== 'spongebob_groove' && t !== 'priority_boost')).map(([t, x]) => `<option value="${t}" ${a.type === t ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
        <input type="number" data-ai="${i}" data-af="delay" value="${a.delay || 0}" min="0" step="100">
        <input type="number" data-ai="${i}" data-af="duration" value="${a.duration ?? ''}" placeholder="event" min="0" step="0.5">
        <input type="number" data-ai="${i}" data-af="intensity" value="${a.intensity ?? 1}" min="0.2" max="2" step="0.1">
        <div class="params">${paramFields(a, i)}</div>
        <button class="b sm red" data-act="edRemove" data-i="${i}">✕</button></div>`).join('') || '<div class="muted">No actions yet</div>'}</div>
      <div class="row"><select id="edAddType">${Object.entries(O.ACTION_TYPES).filter(([t]) => isGift || (t !== 'spongebob_groove' && t !== 'priority_boost')).map(([t, x]) => `<option value="${t}">${esc(x.label)}</option>`).join('')}</select><button class="b" data-act="edAdd">+ Add action</button></div>
      ${isGift ? '' : '<div class="note warn">SpongeBob\'s groove and queue boosts can only be assigned to gifts.</div>'}
      <div class="row" style="margin-top:10px"><button class="b primary" data-act="edSave">💾 Save mapping</button><button class="b" data-act="edPreview">▶ Save &amp; preview</button><button class="b" data-act="edRevert">Revert</button><button class="b red" data-act="edDelete">Delete mapping</button></div>
    </div>
    <div class="card" style="margin-top:12px"><h3>Presets</h3><div class="row">
      <input id="presetName" placeholder="preset name"><button class="b" data-act="presetSave">Save all mappings as preset</button>
      <select id="presetSel"><option value="__defaults__">Factory defaults</option>${S.presets.map(p => `<option>${esc(p)}</option>`).join('')}</select><button class="b" data-act="presetRestore">Restore preset</button></div></div>`;
  $('#edKey').onchange = (e) => { editorKey = e.target.value; editorDraft = null; renderEditor(true); };
  el.oninput = el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.ai !== undefined) {
      const a = editorDraft.actions[+t.dataset.ai], f = t.dataset.af;
      if (f === 'type') { a.type = t.value; a.params = structuredClone(S.options.ACTION_TYPES[t.value].params); syncDraft(); renderEditor(true); return; }
      a[f] = f === 'duration' ? (t.value === '' ? null : +t.value) : +t.value;
    } else if (t.dataset.pi !== undefined) {
      const a = editorDraft.actions[+t.dataset.pi]; a.params ||= {};
      a.params[t.dataset.pn] = t.type === 'checkbox' ? t.checked : (t.dataset.pn === 'amount' ? (t.value === '' ? null : +t.value) : t.value);
    }
  };
}
function syncDraft() {
  const d = editorDraft; if (!$('#edLabel')) return d;
  Object.assign(d, { tickerText: $('#edTicker').value.trim(), label: $('#edLabel').value, enabled: $('#edEnabled').value === '1', durationSec: +$('#edDur').value, cooldownSec: +$('#edCd').value, userCooldownSec: +$('#edUcd').value, overlap: $('#edOverlap').value, quantityMode: $('#edQty').value, maxRepeats: +$('#edMaxRep').value });
  return d;
}

// ------------------------------------------------------------------------------------- HIRING
function renderHiring() {
  const el = $('#tab-hiring'), h = S.hiring, cur = h.current;
  const sel = h.queue.find(a => a.id === selectedApp) || cur || h.queue[0];
  el.innerHTML = `<h2>Hiring Office</h2>
  <div class="grid g2">
    <div class="card"><h3>Application queue (${h.queue.length})</h3>
      <div class="row"><button class="b" data-act="reviewNow">Review next now</button><button class="b" data-act="pauseHiring">${h.paused ? '▶ Resume auto-review' : '⏸ Pause auto-review'}</button><button class="b" data-act="returnToQueue" ${cur ? '' : 'disabled'}>↩ Return current to queue</button></div>
      <table><tr><th>#</th><th>Applicant</th><th>Reason</th><th>Priority</th><th>Status</th><th></th></tr>
      ${h.queue.map((a, i) => `<tr class="${sel?.id === a.id ? 'sel' : ''}"><td>${i + 1}</td><td><a href="#" data-act="selApp" data-id="${a.id}">${esc(a.name || a.nickname)}</a><div class="small muted">@${esc(a.uniqueId)} ${a.source === 'demo' ? '<span class="tag demo">DEMO</span>' : '<span class="tag live">LIVE</span>'}</div></td><td class="small">${esc(a.pitch || a.experience || '—')}</td><td>${a.priority ? `<span class="tag pri">★ ${a.priority}</span>` : '—'}</td><td>${a.status}</td>
      <td><button class="b sm" data-act="qMove" data-id="${a.id}" data-dir="up">↑</button><button class="b sm" data-act="qMove" data-id="${a.id}" data-dir="down">↓</button>${a.status === 'collecting' ? `<button class="b sm" data-act="qForce" data-id="${a.id}">queue</button>` : ''}<button class="b sm red" data-act="qRemove" data-id="${a.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No applications waiting</td></tr>'}</table>
    </div>
    <div class="card"><h3>${cur ? 'Under review' : 'Selected application'}</h3>
      ${sel ? `<div class="kv"><div>Name</div><div>${esc(sel.name || '(not given)')} <span class="muted">@${esc(sel.uniqueId)}</span></div><div>Why they want it</div><div>${esc(sel.pitch || '—')}</div><div>Skills</div><div>${esc(sel.experience || '—')}</div><div>Asked for</div><div>${esc(sel.role || '(nothing — Mr. Krabs decides)')}</div><div>Chat</div><div>${sel.messages.map(esc).join('<br>')}</div><div>Priority</div><div>${sel.priority} ${sel.priorityReasons.length ? `(${esc(sel.priorityReasons.join(', '))})` : ''}</div><div>Status</div><div>${sel.status}${cur && cur.id === sel.id ? ` — <b>${esc(h.phase)}</b>` : ''}${h.awaitingManual ? ' — AI failed, waiting for your stamp' : ''}</div></div>` : '<div class="muted">Nothing selected</div>'}
      <h3 style="margin-top:12px">Decision stamps ${cur ? '(applies to the application under review)' : '(reviews the selected application now)'}</h3>
      <div class="stampbtns"><button class="b yellow" data-act="decide" data-d="CALL YOU LATER" ${sel ? '' : 'disabled'}>CALL YOU LATER</button><button class="b red" data-act="decide" data-d="DENIED" ${sel ? '' : 'disabled'}>DENIED</button><button class="b green" data-act="decide" data-d="ACCEPTED" ${sel ? '' : 'disabled'}>ACCEPTED</button></div>
      <h3 style="margin-top:12px">Stamping animation test (dummy paper, queue untouched)</h3>
      <div class="stampbtns"><button class="b sm" data-act="stampTest" data-d="CALL YOU LATER">Test yellow</button><button class="b sm" data-act="stampTest" data-d="DENIED">Test red</button><button class="b sm" data-act="stampTest" data-d="ACCEPTED">Test green</button></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>💰 Payroll (${(h.employees || []).length} employees) — they can ask for raises in chat</h3>
    <table><tr><th>Employee</th><th>Position</th><th>Wage</th><th>Raises</th></tr>
    ${(h.employees || []).map(e => `<tr><td>${esc(e.name)} <span class="muted small">@${esc(e.user)}</span></td><td>${esc(e.position)}</td><td>$${(e.wageCents / 100).toFixed(2)}/hr</td><td>${e.raises}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nobody hired yet</td></tr>'}</table></div>
  <div class="card" style="margin-top:14px"><h3>Decision history — ${Object.entries(h.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}</h3>
    <table><tr><th>Time</th><th>Applicant</th><th>Position assigned</th><th>Decision</th><th>By</th><th>Explanation</th></tr>
    ${h.history.map(a => `<tr><td>${time(a.decidedAt)}</td><td>${esc(a.name || a.nickname)} ${a.source === 'demo' ? '<span class="tag demo">DEMO</span>' : ''}</td><td>${esc(a.assignedRole || '—')}</td><td><span class="tag ${a.decision.split(' ')[0]}">${a.decision}</span></td><td>${esc(a.decidedBy)}</td><td class="small">${esc(a.explanation)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No decisions yet</td></tr>'}</table></div>`;
}

// ------------------------------------------------------------------------------------- SCENE
function renderScene() {
  const el = $('#tab-scene');
  if (formsRendered.has('scene')) return;
  formsRendered.add('scene');
  const sc = S.settings.scene, O = S.options, L = sc.layout;
  const slider = (id, label, v, min, max, step) => `<label class="f">${label} <span id="${id}-v">${v}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  el.innerHTML = `<h2>Characters &amp; Scene</h2><div class="dash-layout"><div>
    <div class="card"><h3>Visibility</h3><div class="row">
      <label><input type="checkbox" id="vK" ${sc.showKrabs ? 'checked' : ''}> Mr. Krabs</label><label><input type="checkbox" id="vS" ${sc.showSpongebob ? 'checked' : ''}> SpongeBob</label><label><input type="checkbox" id="vQ" ${sc.showSquidward ? 'checked' : ''}> Squidward</label></div></div>
    <div class="card" style="margin-top:12px"><h3>Animation tests</h3>
      <div class="small muted">Mr. Krabs</div><div class="chips" style="margin:4px 0 10px">${O.KRABS_ANIMS.map(a => `<span class="chip" data-act="animTest" data-t="krabs" data-a="${a}">${a}</span>`).join('')}</div>
      <div class="small muted">SpongeBob (idle animations only — his groove dance starts only from a qualifying gift)</div><div class="chips" style="margin:4px 0 10px">${O.SPONGE_ANIMS.map(a => `<span class="chip" data-act="animTest" data-t="sponge" data-a="${a}">${a}</span>`).join('')}</div>
      <div class="small muted">Squidward</div><div class="chips" style="margin-top:4px">${['shocked', 'annoyed'].map(a => `<span class="chip" data-act="animTest" data-t="squid" data-a="${a}">${a}</span>`).join('')}</div></div>
    <div class="card" style="margin-top:12px"><h3>Camera &amp; lighting</h3><div class="form">
      <label class="f">Base shot<select id="camPreset">${O.CAMERA_SHOTS.map(s => `<option ${sc.camera.preset === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      ${slider('camFov', 'FOV', sc.camera.fov, 35, 80, 1)}${slider('camX', 'Camera X offset', sc.camera.x, -1, 0.05, 0.01)}${slider('camY', 'Camera Y offset', sc.camera.y, -0.5, 1, 0.01)}${slider('camZ', 'Camera Z offset', sc.camera.z, -1, 1, 0.01)}
      ${slider('bright', 'Brightness', sc.brightness, 0.4, 1.8, 0.05)}
      <label class="f">Quality<select id="quality">${['low', 'medium', 'high'].map(q => `<option ${sc.quality === q ? 'selected' : ''}>${q}</option>`).join('')}</select></label></div></div>
    <div class="card" style="margin-top:12px"><h3>Layout offsets (metres)</h3><div class="form">
      ${slider('dX', 'Desk+Krabs X', L.desk.x, -1, 0.8, 0.01)}${slider('dZ', 'Desk+Krabs Z', L.desk.z, -1, 1, 0.01)}
      ${slider('sX', 'SpongeBob X', L.spongebob.x, -1.5, 1.5, 0.01)}${slider('sZ', 'SpongeBob Z', L.spongebob.z, -2, 1.5, 0.01)}
      ${slider('qX', 'Squidward X', L.squidward.x, -1, 1, 0.01)}${slider('qZ', 'Squidward Z', L.squidward.z, -1, 1, 0.01)}</div>
      <div class="row" style="margin-top:8px"><button class="b primary" data-act="sceneSave">Save scene settings</button></div></div>
    <div class="card" style="margin-top:12px"><h3>Voice tests</h3><div class="row"><select id="vtChar"><option>krabs</option><option>spongebob</option><option>squidward</option></select><input id="vtText" style="flex:1" value="Ahoy! Who wants to make me some money?"><button class="b" data-act="voiceTest">▶ Speak</button></div>
      <div class="small muted">Voice provider and per-character voices are in Settings → Voice.</div></div>
  </div><div class="card"><h3>Live 3D preview</h3><div class="preview-slot" data-src="/overlay.html?preview=1&quality=medium"></div></div></div>`;
  el.oninput = (e) => { const v = $('#' + e.target.id + '-v'); if (v) v.textContent = e.target.value; clearTimeout(el._t); el._t = setTimeout(() => actions.sceneSave(null, null, true), 250); };
  el.onchange = (e) => { if (['vK', 'vS', 'vQ', 'camPreset', 'quality'].includes(e.target.id)) actions.sceneSave(null, null, true); };
}

// ------------------------------------------------------------------------------------- OVERLAY
function renderOverlay() {
  const el = $('#tab-overlay');
  if (formsRendered.has('overlay')) return;
  formsRendered.add('overlay');
  const o = S.settings.overlay, url = `${location.origin}/overlay.html`;
  const cb = (id, label) => `<label><input type="checkbox" data-ov="${id}" ${o[id] !== false ? 'checked' : ''}> ${label}</label>`;
  el.innerHTML = `<h2>Stream Overlay</h2><div class="dash-layout"><div>
    <div class="card"><h3>OBS setup</h3>
      <div class="row"><code id="ovUrl">${url}</code><button class="b sm" data-act="copyUrl">Copy</button><a class="b sm" href="${url}" target="_blank">Open</a></div>
      <ol class="small"><li>OBS → Sources → + → <b>Browser</b>.</li><li>URL: the address above. Width <b>1080</b>, height <b>1920</b> (9:16 vertical canvas).</li><li>Tick <b>Control audio via OBS</b> so voices/music/effects go to your stream mix.</li><li>Leave “Shutdown source when not visible” unticked so the scene stays loaded.</li></ol>
      <div class="note">The overlay mirrors the control panel in real time over a local WebSocket. Any number of overlay windows can be open; only the one in OBS needs audio.</div></div>
    <div class="card" style="margin-top:12px"><h3>Overlay elements</h3><div class="row">${cb('showTicker', 'Gift ticker bar')}${cb('showQueue', 'Hiring queue')}${cb('showApplication', 'Application card + stamp')}${cb('showSubtitles', 'Subtitles')}${cb('showBanners', 'Gift banners')}${cb('showStatusBadge', 'DEMO/LIVE badge')}</div>
      <div class="row"><label><input type="checkbox" data-ov="showGoal" ${o.showGoal !== false ? 'checked' : ''}> 🎯 Goal bar</label><label><input type="checkbox" data-ov="showCrown" ${o.showCrown !== false ? 'checked' : ''}> 👑 Top Tipper</label>
        <label><input type="checkbox" data-ov="bgmEnabled" ${o.bgmEnabled !== false ? 'checked' : ''}> 🎵 Background music</label>
        <label class="small">Volume <input type="range" min="0" max="1" step="0.05" value="${o.bgmVolume ?? 0.35}" data-ovnum="bgmVolume"></label>
        <span class="small muted">Original island loop, or drop your own MP3s (that you have rights to) into <code>public/music</code>.</span></div>
      <div class="row"><label><input type="checkbox" data-ov="previewAudioInControl" ${o.previewAudioInControl ? 'checked' : ''}> Play audio in the dashboard preview (turn off if OBS monitoring doubles it)</label></div></div>
  </div><div class="card"><h3>Overlay (exact OBS output)</h3><div class="preview-slot" data-src="/overlay.html?preview=1&quality=medium"></div></div></div>`;
  el.onchange = async (e) => {
    const n = e.target.dataset.ovnum; if (n) { await call('settings.update', { patch: { overlay: { [n]: +e.target.value } } }); return; }
    const k = e.target.dataset.ov; if (!k) return; await call('settings.update', { patch: { overlay: { [k]: e.target.checked } } }, 'Overlay updated');
  };
}

// ------------------------------------------------------------------------------------- SETTINGS
function renderSettings() {
  const el = $('#tab-settings');
  if (formsRendered.has('settings')) { const lb = $('#logBox'); if (lb) lb.innerHTML = S.logs.slice(-150).map(l => `<span class="lv-${l.level}">${time(l.t)} [${l.level}] ${esc(l.msg)}</span>`).join('\n'); return; }
  formsRendered.add('settings');
  const s = S.settings, a = s.ai, v = s.voice, h = s.hiring, e = s.engine, t = s.tiktok;
  const inp = (path, val, type = 'text', extra = '') => `<input data-path="${path}" type="${type}" value="${esc(val)}" ${extra}>`;
  const sel = (path, val, opts) => `<select data-path="${path}">${opts.map(o => `<option ${String(o) === String(val) ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  const chk = (path, val) => `<input data-path="${path}" type="checkbox" ${val ? 'checked' : ''}>`;
  const F = (label, html) => `<label class="f">${label}${html}</label>`;
  el.innerHTML = `<h2>Settings</h2>
  <div class="grid g2">
  <div class="card"><h3>GPT-OSS (local, Ollama)</h3>
    <div class="note">Runs only on your PC through Ollama. There is no cloud AI fallback. <b>gpt-oss:20b</b> (13 GB, MXFP4) is larger than your 8 GB VRAM, so Ollama splits it between GPU and CPU; keep the context small (4096) and reasoning "low" for snappy replies.</div>
    <div class="form">${F('Endpoint', inp('ai.endpoint', a.endpoint))}${F('Model', `<select data-path="ai.model" id="aiModel"><option>${esc(a.model)}</option></select>`)}${F('Reasoning effort', sel('ai.think', a.think, ['low', 'medium', 'high']))}${F('Temperature', inp('ai.temperature', a.temperature, 'number', 'step="0.1" min="0" max="2"'))}${F('Context (num_ctx)', inp('ai.numCtx', a.numCtx, 'number', 'step="512"'))}${F('Timeout (s)', inp('ai.timeoutSec', a.timeoutSec, 'number'))}${F('Retries', inp('ai.retries', a.retries, 'number', 'min="0" max="3"'))}${F('Keep model loaded', inp('ai.keepAlive', a.keepAlive))}${F('Max pending chat jobs', inp('ai.maxPendingChats', a.maxPendingChats, 'number'))}${F('Krabs chat-reply cooldown (s)', inp('ai.chatReplyCooldownSec', a.chatReplyCooldownSec, 'number'))}${F('Only send job-related chat to the AI', chk('ai.prefilter', a.prefilter))}${F('If AI review fails', sel('ai.failurePolicy', a.failurePolicy, ['random', 'manual']))}${F('Max wait for operator stamp (s)', inp('ai.manualWaitSec', a.manualWaitSec ?? 45, 'number'))}</div>
    <div class="row" style="margin-top:8px"><button class="b" data-act="aiTest">Test connection</button><span class="small" id="aiStat">${esc(S.status.ai.state)} — ${esc(S.status.ai.detail)}</span></div></div>
  <div class="card"><h3>TikTok LIVE</h3>
    <div class="note warn">Uses the unofficial <code>tiktok-live-connector</code> (v2.5). It needs a free <b>Euler Stream</b> API key (eulerstream.com) for signing, and you must be live. TikTok can change things at any time, so this may break without notice.</div>
    <div class="form">${F('Your TikTok username', inp('tiktok.username', t.username, 'text', 'placeholder="without @"'))}${F('Auto-reconnect', chk('tiktok.autoReconnect', t.autoReconnect))}${F('Max reconnect attempts', inp('tiktok.maxReconnectAttempts', t.maxReconnectAttempts, 'number'))}</div>
    <div class="row" style="margin-top:8px"><input id="eulerKey" type="password" placeholder="Euler Stream API key (${S.secrets.eulerStreamApiKey})" style="flex:1"><button class="b" data-act="setSecret" data-name="eulerStreamApiKey" data-input="eulerKey">Save key</button></div></div>
  <div class="card"><h3>Voice</h3>
    <div class="note">Fish Audio voices are community voice models chosen by you. They are not official character voices. SAPI uses the Windows voices installed on this PC. Lines are cached locally after the first synthesis.</div>
    <div class="form">${F('Provider', sel('voice.provider', v.provider, ['fish', 'sapi', 'none']))}${F('Fish model', inp('voice.fishModel', v.fishModel))}${F('Volume', inp('voice.volume', v.volume, 'number', 'step="0.05" min="0" max="1"'))}${F('Max queued lines', inp('voice.maxQueue', v.maxQueue, 'number'))}
    ${['krabs', 'spongebob', 'squidward'].map(c => F(`${c} — Fish voice ID`, inp(`voice.characters.${c}.fishReferenceId`, v.characters[c].fishReferenceId)) + F(`${c} — SAPI voice`, sel(`voice.characters.${c}.sapiVoice`, v.characters[c].sapiVoice, ['Microsoft David Desktop', 'Microsoft Zira Desktop'])) + F(`${c} — SAPI rate`, inp(`voice.characters.${c}.sapiRate`, v.characters[c].sapiRate, 'number', 'min="-10" max="10"'))).join('')}</div>
    <div class="row" style="margin-top:8px"><input id="fishKey" type="password" placeholder="Fish Audio API key (${S.secrets.fishAudioApiKey})" style="flex:1"><button class="b" data-act="setSecret" data-name="fishAudioApiKey" data-input="fishKey">Save key</button></div></div>
  <div class="card"><h3>Hiring &amp; queue rules</h3><div class="form">${F('Auto-review', chk('hiring.autoReview', h.autoReview))}${F('Follow-up timeout (s)', inp('hiring.followupTimeoutSec', h.followupTimeoutSec, 'number'))}${F('Max follow-up questions', inp('hiring.maxFollowups', h.maxFollowups, 'number'))}${F('Pause between reviews (s)', inp('hiring.pauseBetweenSec', h.pauseBetweenSec, 'number'))}${F('Max queue length', inp('hiring.maxQueue', h.maxQueue, 'number'))}${F('Rose rule', sel('hiring.roseRule', h.roseRule, ['boost', 'front']))}${F('Priority per Rose', inp('hiring.roseBoostPerGift', h.roseBoostPerGift, 'number'))}${F('Max priority', inp('hiring.maxPriority', h.maxPriority, 'number'))}</div></div>
  <div class="card"><h3>🎯 Gift goal &amp; 👑 Top Tipper</h3><div class="form">${F('Goal bar on stream', chk('goal.enabled', s.goal.enabled))}${F('Goal label', inp('goal.label', s.goal.label))}${F('Goal size (coins)', inp('goal.targetCoins', s.goal.targetCoins, 'number', 'min="1"'))}</div><div class="row" style="margin-top:8px"><button class="b" data-act="statsReset">Reset goal &amp; Top Tipper (new stream)</button><span class="small muted">Coins use TikTok's real gift values. Stats reset when the app restarts.</span></div></div>
  <div class="card"><h3>👋 Welcomes &amp; thanks</h3><div class="form">${F('Welcome people who join', chk('greet.joins', s.greet.joins))}${F('Thank likers', chk('greet.likes', s.greet.likes))}${F('Thank shares', chk('greet.shares', s.greet.shares))}${F('Welcome batch every (s)', inp('greet.joinEverySec', s.greet.joinEverySec, 'number'))}${F('Like thanks every (s)', inp('greet.likeEverySec', s.greet.likeEverySec, 'number'))}</div></div>
  <div class="card"><h3>Dead-air hooks</h3><div class="form">${F('Enabled', chk('hooks.enabled', s.hooks.enabled))}${F('Chat quiet for (s)', inp('hooks.quietSec', s.hooks.quietSec, 'number'))}${F('Repeat every (s) while quiet', inp('hooks.repeatSec', s.hooks.repeatSec, 'number'))}</div><div class="row" style="margin-top:8px"><button class="b" data-act="hookNow">Play a hook now</button><span class="small muted">GPT-OSS writes a fresh call-to-action each time.</span></div></div>
  <div class="card"><h3>Squidward banter</h3><div class="form">${F('Enabled', chk('banter.enabled', s.banter.enabled))}${F('Min seconds between', inp('banter.minSec', s.banter.minSec, 'number'))}${F('Max seconds between', inp('banter.maxSec', s.banter.maxSec, 'number'))}</div><div class="row" style="margin-top:8px"><button class="b" data-act="banterNow">Play a banter now</button><span class="small muted">Squidward complains, Mr. Krabs answers; waits for quiet moments.</span></div></div>
  <div class="card"><h3>Reaction engine &amp; SpongeBob groove</h3><div class="form">${F('Max concurrent reactions', inp('engine.maxConcurrentReactions', e.maxConcurrentReactions, 'number', 'min="1" max="6"'))}${F('Max queued reactions', inp('engine.maxQueuedReactions', e.maxQueuedReactions, 'number'))}${F('Groove while already dancing', sel('engine.groovePolicy', e.groovePolicy, ['queue', 'extend', 'ignore']))}${F('Groove max queued', inp('engine.grooveMaxQueue', e.grooveMaxQueue, 'number'))}${F('Dance length (s)', inp('engine.grooveDanceSec', e.grooveDanceSec, 'number'))}${F('Extend by (s)', inp('engine.grooveExtendSec', e.grooveExtendSec, 'number'))}${F('Max dance length (s)', inp('engine.grooveMaxDanceSec', e.grooveMaxDanceSec, 'number'))}</div></div>
  <div class="card"><h3>Assets &amp; performance</h3><div class="form">${Object.entries(s.scene.models).map(([k, u]) => F(`Model: ${k}`, inp(`scene.models.${k}`, u))).join('')}${F('Graphics quality', sel('scene.quality', s.scene.quality, ['low', 'medium', 'high']))}</div><div class="small muted" style="margin-top:6px">Model files live in <code>public/models/</code>. Changing a path takes effect when overlays reload.</div></div>
  </div>
  <div class="row" style="margin-top:12px"><button class="b primary" data-act="saveSettings">💾 Save settings</button><span class="small muted">Saved to data/settings.json; API keys are stored separately in data/secrets.json and never shown again.</span></div>
  <div class="card" style="margin-top:14px"><h3>Logs &amp; diagnostics</h3><div class="logbox" id="logBox"></div><div class="small muted">Full log: data/app.log</div></div>`;
  call('ai.models').then(ms => { const s2 = $('#aiModel'); if (s2) s2.innerHTML = ms.map(m => `<option ${m.name === a.model ? 'selected' : ''} value="${esc(m.name)}">${esc(m.name)} (${esc(m.params)} ${esc(m.quant)}, ${(m.size / 1e9).toFixed(1)} GB)</option>`).join(''); }).catch(() => {});
  renderSettings();
}

// ------------------------------------------------------------------------------------- ACTIONS
const val = (id) => $('#' + id)?.value;
const actions = {
  mode: (b) => call('setMode', { mode: b.dataset.mode }, `Switched to ${b.dataset.mode.toUpperCase()} mode`),
  start: () => call('system.start', {}, 'Started'),
  stop: () => call('system.stop', {}, 'Stopped — incoming events are ignored'),
  pauseHiring: () => call('hiring.pause', { paused: !S.hiring.paused }),
  connect: () => call('tiktok.connect', {}).then(r => r?.ok ? toast('Connected to TikTok LIVE', 'ok') : toast('TikTok: ' + (r?.error || 'failed'), 'err')),
  disconnect: () => call('tiktok.disconnect', {}, 'Disconnected'),
  aiTest: () => { toast('Testing GPT-OSS… first load can take ~30s'); call('ai.test').then(r => r.ok ? toast('GPT-OSS ready', 'ok') : toast('GPT-OSS: ' + r.error, 'err')); },
  voiceClear: () => call('voice.clear', {}, 'Voice queue cleared'),
  demoChat: () => { const t = val('demoMsg'); if (!t) return; call('demo.chat', { user: val('demoUser'), text: t }); $('#demoMsg').value = ''; },
  demoExample: (el) => { call('demo.chat', { user: val('demoUser'), text: el.textContent }); },
  demoGift: (b) => call('demo.gift', { user: val('demoUser'), gift: b.dataset.gift, count: +(b.dataset.count || 1), streak: !!b.dataset.streak }).then(r => r?.cooldown && toast('Gift counted; show skipped (cooldown)')),
  demoOther: () => call('demo.gift', { user: val('demoUser'), gift: val('demoOtherGift'), count: 1 }),
  demoDup: () => call('demo.duplicate', { user: val('demoUser'), gift: 'Rose' }).then(r => toast(`Delivered twice → second ${r.second?.duplicate ? 'ignored as duplicate ✔' : 'NOT deduplicated'}`, r.second?.duplicate ? 'ok' : 'err')),
  demoSpam: () => call('demo.spam', { user: 'spammer', gift: 'Rose', n: 10 }, '10 roses sent — watch cooldowns in the log'),
  demoFollow: () => call('demo.follow', { user: val('demoUser') }),
  demoJoin: () => call('demo.join', { user: val('demoUser') }),
  demoLike: () => call('demo.like', { user: val('demoUser') }),
  demoShare: () => call('demo.share', { user: val('demoUser') }),
  demoCustomBtn: () => { const n = val('demoCustom'); if (n) call('demo.custom', { name: n, user: val('demoUser') }).then(r => r?.ignored && toast('No mapping for custom:' + n + ' — create one in the Reaction Editor')); },
  refreshCatalog: () => call('tiktok.refreshCatalog').then(r => toast(`Loaded ${r.count} gifts from TikTok`, 'ok')),
  toggleMap: async (el) => { const m = structuredClone(S.settings.mappings[el.dataset.key]); m.enabled = el.checked; await call('mappings.save', { key: el.dataset.key, mapping: m }); },
  toggleGroove: async (el) => {
    const key = 'gift:' + el.dataset.gkey;
    const g = S.catalog.gifts.find(x => x.key === el.dataset.gkey);
    const m = structuredClone(S.settings.mappings[key] || { ...blankMapping(`${g?.name || el.dataset.gkey} — SpongeBob groove`), overlap: 'parallel' });
    m.actions = m.actions.filter(a => a.type !== 'spongebob_groove');
    if (el.checked) m.actions.push({ type: 'spongebob_groove', params: {}, delay: 0, duration: null, intensity: 1 });
    await call('mappings.save', { key, mapping: m }, el.checked ? `SpongeBob's groove now triggers on ${g?.name}` : `Groove removed from ${g?.name}`);
  },
  previewKey: (el) => call('reaction.preview', { key: el.dataset.key }).then(r => r?.cooldown && toast('On cooldown — wait a moment')),
  editKey: (el) => { editorKey = el.dataset.key; editorDraft = null; $('[data-tab=editor]').click(); },
  edNewCustom: () => { const n = (val('edNewCustom') || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'); if (!n) return; editorKey = 'custom:' + n; editorDraft = blankMapping('Custom: ' + n); renderEditor(true); },
  edAdd: () => { syncDraft(); const t = val('edAddType'); editorDraft.actions.push({ type: t, params: structuredClone(S.options.ACTION_TYPES[t].params), delay: 0, duration: null, intensity: 1 }); keepDraft(); },
  edRemove: (b) => { syncDraft(); editorDraft.actions.splice(+b.dataset.i, 1); keepDraft(); },
  edMove: (b) => { syncDraft(); const i = +b.dataset.i, j = i + +b.dataset.d, A = editorDraft.actions; if (j < 0 || j >= A.length) return; [A[i], A[j]] = [A[j], A[i]]; keepDraft(); },
  edSave: () => call('mappings.save', { key: editorKey, mapping: syncDraft() }, 'Mapping saved'),
  edPreview: async () => { await call('mappings.save', { key: editorKey, mapping: syncDraft() }); await call('reaction.preview', { key: editorKey }); },
  edRevert: () => { editorDraft = null; renderEditor(true); },
  edDelete: async () => { if (!confirm(`Delete mapping ${editorKey}?`)) return; await call('mappings.delete', { key: editorKey }, 'Mapping deleted'); editorKey = 'gift:rose'; editorDraft = null; renderEditor(true); },
  presetSave: () => { const n = val('presetName'); if (n) call('presets.save', { name: n }, 'Preset saved').then(() => renderEditor(true)); },
  presetRestore: async () => { const n = val('presetSel'); if (!confirm(`Replace all mappings with "${n}"?`)) return; await call('presets.restore', { name: n }, 'Preset restored'); editorDraft = null; setTimeout(() => renderEditor(true), 200); },
  selApp: (el, e) => { e.preventDefault(); selectedApp = el.dataset.id; renderHiring(); },
  reviewNow: () => call('hiring.reviewNow'),
  returnToQueue: () => call('hiring.returnToQueue'),
  qMove: (b) => call('hiring.move', { id: b.dataset.id, dir: b.dataset.dir }),
  qRemove: (b) => call('hiring.remove', { id: b.dataset.id }),
  qForce: (b) => call('hiring.forceQueued', { id: b.dataset.id }),
  decide: (b) => call('hiring.decide', { decision: b.dataset.d, id: S.hiring.current?.id || selectedApp || S.hiring.queue[0]?.id }),
  stampTest: (b) => call('hiring.stampTest', { decision: b.dataset.d }),
  animTest: (el) => call('scene.test', { target: el.dataset.t, anim: el.dataset.a }),
  showPreview: (b) => { const slot = b.closest('.preview-slot'); slot.dataset.on = '1'; mountPreview(); },
  banterNow: () => call('banter.now'),
  hookNow: () => call('hook.now'),
  statsReset: () => { if (confirm('Reset the gift goal and Top Tipper?')) call('stats.reset', {}, 'Gift stats reset'); },
  voiceTest: () => call('voice.test', { character: val('vtChar'), text: val('vtText') }),
  sceneSave: (_b, _e, quiet) => {
    const n = (id) => +val(id);
    const patch = { scene: { showKrabs: $('#vK').checked, showSpongebob: $('#vS').checked, showSquidward: $('#vQ').checked, quality: val('quality'), brightness: n('bright'),
      camera: { preset: val('camPreset'), fov: n('camFov'), x: n('camX'), y: n('camY'), z: n('camZ') },
      layout: { desk: { x: n('dX'), z: n('dZ'), rot: 0 }, spongebob: { x: n('sX'), z: n('sZ'), rot: 0 }, squidward: { x: n('qX'), z: n('qZ'), rot: 0 } } } };
    return call('settings.update', { patch }, quiet ? null : 'Scene saved');
  },
  copyUrl: () => { navigator.clipboard.writeText(location.origin + '/overlay.html'); toast('Overlay URL copied', 'ok'); },
  setSecret: (b) => { const v2 = val(b.dataset.input); if (!v2) return toast('Paste the key first', 'err'); call('secrets.set', { name: b.dataset.name, value: v2 }, 'Key saved locally').then(() => { $('#' + b.dataset.input).value = ''; formsRendered.delete('settings'); }); },
  saveSettings: () => {
    const patch = {};
    for (const inp of $$('#tab-settings [data-path]')) {
      const path = inp.dataset.path.split('.'); let o = patch;
      path.slice(0, -1).forEach(k => { o = o[k] ||= {}; });
      o[path.at(-1)] = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? +inp.value : inp.value;
    }
    call('settings.update', { patch }, 'Settings saved');
  },
};
function keepDraft() { renderEditor(true); }
