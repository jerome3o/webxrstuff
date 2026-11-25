// Blockfell crafting content: blocks (ids 100–199), items (ids 600–699), tags, recipes, kiln
// smelting and fuel. Everything registers at module load (before create() builds the atlas and
// the worker block table). Pure data + tiny helpers; the systems live in ../crafting.js.
import { registerBlock, BLOCKS, B } from '../../blocks.js';
import { registerItem, ITEMS, I, TOOL_TIERS } from '../../items.js';
import { registerSprite } from '../../textures.js';
import { bladeSprite, tillerSprite } from './art.js';

// ── shapes (main-thread shape layer, see shapes.js) ─────────
// Boxes are [x0,y0,z0,x1,y1,z1] in 1/16 block. Facing index f: 0 = −x side, 1 = +z, 2 = +x, 3 = −z.
export const PANEL = [
  (t) => [0, 0, 0, t, 16, 16], (t) => [0, 0, 16 - t, 16, 16, 16],
  (t) => [16 - t, 0, 0, 16, 16, 16], (t) => [0, 0, 0, 16, 16, t],
];
const STAIR_TOP = [[0, 8, 0, 8, 16, 16], [0, 8, 8, 16, 16, 16], [8, 8, 0, 16, 16, 16], [0, 8, 0, 16, 16, 8]];
export const SHAPE_IDS = [];    // every block id rendered by the shape layer

const blk = (d) => { const r = registerBlock(d); if (d.shape) SHAPE_IDS.push(d.id); return r; };
const asItem = (id, extra = {}) => { const b = BLOCKS[id]; return registerItem({ id, key: b.key, name: b.name, kind: 'block', block: id, stack: 64, ...extra }); };

