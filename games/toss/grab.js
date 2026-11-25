import * as THREE from 'three';
import { Builder } from './env.js';

// Grab & throw for both hands (VR) and the desktop crosshair.
// Release velocity = least-squares fit over the last few frames of grip positions, plus
// angular velocity × lever arm (wrist flicks), plus an optional subtle aim assist.
const HIST = 10, STRIDE = 8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _d = new THREE.Vector3();

function makeState(side) {
  return { side, held: null, hover: null, offPos: new THREE.Vector3(), offQuat: new THREE.Quaternion(), hist: new Float64Array(HIST * STRIDE), n: 0, i: 0, fly: 1, flyFrom: new THREE.Vector3(), charging: false, charge: 0, hl: 0 };
}

export class Grabber {
  constructor(game) {
    this.game = game; this.input = game.input; this.world = game.world;
    this.states = { left: makeState('left'), right: makeState('right') };
    this.reach = 0.12;
    this.assist = 0;          // 0..1
    this.throwBoost = 1.12;
    this.samples = 5;         // frames used for the velocity fit
    this.lastThrow = null;    // debug info
    this.hoverSet = new Set();
    // hand visuals (VR only)
    this.handMeshes = {};
    for (const side of ['left', 'right']) {
      const b = new Builder(), s = side === 'left' ? -1 : 1;
      b.box(null, 0, 0, 0.02, 0.07, 0.03, 0.09, 0xf0c8a0);
      for (let i = 0; i < 4; i++) b.cyl(null, -0.025 + i * 0.017, -0.005, -0.045, 0.008, 0.009, 0.05, 0xf0c8a0, 6, Math.PI / 2 - 0.4, 0, 0);
      b.cyl(null, s * 0.042, 0.0, 0.0, 0.009, 0.011, 0.05, 0xf0c8a0, 6, Math.PI / 2, 0, -s * 0.8);
      b.box(null, 0, 0.0, 0.075, 0.075, 0.035, 0.03, 0xc0261d);
      const m = new THREE.Mesh(b.geometry(), game.mats.figure);
      m.visible = false;
      game.scene.add(m);
      this.handMeshes[side] = m;
    }
  }
  isHolding(hand) { return !!this.states[hand.handedness].held; }
  heldBy(hand) { return this.states[hand.handedness].held; }
  grabbable(b) { const u = b.user; return !!u && u.grabbable && !u.inPlay && !u.spent && b.enabled && !b.pinned; }

