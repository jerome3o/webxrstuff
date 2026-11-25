// Chunk lighting + meshing. Pure JS, runs inside the worker.
//
// For each chunk we copy a (16 + 2*MARGIN)² × HEIGHT region of blocks from it and its neighbours,
// flood-fill skylight and block light over that region, then emit culled faces with
// per-vertex ambient occlusion and smooth (averaged) light.
//
// Vertex format (12 bytes, matched by materials.js):
//   position Uint16×3  local coords in 1/16 block (0..256, y 0..HEIGHT*16)
//   uv       Uint8×2   tile uv in 1/16 (0..16)
//   data     Uint8×4   [texture layer, face | ao<<3 | flags<<5, sky*17, block*17]
//            face 0..5 (+x,-x,+y,-y,+z,-z), 6 = plant; ao 0..3 (3 = open); flags 1 leaves sway, 2 plant base, 3 plant tip
import { CHUNK, HEIGHT } from './blocks.js';

const R_NONE = 0, R_CUBE = 1, R_CUTOUT = 2, R_LIQUID = 3, R_CROSS = 4;

// origin corner + two edges (e1 × e2 = outward normal) per face
const FACES = [
  { n: [1, 0, 0], o: [1, 0, 0], e1: [0, 1, 0], e2: [0, 0, 1] },
  { n: [-1, 0, 0], o: [0, 0, 0], e1: [0, 0, 1], e2: [0, 1, 0] },
  { n: [0, 1, 0], o: [0, 1, 0], e1: [0, 0, 1], e2: [1, 0, 0] },
  { n: [0, -1, 0], o: [0, 0, 0], e1: [1, 0, 0], e2: [0, 0, 1] },
  { n: [0, 0, 1], o: [0, 0, 1], e1: [1, 0, 0], e2: [0, 1, 0] },
  { n: [0, 0, -1], o: [0, 0, 0], e1: [0, 1, 0], e2: [1, 0, 0] },
];
const AB = [[0, 0], [1, 0], [1, 1], [0, 1]];

class Buf {
  constructor(n = 1 << 15) { this.alloc(n); this.n = 0; }
  alloc(n) {
    const p = new Uint16Array(n * 3), u = new Uint8Array(n * 2), d = new Uint8Array(n * 4);
    if (this.pos) { p.set(this.pos); u.set(this.uv); d.set(this.dat); }
    this.cap = n; this.pos = p; this.uv = u; this.dat = d;
  }
  ensure(extra) { if (this.n + extra > this.cap) this.alloc(Math.max(this.cap * 2, this.n + extra)); }
  out() {
    const n = this.n;
    return { quads: n >> 2, pos: this.pos.slice(0, n * 3), uv: this.uv.slice(0, n * 2), dat: this.dat.slice(0, n * 4) };
  }
}

export class Mesher {
  constructor(table, margin = 10) {
    this.t = table;
    this.M = margin;
    this.R = CHUNK + margin * 2;
    this.RR = this.R * this.R;
    const N = this.RR * HEIGHT;
    this.N = N;
    this.region = new Uint8Array(N);
    this.sky = new Uint8Array(N);
    this.blk = new Uint8Array(N);
    this.QS = 1 << 18; this.q = new Int32Array(this.QS);
    this.topFull = new Int16Array(this.RR); this.lowLit = new Int16Array(this.RR);
    this.opaque = new Buf(); this.trans = new Buf();
    // per face: neighbour offset + for each corner the 3 AO sample offsets, uv, and corner xyz
    const R = this.R, RR = this.RR;
    const off = (v) => v[0] + v[2] * R + v[1] * RR;
    this.faces = FACES.map((F, f) => {
      const nOff = off(F.n);
      const corners = AB.map(([a, b]) => {
        const c = [0, 1, 2].map(k => F.o[k] + a * F.e1[k] + b * F.e2[k]);
        const s1 = a ? 1 : -1, s2 = b ? 1 : -1;
        const v1 = [0, 1, 2].map(k => F.n[k] + s1 * F.e1[k]);
        const v2 = [0, 1, 2].map(k => F.n[k] + s2 * F.e2[k]);
        const v3 = [0, 1, 2].map(k => F.n[k] + s1 * F.e1[k] + s2 * F.e2[k]);
        let u, v;
        switch (f) {
          case 0: u = 1 - c[2]; v = c[1]; break;
          case 1: u = c[2]; v = c[1]; break;
          case 2: case 3: u = c[0]; v = c[2]; break;
          case 4: u = c[0]; v = c[1]; break;
          default: u = 1 - c[0]; v = c[1];
        }
        return { c, o1: off(v1), o2: off(v2), o3: off(v3), u, v };
      });
      return { nOff, corners };
    });
    this._ao = new Int32Array(4); this._sk = new Float32Array(4); this._bl = new Float32Array(4);
  }

