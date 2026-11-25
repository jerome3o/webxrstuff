import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, BLADE_Z, BLADE_AY, BLADE_AZ, BLADE_HT, contact, paddleRestitution, MU_PADDLE } from './physics.js';

// ── Paddle rigid body driven by a tracked pose ───────────────
// Keeps the pose at the start and end of the current frame. Inside the frame the pose is
// interpolated (lerp / slerp), so the paddle's linear and angular velocity are the exact
// derivatives of that path. Ball contact is swept: the ball's start/end positions in a physics
// sub-step are expressed in the paddle frame at the sub-step's start/end time, and the segment
// is tested against the blade faces, so fast swings cannot tunnel.
export class PaddleBody {
  constructor() {
    this.p0 = new THREE.Vector3(); this.q0 = new THREE.Quaternion();
    this.p1 = new THREE.Vector3(); this.q1 = new THREE.Quaternion();
    this.vel = new THREE.Vector3(); this.angVel = new THREE.Vector3();
    this.hasPose = false; this.enabled = true; this.cooldown = 0;
    // scratch
    this._pa = new THREE.Vector3(); this._qa = new THREE.Quaternion();
    this._pb = new THREE.Vector3(); this._qb = new THREE.Quaternion();
    this._qi = new THREE.Quaternion(); this._la = new THREE.Vector3(); this._lb = new THREE.Vector3();
    this._lc = new THREE.Vector3(); this._n = new THREE.Vector3(); this._c = new THREE.Vector3();
    this._sv = new THREE.Vector3(); this._dq = new THREE.Quaternion();
    this.hit = { speed: 0, side: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), f: 0, rel: 0 };
  }
  // New tracked pose for the end of this frame.
  setPose(pos, quat, dt) {
    if (!this.hasPose || this.p1.distanceToSquared(pos) > 0.5 * 0.5) {
      this.p0.copy(pos); this.q0.copy(quat); this.p1.copy(pos); this.q1.copy(quat);
      this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.hasPose = true; return;
    }
    this.p0.copy(this.p1); this.q0.copy(this.q1);
    this.p1.copy(pos); this.q1.copy(quat);
    this.computeVelocity(dt);
  }
  // Explicit start/end poses (tests, desktop).
  setPoses(pa, qa, pb, qb, dt) { this.p0.copy(pa); this.q0.copy(qa); this.p1.copy(pb); this.q1.copy(qb); this.hasPose = true; this.computeVelocity(dt); }
  computeVelocity(dt) {
    if (dt <= 0) { this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); return; }
    this.vel.subVectors(this.p1, this.p0).divideScalar(dt);
    const dq = this._dq.copy(this.q0).invert().premultiply(this.q1); // q1 * q0^-1
    if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
    const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    if (s < 1e-6) this.angVel.set(dq.x * 2 / dt, dq.y * 2 / dt, dq.z * 2 / dt);
    else { const ang = 2 * Math.acos(Math.min(1, dq.w)) / dt / s; this.angVel.set(dq.x * ang, dq.y * ang, dq.z * ang); }
  }
  poseAt(a, outP, outQ) { outP.lerpVectors(this.p0, this.p1, a); outQ.slerpQuaternions(this.q0, this.q1, a); }

  // One sweep for a physics sub-step. ballPrev = ball centre at the sub-step start (a0), b.p at the end (a1).
  // On contact: resolves the impulse, places the ball on the face, and returns true (details in this.hit).
  sweep(b, ballPrev, a0, a1) {
    if (!this.enabled || !this.hasPose) return false;
    if (this.cooldown > 0) { this.cooldown--; return false; }
    const s = BLADE_HT + R;
    const pa = this._pa, qa = this._qa, pb = this._pb, qb = this._qb, la = this._la, lb = this._lb, qi = this._qi;
    this.poseAt(a0, pa, qa); this.poseAt(a1, pb, qb);
    la.subVectors(ballPrev, pa).applyQuaternion(qi.copy(qa).invert());
    lb.subVectors(b.p, pb).applyQuaternion(qi.copy(qb).invert());
    // quick reject: far from the blade
    const dzA = la.z + BLADE_Z, dzB = lb.z + BLADE_Z;
    if ((la.x * la.x + la.y * la.y + dzA * dzA) > 0.25 && (lb.x * lb.x + lb.y * lb.y + dzB * dzB) > 0.25) return false;
    let f = -1, side = 0;
    if (la.x >= s && lb.x < s) { f = (la.x - s) / (la.x - lb.x); side = 1; }
    else if (la.x <= -s && lb.x > -s) { f = (-s - la.x) / (lb.x - la.x); side = -1; }
    const lc = this._lc;
    if (side !== 0) {
      lc.lerpVectors(la, lb, f);
      if (!inBlade(lc)) side = 0;
    }
    if (side === 0) {
      // Embedded (paddle swept in edge-first, or ball spawned inside): push out of the nearer face.
      if (Math.abs(lb.x) < s && inBlade(lb)) { f = 1; side = lb.x >= 0 ? 1 : -1; lc.copy(lb); }
      else return false;
    }
    lc.x = side * s;
    const ah = a0 + (a1 - a0) * f;
    this.poseAt(ah, pa, qa);
    const c = this._c.copy(lc).applyQuaternion(qa).add(pa);
    const n = this._n.set(side, 0, 0).applyQuaternion(qa);
    // velocity of the blade surface at the contact point
    const sv = this._sv.set(c.x - n.x * R - pa.x, c.y - n.y * R - pa.y, c.z - n.z * R - pa.z);
    sv.crossVectors(this.angVel, sv).add(this.vel);
    const rel = (b.v.x - sv.x) * n.x + (b.v.y - sv.y) * n.y + (b.v.z - sv.z) * n.z;
    b.p.copy(c);
    if (rel >= 0) {
      // already separating: just make sure the ball is not left inside the paddle
      b.p.addScaledVector(n, 0.0005);
      return false;
    }
    const sp = contact(b, n.x, n.y, n.z, sv.x, sv.y, sv.z, paddleRestitution(-rel), MU_PADDLE);
    b.p.addScaledVector(n, 0.0005);
    const h = this.hit; h.speed = sp; h.side = side; h.point.copy(c); h.normal.copy(n); h.f = f; h.rel = -rel;
    this.cooldown = 12;  // ~25 ms at 480 Hz: no double contacts
    return true;
  }
}

