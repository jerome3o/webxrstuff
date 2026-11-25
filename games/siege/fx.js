import * as THREE from 'three';

// Pooled instanced particles (ink puffs, sparks) and ground rings, all in board-local space.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

export class FX {
  constructor(parent) {
    this.NP = 600; this.NR = 32;
    this.p = []; for (let i = 0; i < this.NP; i++) this.p.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.1, s1: 0, g: 0, drag: 0, kind: 0, r: 1, gC: 1, b: 1, rot: 0 });
    this.r = []; for (let i = 0; i < this.NR; i++) this.r.push({ life: 0, max: 1, x: 0, y: 0, z: 0, r0: 0, r1: 1, cr: 1, cg: 1, cb: 1 });
    this.pi = 0; this.ri = 0;
    this.puff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), this.NP);
    this.spark = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), this.NP);
    const rg = new THREE.RingGeometry(0.88, 1, 40); rg.rotateX(-Math.PI / 2);
    this.ring = new THREE.InstancedMesh(rg, new THREE.MeshBasicMaterial({ toneMapped: false, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide }), this.NR);
    for (const m of [this.puff, this.spark, this.ring]) {
      m.frustumCulled = false; m.count = 0;
      m.setColorAt(0, _c.set(0xffffff)); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      parent.add(m);
    }
    this.spark.renderOrder = 5; this.ring.renderOrder = 4;
  }
  // kind 0 = puff (lit, shrinks), 1 = spark (additive, fades)
  emit(kind, x, y, z, vx, vy, vz, life, s0, s1, color, g = 0, drag = 0) {
    const p = this.p[this.pi]; this.pi = (this.pi + 1) % this.NP;
    p.kind = kind; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.s0 = s0; p.s1 = s1; p.g = g; p.drag = drag;
    _c.set(color); p.r = _c.r; p.gC = _c.g; p.b = _c.b; p.rot = Math.random() * 6;
  }
  burst(kind, x, y, z, n, speed, life, s0, s1, color, g = 0, up = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.6);
      this.emit(kind, x, y, z, Math.cos(a) * r * sp, u * sp + up, Math.sin(a) * r * sp, life * (0.6 + Math.random() * 0.4), s0, s1, color, g, 2);
    }
  }
  inkPuff(x, y, z, size = 1) {
    this.burst(0, x, y + 0.15 * size, z, Math.round(7 + 5 * size), 1.3 * size, 0.55, 0.11 * size, 0.0, 0x1c1b24, -0.5, 0.4);
    this.burst(0, x, y + 0.15 * size, z, 4, 0.8 * size, 0.7, 0.08 * size, 0.0, 0x4a4660, -0.3, 0.6);
    this.burst(1, x, y + 0.2, z, 4, 1.2, 0.5, 0.05, 0.0, 0xfff2c0, -2, 0.8);
  }
  firework(x, y, z, colorA, colorB, scale = 1) {
    this.burst(1, x, y, z, 22, 2.6 * scale, 0.7, 0.06, 0.01, colorA, -2.5);
    this.burst(1, x, y, z, 12, 1.6 * scale, 0.9, 0.05, 0.01, colorB, -2.0);
    this.burst(0, x, y, z, 5, 0.6, 0.5, 0.12 * scale, 0, 0x8a8a8a, 0.3);
  }
  addRing(x, y, z, r0, r1, life, color) {
    const r = this.r[this.ri]; this.ri = (this.ri + 1) % this.NR;
    r.x = x; r.y = y; r.z = z; r.r0 = r0; r.r1 = r1; r.life = life; r.max = life;
    _c.set(color); r.cr = _c.r; r.cg = _c.g; r.cb = _c.b;
  }
  clear() { for (const p of this.p) p.life = 0; for (const r of this.r) r.life = 0; }
  update(dt) {
    let np = 0, ns = 0, nr = 0;
    for (let i = 0; i < this.NP; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const u = p.life / p.max;
      const s = p.s1 + (p.s0 - p.s1) * (p.kind === 0 ? Math.sin(Math.min(1, u * 1.4) * Math.PI / 2) : u);
      _p.set(p.x, p.y, p.z); _s.setScalar(Math.max(0.0001, s));
      p.rot += dt * 3; _e.set(p.rot, p.rot * 0.7, 0); _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      if (p.kind === 0) { this.puff.setMatrixAt(np, _m); this.puff.setColorAt(np, _c.setRGB(p.r, p.gC, p.b)); np++; }
      else { const f = Math.min(1, u * 1.5); this.spark.setMatrixAt(ns, _m); this.spark.setColorAt(ns, _c.setRGB(p.r * f, p.gC * f, p.b * f)); ns++; }
    }
    for (let i = 0; i < this.NR; i++) {
      const r = this.r[i];
      if (r.life <= 0) continue;
      r.life -= dt; if (r.life <= 0) continue;
      const u = 1 - r.life / r.max, rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - u) * (1 - u));
      _p.set(r.x, r.y, r.z); _q.identity(); _s.set(rad, 1, rad);
      _m.compose(_p, _q, _s); this.ring.setMatrixAt(nr, _m);
      const f = (1 - u) * 0.9; this.ring.setColorAt(nr, _c.setRGB(r.cr * f, r.cg * f, r.cb * f)); nr++;
    }
    this.puff.count = np; this.spark.count = ns; this.ring.count = nr;
    for (const m of [this.puff, this.spark, this.ring]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
