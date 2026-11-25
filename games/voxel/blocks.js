// Blockfell block registry. PURE DATA: no three.js import, because the world worker imports
// this file too (import maps don't apply inside workers).
//
// To add a block: append a def with a NEW, never-reused numeric id (ids are stored in saves and
// in the Uint8 voxel arrays, so 1..255, keep them stable). Then paint its tiles in textures.js
// (or reuse existing tile names). Fields:
//   id        1..255, unique, stable forever
//   key       short string id ('slate'); B.slate === id
//   name      display name
//   tiles     { all } or { top, bottom, side } or per-face { px, nx, py, ny, pz, nz }: tile names
//   render    'cube' (opaque), 'cutout' (alpha-tested, e.g. leaves/glass), 'liquid', 'cross' (plants), 'none'
//   solid     collides with the player (default: true for cube/cutout)
//   light     block-light emission 0..15
//   lightOpacity 0..15 how much it dims light passing through (default: 15 cube, 1 cutout, 2 liquid, 0 cross)
//   hardness  seconds to break by hand (Infinity = unbreakable, 0 = instant)
//   tool      'pick' | 'axe' | 'spade' | null: the tool that speeds it up
//   minTier   tool tier required for it to drop anything in survival (0 = hand ok)
//   drops     undefined → itself; null → nothing; 'itemKey'; or [{ item, count = 1, chance = 1 }]
//   sound     material for break/place/step sounds: stone, dirt, grass, sand, wood, leaves, glass, snow, cloth, plant
//   replaceable  placing a block into this cell overwrites it (plants, water)
//   wave      leaves/plants sway in the vertex shader
//   creative  false hides it from the creative palette (water, deepcore)
//   interact  true → main grip on it emits 'blockUse' instead of placing (chests, benches in phase 2)

export const CHUNK = 16;        // chunk size in x and z
export const HEIGHT = 96;       // world height (y 0..95)
export const SEA = 40;          // water fills air at y <= SEA

export const BLOCKS = [];       // dense by id: BLOCKS[id] = def (holes are undefined)
export const B = { air: 0 };    // key → id
export const BLOCK_LIST = [];   // defs in registration order

export function registerBlock(def) {
  if (BLOCKS[def.id]) throw new Error(`block id ${def.id} already used by ${BLOCKS[def.id].key}`);
  const render = def.render ?? 'cube';
  const d = {
    solid: render === 'cube' || render === 'cutout',
    light: 0,
    lightOpacity: render === 'cube' ? 15 : render === 'cutout' ? 1 : render === 'liquid' ? 2 : 0,
    hardness: 1, tool: null, minTier: 0, sound: 'stone',
    replaceable: false, wave: false, creative: true, interact: false,
    ...def, render,
  };
  BLOCKS[d.id] = d; B[d.key] = d.id; BLOCK_LIST.push(d);
  return d;
}

const blk = registerBlock;
BLOCKS[0] = { id: 0, key: 'air', name: 'Air', render: 'none', solid: false, light: 0, lightOpacity: 0, hardness: 0, replaceable: true, creative: false, tiles: {} };

// ── Ground ──────────────────────────────────────────────────
blk({ id: 1, key: 'turf', name: 'Meadow Turf', tiles: { top: 'turf_top', side: 'turf_side', bottom: 'loam' }, hardness: 0.6, tool: 'spade', drops: 'loam', sound: 'grass' });
blk({ id: 2, key: 'loam', name: 'Loam', tiles: { all: 'loam' }, hardness: 0.5, tool: 'spade', sound: 'dirt' });
blk({ id: 3, key: 'slate', name: 'Slate', tiles: { all: 'slate' }, hardness: 1.5, tool: 'pick', minTier: 1, drops: 'rubble' });
blk({ id: 4, key: 'rubble', name: 'Slate Rubble', tiles: { all: 'rubble' }, hardness: 2, tool: 'pick', minTier: 1 });
blk({ id: 5, key: 'sand', name: 'Dune Sand', tiles: { all: 'sand' }, hardness: 0.5, tool: 'spade', sound: 'sand' });
blk({ id: 6, key: 'duneshale', name: 'Duneshale', tiles: { top: 'duneshale_top', side: 'duneshale', bottom: 'duneshale_top' }, hardness: 1.0, tool: 'pick', minTier: 1 });
blk({ id: 7, key: 'snowpack', name: 'Snowpack', tiles: { top: 'snow', side: 'snow_side', bottom: 'loam' }, hardness: 0.4, tool: 'spade', sound: 'snow' });
blk({ id: 8, key: 'rime', name: 'Rime Ice', tiles: { all: 'rime' }, hardness: 0.6, tool: 'pick', drops: null, sound: 'glass' });
blk({ id: 9, key: 'water', name: 'Still Water', tiles: { all: 'water' }, render: 'liquid', solid: false, hardness: Infinity, replaceable: true, creative: false, sound: 'plant' });
blk({ id: 10, key: 'deepcore', name: 'Deepcore', tiles: { all: 'deepcore' }, hardness: Infinity, creative: false });
blk({ id: 11, key: 'shingle', name: 'Shingle', tiles: { all: 'shingle' }, hardness: 0.6, tool: 'spade', sound: 'sand' });
blk({ id: 12, key: 'riverclay', name: 'Riverclay', tiles: { all: 'riverclay' }, hardness: 0.6, tool: 'spade', sound: 'dirt' });

