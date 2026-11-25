import * as THREE from 'three';

// ── Geometry builder: merges many primitives into one vertex-coloured mesh. ──
// Lighting from many virtual lamps is baked into the vertex colours at build time, so the whole
// static market renders unlit in a couple of draw calls.
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();
const geoCache = new Map();
function unitBox(sx, sy, sz) {
  const a = Math.min(6, Math.max(1, Math.ceil(sx / 0.7))), b = Math.min(6, Math.max(1, Math.ceil(sy / 0.7))), c = Math.min(6, Math.max(1, Math.ceil(sz / 0.7)));
  const k = `b${a},${b},${c}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(1, 1, 1, a, b, c).toNonIndexed());
  return geoCache.get(k);
}
function cached(key, make) { if (!geoCache.has(key)) { const g = make(); geoCache.set(key, g.index ? g.toNonIndexed() : g); } return geoCache.get(key); }

export class Builder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; }
  // geo: non-indexed BufferGeometry; m: Matrix4; color: hex or THREE.Color
  add(geo, m, color) {
    const p = geo.attributes.position, n = geo.attributes.normal, cAttr = geo.attributes.color;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    if (color !== undefined && color !== null) _c.set(color);
    const v = new THREE.Vector3();
    const flip = m.determinant() < 0;
    const cnt = p.count;
    for (let i0 = 0; i0 < cnt; i0 += 3) {
      for (let k = 0; k < 3; k++) {
        const i = flip ? i0 + (k === 0 ? 0 : 3 - k) : i0 + k;
        v.fromBufferAttribute(p, i).applyMatrix4(m); this.pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); this.nrm.push(v.x, v.y, v.z);
        if (cAttr && (color === undefined || color === null)) this.col.push(cAttr.getX(i), cAttr.getY(i), cAttr.getZ(i));
        else this.col.push(_c.r, _c.g, _c.b);
      }
    }
  }
  _mat(frame, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz)); _p.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    if (frame) _m.premultiply(frame);
    return _m;
  }
  box(frame, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) { this.add(unitBox(sx, sy, sz), this._mat(frame, x, y, z, sx, sy, sz, rx, ry, rz), color); }
  // cylinder: radius top/bottom, height; centred
  cyl(frame, x, y, z, rt, rb, h, color, seg = 12, rx = 0, ry = 0, rz = 0, open = false) {
    const g = cached(`c${rt / rb},${seg},${open}`, () => new THREE.CylinderGeometry(rt / rb, 1, 1, seg, 1, open));
    this.add(g, this._mat(frame, x, y, z, rb, h, rb, rx, ry, rz), color);
  }
  sphere(frame, x, y, z, sx, sy, sz, color, seg = 10) {
    const g = cached(`s${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg * 0.6 | 0)));
    this.add(g, this._mat(frame, x, y, z, sx, sy, sz), color);
  }
  cone(frame, x, y, z, r, h, color, seg = 10, rx = 0, ry = 0, rz = 0) {
    const g = cached(`k${seg}`, () => new THREE.ConeGeometry(1, 1, seg));
    this.add(g, this._mat(frame, x, y, z, r, h, r, rx, ry, rz), color);
  }
  torus(frame, x, y, z, R, r, color, rx = 0, ry = 0, rz = 0) {
    const g = cached(`t${(r / R).toFixed(3)}`, () => new THREE.TorusGeometry(1, r / R, 6, 24));
    this.add(g, this._mat(frame, x, y, z, R, R, R, rx, ry, rz), color);
  }
  geo(frame, geometry, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    this.add(g, this._mat(frame, x, y, z, sx, sy, sz, rx, ry, rz), color);
  }
  get count() { return this.pos.length / 3; }
  geometry(lights = null, ambient = null) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos), nrm = new Float32Array(this.nrm), col = new Float32Array(this.col);
    if (lights) bake(pos, nrm, col, lights, ambient);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }
  mesh(material, lights = null, ambient = null) {
    const m = new THREE.Mesh(this.geometry(lights, ambient), material);
    m.matrixAutoUpdate = false; m.updateMatrix();
    return m;
  }
}

