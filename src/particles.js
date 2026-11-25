import * as THREE from 'three';
import { rand } from './util.js';

// A single pooled point cloud per blend mode. Fixed capacity, ring-buffer allocation,
// everything simulated on the CPU (it's cheap at a few thousand points).

const VS = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(0.05, -mv.z);
  }`;
const FS = /* glsl */`
  varying float vAlpha;
  varying vec3 vColor;
  uniform float uSoft;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float a = mix(step(r, 1.0), 1.0 - smoothstep(0.0, 1.0, r), uSoft);
    if (a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }`;

export class ParticleSystem {
  constructor(scene, capacity, { additive = true, soft = 1 } = {}) {
    this.cap = capacity;
    this.next = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.s0 = new Float32Array(capacity);
    this.s1 = new Float32Array(capacity);
    this.flicker = new Uint8Array(capacity);
    this.alive = 0;

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS,
      uniforms: { uScale: { value: 500 }, uSoft: { value: soft } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  setViewportHeight(h) { this.material.uniforms.uScale.value = h * 0.5; }

  emit(o) {
    const n = o.count ?? 1;
    const c = new THREE.Color(o.color ?? 0xffffff);
    const c2 = o.color2 !== undefined ? new THREE.Color(o.color2) : null;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.cap;
      const p = o.pos;
      const sp = o.spread ?? 0;
      this.pos[i * 3] = p.x + rand(-sp, sp); this.pos[i * 3 + 1] = p.y + rand(-sp, sp); this.pos[i * 3 + 2] = p.z + rand(-sp, sp);
      // Velocity: base + random direction scaled by speed
      let vx = 0, vy = 0, vz = 0;
      const speed = o.speed ?? 0;
      if (speed) {
        let x, y, z, l;
        do { x = rand(-1, 1); y = rand(-1, 1); z = rand(-1, 1); l = x * x + y * y + z * z; } while (l > 1 || l < 0.01);
        l = Math.sqrt(l);
        const s = speed * (o.shell ? 1 : rand(0.3, 1));
        vx = x / l * s; vy = y / l * s; vz = z / l * s;
      }
      if (o.vel) { vx += o.vel.x; vy += o.vel.y; vz += o.vel.z; }
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      const life = (o.life ?? 1) * rand(0.7, 1.3);
      this.life[i] = life; this.maxLife[i] = life;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0.5;
      this.s0[i] = (o.size ?? 0.1) * rand(0.7, 1.3);
      this.s1[i] = o.sizeEnd ?? this.s0[i] * 0.2;
      this.flicker[i] = o.flicker ? 1 : 0;
      const cc = c2 && Math.random() < 0.5 ? c2 : c;
      this.col[i * 3] = cc.r; this.col[i * 3 + 1] = cc.g; this.col[i * 3 + 2] = cc.b;
      this.alpha[i] = 1;
      this.size[i] = this.s0[i];
    }
  }

  update(dt) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; } continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= d; V[i * 3 + 1] = V[i * 3 + 1] * d + this.grav[i] * dt; V[i * 3 + 2] *= d;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      let a = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      if (this.flicker[i]) a *= 0.5 + 0.5 * Math.random();
      this.alpha[i] = Math.max(0, a);
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }
}

// High-level effects built on two systems: glow (additive) and matter (normal-blended).
export class FX {
  constructor(scene, capacity) {
    this.glow = new ParticleSystem(scene, capacity, { additive: true });
    this.matter = new ParticleSystem(scene, Math.floor(capacity * 0.6), { additive: false, soft: 0.25 });
  }
  setViewportHeight(h) { this.glow.setViewportHeight(h); this.matter.setViewportHeight(h); }
  update(dt) { this.glow.update(dt); this.matter.update(dt); }

  sparks(pos, color = 0xffc860, n = 20, speed = 4) {
    this.glow.emit({ pos, count: n, color, color2: 0xffffff, speed, life: 0.5, size: 0.06, sizeEnd: 0.01, gravity: -6, drag: 1.5 });
  }
  dust(pos, color = 0xb09a78, n = 10) {
    this.matter.emit({ pos, count: n, color, speed: 1.2, life: 0.9, size: 0.12, sizeEnd: 0.3, gravity: -0.5, drag: 3 });
  }
  splinters(pos, color = 0xd9c79a, n = 8) {
    this.matter.emit({ pos, count: n, color, speed: 3, life: 0.6, size: 0.04, gravity: -9, drag: 1 });
  }
  paper(pos, n = 30) {
    this.matter.emit({ pos, count: n, color: 0xc81e1e, color2: 0xe8b84a, speed: 3, life: 2.2, size: 0.07, sizeEnd: 0.06, gravity: -1.2, drag: 2.5 });
    this.glow.emit({ pos, count: 25, color: 0xffa040, speed: 2, life: 0.8, size: 0.08, gravity: 1, drag: 2, flicker: true });
  }
  shards(pos, n = 40) {
    this.matter.emit({ pos, count: n, color: 0xf4f6fa, color2: 0x2a4fa0, speed: 5, life: 1.2, size: 0.05, sizeEnd: 0.04, gravity: -9.8, drag: 0.6 });
  }
  feathers(pos) { this.matter.emit({ pos, count: 25, color: 0xffffff, color2: 0x222222, speed: 2, life: 2.5, size: 0.08, sizeEnd: 0.07, gravity: -0.6, drag: 2.5 }); }
  coinBurst(pos) {
    this.glow.emit({ pos, count: 30, color: 0xffd56a, color2: 0xfff3c0, speed: 3, life: 1, size: 0.07, gravity: -3, drag: 1.2 });
  }
  explosion(pos, r = 5) {
    this.glow.emit({ pos, count: 140, color: 0xffb040, color2: 0xff5a1a, speed: r * 2.2, life: 0.7, size: 0.7, sizeEnd: 0.1, gravity: 0, drag: 3.5 });
    this.glow.emit({ pos, count: 30, color: 0xfff2c0, speed: r, life: 0.25, size: 1.6, sizeEnd: 0.4, drag: 4 });
    this.glow.emit({ pos, count: 60, color: 0xffd080, speed: r * 3, life: 1.2, size: 0.07, gravity: -9, drag: 0.8 });
    this.matter.emit({ pos, count: 50, color: 0x2a2522, color2: 0x55504a, speed: r * 0.7, life: 2.8, size: 1.2, sizeEnd: 3.0, gravity: 0.8, drag: 1.6 });
  }
  firework(pos, palette) {
    const cols = palette ?? [[0xff3030, 0xffd040], [0x40ffb0, 0xffffff], [0xffd040, 0xff7020], [0xff60d0, 0x80c0ff]][Math.floor(Math.random() * 4)];
    this.glow.emit({ pos, count: 220, color: cols[0], color2: cols[1], speed: 12, shell: true, life: 1.8, size: 0.35, sizeEnd: 0.05, gravity: -3, drag: 1.4, flicker: true });
    this.glow.emit({ pos, count: 20, color: 0xffffff, speed: 2, life: 0.3, size: 2.5, sizeEnd: 0.5 });
  }
  trail(pos, color = 0xffffff, size = 0.025, life = 0.35) {
    this.glow.emit({ pos, count: 1, color, life, size, sizeEnd: 0.0, drag: 0 });
  }
  smoke(pos, size = 0.4, vel = null) {
    this.matter.emit({ pos, count: 1, color: 0xcfc8bd, color2: 0xa9a29a, vel, life: 2.2, size, sizeEnd: size * 4, gravity: 0.35, drag: 1.0, speed: 0.2 });
  }
  flame(pos, vel = null) {
    this.glow.emit({ pos, count: 2, color: 0xffa030, color2: 0xff5010, vel, speed: 0.6, life: 0.35, size: 0.18, sizeEnd: 0.02, gravity: 1.5, drag: 2 });
  }
  muzzle(pos, dir, big = false) {
    const v = dir.clone().multiplyScalar(big ? 14 : 8);
    this.glow.emit({ pos, count: big ? 30 : 14, color: 0xfff0b0, color2: 0xff9a30, vel: v, speed: big ? 4 : 2, life: 0.12, size: big ? 0.35 : 0.18, sizeEnd: 0.02, drag: 10 });
    this.matter.emit({ pos, count: big ? 10 : 4, color: 0xd8d2c8, vel: dir.clone().multiplyScalar(2), speed: 0.6, life: 1.4, size: 0.15, sizeEnd: big ? 1.2 : 0.6, gravity: 0.3, drag: 2 });
  }
  lightning(a, b) {
    // jagged bolt as a dense line of glowing points
    const steps = Math.ceil(a.distanceTo(b) * 6);
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      p.lerpVectors(a, b, i / steps);
      p.x += rand(-0.15, 0.15); p.y += rand(-0.15, 0.15); p.z += rand(-0.15, 0.15);
      this.glow.emit({ pos: p, count: 1, color: 0xbfe0ff, life: 0.25, size: 0.12, sizeEnd: 0.02 });
    }
  }
}
