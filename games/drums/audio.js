// Thunder Drums audio engine: physically-inspired percussion synthesis, HRTF-panned
// per-instrument sources, a shared convolution reverb and a voice limiter.
// All sound is synthesized with WebAudio.

const MAX_VOICES = 26;

function makeIR(ac, seconds) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ac.sampleRate;
      // wooden hall: tail darkens over time (one-pole low-pass with rising smoothing)
      const k = 0.55 + 0.4 * Math.min(1, t / seconds);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * Math.exp(-t * 3.2) * 2.2;
    }
    // a few early reflections off pillars / walls
    const taps = [0.011, 0.019, 0.027, 0.041, 0.053, 0.067];
    for (let j = 0; j < taps.length; j++) {
      const idx = Math.floor((taps[j] + ch * 0.0023 * (j % 2 ? 1 : -1) + 0.003) * ac.sampleRate);
      if (idx > 0 && idx < len) d[idx] += (j % 2 ? -0.5 : 0.6) * (1 - j * 0.12);
    }
  }
  return buf;
}

export class DrumAudio {
  constructor(ac, out) {
    this.ac = ac;
    this.bus = ac.createGain(); this.bus.gain.value = 0.85; this.bus.connect(out);
    this.revIn = ac.createGain();
    this.rev = ac.createConvolver(); this.rev.normalize = true; this.rev.buffer = makeIR(ac, 2.6);
    this.revOut = ac.createGain(); this.revOut.gain.value = 0.42;
    this.revIn.connect(this.rev); this.rev.connect(this.revOut); this.revOut.connect(this.bus);
    this.backBus = ac.createGain(); this.backBus.gain.value = 0.5; this.backBus.connect(this.bus);
    this.backSend = ac.createGain(); this.backSend.gain.value = 0.35; this.backBus.connect(this.backSend); this.backSend.connect(this.revIn);
    const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.noise = nb;
    this.voices = [];
    this.sources = [];
    this.disposed = false;
  }

