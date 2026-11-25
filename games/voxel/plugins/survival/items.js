// Survival items: creature drops, foraged food, the sling and the bedroll.
// Registered at module load (before create() builds sprites). Ids 420..449 are reserved for survival.
import { ITEMS, I, registerItem } from '../../items.js';
import { registerSprite } from '../../textures.js';

const INK = '#3a3346';
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lerpHex = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return [0, 1, 2].map(i => Math.round(x[i] + (y[i] - x[i]) * t)); };

// ── tiny pixel-art helpers (16×16, pastel gouache + ink outline like the phase-1 sprites) ──
function blob(p, cx, cy, rx, ry, light, base, dark) {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
    if (d > 1) continue;
    const sh = (dx + dy) * 0.5 + d * 0.35; // upper-left lit
    p.set(x, y, sh < -0.25 ? light : sh > 0.45 ? dark : base);
  }
}
function line(p, x0, y0, x1, y1, col) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) p.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), col);
}
function outline(p) {
  const on = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) on.push(p.alpha(x, y) > 0);
  const at = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && on[x + y * 16];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++)
    if (!at(x, y) && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) p.set(x, y, INK);
}
function glowDots(p, pts, col) { for (const [x, y] of pts) p.set(x, y, col); }

const SPRITES = {
  mossback_haunch(p) { // rosy cut with a cream knuckle
    p.clear(); blob(p, 6.5, 9.5, 5, 4.2, '#f4b3a6', '#e48a80', '#c4656a');
    line(p, 10, 6, 13, 3, '#f3ead6'); p.set(13, 2, '#fff8ea'); p.set(14, 3, '#fff8ea'); p.set(12, 2, '#f3ead6');
    glowDots(p, [[4, 8], [5, 7]], '#ffd6cc'); outline(p);
  },
  moss_hide(p) {
    p.clear(); blob(p, 8, 9, 6.2, 5, '#e3cda8', '#cfb38a', '#a98d68');
    for (let x = 3; x < 13; x++) { p.set(x, 5 + ((x * 7) % 3 === 0 ? 0 : 1), '#8fbf72'); p.set(x, 6, '#79a862'); }
    glowDots(p, [[5, 5], [10, 5]], '#f2a7c3'); outline(p);
  },
  kite_plume(p) {
    p.clear();
    for (let i = 0; i < 11; i++) { const x = 3 + i, y = 13 - i; p.set(x, y, '#f3f6ff'); if (i > 1 && i < 10) { p.set(x - 1, y - 1, '#a9cdf2'); p.set(x + 1, y + 1, '#8db8e8'); if (i % 2) p.set(x - 2, y - 2, '#cfe3f8'); } }
    line(p, 2, 14, 4, 12, '#9a7350'); outline(p);
  },
  glimmerfin(p) {
    p.clear(); blob(p, 7, 8, 5.5, 3.4, '#a8e8df', '#6cc9c0', '#3f9e9f');
    for (let x = 3; x < 11; x++) p.set(x, 8, '#f6d77a');
    p.set(13, 6, '#6cc9c0'); p.set(13, 10, '#6cc9c0'); p.set(14, 5, '#3f9e9f'); p.set(14, 11, '#3f9e9f'); p.set(13, 8, '#3f9e9f'); p.set(12, 7, '#6cc9c0'); p.set(12, 9, '#6cc9c0');
    p.set(4, 7, INK); outline(p);
  },
  ink_essence(p) {
    p.clear(); blob(p, 8, 9.5, 4.6, 4.8, '#5a4a86', '#3b2f5e', '#251d3d');
    line(p, 8, 2, 8, 5, '#3b2f5e'); p.set(7, 4, '#3b2f5e'); p.set(9, 4, '#3b2f5e');
    glowDots(p, [[7, 9], [8, 9], [8, 10], [7, 10], [9, 8]], '#9ff3ff'); p.set(6, 8, '#e6fdff'); outline(p);
  },
  crab_shell(p) {
    p.clear(); blob(p, 8, 10, 6.5, 4.5, '#b9c2d2', '#8e9aae', '#68738a');
    for (let x = 2; x < 15; x++) for (let y = 11; y < 16; y++) p.d[(y * 16 + x) * 4 + 3] = y > 12 ? 0 : p.d[(y * 16 + x) * 4 + 3];
    glowDots(p, [[6, 7], [9, 6], [11, 8]], '#74dcef'); glowDots(p, [[6, 6], [9, 5]], '#e0fbff'); outline(p);
  },
  hornbloom_antler(p) {
    p.clear(); line(p, 3, 14, 8, 6, '#e9dcc4'); line(p, 8, 6, 8, 2, '#e9dcc4'); line(p, 8, 6, 13, 3, '#e9dcc4'); line(p, 6, 9, 3, 6, '#d6c6a8');
    glowDots(p, [[8, 1], [7, 2], [9, 2]], '#f49ab8'); glowDots(p, [[13, 2], [14, 3]], '#fbd36e'); glowDots(p, [[2, 5]], '#f49ab8'); outline(p);
  },
  hornbloom_venison(p) {
    p.clear(); blob(p, 8, 8.5, 6, 4.5, '#f0a59a', '#d8786f', '#b45a5a');
    line(p, 4, 7, 11, 11, '#fbe3d6'); glowDots(p, [[6, 6]], '#ffd2c6'); outline(p);
  },
  moth_dust(p) {
    p.clear(); blob(p, 8, 11, 5.5, 3, '#fff3b8', '#f6d77a', '#e0b155');
    glowDots(p, [[5, 6], [9, 4], [11, 7], [7, 3], [12, 5]], '#fff8d6'); outline(p);
  },
  wyrm_heart(p) {
    p.clear();
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const X = (x + 0.5 - 8) / 6, Y = -(y + 0.5 - 8.5) / 6;
      const v = Math.pow(X * X + Y * Y - 0.55, 3) - X * X * Y * Y * Y;
      if (v <= 0) { const t = Math.min(1, Math.max(0, (x + y) / 26)); p.set(x, y, lerpHex('#ffb38a', '#c23a5a', t)); }
    }
    glowDots(p, [[5, 6], [6, 5], [6, 6]], '#fff1d6'); outline(p);
  },
  wyrm_scale(p) {
    p.clear(); blob(p, 8, 8, 5, 6, '#9fb1d6', '#6f82ad', '#4a5a82');
    line(p, 8, 3, 8, 12, '#b8c8ea'); glowDots(p, [[6, 5]], '#e4ecff'); outline(p);
  },
  dewberry(p) {
    p.clear(); blob(p, 6, 10, 3, 3, '#a9a8ec', '#7a74d0', '#544fa6'); blob(p, 10.5, 10.5, 3, 3, '#a9a8ec', '#7a74d0', '#544fa6'); blob(p, 8.3, 6.8, 2.8, 2.8, '#b8b6f2', '#8a84da', '#5c57ae');
    line(p, 8, 4, 11, 1, '#6fa36b'); p.set(12, 1, '#8fc07a'); glowDots(p, [[5, 9], [9, 9], [7, 6]], '#eef0ff'); outline(p);
  },
  plumfruit(p) {
    p.clear(); blob(p, 8, 9.5, 5, 5, '#c79ad6', '#9e6bb8', '#744a92');
    line(p, 8, 4, 9, 2, '#7a5638'); p.set(10, 2, '#8fc07a'); p.set(11, 3, '#8fc07a'); glowDots(p, [[6, 7], [6, 8]], '#ecd6f4'); outline(p);
  },
  roast_haunch(p) {
    p.clear(); blob(p, 6.5, 9.5, 5, 4.2, '#d9a066', '#b5713f', '#8a4f2c');
    line(p, 10, 6, 13, 3, '#f3ead6'); p.set(13, 2, '#fff8ea'); p.set(14, 3, '#fff8ea'); p.set(12, 2, '#f3ead6');
    glowDots(p, [[4, 8], [5, 7], [7, 11]], '#f2c48a'); outline(p);
  },
  seared_glimmerfin(p) {
    p.clear(); blob(p, 7, 8, 5.5, 3.4, '#e8c58a', '#c99a5c', '#9a6d3f');
    for (let x = 4; x < 11; x += 2) { p.set(x, 7, '#7a4f2c'); p.set(x + 1, 9, '#7a4f2c'); }
    p.set(13, 6, '#c99a5c'); p.set(13, 10, '#c99a5c'); p.set(14, 5, '#9a6d3f'); p.set(14, 11, '#9a6d3f'); p.set(13, 8, '#9a6d3f'); p.set(12, 7, '#c99a5c'); p.set(12, 9, '#c99a5c');
    outline(p);
  },
  roast_flank(p) {
    p.clear(); blob(p, 8, 8.5, 6, 4.5, '#d9a066', '#b5713f', '#8a4f2c');
    line(p, 4, 7, 11, 11, '#f2d3a6'); glowDots(p, [[6, 6]], '#f6d6aa'); outline(p);
  },
  sling(p) {
    p.clear(); line(p, 4, 14, 7, 9, '#9a7350'); line(p, 7, 9, 5, 3, '#9a7350'); line(p, 7, 9, 11, 4, '#9a7350');
    line(p, 5, 3, 8, 6, '#e6a6b8'); line(p, 11, 4, 8, 6, '#e6a6b8'); p.set(8, 6, '#c47e93'); p.set(8, 7, '#c47e93'); outline(p);
  },
  bedroll(p) {
    p.clear();
    for (let y = 5; y < 12; y++) for (let x = 2; x < 14; x++) p.set(x, y, (x >> 1) % 2 ? '#e58f9f' : '#f3c1cb');
    blob(p, 12.5, 8.5, 2.2, 3.6, '#f8e4d0', '#e9d1b8', '#c9ad92'); line(p, 5, 5, 5, 11, '#9a7350'); line(p, 9, 5, 9, 11, '#9a7350'); outline(p);
  },
};

