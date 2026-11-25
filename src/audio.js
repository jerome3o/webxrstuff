// Everything is synthesised with WebAudio: no audio files to load.
// Sounds are spatialised with HRTF panners so you can hear where a hit landed.

const PENTA = [0, 2, 4, 7, 9]; // gong shang jue zhi yu

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this._musicTimer = null;
    this._nextNote = 0;
    this._step = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = 1; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);

    // Shared reverb send: a generated "courtyard" impulse.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.6);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.music.connect(this.reverbSend);

    this.noise = this._noiseBuffer(2);
    this._startAmbience();
    if (this.musicOn) this.startMusic();
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Update the listener from the (XR) camera each frame.
  setListener(pos, fwd, up) {
    const L = this.ctx?.listener; if (!L) return;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.02); L.positionY.setTargetAtTime(pos.y, t, 0.02); L.positionZ.setTargetAtTime(pos.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02); L.forwardY.setTargetAtTime(fwd.y, t, 0.02); L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02); L.upY.setTargetAtTime(up.y, t, 0.02); L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // Output node for a one-shot. With a position it goes through an HRTF panner.
  _out(pos, wet = 0.3, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
      p.refDistance = 2; p.rolloffFactor = 0.9; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(this.sfx);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w); w.connect(this.reverbSend); }
    } else {
      g.connect(this.sfx);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.reverbSend); }
    }
    return g;
  }

  _env(node, t, a, peak, d, end = 0.0001) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(end, t + a + d);
  }

  _noiseShot({ pos, type = 'bandpass', freq = 1000, q = 1, dur = 0.2, gain = 0.5, attack = 0.002, wet = 0.2, freqEnd = null, rate = 1 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain(); this._env(g, t, attack, gain, dur);
    src.connect(f).connect(g).connect(this._out(pos, wet));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  _tone({ pos, type = 'sine', freq = 440, freqEnd = null, dur = 0.3, gain = 0.3, attack = 0.003, wet = 0.3, delay = 0, detune = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain(); this._env(g, t, attack, gain, dur);
    o.connect(g).connect(this._out(pos, wet));
    o.start(t); o.stop(t + attack + dur + 0.05);
  }

  // ── Weapon sounds ─────────────────────────────────────────
  bowTwang(power, pos) {
    this._tone({ pos, type: 'triangle', freq: 110 + power * 50, freqEnd: 70, dur: 0.35, gain: 0.35 + power * 0.3 });
    this._tone({ pos, type: 'sine', freq: 220 + power * 90, freqEnd: 140, dur: 0.18, gain: 0.2 });
    this._noiseShot({ pos, type: 'highpass', freq: 2500, dur: 0.06, gain: 0.25 });
  }
  whoosh(pos) { this._noiseShot({ pos, type: 'bandpass', freq: 400, freqEnd: 1600, q: 2, dur: 0.35, gain: 0.25, attack: 0.08, wet: 0 }); }
  pistolShot(pos) {
    this._noiseShot({ pos, type: 'lowpass', freq: 3000, freqEnd: 300, dur: 0.25, gain: 0.9, wet: 0.5 });
    this._tone({ pos, type: 'sine', freq: 140, freqEnd: 45, dur: 0.2, gain: 0.7 });
  }
  sniperShot(pos) {
    this._noiseShot({ pos, type: 'lowpass', freq: 6000, freqEnd: 180, dur: 0.6, gain: 1.0, wet: 0.8 });
    this._tone({ pos, type: 'sine', freq: 90, freqEnd: 30, dur: 0.5, gain: 0.9 });
    this._tone({ pos, type: 'square', freq: 1800, freqEnd: 600, dur: 0.05, gain: 0.08 });
  }
  sniperCharge(progress) {
    if (!this.ctx) return;
    this._tone({ type: 'sine', freq: 300 + progress * 900, dur: 0.06, gain: 0.05, wet: 0 });
  }
  sniperReady() { this._tone({ type: 'sine', freq: 1568, dur: 0.25, gain: 0.12 }); this._tone({ type: 'sine', freq: 2093, dur: 0.3, gain: 0.08, delay: 0.06 }); }
  rocketLaunch(pos) {
    this._noiseShot({ pos, type: 'bandpass', freq: 300, freqEnd: 1200, q: 0.7, dur: 0.9, gain: 0.8, attack: 0.02, wet: 0.4 });
    this._tone({ pos, type: 'sawtooth', freq: 60, freqEnd: 120, dur: 0.6, gain: 0.25 });
  }
  explosion(pos, big = 1) {
    this._noiseShot({ pos, type: 'lowpass', freq: 1800, freqEnd: 80, dur: 1.4 * big, gain: 1.0, wet: 0.9, rate: 0.6 });
    this._tone({ pos, type: 'sine', freq: 70, freqEnd: 25, dur: 1.0 * big, gain: 1.0 });
    for (let i = 0; i < 6; i++) this._noiseShot({ pos, type: 'highpass', freq: 3000, dur: 0.04, gain: 0.3, wet: 0.2 });
  }
  dryFire() { this._tone({ type: 'square', freq: 900, dur: 0.03, gain: 0.08, wet: 0 }); this._tone({ type: 'square', freq: 500, dur: 0.03, gain: 0.06, wet: 0, delay: 0.05 }); }
  weaponSwap() { this._noiseShot({ type: 'bandpass', freq: 2200, q: 4, dur: 0.08, gain: 0.25, wet: 0 }); this._tone({ type: 'triangle', freq: 660, dur: 0.08, gain: 0.08, wet: 0 }); }

  // ── Impact sounds by material ─────────────────────────────
  impact(material, pos, strength = 1) {
    switch (material) {
      case 'straw': this._noiseShot({ pos, type: 'lowpass', freq: 900, dur: 0.12, gain: 0.7 * strength }); this._tone({ pos, freq: 90, freqEnd: 50, dur: 0.12, gain: 0.5 }); break;
      case 'wood': this._tone({ pos, type: 'triangle', freq: 240, freqEnd: 120, dur: 0.12, gain: 0.6 * strength }); this._noiseShot({ pos, freq: 1600, q: 3, dur: 0.05, gain: 0.4 }); break;
      case 'paper': this._noiseShot({ pos, type: 'highpass', freq: 1800, dur: 0.18, gain: 0.5 }); this._noiseShot({ pos, type: 'bandpass', freq: 600, dur: 0.1, gain: 0.3 }); break;
      case 'metal': this._tone({ pos, freq: 1250, dur: 0.6, gain: 0.25 }); this._tone({ pos, freq: 1873, dur: 0.4, gain: 0.15 }); this._noiseShot({ pos, type: 'highpass', freq: 4000, dur: 0.05, gain: 0.4 }); break;
      case 'porcelain': this.shatter(pos); break;
      case 'stone': this._noiseShot({ pos, freq: 2500, q: 2, dur: 0.07, gain: 0.5 }); this._tone({ pos, type: 'square', freq: 180, freqEnd: 90, dur: 0.05, gain: 0.15 }); break;
      case 'ground': this._noiseShot({ pos, type: 'lowpass', freq: 500, dur: 0.15, gain: 0.5 }); break;
      default: this._noiseShot({ pos, freq: 800, dur: 0.1, gain: 0.4 });
    }
  }
  shatter(pos) {
    for (let i = 0; i < 7; i++) this._tone({ pos, freq: 2500 + Math.random() * 3500, dur: 0.15 + Math.random() * 0.3, gain: 0.08, delay: Math.random() * 0.12 });
    this._noiseShot({ pos, type: 'highpass', freq: 3000, dur: 0.35, gain: 0.6 });
  }
  gong(pos) {
    const partials = [[1, 0.7, 4.5], [1.48, 0.35, 3.2], [2.07, 0.25, 2.4], [2.76, 0.18, 1.8], [3.9, 0.08, 1.0]];
    for (const [m, g, d] of partials) this._tone({ pos, freq: 98 * m, freqEnd: 92 * m, dur: d, gain: g, wet: 0.7, attack: 0.01 });
    this._noiseShot({ pos, type: 'lowpass', freq: 700, dur: 0.3, gain: 0.5 });
  }
  lanternPop(pos) { this.impact('paper', pos); this._noiseShot({ pos, type: 'lowpass', freq: 1200, dur: 0.5, gain: 0.25, attack: 0.05 }); }
  coin(delay = 0) { this._tone({ type: 'sine', freq: 1975, dur: 0.18, gain: 0.12, delay, wet: 0.2 }); this._tone({ type: 'sine', freq: 2637, dur: 0.3, gain: 0.1, delay: delay + 0.07, wet: 0.2 }); }
  crateOpen(pos) { this.impact('wood', pos, 1.2); for (let i = 0; i < 4; i++) this.coin(i * 0.06); }
  bullseye(pos) { [784, 988, 1175, 1568].forEach((f, i) => this._tone({ pos, type: 'triangle', freq: f, dur: 0.5, gain: 0.18, delay: i * 0.07, wet: 0.5 })); }
  comboChime(level) { const base = 523 * Math.pow(2, PENTA[level % 5] / 12); [0, 4, 7].forEach((s, i) => this._tone({ type: 'triangle', freq: base * Math.pow(2, s / 12), dur: 0.6, gain: 0.12, delay: i * 0.05, wet: 0.5 })); }
  firecrackers(pos, n = 14) { for (let i = 0; i < n; i++) setTimeout(() => this._noiseShot({ pos, type: 'highpass', freq: 1500, dur: 0.05, gain: 0.5, wet: 0.4 }), i * (40 + Math.random() * 60)); }
  fireworkBoom(pos) { this._noiseShot({ pos, type: 'lowpass', freq: 900, freqEnd: 100, dur: 1.2, gain: 0.7, wet: 0.9 }); setTimeout(() => this.firecrackers(pos, 8), 350); }
  penalty() { this._tone({ type: 'sawtooth', freq: 300, freqEnd: 150, dur: 0.4, gain: 0.12, wet: 0.1 }); }
  uiClick() { this._tone({ type: 'triangle', freq: 1320, dur: 0.05, gain: 0.1, wet: 0 }); }
  uiHover() { this._tone({ type: 'sine', freq: 2000, dur: 0.02, gain: 0.03, wet: 0 }); }
  roundStart() { this.gong(null); [0, 0.25, 0.5].forEach(d => this._tone({ type: 'sine', freq: 65, freqEnd: 40, dur: 0.3, gain: 0.7, delay: d, wet: 0.5 })); }
  roundEnd() { this.gong(null); [0, 2, 4, 7, 9, 12].forEach((s, i) => this._tone({ type: 'triangle', freq: 392 * Math.pow(2, s / 12), dur: 0.8, gain: 0.12, delay: i * 0.12, wet: 0.6 })); }

  // ── Ambience: wind bed that follows the in-game wind ─────
  _startAmbience() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.05;
    src.connect(f).connect(this.windGain).connect(this.sfx);
    src.start();
    this.windFilter = f;
  }
  setWind(strength) {
    if (!this.windGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.03 + strength * 0.03, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(250 + strength * 180, t, 0.5);
  }

  // ── Generative guzheng-ish music in D pentatonic ──────────
  startMusic() {
    if (!this.ctx || this._musicTimer) return;
    this._nextNote = this.ctx.currentTime + 0.2;
    this._musicTimer = setInterval(() => this._schedule(), 100);
    this._drone();
  }
  stopMusic() {
    clearInterval(this._musicTimer); this._musicTimer = null;
    if (this._droneNodes) { this._droneNodes.forEach(n => { try { n.stop(); } catch { } }); this._droneNodes = null; }
  }
  toggleMusic() { this.musicOn = !this.musicOn; this.musicOn ? this.startMusic() : this.stopMusic(); return this.musicOn; }

  _drone() {
    const ctx = this.ctx; this._droneNodes = [];
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0.12;
    f.connect(g).connect(this.music);
    for (const [freq, det] of [[73.42, -6], [110, 5], [146.83, 2]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = 0.25;
      o.connect(og).connect(f); o.start(); this._droneNodes.push(o);
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 250; lfo.connect(lg).connect(f.frequency); lfo.start(); this._droneNodes.push(lfo);
  }

  _pluck(t, freq, vel) {
    const ctx = this.ctx;
    // Additive pluck with a downward "press" bend, like a guzheng string.
    const out = ctx.createGain(); out.connect(this.music);
    const harm = [[1, 1, 2.2], [2, 0.45, 1.2], [3, 0.22, 0.7], [4, 0.12, 0.45], [5.02, 0.06, 0.3]];
    for (const [m, a, d] of harm) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq * m * 1.012, t);
      o.frequency.exponentialRampToValueAtTime(freq * m, t + 0.08);
      if (Math.random() < 0.3) { // occasional vibrato bend
        o.frequency.setValueAtTime(freq * m, t + 0.4);
        o.frequency.linearRampToValueAtTime(freq * m * 1.03, t + 0.7);
        o.frequency.linearRampToValueAtTime(freq * m, t + 1.0);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a * vel * 0.22, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + d + 0.05);
    }
  }

  _schedule() {
    const ctx = this.ctx; if (!ctx) return;
    const beat = 0.42;
    while (this._nextNote < ctx.currentTime + 0.4) {
      const s = this._step++;
      const phrase = Math.floor(s / 16) % 4;
      if (Math.random() < (s % 4 === 0 ? 0.85 : 0.45)) {
        const deg = Math.floor(Math.abs(Math.sin(s * 0.7 + phrase) * 9 + Math.random() * 3)) % 10;
        const oct = deg >= 5 ? 1 : 0;
        const semis = PENTA[deg % 5] + 12 * oct;
        const f = 293.66 * Math.pow(2, semis / 12);
        this._pluck(this._nextNote, f, s % 4 === 0 ? 1 : 0.6);
        // Glissando flourish every few phrases.
        if (s % 32 === 31) for (let k = 0; k < 6; k++) this._pluck(this._nextNote + k * 0.035, 293.66 * Math.pow(2, (PENTA[k % 5] + 12 * Math.floor(k / 5)) / 12), 0.4);
      }
      if (s % 8 === 0) this._woodblock(this._nextNote);
      this._nextNote += beat * (s % 2 ? 0.9 : 1.1); // a little swing
    }
  }
  _woodblock(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(820, t);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.music); o.start(t); o.stop(t + 0.1);
  }
}

export const audio = new AudioEngine();
