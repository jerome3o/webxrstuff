import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Low-poly procedural creature parts. Each part is ONE merged, vertex-coloured, flat-shaded geometry
// that the creature system draws with an InstancedMesh (one draw call per part per kind).
// A part is described as a list of primitives:
//   { s: 'ico'|'box'|'cyl'|'cone'|'oct'|'tet', d?: detail, r?, w?,h?,dd?, rt?,rb?,len?, at: [x,y,z], rot: [x,y,z], sc: [x,y,z], c: '#hex' }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

function prim(o) {
  let g;
  switch (o.s) {
    case 'box': g = new THREE.BoxGeometry(o.w ?? 1, o.h ?? 1, o.dd ?? 1); break;
    case 'cyl': g = new THREE.CylinderGeometry(o.rt ?? o.r ?? 0.5, o.rb ?? o.r ?? 0.5, o.len ?? 1, o.seg ?? 6); break;
    case 'cone': g = new THREE.ConeGeometry(o.r ?? 0.5, o.len ?? 1, o.seg ?? 5); break;
    case 'oct': g = new THREE.OctahedronGeometry(o.r ?? 0.5, o.d ?? 0); break;
    case 'tet': g = new THREE.TetrahedronGeometry(o.r ?? 0.5, 0); break;
    default: g = new THREE.IcosahedronGeometry(o.r ?? 0.5, o.d ?? 1);
  }
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  const sc = o.sc ?? [1, 1, 1], at = o.at ?? [0, 0, 0], rot = o.rot ?? [0, 0, 0];
  _m.compose(_p.set(at[0], at[1], at[2]), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(sc[0], sc[1], sc[2]));
  g.applyMatrix4(_m);
  // subtle per-face colour jitter → painterly facets
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  const base = _c.set(o.c ?? '#ffffff');
  const br = base.r, bg = base.g, bb = base.b;
  for (let f = 0; f < n; f += 3) {
    const j = 1 + (Math.sin(f * 12.9898 + (o.seed ?? 0)) * 0.5) * (o.jit ?? 0.08);
    for (let k = 0; k < 3; k++) { col[(f + k) * 3] = br * j; col[(f + k) * 3 + 1] = bg * j; col[(f + k) * 3 + 2] = bb * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildPart(list) {
  const gs = list.map(prim);
  const g = mergeGeometries(gs, false);
  for (const x of gs) x.dispose();
  g.computeBoundingSphere();
  return g;
}

// ── creature parts ─────────────────────────────────────────────
// Coordinates: creature-local, +Y up, facing −Z (forward), origin at the feet.
export const MODELS = {
  // Mossback: a round, loaf-shaped grazer wearing a mossy saddle with tiny flowers.
  mossback: {
    body: [
      { s: 'ico', r: 0.42, at: [0, 0.48, 0.02], sc: [1.0, 0.82, 1.18], c: '#e3cfae' },
      { s: 'ico', r: 0.4, at: [0, 0.66, 0.05], sc: [0.98, 0.5, 1.08], c: '#8fbf72', jit: 0.16 },
      { s: 'ico', r: 0.06, d: 0, at: [0.16, 0.86, -0.06], c: '#f2a7c3' },
      { s: 'ico', r: 0.05, d: 0, at: [-0.12, 0.85, 0.2], c: '#fff1b8' },
      { s: 'ico', r: 0.055, d: 0, at: [-0.05, 0.88, -0.14], c: '#f2a7c3' },
      { s: 'cone', r: 0.08, len: 0.18, at: [0, 0.5, 0.52], rot: [1.9, 0, 0], c: '#cbb38e' },
    ],
    head: [
      { s: 'ico', r: 0.22, at: [0, 0, -0.06], sc: [1, 0.92, 1.05], c: '#efdfc4' },
      { s: 'ico', r: 0.1, d: 0, at: [0, -0.06, -0.24], sc: [1.2, 0.8, 0.8], c: '#f2c9b8' },
      { s: 'box', w: 0.045, h: 0.06, dd: 0.02, at: [-0.1, 0.05, -0.24], c: '#2e2838' },
      { s: 'box', w: 0.045, h: 0.06, dd: 0.02, at: [0.1, 0.05, -0.24], c: '#2e2838' },
      { s: 'cone', r: 0.07, len: 0.22, at: [-0.2, 0.14, 0], rot: [0, 0, 0.9], sc: [1, 1, 0.4], c: '#8fbf72' },
      { s: 'cone', r: 0.07, len: 0.22, at: [0.2, 0.14, 0], rot: [0, 0, -0.9], sc: [1, 1, 0.4], c: '#8fbf72' },
    ],
    legsA: [
      { s: 'cyl', rt: 0.07, rb: 0.08, len: 0.3, at: [-0.2, -0.15, -0.24], c: '#a88f6e' },
      { s: 'cyl', rt: 0.07, rb: 0.08, len: 0.3, at: [0.2, -0.15, 0.26], c: '#a88f6e' },
    ],
    legsB: [
      { s: 'cyl', rt: 0.07, rb: 0.08, len: 0.3, at: [0.2, -0.15, -0.24], c: '#a88f6e' },
      { s: 'cyl', rt: 0.07, rb: 0.08, len: 0.3, at: [-0.2, -0.15, 0.26], c: '#a88f6e' },
    ],
  },
  // Hornbloom: tall, slender browser whose antlers grow little blossoms. Neutral.
  hornbloom: {
    body: [
      { s: 'ico', r: 0.38, at: [0, 1.0, 0.05], sc: [0.85, 0.8, 1.45], c: '#e9c7b9' },
      { s: 'ico', r: 0.3, at: [0, 0.96, 0.05], sc: [0.8, 0.5, 1.35], c: '#f6e6da' },
      { s: 'cone', r: 0.1, len: 0.25, at: [0, 1.08, 0.6], rot: [-1.2, 0, 0], c: '#f6e6da' },
      { s: 'cyl', rt: 0.11, rb: 0.14, len: 0.55, at: [0, 1.35, -0.38], rot: [-0.5, 0, 0], c: '#e9c7b9' },
    ],
    head: [
      { s: 'ico', r: 0.17, at: [0, 0, -0.08], sc: [0.9, 0.9, 1.4], c: '#e9c7b9' },
      { s: 'ico', r: 0.08, d: 0, at: [0, -0.05, -0.3], c: '#c98f8f' },
      { s: 'box', w: 0.04, h: 0.05, dd: 0.02, at: [-0.11, 0.04, -0.17], c: '#2e2838' },
      { s: 'box', w: 0.04, h: 0.05, dd: 0.02, at: [0.11, 0.04, -0.17], c: '#2e2838' },
      { s: 'cyl', r: 0.025, len: 0.38, at: [-0.12, 0.26, 0.02], rot: [0.2, 0, 0.35], c: '#efe3cc' },
      { s: 'cyl', r: 0.025, len: 0.38, at: [0.12, 0.26, 0.02], rot: [0.2, 0, -0.35], c: '#efe3cc' },
      { s: 'cyl', r: 0.02, len: 0.18, at: [-0.24, 0.36, 0.02], rot: [0, 0, 1.1], c: '#efe3cc' },
      { s: 'cyl', r: 0.02, len: 0.18, at: [0.24, 0.36, 0.02], rot: [0, 0, -1.1], c: '#efe3cc' },
      { s: 'ico', r: 0.06, d: 0, at: [-0.19, 0.44, 0.06], c: '#f49ab8' },
      { s: 'ico', r: 0.06, d: 0, at: [0.19, 0.44, 0.06], c: '#fbd36e' },
      { s: 'ico', r: 0.05, d: 0, at: [-0.32, 0.4, 0.02], c: '#fbd36e' },
      { s: 'ico', r: 0.05, d: 0, at: [0.32, 0.4, 0.02], c: '#f49ab8' },
      { s: 'cone', r: 0.06, len: 0.16, at: [-0.16, 0.08, 0.06], rot: [0, 0, 1.3], sc: [1, 1, 0.4], c: '#e9c7b9' },
      { s: 'cone', r: 0.06, len: 0.16, at: [0.16, 0.08, 0.06], rot: [0, 0, -1.3], sc: [1, 1, 0.4], c: '#e9c7b9' },
    ],
    legsA: [
      { s: 'cyl', rt: 0.055, rb: 0.04, len: 0.8, at: [-0.17, -0.4, -0.38], c: '#cfa595' },
      { s: 'cyl', rt: 0.055, rb: 0.04, len: 0.8, at: [0.17, -0.4, 0.42], c: '#cfa595' },
    ],
    legsB: [
      { s: 'cyl', rt: 0.055, rb: 0.04, len: 0.8, at: [0.17, -0.4, -0.38], c: '#cfa595' },
      { s: 'cyl', rt: 0.055, rb: 0.04, len: 0.8, at: [-0.17, -0.4, 0.42], c: '#cfa595' },
    ],
  },
  // Sky kite: a diamond-bodied glider with long ribbon tail.
  skykite: {
    body: [
      { s: 'oct', r: 0.22, at: [0, 0, 0], sc: [0.7, 0.55, 1.6], c: '#f4f6ff' },
      { s: 'oct', r: 0.1, at: [0, 0.03, -0.3], sc: [0.8, 0.8, 1.2], c: '#a9cdf2' },
      { s: 'cone', r: 0.035, len: 0.12, at: [0, 0.02, -0.46], rot: [-Math.PI / 2, 0, 0], c: '#f6c66e' },
      { s: 'box', w: 0.03, h: 0.01, dd: 0.5, at: [0, 0, 0.55], c: '#e58f9f' },
      { s: 'box', w: 0.1, h: 0.01, dd: 0.08, at: [0, 0, 0.82], rot: [0, 0.78, 0], c: '#e58f9f' },
    ],
    wingL: [
      { s: 'box', w: 0.7, h: 0.025, dd: 0.32, at: [-0.36, 0, 0.02], c: '#cfe3f8' },
      { s: 'box', w: 0.3, h: 0.026, dd: 0.18, at: [-0.62, 0.001, 0.08], c: '#8db8e8' },
    ],
    wingR: [
      { s: 'box', w: 0.7, h: 0.025, dd: 0.32, at: [0.36, 0, 0.02], c: '#cfe3f8' },
      { s: 'box', w: 0.3, h: 0.026, dd: 0.18, at: [0.62, 0.001, 0.08], c: '#8db8e8' },
    ],
  },
  // Lantern moth: fuzzy night flier with a glowing abdomen.
  lanternmoth: {
    body: [
      { s: 'ico', r: 0.07, d: 0, at: [0, 0, -0.05], c: '#efe6d2' },
      { s: 'cone', r: 0.012, len: 0.12, at: [-0.04, 0.06, -0.12], rot: [-0.7, 0, 0.4], c: '#c9b98f' },
      { s: 'cone', r: 0.012, len: 0.12, at: [0.04, 0.06, -0.12], rot: [-0.7, 0, -0.4], c: '#c9b98f' },
    ],
    wingL: [{ s: 'box', w: 0.22, h: 0.01, dd: 0.18, at: [-0.12, 0, 0.0], rot: [0, 0.25, 0], c: '#d9c7f0' }, { s: 'box', w: 0.12, h: 0.012, dd: 0.1, at: [-0.16, 0.002, 0.03], c: '#b7a2e0' }],
    wingR: [{ s: 'box', w: 0.22, h: 0.01, dd: 0.18, at: [0.12, 0, 0.0], rot: [0, -0.25, 0], c: '#d9c7f0' }, { s: 'box', w: 0.12, h: 0.012, dd: 0.1, at: [0.16, 0.002, 0.03], c: '#b7a2e0' }],
    glow: [{ s: 'ico', r: 0.065, d: 0, at: [0, -0.01, 0.08], sc: [0.9, 0.9, 1.4], c: '#ffe08a' }],
  },
  // Glimmerfin: a small teal fish with a gold stripe.
  glimmerfin: {
    body: [
      { s: 'oct', r: 0.14, at: [0, 0, 0], sc: [0.55, 0.9, 1.6], c: '#6cc9c0' },
      { s: 'oct', r: 0.1, at: [0, 0.005, 0], sc: [0.6, 0.25, 2.0], c: '#f6d77a' },
      { s: 'box', w: 0.02, h: 0.02, dd: 0.02, at: [-0.07, 0.03, -0.14], c: '#2e2838' },
      { s: 'box', w: 0.02, h: 0.02, dd: 0.02, at: [0.07, 0.03, -0.14], c: '#2e2838' },
      { s: 'cone', r: 0.04, len: 0.1, at: [0, 0.12, 0.02], sc: [0.3, 1, 1], c: '#3f9e9f' },
    ],
    tail: [{ s: 'cone', r: 0.1, len: 0.14, at: [0, 0, 0.07], rot: [-Math.PI / 2, 0, 0], sc: [0.25, 1, 1], c: '#3f9e9f' }],
  },
  // Ink shade: a burrowing drip of night-ink with lamp eyes.
  inkshade: {
    body: [
      { s: 'ico', r: 0.42, d: 1, at: [0, 0.55, 0], sc: [1, 1.15, 1], c: '#5e4f9a', jit: 0.2 },
      { s: 'ico', r: 0.3, d: 1, at: [0, 0.95, 0.05], sc: [1, 1, 1], c: '#7060ae', jit: 0.2 },
      { s: 'cone', r: 0.1, len: 0.3, at: [0.12, 1.25, 0.1], rot: [0.3, 0, -0.3], c: '#7060ae' },
    ],
    drips: [
      { s: 'cone', r: 0.12, len: 0.35, at: [-0.25, 0.15, -0.15], rot: [Math.PI, 0, 0.2], c: '#4a3d80' },
      { s: 'cone', r: 0.1, len: 0.3, at: [0.28, 0.15, 0.05], rot: [Math.PI, 0, -0.2], c: '#4a3d80' },
      { s: 'cone', r: 0.11, len: 0.32, at: [0.0, 0.15, 0.3], rot: [Math.PI, 0.3, 0], c: '#4a3d80' },
      { s: 'cone', r: 0.09, len: 0.28, at: [0.05, 0.14, -0.3], rot: [Math.PI, 0, 0.1], c: '#4a3d80' },
    ],
    eyes: [
      { s: 'ico', r: 0.075, d: 0, at: [-0.13, 0.98, -0.27], sc: [1, 1.3, 0.6], c: '#a8f6ff' },
      { s: 'ico', r: 0.075, d: 0, at: [0.13, 0.98, -0.27], sc: [1, 1.3, 0.6], c: '#a8f6ff' },
    ],
  },
  // Cragcrab: slate-shelled cave crab with skyglass crystals growing on its back.
  cragcrab: {
    shell: [
      { s: 'ico', r: 0.42, d: 1, at: [0, 0.38, 0], sc: [1.25, 0.55, 1], c: '#8e9aae', jit: 0.14 },
      { s: 'ico', r: 0.3, d: 0, at: [0, 0.5, 0.05], sc: [1.1, 0.5, 0.9], c: '#a7b1c2', jit: 0.12 },
      { s: 'ico', r: 0.15, d: 0, at: [0.25, 0.5, 0.15], sc: [1, 0.5, 1], c: '#6f8a6a' },
      { s: 'cyl', r: 0.025, len: 0.16, at: [-0.1, 0.5, -0.36], rot: [0.3, 0, 0], c: '#68738a' },
      { s: 'cyl', r: 0.025, len: 0.16, at: [0.1, 0.5, -0.36], rot: [0.3, 0, 0], c: '#68738a' },
      { s: 'ico', r: 0.045, d: 0, at: [-0.1, 0.59, -0.39], c: '#1d1830' },
      { s: 'ico', r: 0.045, d: 0, at: [0.1, 0.59, -0.39], c: '#1d1830' },
    ],
    crystals: [
      { s: 'oct', r: 0.12, at: [-0.15, 0.68, 0.05], sc: [0.6, 1.6, 0.6], rot: [0.2, 0, 0.25], c: '#74dcef' },
      { s: 'oct', r: 0.09, at: [0.05, 0.66, -0.08], sc: [0.6, 1.5, 0.6], rot: [-0.2, 0, -0.2], c: '#9be8f6' },
      { s: 'oct', r: 0.07, at: [-0.02, 0.64, 0.2], sc: [0.6, 1.4, 0.6], rot: [0.3, 0, 0.1], c: '#5fd2e8' },
    ],
    clawL: [
      { s: 'cyl', r: 0.05, len: 0.25, at: [0, 0, -0.1], rot: [Math.PI / 2, 0, 0], c: '#7d889c' },
      { s: 'ico', r: 0.13, d: 0, at: [0, 0.02, -0.28], sc: [0.8, 0.7, 1.2], c: '#a7b1c2' },
      { s: 'cone', r: 0.05, len: 0.16, at: [0.03, 0.05, -0.42], rot: [-Math.PI / 2, 0, 0], c: '#d9dee8' },
    ],
    clawR: [
      { s: 'cyl', r: 0.05, len: 0.25, at: [0, 0, -0.1], rot: [Math.PI / 2, 0, 0], c: '#7d889c' },
      { s: 'ico', r: 0.13, d: 0, at: [0, 0.02, -0.28], sc: [0.8, 0.7, 1.2], c: '#a7b1c2' },
      { s: 'cone', r: 0.05, len: 0.16, at: [-0.03, 0.05, -0.42], rot: [-Math.PI / 2, 0, 0], c: '#d9dee8' },
    ],
    legs: [-1, 1].flatMap(sx => [-0.18, 0.02, 0.22].map(z => (
      { s: 'cyl', rt: 0.035, rb: 0.02, len: 0.42, at: [sx * 0.5, 0.18, z], rot: [0, 0, sx * 0.9], c: '#68738a' }))),
  },
  // Deep wyrm: a segmented burrowing serpent of slate plates with an ember heart (boss).
  deepwyrm: {
    head: [
      { s: 'oct', r: 0.75, at: [0, 0, -0.2], sc: [0.95, 0.75, 1.5], c: '#5a6788', jit: 0.12 },
      { s: 'box', w: 0.9, h: 0.18, dd: 0.9, at: [0, -0.35, -0.55], c: '#3c4562' },
      { s: 'cone', r: 0.14, len: 0.6, at: [-0.4, 0.45, 0.25], rot: [0.9, 0, 0.4], c: '#c9d6f5' },
      { s: 'cone', r: 0.14, len: 0.6, at: [0.4, 0.45, 0.25], rot: [0.9, 0, -0.4], c: '#c9d6f5' },
      { s: 'cone', r: 0.06, len: 0.25, at: [-0.25, -0.4, -1.0], rot: [Math.PI, 0, 0], c: '#efe6d2' },
      { s: 'cone', r: 0.06, len: 0.25, at: [0.25, -0.4, -1.0], rot: [Math.PI, 0, 0], c: '#efe6d2' },
    ],
    eyes: [
      { s: 'ico', r: 0.12, d: 0, at: [-0.36, 0.18, -0.8], sc: [1, 0.6, 1], c: '#ffb38a' },
      { s: 'ico', r: 0.12, d: 0, at: [0.36, 0.18, -0.8], sc: [1, 0.6, 1], c: '#ffb38a' },
    ],
    seg: [
      { s: 'ico', r: 0.62, d: 0, at: [0, 0, 0], sc: [1, 0.9, 1.1], c: '#6f82ad', jit: 0.16 },
      { s: 'oct', r: 0.3, at: [0, 0.5, 0.1], sc: [0.5, 1, 1.2], c: '#c9d6f5' },
      { s: 'box', w: 0.8, h: 0.12, dd: 0.7, at: [0, -0.45, 0], c: '#4a5a82' },
    ],
    core: [{ s: 'ico', r: 0.24, d: 0, at: [0, 0, 0], c: '#ff9a6a' }],
  },
};

// The death pouch and the laid-out bedroll (plain meshes, only a few exist).
export function pouchGeometry() {
  return buildPart([
    { s: 'ico', r: 0.22, d: 1, at: [0, 0.2, 0], sc: [1, 0.9, 1], c: '#b98d63' },
    { s: 'cyl', rt: 0.07, rb: 0.12, len: 0.12, at: [0, 0.42, 0], c: '#a57a52' },
    { s: 'cyl', r: 0.13, len: 0.03, at: [0, 0.38, 0], c: '#e58f9f' },
    { s: 'ico', r: 0.06, d: 0, at: [0, 0.2, -0.2], c: '#ffd27a' },
  ]);
}
export function bedrollGeometry() {
  return buildPart([
    { s: 'box', w: 0.8, h: 0.08, dd: 1.7, at: [0, 0.04, 0.1], c: '#e58f9f' },
    { s: 'box', w: 0.82, h: 0.09, dd: 0.06, at: [0, 0.045, -0.2], c: '#f3c1cb' },
    { s: 'box', w: 0.82, h: 0.09, dd: 0.06, at: [0, 0.045, 0.4], c: '#f3c1cb' },
    { s: 'cyl', r: 0.16, len: 0.82, at: [0, 0.16, 0.86], rot: [0, 0, Math.PI / 2], c: '#e9d1b8', seg: 8 },
    { s: 'box', w: 0.5, h: 0.12, dd: 0.3, at: [0, 0.1, -0.62], c: '#f8e4d0' },
  ]);
}
