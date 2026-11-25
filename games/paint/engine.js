import * as THREE from 'three';
import { makeInkTexture, makeGlowTexture, makeRibbonShadeTexture, makeLeafTexture, hsvToRgb, rgbToHsv } from './textures.js';

// ── Stroke engine ────────────────────────────────────────────
// Strokes are stored as point lists (position, side, normal, pressure) in the
// local space of the painting root. Geometry is generated into a few large,
// preallocated chunks per brush material (one draw call per chunk), appended
// incrementally while painting. Removing a stroke compacts its chunk.

export const MAXV = 32768;          // vertices per chunk (Uint16 indices)
export const MAXI = MAXV * 6;
const TUBE = 6;

export const BRUSHES = [
  { id: 'ink', name: 'Ink Wash', glyph: '墨', vpp: 2, ipp: 6 },
  { id: 'flat', name: 'Flat Ribbon', glyph: '帶', vpp: 2, ipp: 6 },
  { id: 'tube', name: 'Tube', glyph: '管', vpp: TUBE, ipp: TUBE * 6 },
  { id: 'neon', name: 'Neon Glow', glyph: '光', vpp: 4, ipp: 12 },
  { id: 'spark', name: 'Sparkle', glyph: '星', vpp: 4, ipp: 6 },
  { id: 'leaf', name: 'Bamboo Leaf', glyph: '竹', vpp: 4, ipp: 6 },
  { id: 'grad', name: 'Gradient', glyph: '虹', vpp: 2, ipp: 6 },
];
export const SYMS = ['Off', 'Mirror', 'Radial ×6'];
const COPIES = [1, 2, 6];
export const SYM_C = { x: 0, z: -1.3 };   // symmetry axis / plane position (painting-local)

const RAD = [0, 1, 2, 3, 4, 5].map(k => [Math.cos(k * Math.PI / 3), Math.sin(k * Math.PI / 3)]);

