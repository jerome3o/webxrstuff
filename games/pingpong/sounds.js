import { Sfx } from '../../src/platform/kit.js';

// Synthesised, spatialised contact sounds. Loudness and pitch follow impact speed.
export class Sounds {
  constructor(audio) {
    this.audio = audio; this.sfx = new Sfx(audio);
    this._last = { paddle: 0, table: 0, net: 0, floor: 0 };
  }
  _ok(kind, gap = 0.02) {
    const ctx = this.audio.ctx; if (!ctx) return false;
    const t = ctx.currentTime; if (t - this._last[kind] < gap) return false;
    this._last[kind] = t; return true;
  }
  // Keep the WebAudio listener on the player's head.
  updateListener(head) {
    const L = this.audio.ctx?.listener; if (!L) return;
    const p = head.pos, f = head.fwd, u = head.up;
    if (L.positionX) {
      const t = this.audio.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(u.x, t); L.upY.setValueAtTime(u.y, t); L.upZ.setValueAtTime(u.z, t);
    } else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
  resetListener() {
    const L = this.audio.ctx?.listener; if (!L) return;
    if (L.positionX) { L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0; L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
  }
  paddle(pos, speed, rubber = true) {
    if (!this._ok('paddle', 0.03)) return;
    const k = Math.min(1, speed / 12), sp = { x: pos.x, y: pos.y, z: pos.z };
    // hollow "pock": short wooden body + bright rubber click
    this.sfx.tone({ freq: 760 + 260 * k, freqEnd: 520, dur: 0.05, type: 'triangle', gain: 0.18 + 0.35 * k, pos: sp });
    this.sfx.noise({ freq: rubber ? 2300 : 3200, q: 2.5, dur: 0.028 + 0.02 * k, gain: 0.25 + 0.5 * k, pos: sp });
    this.sfx.tone({ freq: 210, freqEnd: 140, dur: 0.06, type: 'sine', gain: 0.08 + 0.2 * k, pos: sp });
  }
  table(pos, speed) {
    if (!this._ok('table', 0.015)) return;
    const k = Math.min(1, speed / 7), sp = { x: pos.x, y: pos.y, z: pos.z };
    this.sfx.tone({ freq: 1250 + 300 * k, freqEnd: 980, dur: 0.035, type: 'sine', gain: 0.12 + 0.3 * k, pos: sp });
    this.sfx.noise({ freq: 4200, q: 1.6, dur: 0.02, gain: 0.12 + 0.35 * k, pos: sp });
    this.sfx.tone({ freq: 330, freqEnd: 240, dur: 0.07, type: 'sine', gain: 0.05 + 0.15 * k, pos: sp }); // table body
  }
  net(pos, speed) {
    if (!this._ok('net', 0.05)) return;
    const k = Math.min(1, speed / 6), sp = { x: pos.x, y: pos.y, z: pos.z };
    this.sfx.noise({ freq: 650, q: 0.8, type: 'lowpass', dur: 0.09, gain: 0.2 + 0.35 * k, pos: sp });
    this.sfx.tone({ freq: 170, freqEnd: 110, dur: 0.08, type: 'sine', gain: 0.1 + 0.2 * k, pos: sp });
  }
  floor(pos, speed) {
    if (!this._ok('floor', 0.03)) return;
    const k = Math.min(1, speed / 6), sp = { x: pos.x, y: pos.y, z: pos.z };
    this.sfx.tone({ freq: 1050, freqEnd: 820, dur: 0.03, type: 'sine', gain: 0.05 + 0.22 * k, pos: sp });
    this.sfx.noise({ freq: 2600, q: 1.2, dur: 0.02, gain: 0.05 + 0.2 * k, pos: sp });
  }
  toss(pos) { this.sfx.noise({ freq: 900, q: 0.7, dur: 0.06, gain: 0.05, pos: { x: pos.x, y: pos.y, z: pos.z } }); }
  machine(pos) {
    const sp = { x: pos.x, y: pos.y, z: pos.z };
    this.sfx.noise({ freq: 500, freqEnd: 2400, q: 1, dur: 0.12, gain: 0.22, pos: sp });
    this.sfx.tone({ freq: 90, freqEnd: 60, dur: 0.12, type: 'square', gain: 0.05, pos: sp });
  }
  point(won) {
    const f = won ? [660, 880] : [520, 390];
    f.forEach((fr, i) => this.sfx.tone({ freq: fr, dur: 0.16, type: 'sine', gain: 0.12, delay: i * 0.11 }));
  }
  fanfare(won) {
    const f = won ? [523, 659, 784, 1047] : [440, 392, 349, 262];
    f.forEach((fr, i) => this.sfx.tone({ freq: fr, dur: 0.3, type: 'triangle', gain: 0.13, delay: i * 0.14 }));
  }
  click() { this.sfx.tone({ freq: 1200, dur: 0.03, type: 'sine', gain: 0.08 }); }
  hover() { this.sfx.tone({ freq: 900, dur: 0.015, type: 'sine', gain: 0.03 }); }
}