// id, key, name, extra
const DEFS = [
  [420, 'mossback_haunch', 'Mossback Haunch', { food: { hunger: 3, saturation: 1.6 }, smelt: { to: 'roast_haunch', time: 6 } }],
  [421, 'moss_hide', 'Moss Hide', {}],
  [422, 'kite_plume', 'Kite Plume', {}],
  [423, 'glimmerfin', 'Raw Glimmerfin', { food: { hunger: 2, saturation: 1 }, smelt: { to: 'seared_glimmerfin', time: 5 } }],
  [424, 'ink_essence', 'Ink Essence', {}],
  [425, 'crab_shell', 'Cragcrab Shell', {}],
  [426, 'hornbloom_antler', 'Hornbloom Antler', {}],
  [427, 'hornbloom_venison', 'Hornbloom Flank', { food: { hunger: 4, saturation: 2 }, smelt: { to: 'roast_flank', time: 6 } }],
  [428, 'moth_dust', 'Lantern Dust', {}],
  [429, 'wyrm_heart', 'Wyrmheart Ember', { stack: 16, food: { hunger: 10, saturation: 12, heal: 20, always: true } }],
  [430, 'wyrm_scale', 'Deep Wyrm Scale', {}],
  [431, 'dewberry', 'Dewberries', { food: { hunger: 2, saturation: 0.6 } }],
  [432, 'plumfruit', 'Blossom Plum', { food: { hunger: 4, saturation: 2.4 } }],
  [433, 'sling', 'Twine Sling', { kind: 'weapon', stack: 1, weapon: { damage: 1, ranged: true, ammo: ['rubble', 'shingle'] } }],
  [434, 'bedroll', 'Bedroll', { kind: 'bedroll', stack: 1 }],
  [435, 'roast_haunch', 'Roast Haunch', { food: { hunger: 8, saturation: 12 } }],
  [436, 'seared_glimmerfin', 'Seared Glimmerfin', { food: { hunger: 5, saturation: 6 } }],
  [437, 'roast_flank', 'Roast Hornbloom Flank', { food: { hunger: 8, saturation: 12.8 } }],
];