function hrand(seed, i, k) {
  let h = Math.imul(seed ^ Math.imul(i + 1, 374761393) ^ Math.imul(k + 1, 668265263), 1274126177);
  h ^= h >>> 13; h = Math.imul(h, 1103515245); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth01 = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const s2l = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

// scratch outputs of the symmetry transforms (no allocation in the emit loop)
const OP = new Float64Array(3), OS = new Float64Array(3), ON = new Float64Array(3);
const HSV = { r: 0, g: 0, b: 0 };
const LEAF_C = [-1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, -1, 1, 0, 1];

function xp(sym, c, x, y, z, out) {
  if (c === 0) { out[0] = x; out[1] = y; out[2] = z; return; }
  if (sym === 1) { out[0] = 2 * SYM_C.x - x; out[1] = y; out[2] = z; return; }
  const [co, si] = RAD[c], dx = x - SYM_C.x, dz = z - SYM_C.z;
  out[0] = SYM_C.x + dx * co + dz * si; out[1] = y; out[2] = SYM_C.z - dx * si + dz * co;
}
// isSide: the ribbon side vector is negated after a mirror so winding stays consistent with the normal
function xv(sym, c, x, y, z, out, isSide) {
  if (c === 0) { out[0] = x; out[1] = y; out[2] = z; return; }
  if (sym === 1) { if (isSide) { out[0] = x; out[1] = -y; out[2] = -z; } else { out[0] = -x; out[1] = y; out[2] = z; } return; }
  const [co, si] = RAD[c];
  out[0] = x * co + z * si; out[1] = y; out[2] = -x * si + z * co;
}

export class Stroke {
  constructor(brush, hex, size, sym = 0, seed = null) {
    this.brush = brush; this.b = BRUSHES[brush]; this.hex = hex; this.size = size; this.sym = sym; this.copies = COPIES[sym];
    this.seed = seed ?? ((Math.random() * 2147483647) | 0);
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, bl = (hex & 255) / 255;
    this.lr = s2l(r); this.lg = s2l(g); this.lb = s2l(bl);
    this.hsv = rgbToHsv(r, g, bl);
    this.cap = 0; this.n = 0;
    this.pos = this.side = this.nrm = this.prs = this.dist = null;
    this.ensure(64);
    this.min = [Infinity, Infinity, Infinity]; this.max = [-Infinity, -Infinity, -Infinity];
    this.chunk = null; this.vStart = 0; this.iStart = 0; this.emitted = 0; this.finished = false;
    this.prevBase = new Int32Array(6).fill(-1); this.lastStamp = -1e9; this.stampN = 0;
  }
  ensure(n) {
    if (n <= this.cap) return;
    let cap = Math.max(64, this.cap * 2); while (cap < n) cap *= 2;
    const grow = (a, k) => { const b = new Float32Array(cap * k); if (a) b.set(a.subarray(0, this.n * k)); return b; };
    this.pos = grow(this.pos, 3); this.side = grow(this.side, 3); this.nrm = grow(this.nrm, 3);
    this.prs = grow(this.prs, 1); this.dist = grow(this.dist, 1);
    this.cap = cap;
  }
  push(x, y, z, sx, sy, sz, nx, ny, nz, p) {
    const n = this.n; this.ensure(n + 1);
    const o = n * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z;
    this.side[o] = sx; this.side[o + 1] = sy; this.side[o + 2] = sz;
    this.nrm[o] = nx; this.nrm[o + 1] = ny; this.nrm[o + 2] = nz;
    this.prs[n] = p;
    if (n === 0) this.dist[0] = 0;
    else {
      const dx = x - this.pos[o - 3], dy = y - this.pos[o - 2], dz = z - this.pos[o - 1];
      this.dist[n] = this.dist[n - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (n === 1 && this.autoFirst) { this.side.copyWithin(0, 3, 6); this.nrm.copyWithin(0, 3, 6); }
    }
    if (x < this.min[0]) this.min[0] = x; if (y < this.min[1]) this.min[1] = y; if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x; if (y > this.max[1]) this.max[1] = y; if (z > this.max[2]) this.max[2] = z;
    this.n = n + 1;
  }
  resetPoints() { this.n = 0; this.min.fill(Infinity); this.max.fill(-Infinity); }
  get perPointV() { return this.b.vpp * this.copies; }
  get perPointI() { return this.b.ipp * this.copies; }
  get length() { return this.n ? this.dist[this.n - 1] : 0; }
}

class Chunk {
  constructor(key, material, root) {
    this.key = key;
    this.pos = new Float32Array(MAXV * 3); this.nrm = new Float32Array(MAXV * 3);
    this.col = new Float32Array(MAXV * 4); this.uv = new Float32Array(MAXV * 2);
    this.idx = new Uint16Array(MAXI);
    const g = this.geo = new THREE.BufferGeometry();
    const mk = (arr, k) => new THREE.BufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [[mk(this.pos, 3), 3], [mk(this.nrm, 3), 3], [mk(this.col, 4), 4], [mk(this.uv, 2), 2]];
    g.setAttribute('position', this.attrs[0][0]); g.setAttribute('normal', this.attrs[1][0]);
    g.setAttribute('color', this.attrs[2][0]); g.setAttribute('uv', this.attrs[3][0]);
    this.index = mk(this.idx, 1); g.setIndex(this.index);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = material.userData.order ?? 0;
    root.add(this.mesh);
    this.v = 0; this.i = 0; this.strokes = [];
    this.dv0 = Infinity; this.di0 = Infinity; this.dirty = false;
  }
  markFrom(v, i) { if (v < this.dv0) this.dv0 = v; if (i < this.di0) this.di0 = i; this.dirty = true; }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.v > this.dv0) for (const [a, k] of this.attrs) { a.clearUpdateRanges(); a.addUpdateRange(this.dv0 * k, (this.v - this.dv0) * k); a.needsUpdate = true; }
    if (this.i > this.di0) { this.index.clearUpdateRanges(); this.index.addUpdateRange(this.di0, this.i - this.di0); this.index.needsUpdate = true; }
    this.geo.setDrawRange(0, this.i);
    this.mesh.visible = this.i > 0;
    this.dv0 = this.di0 = Infinity;
  }
  vert(x, y, z, nx, ny, nz, r, g, b, a, u, v) {
    const k = this.v++, o3 = k * 3, o4 = k * 4, o2 = k * 2;
    this.pos[o3] = x; this.pos[o3 + 1] = y; this.pos[o3 + 2] = z;
    this.nrm[o3] = nx; this.nrm[o3 + 1] = ny; this.nrm[o3 + 2] = nz;
    this.col[o4] = r; this.col[o4 + 1] = g; this.col[o4 + 2] = b; this.col[o4 + 3] = a;
    this.uv[o2] = u; this.uv[o2 + 1] = v;
    return k;
  }
  tri(a, b, c) { const i = this.i; this.idx[i] = a; this.idx[i + 1] = b; this.idx[i + 2] = c; this.i = i + 3; }
}

