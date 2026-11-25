// Synthesised creature + survival sounds (WebAudio through the phase-1 kit Sfx). All original.
export class SurvivalSfx {
  constructor(game) { this.game = game; this.sfx = game.audio.sfx; this.ok = !!game.audio.enabled; }
  t(o) { if (this.ok) this.sfx.tone(o); }
  n(o) { if (this.ok) this.sfx.noise(o); }
  r(a, b) { return a + Math.random() * (b - a); }

  // creature voices: kind → 'call' | 'hurt' | 'die' | 'windup' | 'attack'
  voice(kind, what, pos) {
    const r = this.r.bind(this);
    switch (kind) {
      case 'mossback':
        if (what === 'call') { this.t({ freq: r(130, 160), freqEnd: 95, dur: 0.32, type: 'triangle', gain: 0.16, pos }); this.n({ freq: 400, q: 0.8, type: 'lowpass', dur: 0.2, gain: 0.06, pos }); }
        else if (what === 'hurt') this.t({ freq: r(420, 480), freqEnd: 260, dur: 0.18, type: 'triangle', gain: 0.18, pos });
        else if (what === 'die') { this.t({ freq: 300, freqEnd: 90, dur: 0.5, type: 'triangle', gain: 0.18, pos }); }
        break;
      case 'hornbloom':
        if (what === 'call') { this.t({ freq: 520, dur: 0.6, type: 'sine', gain: 0.08, pos }); this.t({ freq: 780, dur: 0.5, type: 'sine', gain: 0.05, delay: 0.05, pos }); this.t({ freq: 1040, dur: 0.4, type: 'sine', gain: 0.03, delay: 0.1, pos }); }
        else if (what === 'windup') { this.n({ freq: 500, q: 0.9, type: 'bandpass', dur: 0.25, gain: 0.25, pos }); this.n({ freq: 420, q: 0.9, type: 'bandpass', dur: 0.25, gain: 0.25, delay: 0.3, pos }); }
        else if (what === 'hurt') { this.t({ freq: 660, freqEnd: 420, dur: 0.22, type: 'sine', gain: 0.14, pos }); this.t({ freq: 990, freqEnd: 600, dur: 0.18, type: 'sine', gain: 0.06, pos }); }
        else if (what === 'die') this.t({ freq: 520, freqEnd: 180, dur: 0.8, type: 'sine', gain: 0.14, pos });
        else if (what === 'attack') this.n({ freq: 220, q: 0.7, type: 'lowpass', dur: 0.2, gain: 0.3, pos });
        break;
      case 'skykite':
        if (what === 'call') { const f = r(1700, 2100); this.t({ freq: f, freqEnd: f * 1.45, dur: 0.25, type: 'sine', gain: 0.06, pos }); this.t({ freq: f * 1.4, freqEnd: f, dur: 0.3, type: 'sine', gain: 0.05, delay: 0.28, pos }); }
        else this.t({ freq: 2400, freqEnd: 1200, dur: 0.2, type: 'sine', gain: 0.1, pos });
        break;
      case 'lanternmoth':
        if (what === 'call') this.n({ freq: 5200, q: 2, type: 'bandpass', dur: 0.12, gain: 0.03, pos });
        else this.t({ freq: 1800, freqEnd: 3600, dur: 0.15, type: 'sine', gain: 0.06, pos });
        break;
      case 'glimmerfin':
        this.n({ freq: 1400, q: 0.8, type: 'bandpass', dur: 0.15, gain: 0.12, pos }); break;
      case 'inkshade':
        if (what === 'call') { this.t({ freq: r(60, 75), freqEnd: 50, dur: 0.6, type: 'square', gain: 0.03, pos }); this.n({ freq: 300, q: 3, type: 'bandpass', dur: 0.5, gain: 0.06, pos }); }
        else if (what === 'windup') { this.t({ freq: 180, freqEnd: 640, dur: 0.5, type: 'sawtooth', gain: 0.05, pos }); this.n({ freq: 3000, q: 0.6, type: 'highpass', dur: 0.5, gain: 0.08, pos }); }
        else if (what === 'attack') this.n({ freq: 700, q: 0.7, type: 'lowpass', dur: 0.18, gain: 0.25, pos });
        else if (what === 'hurt') this.t({ freq: 240, freqEnd: 120, dur: 0.2, type: 'square', gain: 0.06, pos });
        else if (what === 'die' || what === 'burn') { this.n({ freq: 2500, q: 0.5, type: 'highpass', dur: 0.9, gain: 0.12, pos, freqEnd: 600 }); this.t({ freq: 200, freqEnd: 40, dur: 0.7, type: 'square', gain: 0.04, pos }); }
        else if (what === 'emerge') this.n({ freq: 260, q: 0.6, type: 'lowpass', dur: 0.8, gain: 0.25, pos });
        break;
      case 'cragcrab':
        if (what === 'call' || what === 'windup') for (let i = 0; i < 3; i++) this.t({ freq: r(1100, 1400), dur: 0.02, type: 'square', gain: 0.05, delay: i * 0.08, pos });
        else if (what === 'attack') { this.t({ freq: 1600, dur: 0.03, type: 'square', gain: 0.12, pos }); this.n({ freq: 2000, q: 2, type: 'bandpass', dur: 0.06, gain: 0.2, pos }); }
        else if (what === 'hurt') { this.n({ freq: 1700, q: 1.4, type: 'bandpass', dur: 0.1, gain: 0.3, pos }); this.t({ freq: 170, dur: 0.08, type: 'triangle', gain: 0.1, pos }); }
        else if (what === 'die') { this.n({ freq: 1200, q: 0.8, type: 'bandpass', dur: 0.4, gain: 0.3, pos }); this.t({ freq: 1900, dur: 0.3, type: 'sine', gain: 0.05, delay: 0.05, pos }); }
        break;
      case 'deepwyrm':
        if (what === 'call') { this.t({ freq: 55, freqEnd: 38, dur: 1.6, type: 'sawtooth', gain: 0.08, pos }); this.n({ freq: 160, q: 0.7, type: 'lowpass', dur: 1.4, gain: 0.25, pos }); }
        else if (what === 'windup') { this.t({ freq: 70, freqEnd: 140, dur: 0.9, type: 'sawtooth', gain: 0.1, pos }); this.n({ freq: 400, q: 0.6, type: 'lowpass', dur: 0.9, gain: 0.3, pos, freqEnd: 1200 }); }
        else if (what === 'attack') this.n({ freq: 300, q: 0.5, type: 'lowpass', dur: 0.5, gain: 0.5, pos });
        else if (what === 'hurt') { this.t({ freq: 110, freqEnd: 70, dur: 0.3, type: 'sawtooth', gain: 0.1, pos }); this.n({ freq: 1800, q: 1.5, type: 'bandpass', dur: 0.1, gain: 0.2, pos }); }
        else if (what === 'die') { this.t({ freq: 90, freqEnd: 25, dur: 2.5, type: 'sawtooth', gain: 0.14, pos }); this.n({ freq: 250, q: 0.5, type: 'lowpass', dur: 2.2, gain: 0.4, pos }); this.t({ freq: 880, dur: 1.5, type: 'sine', gain: 0.05, delay: 0.6, pos }); }
        break;
    }
  }
  swing() { this.n({ freq: 1600, q: 0.8, type: 'bandpass', dur: 0.12, gain: 0.08, freqEnd: 600 }); }
  hit(pos, heavy) { this.n({ freq: heavy ? 500 : 900, q: 0.9, type: 'lowpass', dur: 0.1, gain: heavy ? 0.45 : 0.3, pos }); this.t({ freq: heavy ? 140 : 210, freqEnd: 80, dur: 0.1, type: 'triangle', gain: 0.18, pos }); }
  hurt() { this.t({ freq: 330, freqEnd: 170, dur: 0.16, type: 'triangle', gain: 0.22 }); this.n({ freq: 300, q: 0.7, type: 'lowpass', dur: 0.12, gain: 0.3 }); }
  munch() { this.n({ freq: this.r(900, 1500), q: 1.2, type: 'bandpass', dur: 0.07, gain: 0.22 }); }
  gulp() { this.t({ freq: 300, freqEnd: 520, dur: 0.12, type: 'sine', gain: 0.14 }); this.t({ freq: 660, dur: 0.1, type: 'sine', gain: 0.06, delay: 0.1 }); }
  death() { [440, 370, 294, 220].forEach((f, i) => this.t({ freq: f, dur: 0.5, type: 'triangle', gain: 0.12, delay: i * 0.22 })); }
  respawn() { [392, 523, 659, 784].forEach((f, i) => this.t({ freq: f, dur: 0.35, type: 'sine', gain: 0.08, delay: i * 0.09 })); }
  bubble() { this.t({ freq: this.r(500, 800), freqEnd: 1200, dur: 0.06, type: 'sine', gain: 0.06 }); }
  sling() { this.n({ freq: 2200, q: 0.8, type: 'bandpass', dur: 0.2, gain: 0.12, freqEnd: 700 }); this.t({ freq: 180, dur: 0.05, type: 'triangle', gain: 0.1 }); }
  charge() { this.t({ freq: 300, freqEnd: 500, dur: 0.08, type: 'sine', gain: 0.04 }); }
  sleep() { [523, 440, 392, 330].forEach((f, i) => this.t({ freq: f, dur: 0.6, type: 'sine', gain: 0.07, delay: i * 0.3 })); }
  pickup() { this.t({ freq: 700, freqEnd: 1100, dur: 0.1, type: 'sine', gain: 0.1 }); this.t({ freq: 1100, freqEnd: 1500, dur: 0.1, type: 'sine', gain: 0.08, delay: 0.08 }); }
}
