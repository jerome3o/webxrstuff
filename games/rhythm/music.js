// Procedural songs for Lantern Rush.
// A song is generated deterministically from a seed into one 16th-note grid. The same grid produces
// both the audio events (drums, bass, pad, pentatonic lead) and the note chart, so every lantern lands
// exactly on a musical step. Audio is scheduled ahead on the AudioContext clock by Conductor.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Directions: required swing direction (screen space, +y up). 8 = any direction.
export const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0], [-0.7071, 0.7071], [0.7071, 0.7071], [-0.7071, -0.7071], [0.7071, -0.7071]];
export const D = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, UL: 4, UR: 5, DL: 6, DR: 7, ANY: 8 };

export const SONGS = [
  {
    id: 'moon', title: 'Paper Moon Drift', cn: '纸月', mood: 'Mellow · zither pluck', bpm: 92, seed: 1103,
    mode: 'minor', root: 50, timbre: 'pluck', stars: 1, speed: 8, gap: 1.0, anyP: 0.22, bombP: 0.25,
    sections: [[4, 0], [8, 1], [8, 2, 'walls'], [4, 1], [6, 3, 'walls'], [2, 1]],
  },
  {
    id: 'lotus', title: 'Lotus Current', cn: '莲流', mood: 'Bright · bamboo flute', bpm: 116, seed: 2207,
    mode: 'major', root: 53, timbre: 'flute', stars: 2, speed: 10, gap: 1.0, anyP: 0.14, bombP: 0.45,
    sections: [[4, 0], [8, 1], [8, 2, 'walls'], [4, 1], [8, 3, 'walls'], [4, 2], [2, 1]],
  },
  {
    id: 'fire', title: 'Firecracker Alley', cn: '爆竹巷', mood: 'Driving · square lead', bpm: 144, seed: 3301,
    mode: 'minor', root: 52, timbre: 'square', stars: 3, speed: 12, gap: 0.5, anyP: 0.1, bombP: 0.6,
    sections: [[4, 0], [8, 2], [8, 3, 'walls'], [4, 1], [8, 3, 'walls'], [8, 3], [4, 2, 'walls'], [2, 1]],
  },
];

const MAJOR = [0, 2, 4, 7, 9], MINOR = [0, 3, 5, 7, 10];

