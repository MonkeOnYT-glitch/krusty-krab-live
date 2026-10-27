// Pooled GPU particle systems. Every kind has a fixed-capacity buffer (scaled by quality),
// so a flood of gifts recycles particles instead of allocating more.
import * as THREE from 'three';

function sprite(draw, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const SPRITES = {
  petal: () => sprite((g, s) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(s / 2, s / 2, s * 0.22, s * 0.4, 0.6, 0, Math.PI * 2); g.fill(); }),
  square: () => sprite((g, s) => { g.fillStyle = '#fff'; g.fillRect(s * 0.2, s * 0.32, s * 0.6, s * 0.36); }),
  coin: () => sprite((g, s) => { g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, 7); g.fill(); g.strokeStyle = '#b8860b'; g.lineWidth = s * 0.07; g.stroke(); g.fillStyle = '#b8860b'; g.font = `bold ${s * 0.5}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', s / 2, s / 2 + 2); }),
  bubble: () => sprite((g, s) => { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = s * 0.06; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, 7); g.stroke(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(s * 0.38, s * 0.36, s * 0.08, 0, 7); g.fill(); }),
  glow: () => sprite((g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }),
  smoke: () => sprite((g, s) => { for (let i = 0; i < 6; i++) { const x = s * (0.3 + Math.random() * 0.4), y = s * (0.3 + Math.random() * 0.4), r = g.createRadialGradient(x, y, 0, x, y, s * 0.3); r.addColorStop(0, 'rgba(255,255,255,0.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); } }, 128),
  note: () => sprite((g, s) => { g.fillStyle = '#fff'; g.font = `bold ${s * 0.8}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', s / 2, s / 2); }),
};

const KINDS = {
  petals: { sprite: 'petal', cap: 260, size: 0.09, colors: [0xff2a55, 0xff5c7a, 0xd90429], gravity: -0.35, drag: 0.6, life: [3, 5], spin: true, blend: 'normal' },
  confetti: { sprite: 'square', cap: 500, size: 0.06, colors: [0xff3b30, 0xffcc00, 0x34c759, 0x0a84ff, 0xff2d95, 0xaf52de], gravity: -0.5, drag: 0.8, life: [3, 5], blend: 'normal' },
  coins: { sprite: 'coin', cap: 220, size: 0.1, colors: [0xffffff], gravity: -1.6, drag: 0.2, life: [2, 3], blend: 'normal' },
  bubbles: { sprite: 'bubble', cap: 220, size: 0.08, colors: [0xbfe9ff], gravity: 0.35, drag: 0.5, life: [3, 6], blend: 'normal' },
  sparks: { sprite: 'glow', cap: 600, size: 0.12, colors: [0xffe08a, 0xffa040, 0xffffff], gravity: -1.2, drag: 1.2, life: [0.8, 2], blend: 'add' },
  ink: { sprite: 'glow', cap: 120, size: 0.04, colors: [0xffffff], gravity: -2, drag: 2, life: [0.3, 0.7], blend: 'normal' },
  debris: { sprite: 'square', cap: 300, size: 0.08, colors: [0x6b4a2b, 0x3b2a1a, 0xc9a26b], gravity: -3, drag: 0.4, life: [1.5, 3], blend: 'normal' },
  smoke: { sprite: 'smoke', cap: 120, size: 1.4, colors: [0x2b2522, 0x4a403a], gravity: 0.25, drag: 0.3, life: [3, 6], blend: 'normal', opacity: 0.55 },
  notes: { sprite: 'note', cap: 80, size: 0.11, colors: [0xffe14d, 0x7cf2ff, 0xff8be0], gravity: 0.25, drag: 0.5, life: [1.5, 2.5], blend: 'normal' },
};

const VERT = `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC;
void main(){ vA=alpha; vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(900.0/-mv.z); gl_Position=projectionMatrix*mv; }`;
const FRAG = `uniform sampler2D map; uniform float opacity; varying float vA; varying vec3 vC;
void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*t.rgb, t.a*vA*opacity); if(gl_FragColor.a<0.01) discard; }`;

class System {
  constructor(scene, kind, def, scale) {
    this.def = def; this.cap = Math.max(20, Math.floor(def.cap * scale));
    const n = this.cap;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.alpha = new Float32Array(n); this.life = new Float32Array(n); this.age = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({ uniforms: { map: { value: SPRITES[def.sprite]() }, opacity: { value: def.opacity ?? 1 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: def.blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points); this.cursor = 0; this.alive = 0;
  }
  spawn(p, v, color) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    const d = this.def, c = new THREE.Color(color ?? d.colors[Math.floor(Math.random() * d.colors.length)]);
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.col.set([c.r, c.g, c.b], i * 3);
    this.size[i] = d.size * (0.7 + Math.random() * 0.6); this.alpha[i] = 1;
    this.life[i] = d.life[0] + Math.random() * (d.life[1] - d.life[0]); this.age[i] = 0;
  }
  update(dt, t) {
    const d = this.def; let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      alive++;
      this.age[i] += dt; const k = this.age[i] / this.life[i], j = i * 3;
      this.vel[j + 1] += d.gravity * dt;
      const dr = Math.exp(-d.drag * dt); this.vel[j] *= dr; this.vel[j + 2] *= dr; if (d.gravity < 0) this.vel[j + 1] = Math.max(this.vel[j + 1], -2.5 * Math.abs(d.gravity) - 0.2);
      if (d.spin || d.sprite === 'square') { this.vel[j] += Math.sin(t * 3 + i) * 0.3 * dt; this.vel[j + 2] += Math.cos(t * 2.3 + i) * 0.3 * dt; }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < -0.78 && d.gravity < 0) { this.pos[j + 1] = -0.78; this.vel[j] = this.vel[j + 1] = this.vel[j + 2] = 0; }
      this.alpha[i] = k < 0.1 ? k / 0.1 : k > 0.75 ? (1 - k) / 0.25 : 1;
      if (d.sprite === 'smoke') this.size[i] += dt * 0.5;
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = g.attributes.alpha.needsUpdate = g.attributes.size.needsUpdate = g.attributes.color.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, quality = 'high') { this.scene = scene; this.systems = {}; this.streams = []; this.t = 0; this.setQuality(quality); }
  setQuality(q) { this.scale = { low: 0.35, medium: 0.65, high: 1 }[q] ?? 1; }
  sys(kind) {
    if (!this.systems[kind]) this.systems[kind] = new System(this.scene, kind, KINDS[kind], this.scale);
    return this.systems[kind];
  }
  /** Ambient emission inside the restaurant volume visible from the desk camera. */
  emit(kind, n = 10, at = null) {
    if (!KINDS[kind]) return;
    const s = this.sys(kind), V = THREE.Vector3;
    for (let i = 0; i < n; i++) {
      let p, v;
      if (at) { p = at.clone().add(new V((Math.random() - 0.5) * 0.3, Math.random() * 0.3, (Math.random() - 0.5) * 0.3)); v = new V((Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * 0.3); }
      else if (kind === 'bubbles') { p = new V(-1 + Math.random() * 4, -0.8, (Math.random() - 0.5) * 3); v = new V(0, 0.2 + Math.random() * 0.4, 0); }
      else if (kind === 'smoke') { p = new V(-2 + Math.random() * 4.5, -0.6 + Math.random() * 1.5, (Math.random() - 0.5) * 4); v = new V((Math.random() - 0.5) * 0.1, 0.05, (Math.random() - 0.5) * 0.1); }
      else if (kind === 'notes') { p = new V(-0.35 + (Math.random() - 0.5) * 0.4, 0.1 + Math.random() * 0.3, 0.9 + (Math.random() - 0.5) * 0.4); v = new V((Math.random() - 0.5) * 0.2, 0.3, (Math.random() - 0.5) * 0.2); }
      else { p = new V(0.2 + Math.random() * 3.0, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 2.4); v = new V((Math.random() - 0.5) * 0.4, -0.1 - Math.random() * 0.3, (Math.random() - 0.5) * 0.4); }
      s.spawn(p, v);
    }
  }
  burst(kind, pos, color, n = 50) {
    const s = this.sys(kind); n = Math.floor(n * this.scale);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize();
      const sp = kind === 'ink' ? 0.6 + Math.random() * 0.8 : 2 + Math.random() * 5;
      s.spawn(pos, dir.multiplyScalar(sp), kind === 'ink' ? color : undefined);
    }
  }
  /** Continuous emission for `duration` seconds; rate scales with intensity and quality. */
  stream(kind, duration, intensity = 1) { this.streams.push({ kind, until: this.t + duration, rate: 40 * intensity * this.scale, acc: 0 }); if (this.streams.length > 8) this.streams.shift(); }
  update(dt) {
    this.t += dt;
    this.streams = this.streams.filter(s => this.t < s.until);
    for (const s of this.streams) { s.acc += s.rate * dt; const n = Math.floor(s.acc); if (n) { s.acc -= n; this.emit(s.kind, n); } }
    for (const s of Object.values(this.systems)) s.update(dt, this.t);
  }
}
