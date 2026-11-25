import * as THREE from 'three';

// The shadow sensei: a mirrored ink-shadow opponent built from one InstancedMesh of capsules
// (one draw call). Pose is driven by a few parameters and solved with two-bone IK each frame.
// The figure faces +Z (towards the player); "side" is world X, so its -X arm mirrors the player's left.

const NB = 17;
const UP = new THREE.Vector3(0, 1, 0);
const C_BODY = new THREE.Color(0x2b2340), C_HEAD = new THREE.Color(0x3a3050), C_RED = new THREE.Color(0xff3a30), C_BLUE = new THREE.Color(0x3a7cff), C_SASH = new THREE.Color(0xc02a20);

function v() { return new THREE.Vector3(); }

export class Sensei {
  constructor() {
    const geo = new THREE.CapsuleGeometry(0.5, 1, 3, 10);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a1240 });
    this.mesh = new THREE.InstancedMesh(geo, mat, NB);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < NB; i++) this.mesh.setColorAt(i, C_BODY);
    this.mesh.setColorAt(1, C_HEAD);
    this.mesh.setColorAt(7, C_RED); this.mesh.setColorAt(8, C_BLUE);
    this.mesh.setColorAt(14, C_SASH); this.mesh.setColorAt(15, C_SASH); this.mesh.setColorAt(16, C_SASH);
    this.root = new THREE.Group(); this.root.add(this.mesh);
    // targets (set by the game every frame) and smoothed values
    this.crouch = 0; this.lean = 0; this.act = [0, 0]; this.amt = [0, 0]; this.bob = 0; this.bow = 0;
    this._c = 0; this._l = 0; this._a = [0, 0]; this._act = [0, 0]; this._bow = 0;
    this.j = {}; for (const k of ['pel', 'chest', 'neck', 'head', 'sh0', 'sh1', 'el0', 'el1', 'f0', 'f1', 'hip0', 'hip1', 'kn0', 'kn1', 'ft0', 'ft1', 't0', 't1', 'tmp', 'hint', 'a', 'b', 'j2']) this.j[k] = v();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = v(); this._mid = v(); this._dir = v(); this._d = v(); this._perp = v();
    this.update(0);
  }

  _bone(i, a, b, r) {
    const mid = this._mid.addVectors(a, b).multiplyScalar(0.5), dir = this._dir.subVectors(b, a);
    const len = dir.length();
    if (len > 1e-5) this._q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len)); else this._q.identity();
    this._s.set(2 * r, (len + 2 * r) / 2, 2 * r);
    this._m.compose(mid, this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
  }

  // Two-bone IK: writes the joint into `out`; clamps target to reach.
  _ik(root, target, l1, l2, hint, out, end) {
    const d = this._d.subVectors(target, root); let dist = d.length();
    const maxR = l1 + l2 - 1e-3;
    if (dist < 1e-4) { d.set(0, -1, 0); dist = 1e-4; } else d.multiplyScalar(1 / dist);
    if (dist > maxR) dist = maxR;
    end.copy(root).addScaledVector(d, dist);
    const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const p = this._perp.copy(hint).addScaledVector(d, -hint.dot(d));
    if (p.lengthSq() < 1e-6) p.set(0, -1, 0); p.normalize();
    out.copy(root).addScaledVector(d, a).addScaledVector(p, h);
  }

  update(dt) {
    const k = dt > 0 ? 1 - Math.exp(-14 * dt) : 1;
    this._c += (this.crouch - this._c) * k; this._l += (this.lean - this._l) * k; this._bow += (this.bow - this._bow) * k * 0.5;
    for (let i = 0; i < 2; i++) {
      const tgt = this.amt[i];
      if (this.act[i] !== this._act[i] && tgt > this._a[i] * 0.8) this._act[i] = this.act[i];
      this._a[i] += (tgt - this._a[i]) * k;
    }
    const J = this.j, c = this._c, l = this._l, bow = this._bow;
    J.pel.set(0.08 * l, 0.95 - 0.38 * c - 0.03 * this.bob, -0.03 * c);
    J.chest.set(J.pel.x + 0.24 * l, J.pel.y + 0.46 - 0.06 * c - 0.1 * bow, J.pel.z + 0.08 * c + 0.25 * bow);
    J.neck.set(J.chest.x + 0.05 * l, J.chest.y + 0.12, J.chest.z + 0.03 * c + 0.08 * bow);
    J.head.set(J.neck.x + 0.05 * l, J.neck.y + 0.13 - 0.05 * bow, J.neck.z + 0.03 + 0.1 * bow);
    this._bone(0, J.pel, J.chest, 0.15);
    J.j2.copy(J.head).setY(J.head.y + 0.03); this._bone(1, J.tmp.copy(J.head).setY(J.head.y - 0.03), J.j2, 0.12);
    J.sh0.set(J.chest.x - 0.2, J.chest.y + 0.02, J.chest.z); J.sh1.set(J.chest.x + 0.2, J.chest.y + 0.02, J.chest.z);
    this._bone(2, J.sh0, J.sh1, 0.075);
    // arms
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1, sh = i === 0 ? J.sh0 : J.sh1, el = i === 0 ? J.el0 : J.el1, f = i === 0 ? J.f0 : J.f1, t = i === 0 ? J.t0 : J.t1;
      // guard
      t.set(J.chest.x + s * 0.12, J.neck.y - 0.04, J.chest.z + 0.3);
      const amt = this._a[i], act = this._act[i];
      if (amt > 0.001 && act) {
        const a = J.a;
        if (act === 1) a.set(sh.x - s * 0.04, sh.y + 0.03, sh.z + 0.62);               // jab
        else if (act === 2) a.set(J.chest.x - s * 0.05, sh.y + 0.05, sh.z + 0.46);     // hook
        else if (act === 3) a.set(sh.x - s * 0.06, J.head.y - 0.02, sh.z + 0.34);      // uppercut
        else a.set(J.head.x + s * 0.07, J.head.y - 0.02, J.head.z + 0.26);             // block
        t.lerp(a, Math.min(1, amt));
        if (act === 2) J.hint.set(s, 0.4, -0.3); else if (act === 3) J.hint.set(s * 0.3, -1, 0.3); else if (act === 4) J.hint.set(s * 0.4, -1, 0); else J.hint.set(s * 0.5, -1, -0.2);
      } else J.hint.set(s * 0.5, -1, -0.2);
      if (bow > 0.01) { t.lerp(J.tmp.set(J.chest.x + s * 0.02, J.chest.y - 0.02, J.chest.z + 0.25), bow); }
      this._ik(sh, t, 0.3, 0.28, J.hint, el, f);
      this._bone(3 + i * 2, sh, el, 0.055);
      this._bone(4 + i * 2, el, f, 0.048);
      this._bone(7 + i, f, f, 0.075);
    }
    // legs
    J.hip0.set(J.pel.x - 0.11, J.pel.y - 0.02, J.pel.z); J.hip1.set(J.pel.x + 0.11, J.pel.y - 0.02, J.pel.z);
    this._bone(9, J.hip0, J.hip1, 0.09);
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1, hip = i === 0 ? J.hip0 : J.hip1, kn = i === 0 ? J.kn0 : J.kn1, ft = i === 0 ? J.ft0 : J.ft1;
      J.b.set(s * 0.24 + 0.04 * l, 0.07, 0.02);
      J.hint.set(s * 0.25, 0, 1);
      this._ik(hip, J.b, 0.47, 0.47, J.hint, kn, ft);
      this._bone(10 + i * 2, hip, kn, 0.07);
      this._bone(11 + i * 2, kn, ft, 0.058);
    }
    // sash + headband
    this._bone(14, J.tmp.copy(J.pel).setY(J.pel.y + 0.08).setX(J.pel.x - 0.14), J.a.copy(J.pel).setY(J.pel.y + 0.08).setX(J.pel.x + 0.14), 0.1);
    J.a.copy(J.head).add(J.b.set(-0.1, 0.05, 0)); J.tmp.copy(J.head).add(J.b.set(0.1, 0.05, 0));
    this._bone(15, J.a, J.tmp, 0.03);
    J.a.copy(J.head).add(J.b.set(-0.1, 0.03, -0.06)); J.tmp.copy(J.head).add(J.b.set(-0.18, -0.12, -0.16));
    this._bone(16, J.a, J.tmp, 0.022);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
