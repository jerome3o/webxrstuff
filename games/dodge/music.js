import { mulberry } from './env.js';

// Procedural "mountain dojo" groove: kick/snare/hats, taiko fills, a sawtooth bass on an
// i–VI–VII–v loop in D, a plucked pentatonic lead and soft chord pads.
// Song time t is the master clock for gameplay: t = 0 is the downbeat of bar 0, and every
// note is scheduled at AudioContext time base + t, so spawns and music share one timeline.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const ROOTS = [38, 34, 36, 33];               // D, Bb, C, A
const CHORDS = [[0, 3, 7], [0, 4, 7], [0, 4, 7], [0, 3, 7]];
const SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81];
const STYLES = [
  { kick: [0, 8], snare: [4, 12], hat: 2, open: false, bass: [0, 6, 8, 14], lead: 0.35, pad: 0.05 },             // warm-up
  { kick: [0, 4, 8, 12], snare: [4, 12], hat: 2, open: true, bass: [0, 3, 6, 8, 10, 14], lead: 0.5, pad: 0.04 },  // normal
  { kick: [0, 4, 8, 10, 12], snare: [4, 12], hat: 1, open: true, bass: [0, 2, 3, 6, 8, 10, 11, 14], lead: 0.6, pad: 0.035 }, // intense
];
const LOOKAHEAD = 0.3;

export class Music {
  constructor(audio) {
    const a = this.actx = audio.ctx;
    this.bus = a.createGain(); this.bus.gain.value = 0;
    this.bus.connect(audio.out);
    this.delay = a.createDelay(1.5); this.fb = a.createGain(); this.fb.gain.value = 0.3;
    this.wet = a.createGain(); this.wet.gain.value = 0.22;
    this.delay.connect(this.fb); this.fb.connect(this.delay); this.delay.connect(this.wet); this.wet.connect(this.bus);
    const b = a.createBuffer(1, a.sampleRate, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
    this.playing = false; this.disposed = false;
    this.t = 0; this.spb = 0.5; this.step = 0; this.endStep = Infinity;
    this.kickLog = new Float32Array(64); this.kickN = 0;   // song times of scheduled kicks (for tests)
    this.notes = 0;
    this.melody = new Int8Array(8 * 16);
  }

  get running() { return this.actx.state === 'running'; }

  start(bpm, styleIdx, introBars, seed) {
    if (this.disposed) return;
    this.spb = 60 / bpm; this.st = this.spb / 4; this.style = STYLES[styleIdx] ?? STYLES[1];
    this.t = -introBars * 4 * this.spb;
    this.step = -introBars * 16;
    this.base = this.actx.currentTime + 0.08 - this.t;
    this.endStep = Infinity; this.playing = true; this.kickN = 0;
    this.delay.delayTime.value = this.spb * 0.75;
    const now = this.actx.currentTime;
    this.bus.gain.cancelScheduledValues(now); this.bus.gain.setValueAtTime(0.75, now);
    // melody: 4 bars generated, bars 4-7 repeat them with a varied tail
    const r = mulberry(seed * 977 + 13); let idx = 4;
    this.melody.fill(0);
    for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 16; s += 2) {
      if (r() < 0.62 || s === 0) { idx = Math.max(0, Math.min(SCALE.length - 1, idx + Math.round((r() - 0.5) * 4))); this.melody[bar * 16 + s] = SCALE[idx]; }
      if (r() < 0.15) this.melody[bar * 16 + s + 1] = SCALE[Math.min(SCALE.length - 1, idx + 1)];
    }
    for (let i = 0; i < 64; i++) this.melody[64 + i] = this.melody[i];
    for (let s = 8; s < 16; s += 2) this.melody[7 * 16 + s] = SCALE[(s / 2) % SCALE.length];
  }

  // Stop scheduling after song time endT (a final taiko + gong is played there).
  endAt(endT) { this.endStep = Math.round(endT / this.st); }

  fadeOut(sec = 0.6) {
    const now = this.actx.currentTime;
    this.bus.gain.cancelScheduledValues(now); this.bus.gain.setValueAtTime(this.bus.gain.value, now);
    this.bus.gain.linearRampToValueAtTime(0, now + sec);
    this.playing = false;
  }

  update(dt) {
    if (!this.playing && this.endStep === Infinity) return this.t;
    const a = this.actx;
    if (this.running) {
      const target = a.currentTime - this.base, err = target - (this.t + dt);
      if (Math.abs(err) > 0.08) this.t = target; else this.t += dt + err * 0.2;
    } else {
      this.t += dt; this.base = a.currentTime - this.t;
    }
    if (!this.playing) return this.t;
    const horizon = this.t + LOOKAHEAD;
    while (this.step * this.st < horizon) {
      const stepT = this.step * this.st, at = this.base + stepT;
      if (this.step > this.endStep) { this.playing = false; break; }
      if (this.running && at >= a.currentTime - 0.02) this._play(this.step, at, stepT);
      this.step++;
    }
    return this.t;
  }

