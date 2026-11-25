// Small rigid-body engine for Night Market Toss.
// Shapes: sphere, box, cylinder (Y axis), torus (ring, Y axis), cup (bowl, static only).
// Contacts: each body carries surface sample points (with a radius); samples of one body are tested
// against the signed distance field of the other. Solver: sequential impulses with accumulated
// clamping, Coulomb friction (two tangents), restitution, Baumgarte bias, rolling resistance,
// sleeping. Fixed timestep with substeps. No allocations inside step().
import * as THREE from 'three';

export const SPHERE = 0, BOX = 1, CYL = 2, TORUS = 3, CUP = 4;

let _bodyId = 0;
export class Body {
  // shape: { kind, r, hx, hy, hz, hh, R, t, depth }
  constructor(shape, { mass = 0, restitution = 0.2, friction = 0.5, rolling = 0.5, linDamp = 0.02, angDamp = 0.1, rimSamples = 12, noRotate = false, tag = '' } = {}) {
    this.id = _bodyId++;
    this.shape = shape;
    this.kind = shape.kind;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.isStatic = mass <= 0;
    this.mass = mass; this.invMass = mass > 0 ? 1 / mass : 0;
    this.restitution = restitution; this.friction = friction; this.rolling = rolling;
    this.linDamp = linDamp; this.angDamp = angDamp;
    this.noRotate = noRotate;
    this.tag = tag;
    this.sleeping = false; this.sleepTimer = 0;
    this.held = false;      // excluded from simulation (follows a hand)
    this.enabled = true;    // excluded entirely when false
    this.pinned = false;    // stuck (darts): behaves as static
    this.touching = 0;      // contacts in the last substep
    this.user = null;
    this.invI = new Float64Array(9);
    this.aabb = new Float64Array(6);
    this.moving = false;     // statics that are moved every frame (recompute AABB)
    this.invILocal = new Float64Array(3);
    this._buildSamples(rimSamples);
    this._buildInertia();
    this.bound = this._bound();
    this.ws = new Float64Array(this.samples.length);  // world samples
    this.wsDirty = true;
    this.updateInertia();
  }
  _bound() {
    const s = this.shape;
    switch (this.kind) {
      case SPHERE: return s.r;
      case BOX: return Math.hypot(s.hx, s.hy, s.hz);
      case CYL: return Math.hypot(s.r, s.hh);
      case TORUS: return s.R + s.r;
      case CUP: return Math.hypot(s.R, s.hh);
    }
    return 1;
  }
  _buildSamples(n) {
    const s = this.shape, pts = [];
    let sr = 0;
    if (this.kind === SPHERE) { pts.push(0, 0, 0); sr = s.r; }
    else if (this.kind === BOX) {
      for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
        if (x === 0 && y === 0 && z === 0) continue;
        pts.push(x * s.hx, y * s.hy, z * s.hz);
      }
    } else if (this.kind === CYL) {
      for (const y of [-s.hh, s.hh]) {
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(Math.cos(a) * s.r, y, Math.sin(a) * s.r); }
        pts.push(0, y, 0);
      }
      if (s.hh > s.r * 0.8) for (let i = 0; i < n; i += 2) { const a = (i + 1) / n * Math.PI * 2; pts.push(Math.cos(a) * s.r, 0, Math.sin(a) * s.r); }
    } else if (this.kind === TORUS) {
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push(Math.cos(a) * s.R, 0, Math.sin(a) * s.R); }
      sr = s.r;
    }
    this.samples = new Float64Array(pts);
    this.sampleR = sr;
  }
  _buildInertia() {
    const s = this.shape, m = this.mass;
    let ix = 0, iy = 0, iz = 0;
    if (m > 0) {
      switch (this.kind) {
        case SPHERE: ix = iy = iz = 0.4 * m * s.r * s.r; break;
        case BOX: ix = m / 3 * (s.hy * s.hy + s.hz * s.hz); iy = m / 3 * (s.hx * s.hx + s.hz * s.hz); iz = m / 3 * (s.hx * s.hx + s.hy * s.hy); break;
        case CYL: iy = 0.5 * m * s.r * s.r; ix = iz = m / 12 * (3 * s.r * s.r + 4 * s.hh * s.hh); break;
        case TORUS: iy = m * s.R * s.R; ix = iz = 0.5 * m * s.R * s.R; break;
      }
    }
    const L = this.invILocal;
    L[0] = ix > 0 && !this.noRotate ? 1 / ix : 0; L[1] = iy > 0 && !this.noRotate ? 1 / iy : 0; L[2] = iz > 0 && !this.noRotate ? 1 / iz : 0;
  }
  updateInertia() {
    const q = this.quat, x = q.x, y = q.y, z = q.z, w = q.w;
    // rotation matrix
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    const a = this.invILocal[0], b = this.invILocal[1], c = this.invILocal[2], I = this.invI;
    I[0] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c;
    I[1] = r00 * r10 * a + r01 * r11 * b + r02 * r12 * c;
    I[2] = r00 * r20 * a + r01 * r21 * b + r02 * r22 * c;
    I[3] = I[1];
    I[4] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c;
    I[5] = r10 * r20 * a + r11 * r21 * b + r12 * r22 * c;
    I[6] = I[2]; I[7] = I[5];
    I[8] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;
    this.wsDirty = true;
  }
  wake() { this.sleeping = false; this.sleepTimer = 0; }
  // world-space AABB (used for statics; dynamic bodies use pos ± bound)
  computeAABB() {
    const s = this.shape, q = this.quat, x = q.x, y = q.y, z = q.z, w = q.w;
    const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * w), r02 = 2 * (x * z + y * w);
    const r10 = 2 * (x * y + z * w), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * w);
    const r20 = 2 * (x * z - y * w), r21 = 2 * (y * z + x * w), r22 = 1 - 2 * (x * x + y * y);
    let ex, ey, ez;
    if (this.kind === BOX) {
      ex = Math.abs(r00) * s.hx + Math.abs(r01) * s.hy + Math.abs(r02) * s.hz;
      ey = Math.abs(r10) * s.hx + Math.abs(r11) * s.hy + Math.abs(r12) * s.hz;
      ez = Math.abs(r20) * s.hx + Math.abs(r21) * s.hy + Math.abs(r22) * s.hz;
    } else if (this.kind === SPHERE) { ex = ey = ez = s.r; }
    else {
      // Y-axis solids of revolution: axis a = column 1, radius rr, half height hh
      const rr = this.kind === TORUS ? s.R + s.r : s.R ?? s.r, hh = this.kind === TORUS ? s.r : s.hh;
      ex = Math.abs(r01) * hh + rr * Math.sqrt(Math.max(0, 1 - r01 * r01));
      ey = Math.abs(r11) * hh + rr * Math.sqrt(Math.max(0, 1 - r11 * r11));
      ez = Math.abs(r21) * hh + rr * Math.sqrt(Math.max(0, 1 - r21 * r21));
    }
    const m = 0.01, a = this.aabb;
    a[0] = this.pos.x - ex - m; a[1] = this.pos.y - ey - m; a[2] = this.pos.z - ez - m;
    a[3] = this.pos.x + ex + m; a[4] = this.pos.y + ey + m; a[5] = this.pos.z + ez + m;
  }
  // Teleport + zero velocity.
  place(x, y, z, quat = null) {
    this.pos.set(x, y, z); if (quat) this.quat.copy(quat);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.updateInertia(); this.wake();
  }
  get dynamic() { return !this.isStatic && !this.pinned; }
}

