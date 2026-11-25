import * as THREE from 'three';
import { BLOCKS, faceTile } from '../../blocks.js';
import { geometryFromArrays } from '../../materials.js';
import { SHAPE_IDS } from './content.js';

// Shape layer: blocks with a `shape` (slabs, steps, doors, ladders, fences) are 'none' to the worker
// mesher; here, on the main thread, we build one small mesh per chunk that contains any of them,
// in the chunk vertex format, drawn with the shared opaque chunk material (alpha-tested).
// Faces take the light of the cell they face (max with the shape's own cell), AO is flat.
//
// Rebuilds: chunkLoaded, blockChanged inside/next to a chunk with shapes, and when the chunk's
// light snapshot is replaced by a worker remesh (polled a few times per second, no per-frame work).

// face → [normal axis, positive?, e1 axis, e2 axis] (same corner order/winding as mesher.js)
const FACE_AX = [[0, 1, 1, 2], [0, 0, 2, 1], [1, 1, 2, 0], [1, 0, 0, 2], [2, 1, 0, 1], [2, 0, 1, 0]];
const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const AB = [[0, 0], [1, 0], [1, 1], [0, 1]];
const nkey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export const isShape = new Uint8Array(256);
for (const id of SHAPE_IDS) isShape[id] = 1;

// fence connection: other fences/walls, closed doors and full opaque cubes
function connects(id) {
  if (id <= 0) return false;
  const d = BLOCKS[id];
  return !!d && (d.shape === 'fence' || d.render === 'cube' || d.render === 'cutout');
}

export function boxesFor(def, x, y, z, world, out) {
  out.length = 0;
  if (def.shape !== 'fence') { for (const b of def.shape) out.push(b); return out; }
  const F = def.fence, p = F.post;
  out.push(p);
  const c0 = 8 - F.half, c1 = 8 + F.half;
  for (const [y0, y1] of F.rails) {
    if (connects(world.getBlock(x - 1, y, z))) out.push([0, y0, c0, p[0], y1, c1]);
    if (connects(world.getBlock(x + 1, y, z))) out.push([p[3], y0, c0, 16, y1, c1]);
    if (connects(world.getBlock(x, y, z - 1))) out.push([c0, y0, 0, c1, y1, p[2]]);
    if (connects(world.getBlock(x, y, z + 1))) out.push([c0, y0, p[5], c1, y1, 16]);
  }
  return out;
}

class Buf {
  constructor() { this.cap = 0; this.n = 0; this.grow(1024); }
  grow(n) {
    const p = new Uint16Array(n * 3), u = new Uint8Array(n * 2), d = new Uint8Array(n * 4);
    if (this.cap) { p.set(this.pos); u.set(this.uv); d.set(this.dat); }
    this.pos = p; this.uv = u; this.dat = d; this.cap = n;
  }
}

