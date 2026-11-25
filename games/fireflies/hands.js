import * as THREE from 'three';
import { JOINTS, BONES, DEFAULT_RADII, classifyHand, classifyCup, makeGesture, makeCup, poseHand } from './gestures.js';

// Per-hand state shared by tracked hands, controllers and the desktop emulation.
// mode: 'tracked' (XRHand joints), 'ctrl' (controller or desktop: synthetic hand posed by trigger/grip), 'none'
function makeHandState(side) {
  return {
    side, mode: 'none', present: false,
    joints: new Float32Array(75), radii: new Float32Array(DEFAULT_RADII),
    g: makeGesture(),
    pinch: false, pinchDown: false, pinchUp: false,
    grab: false, grabDown: false, grabUp: false,
    fist: false, point: false, open: false,
    palm: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), fwd: new THREE.Vector3(0, 0, -1),
    pinchPt: new THREE.Vector3(), tip: new THREE.Vector3(), pointDir: new THREE.Vector3(0, 0, -1),
    holdPt: new THREE.Vector3(), speed: 0, stillT: 0, glowPinch: 0,
    _prevPalm: new THREE.Vector3(), _hasPrev: false,
    curl: [0.2, 0.25, 0.3, 0.3], thumbPinch: 0, tuck: 0, // smoothed synthetic pose
  };
}

