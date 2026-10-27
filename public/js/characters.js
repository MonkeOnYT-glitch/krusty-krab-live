// Procedural character animation on the real models' own skeletons / part hierarchies.
// Each rig maps semantic joints (armL, elbowR, head…) to model nodes and the local axis that
// produces a given motion; animations are written in semantic terms and layered with blend weights.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const env = (t, dur, fade = 0.45) => Math.min(ease(t / fade), ease((dur - t) / fade));
const blink = (t, every) => (Math.sin(t * TAU / every) > 0.97 ? 1 : 0);

// Motions are expressed in the character's own frame (model +z = forward, +y = up) and converted
// into each node's local frame, so the same animation code drives FBX part hierarchies and MMD skeletons.
// raise/spread rotate around the forward axis toward the joint's own side (detected from its rest position).
const MOTIONS = {
  raise: ['z', 1, true], spread: ['z', 1, true], swing: ['x', -1], bend: ['x', -1], kbend: ['x', 1],
  turn: ['y', 1], yaw: ['y', 1], twist: ['y', 1], nod: ['x', 1], lean: ['x', 1], tilt: ['z', 1], open: ['x', 1], wiggle: ['z', 1],
};

export const RIGS = {
  krabs: {
    height: 1.3, yaw: Math.PI / 2,
    joints: { root: 'Body', armL: 'Left_shoulder', armR: 'Right_shoulder', elbowL: 'Left_arm', elbowR: 'Right_arm', clawL: 'Left_claw', clawR: 'Right_claw', legL: 'Left_leg', legR: 'Right_leg', eyeL: 'Cylinder002', eyeR: 'Object002' },
  },
  spongebob: {
    height: 0.9, yaw: Math.PI / 2,
    joints: { root: 'センター', upper: '上半身', lower: '下半身', head: '頭', jaw: 'Jaw', armL: '腕.L', armR: '腕.R', elbowL: 'ひじ.L', elbowR: 'ひじ.R', legL: 'Left Leg Move', legR: 'Right Leg Move', kneeL: 'ひざ.L', kneeR: 'ひざ.R' },
  },
  squidward: {
    height: 1.35, yaw: Math.PI / 2,
    joints: { root: 'Body', head: 'Head', neck: 'Neck', armL: 'Left_shoulder', armR: 'Right_shoulder' },
  },
};

