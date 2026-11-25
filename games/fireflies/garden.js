import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Firefly colours (index = colour id). Hues drive the mixing rule (circular mean of hues).
export const COLORS = [
  { name: 'amber', hue: 38, rgb: [1.0, 0.68, 0.2] },
  { name: 'jade', hue: 115, rgb: [0.42, 1.0, 0.35] },
  { name: 'azure', hue: 205, rgb: [0.25, 0.62, 1.0] },
  { name: 'rose', hue: 335, rgb: [1.0, 0.35, 0.62] },
];
export const NCOL = COLORS.length;

// Mix a composition (counts per colour) into an RGB triple (written into out[o..o+2]).
const _c = new THREE.Color();
export function mixColor(comp, ci, out, o = 0) {
  let x = 0, y = 0, n = 0, kinds = 0;
  for (let k = 0; k < NCOL; k++) {
    const c = comp[ci + k]; if (!c) continue;
    const h = COLORS[k].hue * Math.PI / 180; x += Math.cos(h) * c; y += Math.sin(h) * c; n += c; kinds++;
  }
  if (n === 0) { out[o] = out[o + 1] = out[o + 2] = 0.6; return out; }
  if (kinds === 1) { for (let k = 0; k < NCOL; k++) if (comp[ci + k]) { const r = COLORS[k].rgb; out[o] = r[0]; out[o + 1] = r[1]; out[o + 2] = r[2]; } return out; }
  const mag = Math.hypot(x, y) / n;
  let hue = Math.atan2(y, x) / (Math.PI * 2); if (hue < 0) hue += 1;
  _c.setHSL(hue, kinds <= 2 ? 0.9 : Math.min(1, mag * 1.6), kinds <= 2 ? 0.58 : 0.6 + (1 - mag) * 0.25);
  out[o] = _c.r; out[o + 1] = _c.g; out[o + 2] = _c.b;
  return out;
}

// ── Level data ───────────────────────────────────────────────
// Positions are area-local: origin = where the player stands, -Z = facing direction.
// flies: [colour, type, count] with type 0 = calm, 1 = shy (flees fast hands), 2 = still (lands on a still open palm)
const r = (amber = 0, jade = 0, azure = 0, rose = 0) => [amber, jade, azure, rose];
export const AREAS = [
  {
    id: 'gate', name: 'Moon Gate', zh: '月门', x: 0, z: 0, yaw: 0,
    hint: ['Pinch a firefly between thumb and finger.', 'Bring it to a lantern and let go.', 'Open your palm and push to send a handful off.'],
    hintCtl: 'Controllers: trigger to catch, let go at a lantern; grip release throws.',
    lanterns: [{ p: [-0.62, 1.18, -0.55], need: r(1) }, { p: [0, 1.3, -0.78], need: r(2) }, { p: [0.62, 1.18, -0.55], need: r(3) }],
    flies: [[0, 0, 13]], pond: null,
  },
  {
    id: 'pond', name: 'Lotus Pond', zh: '莲池', x: 0, z: -10.5, yaw: 0,
    hint: ['Cup both hands, palms up, to scoop many.', 'Open them and draw apart to let them go.', 'Mind the koi: they leap for low fireflies.'],
    hintCtl: 'Controllers: grip to scoop (both grips together = bigger bowl).',
    lanterns: [{ p: [-0.7, 1.15, -0.45], need: r(4) }, { p: [0, 1.28, -0.72], need: r(0, 3) }, { p: [0.7, 1.15, -0.45], need: r(0, 5) }],
    flies: [[0, 0, 10], [1, 0, 14]], pond: { x: 0, z: -3.4, rx: 4.2, rz: 2.7 }, fish: 4,
  },
  {
    id: 'bamboo', name: 'Bamboo Grove', zh: '竹林', x: -8, z: -18.5, yaw: Math.PI / 2,
    hint: ['Blue fireflies are shy: move slowly, or point to call them.', 'Rose fireflies come only to a still, open palm.'],
    hintCtl: 'Controllers: hold A / X to call. Hold a hand still and open for rose ones.',
    lanterns: [{ p: [-0.62, 1.18, -0.55], need: r(0, 0, 2) }, { p: [0, 1.3, -0.78], need: r(0, 0, 0, 2) }, { p: [0.62, 1.18, -0.55], need: r(0, 0, 3) }],
    flies: [[2, 1, 10], [3, 2, 7], [0, 0, 4]], pond: null,
  },
  {
    id: 'bridge', name: 'Willow Bridge', zh: '柳桥', x: 0, z: -26, yaw: 0,
    hint: ['These lanterns want mixed light.', 'The beads under each show the colours to bring.'],
    hintCtl: 'Any order works: each lantern takes one of each colour shown.',
    lanterns: [{ p: [-0.78, 1.15, -0.32], need: r(1, 0, 1) }, { p: [-0.27, 1.3, -0.66], need: r(0, 0, 1, 1) }, { p: [0.27, 1.3, -0.66], need: r(1, 0, 0, 1) }, { p: [0.78, 1.15, -0.32], need: r(0, 1, 1) }],
    flies: [[0, 0, 6], [2, 0, 6], [3, 0, 6], [1, 0, 4]], pond: { x: 0, z: -0.6, rx: 6.6, rz: 4.0 }, fish: 3,
  },
  {
    id: 'pavilion', name: 'Moon Pavilion', zh: '月亭', x: 8, z: -18.5, yaw: -Math.PI / 2,
    hint: ['Round lanterns take a single orb of light.', 'Gather fireflies, close your fist and hold', 'to squeeze them into one bright orb.'],
    hintCtl: 'Controllers: hold trigger, then squeeze grip to make an orb.',
    lanterns: [{ p: [-0.62, 1.22, -0.55], need: r(3), orb: true }, { p: [0.62, 1.22, -0.55], need: r(0, 2, 2), orb: true }, { p: [0, 1.42, -0.85], need: r(1, 1, 1, 1), orb: true, scale: 1.4 }],
    flies: [[0, 0, 8], [1, 0, 6], [2, 0, 6], [3, 0, 5]], pond: null,
  },
];