// ── Trees ───────────────────────────────────────────────────
blk({ id: 13, key: 'amber_log', name: 'Amberwood Log', tiles: { top: 'amber_ring', bottom: 'amber_ring', side: 'amber_bark' }, hardness: 2, tool: 'axe', sound: 'wood' });
blk({ id: 14, key: 'amber_leaves', name: 'Amber Canopy', tiles: { all: 'amber_leaves' }, render: 'cutout', hardness: 0.25, drops: [{ item: 'twig', chance: 0.12 }], sound: 'leaves', wave: true });
blk({ id: 15, key: 'amber_planks', name: 'Amberwood Planks', tiles: { all: 'amber_planks' }, hardness: 2, tool: 'axe', sound: 'wood' });
blk({ id: 16, key: 'plum_log', name: 'Plumwood Log', tiles: { top: 'plum_ring', bottom: 'plum_ring', side: 'plum_bark' }, hardness: 2, tool: 'axe', sound: 'wood' });
blk({ id: 17, key: 'blossom', name: 'Plum Blossom', tiles: { all: 'blossom' }, render: 'cutout', hardness: 0.25, drops: [{ item: 'twig', chance: 0.12 }], sound: 'leaves', wave: true });
blk({ id: 18, key: 'plum_planks', name: 'Plumwood Planks', tiles: { all: 'plum_planks' }, hardness: 2, tool: 'axe', sound: 'wood' });
blk({ id: 19, key: 'pine_log', name: 'Pinecrest Log', tiles: { top: 'pine_ring', bottom: 'pine_ring', side: 'pine_bark' }, hardness: 2, tool: 'axe', sound: 'wood' });
blk({ id: 20, key: 'pine_needles', name: 'Pine Needles', tiles: { all: 'pine_needles' }, render: 'cutout', hardness: 0.25, drops: [{ item: 'twig', chance: 0.12 }], sound: 'leaves', wave: true });
blk({ id: 21, key: 'pine_planks', name: 'Pinecrest Planks', tiles: { all: 'pine_planks' }, hardness: 2, tool: 'axe', sound: 'wood' });
blk({ id: 22, key: 'dunecap', name: 'Dunecap', tiles: { top: 'dunecap_top', bottom: 'dunecap_top', side: 'dunecap_side' }, hardness: 0.4, sound: 'plant' });

// ── Plants (cross) ──────────────────────────────────────────
const plant = { render: 'cross', solid: false, hardness: 0, replaceable: true, sound: 'plant', wave: true };
blk({ id: 23, key: 'tuft', name: 'Meadow Tuft', tiles: { all: 'tuft' }, ...plant, drops: null });
blk({ id: 24, key: 'bellflower', name: 'Bellflower', tiles: { all: 'bellflower' }, ...plant });
blk({ id: 25, key: 'emberbloom', name: 'Emberbloom', tiles: { all: 'emberbloom' }, ...plant });
blk({ id: 26, key: 'snowdrop', name: 'Snowdrop', tiles: { all: 'snowdrop' }, ...plant });
blk({ id: 27, key: 'tumbletwig', name: 'Tumbletwig', tiles: { all: 'tumbletwig' }, ...plant, drops: [{ item: 'twig', count: 1 }] });

