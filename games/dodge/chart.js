import { mulberry } from './env.js';

// Routines and the beat-locked chart generator.
// Every event lands exactly on a beat (or half beat) of the song: t = beat * secondsPerBeat.

export const K = { PAD: 0, SHIELD: 1, HPOLE: 2, VPOLE: 3, WALL: 4, LOG: 5 };
export const SUB = { JAB: 0, HOOK: 1, UPPER: 2 };
export const HOLE = { DUCK: 0, LEFT: 1, RIGHT: 2, LOWLEFT: 3, LOWRIGHT: 4 };
export const HOLE_MIRROR = [0, 2, 1, 4, 3];

export const ROUTINES = [
  { id: 'warmup', name: 'Warm-up', cn: '起', desc: 'Jabs, easy ducks and leans', bpm: 96, bars: 32, speed: 6.0, minPunch: 1.2, style: 0, level: (b) => Math.min(0.75, b / 40) },
  { id: 'normal', name: 'Mountain Flow', cn: '流', desc: 'Hooks, walls and swinging logs', bpm: 112, bars: 44, speed: 7.5, minPunch: 1.6, style: 1, level: (b) => 0.6 + b / 44 * 0.9 },
  { id: 'intense', name: 'Storm Peak', cn: '雷', desc: 'Fast combos on the 8ths', bpm: 128, bars: 56, speed: 9.0, minPunch: 2.0, style: 2, level: (b) => b < 6 ? 1.2 : 1.6 + b / 56 },
  { id: 'endless', name: 'Endless Ascent', cn: '无', desc: '5 spirit, ever faster', bpm: 120, bars: Infinity, speed: 7.0, minPunch: 1.6, style: 1, level: (b) => Math.min(2.8, 0.3 + b / 14), speedRamp: true, hearts: 5 },
];

const P = K.PAD;
// [beat, kind, side(-1 left / +1 right) | hole, sub]
const PHRASES = [
  { lv: 0, w: 3, ev: [[0, P, -1, 0], [2, P, 1, 0], [4, P, -1, 0], [6, P, 1, 0]] },
  { lv: 0, w: 2, ev: [[0, P, -1, 0], [1, P, 1, 0], [4, P, -1, 0], [5, P, 1, 0]] },
  { lv: 0, w: 3, ev: [[0, K.HPOLE, 0], [4, P, -1, 0], [6, P, 1, 0]] },
  { lv: 0, w: 3, ev: [[0, K.VPOLE, -1], [4, K.VPOLE, 1]] },
  { lv: 0, w: 2, ev: [[0, K.SHIELD, 0], [4, P, -1, 0], [5, P, 1, 0]] },
  { lv: 0.3, w: 2, ev: [[0, K.WALL, HOLE.DUCK], [4, P, -1, 2], [6, P, 1, 2]] },
  { lv: 0.5, w: 2, ev: [[0, P, -1, 2], [2, P, 1, 2], [4, P, -1, 0], [5, P, 1, 0], [6, P, -1, 0]] },
  { lv: 0.8, w: 3, ev: [[0, P, -1, 1], [2, P, 1, 1], [4, P, -1, 0], [5, P, 1, 0], [6, P, -1, 1]] },
  { lv: 0.8, w: 2, ev: [[0, K.WALL, HOLE.LEFT], [4, P, 1, 0], [6, K.WALL, HOLE.RIGHT]] },
  { lv: 1.0, w: 2, ev: [[0, K.LOG, -1], [4, K.LOG, 1], [6, P, 1, 0]] },
  { lv: 1.0, w: 2, ev: [[0, P, -1, 0], [1, P, 1, 0], [2, K.HPOLE, 0], [4, P, -1, 1], [5, P, 1, 1], [7, K.SHIELD, 0]] },
  { lv: 1.2, w: 2, ev: [[0, K.WALL, HOLE.LOWLEFT], [4, K.WALL, HOLE.LOWRIGHT]] },
  { lv: 1.3, w: 2, ev: [[0, K.SHIELD, 0], [2, P, -1, 1], [3, P, 1, 1], [4, K.LOG, 1], [6, P, -1, 2], [7, P, 1, 2]] },
  { lv: 1.6, w: 2, ev: [[0, P, -1, 0], [0.5, P, 1, 0], [1, P, -1, 0], [2, P, 1, 1], [3, P, -1, 1], [4, K.HPOLE, 0], [6, P, -1, 2], [6.5, P, 1, 2]] },
  { lv: 1.6, w: 2, ev: [[0, K.VPOLE, -1], [2, K.VPOLE, 1], [4, K.HPOLE, 0], [6, K.SHIELD, 0]] },
  { lv: 1.9, w: 2, ev: [[0, K.LOG, -1], [2, P, 1, 0], [2.5, P, 1, 0], [4, K.WALL, HOLE.DUCK], [6, P, -1, 2], [6.5, P, 1, 2], [7, P, -1, 0]] },
  { lv: 2.1, w: 2, ev: [[0, P, -1, 1], [0.5, P, 1, 1], [1, P, -1, 1], [1.5, P, 1, 1], [2, K.SHIELD, 0], [4, K.WALL, HOLE.LEFT], [6, K.WALL, HOLE.RIGHT]] },
];
const REST = { lv: 0, w: 0, ev: [[0, P, -1, 0], [2, P, 1, 0], [4, P, -1, 0], [6, P, 1, 0]] };