export class ShapeLayer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group(); this.group.name = 'voxel-shapes';
    game.scene.add(this.group);
    this.chunks = new Map();     // nkey → { cx, cz, count, light, mesh }
    this.dirty = new Set();
    this.buf = new Buf();
    this.boxes = [];
    this.lo = { sky: 0, block: 0 }; this.ln = { sky: 0, block: 0 };
    this._pollT = 0;
    this.layerCache = new Int16Array(256 * 6).fill(-1);
  }

  // count shape blocks in a loaded chunk (cheap byte scan)
  scan(c) {
    const b = c.blocks; if (!b) return;
    let n = 0;
    for (let i = 0; i < b.length; i++) if (isShape[b[i]]) n++;
    const k = nkey(c.cx, c.cz);
    let e = this.chunks.get(k);
    if (!n && !e) return;
    if (!e) { e = { cx: c.cx, cz: c.cz, count: 0, light: null, mesh: null }; this.chunks.set(k, e); }
    e.count = n; this.dirty.add(k);
  }
  unload(cx, cz) {
    const k = nkey(cx, cz), e = this.chunks.get(k);
    if (e) { this._drop(e); this.chunks.delete(k); this.dirty.delete(k); }
  }
  // a block changed: rebuild this chunk (and neighbours if on a border) when shapes are involved
  changed(x, y, z, id, prev) {
    const cx = x >> 4, cz = z >> 4;
    const shapeHere = isShape[id] || isShape[prev];
    const lx = x & 15, lz = z & 15;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx && (dx < 0 ? lx !== 0 : lx !== 15)) || (dz && (dz < 0 ? lz !== 0 : lz !== 15))) continue;
      const k = nkey(cx + dx, cz + dz);
      const e = this.chunks.get(k);
      if (e) { if (!dx && !dz && shapeHere) e.count += (isShape[id] ? 1 : 0) - (isShape[prev] ? 1 : 0); this.dirty.add(k); }
      else if (!dx && !dz && isShape[id]) { this.chunks.set(k, { cx, cz, count: 1, light: null, mesh: null }); this.dirty.add(k); }
    }
  }

  update(dt) {
    const world = this.game.world;
    if ((this._pollT -= dt) <= 0) {
      this._pollT = 0.3;
      for (const [k, e] of this.chunks) {
        const c = world.chunkAt(e.cx, e.cz);
        if (c && c.light && c.light !== e.light) this.dirty.add(k);
      }
    }
    let budget = 2;
    for (const k of this.dirty) {
      if (budget-- <= 0) break;
      this.dirty.delete(k);
      const e = this.chunks.get(k);
      if (e) this._build(e);
    }
  }

  _layer(id, f) {
    const i = id * 6 + f;
    let L = this.layerCache[i];
    if (L < 0) L = this.layerCache[i] = this.game.atlas.layer(faceTile(BLOCKS[id], f));
    return L;
  }

  _build(e) {
    const g = this.game, world = g.world;
    const c = world.chunkAt(e.cx, e.cz);
    if (!c || !c.blocks) { this._drop(e); return; }
    e.light = c.light;
    const blocks = c.blocks, buf = this.buf, ox = e.cx * 16, oz = e.cz * 16;
    buf.n = 0;
    let count = 0, minY = 1e9, maxY = -1;
    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i];
      if (!isShape[id]) continue;
      count++;
      const lx = i & 15, lz = (i >> 4) & 15, y = i >> 8;
      const x = ox + lx, z = oz + lz;
      const def = BLOCKS[id];
      world.getLight(x, y, z, this.lo);
      const boxes = boxesFor(def, x, y, z, world, this.boxes);
      for (const bx of boxes) this._box(def, id, bx, lx, y, lz, x, z);
      if (y < minY) minY = y; if (y + 1 > maxY) maxY = y + 1;
    }
    e.count = count;
    if (e.mesh) { e.mesh.geometry.dispose(); e.mesh.removeFromParent(); e.mesh = null; }
    if (!buf.n) { if (!count) this.chunks.delete(nkey(e.cx, e.cz)); return; }
    const n = buf.n;
    const arr = { quads: n >> 2, pos: buf.pos.slice(0, n * 3), uv: buf.uv.slice(0, n * 2), dat: buf.dat.slice(0, n * 4) };
    if (arr.quads > world.indexQuads) return; // never in practice (64k quads per chunk)
    const box = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(16, maxY, 16));
    const geo = geometryFromArrays(arr, world.index, { box, sphere: box.getBoundingSphere(new THREE.Sphere()) });
    const m = new THREE.Mesh(geo, g.mats.opaque);
    m.position.set(ox, 0, oz); m.matrixAutoUpdate = false; m.updateMatrix();
    this.group.add(m);
    e.mesh = m;
  }

  _box(def, id, b, lx, y, lz, wx, wz) {
    const world = this.game.world, buf = this.buf, lo = this.lo, ln = this.ln;
    for (let f = 0; f < 6; f++) {
      const [na, pos, a1, a2] = FACE_AX[f];
      const plane = pos ? b[na + 3] : b[na];
      // cull a face lying on the cell border against a full opaque cube
      const onBorder = pos ? plane === 16 : plane === 0;
      const nb = NB[f];
      if (onBorder) {
        const nid = world.getBlock(wx + nb[0], y + nb[1], wz + nb[2]);
        if (nid > 0 && BLOCKS[nid]?.render === 'cube') continue;
      }
      world.getLight(wx + nb[0], y + nb[1], wz + nb[2], ln);
      const sky = Math.max(lo.sky, ln.sky), blk = Math.max(lo.block, ln.block);
      if (buf.n + 4 > buf.cap) buf.grow(buf.cap * 2);
      const L = this._layer(id, f);
      const P = buf.pos, U = buf.uv, D = buf.dat;
      for (let k = 0; k < 4; k++) {
        const [A, Bb] = AB[k];
        const v = [0, 0, 0];
        v[na] = plane; v[a1] = A ? b[a1 + 3] : b[a1]; v[a2] = Bb ? b[a2 + 3] : b[a2];
        const vi = buf.n++;
        P[vi * 3] = lx * 16 + v[0]; P[vi * 3 + 1] = y * 16 + v[1]; P[vi * 3 + 2] = lz * 16 + v[2];
        let u, w;
        switch (f) {
          case 0: u = 16 - v[2]; w = v[1]; break;
          case 1: u = v[2]; w = v[1]; break;
          case 2: case 3: u = v[0]; w = v[2]; break;
          case 4: u = v[0]; w = v[1]; break;
          default: u = 16 - v[0]; w = v[1];
        }
        U[vi * 2] = u; U[vi * 2 + 1] = w;
        D[vi * 4] = L; D[vi * 4 + 1] = f | (3 << 3); D[vi * 4 + 2] = sky * 17; D[vi * 4 + 3] = blk * 17;
      }
    }
  }

  _drop(e) { if (e.mesh) { e.mesh.geometry.dispose(); e.mesh.removeFromParent(); e.mesh = null; } }
  dispose() { for (const e of this.chunks.values()) this._drop(e); this.chunks.clear(); this.group.removeFromParent(); }
}