export function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// area-local → world
export function toWorld(area, x, y, z, out) {
  const c = Math.cos(area.yaw), s = Math.sin(area.yaw);
  return out.set(area.x + x * c + z * s, y, area.z - x * s + z * c);
}

// ── Geometry buckets merged into one mesh per material ───────
class Bucket {
  constructor() { this.geos = []; }
  add(src, m, color, jitter = 0, rand = Math.random) {
    let g = src.index ? src.toNonIndexed() : src.clone();
    g.deleteAttribute('uv'); if (g.attributes.uv1) g.deleteAttribute('uv1');
    g.applyMatrix4(m);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const j = jitter ? 1 + (rand() - 0.5) * jitter : 1;
      col[i * 3] = color[0] * j; col[i * 3 + 1] = color[1] * j; col[i * 3 + 2] = color[2] * j;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
  }
  build(material) {
    if (!this.geos.length) return null;
    const g = mergeGeometries(this.geos, false);
    for (const x of this.geos) x.dispose();
    this.geos = [];
    g.computeBoundingSphere();
    return new THREE.Mesh(g, material);
  }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
function areaM(area, local) { return new THREE.Matrix4().makeRotationY(area.yaw).setPosition(area.x, 0, area.z).multiply(local); }
// matrix for a cylinder (unit height along Y, centred) spanning a → b
function between(a, b, radius) {
  const d = _p.copy(b).sub(a), len = d.length();
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), _q, _s.set(radius, len, radius));
}

