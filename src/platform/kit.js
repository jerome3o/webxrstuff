import * as THREE from 'three';

// Shared helpers any game may use. Everything here is optional.

export const FONTS = {
  brush: '"Ma Shan Zheng", "Noto Serif SC", serif',
  serif: '"Noto Serif SC", Georgia, serif',
  latin: '"Cormorant Garamond", Georgia, serif',
  sans: '"Inter", "Segoe UI", system-ui, sans-serif',
};

// ── Canvas-textured panel with clickable buttons ─────────────
// const p = new Panel({ width: 1, height: 0.6, px: 1024, draw: (ctx, W, H, panel) => { ...; panel.button('id', x,y,w,h, 'Label', () => {}) } })
// scene.add(p.mesh); pointer.panels.push(p); p.markDirty() when content changes.
export class Panel {
  constructor({ width, height, px = 1024, draw, transparent = true }) {
    this.W = px; this.H = Math.round(px * height / width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.drawFn = draw;
    this.buttons = [];
    this.hover = null;
    this.dirty = true;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.tex, transparent, toneMapped: false }));
    this.mesh.userData.panel = this;
  }
  markDirty() { this.dirty = true; }
  redraw() {
    if (!this.dirty) return;
    this.dirty = false; this.buttons = [];
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.drawFn(this.ctx, this.W, this.H, this);
    this.tex.needsUpdate = true;
  }
  // Draw + register a button. style: { bg, fg, border, font, active, enabled }
  button(id, x, y, w, h, label, onClick, style = {}) {
    const c = this.ctx, hov = this.hover === id && style.enabled !== false;
    roundRect(c, x, y, w, h, Math.min(h * 0.2, 24));
    c.fillStyle = style.active ? (style.activeBg ?? '#c0261d') : hov ? (style.hoverBg ?? '#3a3a4a') : (style.bg ?? '#22222c'); c.fill();
    c.lineWidth = hov ? 5 : 2; c.strokeStyle = style.border ?? '#e2b85c'; c.stroke();
    c.fillStyle = style.enabled === false ? '#777' : (style.fg ?? '#f1e6cf');
    c.textAlign = 'center'; c.textBaseline = 'middle';
    fitText(c, label, x + w / 2, y + h / 2 + 2, w - 20, style.size ?? h * 0.42, style.font ?? FONTS.sans);
    this.buttons.push({ id, x, y, w, h, onClick, enabled: style.enabled !== false });
  }
  buttonAt(uv) {
    const px = uv.x * this.W, py = (1 - uv.y) * this.H;
    return this.buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) ?? null;
  }
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
export function fitText(c, text, x, y, maxW, size, font) {
  let s = size; c.font = `${s}px ${font}`;
  while (c.measureText(text).width > maxW && s > 8) { s -= 2; c.font = `${s}px ${font}`; }
  c.fillText(text, x, y);
}

// ── Laser pointer for Panels ─────────────────────────────────
// const pointer = new Pointer(scene); pointer.panels.push(panel);
// each frame: const hit = pointer.update(input.main, { show: true }); if (hit?.button && input.main.triggerDown) pointer.click(hit)
export class Pointer {
  constructor(scene, color = 0xffd060) {
    this.panels = [];
    this.raycaster = new THREE.Raycaster();
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false; this.line.visible = false;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshBasicMaterial({ color }));
    this.dot.visible = false;
    scene.add(this.line, this.dot);
    this.onHover = null; this.onClick = null;
  }
  pick(origin, dir, far = 10) {
    this.raycaster.set(origin, dir); this.raycaster.far = far;
    const meshes = this.panels.filter(p => p.mesh.visible && p.mesh.parent).map(p => p.mesh);
    const h = this.raycaster.intersectObjects(meshes, false)[0];
    if (!h) return null;
    const panel = h.object.userData.panel;
    return { panel, button: panel.buttonAt(h.uv), point: h.point, distance: h.distance, uv: h.uv };
  }
  update(hand, { show = true, far = 10 } = {}) {
    let hit = null;
    if (hand?.present) hit = this.pick(hand.rayPos, hand.rayDir(), far);
    const hoverId = hit?.button?.enabled ? hit.button.id : null;
    for (const p of this.panels) {
      const h = hit && hit.panel === p ? hoverId : null;
      if (p.hover !== h) { if (h && this.onHover) this.onHover(); p.hover = h; p.markDirty(); }
      p.redraw();
    }
    if (show && hit) {
      this.line.visible = this.dot.visible = true;
      this.line.position.copy(hand.rayPos);
      this.line.quaternion.copy(hand.rayQuat);
      this.line.scale.setScalar(hit.distance);
      this.dot.position.copy(hit.point);
    } else this.line.visible = this.dot.visible = false;
    return hit;
  }
  click(hit) {
    if (hit?.button?.enabled && hit.button.onClick) { this.onClick?.(); hit.button.onClick(); for (const p of this.panels) p.markDirty(); return true; }
    return false;
  }
}

// ── Text label (camera-facing sprite) ────────────────────────
export function makeLabel(text, { size = 0.2, color = '#ffffff', font = FONTS.sans, bg = null, px = 64 } = {}) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `${px}px ${font}`;
  const w = Math.ceil(x.measureText(text).width) + px, h = Math.ceil(px * 1.5);
  c.width = w; c.height = h;
  if (bg) { x.fillStyle = bg; roundRect(x, 0, 0, w, h, h * 0.25); x.fill(); }
  x.font = `${px}px ${font}`; x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(size * w / h, size, 1);
  return s;
}

