// Blockfell item registry. Every block is also an item with the SAME numeric id (1..255).
// Non-block items (tools, materials, later food etc.) use ids >= 256.
//
// Add an item:  registerItem({ id: 300, key: 'my_thing', name: 'My Thing', sprite: 'my_thing', stack: 64 })
// and paint its sprite with registerSprite('my_thing', (p, rnd) => ...) from textures.js.
// Tool items carry tool: { type: 'pick'|'axe'|'spade'|'blade'..., tier, speed, durability }.
// Fields: id, key, name, kind ('block'|'tool'|'material'|...), block (block id for kind 'block'),
//         sprite (sprite name for non-blocks), stack (max stack size), tool, food (phase 2), etc.
import { BLOCK_LIST, BLOCKS } from './blocks.js';
import { registerSprite, toolSprite } from './textures.js';

export const ITEMS = [];   // by id
export const I = {};       // key → id

export function registerItem(def) {
  if (ITEMS[def.id]) throw new Error(`item id ${def.id} already used by ${ITEMS[def.id].key}`);
  const d = { kind: 'material', stack: 64, ...def };
  ITEMS[d.id] = d; I[d.key] = d.id;
  return d;
}

for (const b of BLOCK_LIST) registerItem({ id: b.id, key: b.key, name: b.name, kind: 'block', block: b.id, stack: 64 });

registerItem({ id: 256, key: 'twig', name: 'Twig', sprite: 'twig' });
registerItem({ id: 257, key: 'soot_lump', name: 'Soot Lump', sprite: 'soot_lump' });
registerItem({ id: 258, key: 'raw_copper', name: 'Raw Copper', sprite: 'raw_copper' });
registerItem({ id: 259, key: 'raw_moonsilver', name: 'Raw Moonsilver', sprite: 'raw_moonsilver' });
registerItem({ id: 260, key: 'sunstone_shard', name: 'Sunstone Shard', sprite: 'sunstone_shard' });
registerItem({ id: 261, key: 'skyglass_shard', name: 'Skyglass Shard', sprite: 'skyglass_shard' });

// Tools: 5 tiers × 3 kinds, ids 270..284
export const TOOL_TIERS = [
  { key: 'driftwood', name: 'Driftwood', tier: 1, speed: 2, durability: 60, head: '#c9a77a', hi: '#e8d0a4' },
  { key: 'slate', name: 'Slate', tier: 2, speed: 4, durability: 140, head: '#8e9aae', hi: '#c3cbd8' },
  { key: 'copper', name: 'Copper', tier: 3, speed: 6, durability: 260, head: '#e0895a', hi: '#f6bf97' },
  { key: 'moonsilver', name: 'Moonsilver', tier: 4, speed: 8, durability: 900, head: '#c9d6f5', hi: '#f6f9ff' },
  { key: 'skyglass', name: 'Skyglass', tier: 5, speed: 12, durability: 1800, head: '#5fd2e8', hi: '#d0f7fd' },
];
const KINDS = [['pick', 'Pick'], ['axe', 'Hatchet'], ['spade', 'Spade']];
TOOL_TIERS.forEach((t, ti) => KINDS.forEach(([type, label], ki) => {
  const key = `${t.key}_${type}`;
  registerSprite(key, toolSprite(type, t.head, t.hi));
  registerItem({ id: 270 + ti * 3 + ki, key, name: `${t.name} ${label}`, kind: 'tool', sprite: key, stack: 1, tool: { type, tier: t.tier, speed: t.speed, durability: t.durability } });
}));

export const itemDef = (id) => ITEMS[id] ?? null;
export const isBlockItem = (id) => id > 0 && id < 256 && !!BLOCKS[id];

// How long breaking takes and whether it drops, for a block def and the held stack (or null).
export function breakInfo(blockDef, stack, creative) {
  if (blockDef.hardness === Infinity) return { time: Infinity, drops: false };
  if (creative) return { time: 0.12, drops: false };
  const tool = stack ? ITEMS[stack.id]?.tool : null;
  const matches = tool && blockDef.tool && tool.type === blockDef.tool;
  const tier = matches ? tool.tier : 0;
  const canDrop = tier >= (blockDef.minTier ?? 0);
  let time = blockDef.hardness * 1.5;
  if (matches) time /= tool.speed;
  if (!canDrop) time = blockDef.hardness * 5;
  return { time: Math.max(0.05, time), drops: canDrop, usedTool: !!matches };
}

// Resolve a block's drops into [{ id, count }].
export function rollDrops(blockDef, rnd = Math.random) {
  const d = blockDef.drops;
  if (d === null) return [];
  if (d === undefined) return [{ id: blockDef.id, count: 1 }];
  if (typeof d === 'string') return I[d] ? [{ id: I[d], count: 1 }] : [];
  const out = [];
  for (const e of d) if (rnd() < (e.chance ?? 1) && I[e.item]) out.push({ id: I[e.item], count: e.count ?? 1 });
  return out;
}