export class Engine {
  constructor(root) {
    this.root = root;
    this.strokes = [];
    this.chunks = {};
    this.tex = { ink: makeInkTexture(), glow: makeGlowTexture(), shade: makeRibbonShadeTexture(), leaf: makeLeafTexture() };
    this.uTime = { value: 0 };
    this.uAdd = { value: 1 };
    this.mats = this._makeMaterials();
  }

  _makeMaterials() {
    const D = THREE.DoubleSide, t = this.tex;
    const ink = new THREE.MeshBasicMaterial({ map: t.ink, vertexColors: true, transparent: true, depthWrite: false, side: D, toneMapped: false });
    ink.userData.order = 1;
    const flat = new THREE.MeshLambertMaterial({ vertexColors: true, side: D });
    const tube = new THREE.MeshLambertMaterial({ vertexColors: true });
    const neon = new THREE.MeshBasicMaterial({ map: t.glow, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: D, toneMapped: false });
    neon.userData.order = 3;
    const spark = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uAdd: this.uAdd },
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main() {
          vUv = uv; vCol = color.rgb;
          float tw = 0.55 + 0.45 * sin(uTime * 2.7 + color.a * 37.0);
          vA = tw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float sc = length(modelMatrix[0].xyz);
          mv.xy += normal.xy * normal.z * sc * (0.8 + 0.4 * tw);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uAdd;
        varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main() {
          vec2 q = vUv * 2.0 - 1.0; float r = length(q);
          float core = exp(-r * r * 9.0);
          float star = max(0.0, 1.0 - abs(q.x) * 12.0) * max(0.0, 1.0 - abs(q.y)) + max(0.0, 1.0 - abs(q.y) * 12.0) * max(0.0, 1.0 - abs(q.x));
          float glowA = clamp(core + star * 0.7, 0.0, 1.0) * vA;
          float dotA = smoothstep(0.62, 0.48, r) * 0.95;
          float a = mix(dotA, glowA, uAdd);
          if (a < 0.01) discard;
          vec3 col = mix(vCol, mix(vCol, vec3(1.0), core * 0.6), uAdd);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    spark.userData.order = 4;
    const leaf = new THREE.MeshBasicMaterial({ map: t.leaf, vertexColors: true, alphaTest: 0.4, side: D, toneMapped: false });
    const grad = new THREE.MeshBasicMaterial({ map: t.shade, vertexColors: true, side: D, toneMapped: false, alphaTest: 0.5 });
    return { ink, flat, tube, neon, spark, leaf, grad };
  }

  // Light backgrounds: additive brushes become normal-blended so they stay visible.
  setLightBackground(light) {
    const bl = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [this.mats.neon, this.mats.spark]) if (m.blending !== bl) { m.blending = bl; m.needsUpdate = true; }
    this.uAdd.value = light ? 0 : 1;
    this._light = light;
  }

  drawCalls() { let n = 0; for (const k in this.chunks) for (const c of this.chunks[k]) if (c.mesh.visible) n++; return n; }
  chunkCount() { let n = 0; for (const k in this.chunks) n += this.chunks[k].length; return n; }
  pointCount() { let n = 0; for (const s of this.strokes) n += s.n; return n; }

  _chunkWithSpace(key, needV, needI) {
    const list = this.chunks[key] ?? (this.chunks[key] = []);
    for (const c of list) if (c.v + needV <= MAXV && c.i + needI <= MAXI) return c;
    const c = new Chunk(key, this.mats[key], this.root);
    list.push(c);
    return c;
  }
  maxPoints(s) { return Math.floor((MAXV - 64) / s.perPointV); }

