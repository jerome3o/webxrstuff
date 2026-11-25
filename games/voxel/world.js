import * as THREE from 'three';
import { BLOCKS, B, CHUNK, HEIGHT } from './blocks.js';
import { geometryFromArrays, makeQuadIndex } from './materials.js';

// Chunked voxel world on the main thread: holds a copy of every loaded chunk's blocks + light
// (for physics, raycasts and gameplay), streams chunks around the player through the worker,
// owns the chunk meshes, and records player edits (the save diff).
//
//   world.getBlock(x, y, z)  → id (−1 if the chunk isn't loaded yet)
//   world.setBlock(x, y, z, id, { cause })  → records the edit, remeshes, emits 'blockChanged'
//   world.getLight(x, y, z)  → { sky 0..15, block 0..15 } (sky is the *potential* skylight; multiply by daylight)
//   world.raycast(origin, dir, maxDist, out)  → DDA voxel pick
//   world.isLoaded(x, z), world.surfaceY(x, z, fromY)

const nkey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const MAX_INFLIGHT = 3;
const APPLY_PER_FRAME = 2;

export class World {
  constructor(game, { seed, table, renderDistance = 6, edits = null }) {
    this.game = game; this.seed = seed; this.table = table;
    this.renderDistance = renderDistance;
    this.chunks = new Map();       // nkey → chunk
    this.edits = new Map();        // 'cx,cz' → Map(idx → id)
    this.editsDirty = false;
    this.group = new THREE.Group(); this.group.name = 'voxel-chunks';
    game.scene.add(this.group);
    this.index = makeQuadIndex(1 << 16); this.indexQuads = 1 << 16;
    this.inflight = new Set();
    this.results = [];
    this.center = { cx: 1e9, cz: 1e9 };
    this._scanT = 0; this._pruneT = 0;
    this._dirtyNeighbours = new Map(); this._dirtyT = 0;
    this._last = null;
    this.stats = { loaded: 0, meshes: 0, quads: 0 };
    if (edits) this.importEdits(edits);

    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this._spawnWaiters = [];
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => console.error('[voxel] worker error', e.message ?? e);
    const plain = {};
    for (const [k, m] of this.edits) { const a = []; for (const [i, id] of m) a.push(i, id); plain[k] = a; }
    this.worker.postMessage({ type: 'init', seed, table, edits: plain });
  }

  dispose() {
    this.worker.terminate();
    for (const c of this.chunks.values()) this._disposeMeshes(c);
    this.chunks.clear();
    this.group.removeFromParent();
  }

  findSpawn() {
    return new Promise((res) => { this._spawnWaiters.push(res); this.worker.postMessage({ type: 'spawn' }); });
  }

