// WebAudio: synthesized sound effects + music loops (no external audio assets), and voice-line playback.
export class AudioEngine {
  constructor(enabled) {
    this.enabled = enabled;
    this.ctx = null; this.master = null; this.music = null; this.voiceEl = null; this.volume = 0.9;
  }
  ensure() {
    if (!this.enabled) return false;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination);
      // Hall reverb (generated impulse) so impacts sound big instead of dry and synthetic.
      const c = this.ctx, len = c.sampleRate * 3.2, ir = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      this.reverb = c.createConvolver(); this.reverb.buffer = ir;
      this.wet = c.createGain(); this.wet.gain.value = 0.55; this.reverb.connect(this.wet); this.wet.connect(this.master);
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      this.master.disconnect(); this.master.connect(comp); comp.connect(c.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }
  setEnabled(v) { this.enabled = v; if (!v) { this.stopMusic(); this.voiceEl?.pause(); this.stopBgm(); } }

  // --- background music -------------------------------------------------------------------
  // Plays the user's own files from /music (shuffled) or, if there are none, an original
  // procedurally generated island loop. Ducks under speech and pauses for event music.
  async startBgm(volume = 0.35) {
    if (!this.ensure() || this.bgm) return;
    const c = this.ctx;
    const bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(this.master);
    this.bgm = { bus, level: volume, ducked: false, files: [], el: null, timer: null };
    bus.gain.setTargetAtTime(volume, c.currentTime, 1.5);
    try { this.bgm.files = (await (await fetch('/api/music')).json()).files || []; } catch { this.bgm.files = []; }
    if (!this.bgm) return;
    if (this.bgm.files.length) this.playBgmFile(); else this.islandLoop();
  }
  setBgmVolume(v) { if (this.bgm) { this.bgm.level = v; this.bgmGain(); } }
  bgmGain(fast = false) {
    const b = this.bgm; if (!b) return;
    const target = this.music ? 0.0001 : b.ducked ? b.level * 0.3 : b.level; // event music takes over completely
    b.bus.gain.setTargetAtTime(Math.max(0.0001, target), this.ctx.currentTime, fast ? 0.08 : 0.6);
  }
  duckBgm(on) { if (this.bgm && this.bgm.ducked !== on) { this.bgm.ducked = on; this.bgmGain(true); } }
  playBgmFile() {
    const b = this.bgm; if (!b) return;
    const pick = b.files[Math.floor(Math.random() * b.files.length)];
    const el = new Audio('/music/' + encodeURIComponent(pick)); el.crossOrigin = 'anonymous';
    if (!b.src) { b.src = this.ctx.createMediaElementSource(el); } else { b.src.disconnect(); b.src = this.ctx.createMediaElementSource(el); }
    b.src.connect(b.bus); b.el = el;
    el.onended = () => this.playBgmFile();
    el.play().catch(() => {});
  }
  islandLoop() {
    // Original laid-back "island" tune: ukulele strums, sliding steel-guitar melody, bass and shaker.
    const c = this.ctx, b = this.bgm, bpm = 96, beat = 60 / bpm;
    const chords = [[262, 330, 392, 523], [220, 262, 330, 440], [175, 220, 262, 349], [196, 247, 294, 392]]; // C Am F G
    const bass = [131, 110, 87, 98];
    const mel = [[659, 0, 784, 0, 880, 784, 659, 0], [587, 0, 659, 523, 440, 0, 523, 0], [523, 0, 587, 659, 698, 0, 659, 587], [587, 0, 494, 0, 392, 440, 494, 0]];
    let next = c.currentTime + 0.1, step = 0;
    const pluck = (f, t, g, len = 0.5) => {
      const o = c.createOscillator(), o2 = c.createOscillator(), gn = c.createGain(), lp = c.createBiquadFilter();
      o.type = 'triangle'; o2.type = 'square'; o.frequency.value = f; o2.frequency.value = f * 2.001;
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + len);
      const g2 = c.createGain(); g2.gain.value = 0.15;
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.006); gn.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(gn); gn.connect(b.bus);
      o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
    };
    const steel = (f, t, len) => { // sliding, vibrato-y lap-steel note
      const o = c.createOscillator(), gn = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(f * 0.94, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      lfo.frequency.value = 5.5; lg.gain.value = f * 0.012; lfo.connect(lg); lg.connect(o.frequency);
      gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.055, t + 0.06); gn.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(gn); gn.connect(b.bus); if (this.reverb) gn.connect(this.reverb);
      o.start(t); lfo.start(t); o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
    };
    b.timer = setInterval(() => {
      if (!this.bgm) return;
      while (next < c.currentTime + 0.3) {
        const bar = Math.floor(step / 8) % 4, s8 = step % 8, t = next;
        // ukulele: down-down-up-up-down-up strum on eighths
        if ([0, 2, 3, 5, 6, 7].includes(s8)) chords[bar].forEach((f, i) => pluck(f, t + i * 0.012 * (s8 % 2 ? -1 : 1) + (s8 % 2 ? 0.036 : 0), s8 === 0 ? 0.05 : 0.03, 0.35));
        if (s8 === 0 || s8 === 4) pluck(bass[bar] / 2, t, 0.13, 0.7);
        if (s8 === 6) pluck(bass[bar] * 0.75, t, 0.08, 0.4);
        const m = mel[bar][s8]; if (m && Math.floor(step / 32) % 2 === 1) steel(m, t, beat * 1.4); // melody every other pass
        this.noise(t, 0.04, s8 % 2 ? 0.025 : 0.04, 6500, b.bus, 'highpass'); // shaker
        next += beat / 2; step++;
      }
    }, 80);
  }
  stopBgm() {
    const b = this.bgm; if (!b) return;
    clearInterval(b.timer); b.el?.pause();
    b.bus.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    setTimeout(() => b.bus.disconnect(), 2000);
    this.bgm = null;
  }

  // --- voice ----------------------------------------------------------------------------
  // Lines never cut each other off: if one is still playing, the next waits for it to end.
  playVoice(url, volume = 0.9) {
    if (!this.enabled || !url) return;
    this.voiceQueue ||= [];
    this.voiceQueue.push({ url, volume });
    if (!this.voiceBusy) this.nextVoice();
  }
  nextVoice() {
    const item = this.voiceQueue.shift();
    if (!item) { this.voiceBusy = false; if (this.music) this.music.gain.gain.setTargetAtTime(this.music.level, this.ctx.currentTime, 0.3); this.duckBgm(false); return; }
    this.voiceBusy = true;
    try {
      const a = new Audio(item.url); a.volume = Math.max(0, Math.min(1, item.volume)); this.voiceEl = a;
      if (this.music) this.music.gain.gain.setTargetAtTime(0.18, this.ctx.currentTime, 0.1); // duck music under speech
      this.duckBgm(true);
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(guard); setTimeout(() => this.nextVoice(), 150); };
      const guard = setTimeout(finish, 30000); // a stalled stream can never block the queue forever
      a.onended = a.onerror = finish;
      a.play().catch(finish);
    } catch { this.voiceBusy = false; }
  }

  // --- synth helpers -------------------------------------------------------------------
  osc(type, freq, t0, dur, gain = 0.3, dest = this.master, freqEnd = null) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(t0, dur, gain = 0.3, filterFreq = 1200, dest = this.master, type = 'lowpass') {
    const c = this.ctx, len = Math.max(1, Math.floor(c.sampleRate * dur));
    if (!this._nb || this._nb.length < len) { this._nb = c.createBuffer(1, c.sampleRate * 4, c.sampleRate); const d = this._nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = c.createBufferSource(); s.buffer = this._nb;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random() * 2, dur + 0.05);
  }

  sfx(name, intensity = 1) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime, k = Math.min(1.5, intensity);
    switch (name) {
      case 'stamp': this.osc('sine', 140, t, 0.25, 0.8 * k, this.master, 45); this.noise(t, 0.12, 0.5 * k, 2500); break;
      case 'chime': [880, 1108, 1318, 1760].forEach((f, i) => this.osc('triangle', f, t + i * 0.08, 0.9, 0.18 * k)); break;
      case 'cash': this.osc('square', 1567, t, 0.09, 0.12); this.osc('square', 2093, t + 0.09, 0.5, 0.12); this.noise(t, 0.08, 0.2, 6000, this.master, 'highpass'); break;
      case 'pop': this.osc('sine', 600, t, 0.12, 0.4, this.master, 1200); break;
      case 'whoosh': this.noise(t, 0.6, 0.4 * k, 900, this.master, 'bandpass'); break;
      case 'airhorn': [466, 470, 233].forEach(f => this.osc('sawtooth', f, t, 0.9, 0.12 * k)); break;
      case 'drumroll': for (let i = 0; i < 28; i++) this.noise(t + i * 0.05, 0.05, 0.15 + i * 0.008, 3000); break;
      case 'beep': this.osc('sine', 660, t, 0.15, 0.15); break;
      case 'hit': { // trailer-style impact: sub drop + body thump + filtered crack, sent into the hall
        const bus = this.ctx.createGain(); bus.gain.value = 1; bus.connect(this.master); bus.connect(this.reverb);
        this.osc('sine', 70, t, 1.6, 0.9 * k, bus, 28); this.osc('triangle', 120, t, 0.35, 0.45 * k, bus, 50);
        this.noise(t, 0.5, 0.55 * k, 900, bus); this.noise(t, 0.08, 0.4 * k, 3500, bus, 'bandpass');
        break; }
      case 'alarm': case 'horn': { // low brass "braam" warning instead of a beeping siren
        const bus = this.ctx.createGain(); bus.connect(this.master); bus.connect(this.reverb);
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1400, t + 0.6); f.frequency.linearRampToValueAtTime(500, t + 1.8); f.connect(bus);
        for (const fr of [55, 55.4, 82.4, 110.3]) this.osc('sawtooth', fr, t, 2.2, 0.12 * k, f);
        break; }
      case 'snap': this.noise(t, 0.03, 0.22, 4200, this.master, 'highpass'); this.osc('square', 1700 + Math.random() * 600, t, 0.04, 0.05); break;
      case 'boom': {
        const bus = this.ctx.createGain(); bus.connect(this.master); bus.connect(this.reverb);
        this.osc('sine', 90, t, 3.2, 1.0 * k, bus, 22);
        this.noise(t, 4.0, 0.9 * k, 380, bus);
        this.noise(t, 0.5, 0.7 * k, 4500, bus);
        this.noise(t + 0.15, 2.5, 0.35 * k, 160, bus);
        break; }
      default: this.osc('sine', 500, t, 0.15, 0.2);
    }
  }

  // --- music: simple procedurally sequenced loops ------------------------------------------
  startMusic(track = 'party', duration = 10) {
    if (!this.ensure()) return;
    this.stopMusic();
    const c = this.ctx, gain = c.createGain(); gain.gain.value = 0.0001; gain.connect(this.master);
    const level = track === 'tension' ? 0.5 : 0.42;
    gain.gain.setTargetAtTime(level, c.currentTime, 0.2);
    const bpm = track === 'party' ? 124 : track === 'fanfare' ? 110 : track === 'timelapse' ? 190 : 70, beat = 60 / bpm;
    const m = { gain, level, track, next: c.currentTime + 0.05, step: 0, stopAt: c.currentTime + duration };
    const bass = [55, 55, 82.4, 73.4]; const chords = [[220, 277, 330], [220, 277, 330], [196, 247, 294], [208, 262, 311]];
    m.timer = setInterval(() => {
      while (m.next < c.currentTime + 0.25) {
        const t = m.next, s = m.step, bar = Math.floor(s / 4) % 4;
        if (track === 'party') {
          if (s % 1 === 0) this.osc('sine', 120, t, 0.18, 0.7, gain, 45); // kick
          this.noise(t + beat / 2, 0.05, 0.12, 8000, gain, 'highpass'); // hat
          if (s % 2 === 1) this.noise(t, 0.12, 0.25, 1800, gain, 'bandpass'); // clap
          this.osc('sawtooth', bass[bar], t + beat / 2, beat * 0.45, 0.16, gain);
          if (s % 4 === 0) chords[bar].forEach(f => this.osc('square', f * 2, t, beat * 0.6, 0.035, gain));
        } else if (track === 'tension') {
          this.osc('sine', s % 2 ? 50 : 55, t, beat * 0.4, 0.6, gain, 35);
          if (s % 4 === 0) this.osc('sawtooth', 73.4, t, beat * 3.8, 0.06, gain);
        } else if (track === 'timelapse') {
          const mel = [784, 988, 1175, 988, 1319, 1175, 988, 784]; this.osc('triangle', mel[s % mel.length], t, beat * 0.45, 0.09, gain);
          this.osc('sine', s % 2 ? 98 : 131, t, 0.15, 0.4, gain, 60); this.noise(t + beat / 2, 0.03, 0.08, 7000, gain, 'highpass');
        } else {
          const mel = [523, 659, 784, 1046, 784, 1046]; this.osc('triangle', mel[s % mel.length], t, beat * 0.9, 0.12, gain);
          if (s % 2 === 0) this.osc('sine', 110, t, 0.2, 0.5, gain, 50);
        }
        m.next += beat; m.step++;
      }
      if (c.currentTime > m.stopAt) this.stopMusic();
    }, 60);
    this.music = m;
    this.bgmGain();
  }
  extendMusic(duration) { if (this.music) this.music.stopAt = Math.max(this.music.stopAt, this.ctx.currentTime + duration); }
  stopMusic() {
    const m = this.music; if (!m) return;
    clearInterval(m.timer);
    m.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    setTimeout(() => m.gain.disconnect(), 2000);
    this.music = null;
    this.bgmGain();
  }
}
