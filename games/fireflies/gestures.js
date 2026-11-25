// Pure gesture classification for articulated hands (no THREE, no DOM).
// Joint positions are a flat Float32Array(75): 25 joints x (x, y, z), in WebXR joint order.
// Everything here is allocation-free once the output objects exist, and importable from tests.

export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];
export const J = { WRIST: 0, THUMB_TIP: 4, INDEX_PROX: 6, INDEX_TIP: 9, MIDDLE_PROX: 11, MIDDLE_TIP: 14, PINKY_PROX: 21 };

// Bones drawn between joints (pairs of joint indices). Finger chains + knuckle webbing.
export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
  [6, 11], [11, 16], [16, 21], [1, 6],
];

// Typical joint radii (m), used when the runtime does not provide them.
export const DEFAULT_RADII = new Float32Array([
  0.021,
  0.019, 0.013, 0.011, 0.009,
  0.016, 0.011, 0.0095, 0.0085, 0.0075,
  0.016, 0.0115, 0.01, 0.009, 0.0078,
  0.016, 0.011, 0.0095, 0.0085, 0.0075,
  0.015, 0.0095, 0.0085, 0.0078, 0.007,
]);

export function makeGesture() {
  return {
    pinch: false, fist: false, point: false, open: false,
    pinchDist: 1, curls: [0, 0, 0, 0],
    palm: [0, 0, 0], normal: [0, 1, 0], fwd: [0, 0, -1],
    pinchPoint: [0, 0, 0], indexTip: [0, 0, 0], pointDir: [0, 0, -1],
  };
}
export function makeCup() { return { cup: false, center: [0, 0, 0], dist: 1 }; }

function bendAngle(p, a, b, c) {
  // angle between bone a->b and bone b->c
  const ax = p[b * 3] - p[a * 3], ay = p[b * 3 + 1] - p[a * 3 + 1], az = p[b * 3 + 2] - p[a * 3 + 2];
  const bx = p[c * 3] - p[b * 3], by = p[c * 3 + 1] - p[b * 3 + 1], bz = p[c * 3 + 2] - p[b * 3 + 2];
  const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
  if (la < 1e-6 || lb < 1e-6) return 0;
  const d = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
}
function setDir(out, p, a, b) {
  const x = p[b * 3] - p[a * 3], y = p[b * 3 + 1] - p[a * 3 + 1], z = p[b * 3 + 2] - p[a * 3 + 2];
  const l = Math.hypot(x, y, z) || 1;
  out[0] = x / l; out[1] = y / l; out[2] = z / l;
}

// Classify one hand. `prev` (a previous output, may be the same object as `out`) gives hysteresis.
export function classifyHand(p, handedness, prev, out = makeGesture()) {
  const wasPinch = prev ? prev.pinch : false, wasFist = prev ? prev.fist : false;
  const wasPoint = prev ? prev.point : false, wasOpen = prev ? prev.open : false;
  // finger curl: summed joint bend angles (MCP + PIP + DIP), ~0 straight, ~1 fully curled
  for (let k = 0; k < 4; k++) {
    const b = 5 + 5 * k;
    const s = bendAngle(p, b, b + 1, b + 2) + bendAngle(p, b + 1, b + 2, b + 3) + bendAngle(p, b + 2, b + 3, b + 4);
    const c = s / 3.6;
    out.curls[k] = c > 1 ? 1 : c;
  }
  const tx = p[12], ty = p[13], tz = p[14], ix = p[27], iy = p[28], iz = p[29];
  out.pinchDist = Math.hypot(tx - ix, ty - iy, tz - iz);
  out.pinchPoint[0] = (tx + ix) * 0.5; out.pinchPoint[1] = (ty + iy) * 0.5; out.pinchPoint[2] = (tz + iz) * 0.5;
  out.indexTip[0] = ix; out.indexTip[1] = iy; out.indexTip[2] = iz;
  // palm frame
  const wx = p[0], wy = p[1], wz = p[2];
  const ax = p[18] - wx, ay = p[19] - wy, az = p[20] - wz;      // index proximal
  const bx = p[63] - wx, by = p[64] - wy, bz = p[65] - wz;      // pinky proximal
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  if (handedness === 'left') { nx = -nx; ny = -ny; nz = -nz; }
  const nl = Math.hypot(nx, ny, nz) || 1;
  out.normal[0] = nx / nl; out.normal[1] = ny / nl; out.normal[2] = nz / nl;
  out.palm[0] = (wx + p[18] + p[33] + p[63]) * 0.25;
  out.palm[1] = (wy + p[19] + p[34] + p[64]) * 0.25;
  out.palm[2] = (wz + p[20] + p[35] + p[65]) * 0.25;
  setDir(out.fwd, p, 0, 11);
  setDir(out.pointDir, p, 6, 9);

  const [ci, cm, cr, cp] = out.curls;
  const pinch = wasPinch ? out.pinchDist < 0.045 : out.pinchDist < 0.025;
  const others = Math.min(cm, cr, cp);
  const fist = !pinch && (wasFist ? Math.min(ci, cm, cr, cp) > 0.5 : Math.min(ci, cm, cr, cp) > 0.62);
  const point = !pinch && !fist && (wasPoint ? ci < 0.4 && others > 0.45 : ci < 0.3 && others > 0.55);
  const maxC = Math.max(ci, cm, cr, cp);
  const open = !pinch && !fist && !point && (wasOpen ? maxC < 0.45 : maxC < 0.35) && out.pinchDist > 0.045;
  out.pinch = pinch; out.fist = fist; out.point = point; out.open = open;
  return out;
}

