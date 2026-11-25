import { Stroke, BRUSHES } from './engine.js';
import { mulberry32 } from './textures.js';

// Procedurally painted first-launch sketch: ink-wash mountains, a red sun,
// a gnarled pine with needle clusters, rocks, bamboo with leaf stamps, mist and birds.

const BI = (id) => BRUSHES.findIndex(b => b.id === id);
const EYE = [0, 1.45, 0.4];

// pts: flat [x,y,z,p, ...]. Ribbons are oriented to face the viewer.
function mk(brush, hex, size, pts, seed) {
  const s = new Stroke(BI(brush), hex, size, 0, seed);
  const n = pts.length / 4;
  let psx = 0, psy = 1, psz = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let tx = pts[b * 4] - pts[a * 4], ty = pts[b * 4 + 1] - pts[a * 4 + 1], tz = pts[b * 4 + 2] - pts[a * 4 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let vx = pts[i * 4] - EYE[0], vy = pts[i * 4 + 1] - EYE[1], vz = pts[i * 4 + 2] - EYE[2];
    const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
    let sx = ty * vz - tz * vy, sy = tz * vx - tx * vz, sz = tx * vy - ty * vx;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) { sx = psx; sy = psy; sz = psz; sl = 1; }
    sx /= sl; sy /= sl; sz /= sl;
    if (i > 0 && sx * psx + sy * psy + sz * psz < 0) { sx = -sx; sy = -sy; sz = -sz; }
    psx = sx; psy = sy; psz = sz;
    let nx = sy * tz - sz * ty, ny = sz * tx - sx * tz, nz = sx * ty - sy * tx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    s.push(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], sx, sy, sz, nx / nl, ny / nl, nz / nl, pts[i * 4 + 3]);
  }
  return s;
}

