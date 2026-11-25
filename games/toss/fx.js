import * as THREE from 'three';
import { dotTexture } from './env.js';

// Pooled additive particle system (one draw call per instance).
export class Particles {
  constructor(scene, { count = 600, size = 0.06, tex = null, opacity = 1 } = {}) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.twinkle = new Uint8Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -100;
    const g = new THREE.BufferGeometry();
    this.pAttr = new THREE.BufferAttribute(this.pos, 3); this.pAttr.setUsage(THREE.DynamicDrawUsage);
    this.cAttr = new THREE.BufferAttribute(this.col, 3); this.cAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pAttr); g.setAttribute('color', this.cAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -8), 60);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size, map: tex ?? dotTexture(), vertexColors: true, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0; this.alive = 0;
  }
  emit(x, y, z, vx, vy, vz, life, r, g, b, grav = -9.8, drag = 0, twinkle = 0) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    const o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz;
    this.base[o] = r; this.base[o + 1] = g; this.base[o + 2] = b;
    this.life[i] = life; this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.twinkle[i] = twinkle;
  }
  update(dt) {
    const P = this.pos, V = this.vel, C = this.col, B = this.base;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      if (this.life[i] <= 0) { if (C[o] !== 0 || C[o + 1] !== 0) { C[o] = C[o + 1] = C[o + 2] = 0; P[o + 1] = -100; } continue; }
      alive++;
      this.life[i] -= dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      V[o] *= d; V[o + 1] = V[o + 1] * d + this.grav[i] * dt; V[o + 2] *= d;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      let f = k < 0.5 ? k * 2 : 1;
      if (this.twinkle[i] && k < 0.6) f *= Math.random() < 0.5 ? 0.2 : 1.2;
      const fadeIn = Math.min(1, (this.max[i] - this.life[i]) * 6);
      f *= fadeIn;
      C[o] = B[o] * f; C[o + 1] = B[o + 1] * f; C[o + 2] = B[o + 2] * f;
    }
    this.alive = alive;
    this.points.visible = alive > 0;
    this.pAttr.needsUpdate = true; this.cAttr.needsUpdate = true;
  }
}

const PALETTES = [[1, 0.35, 0.2], [1, 0.8, 0.3], [0.4, 0.9, 1], [1, 0.4, 0.8], [0.5, 1, 0.5], [1, 1, 0.9]];

export class Fireworks {
  constructor(scene, sounds) {
    this.sparks = new Particles(scene, { count: 900, size: 0.09 });
    this.sounds = sounds;
    this.rockets = []; for (let i = 0; i < 12; i++) this.rockets.push({ on: false, x: 0, y: 0, z: 0, vy: 0, t: 0, c: 0 });
  }
  launch(x, y, z, count = 3) {
    let k = 0;
    for (const r of this.rockets) {
      if (r.on) continue;
      r.on = true; r.x = x + (Math.random() - 0.5) * 1.5; r.y = y; r.z = z + (Math.random() - 0.5) * 1.5;
      r.vy = 7 + Math.random() * 3; r.t = 0.45 + Math.random() * 0.35 + k * 0.25; r.c = (Math.random() * PALETTES.length) | 0;
      if (++k >= count) break;
    }
    this.sounds?.firecrackers({ x, y, z }, 10 + count * 3);
  }
  confetti(x, y, z, n = 30, color = null) {
    for (let i = 0; i < n; i++) {
      const c = color ?? PALETTES[(Math.random() * PALETTES.length) | 0];
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = 1 + Math.random() * 2.5, q = Math.sqrt(1 - u * u);
      this.sparks.emit(x, y, z, Math.cos(a) * q * s, u * s + 1, Math.sin(a) * q * s, 0.5 + Math.random() * 0.6, c[0], c[1], c[2], -6, 2);
    }
  }
  update(dt) {
    for (const r of this.rockets) {
      if (!r.on) continue;
      r.t -= dt; r.y += r.vy * dt; r.vy -= 4 * dt;
      this.sparks.emit(r.x, r.y, r.z, (Math.random() - 0.5) * 0.3, -0.5, (Math.random() - 0.5) * 0.3, 0.35, 1, 0.6, 0.25, -2, 1);
      if (r.t <= 0) {
        r.on = false;
        const c = PALETTES[r.c], c2 = PALETTES[(r.c + 2) % PALETTES.length];
        for (let i = 0; i < 90; i++) {
          const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, q = Math.sqrt(1 - u * u), s = 3.2 + Math.random() * 0.8;
          const cc = i % 3 === 0 ? c2 : c;
          this.sparks.emit(r.x, r.y, r.z, Math.cos(a) * q * s, u * s, Math.sin(a) * q * s, 1.1 + Math.random() * 0.7, cc[0], cc[1], cc[2], -2.2, 1.6, 1);
        }
        this.sounds?.sfx.noise({ freq: 300, q: 0.5, type: 'lowpass', dur: 0.4, gain: 0.35, pos: { x: r.x, y: r.y, z: r.z } });
      }
    }
    this.sparks.update(dt);
  }
}

export class Steam {
  constructor(scene, emitters) {
    this.p = new Particles(scene, { count: 220, size: 0.45, opacity: 0.55 });
    this.emitters = emitters; this.acc = 0;
  }
  update(dt) {
    this.acc += dt * 9 * this.emitters.length;
    while (this.acc >= 1) {
      this.acc -= 1;
      const e = this.emitters[(Math.random() * this.emitters.length) | 0];
      const s = 0.06 + Math.random() * 0.05;
      this.p.emit(e.x + (Math.random() - 0.5) * 0.25, e.y, e.z + (Math.random() - 0.5) * 0.25,
        (Math.random() - 0.5) * 0.1, 0.3 + Math.random() * 0.2, (Math.random() - 0.5) * 0.1, 2.2 + Math.random(), s, s * 0.95, s * 0.9, 0.05, 0.3);
    }
    this.p.update(dt);
  }
}
