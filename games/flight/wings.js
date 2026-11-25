import * as THREE from 'three';

// Crane wings drawn between estimated shoulders and the tracked hands.
// One InstancedMesh of feathers for both wings (1 draw call), all in rig-local space.
// Red-crowned crane: white primaries and coverts, black secondaries/tertials.

const COVERTS = 10, SECONDARIES = 9, PRIMARIES = 8;
const PER_WING = COVERTS + SECONDARIES + PRIMARIES;

function featherGeometry() {
  // Lies in the XZ plane, base at the origin, tip at z = 1, normal +Y.
  const P = [
    [0, 0], [-0.16, 0.02], [0.16, 0.02], [-0.5, 0.35], [0.5, 0.4], [-0.42, 0.75], [0.36, 0.8], [0, 1],
  ];
  const tri = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6, 5, 7, 6];
  const pos = [], col = [];
  for (const k of tri) {
    const [x, z] = P[k]; pos.push(x, 0, z);
    const t = z; const c = Math.pow(1 - 0.22 * t, 2.2); // darker towards the tip
    col.push(c, c, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class Wings {
  constructor(parent) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x202428 });
    this.mesh = new THREE.InstancedMesh(featherGeometry(), mat, PER_WING * 2);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const c = new THREE.Color();
    for (let w = 0; w < 2; w++) for (let k = 0; k < PER_WING; k++) {
      const i = w * PER_WING + k;
      // order matches _wing(): secondaries, coverts, primaries
      if (k < SECONDARIES) c.setRGB(0.13, 0.13, 0.15);
      else if (k < SECONDARIES + COVERTS) c.setRGB(0.95, 0.95, 0.93);
      else c.setRGB(0.97, 0.97, 0.96);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
    parent.add(this.mesh);
    // scratch
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._n = new THREE.Vector3();
    this._d = new THREE.Vector3(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this.visible = true;
  }

  // S: shoulder, H: hand (rig-local). back: rig-local unit vector pointing behind the body.
  // side: -1 left, +1 right. flapV: hand downward speed (m/s, + = down). fold: 0..1 (sweep).
  _wing(w, S, H, back, side, spread, fold, flapV, t, speed) {
    const a = this._a.subVectors(H, S); const armLen = Math.max(0.15, a.length()); a.divideScalar(armLen);
    const n = this._n.crossVectors(a, back);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0); n.normalize(); if (n.y < 0) n.negate();
    const b = this._b.crossVectors(n, a).normalize(); if (b.dot(back) < 0) b.negate();
    const bend = Math.max(-0.35, Math.min(0.5, flapV * 0.16));
    const flutterAmp = Math.min(0.06, speed * 0.002);
    this._i = w * PER_WING; this._flut = flutterAmp; this._t = t;
    const put = this._put;
    const p = this._p;
    const scale = Math.min(1.25, armLen / 0.62);
    // secondaries along the arm, black, pointing back
    for (let k = 0; k < SECONDARIES; k++) {
      const u = 0.04 + 0.86 * (k / (SECONDARIES - 1));
      p.copy(S).lerp(H, u).addScaledVector(n, -0.012);
      const len = (0.6 - 0.1 * u) * scale * (1 - 0.25 * fold);
      put.call(this, p, 0.12 + 0.25 * u, 1, len, 0.17 * scale, -bend * 0.6 * u, k);
    }
    // coverts on top, white
    for (let k = 0; k < COVERTS; k++) {
      const u = 0.02 + 0.92 * (k / (COVERTS - 1));
      p.copy(S).lerp(H, u).addScaledVector(n, 0.012);
      put.call(this, p, 0.18 + 0.2 * u, 1, (0.44 - 0.08 * u) * scale * (1 - 0.2 * fold), 0.24 * scale, -bend * 0.3 * u, k + 20);
    }
    // primaries fanning from the hand
    const fan = (0.25 + 0.75 * spread) * (1 - 0.55 * fold);
    for (let k = 0; k < PRIMARIES; k++) {
      const f = k / (PRIMARIES - 1);
      const ang = (0.12 + f * 1.25 * fan + (1 - fan) * 0.9 * f * 0.4) ;
      p.copy(H).addScaledVector(a, -0.05 * f).addScaledVector(n, -0.004 * k);
      const len = (0.82 - 0.22 * f) * scale;
      put.call(this, p, Math.cos(ang), Math.sin(ang), len, 0.15 * scale, -bend * (1 - 0.5 * f), k + 40);
    }
  }

  _put(base, dirAlong, dirBack, len, width, lift, k) {
    const a = this._a, b = this._b, n = this._n;
    const d = this._d.copy(a).multiplyScalar(dirAlong).addScaledVector(b, dirBack);
    d.addScaledVector(n, lift + this._flut * Math.sin(this._t * 31 + k * 1.7)).normalize();
    const y = this._y.copy(n).addScaledVector(d, -n.dot(d)).normalize();
    const x = this._x.crossVectors(y, d);
    this._m.makeBasis(x.multiplyScalar(width), y, d.multiplyScalar(len));
    this._m.setPosition(base);
    this.mesh.setMatrixAt(this._i++, this._m);
  }

  update(SL, HL, SR, HR, back, ctl, flapL, flapR, t, speed) {
    this.mesh.visible = this.visible;
    if (!this.visible) return;
    this._wing(0, SL, HL, back, -1, ctl.spread, ctl.sweep, flapL, t, speed);
    this._wing(1, SR, HR, back, 1, ctl.spread, ctl.sweep, flapR, t, speed);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