  _play(step, at, stepT) {
    const st = this.style, s = ((step % 16) + 16) % 16, bar = Math.floor(step / 16), b4 = ((bar % 4) + 4) % 4;
    const intro = bar < 0;
    if (step === this.endStep) { this._taiko(at, 70, 1.2); this._gong(at); this._kick(at, 1); this._logKick(stepT); return; }
    const fill = !intro && b4 === 3 && s >= 12;
    if (st.kick.includes(s) && !(fill && s > 12)) { this._kick(at, 1); this._logKick(stepT); }
    if (!intro && st.snare.includes(s)) this._snare(at);
    if (s % st.hat === 0) this._hat(at, st.open && s % 4 === 2, intro ? 0.06 : 0.09);
    if (fill) this._taiko(at, s % 2 ? 92 : 78, 0.7);
    if (intro && s === 0 && bar === -1) this._taiko(at, 80, 0.8);
    if (!intro && b4 === 0 && s === 0 && bar % 8 === 0) this._taiko(at, 66, 1);
    const root = ROOTS[b4];
    if (!intro || bar === -1) {
      if (st.bass.includes(s)) this._bass(at, midi(root + (s === 6 || s === 14 ? 12 : 0)), this.st * 1.6);
    }
    if (!intro && s === 0) { const ch = CHORDS[b4]; for (let i = 0; i < 3; i++) this._pad(at, midi(root + 24 + ch[i]), this.spb * 4, st.pad); }
    const sect = ((bar % 16) + 16) % 16;
    if (!intro && sect >= 4 && sect < 14) {
      const n = this.melody[(((bar % 8) + 8) % 8) * 16 + s];
      if (n) this._pluck(at, midi(n), st.lead * 0.22);
    }
  }

  _logKick(t) { this.kickLog[this.kickN % this.kickLog.length] = t; this.kickN++; }

  _env(g, at, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + attack + dur);
  }
  _noise(at, dur) {
    const s = this.actx.createBufferSource(); s.buffer = this.noiseBuf; s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.05); return s;
  }
  _kick(at, gain) {
    const a = this.actx, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.14);
    this._env(g, at, 0.95 * gain, 0.003, 0.32);
    o.connect(g).connect(this.bus); o.start(at); o.stop(at + 0.4);
    this.notes++;
  }
  _snare(at) {
    const a = this.actx, n = this._noise(at, 0.2), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'bandpass'; f.frequency.value = 1900; f.Q.value = 0.7;
    this._env(g, at, 0.45, 0.002, 0.17);
    n.connect(f).connect(g).connect(this.bus);
    const o = a.createOscillator(), og = a.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(210, at); o.frequency.exponentialRampToValueAtTime(150, at + 0.08);
    this._env(og, at, 0.25, 0.002, 0.08); o.connect(og).connect(this.bus); o.start(at); o.stop(at + 0.15);
  }
  _hat(at, open, gain) {
    const a = this.actx, n = this._noise(at, open ? 0.2 : 0.06), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'highpass'; f.frequency.value = 7200;
    this._env(g, at, open ? gain * 1.2 : gain, 0.001, open ? 0.16 : 0.035);
    n.connect(f).connect(g).connect(this.bus);
  }
  _taiko(at, freq, gain) {
    const a = this.actx, o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq * 1.6, at); o.frequency.exponentialRampToValueAtTime(freq, at + 0.06);
    this._env(g, at, gain, 0.004, 0.55); o.connect(g).connect(this.bus); o.start(at); o.stop(at + 0.65);
    const n = this._noise(at, 0.12), f = a.createBiquadFilter(), ng = a.createGain();
    f.type = 'lowpass'; f.frequency.value = 600; this._env(ng, at, gain * 0.5, 0.002, 0.1);
    n.connect(f).connect(ng).connect(this.bus);
  }
  _gong(at) {
    const a = this.actx;
    for (const [fr, gn] of [[110, 0.25], [163, 0.14], [231, 0.1], [347, 0.06]]) {
      const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(fr * 1.02, at); o.frequency.exponentialRampToValueAtTime(fr, at + 1.5);
      this._env(g, at, gn, 0.01, 3.2); o.connect(g).connect(this.bus); o.start(at); o.stop(at + 3.3);
      g.connect(this.delay);
    }
  }
  _bass(at, freq, dur) {
    const a = this.actx, o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = freq;
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, at); f.frequency.exponentialRampToValueAtTime(180, at + dur);
    this._env(g, at, 0.32, 0.005, dur);
    o.connect(f).connect(g).connect(this.bus); o.start(at); o.stop(at + dur + 0.05);
  }
  _pluck(at, freq, gain) {
    const a = this.actx, o = a.createOscillator(), o2 = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.value = freq; o2.type = 'square'; o2.frequency.value = freq * 2.003;
    const g2 = a.createGain(); g2.gain.value = 0.12;
    this._env(g, at, gain, 0.002, 0.5);
    o.connect(g); o2.connect(g2).connect(g); g.connect(this.bus); g.connect(this.delay);
    o.start(at); o2.start(at); o.stop(at + 0.55); o2.stop(at + 0.55);
  }
  _pad(at, freq, dur, gain) {
    const a = this.actx, f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'lowpass'; f.frequency.value = 1100;
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(gain, at + dur * 0.3); g.gain.linearRampToValueAtTime(0.0001, at + dur);
    for (const det of [-6, 7]) { const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det; o.connect(f); o.start(at); o.stop(at + dur + 0.05); }
    f.connect(g).connect(this.bus);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.playing = false;
    try {
      const now = this.actx.currentTime;
      this.bus.gain.cancelScheduledValues(now); this.bus.gain.setValueAtTime(0, now); this.bus.gain.value = 0;
      this.fb.disconnect(); this.delay.disconnect(); this.wet.disconnect(); this.bus.disconnect();
    } catch { }
  }
}
