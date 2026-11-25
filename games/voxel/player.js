import * as THREE from 'three';
import { BLOCKS, B } from './blocks.js';
import { rotateRigAround } from '../../src/platform/kit.js';

// Player body + locomotion for VR and desktop.
// The collision body is an AABB whose X/Z follow the head (so you can physically lean and walk),
// whose feet are this.feetY, and whose height follows the head height (so you can duck).
//   player.position   Vector3 feet centre (world)      player.eye   head position (world)
//   player.velocity   Vector3 m/s                      player.onGround / inWater / headInWater / flying
//   player.teleport(x, y, z)   player.push(vx, vy, vz)  (knockback for phase 2)
// Events: 'playerLanded' { fall }, 'playerDamaged' { amount, cause: 'fall' } (survival only; phase 2 applies it).

const GRAV = 26, JUMP_V = 8.4;
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    const { rig, scene } = game.ctx;
    this.rig = rig;
    this.position = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.feetY = rig.position.y;
    this.onGround = false; this.inWater = false; this.headInWater = false; this.flying = false;
    this.width = 0.6; this.height = 1.8;
    this.stepLag = 0; this.frozen = true;
    this._snapReady = true; this._flickReady = true;
    this._lastJumpTap = -1; this._fallTop = null; this._stepDist = 0;
    this._lastPhysT = 0;
    this.speed = 0;
    this.box = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

    // teleport arc (VR teleport mode)
    const N = 64;
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.arc = new THREE.Line(this.arcGeo, new THREE.LineBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.9 }));
    this.arc.frustumCulled = false; this.arc.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.33, 24), new THREE.MeshBasicMaterial({ color: 0x9fe3ff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    scene.add(this.arc, this.marker);
    this.tpAiming = false; this.tpValid = false; this.tpPoint = new THREE.Vector3();

    // comfort vignette + "head inside a block" blackout, parented to the rig, follow the camera
    this.vig = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uStrength; varying vec2 vUv; void main(){ float r = length(vUv); float a = smoothstep(0.55 - uStrength * 0.25, 1.0 - uStrength * 0.3, r) * uStrength; gl_FragColor = vec4(0.02, 0.02, 0.05, a); }`,
    }));
    this.vig.renderOrder = 1000; this.vig.frustumCulled = false; this.vig.visible = false;
    this.blackout = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: 0x08060c, side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0 }));
    this.blackout.renderOrder = 1001; this.blackout.visible = false; this.blackout.frustumCulled = false;
    rig.add(this.vig, this.blackout);
    this.vigStrength = 0;
  }

  get scale() { return this.game.settings.giant ? 3 : 1; }

  teleport(x, y, z) {
    const head = this.game.input.head.pos;
    this.rig.position.x += x - head.x; this.rig.position.z += z - head.z;
    this.feetY = y; this.rig.position.y = y; this.stepLag = 0;
    this.velocity.set(0, 0, 0); this._fallTop = null;
    this.position.set(x, y, z);
  }
  push(vx, vy, vz) { this.velocity.x += vx; this.velocity.y += vy; this.velocity.z += vz; }

  _solidAt(x, y, z) {
    const id = this.game.world.getBlock(x, y, z);
    if (id < 0) return true;
    const d = BLOCKS[id];
    return d ? d.solid : false;
  }
  _boxFree(minX, minY, minZ, maxX, maxY, maxZ) {
    const e = 1e-4;
    for (let y = Math.floor(minY + e); y <= Math.floor(maxY - e); y++)
      for (let z = Math.floor(minZ + e); z <= Math.floor(maxZ - e); z++)
        for (let x = Math.floor(minX + e); x <= Math.floor(maxX - e); x++)
          if (this._solidAt(x, y, z)) return false;
    return true;
  }
  // Sweep the box along one axis; voxels already overlapping the box are ignored (so physically
  // leaning into a wall never traps you). Returns the allowed delta.
  _moveAxis(axis, d) {
    if (d === 0) return 0;
    const b = this.box, e = 1e-4;
    const lo = axis === 0 ? b.minX : axis === 1 ? b.minY : b.minZ;
    const hi = axis === 0 ? b.maxX : axis === 1 ? b.maxY : b.maxZ;
    const lead = d > 0 ? hi : lo;
    const from = d > 0 ? Math.ceil(lead - e) : Math.floor(lead + e) - 1;
    const to = d > 0 ? Math.floor(lead + d - e) : Math.floor(lead + d + e);
    const step = d > 0 ? 1 : -1;
    // ranges of the other two axes
    const a1 = axis === 0 ? 1 : 0, a2 = axis === 2 ? 1 : 2;
    const r = (ax, which) => ax === 0 ? (which ? b.maxX : b.minX) : ax === 1 ? (which ? b.maxY : b.minY) : (which ? b.maxZ : b.minZ);
    const p0 = Math.floor(r(a1, 0) + e), p1 = Math.floor(r(a1, 1) - e), q0 = Math.floor(r(a2, 0) + e), q1 = Math.floor(r(a2, 1) - e);
    for (let c = from; d > 0 ? c <= to : c >= to; c += step) {
      for (let p = p0; p <= p1; p++) for (let q = q0; q <= q1; q++) {
        let x, y, z;
        if (axis === 0) { x = c; y = p; z = q; } else if (axis === 1) { x = p; y = c; z = q; } else { x = p; y = q; z = c; }
        if (this._solidAt(x, y, z)) {
          return d > 0 ? Math.max(0, c - lead - e) : Math.min(0, c + 1 - lead + e);
        }
      }
    }
    return d;
  }
  _setBox(cx, feet, cz, w, h) { const b = this.box; b.minX = cx - w; b.maxX = cx + w; b.minZ = cz - w; b.maxZ = cz + w; b.minY = feet; b.maxY = feet + h; }

  update(dt) {
    const g = this.game, input = g.input, s = this.scale, set = g.settings;
    const head = input.head.pos, rig = this.rig;
    if (Math.abs(rig.scale.x - s) > 1e-3) rig.scale.setScalar(s);
    const vr = !input.desktop;
    const uiOpen = g.ui?.modalOpen;
    // keep body centred under the head; height follows head height in VR (ducking)
    const bx = head.x, bz = head.z;
    const w = 0.3 * s;
    const h = vr ? THREE.MathUtils.clamp(head.y - this.feetY + 0.12 * s, 0.8 * s, 2.0 * s) : 1.8 * s;
    this.width = w * 2; this.height = h;
    this.position.set(bx, this.feetY, bz);
    this.eye.copy(head);
    const world = g.world;
    this.frozen = !world.isLoaded(bx, bz) || world.getBlock(Math.floor(bx), Math.max(0, Math.floor(this.feetY)), Math.floor(bz)) < 0;

    // environment probes
    const fx = Math.floor(bx), fz = Math.floor(bz);
    const midId = world.getBlock(fx, Math.floor(this.feetY + 0.45 * s), fz);
    this.inWater = midId === B.water || world.getBlock(fx, Math.floor(this.feetY + 0.1), fz) === B.water;
    const eyeId = world.getBlock(Math.floor(head.x), Math.floor(head.y), Math.floor(head.z));
    this.headInWater = eyeId === B.water;
    const eyeDef = BLOCKS[eyeId];
    const headStuck = !!(eyeDef && eyeDef.render === 'cube' && !this.flying);
    this._updateOverlays(dt, headStuck);
    if (this.frozen) { this.velocity.set(0, 0, 0); return; }

    // ── turning (VR) ──
    if (vr && input.main.present && !uiOpen) {
      const x = input.main.axes[0];
      if (set.turn === 'smooth') { if (Math.abs(x) > 0.2) { rotateRigAround(rig, head, -x * 2.4 * dt); this._turning = true; } else this._turning = false; }
      else {
        if (Math.abs(x) > 0.65 && this._snapReady) { rotateRigAround(rig, head, -Math.sign(x) * THREE.MathUtils.degToRad(set.snapDeg)); this._snapReady = false; }
        if (Math.abs(x) < 0.3) this._snapReady = true;
      }
    }

    // ── fly toggle: double-tap jump (creative) ──
    const jumpTap = vr ? input.main.a : input.keyDown('Space');
    const jumpHeld = vr ? input.main.aHeld : input.key('Space');
    const now = g.time;
    if (jumpTap && !uiOpen) {
      if (g.mode === 'creative' && now - this._lastJumpTap < 0.32) { this.flying = !this.flying; this.velocity.y = 0; this._lastJumpTap = -1; g.toast(this.flying ? 'Flying' : 'Walking'); }
      else this._lastJumpTap = now;
    }
    if (g.mode !== 'creative') this.flying = false;

    // ── teleport mode (VR only) ──
    if (vr && set.locomotion === 'teleport') this._teleport(input);
    else { this.arc.visible = this.marker.visible = false; this.tpAiming = false; }

    // ── wish direction ──
    let ax = 0, ay = 0;
    if (!(vr && set.locomotion === 'teleport') && !uiOpen) { ax = input.off.axes[0]; ay = input.off.axes[1]; }
    const mag = Math.hypot(ax, ay);
    if (mag < 0.15) { ax = 0; ay = 0; } else if (mag > 1) { ax /= mag; ay /= mag; }
    if (vr) _f.copy(input.head.fwd);
    else _f.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw));
    const fyRaw = _f.y;
    _f.y = 0;
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1);
    _f.normalize();
    _r.set(-_f.z, 0, _f.x);
    const sprint = vr ? !!set.sprint : (input.key('ShiftLeft') || input.key('ControlLeft')) && !this.flying;
    let speed = (this.flying ? 9 : this.inWater ? 2.4 : sprint ? 5.8 : 4.0) * s;
    if (!vr && this.flying && input.key('ControlLeft')) speed *= 2;
    const wx = (_f.x * -ay + _r.x * ax) * speed, wz = (_f.z * -ay + _r.z * ax) * speed;
    const wy = this.flying && vr ? (fyRaw * -ay) * speed : 0;
    const v = this.velocity;
    const k = 1 - Math.exp(-dt * (this.onGround || this.flying || this.inWater ? 14 : 3.5));
    v.x += (wx - v.x) * k; v.z += (wz - v.z) * k;

    // ── vertical ──
    if (this.flying) {
      let up = 0;
      if (vr) { if (jumpHeld) up += 1; } else { if (jumpHeld) up += 1; if (input.key('ShiftLeft')) up -= 1; }
      const ty = up * 7 * s + wy;
      v.y += (ty - v.y) * (1 - Math.exp(-dt * 10));
    } else if (this.inWater) {
      v.y -= GRAV * 0.25 * s * dt;
      if (jumpHeld && !uiOpen) v.y += (3.2 * s - v.y) * (1 - Math.exp(-dt * 6));
      v.y = Math.max(v.y, -2.2 * s);
      if (jumpTap && this.onGround) v.y = 4.5 * s;
    } else {
      v.y -= GRAV * s * dt;
      v.y = Math.max(v.y, -45 * s);
      if (jumpTap && this.onGround && !uiOpen) v.y = JUMP_V * s;
    }

    // ── collide + move ──
    const feet0 = this.feetY;
    this._setBox(bx, this.feetY, bz, w, h);
    let dx = v.x * dt, dy = v.y * dt, dz = v.z * dt;
    const rdy = this._moveAxis(1, dy);
    if (rdy !== dy) { if (dy < 0) this._land(); v.y = 0; }
    const wasGround = this.onGround;
    this.onGround = dy < 0 && rdy !== dy;
    if (!this.onGround && !this.flying && wasGround && v.y <= 0) {
      // still standing on something? (tiny probe)
      if (this._moveAxis(1, -0.02) > -0.02) this.onGround = true;
    }
    this.box.minY += rdy; this.box.maxY += rdy;
    let rdx = this._moveAxis(0, dx);
    this.box.minX += rdx; this.box.maxX += rdx;
    let rdz = this._moveAxis(2, dz);
    this.box.minZ += rdz; this.box.maxZ += rdz;
    // auto step-up onto a 1-block ledge
    const blocked = (Math.abs(rdx - dx) > 1e-5) || (Math.abs(rdz - dz) > 1e-5);
    if (blocked && (wasGround || this.inWater) && set.autoStep && !this.flying) {
      const lift = 1.02 * s;
      const sb = { ...this.box };
      this.box.minX -= rdx; this.box.maxX -= rdx; this.box.minZ -= rdz; this.box.maxZ -= rdz;
      if (this._boxFree(this.box.minX, this.box.minY + lift, this.box.minZ, this.box.maxX, this.box.maxY + lift, this.box.maxZ)) {
        this.box.minY += lift; this.box.maxY += lift;
        const sx = this._moveAxis(0, dx); this.box.minX += sx; this.box.maxX += sx;
        const sz = this._moveAxis(2, dz); this.box.minZ += sz; this.box.maxZ += sz;
        const down = this._moveAxis(1, -lift); this.box.minY += down; this.box.maxY += down;
        const climbed = this.box.minY - sb.minY;
        if ((Math.abs(sx) > Math.abs(rdx) + 1e-4 || Math.abs(sz) > Math.abs(rdz) + 1e-4) && climbed > 0.05) {
          rdx = sx; rdz = sz; this.stepLag += climbed; v.y = Math.max(0, v.y); this.onGround = true;
        } else Object.assign(this.box, sb);
      } else Object.assign(this.box, sb);
    }
    if (Math.abs(rdx - dx) > 1e-5) v.x = 0;
    if (Math.abs(rdz - dz) > 1e-5) v.z = 0;
    this.feetY = this.box.minY;
    rig.position.x += rdx; rig.position.z += rdz;
    this.stepLag *= Math.exp(-dt * 14); if (this.stepLag < 0.002) this.stepLag = 0;
    rig.position.y = this.feetY - this.stepLag;
    this.position.set(bx + rdx, this.feetY, bz + rdz);
    this.speed = Math.hypot(rdx, rdz) / Math.max(dt, 1e-4);

    // fall tracking
    if (!this.onGround && !this.flying && !this.inWater) { if (this._fallTop === null || this.feetY > this._fallTop) this._fallTop = this.feetY; }
    else if (this.inWater || this.flying) this._fallTop = null;
    // footsteps
    if (this.onGround && !this.inWater) {
      this._stepDist += Math.hypot(rdx, rdz);
      if (this._stepDist > 1.7 * s) {
        this._stepDist = 0;
        const below = world.getBlock(Math.floor(this.position.x), Math.floor(this.feetY - 0.05), Math.floor(this.position.z));
        if (below > 0) g.audio.material(BLOCKS[below]?.sound, 'step', null);
      }
    }
    if (this.feetY < -20) this.teleport(this.position.x, 90, this.position.z);
    void feet0;
  }

  _land() {
    if (this._fallTop === null) return;
    const fall = (this._fallTop - this.feetY) / this.scale;
    this._fallTop = null;
    const g = this.game;
    g.events.emit('playerLanded', { fall });
    if (fall > 3.5 && g.mode === 'survival' && !this.inWater) g.events.emit('playerDamaged', { amount: Math.floor(fall - 3), cause: 'fall' });
  }

  _teleport(input) {
    const h = input.off, s = this.scale;
    const uiOpen = this.game.ui?.modalOpen;
    if (!h.present || uiOpen) { this.arc.visible = this.marker.visible = false; this.tpAiming = false; return; }
    const y = h.axes[1];
    if (!this.tpAiming && y < -0.7) this.tpAiming = true;
    if (this.tpAiming && y > -0.3) {
      this.tpAiming = false; this.arc.visible = this.marker.visible = false;
      if (this.tpValid) { this.teleport(this.tpPoint.x, this.tpPoint.y, this.tpPoint.z); this.game.audio.material('plant', 'step', null); }
      return;
    }
    if (!this.tpAiming) return;
    // ballistic arc against voxels
    const arr = this.arcGeo.attributes.position.array;
    const p = _v.copy(h.rayPos), vel = h.rayDir().multiplyScalar(11 * Math.sqrt(s));
    const world = this.game.world;
    let n = 0; this.tpValid = false;
    for (; n < 64; n++) {
      arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z;
      const id = world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (id < 0) break;
      const d = BLOCKS[id];
      if (d && (d.solid || d.render === 'liquid')) {
        const top = Math.floor(p.y) + 1;
        const cx = Math.floor(p.x) + 0.5, cz = Math.floor(p.z) + 0.5;
        if (d.solid && this._boxFree(cx - 0.3, top, cz - 0.3, cx + 0.3, top + 1.8 * s, cz + 0.3)) { this.tpValid = true; this.tpPoint.set(cx, top, cz); }
        n++; break;
      }
      vel.y -= 9.8 * 0.035; p.addScaledVector(vel, 0.035);
    }
    this.arcGeo.setDrawRange(0, n); this.arcGeo.attributes.position.needsUpdate = true;
    this.arc.visible = true;
    this.marker.visible = this.tpValid;
    this.marker.position.copy(this.tpPoint).y += 0.03;
    this.marker.scale.setScalar(s);
    this.arc.material.color.setHex(this.tpValid ? 0x9fe3ff : 0xff7a6a);
  }

  _updateOverlays(dt, headStuck) {
    const input = this.game.input, cam = this.game.ctx.camera;
    const vr = !input.desktop;
    // place both at the camera's rig-local pose
    this.vig.position.copy(cam.position); this.vig.quaternion.copy(cam.quaternion);
    this.vig.translateZ(-0.3); this.vig.scale.setScalar(0.5);
    this.blackout.position.copy(cam.position);
    const want = vr && this.game.settings.vignette ? Math.min(1, (this.speed / (4 * this.scale)) * 0.8 + (this._turning ? 0.6 : 0)) : 0;
    this.vigStrength += (want - this.vigStrength) * (1 - Math.exp(-dt * 8));
    this.vig.material.uniforms.uStrength.value = this.vigStrength;
    this.vig.visible = this.vigStrength > 0.02;
    const bo = this.blackout.material;
    bo.opacity += ((headStuck ? 0.92 : 0) - bo.opacity) * (1 - Math.exp(-dt * 12));
    this.blackout.visible = bo.opacity > 0.02;
  }

  dispose() { this.arc.removeFromParent(); this.marker.removeFromParent(); this.vig.removeFromParent(); this.blackout.removeFromParent(); }
}