// ── stations ────────────────────────────────────────────────
blk({ id: 100, key: 'joiner_bench', name: "Joiner's Bench", tiles: { top: 'bench_top', bottom: 'amber_planks', side: 'bench_side' }, render: 'cutout', lightOpacity: 1, hardness: 2, tool: 'axe', sound: 'wood', interact: true });
blk({ id: 101, key: 'clay_kiln', name: 'Clay Kiln', tiles: { top: 'kiln_top', bottom: 'kiln_top', side: 'kiln_side' }, hardness: 2.5, tool: 'pick', interact: true });
blk({ id: 102, key: 'clay_kiln_lit', name: 'Clay Kiln (lit)', tiles: { top: 'kiln_top_lit', bottom: 'kiln_top', side: 'kiln_side_lit' }, hardness: 2.5, tool: 'pick', interact: true, light: 13, drops: 'clay_kiln', creative: false });
blk({ id: 103, key: 'cedar_chest', name: 'Cedar Chest', tiles: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side' }, hardness: 2, tool: 'axe', sound: 'wood', interact: true });

// ── farming ─────────────────────────────────────────────────
blk({ id: 104, key: 'tilled_loam', name: 'Tilled Loam', tiles: { top: 'tilled_top', side: 'loam', bottom: 'loam' }, hardness: 0.5, tool: 'spade', drops: 'loam', sound: 'dirt' });
const crop = { render: 'cross', solid: false, hardness: 0, replaceable: false, sound: 'plant', wave: true, creative: false };
export const CROPS = {
  barley: { ids: [105, 106, 107, 108], seed: 'barley_seed' },
  earthroot: { ids: [109, 110, 111, 112], seed: 'earthroot' },
};
for (let s = 0; s < 4; s++) {
  blk({ id: 105 + s, key: `barley_${s}`, name: 'Sun Barley', tiles: { all: `barley_${s}` }, ...crop,
    drops: s < 3 ? 'barley_seed' : [{ item: 'barley', count: 2 }, { item: 'barley_seed' }, { item: 'barley_seed', chance: 0.5 }] });
  blk({ id: 109 + s, key: `earthroot_${s}`, name: 'Earthroot', tiles: { all: `earthroot_${s}` }, ...crop,
    drops: s < 3 ? 'earthroot' : [{ item: 'earthroot', count: 2 }, { item: 'earthroot', chance: 0.5 }] });
}

// ── light + building ────────────────────────────────────────
blk({ id: 113, key: 'rushlight', name: 'Rushlight', tiles: { all: 'rushlight' }, render: 'cross', solid: false, hardness: 0, light: 14, sound: 'wood' });
blk({ id: 114, key: 'sunstone_lamp', name: 'Sunstone Lamp', tiles: { all: 'sunstone_lamp' }, light: 15, hardness: 0.6, sound: 'glass' });
blk({ id: 115, key: 'paper_screen', name: 'Paper Screen', tiles: { all: 'paper_screen' }, render: 'cutout', lightOpacity: 2, hardness: 0.5, sound: 'cloth' });
blk({ id: 116, key: 'slate_tiles', name: 'Slate Tiles', tiles: { all: 'slate_tiles' }, hardness: 2, tool: 'pick', minTier: 1 });
blk({ id: 117, key: 'dune_brick', name: 'Dune Bricks', tiles: { all: 'dune_brick' }, hardness: 1.6, tool: 'pick', minTier: 1 });
blk({ id: 118, key: 'felt_cream', name: 'Oat Felt', tiles: { all: 'felt_cream' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 119, key: 'felt_ink', name: 'Ink Felt', tiles: { all: 'felt_ink' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 120, key: 'felt_peach', name: 'Peach Felt', tiles: { all: 'felt_peach' }, hardness: 0.8, sound: 'cloth' });

// slabs (lower half) — lightOpacity 15: shape faces take the light of the cell they face
const SLAB = [[0, 0, 0, 16, 8, 16]];
const shapeBase = { render: 'none', solid: true, lightOpacity: 15 };
blk({ id: 122, key: 'amber_slab', name: 'Amberwood Slab', tiles: { all: 'amber_planks' }, ...shapeBase, shape: SLAB, hardness: 1.5, tool: 'axe', sound: 'wood' });
blk({ id: 123, key: 'slate_brick_slab', name: 'Slate Brick Slab', tiles: { all: 'slate_brick' }, ...shapeBase, shape: SLAB, hardness: 1.5, tool: 'pick', minTier: 1 });
blk({ id: 124, key: 'rubble_slab', name: 'Rubble Slab', tiles: { all: 'rubble' }, ...shapeBase, shape: SLAB, hardness: 1.5, tool: 'pick', minTier: 1 });
blk({ id: 125, key: 'kiln_brick_slab', name: 'Kiln Brick Slab', tiles: { all: 'kiln_brick' }, ...shapeBase, shape: SLAB, hardness: 1.5, tool: 'pick', minTier: 1 });
// steps: 4 facings each; the first id is the item, placement turns it to face away from the player
export const STAIRS = { amber_stairs: 126, slate_stairs: 130 };
for (let f = 0; f < 4; f++) {
  blk({ id: 126 + f, key: f ? `amber_stairs_${f}` : 'amber_stairs', name: 'Amberwood Steps', tiles: { all: 'amber_planks' }, ...shapeBase, lightOpacity: 2, shape: [SLAB[0], STAIR_TOP[f]], hardness: 1.5, tool: 'axe', sound: 'wood', drops: 'amber_stairs', creative: !f, stairBase: 126, facing: f });
  blk({ id: 130 + f, key: f ? `slate_stairs_${f}` : 'slate_stairs', name: 'Slate Brick Steps', tiles: { all: 'slate_brick' }, ...shapeBase, lightOpacity: 2, shape: [SLAB[0], STAIR_TOP[f]], hardness: 1.5, tool: 'pick', minTier: 1, drops: 'slate_stairs', creative: !f, stairBase: 130, facing: f });
}
// fences / walls: post + rails toward connecting neighbours (computed by the shape layer)
blk({ id: 134, key: 'pine_rail', name: 'Pine Rail', tiles: { all: 'pine_planks' }, render: 'none', solid: true, lightOpacity: 0, hardness: 1.5, tool: 'axe', sound: 'wood',
  shape: 'fence', fence: { post: [6, 0, 6, 10, 16, 10], rails: [[6, 9], [12, 15]], half: 1 } });
blk({ id: 135, key: 'rubble_wall', name: 'Rubble Wall', tiles: { all: 'rubble' }, render: 'none', solid: true, lightOpacity: 0, hardness: 2, tool: 'pick', minTier: 1,
  shape: 'fence', fence: { post: [4, 0, 4, 12, 16, 12], rails: [[0, 13]], half: 3 } });
// ladders: thin panel against a wall (facing = wall side)
export const LADDER0 = 136;
for (let f = 0; f < 4; f++) blk({ id: 136 + f, key: `twig_ladder_${f}`, name: 'Twig Ladder', tiles: { all: 'ladder' }, render: 'none', solid: false, lightOpacity: 0, hardness: 0.4, tool: 'axe', sound: 'wood', drops: 'twig_ladder', creative: false, interact: true, ladder: true, shape: [PANEL[f](1)] });
// doors: id = base + facing + open*4 + upper*8 (closed panel on side `facing`, open panel swings to facing+1)
export const DOORS = { plank_door: 140, paper_door: 156 };
const ITEM_NAMES = { plank_door: 'Plank Door', paper_door: 'Paper Door' };
for (const [item, base, tile, hard, sound, tool] of [['plank_door', 140, 'door_plank', 1.5, 'wood', 'axe'], ['paper_door', 156, 'door_paper', 0.8, 'cloth', null]]) {
  for (let i = 0; i < 16; i++) {
    const f = i & 3, open = (i >> 2) & 1, upper = i >> 3;
    blk({ id: base + i, key: `${item}_${i}`, name: ITEM_NAMES[item], tiles: { all: `${tile}_${upper ? 'hi' : 'lo'}` }, render: 'none', solid: !open, lightOpacity: 0,
      hardness: hard, tool, sound, drops: upper ? null : item, creative: false, interact: true, door: { base, f, open, upper },
      shape: [PANEL[open ? (f + 1) & 3 : f](3)] });
  }
}

// ── items ───────────────────────────────────────────────────
for (const id of [100, 101, 103, 104, 113, 114, 115, 116, 117, 118, 119, 120, 122, 123, 124, 125, 126, 130, 134, 135]) asItem(id);
const item = (id, key, name, extra = {}) => registerItem({ id, key, name, sprite: extra.sprite ?? key, ...extra });
item(600, 'fiber', 'Meadow Fiber');
item(601, 'barley_seed', 'Barley Seeds', { plant: 'barley' });
item(602, 'barley', 'Sun Barley');
item(603, 'earthroot', 'Earthroot', { plant: 'earthroot', food: { hunger: 2, saturation: 1 } });
item(604, 'roasted_earthroot', 'Hearth-Roasted Root', { food: { hunger: 6, saturation: 7 } });
item(605, 'barley_loaf', 'Barley Loaf', { food: { hunger: 5, saturation: 6 } });
item(606, 'copper_ingot', 'Copper Ingot');
item(607, 'moonsilver_ingot', 'Moonsilver Ingot');
item(608, 'fired_brick', 'Fired Brick');
item(609, 'paper', 'Reed Paper');
item(610, 'plank_door', 'Plank Door', { kind: 'placer', stack: 16 });
item(611, 'paper_door', 'Paper Door', { kind: 'placer', stack: 16 });
item(612, 'twig_ladder', 'Twig Ladder', { kind: 'placer', sprite: 'ladder_item' });

// blades + tillers for all 5 tiers (ids 620..629); every tool gets a melee `damage`
const BLADE_DMG = [4, 5, 6, 7, 9];
TOOL_TIERS.forEach((t, ti) => {
  registerSprite(`${t.key}_blade`, bladeSprite(t.head, t.hi));
  registerSprite(`${t.key}_tiller`, tillerSprite(t.head, t.hi));
  registerItem({ id: 620 + ti * 2, key: `${t.key}_blade`, name: `${t.name} Blade`, kind: 'tool', sprite: `${t.key}_blade`, stack: 1, damage: BLADE_DMG[ti], tool: { type: 'blade', tier: t.tier, speed: t.speed, durability: t.durability } });
  registerItem({ id: 621 + ti * 2, key: `${t.key}_tiller`, name: `${t.name} Tiller`, kind: 'tool', sprite: `${t.key}_tiller`, stack: 1, damage: 1 + Math.floor(t.tier / 2), tool: { type: 'tiller', tier: t.tier, speed: t.speed, durability: t.durability } });
  for (const k of ['pick', 'axe', 'spade']) { const d = ITEMS[I[`${t.key}_${k}`]]; if (d && d.damage == null) d.damage = (k === 'axe' ? 2 : 1) + Math.floor(t.tier / 2); }
});

// meadow tufts now yield fiber and seeds (phase-1 tufts dropped nothing)
if (BLOCKS[B.tuft]) BLOCKS[B.tuft].drops = [{ item: 'fiber', chance: 0.35 }, { item: 'barley_seed', chance: 0.14 }, { item: 'earthroot', chance: 0.05 }];

// ── tags (an input may name '#tag' to accept any member) ────
export const TAGS = {
  planks: ['amber_planks', 'plum_planks', 'pine_planks'],
  log: ['amber_log', 'plum_log', 'pine_log'],
};

// ── recipes ─────────────────────────────────────────────────
// { out: [key, count], in: [[key|'#tag', n], ...], st: 'hand'|'bench', cat }
export const RECIPES = [];
const R = (st, cat, out, n, ...ins) => RECIPES.push({ out: [out, n], in: ins, st, cat });
// hand (anywhere, from the pack)
R('hand', 'build', 'amber_planks', 4, ['amber_log', 1]);
R('hand', 'build', 'plum_planks', 4, ['plum_log', 1]);
R('hand', 'build', 'pine_planks', 4, ['pine_log', 1]);
R('hand', 'misc', 'twig', 4, ['#planks', 2]);
R('hand', 'misc', 'joiner_bench', 1, ['#planks', 4]);
R('hand', 'deco', 'rushlight', 4, ['twig', 1], ['soot_lump', 1]);
R('hand', 'farm', 'barley_seed', 2, ['barley', 1]);
R('hand', 'deco', 'felt_cream', 1, ['fiber', 4]);
R('hand', 'deco', 'felt_rose', 1, ['felt_cream', 1], ['emberbloom', 1]);
R('hand', 'deco', 'felt_sky', 1, ['felt_cream', 1], ['bellflower', 1]);
R('hand', 'deco', 'felt_mint', 1, ['felt_cream', 1], ['glowcap', 1]);
R('hand', 'deco', 'felt_butter', 1, ['felt_cream', 1], ['barley', 1]);
R('hand', 'deco', 'felt_ink', 1, ['felt_cream', 1], ['soot_lump', 1]);
R('hand', 'deco', 'felt_lilac', 2, ['felt_rose', 1], ['felt_sky', 1]);
R('hand', 'deco', 'felt_peach', 2, ['felt_rose', 1], ['felt_butter', 1]);
// bench: tools for every tier
const TIER_MAT = { driftwood: ['#planks'], slate: ['rubble'], copper: ['copper_ingot'], moonsilver: ['moonsilver_ingot'], skyglass: ['skyglass_shard', ['sunstone_shard', 1]] };
for (const t of TOOL_TIERS) {
  const [m, extra] = TIER_MAT[t.key];
  const X = extra ? [extra] : [];
  R('bench', 'tools', `${t.key}_pick`, 1, [m, 3], ['twig', 2], ...X);
  R('bench', 'tools', `${t.key}_axe`, 1, [m, 3], ['twig', 2], ...X);
  R('bench', 'tools', `${t.key}_spade`, 1, [m, 1], ['twig', 2], ...X);
  R('bench', 'tools', `${t.key}_blade`, 1, [m, 2], ['twig', 1], ...X);
  R('bench', 'tools', `${t.key}_tiller`, 1, [m, 2], ['twig', 2], ...X);
}
R('bench', 'misc', 'clay_kiln', 1, ['rubble', 6], ['loam', 2]);
R('bench', 'misc', 'cedar_chest', 1, ['#planks', 8]);
R('bench', 'misc', 'paper', 3, ['fiber', 3]);
R('bench', 'build', 'slate_brick', 4, ['slate', 4]);
R('bench', 'build', 'slate_tiles', 4, ['slate_brick', 4]);
R('bench', 'build', 'dune_brick', 4, ['duneshale', 4]);
R('bench', 'build', 'kiln_brick', 1, ['fired_brick', 4]);
R('bench', 'build', 'amber_slab', 6, ['amber_planks', 3]);
R('bench', 'build', 'slate_brick_slab', 6, ['slate_brick', 3]);
R('bench', 'build', 'rubble_slab', 6, ['rubble', 3]);
R('bench', 'build', 'kiln_brick_slab', 6, ['kiln_brick', 3]);
R('bench', 'build', 'amber_stairs', 4, ['amber_planks', 6]);
R('bench', 'build', 'slate_stairs', 4, ['slate_brick', 6]);
R('bench', 'build', 'pine_rail', 3, ['pine_planks', 2], ['twig', 4]);
R('bench', 'build', 'rubble_wall', 6, ['rubble', 6]);
R('bench', 'build', 'plank_door', 1, ['#planks', 6]);
R('bench', 'build', 'paper_door', 1, ['twig', 4], ['paper', 2]);
R('bench', 'build', 'twig_ladder', 3, ['twig', 7]);
R('bench', 'build', 'paper_screen', 4, ['twig', 4], ['paper', 2]);
R('bench', 'build', 'thatch', 2, ['fiber', 6]);
R('bench', 'deco', 'lantern', 2, ['paper', 2], ['rushlight', 1]);
R('bench', 'deco', 'sunstone_lamp', 1, ['sunstone_shard', 4], ['clear_pane', 1]);
R('bench', 'farm', 'barley_loaf', 1, ['barley', 3]);

// ── kiln ────────────────────────────────────────────────────
// SMELT: input key|'#tag' → { out, count, time (s per item) }. Items may also carry
// `smelt: { to: 'key', count?, time? }` and `fuel: seconds` (used for survival-plugin foods etc.).
export const SMELT = [
  { in: 'raw_copper', out: 'copper_ingot', count: 1, time: 10 },
  { in: 'raw_moonsilver', out: 'moonsilver_ingot', count: 1, time: 14 },
  { in: 'sand', out: 'clear_pane', count: 1, time: 8 },
  { in: 'riverclay', out: 'fired_brick', count: 4, time: 10 },
  { in: 'rubble', out: 'slate', count: 1, time: 8 },
  { in: 'mossy_rubble', out: 'slate', count: 1, time: 8 },
  { in: '#log', out: 'soot_lump', count: 1, time: 12 },
  { in: 'earthroot', out: 'roasted_earthroot', count: 1, time: 6 },
];
export const FUEL = { soot_lump: 60, '#log': 20, '#planks': 10, twig: 3, tumbletwig: 3, fiber: 1.5, thatch: 6, joiner_bench: 20, cedar_chest: 20 };

// ── resolution helpers (by numeric id) ──────────────────────
export function tagIds(spec) {
  if (spec[0] === '#') return (TAGS[spec.slice(1)] || []).map(k => I[k]).filter(Boolean);
  return I[spec] ? [I[spec]] : [];
}
const smeltById = new Map(), fuelById = new Map();
export function buildLookups() {
  smeltById.clear(); fuelById.clear();
  for (const s of SMELT) for (const id of tagIds(s.in)) smeltById.set(id, { out: I[s.out], count: s.count, time: s.time });
  for (const k in FUEL) for (const id of tagIds(k)) fuelById.set(id, FUEL[k]);
  for (const d of ITEMS) {
    if (!d) continue;
    if (d.smelt && I[d.smelt.to]) smeltById.set(d.id, { out: I[d.smelt.to], count: d.smelt.count ?? 1, time: d.smelt.time ?? 8 });
    if (d.fuel > 0) fuelById.set(d.id, d.fuel);
  }
}
export const smeltFor = (id) => smeltById.get(id) ?? null;
export const fuelFor = (id) => fuelById.get(id) ?? 0;