  // ── spatial sources (one per instrument) ───────────────────
  addSource(send = 0.3) {
    const ac = this.ac;
    const inp = ac.createGain();
    const pan = ac.createPanner();
    pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse';
    pan.refDistance = 0.7; pan.rolloffFactor = 0.9; pan.maxDistance = 40;
    const sg = ac.createGain(); sg.gain.value = send;
    inp.connect(pan); pan.connect(this.bus);
    inp.connect(sg); sg.connect(this.revIn);
    const s = { inp, pan, sg };
    this.sources.push(s);
    return s;
  }
  setSourcePos(s, p) {
    const P = s.pan;
    if (P.positionX) { P.positionX.value = p.x; P.positionY.value = p.y; P.positionZ.value = p.z; }
    else P.setPosition(p.x, p.y, p.z);
  }
  setListener(p, f, u) {
    const L = this.ac.listener;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // ── voice management ───────────────────────────────────────
  reap() {
    const now = this.ac.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.end < now) { try { v.g.disconnect(); } catch { } this.voices.splice(i, 1); }
    }
  }
  _kill(v, now) {
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setValueAtTime(v.g.gain.value, now);
      v.g.gain.linearRampToValueAtTime(0, now + 0.03);
    } catch { }
    for (const s of v.srcs) { try { s.stop(now + 0.04); } catch { } }
    v.end = now + 0.05;
  }
  // A voice: sources → [tone low-pass] → gain → dst. Steals the voice nearest to its end when full.
  _voice(dst, t, dur, gain, lpHz = 0) {
    const ac = this.ac;
    this.reap();
    if (this.voices.length >= MAX_VOICES) {
      let k = 0;
      for (let i = 1; i < this.voices.length; i++) if (this.voices[i].end < this.voices[k].end) k = i;
      const v = this.voices[k]; this._kill(v, ac.currentTime); this.voices.splice(k, 1);
      setTimeout(() => { try { v.g.disconnect(); } catch { } }, 120);
    }
    const g = ac.createGain(); g.gain.value = gain; g.connect(dst);
    let inp = g;
    if (lpHz > 0) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(lpHz, ac.sampleRate * 0.45); lp.Q.value = 0.5; lp.connect(g); inp = lp; }
    const v = { g, inp, end: t + dur, srcs: [] };
    this.voices.push(v);
    return v;
  }
  _osc(v, type, f, t, end) {
    const o = this.ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(end); v.srcs.push(o); return o;
  }
  _noise(v, t, end) {
    const s = this.ac.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(end); v.srcs.push(s); return s;
  }
  // decaying envelope gain; decay = T60-ish seconds
  _env(amp, t, attack, decay, dst) {
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.setTargetAtTime(0, t + attack, Math.max(0.002, decay / 6.9));
    g.connect(dst); return g;
  }
  _filter(type, f, q) { const b = this.ac.createBiquadFilter(); b.type = type; b.frequency.value = Math.min(f, this.ac.sampleRate * 0.45); b.Q.value = q; return b; }
  // noise burst through a filter
  _noiseBurst(v, t, amp, attack, decay, type, f, q, dst) {
    const n = this._noise(v, t, t + attack + decay * 1.2 + 0.02);
    const bf = this._filter(type, f, q);
    n.connect(bf); bf.connect(this._env(amp, t, attack, decay, dst));
  }

  // ── instrument models ─────────────────────────────────────
  // Membrane drum: Bessel-mode partials (1, 1.59, 2.14, 2.30, 2.65, 2.92), pitch drop on attack
  // (tension rises under impact), stick noise. Centre hits favour the fundamental, edge hits the overtones.
  membrane(src, t, vel, r, P) {
    const bright = 0.2 + 0.8 * vel;
    const end = t + P.decay * 1.3 + 0.05;
    const v = this._voice(src.inp, t, end - t, (0.1 + 0.9 * Math.pow(vel, 1.3)) * P.gain, P.lp * (0.35 + 2.4 * vel * vel));
    const center = 1 - Math.min(1, r * r);
    const modes = P.modes;
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      const a = m[1] * (i === 0 ? (0.45 + 0.55 * center) : (0.2 + 1.1 * r) * Math.pow(bright, i * 0.45));
      if (a < 0.015) continue;
      const f = P.f0 * m[0] * (1 + 0.03 * r);
      const o = this._osc(v, 'sine', f * (1 + P.drop * (0.3 + vel)), t, end);
      o.frequency.exponentialRampToValueAtTime(f, t + P.dropTime);
      o.connect(this._env(a, t, 0.002, P.decay * m[2], v.inp));
    }
    // shell / air thump
    if (P.thump) {
      const o = this._osc(v, 'sine', P.f0 * 0.62 * (1 + 0.5 * vel), t, t + 0.5);
      o.frequency.exponentialRampToValueAtTime(P.f0 * 0.55, t + 0.12);
      o.connect(this._env(P.thump * (0.5 + 0.5 * center), t, 0.004, 0.35, v.inp));
    }
    this._noiseBurst(v, t, P.noiseAmp * (0.3 + 0.9 * bright), 0.001, P.noiseDecay * (0.6 + 0.6 * vel), 'bandpass', P.noiseF * (0.5 + 1.8 * bright), 0.7, v.inp);
    if (r > 0.82) this._noiseBurst(v, t, 0.25 * bright, 0.0005, 0.02, 'highpass', 2500, 0.7, v.inp);
  }

  // Wood: two strongly damped modes + click. Used for wooden fish, temple block and taiko rim ("ka").
  wood(src, t, vel, P) {
    const bright = 0.25 + 0.75 * vel;
    const end = t + P.decay * 2 + 0.05;
    const v = this._voice(src.inp, t, end - t, (0.12 + 0.88 * Math.pow(vel, 1.2)) * P.gain, 1500 + 9000 * vel);
    const modes = P.modes;
    for (let i = 0; i < modes.length; i++) {
      const m = modes[i];
      const a = m[1] * (i === 0 ? 1 : Math.pow(bright, 1 + i * 0.5));
      const f = P.f0 * m[0];
      const o = this._osc(v, 'sine', f * (1 + 0.04 * vel), t, end);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
      o.connect(this._env(a, t, 0.001, P.decay * m[2], v.inp));
    }
    this._noiseBurst(v, t, 0.35 * bright, 0.0005, 0.012, 'bandpass', P.click * (0.7 + 0.6 * bright), 1.4, v.inp);
  }

  // Bian-zhong bell: inharmonic partial set with two strike tones. A front-centre (sui) hit rings the
  // main tone; a side (gu) hit rings the second tone a minor third above. Harder = more high partials.
  bell(src, t, vel, f0, side, low) {
    const R = [1, 1.19, 2.01, 2.43, 3.02, 4.13, 5.32, 6.71, 8.4];
    const A_SUI = [1, 0.22, 0.5, 0.25, 0.32, 0.17, 0.1, 0.06, 0.035];
    const A_GU = [0.3, 1, 0.28, 0.48, 0.22, 0.27, 0.11, 0.07, 0.04];
    const bright = 0.15 + 0.85 * vel;
    const dec = 3.4 * Math.pow(300 / f0, 0.35) * (0.85 + 0.3 * low);
    const end = t + dec * 1.1 + 0.05;
    const v = this._voice(src.inp, t, end - t, 0.06 + 0.5 * Math.pow(vel, 1.25));
    const amps = side ? A_GU : A_SUI;
    for (let i = 0; i < R.length; i++) {
      const f = f0 * R[i];
      if (f > 15000) break;
      const a = amps[i] * (i < 2 ? 1 : Math.pow(bright, (i - 1) * 0.55)) * (1 - 0.35 * low * (i > 3));
      if (a < 0.01) continue;
      const o = this._osc(v, 'sine', f, t, end);
      o.connect(this._env(a, t, 0.0015, dec * Math.pow(1 / R[i], 0.6), v.inp));
      if (i === (side ? 1 : 0)) { // beating pair: slow shimmer on the main tone
        const o2 = this._osc(v, 'sine', f + 0.9 + f * 0.0012, t, end);
        o2.connect(this._env(a * 0.45, t, 0.002, dec * 0.8, v.inp));
      }
    }
    this._noiseBurst(v, t, 0.18 * bright * bright, 0.0005, 0.025, 'bandpass', 3500 + 3000 * vel, 1.5, v.inp);
  }

  // Gong: inharmonic plate modes whose upper partials "bloom" after the strike (energy cascades
  // upward, more so when hit harder) plus a filtered noise wash. Big gong pitch falls; the
  // small opera gong's pitch rises.
  gong(src, t, vel, r, P) {
    const bright = 0.2 + 0.8 * vel;
    const end = t + P.decay * 1.05 + 0.1;
    const v = this._voice(src.inp, t, end - t, (0.08 + 0.75 * Math.pow(vel, 1.2)) * P.gain, P.lp * (0.4 + 1.8 * vel));
    const center = 1 - Math.min(1, r * r);
    const R = P.ratios;
    for (let i = 0; i < R.length; i++) {
      const f = P.f0 * R[i];
      const a = P.amps[i] * (i === 0 ? (0.35 + 0.65 * center) : (0.4 + 0.8 * r) * Math.pow(bright, i * 0.3));
      if (a < 0.01) continue;
      const o = this._osc(v, 'sine', f, t, end);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * P.glide, t + P.glideTime);
      const bloom = i === 0 ? 0.003 : 0.003 + P.bloom * (i / R.length) * vel;
      o.connect(this._env(a, t, bloom, P.decay * Math.pow(1 / R[i], 0.45), v.inp));
    }
    if (P.wash) {
      const n = this._noise(v, t, end);
      const bf = this._filter('bandpass', P.washF * (0.6 + 1.1 * bright), 0.9);
      n.connect(bf); bf.connect(this._env(P.wash * bright * (0.4 + 0.8 * r), t, 0.06 + 0.25 * vel, P.decay * 0.45, v.inp));
    }
    this._noiseBurst(v, t, 0.2 * bright, 0.0005, 0.03, 'bandpass', 1800 + 2500 * vel, 1, v.inp);
  }

  // Cymbal: noise burst through high-pass/band filters + a cluster of inharmonic square waves
  // (metallic ring). Edge = crash wash, centre bell = clear ping. Harder = brighter and longer.
  cymbal(src, t, vel, r, P) {
    const bright = 0.2 + 0.8 * vel;
    const bellHit = r < 0.3;
    const dec = P.decay * (0.45 + 0.75 * vel) * (bellHit ? 0.6 : 0.6 + 0.5 * r);
    const end = t + dec * 1.1 + 0.05;
    const v = this._voice(src.inp, t, end - t, (0.06 + 0.55 * Math.pow(vel, 1.15)) * P.gain);
    // metallic square cluster
    const F = [205.3, 304.4, 369.6, 522.7, 540, 800];
    const mix = this.ac.createGain(); mix.gain.value = 0.16;
    const hp = this._filter('highpass', P.hp * (0.55 + 0.6 * bright), 0.7);
    const bp = this._filter('peaking', P.peak, 1.2); bp.gain.value = 6;
    mix.connect(hp); hp.connect(bp);
    bp.connect(this._env(bellHit ? 0.35 : 0.8, t, 0.001, dec, v.inp));
    for (let i = 0; i < F.length; i++) this._osc(v, 'square', F[i] * P.scale, t, end).connect(mix);
    // noise wash
    const n = this._noise(v, t, end);
    const nf = this._filter('highpass', 2500 + 5000 * bright * (bellHit ? 1.3 : 1), 0.6);
    n.connect(nf); nf.connect(this._env((bellHit ? 0.25 : 0.7) * bright, t, 0.001, dec * 0.8, v.inp));
    // bell ping
    if (bellHit || r < 0.45) {
      const pa = bellHit ? 0.5 : 0.18;
      const PR = [1, 1.49, 2.32];
      for (let i = 0; i < PR.length; i++) this._osc(v, 'sine', P.ping * PR[i], t, end).connect(this._env(pa / (i + 1), t, 0.001, 1.2, v.inp));
    }
  }

  // ── backing band (non-spatial) ─────────────────────────────
  kick(t, acc = 1) {
    const v = this._voice(this.backBus, t, 0.6, 0.55 * acc);
    const o = this._osc(v, 'sine', 95, t, t + 0.55);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.09);
    o.connect(this._env(1, t, 0.003, 0.45, v.inp));
    this._noiseBurst(v, t, 0.15, 0.001, 0.03, 'lowpass', 900, 0.7, v.inp);
  }
  shaker(t, acc = 1) {
    const v = this._voice(this.backBus, t, 0.12, 0.18 * acc);
    this._noiseBurst(v, t, 1, 0.006, 0.06, 'highpass', 6500, 0.8, v.inp);
  }
  // plucked zither: detuned saw + triangle through a closing low-pass
  pluck(t, f, acc = 1, slide = false) {
    const ac = this.ac;
    const v = this._voice(this.backBus, t, 1.4, 0.14 * acc);
    const lp = this._filter('lowpass', 4200, 2);
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.8), t + 0.35);
    lp.connect(this._env(1, t, 0.002, 1.2, v.inp));
    const a = this._osc(v, 'sawtooth', slide ? f * 0.94 : f, t, t + 1.35);
    const b = this._osc(v, 'triangle', (slide ? f * 0.94 : f) * 1.003, t, t + 1.35);
    if (slide) { a.frequency.exponentialRampToValueAtTime(f, t + 0.07); b.frequency.exponentialRampToValueAtTime(f * 1.003, t + 0.07); }
    const bg = ac.createGain(); bg.gain.value = 0.7; b.connect(bg); bg.connect(lp); a.connect(lp);
  }
  pad(t, f, dur) {
    const v = this._voice(this.backBus, t, dur + 0.8, 0.05);
    const lp = this._filter('lowpass', 700, 0.5);
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.7);
    g.gain.setValueAtTime(1, t + dur - 0.4); g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    lp.connect(g); g.connect(v.inp);
    for (const m of [1, 1.5, 2.003]) this._osc(v, 'triangle', f * m, t, t + dur + 0.7).connect(lp);
  }
  click(t, accent) {
    const v = this._voice(this.bus, t, 0.08, accent ? 0.22 : 0.13);
    this._osc(v, 'sine', accent ? 1760 : 1175, t, t + 0.07).connect(this._env(1, t, 0.001, 0.05, v.inp));
  }

  stopAll() {
    const now = this.ac.currentTime;
    for (const v of this.voices) this._kill(v, now);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    try { this.bus.disconnect(); } catch { }
    for (const s of this.sources) { try { s.inp.disconnect(); s.pan.disconnect(); s.sg.disconnect(); } catch { } }
    try { this.revIn.disconnect(); this.rev.disconnect(); this.revOut.disconnect(); this.backBus.disconnect(); this.backSend.disconnect(); } catch { }
    for (const v of this.voices) { try { v.g.disconnect(); } catch { } }
    this.voices.length = 0;
    // leave the shared listener at a neutral pose for the next game
    try { this.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }); } catch { }
  }
}

