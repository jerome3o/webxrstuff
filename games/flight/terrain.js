// Pure (no three.js) world generation: heightmap, rivers, villages, courses.
// Shared by the renderer (world.js), the game (index.js) and node test scripts.

export const HALF = 1600;          // world spans [-HALF, HALF] on x and z
export const N = 256;              // grid cells per side
export const CELL = (HALF * 2) / N;
export const WATER_Y = 0;

// ── Deterministic RNG + value noise ─────────────────────────
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(ix, iz, s) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(s, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}
export function fbm(x, z, oct = 4, s = 0) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, z * f, s + i * 17) * amp; f *= 2.03; amp *= 0.5; }
  return v;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Layout ──────────────────────────────────────────────────
// River winds from the north edge to the south edge.
export const RIVER = [
  [-420, -1700], [-300, -1250], [-430, -900], [-260, -560], [-40, -330], [180, -120],
  [300, 180], [140, 480], [60, 760], [230, 1080], [420, 1350], [520, 1700],
];
export const RIVER_HALF_W = 22;

// Villages sit on the river plains; warm roofs make thermals.
export const VILLAGES = [
  { x: -150, z: 860, r: 70, thermal: 3.6 },
  { x: 430, z: 330, r: 75, thermal: 4.0 },
  { x: -380, z: -330, r: 65, thermal: 3.8 },
  { x: -130, z: -1050, r: 70, thermal: 4.2 },
  { x: 620, z: -560, r: 60, thermal: 4.4 },
  { x: -760, z: 300, r: 60, thermal: 4.0 },
];
// Terraced hills next to villages.
export const TERRACES = [
  { x: -300, z: 1010, r: 170, h: 38 },
  { x: 560, z: 470, r: 190, h: 46 },
  { x: -560, z: -260, r: 180, h: 42 },
  { x: 20, z: -1180, r: 170, h: 36 },
  { x: -880, z: 430, r: 160, h: 40 },
];

export const PERCH = { x: 60, z: 1260, top: 118, r: 7 };

// Time-trial courses: control points [x, z, y]. Rings are placed on these points.
export const COURSES = [
  {
    id: 'river', name: 'River Run', cn: '江', desc: 'Follow the river north, low over the water.',
    pts: [
      [80, 1120, 100], [160, 960, 78], [150, 820, 56], [70, 690, 40], [110, 560, 34], [190, 420, 30],
      [270, 230, 28], [230, 40, 30], [110, -110, 30], [-30, -250, 32], [-170, -400, 34], [-260, -560, 40],
      [-320, -740, 46], [-410, -900, 56],
    ],
  },
  {
    id: 'karst', name: 'Stone Forest', cn: '峰', desc: 'Weave between the limestone towers.',
    pts: [
      [140, 1110, 104], [330, 980, 92], [520, 900, 84], [700, 760, 78], [820, 560, 74], [760, 360, 70],
      [900, 180, 72], [1000, -40, 80], [860, -230, 84], [960, -430, 90], [800, -620, 96], [620, -800, 104],
      [420, -900, 110],
    ],
  },
  {
    id: 'cloud', name: 'Cloud Gate', cn: '云', desc: 'Ride the thermals up to the high gate.',
    pts: [
      [20, 1120, 104], [-90, 980, 92], [-150, 880, 100], [-150, 860, 150], [-280, 700, 168], [-460, 560, 176],
      [-640, 420, 180], [-760, 300, 200], [-780, 140, 250], [-900, -60, 236], [-1000, -300, 214],
      [-880, -560, 180], [-640, -700, 140], [-420, -800, 110], [-230, -980, 90],
    ],
  },
];

// ── Heightmap ───────────────────────────────────────────────
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return Math.sqrt(x * x + z * z);
}
export function riverDist(x, z) {
  let d = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) d = Math.min(d, segDist(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1]));
  return d;
}
function courseDist(x, z) {
  let d = 1e9;
  for (const c of COURSES) for (let i = 0; i < c.pts.length - 1; i++) d = Math.min(d, segDist(x, z, c.pts[i][0], c.pts[i][1], c.pts[i + 1][0], c.pts[i + 1][1]));
  return d;
}

// Karst towers: rejection-sampled so the courses, river, villages and perch stay clear.
function makePeaks() {
  const rnd = mulberry(7331), peaks = [];
  const fits = (x, z, r, h) => {
    if (riverDist(x, z) < r + 45) return false;
    for (const v of VILLAGES) if (Math.hypot(x - v.x, z - v.z) < r + v.r + 70) return false;
    for (const t of TERRACES) if (Math.hypot(x - t.x, z - t.z) < r + t.r * 0.8) return false;
    if (Math.hypot(x - PERCH.x, z - PERCH.z) < r + 110) return false;
    const cd = courseDist(x, z);
    if (cd < r + 34) return false;
    for (const p of peaks) if (Math.hypot(x - p.x, z - p.z) < (r + p.r) * 0.72) return false;
    return true;
  };
  let tries = 0;
  while (peaks.length < 230 && tries++ < 30000) {
    const x = (rnd() * 2 - 1) * (HALF - 60), z = (rnd() * 2 - 1) * (HALF - 60);
    const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
    const r = 42 + rnd() * 70 + edge * 30;
    const h = (70 + rnd() * 150 + edge * 120) * (0.8 + 0.4 * Math.min(1, r / 90));
    if (!fits(x, z, r, h)) continue;
    peaks.push({ x, z, r, h, p1: rnd() * 6.28, p2: rnd() * 6.28, a1: 0.1 + rnd() * 0.12, a2: 0.05 + rnd() * 0.08 });
  }
  // The perch: a lone tower with a flat top.
  peaks.push({ x: PERCH.x, z: PERCH.z, r: PERCH.r + 40, h: PERCH.top, p1: 0, p2: 0, a1: 0.04, a2: 0.03, flat: true });
  return peaks;
}