// ── Ores (inside slate) ─────────────────────────────────────
blk({ id: 28, key: 'soot_seam', name: 'Soot Seam', tiles: { all: 'soot_seam' }, hardness: 3, tool: 'pick', minTier: 1, drops: 'soot_lump' });
blk({ id: 29, key: 'copper_vein', name: 'Copper Vein', tiles: { all: 'copper_vein' }, hardness: 3, tool: 'pick', minTier: 2, drops: 'raw_copper' });
blk({ id: 30, key: 'moonsilver_vein', name: 'Moonsilver Vein', tiles: { all: 'moonsilver_vein' }, hardness: 3.5, tool: 'pick', minTier: 3, drops: 'raw_moonsilver' });
blk({ id: 31, key: 'sunstone', name: 'Sunstone', tiles: { all: 'sunstone' }, hardness: 3, tool: 'pick', minTier: 3, light: 11, drops: [{ item: 'sunstone_shard', count: 2 }] });
blk({ id: 32, key: 'skyglass_geode', name: 'Skyglass Geode', tiles: { all: 'skyglass_geode' }, hardness: 4, tool: 'pick', minTier: 4, light: 4, drops: 'skyglass_shard' });

// ── Building ────────────────────────────────────────────────
blk({ id: 33, key: 'clear_pane', name: 'Clear Pane', tiles: { all: 'clear_pane' }, render: 'cutout', lightOpacity: 0, hardness: 0.3, drops: null, sound: 'glass' });
blk({ id: 34, key: 'lantern', name: 'Paper Lantern', tiles: { top: 'lantern_top', bottom: 'lantern_top', side: 'lantern' }, render: 'cutout', light: 15, lightOpacity: 0, hardness: 0.3, sound: 'cloth' });
blk({ id: 35, key: 'kiln_brick', name: 'Kiln Brick', tiles: { all: 'kiln_brick' }, hardness: 2, tool: 'pick', minTier: 1 });
blk({ id: 36, key: 'thatch', name: 'Thatch', tiles: { top: 'thatch_top', bottom: 'thatch_top', side: 'thatch' }, hardness: 0.5, sound: 'grass' });
blk({ id: 37, key: 'felt_rose', name: 'Rose Felt', tiles: { all: 'felt_rose' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 38, key: 'felt_sky', name: 'Sky Felt', tiles: { all: 'felt_sky' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 39, key: 'felt_mint', name: 'Mint Felt', tiles: { all: 'felt_mint' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 40, key: 'felt_butter', name: 'Butter Felt', tiles: { all: 'felt_butter' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 41, key: 'felt_lilac', name: 'Lilac Felt', tiles: { all: 'felt_lilac' }, hardness: 0.8, sound: 'cloth' });
blk({ id: 42, key: 'slate_brick', name: 'Slate Bricks', tiles: { all: 'slate_brick' }, hardness: 2, tool: 'pick', minTier: 1 });
blk({ id: 43, key: 'glowcap', name: 'Glowcap', tiles: { all: 'glowcap' }, ...plant, wave: false, light: 9 });
blk({ id: 44, key: 'mossy_rubble', name: 'Mossy Rubble', tiles: { all: 'mossy_rubble' }, hardness: 2, tool: 'pick', minTier: 1 });

// Face order used everywhere: 0 +x, 1 -x, 2 +y (top), 3 -y (bottom), 4 +z, 5 -z
export const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export function faceTile(def, face) {
  const t = def.tiles || {};
  const k = FACE_KEYS[face];
  if (t[k]) return t[k];
  if (face === 2 && t.top) return t.top;
  if (face === 3 && t.bottom) return t.bottom;
  if (face !== 2 && face !== 3 && t.side) return t.side;
  return t.all ?? t.side ?? t.top;
}

const RENDER_CODE = { none: 0, cube: 1, cutout: 2, liquid: 3, cross: 4 };

// Compact, transferable table the worker uses for lighting + meshing.
// tileLayer(name) → texture-array layer index.
export function buildBlockTable(tileLayer) {
  const N = 256;
  const t = {
    render: new Uint8Array(N), lightOpacity: new Uint8Array(N), light: new Uint8Array(N),
    wave: new Uint8Array(N), layers: new Uint16Array(N * 6),
  };
  for (let id = 1; id < N; id++) {
    const d = BLOCKS[id];
    if (!d) continue;
    t.render[id] = RENDER_CODE[d.render] ?? 1;
    t.lightOpacity[id] = d.lightOpacity; t.light[id] = d.light; t.wave[id] = d.wave ? 1 : 0;
    for (let f = 0; f < 6; f++) t.layers[id * 6 + f] = tileLayer(faceTile(d, f));
  }
  return t;
}

export const chunkKey = (cx, cz) => `${cx},${cz}`;
export const voxIndex = (x, y, z) => x + (z << 4) + (y << 8); // local coords
