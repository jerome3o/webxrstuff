import * as THREE from 'three';
import { BLOCK_LIST, faceTile } from './blocks.js';

// Procedural 16×16 pixel art for Blockfell: soft pastel "gouache" palette with ink accents.
// Every tile is painted by a function (p, rnd) on a Px buffer. To add a tile:
//   registerTile('my_tile', (p, rnd) => { p.fill('#aabbcc'); ... })
// Block tiles go into one THREE.DataArrayTexture (one layer per tile). Item sprites
// (tools, materials) are registered with registerSprite and only used for icons / held models.

export const TILE_PAINTERS = new Map();
export const SPRITE_PAINTERS = new Map();
export const registerTile = (name, fn) => TILE_PAINTERS.set(name, fn);
export const registerSprite = (name, fn) => SPRITE_PAINTERS.set(name, fn);

// ── pixel helpers ───────────────────────────────────────────
export const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const C = (c) => typeof c === 'string' ? hex(c) : c;

export class Px {
  constructor() { this.d = new Uint8ClampedArray(16 * 16 * 4); }
  set(x, y, c, a = 255) { x &= 15; y &= 15; const i = (y * 16 + x) * 4, v = C(c); this.d[i] = v[0]; this.d[i + 1] = v[1]; this.d[i + 2] = v[2]; this.d[i + 3] = a; }
  get(x, y) { x &= 15; y &= 15; const i = (y * 16 + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2]]; }
  alpha(x, y) { return this.d[(((y & 15) * 16) + (x & 15)) * 4 + 3]; }
  tint(x, y, c, t) { this.set(x, y, mix(this.get(x, y), C(c), t), this.alpha(x, y)); }
  shade(x, y, k) { const v = this.get(x, y); this.set(x, y, [v[0] * k, v[1] * k, v[2] * k], this.alpha(x, y)); }
  fill(c, a = 255) { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, c, a); }
  clear() { this.d.fill(0); }
}

