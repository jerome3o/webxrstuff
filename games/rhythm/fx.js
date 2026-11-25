import * as THREE from 'three';
import { FONTS } from '../../src/platform/kit.js';
import { makeGlowTexture, makeRingTexture } from './assets.js';

// Pooled effects. No allocations in update().

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _ax = new THREE.Vector3();

export class Sparks {
  constructor(scene, n = 600) {
    this.n = n; this.next = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -100;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.045, map: makeGlowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.active = 0;
  }
  burst(p, color, count, speed = 3, dir = null, spread = 1) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      let x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
      const l = Math.hypot(x, y, z) || 1, sp = speed * (0.3 + Math.random() * 0.9);
      x = x / l * spread; y = y / l * spread; z = z / l * spread;
      if (dir) { x += dir.x; y += dir.y; z += dir.z; }
      this.vel[i * 3] = x * sp; this.vel[i * 3 + 1] = y * sp + 1; this.vel[i * 3 + 2] = z * sp;
      this.max[i] = this.life[i] = 0.35 + Math.random() * 0.5;
      const w = Math.random() < 0.3 ? 1 : 0;
      this.base[i * 3] = color.r + w * 0.6; this.base[i * 3 + 1] = color.g + w * 0.6; this.base[i * 3 + 2] = color.b + w * 0.6;
    }
    this.active = 1;
  }
  update(dt) {
    if (!this.active) return;
    let any = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = 1;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) { this.pos[i3 + 1] = -100; this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0; continue; }
      this.vel[i3 + 1] -= 6 * dt;
      const drag = 1 - 2.5 * dt;
      this.vel[i3] *= drag; this.vel[i3 + 1] *= drag; this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = this.life[i] / this.max[i];
      this.col[i3] = this.base[i3] * f; this.col[i3 + 1] = this.base[i3 + 1] * f; this.col[i3 + 2] = this.base[i3 + 2] * f;
    }
    this.active = any;
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
  clear() { this.life.fill(0); this.col.fill(0); for (let i = 0; i < this.n; i++) this.pos[i * 3 + 1] = -100; this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = true; }
}

// Lantern halves: InstancedMesh with simple rigid-body motion.
export class Halves {
  constructor(scene, geo, material, n = 64) {
    this.mesh = new THREE.InstancedMesh(geo, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < n; i++) this.items.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), ax: new THREE.Vector3(), w: 0, life: 0, col: new THREE.Color() });
  }
  // Spawn two halves of a lantern at p, split by the plane through p with normal n (in XY), rolled by angle.
  split(p, roll, n, color, push) {
    for (let s = 0; s < 2; s++) {
      const it = this.items.find(x => !x.on); if (!it) return;
      it.on = true; it.life = 1.6;
      it.p.copy(p);
      // half geometry lies on +X; rotate so +X points along +n (s=0) or -n (s=1)
      it.q.setFromAxisAngle(_ax.set(0, 0, 1), roll + (s ? Math.PI : 0));
      const sg = s ? -1 : 1;
      _v.copy(push); if (_v.lengthSq() > 9) _v.setLength(3);
      it.v.set(n.x * sg * 1.6, n.y * sg * 1.6 + 1.0, 0.6).addScaledVector(_v, 0.3);
      it.ax.set(n.y * sg, -n.x * sg, (Math.random() - 0.5)).normalize();
      it.w = 5 + Math.random() * 4;
      it.col.copy(color);
    }
  }
  update(dt, waterY) {
    let k = 0;
    for (const it of this.items) {
      if (!it.on) continue;
      it.life -= dt;
      if (it.life <= 0) { it.on = false; continue; }
      it.v.y -= 9.8 * dt;
      it.p.addScaledVector(it.v, dt);
      if (it.p.z > -0.35) it.life = Math.min(it.life, 0.12); // never fly through the player's face
      if (it.p.y < waterY) { it.p.y = waterY; it.v.multiplyScalar(0.3); it.v.y = 0; it.w *= 0.9; it.life = Math.min(it.life, 0.5); }
      _q.setFromAxisAngle(it.ax, it.w * dt); it.q.premultiply(_q);
      const sc = Math.min(1, it.life / 0.4);
      _s.setScalar(sc);
      _m.compose(it.p, it.q, _s);
      this.mesh.setMatrixAt(k, _m); this.mesh.setColorAt(k, it.col); k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { for (const it of this.items) it.on = false; this.mesh.count = 0; }
}

// Expanding light rings at cut points (instanced, additive; fade via instance colour).
export class Rings {
  constructor(scene, n = 12) {
    const mat = new THREE.MeshBasicMaterial({ map: makeRingTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.setColorAt(0, _c.set(0, 0, 0));
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < n; i++) this.items.push({ on: false, p: new THREE.Vector3(), t: 0, col: new THREE.Color(), size: 1 });
    this.next = 0;
  }
  spawn(p, color, size = 1) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    it.on = true; it.p.copy(p); it.t = 0; it.col.copy(color); it.size = size;
  }
  update(dt) {
    let k = 0;
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt;
      if (it.t > 0.35) { it.on = false; continue; }
      const f = it.t / 0.35;
      _s.setScalar((0.2 + f * 0.9) * it.size);
      _q.identity();
      _m.compose(it.p, _q, _s);
      this.mesh.setMatrixAt(k, _m);
      _c.copy(it.col).multiplyScalar((1 - f) * 1.5);
      this.mesh.setColorAt(k, _c); k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// Floating score popups: a few sprites with their own small canvas, redrawn only when spawned.
export class Popups {
  constructor(scene, n = 8) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 96;
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
      s.scale.set(0.42, 0.16, 1); s.visible = false; scene.add(s);
      this.items.push({ s, c, tex, t: 0, on: false });
    }
    this.next = 0;
  }
  spawn(p, text, color, sub = '') {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    const x = it.c.getContext('2d');
    x.clearRect(0, 0, 256, 96);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `64px ${FONTS.brush}`; x.lineWidth = 6; x.strokeStyle = 'rgba(10,5,15,0.85)';
    x.strokeText(text, 128, sub ? 40 : 50); x.fillStyle = color; x.fillText(text, 128, sub ? 40 : 50);
    if (sub) { x.font = `600 22px ${FONTS.sans}`; x.fillStyle = '#f1e6cf'; x.fillText(sub, 128, 82); }
    it.tex.needsUpdate = true;
    it.s.position.copy(p); it.s.visible = true; it.t = 0; it.on = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt;
      it.s.position.y += dt * 0.35;
      it.s.material.opacity = Math.max(0, 1 - Math.max(0, it.t - 0.4) / 0.4);
      if (it.t > 0.8) { it.on = false; it.s.visible = false; }
    }
  }
  clear() { for (const it of this.items) { it.on = false; it.s.visible = false; } }
}