function inBlade(l) {
  const y = l.y / (BLADE_AY + R * 0.5), z = (l.z + BLADE_Z) / (BLADE_AZ + R * 0.5);
  return y * y + z * z <= 1;
}

// ── Paddle mesh (merged, vertex colours) ─────────────────────
function colored(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function bladeDisc(x0, x1, scale, hex) {
  const g = new THREE.CylinderGeometry(1, 1, x1 - x0, 40, 1);
  g.rotateZ(-Math.PI / 2);
  g.scale(1, BLADE_AY * scale, BLADE_AZ * scale);
  g.translate((x0 + x1) / 2, 0, -BLADE_Z);
  return colored(g, hex);
}
export function makePaddleMesh(faceHex = 0xc8202a, backHex = 0x1a1a1e) {
  const parts = [
    bladeDisc(0.0028, BLADE_HT, 0.985, faceHex),
    bladeDisc(-0.0028, 0.0028, 1.0, 0xd9b27a),
    bladeDisc(-BLADE_HT, -0.0028, 0.985, backHex),
  ];
  const handle = new THREE.BoxGeometry(0.024, 0.03, 0.105, 1, 1, 1); handle.translate(0, 0, -0.022); parts.push(colored(handle, 0x9a6a3a));
  const flare = new THREE.BoxGeometry(0.026, 0.044, 0.03); flare.translate(0, 0, -0.07); parts.push(colored(flare, 0xb07a44));
  const cap = new THREE.BoxGeometry(0.026, 0.032, 0.012); cap.translate(0, 0, 0.035); parts.push(colored(cap, 0x2a2a30));
  const geo = mergeGeometries(parts.map(g => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0 }));
}
