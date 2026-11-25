import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Small helper that collects primitive parts with per-vertex colours and merges them into
// a single non-indexed BufferGeometry (position, normal, color) for one draw call.
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class GeoBuilder {
  constructor(seed = 1) { this.parts = []; this.rand = mulberry32(seed); }

  // geo: a fresh geometry (consumed). o: {x,y,z, rx,ry,rz, sx,sy,sz, s, jitter}
  add(geo, color, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    if (!g.attributes.normal) g.computeVertexNormals();
    const s = o.s ?? 1;
    _e.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.order ?? 'YXZ');
    _q.setFromEuler(_e);
    _p.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    _s.set((o.sx ?? 1) * s, (o.sy ?? 1) * s, (o.sz ?? 1) * s);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (o.pre) g.applyMatrix4(o.pre);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    const jit = o.jitter ?? 0.04;
    for (let i = 0; i < n; i += 3) {
      let r = _c.r, gg = _c.g, b = _c.b;
      if (jit) { const k = 1 + (this.rand() - 0.5) * 2 * jit; r *= k; gg *= k; b *= k; }
      for (let j = 0; j < 3 && i + j < n; j++) { col[(i + j) * 3] = r; col[(i + j) * 3 + 1] = gg; col[(i + j) * 3 + 2] = b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Drop any extra attributes so merge works.
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    g.morphAttributes = {};
    g.clearGroups();
    this.parts.push(g);
    return this;
  }
  addRaw(g) { this.parts.push(g); return this; }

  box(color, w, h, d, o = {}) { return this.add(new THREE.BoxGeometry(w, h, d), color, o); }
  cyl(color, rt, rb, h, seg, o = {}) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg ?? 8), color, o); }
  cone(color, r, h, seg, o = {}) { return this.add(new THREE.ConeGeometry(r, h, seg ?? 8), color, o); }
  ball(color, r, detail, o = {}) { return this.add(new THREE.IcosahedronGeometry(r, detail ?? 0), color, o); }
  torus(color, r, tube, rs, ts, arc, o = {}) { return this.add(new THREE.TorusGeometry(r, tube, rs ?? 4, ts ?? 10, arc ?? Math.PI * 2), color, o); }
  lathe(color, pts, seg, o = {}) { return this.add(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg ?? 8), color, o); }

  build() {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

export function shade(hex, k) {
  _c.set(hex); _c.getHSL(_hsl); _c.setHSL(_hsl.h, _hsl.s, Math.min(1, _hsl.l * k)); return _c.getHex();
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