// ── math scratch (module level, reused) ───────────────────────
const N = { x: 0, y: 0, z: 0 };   // sdf normal output
const L = { x: 0, y: 0, z: 0 };   // local point
function rot(q, x, y, z, out) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out.x = x + qw * tx + qy * tz - qz * ty; out.y = y + qw * ty + qz * tx - qx * tz; out.z = z + qw * tz + qx * ty - qy * tx;
}
function rotInv(q, x, y, z, out) {
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out.x = x + qw * tx + qy * tz - qz * ty; out.y = y + qw * ty + qz * tx - qx * tz; out.z = z + qw * tz + qx * ty - qy * tx;
}

function cupDist(s, px, py, pz) {
  const rl = Math.sqrt(px * px + pz * pz);
  // outer solid cylinder
  let dx = rl - s.R, dy = Math.abs(py) - s.hh;
  const outer = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  // recess: cylinder radius R - t from y = hh - depth upward
  const cy = py - s.hh;
  dx = rl - (s.R - s.t); dy = Math.abs(cy) - s.depth;
  const inner = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return Math.max(outer, -inner);
}

// Signed distance from local point (px,py,pz) to shape; local normal into N.
function sdfLocal(b, px, py, pz) {
  const s = b.shape;
  switch (b.kind) {
    case SPHERE: {
      const l = Math.sqrt(px * px + py * py + pz * pz);
      if (l > 1e-9) { N.x = px / l; N.y = py / l; N.z = pz / l; } else { N.x = 0; N.y = 1; N.z = 0; }
      return l - s.r;
    }
    case BOX: {
      const ax = Math.abs(px) - s.hx, ay = Math.abs(py) - s.hy, az = Math.abs(pz) - s.hz;
      if (ax > 0 || ay > 0 || az > 0) {
        const ox = ax > 0 ? ax : 0, oy = ay > 0 ? ay : 0, oz = az > 0 ? az : 0;
        const l = Math.sqrt(ox * ox + oy * oy + oz * oz);
        N.x = (px < 0 ? -ox : ox) / l; N.y = (py < 0 ? -oy : oy) / l; N.z = (pz < 0 ? -oz : oz) / l;
        return l;
      }
      if (ax >= ay && ax >= az) { N.x = px < 0 ? -1 : 1; N.y = 0; N.z = 0; return ax; }
      if (ay >= az) { N.x = 0; N.y = py < 0 ? -1 : 1; N.z = 0; return ay; }
      N.x = 0; N.y = 0; N.z = pz < 0 ? -1 : 1; return az;
    }
    case CYL: {
      const rl = Math.sqrt(px * px + pz * pz);
      const rx = rl > 1e-9 ? px / rl : 1, rz = rl > 1e-9 ? pz / rl : 0;
      const dx = rl - s.r, dy = Math.abs(py) - s.hh, sy = py < 0 ? -1 : 1;
      if (dx > 0 || dy > 0) {
        const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0, l = Math.sqrt(ox * ox + oy * oy);
        N.x = rx * ox / l; N.y = sy * oy / l; N.z = rz * ox / l;
        return l;
      }
      if (dx > dy) { N.x = rx; N.y = 0; N.z = rz; return dx; }
      N.x = 0; N.y = sy; N.z = 0; return dy;
    }
    case TORUS: {
      const rl = Math.sqrt(px * px + pz * pz);
      const rx = rl > 1e-9 ? px / rl : 1, rz = rl > 1e-9 ? pz / rl : 0;
      const qx = rl - s.R, qy = py, ql = Math.sqrt(qx * qx + qy * qy);
      if (ql > 1e-9) { N.x = rx * qx / ql; N.y = qy / ql; N.z = rz * qx / ql; } else { N.x = 0; N.y = 1; N.z = 0; }
      return ql - s.r;
    }
    case CUP: {
      const d = cupDist(s, px, py, pz), e = 0.0015;
      let gx = cupDist(s, px + e, py, pz) - d, gy = cupDist(s, px, py + e, pz) - d, gz = cupDist(s, px, py, pz + e) - d;
      const l = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (l > 1e-12) { N.x = gx / l; N.y = gy / l; N.z = gz / l; } else { N.x = 0; N.y = 1; N.z = 0; }
      return d;
    }
  }
  return 1e9;
}
// World-space SDF of body b at (x,y,z); world normal into N.
function sdfWorld(b, x, y, z) {
  rotInv(b.quat, x - b.pos.x, y - b.pos.y, z - b.pos.z, L);
  const d = sdfLocal(b, L.x, L.y, L.z);
  rot(b.quat, N.x, N.y, N.z, L);
  N.x = L.x; N.y = L.y; N.z = L.z;
  return d;
}
export function sdf(b, p, outNormal) { const d = sdfWorld(b, p.x, p.y, p.z); if (outNormal) outNormal.set(N.x, N.y, N.z); return d; }