  // ── block access ─────────────────────────────────────────
  chunkAt(cx, cz) {
    const l = this._last;
    if (l && l.cx === cx && l.cz === cz) return l;
    const c = this.chunks.get(nkey(cx, cz));
    if (c) this._last = c;
    return c;
  }
  getBlock(x, y, z) {
    if (y < 0) return B.deepcore;
    if (y >= HEIGHT) return 0;
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c || !c.blocks) return -1;
    return c.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }
  getLight(x, y, z, out = { sky: 15, block: 0 }) {
    if (y >= HEIGHT) { out.sky = 15; out.block = 0; return out; }
    if (y < 0) { out.sky = 0; out.block = 0; return out; }
    const c = this.chunkAt(x >> 4, z >> 4);
    if (!c || !c.light) { out.sky = 15; out.block = 0; return out; }
    const v = c.light[(x & 15) + ((z & 15) << 4) + (y << 8)];
    out.sky = v >> 4; out.block = v & 15; return out;
  }
  isSolid(x, y, z) { const id = this.getBlock(x, y, z); return id < 0 ? true : BLOCKS[id]?.solid ?? false; }
  isLoaded(x, z) { const c = this.chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4); return !!(c && c.blocks); }
  // y of the top face of the highest solid block at or below fromY (or −1)
  surfaceY(x, z, fromY = HEIGHT - 1) {
    x = Math.floor(x); z = Math.floor(z);
    for (let y = Math.min(HEIGHT - 1, Math.floor(fromY)); y >= 0; y--) { const id = this.getBlock(x, y, z); if (id < 0) return -1; if (BLOCKS[id]?.solid) return y + 1; }
    return -1;
  }

  setBlock(x, y, z, id, info = {}) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunkAt(cx, cz);
    if (!c || !c.blocks) return false;
    const idx = (x & 15) + ((z & 15) << 4) + (y << 8);
    const prev = c.blocks[idx];
    if (prev === id) return false;
    c.blocks[idx] = id;
    const k = cx + ',' + cz;
    let e = this.edits.get(k); if (!e) { e = new Map(); this.edits.set(k, e); }
    e.set(idx, id); this.editsDirty = true;
    this.worker.postMessage({ type: 'set', x, y, z, id });
    this.worker.postMessage({ type: 'remesh', cx, cz, prio: true });
    // border faces need the neighbour right away; light changes can reach ~10 blocks → lazy remesh
    const lx = x & 15, lz = z & 15;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const ncx = cx + dx, ncz = cz + dz;
      if (!this.chunks.has(nkey(ncx, ncz))) continue;
      const nearX = dx === 0 || (dx < 0 ? lx <= 9 : lx >= 6), nearZ = dz === 0 || (dz < 0 ? lz <= 9 : lz >= 6);
      if (!nearX || !nearZ) continue;
      const touching = (dx < 0 && lx === 0) || (dx > 0 && lx === 15) || (dz < 0 && lz === 0) || (dz > 0 && lz === 15);
      if (touching && (dx === 0 || dz === 0)) this.worker.postMessage({ type: 'remesh', cx: ncx, cz: ncz, prio: false });
      else this._dirtyNeighbours.set(nkey(ncx, ncz), [ncx, ncz]);
    }
    this._dirtyT = 0.35;
    this.game.events.emit('blockChanged', { x, y, z, id, prev, ...info });
    return true;
  }

  // ── streaming ────────────────────────────────────────────
  setRenderDistance(r) { this.renderDistance = r; this.center.cx = 1e9; }

  update(dt, px, pz, fwdX = 0, fwdZ = -1) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    // apply finished meshes (a couple per frame to spread GPU uploads)
    for (let n = 0; n < APPLY_PER_FRAME && this.results.length; n++) this._apply(this.results.shift());
    if (this._dirtyT > 0 && (this._dirtyT -= dt) <= 0) {
      for (const [, [cx, cz]] of this._dirtyNeighbours) this.worker.postMessage({ type: 'remesh', cx, cz, prio: false });
      this._dirtyNeighbours.clear();
    }
    this._scanT -= dt;
    const moved = pcx !== this.center.cx || pcz !== this.center.cz;
    if (!moved && this._scanT > 0) return;
    this._scanT = 0.25;
    this.center.cx = pcx; this.center.cz = pcz;
    const R = this.renderDistance, R2 = (R + 0.5) * (R + 0.5);
    // unload far chunks
    const UR2 = (R + 1.5) * (R + 1.5);
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > UR2) { this._disposeMeshes(c); this.chunks.delete(k); if (this._last === c) this._last = null; this.game.events.emit('chunkUnloaded', { cx: c.cx, cz: c.cz }); }
    }
    if (moved) {
      this._pruneT -= 1;
      if (this._pruneT <= 0) { this._pruneT = 8; this.worker.postMessage({ type: 'prune', cx: pcx, cz: pcz, r: R + 3 }); }
    }
    if (this.inflight.size >= MAX_INFLIGHT) return;
    // nearest missing chunks first, biased toward where the player looks
    const want = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      const cx = pcx + dx, cz = pcz + dz, k = nkey(cx, cz);
      if (this.chunks.has(k) || this.inflight.has(k)) continue;
      const len = Math.sqrt(d2) || 1;
      const facing = (dx * fwdX + dz * fwdZ) / len;
      want.push([d2 - (d2 > 2 ? facing * len * 1.5 : 0), cx, cz, k]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < want.length && this.inflight.size < MAX_INFLIGHT; i++) {
      const [, cx, cz, k] = want[i];
      this.inflight.add(k);
      this.worker.postMessage({ type: 'load', cx, cz });
    }
    if (want.length) this._scanT = 0.05;
  }

  get pendingCount() { return this.inflight.size + this.results.length; }

  _onMessage(m) {
    if (m.type === 'chunk' || m.type === 'mesh') this.results.push(m);
    else if (m.type === 'spawn') { const w = this._spawnWaiters; this._spawnWaiters = []; for (const f of w) f(m); }
    else if (m.type === 'error') console.error('[voxel worker]', m.message);
  }

  _apply(m) {
    const k = nkey(m.cx, m.cz);
    if (m.type === 'chunk') {
      this.inflight.delete(k);
      const dx = m.cx - this.center.cx, dz = m.cz - this.center.cz, R = this.renderDistance + 1.5;
      if (dx * dx + dz * dz > R * R) return;
      let c = this.chunks.get(k);
      if (!c) { c = { cx: m.cx, cz: m.cz, blocks: null, light: null, meshO: null, meshT: null }; this.chunks.set(k, c); }
      c.blocks = m.blocks;
      // re-apply our own edits (a set may have crossed this reply in flight)
      const e = this.edits.get(m.cx + ',' + m.cz);
      if (e) for (const [i, id] of e) c.blocks[i] = id;
      this._setMesh(c, m.mesh);
      this.game.events.emit('chunkLoaded', { cx: m.cx, cz: m.cz, chunk: c });
    } else {
      const c = this.chunks.get(k);
      if (!c) return;
      this._setMesh(c, m.mesh);
    }
  }

  _setMesh(c, mesh) {
    c.light = mesh.light;
    const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
    const build = (arr, mat, old) => {
      if (old) { old.geometry.dispose(); old.removeFromParent(); }
      if (!arr.quads) return null;
      if (arr.quads > this.indexQuads) { this.indexQuads = 1 << Math.ceil(Math.log2(arr.quads)); this.index = makeQuadIndex(this.indexQuads); }
      let minY = 1e9, maxY = -1e9;
      const p = arr.pos;
      for (let i = 1; i < p.length; i += 3) { const y = p[i]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      minY /= 16; maxY /= 16;
      const box = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(16, maxY, 16));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const g = geometryFromArrays(arr, this.index, { box, sphere });
      const ms = new THREE.Mesh(g, mat);
      ms.position.set(ox, 0, oz); ms.matrixAutoUpdate = false; ms.updateMatrix();
      ms.renderOrder = mat.transparent ? 2 : 0;
      this.group.add(ms);
      return ms;
    };
    c.meshO = build(mesh.opaque, this.game.mats.opaque, c.meshO);
    c.meshT = build(mesh.trans, this.game.mats.water, c.meshT);
  }

  _disposeMeshes(c) {
    for (const m of [c.meshO, c.meshT]) if (m) { m.geometry.dispose(); m.removeFromParent(); }
    c.meshO = c.meshT = null;
  }

  // ── raycast (Amanatides & Woo) ────────────────────────────
  // Returns out with hit=false/true, cell x,y,z, face normal nx,ny,nz, id, dist.
  // skip(id) → true to pass through (default: air and liquids).
  raycast(o, d, maxDist, out, skip = defaultSkip) {
    out.hit = false;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = d.x > 0 ? 1 : -1, sy = d.y > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
    const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
    let tx = d.x === 0 ? Infinity : (d.x > 0 ? (x + 1 - o.x) : (o.x - x)) * tdx;
    let ty = d.y === 0 ? Infinity : (d.y > 0 ? (y + 1 - o.y) : (o.y - y)) * tdy;
    let tz = d.z === 0 ? Infinity : (d.z > 0 ? (z + 1 - o.z) : (o.z - z)) * tdz;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256; i++) {
      const id = this.getBlock(x, y, z);
      if (id < 0) return out;
      if (!skip(id)) {
        out.hit = true; out.x = x; out.y = y; out.z = z; out.nx = nx; out.ny = ny; out.nz = nz; out.id = id; out.dist = t;
        return out;
      }
      if (tx < ty && tx < tz) { t = tx; if (t > maxDist) break; x += sx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { t = ty; if (t > maxDist) break; y += sy; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { t = tz; if (t > maxDist) break; z += sz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return out;
  }

  // ── save diff ─────────────────────────────────────────────
  exportEdits() {
    const out = {};
    for (const [k, m] of this.edits) {
      if (!m.size) continue;
      const bytes = new Uint8Array(m.size * 3); let i = 0;
      for (const [idx, id] of m) { bytes[i++] = idx & 255; bytes[i++] = idx >> 8; bytes[i++] = id; }
      let s = ''; for (let j = 0; j < bytes.length; j += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
      out[k] = btoa(s);
    }
    return out;
  }
  importEdits(obj) {
    for (const k in obj) {
      try {
        const s = atob(obj[k]), m = new Map();
        for (let i = 0; i + 2 < s.length; i += 3) m.set(s.charCodeAt(i) | (s.charCodeAt(i + 1) << 8), s.charCodeAt(i + 2));
        this.edits.set(k, m);
      } catch { /* ignore a corrupt chunk entry */ }
    }
  }
}

const defaultSkip = (id) => id === 0 || BLOCKS[id]?.render === 'liquid';
