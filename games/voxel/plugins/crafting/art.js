// Blockfell crafting content: procedural 16×16 tiles + item sprites, in the same soft pastel
// "gouache" style as textures.js (painted at module load, before create() builds the atlas).
import { registerTile, registerSprite, hex } from '../../textures.js';

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const C = (c) => typeof c === 'string' ? hex(c) : c;
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

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
function ground(p, rnd, base, light, dark, amt = 1) {
  const n = vnoise(rnd, 4), n2 = vnoise(rnd, 8), B = C(base), L = C(light), D = C(dark);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = n[x + y * 16] * 0.7 + n2[x + y * 16] * 0.3 + (rnd() - 0.5) * 0.18 * amt;
    p.set(x, y, v > 0.62 ? mix(B, L, Math.min(1, (v - 0.62) * 3.5)) : v < 0.38 ? mix(B, D, Math.min(1, (0.38 - v) * 3.5)) : B);
  }
}
function planks(p, rnd, base, seam, grain, vertical = false) {
  const B = C(base);
  for (let a = 0; a < 16; a++) {
    const plank = a >> 2, shift = plank % 2 ? 8 : 3, pv = Math.sin(plank * 12.9898 + 4.1) * 0.03;
    for (let b = 0; b < 16; b++) {
      let c = mix(B, pv > 0 ? WHITE : BLACK, Math.abs(pv));
      if ((a & 3) === 3) c = C(seam);
      else if (((b + shift) & 15) === 0) c = mix(c, C(seam), 0.8);
      else if (rnd() < 0.1) c = mix(c, C(grain), 0.5);
      else if ((a & 3) === 0) c = mix(c, WHITE, 0.08);
      if (vertical) p.set(a, b, c); else p.set(b, a, c);
    }
  }
}
function felt(p, rnd, base) {
  const B = C(base);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const w = ((x + y) & 1) ? 0.035 : -0.035;
    p.set(x, y, mix(B, w > 0 ? WHITE : [40, 30, 60], Math.abs(w) + rnd() * 0.04));
  }
  for (let i = 0; i < 5; i++) { const x = (rnd() * 16) | 0, y = (rnd() * 16) | 0; p.tint(x, y, '#ffffff', 0.18); p.tint(x + 1, y, '#ffffff', 0.1); }
}
function frame(p, col, w = 1) { for (let i = 0; i < 16; i++) for (let k = 0; k < w; k++) { p.set(i, k, col); p.set(i, 15 - k, col); p.set(k, i, col); p.set(15 - k, i, col); } }
function rect(p, x0, y0, x1, y1, col, a = 255) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, col, a); }
function bricks(p, rnd, tones, mortar, h = 4, w = 8) {
  const T = tones.map(C);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const row = Math.floor(y / h), xx = (x + (row % 2) * (w / 2)) % w, brick = Math.floor((x + (row % 2) * (w / 2)) / w) + row * 3;
    let c = T[brick % T.length];
    if (y % h === h - 1 || xx === w - 1) c = C(mortar);
    else if (y % h === 0) c = mix(c, WHITE, 0.12);
    p.set(x, y, mix(c, BLACK, rnd() * 0.05));
  }
}