  // getChunk(cx, cz) must return the Uint8Array for any chunk in the 3×3 neighbourhood.
  build(cx, cz, getChunk) {
    const { M, R, RR, region, sky, blk, t } = this;
    const S = CHUNK, H = HEIGHT;
    const lo = t.lightOpacity, emit = t.light, render = t.render;
    // ── copy region ──
    let qn = 0; const q = this.q, QM = this.QS - 1;
    let maxY = 0;
    for (let rz = 0; rz < R; rz++) {
      const lz = rz - M, oz = Math.floor(lz / S), iz = lz - oz * S;
      for (let rx = 0; rx < R; rx++) {
        const lx = rx - M, ox = Math.floor(lx / S), ix = lx - ox * S;
        const src = getChunk(cx + ox, cz + oz);
        const col = rx + rz * R;
        const inner = ox === 0 && oz === 0;
        let si = ix + (iz << 4);
        for (let y = 0, ri = col; y < H; y++, ri += RR, si += 256) {
          const b = src[si];
          region[ri] = b;
          if (b) {
            if (inner && y > maxY) maxY = y;
            if (emit[b]) { blk[ri] = emit[b]; q[(qn++) & QM] = ri; }
            else blk[ri] = 0;
          } else blk[ri] = 0;
        }
      }
    }
    // ── block light ──
    this._spread(blk, qn);
    // ── skylight: straight down from the top, then flood ──
    const topFull = this.topFull, lowLit = this.lowLit;
    for (let col = 0; col < RR; col++) {
      let level = 15, y = H - 1, tf = -1;
      for (; y >= 0; y--) {
        const i = col + y * RR, op = lo[region[i]];
        if (op) { if (tf < 0) tf = y; level -= op; if (level <= 0 || op >= 15) break; }
        sky[i] = level;
      }
      lowLit[col] = y + 1; topFull[col] = tf < 0 ? 0 : tf;
      for (; y >= 0; y--) sky[col + y * RR] = 0;
    }
    qn = 0;
    for (let rz = 0; rz < R; rz++) for (let rx = 0; rx < R; rx++) {
      const col = rx + rz * R;
      let m = topFull[col];
      if (rx > 0 && topFull[col - 1] > m) m = topFull[col - 1];
      if (rx < R - 1 && topFull[col + 1] > m) m = topFull[col + 1];
      if (rz > 0 && topFull[col - R] > m) m = topFull[col - R];
      if (rz < R - 1 && topFull[col + R] > m) m = topFull[col + R];
      for (let y = lowLit[col]; y <= m && y < H; y++) { const i = col + y * RR; if (sky[i] > 1) q[(qn++) & QM] = i; }
    }
    this._spread(sky, qn);

    // ── mesh ──
    const ob = this.opaque, tb = this.trans; ob.n = 0; tb.n = 0;
    const yMax = Math.min(H - 1, maxY + 1);
    for (let y = 0; y <= yMax; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const ri = (x + M) + (z + M) * R + y * RR;
      const b = region[ri];
      if (!b) continue;
      const r = render[b];
      if (r === R_CROSS) { this._cross(ob, b, ri, x, y, z); continue; }
      if (r === R_NONE) continue;
      const above = y < H - 1 ? region[ri + RR] : 0;
      const liquidTop = r === R_LIQUID && render[above] !== R_LIQUID;
      for (let f = 0; f < 6; f++) {
        let n;
        if (f === 2) n = y < H - 1 ? above : 0;
        else if (f === 3) { if (y === 0) continue; n = region[ri - RR]; }
        else n = region[ri + this.faces[f].nOff];
        const rn = render[n];
        if (rn === R_CUBE) continue;
        if (r === R_CUTOUT && n === b) continue;
        if (r === R_LIQUID && (rn === R_LIQUID || (f === 3 && rn !== R_NONE && rn !== R_CROSS))) continue;
        this._face(r === R_LIQUID ? tb : ob, b, f, ri, x, y, z, liquidTop, r === R_CUTOUT && t.wave[b] ? 1 : 0);
      }
    }
    // ── light snapshot of the chunk interior for the main thread: (sky << 4) | block ──
    const light = new Uint8Array(S * S * H);
    for (let y = 0; y < H; y++) for (let z = 0; z < S; z++) {
      let ri = M + (z + M) * R + y * RR, li = (z << 4) + (y << 8);
      for (let x = 0; x < S; x++, ri++, li++) light[li] = (sky[ri] << 4) | blk[ri];
    }
    return { opaque: ob.out(), trans: tb.out(), light };
  }

  _spread(arr, qn) {
    const { region, R, RR, q } = this, QM = this.QS - 1, lo = this.t.lightOpacity, H = HEIGHT;
    let head = 0, tail = qn;
    while (head < tail) {
      const i = q[(head++) & QM];
      const L = arr[i];
      if (L <= 1) continue;
      const y = (i / RR) | 0, rem = i - y * RR, z = (rem / R) | 0, x = rem - z * R;
      for (let k = 0; k < 6; k++) {
        let ni;
        if (k === 0) { if (x === R - 1) continue; ni = i + 1; }
        else if (k === 1) { if (x === 0) continue; ni = i - 1; }
        else if (k === 2) { if (z === R - 1) continue; ni = i + R; }
        else if (k === 3) { if (z === 0) continue; ni = i - R; }
        else if (k === 4) { if (y === H - 1) continue; ni = i + RR; }
        else { if (y === 0) continue; ni = i - RR; }
        const op = lo[region[ni]];
        if (op >= 15) continue;
        const nl = L - 1 - op;
        if (nl > arr[ni]) { arr[ni] = nl; if (tail - head < this.QS) q[(tail++) & QM] = ni; }
      }
    }
  }

