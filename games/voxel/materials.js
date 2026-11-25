import * as THREE from 'three';
import { BLOCKS, faceTile } from './blocks.js';

// Shader materials for chunk meshes (see mesher.js for the vertex format).
// All chunk materials share one uniforms object, so day/night, fog and time are one write per frame.

const VERT = /* glsl */`
precision highp sampler2DArray;
in vec4 data;
uniform float uTime;
uniform float uDaylight;
uniform vec3 uSkyLight;
uniform vec3 uBlockLight;
uniform float uItemLight;
uniform vec3 uSunDir;
uniform float uSunAmt;
out vec2 vUv;
out float vLayer;
out vec3 vLight;
out float vDist;
float curve(float l) { return pow(0.8, 15.0 * (1.0 - l)); }
void main() {
  vec3 p = position * 0.0625;
  float f = data.y;
  float face = mod(f, 8.0);
  float ao = mod(floor(f / 8.0), 4.0);
  float flags = floor(f / 32.0);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  if (flags > 0.5) {
    float amp = flags < 1.5 ? 0.025 : (flags > 2.5 ? 0.09 : 0.0);
    wp.x += sin(uTime * 1.6 + wp.x * 0.7 + wp.z * 0.4) * amp;
    wp.z += cos(uTime * 1.3 + wp.z * 0.6 + wp.y * 0.3) * amp;
  }
  vUv = uv * 0.0625;
  vLayer = data.x;
  float sky = curve(data.z / 255.0) * uItemLight;
  float blk = curve(data.w / 255.0);
  vec3 L = max(uSkyLight * sky * uDaylight, uBlockLight * blk) + vec3(0.025, 0.022, 0.035);
  vec3 N = face < 0.5 ? vec3(1.0, 0.0, 0.0) : face < 1.5 ? vec3(-1.0, 0.0, 0.0) : face < 2.5 ? vec3(0.0, 1.0, 0.0) : face < 3.5 ? vec3(0.0, -1.0, 0.0) : face < 4.5 ? vec3(0.0, 0.0, 1.0) : face < 5.5 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
  float base = face < 1.5 ? 0.7 : face < 2.5 ? 0.8 : face < 3.5 ? 0.5 : face < 5.5 ? 0.6 : 0.78;
  float sunT = max(dot(N, uSunDir), 0.0) * uSunAmt * smoothstep(0.55, 0.95, data.z / 255.0);
  vec3 tint = vec3(0.93, 0.96, 1.06) * base + vec3(1.0, 0.9, 0.74) * sunT;
  float shade = 1.0;
  float a = ao / 3.0;
  vec3 aoCol = mix(vec3(0.36, 0.33, 0.48), vec3(1.0), a * 0.85 + 0.15 * a * a);
  vLight = L * shade * tint * aoCol;
  vec4 mv = viewMatrix * wp;
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uOpacity;
in vec2 vUv;
in float vLayer;
in vec3 vLight;
in float vDist;
void main() {
  vec2 uv = vUv;
#ifdef WATER
  uv += vec2(uTime * 0.015, sin(uTime * 0.6 + vUv.x * 6.0) * 0.02);
#endif
  vec4 t = texture(uAtlas, vec3(uv, floor(vLayer + 0.5)));
#ifndef WATER
  if (t.a < 0.5) discard;
#endif
  vec3 c = t.rgb * vLight;
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  c = mix(c, uFogColor, fog);
#ifdef WATER
  gl_FragColor = vec4(c, mix(uOpacity, 1.0, fog * 0.6));
#else
  gl_FragColor = vec4(c, 1.0);
#endif
  #include <colorspace_fragment>
}`;