function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// tileable value noise in [0,1]
function vnoise(rnd, cells = 4) {
  const g = []; for (let i = 0; i < cells * cells; i++) g.push(rnd());
  const out = new Float32Array(256), s = 16 / cells;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy);
    let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = g[(ix % cells) + (iy % cells) * cells], b = g[((ix + 1) % cells) + (iy % cells) * cells];
    const c = g[(ix % cells) + ((iy + 1) % cells) * cells], d = g[((ix + 1) % cells) + ((iy + 1) % cells) * cells];
    out[x + y * 16] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  }
  return out;
}
// soft painterly ground: 3 tones blended by noise + dither + a few brush dabs
function ground(p, rnd, base, light, dark, { cells = 4, dabs = 10, dabLen = 2, dir = [1, 0], amt = 1 } = {}) {
  const n = vnoise(rnd, cells), n2 = vnoise(rnd, 8);
  const B = C(base), L = C(light), D = C(dark);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = (n[x + y * 16] * 0.7 + n2[x + y * 16] * 0.3) + (rnd() - 0.5) * 0.18 * amt;
    const c = v > 0.62 ? mix(B, L, Math.min(1, (v - 0.62) * 3.5)) : v < 0.38 ? mix(B, D, Math.min(1, (0.38 - v) * 3.5)) : B;
    p.set(x, y, c);
  }
  for (let i = 0; i < dabs; i++) {
    const x = (rnd() * 16) | 0, y = (rnd() * 16) | 0, c = rnd() < 0.5 ? L : D;
    for (let k = 0; k < dabLen; k++) p.tint(x + dir[0] * k, y + dir[1] * k, c, 0.55);
  }
}
function specks(p, rnd, colors, n, a = 255) { for (let i = 0; i < n; i++) p.set((rnd() * 16) | 0, (rnd() * 16) | 0, colors[(rnd() * colors.length) | 0], a); }
// tileable voronoi stones
function stones(p, rnd, n, tones, mortar, hi) {
  const pts = []; for (let i = 0; i < n; i++) pts.push([rnd() * 16, rnd() * 16, C(tones[(rnd() * tones.length) | 0])]);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let d1 = 1e9, d2 = 1e9, best = null, bdx = 0, bdy = 0;
    for (const q of pts) for (let oy = -16; oy <= 16; oy += 16) for (let ox = -16; ox <= 16; ox += 16) {
      const dx = x + 0.5 - (q[0] + ox), dy = y + 0.5 - (q[1] + oy), d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; best = q; bdx = dx; bdy = dy; } else if (d < d2) d2 = d;
    }
    if (Math.sqrt(d2) - Math.sqrt(d1) < 0.9) p.set(x, y, mortar);
    else { let c = best[2]; if (bdx + bdy < -1.6) c = mix(c, C(hi), 0.45); else if (bdx + bdy > 2.2) c = mix(c, C(mortar), 0.25); p.set(x, y, mix(c, [255, 255, 255], (rnd() - 0.5) * 0.08)); }
  }
}
function rings(p, rnd, a, b, bark) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 7.5, r = Math.sqrt(dx * dx + dy * dy) + (rnd() - 0.5) * 0.5;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 6.6) p.set(x, y, bark);
    else p.set(x, y, Math.floor(r * 0.9) % 2 ? a : b);
  }
  p.tint(7, 7, bark, 0.4); p.tint(8, 8, bark, 0.3);
}
function planks(p, rnd, base, seam, grain) {
  const B = C(base);
  for (let y = 0; y < 16; y++) {
    const plank = y >> 2, shift = plank % 2 ? 8 : 3;
    const pv = (Math.sin(plank * 12.9898 + 4.1) * 0.5) * 0.06;
    for (let x = 0; x < 16; x++) {
      let c = mix(B, pv > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(pv));
      if ((y & 3) === 3) c = C(seam);
      else if (((x + shift) & 15) === 0) c = mix(c, C(seam), 0.8);
      else if (rnd() < 0.1) c = mix(c, C(grain), 0.5);
      else if ((y & 3) === 0) c = mix(c, [255, 255, 255], 0.08);
      p.set(x, y, c);
    }
  }
}
function leaves(p, rnd, tones, holes = 0.22, cells = 8) {
  const n = vnoise(rnd, cells), n2 = vnoise(rnd, 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = n[x + y * 16] * 0.6 + n2[x + y * 16] * 0.4 + (rnd() - 0.5) * 0.25;
    if (v < holes + 0.12 && rnd() < 0.85) { p.set(x, y, tones[0], 0); continue; }
    const k = Math.min(tones.length - 1, Math.max(0, Math.floor((v - 0.2) * tones.length * 1.25)));
    p.set(x, y, tones[k]);
  }
}
function ore(p, rnd, colors, clusters, size = 3) {
  for (let i = 0; i < clusters; i++) {
    let x = 2 + ((rnd() * 12) | 0), y = 2 + ((rnd() * 12) | 0);
    for (let k = 0; k < size + ((rnd() * 2) | 0); k++) {
      p.set(x, y, colors[0]); p.set(x + 1, y, colors[1 % colors.length]); p.set(x, y + 1, colors[2 % colors.length]);
      x += ((rnd() * 3) | 0) - 1; y += ((rnd() * 3) | 0) - 1;
    }
  }
}
function slateBase(p, rnd) {
  const tones = ['#8a97ab', '#97a3b6', '#a6b0c2', '#7f8ca2'].map(hex);
  const n = vnoise(rnd, 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const band = (y + Math.round(Math.sin((x + n[x + y * 16] * 6) * 0.55) * 1.2) + 16) % 16;
    const k = band < 4 ? 0 : band < 8 ? 1 : band < 12 ? 2 : 1;
    let c = tones[k];
    if (band === 5 || band === 13) c = mix(c, tones[3], 0.8);
    p.set(x, y, mix(c, [255, 255, 255], (rnd() - 0.5) * 0.06));
  }
  specks(p, rnd, ['#b8c1cf', '#76839a'], 6);
}
function blades(p, rnd, n, lo, hi, minH = 6, maxH = 13) {
  for (let i = 0; i < n; i++) {
    let x = 1 + rnd() * 14; const h = minH + ((rnd() * (maxH - minH)) | 0), lean = (rnd() - 0.5) * 0.35;
    for (let k = 0; k < h; k++) { p.set(Math.round(x), 15 - k, mix(C(lo), C(hi), k / h)); x += lean; }
  }
}
function stem(p, x, y0, y1, col = '#6fa36b') { for (let y = y1; y <= y0; y++) p.set(x, y, col); }
function felt(p, rnd, base) {
  const B = C(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const w = ((x + y) & 1) ? 0.035 : -0.035;
    p.set(x, y, mix(B, w > 0 ? [255, 255, 255] : [40, 30, 60], Math.abs(w) + rnd() * 0.04));
  }
  for (let i = 0; i < 5; i++) { const x = (rnd() * 16) | 0, y = (rnd() * 16) | 0; p.tint(x, y, '#ffffff', 0.18); p.tint(x + 1, y, '#ffffff', 0.1); }
}