// Isometric icon for a shape block (the panels show it instead of a full cube).
export function shapeIcon(game, id) {
  const def = BLOCKS[id];
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  let boxes;
  if (def.shape === 'fence') { const F = def.fence, p = F.post, c0 = 8 - F.half, c1 = 8 + F.half; boxes = [p]; for (const [y0, y1] of F.rails) boxes.push([0, y0, c0, p[0], y1, c1], [p[3], y0, c0, 16, y1, c1]); }
  else boxes = def.shape;
  const s = 1.72, cx = 32, cy = 34;
  const sorted = boxes.slice().sort((a, b) => (a[0] + a[3] + a[2] + a[5] + a[1] + a[4]) - (b[0] + b[3] + b[2] + b[5] + b[1] + b[4]));
  const tile = (f) => game.atlas.canvases.get(faceTile(def, f));
  for (const b of sorted) {
    const [x0, y0, z0, x1, y1, z1] = b;
    // top (y = y1): image (u, v) → world (x = u, z = v)
    g.setTransform(s, 0.5 * s, -s, 0.5 * s, cx, cy - y1 * 1.15 * s);
    g.drawImage(tile(2), x0, z0, x1 - x0, z1 - z0, x0, z0, x1 - x0, z1 - z0);
    // front (+z face, z = z1): image u → x, v → y = 16 - v
    g.setTransform(s, 0.5 * s, 0, 1.15 * s, cx - z1 * s, cy + z1 * 0.5 * s - 16 * 1.15 * s);
    g.drawImage(tile(4), x0, 16 - y1, x1 - x0, y1 - y0, x0, 16 - y1, x1 - x0, y1 - y0);
    g.fillStyle = 'rgba(40,30,70,0.22)'; g.fillRect(x0, 16 - y1, x1 - x0, y1 - y0);
    // right (+x face, x = x1): image u → z = 16 − u
    g.setTransform(s, -0.5 * s, 0, 1.15 * s, cx + (x1 - 16) * s, cy + (x1 + 16) * 0.5 * s - 16 * 1.15 * s);
    g.drawImage(tile(0), 16 - z1, 16 - y1, z1 - z0, y1 - y0, 16 - z1, 16 - y1, z1 - z0, y1 - y0);
    g.fillStyle = 'rgba(40,30,70,0.4)'; g.fillRect(16 - z1, 16 - y1, z1 - z0, y1 - y0);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}
