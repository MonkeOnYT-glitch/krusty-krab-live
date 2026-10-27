// The Krusty Krab 3D stage: environment, hiring desk props, characters, lights, camera and effects.
// One instance per page; it is built once and only mutated by commands (never reloaded per event).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Character, RIGS, KRABS_ANIMS, SPONGE_ANIMS, SQUID_ANIMS } from './characters.js';
import { Particles } from './fx.js';

const t_now = () => performance.now() / 1000;
const DECISION_STYLE = {
  'ACCEPTED': { color: '#16a34a', ink: 0x16a34a },
  'DENIED': { color: '#dc2626', ink: 0xdc2626 },
  'CALL YOU LATER': { color: '#eab308', ink: 0xeab308 },
};
// World layout (metres). +x points out the front door; the register boat sits against the back wall at x≈-1.4.
const FLOOR_Y = -0.79;
export const LAYOUT = {
  desk: new THREE.Vector3(1.45, FLOOR_Y, 0),
  krabs: new THREE.Vector3(0.98, FLOOR_Y, 0),
  spongebob: new THREE.Vector3(-0.35, FLOOR_Y, 0.9),
  squidward: new THREE.Vector3(-1.75, FLOOR_Y + 0.12, -0.35),
};
const CAMERAS = {
  desk: { pos: [3.24, 0.32, 0.02], look: [0.2, -0.12, 0.05], fov: 58 },
  wide: { pos: [3.3, 1.3, 0.1], look: [-1.5, -0.15, 0.35], fov: 70 },
  krabs_close: { pos: [2.55, 0.45, 0.0], look: [1.2, 0.2, 0.0], fov: 50 },
  spongebob: { pos: [1.4, 0.2, 0.85], look: [-0.35, -0.3, 0.9], fov: 50 },
  paper: { pos: [2.45, 0.27, 0.0], look: [1.25, 0.2, 0.0], fov: 40 },
  dramatic: { pos: [3.1, -0.35, -0.45], look: [-1.6, 0.35, 0.1], fov: 66 },
};

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData = { canvas: c, ctx: g };
  return t;
}
function woodTex(base = '#8b5a2b', dark = '#5e3a1a') {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { g.strokeStyle = `rgba(60,30,10,${0.08 + Math.random() * 0.15})`; g.lineWidth = 1 + Math.random() * 3; g.beginPath(); const y = Math.random() * h; g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2); g.stroke(); }
    g.fillStyle = dark; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
  });
}