  // ── live stroke API ──
  begin(brush, hex, size, sym) {
    const s = new Stroke(brush, hex, size, sym);
    s.autoFirst = true;
    this._attach(s, 64);
    this.strokes.push(s);
    return s;
  }
  _attach(s, points) {
    const c = this._chunkWithSpace(s.b.id, points * s.perPointV + 8, points * s.perPointI + 8);
    s.chunk = c; s.vStart = c.v; s.iStart = c.i; c.strokes.push(s);
  }
  // Emit any points not yet turned into geometry. Returns false if the stroke can't grow further.
  pump(s) {
    if (s.n < 2) return true;
    const c = s.chunk;
    const needV = (s.n - s.emitted) * s.perPointV, needI = (s.n - s.emitted) * s.perPointI;
    if (c.v + needV > MAXV || c.i + needI > MAXI) {
      if (s.n * s.perPointV + 8 > MAXV) return false;
      // move the stroke (always last in its chunk while live) to a chunk with room
      this._detachTail(s);
      this._attach(s, Math.max(256, s.n * 2));
      this._emitAll(s);
      return true;
    }
    c.markFrom(c.v, c.i);
    while (s.emitted < s.n) this._emit(s, s.emitted++);
    return true;
  }
  // Re-generate a stroke that is the last one in its chunk (taper on finish, straight-line preview).
  reemit(s) {
    const c = s.chunk;
    if (c.strokes[c.strokes.length - 1] !== s) { this._rebuild(c); return; }
    c.v = s.vStart; c.i = s.iStart; c.markFrom(c.v, c.i);
    if (s.n >= 2) this._emitAll(s);
  }
  finish(s) {
    if (s.n < 2) { this.remove(s); return false; }
    s.finished = true;
    this.reemit(s);
    return true;
  }
  _detachTail(s) {
    const c = s.chunk; c.strokes.pop(); c.v = s.vStart; c.i = s.iStart; c.markFrom(c.v, c.i);
  }
  remove(s) {
    const k = this.strokes.indexOf(s); if (k >= 0) this.strokes.splice(k, 1);
    const c = s.chunk; if (!c) return;
    const j = c.strokes.indexOf(s);
    if (j === c.strokes.length - 1) this._detachTail(s);
    else if (j >= 0) { c.strokes.splice(j, 1); this._rebuild(c); }
    s.chunk = null;
  }
  // Add a complete stroke (redo / load / demo).
  add(s) {
    s.finished = true;
    const lim = this.maxPoints(s);
    if (s.n > lim) s.n = lim;
    if (s.n < 2) return false;
    this._attach(s, s.n);
    this._emitAll(s);
    this.strokes.push(s);
    return true;
  }
  clear() {
    this.strokes.length = 0;
    for (const k in this.chunks) for (const c of this.chunks[k]) { for (const s of c.strokes) s.chunk = null; c.strokes.length = 0; c.v = c.i = 0; c.markFrom(0, 0); }
  }
  flush() { for (const k in this.chunks) for (const c of this.chunks[k]) c.flush(); }

  _rebuild(c) {
    c.v = 0; c.i = 0; c.markFrom(0, 0);
    for (const s of c.strokes) { s.vStart = c.v; s.iStart = c.i; this._emitAll(s); }
  }
  _emitAll(s) {
    s.emitted = 0; s.prevBase.fill(-1); s.lastStamp = -1e9; s.stampN = 0;
    const c = s.chunk; s.vStart = c.v; s.iStart = c.i; c.markFrom(c.v, c.i);
    if (s.n < 2) return;
    while (s.emitted < s.n) this._emit(s, s.emitted++);
  }

