import * as THREE from 'three';

// Camera-facing additive glow quads, one draw call per batch.
// Fill with set(i, x, y, z, r, g, b, size) each frame, then commit(count).
export class GlowBatch {
  constructor(capacity, { core = 1.0, halo = 0.6, renderOrder = 5 } = {}) {
    this.capacity = capacity;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.center = new Float32Array(capacity * 3);
    this.color = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.aCenter = new THREE.InstancedBufferAttribute(this.center, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iCenter', this.aCenter); g.setAttribute('iColor', this.aColor); g.setAttribute('iSize', this.aSize);
    g.instanceCount = 0;
    this.geometry = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: core }, uHalo: { value: halo } },
      vertexShader: /* glsl */`
        attribute vec3 iCenter; attribute vec3 iColor; attribute float iSize;
        varying vec3 vColor; varying vec2 vUv;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iCenter, 1.0);
          mv.xy += position.xy * iSize;
          vUv = position.xy; vColor = iColor;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uCore; uniform float uHalo;
        varying vec3 vColor; varying vec2 vUv;
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 26.0) * uCore;
          float halo = (1.0 - sqrt(r2)); halo = halo * halo * uHalo;
          vec3 c = vColor * (core * 1.8 + halo) + vec3(core * 0.55 * length(vColor));
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.n = 0;
  }
  begin() { this.n = 0; }
  push(x, y, z, r, g, b, size) {
    const i = this.n; if (i >= this.capacity) return;
    this.center[i * 3] = x; this.center[i * 3 + 1] = y; this.center[i * 3 + 2] = z;
    this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b;
    this.size[i] = size; this.n++;
  }
  commit() {
    this.geometry.instanceCount = this.n;
    this.aCenter.needsUpdate = this.aColor.needsUpdate = this.aSize.needsUpdate = true;
    this.aCenter.addUpdateRange(0, this.n * 3); this.aColor.addUpdateRange(0, this.n * 3); this.aSize.addUpdateRange(0, this.n);
  }
}

// GPU-animated decorative fireflies (no CPU per frame beyond one uniform).
export function makeAmbientFlies(count, boxes, rand) {
  const pos = new Float32Array(count * 3), ph = new Float32Array(count), col = new Float32Array(count * 3);
  const tints = [[1, 0.78, 0.3], [0.65, 1, 0.45], [1, 0.9, 0.55]];
  for (let i = 0; i < count; i++) {
    const b = boxes[Math.floor(rand() * boxes.length)];
    pos[i * 3] = b[0] + (rand() - 0.5) * b[3];
    pos[i * 3 + 1] = 0.3 + rand() * b[4];
    pos[i * 3 + 2] = b[2] + (rand() - 0.5) * b[5];
    ph[i] = rand() * 100;
    const t = tints[i % 3]; col[i * 3] = t[0]; col[i * 3 + 1] = t[1]; col[i * 3 + 2] = t[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uBright: { value: 0.6 } },
    vertexShader: /* glsl */`
      attribute float aPhase; attribute vec3 aColor;
      uniform float uTime; uniform float uScale; uniform float uBright;
      varying vec3 vColor; varying float vA;
      void main() {
        float t = uTime;
        vec3 p = position + vec3(sin(t * 0.21 + aPhase) * 0.9 + sin(t * 0.07 + aPhase * 3.1) * 1.4,
                                 sin(t * 0.33 + aPhase * 2.0) * 0.35,
                                 cos(t * 0.17 + aPhase) * 0.9 + cos(t * 0.05 + aPhase * 1.7) * 1.4);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float blink = pow(max(0.0, sin(t * (0.6 + fract(aPhase) * 0.9) + aPhase * 7.0)), 3.0);
        vA = blink * uBright;
        vColor = aColor;
        gl_PointSize = clamp(0.05 * uScale / -mv.z, 1.0, 24.0) * (0.4 + blink);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vColor; varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d) * 4.0;
        if (r2 > 1.0) discard;
        float a = exp(-r2 * 5.0) * vA;
        gl_FragColor = vec4(vColor * a * 1.6, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = 4;
  return pts;
}

export function makeStars(count, rand) {
  const pos = new Float32Array(count * 3), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = rand(), v = 0.12 + rand() * 0.88;
    const th = u * Math.PI * 2, y = v, r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(th) * r * 300; pos[i * 3 + 1] = y * 300; pos[i * 3 + 2] = Math.sin(th) * r * 300;
    ph[i] = rand() * 50;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aPhase; uniform float uTime; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vA = (0.55 + 0.45 * sin(uTime * (0.8 + fract(aPhase)) + aPhase)) * smoothstep(20.0, 120.0, position.y);
        gl_PointSize = 1.0 + fract(aPhase * 7.3) * 1.8;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main() { gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vA, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.renderOrder = -5;
  return pts;
}
