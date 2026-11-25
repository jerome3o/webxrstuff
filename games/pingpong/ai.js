import * as THREE from 'three';
import { R, H, TOP, HL, HW, BLADE_Z, EV_TABLE, EV_NET, Predictor, solveShot, makeBall } from './physics.js';

// ── Opponent skill levels ────────────────────────────────────
export const LEVELS = {
  easy:   { name: 'Easy',   react: 0.34, speed: 2.1, perr: 0.05,  reach: 0.2,  T: [0.6, 0.82],  spread: 0.45, err: 0.14,  spin: [40, 140],  deep: [0.7, 1.05], push: 0.3,  smash: 0.2 },
  normal: { name: 'Normal', react: 0.24, speed: 3.1, perr: 0.035, reach: 0.2,  T: [0.46, 0.68], spread: 0.72, err: 0.08,  spin: [80, 240],  deep: [0.8, 1.2],  push: 0.28, smash: 0.5 },
  hard:   { name: 'Hard',   react: 0.15, speed: 4.4, perr: 0.02,  reach: 0.21, T: [0.36, 0.55], spread: 0.95, err: 0.04,  spin: [140, 360], deep: [0.9, 1.26], push: 0.25, smash: 0.8 },
};

const rnd = (a, b) => a + Math.random() * (b - a);
function gauss() { let u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }

// Spin vector for a shot travelling along +Z/−Z: topspin rotates about (up × v̂).
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _ax = new THREE.Vector3();
export function spinFor(out, p0, tx, tz, top, side) {
  _dir.set(tx - p0.x, 0, tz - p0.z).normalize();
  _ax.crossVectors(_up, _dir).normalize();
  return out.copy(_ax).multiplyScalar(top).addScaledVector(_up, side);
}

const _pred = new Predictor(1400), _st = makeBall();
// Verify a launch: first table contact must be on the receiving side (dir = +1 → player side, z > 0) and in bounds.
export function checkShot(p0, v, w, dir, allowNet = false) {
  _st.p.copy(p0); _st.v.copy(v); _st.w.copy(w);
  _pred.run(_st, 1400);
  for (let k = 0; k < _pred.nev; k++) {
    const t = _pred.evType[k];
    if (t === EV_NET) { if (!allowNet) return false; continue; }
    if (t === EV_TABLE) { const z = _pred.evZ[k], x = _pred.evX[k]; return z * dir > 0.02 && Math.abs(x) <= HW && Math.abs(z) <= HL; }
    return false;
  }
  return false;
}

// Builds a shot from p0 towards side dir (+1 = player). kind: 'drive' | 'push' | 'smash' | 'lob' | 'error'
// Fills outV / outW. Returns the shot actually used.
export function makeShot(p0, dir, lv, kind, outV, outW) {
  for (let attempt = 0; attempt < 7; attempt++) {
    let T, top, side, tx, tz;
    const sx = (Math.random() * 2 - 1) * lv.spread * (HW - 0.1);
    side = rnd(-1, 1) * lv.spin[1] * 0.2;
    if (kind === 'push') { T = rnd(0.72, 0.92); top = -rnd(lv.spin[0], lv.spin[1]) * 0.8; tx = sx * 0.8; tz = rnd(0.35, 0.9); }
    else if (kind === 'smash') { T = rnd(0.3, 0.38); top = rnd(30, 90); tx = sx; tz = rnd(0.9, 1.2); }
    else if (kind === 'lob') { T = rnd(1.05, 1.25); top = rnd(60, 160); tx = sx * 0.6; tz = rnd(0.9, 1.2); }
    else if (kind === 'error') {
      const r = Math.random();
      T = rnd(lv.T[0], lv.T[1]); top = rnd(lv.spin[0], lv.spin[1]);
      if (r < 0.4) { tx = sx; tz = HL + rnd(0.08, 0.35); }                    // long
      else if (r < 0.75) { tx = Math.sign(sx || 1) * (HW + rnd(0.06, 0.3)); tz = rnd(0.5, 1.2); } // wide
      else { tx = sx; tz = 0.08; T = Math.max(0.3, T - 0.25); top = 0; }           // into the net
      spinFor(outW, p0, tx, tz * dir, top, side);
      if (solveShot(p0, outW, tx, tz * dir, T, outV)) return kind;
      continue;
    }
    else { T = rnd(lv.T[0], lv.T[1]); top = rnd(lv.spin[0], lv.spin[1]); tx = sx; tz = rnd(lv.deep[0], lv.deep[1]); }
    // Low contact points need more air time to clear the net.
    if (p0.y < TOP + 0.12) T += 0.12;
    T += attempt * 0.08;
    spinFor(outW, p0, tx, tz * dir, top, side);
    if (solveShot(p0, outW, tx, tz * dir, T, outV) && checkShot(p0, outV, outW, dir)) return kind;
    if (attempt >= 3) kind = 'lob';
  }
  // Safe fallback: gentle lob to the middle
  spinFor(outW, p0, 0, 0.8 * dir, 40, 0);
  solveShot(p0, outW, 0, 0.8 * dir, 1.15, outV);
  return 'lob';
}