export function createChunkMaterials(atlas) {
  const uniforms = {
    uAtlas: { value: atlas },
    uTime: { value: 0 },
    uDaylight: { value: 1 },
    uSkyLight: { value: new THREE.Color(1, 1, 1) },
    uBlockLight: { value: new THREE.Color(1.12, 0.78, 0.48) },
    uFogColor: { value: new THREE.Color(0.8, 0.85, 0.95) },
    uFogNear: { value: 40 },
    uFogFar: { value: 90 },
    uItemLight: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunAmt: { value: 0.3 },
    uOpacity: { value: 0.72 },
  };
  const opaque = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false });
  const water = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false,
    defines: { WATER: 1 }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  // per-object lit copy for items / held blocks: own uItemLight, rest shared
  const itemUniforms = { ...uniforms, uItemLight: { value: 1 } };
  const item = new THREE.ShaderMaterial({ uniforms: itemUniforms, vertexShader: VERT, fragmentShader: FRAG, toneMapped: false });
  return { uniforms, opaque, water, item };
}

// One shared index buffer: quad q uses vertices 4q..4q+3 as (0,1,2)(0,2,3).
export function makeQuadIndex(maxQuads) {
  const idx = new Uint32Array(maxQuads * 6);
  for (let q = 0, i = 0; q < maxQuads; q++) { const v = q * 4; idx[i++] = v; idx[i++] = v + 1; idx[i++] = v + 2; idx[i++] = v; idx[i++] = v + 2; idx[i++] = v + 3; }
  return new THREE.BufferAttribute(idx, 1);
}

export function geometryFromArrays(arr, index, bounds) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr.pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(arr.uv, 2));
  g.setAttribute('data', new THREE.BufferAttribute(arr.dat, 4));
  g.setIndex(index);
  g.setDrawRange(0, arr.quads * 6);
  g.boundingSphere = bounds.sphere; g.boundingBox = bounds.box;
  return g;
}

// A small standalone block model (unit cube, or crossed planes for plants), in the chunk vertex
// format. Positions are 0..1 so wrap it in a Group offset by -0.5 to centre. Cached per block id.
const FACE_CORNERS = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];
function faceUV(f, c) {
  switch (f) {
    case 0: return [1 - c[2], c[1]]; case 1: return [c[2], c[1]];
    case 2: case 3: return [c[0], c[2]]; case 4: return [c[0], c[1]]; default: return [1 - c[0], c[1]];
  }
}
const blockGeoCache = new Map();
export function blockGeometry(id, tileLayer, index) {
  if (blockGeoCache.has(id)) return blockGeoCache.get(id);
  const d = BLOCKS[id];
  const pos = [], uv = [], dat = [];
  if (d.render === 'cross') {
    const L = tileLayer(faceTile(d, 0));
    const quads = [[[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]], [[0, 0, 0], [0, 1, 0], [1, 1, 1], [1, 0, 1]], [[0, 0, 1], [1, 0, 0], [1, 1, 0], [0, 1, 1]], [[0, 0, 1], [0, 1, 1], [1, 1, 0], [1, 0, 0]]];
    for (const q of quads) for (const c of q) {
      pos.push(c[0] * 16, c[1] * 16, c[2] * 16);
      uv.push(c[0] * 16, c[1] * 16); dat.push(L, 6 | (3 << 3), 255, 0);
    }
  } else {
    for (let f = 0; f < 6; f++) {
      const L = tileLayer(faceTile(d, f));
      for (const c of FACE_CORNERS[f]) {
        pos.push(c[0] * 16, c[1] * 16, c[2] * 16);
        const t = faceUV(f, c); uv.push(t[0] * 16, t[1] * 16);
        dat.push(L, f | (3 << 3), 255, 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Uint16Array(pos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Uint8Array(uv), 2));
  g.setAttribute('data', new THREE.BufferAttribute(new Uint8Array(dat), 4));
  g.setIndex(index);
  g.setDrawRange(0, (pos.length / 12) * 6);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0.5), 0.9); // real units (shader scales by 1/16)
  g.userData.shared = true;
  blockGeoCache.set(id, g);
  return g;
}
export function clearBlockGeometryCache() { for (const g of blockGeoCache.values()) g.dispose(); blockGeoCache.clear(); }