  // ── geometry for one point (all symmetry copies) ──
  _emit(s, i) {
    const c = s.chunk, b = s.b.id, sym = s.sym, copies = s.copies, size = s.size;
    const o = i * 3, P = s.pos, S = s.side, N = s.nrm;
    const px = P[o], py = P[o + 1], pz = P[o + 2];
    const sx = S[o], sy = S[o + 1], sz = S[o + 2], nx = N[o], ny = N[o + 1], nz = N[o + 2];
    const p = s.prs[i], d = s.dist[i], total = s.dist[s.n - 1];
    const TL = Math.max(size * 2.5, 0.012);
    const tp = Math.min(smooth01(d / TL), s.finished ? smooth01((total - d) / TL) : 1);
    let r = s.lr, g = s.lg, bl = s.lb;

    if (b === 'ink' || b === 'flat' || b === 'grad' || b === 'neon') {
      let w, a = 1, u = 0, r2 = r, g2 = g, b2 = bl;
      if (b === 'ink') {
        w = size * 0.5 * (0.3 + 0.7 * p) * (0.12 + 0.88 * tp);
        a = Math.min(1, (0.1 + 0.95 * Math.pow(p, 1.15)) * (0.6 + 0.4 * tp));
        u = d / (size * 3.5);
      } else if (b === 'neon') {
        w = size * 0.5 * (0.6 + 0.4 * p) * (0.25 + 0.75 * tp) * 1.8;
        a = 0.5 + 0.5 * p;
        const k = this._light ? 1 : 1.5; r *= k; g *= k; bl *= k; r2 = r; g2 = g; b2 = bl;
      } else {
        w = size * 0.5 * (0.45 + 0.55 * p) * (0.45 + 0.55 * tp);
        if (b === 'grad') {
          const h = s.hsv, ph = (s.seed & 255) / 40;
          hsvToRgb((h.h + 0.16 * Math.sin(d * 2.4 + ph) + 1) % 1, h.s, h.v, HSV);
          r = s2l(HSV.r); g = s2l(HSV.g); bl = s2l(HSV.b);
          hsvToRgb((h.h + 0.1 + 0.16 * Math.sin(d * 2.4 + ph + 1.2) + 1) % 1, h.s * 0.75, Math.min(1, h.v * 1.1 + 0.1), HSV);
          r2 = s2l(HSV.r); g2 = s2l(HSV.g); b2 = s2l(HSV.b);
        } else { r2 = r; g2 = g; b2 = bl; }
      }
      for (let k = 0; k < copies; k++) {
        xp(sym, k, px, py, pz, OP); xv(sym, k, sx, sy, sz, OS, true); xv(sym, k, nx, ny, nz, ON, false);
        const X = OP[0], Y = OP[1], Z = OP[2];
        const base = c.vert(X - OS[0] * w, Y - OS[1] * w, Z - OS[2] * w, ON[0], ON[1], ON[2], r, g, bl, a, u, 0);
        c.vert(X + OS[0] * w, Y + OS[1] * w, Z + OS[2] * w, ON[0], ON[1], ON[2], r2, g2, b2, a, u, 1);
        if (b === 'neon') {
          c.vert(X - ON[0] * w, Y - ON[1] * w, Z - ON[2] * w, OS[0], OS[1], OS[2], r, g, bl, a, u, 0);
          c.vert(X + ON[0] * w, Y + ON[1] * w, Z + ON[2] * w, OS[0], OS[1], OS[2], r, g, bl, a, u, 1);
        }
        const pb = s.prevBase[k];
        if (pb >= 0) {
          c.tri(pb, pb + 1, base); c.tri(pb + 1, base + 1, base);
          if (b === 'neon') { c.tri(pb + 2, pb + 3, base + 2); c.tri(pb + 3, base + 3, base + 2); }
        }
        s.prevBase[k] = base;
      }
      return;
    }

    if (b === 'tube') {
      const rad = size * 0.5 * (0.35 + 0.65 * p) * (0.1 + 0.9 * tp);
      for (let k = 0; k < copies; k++) {
        xp(sym, k, px, py, pz, OP); xv(sym, k, sx, sy, sz, OS, true); xv(sym, k, nx, ny, nz, ON, false);
        let base = -1;
        for (let j = 0; j < TUBE; j++) {
          const ca = Math.cos(j * Math.PI * 2 / TUBE), sa = Math.sin(j * Math.PI * 2 / TUBE);
          const qx = ca * OS[0] + sa * ON[0], qy = ca * OS[1] + sa * ON[1], qz = ca * OS[2] + sa * ON[2];
          const shade = 0.92 + 0.08 * sa;
          const vi = c.vert(OP[0] + qx * rad, OP[1] + qy * rad, OP[2] + qz * rad, qx, qy, qz, r * shade, g * shade, bl * shade, 1, j / TUBE, d);
          if (j === 0) base = vi;
        }
        const pb = s.prevBase[k];
        if (pb >= 0) for (let j = 0; j < TUBE; j++) {
          const j1 = (j + 1) % TUBE;
          c.tri(pb + j, base + j, pb + j1); c.tri(pb + j1, base + j, base + j1);
        }
        s.prevBase[k] = base;
      }
      return;
    }

    // stamp brushes: sparkle dots and bamboo leaves
    const spacing = b === 'spark' ? size * 0.5 : size * 0.95;
    if (d - s.lastStamp < spacing) return;
    s.lastStamp = d; const sn = s.stampN++;
    const r1 = hrand(s.seed, sn, 1), r2 = hrand(s.seed, sn, 2), r3 = hrand(s.seed, sn, 3), r4 = hrand(s.seed, sn, 4);
    if (b === 'spark') {
      const jx = (r1 - 0.5) * size * 1.4, jy = (r2 - 0.5) * size * 1.4;
      const cx = px + sx * jx + nx * jy, cy = py + sy * jx + ny * jy, cz = pz + sz * jx + nz * jy;
      const ds = size * (0.22 + 0.55 * r3 * r3) * (0.5 + 0.5 * p);
      const wm = r4 * 0.35; const R = r + (1 - r) * wm, G = g + (1 - g) * wm, B = bl + (1 - bl) * wm;
      for (let k = 0; k < copies; k++) {
        xp(sym, k, cx, cy, cz, OP);
        const v0 = c.vert(OP[0], OP[1], OP[2], -1, -1, ds, R, G, B, r1, 0, 0);
        c.vert(OP[0], OP[1], OP[2], 1, -1, ds, R, G, B, r1, 1, 0);
        c.vert(OP[0], OP[1], OP[2], 1, 1, ds, R, G, B, r1, 1, 1);
        c.vert(OP[0], OP[1], OP[2], -1, 1, ds, R, G, B, r1, 0, 1);
        c.tri(v0, v0 + 1, v0 + 2); c.tri(v0, v0 + 2, v0 + 3);
      }
      return;
    }
    // leaf: tangent from the previous point
    const q = i > 0 ? o - 3 : o + 3;
    let tx = (i > 0 ? px - P[q] : P[q] - px), ty = (i > 0 ? py - P[q + 1] : P[q + 1] - py), tz = (i > 0 ? pz - P[q + 2] : P[q + 2] - pz);
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const th = (0.35 + 0.45 * r1) * (sn & 1 ? 1 : -1);
    const ct = Math.cos(th), st = Math.sin(th);
    const dx = tx * ct + sx * st, dy = ty * ct + sy * st, dz = tz * ct + sz * st;      // leaf axis
    const ex = -tx * st + sx * ct, ey = -ty * st + sy * ct, ez = -tz * st + sz * ct;   // across leaf
    const L = size * 3.2 * (0.55 + 0.45 * p) * (0.65 + 0.45 * r2) * (0.35 + 0.65 * tp), W = L * 0.2;
    const sh = 0.75 + 0.35 * r3, R = r * sh, G = g * sh, B = bl * sh;
    for (let k = 0; k < copies; k++) {
      xv(sym, k, nx, ny, nz, ON, false);
      let v0 = -1;
      for (let j = 0; j < 4; j++) {
        const cw = LEAF_C[j * 4] * W, cl = LEAF_C[j * 4 + 1] * L;
        xp(sym, k, px + ex * cw * 0.5 + dx * cl, py + ey * cw * 0.5 + dy * cl, pz + ez * cw * 0.5 + dz * cl, OP);
        const vi = c.vert(OP[0], OP[1], OP[2], ON[0], ON[1], ON[2], R, G, B, 1, LEAF_C[j * 4 + 2], LEAF_C[j * 4 + 3]);
        if (v0 < 0) v0 = vi;
      }
      c.tri(v0, v0 + 1, v0 + 2); c.tri(v0, v0 + 2, v0 + 3);
    }
  }