// Serve from p0: first bounce on the server's own half, then on the receiver's (dir = receiver side sign).
export function makeServe(p0, dir, lv, outV, outW) {
  for (let i = 0; i < 40; i++) {
    const ax = p0.x + rnd(-0.25, 0.25) * (0.5 + lv.spread), az = -dir * rnd(0.75, 1.15);
    const T = rnd(0.11, 0.22) + (i > 20 ? 0.04 : 0);
    const r = Math.random();
    const top = r < 0.45 ? -rnd(lv.spin[0], lv.spin[1]) : r < 0.8 ? rnd(lv.spin[0], lv.spin[1]) * 0.7 : 0;
    spinFor(outW, p0, ax, az, top, rnd(-1, 1) * lv.spin[1] * 0.35);
    if (!solveShot(p0, outW, ax, az, T, outV)) continue;
    _st.p.copy(p0); _st.v.copy(outV); _st.w.copy(outW);
    _pred.run(_st, 1400);
    if (_pred.nev < 2 || _pred.evType[0] !== EV_TABLE || _pred.evType[1] !== EV_TABLE) continue;
    const z1 = _pred.evZ[1], x1 = _pred.evX[1];
    if (z1 * dir > 0.15 && Math.abs(z1) < HL - 0.05 && Math.abs(x1) < HW - 0.04) return true;
  }
  // fallback: a simple, slow serve
  spinFor(outW, p0, 0, -dir * 0.7, 0, 0);
  solveShot(p0, outW, 0, -dir * 0.7, 0.32, outV);
  return false;
}

