import * as THREE from 'three';

// Unified input for every game.
// In VR it reads WebXR controllers (xr-standard mapping) and exposes tracked hands.
// On desktop it emulates two controllers from mouse + keyboard so games are testable.
//
// Hand state (input.left / input.right / input.main / input.off):
//   present, gripPos, gripQuat, rayPos, rayQuat (all world space, updated every frame)
//   trigger, squeeze            analog 0..1
//   triggerDown, triggerUp      edges this frame
//   squeezeDown, squeezeUp      edges this frame
//   a, b                        edge: face buttons (A/B on right, X/Y on left)
//   aHeld, bHeld                held state
//   stick                       edge: thumbstick click
//   axes                        [x, y] thumbstick (y is -1 when pushed forward)
//   velocity, angularSpeed      grip linear velocity (m/s, world) and angular speed (rad/s)
//   haptic(intensity 0..1, ms)
//   handedness                  'left' | 'right'
//   rayDir()                    world direction of the pointing ray (new Vector3)

function makeHand(handedness) {
  return {
    handedness, present: false,
    gripPos: new THREE.Vector3(), gripQuat: new THREE.Quaternion(),
    rayPos: new THREE.Vector3(), rayQuat: new THREE.Quaternion(),
    trigger: 0, squeeze: 0,
    triggerDown: false, triggerUp: false, squeezeDown: false, squeezeUp: false,
    a: false, b: false, aHeld: false, bHeld: false, stick: false, stickHeld: false,
    axes: [0, 0],
    velocity: new THREE.Vector3(), angularSpeed: 0,
    _prevPos: new THREE.Vector3(), _prevQuat: new THREE.Quaternion(), _hasPrev: false,
    haptic: () => { },
    rayDir() { return new THREE.Vector3(0, 0, -1).applyQuaternion(this.rayQuat); },
  };
}