// Returns { bpm, spb, duration, events (audio), notes (chart), walls, kicks (times), beats }.
export function buildSong(def, hard) {
  const R = mulberry32(def.seed);
  const spb = 60 / def.bpm, s16 = spb / 4;
  const scale = def.mode === 'major' ? MAJOR : MINOR;
  const progs = def.mode === 'major' ? [[0, 7, 9, 5], [0, 5, 9, 7], [9, 5, 0, 7]] : [[0, 8, 10, 7], [0, 10, 8, 10], [0, 5, 8, 7]];
  const prog = progs[Math.floor(R() * progs.length)];
  const fourFloor = def.bpm >= 130;
  const events = [];
  const steps = []; // per 16th: { t, kick, snare, lead (midi or 0), int, sec, barInSec, walls }
  const degToSemi = (d) => scale[((d % 5) + 5) % 5] + 12 * Math.floor(d / 5);
  const extraKick = [6, 10, 14, 3, 11][Math.floor(R() * 5)];
  let bar = 0;
  for (let si = 0; si < def.sections.length; si++) {
    const [bars, int, flag] = def.sections[si];
    // 2-bar lead motif for this section
    const motif = [];
    const dens = [0.0, 0.42, 0.55, 0.68][int];
    let deg = 4 + Math.floor(R() * 3);
    for (let s = 0; s < 32; s += 2) {
      if (s === 0 || R() < dens) {
        const r = R();
        deg += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.82 ? 2 : r < 0.94 ? -2 : (R() < 0.5 ? 3 : -3);
        deg = Math.max(1, Math.min(10, deg));
        motif.push({ s, deg });
      }
    }
    for (let i = 0; i < motif.length; i++) motif[i].len = Math.min(6, ((motif[i + 1]?.s ?? 32) - motif[i].s));
    for (let b = 0; b < bars; b++, bar++) {
      const chord = prog[bar % 4];
      const barT = bar * 16 * s16;
      const fill = b === bars - 1 && int >= 1 && si < def.sections.length - 1;
      // pad chord
      const third = def.mode === 'major' ? 4 : 3;
      events.push({ t: barT, type: 'pad', n: [def.root + 12 + chord, def.root + 12 + chord + 7, def.root + 24 + chord + third], d: 16 * s16, v: int === 0 ? 0.8 : 0.55 });
      // chord shift in scale degrees for the lead
      let shift = scale.indexOf(chord % 12); if (shift < 0) shift = 0;
      if (b % 4 === 3 && R() < 0.5) shift += 1;
      for (let s = 0; s < 16; s++) {
        const t = barT + s * s16;
        let kick = false, snare = false, lead = 0, hat = 0;
        if (int === 0) { kick = s === 0 || (b >= 2 && s === 8); }
        else {
          kick = fourFloor ? s % 4 === 0 : (s === 0 || s === 8 || (s === extraKick && int >= 2));
          if (int >= 3 && s === 14 && b % 2 === 1) kick = true;
          snare = s === 4 || s === 12;
          if (fill && s >= 12) snare = true;
          if (int >= 3 && (s === 7 || s === 15) && R() < 0.25) events.push({ t, type: 'snare', v: 0.25 });
          hat = s % 2 === 0 ? (s % 4 === 0 ? 0.5 : 0.8) : (int >= 2 ? 0.35 : 0);
          if (s === 14 && int >= 2 && b % 2 === 1) hat = -1; // open
        }
        if (kick) events.push({ t, type: 'kick', v: int === 0 ? 0.7 : 1 });
        if (snare) events.push({ t, type: 'snare', v: fill && s >= 12 ? 0.45 + (s - 12) * 0.15 : 0.9 });
        if (hat > 0) events.push({ t, type: 'hat', v: hat });
        if (hat < 0) events.push({ t, type: 'ohat', v: 0.7 });
        // bass
        if (int >= 1) {
          const pat = fourFloor ? (s % 4 === 2) : (s === 0 || s === 6 || s === 10 || (int >= 2 && s === 14));
          if (pat) {
            const oct = fourFloor ? 0 : (s === 10 ? 12 : 0);
            events.push({ t, type: 'bass', n: def.root - 12 + chord + oct, d: s16 * (fourFloor ? 2 : 3), v: 0.9 });
          }
        } else if (s === 0 && b >= 2) events.push({ t, type: 'bass', n: def.root - 12 + chord, d: s16 * 12, v: 0.6 });
        // lead
        if (int >= 1) {
          const ms = (b % 2) * 16 + s;
          const m = motif.find(x => x.s === ms);
          if (m && !(fill && s >= 12)) {
            lead = def.root + 24 + degToSemi(m.deg + shift);
            events.push({ t, type: 'lead', n: lead, d: m.len * s16, v: 0.8 });
          }
        }
        steps.push({ t, kick, snare, lead, int, s, bar, b, flag });
      }
    }
  }
  const duration = bar * 16 * s16;
  events.sort((a, b) => a.t - b.t);

  // ── chart from the same grid ──
  const C = mulberry32(def.seed * 7 + (hard ? 13 : 1));
  const notes = [], walls = [];
  const gapBeats = hard ? def.gap * 0.5 + 0.25 : def.gap + (def.stars === 1 ? 0.5 : 0);
  const handGap = Math.max(gapBeats * 1.5, hard ? 0.75 : 1.25) * spb;
  const lastHand = [-99, -99], parity = [1, 1]; // next swing: 1 = down, 0 = up
  let lastT = -99, hand = 0, leadLo = 999, leadHi = 0;
  for (const st of steps) if (st.lead) { leadLo = Math.min(leadLo, st.lead); leadHi = Math.max(leadHi, st.lead); }
  const leadMid = (leadLo + leadHi) / 2;
  // walls first: two per flagged section
  for (const st of steps) {
    if (st.flag === 'walls' && st.s === 0 && (st.b === 1 || st.b === 5)) {
      const types = ['left', 'right', 'top'];
      const type = types[Math.floor(C() * 3)];
      const dur = (hard ? 3 : 2) * spb;
      walls.push({ t: st.t + 2 * spb, dur, type });
    }
  }
  const blocked = (t, col, row) => {
    for (const w of walls) {
      if (t > w.t - spb * 0.75 && t < w.t + w.dur + spb * 0.5) {
        if (w.type === 'left' && col <= 1) return true;
        if (w.type === 'right' && col >= 2) return true;
        if (w.type === 'top' && row >= 1) return true;
      }
    }
    return false;
  };
  const firstT = 2 * 16 * s16;
  for (const st of steps) {
    if (st.t < firstT || st.t > duration - 2 * spb) continue;
    if (st.s % 2 === 1) continue;
    const onBeat = st.s % 4 === 0;
    let str = (onBeat ? 2 : 0) + (st.kick ? 2 : 0) + (st.snare ? 3 : 0) + (st.lead ? 2 : 0);
    const need = st.int === 0 ? 5 : st.int === 1 ? (hard ? 3 : 4) : st.int === 2 ? (hard ? 2 : 3) : 2;
    if (str < need) continue;
    const g = (st.int <= 1 ? gapBeats * (hard ? 1.5 : 2) : gapBeats) * spb;
    if (st.t - lastT < g - 1e-4) continue;
    const dbl = st.snare && st.int >= 2 && C() < (hard ? 0.45 : 0.3);
    let hands;
    if (dbl) hands = [0, 1];
    else {
      let h = 1 - hand;
      if (C() < 0.2) h = hand;
      if (st.t - lastHand[h] < handGap) h = 1 - h;
      if (st.t - lastHand[h] < handGap) continue;
      hands = [h];
    }
    if (dbl && (st.t - lastHand[0] < handGap * 0.8 || st.t - lastHand[1] < handGap * 0.8)) continue;
    const high = st.lead && st.lead > leadMid;
    let placed = false;
    for (const h of hands) {
      const down = parity[h] === 1;
      let dir = down ? D.DOWN : D.UP;
      const r = C();
      let row = down ? 1 : 0;
      if (high) row += 1;
      let col = h === 0 ? (C() < 0.6 ? 1 : 0) : (C() < 0.6 ? 2 : 3);
      if (r < def.anyP) dir = D.ANY;
      else if (r < def.anyP + 0.22) dir = down ? (h === 0 ? D.DL : D.DR) : (h === 0 ? D.UL : D.UR);
      else if (r < def.anyP + 0.3 && !dbl) { dir = h === 0 ? D.LEFT : D.RIGHT; row = 1; col = h === 0 ? 0 : 3; }
      if (dbl) row = down ? 1 : 0;
      row = Math.min(2, row);
      if (blocked(st.t, col, row)) { col = h === 0 ? 2 : 1; if (blocked(st.t, col, row)) { row = 0; if (blocked(st.t, col, row)) continue; } }
      notes.push({ t: st.t, hand: h, dir, col, row, bomb: false });
      parity[h] = dir === D.LEFT || dir === D.RIGHT ? 1 : 1 - parity[h];
      lastHand[h] = st.t; hand = h; placed = true;
    }
    if (placed) lastT = st.t;
  }
  // bombs: on off-beats in busy sections, on the side whose hand is resting
  const busy = (t, col, row) => notes.some(n => !n.bomb && Math.abs(n.t - t) < spb * 1.1 && n.col === col && Math.abs(n.row - row) <= 1);
  const bombRate = Math.min(0.9, def.bombP * (hard ? 1.2 : 1.0));
  for (const st of steps) {
    if (st.int < 2 || (st.s !== 10 && st.s !== 2) || C() > bombRate) continue;
    let nearest = null, nd = 1e9;
    for (const n of notes) { const d = Math.abs(n.t - st.t); if (!n.bomb && d < nd) { nd = d; nearest = n; } }
    if (!nearest || nd < spb * 0.4) continue;
    const col = nearest.hand === 0 ? (C() < 0.5 ? 3 : 2) : (C() < 0.5 ? 0 : 1);
    const row = C() < 0.5 ? 2 : 0;
    if (busy(st.t, col, row) || blocked(st.t, col, row)) continue;
    notes.push({ t: st.t, hand: -1, dir: D.ANY, col, row, bomb: true });
  }
  notes.sort((a, b) => a.t - b.t);
  const kicks = events.filter(e => e.type === 'kick' || e.type === 'snare').map(e => e.t);
  return { def, hard, bpm: def.bpm, spb, s16, duration, events, notes, walls, kicks, speed: def.speed * (hard ? 1.15 : 1) };
}

