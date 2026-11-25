import { Sfx } from '../../src/platform/kit.js';

// Synthesised sound for Blockfell: per-material hit/break/place/step sounds and an ambient bed
// (wind, birds by day, crickets at night, muffled underground / underwater).
// game.audio.material(kind, 'break'|'hit'|'place'|'step', pos) and game.audio.pop(pos).

const MAT = {
  stone: { f: 1700, q: 1.4, type: 'bandpass', tone: 170, g: 1 },
  dirt: { f: 650, q: 0.8, type: 'lowpass', g: 1.1 },
  grass: { f: 2400, q: 0.7, type: 'bandpass', g: 0.8 },
  sand: { f: 3200, q: 0.5, type: 'bandpass', g: 0.8, dur: 1.3 },
  wood: { f: 900, q: 3, type: 'bandpass', tone: 300, g: 1 },
  leaves: { f: 4200, q: 0.6, type: 'bandpass', g: 0.6 },
  glass: { f: 5000, q: 2, type: 'bandpass', tone: 1900, ring: 2850, g: 0.7 },
  snow: { f: 1300, q: 0.6, type: 'lowpass', g: 0.9, dur: 1.3 },
  cloth: { f: 600, q: 0.7, type: 'lowpass', g: 0.7 },
  plant: { f: 3000, q: 0.8, type: 'bandpass', g: 0.5, dur: 0.7 },
};

export class GameAudio {
  constructor(platformAudio) {
    this.pa = platformAudio;
    this.sfx = new Sfx(platformAudio);
    this.ctx = platformAudio.ctx;
    this.enabled = !!this.ctx;
    this.nodes = [];
    this.birdT = 2; this.cricketT = 1;
    this.levels = { day: 1, sky: 1, water: 0 };
    if (this.enabled) this._ambient();
  }

  material(kind, action, pos) {
    if (!this.enabled) return;
    const m = MAT[kind] ?? MAT.stone;
    const k = action === 'break' ? 1 : action === 'place' ? 0.8 : action === 'hit' ? 0.45 : 0.22;
    const dur = (action === 'break' ? 0.18 : action === 'step' ? 0.06 : 0.09) * (m.dur ?? 1);
    const jitter = 0.85 + Math.random() * 0.3;
    this.sfx.noise({ freq: m.f * jitter, q: m.q, type: m.type, dur, gain: 0.35 * k * m.g, pos });
    if (m.tone && action !== 'step') this.sfx.tone({ freq: m.tone * jitter, freqEnd: m.tone * 0.6, dur: dur * 0.8, type: 'triangle', gain: 0.12 * k, pos });
    if (m.ring && action !== 'step') this.sfx.tone({ freq: m.ring, dur: 0.25, type: 'sine', gain: 0.05 * k, delay: 0.02, pos });
    if (action === 'break') this.sfx.noise({ freq: m.f * 0.5, q: 0.7, type: 'lowpass', dur: 0.12, gain: 0.18 * m.g, delay: 0.05, pos });
  }
  pop(pos) { if (this.enabled) { this.sfx.tone({ freq: 620 + Math.random() * 120, freqEnd: 980, dur: 0.07, type: 'sine', gain: 0.12, pos }); } }
  click() { if (this.enabled) this.sfx.tone({ freq: 880, dur: 0.04, type: 'triangle', gain: 0.08 }); }
  splash(pos) { if (this.enabled) this.sfx.noise({ freq: 900, q: 0.6, type: 'lowpass', dur: 0.35, gain: 0.3, pos, freqEnd: 300 }); }

  _ambient() {
    const ctx = this.ctx, out = this.pa.out;
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { b = b * 0.985 + (Math.random() * 2 - 1) * 0.15; d[i] = b; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(out); src.start();
    this.wind = { src, lp, g };
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.5; this.ambGain.connect(out);
    this.nodes.push(src, lp, g, this.ambGain);
  }

  // called every frame with environment levels: day 0..1, sky exposure 0..1, underwater bool
  update(dt, { day, sky, underwater, time }) {
    if (!this.enabled) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const w = this.wind;
    const gust = 0.5 + 0.5 * Math.sin(time * 0.21) * Math.sin(time * 0.057 + 1);
    const wv = underwater ? 0.02 : (0.025 + 0.05 * gust) * (0.25 + 0.75 * sky);
    w.g.gain.setTargetAtTime(wv, now, 0.3);
    w.lp.frequency.setTargetAtTime(underwater ? 220 : 300 + 500 * gust, now, 0.5);
    if (underwater || sky < 0.3) return;
    this.birdT -= dt; this.cricketT -= dt;
    if (day > 0.6 && this.birdT <= 0) { this.birdT = 1.5 + Math.random() * 5; this._bird(); }
    if (day < 0.35 && this.cricketT <= 0) { this.cricketT = 0.9 + Math.random() * 1.6; this._cricket(); }
  }

  _bird() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(this.ambGain);
    const base = 2200 + Math.random() * 1600, notes = 2 + ((Math.random() * 4) | 0);
    for (let n = 0; n < notes; n++) {
      const t = t0 + n * (0.09 + Math.random() * 0.06);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.25), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), t + 0.06);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(pan); o.start(t); o.stop(t + 0.1);
    }
    setTimeout(() => { try { pan.disconnect(); } catch { } }, 1500);
  }
  _cricket() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.8 - 0.9; pan.connect(this.ambGain);
    const f = 4300 + Math.random() * 500;
    for (let n = 0; n < 3; n++) {
      const t = t0 + n * 0.07;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.012, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g).connect(pan); o.start(t); o.stop(t + 0.06);
    }
    setTimeout(() => { try { pan.disconnect(); } catch { } }, 1000);
  }

  dispose() {
    for (const n of this.nodes) { try { n.stop?.(); } catch { } try { n.disconnect(); } catch { } }
    this.nodes = [];
  }
}