function peakHeight(p, x, z) {
  const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz, rr = p.r * 1.25;
  if (d2 > rr * rr) return 0;
  const th = Math.atan2(dz, dx);
  const re = p.r * (1 + p.a1 * Math.sin(3 * th + p.p1) + p.a2 * Math.sin(5 * th + p.p2));
  const t = Math.sqrt(d2) / re;
  if (t >= 1) return 0;
  if (p.flat) {
    const inner = (PERCH.r) / re;
    if (t < inner) return p.h;
    const u = (t - inner) / (1 - inner);
    return p.h * Math.pow(1 - Math.pow(u, 3.5), 0.45);
  }
  const t3 = t * t * t;
  return p.h * (0.86 * Math.pow(1 - t3, 0.6) + 0.14 * (1 - t)) * (1 + 0.06 * vnoise(x / 23, z / 23, 9));
}

export function generate() {
  const peaks = makePeaks();
  const S = N + 1;
  const height = new Float32Array(S * S);
  const terr = new Float32Array(S * S);   // terrace mask 0..1
  const field = new Float32Array(S * S);  // field patch noise -1..1
  // bucket peaks on a coarse grid for speed
  const B = 16, bs = (HALF * 2) / B, buckets = Array.from({ length: B * B }, () => []);
  for (const p of peaks) {
    const rr = p.r * 1.3;
    const x0 = Math.max(0, Math.floor((p.x - rr + HALF) / bs)), x1 = Math.min(B - 1, Math.floor((p.x + rr + HALF) / bs));
    const z0 = Math.max(0, Math.floor((p.z - rr + HALF) / bs)), z1 = Math.min(B - 1, Math.floor((p.z + rr + HALF) / bs));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) buckets[j * B + i].push(p);
  }
  for (let j = 0; j < S; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < S; i++) {
      const x = -HALF + i * CELL;
      // valley floor
      let h = 7 + 5 * fbm(x / 420, z / 420, 3, 1) + 2 * fbm(x / 90, z / 90, 2, 2);
      // border ranges
      const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF;
      h += smooth(0.8, 1.0, edge) * (170 + 90 * fbm(x / 150, z / 150, 3, 3));
      // terraced hills
      let tm = 0;
      for (const t of TERRACES) {
        const d = Math.hypot(x - t.x, z - t.z) / t.r;
        if (d < 1) {
          const k = Math.pow(1 - d * d, 1.4);
          const raw = t.h * k * (1 + 0.15 * fbm(x / 60, z / 60, 2, 4));
          const step = 4;
          const q = Math.floor(raw / step) * step + Math.min(step, (raw % step) * 0.25);
          h += q; tm = Math.max(tm, smooth(0.0, 0.25, k));
        }
      }
      // karst towers
      const bi = Math.min(B - 1, Math.max(0, Math.floor((x + HALF) / bs))), bj = Math.min(B - 1, Math.max(0, Math.floor((z + HALF) / bs)));
      let ph = 0;
      for (const p of buckets[bj * B + bi]) { const v = peakHeight(p, x, z); if (v > ph) ph = v; }
      h += ph;
      // river carve
      const rd = riverDist(x, z);
      const bank = smooth(RIVER_HALF_W - 6, RIVER_HALF_W + 55, rd);
      h = -3.5 + (h + 3.5) * bank;
      height[j * S + i] = h;
      terr[j * S + i] = tm * (1 - smooth(0, 1, ph / 20));
      field[j * S + i] = vnoise(x / 38, z / 38, 5);
    }
  }
  return { height, terr, field, peaks, S };
}

// Bilinear sample matching the rendered triangles closely.
export function makeSampler(height) {
  const S = N + 1;
  function groundY(x, z) {
    const fx = Math.min(N - 1e-4, Math.max(0, (x + HALF) / CELL)), fz = Math.min(N - 1e-4, Math.max(0, (z + HALF) / CELL));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = height[j * S + i], b = height[j * S + i + 1], c = height[(j + 1) * S + i], d = height[(j + 1) * S + i + 1];
    // match PlaneGeometry triangulation (diagonal from (i,j+1) to (i+1,j))
    if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  return {
    groundY,
    surfaceY(x, z) { return Math.max(groundY(x, z), WATER_Y); },
    // slope magnitude (rise/run) from central differences
    slope(x, z) {
      const e = CELL;
      const gx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e), gz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
      return Math.hypot(gx, gz);
    },
    grad(x, z, out) {
      const e = CELL;
      out.x = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e); out.z = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
      return out;
    },
  };
}