  _face(buf, b, f, ri, x, y, z, liquidTop, flags) {
    const { region, sky, blk, t } = this;
    const render = t.render;
    const F = this.faces[f];
    const ni = ri + F.nOff;
    const H = HEIGHT, RR = this.RR;
    const outside = (f === 2 && ni >= this.N);
    const s0 = outside ? 15 : sky[ni], b0 = outside ? 0 : blk[ni];
    const ao = this._ao, sk = this._sk, bl = this._bl;
    for (let k = 0; k < 4; k++) {
      const C = F.corners[k];
      if (outside || y + F.corners[k].c[1] >= H) { ao[k] = 3; sk[k] = s0; bl[k] = b0; continue; }
      const i1 = ri + C.o1, i2 = ri + C.o2, i3 = ri + C.o3, N = this.N;
      const in1 = i1 >= 0 && i1 < N, in2 = i2 >= 0 && i2 < N, in3 = i3 >= 0 && i3 < N;
      const o1 = in1 && render[region[i1]] === R_CUBE, o2 = in2 && render[region[i2]] === R_CUBE;
      const o3 = in3 && render[region[i3]] === R_CUBE;
      ao[k] = (o1 && o2) ? 0 : 3 - ((o1 ? 1 : 0) + (o2 ? 1 : 0) + (o3 ? 1 : 0));
      let ss = s0, bb = b0, n = 1;
      if (!o1 && in1) { ss += sky[i1]; bb += blk[i1]; n++; }
      if (!o2 && in2) { ss += sky[i2]; bb += blk[i2]; n++; }
      if (!o3 && !(o1 && o2) && in3) { ss += sky[i3]; bb += blk[i3]; n++; }
      sk[k] = ss / n; bl[k] = bb / n;
    }
    // flip the quad diagonal toward the darker pair to avoid AO anisotropy
    const start = (ao[0] + ao[2] < ao[1] + ao[3]) ? 1 : 0;
    buf.ensure(4);
    const layer = t.layers[b * 6 + f];
    const top16 = liquidTop ? 14 : 16;
    const P = buf.pos, U = buf.uv, D = buf.dat;
    for (let j = 0; j < 4; j++) {
      const k = (j + start) & 3;
      const C = F.corners[k];
      const vi = buf.n++;
      P[vi * 3] = (x + C.c[0]) * 16;
      P[vi * 3 + 1] = y * 16 + (C.c[1] ? top16 : 0);
      P[vi * 3 + 2] = (z + C.c[2]) * 16;
      U[vi * 2] = C.u * 16;
      U[vi * 2 + 1] = (f !== 2 && f !== 3 && C.c[1] && liquidTop) ? 14 : C.v * 16;
      D[vi * 4] = layer;
      D[vi * 4 + 1] = f | (ao[k] << 3) | (flags << 5);
      D[vi * 4 + 2] = Math.round(sk[k] * 17);
      D[vi * 4 + 3] = Math.round(bl[k] * 17);
    }
  }

  _cross(buf, b, ri, x, y, z) {
    const s = Math.round(this.sky[ri] * 17), l = Math.round(this.blk[ri] * 17);
    const layer = this.t.layers[b * 6];
    const wave = this.t.wave[b];
    buf.ensure(16);
    const P = buf.pos, U = buf.uv, D = buf.dat;
    const lo = 2, hi = 14;
    // two diagonal planes, each emitted with both windings
    const planes = CROSS;
    for (let p = 0; p < 4; p++) {
      const pl = planes[p];
      for (let j = 0; j < 4; j++) {
        const vi = buf.n++;
        const c = pl[j];
        P[vi * 3] = x * 16 + (c[0] ? hi : lo);
        P[vi * 3 + 1] = y * 16 + c[1] * 16;
        P[vi * 3 + 2] = z * 16 + (c[2] ? hi : lo);
        U[vi * 2] = c[3] * 16; U[vi * 2 + 1] = c[1] * 16;
        D[vi * 4] = layer;
        D[vi * 4 + 1] = 6 | (3 << 3) | ((wave ? (c[1] ? 3 : 2) : 0) << 5);
        D[vi * 4 + 2] = s; D[vi * 4 + 3] = l;
      }
    }
  }
}

// corner = [x(0/1 → lo/hi), y, z(0/1), u]
const CROSS = [
  [[0, 0, 0, 0], [1, 0, 1, 1], [1, 1, 1, 1], [0, 1, 0, 0]],
  [[0, 0, 0, 0], [0, 1, 0, 0], [1, 1, 1, 1], [1, 0, 1, 1]],
  [[0, 0, 1, 0], [1, 0, 0, 1], [1, 1, 0, 1], [0, 1, 1, 0]],
  [[0, 0, 1, 0], [0, 1, 1, 0], [1, 1, 0, 1], [1, 0, 0, 1]],
];