// ── block tiles ─────────────────────────────────────────────
registerTile('turf_top', (p, r) => { ground(p, r, '#9ccc8c', '#b8de9e', '#82b47c', { dabs: 14, dir: [1, 1] }); specks(p, r, ['#eef0b8', '#f6d6e0'], 3); });
registerTile('turf_side', (p, r) => {
  for (let x = 0; x < 16; x++) {
    const off = (r() * 3) | 0;
    for (let y = 0; y < 16; y++) {
      let c = mix(hex('#94c486'), hex('#6c9b6c'), (y + off) / 18);
      if ((x + ((y / 5) | 0)) % 3 === 0) c = mix(c, hex('#6e9d70'), 0.35);
      p.set(x, y, mix(c, [255, 255, 255], (r() - 0.5) * 0.08));
    }
  }
  for (let i = 0; i < 9; i++) { const x = (r() * 16) | 0, y = (r() * 12) | 0; for (let k = 0; k < 3; k++) p.tint(x, y + k, '#c3e4a6', 0.6 - k * 0.15); }
});
registerTile('loam', (p, r) => { ground(p, r, '#b98b72', '#cfa287', '#a07561', { dabs: 8 }); specks(p, r, ['#dcc6ae', '#8f6853'], 6); });
registerTile('slate', (p, r) => slateBase(p, r));
registerTile('rubble', (p, r) => stones(p, r, 7, ['#8c98ad', '#9aa5b8', '#a9b3c4', '#838fa5'], '#5f6a82', '#c3cbd8'));
registerTile('mossy_rubble', (p, r) => {
  stones(p, r, 7, ['#8c98ad', '#9aa5b8', '#a9b3c4'], '#5f6a82', '#c3cbd8');
  const n = vnoise(r, 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (n[x + y * 16] > 0.58) p.set(x, y, r() < 0.5 ? '#94c283' : '#7fae76');
});
registerTile('sand', (p, r) => {
  ground(p, r, '#efdbb5', '#f8eacb', '#e2c79b', { dabs: 6, amt: 0.7 });
  for (let x = 0; x < 16; x++) for (let k = 0; k < 3; k++) { const y = (k * 5 + Math.round(Math.sin(x * 0.7 + k) * 1.1) + 16) % 16; p.tint(x, y, '#fbf1d9', 0.55); }
  specks(p, r, ['#d8b98a', '#fff6e2'], 5);
});
registerTile('duneshale', (p, r) => {
  const bands = ['#e4c99e', '#d7b98c', '#ebd5ad', '#cfae85'].map(hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const b = ((y + Math.round(Math.sin(x * 0.4) * 0.8) + 16) >> 2) % 4;
    p.set(x, y, mix(bands[b], [255, 255, 255], (r() - 0.5) * 0.07));
  }
});
registerTile('duneshale_top', (p, r) => ground(p, r, '#e6cda4', '#f0dcb8', '#d6b98d', { dabs: 4, amt: 0.6 }));
registerTile('snow', (p, r) => { ground(p, r, '#e6edf6', '#f7f9fd', '#cfdaeb', { dabs: 6, amt: 0.6 }); specks(p, r, ['#ffffff'], 4); });
registerTile('snow_side', (p, r) => {
  ground(p, r, '#e3eaf4', '#f4f7fc', '#ccd7e8', { dabs: 4, amt: 0.6 });
  for (let x = 0; x < 16; x++) for (const y0 of [5, 11]) p.tint(x, (y0 + Math.round(Math.sin(x * 0.6) * 0.8)) & 15, '#c9d6ea', 0.6);
});
registerTile('rime', (p, r) => {
  ground(p, r, '#c3e3ee', '#e6f6fb', '#a5d1e1', { dabs: 6, dir: [1, -1], dabLen: 4 });
  for (let i = 0; i < 2; i++) { let x = (r() * 16) | 0, y = (r() * 16) | 0; for (let k = 0; k < 9; k++) { p.set(x, y, '#90c2d6'); x += r() < 0.5 ? 1 : 0; y += r() < 0.6 ? 1 : 0; } }
  for (let k = 0; k < 5; k++) p.set(3 + k, 10 - k, '#f4fbfd');
});
registerTile('water', (p, r) => {
  ground(p, r, '#6cb0cc', '#8ecbe0', '#5a9dbd', { dabs: 0, amt: 0.4, cells: 2 });
  for (let i = 0; i < 6; i++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; for (let k = 0; k < 4; k++) p.tint(x + k, y + (k === 1 || k === 2 ? -1 : 0), '#b6e2ee', 0.6); }
});
registerTile('deepcore', (p, r) => {
  ground(p, r, '#3c364a', '#4e4660', '#2b2638', { dabs: 10, cells: 4 });
  specks(p, r, ['#6d5b8f', '#7c6aa0'], 4);
});
registerTile('shingle', (p, r) => stones(p, r, 13, ['#aba59c', '#bfb8ac', '#949089', '#c9c0b0'], '#77716c', '#ddd6c8'));
registerTile('riverclay', (p, r) => { ground(p, r, '#a9b6c2', '#bcc7d1', '#97a6b5', { dabs: 10, dabLen: 4 }); });

registerTile('amber_bark', (p, r) => {
  for (let x = 0; x < 16; x++) {
    const groove = (x % 4 === 0), hi = (x % 4 === 2);
    for (let y = 0; y < 16; y++) {
      let c = hex('#9b6b4c');
      if (groove || (x % 4 === 1 && (y + x) % 5 === 0)) c = hex('#7c533a');
      else if (hi) c = mix(c, hex('#b98760'), 0.7);
      p.set(x + (y % 7 === 0 ? 1 : 0), y, mix(c, [255, 255, 255], (r() - 0.5) * 0.07));
    }
  }
  p.set(10, 6, '#6c4632'); p.set(11, 6, '#6c4632'); p.set(10, 7, '#c99a70');
});
registerTile('amber_ring', (p, r) => rings(p, r, '#ddb27f', '#c99b69', '#8f6245'));
registerTile('amber_leaves', (p, r) => leaves(p, r, ['#7fa452', '#98bb64', '#afcd76', '#c8dc8a'], 0.18, 4));
registerTile('amber_planks', (p, r) => planks(p, r, '#d8aa74', '#a8784b', '#b98a59'));
registerTile('plum_bark', (p, r) => {
  ground(p, r, '#6f4b5d', '#86637a', '#5a3b4c', { dabs: 4, dir: [0, 1], dabLen: 4, cells: 2 });
  for (let i = 0; i < 7; i++) { const x = (r() * 14) | 0, y = (r() * 16) | 0; p.set(x, y, '#a38393'); p.set(x + 1, y, '#a38393'); p.set(x + 2, y, '#8d6b7d'); }
});
registerTile('plum_ring', (p, r) => rings(p, r, '#d4a6b0', '#c1919d', '#6a4758'));
registerTile('blossom', (p, r) => { leaves(p, r, ['#d98aa6', '#eaa3bb', '#f5bfd0', '#fde3ec'], 0.2); specks(p, r, ['#ffffff'], 3); });
registerTile('plum_planks', (p, r) => planks(p, r, '#bb8996', '#91606e', '#a47280'));
registerTile('pine_bark', (p, r) => {
  // long vertical plates with dark furrows that wander
  const furrow = [1, 6, 11]; const off = furrow.map(() => r() * 6);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = hex('#7a6252');
    for (let k = 0; k < furrow.length; k++) { const fx = (furrow[k] + Math.round(Math.sin((y + off[k]) * 0.7))) & 15; if (x === fx) c = hex('#4f3f36'); else if (x === ((fx + 1) & 15)) c = hex('#957a66'); }
    p.set(x, y, mix(c, [255, 255, 255], (r() - 0.5) * 0.08));
  }
});
registerTile('pine_ring', (p, r) => rings(p, r, '#d2b189', '#bf9d75', '#5d4c41'));
registerTile('pine_needles', (p, r) => {
  const n = vnoise(r, 4), hole = vnoise(r, 8);
  const T = ['#3f6f63', '#4d8677', '#5f9c8c', '#7ab5a3'].map(hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (hole[x + y * 16] < 0.3) { p.set(x, y, T[1], 0); continue; }
    p.set(x, y, T[Math.min(3, Math.floor(n[x + y * 16] * 3.2))]);
  }
  for (let i = 0; i < 9; i++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; if (p.alpha(x, y)) { p.set(x, y, T[3]); if (p.alpha(x + 1, y + 1)) p.set(x + 1, y + 1, T[2]); } }
});
registerTile('pine_planks', (p, r) => planks(p, r, '#dfc9a2', '#b39b74', '#c8b08a'));
registerTile('dunecap_side', (p, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c = hex('#7cb8a0'); const m = x % 4;
    if (m === 0) c = hex('#62a089'); else if (m === 1) c = hex('#9ccdb6');
    p.set(x, y, mix(c, [255, 255, 255], (r() - 0.5) * 0.06));
  }
  for (let y = 1; y < 16; y += 3) for (let x = 0; x < 16; x += 4) p.set(x, y + (x & 4 ? 1 : 0), '#f6efd2');
});
registerTile('dunecap_top', (p, r) => {
  rings(p, r, '#8ac4ab', '#7ab79d', '#62a089');
  for (const [x, y] of [[7, 6], [8, 6], [6, 7], [9, 7], [6, 8], [9, 8], [7, 9], [8, 9]]) p.set(x, y, '#f2a0b8');
  p.set(7, 7, '#ffe0e8'); p.set(8, 7, '#ffd6e2'); p.set(7, 8, '#ffd6e2'); p.set(8, 8, '#ffcf6e');
});
registerTile('tuft', (p, r) => { p.clear(); blades(p, r, 9, '#6fa36b', '#bfe19f'); });
registerTile('bellflower', (p, r) => {
  p.clear(); blades(p, r, 4, '#6fa36b', '#a8d391', 4, 8);
  for (const [x, top] of [[4, 5], [8, 3], [12, 6]]) {
    stem(p, x, 15, top);
    p.set(x - 1, top, '#86a8ec'); p.set(x, top, '#b5cbf6'); p.set(x + 1, top, '#86a8ec');
    p.set(x - 1, top + 1, '#6585cc'); p.set(x, top + 1, '#86a8ec'); p.set(x + 1, top + 1, '#6585cc');
    p.set(x - 1, top + 2, '#4d6db5'); p.set(x + 1, top + 2, '#4d6db5');
  }
});
registerTile('emberbloom', (p, r) => {
  p.clear(); blades(p, r, 4, '#6fa36b', '#a8d391', 4, 8);
  for (const [x, y] of [[5, 5], [11, 3]]) {
    stem(p, x, 15, y + 1);
    for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) p.set(x + dx, y + dy, (dx + dy) & 1 ? '#f59a72' : '#ffc0a0');
    p.set(x, y, '#ffd36e');
  }
});
registerTile('snowdrop', (p, r) => {
  p.clear(); blades(p, r, 3, '#6fa36b', '#9fcf96', 4, 7);
  for (const [x, top] of [[5, 6], [10, 4]]) {
    stem(p, x, 15, top); p.set(x + 1, top, '#6fa36b');
    p.set(x + 1, top + 1, '#ffffff'); p.set(x + 2, top + 1, '#e6ecf5'); p.set(x + 1, top + 2, '#e6ecf5'); p.set(x + 2, top + 2, '#ffffff'); p.set(x + 1, top + 3, '#9fd08f');
  }
});
registerTile('tumbletwig', (p, r) => {
  p.clear();
  const br = (x, y, dx, len, d) => { for (let k = 0; k < len; k++) { p.set(Math.round(x), y, k % 3 ? '#9a7a5a' : '#7a5c42'); x += dx; y--; if (d > 0 && r() < 0.18) br(x, y, -dx * 0.8 + (r() - 0.5), 3 + ((r() * 3) | 0), d - 1); } };
  br(7, 15, -0.35, 10, 2); br(8, 15, 0.45, 9, 2);
});
registerTile('glowcap', (p, r) => {
  p.clear();
  for (const [x, top, w] of [[4, 8, 2], [10, 4, 3], [12, 10, 1]]) {
    for (let y = top + 1; y < 16; y++) { p.set(x, y, '#ece6d2'); if (w > 2) p.set(x + 1, y, '#d8d0b8'); }
    for (let dx = -w; dx <= w + (w > 2 ? 1 : 0); dx++) { p.set(x + dx, top, '#7fe6d6'); if (Math.abs(dx) < w) p.set(x + dx, top - 1, '#b3f5ea'); }
    p.set(x, top - 1, '#ffffff');
  }
});
registerTile('soot_seam', (p, r) => { slateBase(p, r); ore(p, r, ['#2f2d38', '#4a4757', '#3a3845'], 5, 3); });
registerTile('copper_vein', (p, r) => { slateBase(p, r); ore(p, r, ['#e0895a', '#f4b184', '#b5643f'], 4, 3); });
registerTile('moonsilver_vein', (p, r) => { slateBase(p, r); ore(p, r, ['#dce6ff', '#f7faff', '#b4c3ea'], 4, 3); });
registerTile('sunstone', (p, r) => {
  slateBase(p, r);
  for (let i = 0; i < 5; i++) { const x = 2 + ((r() * 12) | 0), y = 3 + ((r() * 11) | 0); p.set(x, y, '#ffcf5e'); p.set(x, y - 1, '#ffe9a6'); p.set(x, y - 2, '#fff6d8'); p.set(x + 1, y, '#f0a63c'); p.set(x - 1, y, '#f0a63c'); }
});
registerTile('skyglass_geode', (p, r) => {
  slateBase(p, r);
  for (let i = 0; i < 4; i++) { const x = 3 + ((r() * 10) | 0), y = 4 + ((r() * 9) | 0); p.set(x, y, '#74dcef'); p.set(x, y - 1, '#b5f2fb'); p.set(x + 1, y, '#3fb2cf'); p.set(x + 1, y - 1, '#74dcef'); p.set(x, y - 2, '#e8fcff'); }
});
registerTile('clear_pane', (p) => {
  p.clear();
  for (let i = 0; i < 16; i++) { p.set(i, 0, '#e3f1f5'); p.set(i, 15, '#c9dfe6'); p.set(0, i, '#e3f1f5'); p.set(15, i, '#c9dfe6'); }
  for (let k = 0; k < 4; k++) { p.set(3 + k, 6 - k, '#ffffff'); p.set(5 + k, 7 - k, '#f2fbfd'); }
});
registerTile('lantern', (p, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let c;
    if (y < 2 || y > 13) c = (y === 0 || y === 15) ? '#5a4234' : '#7a5a45';
    else {
      const glow = 1 - Math.abs(x - 7.5) / 9;
      c = mix(hex('#f6bd7a'), hex('#fff0cf'), glow);
      if (x % 5 === 2) c = mix(c, hex('#d98d56'), 0.55);
      if (y === 3 || y === 12) c = mix(c, hex('#e0664a'), 0.7);
    }
    p.set(x, y, c);
  }
});
registerTile('lantern_top', (p) => {
  p.fill('#6b4f3d');
  for (let i = 0; i < 16; i++) { p.set(i, 0, '#55402f'); p.set(0, i, '#55402f'); p.set(i, 15, '#55402f'); p.set(15, i, '#55402f'); }
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) p.set(x, y, (x === 5 || x === 10 || y === 5 || y === 10) ? '#f6bd7a' : '#fff0cf');
});
registerTile('kiln_brick', (p, r) => {
  const tones = ['#c97c60', '#d48b6d', '#b96e54', '#cf8466'].map(hex);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 2, xx = (x + (row % 2) * 4) & 7;
    const brick = ((x + (row % 2) * 4) >> 3) + row * 3;
    let c = tones[brick % 4];
    if ((y & 3) === 3 || xx === 7) c = hex('#ead8c4');
    else if ((y & 3) === 0) c = mix(c, [255, 255, 255], 0.12);
    p.set(x, y, mix(c, [0, 0, 0], r() * 0.05));
  }
});
registerTile('thatch', (p, r) => {
  for (let x = 0; x < 16; x++) {
    const t = ['#e3c47e', '#d4b066', '#efd89a', '#c9a45e'][(r() * 4) | 0];
    for (let y = 0; y < 16; y++) p.set(x, y, mix(hex(t), [0, 0, 0], (y % 8 === 7) ? 0.18 : r() * 0.05));
  }
});
registerTile('thatch_top', (p, r) => {
  ground(p, r, '#e0c07a', '#f0d898', '#c9a45e', { dabs: 30, dabLen: 3, dir: [1, 1] });
  for (let i = 0; i < 12; i++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; for (let k = 0; k < 3; k++) p.tint(x - k, y + k, '#b8934f', 0.5); }
});
registerTile('felt_rose', (p, r) => felt(p, r, '#f0b3bf'));
registerTile('felt_sky', (p, r) => felt(p, r, '#a9cdf0'));
registerTile('felt_mint', (p, r) => felt(p, r, '#aee3c8'));
registerTile('felt_butter', (p, r) => felt(p, r, '#f6e3a1'));
registerTile('felt_lilac', (p, r) => felt(p, r, '#c9b6ea'));
registerTile('slate_brick', (p, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = y >> 3, xx = (x + row * 4) & 7, yy = y & 7;
    let c = mix(hex('#97a3b6'), hex('#8a97ab'), ((x + row * 4) >> 3) % 2 ? 0.6 : 0);
    if (yy === 7 || xx === 7) c = hex('#66718a');
    else if (yy === 0 || xx === 0) c = mix(c, [255, 255, 255], 0.16);
    else if (yy === 6 || xx === 6) c = mix(c, [0, 0, 30], 0.1);
    p.set(x, y, mix(c, [255, 255, 255], (r() - 0.5) * 0.06));
  }
});