export class Input {
  constructor(renderer, rig, camera, dom) {
    this.renderer = renderer; this.rig = rig; this.camera = camera; this.dom = dom;
    this.left = makeHand('left');
    this.right = makeHand('right');
    this.leftHanded = false;
    this.head = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fwd: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0) };
    this.desktop = false;
    this.xr = false;

    // XR controllers + hand-tracking joints
    this.ctrl = [0, 1].map((i) => {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      const hand = renderer.xr.getHand(i);
      rig.add(ray, grip, hand);
      const c = { ray, grip, hand, source: null, prev: [] };
      ray.addEventListener('connected', (e) => { c.source = e.data; });
      ray.addEventListener('disconnected', () => { c.source = null; });
      return c;
    });

    // Desktop state
    this.mouse = { left: false, right: false, leftDown: false, rightDown: false, leftUp: false, rightUp: false, dx: 0, dy: 0, wheel: 0, x: 0, y: 0 };
    this.keys = new Set();
    this.keysDown = new Set();
    this.yaw = 0; this.pitch = 0;
    this.locked = false;
    this.freezeLook = false;
    this.lookEnabled = true;
    this.lookSensitivity = 0.0022;
    this._bind();
  }

  get main() { return this.leftHanded ? this.left : this.right; }
  get off() { return this.leftHanded ? this.right : this.left; }

  // Raw XR hand-tracking: returns { handedness, joints: XRHand joint Object3Ds by name } or null
  trackedHand(handedness) {
    for (const c of this.ctrl) {
      if (c.source?.hand && c.source.handedness === handedness) return { handedness, joints: c.hand.joints, object: c.hand };
    }
    return null;
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('mousedown', (e) => {
      if (!this.desktop) return;
      if (!this.locked && this.lookEnabled) {
        try { const r = d.requestPointerLock(); r?.catch?.(() => { }); } catch { }
      }
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftDown = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightDown = true; }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouse.left) { this.mouse.left = false; this.mouse.leftUp = true; }
      if (e.button === 2 && this.mouse.right) { this.mouse.right = false; this.mouse.rightUp = true; }
    });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === d; });
    document.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (!this.desktop || !this.locked || this.freezeLook) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      if (this.lookEnabled) {
        this.yaw -= e.movementX * this.lookSensitivity;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - e.movementY * this.lookSensitivity));
      }
    });
    d.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.keysDown.add(e.code);
      this.keys.add(e.code);
      if (this.desktop && (e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  key(code) { return this.keys.has(code); }
  keyDown(code) { return this.keysDown.has(code); }

  // Call once per frame before the game update.
  update(dt) {
    this.xr = this.renderer.xr.isPresenting;
    this.rig.updateMatrixWorld(true);
    if (this.xr) this._readXR();
    else if (this.desktop) this._readDesktop(dt);
    else { this.left.present = this.right.present = false; }

    this.camera.getWorldPosition(this.head.pos);
    this.camera.getWorldQuaternion(this.head.quat);
    this.head.fwd.set(0, 0, -1).applyQuaternion(this.head.quat);
    this.head.up.set(0, 1, 0).applyQuaternion(this.head.quat);

    for (const h of [this.left, this.right]) this._velocity(h, dt);
  }

  // Call at the end of the frame to clear edge flags.
  endFrame() {
    this.mouse.leftDown = this.mouse.rightDown = this.mouse.leftUp = this.mouse.rightUp = false;
    this.mouse.dx = this.mouse.dy = 0; this.mouse.wheel = 0;
    this.keysDown.clear();
  }

  _velocity(h, dt) {
    if (!h.present || dt <= 0) { h._hasPrev = false; h.velocity.set(0, 0, 0); h.angularSpeed = 0; return; }
    if (h._hasPrev) {
      const v = h.gripPos.clone().sub(h._prevPos).divideScalar(dt);
      h.velocity.lerp(v, 0.6);
      h.angularSpeed = h._prevQuat.angleTo(h.gripQuat) / dt;
    }
    h._prevPos.copy(h.gripPos); h._prevQuat.copy(h.gripQuat); h._hasPrev = true;
  }

  _readXR() {
    const seen = { left: false, right: false };
    for (const c of this.ctrl) {
      const src = c.source;
      if (!src || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const out = this[src.handedness];
      seen[src.handedness] = true;
      const gp = src.gamepad;
      out.present = true;
      if (src.hand && !gp) {
        // Hand tracking without a gamepad: approximate pinch as trigger.
        const j = c.hand.joints;
        const tip = j['index-finger-tip'], thumb = j['thumb-tip'], wrist = j['wrist'];
        if (tip && thumb && wrist) {
          wrist.getWorldPosition(out.gripPos); wrist.getWorldQuaternion(out.gripQuat);
          c.ray.getWorldPosition(out.rayPos); c.ray.getWorldQuaternion(out.rayQuat);
          const pinch = tip.getWorldPosition(new THREE.Vector3()).distanceTo(thumb.getWorldPosition(new THREE.Vector3()));
          this._setAnalog(out, pinch < 0.02 ? 1 : pinch < 0.035 ? 0.5 : 0, 0);
          out.a = out.b = out.stick = false; out.axes = [0, 0];
        } else out.present = false;
        out.haptic = () => { };
        continue;
      }
      if (!gp) { out.present = false; continue; }
      c.grip.getWorldPosition(out.gripPos); c.grip.getWorldQuaternion(out.gripQuat);
      c.ray.getWorldPosition(out.rayPos); c.ray.getWorldQuaternion(out.rayQuat);
      const val = (i) => gp.buttons[i] ? (gp.buttons[i].value ?? (gp.buttons[i].pressed ? 1 : 0)) : 0;
      const pressed = (i) => !!gp.buttons[i]?.pressed;
      this._setAnalog(out, val(0), val(1));
      const edge = (i) => { const p = pressed(i); const was = c.prev[i]; c.prev[i] = p; return p && !was; };
      out.stick = edge(3); out.a = edge(4); out.b = edge(5);
      out.stickHeld = pressed(3); out.aHeld = pressed(4); out.bHeld = pressed(5);
      out.axes = [gp.axes[2] ?? gp.axes[0] ?? 0, gp.axes[3] ?? gp.axes[1] ?? 0];
      out.haptic = (intensity, ms) => {
        try {
          const act = gp.hapticActuators?.[0];
          if (act?.pulse) act.pulse(Math.max(0, Math.min(1, intensity)), ms);
          else gp.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
        } catch { }
      };
    }
    if (!seen.left) this.left.present = false;
    if (!seen.right) this.right.present = false;
  }

  _setAnalog(out, trig, sq) {
    const pt = out.trigger, ps = out.squeeze;
    out.trigger = trig; out.squeeze = sq;
    out.triggerDown = trig > 0.55 && pt <= 0.55;
    out.triggerUp = trig < 0.3 && pt >= 0.3;
    out.squeezeDown = sq > 0.6 && ps <= 0.6;
    out.squeezeUp = sq < 0.3 && ps >= 0.3;
  }

  // Desktop emulation:
  //   mouse look (click to lock), crosshair = main-hand ray
  //   main hand: LMB trigger, RMB squeeze, E = A button, R = B button, C = stick click, arrow keys = stick
  //   off hand:  Q trigger, F squeeze, X = X button, Z = Y button, V = stick click, WASD = stick
  //   Tab = back to hub (handled by the platform)
  _readDesktop() {
    const cam = this.camera;
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    cam.updateMatrixWorld(true);
    const cp = cam.getWorldPosition(new THREE.Vector3()), cq = cam.getWorldQuaternion(new THREE.Quaternion());
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cq), r = new THREE.Vector3(1, 0, 0).applyQuaternion(cq), u = new THREE.Vector3(0, 1, 0).applyQuaternion(cq);
    const m = this.main, o = this.off;
    m.present = o.present = true;
    const side = this.leftHanded ? -1 : 1;
    m.gripPos.copy(cp).addScaledVector(f, 0.42).addScaledVector(r, 0.2 * side).addScaledVector(u, -0.2);
    m.gripQuat.copy(cq);
    m.rayPos.copy(cp).addScaledVector(f, 0.05); m.rayQuat.copy(cq);
    o.gripPos.copy(cp).addScaledVector(f, 0.42).addScaledVector(r, -0.2 * side).addScaledVector(u, -0.2);
    o.gripQuat.copy(cq);
    o.rayPos.copy(o.gripPos); o.rayQuat.copy(cq);

    this._setAnalog(m, this.mouse.left ? 1 : 0, this.mouse.right ? 1 : 0);
    this._setAnalog(o, this.key('KeyQ') ? 1 : 0, this.key('KeyF') ? 1 : 0);
    m.a = this.keyDown('KeyE'); m.b = this.keyDown('KeyR'); m.stick = this.keyDown('KeyC');
    m.aHeld = this.key('KeyE'); m.bHeld = this.key('KeyR'); m.stickHeld = this.key('KeyC');
    o.a = this.keyDown('KeyX'); o.b = this.keyDown('KeyZ'); o.stick = this.keyDown('KeyV');
    o.aHeld = this.key('KeyX'); o.bHeld = this.key('KeyZ'); o.stickHeld = this.key('KeyV');
    o.axes = [(this.key('KeyD') ? 1 : 0) - (this.key('KeyA') ? 1 : 0), (this.key('KeyS') ? 1 : 0) - (this.key('KeyW') ? 1 : 0)];
    m.axes = [(this.key('ArrowRight') ? 1 : 0) - (this.key('ArrowLeft') ? 1 : 0), (this.key('ArrowDown') ? 1 : 0) - (this.key('ArrowUp') ? 1 : 0)];
    m.haptic = o.haptic = () => { };
  }
}