export class Stage {
  constructor(canvas, { quality = 'high', onProgress = () => {} } = {}) {
    this.canvas = canvas; this.onProgress = onProgress;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0x2a6f97, 18, 60);
    this.camera = new THREE.PerspectiveCamera(55, 9 / 16, 0.05, 200);
    this.camState = { shot: 'desk', until: 0, from: null, t0: 0, cur: { pos: new THREE.Vector3(...CAMERAS.desk.pos), look: new THREE.Vector3(...CAMERAS.desk.look), fov: 55 } };
    this.camOffset = new THREE.Vector3();
    this.shake = 0; this.lightMode = 'normal'; this.lightUntil = 0; this.brightness = 1;
    this.chars = {}; this.paper = null; this.clock = new THREE.Clock();
    this.nuke = null; this.dance = null;
    this.setQuality(quality);
    this.buildLights();
    this.particles = new Particles(this.scene, quality);
    this.buildDesk();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const pr = { low: 0.6, medium: 0.85, high: 1 }[q] ?? 1;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * pr);
    this.renderer.shadowMap.enabled = false; // shadow maps produced smeared character shadows on the walls
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.key) { this.key.castShadow = false; this.key.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024); this.key.shadow.map?.dispose(); this.key.shadow.map = null; }
    this.particles?.setQuality(q);
    this.resize();
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    // Render at true 9:16 inside the container (letterboxed by CSS).
    let w = r.width, h = r.height; if (w / h > 9 / 16) w = h * 9 / 16; else h = w * 16 / 9;
    this.renderer.setSize(Math.round(w), Math.round(h), true);
    this.camera.aspect = 9 / 16; this.camera.updateProjectionMatrix();
  }

  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6b4a2b, 1.4); s.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.key.position.set(6, 6, 2.5); this.key.target.position.set(0, -0.5, 0);
    this.key.castShadow = false; this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.02;
    Object.assign(this.key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
    s.add(this.key, this.key.target);
    this.warm = [];
    for (const [x, z] of [[1.2, 2.5], [1.2, -2.5], [-0.8, 0], [2.3, 0]]) { const p = new THREE.PointLight(0xffc27a, 3.0, 6, 1.6); p.position.set(x, 1.7, z); s.add(p); this.warm.push(p); }
    this.deskLamp = new THREE.SpotLight(0xfff4e0, 14, 5, 0.55, 0.6, 1.5); this.deskLamp.position.set(2.7, 1.6, 0.3); this.deskLamp.target.position.set(1.6, -0.2, 0); s.add(this.deskLamp, this.deskLamp.target);
    // party rig (off until needed)
    this.party = [0xff2d95, 0x2de2ff, 0xffe62d, 0x7c3aed].map((c, i) => { const l = new THREE.SpotLight(c, 0, 9, 0.5, 0.5, 1); l.position.set(1, 2.2, 0); s.add(l, l.target); return l; });
    this.alarm = new THREE.PointLight(0xff2020, 0, 12, 1.2); this.alarm.position.set(0.5, 1.8, 0); this.alarm.visible = false; s.add(this.alarm);
    this.blast = new THREE.PointLight(0xffa040, 0, 40, 1.2); this.blast.position.set(-1.5, 0.8, 0); this.blast.visible = false; s.add(this.blast);
  }

  buildDesk() {
    const g = new THREE.Group(); g.name = 'HiringDesk';
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ map: woodTex('#6b4220', '#3b2410'), roughness: 0.8 });
    const W = 1.25, D = 0.55, H = 0.5;
    const top = new THREE.Mesh(new THREE.BoxGeometry(D, 0.05, W), wood); top.position.y = H; g.add(top);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.04, H - 0.05, W - 0.04), dark); front.position.set(D / 2 - 0.03, (H - 0.05) / 2, 0); g.add(front);
    for (const z of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(D - 0.04, H - 0.05, 0.04), dark); side.position.set(0, (H - 0.05) / 2, z * (W / 2 - 0.03)); g.add(side); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.25), new THREE.MeshStandardMaterial({ map: canvasTex(768, 256, (c, w, h) => {
      c.fillStyle = '#f4e1b0'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7a4a1e'; c.lineWidth = 14; c.strokeRect(10, 10, w - 20, h - 20);
      c.fillStyle = '#b91c1c'; c.font = 'bold 96px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('NOW HIRING', w / 2, h / 2 + 6);
    }), roughness: 0.6 }));
    sign.position.set(D / 2 + 0.002, H * 0.55, 0); sign.rotation.y = Math.PI / 2; g.add(sign);
    // paper stack (inbox) and outbox tray
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e1, roughness: 0.9 });
    const tray = (z) => { const t = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.035, 0.22), dark); t.position.set(-0.05, H + 0.04, z); g.add(t); return t; };
    tray(-0.45); tray(0.45);
    for (let i = 0; i < 9; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.004, 0.19), paperMat); p.position.set(-0.05 + (Math.random() - 0.5) * 0.01, H + 0.06 + i * 0.005, -0.45 + (Math.random() - 0.5) * 0.01); p.rotation.y = (Math.random() - 0.5) * 0.1; g.add(p); }
    this.outbox = []; this.outboxBase = new THREE.Vector3(-0.05, H + 0.06, 0.45);
    // ink pad
    const pad = new THREE.Group();
    pad.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.11), new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.5, roughness: 0.4 })));
    const ink = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.006, 0.085), new THREE.MeshStandardMaterial({ color: 0x3b0d0d, roughness: 0.3 })); ink.position.y = 0.014; pad.add(ink);
    pad.position.set(0.12, H + 0.04, 0.33); g.add(pad); this.inkPad = pad;
    // the big decision stamp
    const stamp = new THREE.Group();
    const brass = new THREE.MeshStandardMaterial({ color: 0xb8860b, metalness: 0.8, roughness: 0.3 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.16, 16), new THREE.MeshStandardMaterial({ map: woodTex('#7a1f1f', '#4a1010'), roughness: 0.5 })); handle.position.y = 0.12; stamp.add(handle);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 16), handle.material); knob.position.y = 0.22; stamp.add(knob);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.05, 0.12), brass); block.position.y = 0.025; stamp.add(block);
    this.stampFace = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.11), new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 })); this.stampFace.position.y = -0.002; stamp.add(this.stampFace);
    stamp.traverse(m => { if (m.isMesh) m.castShadow = true; });
    this.stampRest = new THREE.Vector3(0.12, H + 0.06, 0.33); stamp.position.copy(this.stampRest);
    g.add(stamp); this.stamp = stamp;
    g.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.deskTopY = H + 0.025; this.desk = g;
    this.scene.add(g);
  }

  // --- application paper -----------------------------------------------------------------
  drawPaper(tex, p, stamp = null) {
    if (stamp && p.assigned === undefined) p.assigned = '';
    const { canvas: c, ctx: g } = tex.userData, w = c.width, h = c.height;
    g.fillStyle = '#fbf6e6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a1f1f'; g.fillRect(0, 0, w, 70);
    g.fillStyle = '#fff'; g.font = 'bold 34px Georgia'; g.textAlign = 'center'; g.fillText('KRUSTY KRAB', w / 2, 46);
    g.fillStyle = '#222'; g.font = 'bold 24px Georgia'; g.fillText('EMPLOYMENT APPLICATION', w / 2, 108);
    g.textAlign = 'left'; g.font = '22px Georgia';
    const line = (label, val, y) => { g.fillStyle = '#7a4a1e'; g.font = 'bold 20px Georgia'; g.fillText(label, 30, y); g.fillStyle = '#111'; g.font = '24px "Comic Sans MS", cursive'; wrap(String(val || '—'), 30, y + 30, w - 60, 28, 2); g.strokeStyle = '#cbb98a'; g.beginPath(); g.moveTo(30, y + 40); g.lineTo(w - 30, y + 40); g.stroke(); };
    const wrap = (t, x, y, mw, lh, max) => { const words = t.split(' '); let ln = '', n = 0; for (const wd of words) { if (g.measureText(ln + wd).width > mw && ln) { g.fillText(ln, x, y + n * lh); ln = ''; if (++n >= max) return; } ln += wd + ' '; } g.fillText(ln, x, y + n * lh); };
    line('NAME', p.name, 150); line('WHY I WANT TO WORK HERE', p.pitch || p.experience, 240); line('SKILLS', p.experience && p.pitch ? p.experience : '', 330); line('POSITION', p.assigned || (p.role ? `Requested: ${p.role}` : 'Mr. Krabs decides'), 420);
    g.fillStyle = '#555'; g.font = '18px monospace'; g.fillText('@' + p.user + (p.source === 'demo' ? '  [DEMO]' : ''), 30, h - 24);
    if (p.priority > 0) { g.fillStyle = '#e11d48'; g.font = 'bold 22px Georgia'; g.textAlign = 'right'; g.fillText('★ PRIORITY ' + p.priority, w - 30, h - 24); }
    if (stamp) {
      const s = DECISION_STYLE[stamp];
      g.save(); g.translate(w / 2, h * 0.55); g.rotate(-0.22); g.globalAlpha = 0.88;
      g.strokeStyle = s.color; g.lineWidth = 10; g.font = `bold ${stamp.length > 8 ? 52 : 78}px Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tw = g.measureText(stamp).width + 50; g.strokeRect(-tw / 2, -58, tw, 116); g.lineWidth = 3; g.strokeRect(-tw / 2 + 10, -48, tw - 20, 96);
      g.fillStyle = s.color; g.fillText(stamp, 0, 4);
      // ink speckle for a physical look
      g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 260; i++) { g.globalAlpha = Math.random() * 0.6; g.fillRect((Math.random() - 0.5) * tw, (Math.random() - 0.5) * 116, 2 + Math.random() * 4, 2 + Math.random() * 4); }
      g.restore();
    }
    tex.needsUpdate = true;
  }
  paperCmd(action, p) {
    const deskWorld = this.desk.position;
    if (action === 'pickup') {
      if (this.paper) { this.scene.remove(this.paper.mesh); this.paper.mesh.material.map.dispose(); this.paper.mesh.material.dispose(); }
      const tex = canvasTex(512, 680, () => {});
      this.drawPaper(tex, p);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.paper = { mesh, tex, data: p, phase: 'pickup', t0: this.time, from: deskWorld.clone().add(new THREE.Vector3(-0.05, this.deskTopY + 0.06, -0.45)) };
    } else if (this.paper) {
      this.paper.phase = action; this.paper.t0 = this.time;
      this.paper.fromPos = this.paper.mesh.position.clone(); this.paper.fromQuat = this.paper.mesh.quaternion.clone();
    }
  }
  updatePaper(t) {
    const P = this.paper; if (!P) return;
    const m = P.mesh, lt = t - P.t0, d = this.desk.position;
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)); // lying on desk, text toward camera
    const held = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)); // held up, facing camera
    const onDesk = new THREE.Vector3(d.x + 0.02, d.y + this.deskTopY + 0.004, d.z - 0.05);
    const inHands = new THREE.Vector3(d.x - 0.2, d.y + this.deskTopY + 0.38, d.z);
    if (P.phase === 'pickup') {
      const k = Math.min(1, lt / 1.2), e = k * k * (3 - 2 * k);
      m.position.lerpVectors(P.from, inHands, e); m.position.y += Math.sin(e * Math.PI) * 0.15;
      m.quaternion.copy(flat).slerp(held, e);
    } else if (P.phase === 'inspect') {
      m.position.copy(inHands).add(new THREE.Vector3(0, Math.sin(t * 2) * 0.015, Math.sin(t * 1.3) * 0.03));
      m.quaternion.copy(held).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.sin(t * 1.7) * 0.06)));
    } else if (P.phase === 'lay') {
      const k = Math.min(1, lt / 0.4);
      m.position.lerpVectors(P.fromPos, onDesk, k); m.quaternion.copy(P.fromQuat).slerp(flat, k);
    } else if (P.phase === 'file') {
      const k = Math.min(1, lt / 0.9), dest = d.clone().add(this.outboxBase).add(new THREE.Vector3(0, this.outbox.length * 0.004, 0));
      m.position.lerpVectors(P.fromPos, dest, k); m.position.y += Math.sin(k * Math.PI) * 0.12;
      m.quaternion.copy(P.fromQuat).slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2 + 0.1)), k);
      m.scale.setScalar(1 - k * 0.15);
      if (k >= 1) {
        // keep a few filed papers as set dressing; dispose older ones
        this.outbox.push(m); if (this.outbox.length > 6) { const old = this.outbox.shift(); this.scene.remove(old); old.material.map.dispose(); old.material.dispose(); old.geometry.dispose(); }
        this.paper = null;
      }
    }
  }

  // --- stamping ----------------------------------------------------------------------------
  stampCmd(decision, position = '') {
    if (this.paper && position) this.paper.data.assigned = position;
    const style = DECISION_STYLE[decision]; if (!style) return;
    if (this.paper && this.paper.phase !== 'lay') this.paperCmd('lay');
    this.stampFace.material.color.setHex(style.ink);
    this.inkPad.children[1].material.color.setHex(style.ink).multiplyScalar(0.6);
    this.stampAnim = { t0: this.time, decision, hit: false };
    this.chars.krabs?.play('stamp', 1.6);
  }
  updateStamp(t) {
    const S = this.stampAnim; if (!S) return;
    const lt = t - S.t0, d = this.desk.position, st = this.stamp;
    const rest = this.stampRest, ink = this.stampRest.clone().add(new THREE.Vector3(0, 0.01, 0));
    const target = new THREE.Vector3(0.02, this.deskTopY + 0.006, -0.05);
    const above = target.clone().add(new THREE.Vector3(-0.05, 0.42, 0));
    const lerp = (a, b, k) => st.position.lerpVectors(a, b, Math.max(0, Math.min(1, k)));
    if (lt < 0.25) lerp(rest, ink.clone().add(new THREE.Vector3(0, 0.12, 0)), lt / 0.25);
    else if (lt < 0.35) lerp(ink.clone().add(new THREE.Vector3(0, 0.12, 0)), ink, (lt - 0.25) / 0.1); // ink up
    else if (lt < 0.8) lerp(ink, above, (lt - 0.35) / 0.45);
    else if (lt < 0.92) { lerp(above, target, ((lt - 0.8) / 0.12) ** 2); }
    else if (lt < 1.3) {
      st.position.copy(target);
      if (!S.hit) {
        S.hit = true; this.shake = Math.max(this.shake, 0.35);
        this.audio?.sfx('stamp', 1.2);
        if (this.paper) this.drawPaper(this.paper.tex, this.paper.data, S.decision);
        this.particles.burst('ink', d.clone().add(target), DECISION_STYLE[S.decision].ink, 40);
      }
    } else if (lt < 1.8) lerp(target, rest, (lt - 1.3) / 0.5);
    else { st.position.copy(rest); this.stampAnim = null; }
    st.rotation.z = lt > 0.35 && lt < 1.3 ? -0.15 * Math.sin(Math.min(1, (lt - 0.35) / 0.45) * Math.PI) : 0;
  }

  // --- loading -------------------------------------------------------------------------------
  async load(models) {
    const loader = new GLTFLoader();
    const get = (url, label) => new Promise((res, rej) => loader.load(url, res, (e) => this.onProgress(label, e.total ? e.loaded / e.total : 0), (err) => rej(new Error(`${label}: ${err.message || err}`))));
    const errors = [];
    const [envG, kG, sG, qG] = await Promise.all([
      get(models.environment, 'Krusty Krab').catch(e => { errors.push(e.message); return null; }),
      get(models.krabs, 'Mr. Krabs').catch(e => { errors.push(e.message); return null; }),
      get(models.spongebob, 'SpongeBob').catch(e => { errors.push(e.message); return null; }),
      get(models.squidward, 'Squidward').catch(e => { errors.push(e.message); return null; }),
    ]);
    if (envG) {
      const e = envG.scene; e.name = 'KrustyKrab';
      e.traverse(o => {
        if (!o.isMesh) return;
        const big = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).length();
        o.receiveShadow = true; o.castShadow = big < 4 && big > 0.15;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        // Physical (clearcoat/transmission/sheen) shaders are much heavier than needed for a stream: downgrade.
        const cheap = mats.map(m => {
          let n = m;
          if (m.isMeshPhysicalMaterial) {
            n = new THREE.MeshStandardMaterial({ name: m.name, color: m.color, map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap,
              roughness: m.roughness, metalness: Math.min(m.metalness, 0.6), emissive: m.emissive, emissiveMap: m.emissiveMap, alphaMap: m.alphaMap,
              transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest, vertexColors: m.vertexColors });
            m.dispose();
          }
          if (/glass|vitre/i.test(n.name + o.name)) { n.transparent = true; n.opacity = 0.18; n.depthWrite = false; }
          if (n.map) n.map.anisotropy = 4;
          return n;
        });
        o.material = Array.isArray(o.material) ? cheap : cheap[0];
        o.matrixAutoUpdate = false; o.updateMatrix();
      });
      this.scene.add(e); this.env = e;
    } else {
      // Labeled fallback: a plain room so the rest of the app still works if the model is missing.
      const room = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 12), new THREE.MeshStandardMaterial({ color: 0x8b5a2b, side: THREE.BackSide }));
      room.position.set(0.4, FLOOR_Y + 2, 0); this.scene.add(room);
    }
    this.desk.position.copy(LAYOUT.desk);
    const add = (name, gltf, rig) => {
      if (!gltf) return;
      const c = new Character(name, gltf.scene, rig);
      c.root.position.copy(LAYOUT[name]);
      this.scene.add(c.root); this.chars[name] = c;
    };
    add('krabs', kG, RIGS.krabs); add('spongebob', sG, RIGS.spongebob); add('squidward', qG, RIGS.squidward);
    if (this.chars.spongebob) this.chars.spongebob.facing = -0.5; // idle: half-turned toward the register, working
    if (this.chars.squidward) this.chars.squidward.root.rotation.y = 0.15;
    return errors;
  }

  applySettings(sc) {
    if (!sc) return;
    if (sc.quality && sc.quality !== this.quality) this.setQuality(sc.quality);
    const vis = { krabs: sc.showKrabs, spongebob: sc.showSpongebob, squidward: sc.showSquidward };
    for (const [k, v] of Object.entries(vis)) if (this.chars[k]) this.chars[k].root.visible = v !== false;
    this.brightness = sc.brightness ?? 1;
    const L = sc.layout || {};
    const off = (o, base, l) => { if (!o || !l) return; o.position.set(base.x + (l.x || 0), base.y, base.z + (l.z || 0)); };
    off(this.desk, LAYOUT.desk, L.desk); if (L.desk) this.desk.rotation.y = (L.desk.rot || 0);
    if (this.chars.krabs && L.desk) off(this.chars.krabs.root, LAYOUT.krabs, L.desk);
    off(this.chars.spongebob?.root, LAYOUT.spongebob, L.spongebob);
    off(this.chars.squidward?.root, LAYOUT.squidward, L.squidward);
    const cam = sc.camera || {};
    this.baseShot = cam.preset || 'desk';
    this.camOffset.set(cam.x || 0, cam.y || 0, cam.z || 0);
    this.fovOverride = cam.fov;
    if (performance.now() / 1000 > this.camState.until) this.setShot(this.baseShot, 0);
  }

  setShot(shot, duration = 0, blend = 1.0) {
    if (!CAMERAS[shot]) return;
    const cs = this.camState;
    cs.from = { pos: cs.cur.pos.clone(), look: cs.cur.look.clone(), fov: cs.cur.fov };
    cs.shot = shot; cs.t0 = this.time || 0; cs.blend = blend;
    cs.until = duration ? performance.now() / 1000 + duration : 0;
  }
  updateCamera(t, dt) {
    const cs = this.camState;
    if (cs.until && performance.now() / 1000 > cs.until) { cs.until = 0; this.setShot(this.baseShot || 'desk', 0, 1.2); }
    const target = CAMERAS[cs.shot];
    const k = cs.from ? Math.min(1, (t - cs.t0) / cs.blend) : 1, e = k * k * (3 - 2 * k);
    const tp = new THREE.Vector3(...target.pos).add(cs.shot === (this.baseShot || 'desk') ? this.camOffset : new THREE.Vector3());
    const tl = new THREE.Vector3(...target.look);
    const fov = cs.shot === (this.baseShot || 'desk') && this.fovOverride ? this.fovOverride : target.fov;
    if (cs.from) { cs.cur.pos.lerpVectors(cs.from.pos, tp, e); cs.cur.look.lerpVectors(cs.from.look, tl, e); cs.cur.fov = cs.from.fov + (fov - cs.from.fov) * e; }
    else { cs.cur.pos.copy(tp); cs.cur.look.copy(tl); cs.cur.fov = fov; }
    this.camera.position.copy(cs.cur.pos);
    // subtle handheld drift keeps the stream alive
    this.camera.position.x += Math.sin(t * 0.31) * 0.01; this.camera.position.y += Math.sin(t * 0.43) * 0.008;
    if (this.shake > 0.001) {
      const s = this.shake * 0.08;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shake *= Math.pow(0.04, dt);
    }
    this.camera.lookAt(cs.cur.look);
    if (Math.abs(this.camera.fov - cs.cur.fov) > 0.01) { this.camera.fov = cs.cur.fov; this.camera.updateProjectionMatrix(); }
  }

  setLighting(mode, duration) { this.lightMode = mode; this.lightUntil = duration ? performance.now() / 1000 + duration : 0; }
  updateLights(t) {
    if (this.lightUntil && performance.now() / 1000 > this.lightUntil) { this.lightMode = 'normal'; this.lightUntil = 0; }
    const mode = this.nuke ? this.nuke.light : this.lightMode, B = this.brightness;
    const tgt = { hemi: 1.4, key: 2.4, warm: 3.0, party: 0, alarm: 0, lamp: 14 };
    if (mode === 'party') Object.assign(tgt, { hemi: 0.45, key: 0.5, warm: 0.6, party: 45, lamp: 4 });
    if (mode === 'dim') Object.assign(tgt, { hemi: 0.35, key: 0.4, warm: 0.8, lamp: 6 });
    if (mode === 'red_alert') Object.assign(tgt, { hemi: 0.35, key: 0.3, warm: 0.3, alarm: 18 * (0.5 + 0.5 * Math.sin(t * 9)), lamp: 2 });
    if (mode === 'golden') Object.assign(tgt, { hemi: 1.8, key: 3.2, warm: 5, lamp: 18 });
    if (mode === 'aftermath') Object.assign(tgt, { hemi: 0.6, key: 0.8, warm: 0.6, lamp: 4 });
    const lerp = (cur, to) => cur + (to - cur) * 0.08;
    this.hemi.intensity = lerp(this.hemi.intensity, tgt.hemi * B);
    this.key.intensity = lerp(this.key.intensity, tgt.key * B);
    for (const w of this.warm) w.intensity = lerp(w.intensity, tgt.warm * B * (0.95 + Math.sin(t * 3 + w.position.z) * 0.05));
    this.deskLamp.intensity = lerp(this.deskLamp.intensity, tgt.lamp * B);
    this.alarm.intensity = mode === 'red_alert' ? tgt.alarm : lerp(this.alarm.intensity, 0);
    this.alarm.visible = mode === 'red_alert' || this.alarm.intensity > 0.05;
    this.blast.visible = this.blast.intensity > 0.5;
    this.party.forEach((l, i) => {
      l.intensity = lerp(l.intensity, tgt.party);
      l.visible = l.intensity > 0.05;
      const a = t * (1.2 + i * 0.3) + i * Math.PI / 2;
      l.position.set(1.2 + Math.cos(a) * 0.8, 2.2, Math.sin(a) * 2);
      l.target.position.set(0.5 + Math.cos(a * 1.7) * 2, FLOOR_Y, Math.sin(a * 1.3) * 3);
    });
    this.scene.fog.color.setHex(mode === 'red_alert' ? 0x401010 : mode === 'aftermath' ? 0x3a3530 : 0x2a6f97);
  }

  // --- the Galaxy "nuke": the Krusty Krab blows apart, then a sped-up LEGO-style rebuild ----------
  // Timeline (D = duration): 0 warning+countdown · 3.4 boom, pieces fly · rebuild timelapse · D-2 back to clean.
  collectPieces() {
    if (this.pieces || !this.env) return;
    this.pieces = [];
    const box = new THREE.Box3(), size = new THREE.Vector3(), c = new THREE.Vector3();
    const list = [];
    this.env.traverse(o => { if (o.isMesh) list.push(o); });
    for (const o of list) {
      box.setFromObject(o); box.getSize(size); box.getCenter(c);
      const huge = size.length() > 20; // sky dome, sea floor
      const ground = size.y < 0.08 && box.min.y < FLOOR_Y + 0.15 && Math.max(size.x, size.z) > 3; // restaurant floor stays
      const outside = Math.abs(c.x) > 9 || Math.abs(c.z) > 9; // houses outside the windows
      if (huge || ground || outside) continue;
      this.scene.attach(o); // keep world transform, animate in world space
      this.pieces.push({ o, home: o.position.clone(), homeQ: o.quaternion.clone(), center: c.clone(), y: box.min.y, v: new THREE.Vector3(), w: new THREE.Vector3(), delay: 0 });
    }
    this.pieces.sort((a, b) => a.y - b.y || a.center.length() - b.center.length()); // build order: bottom up
  }
  startNuke(duration = 24, intensity = 1, hooks = {}) {
    if (this.nuke) { this.nuke.end = Math.max(this.nuke.end, this.time + duration); return; }
    this.collectPieces();
    const D = Math.max(16, duration);
    const n = { t0: this.time, dur: D, I: intensity, light: 'red_alert', stage: 'warn', hooks, objs: [],
      BOOM: 3.4, REBUILD: 3.4 + Math.min(6, (D - 3.4) * 0.3), DONE: D - 2.6 };
    const add = (o) => { o.visible = false; this.scene.add(o); n.objs.push(o); return o; };
    const glow = (color, op) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    n.origin = new THREE.Vector3(-0.6, FLOOR_Y + 0.6, 0);
    n.ball = add(new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), glow(0xffd27a, 0.95)));
    n.ring = add(new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64), Object.assign(glow(0xfff1c0, 0.9), { side: THREE.DoubleSide })));
    n.ring.rotation.x = -Math.PI / 2;
    n.stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 1, 24, 1, true), Object.assign(glow(0xff7a30, 0), { side: THREE.DoubleSide })));
    n.cap = add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), glow(0xff9a40, 0)));
    for (const o of n.objs) o.position.copy(n.origin);
    this.nuke = n;
    this.setShot('wide', 0, 1.5);
    hooks.onStage?.('warn', 0);
  }
  explodePieces(n) {
    for (const p of this.pieces || []) {
      const dir = p.center.clone().sub(n.origin); const dist = dir.length(); dir.normalize();
      p.delay = dist / 14; // shock front
      p.v.copy(dir.multiplyScalar((5 + Math.random() * 7) * n.I)).add(new THREE.Vector3(0, (3 + Math.random() * 6) * n.I, 0));
      p.w.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      p.landed = false;
    }
  }
  updatePieces(n, lt, dt) {
    if (!this.pieces) return;
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    if (n.stage === 'boom' || n.stage === 'aftermath') {
      const bt = lt - n.BOOM;
      for (const p of this.pieces) {
        if (bt < p.delay || p.landed) continue;
        p.v.y -= 6.5 * dt;
        p.o.position.addScaledVector(p.v, dt);
        e.set(p.w.x * dt, p.w.y * dt, p.w.z * dt); p.o.quaternion.multiply(q.setFromEuler(e));
        if (p.o.position.y < FLOOR_Y + 0.05) { p.o.position.y = FLOOR_Y + 0.05; p.v.y *= -0.25; p.v.x *= 0.6; p.v.z *= 0.6; p.w.multiplyScalar(0.5); if (Math.abs(p.v.y) < 0.3) p.landed = true; }
      }
    } else if (n.stage === 'rebuild') {
      // timelapse: pieces drop in from above in build order and "snap" into place
      const span = n.DONE - n.REBUILD - 0.6, N = this.pieces.length;
      let snapped = 0;
      this.pieces.forEach((p, i) => {
        const start = n.REBUILD + 0.4 + (i / N) * span, k = (lt - start) / 0.28;
        if (k <= 0) { p.o.visible = false; return; }
        p.o.visible = true;
        const kk = Math.min(1, k), bounce = kk < 1 ? Math.sin(kk * Math.PI) * 0.08 : 0;
        p.o.position.copy(p.home).add(new THREE.Vector3(0, (1 - kk) * (1 - kk) * 1.6 + bounce, 0));
        p.o.quaternion.copy(p.homeQ);
        if (k >= 1 && !p.snapped) { p.snapped = true; snapped++; }
      });
      if (snapped && t_now() - (this._lastSnap || 0) > 0.07) { this._lastSnap = t_now(); this.audio?.sfx('snap'); }
    }
  }
  restorePieces() {
    for (const p of this.pieces || []) { p.o.visible = true; p.o.position.copy(p.home); p.o.quaternion.copy(p.homeQ); p.snapped = false; p.landed = false; }
  }
  timelapseCrew(n, lt) {
    // sped-up workers: SpongeBob and Squidward zip around the site while it goes back up
    const crew = [this.chars.spongebob, this.chars.squidward].filter(Boolean);
    if (!n.lastHop || lt - n.lastHop > 0.22) {
      n.lastHop = lt;
      for (const c of crew) {
        c.root.position.set(-1.6 + Math.random() * 3.2, c.root.position.y, -2.5 + Math.random() * 5);
        c.root.rotation.y = Math.random() * Math.PI * 2;
        c.play(c === this.chars.spongebob ? (Math.random() < 0.5 ? 'flip' : 'cheer') : 'talk', 0.4);
      }
    }
  }
  updateNuke(t, dt) {
    const n = this.nuke; if (!n) return;
    const lt = t - n.t0;
    if (n.stage === 'warn' && lt >= n.BOOM) {
      n.stage = 'boom'; n.light = 'aftermath';
      this.shake = 1.6 * n.I; n.hooks.onStage?.('boom', lt);
      for (const o of n.objs) o.visible = true;
      this.blast.intensity = 400 * n.I;
      this.explodePieces(n);
      this.particles.burst('sparks', n.origin.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xffc040, 260 * n.I);
      this.particles.burst('debris', n.origin.clone().add(new THREE.Vector3(0, 0.3, 0)), 0x6b4a2b, 200 * n.I);
      this.setShot('dramatic', 0, 0.25);
    }
    if (n.stage === 'boom' || n.stage === 'aftermath') {
      const bt = lt - n.BOOM, k = Math.min(1, bt / 1.6);
      n.ball.scale.setScalar((0.2 + 5.5 * (1 - Math.pow(1 - k, 3))) * n.I * (1 - Math.min(1, bt / 4) * 0.4));
      n.ball.material.opacity = Math.max(0, 0.95 - bt * 0.22);
      n.ball.material.color.setHSL(0.1 - Math.min(0.08, bt * 0.03), 1, 0.7 - Math.min(0.35, bt * 0.1));
      n.ring.scale.setScalar(0.5 + bt * 9 * n.I); n.ring.position.y = FLOOR_Y + 0.05; n.ring.material.opacity = Math.max(0, 0.9 - bt * 0.4);
      const rise = Math.min(1, bt / 3);
      n.stem.material.opacity = Math.max(0, Math.min(0.8, bt * 0.6) - Math.max(0, bt - 3.5) * 0.3);
      n.stem.scale.set(1 + rise, 0.1 + rise * 6, 1 + rise); n.stem.position.set(n.origin.x, n.origin.y + rise * 3, n.origin.z);
      n.cap.material.opacity = n.stem.material.opacity; n.cap.scale.set(1.2 + rise * 2.2, 0.7 + rise * 1.2, 1.2 + rise * 2.2); n.cap.position.set(n.origin.x, n.origin.y + rise * 6.2, n.origin.z);
      this.blast.intensity *= Math.pow(0.25, dt);
      if (bt > 0.7 && n.stage === 'boom') { n.stage = 'aftermath'; this.setShot('wide', 0, 2.5); }
      if (bt < 2.5 && Math.random() < 0.3) this.shake = Math.max(this.shake, 0.4 * n.I);
      if (Math.random() < 0.2) this.particles.emit('smoke', 2);
      if (lt >= n.REBUILD) {
        n.stage = 'rebuild'; n.light = 'golden';
        for (const o of n.objs) o.visible = false;
        this.blast.intensity = 0;
        n.crewHome = [this.chars.spongebob, this.chars.squidward].filter(Boolean).map(c => [c, c.root.position.clone(), c.root.rotation.y]);
        this.setShot('wide', 0, 0.01);
        n.hooks.onStage?.('rebuild', lt);
      }
    }
    this.updatePieces(n, lt, dt);
    if (n.stage === 'rebuild') {
      this.timelapseCrew(n, lt);
      if (lt >= n.DONE) { n.stage = 'restore'; n.light = 'normal'; this.restorePieces(); this.resetCrew(n); n.hooks.onStage?.('restore', lt); }
    }
    if (lt >= n.dur) this.endNuke();
  }
  resetCrew(n) { for (const [c, pos, ry] of n.crewHome || []) { c.root.position.copy(pos); c.root.rotation.y = ry; } }
  endNuke() {
    const n = this.nuke; if (!n) return;
    for (const o of n.objs) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
    this.restorePieces(); this.resetCrew(n);
    this.blast.intensity = 0; this.nuke = null;
    this.setShot(this.baseShot || 'desk', 0, 1.2);
  }

  // --- SpongeBob dance ------------------------------------------------------------------------
  setSpongeDance(on, untilMs) {
    const sb = this.chars.spongebob; if (!sb) return;
    if (on) {
      const until = performance.now() / 1000 + Math.max(1, (untilMs - Date.now()) / 1000);
      if (sb.mode === 'dance') sb.modeUntil = until; else { sb.setMode('dance', until); }
      sb.facingTarget = 0;
      this.particles.emit('notes', 12);
    } else { sb.endMode(0.7); }
  }

  start() {
    const minFrame = 1000 / (Number(new URLSearchParams(location.search).get('fps')) || 60) - 1;
    let lastFrame = 0;
    const loop = (frameT) => {
      requestAnimationFrame(loop);
      if (frameT - lastFrame < minFrame) return; // don't render faster than the stream can use
      lastFrame = frameT;
      const dt = Math.min(0.05, this.clock.getDelta());
      this.time = (this.time || 0) + dt;
      const t = this.time;
      const sb = this.chars.spongebob;
      if (sb) { // ease SpongeBob between "working" (turned toward register) and facing camera
        const want = sb.mode === 'dance' || sb.actions.some(a => a.anim === 'notice' || a.anim === 'cheer' || a.anim === 'shocked' || a.anim === 'wave') || sb.talkingUntil > performance.now() / 1000 ? 0 : -0.5;
        sb.facing += (want - sb.facing) * Math.min(1, dt * 4);
      }
      const now = performance.now() / 1000;
      this.chars.krabs?.update(now, KRABS_ANIMS);
      sb?.update(now, SPONGE_ANIMS);
      this.chars.squidward?.update(now, SQUID_ANIMS);
      this.updatePaper(t); this.updateStamp(t);
      this.updateNuke(t, dt); this.updateLights(t); this.updateCamera(t, dt);
      this.particles.update(dt, this.camera);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }
}