// ── item sprites (transparent, 16×16, drawn with an ink outline) ──
const INK = '#3a3346';
function outline(p) {
  const a = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) a.push(p.alpha(x, y) > 0);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (a[x + y * 16]) continue;
    const n = (xx, yy) => xx >= 0 && xx < 16 && yy >= 0 && yy < 16 && a[xx + yy * 16];
    if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) p.set(x, y, INK);
  }
}
function line(p, x0, y0, x1, y1, col, w = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); p.set(x, y, col); if (w > 1) p.set(x + 1, y, col); }
}
function nugget(p, r, cols) {
  for (let y = 5; y < 12; y++) for (let x = 4; x < 12; x++) { const dx = (x - 7.5) / 3.8, dy = (y - 8.2) / 3; if (dx * dx + dy * dy < 1 + (r() - 0.5) * 0.3) p.set(x, y, dy < -0.3 ? cols[1] : dy > 0.4 ? cols[2] : cols[0]); }
  p.set(6, 6, '#ffffff', 255);
}
function crystal(p, cols) {
  for (const [x, h] of [[6, 9], [8, 11], [10, 7]]) for (let k = 0; k < h; k++) { const y = 14 - k; p.set(x, y, k > h - 3 ? cols[1] : cols[0]); p.set(x + 1, y, cols[2]); }
}
const toolHandle = (p, col = '#9a7350') => { line(p, 2, 14, 10, 6, col); line(p, 3, 14, 11, 6, '#7a5638'); };
export function toolSprite(kind, head, headHi) {
  return (p) => {
    p.clear();
    toolHandle(p);
    if (kind === 'pick') {
      for (let t = 0; t <= 1.0001; t += 0.04) {
        const x = (1 - t) * (1 - t) * 5 + 2 * (1 - t) * t * 14 + t * t * 14, y = (1 - t) * (1 - t) * 2 + 2 * (1 - t) * t * 1 + t * t * 11;
        p.set(Math.round(x), Math.round(y), head); p.set(Math.round(x) - 1, Math.round(y) + 1, t > 0.2 && t < 0.8 ? head : headHi);
      }
      p.set(10, 4, headHi); p.set(11, 4, headHi);
    } else if (kind === 'axe') {
      for (let y = 1; y < 10; y++) for (let x = 8; x < 16; x++) { const dx = x - 13, dy = y - 4.5; if (dx * dx * 0.7 + dy * dy < 12 && x + y > 13 && !(x > 14 && (y < 2 || y > 8))) p.set(x, y, x > 13 ? headHi : head); }
    } else {
      for (let y = 0; y < 9; y++) for (let x = 8; x < 16; x++) { const u = (x - y) * 0.7, v = (x + y - 15) * 0.7; if (Math.abs(u - 6.5) < 2.4 && Math.abs(v - 2.4) < 3.2) p.set(x, y, (u > 6.5) ? headHi : head); }
    }
    outline(p);
  };
}
registerSprite('twig', (p) => { p.clear(); line(p, 3, 13, 12, 3, '#9a7350'); line(p, 8, 8, 11, 9, '#9a7350'); p.set(12, 3, '#b5d27b'); outline(p); });
registerSprite('soot_lump', (p, r) => { p.clear(); nugget(p, r, ['#3b3845', '#56526a', '#2a2833']); outline(p); });
registerSprite('raw_copper', (p, r) => { p.clear(); nugget(p, r, ['#e0895a', '#f4b184', '#b5643f']); outline(p); });
registerSprite('raw_moonsilver', (p, r) => { p.clear(); nugget(p, r, ['#c9d6f5', '#f2f6ff', '#9eaed8']); outline(p); });
registerSprite('sunstone_shard', (p) => { p.clear(); crystal(p, ['#ffcf5e', '#fff2c2', '#f0a63c']); outline(p); });
registerSprite('skyglass_shard', (p) => { p.clear(); crystal(p, ['#74dcef', '#e0fbff', '#3fb2cf']); outline(p); });