export class Character {
  constructor(name, object, rig) {
    this.name = name; this.object = object; this.rig = rig;
    this.root = new THREE.Group(); // positioned in world; object normalized inside
    this.root.add(object);
    this.joints = {};
    this.actions = []; this.layers = []; this.mode = null; this.modeStart = 0; this.modeUntil = 0;
    this.talkingUntil = 0; this.facing = 0; this.facingTarget = 0; this.hop = 0;
    this.normalize();
    this.bindJoints();
  }
  bindJoints() {
    const o = this.object; o.updateMatrixWorld(true);
    const objQ = o.getWorldQuaternion(new THREE.Quaternion()).invert();
    const objInv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    for (const [sem, name] of Object.entries(this.rig.joints)) {
      const node = o.getObjectByName(name) || o.getObjectByName(name.replace(/[.s]/g, ''));
      if (!node) continue;
      const P = objQ.clone().multiply(node.parent.getWorldQuaternion(new THREE.Quaternion())); // parent rest frame in model space
      const pos = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(objInv);
      this.joints[sem] = { node, rest: node.quaternion.clone(), P, Pinv: P.clone().invert(), side: Math.sign(pos.x) || 1 };
    }
  }
  normalize() {
    const o = this.object;
    o.rotation.set(0, 0, 0); o.position.set(0, 0, 0); o.scale.setScalar(1);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
    const s = this.rig.height / size.y;
    o.scale.setScalar(s);
    o.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -b2.min.y, -c.z);
    this.inner = new THREE.Group(); this.root.add(this.inner); this.inner.add(o); // inner handles yaw/hops about the feet center
    this.inner.rotation.y = this.rig.yaw;
    // Some exports mark every material transparent with depth writes off, which mis-sorts body parts
    // (SpongeBob's eyelids/eyes). Characters are opaque; cut-out alpha is handled by alphaTest.
    o.traverse(m => {
      if (!m.isMesh) return;
      m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) { mat.transparent = false; mat.depthWrite = true; mat.alphaTest = 0.5; mat.side = THREE.FrontSide; if ('metalness' in mat) mat.metalness = 0; if ('roughness' in mat) mat.roughness = Math.max(0.55, mat.roughness); }
    });
  }
  play(anim, dur = 2) { this.actions = this.actions.filter(a => a.anim !== anim); this.actions.push({ anim, start: performance.now() / 1000, dur }); if (this.actions.length > 4) this.actions.shift(); }
  layer(anim, dur = 2.5) { this.layers = [{ anim, start: performance.now() / 1000, dur }]; }
  endMode(fade = 0.6) { if (this.mode) this.modeUntil = Math.min(this.modeUntil, performance.now() / 1000 + fade); }
  setMode(mode, until = Infinity) { this.mode = mode; this.modeStart = performance.now() / 1000; this.modeUntil = until; }
  talk(dur) { this.talkingUntil = performance.now() / 1000 + dur; }

  update(time, anims) {
    const P = {}; // semantic pose accumulators
    const add = (j, m, v) => { if (!v) return; (P[j] ||= {})[m] = (P[j][m] || 0) + v; };
    const ctx = { t: time, add, talking: time < this.talkingUntil, ch: this };
    anims.idle(ctx, 1);
    if (this.mode && time < this.modeUntil) anims[this.mode]?.(ctx, Math.min(ease((time - this.modeStart) / 0.6), ease((this.modeUntil - time) / 0.6)), time - this.modeStart);
    else if (this.mode) this.mode = null;
    for (const a of [...this.actions, ...this.layers]) {
      const lt = time - a.start;
      if (lt > a.dur) continue;
      anims[a.anim]?.(ctx, env(lt, a.dur), lt, a.dur);
    }
    this.actions = this.actions.filter(a => time - a.start < a.dur);
    this.layers = this.layers.filter(a => time - a.start < a.dur);
    this.talkW = (this.talkW || 0) + ((ctx.talking ? 1 : 0) - (this.talkW || 0)) * 0.12;
    if (this.talkW > 0.01) anims.talk?.(ctx, this.talkW, time);

    // apply
    const e = new THREE.Euler(), q = new THREE.Quaternion();
    for (const [sem, j] of Object.entries(this.joints)) {
      const p = P[sem];
      if (!p) { j.node.quaternion.copy(j.rest); continue; }
      e.set(0, 0, 0);
      for (const [motion, v] of Object.entries(p)) { const m = MOTIONS[motion]; if (m) e[m[0]] += v * m[1] * (m[2] ? j.side : 1); }
      q.setFromEuler(e); // delta in model space → parent-local: Pinv * Δ * P
      j.node.quaternion.copy(j.Pinv).multiply(q).multiply(j.P).multiply(j.rest);
    }
    const r = P.world || {};
    this.inner.position.y = r.hop || 0;
    this.inner.position.x = r.slide || 0;
    this.inner.rotation.y = this.rig.yaw + (r.yaw || 0);
    this.inner.rotation.z = r.roll || 0;
  }
}

