// Procedural terrain for Blockfell. Pure JS, runs inside the worker.
// generateChunk(cx, cz) → Uint8Array(16*16*HEIGHT) of block ids, index = x + z*16 + y*256.
import { B, CHUNK, HEIGHT, SEA } from './blocks.js';
import { Simplex, hash2, mulberry32 } from './noise.js';

export const BIOME = { ocean: 0, beach: 1, plains: 2, forest: 3, desert: 4, snow: 5, mountain: 6 };
export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Snowy Hills', 'Mountains'];

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nCont = new Simplex(s + 101); this.nDetail = new Simplex(s + 202); this.nRidge = new Simplex(s + 303);
    this.nMask = new Simplex(s + 404); this.nTemp = new Simplex(s + 505); this.nHum = new Simplex(s + 606);
    this.nCave1 = new Simplex(s + 707); this.nCave2 = new Simplex(s + 808); this.nCheese = new Simplex(s + 909);
    this.nFlower = new Simplex(s + 1010);
    // scratch for column data (chunk + 4 block margin for trees)
    this.M = 4; this.CW = CHUNK + this.M * 2;
    this.colH = new Int16Array(this.CW * this.CW);
    this.colB = new Uint8Array(this.CW * this.CW);
    this.caveGrid = new Float32Array(5 * 5 * 25);
  }

  // Terrain height + biome for a world column. Pure function of (x, z, seed).
  column(x, z, out) {
    const c = this.nCont.fbm2(x / 720, z / 720, 4);
    const t = this.nTemp.fbm2(x / 900 + 31.7, z / 900 - 12.1, 3);
    const hu = this.nHum.fbm2(x / 760 - 7.3, z / 760 + 55.5, 3);
    const hills = this.nDetail.fbm2(x / 96, z / 96, 4);
    const mask = smooth(0.08, 0.42, this.nMask.fbm2(x / 520, z / 520, 3) + c * 0.35);
    let r = 1 - Math.abs(this.nRidge.fbm2(x / 230, z / 230, 4)); r = r * r;
    let h = 44 + c * 26;
    h += hills * (t < -0.22 ? 9 : 5);
    const mount = mask * r * 44;
    h += mount;
    h = Math.max(4, Math.min(HEIGHT - 8, Math.round(h)));
    let biome;
    if (h <= SEA + 1 && c < -0.05) biome = h < SEA - 1 ? BIOME.ocean : BIOME.beach;
    else if (mount > 18 && h > 64) biome = BIOME.mountain;
    else if (t < -0.22) biome = BIOME.snow;
    else if (t > 0.22 && hu < 0.08) biome = BIOME.desert;
    else if (hu > 0.1) biome = BIOME.forest;
    else biome = BIOME.plains;
    out.h = h; out.biome = biome;
    return out;
  }

  findSpawn() {
    const o = { h: 0, biome: 0 };
    for (let ring = 0; ring < 60; ring++) {
      const n = Math.max(1, ring * 8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, rr = ring * 12;
        const x = Math.round(Math.cos(a) * rr), z = Math.round(Math.sin(a) * rr);
        this.column(x, z, o);
        if ((o.biome === BIOME.plains || o.biome === BIOME.forest) && o.h > SEA + 2) return { x: x + 0.5, y: o.h + 1, z: z + 0.5, biome: o.biome };
      }
    }
    return { x: 0.5, y: HEIGHT - 10, z: 0.5, biome: 0 };
  }

  generateChunk(cx, cz) {
    const S = CHUNK, H = HEIGHT, M = this.M, CW = this.CW;
    const data = new Uint8Array(S * S * H);
    const x0 = cx * S, z0 = cz * S;
    const seed = this.seed;
    const o = { h: 0, biome: 0 };
    for (let lz = -M; lz < S + M; lz++) for (let lx = -M; lx < S + M; lx++) {
      this.column(x0 + lx, z0 + lz, o);
      const ci = (lx + M) + (lz + M) * CW;
      this.colH[ci] = o.h; this.colB[ci] = o.biome;
    }
    const idx = (x, y, z) => x + (z << 4) + (y << 8);

    // ── strata ──
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const ci = (x + M) + (z + M) * CW;
      const h = this.colH[ci], biome = this.colB[ci];
      const wx = x0 + x, wz = z0 + z;
      const r = hash2(wx, wz, 7, seed);
      const under = h < SEA;
      let top, fill, fillDepth = 3 + ((r * 2) | 0);
      switch (biome) {
        case BIOME.ocean: case BIOME.beach: {
          const n = this.nDetail.noise2(wx / 24, wz / 24);
          top = fill = n > 0.45 ? B.shingle : n < -0.5 ? B.riverclay : B.sand; break;
        }
        case BIOME.desert: top = fill = B.sand; fillDepth = 4; break;
        case BIOME.snow: top = under ? B.sand : B.snowpack; fill = B.loam; break;
        case BIOME.mountain: top = h > 74 ? B.snowpack : h > 68 ? B.slate : B.turf; fill = h > 68 ? B.slate : B.loam; break;
        default: top = under ? (r < 0.3 ? B.riverclay : B.sand) : B.turf; fill = under ? B.sand : B.loam;
      }
      if (h <= SEA + 1 && biome !== BIOME.desert && biome !== BIOME.snow && biome !== BIOME.mountain) { top = under ? top : B.sand; if (!under) fill = B.sand; }
      for (let y = 0; y <= h; y++) {
        let b;
        if (y === 0 || (y <= 2 && hash2(wx + y * 913, wz, 3, seed) < 0.55 - y * 0.15)) b = B.deepcore;
        else if (y === h) b = top;
        else if (y > h - fillDepth) b = fill;
        else if (biome === BIOME.desert && y > h - fillDepth - 5) b = B.duneshale;
        else b = B.slate;
        data[idx(x, y, z)] = b;
      }
    }

    // ── caves: two noise "tunnels" + deep caverns, sampled on a 4³ grid and interpolated ──
    const G = this.caveGrid;
    for (let gy = 0; gy < 25; gy++) for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) {
      const wx = x0 + gx * 4, wy = gy * 4, wz = z0 + gz * 4;
      const a = this.nCave1.noise3(wx / 52, wy / 30, wz / 52);
      const b = this.nCave2.noise3(wx / 52, wy / 30, wz / 52);
      let v = a * a + b * b;                       // small near the intersection of two noise zero-sets → tunnels
      if (wy < 36) {
        const ch = this.nCheese.noise3(wx / 70, wy / 28, wz / 70);
        v = Math.min(v, (0.7 - ch) * 0.12);
      }
      G[gx + gz * 5 + gy * 25] = v;
    }
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const ci = (x + M) + (z + M) * CW;
      const h = this.colH[ci];
      const wet = h <= SEA + 2;                    // don't open caves under the sea / beaches
      const top = wet ? h - 6 : h;
      const fx = x / 4, fz = z / 4, ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz;
      for (let y = 3; y <= top; y++) {
        const fy = y / 4, iy = fy | 0, ty = fy - iy;
        const g = (X, Y, Z) => G[(ix + X) + (iz + Z) * 5 + (iy + Y) * 25];
        const v0 = (g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx) * (1 - tz) + (g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx) * tz;
        const v1 = (g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx) * (1 - tz) + (g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx) * tz;
        const v = v0 * (1 - ty) + v1 * ty;
        const thr = 0.011 + (y < 20 ? 0.004 : 0);
        if (v < thr) {
          const i = idx(x, y, z);
          if (data[i] !== B.deepcore) data[i] = 0;
        }
      }
    }

    // ── ores ──
    const rnd = mulberry32((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ seed) >>> 0);
    const vein = (id, count, ymin, ymax, smin, smax) => {
      for (let n = 0; n < count; n++) {
        let x = (rnd() * S) | 0, z = (rnd() * S) | 0, y = ymin + ((rnd() * (ymax - ymin)) | 0);
        const size = smin + ((rnd() * (smax - smin + 1)) | 0);
        for (let k = 0; k < size; k++) {
          if (x >= 0 && x < S && z >= 0 && z < S && y > 0 && y < H) {
            const i = idx(x, y, z);
            if (data[i] === B.slate) data[i] = id;
          }
          const d = (rnd() * 6) | 0;
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) z++; else if (d === 3) z--; else if (d === 4) y++; else y--;
        }
      }
    };
    vein(B.soot_seam, 14, 8, 82, 5, 10);
    vein(B.copper_vein, 8, 6, 56, 4, 8);
    vein(B.moonsilver_vein, 4, 3, 30, 3, 6);
    vein(B.sunstone, 2, 3, 24, 2, 5);
    if (rnd() < 0.5) vein(B.skyglass_geode, 1, 2, 14, 1, 3);

    // ── water, ice, cave decorations ──
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const ci = (x + M) + (z + M) * CW;
      const h = this.colH[ci], biome = this.colB[ci];
      for (let y = h + 1; y <= SEA; y++) data[idx(x, y, z)] = (y === SEA && biome === BIOME.snow) ? B.rime : B.water;
      // glowcaps on deep cave floors
      for (let y = 4; y < Math.min(h - 4, 40); y++) {
        const i = idx(x, y, z);
        if (data[i] === 0 && data[i - 256] === B.slate && hash2(x0 + x, z0 + z, y, seed) < 0.035) data[i] = B.glowcap;
      }
    }

    // ── surface decorations ──
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const ci = (x + M) + (z + M) * CW;
      const h = this.colH[ci], biome = this.colB[ci];
      if (h <= SEA || h >= H - 2) continue;
      const topB = data[idx(x, h, z)], above = idx(x, h + 1, z);
      if (data[above] !== 0) continue;
      const wx = x0 + x, wz = z0 + z;
      const r = hash2(wx, wz, 11, seed);
      const fl = this.nFlower.noise2(wx / 18, wz / 18);
      if (topB === B.turf) {
        const flowerP = biome === BIOME.plains ? 0.07 : 0.025;
        if (fl > 0.35 && r < flowerP) data[above] = fl > 0.6 ? B.emberbloom : B.bellflower;
        else if (r < (biome === BIOME.plains ? 0.15 : biome === BIOME.forest ? 0.09 : 0.05)) data[above] = B.tuft;
      } else if (topB === B.snowpack) { if (r < 0.015) data[above] = B.snowdrop; }
      else if (biome === BIOME.desert && topB === B.sand) { if (r < 0.007) data[above] = B.tumbletwig; }
    }

    // ── trees (jittered 5×5 grid so they can cross chunk borders deterministically) ──
    const CELL = 5;
    const gx0 = Math.floor((x0 - M) / CELL), gx1 = Math.floor((x0 + S + M) / CELL);
    const gz0 = Math.floor((z0 - M) / CELL), gz1 = Math.floor((z0 + S + M) / CELL);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const tx = gx * CELL + ((hash2(gx, gz, 21, seed) * CELL) | 0);
      const tz = gz * CELL + ((hash2(gx, gz, 22, seed) * CELL) | 0);
      const lx = tx - x0, lz = tz - z0;
      if (lx < -M || lx >= S + M || lz < -M || lz >= S + M) continue;
      const ci = (lx + M) + (lz + M) * CW;
      const h = this.colH[ci], biome = this.colB[ci];
      if (h <= SEA + 1 || h > H - 16) continue;
      const p = hash2(gx, gz, 23, seed);
      const kind = hash2(gx, gz, 24, seed);
      const hh = hash2(gx, gz, 25, seed);
      let type = null;
      if (biome === BIOME.forest && p < 0.85) type = kind < 0.62 ? 'amber' : 'plum';
      else if (biome === BIOME.plains && p < 0.07) type = kind < 0.5 ? 'amber' : 'plum';
      else if (biome === BIOME.snow && p < 0.45) type = 'pine';
      else if (biome === BIOME.mountain && p < 0.12 && h < 72) type = 'pine';
      else if (biome === BIOME.desert && p < 0.1) type = 'dunecap';
      if (!type) continue;
      // the column must be the natural surface (not carved away)
      if (lx >= 0 && lx < S && lz >= 0 && lz < S) {
        const tb = data[idx(lx, h, lz)];
        if (tb !== B.turf && tb !== B.snowpack && tb !== B.sand) continue;
      }
      this._tree(data, type, lx, h + 1, lz, hh, gx, gz);
    }
    return data;
  }

  _tree(data, type, x, y, z, r, gx, gz) {
    const S = CHUNK, H = HEIGHT, seed = this.seed;
    const put = (px, py, pz, id, force) => {
      if (px < 0 || px >= S || pz < 0 || pz >= S || py < 1 || py >= H) return;
      const i = px + (pz << 4) + (py << 8);
      const cur = data[i];
      const soft = cur === 0 || (cur >= B.tuft && cur <= B.tumbletwig);
      const leaf = cur === B.amber_leaves || cur === B.blossom || cur === B.pine_needles;
      if (soft || (force && leaf)) data[i] = id;
    };
    const h3 = (a, b, c) => hash2(gx * 31 + a, gz * 17 + b * 7, c + 40, seed);
    if (type === 'dunecap') {
      const n = 1 + ((r * 3) | 0);
      for (let i = 0; i < n; i++) put(x, y + i, z, B.dunecap, true);
      return;
    }
    if (type === 'amber') {
      const th = 4 + ((r * 3) | 0);
      const top = y + th;
      for (let dy = -2; dy <= 1; dy++) {
        const rad = dy <= -1 ? 2 : dy === 0 ? 2 : 1;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (rad === 1 || h3(dx, dz, dy) < 0.6)) continue;
          put(x + dx, top + dy, z + dz, B.amber_leaves, false);
        }
      }
      put(x, top + 2, z, B.amber_leaves, false);
      for (let i = 0; i < th; i++) put(x, y + i, z, B.amber_log, true);
      return;
    }
    if (type === 'plum') {
      const th = 3 + ((r * 2) | 0);
      const lean = r < 0.5 ? 1 : -1, leanX = h3(1, 1, 1) < 0.5;
      let bx = x, bz = z;
      for (let i = 0; i < th + 1; i++) {
        if (i === th - 1) { if (leanX) bx += lean; else bz += lean; }
        put(bx, y + i, bz, B.plum_log, true);
      }
      const top = y + th + 1;
      for (let dy = -1; dy <= 1; dy++) {
        const rad = dy === 1 ? 2 : 3;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const d = (dx * dx) / (rad * rad + 0.5) + (dz * dz) / (rad * rad + 0.5) + (dy === 1 ? 0.2 : 0);
          if (d > 1 || (d > 0.7 && h3(dx, dz, dy + 5) < 0.4)) continue;
          put(bx + dx, top + dy, bz + dz, B.blossom, false);
        }
      }
      return;
    }
    if (type === 'pine') {
      const th = 6 + ((r * 4) | 0);
      const top = y + th;
      for (let yy = y + 2; yy <= top + 1; yy++) {
        const k = top + 1 - yy;
        let rad = Math.min(3, Math.round(k * 0.55 + 0.4));
        if ((k & 1) === 1 && rad > 1) rad -= 1;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dz * dz > rad * rad + 0.6) continue;
          put(x + dx, yy, z + dz, B.pine_needles, false);
        }
      }
      put(x, top + 2, z, B.pine_needles, false);
      for (let i = 0; i < th; i++) put(x, y + i, z, B.pine_log, true);
    }
  }
}