// ── stations ────────────────────────────────────────────────
registerTile('bench_top', (p, r) => {
  planks(p, r, '#dcb07b', '#a8784b', '#bf9161');
  frame(p, '#9a6a44');
  // a set-square and a pencil line carved into the top
  for (let i = 3; i < 10; i++) { p.set(i, 3, '#7fb6a8'); p.set(3, i, '#7fb6a8'); }
  for (let i = 4; i < 12; i++) p.set(i + 1, 16 - i, '#5e4a63');
  p.set(12, 12, '#e58f9f'); p.set(13, 12, '#e58f9f');
});
registerTile('bench_side', (p, r) => {
  p.clear();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) p.set(x, y, mix(C(y === 3 ? '#9a6a44' : '#d3a670'), WHITE, (r() - 0.5) * 0.08));
  for (let y = 4; y < 16; y++) for (const x of [1, 2, 13, 14]) p.set(x, y, x === 1 || x === 13 ? '#b98758' : '#9a6a44');
  for (let x = 3; x < 13; x++) { p.set(x, 10, '#c49464'); p.set(x, 11, '#9a6a44'); }
  for (const [x, y] of [[5, 8], [6, 8], [9, 9], [10, 9]]) p.set(x, y, '#8e9aae');   // tools on the shelf
  p.set(5, 9, '#c3cbd8'); p.set(10, 8, '#e0895a');
});
const KILN = ['#e2a58a', '#d8977c', '#eab49a', '#cf8e74'];
function kilnBody(p, r) {
  ground(p, r, '#e0a287', '#efbea6', '#c98a71');
  for (let x = 0; x < 16; x++) { p.tint(x, 0, '#b97a63', 0.5); p.tint(x, 15, '#9d6553', 0.6); }
  for (let i = 0; i < 6; i++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; p.tint(x, y, KILN[(r() * 4) | 0], 0.7); }
}
function kilnMouth(p, lit) {
  for (let y = 7; y < 15; y++) for (let x = 4; x < 12; x++) {
    const dx = x - 7.5, dy = y - 9.5;
    if (y < 10 && dx * dx + dy * dy * 1.4 > 13) continue;
    const edge = x === 4 || x === 11 || (y < 10 && dx * dx + dy * dy * 1.4 > 8);
    if (edge) { p.set(x, y, '#8a5545'); continue; }
    if (!lit) p.set(x, y, y > 12 ? '#4a3a44' : '#3a2e3a');
    else { const t = (y - 8) / 6; p.set(x, y, mix(C('#fff1b8'), C('#f2894e'), Math.min(1, Math.abs(dx) / 4 + (1 - t) * 0.6))); }
  }
  if (lit) { p.set(7, 13, '#ffffff'); p.set(8, 12, '#fff8d8'); }
}
registerTile('kiln_side', (p, r) => { kilnBody(p, r); kilnMouth(p, false); });
registerTile('kiln_side_lit', (p, r) => { kilnBody(p, r); kilnMouth(p, true); });
registerTile('kiln_top', (p, r) => {
  kilnBody(p, r);
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) p.set(x, y, (x === 5 || x === 10 || y === 5 || y === 10) ? '#a86e5a' : '#4a3a44');
});
registerTile('kiln_top_lit', (p, r) => {
  kilnBody(p, r);
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) p.set(x, y, (x === 5 || x === 10 || y === 5 || y === 10) ? '#a86e5a' : ((x + y) & 1 ? '#ffb36b' : '#ffe2a0'));
});
const CEDAR = { base: '#d49a86', seam: '#a1655a', grain: '#bd8272', band: '#d9b46a', bandDk: '#a8834a' };
registerTile('chest_top', (p, r) => {
  planks(p, r, CEDAR.base, CEDAR.seam, CEDAR.grain);
  frame(p, CEDAR.band);
  for (let i = 1; i < 15; i++) { p.set(i, 1, CEDAR.bandDk); p.set(1, i, CEDAR.bandDk); }
});
registerTile('chest_side', (p, r) => {
  planks(p, r, CEDAR.base, CEDAR.seam, CEDAR.grain);
  for (let x = 0; x < 16; x++) { p.set(x, 5, CEDAR.bandDk); p.set(x, 4, '#8f5a50'); }
  for (let y = 0; y < 16; y++) for (const x of [0, 15]) p.set(x, y, CEDAR.band);
  rect(p, 6, 4, 9, 8, CEDAR.band); rect(p, 7, 6, 8, 7, '#5e4a63');
  p.set(6, 4, '#f3dc9a');
});

