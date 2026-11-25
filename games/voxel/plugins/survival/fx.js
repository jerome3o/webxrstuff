import * as THREE from 'three';
import { BLOCKS } from '../../blocks.js';

// Pooled cube particles for survival effects (crumbs, poofs, smoke, sparks, bubbles): one draw call.
const MAX = 160;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();

export class Fx {
  constructor(game) {
    this.game = game;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(1, 1, 1));
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    game.scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < MAX; i++) this.p.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 0.1, grav: 0, drag: 0, col: new THREE.Color(), spin: 0, grow: 0, collide: false });
    this.next = 0;
  }
  // emit n particles. o: { color (hex|Color), spread, speed, up, life, size, grav, drag, grow, collide, colors? }
  burst(pos, n, o = {}) {
    for (let i = 0; i < n; i++) {
      let q = null;
      for (let k = 0; k < MAX; k++) { const c = this.p[(this.next + k) % MAX]; if (c.life <= 0) { q = c; this.next = (this.next + k + 1) % MAX; break; } }
      if (!q) { q = this.p[this.next]; this.next = (this.next + 1) % MAX; }
      const sp = o.spread ?? 0.15, v = o.speed ?? 1.5;
      q.pos.set(pos.x + (Math.random() - 0.5) * sp * 2, pos.y + (Math.random() - 0.5) * sp * 2, pos.z + (Math.random() - 0.5) * sp * 2);
      q.vel.set((Math.random() - 0.5) * 2 * v, (o.up ?? 1) * (0.4 + Math.random()) * v, (Math.random() - 0.5) * 2 * v);
      if (o.dir) q.vel.addScaledVector(o.dir, 1);
      q.max = q.life = (o.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      q.size = (o.size ?? 0.07) * (0.7 + Math.random() * 0.6);
      q.grav = o.grav ?? 9; q.drag = o.drag ?? 1.5; q.grow = o.grow ?? 0; q.collide = !!o.collide;
      const cols = o.colors;
      q.col.set(cols ? cols[(Math.random() * cols.length) | 0] : (o.color ?? 0xffffff));
      q.spin = Math.random() * 6;
    }
  }
  update(dt) {
    let n = 0;
    const w = this.game.world;
    for (let i = 0; i < MAX; i++) {
      const q = this.p[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      q.vel.y -= q.grav * dt;
      const k = Math.exp(-q.drag * dt); q.vel.x *= k; q.vel.z *= k; if (q.grav <= 0) q.vel.y *= k;
      q.pos.addScaledVector(q.vel, dt);
      if (q.collide && q.vel.y < 0) {
        const id = w.getBlock(Math.floor(q.pos.x), Math.floor(q.pos.y), Math.floor(q.pos.z));
        if (id < 0 || BLOCKS[id]?.solid) { q.pos.y = Math.floor(q.pos.y) + 1.01; q.vel.set(q.vel.x * 0.3, 0, q.vel.z * 0.3); }
      }
      const f = q.life / q.max;
      const s = q.size * (q.grow ? (1 + (1 - f) * q.grow) : Math.min(1, f * 3));
      q.spin += dt * 3;
      _q.setFromEuler(_e.set(q.spin, q.spin * 0.7, 0));
      _m.compose(q.pos, _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(n, _m); this.mesh.setColorAt(n, q.col); n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) { this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true; }
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