// --- animation libraries -------------------------------------------------------------------
// ctx.add(joint, motion, radians). `w` = blend weight 0..1, `lt` = local time.
export const KRABS_ANIMS = {
  idle({ t, add }, w) {
    add('world', 'hop', Math.abs(Math.sin(t * 1.6)) * 0.006);
    add('root', 'tilt', Math.sin(t * 0.8) * 0.03);
    add('armL', 'raise', -1.15 + Math.sin(t * 1.3) * 0.05); add('armR', 'raise', -1.15 + Math.sin(t * 1.3 + 1) * 0.05);
    add('clawL', 'open', Math.max(0, Math.sin(t * 0.9)) * 0.15); add('clawR', 'open', Math.max(0, Math.sin(t * 0.7 + 2)) * 0.15);
    add('eyeL', 'wiggle', Math.sin(t * 2.1) * 0.05); add('eyeR', 'wiggle', Math.sin(t * 2.3 + 1) * 0.05);
    add('world', 'yaw', Math.sin(t * 0.25) * 0.12);
  },
  talk({ t, add }, w) {
    add('world', 'hop', Math.abs(Math.sin(t * 6)) * 0.008 * w);
    add('armL', 'raise', (0.25 + Math.sin(t * 2.4) * 0.15) * w); add('armR', 'raise', (0.25 + Math.sin(t * 2.1 + 2) * 0.15) * w);
    add('elbowL', 'bend', Math.sin(t * 2.8) * 0.12 * w); add('clawR', 'open', Math.abs(Math.sin(t * 5)) * 0.25 * w);
    add('root', 'tilt', Math.sin(t * 1.7) * 0.04 * w);
  },
  inspect({ t, add }, w) {
    add('armL', 'raise', 0.7 * w); add('armR', 'raise', 0.7 * w); add('armL', 'swing', 0.9 * w); add('armR', 'swing', 0.9 * w);
    add('elbowL', 'bend', 0.6 * w); add('elbowR', 'bend', 0.6 * w);
    add('root', 'lean', 0.12 * w); add('world', 'yaw', Math.sin(t * 1.5) * 0.15 * w);
    add('eyeL', 'wiggle', Math.sin(t * 6) * 0.12 * w); add('eyeR', 'wiggle', Math.sin(t * 6 + 1) * 0.12 * w);
  },
  excited({ t, add }, w) {
    add('world', 'hop', Math.abs(Math.sin(t * 10)) * 0.07 * w);
    add('armL', 'raise', 1.3 * w); add('armR', 'raise', 1.3 * w);
    add('clawL', 'open', Math.abs(Math.sin(t * 12)) * 0.5 * w); add('clawR', 'open', Math.abs(Math.sin(t * 12 + 1)) * 0.5 * w);
  },
  greedy({ t, add }, w) {
    add('armL', 'raise', 0.8 * w); add('armR', 'raise', 0.8 * w);
    add('armL', 'swing', (0.5 + Math.sin(t * 14) * 0.15) * w); add('armR', 'swing', (-0.5 + Math.sin(t * 14 + Math.PI) * 0.15) * w);
    add('root', 'tilt', Math.sin(t * 7) * 0.08 * w); add('world', 'hop', Math.abs(Math.sin(t * 7)) * 0.015 * w);
  },
  annoyed({ t, add }, w, lt) {
    add('armL', 'raise', 0.6 * w); add('armR', 'raise', 0.6 * w);
    add('armL', 'swing', 0.7 * w); add('armR', 'swing', -0.7 * w);
    add('world', 'hop', (lt % 0.5 < 0.08 ? 0.03 : 0) * w); add('root', 'lean', -0.08 * w);
  },
  suspicious({ t, add }, w) {
    add('root', 'lean', 0.18 * w); add('world', 'yaw', Math.sin(t * 2) * 0.3 * w);
    add('armR', 'raise', 1.1 * w); add('elbowR', 'bend', 1.0 * w);
    add('eyeL', 'wiggle', 0.25 * w); add('eyeR', 'wiggle', -0.25 * w);
  },
  surprised({ t, add }, w, lt) {
    add('world', 'hop', Math.max(0, Math.sin(Math.min(lt, 0.5) * TAU)) * 0.12 * w);
    add('armL', 'raise', 1.5 * w); add('armR', 'raise', 1.5 * w); add('root', 'lean', -0.15 * w);
  },
  shocked({ t, add }, w, lt) {
    add('world', 'hop', (Math.abs(Math.sin(t * 16)) * 0.04 + (lt < 0.4 ? Math.sin(lt / 0.4 * Math.PI) * 0.15 : 0)) * w);
    add('armL', 'raise', (1.6 + Math.sin(t * 30) * 0.12) * w); add('armR', 'raise', (1.6 + Math.sin(t * 31) * 0.12) * w);
    add('root', 'tilt', Math.sin(t * 25) * 0.06 * w); add('root', 'lean', -0.2 * w);
    add('eyeL', 'wiggle', Math.sin(t * 20) * 0.3 * w); add('eyeR', 'wiggle', Math.sin(t * 22) * 0.3 * w);
  },
  laugh({ t, add }, w) {
    add('root', 'lean', -0.2 * w); add('world', 'hop', Math.abs(Math.sin(t * 14)) * 0.02 * w);
    add('armL', 'raise', 0.4 * w); add('armR', 'raise', 0.4 * w); add('root', 'tilt', Math.sin(t * 14) * 0.05 * w);
  },
  dance({ t, add }, w) {
    const b = t * TAU * (124 / 60) / 2;
    add('world', 'hop', Math.abs(Math.sin(b)) * 0.06 * w);
    add('world', 'yaw', Math.sin(b / 4) * 0.22 * w);
    add('root', 'tilt', Math.sin(b) * 0.15 * w);
    add('armL', 'raise', (0.95 + Math.sin(b) * 0.45) * w); add('armR', 'raise', (0.95 - Math.sin(b) * 0.45) * w);
    add('clawL', 'open', Math.abs(Math.sin(b * 2)) * 0.5 * w); add('clawR', 'open', Math.abs(Math.sin(b * 2 + 1)) * 0.5 * w);
    add('legL', 'swing', Math.max(0, Math.sin(b)) * 0.5 * w); add('legR', 'swing', Math.max(0, -Math.sin(b)) * 0.5 * w);
  },
  stamp({ add }, w, lt) {
    // raise (0–0.45s) → slam (0.45–0.6s) → hold → recover. Synced with the stamp object in stage.js.
    const up = lt < 0.45 ? ease(lt / 0.45) : lt < 0.6 ? 1 - ease((lt - 0.45) / 0.15) : 0;
    const hit = lt >= 0.55 && lt < 0.9 ? 1 : 0;
    add('armR', 'raise', (0.9 + up * 1.1) * w); add('elbowR', 'bend', (0.3 + up * 0.5) * w);
    add('root', 'lean', (hit * 0.18 - up * 0.08) * w); add('world', 'hop', (up * 0.05 - hit * 0.02) * w);
    add('armL', 'raise', 0.4 * w);
  },
  glance_annoyed({ add }, w) { add('world', 'yaw', 0.5 * w); add('armL', 'swing', 0.6 * w); add('armR', 'swing', -0.6 * w); add('armL', 'raise', 0.5 * w); add('armR', 'raise', 0.5 * w); },
  glance_amused({ t, add }, w) { add('world', 'yaw', 0.5 * w); add('root', 'tilt', Math.sin(t * 12) * 0.06 * w); add('armL', 'raise', 0.9 * w); },
  glance_confused({ t, add }, w) { add('world', 'yaw', 0.5 * w); add('root', 'tilt', 0.18 * w); add('armR', 'raise', 1.0 * w); add('elbowR', 'bend', 1.0 * w); },
};