const _mA = new THREE.Matrix4(), _mB = new THREE.Matrix4(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _col = new THREE.Color(), _x = new THREE.Vector3(), _z = new THREE.Vector3();

export class Hands {
  constructor(scene) {
    this.L = makeHandState('left'); this.R = makeHandState('right');
    this.list = [this.L, this.R];
    this.cup = makeCup(); this.cupDown = false; this.cupUp = false;
    this.sepSpeed = 0; this._prevSep = -1;
    this.override = null; // tests: { left: Float32Array(75), right: ... } simulates tracked hands
    // rendering: joints as instanced spheres, bones as instanced open cylinders
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x141d33 });
    this.jointMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, 52);
    this.boneMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), mat, BONES.length * 2);
    for (const m of [this.jointMesh, this.boneMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false;
      for (let i = 0; i < m.count; i++) m.setColorAt(i, _col.setRGB(0.55, 0.62, 0.78));
      scene.add(m);
    }
    this.jointMesh.count = 0; this.boneMesh.count = 0;
    // controller → hand-local offsets (palm facing inward, wrist behind the grip)
    this.offset = {
      left: new THREE.Matrix4().compose(new THREE.Vector3(0.0, -0.015, 0.075), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1)),
      right: new THREE.Matrix4().compose(new THREE.Vector3(0.0, -0.015, 0.075), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, -Math.PI / 2)), new THREE.Vector3(1, 1, 1)),
    };
    this.desktopOffset = {
      left: new THREE.Matrix4().compose(new THREE.Vector3(0.02, -0.02, 0.06), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, -0.25, 1.1)), new THREE.Vector3(1, 1, 1)),
      right: new THREE.Matrix4().compose(new THREE.Vector3(-0.02, -0.02, 0.06), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0.25, -1.1)), new THREE.Vector3(1, 1, 1)),
    };
  }

  update(dt, input, { pointHeld }) {
    for (const h of this.list) {
      const src = input[h.side];
      const tracked = input.xr ? input.trackedHand(h.side) : null;
      const wasPinch = h.pinch, wasGrab = h.grab;
      const ov = this.override?.[h.side];
      if (ov || (tracked && this._readTracked(h, tracked.joints))) {
        if (ov) { h.joints.set(ov); h.radii.set(DEFAULT_RADII); }
        h.mode = 'tracked'; h.present = true;
        classifyHand(h.joints, h.side, h.g, h.g);
        h.pinch = h.g.pinch; h.fist = h.g.fist; h.point = h.g.point; h.open = h.g.open;
        h.grab = false;
        h.pinchPt.fromArray(h.g.pinchPoint); h.tip.fromArray(h.g.indexTip); h.pointDir.fromArray(h.g.pointDir);
        h.palm.fromArray(h.g.palm); h.normal.fromArray(h.g.normal); h.fwd.fromArray(h.g.fwd);
      } else if (src.present) {
        h.mode = 'ctrl'; h.present = true;
        const trig = src.trigger, sq = src.squeeze, pt = pointHeld(h.side);
        // smoothed pose targets
        const k = Math.min(1, dt * 18);
        const ci = pt ? 0 : 0.12 + trig * 0.8, co = pt ? 0.95 : 0.22 + sq * 0.78;
        h.curl[0] += (ci - h.curl[0]) * k;
        for (let i = 1; i < 4; i++) h.curl[i] += (co + i * 0.03 - h.curl[i]) * k;
        h.thumbPinch += ((pt ? 0 : trig) - h.thumbPinch) * k;
        h.tuck += ((pt || (sq > 0.5 && trig < 0.5) ? 1 : 0) - h.tuck) * k;
        _mA.compose(src.gripPos, src.gripQuat, _s.set(1, 1, 1));
        _mA.multiply(input.desktop ? this.desktopOffset[h.side] : this.offset[h.side]);
        poseHand(h.joints, h.side, h.curl, h.thumbPinch, h.tuck, _mA.elements);
        h.radii.set(DEFAULT_RADII);
        classifyHand(h.joints, h.side, h.g, h.g); // for palm frame and tips
        h.pinch = trig > (wasPinch ? 0.3 : 0.55);
        h.grab = sq > (wasGrab ? 0.3 : 0.6);
        h.fist = h.grab && h.pinch;
        h.point = pt && !h.pinch && !h.grab;
        h.open = trig < 0.15 && sq < 0.15 && !pt;
        h.pinchPt.fromArray(h.g.pinchPoint); h.tip.fromArray(h.g.indexTip);
        h.palm.fromArray(h.g.palm); h.normal.fromArray(h.g.normal); h.fwd.fromArray(h.g.fwd);
        // controllers point along their ray; desktop main hand points along the crosshair
        h.pointDir.copy(src.rayDir ? _v.set(0, 0, -1).applyQuaternion(src.rayQuat) : h.g.pointDir);
      } else {
        h.mode = 'none'; h.present = false; h.pinch = h.grab = h.fist = h.point = h.open = false;
      }
      h.pinchDown = h.pinch && !wasPinch; h.pinchUp = !h.pinch && wasPinch;
      h.grabDown = h.grab && !wasGrab; h.grabUp = !h.grab && wasGrab;
      // speed + stillness from the palm
      if (h.present) {
        if (h._hasPrev && dt > 0) {
          const sp = _v.copy(h.palm).sub(h._prevPalm).length() / dt;
          h.speed += (sp - h.speed) * Math.min(1, dt * 10);
        }
        h._prevPalm.copy(h.palm); h._hasPrev = true;
        h.stillT = h.speed < 0.09 ? h.stillT + dt : 0;
      } else { h._hasPrev = false; h.speed = 0; h.stillT = 0; }
      // where carried fireflies sit
      if (h.pinch) h.holdPt.copy(h.pinchPt);
      else if (h.fist) h.holdPt.copy(h.palm).addScaledVector(h.normal, 0.03);
      else h.holdPt.copy(h.palm).addScaledVector(h.normal, 0.06);
      h.glowPinch += ((h.pinch ? 1 : 0) - h.glowPinch) * Math.min(1, dt * 12);
    }
    // two-handed bowl
    const L = this.L, R = this.R, wasCup = this.cup.cup;
    if (L.present && R.present) {
      if (L.mode === 'tracked' && R.mode === 'tracked') classifyCup(L.g, R.g, this.cup, this.cup);
      else {
        const d = L.palm.distanceTo(R.palm);
        this.cup.dist = d;
        this.cup.cup = L.grab && R.grab && d < (wasCup ? 0.42 : 0.32);
        this.cup.center[0] = (L.palm.x + R.palm.x) / 2; this.cup.center[1] = (L.palm.y + R.palm.y) / 2 + 0.03; this.cup.center[2] = (L.palm.z + R.palm.z) / 2;
      }
      const sep = L.palm.distanceTo(R.palm);
      if (this._prevSep >= 0 && dt > 0) this.sepSpeed += ((sep - this._prevSep) / dt - this.sepSpeed) * Math.min(1, dt * 12);
      this._prevSep = sep;
    } else { this.cup.cup = false; this._prevSep = -1; this.sepSpeed = 0; }
    this.cupDown = this.cup.cup && !wasCup; this.cupUp = !this.cup.cup && wasCup;
  }

  _readTracked(h, joints) {
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const j = joints[JOINTS[i]];
      if (!j || !j.visible) continue;
      j.getWorldPosition(_v);
      h.joints[i * 3] = _v.x; h.joints[i * 3 + 1] = _v.y; h.joints[i * 3 + 2] = _v.z;
      h.radii[i] = j.jointRadius ?? DEFAULT_RADII[i];
      ok++;
    }
    return ok >= 20;
  }

  // Write instance matrices for both hands.
  render(hideCtrlHands = false) {
    let ji = 0, bi = 0;
    for (const h of this.list) {
      if (!h.present || (hideCtrlHands && h.mode !== 'tracked')) continue;
      const P = h.joints, warm = h.glowPinch;
      _col.setRGB(0.5 + warm * 0.35, 0.58 + warm * 0.2, 0.75 - warm * 0.15);
      for (let i = 0; i < 25; i++) {
        const r = h.radii[i] * 1.02;
        _mA.compose(_v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]), _q.identity(), _s.set(r, r, r));
        this.jointMesh.setMatrixAt(ji, _mA); this.jointMesh.setColorAt(ji, _col); ji++;
      }
      // palm: a flattened ellipsoid in the palm frame
      _x.crossVectors(h.normal, h.fwd).normalize(); _z.crossVectors(_x, h.normal).normalize();
      _mB.makeBasis(_x, h.normal, _z);
      _v.copy(h.palm).addScaledVector(h.fwd, -0.008);
      _mA.compose(_v, _q.setFromRotationMatrix(_mB), _s.set(0.036, 0.013, 0.042));
      this.jointMesh.setMatrixAt(ji, _mA); this.jointMesh.setColorAt(ji, _col); ji++;
      for (const [a, b] of BONES) {
        _v.set(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]); _v2.set(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
        const len = _v.distanceTo(_v2);
        const r = (h.radii[a] + h.radii[b]) * 0.5 * (a === 0 ? 0.95 : 0.92);
        _v2.sub(_v); if (len > 1e-5) _v2.divideScalar(len); else _v2.set(0, 1, 0);
        _q.setFromUnitVectors(_up, _v2);
        _v.addScaledVector(_v2, len * 0.5);
        _mA.compose(_v, _q, _s.set(r, len, r));
        this.boneMesh.setMatrixAt(bi, _mA); this.boneMesh.setColorAt(bi, _col); bi++;
      }
    }
    this.jointMesh.count = ji; this.boneMesh.count = bi;
    this.jointMesh.instanceMatrix.needsUpdate = this.boneMesh.instanceMatrix.needsUpdate = true;
    if (this.jointMesh.instanceColor) this.jointMesh.instanceColor.needsUpdate = true;
    if (this.boneMesh.instanceColor) this.boneMesh.instanceColor.needsUpdate = true;
  }
}
