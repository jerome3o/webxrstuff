import { Sfx } from '../../src/platform/kit.js';

// Market ambience (crowd murmur, distant plucked melody) and one-shot sound effects, all synthesized.
export class Sounds {
  constructor(audio) {
    this.audio = audio;
    this.sfx = new Sfx(audio);
    this.nodes = [];
    this.voiceT = 0; this.musicT = 2; this.musicStep = 0;
    this.cool = new Map(); // key -> last time
    this.now = 0;
  }
  get ctx() { return this.audio.ctx; }

  startAmbience() {
    const ctx = this.ctx; if (!ctx) return;
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let b = 0;
      for (let i = 0; i < len; i++) { b = b * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = b * 6; } // brownish noise
    }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 420; f1.Q.value = 0.8;
    const f2 = ctx.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 900; f2.gain.value = 6; f2.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.value = 0.12;
    src.connect(f1).connect(f2).connect(g).connect(this.audio.out);
    // slow swell of the crowd
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lg = ctx.createGain(); lg.gain.value = 0.04; lfo.connect(lg).connect(g.gain);
    src.start(); lfo.start();
    this.murmurGain = g;
    this.nodes.push(src, lfo, g, f1, f2, lg);
  }

  // per-frame: sprinkle voice-like babble and a distant plucked tune
  update(dt, t) {
    this.now = t;
    const ctx = this.ctx; if (!ctx || !this.nodes.length) return;
    this.voiceT -= dt;
    if (this.voiceT <= 0) {
      this.voiceT = 0.12 + Math.random() * 0.5;
      this._voice();
    }
    this.musicT -= dt;
    if (this.musicT <= 0) {
      const scale = [293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
      const phrase = [0, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 3, 2, 3, -1];
      const n = phrase[this.musicStep++ % phrase.length];
      this.musicT = n < 0 ? 1.6 : 0.42 + (this.musicStep % 4 === 0 ? 0.3 : 0);
      if (n >= 0) this._pluck(scale[n], 0.045);
    }
  }
  _voice() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 110 + Math.random() * 160; o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.8 + Math.random() * 0.5), t + 0.25);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 900; bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012 + Math.random() * 0.01, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.2);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = Math.random() * 2 - 1;
    o.connect(bp).connect(g);
    if (p) { g.connect(p); p.connect(this.audio.out); } else g.connect(this.audio.out);
    o.start(t); o.stop(t + 0.5);
  }
  _pluck(freq, gain, pos = null) {
    this.sfx.tone({ freq, dur: 0.9, type: 'triangle', gain, attack: 0.003, pos });
    this.sfx.tone({ freq: freq * 2.01, dur: 0.35, type: 'sine', gain: gain * 0.4, attack: 0.002, pos });
  }
  _ok(key, gap) { const l = this.cool.get(key) ?? -1; if (this.now - l < gap) return false; this.cool.set(key, this.now); return true; }

  // ── one-shots ──
  thud(pos, v = 1) { if (!this._ok('thud' + (pos.x * 3 | 0), 0.05)) return; this.sfx.noise({ freq: 220, q: 1.2, type: 'lowpass', dur: 0.09, gain: Math.min(0.5, 0.12 * v), pos }); }
  clank(pos, v = 1) {
    if (!this._ok('clank' + (pos.x * 5 | 0) + (pos.y * 5 | 0), 0.04)) return;
    const g = Math.min(0.12, 0.03 * v), f = 900 + Math.random() * 500;
    this.sfx.tone({ freq: f, dur: 0.18, type: 'square', gain: g * 0.4, pos });
    this.sfx.tone({ freq: f * 2.76, dur: 0.12, type: 'sine', gain: g, pos });
    this.sfx.noise({ freq: 4000, q: 2, dur: 0.05, gain: g, pos });
  }
  clink(pos, v = 1) { if (!this._ok('clink', 0.05)) return; const f = 2200 + Math.random() * 800; this.sfx.tone({ freq: f, dur: 0.25, gain: Math.min(0.1, 0.03 * v), pos }); this.sfx.tone({ freq: f * 1.5, dur: 0.15, gain: Math.min(0.06, 0.02 * v), pos }); }
  bounce(pos, v = 1) { if (!this._ok('bounce' + (pos.x * 3 | 0), 0.06)) return; this.sfx.tone({ freq: 140, freqEnd: 70, dur: 0.12, gain: Math.min(0.35, 0.08 * v), pos }); }
  wood(pos, v = 1) { if (!this._ok('wood', 0.05)) return; this.sfx.noise({ freq: 700, q: 3, dur: 0.06, gain: Math.min(0.3, 0.07 * v), pos }); this.sfx.tone({ freq: 320, dur: 0.06, gain: Math.min(0.1, 0.03 * v), pos }); }
  coin(pos, v = 1) { if (!this._ok('coin', 0.04)) return; const f = 3000 + Math.random() * 1200; this.sfx.tone({ freq: f, dur: 0.12, gain: Math.min(0.07, 0.025 * v), pos }); this.sfx.tone({ freq: f * 1.33, dur: 0.2, gain: Math.min(0.05, 0.02 * v), delay: 0.03, pos }); }
  splash(pos) { this.sfx.noise({ freq: 1800, freqEnd: 500, q: 0.7, dur: 0.25, gain: 0.15, pos }); }
  pop(pos) { this.sfx.noise({ freq: 1500, q: 0.5, type: 'highpass', dur: 0.05, gain: 0.5, pos }); this.sfx.tone({ freq: 180, freqEnd: 60, dur: 0.08, gain: 0.2, pos }); }
  thunk(pos) { this.sfx.noise({ freq: 900, q: 4, dur: 0.05, gain: 0.3, pos }); this.sfx.tone({ freq: 220, freqEnd: 120, dur: 0.07, gain: 0.12, pos }); }
  swish(pos) { this.sfx.noise({ freq: 2500, freqEnd: 900, q: 1, dur: 0.35, gain: 0.18, pos }); }
  grab() { this.sfx.tone({ freq: 520, dur: 0.05, gain: 0.04 }); }
  throwWhoosh(speed) { this.sfx.noise({ freq: 600 + speed * 80, freqEnd: 300, q: 1.5, dur: 0.18, gain: Math.min(0.12, 0.012 * speed) }); }
  click() { this.sfx.tone({ freq: 880, dur: 0.04, gain: 0.08 }); }
  score(pos, n = 1) { const base = 523.3; for (let i = 0; i < 3; i++) this.sfx.tone({ freq: base * [1, 1.25, 1.5][i] * (1 + n * 0.02), dur: 0.15, delay: i * 0.07, gain: 0.08, type: 'triangle', pos }); }
  miss(pos) { this.sfx.tone({ freq: 300, freqEnd: 200, dur: 0.3, type: 'triangle', gain: 0.06, pos }); }
  win(pos, big) {
    const notes = big ? [523.3, 659.3, 784, 1046.5, 784, 1046.5] : [523.3, 659.3, 784];
    notes.forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.22, type: 'triangle', gain: 0.1, delay: i * 0.09, pos }));
  }
  tickets(pos, n) { for (let i = 0; i < Math.min(n, 12); i++) this.sfx.noise({ freq: 3000, q: 6, dur: 0.02, gain: 0.12, delay: i * 0.08, pos }); }
  register() { this.sfx.tone({ freq: 1318, dur: 0.12, gain: 0.08 }); this.sfx.tone({ freq: 1760, dur: 0.3, gain: 0.08, delay: 0.1 }); this.sfx.noise({ freq: 5000, q: 3, dur: 0.06, gain: 0.08 }); }
  denied() { this.sfx.tone({ freq: 220, dur: 0.15, type: 'square', gain: 0.04 }); this.sfx.tone({ freq: 180, dur: 0.2, type: 'square', gain: 0.04, delay: 0.12 }); }
  firecrackers(pos, n = 14) {
    let d = 0;
    for (let i = 0; i < n; i++) {
      d += 0.04 + Math.random() * 0.12;
      this.sfx.noise({ freq: 1200 + Math.random() * 2500, q: 0.6, dur: 0.04, gain: 0.35, delay: d, pos });
    }
    this.sfx.noise({ freq: 400, freqEnd: 3000, q: 1, dur: 0.4, gain: 0.08, pos }); // fuse whistle
  }

  dispose() {
    for (const n of this.nodes) { try { n.stop?.(); } catch { } try { n.disconnect(); } catch { } }
    this.nodes = [];
  }
}