// Blade trail ribbon from recent base/tip samples (time-based, fades out).
export class Trail {
  constructor(scene, color, n = 14) {
    this.n = n;
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 3);
    this.base = new Float32Array(n * 3); this.tip = new Float32Array(n * 3); this.age = new Float32Array(n).fill(9);
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setIndex(idx);
    this.geo = g;
    this.color = new THREE.Color(color);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  push(b, t, dt) {
    this.base.copyWithin(3, 0, (this.n - 1) * 3); this.tip.copyWithin(3, 0, (this.n - 1) * 3); this.age.copyWithin(1, 0, this.n - 1);
    for (let i = 1; i < this.n; i++) this.age[i] += dt;
    this.base[0] = b.x; this.base[1] = b.y; this.base[2] = b.z; this.tip[0] = t.x; this.tip[1] = t.y; this.tip[2] = t.z; this.age[0] = 0;
    const span = 0.12;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, o = i * 6;
      // ribbon covers the outer 70% of the blade
      const bx = this.base[i3] + (this.tip[i3] - this.base[i3]) * 0.3, by = this.base[i3 + 1] + (this.tip[i3 + 1] - this.base[i3 + 1]) * 0.3, bz = this.base[i3 + 2] + (this.tip[i3 + 2] - this.base[i3 + 2]) * 0.3;
      this.pos[o] = bx; this.pos[o + 1] = by; this.pos[o + 2] = bz;
      this.pos[o + 3] = this.tip[i3]; this.pos[o + 4] = this.tip[i3 + 1]; this.pos[o + 5] = this.tip[i3 + 2];
      const f = Math.max(0, 1 - this.age[i] / span) * 0.8;
      this.col[o] = this.color.r * f * 0.3; this.col[o + 1] = this.color.g * f * 0.3; this.col[o + 2] = this.color.b * f * 0.3;
      this.col[o + 3] = this.color.r * f; this.col[o + 4] = this.color.g * f; this.col[o + 5] = this.color.b * f;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
  }
  reset() { this.age.fill(9); this.col.fill(0); this.geo.attributes.color.needsUpdate = true; }
}
