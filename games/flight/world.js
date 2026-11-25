import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, N, CELL, WATER_Y, VILLAGES, PERCH, mulberry, vnoise, riverDist } from './terrain.js';

// Everything static in the landscape. Draw calls: terrain, water, far range, sky, 2 tree kinds,
// houses, pagodas, perch, clouds, thermal motes, circling birds  (~12).

export const SUN_DIR = new THREE.Vector3(0.45, 0.42, -0.79).normalize();
export const FOG_HEX = 0xc4d3d8;

const lin = (c) => Math.pow(c, 2.2);
function setLin(arr, i, r, g, b) { arr[i] = lin(r); arr[i + 1] = lin(g); arr[i + 2] = lin(b); }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ── Billboard material (instanced, faces the camera without roll, fogged) ─
function billboardMaterial(map, { additive = false, opacity = 1, color = 0xffffff } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying float vTint;
      varying float vFade;
      void main() {
        vec4 c4 = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 c = c4.xyz;
        float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
        vec3 d = c - cameraPosition;
        vec3 R = cross(d, vec3(0.0, 1.0, 0.0));
        float rl = length(R);
        R = rl > 1e-4 ? R / rl : vec3(1.0, 0.0, 0.0);
        vec3 U = normalize(cross(R, d));
        vec3 wp = c + R * position.x * sx + U * position.y * sy;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vUv = uv;
        vTint = instanceMatrix[2].z; // z-scale carries a per-instance brightness
        float dist = length(d);
        vTint *= 1.0; vFade = smoothstep(0.25 * sx, 0.8 * sx, dist);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv; varying float vTint; varying float vFade;
      void main() {
        vec4 t = texture2D(map, vUv);
        gl_FragColor = vec4(t.rgb * uColor * vTint, t.a * uOpacity * vFade);
        if (gl_FragColor.a < 0.01) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Tileable detail: R = mottling for flat ground, G = vertical streaks for cliffs.
function detailTexture() {
  const W = 256, P = 16;
  const lat = (seed) => { const r = mulberry(seed), a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = r(); return a; };
  const L1 = lat(1), L2 = lat(2);
  const pn = (L, x, y, px, py) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const g = (i, j) => L[((j % py + py) % py) * P + ((i % px + px) % px)];
    const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const t = canvasTex(W, W, (c) => {
    const img = c.createImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;
      const r = 0.6 * pn(L1, u * 16, v * 16, 16, 16) + 0.4 * pn(L2, u * 8, v * 8, 8, 8);
      const g = 0.65 * pn(L2, u * 16, v * 2, 16, 2) + 0.35 * pn(L1, u * 16, v * 16, 16, 16);
      const k = (y * W + x) * 4; img.data[k] = r * 255; img.data[k + 1] = g * 255; img.data[k + 2] = 128; img.data[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
  t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// ── Terrain ─────────────────────────────────────────────────
function buildTerrain(gen) {
  const { height, terr, field, S } = gen;
  const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position.array;
  const col = new Float32Array(S * S * 3);
  const ter = new Float32Array(S * S);
  for (let k = 0; k < S * S; k++) pos[k * 3 + 1] = height[k];
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal.array;
  for (let k = 0; k < S * S; k++) {
    const x = pos[k * 3], z = pos[k * 3 + 2], h = height[k];
    const ny = nrm[k * 3 + 1];
    const steep = 1 - ny; // 0 flat .. 1 vertical
    const n1 = vnoise(x / 17, z / 17, 3), f = field[k];
    let r, g, b;
    if (h < 1.2) { r = 0.52; g = 0.5; b = 0.4; }                 // mud bank
    else {
      // valley fields: patchwork greens and gold
      const pick = f > 0.35 ? 0 : f > -0.1 ? 1 : f > -0.45 ? 2 : 3;
      const P = [[0.56, 0.6, 0.27], [0.36, 0.53, 0.24], [0.45, 0.6, 0.3], [0.3, 0.45, 0.22]][pick];
      r = P[0]; g = P[1]; b = P[2];
      // forested slopes / karst
      const forest = smooth(0.06, 0.25, steep) * (h > 14 ? 1 : 0.5);
      const fr = 0.2 + 0.05 * n1, fg = 0.34 + 0.06 * n1, fb = 0.2;
      r += (fr - r) * forest; g += (fg - g) * forest; b += (fb - b) * forest;
      // bare limestone on the cliffs
      const rock = smooth(0.42, 0.7, steep) * (0.7 + 0.3 * n1);
      const rr = 0.62 + 0.08 * n1, rg = 0.62 + 0.07 * n1, rb = 0.57 + 0.06 * n1;
      r += (rr - r) * rock; g += (rg - g) * rock; b += (rb - b) * rock;
      // high misty tops get a cooler green
      const hi = smooth(150, 320, h) * 0.4;
      r += (0.32 - r) * hi; g += (0.42 - g) * hi; b += (0.36 - b) * hi;
    }
    setLin(col, k * 3, r, g, b);
    ter[k] = terr[k];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('terr', new THREE.BufferAttribute(ter, 1));
  geo.computeBoundingSphere();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const detail = detailTexture();
  mat.userData.detail = detail;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float terr;\nvarying float vTerr;\nvarying float vWY;\nvarying vec3 vWP;\nvarying vec3 vN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerr = terr; vWY = position.y; vWP = position; vN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTerr;\nvarying float vWY;\nvarying vec3 vWP;\nvarying vec3 vN;\nuniform sampler2D tDetail;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 an = abs(vN);
          float dFlat = texture2D(tDetail, vWP.xz * 0.06).r;
          float hz = an.x > an.z ? vWP.z : vWP.x;
          float dSide = texture2D(tDetail, vec2(hz * 0.06, vWP.y * 0.016)).g;
          float det = mix(dSide, dFlat, smoothstep(0.55, 0.9, an.y));
          diffuseColor.rgb *= 0.72 + 0.56 * det;
        }
        if (vTerr > 0.01) {
          float stepIx = floor(vWY / 4.0);
          float st = fract(vWY / 4.0);
          float paddy = 1.0 - smoothstep(0.22, 0.34, st);
          float hsh = fract(sin(stepIx * 12.9898) * 43758.5453);
          vec3 pc = hsh < 0.33 ? vec3(0.30, 0.55, 0.16) : hsh < 0.66 ? vec3(0.50, 0.62, 0.22) : vec3(0.55, 0.66, 0.66);
          vec3 wall = vec3(0.20, 0.27, 0.12);
          float edge = smoothstep(0.0, 0.035, st) * (1.0 - smoothstep(0.17, 0.22, st));
          vec3 tc = mix(wall, pc * (0.8 + 0.2 * edge), paddy);
          diffuseColor.rgb = mix(diffuseColor.rgb, tc, clamp(vTerr, 0.0, 1.0) * smoothstep(0.72, 0.86, vN.y));
        }`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function buildWater() {
  const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 1, 1); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({ color: 0x5f8f96, specular: 0x6a6656, shininess: 140, emissive: 0x0b1d22 });
  const m = new THREE.Mesh(geo, mat); m.position.y = WATER_Y; m.renderOrder = 1; m.updateMatrix(); m.matrixAutoUpdate = false;
  return m;
}

// ── Sky dome + distant ranges ───────────────────────────────
function buildSky(fogColor) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR }, uHorizon: { value: fogColor }, uZenith: { value: new THREE.Color(0x4f86c6) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      #include <common>
      varying vec3 vDir; uniform vec3 uSun, uHorizon, uZenith;
      void main(){
        float h = vDir.y;
        vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        col += vec3(1.0,0.85,0.6) * pow(s, 6.0) * 0.25;
        col += vec3(1.0,0.9,0.7) * pow(s, 400.0) * 0.5;
        col = mix(col, vec3(4.0,3.6,3.0), smoothstep(0.9993, 0.9996, s));
        if (h < 0.0) col = uHorizon;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), mat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  return sky;
}

function buildFarRange() {
  // A painted cylinder of misty karst silhouettes beyond the playable map.
  const tex = canvasTex(2048, 256, (c, W, H) => {
    const rnd = mulberry(42);
    const layers = [
      { col: [196, 211, 216], base: 0.72, amp: 0.5 },
      { col: [168, 189, 196], base: 0.8, amp: 0.42 },
      { col: [140, 166, 172], base: 0.9, amp: 0.3 },
    ];
    for (const L of layers) {
      c.fillStyle = `rgb(${L.col.join(',')})`;
      c.beginPath(); c.moveTo(0, H);
      let x = 0;
      while (x < W) {
        const w = 30 + rnd() * 90, h = H * (L.base - L.amp * (0.3 + 0.7 * rnd()));
        // rounded karst hump
        c.lineTo(x, H * L.base);
        c.bezierCurveTo(x + w * 0.05, h, x + w * 0.95, h, x + w, H * L.base);
        x += w * (0.7 + rnd() * 0.5);
      }
      c.lineTo(W, H); c.closePath(); c.fill();
    }
    // mist band at the bottom
    const g = c.createLinearGradient(0, H * 0.55, 0, H);
    g.addColorStop(0, 'rgba(196,211,216,0)'); g.addColorStop(1, 'rgba(196,211,216,1)');
    c.fillStyle = g; c.fillRect(0, H * 0.55, W, H * 0.45);
  });
  tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 3;
  const geo = new THREE.CylinderGeometry(3800, 3800, 900, 64, 1, true);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const m = new THREE.Mesh(geo, mat); m.position.y = 300; m.renderOrder = -9; m.frustumCulled = false;
  return m;
}

// ── Instanced props ─────────────────────────────────────────
function colorGeo(geo, r, g, b) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) setLin(a, i * 3, r, g, b);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  geo.deleteAttribute('uv');
  if (geo.index) geo = geo.toNonIndexed();
  return geo;
}
function conifer() {
  const trunk = colorGeo(new THREE.CylinderGeometry(0.12, 0.18, 0.35, 3, 1, true).translate(0, 0.17, 0), 0.35, 0.25, 0.16);
  const a = colorGeo(new THREE.ConeGeometry(0.42, 0.6, 6).translate(0, 0.55, 0), 0.2, 0.36, 0.2);
  const b = colorGeo(new THREE.ConeGeometry(0.3, 0.5, 6).translate(0, 0.85, 0), 0.24, 0.42, 0.22);
  return mergeGeometries([trunk, a, b]);
}
function broadleaf() {
  const trunk = colorGeo(new THREE.CylinderGeometry(0.08, 0.12, 0.45, 3, 1, true).translate(0, 0.22, 0), 0.36, 0.27, 0.18);
  const crown = colorGeo(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 0.8, 1).translate(0, 0.72, 0), 0.32, 0.5, 0.22);
  return mergeGeometries([trunk, crown]);
}
function house() {
  const parts = [];
  parts.push(colorGeo(new THREE.BoxGeometry(7, 3.6, 5).translate(0, 1.8, 0), 0.9, 0.88, 0.82));
  parts.push(colorGeo(new THREE.BoxGeometry(7.4, 0.5, 5.4).translate(0, 0.25, 0), 0.5, 0.48, 0.45));
  // gable roof with overhang
  const roof = new THREE.BufferGeometry();
  const w = 4.3, d = 3.4, y0 = 3.5, y1 = 6.0;
  const v = [
    -w, y0, -d, w, y0, -d, w, y1, 0, -w, y0, -d, w, y1, 0, -w, y1, 0,
    -w, y0, d, -w, y1, 0, w, y1, 0, -w, y0, d, w, y1, 0, w, y0, d,
    -w + 0.3, y0, -d + 0.5, -w + 0.3, y0, d - 0.5, -w + 0.3, y1 - 0.1, 0,
    w - 0.3, y0, -d + 0.5, w - 0.3, y1 - 0.1, 0, w - 0.3, y0, d - 0.5,
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  const rc = new Float32Array(v.length);
  for (let i = 0; i < v.length / 3; i++) setLin(rc, i * 3, i < 12 ? 0.26 : 0.86, i < 12 ? 0.28 : 0.84, i < 12 ? 0.31 : 0.78);
  roof.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  parts.push(roof);
  return mergeGeometries(parts);
}
function pagoda() {
  const parts = [];
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const s = 1 - i * 0.14;
    parts.push(colorGeo(new THREE.CylinderGeometry(2.6 * s, 2.8 * s, 3.2, 8).translate(0, y + 1.6, 0), 0.92, 0.88, 0.8));
    parts.push(colorGeo(new THREE.ConeGeometry(4.6 * s, 1.6, 8).translate(0, y + 3.6, 0), 0.24, 0.26, 0.3));
    parts.push(colorGeo(new THREE.CylinderGeometry(2.7 * s, 2.7 * s, 0.4, 8).translate(0, y + 2.8, 0), 0.62, 0.16, 0.12));
    y += 3.6;
  }
  parts.push(colorGeo(new THREE.ConeGeometry(0.3, 4, 6).translate(0, y + 2, 0), 0.7, 0.55, 0.25));
  return mergeGeometries(parts);
}

function placeTrees(gen, sampler) {
  const rnd = mulberry(99);
  const out = [[], []];
  const S = gen.S;
  let tries = 0;
  while ((out[0].length + out[1].length) < 3000 && tries++ < 60000) {
    const x = (rnd() * 2 - 1) * (HALF - 20), z = (rnd() * 2 - 1) * (HALF - 20);
    const h = sampler.groundY(x, z);
    if (h < 2) continue;
    const sl = sampler.slope(x, z);
    if (sl > 1.6) continue;
    const i = Math.round((x + HALF) / CELL), j = Math.round((z + HALF) / CELL);
    if (gen.terr[j * S + i] > 0.15) continue;
    let nearV = false; for (const v of VILLAGES) if (Math.hypot(x - v.x, z - v.z) < v.r + 10) nearV = true;
    if (nearV) continue;
    if (Math.hypot(x - PERCH.x, z - PERCH.z) < 70) continue;
    const onHill = h > 20;
    const clump = vnoise(x / 120, z / 120, 11);
    if (!onHill && clump < 0.25 && riverDist(x, z) > 60) continue;
    if (onHill && rnd() < 0.15) continue;
    const kind = onHill ? (rnd() < 0.7 ? 0 : 1) : (rnd() < 0.3 ? 0 : 1);
    const s = (onHill ? 7 : 9) + rnd() * 7;
    out[kind].push([x, h - 0.5, z, s, rnd() * 6.28, 0.8 + rnd() * 0.4]);
  }
  return out;
}

function instanced(geo, mat, items, colorFn) {
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  items.forEach((it, i) => {
    p.set(it[0], it[1], it[2]); e.set(0, it[4], 0); q.setFromEuler(e); s.set(it[3], it[3] * (it[6] ?? 1), it[3]);
    M.compose(p, q, s); m.setMatrixAt(i, M);
    if (colorFn) { colorFn(c, it); m.setColorAt(i, c); }
  });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

function buildVillages(sampler) {
  const rnd = mulberry(5);
  const houses = [], pagodas = [];
  for (const v of VILLAGES) {
    const axis = rnd() * Math.PI;
    let placed = 0, tries = 0;
    while (placed < 26 && tries++ < 400) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * v.r;
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      if (houses.some(h => Math.hypot(h[0] - x, h[2] - z) < 11)) continue;
      if (sampler.slope(x, z) > 0.3 || sampler.groundY(x, z) < 1.5) continue;
      houses.push([x, sampler.groundY(x, z) - 0.3, z, 0.85 + rnd() * 0.4, axis + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.15, rnd()]);
      placed++;
    }
  }
  for (const i of [0, 2, 4]) { const v = VILLAGES[i]; const x = v.x + v.r * 0.9, z = v.z - 12; pagodas.push([x, sampler.groundY(x, z) - 0.5, z, 1.4, 0]); }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const hm = instanced(house(), mat, houses, (c, it) => c.setScalar(0.85 + it[5] * 0.2));
  const pm = instanced(pagoda(), mat, pagodas);
  return [hm, pm];
}

// The launch perch: a deck with a little red pavilion on top of a lone tower.
function buildPerch(topY) {
  const parts = [];
  // deck and rock collar; the player stands at the front, the pavilion sits behind
  parts.push(colorGeo(new THREE.CylinderGeometry(5.5, 5.8, 0.6, 18).translate(0, -0.3, 1.5), 0.45, 0.32, 0.22));
  parts.push(colorGeo(new THREE.CylinderGeometry(6.4, 4.0, 9, 14).translate(0, -5, 1.5), 0.55, 0.56, 0.5));
  const pz = 4.2;
  for (const [x, z] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) parts.push(colorGeo(new THREE.CylinderGeometry(0.14, 0.16, 3, 8).translate(x, 1.5, z + pz), 0.66, 0.12, 0.1));
  parts.push(colorGeo(new THREE.ConeGeometry(4.0, 1.6, 4).rotateY(Math.PI / 4).translate(0, 3.7, pz), 0.22, 0.24, 0.28));
  parts.push(colorGeo(new THREE.BoxGeometry(5.0, 0.28, 3.8).translate(0, 2.95, pz), 0.6, 0.14, 0.1));
  parts.push(colorGeo(new THREE.SphereGeometry(0.3, 8, 6).translate(0, 4.6, pz), 0.85, 0.65, 0.25));
  for (const x of [-2.2, 2.2]) parts.push(colorGeo(new THREE.SphereGeometry(0.26, 8, 6).scale(1, 1.25, 1).translate(x, 2.45, pz - 1.6), 1.0, 0.45, 0.2));
  // railing around the back half
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * 0.1 + (i / 8) * Math.PI * 0.8;
    parts.push(colorGeo(new THREE.BoxGeometry(0.12, 0.9, 0.12).translate(Math.cos(a) * 5.2, 0.45, 1.5 + Math.sin(a) * 5.2), 0.6, 0.14, 0.1));
  }
  const rail = new THREE.TorusGeometry(5.2, 0.06, 4, 24, Math.PI * 0.8).rotateX(Math.PI / 2).rotateY(-Math.PI * 0.1).translate(0, 0.9, 1.5);
  parts.push(colorGeo(rail, 0.6, 0.14, 0.1));
  const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x100804 }));
  m.position.set(PERCH.x, topY, PERCH.z);
  return m;
}

// ── Clouds and mist ─────────────────────────────────────────
function cloudTexture() {
  return canvasTex(256, 256, (c, W, H) => {
    const rnd = mulberry(3);
    for (let i = 0; i < 26; i++) {
      const x = W * (0.2 + rnd() * 0.6), y = H * (0.35 + rnd() * 0.35), r = W * (0.1 + rnd() * 0.16);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const shade = Math.round(255 - (y / H) * 50);
      g.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 8)},0.55)`);
      g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
  });
}
function buildClouds(sampler) {
  const rnd = mulberry(77);
  const items = [];
  for (let i = 0; i < 70; i++) {
    const x = (rnd() * 2 - 1) * HALF * 1.1, z = (rnd() * 2 - 1) * HALF * 1.1;
    items.push([x, 270 + rnd() * 160, z, 120 + rnd() * 160, 0.55, 0.95 + rnd() * 0.1]);
  }
  // low mist puffs hugging the towers
  for (let i = 0; i < 46; i++) {
    const x = (rnd() * 2 - 1) * HALF * 0.95, z = (rnd() * 2 - 1) * HALF * 0.95;
    const g = sampler.groundY(x, z);
    items.push([x, Math.max(g, 0) + 25 + rnd() * 40, z, 70 + rnd() * 70, 0.35, 0.9]);
  }
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), billboardMat(cloudTexture(), { opacity: 0.9 }), items.length);
  const M = new THREE.Matrix4();
  items.forEach((it, i) => { M.makeScale(it[3], it[3] * it[4], it[5]); M.setPosition(it[0], it[1], it[2]); mesh.setMatrixAt(i, M); });
  mesh.frustumCulled = false; mesh.renderOrder = 5;
  return mesh;
}

export function billboardMat(map, opts) {
  const m = billboardMaterial(map, opts);
  m.uniforms.map.value = map;
  return m;
}

// ── Thermals: rising motes + circling birds ────────────────
function moteTexture() {
  return canvasTex(64, 64, (c, W) => {
    const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(255,240,210,1)'); g.addColorStop(0.4, 'rgba(255,220,170,0.5)'); g.addColorStop(1, 'rgba(255,200,150,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  });
}
function buildThermals(sampler) {
  const PER = 70, n = VILLAGES.length * PER;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 3);
  const rnd = mulberry(8);
  for (let i = 0; i < n; i++) { seed[i * 3] = rnd() * 6.28; seed[i * 3 + 1] = Math.sqrt(rnd()); seed[i * 3 + 2] = rnd(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ size: 2.2, map: moteTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, color: 0xffe2b0 });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  const base = VILLAGES.map(v => sampler.groundY(v.x, v.z));
  // little dark birds circling in each thermal
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -1, 0.25, -0.1, 0, 0.05, -0.1, 0, 0, 0.3, 0, 0.05, -0.1, 1, 0.25, -0.1], 3));
  bgeo.computeVertexNormals();
  const NB = VILLAGES.length * 3;
  const birds = new THREE.InstancedMesh(bgeo, new THREE.MeshBasicMaterial({ color: 0x2a2c30, side: THREE.DoubleSide }), NB);
  birds.frustumCulled = false;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1.6, 1.6, 1.6), up = new THREE.Vector3(0, 1, 0);
  function update(t) {
    for (let v = 0; v < VILLAGES.length; v++) {
      const V = VILLAGES[v], by = base[v];
      for (let k = 0; k < PER; k++) {
        const i = v * PER + k;
        const a = seed[i * 3] + t * 0.25, r = seed[i * 3 + 1] * 45;
        const y = ((seed[i * 3 + 2] * 300 + t * 4) % 300);
        pos[i * 3] = V.x + Math.cos(a) * r; pos[i * 3 + 1] = by + 10 + y; pos[i * 3 + 2] = V.z + Math.sin(a) * r;
      }
      for (let b = 0; b < 3; b++) {
        const a = t * (0.35 + b * 0.05) + b * 2.1 + v, r = 30 + b * 12;
        p.set(V.x + Math.cos(a) * r, by + 90 + b * 55 + Math.sin(t * 0.3 + b) * 8, V.z + Math.sin(a) * r);
        q.setFromAxisAngle(up, -a);
        // flap wings by squashing y scale
        s.y = 1.6 * (0.6 + 0.4 * Math.sin(t * 7 + b * 2 + v));
        M.compose(p, q, s); birds.setMatrixAt(v * 3 + b, M);
      }
    }
    geo.attributes.position.needsUpdate = true;
    birds.instanceMatrix.needsUpdate = true;
  }
  return { objects: [pts, birds], update };
}