const N = 160;
export class Chart {
  constructor() {
    this.ev = [];
    for (let i = 0; i < N; i++) this.ev.push({ t: 0, beat: 0, kind: 0, side: 0, sub: 0, hole: 0, speed: 0 });
    this.head = 0; this.tail = 0;
  }
  reset(routine, seed) {
    this.r = routine; this.spb = 60 / routine.bpm; this.rng = mulberry(seed);
    this.head = this.tail = 0; this.nextBar = 0; this.last = -1; this.phraseN = 0; this.total = 0;
  }
  get count() { return (this.tail - this.head + N) % N; }
  peek() { return this.head === this.tail ? null : this.ev[this.head]; }
  shift() { const e = this.ev[this.head]; this.head = (this.head + 1) % N; return e; }
  at(i) { return this.ev[(this.head + i) % N]; }
  get finished() { return this.nextBar >= this.r.bars - 1 && this.head === this.tail; }

  speedAt(bar) { return this.r.speedRamp ? this.r.speed + Math.min(3, bar / 10) : this.r.speed; }

  // Generate phrases (2 bars each) until the chart covers song time `until`.
  ensure(until) {
    const barDur = this.spb * 4;
    while (this.nextBar * barDur < until + 4 && this.nextBar < this.r.bars - 1 && this.count < N - 12) {
      const bar = this.nextBar, lvl = this.r.level(bar);
      let ph;
      this.phraseN++;
      if (lvl < 0.5 && this.phraseN % 4 === 0) ph = REST;
      else {
        let tot = 0;
        for (let i = 0; i < PHRASES.length; i++) if (PHRASES[i].lv <= lvl && i !== this.last) tot += PHRASES[i].w * (PHRASES[i].lv > lvl - 0.6 ? 1.6 : 1);
        let x = this.rng() * tot, pick = 0;
        for (let i = 0; i < PHRASES.length; i++) {
          if (PHRASES[i].lv > lvl || i === this.last) continue;
          x -= PHRASES[i].w * (PHRASES[i].lv > lvl - 0.6 ? 1.6 : 1);
          if (x <= 0) { pick = i; break; }
        }
        this.last = pick; ph = PHRASES[pick];
      }
      const m = this.rng() < 0.5 ? 1 : -1, sp = this.speedAt(bar);
      const bars = Math.min(2, this.r.bars - 1 - bar);
      for (const [beat, kind, a, sub] of ph.ev) {
        if (beat >= bars * 4) continue;
        const e = this.ev[this.tail]; this.tail = (this.tail + 1) % N;
        e.beat = bar * 4 + beat; e.t = e.beat * this.spb; e.kind = kind; e.speed = sp; e.sub = sub ?? 0;
        e.side = kind === K.WALL ? 0 : a * m;
        e.hole = kind === K.WALL ? (m < 0 ? HOLE_MIRROR[a] : a) : 0;
        this.total++;
      }
      this.nextBar += 2;
    }
  }
}