  _record(st, h, t) {
    const o = st.i * STRIDE, H = st.hist;
    H[o] = h.gripPos.x; H[o + 1] = h.gripPos.y; H[o + 2] = h.gripPos.z;
    H[o + 3] = h.gripQuat.x; H[o + 4] = h.gripQuat.y; H[o + 5] = h.gripQuat.z; H[o + 6] = h.gripQuat.w; H[o + 7] = t;
    st.i = (st.i + 1) % HIST; st.n = Math.min(HIST, st.n + 1);
  }
  // Linear (outV) and angular (outW) velocity of the hand from the last `samples` frames.
  estimate(st, outV, outW) {
    outV.set(0, 0, 0); outW.set(0, 0, 0);
    const n = Math.min(st.n, this.samples);
    if (n < 2) return;
    const H = st.hist;
    let mt = 0, mx = 0, my = 0, mz = 0;
    for (let k = 0; k < n; k++) { const o = ((st.i - 1 - k + HIST) % HIST) * STRIDE; mt += H[o + 7]; mx += H[o]; my += H[o + 1]; mz += H[o + 2]; }
    mt /= n; mx /= n; my /= n; mz /= n;
    let stt = 0, sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < n; k++) {
      const o = ((st.i - 1 - k + HIST) % HIST) * STRIDE, dt = H[o + 7] - mt;
      stt += dt * dt; sx += dt * (H[o] - mx); sy += dt * (H[o + 1] - my); sz += dt * (H[o + 2] - mz);
    }
    if (stt < 1e-8) return;
    outV.set(sx / stt, sy / stt, sz / stt);
    // angular: newest vs oldest orientation
    const on = ((st.i - 1 + HIST) % HIST) * STRIDE, oo = ((st.i - n + HIST) % HIST) * STRIDE;
    const span = H[on + 7] - H[oo + 7];
    if (span < 1e-4) return;
    _q.set(H[on + 3], H[on + 4], H[on + 5], H[on + 6]);
    _q2.set(H[oo + 3], H[oo + 4], H[oo + 5], H[oo + 6]).invert();
    _q.multiply(_q2); // world-space delta
    if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
    const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
    if (s > 1e-5) { const ang = 2 * Math.acos(Math.min(1, _q.w)); outW.set(_q.x / s, _q.y / s, _q.z / s).multiplyScalar(ang / span); }
  }

  _setHover(st, body) {
    if (st.hover === body) return;
    const old = st.hover; st.hover = body;
    if (old && old.prop && !this._hovered(old)) old.prop.set.highlight(old, 0);
    if (body?.prop) body.prop.set.highlight(body, 0.55);
  }
  _hovered(b) { return this.states.left.hover === b || this.states.right.hover === b; }

  findNear(p) {
    let best = null, bd = this.reach;
    for (const b of this.world.bodies) {
      if (!this.grabbable(b)) continue;
      const d = b.pos.distanceTo(p) - Math.min(b.bound, 0.07);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  grab(st, h, body, t, desktop = false) {
    // pass between hands
    for (const k of ['left', 'right']) { const o = this.states[k]; if (o !== st && o.held === body) { o.held = null; } }
    st.held = body; body.held = true; body.wake();
    body.vel.set(0, 0, 0); body.angVel.set(0, 0, 0);
    const u = body.user;
    u.released = false; u.inPlay = false; u.strayT = 0;
    _q.copy(h.gripQuat).invert();
    if (desktop) {
      st.offPos.set(0, 0, 0);
      st.offQuat.copy(_q).multiply(body.quat);
      if (u.dart) st.offQuat.identity();
      st.fly = 0; st.flyFrom.copy(body.pos);
    } else {
      st.offPos.copy(body.pos).sub(h.gripPos).applyQuaternion(_q);
      const l = st.offPos.length(); if (l > 0.06) st.offPos.multiplyScalar(0.06 / l);
      st.offQuat.copy(_q).multiply(body.quat);
      if (u.dart) { st.offQuat.identity(); st.offPos.set(0, -0.01, -0.06); }
      st.fly = 1;
    }
    st.charging = false; st.charge = 0;
    this._setHover(st, null);
    h.haptic(0.45, 30);
    this.game.sounds.grab();
  }
  _follow(st, h, dt) {
    const b = st.held;
    _v.copy(st.offPos).applyQuaternion(h.gripQuat).add(h.gripPos);
    if (st.fly < 1) {
      st.fly = Math.min(1, st.fly + dt / 0.16);
      const e = st.fly * st.fly * (3 - 2 * st.fly);
      b.pos.lerpVectors(st.flyFrom, _v, e);
    } else b.pos.copy(_v);
    b.quat.copy(h.gripQuat).multiply(st.offQuat);
    b.updateInertia();
  }
  release(st, h, t, vel = null, angVel = null) {
    const b = st.held; if (!b) return;
    st.held = null; b.held = false; b.wake();
    if (vel) { b.vel.copy(vel); if (angVel) b.angVel.copy(angVel); else b.angVel.set(0, 0, 0); }
    else {
      this.estimate(st, _v, _w);
      _d.copy(b.pos).sub(h.gripPos);
      _v2.crossVectors(_w, _d);               // lever arm
      b.vel.copy(_v).add(_v2).multiplyScalar(this.throwBoost);
      b.angVel.copy(_w);
    }
    this.applyAssist(b);
    const sp = b.vel.length();
    if (sp > 25) b.vel.multiplyScalar(25 / sp);
    const u = b.user;
    u.released = sp > 0.6; u.thrownAt = t; u.thrower = h;
    if (u.dart && sp > 1) { _v.copy(b.vel).normalize(); b.quat.setFromUnitVectors(_v2.set(0, 0, -1), _v); }
    this.lastThrow = { speed: sp, vel: b.vel.toArray(), assist: this.assist };
    if (sp > 2.5) this.game.sounds.throwWhoosh(sp);
    h.haptic(0.2, 15);
  }
  forceDrop(body) {
    for (const k of ['left', 'right']) { const st = this.states[k]; if (st.held === body) { st.held = null; body.held = false; body.wake(); } }
  }

  // Subtle aim assist: nudge the throw toward the closest stall target (direction, and speed for lobs).
  applyAssist(b) {
    const a = this.assist; if (a <= 0) return;
    const stall = this.game.stallAt(b.pos); if (!stall) return;
    const targets = stall.aimTargets(); if (!targets.length) return;
    const v = b.vel, hs = Math.hypot(v.x, v.z); if (hs < 1) return;
    let best = null, bestAng = 1e9;
    for (const tp of targets) {
      const dx = tp.x - b.pos.x, dz = tp.z - b.pos.z;
      const ang = Math.atan2(v.x * dz - v.z * dx, v.x * dx + v.z * dz); // signed angle from v to target
      if (Math.abs(ang) < Math.abs(bestAng)) { bestAng = ang; best = tp; }
    }
    const maxA = THREE.MathUtils.degToRad(5 + 9 * a);
    if (!best || Math.abs(bestAng) > maxA) return;
    const k = a * 0.85 * (1 - 0.5 * Math.abs(bestAng) / maxA);
    const rot = bestAng * k, c = Math.cos(rot), s = Math.sin(rot);
    // rotate horizontal velocity toward target (positive angle = counter-clockwise seen from above in (x,z) with our sign convention)
    const nx = v.x * c - v.z * s, nz = v.x * s + v.z * c;
    v.x = nx; v.z = nz;
    if (stall.assistSpeed) {
      const dx = best.x - b.pos.x, dz = best.z - b.pos.z, d = Math.hypot(dx, dz), hgt = best.y - b.pos.y;
      const th = Math.atan2(v.y, hs), cos = Math.cos(th), den = 2 * cos * cos * (d * Math.tan(th) - hgt);
      if (den > 0.01) {
        const ideal = Math.sqrt(9.81 * d * d / den), cur = v.length(), ratio = ideal / cur;
        if (ratio > 0.65 && ratio < 1.5) v.multiplyScalar(1 + (ratio - 1) * k * 0.8);
      }
    }
  }

  update(dt, t) {
    const input = this.input;
    for (const side of ['left', 'right']) {
      const h = input[side], st = this.states[side];
      const hm = this.handMeshes[side];
      hm.visible = input.xr && h.present;
      if (!h.present) { if (st.held) this.release(st, h, t, _v.set(0, 0, 0)); st.n = 0; this._setHover(st, null); continue; }
      this._record(st, h, t);
      if (hm.visible) { hm.position.copy(h.gripPos); hm.quaternion.copy(h.gripQuat); const sq = 1 - h.squeeze * 0.25; hm.scale.set(1, 1, sq); }
      if (input.desktop) continue;
      if (st.held) {
        this._follow(st, h, dt);
        if (h.squeezeUp || h.squeeze < 0.2) this.release(st, h, t);
      } else {
        const cand = this.findNear(h.gripPos);
        this._setHover(st, cand);
        if (cand && h.squeezeDown) this.grab(st, h, cand, t);
      }
    }
    if (input.desktop) this._desktop(dt, t);
    // pulse the highlight of hovered things
    for (const side of ['left', 'right']) { const st = this.states[side]; if (st.hover?.prop) st.hover.prop.set.highlight(st.hover, 0.4 + 0.25 * Math.sin(t * 9)); }
  }

  _desktop(dt, t) {
    const input = this.input, h = input.main, st = this.states[h.handedness];
    if (!st.held) {
      _d.set(0, 0, -1).applyQuaternion(h.rayQuat);
      const cand = this.world.raycastBodies(h.rayPos, _d, 4.5, (b) => this.grabbable(b));
      this._setHover(st, cand);
      if (cand && (h.squeezeDown || h.a)) this.grab(st, h, cand, t, true);
      st.charging = false; st.charge = 0;
      return;
    }
    // held: pull back while charging
    if (h.triggerDown) { st.charging = true; st.charge = 0; }
    if (st.charging) st.charge = Math.min(1, st.charge + dt / 1.1);
    this._follow(st, h, dt);
    if (st.charging) { const head = input.head; st.held.pos.addScaledVector(head.fwd, -0.12 * st.charge).addScaledVector(head.up, -0.04 * st.charge); }
    if (st.charging && h.triggerUp) {
      const head = input.head, b = st.held;
      b.pos.copy(head.pos).addScaledVector(head.fwd, 0.35).addScaledVector(head.up, -0.07);
      const speed = 2.2 + 11.8 * st.charge;
      _v.copy(head.fwd).multiplyScalar(speed);
      _w.set(0, 0, 0);
      if (b.user.kind === 'Ring' || b.user.kind === 'Coin') _w.copy(head.up).multiplyScalar(8);   // frisbee spin keeps rings/coins flat
      st.charging = false; st.charge = 0;
      this.release(st, h, t, _v, _w);
    } else if (h.squeezeDown || h.a) {
      const head = input.head, b = st.held;
      b.pos.copy(head.pos).addScaledVector(head.fwd, 0.45).addScaledVector(head.up, -0.2);
      this.release(st, h, t, _v.set(0, 0, 0));
    }
  }
  chargeOf(hand) { return this.states[hand.handedness].charging ? this.states[hand.handedness].charge : 0; }
}
