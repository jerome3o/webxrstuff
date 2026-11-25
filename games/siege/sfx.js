import { Sfx } from '../../src/platform/kit.js';

// Tiny synthesized sounds, positioned in world space at the diorama event.
export class SiegeAudio {
  constructor(audio) {
    this.audio = audio; this.sfx = new Sfx(audio); this.last = Object.create(null); this.muted = false;
  }
  _ok(k, gap) {
    const c = this.audio.ctx; if (!c || this.muted) return false;
    const t = c.currentTime; if ((this.last[k] ?? -9) + gap > t) return false; this.last[k] = t; return true;
  }
  listener(head) {
    const c = this.audio.ctx; if (!c) return;
    const L = c.listener, p = head.pos, f = head.fwd, u = head.up;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
    } else { L.setPosition?.(p.x, p.y, p.z); L.setOrientation?.(f.x, f.y, f.z, u.x, u.y, u.z); }
  }
  arrow(pos) { if (!this._ok('arrow', 0.07)) return; this.sfx.tone({ freq: 1500, freqEnd: 600, dur: 0.06, type: 'triangle', gain: 0.05, pos }); this.sfx.noise({ freq: 5000, q: 2, dur: 0.05, gain: 0.04, pos }); }
  rocketLaunch(pos) { if (!this._ok('rl', 0.1)) return; this.sfx.noise({ freq: 1200, freqEnd: 4000, q: 1.5, dur: 0.35, gain: 0.08, pos }); }
  firework(pos) {
    if (!this._ok('fw', 0.08)) return;
    this.sfx.noise({ freq: 800, q: 0.7, dur: 0.12, gain: 0.18, pos });
    for (let i = 0; i < 4; i++) this.sfx.noise({ freq: 3000 + Math.random() * 3000, q: 3, dur: 0.03, gain: 0.06, delay: 0.08 + Math.random() * 0.35, pos });
  }
  bell(pos, level) {
    if (!this._ok('bell', 0.12)) return;
    const f = 880 - level * 110;
    this.sfx.tone({ freq: f, dur: 1.2, gain: 0.08, pos });
    this.sfx.tone({ freq: f * 2.76, dur: 0.6, gain: 0.03, pos });
    this.sfx.tone({ freq: f * 5.4, dur: 0.25, gain: 0.015, pos });
  }
  cannon(pos) { if (!this._ok('cannon', 0.1)) return; this.sfx.noise({ freq: 300, freqEnd: 80, type: 'lowpass', q: 1, dur: 0.35, gain: 0.3, pos }); this.sfx.tone({ freq: 120, freqEnd: 40, dur: 0.3, gain: 0.15, pos }); }
  boom(pos) { if (!this._ok('boom', 0.08)) return; this.sfx.noise({ freq: 500, freqEnd: 100, type: 'lowpass', dur: 0.3, gain: 0.22, pos }); }
  chime(pos) { if (!this._ok('chime', 0.2)) return; [660, 990, 1320].forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.7, gain: 0.05, delay: i * 0.09, pos })); }
  pop(pos, big = false) {
    if (!this._ok('pop', 0.04)) return;
    const f = big ? 160 : 380 + Math.random() * 200;
    this.sfx.tone({ freq: f, freqEnd: f * 0.3, dur: big ? 0.5 : 0.12, type: 'sine', gain: big ? 0.25 : 0.09, pos });
    this.sfx.noise({ freq: 1800, q: 1, dur: 0.06, gain: 0.04, pos });
  }
  coin(pos) { if (!this._ok('coin', 0.09)) return; this.sfx.tone({ freq: 1760, dur: 0.05, type: 'square', gain: 0.02, pos }); this.sfx.tone({ freq: 2350, dur: 0.12, type: 'square', gain: 0.02, delay: 0.05, pos }); }
  leak(pos) { if (!this._ok('leak', 0.15)) return; this.sfx.tone({ freq: 90, freqEnd: 50, dur: 0.4, type: 'sawtooth', gain: 0.1, pos }); this.sfx.noise({ freq: 400, type: 'lowpass', dur: 0.3, gain: 0.2, pos }); }
  place(pos) { this.sfx.noise({ freq: 900, q: 2, dur: 0.06, gain: 0.2, pos }); this.sfx.tone({ freq: 220, freqEnd: 140, dur: 0.12, type: 'triangle', gain: 0.12, pos }); }
  upgrade(pos) { [523, 659, 784, 1046].forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.18, type: 'triangle', gain: 0.07, delay: i * 0.07, pos })); }
  sell(pos) { [1046, 784, 523].forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.12, type: 'square', gain: 0.025, delay: i * 0.06, pos })); }
  deny(pos) { this.sfx.tone({ freq: 180, dur: 0.15, type: 'square', gain: 0.05, pos }); }
  pick(pos) { this.sfx.tone({ freq: 700, freqEnd: 900, dur: 0.06, type: 'triangle', gain: 0.06, pos }); }
  click() { this.sfx.tone({ freq: 1200, dur: 0.03, type: 'triangle', gain: 0.05 }); }
  gong(pos) { this.sfx.tone({ freq: 110, dur: 2.0, gain: 0.2, pos }); this.sfx.tone({ freq: 165, dur: 1.5, gain: 0.08, pos }); this.sfx.noise({ freq: 400, q: 0.8, dur: 0.4, gain: 0.08, pos }); }
  flick(pos) { this.sfx.noise({ freq: 600, freqEnd: 3000, q: 1, dur: 0.25, gain: 0.2, pos }); }
  splash(pos) { if (!this._ok('splash', 0.1)) return; this.sfx.noise({ freq: 1500, freqEnd: 400, q: 0.6, dur: 0.3, gain: 0.12, pos }); }
  brush(pos) { if (!this._ok('brush', 0.12)) return; this.sfx.noise({ freq: 2500, q: 0.8, dur: 0.12, gain: 0.05, pos }); }
  fanfare(win) {
    const notes = win ? [523, 659, 784, 1046, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.sfx.tone({ freq: f, dur: 0.35, type: 'triangle', gain: 0.1, delay: i * 0.16 }));
  }
}