export function buildDemo() {
  const rnd = mulberry32(2024);
  const out = [];
  const add = (brush, hex, size, pts) => { if (pts.length >= 8) out.push(mk(brush, hex, size, pts, (rnd() * 2147483647) | 0)); };
  const g = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
  const wob = (x, k) => Math.sin(x * 7.1 + k) * 0.5 + Math.sin(x * 13.7 + k * 2) * 0.3 + Math.sin(x * 29 + k * 3) * 0.2;

  // ── red sun behind the far range ──
  {
    const cx = 1.65, cy = 2.5, cz = -4.9, R = 0.3, P = [];
    for (let a = 0; a < Math.PI * 2 * 5.5; a += 0.12) { const r = 0.02 + (R - 0.02) * a / (Math.PI * 2 * 5.5); P.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz, 0.55); }
    add('ink', 0xc8402c, 0.085, P);
  }

  // ── mountains: ridge line, then washes fading downward ──
  const range = (zf, hf, ridgeHex, washHex, ridgeP, washP, layers, cun, floorY) => {
    const ridge = [];
    for (let x = -3.9; x <= 3.9; x += 0.04) ridge.push(x, hf(x), zf(x), ridgeP * (0.75 + 0.25 * Math.sin(x * 3.1)));
    add('ink', ridgeHex, 0.05, ridge);
    for (let k = 1; k <= layers; k++) {
      let P = [];
      for (let x = -3.9; x <= 3.9; x += 0.05) {
        const y = hf(x) - 0.05 - k * 0.12 + 0.02 * wob(x, k);
        if (y > floorY) P.push(x, y, zf(x) + 0.01 * k, Math.max(0.07, washP - k * 0.03));
        else { add('ink', washHex, 0.42, P); P = []; }
      }
      add('ink', washHex, 0.42, P);
    }
    if (cun) for (let x = -3.8; x <= 3.8; x += 0.07) {
      const h = hf(x), sl = (hf(x + 0.02) - hf(x - 0.02)) / 0.04;
      if (Math.abs(sl) < 0.35 || h < 0.95 || rnd() > 0.55) continue;
      const P = [], L = 0.18 + rnd() * 0.2, dir = -Math.sign(sl);
      for (let s = 0; s <= 1.001; s += 0.125) P.push(x + dir * 0.12 * s * L / 0.2, h - 0.02 - s * L, zf(x) + 0.02, 0.75 - 0.45 * s);
      add('ink', ridgeHex, 0.022, P);
    }
  };
  range((x) => -4.4 + 0.06 * x * x,
    (x) => 1.05 + 1.25 * g(x, -0.4, 0.75) + 0.9 * g(x, -2.3, 0.6) + 1.0 * g(x, 1.5, 0.8) + 0.55 * g(x, 3.1, 0.5) + 0.04 * wob(x, 1),
    0x4e5966, 0x66727f, 0.65, 0.33, 7, false, 0.95);
  range((x) => -3.3 + 0.05 * x * x,
    (x) => 0.7 + 0.95 * g(x, -2.7, 0.55) + 0.6 * g(x, -1.6, 0.45) + 1.1 * g(x, 2.4, 0.5) + 0.55 * g(x, 3.4, 0.4) + 0.035 * wob(x, 5),
    0x24272a, 0x363b40, 0.95, 0.4, 6, true, 0.7);

  // ── mist bands across the mountain feet ──
  for (const [y, z, p] of [[1.0, -3.9, 0.35], [0.78, -3.15, 0.3]]) {
    const P = []; for (let x = -3.9; x <= 3.9; x += 0.08) P.push(x, y + 0.03 * Math.sin(x * 1.7), z + 0.05 * x * x * 0.8, p * (0.7 + 0.3 * Math.sin(x * 2.3)));
    add('ink', 0xf1ece0, 0.34, P);
  }

  // ── birds ──
  for (const [bx, by, bz, sc] of [[0.85, 2.35, -3.7, 1], [1.08, 2.5, -3.75, 0.8], [1.22, 2.3, -3.65, 0.7]]) {
    for (const side of [-1, 1]) {
      const P = []; for (let s = 0; s <= 1.001; s += 0.2) P.push(bx + side * s * 0.06 * sc, by + (Math.sin(s * Math.PI * 0.8) * 0.022 - s * 0.005) * sc, bz, 0.9 - 0.5 * s);
      add('ink', 0x1a1714, 0.009, P);
    }
  }

  // ── pine tree ──
  const tx0 = -0.95, tz0 = -2.0, TH = 2.25;
  const trunk = (t) => [tx0 + 0.22 * Math.sin(t * 2.8) - 0.1 * t, t * TH, tz0 + 0.12 * Math.sin(t * 2.2)];
  {
    const P = [], L = [], R = [];
    for (let t = 0; t <= 1.001; t += 0.025) {
      const [x, y, z] = trunk(t), w = 0.07 * (1 - 0.6 * t);
      P.push(x, y, z, 1 - 0.3 * t);
      L.push(x - w + 0.01 * wob(t * 3, 2), y, z + 0.01, 0.95 - 0.35 * t);
      R.push(x + w + 0.01 * wob(t * 3, 4), y, z + 0.01, 0.9 - 0.35 * t);
    }
    add('ink', 0x4a4038, 0.15, P);
    add('ink', 0x15120f, 0.03, L);
    add('ink', 0x15120f, 0.022, R);
    for (let k = 0; k < 16; k++) {
      const t = 0.04 + rnd() * 0.8, [x, y, z] = trunk(t), w = 0.05 * (1 - 0.6 * t), Q = [];
      for (let s = 0; s <= 1.001; s += 0.25) Q.push(x - w * 0.6 + s * w * 1.2, y + Math.sin(s * Math.PI) * 0.02 - 0.01, z + 0.015, 0.7);
      add('ink', 0x1e1a16, 0.012, Q);
    }
  }
  const pad = (cx, cy, cz, width) => {
    for (const [oy, pr] of [[0, 0.24], [0.045, 0.18], [-0.035, 0.2]]) {
      const P = []; for (let s = 0; s <= 1.001; s += 0.1) P.push(cx - width / 2 + s * width, cy + oy + 0.03 * Math.sin(s * Math.PI), cz + 0.03 * Math.sin(s * 5), pr * Math.sin(0.15 + s * 2.84));
      add('ink', 0x3c5444, 0.13, P);
    }
    const fans = Math.max(3, Math.round(width / 0.075));
    for (let f = 0; f < fans; f++) {
      const fx = cx - width / 2 + (f + 0.5) * width / fans + (rnd() - 0.5) * 0.03, fy = cy - 0.015 + rnd() * 0.04 + 0.025 * Math.sin((f + 0.5) / fans * Math.PI), fz = cz + (rnd() - 0.5) * 0.08;
      for (let k = 0; k < 9; k++) {
        const a = 0.25 + k / 8 * (Math.PI - 0.5) + (rnd() - 0.5) * 0.15, L = 0.075 + rnd() * 0.04, P = [];
        for (let s = 0; s <= 1.001; s += 0.2) P.push(fx + Math.cos(a) * L * s, fy + Math.sin(a) * L * s, fz + (rnd() - 0.5) * 0.004, 0.95 - 0.6 * s);
        add('ink', 0x141c17, 0.011, P);
      }
    }
  };
  const branches = [[0.42, 1, 0.75], [0.52, -1, 0.62], [0.62, 1, 0.95], [0.71, -1, 0.8], [0.8, 1, 0.62], [0.88, -1, 0.5], [0.95, 1, 0.38]];
  for (const [t, dir, len] of branches) {
    const [x0, y0, z0] = trunk(t), P = [], dz = (rnd() - 0.5) * 0.5;
    const at = (s) => [x0 + dir * len * s, y0 - 0.12 * len * Math.sin(s * Math.PI * 0.8) + 0.2 * len * s * s, z0 + dz * len * s];
    for (let s = 0; s <= 1.001; s += 0.0625) { const [x, y, z] = at(s); P.push(x, y, z, 0.85 - 0.5 * s); }
    add('ink', 0x241f1a, 0.045, P);
    const [ex, ey, ez] = at(1), [mx, my, mz] = at(0.55);
    pad(ex, ey + 0.03, ez, 0.3 + len * 0.25);
    if (len > 0.55) pad(mx, my + 0.04, mz, 0.22 + len * 0.15);
  }
  { const [x, y, z] = trunk(1); pad(x, y + 0.05, z, 0.34); }

  // ── rocks at the foot of the pine ──
  for (const [rx, ry, rz, w, h] of [[-0.5, 0.13, -1.85, 0.26, 0.15], [-1.4, 0.08, -2.15, 0.18, 0.1]]) {
    const P = [];
    for (let a = Math.PI * 1.05; a <= Math.PI * 3.15; a += 0.12) { const r = 1 + 0.12 * Math.sin(a * 3 + rx * 10); P.push(rx + Math.cos(a) * w * r, ry + Math.max(-0.75, Math.sin(a)) * h * r, rz, 0.85 - 0.2 * Math.sin(a * 2)); }
    add('ink', 0x1f1b17, 0.026, P);
    for (let k = 0; k < 3; k++) { const Q = []; for (let s = 0; s <= 1.001; s += 0.125) Q.push(rx - w * 0.8 + s * w * 1.6, ry - h * 0.45 + k * h * 0.4 + 0.02 * Math.sin(s * 4), rz - 0.01, 0.28 * Math.sin(0.2 + s * 2.7)); add('ink', 0x5b5f5a, 0.1, Q); }
  }
  for (let k = 0; k < 14; k++) {
    const gx = -1.7 + rnd() * 1.6, gz = -2.0 + rnd() * 0.4, a = Math.PI / 2 + (rnd() - 0.5) * 1.1, L = 0.06 + rnd() * 0.08, P = [];
    for (let s = 0; s <= 1.001; s += 0.25) P.push(gx + Math.cos(a) * L * s, 0.01 + Math.sin(a) * L * s, gz, 0.85 - 0.6 * s);
    add('ink', 0x2a2f25, 0.008, P);
  }

  // ── bamboo grove on the right ──
  for (const [bx, bz, H, lean] of [[1.3, -1.75, 2.3, 0.08], [1.5, -1.9, 1.95, 0.16], [1.12, -1.62, 1.55, -0.1]]) {
    const at = (y) => [bx + lean * (y / H) * (y / H), y, bz];
    for (let y = 0; y < H - 0.05; y += 0.3) {
      const P = [];
      for (let s = 0; s <= 1.001; s += 0.2) { const yy = y + 0.012 + s * (0.3 - 0.024), [x, , z] = at(yy); P.push(x, yy, z, 0.8 - 0.15 * Math.sin(s * Math.PI)); }
      add('ink', 0x35553a, 0.045, P);
      if (y > 0) { const [x, , z] = at(y), Q = []; for (let s = 0; s <= 1.001; s += 0.5) Q.push(x - 0.035 + s * 0.07, y + 0.004 * Math.sin(s * Math.PI), z + 0.005, 0.9); add('ink', 0x15241a, 0.01, Q); }
      // twig + leaves on the upper nodes
      if (y > H * 0.45) {
        const dir = rnd() < 0.5 ? -1 : 1, [x, , z] = at(y), T = [], Lf = [], len = 0.22 + rnd() * 0.18, dz = (rnd() - 0.5) * 0.3;
        for (let s = 0; s <= 1.001; s += 0.1) T.push(x + dir * len * s, y + len * 0.5 * s - 0.08 * s * s, z + dz * s, 0.8 - 0.5 * s);
        add('ink', 0x1f2f22, 0.008, T);
        for (let s = 0.25; s <= 1.001; s += 0.05) Lf.push(x + dir * len * s, y + len * 0.5 * s - 0.08 * s * s - 0.01, z + dz * s, 0.95);
        add('leaf', 0x2a4a30, 0.045, Lf);
      }
    }
  }

  // ── gold dust drifting from the sun ──
  {
    const P = []; for (let s = 0; s <= 1.001; s += 0.02) P.push(0.55 + s * 1.5, 1.85 + s * 0.75 + 0.12 * Math.sin(s * 6), -2.6 - s * 1.6, 0.7);
    add('spark', 0xe8b04a, 0.035, P);
  }
  // ── artist's seal ──
  for (let k = 0; k < 4; k++) {
    const P = []; for (let s = 0; s <= 1.001; s += 0.25) P.push(2.0 + s * 0.11, 0.98 - k * 0.026, -2.55, 0.9);
    add('flat', 0xb02a1e, 0.03, P);
  }
  return out;
}