  // ── eraser hit test (painting-local point) ──
  hitTest(x, y, z, radius, out) {
    out.length = 0;
    for (const s of this.strokes) {
      if (!s.finished) continue;
      const m = radius + s.size * 0.6;
      for (let k = 0; k < s.copies; k++) {
        // inverse symmetry transform of the query point
        let qx = x, qz = z;
        if (k > 0) {
          if (s.sym === 1) qx = 2 * SYM_C.x - x;
          else { const [co, si] = RAD[k], dx = x - SYM_C.x, dz = z - SYM_C.z; qx = SYM_C.x + dx * co - dz * si; qz = SYM_C.z + dx * si + dz * co; }
        }
        if (qx < s.min[0] - m || qx > s.max[0] + m || y < s.min[1] - m || y > s.max[1] + m || qz < s.min[2] - m || qz > s.max[2] + m) continue;
        const P = s.pos, m2 = m * m;
        let hit = false;
        for (let i = 0; i < s.n; i++) {
          const dx = P[i * 3] - qx, dy = P[i * 3 + 1] - y, dz = P[i * 3 + 2] - qz;
          if (dx * dx + dy * dy + dz * dz < m2) { hit = true; break; }
        }
        if (hit) { out.push(s); break; }
      }
    }
    return out;
  }

