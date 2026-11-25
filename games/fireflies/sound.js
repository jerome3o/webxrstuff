// Night ambience, generative pentatonic music and chimes (WebAudio only, no assets).
const BASE = 146.83; // D3
const SCALE = [0, 2, 4, 7, 9]; // D major pentatonic
// chord progression (semitones from D3): D, Bm7, Gadd9, Asus
const CHORDS = [[0, 7, 12, 16], [-3, 4, 9, 12], [-7, 2, 5, 9], [-5, 2, 7, 12]];
const CHORD_TONES = [[0, 4, 7, 12, 16, 19], [-3, 2, 7, 9, 14], [-5, 2, 7, 11, 14], [-5, 2, 7, 9, 14]];
const BEAT = 0.75;
const hz = (semi) => BASE * Math.pow(2, semi / 12);

export class GardenAudio {
  constructor(audio) {
    this.audio = audio; this.ctx = null; this.on = false;
    this.music = true; this.intensity = 0; this.sources = []; this.timers = 0;
    this.nextBeat = 0; this.beat = 0; this.chord = 0; this.frogT = 6; this.owlT = 20;
  }
  // Lazily start once the shared AudioContext exists.
  ensure() {
    if (this.on) return true;
    const ctx = this.audio?.ctx; if (!ctx || !this.audio.out) return false;
    this.ctx = ctx; this.on = true;
    const now = ctx.currentTime;
    this.master = ctx.createGain(); this.master.gain.setValueAtTime(0.0001, now); this.master.gain.exponentialRampToValueAtTime(0.9, now + 2.5);
    this.master.connect(this.audio.out);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.music ? 0.55 : 0; this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.5; this.ambBus.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.8; this.sfxBus.connect(this.master);
    // reverb
    this.verb = ctx.createConvolver(); this.verb.buffer = this._impulse(2.2);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.45;
    this.verb.connect(this.verbGain).connect(this.master);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 1; this.verbSend.connect(this.verb);
    // feedback echo for melody
    this.echo = ctx.createDelay(1.5); this.echo.delayTime.value = BEAT * 1.5;
    this.echoFb = ctx.createGain(); this.echoFb.gain.value = 0.35;
    const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 2200;
    this.echo.connect(echoLp).connect(this.echoFb).connect(this.echo);
    echoLp.connect(this.musicBus);
    this._noiseBuf = this._noise(2);
    this._startAmbience();
    this.nextBeat = now + 0.5;
    return true;
  }
  _impulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    return b;
  }
  _noise(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _startAmbience() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    // crickets: a 4 s stereo loop of chirp trains
    const len = Math.floor(sr * 4), buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let v = 0; v < 3; v++) {
        const f = 3900 + Math.random() * 1300, amp = 0.05 + Math.random() * 0.05;
        let t = Math.random() * 0.5;
        while (t < 3.8) {
          const pulses = 3 + Math.floor(Math.random() * 3);
          for (let p = 0; p < pulses; p++) {
            const s0 = Math.floor((t + p * 0.032) * sr), s1 = Math.min(len, s0 + Math.floor(0.018 * sr));
            for (let s = s0; s < s1; s++) { const e = Math.sin(Math.PI * (s - s0) / (s1 - s0)); d[s] += Math.sin(2 * Math.PI * f * s / sr) * e * amp; }
          }
          t += 0.35 + Math.random() * 0.9;
        }
      }
    }
    const cr = ctx.createBufferSource(); cr.buffer = buf; cr.loop = true;
    const crg = ctx.createGain(); crg.gain.value = 0.6;
    cr.connect(crg).connect(this.ambBus); cr.start();
    // a second, slower, more distant cricket layer
    const cr2 = ctx.createBufferSource(); cr2.buffer = buf; cr2.loop = true; cr2.playbackRate.value = 0.83;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
    const crg2 = ctx.createGain(); crg2.gain.value = 0.35;
    cr2.connect(lp).connect(crg2).connect(this.ambBus); cr2.start(ctx.currentTime + 1.3);
    // breeze: filtered noise with slow LFO
    const wn = ctx.createBufferSource(); wn.buffer = this._noiseBuf; wn.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380; wf.Q.value = 0.4;
    const wg = ctx.createGain(); wg.gain.value = 0.11;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.06;
    lfo.connect(lfoG).connect(wg.gain);
    wn.connect(wf).connect(wg).connect(this.ambBus); wn.start(); lfo.start();
    this.sources.push(cr, cr2, wn, lfo);
  }
  setMusic(on) {
    this.music = on;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.4);
  }
  // Listener follows the head (positional chimes).
  setListener(pos, fwd, up) {
    if (!this.on) return;
    const L = this.ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }
  _dest(pos, bus, gain = 1) {
    const g = this.ctx.createGain(); g.gain.value = gain;
    if (pos) {
      const p = this.ctx.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 1.2; p.rolloffFactor = 0.8;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(bus);
    } else g.connect(bus);
    return g;
  }
  _voice(freq, t, { dur = 1, gain = 0.1, type = 'sine', attack = 0.01, dest, detune = 0 }) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + attack + dur + 0.05);
    return g;
  }
  update(dt, intensity) {
    if (!this.ensure()) return;
    this.intensity = intensity;
    const ctx = this.ctx, now = ctx.currentTime;
    if (this.nextBeat < now - 1) this.nextBeat = now + 0.1; // tab was hidden
    while (this.nextBeat < now + 0.25) { this._beat(this.nextBeat); this.nextBeat += BEAT; }
    // occasional frog / owl
    this.frogT -= dt; this.owlT -= dt;
    if (this.frogT < 0) { this.frogT = 7 + Math.random() * 12; this._frog(now); }
    if (this.owlT < 0) { this.owlT = 25 + Math.random() * 30; this._owl(now); }
  }
  _beat(t) {
    const b = this.beat++;
    if (b % 8 === 0) {
      this.chord = (b / 8) % 4;
      if (this.music) this._pad(t, CHORDS[this.chord]);
    }
    if (!this.music) return;
    const p = 0.18 + this.intensity * 0.55;
    if (Math.random() < p) {
      const tones = CHORD_TONES[this.chord];
      let semi = Math.random() < 0.7 ? tones[Math.floor(Math.random() * tones.length)] : SCALE[Math.floor(Math.random() * 5)] + 12;
      semi += 12;
      const off = Math.random() < 0.3 ? BEAT * 0.5 : 0;
      this._pluck(hz(semi), t + off, 0.07 + Math.random() * 0.03);
    }
    if (b % 8 === 0 || (b % 8 === 4 && this.intensity > 0.4)) this._bass(t, CHORDS[this.chord][0] - 12);
  }
  _pad(t, notes) {
    const ctx = this.ctx, dur = BEAT * 8;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700 + this.intensity * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 2.2);
    g.gain.setValueAtTime(0.05, t + dur - 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 2.5);
    lp.connect(g); g.connect(this.musicBus); g.connect(this.verbSend);
    for (const n of notes) {
      for (const [type, det] of [['sine', -6], ['triangle', 7]]) {
        const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz(n); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 2.6);
      }
    }
  }
  _pluck(f, t, gain) {
    const ctx = this.ctx;
    const out = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (out.pan) out.pan.value = Math.random() * 1.4 - 0.7;
    out.connect(this.musicBus); out.connect(this.verbSend); out.connect(this.echo);
    this._voice(f, t, { dur: 1.6, gain, attack: 0.004, dest: out });
    this._voice(f * 2, t, { dur: 0.5, gain: gain * 0.35, attack: 0.003, dest: out });
    this._voice(f * 3.01, t, { dur: 0.18, gain: gain * 0.2, attack: 0.002, dest: out, type: 'triangle' });
  }
  _bass(t, semi) {
    const g = this.ctx.createGain(); g.gain.value = 1; g.connect(this.musicBus);
    this._voice(hz(semi), t, { dur: BEAT * 3.5, gain: 0.09, attack: 0.08, dest: g });
  }
  // FM bell
  _bell(f, t, gain, pos) {
    const ctx = this.ctx, dest = this._dest(pos, this.sfxBus, 1);
    dest.connect(this.verbSend);
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
    car.frequency.value = f; mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.8);
    mod.connect(mg).connect(car.frequency);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    car.connect(g).connect(dest);
    car.start(t); mod.start(t); car.stop(t + 3.3); mod.stop(t + 3.3);
  }
  // Lantern lit: arpeggio of the current chord, an octave or two up.
  chime(pos, k = 0) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + 0.02, tones = CHORD_TONES[this.chord];
    for (let i = 0; i < 3; i++) {
      const semi = tones[(k + i * 2) % tones.length] + 24;
      this._bell(hz(semi), t + i * 0.16, 0.12 - i * 0.02, pos);
    }
  }
  // Firefly accepted into a lantern: a single soft bell on a scale tone.
  ding(pos, k = 0) {
    if (!this.ensure()) return;
    const tones = CHORD_TONES[this.chord];
    this._bell(hz(tones[k % tones.length] + 24), this.ctx.currentTime + 0.01, 0.05, pos);
  }
  fanfare() {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime + 0.05;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this._bell(hz(s + 24), t + i * 0.13, 0.08, null));
  }
  grab(pos) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime, d = this._dest(pos, this.sfxBus);
    this._voice(1320 + Math.random() * 200, t, { dur: 0.12, gain: 0.05, dest: d });
    this._voice(1980, t + 0.03, { dur: 0.1, gain: 0.03, dest: d });
  }
  release(pos) { this._whoosh(pos, 0.06, 900, 2400); }
  reject(pos) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime, d = this._dest(pos, this.sfxBus);
    this._voice(330, t, { dur: 0.25, gain: 0.05, dest: d, type: 'triangle' });
    this._voice(311, t + 0.12, { dur: 0.3, gain: 0.04, dest: d, type: 'triangle' });
  }
  squeeze(pos) {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime, d = this._dest(pos, this.sfxBus); d.connect(this.verbSend);
    for (let i = 0; i < 5; i++) this._voice(hz(SCALE[i] + 24), t + i * 0.05, { dur: 0.6, gain: 0.04, dest: d });
  }
  splash(pos) {
    if (!this.ensure()) return;
    this._whoosh(pos, 0.25, 1600, 300, 0.25);
  }
  _whoosh(pos, gain, f0, f1, dur = 0.35) {
    if (!this.ensure()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this._noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this._dest(pos, this.sfxBus)); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _frog(t) {
    const g = this.ctx.createGain(); g.gain.value = 1;
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.random() * 1.6 - 0.8; g.connect(p).connect(this.ambBus); } else g.connect(this.ambBus);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.connect(g);
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) this._voice(150 + Math.random() * 30, t + i * 0.22, { dur: 0.09, gain: 0.12, type: 'square', dest: lp, attack: 0.01 });
  }
  _owl(t) {
    const g = this.ctx.createGain(); g.gain.value = 1; g.connect(this.ambBus); g.connect(this.verbSend);
    this._voice(392, t, { dur: 0.35, gain: 0.035, dest: g, attack: 0.06 });
    this._voice(370, t + 0.55, { dur: 0.7, gain: 0.03, dest: g, attack: 0.08 });
  }
  dispose() {
    if (!this.on) return;
    for (const s of this.sources) { try { s.stop(); } catch { } }
    try {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(this.master.gain.value, t); this.master.gain.linearRampToValueAtTime(0, t + 0.15);
      const m = this.master; setTimeout(() => { try { m.disconnect(); } catch { } }, 300);
    } catch { }
    this.on = false;
  }
}