// Two palms close together, both facing up, fingers not clenched: a bowl.
export function classifyCup(L, R, prevCup, out = makeCup()) {
  const was = prevCup ? prevCup.cup : false;
  const d = Math.hypot(L.palm[0] - R.palm[0], L.palm[1] - R.palm[1], L.palm[2] - R.palm[2]);
  out.dist = d;
  const up = was ? 0.3 : 0.45, maxD = was ? 0.22 : 0.17;
  const relaxed = (L.curls[1] + L.curls[2] + L.curls[3]) / 3 < 0.7 && (R.curls[1] + R.curls[2] + R.curls[3]) / 3 < 0.7;
  out.cup = L.normal[1] > up && R.normal[1] > up && d < maxD && relaxed && !L.pinch && !R.pinch && !L.fist && !R.fist;
  out.center[0] = (L.palm[0] + R.palm[0]) * 0.5;
  out.center[1] = (L.palm[1] + R.palm[1]) * 0.5 + 0.035;
  out.center[2] = (L.palm[2] + R.palm[2]) * 0.5;
  return out;
}

// ── Synthetic hand poser ─────────────────────────────────────
// Builds a stylised hand in hand-local space (wrist at origin, fingers toward -Z, palm facing -Y),
// then transforms it by a column-major 4x4 matrix `m` (THREE.Matrix4.elements) if given.
// curls: [index, middle, ring, pinky] 0..1; pinch 0..1 brings thumb tip to index tip; tuck 0..1 folds thumb.
const KNUCKLE = [[-0.022, -0.087], [-0.002, -0.092], [0.017, -0.087], [0.033, -0.077]];
const SEG = [[0.040, 0.024, 0.020], [0.045, 0.028, 0.022], [0.042, 0.026, 0.020], [0.032, 0.020, 0.018]];
const BEND = [1.35, 1.55, 0.95];
const THUMB = [[-0.019, -0.012, -0.022], [-0.040, -0.020, -0.045], [-0.053, -0.022, -0.073], [-0.060, -0.022, -0.097]];
const _tmp = new Float32Array(75);
export function poseHand(out, handedness, curls, pinch = 0, tuck = 0, m = null) {
  const s = handedness === 'left' ? -1 : 1;
  const P = _tmp;
  P[0] = 0; P[1] = 0; P[2] = 0;
  for (let k = 0; k < 4; k++) {
    const b = 5 + 5 * k, kx = KNUCKLE[k][0] * s, kz = KNUCKLE[k][1];
    const mx = kx * 0.35, mz = -0.025;
    P[b * 3] = mx; P[b * 3 + 1] = 0; P[b * 3 + 2] = mz;
    P[(b + 1) * 3] = kx; P[(b + 1) * 3 + 1] = 0; P[(b + 1) * 3 + 2] = kz;
    let dx = kx - mx, dz = kz - mz; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    let a = 0, x = kx, y = 0, z = kz;
    const c = curls[k];
    for (let j = 0; j < 3; j++) {
      a += BEND[j] * c;
      const ca = Math.cos(a), sa = Math.sin(a);
      x += SEG[k][j] * dx * ca; z += SEG[k][j] * dz * ca; y -= SEG[k][j] * sa;
      const q = (b + 2 + j) * 3;
      P[q] = x; P[q + 1] = y; P[q + 2] = z;
    }
  }
  // thumb
  for (let j = 0; j < 4; j++) { P[(1 + j) * 3] = THUMB[j][0] * s; P[(1 + j) * 3 + 1] = THUMB[j][1]; P[(1 + j) * 3 + 2] = THUMB[j][2]; }
  if (tuck > 0) {
    const tgt = [[-0.03 * s, -0.03, -0.05], [-0.025 * s, -0.04, -0.075], [-0.005 * s, -0.045, -0.085]];
    for (let j = 0; j < 3; j++) for (let e = 0; e < 3; e++) { const q = (2 + j) * 3 + e; P[q] += (tgt[j][e] - P[q]) * tuck; }
  }
  if (pinch > 0) {
    const ix = P[27], iy = P[28], iz = P[29];
    const w = [0, 0.35, 0.7, 1];
    for (let j = 1; j < 4; j++) {
      const q = (1 + j) * 3, t = pinch * w[j];
      const gx = j === 3 ? ix : (P[q] + ix) * 0.5, gy = j === 3 ? iy - 0.004 : (P[q + 1] + iy) * 0.5 - 0.01, gz = j === 3 ? iz : (P[q + 2] + iz) * 0.5 + 0.01;
      P[q] += (gx - P[q]) * t; P[q + 1] += (gy - P[q + 1]) * t; P[q + 2] += (gz - P[q + 2]) * t;
    }
  }
  for (let i = 0; i < 25; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (m) {
      out[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      out[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      out[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    } else { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; }
  }
  return out;
}