// ── Synth + lookahead scheduler on the AudioContext clock ───────────
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Conductor {
  constructor(actx, out, noise) {
    this.actx = actx; this.out = out; this.noise = noise;
    this.song = null; this.bus = null; this.idx = 0; this.t0 = 0; this.timer = null;
  }
  // Start the song so that song time 0 plays at AudioContext time `when`.
  start(song, when) {
    this.stop(0);
    const a = this.actx;
    this.song = song; this.t0 = when; this.idx = 0;
    const bus = this.bus = a.createGain(); bus.gain.value = 0.75; bus.connect(this.out);
    this.drums = a.createGain(); this.drums.gain.value = 0.9; this.drums.connect(bus);
    this.leadBus = a.createGain(); this.leadBus.gain.value = 0.5; this.leadBus.connect(bus);
    // dotted-eighth echo on the lead
    const dl = a.createDelay(2); dl.delayTime.value = song.spb * 0.75;
    const fb = a.createGain(); fb.gain.value = 0.32;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const wet = a.createGain(); wet.gain.value = 0.35;
    this.leadBus.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(wet); wet.connect(bus);
    this.padBus = a.createGain(); this.padBus.gain.value = 0.16;
    const plp = a.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 1100;
    this.padBus.connect(plp); plp.connect(bus);
    this.pump();
    this.timer = setInterval(() => this.pump(), 25);
  }
  pump() {
    if (!this.song || this.actx.state !== 'running') return;
    const ev = this.song.events, now = this.actx.currentTime;
    const horizon = now - this.t0 + 0.25;
    while (this.idx < ev.length && ev[this.idx].t < horizon) {
      const e = ev[this.idx++];
      const at = this.t0 + e.t;
      if (at < now - 0.03) continue; // too late (e.g. after a hitch): skip rather than flam
      this.play(e, Math.max(at, now));
    }
  }
  stop(fade = 0.08) {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.bus) {
      const b = this.bus, a = this.actx, t = a.currentTime;
      try { b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0, t + fade + 0.01); } catch { }
      setTimeout(() => { try { b.disconnect(); } catch { } }, (fade + 0.05) * 1000);
      this.bus = null;
    }
    this.song = null;
  }
  // Tape-stop style failure: drop pitch of what is left by filtering + fading.
  fail() { this.stop(0.9); }

  play(e, t) {
    switch (e.type) {
      case 'kick': return this.kick(t, e.v);
      case 'snare': return this.snare(t, e.v);
      case 'hat': return this.hat(t, e.v, 0.035);
      case 'ohat': return this.hat(t, e.v, 0.2);
      case 'bass': return this.bass(t, e.n, e.d, e.v);
      case 'lead': return this.lead(t, e.n, e.d, e.v);
      case 'pad': return this.pad(t, e.n, e.d, e.v);
    }
  }
  env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }
  kick(t, v) {
    const a = this.actx, o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.95 * v, 0.003, 0.32);
    o.connect(g); g.connect(this.drums); o.start(t); o.stop(t + 0.4);
  }
  noiseHit(t, type, freq, q, peak, dur, dest) {
    const a = this.actx, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
    this.env(g, t, peak, 0.002, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  snare(t, v) {
    this.noiseHit(t, 'bandpass', 2000, 0.7, 0.55 * v, 0.18, this.drums);
    const a = this.actx, o = a.createOscillator(), g = a.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(200, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    this.env(g, t, 0.35 * v, 0.002, 0.09);
    o.connect(g); g.connect(this.drums); o.start(t); o.stop(t + 0.15);
  }
  hat(t, v, dur) { this.noiseHit(t, 'highpass', 7500, 0.5, 0.16 * v, dur, this.drums); }
  bass(t, n, d, v) {
    const a = this.actx, o = a.createOscillator(), s = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(n); s.type = 'sine'; s.frequency.value = mtof(n);
    f.type = 'lowpass'; f.Q.value = 4; f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(180, t + Math.max(0.1, d));
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.34 * v, t + 0.01);
    g.gain.setValueAtTime(0.3 * v, t + d * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.06);
    o.connect(f); s.connect(f); f.connect(g); g.connect(this.bus);
    o.start(t); s.start(t); o.stop(t + d + 0.1); s.stop(t + d + 0.1);
  }
  lead(t, n, d, v) {
    const a = this.actx, tim = this.song.def.timbre, f = mtof(n), g = a.createGain();
    if (tim === 'pluck') {
      const o1 = a.createOscillator(), o2 = a.createOscillator();
      o1.type = 'triangle'; o2.type = 'sine'; o1.frequency.value = f; o2.frequency.value = f * 2.003;
      const g2 = a.createGain(); g2.gain.value = 0.3;
      this.env(g, t, 0.45 * v, 0.004, Math.min(0.9, d + 0.4));
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(this.leadBus);
      o1.start(t); o2.start(t); o1.stop(t + d + 0.6); o2.stop(t + d + 0.6);
    } else if (tim === 'flute') {
      const o = a.createOscillator(), lfo = a.createOscillator(), lg = a.createGain();
      o.type = 'sine'; o.frequency.value = f; lfo.frequency.value = 5.2; lg.gain.value = f * 0.012;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42 * v, t + 0.05);
      g.gain.setValueAtTime(0.36 * v, t + Math.max(0.06, d * 0.85)); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
      o.connect(g); g.connect(this.leadBus);
      o.start(t); lfo.start(t); o.stop(t + d + 0.2); lfo.stop(t + d + 0.2);
      this.noiseHit(t, 'bandpass', f * 2, 2, 0.05 * v, 0.06, this.leadBus);
    } else {
      const o = a.createOscillator(), fl = a.createBiquadFilter();
      o.type = 'square'; o.frequency.value = f;
      fl.type = 'lowpass'; fl.Q.value = 3; fl.frequency.setValueAtTime(3200, t); fl.frequency.exponentialRampToValueAtTime(700, t + d + 0.05);
      this.env(g, t, 0.22 * v, 0.004, d * 0.9 + 0.05);
      o.connect(fl); fl.connect(g); g.connect(this.leadBus);
      o.start(t); o.stop(t + d + 0.15);
    }
  }
  pad(t, ns, d, v) {
    const a = this.actx, g = a.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.6);
    g.gain.setValueAtTime(v, t + d - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.4);
    g.connect(this.padBus);
    for (let i = 0; i < ns.length; i++) {
      const o = a.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = mtof(ns[i]); o.detune.value = (i - 1) * 6;
      o.connect(g); o.start(t); o.stop(t + d + 0.5);
    }
  }
}