// lights: [{ x, y, z, color: THREE.Color (linear), intensity, range }]
export function bake(pos, nrm, col, lights, amb) {
  const sky = amb?.sky ?? new THREE.Color(0x26305a), gnd = amb?.ground ?? new THREE.Color(0x3a2418);
  for (let i = 0; i < pos.length; i += 3) {
    const px = pos[i], py = pos[i + 1], pz = pos[i + 2], nx = nrm[i], ny = nrm[i + 1], nz = nrm[i + 2];
    const hu = 0.5 + 0.5 * ny;
    let r = sky.r * hu + gnd.r * (1 - hu), g = sky.g * hu + gnd.g * (1 - hu), b = sky.b * hu + gnd.b * (1 - hu);
    for (const L of lights) {
      const dx = L.x - px, dy = L.y - py, dz = L.z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > L.range * L.range) continue;
      const d = Math.sqrt(d2) + 1e-6;
      const ndl = (nx * dx + ny * dy + nz * dz) / d;
      const f = 1 - d / L.range;
      const k = L.intensity * f * f * (0.25 + 0.75 * Math.max(0, ndl));
      r += L.color.r * k; g += L.color.g * k; b += L.color.b * k;
    }
    col[i] *= r; col[i + 1] *= g; col[i + 2] *= b;
  }
}

// ── Sign atlas: many text signs share one canvas texture / one draw call ──
export class SignAtlas {
  constructor(rows = 16, W = 1024) {
    this.W = W; this.rows = rows; this.rowH = 128;
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = rows * this.rowH;
    this.ctx = this.canvas.getContext('2d');
    this.n = 0; this.pos = []; this.uv = [];
  }
  // draw(ctx, w, h) in a local 1024x128 cell; returns row index
  add(draw) {
    const row = this.n++, c = this.ctx;
    c.save(); c.translate(0, row * this.rowH); c.beginPath(); c.rect(0, 0, this.W, this.rowH); c.clip();
    draw(c, this.W, this.rowH); c.restore();
    return row;
  }
  // plane of size w x h (aspect should be 8:1 for a full row), facing +Z in frame
  plane(frame, x, y, z, w, h, row, ry = 0, rx = 0) {
    const v0 = 1 - (row + 1) / this.rows, v1 = 1 - row / this.rows;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1));
    if (frame) m.premultiply(frame);
    const c = [[-w / 2, -h / 2, 0, v0], [w / 2, -h / 2, 1, v0], [w / 2, h / 2, 1, v1], [-w / 2, h / 2, 0, v1]];
    const v = new THREE.Vector3();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      v.set(c[i][0], c[i][1], 0).applyMatrix4(m); this.pos.push(v.x, v.y, v.z);
      this.uv.push(c[i][2], c[i][3]);
    }
  }
  mesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    const tex = new THREE.CanvasTexture(this.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }));
    m.matrixAutoUpdate = false;
    return m;
  }
}

// ── Stall frame helper: local -Z points into the stall, +Z toward the street ──
export class Frame {
  constructor(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.qi = this.q.clone().invert();
    this.m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), this.q, new THREE.Vector3(1, 1, 1));
    this.mi = this.m.clone().invert();
  }
  toWorld(lx, ly, lz, out = new THREE.Vector3()) { return out.set(lx, ly, lz).applyMatrix4(this.m); }
  toLocal(v, out = new THREE.Vector3()) { return out.copy(v).applyMatrix4(this.mi); }
  dirToWorld(v, out = new THREE.Vector3()) { return out.copy(v).applyQuaternion(this.q); }
  quat(rx = 0, ry = 0, rz = 0, out = new THREE.Quaternion()) { return out.setFromEuler(new THREE.Euler(rx, ry, rz)).premultiply(this.q); }
}

// ── canvas textures ──
export function cobbleTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2622'; x.fillRect(0, 0, 512, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let row = 0; row < 8; row++) {
    const off = (row % 2) * 32;
    for (let col = -1; col < 9; col++) {
      const px = col * 64 + off + 3, py = row * 64 + 3;
      const l = 30 + rnd() * 22, h = 20 + rnd() * 16;
      x.fillStyle = `hsl(${h}, ${10 + rnd() * 10}%, ${l * 0.55}%)`;
      x.beginPath(); x.roundRect(px, py, 58, 58, 12); x.fill();
      x.fillStyle = 'rgba(255,220,170,0.05)'; x.beginPath(); x.roundRect(px + 6, py + 5, 40, 20, 8); x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

// Simple seeded RNG
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