// ── build: texture array + per-tile canvases / average colours ──
export function buildAtlas(extraTileNames = []) {
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  for (const d of BLOCK_LIST) for (let f = 0; f < 6; f++) add(faceTile(d, f));
  for (const n of extraTileNames) add(n);
  for (const n of TILE_PAINTERS.keys()) add(n);
  if (names.length > 255) throw new Error('too many tiles');
  const L = names.length;
  const data = new Uint8Array(16 * 16 * 4 * L);
  const layer = new Map(), canvases = new Map(), avg = new Map();
  const px = new Px();
  names.forEach((name, li) => {
    px.clear(); px.fill('#ff00ff');
    const fn = TILE_PAINTERS.get(name);
    if (fn) fn(px, rng(name)); else console.warn('[voxel] missing tile painter', name);
    // average colour of opaque pixels; spread it into transparent ones (clean mip edges)
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < 256; i++) if (px.d[i * 4 + 3] > 0) { r += px.d[i * 4]; g += px.d[i * 4 + 1]; b += px.d[i * 4 + 2]; n++; }
    n = Math.max(1, n); r /= n; g /= n; b /= n;
    for (let i = 0; i < 256; i++) if (px.d[i * 4 + 3] === 0) { px.d[i * 4] = r; px.d[i * 4 + 1] = g; px.d[i * 4 + 2] = b; }
    avg.set(name, [r / 255, g / 255, b / 255]);
    // flip rows so v=1 is the top of the painted tile
    for (let y = 0; y < 16; y++) data.set(px.d.subarray((15 - y) * 64, (16 - y) * 64), li * 1024 + y * 64);
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const id = new ImageData(new Uint8ClampedArray(px.d), 16, 16);
    cv.getContext('2d').putImageData(id, 0, 0);
    canvases.set(name, cv);
    layer.set(name, li);
  });
  const tex = new THREE.DataArrayTexture(data, 16, 16, L);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true; tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { texture: tex, layer: (n) => layer.get(n) ?? 0, canvases, avg, names };
}

