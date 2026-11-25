// Cliffside: tower shapes and route layouts.
// A tower is a karst pillar around a vertical axis (cx, cz). Its surface radius at angle phi and height y is
// towerR(t, phi, y). phi = 0 faces +Z (towards the base camp); positive phi goes to the climber's right (+X).
// Route holds are written in surface coordinates: s = metres along the face from the front centre, y = height.

export const TOWERS = [
  { cx: -12, cz: -12, H: 12, seed: 1.3, amp: 1, prof: [[-3, 5.3], [0, 5.0], [6, 4.6], [12, 4.25]] },
  { cx: 0, cz: -17, H: 24, seed: 2.7, amp: 1, prof: [[-3, 6.1], [0, 5.8], [8, 5.2], [10, 5.25], [13, 6.15], [15, 6.0], [17, 5.5], [24, 5.0]] },
  { cx: 13, cz: -14, H: 34, seed: 4.1, amp: 1, prof: [[-3, 6.7], [0, 6.4], [9, 5.8], [10, 5.85], [14, 6.6], [18, 6.4], [21, 6.0], [25, 7.0], [26, 6.85], [34, 6.0]] },
];
// The rock the base camp terrace sits on (top at y = 0, drops to the valley).
export const MASSIF = { cx: 0, cz: -8, H: 0, seed: 7.7, amp: 3, prof: [[-178, 44], [-120, 37], [-40, 30.5], [-6, 27.2], [0, 26.3]] };
export const TERRACE = { cx: 0, cz: -8, walk: 25.0, rail: 25.6, disc: 26.6 };
export const VALLEY_Y = -172;

export function profileR(t, y) {
  const p = t.prof;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) {
      const a = p[i - 1], b = p[i];
      let u = (y - a[0]) / (b[0] - a[0]); u = u * u * (3 - 2 * u);
      return a[1] + (b[1] - a[1]) * u;
    }
  }
  return p[p.length - 1][1];
}

export function towerR(t, phi, y) {
  const s = t.seed;
  let amp = t.amp;
  if (t === MASSIF) amp = 0.12 + 3 * Math.min(1, Math.max(0, -y / 12));
  return profileR(t, y) + amp * (
    0.22 * Math.sin(3 * phi + 0.45 * y + s) +
    0.14 * Math.sin(7 * phi - 0.9 * y + 2 * s) +
    0.08 * Math.sin(13 * phi + 1.7 * y + 3 * s) +
    0.06 * Math.sin(23 * phi + s));
}

export const R0 = (t) => profileR(t, 0);

// World point on the face at surface coords (s, y), pushed out by `out` metres. Writes into `o` ({x,y,z}).
export function surfacePoint(t, s, y, out, o) {
  const phi = s / R0(t);
  const r = towerR(t, phi, y) + out;
  o.x = t.cx + r * Math.sin(phi); o.y = y; o.z = t.cz + r * Math.cos(phi);
  return o;
}

// deterministic jitter in [-1, 1]
const jit = (k, seed) => { const v = Math.sin(k * 12.9898 + seed * 78.233) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; };

// Zig-zag a line of holds up the face.
function zig(list, { y0, y1, step, s = 0, amp = 0.34, types = ['jug'], jitter = 0.1, seed = 1, mv = null }) {
  let k = 0;
  for (let y = y0; y <= y1 + 1e-6; y += step, k++) {
    const side = k % 2 ? 1 : -1;
    const type = types[k % types.length];
    const h = { type, s: s + side * amp + jit(k, seed) * jitter, y: y + jit(k + 7, seed) * 0.06 };
    if (type === 'moving') h.mv = mv ?? { axis: 's', amp: 0.45, speed: 0.9, phase: k * 1.7 };
    list.push(h);
  }
}