// Instrument parameter presets
export const PRESETS = {
  taiko: { f0: 64, drop: 0.45, dropTime: 0.09, decay: 1.5, gain: 0.85, lp: 2200, thump: 0.6, noiseF: 700, noiseAmp: 0.4, noiseDecay: 0.07,
    modes: [[1, 1, 1], [1.59, 0.55, 0.45], [2.14, 0.38, 0.32], [2.30, 0.26, 0.28], [2.65, 0.2, 0.22], [2.92, 0.14, 0.18]] },
  tomL: { f0: 150, drop: 0.3, dropTime: 0.06, decay: 0.6, gain: 0.8, lp: 3000, thump: 0.25, noiseF: 1300, noiseAmp: 0.35, noiseDecay: 0.05,
    modes: [[1, 1, 1], [1.59, 0.5, 0.5], [2.14, 0.35, 0.35], [2.30, 0.25, 0.3], [2.65, 0.15, 0.25]] },
  tomR: { f0: 196, drop: 0.3, dropTime: 0.05, decay: 0.5, gain: 0.8, lp: 3400, thump: 0.2, noiseF: 1500, noiseAmp: 0.35, noiseDecay: 0.045,
    modes: [[1, 1, 1], [1.59, 0.5, 0.5], [2.14, 0.35, 0.35], [2.30, 0.25, 0.3], [2.65, 0.15, 0.25]] },
  ka: { f0: 1250, decay: 0.05, gain: 0.55, click: 3200, modes: [[1, 1, 1], [2.4, 0.4, 0.6]] },
  muyu: { f0: 360, decay: 0.16, gain: 0.85, click: 1900, modes: [[1, 1, 1], [1.72, 0.35, 0.6], [2.95, 0.2, 0.4]] },
  block: { f0: 880, decay: 0.08, gain: 0.7, click: 3000, modes: [[1, 1, 1], [2.31, 0.4, 0.6], [3.9, 0.18, 0.4]] },
  gong: { f0: 92, glide: 0.93, glideTime: 1.0, decay: 7, gain: 0.7, lp: 3500, bloom: 0.55, wash: 0.22, washF: 2200,
    ratios: [1, 1.43, 1.89, 2.35, 2.87, 3.55, 4.41, 5.3, 6.63], amps: [1, 0.55, 0.5, 0.42, 0.35, 0.3, 0.22, 0.16, 0.1] },
  luo: { f0: 470, glide: 1.16, glideTime: 0.2, decay: 1.5, gain: 0.7, lp: 7000, bloom: 0.05, wash: 0.08, washF: 3500,
    ratios: [1, 1.52, 2.27, 2.96, 3.9], amps: [1, 0.4, 0.3, 0.2, 0.12] },
  cymL: { decay: 1.8, gain: 2.3, scale: 1.4, hp: 6500, peak: 8500, ping: 1760 },
  cymR: { decay: 2.8, gain: 2.6, scale: 1.0, hp: 4800, peak: 6200, ping: 1320 },
};