// ── Teleport arc ─────────────────────────────────────────────
// const tp = new Teleporter(scene, { isValid: (p) => true, groundY: (x, z) => 0 });
// each frame: tp.update(input, rig) → handles push-forward-to-aim / release-to-jump on either stick.
export class Teleporter {
  constructor(scene, { isValid = () => true, groundY = () => 0, speed = 13, color = 0x7fd8ff } = {}) {
    this.isValid = isValid; this.groundY = groundY; this.speed = speed;
    this.N = 90;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
    this.line = new THREE.Line(this.geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.line.frustumCulled = false; this.line.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    scene.add(this.line, this.marker);
    this.hand = null; this.valid = false; this.point = new THREE.Vector3();
    this.enabled = true;
  }
  update(input, rig, onTeleport) {
    if (!this.enabled || input.desktop) { this.line.visible = this.marker.visible = false; this.hand = null; return false; }
    if (!this.hand) for (const h of [input.main, input.off]) if (h.present && h.axes[1] < -0.7 && Math.abs(h.axes[0]) < 0.5) { this.hand = h; break; }
    let jumped = false;
    if (this.hand) {
      if (!this.hand.present) this.hand = null;
      else if (this.hand.axes[1] > -0.3) {
        if (this.valid) {
          rig.position.x += this.point.x - input.head.pos.x;
          rig.position.z += this.point.z - input.head.pos.z;
          rig.position.y = this.point.y;
          jumped = true; onTeleport?.(this.point);
        }
        this.hand = null;
      } else this._arc(this.hand);
    }
    if (!this.hand) this.line.visible = this.marker.visible = false;
    return jumped;
  }
  _arc(hand) {
    const p = hand.rayPos.clone(), v = hand.rayDir().multiplyScalar(this.speed);
    const arr = this.geo.attributes.position.array;
    let n = 0; this.valid = false;
    for (; n < this.N; n++) {
      arr[n * 3] = p.x; arr[n * 3 + 1] = p.y; arr[n * 3 + 2] = p.z;
      const gy = this.groundY(p.x, p.z);
      if (n > 0 && p.y <= gy + 0.02) { this.point.set(p.x, gy, p.z); this.valid = this.isValid(this.point); n++; break; }
      v.y -= 9.8 * 0.03; p.addScaledVector(v, 0.03);
    }
    this.geo.setDrawRange(0, n); this.geo.attributes.position.needsUpdate = true;
    this.line.visible = true;
    this.marker.visible = this.valid; this.marker.position.copy(this.point).y += 0.03;
    this.line.material.color.setHex(this.valid ? 0x7fd8ff : 0xff5a4a);
  }
}

// ── Stick locomotion: smooth move (off hand) + snap turn (main hand) ─
export class Locomotion {
  constructor({ speed = 2.5, snapDeg = 30, smoothTurn = false } = {}) {
    this.speed = speed; this.snapDeg = snapDeg; this.smoothTurn = smoothTurn; this._snapReady = true;
  }
  // Returns the horizontal displacement applied (so games can collide/undo).
  update(dt, input, rig, { move = true, turn = true } = {}) {
    const d = new THREE.Vector3();
    if (move && input.off.present) {
      const [x, y] = input.off.axes;
      if (Math.hypot(x, y) > 0.15) {
        const fwd = input.head.fwd.clone(); fwd.y = 0; fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        d.addScaledVector(fwd, -y * this.speed * dt).addScaledVector(right, x * this.speed * dt);
        rig.position.add(d);
      }
    }
    if (turn && input.main.present && !input.desktop) {
      const x = input.main.axes[0];
      if (this.smoothTurn) { if (Math.abs(x) > 0.2) rotateRigAround(rig, input.head.pos, -x * 2.5 * dt); }
      else {
        if (Math.abs(x) > 0.6 && this._snapReady) { rotateRigAround(rig, input.head.pos, -Math.sign(x) * THREE.MathUtils.degToRad(this.snapDeg)); this._snapReady = false; }
        if (Math.abs(x) < 0.3) this._snapReady = true;
      }
    }
    return d;
  }
}

export function rotateRigAround(rig, headPos, angle) {
  const off = rig.position.clone().sub(headPos); off.y = 0;
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
  rig.position.set(headPos.x + off.x, rig.position.y, headPos.z + off.z);
  rig.rotateY(angle);
}

// ── Tiny synth for one-shot sounds ───────────────────────────
// const sfx = new Sfx(ctx.audio); sfx.tone({ freq: 440, dur: 0.2 }); sfx.noise({ freq: 2000, dur: 0.1, pos })
export class Sfx {
  constructor(audio) { this.audio = audio; this._noise = null; }
  get ctx() { return this.audio.ctx; }
  _out(pos, gain = 1) {
    const ctx = this.ctx, g = ctx.createGain(); g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 1.5; p.rolloffFactor = 1;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p); p.connect(this.audio.out);
    } else g.connect(this.audio.out);
    return g;
  }
  tone({ freq = 440, freqEnd = null, dur = 0.2, type = 'sine', gain = 0.2, attack = 0.005, delay = 0, pos = null } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g).connect(this._out(pos)); o.start(t); o.stop(t + attack + dur + 0.05);
  }
  noise({ freq = 1000, q = 1, type = 'bandpass', dur = 0.15, gain = 0.3, attack = 0.002, delay = 0, pos = null, freqEnd = null } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    if (!this._noise) { const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this._noise = b; }
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this._noise; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    s.connect(f).connect(g).connect(this._out(pos)); s.start(t, Math.random()); s.stop(t + attack + dur + 0.05);
  }
}

// Free GPU resources of an object tree.
export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value?.isTexture) u.value.dispose();
      m.dispose?.();
    }
  });
}
