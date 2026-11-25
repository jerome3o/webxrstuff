import { Sfx } from '../../src/platform/kit.js';

// Wind bed scaled with airspeed (two filtered noise layers) + one-shot flight sounds.
export class FlightAudio {
  constructor(audio) {
    this.audio = audio; this.sfx = new Sfx(audio);
    this.ok = false; this._frame = 0;
    const ac = audio?.ctx; if (!ac) return;
    try {
      const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; d[i] = w * 0.5 + b * 4; }
      this.src = ac.createBufferSource(); this.src.buffer = buf; this.src.loop = true;
      this.low = ac.createBiquadFilter(); this.low.type = 'bandpass'; this.low.frequency.value = 300; this.low.Q.value = 0.6;
      this.high = ac.createBiquadFilter(); this.high.type = 'highpass'; this.high.frequency.value = 2500;
      this.gLow = ac.createGain(); this.gLow.gain.value = 0;
      this.gHigh = ac.createGain(); this.gHigh.gain.value = 0;
      this.master = ac.createGain(); this.master.gain.value = 0.8;
      this.src.connect(this.low).connect(this.gLow).connect(this.master);
      this.src.connect(this.high).connect(this.gHigh).connect(this.master);
      this.master.connect(audio.out);
      this.src.start();
      this.ok = true;
    } catch (e) { this.ok = false; }
  }
  // speed m/s, gust 0..1
  update(speed, active) {
    if (!this.ok || (this._frame++ & 3)) return;
    const t = this.audio.ctx.currentTime;
    const s = active ? Math.min(1, speed / 35) : 0.05;
    this.low.frequency.setTargetAtTime(220 + 900 * s, t, 0.15);
    this.gLow.gain.setTargetAtTime(0.04 + 0.35 * s, t, 0.2);
    this.gHigh.gain.setTargetAtTime(Math.max(0, s - 0.45) * 0.18, t, 0.2);
  }
  flap(strength = 1) { this.sfx.noise({ type: 'lowpass', freq: 700, freqEnd: 140, dur: 0.28, gain: Math.min(0.55, 0.2 + 0.12 * strength), attack: 0.03 }); }
  ring(i) {
    const scale = [523, 587, 659, 784, 880, 1047];
    const f = scale[i % scale.length];
    this.sfx.tone({ freq: f, dur: 0.5, gain: 0.18, type: 'triangle' });
    this.sfx.tone({ freq: f * 1.5, dur: 0.6, gain: 0.1, type: 'sine', delay: 0.08 });
    this.sfx.noise({ type: 'highpass', freq: 3000, dur: 0.5, gain: 0.08 });
  }
  finish() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.6, gain: 0.16, type: 'triangle', delay: i * 0.11 })); }
  feather() { [1319, 1568, 2093].forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.25, gain: 0.1, delay: i * 0.06 })); }
  land(hard) { this.sfx.noise({ type: 'lowpass', freq: hard ? 300 : 500, dur: hard ? 0.4 : 0.2, gain: hard ? 0.5 : 0.25 }); }
  stall() { this.sfx.tone({ freq: 140, freqEnd: 90, dur: 0.35, gain: 0.12, type: 'sawtooth' }); }
  click() { this.sfx.tone({ freq: 880, dur: 0.06, gain: 0.08 }); }
  dispose() {
    if (!this.ok) return;
    try { this.src.stop(); } catch { }
    try { this.master.disconnect(); this.src.disconnect(); } catch { }
    this.ok = false;
  }
}