export function buildWorld(scene, gen, sampler) {
  const fogColor = new THREE.Color(FOG_HEX);
  scene.background = fogColor.clone();
  scene.fog = new THREE.FogExp2(FOG_HEX, 0.00085);
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x5a6a48, 1.4));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.0); sun.position.copy(SUN_DIR).multiplyScalar(1000); scene.add(sun);

  scene.add(buildSky(fogColor), buildFarRange());
  const terrain = buildTerrain(gen); scene.add(terrain);
  scene.add(buildWater());
  const trees = placeTrees(gen, sampler);
  const tmat = new THREE.MeshLambertMaterial({ vertexColors: true });
  scene.add(instanced(conifer(), tmat, trees[0], (c, it) => c.setScalar(it[5])));
  scene.add(instanced(broadleaf(), tmat, trees[1], (c, it) => c.setRGB(it[5], it[5] * (0.95 + 0.1 * Math.sin(it[0])), it[5] * 0.9)));
  for (const m of buildVillages(sampler)) scene.add(m);
  const perchY = sampler.groundY(PERCH.x, PERCH.z);
  scene.add(buildPerch(perchY));
  scene.add(buildClouds(sampler));
  const th = buildThermals(sampler);
  for (const o of th.objects) scene.add(o);
  return { perchY, update: th.update, terrain, treeCount: trees[0].length + trees[1].length };
}