// ── farming ─────────────────────────────────────────────────
registerTile('tilled_top', (p, r) => {
  ground(p, r, '#a77a63', '#bd917a', '#8d6352');
  for (let y = 0; y < 16; y++) if (y % 4 === 1 || y % 4 === 2) for (let x = 0; x < 16; x++) p.tint(x, y, y % 4 === 1 ? '#6f4c40' : '#c79f87', 0.45);
  for (let i = 0; i < 6; i++) p.set((r() * 16) | 0, ((r() * 4) | 0) * 4 + 3, '#dcc6ae');
});
function sprout(p, r, n, h, lo, hi) {
  for (let i = 0; i < n; i++) {
    let x = 2 + (i * 12 / Math.max(1, n - 1)) + (r() - 0.5); const hh = h - ((r() * 3) | 0), lean = (r() - 0.5) * 0.3;
    for (let k = 0; k < hh; k++) { p.set(Math.round(x), 15 - k, mix(C(lo), C(hi), k / hh)); x += lean; }
  }
}
registerTile('barley_0', (p, r) => { p.clear(); sprout(p, r, 4, 4, '#6fa36b', '#a8d391'); });
registerTile('barley_1', (p, r) => { p.clear(); sprout(p, r, 5, 8, '#6fa36b', '#b4d98f'); });
registerTile('barley_2', (p, r) => {
  p.clear(); sprout(p, r, 5, 12, '#79a868', '#c6dd8f');
  for (const x of [3, 8, 13]) for (let k = 0; k < 3; k++) p.set(x, 3 + k, '#d8e59c');
});
registerTile('barley_3', (p, r) => {
  p.clear(); sprout(p, r, 5, 13, '#c9b06a', '#e8d18a');
  for (const x of [2, 6, 10, 13]) for (let k = 0; k < 5; k++) { p.set(x, 1 + k, k & 1 ? '#f3d27e' : '#e6b95e'); p.set(x + 1, 2 + k, '#f8e2a0'); }
});
function leafy(p, r, h, tone) {
  for (let i = 0; i < 4; i++) {
    const x0 = 3 + i * 3, top = 15 - h + ((r() * 2) | 0);
    for (let y = top; y < 16; y++) p.set(x0, y, '#5e9a62');
    for (let k = 0; k < 3; k++) { p.set(x0 - 1, top + k, tone); p.set(x0 + 1, top + k + 1, tone); }
  }
}
registerTile('earthroot_0', (p, r) => { p.clear(); leafy(p, r, 3, '#8cc47e'); });
registerTile('earthroot_1', (p, r) => { p.clear(); leafy(p, r, 6, '#86c07c'); });
registerTile('earthroot_2', (p, r) => { p.clear(); leafy(p, r, 9, '#7db874'); });
registerTile('earthroot_3', (p, r) => {
  p.clear(); leafy(p, r, 10, '#7db874');
  for (const x of [4, 10]) { rect(p, x, 13, x + 2, 15, '#c77fa0'); p.set(x + 1, 13, '#e3a3c0'); }
});

// ── light + building ────────────────────────────────────────
registerTile('rushlight', (p) => {
  p.clear();
  for (let y = 7; y < 16; y++) { p.set(7, y, '#9a7350'); p.set(8, y, '#7a5638'); }
  p.set(7, 7, '#4a3a44'); p.set(8, 7, '#4a3a44');
  const fl = [[7, 6, '#ffe7a3'], [8, 6, '#ffd27a'], [7, 5, '#fff4d2'], [8, 5, '#ffe7a3'], [7, 4, '#ffd27a'], [8, 4, '#ffffff'], [7, 3, '#ffbf73'], [8, 2, '#ffd27a'], [6, 6, '#f6a35f'], [9, 6, '#f6a35f'], [6, 5, '#ffc98a'], [9, 5, '#ffc98a']];
  for (const [x, y, c] of fl) p.set(x, y, c);
});
registerTile('sunstone_lamp', (p, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5) / 10;
    p.set(x, y, mix(C('#fff6d4'), C('#ffc65e'), Math.min(1, d + r() * 0.08)));
  }
  frame(p, '#9b7b52'); for (let i = 0; i < 16; i++) { p.set(i, 1, '#c9a46a'); p.set(1, i, '#c9a46a'); }
  for (let i = 4; i < 12; i++) { p.set(i, 7, '#ffe6a0'); p.set(7, i, '#ffe6a0'); }
});
function lattice(p, wood, paper, cell = 5) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const onLine = x === 0 || x === 15 || y === 0 || y === 15 || x % cell === 0 || y % cell === 0;
    p.set(x, y, onLine ? wood : mix(C(paper), WHITE, ((x * 7 + y * 3) % 5) * 0.015));
  }
}
registerTile('paper_screen', (p) => lattice(p, '#8b6650', '#f7efe0'));
registerTile('slate_tiles', (p, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const q = ((x >> 3) + (y >> 3)) & 1;
    let c = C(q ? '#a2adbf' : '#96a2b5');
    if ((x & 7) === 7 || (y & 7) === 7) c = C('#6f7a91');
    else if ((x & 7) === 0 || (y & 7) === 0) c = mix(c, WHITE, 0.2);
    p.set(x, y, mix(c, WHITE, (r() - 0.5) * 0.05));
  }
});
registerTile('dune_brick', (p, r) => bricks(p, r, ['#ecd3a8', '#e2c596', '#f0dbb3'], '#c7a77c', 4, 8));
registerTile('felt_cream', (p, r) => felt(p, r, '#f4ead6'));
registerTile('felt_ink', (p, r) => felt(p, r, '#5b5470'));
registerTile('felt_peach', (p, r) => felt(p, r, '#f7c3a2'));
function doorPlank(p, r, upper) {
  planks(p, r, '#d0a173', '#9a6a44', '#b98a59', true);
  for (let i = 0; i < 16; i++) { p.set(0, i, '#8a5c3c'); p.set(15, i, '#8a5c3c'); }
  if (upper) { for (let x = 0; x < 16; x++) p.set(x, 0, '#8a5c3c'); rect(p, 4, 3, 11, 9, '#000000', 0); for (let x = 3; x < 13; x++) { p.set(x, 2, '#8a5c3c'); p.set(x, 10, '#8a5c3c'); } for (let y = 2; y < 11; y++) { p.set(3, y, '#8a5c3c'); p.set(12, y, '#8a5c3c'); p.set(7, y, '#8a5c3c'); } }
  else { for (let x = 0; x < 16; x++) { p.set(x, 15, '#8a5c3c'); p.set(x, 8, '#a8784b'); } p.set(12, 1, '#e7c77d'); p.set(12, 2, '#c9a14f'); }
}
registerTile('door_plank_lo', (p, r) => doorPlank(p, r, false));
registerTile('door_plank_hi', (p, r) => doorPlank(p, r, true));
registerTile('door_paper_lo', (p) => { lattice(p, '#7a5a48', '#f5ebdc', 5); for (let x = 0; x < 16; x++) { p.set(x, 15, '#5e4436'); p.set(x, 14, '#5e4436'); } });
registerTile('door_paper_hi', (p) => { lattice(p, '#7a5a48', '#f5ebdc', 5); for (let x = 0; x < 16; x++) p.set(x, 0, '#5e4436'); });
registerTile('ladder', (p) => {
  p.clear();
  for (let y = 0; y < 16; y++) { p.set(2, y, '#a98058'); p.set(3, y, '#86603f'); p.set(12, y, '#a98058'); p.set(13, y, '#86603f'); }
  for (const y of [2, 6, 10, 14]) for (let x = 4; x < 12; x++) p.set(x, y, x & 1 ? '#c49a6c' : '#b48a5e');
  for (const y of [2, 6, 10, 14]) { p.set(4, y + 1, '#7fb685'); p.set(11, y + 1, '#7fb685'); }  // twine lashings
});