  // ── compact serialisation: 13 bytes per point, base64 ──
  serialize() { return { v: 1, s: this.strokes.filter(s => s.finished).map(encodeStroke) }; }
  deserialize(data) {
    this.clear();
    if (!data || data.v !== 1 || !Array.isArray(data.s)) return 0;
    let n = 0;
    for (const e of data.s) { const s = decodeStroke(e); if (s && this.add(s)) n++; }
    return n;
  }
}

const Q = 0.0005; // 0.5 mm position quantum
export function encodeStroke(s) {
  const bytes = new Uint8Array(s.n * 13), dv = new DataView(bytes.buffer);
  const q16 = (v) => Math.max(-32767, Math.min(32767, Math.round(v / Q)));
  const q8 = (v) => Math.max(-127, Math.min(127, Math.round(v * 127)));
  for (let i = 0; i < s.n; i++) {
    const o = i * 13, k = i * 3;
    dv.setInt16(o, q16(s.pos[k]), true); dv.setInt16(o + 2, q16(s.pos[k + 1]), true); dv.setInt16(o + 4, q16(s.pos[k + 2]), true);
    dv.setInt8(o + 6, q8(s.side[k])); dv.setInt8(o + 7, q8(s.side[k + 1])); dv.setInt8(o + 8, q8(s.side[k + 2]));
    dv.setInt8(o + 9, q8(s.nrm[k])); dv.setInt8(o + 10, q8(s.nrm[k + 1])); dv.setInt8(o + 11, q8(s.nrm[k + 2]));
    dv.setUint8(o + 12, Math.round(Math.max(0, Math.min(1, s.prs[i])) * 255));
  }
  return [s.brush, s.hex, Math.round(s.size * 1e4), s.sym, s.seed, toB64(bytes)];
}
export function decodeStroke(e) {
  try {
    const [brush, hex, size, sym, seed, b64] = e;
    if (!BRUSHES[brush]) return null;
    const bytes = fromB64(b64), dv = new DataView(bytes.buffer), n = Math.floor(bytes.length / 13);
    const s = new Stroke(brush, hex, size / 1e4, sym | 0, seed | 0);
    s.ensure(n);
    for (let i = 0; i < n; i++) {
      const o = i * 13;
      s.push(dv.getInt16(o, true) * Q, dv.getInt16(o + 2, true) * Q, dv.getInt16(o + 4, true) * Q,
        dv.getInt8(o + 6) / 127, dv.getInt8(o + 7) / 127, dv.getInt8(o + 8) / 127,
        dv.getInt8(o + 9) / 127, dv.getInt8(o + 10) / 127, dv.getInt8(o + 11) / 127,
        dv.getUint8(o + 12) / 255);
    }
    return s;
  } catch { return null; }
}
function toB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b) {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