function groundTexture(rand) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#34463c'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const g = 60 + rand() * 60, b = 50 + rand() * 40;
    x.fillStyle = `rgba(${g * 0.6 | 0},${g | 0},${b | 0},${0.25 + rand() * 0.4})`;
    const px = rand() * 512, py = rand() * 512;
    x.fillRect(px, py, 1 + rand() * 2, 3 + rand() * 6);
  }
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(40,60,50,${0.15 + rand() * 0.2})`;
    x.beginPath(); x.arc(rand() * 512, rand() * 512, 10 + rand() * 40, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(0.33, 0.33); t.anisotropy = 4;
  return t;
}

export const MOON_DIR = new THREE.Vector3(0.38, 0.4, -0.83).normalize();

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMoon: { value: MOON_DIR.clone() }, uGlow: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uMoon; uniform float uGlow; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zen = vec3(0.012, 0.018, 0.06), mid = vec3(0.05, 0.05, 0.14), hor = vec3(0.26, 0.13, 0.22);
        vec3 west = vec3(0.45, 0.22, 0.16);
        float wf = pow(max(0.0, dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), vec3(-0.6, 0.0, -0.8))), 3.0);
        vec3 horizon = mix(hor, west, wf * 0.8);
        vec3 c = h > 0.0 ? mix(mix(horizon, mid, smoothstep(0.0, 0.18, h)), zen, smoothstep(0.15, 0.7, h)) : horizon * 0.5;
        float m = dot(d, uMoon);
        c += vec3(1.0, 0.96, 0.85) * smoothstep(0.99945, 0.9997, m);
        c += vec3(0.45, 0.5, 0.65) * pow(max(0.0, m), 180.0) * 0.6 + vec3(0.2, 0.22, 0.3) * pow(max(0.0, m), 14.0) * 0.25;
        c += vec3(0.12, 0.08, 0.02) * uGlow * smoothstep(0.25, 0.0, h);
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  return sky;
}

// Builds all scenery. Returns data the game needs (lantern placements, ponds, stone lights...).
export function buildGarden(scene) {
  const rand = mulberry(7);
  const lam = new Bucket(), glow = new Bucket();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // templates
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const cyl12 = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  const rock = new THREE.IcosahedronGeometry(1, 0);
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const cone6 = new THREE.ConeGeometry(1, 1, 6, 1);
  const pad = new THREE.CircleGeometry(1, 10);
  const petal = new THREE.ConeGeometry(0.03, 0.09, 4, 1);

  const PLASTER = [0.62, 0.6, 0.56], TILE = [0.12, 0.13, 0.16], WOOD = [0.28, 0.14, 0.1], DARKWOOD = [0.16, 0.09, 0.07];
  const STONE = [0.33, 0.34, 0.36], MOSS = [0.12, 0.2, 0.14], LEAF = [0.1, 0.2, 0.12];

  // ── ground with pond holes
  const ponds = [];
  AREAS.forEach((a, ai) => {
    if (!a.pond) return;
    const c = toWorld(a, a.pond.x, 0, a.pond.z, new THREE.Vector3());
    const rot = Math.abs(Math.sin(a.yaw)) > 0.5;
    ponds.push({ area: ai, x: c.x, z: c.z, rx: rot ? a.pond.rz : a.pond.rx, rz: rot ? a.pond.rx : a.pond.rz, waterY: -0.3 });
  });
  const shape = new THREE.Shape();
  shape.moveTo(-40, -14); shape.lineTo(40, -14); shape.lineTo(40, 50); shape.lineTo(-40, 50); shape.closePath();
  for (const p of ponds) { const h = new THREE.Path(); h.absellipse(p.x, -p.z, p.rx, p.rz, 0, Math.PI * 2, true); shape.holes.push(h); }
  const groundGeo = new THREE.ShapeGeometry(shape, 24);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: groundTexture(rand), color: 0x9aa8a0 }));
  scene.add(ground);

  // pond beds, rims, lotus, water
  const waterGeos = [];
  const bowlProfile = []; for (let i = 0; i <= 8; i++) { const t = i / 8; bowlProfile.push(new THREE.Vector2(Math.max(0.001, 1 - t * t * 0.9), -0.02 - Math.sin(t * Math.PI / 2) * 0.7)); }
  bowlProfile.reverse();
  const bowl = new THREE.LatheGeometry(bowlProfile, 28);
  for (const p of ponds) {
    lam.add(bowl, M(p.x, 0, p.z, 0, 0, 0, p.rx, 1, p.rz), [0.05, 0.07, 0.08]);
    const w = new THREE.CircleGeometry(1, 40); w.rotateX(-Math.PI / 2); w.applyMatrix4(M(p.x, p.waterY, p.z, 0, 0, 0, p.rx, 1, p.rz));
    w.deleteAttribute('uv'); waterGeos.push(w);
    const per = Math.PI * (p.rx + p.rz);
    const n = Math.floor(per / 0.55);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rand() * 0.05, s = 0.16 + rand() * 0.16;
      lam.add(rock, M(p.x + Math.cos(a) * (p.rx + 0.05), 0.02, p.z + Math.sin(a) * (p.rz + 0.05), rand() * 3, rand() * 3, 0, s * 1.3, s * 0.7, s), STONE, 0.3, rand);
    }
    // lotus pads + flowers away from the player standing spot
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, rr = 0.35 + rand() * 0.55;
      const x = p.x + Math.cos(a) * p.rx * rr, z = p.z + Math.sin(a) * p.rz * rr;
      const ar = AREAS[p.area];
      if (Math.hypot(x - ar.x, z - ar.z) < 1.4) continue;
      const s = 0.14 + rand() * 0.16;
      lam.add(pad, M(x, p.waterY + 0.012, z, -Math.PI / 2, 0, rand() * 6, s), [0.1, 0.26, 0.14], 0.2, rand);
      if (rand() < 0.35) {
        for (let k = 0; k < 7; k++) {
          const pa = k / 7 * Math.PI * 2;
          glow.add(petal, M(x + Math.cos(pa) * 0.025, p.waterY + 0.07, z + Math.sin(pa) * 0.025, Math.sin(pa) * 0.5, 0, -Math.cos(pa) * 0.5), [0.42, 0.13, 0.22]);
        }
      }
    }
  }
  const water = new THREE.Mesh(mergeGeometries(waterGeos), new THREE.MeshPhongMaterial({ color: 0x050a14, specular: 0x8899cc, shininess: 90, transparent: true, opacity: 0.78, depthWrite: false }));
  water.renderOrder = 1;
  for (const g of waterGeos) g.dispose();
  scene.add(water);

  // ── walls
  const wall = (x0, z0, x1, z1, h = 2.5) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    lam.add(box, M(cx, h / 2, cz, 0, ang, 0, len, h, 0.35), PLASTER, 0.05, rand);
    lam.add(box, M(cx, h + 0.06, cz, 0, ang, 0, len + 0.2, 0.12, 0.6), TILE);
    lam.add(box, M(cx, h + 0.17, cz, 0, ang, 0, len + 0.1, 0.1, 0.3), TILE);
    lam.add(box, M(cx, 0.12, cz, 0, ang, 0, len, 0.24, 0.4), [0.22, 0.22, 0.24]);
  };
  wall(-17, 6, 17, 6); wall(-17, -36, 17, -36); wall(-17, 6, -17, -36); wall(17, 6, 17, -36);
  // moon gate wall
  {
    const gz = -4.9, half = 3.2, h = 2.9, R = 1.25, gy = 1.38;
    const s = new THREE.Shape(); s.moveTo(-half, 0); s.lineTo(half, 0); s.lineTo(half, h); s.lineTo(-half, h); s.closePath();
    const hole = new THREE.Path(); hole.absarc(0, gy, R, 0, Math.PI * 2, true); s.holes.push(hole);
    const eg = new THREE.ExtrudeGeometry(s, { depth: 0.4, bevelEnabled: false, curveSegments: 40 });
    lam.add(eg, M(0, 0, gz - 0.2), PLASTER, 0.04, rand); eg.dispose();
    const ring = new THREE.TorusGeometry(R + 0.02, 0.06, 6, 48);
    lam.add(ring, M(0, gy, gz + 0.21), [0.3, 0.3, 0.32]); lam.add(ring, M(0, gy, gz - 0.21), [0.3, 0.3, 0.32]); ring.dispose();
    lam.add(box, M(0, h + 0.07, gz, 0, 0, 0, half * 2 + 0.3, 0.14, 0.7), TILE);
    lam.add(box, M(0, h + 0.2, gz, 0, 0, 0, half * 2 + 0.1, 0.12, 0.35), TILE);
    wall(-17, gz, -half, gz, 2.5); wall(half, gz, 17, gz, 2.5);
  }

  // ── stepping stones linking areas
  const stones = (ax, az, bx, bz) => {
    const n = Math.floor(Math.hypot(bx - ax, bz - az) / 0.7);
    for (let i = 1; i < n; i++) {
      const t = i / n, x = ax + (bx - ax) * t + (rand() - 0.5) * 0.25, z = az + (bz - az) * t + (rand() - 0.5) * 0.25;
      if (ponds.some(p => ((x - p.x) / p.rx) ** 2 + ((z - p.z) / p.rz) ** 2 < 1.2)) continue;
      lam.add(cyl12, M(x, 0.015, z, 0, rand() * 3, 0, 0.26 + rand() * 0.08, 0.05, 0.22 + rand() * 0.08), [0.4, 0.4, 0.42], 0.2, rand);
    }
  };
  stones(0, -1.2, 0, -8.5); stones(-1.5, -10.5, -6.5, -18); stones(-8, -20, -3, -25); stones(3, -25.5, 7, -20); stones(4, -10.5, 7.2, -17);

  // ── trees (layered canopy), scholar rocks
  const tree = (x, z, s, leaf) => {
    lam.add(cyl, M(x, 1.1 * s, z, (rand() - 0.5) * 0.15, 0, (rand() - 0.5) * 0.15, 0.09 * s, 2.2 * s, 0.09 * s), DARKWOOD);
    for (let k = 0; k < 4; k++) {
      const a = rand() * 6.28, d = 0.3 + rand() * 0.5;
      lam.add(blob, M(x + Math.cos(a) * d * s, (2.0 + k * 0.45 + rand() * 0.3) * s, z + Math.sin(a) * d * s, 0, rand() * 3, 0, (0.9 - k * 0.12) * s, 0.42 * s, (0.8 - k * 0.1) * s), leaf, 0.35, rand);
    }
  };
  [[-6, 2.5, 1.1], [6.5, 3, 1.2], [-13, -2, 1.3], [12, -6, 1.1], [-14, -12, 1.2], [14, -28, 1.3], [-13, -31, 1.2], [5, -33, 1.0], [12.5, 2, 1.0], [-4.5, -7.5, 0.8], [5, -7.6, 0.9]].forEach(([x, z, s], i) =>
    tree(x, z, s, i % 3 === 0 ? [0.3, 0.1, 0.12] : i % 3 === 1 ? LEAF : [0.14, 0.22, 0.12]));
  const scholar = (x, z, h) => {
    for (let k = 0; k < 3; k++) lam.add(rock, M(x + (rand() - 0.5) * 0.3, h * (0.25 + k * 0.28), z + (rand() - 0.5) * 0.3, rand(), rand() * 3, rand() * 0.4, 0.35 - k * 0.06, h * 0.25, 0.3 - k * 0.05), [0.42, 0.42, 0.44], 0.35, rand);
  };
  scholar(-2.6, -3.6, 1.8); scholar(2.8, -3.9, 1.4); scholar(-3.5, -14.5, 1.6); scholar(10.5, -27, 2.0);

  // ── decorative stone lanterns (light up when an area is complete)
  const stoneLights = [];
  const stoneLantern = (area, ai, lx, lz) => {
    const w = toWorld(area, lx, 0, lz, new THREE.Vector3());
    const m = areaM(area, M(lx, 0, lz));
    const add = (geo, x, y, z, sx, sy, sz, col = [0.45, 0.45, 0.47]) => lam.add(geo, m.clone().multiply(M(x, y, z, 0, 0, 0, sx, sy, sz)), col, 0.15, rand);
    add(box, 0, 0.08, 0, 0.42, 0.16, 0.42); add(cyl, 0, 0.45, 0, 0.08, 0.6, 0.08); add(box, 0, 0.8, 0, 0.36, 0.1, 0.36);
    add(box, 0.13, 0.98, 0.13, 0.05, 0.26, 0.05); add(box, -0.13, 0.98, 0.13, 0.05, 0.26, 0.05); add(box, 0.13, 0.98, -0.13, 0.05, 0.26, 0.05); add(box, -0.13, 0.98, -0.13, 0.05, 0.26, 0.05);
    glow.add(box, m.clone().multiply(M(0, 0.98, 0, 0, 0, 0, 0.2, 0.2, 0.2)), [0.14, 0.07, 0.025]);
    lam.add(cone6, m.clone().multiply(M(0, 1.27, 0, 0, 0.26, 0, 0.36, 0.3, 0.36)), [0.4, 0.4, 0.42]);
    stoneLights.push({ area: ai, pos: new THREE.Vector3(w.x, 0.98, w.z) });
  };

  // ── per-area set pieces
  const lanternDefs = [];
  const hintAnchors = [];
  AREAS.forEach((a, ai) => {
    const AM = (local) => areaM(a, local);
    // hint board anchor: front-left, facing the player
    hintAnchors.push({ pos: toWorld(a, -1.05, 1.78, -1.55, new THREE.Vector3()), yaw: a.yaw + Math.atan2(1.05, 1.55) * 0.8 });
    stoneLantern(a, ai, -2.0, 0.6); stoneLantern(a, ai, 2.0, 0.6);
    for (const L of a.lanterns) {
      const [lx, ly, lz] = L.p;
      const pos = toWorld(a, lx, ly, lz, new THREE.Vector3());
      const sc = (L.scale ?? (L.orb ? 1.2 : 1)) * 0.82;
      lanternDefs.push({ area: ai, pos, need: L.need, orb: !!L.orb, scale: sc });
      const topY = ly + 0.13 * sc;
      if (a.id === 'pavilion') {
        lam.add(cyl, AM(M(lx, (topY + 2.62) / 2, lz, 0, 0, 0, 0.004, 2.62 - topY, 0.004)), [0.1, 0.08, 0.06]);
      } else {
        const ox = Math.abs(lx) < 0.05 ? 0.32 : Math.sign(lx) * 0.3, oz = -0.12;
        lam.add(cyl, AM(M(lx + ox, 1.0, lz + oz, 0, 0, 0, 0.03, 2.0, 0.03)), WOOD);
        lam.add(cyl, AM(between(V(lx + ox, 1.92, lz + oz), V(lx, 1.92, lz), 0.018)), WOOD);
        lam.add(cyl, AM(M(lx, (topY + 1.92) / 2, lz, 0, 0, 0, 0.004, 1.92 - topY, 0.004)), [0.1, 0.08, 0.06]);
        lam.add(box, AM(M(lx + ox, 0.05, lz + oz, 0, 0, 0, 0.16, 0.1, 0.16)), STONE);
      }
    }
    if (a.id === 'gate') {
      lam.add(rock, AM(M(-1.7, 0.25, -1.9, 0.3, 1, 0, 0.6, 0.45, 0.5)), STONE, 0.3, rand);
      lam.add(rock, AM(M(1.9, 0.2, -2.3, 0.1, 2, 0.2, 0.5, 0.35, 0.45)), STONE, 0.3, rand);
      // a low plum tree with blossoms
      lam.add(cyl, AM(between(V(2.6, 0, -1.2), V(2.3, 1.3, -1.4), 0.07)), DARKWOOD);
      lam.add(cyl, AM(between(V(2.3, 1.3, -1.4), V(1.6, 1.9, -1.6), 0.045)), DARKWOOD);
      lam.add(cyl, AM(between(V(2.3, 1.3, -1.4), V(2.9, 2.0, -1.9), 0.04)), DARKWOOD);
      for (let i = 0; i < 40; i++) glow.add(blob, AM(M(2.3 + (rand() - 0.5) * 1.6, 1.6 + rand() * 0.6, -1.6 + (rand() - 0.5) * 0.9, 0, 0, 0, 0.02)), [0.32, 0.13, 0.19]);
    }
    if (a.id === 'pond') {
      lam.add(box, AM(M(0, 0.02, 0.1, 0, 0, 0, 2.4, 0.04, 1.4)), WOOD, 0.15, rand);
      for (let i = -5; i <= 5; i++) lam.add(box, AM(M(i * 0.22, 0.045, 0.1, 0, 0, 0, 0.012, 0.012, 1.4)), DARKWOOD);
    }
    if (a.id === 'bamboo') {
      for (let i = 0; i < 80; i++) {
        const ang = rand() * Math.PI * 2, d = 2.0 + rand() * 4.5;
        const lx = Math.cos(ang) * d, lz = Math.sin(ang) * d;
        if (lz < 0 && Math.abs(lx) < 1.2 && d < 3.2) continue;
        const h = 4 + rand() * 3.5, rad = 0.025 + rand() * 0.025, lean = (rand() - 0.5) * 0.12;
        const col = [0.22 + rand() * 0.08, 0.34 + rand() * 0.1, 0.16];
        lam.add(cyl, AM(M(lx, h / 2, lz, lean, 0, lean, rad, h, rad)), col);
        for (let k = 1; k < 6; k++) lam.add(cyl, AM(M(lx + lean * k * h / 6, k * h / 6, lz - lean * k * h / 6, lean, 0, lean, rad * 1.25, 0.03, rad * 1.25)), [col[0] * 0.8, col[1] * 0.8, col[2]]);
        for (let k = 0; k < 3; k++) lam.add(cone6, AM(M(lx + (rand() - 0.5) * 0.5, h * (0.7 + k * 0.1), lz + (rand() - 0.5) * 0.5, 0, rand() * 3, 0, 0.35, 0.5, 0.35)), [0.12, 0.22, 0.1], 0.3, rand);
      }
    }
    if (a.id === 'bridge') {
      const half = 7.0;
      lam.add(box, AM(M(0, -0.06, 0, 0, 0, 0, half * 2, 0.12, 1.3)), WOOD, 0.1, rand);
      for (let i = -12; i <= 12; i++) {
        for (const sz of [-0.62, 0.62]) lam.add(box, AM(M(i * 0.55, 0.42, sz, 0, 0, 0, 0.06, 0.85, 0.06)), [0.42, 0.13, 0.1]);
        if (i % 4 === 0 && Math.abs(i) < 12) lam.add(box, AM(M(i * 0.55, -0.3, 0, 0, 0, 0, 0.18, 0.5, 1.2)), STONE);
      }
      for (const sz of [-0.62, 0.62]) {
        lam.add(box, AM(M(0, 0.86, sz, 0, 0, 0, half * 1.9, 0.06, 0.09)), [0.45, 0.14, 0.1]);
        lam.add(box, AM(M(0, 0.45, sz, 0, 0, 0, half * 1.9, 0.03, 0.04)), [0.42, 0.13, 0.1]);
      }
      // willow on the far bank
      const wx = 1.6, wz = -5.6;
      lam.add(cyl, AM(between(V(wx, 0, wz), V(wx - 0.3, 2.4, wz + 0.2), 0.16)), DARKWOOD);
      for (let i = 0; i < 70; i++) {
        const a2 = rand() * Math.PI * 2, d = 0.3 + rand() * 1.6;
        const tx = wx - 0.3 + Math.cos(a2) * d, tz = wz + 0.2 + Math.sin(a2) * d, top = 2.6 + rand() * 0.6 - d * 0.25, len = 1.2 + rand() * 1.3;
        lam.add(box, AM(M(tx, top - len / 2, tz, 0, rand() * 3, 0, 0.05, len, 0.012)), [0.2, 0.32, 0.16], 0.3, rand);
      }
      for (let k = 0; k < 4; k++) lam.add(blob, AM(M(wx - 0.3 + (rand() - 0.5), 2.7 + rand() * 0.4, wz + 0.2 + (rand() - 0.5), 0, 0, 0, 1.1, 0.4, 1.0)), [0.18, 0.28, 0.14], 0.3, rand);
    }
    if (a.id === 'pavilion') {
      const R = 2.2;
      const hex = new THREE.CylinderGeometry(R + 0.3, R + 0.4, 0.12, 6);
      lam.add(hex, AM(M(0, -0.04, 0, 0, Math.PI / 6, 0)), [0.2, 0.19, 0.19], 0.1, rand); hex.dispose();
      for (let k = 0; k < 6; k++) {
        const an = k / 6 * Math.PI * 2, cx = Math.cos(an) * R, cz = Math.sin(an) * R;
        lam.add(cyl, AM(M(cx, 1.4, cz, 0, 0, 0, 0.09, 2.8, 0.09)), [0.45, 0.1, 0.08]);
        const an2 = an + Math.PI / 3, nx = Math.cos(an2) * R, nz = Math.sin(an2) * R;
        lam.add(cyl, AM(between(V(cx, 2.72, cz), V(nx, 2.72, nz), 0.06)), [0.4, 0.09, 0.07]);
        lam.add(cyl, AM(between(V(cx, 2.72, cz), V(0, 2.75, 0), 0.04)), [0.3, 0.07, 0.06]);
        const mid = Math.atan2(cz + nz, cx + nx);
        if (Math.abs(Math.sin(mid - (-Math.PI / 2))) > 0.3 || Math.cos(mid + Math.PI / 2) < 0)
          lam.add(cyl, AM(between(V(cx, 0.45, cz), V(nx, 0.45, nz), 0.05)), [0.4, 0.09, 0.07]);
      }
      lam.add(cone6, AM(M(0, 3.35, 0, 0, Math.PI / 6, 0, R + 0.9, 1.3, R + 0.9)), TILE);
      lam.add(cyl, AM(M(0, 4.1, 0, 0, 0, 0, 0.08, 0.4, 0.08)), [0.5, 0.4, 0.2]);
      lam.add(blob, AM(M(0, 4.35, 0, 0, 0, 0, 0.12)), [0.55, 0.45, 0.25]);
    }
  });

  // moss mounds and shrubs scattered near walls
  for (let i = 0; i < 40; i++) {
    const x = (rand() - 0.5) * 32, z = 4 - rand() * 38;
    if (AREAS.some(a => Math.hypot(x - a.x, z - a.z) < 3.2)) continue;
    if (ponds.some(p => ((x - p.x) / p.rx) ** 2 + ((z - p.z) / p.rz) ** 2 < 1.4)) continue;
    if (Math.abs(x) < 1.6 && z > -9 && z < 0) continue;
    lam.add(blob, M(x, 0.1, z, 0, rand() * 3, 0, 0.5 + rand() * 0.5, 0.3 + rand() * 0.25, 0.5 + rand() * 0.4), rand() < 0.5 ? MOSS : LEAF, 0.4, rand);
  }

  const lamMesh = lam.build(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const glowMesh = glow.build(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  scene.add(lamMesh); if (glowMesh) scene.add(glowMesh);
  for (const g of [box, cyl, cyl12, rock, blob, cone6, pad, petal, bowl]) g.dispose();

  scene.add(makeSky());
  return { ponds, lanternDefs, stoneLights, hintAnchors };
}

// Paper lantern body (lathe) with rib shading baked into vertex colours.
export function lanternGeometry() {
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, y = -0.12 + t * 0.24;
    pts.push(new THREE.Vector2(0.03 + 0.085 * Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * t)), 0.75), y));
  }
  const g = new THREE.LatheGeometry(pts, 18);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), a = Math.atan2(pos.getZ(i), pos.getX(i));
    const rib = 0.82 + 0.18 * Math.pow(Math.abs(Math.cos(a * 4.5)), 0.5);
    const band = Math.abs(y) > 0.085 ? 0.55 : 1;
    const v = rib * band; col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
export function lanternCapGeometry() {
  const a = new THREE.CylinderGeometry(0.045, 0.055, 0.03, 12); a.translate(0, 0.122, 0);
  const b = new THREE.CylinderGeometry(0.055, 0.045, 0.03, 12); b.translate(0, -0.122, 0);
  const c = new THREE.CylinderGeometry(0.004, 0.004, 0.07, 4); c.translate(0, -0.17, 0);
  const g = mergeGeometries([a, b, c]); a.dispose(); b.dispose(); c.dispose();
  return g;
}

// Koi: body + tail, nose toward -Z.
export function koiGeometry() {
  const body = new THREE.SphereGeometry(1, 10, 6); body.scale(0.055, 0.04, 0.17);
  const tail = new THREE.ConeGeometry(0.06, 0.12, 4); tail.rotateX(-Math.PI / 2); tail.scale(1, 0.25, 1); tail.translate(0, 0, 0.2);
  const g = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()]);
  body.dispose(); tail.dispose();
  return g;
}