for (const [name, fn] of Object.entries(SPRITES)) registerSprite(name, fn);
for (const [id, key, name, extra] of DEFS) {
  if (ITEMS[id]) { if (ITEMS[id].key !== key) console.warn(`[voxel/survival] item id ${id} taken by ${ITEMS[id].key}`); continue; }
  if (I[key] != null) continue;
  registerItem({ id, key, name, sprite: key, kind: extra.kind ?? (extra.food ? 'food' : 'material'), ...extra });
}

// Damage an item deals in melee. Items may carry weapon: { damage }; tools fall back by type/tier.
export function meleeDamage(stack) {
  if (!stack) return 1;
  const d = ITEMS[stack.id];
  if (!d) return 1;
  if (d.weapon && !d.weapon.ranged && Number.isFinite(d.weapon.damage)) return d.weapon.damage;
  if (Number.isFinite(d.damage)) return d.damage;   // crafting plugin: blades etc. carry a top-level damage
  const t = d.tool;
  if (t) {
    const tier = t.tier ?? 1;
    if (t.type === 'blade' || t.type === 'sword') return 4 + tier * 1.5;
    if (t.type === 'axe') return 3 + tier;
    if (t.type === 'pick') return 2 + tier * 0.5;
    return 1.5 + tier * 0.5;
  }
  return d.kind === 'block' ? 1 : 1;
}
export const isBlade = (stack) => { const t = stack && ITEMS[stack.id]?.tool; return !!(t && (t.type === 'blade' || t.type === 'sword')) || !!(stack && ITEMS[stack.id]?.weapon && !ITEMS[stack.id].weapon.ranged); };
export const foodOf = (stack) => (stack && ITEMS[stack.id]?.food) || null;