export const SPONGE_ANIMS = {
  idle({ t, add, ch }, w) {
    add('world', 'hop', Math.abs(Math.sin(t * 2.2)) * 0.008);
    add('world', 'roll', Math.sin(t * 1.1) * 0.025);
    add('world', 'yaw', Math.sin(t * 0.37) * 0.12);
    add('armL', 'raise', 0.1 + Math.sin(t * 1.4) * 0.05); add('armR', 'raise', 0.1 + Math.sin(t * 1.4 + 1) * 0.05);
    add('world', 'yaw', ch.facing);
  },
  talk({ t, add }, w = 1) { add('jaw', 'open', Math.abs(Math.sin(t * 11)) * 0.3 * w); add('world', 'hop', Math.abs(Math.sin(t * 5.5)) * 0.01 * w); },
  look({ t, add }, w) { add('world', 'yaw', Math.sin(t * 1.6) * 0.5 * w); },
  wave({ t, add }, w) { add('armR', 'raise', 2.3 * w); add('elbowR', 'bend', Math.sin(t * 9) * 0.4 * w); add('world', 'roll', 0.05 * w); },
  cheer({ t, add }, w) { add('world', 'hop', Math.abs(Math.sin(t * 9)) * 0.08 * w); add('armL', 'raise', 2.4 * w); add('armR', 'raise', 2.4 * w); },
  shocked({ t, add }, w, lt) {
    add('world', 'hop', (Math.abs(Math.sin(t * 18)) * 0.025 + (lt < 0.4 ? Math.sin(lt / 0.4 * Math.PI) * 0.12 : 0)) * w);
    add('armL', 'raise', 2.2 * w); add('armR', 'raise', 2.2 * w); add('jaw', 'open', 0.5 * w);
  },
  flip({ t, add }, w) { add('armR', 'raise', (0.4 + Math.max(0, Math.sin(t * 8)) * 1.2) * w); add('elbowR', 'bend', 0.8 * w); },
  notice({ add }, w, lt) {
    add('world', 'hop', (lt < 0.5 ? Math.sin(lt / 0.5 * Math.PI) * 0.18 : 0) * w);
    add('armL', 'raise', 1.3 * w); add('armR', 'raise', 1.3 * w); add('jaw', 'open', 0.4 * w);
  },
  // Full-body dance driven on the real 97-bone skeleton: hip sway, knee pumps, arm swings, spins and jumps.
  dance({ t, add }, w, lt) {
    // Whole-body moves (roll/hop/yaw on the root) plus limb swings; the torso is never twisted against
    // the shorts, which is what opened gaps at the waist.
    const b = lt * TAU * (124 / 60) / 2; const phase = Math.floor(lt / 4) % 3;
    add('world', 'hop', (Math.abs(Math.sin(b)) * 0.06 + (phase === 2 ? Math.abs(Math.sin(b / 2)) * 0.06 : 0)) * w);
    add('world', 'yaw', (phase === 1 ? (lt % 4) / 4 * TAU : Math.sin(b / 2) * 0.45) * w);
    add('world', 'roll', Math.sin(b) * 0.14 * w);
    add('world', 'slide', Math.sin(b / 2) * 0.06 * w);
    const pump = phase === 0 ? Math.sin(b) : Math.sin(b * 2);
    add('armL', 'raise', (0.3 + pump * 1.2 + (phase === 2 ? 1.1 : 0)) * w); add('armR', 'raise', (0.3 - pump * 1.2 + (phase === 2 ? 1.1 : 0)) * w);
    add('elbowL', 'bend', Math.abs(Math.sin(b)) * 0.7 * w); add('elbowR', 'bend', Math.abs(Math.cos(b)) * 0.7 * w);
    add('kneeL', 'kbend', Math.max(0, Math.sin(b)) * 0.45 * w); add('kneeR', 'kbend', Math.max(0, -Math.sin(b)) * 0.45 * w);
    add('jaw', 'open', Math.abs(Math.sin(b * 2)) * 0.2 * w);
  },
};

export const SQUID_ANIMS = {
  talk({ t, add }, w = 1) { add('head', 'nod', Math.sin(t * 4) * 0.05 * w); add('root', 'tilt', Math.sin(t * 1.5) * 0.03 * w); add('armR', 'raise', (0.2 + Math.sin(t * 2) * 0.1) * w); },
  idle({ t, add }) { add('root', 'tilt', Math.sin(t * 0.6) * 0.03); add('head', 'tilt', Math.sin(t * 0.4) * 0.06); add('head', 'nod', 0.05 + Math.sin(t * 0.3) * 0.04); },
  shocked({ t, add }, w) { add('world', 'hop', Math.abs(Math.sin(t * 14)) * 0.03 * w); add('armL', 'raise', 1.5 * w); add('armR', 'raise', 1.5 * w); add('head', 'nod', -0.2 * w); },
  annoyed({ add }, w) { add('head', 'turn', 0.5 * w); add('root', 'lean', -0.1 * w); },
};