// Sprite canvases (items) + pixel data for extruded 3D models.
export function buildSprites() {
  const out = new Map();
  for (const [name, fn] of SPRITE_PAINTERS) {
    const p = new Px(); fn(p, rng(name));
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(p.d), 16, 16), 0, 0);
    out.set(name, { canvas: cv, px: p });
  }
  return out;
}

// 8-stage crack overlay strip (128×16).
export function buildCrackTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 16;
  const g = cv.getContext('2d');
  const r = rng('cracks');
  const paths = [];
  for (let i = 0; i < 10; i++) { const pts = []; let x = 8, y = 8; const a = r() * Math.PI * 2; for (let k = 0; k < 9; k++) { x += Math.cos(a + (r() - 0.5) * 1.6) * 1.3; y += Math.sin(a + (r() - 0.5) * 1.6) * 1.3; pts.push([Math.floor(x), Math.floor(y)]); } paths.push(pts); }
  for (let s = 0; s < 8; s++) {
    g.fillStyle = 'rgba(42,36,51,0.85)';
    const nPaths = 2 + s, len = 3 + s;
    for (let i = 0; i < nPaths && i < paths.length; i++) for (let k = 0; k < Math.min(len, paths[i].length); k++) {
      const [x, y] = paths[i][k];
      if (x >= 0 && x < 16 && y >= 0 && y < 16) g.fillRect(s * 16 + x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / 8, 1);
  return t;
}