// ── item sprites ────────────────────────────────────────────
const INK = '#3a3346';
function outline(p) {
  const a = []; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) a.push(p.alpha(x, y) > 0);
  const n = (xx, yy) => xx >= 0 && xx < 16 && yy >= 0 && yy < 16 && a[xx + yy * 16];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (!a[x + y * 16] && (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1))) p.set(x, y, INK);
}
function line(p, x0, y0, x1, y1, col) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
  for (let i = 0; i <= n; i++) p.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), col);
}
const spr = (name, fn) => registerSprite(name, (p, r) => { p.clear(); fn(p, r); outline(p); });

export function bladeSprite(head, hi) {
  return (p) => {
    p.clear();
    line(p, 2, 14, 4, 12, '#7a5638'); line(p, 3, 14, 5, 12, '#9a7350');
    line(p, 3, 10, 7, 14, '#c9a14f');                         // cross guard
    for (let k = 0; k < 9; k++) { p.set(6 + k, 11 - k, head); p.set(5 + k, 11 - k, hi); p.set(6 + k, 10 - k, hi); }
    p.set(14, 2, hi); p.set(14, 1, head);
    outline(p);
  };
}
export function tillerSprite(head, hi) {
  return (p) => {
    p.clear();
    line(p, 2, 14, 10, 6, '#9a7350'); line(p, 3, 14, 11, 6, '#7a5638');
    for (let x = 9; x < 15; x++) { p.set(x, 3, head); p.set(x, 4, x < 12 ? hi : head); }
    p.set(14, 5, head); p.set(14, 6, head); p.set(13, 5, hi);
    outline(p);
  };
}
spr('fiber', (p) => { for (let k = 0; k < 3; k++) { let x = 4 + k * 3; for (let y = 13; y > 2; y--) { p.set(x, y, k === 1 ? '#9fcf7d' : '#7fb06b'); if (y % 3 === 0) x += k === 2 ? -1 : 1; } } });
spr('barley_seed', (p) => { for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 9], [5, 11], [9, 12]]) { p.set(x, y, '#e2c275'); p.set(x + 1, y, '#c9a35a'); p.set(x, y + 1, '#f3dc9a'); } });
spr('barley', (p) => {
  for (let k = 0; k < 3; k++) line(p, 6 + k * 2, 15, 5 + k * 3, 6, '#b99a58');
  for (const [x, y] of [[4, 2], [7, 1], [10, 2]]) for (let j = 0; j < 5; j++) { p.set(x, y + j, '#f0cc72'); p.set(x + 1, y + j, j & 1 ? '#e2b357' : '#f8e2a0'); }
  for (let x = 5; x < 11; x++) p.set(x, 11, '#e58f9f');   // ribbon
});
spr('earthroot', (p) => {
  for (let y = 6; y < 14; y++) for (let x = 4; x < 12; x++) { const dx = (x - 7.5) / 3.6, dy = (y - 9.8) / 3.6; if (dx * dx + dy * dy < 1) p.set(x, y, dy < -0.3 ? '#e3a3c0' : dy > 0.4 ? '#a9668a' : '#c77fa0'); }
  for (const [x, y] of [[6, 5], [7, 4], [8, 3], [9, 4], [10, 2], [6, 3], [5, 2]]) p.set(x, y, '#7db874');
  p.set(6, 8, '#f6d3e2');
});
spr('roasted_earthroot', (p) => {
  for (let y = 6; y < 14; y++) for (let x = 3; x < 13; x++) { const dx = (x - 7.5) / 4.6, dy = (y - 9.8) / 3.4; if (dx * dx + dy * dy < 1) p.set(x, y, dy < -0.3 ? '#e2a27e' : dy > 0.4 ? '#9c5e4a' : '#c47a5e'); }
  for (const [x, y] of [[6, 10], [9, 9], [8, 11]]) p.set(x, y, '#f6d18a');
  for (const [x, y] of [[6, 3], [7, 2], [9, 3], [10, 1]]) p.set(x, y, '#ffffff', 200);
});
spr('barley_loaf', (p) => {
  for (let y = 5; y < 13; y++) for (let x = 2; x < 14; x++) { const dx = (x - 7.5) / 6, dy = (y - 9) / 4; if (dx * dx + dy * dy < 1) p.set(x, y, dy < -0.2 ? '#e8b878' : dy > 0.5 ? '#b77c4c' : '#d69b5f'); }
  for (const x of [5, 8, 11]) { p.set(x, 7, '#f6dca6'); p.set(x - 1, 8, '#f6dca6'); }
});
function ingot(p, top, mid, dark) {
  for (let y = 6; y < 12; y++) for (let x = 2; x < 14; x++) {
    const inset = 11 - y;
    if (x < 2 + Math.max(0, inset - 2) || x > 13 - Math.max(0, inset - 2)) continue;
    p.set(x, y, y < 8 ? top : y > 9 ? dark : mid);
  }
  p.set(5, 6, '#ffffff'); p.set(6, 6, '#ffffff');
}
spr('copper_ingot', (p) => ingot(p, '#f6bf97', '#e0895a', '#b5643f'));
spr('moonsilver_ingot', (p) => ingot(p, '#f6f9ff', '#c9d6f5', '#9eaed8'));
spr('fired_brick', (p) => { rect(p, 2, 6, 13, 11, '#d48b6d'); rect(p, 2, 6, 13, 7, '#e3a48a'); rect(p, 2, 11, 13, 11, '#b96e54'); p.set(4, 8, '#ead8c4'); p.set(10, 9, '#b96e54'); });
spr('paper', (p) => { for (let y = 3; y < 14; y++) for (let x = 3; x < 13; x++) p.set(x, y, (x + y) % 7 ? '#f8f1e3' : '#efe3cc'); for (let x = 5; x < 11; x++) { p.set(x, 6, '#c9bfd8'); p.set(x, 9, '#c9bfd8'); } p.set(12, 3, '#000000', 0); });
spr('plank_door', (p) => {
  rect(p, 4, 1, 11, 14, '#d0a173'); for (let y = 1; y < 15; y++) { p.set(7, y, '#a8784b'); }
  rect(p, 5, 2, 10, 5, '#000000', 0); for (let x = 5; x < 11; x++) p.set(x, 8, '#a8784b');
  p.set(10, 9, '#e7c77d');
});
spr('paper_door', (p) => {
  for (let y = 1; y < 15; y++) for (let x = 4; x < 12; x++) p.set(x, y, (x === 4 || x === 11 || y === 1 || y === 14 || x === 8 || y % 4 === 1) ? '#7a5a48' : '#f5ebdc');
});
spr('ladder_item', (p) => {
  for (let y = 1; y < 15; y++) { p.set(4, y, '#a98058'); p.set(11, y, '#a98058'); }
  for (const y of [3, 7, 11]) for (let x = 5; x < 11; x++) p.set(x, y, '#c49a6c');
});