// ── contacts (struct-of-arrays) ───────────────────────────────
const MAXC = 3000, S = 24;
// layout: 0-2 n, 3-5 ra, 6-8 rb, 9-11 t1, 12-14 t2, 15 mN, 16 mT1, 17 mT2, 18 jn, 19 jt1, 20 jt2, 21 target, 22 mu, 23 depth

export class World {
  constructor({ gravity = -9.81, dt = 1 / 240, iterations = 8, maxSubsteps = 12, groundY = 0 } = {}) {
    this.g = gravity; this.dt = dt; this.iterations = iterations; this.maxSubsteps = maxSubsteps; this.groundY = groundY;
    this.bodies = []; this.statics = [];
    this.acc = 0;
    this.C = new Float64Array(MAXC * S);
    this.ca = new Array(MAXC).fill(null); this.cb = new Array(MAXC).fill(null);
    this.cAdyn = new Uint8Array(MAXC); this.cBdyn = new Uint8Array(MAXC);
    this.nc = 0;
    this.beta = 0.25; this.slop = 0.0015; this.maxBias = 1.5;
    // impact events for the game (cleared each step() call)
    this.impacts = []; for (let i = 0; i < 96; i++) this.impacts.push({ a: null, b: null, speed: 0, x: 0, y: 0, z: 0 });
    this.impactCount = 0;
    this.sleepLin = 0.07; this.sleepAng = 0.5; this.sleepTime = 0.5;
    this.substeps = 0;
    this.onSubstep = null; // optional callback(dt) per substep (e.g. water drag)
  }
  add(b) { if (b.isStatic) { this.statics.push(b); b.computeAABB(); } else this.bodies.push(b); b.updateInertia(); return b; }
  remove(b) { const a = b.isStatic ? this.statics : this.bodies; const i = a.indexOf(b); if (i >= 0) a.splice(i, 1); }