function makeRoutes() {
  const R = [];
  // ── Route 1: Lotus Steps — a friendly slab, jugs, a ladder and a rest ledge ──
  {
    const holds = [], bars = [], ledges = [], tokens = [], ladders = [];
    zig(holds, { y0: 1.1, y1: 5.5, step: 0.6, amp: 0.32, types: ['jug'], seed: 1 });
    ledges.push({ s0: -1.6, s1: 1.6, y: 6.0, depth: 1.05, cp: true });
    // bolted ladder 6.4 → 10.8
    const lad = { s0: -0.1, s1: 0.5, y0: 6.2, y1: 11.0, out: 0.22 };
    ladders.push(lad);
    for (let y = 6.5; y <= 10.75; y += 0.36) bars.push({ type: 'rung', a: { s: lad.s0, y, out: lad.out }, b: { s: lad.s1, y, out: lad.out } });
    zig(holds, { y0: 11.0, y1: 11.6, step: 0.35, s: -0.15, amp: 0.36, types: ['jug'], seed: 3 });
    holds.push({ type: 'jug', s: -0.35, y: 12, top: true }, { type: 'jug', s: 0.45, y: 12, top: true });
    tokens.push({ s: -1.25, y: 3.3 }, { s: 1.25, y: 8.4 }, { s: -1.0, y: 11.0 });
    R.push({ id: 0, tower: 0, name: 'Lotus Steps', zh: '莲阶', grade: 1, color: '#e2b85c', holds, bars, ledges, tokens, ladders });
  }
  // ── Route 2: Crane's Neck — crimps, a bulging overhang, crumbling rock and a rope ──
  {
    const holds = [], bars = [], ledges = [], tokens = [], ladders = [];
    zig(holds, { y0: 1.1, y1: 7.4, step: 0.62, amp: 0.34, types: ['jug', 'jug', 'crimp'], seed: 11 });
    ledges.push({ s0: -1.6, s1: 1.6, y: 8.0, depth: 1.05, cp: true });
    zig(holds, { y0: 8.6, y1: 13.0, step: 0.58, amp: 0.38, types: ['jug', 'crimp', 'crumble', 'jug'], seed: 12 });
    zig(holds, { y0: 13.55, y1: 15.7, step: 0.6, amp: 0.3, types: ['crimp', 'jug', 'crumble'], seed: 13 });
    ledges.push({ s0: -1.5, s1: 2.0, y: 16.3, depth: 1.0, cp: true });
    bars.push({ type: 'rope', a: { s: 0.95, y: 24.05, out: 0.12 }, b: { s: 0.95, y: 16.9, out: 0.3 } });
    zig(holds, { y0: 17.1, y1: 23.4, step: 0.68, s: -0.75, amp: 0.26, types: ['crimp', 'crumble', 'crimp', 'jug'], seed: 14 });
    holds.push({ type: 'jug', s: -0.4, y: 24, top: true }, { type: 'jug', s: 0.7, y: 24, top: true });
    tokens.push({ s: 1.35, y: 4.2 }, { s: -1.45, y: 11.0 }, { s: 1.5, y: 14.4 }, { s: -1.25, y: 21.0 });
    R.push({ id: 1, tower: 1, name: "Crane's Neck", zh: '鹤颈', grade: 2, color: '#4fb3a6', holds, bars, ledges, tokens, ladders });
  }
  // ── Route 3: Pagoda Peak — moving holds, a chain traverse, a roof and a final leap ──
  {
    const holds = [], bars = [], ledges = [], tokens = [], ladders = [];
    zig(holds, { y0: 1.1, y1: 8.3, step: 0.64, amp: 0.36, types: ['jug', 'crimp', 'crimp', 'crumble', 'jug'], seed: 21 });
    ledges.push({ s0: -1.5, s1: 1.5, y: 9.0, depth: 1.0, cp: true });
    zig(holds, { y0: 9.6, y1: 14.0, step: 0.6, amp: 0.36, types: ['moving', 'crimp', 'jug'], seed: 22 });
    zig(holds, { y0: 14.6, y1: 17.4, step: 0.6, amp: 0.33, types: ['crumble', 'crimp', 'jug'], seed: 23 });
    ledges.push({ s0: -1.4, s1: 0.9, y: 18.0, depth: 1.0, cp: true });
    bars.push({ type: 'chain', a: { s: 0.3, y: 19.9, out: 0.3 }, b: { s: 4.3, y: 20.1, out: 0.3 } });
    zig(holds, { y0: 20.7, y1: 25.3, step: 0.6, s: 4.3, amp: 0.35, types: ['jug', 'moving', 'crimp', 'jug'], seed: 24, mv: { axis: 'y', amp: 0.35, speed: 1.1, phase: 0 } });
    ledges.push({ s0: 2.9, s1: 5.7, y: 26.0, depth: 1.0, cp: true });
    zig(holds, { y0: 26.6, y1: 29.0, step: 0.6, s: 3.9, amp: 0.3, types: ['crimp', 'crumble', 'crimp', 'jug'], seed: 25 });
    holds.push({ type: 'jug', s: 3.7, y: 30.75, big: true });
    bars.push({ type: 'chain', a: { s: 3.1, y: 34.05, out: 0.12 }, b: { s: 3.1, y: 30.5, out: 0.3 } });
    zig(holds, { y0: 31.4, y1: 33.5, step: 0.6, s: 4.0, amp: 0.28, types: ['jug', 'crimp'], seed: 26 });
    holds.push({ type: 'jug', s: 3.5, y: 34, top: true }, { type: 'jug', s: 4.4, y: 34, top: true });
    tokens.push({ s: -1.4, y: 5.0 }, { s: 1.45, y: 12.0 }, { s: 2.1, y: 21.4 }, { s: 5.0, y: 23.5 }, { s: 2.2, y: 29.8 });
    R.push({ id: 2, tower: 2, name: 'Pagoda Peak', zh: '塔峰', grade: 3, color: '#d0503a', holds, bars, ledges, tokens, ladders });
  }
  return R;
}
export const ROUTES = makeRoutes();