// ── The bot ──────────────────────────────────────────────────
const READY_Y = TOP + 0.3, READY_Z = -1.72;
export class Bot {
  constructor(vis) {
    this.vis = vis;
    this.lv = LEVELS.normal;
    this.state = 'idle';
    this.base = new THREE.Vector3(-0.3, READY_Y, READY_Z);   // blade centre without swing offset
    this.aim = new THREE.Vector3(); this.hitPos = new THREE.Vector3();
    this.hitAt = 0; this.moveAt = 0; this.lastHitAt = -10; this.serveAt = 0; this.serveX = 0;
    this.shotKind = 'drive';
    this.bodyX = 0; this.bodyZ = -2.15;
    this.face = new THREE.Vector3(0, 0.1, 1).normalize();
    this.pred = new Predictor(1400);
    this.hold = new THREE.Vector3();
    // scratch
    this._m = new THREE.Matrix4(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
    this._off = new THREE.Vector3(); this._blade = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._sh = new THREE.Vector3(); this._d = new THREE.Vector3(); this._tmpV = new THREE.Vector3(); this._tmpW = new THREE.Vector3();
  }
  setLevel(id) { this.lv = LEVELS[id] ?? LEVELS.normal; }
  reset() { this.state = 'idle'; this.lastHitAt = -10; }

  // Called right after the player strikes the ball. `serveReceive`: the ball is a serve (must bounce on the
  // player's half first). Predicts the flight, decides whether the ball is legal, and picks a contact point.
  plan(ball, now, serveReceive) {
    this.state = 'idle';
    const p = this.pred.run(ball, 1400);
    let k = 0;
    if (serveReceive) {
      if (p.nev < 2 || p.evType[0] !== EV_TABLE || p.evZ[0] <= 0 || p.evType[1] !== EV_TABLE || p.evZ[1] >= 0) return false;
      k = 1;
    } else {
      while (k < p.nev && p.evType[k] === EV_NET) k++;
      if (k >= p.nev || p.evType[k] !== EV_TABLE || p.evZ[k] >= 0) return false;
    }
    const bounce = p.evStep[k], end = k + 1 < p.nev ? p.evStep[k + 1] : p.n - 1;
    let pick = -1;
    for (let i = bounce + 8; i <= end; i++) {
      const y = p.pos[i * 3 + 1], yp = p.pos[(i - 1) * 3 + 1], z = p.pos[i * 3 + 2];
      if (z > -0.4) continue;
      if ((y < yp && y < TOP + 0.3) || z < -1.95 || y < TOP + 0.06) { pick = i; break; }
    }
    if (pick < 0) return false;
    const x = p.pos[pick * 3], y = p.pos[pick * 3 + 1], z = p.pos[pick * 3 + 2];
    if (Math.abs(x) > 1.7 || (y < TOP + 0.03 && Math.abs(z) < HL)) return false;
    this.hitPos.set(x, y, z);
    const e = this.lv.perr;
    this.aim.set(x + gauss() * e, y + gauss() * e * 0.6, z + gauss() * e * 0.5);
    this.hitAt = now + (pick + 1) * H;
    this.moveAt = now + this.lv.react * rnd(0.85, 1.2);
    this.state = 'track';
    // decide the stroke now so the swing animation matches
    const lv = this.lv;
    if (y > TOP + 0.42 && Math.random() < lv.smash) this.shotKind = 'smash';
    else if (y < TOP + 0.28 && Math.random() < lv.push) this.shotKind = 'push';
    else this.shotKind = 'drive';
    return true;
  }

  // In the physics loop at t >= hitAt. Returns true and sets ball v/w if the bot reaches it.
  tryHit(ball, now) {
    this.state = 'recover';
    const dist = this._blade.copy(this.base).distanceTo(ball.p);
    if (dist > this.lv.reach) return false;
    const sp = ball.v.length();
    let kind = this.shotKind;
    if (Math.random() < this.lv.err * (1 + Math.max(0, sp - 6) / 8 + (dist / this.lv.reach) * 0.5)) kind = 'error';
    kind = makeShot(ball.p, +1, this.lv, kind, this._tmpV, this._tmpW);
    ball.v.copy(this._tmpV); ball.w.copy(this._tmpW);
    this.lastKind = kind; this.lastHitAt = now;
    this.setFace(kind, ball.v);
    return true;
  }

  // Serve: hold the ball, toss, then strike on the way down.
  beginServe(now) { this.state = 'serveHold'; this.serveAt = now + rnd(1.2, 1.8); this.serveX = rnd(-0.45, 0.45); }
  servePoint(out) { return out.set(this.serveX + 0.08, TOP + 0.26, -1.6); }
  serveHit(ball, now) {
    makeServe(ball.p, +1, this.lv, this._tmpV, this._tmpW);
    ball.v.copy(this._tmpV); ball.w.copy(this._tmpW);
    this.state = 'recover'; this.lastHitAt = now; this.lastKind = 'serve';
    this.setFace('serve', ball.v);
  }
  setFace(kind, v) {
    const tilt = kind === 'push' || kind === 'serve' ? 0.6 : kind === 'lob' ? 0.4 : kind === 'smash' ? -0.25 : -0.35;
    this.face.set(v.x * 0.15, tilt, 1).normalize();
  }

  // Visual + movement update, once per frame.
  update(dt, now, ball, ballVisible) {
    const lv = this.lv, b = this.base;
    let tx, ty, tz, speed = lv.speed;
    if (this.state === 'track') {
      if (now >= this.moveAt) { tx = this.aim.x; ty = this.aim.y; tz = this.aim.z; }
      else { tx = b.x; ty = b.y; tz = b.z; }
      // face for the planned stroke
      const tilt = this.shotKind === 'push' ? 0.55 : this.shotKind === 'smash' ? -0.25 : -0.3;
      this._d.set(-this.aim.x * 0.1, tilt, 1).normalize(); this.face.lerp(this._d, Math.min(1, dt * 8)).normalize();
    } else if (this.state === 'serveHold' || this.state === 'serveToss') {
      tx = this.serveX - 0.05; ty = TOP + 0.12; tz = -1.72; speed = 1.5;
      this._d.set(0, 0.6, 1).normalize(); this.face.lerp(this._d, Math.min(1, dt * 6)).normalize();
    } else {
      // ready position, drifting towards the ball's line
      tx = THREE.MathUtils.clamp(ballVisible ? ball.p.x * 0.5 : 0, -0.6, 0.6) - 0.15; ty = READY_Y; tz = READY_Z; speed = Math.min(lv.speed, 1.6);
      if (now - this.lastHitAt > 0.35) { this._d.set(0, 0.1, 1).normalize(); this.face.lerp(this._d, Math.min(1, dt * 3)).normalize(); }
    }
    this._d.set(tx - b.x, ty - b.y, tz - b.z);
    const dl = this._d.length(), step = speed * dt;
    if (dl > step) b.addScaledVector(this._d, step / dl); else b.set(tx, ty, tz);

    // swing offset relative to the contact point
    const off = this._off.set(0, 0, 0);
    if (this.state === 'track') {
      const u = (now - this.hitAt) / 0.22;    // -1 .. 0 before contact
      if (u > -1.6) {
        const k = u < -0.35 ? Math.min(1, (u + 1.6) / 1.0) : Math.max(0, -u / 0.35);
        const back = this.shotKind === 'push' ? 0.12 : 0.28, low = this.shotKind === 'push' ? 0.06 : -0.12;
        off.set(0, low * k, -back * k);
      }
    } else {
      const u = (now - this.lastHitAt) / 0.25;
      if (u >= 0 && u < 2) {
        const k = u < 1 ? Math.sin(u * Math.PI / 2) : 1 - (u - 1);
        const fw = this.lastKind === 'push' || this.lastKind === 'serve' ? 0.16 : 0.32, up = this.lastKind === 'push' ? 0.03 : 0.26;
        off.set(0, up * k, fw * k);
      }
    }
    const blade = this._blade.copy(b).add(off);

    // paddle orientation: forehand face (local +X) = face dir, blade up (local -Z) ≈ world up
    const X = this._x.copy(this.face);
    const Z = this._z.set(0, -1, 0).addScaledVector(X, -X.dot(this._z.set(0, -1, 0))).normalize();
    // roll the blade a bit towards the body for a natural wrist
    Z.x += 0.25; Z.addScaledVector(X, -X.dot(Z)).normalize();
    const Y = this._y.crossVectors(Z, X);
    this._m.makeBasis(X, Y, Z); this._q.setFromRotationMatrix(this._m);
    const pad = this.vis.paddle;
    pad.quaternion.copy(this._q);
    pad.position.set(0, 0, -BLADE_Z).applyQuaternion(this._q).negate().add(blade);

    // body follows the paddle arm, hovering
    const wantX = THREE.MathUtils.clamp(b.x + 0.38, -1.6, 1.6), wantZ = THREE.MathUtils.clamp(b.z - 0.5, -2.45, -1.95);
    this.bodyX += THREE.MathUtils.clamp(wantX - this.bodyX, -lv.speed * 0.8 * dt, lv.speed * 0.8 * dt);
    this.bodyZ += THREE.MathUtils.clamp(wantZ - this.bodyZ, -1.2 * dt, 1.2 * dt);
    const root = this.vis.root;
    root.position.set(this.bodyX, Math.sin(now * 2.1) * 0.015, this.bodyZ);
    root.rotation.y = THREE.MathUtils.clamp((blade.x - this.bodyX + 0.38) * -0.4, -0.4, 0.4);
    root.updateMatrixWorld();
    if (ballVisible) { this.vis.head.lookAt(ball.p); }
    // arms: shoulder → grip
    this._sh.set(-0.3, 1.36, 0).applyMatrix4(root.matrixWorld);
    placeArm(this.vis.arm, this._sh, pad.position, this._d);
    this._sh.set(0.3, 1.36, 0).applyMatrix4(root.matrixWorld);
    this.hold.set(this.bodyX + 0.42, TOP + 0.18, this.bodyZ + 0.45);
    if (this.state === 'serveHold') this.hold.set(this.serveX + 0.08, TOP + 0.22 + Math.sin(now * 3) * 0.01, -1.6);
    placeArm(this.vis.offArm, this._sh, this.hold, this._d);
  }
}

const _yAxis = new THREE.Vector3(0, 1, 0);
function placeArm(mesh, from, to, tmp) {
  tmp.subVectors(to, from);
  const len = tmp.length();
  mesh.position.copy(from);
  mesh.scale.set(1, Math.max(0.01, len), 1);
  mesh.quaternion.setFromUnitVectors(_yAxis, tmp.divideScalar(len || 1));
}