  step(frameDt) {
    this.impactCount = 0;
    this.acc += frameDt;
    let n = 0;
    while (this.acc >= this.dt && n < this.maxSubsteps) { this.substep(this.dt); this.acc -= this.dt; n++; }
    if (n >= this.maxSubsteps) this.acc = 0;
    this.substeps = n;
    return n;
  }

  _active(b) { return b.enabled && !b.held && !b.pinned; }

  _updateSamples(b) {
    if (!b.wsDirty) return;
    const s = b.samples, w = b.ws, q = b.quat, p = b.pos;
    for (let i = 0; i < s.length; i += 3) {
      rot(q, s[i], s[i + 1], s[i + 2], L);
      w[i] = L.x + p.x; w[i + 1] = L.y + p.y; w[i + 2] = L.z + p.z;
    }
    b.wsDirty = false;
  }

  _addContact(a, b, nx, ny, nz, px, py, pz, depth) {
    if (this.nc >= MAXC) return;
    const i = this.nc++, o = i * S, C = this.C;
    this.ca[i] = a; this.cb[i] = b;
    C[o] = nx; C[o + 1] = ny; C[o + 2] = nz;
    C[o + 3] = px - a.pos.x; C[o + 4] = py - a.pos.y; C[o + 5] = pz - a.pos.z;
    if (b) { C[o + 6] = px - b.pos.x; C[o + 7] = py - b.pos.y; C[o + 8] = pz - b.pos.z; } else { C[o + 6] = C[o + 7] = C[o + 8] = 0; }
    C[o + 23] = depth;
    a.touching++; if (b) b.touching++;
  }

  // samples of A against SDF of B (B may be static). Contact normal points from B to A.
  _collideSamples(a, b) {
    const w = a.ws, sr = a.sampleR, margin = 0.002;
    let found = 0;
    for (let i = 0; i < w.length; i += 3) {
      const x = w[i], y = w[i + 1], z = w[i + 2];
      const d = sdfWorld(b, x, y, z);
      if (d < sr + margin) {
        this._addContact(a, b, N.x, N.y, N.z, x - N.x * sr, y - N.y * sr, z - N.z * sr, sr - d);
        found++;
      }
    }
    return found;
  }

  substep(dt) {
    const bodies = this.bodies, statics = this.statics, g = this.g, gy = this.groundY;
    this.substeps++;
    // 1. forces
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      b.touching = 0;
      if (!this._active(b) || b.sleeping) continue;
      b.vel.y += g * dt;
      const ld = Math.max(0, 1 - b.linDamp * dt), ad = Math.max(0, 1 - b.angDamp * dt);
      b.vel.multiplyScalar(ld); b.angVel.multiplyScalar(ad);
      this._updateSamples(b);
    }
    this.onSubstep?.(dt);
    for (let j = 0; j < statics.length; j++) if (statics[j].moving) statics[j].computeAABB();
    // 2. contacts
    this.nc = 0;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!this._active(a)) continue;
      if (a.sleeping) { this._updateSamples(a); continue; }
      // ground plane
      const w = a.ws, sr = a.sampleR;
      if (a.pos.y - a.bound < gy + 0.01) {
        for (let k = 0; k < w.length; k += 3) {
          const d = w[k + 1] - sr - gy;
          if (d < 0.002) this._addContact(a, null, 0, 1, 0, w[k], w[k + 1] - sr, w[k + 2], -d);
        }
      }
      // statics
      const ab = a.bound, ax = a.pos.x, ay = a.pos.y, az = a.pos.z;
      for (let j = 0; j < statics.length; j++) {
        const s = statics[j], A = s.aabb;
        if (!s.enabled || ax + ab < A[0] || ax - ab > A[3] || ay + ab < A[1] || ay - ab > A[4] || az + ab < A[2] || az - ab > A[5]) continue;
        this._collideSamples(a, s);
      }
      // pinned dynamic bodies act like statics
      for (let j = 0; j < bodies.length; j++) {
        const s = bodies[j];
        if (!s.pinned || !s.enabled || s === a) continue;
        const dx = a.pos.x - s.pos.x, dy = a.pos.y - s.pos.y, dz = a.pos.z - s.pos.z, r = a.bound + s.bound + 0.01;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        this._collideSamples(a, s);
      }
    }
    // dynamic pairs
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!this._active(a)) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!this._active(b)) continue;
        if (a.sleeping && b.sleeping) continue;
        const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z, r = a.bound + b.bound + 0.01;
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        const before = this.nc;
        this._collideSamples(a, b);
        if (!(a.kind === SPHERE && b.kind === SPHERE)) this._collideSamples(b, a);
        if (this.nc > before && (a.sleeping || b.sleeping)) {
          const aw = a.sleeping ? b : a, sl = a.sleeping ? a : b;
          if (aw.vel.lengthSq() > 0.09 || aw.angVel.lengthSq() > 2) sl.wake();
        }
      }
    }
    // 3. prestep
    const C = this.C, beta = this.beta / dt;
    for (let i = 0; i < this.nc; i++) {
      const o = i * S, a = this.ca[i], b = this.cb[i];
      const aDyn = a.sleeping ? 0 : 1, bDyn = b && !b.isStatic && !b.pinned && !b.sleeping ? 1 : 0;
      this.cAdyn[i] = aDyn; this.cBdyn[i] = bDyn;
      const nx = C[o], ny = C[o + 1], nz = C[o + 2];
      // tangents
      let t1x, t1y, t1z;
      if (Math.abs(nx) < 0.57) { t1x = 0; t1y = nz; t1z = -ny; } else { t1x = -nz; t1y = 0; t1z = nx; }
      let l = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z); t1x /= l; t1y /= l; t1z /= l;
      const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
      C[o + 9] = t1x; C[o + 10] = t1y; C[o + 11] = t1z; C[o + 12] = t2x; C[o + 13] = t2y; C[o + 14] = t2z;
      C[o + 15] = 1 / this._k(i, nx, ny, nz);
      C[o + 16] = 1 / this._k(i, t1x, t1y, t1z);
      C[o + 17] = 1 / this._k(i, t2x, t2y, t2z);
      C[o + 18] = C[o + 19] = C[o + 20] = 0;
      const vn = this._relVel(i, nx, ny, nz);
      const e = Math.max(a.restitution, b ? b.restitution : 0.3);
      let target = vn < -0.6 ? -e * vn : 0;
      const bias = Math.min(this.maxBias, Math.max(0, C[o + 23] - this.slop) * beta);
      if (bias > target) target = bias;
      C[o + 21] = target;
      C[o + 22] = Math.sqrt(a.friction * (b ? b.friction : 0.6));
      if (vn < -0.8 && this.impactCount < this.impacts.length) {
        // de-dup: one per body pair per substep
        let dup = false;
        for (let k = this.impactCount - 1; k >= 0 && k >= this.impactCount - 8; k--) { const e2 = this.impacts[k]; if (e2.a === a && e2.b === b) { if (-vn > e2.speed) e2.speed = -vn; dup = true; break; } }
        if (!dup) { const ev = this.impacts[this.impactCount++]; ev.a = a; ev.b = b; ev.speed = -vn; ev.x = a.pos.x + C[o + 3]; ev.y = a.pos.y + C[o + 4]; ev.z = a.pos.z + C[o + 5]; }
      }
    }
    // 4. iterations
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < this.nc; i++) {
        const o = i * S;
        const nx = C[o], ny = C[o + 1], nz = C[o + 2];
        let vn = this._relVel(i, nx, ny, nz);
        let lam = (C[o + 21] - vn) * C[o + 15];
        const jn0 = C[o + 18], jn = Math.max(0, jn0 + lam); lam = jn - jn0; C[o + 18] = jn;
        if (lam !== 0) this._apply(i, nx * lam, ny * lam, nz * lam);
        const maxF = C[o + 22] * jn;
        // friction 1
        let tx = C[o + 9], ty = C[o + 10], tz = C[o + 11];
        let vt = this._relVel(i, tx, ty, tz);
        lam = -vt * C[o + 16];
        let j0 = C[o + 19], j1 = Math.max(-maxF, Math.min(maxF, j0 + lam)); lam = j1 - j0; C[o + 19] = j1;
        if (lam !== 0) this._apply(i, tx * lam, ty * lam, tz * lam);
        tx = C[o + 12]; ty = C[o + 13]; tz = C[o + 14];
        vt = this._relVel(i, tx, ty, tz);
        lam = -vt * C[o + 17];
        j0 = C[o + 20]; j1 = Math.max(-maxF, Math.min(maxF, j0 + lam)); lam = j1 - j0; C[o + 20] = j1;
        if (lam !== 0) this._apply(i, tx * lam, ty * lam, tz * lam);
      }
    }
    // 5. integrate
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!this._active(b) || b.sleeping) continue;
      if (b.touching > 0 && b.rolling > 0) { const f = Math.max(0, 1 - b.rolling * dt * 6); b.angVel.multiplyScalar(f); }
      const vl = b.vel.lengthSq(); if (vl > 1600) b.vel.multiplyScalar(40 / Math.sqrt(vl));
      const wl = b.angVel.lengthSq(); if (wl > 3600) b.angVel.multiplyScalar(60 / Math.sqrt(wl));
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      if (!b.noRotate) {
        const q = b.quat, wx = b.angVel.x, wy = b.angVel.y, wz = b.angVel.z, h = 0.5 * dt;
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        q.x = qx + h * (wx * qw + wy * qz - wz * qy);
        q.y = qy + h * (wy * qw + wz * qx - wx * qz);
        q.z = qz + h * (wz * qw + wx * qy - wy * qx);
        q.w = qw + h * (-wx * qx - wy * qy - wz * qz);
        q.normalize();
      }
      b.updateInertia();
      // sleep
      if (b.touching > 0 && b.vel.lengthSq() < this.sleepLin * this.sleepLin && b.angVel.lengthSq() < this.sleepAng * this.sleepAng) {
        b.sleepTimer += dt;
        if (b.sleepTimer > this.sleepTime) { b.sleeping = true; b.vel.set(0, 0, 0); b.angVel.set(0, 0, 0); }
      } else b.sleepTimer = 0;
    }
  }

  // effective mass denominator along direction d for contact i
  _k(i, dx, dy, dz) {
    const o = i * S, C = this.C, a = this.ca[i], b = this.cb[i];
    let k = 0;
    if (this.cAdyn[i]) {
      k += a.invMass;
      const rx = C[o + 3], ry = C[o + 4], rz = C[o + 5];
      const cx = ry * dz - rz * dy, cy = rz * dx - rx * dz, cz = rx * dy - ry * dx, I = a.invI;
      const ix = I[0] * cx + I[1] * cy + I[2] * cz, iy = I[3] * cx + I[4] * cy + I[5] * cz, iz = I[6] * cx + I[7] * cy + I[8] * cz;
      k += cx * ix + cy * iy + cz * iz;
    }
    if (this.cBdyn[i]) {
      k += b.invMass;
      const rx = C[o + 6], ry = C[o + 7], rz = C[o + 8];
      const cx = ry * dz - rz * dy, cy = rz * dx - rx * dz, cz = rx * dy - ry * dx, I = b.invI;
      const ix = I[0] * cx + I[1] * cy + I[2] * cz, iy = I[3] * cx + I[4] * cy + I[5] * cz, iz = I[6] * cx + I[7] * cy + I[8] * cz;
      k += cx * ix + cy * iy + cz * iz;
    }
    return k > 1e-9 ? k : 1e9;
  }
  // relative velocity (a - b) at contact i along direction d
  _relVel(i, dx, dy, dz) {
    const o = i * S, C = this.C, a = this.ca[i], b = this.cb[i];
    let vx = 0, vy = 0, vz = 0;
    if (this.cAdyn[i]) {
      const rx = C[o + 3], ry = C[o + 4], rz = C[o + 5], w = a.angVel, v = a.vel;
      vx = v.x + w.y * rz - w.z * ry; vy = v.y + w.z * rx - w.x * rz; vz = v.z + w.x * ry - w.y * rx;
    }
    if (b) {
      if (this.cBdyn[i]) {
        const rx = C[o + 6], ry = C[o + 7], rz = C[o + 8], w = b.angVel, v = b.vel;
        vx -= v.x + w.y * rz - w.z * ry; vy -= v.y + w.z * rx - w.x * rz; vz -= v.z + w.x * ry - w.y * rx;
      } else if (b.isStatic) { vx -= b.vel.x; vy -= b.vel.y; vz -= b.vel.z; } // kinematic statics
    }
    return vx * dx + vy * dy + vz * dz;
  }
  // apply impulse (+ to a, - to b)
  _apply(i, jx, jy, jz) {
    const o = i * S, C = this.C;
    if (this.cAdyn[i]) {
      const a = this.ca[i], m = a.invMass, I = a.invI;
      a.vel.x += jx * m; a.vel.y += jy * m; a.vel.z += jz * m;
      const rx = C[o + 3], ry = C[o + 4], rz = C[o + 5];
      const cx = ry * jz - rz * jy, cy = rz * jx - rx * jz, cz = rx * jy - ry * jx;
      a.angVel.x += I[0] * cx + I[1] * cy + I[2] * cz; a.angVel.y += I[3] * cx + I[4] * cy + I[5] * cz; a.angVel.z += I[6] * cx + I[7] * cy + I[8] * cz;
    }
    if (this.cBdyn[i]) {
      const b = this.cb[i], m = b.invMass, I = b.invI;
      b.vel.x -= jx * m; b.vel.y -= jy * m; b.vel.z -= jz * m;
      const rx = C[o + 6], ry = C[o + 7], rz = C[o + 8];
      const cx = ry * jz - rz * jy, cy = rz * jx - rx * jz, cz = rx * jy - ry * jx;
      b.angVel.x -= I[0] * cx + I[1] * cy + I[2] * cz; b.angVel.y -= I[3] * cx + I[4] * cy + I[5] * cz; b.angVel.z -= I[6] * cx + I[7] * cy + I[8] * cz;
    }
  }

  // Ray vs body bounding spheres (for desktop grabbing). Returns nearest body or null.
  raycastBodies(origin, dir, maxDist, filter) {
    let best = null, bestT = maxDist;
    for (const b of this.bodies) {
      if (!b.enabled || b.held || (filter && !filter(b))) continue;
      const ox = b.pos.x - origin.x, oy = b.pos.y - origin.y, oz = b.pos.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > bestT) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t, r = Math.max(b.bound, 0.07) + 0.04 + t * 0.012;
      if (d2 < r * r) { best = b; bestT = t; }
    }
    return best;
  }
}
