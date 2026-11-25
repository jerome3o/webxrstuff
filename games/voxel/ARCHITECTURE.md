# Blockfell: architecture (phase 1)

Voxel mine-and-build sandbox. Entry `index.js` → `create(ctx)` builds one `game` object that every
module receives and that later modules extend. In the browser console it is `window.__voxel`.

## Modules

| file | runs on | role |
|---|---|---|
| `blocks.js` | main + worker | Block registry (pure data, **no three.js import**). `CHUNK=16`, `HEIGHT=96`, `SEA=40`. `registerBlock`, `BLOCKS[id]`, `B.key → id`, `buildBlockTable()` |
| `items.js` | main | Item registry. Blocks are items with the same id (1..255); others are 256+. Tools (5 tiers × pick/axe/spade), `breakInfo()`, `rollDrops()` |
| `textures.js` | main | Procedural 16×16 tile + sprite painters (`registerTile`, `registerSprite`), builds the `DataArrayTexture` atlas (1 layer per tile, NEAREST + mipmaps), sprite canvases, crack overlay |
| `noise.js` | worker | Seeded simplex 2D/3D, hashes |
| `worldgen.js` | worker | Terrain: biomes (ocean, beach, plains, forest, desert, snowy hills, mountains), caves (noise tunnels + deep caverns), ore veins, water/ice, flowers/tufts/glowcaps, 3 tree kinds + dunecaps |
| `mesher.js` | worker | Per-chunk skylight + block-light flood fill over a 36×36 region, face-culled mesh with per-vertex AO and smooth light |
| `worker.js` | worker | Message loop: generate, mesh, apply edits, priority remesh queue |
| `world.js` | main | Loaded chunks (blocks + light copies), streaming around the player, chunk meshes, `getBlock/setBlock/getLight/raycast`, edit diff for saves |
| `materials.js` | main | Chunk `ShaderMaterial`s (opaque/cutout, water) sharing one uniforms object; shared quad index; `blockGeometry(id)` mini block meshes |
| `sky.js` | main | Day/night: sky dome, sun, moon, stars, clouds, hemisphere + directional light for entities; writes daylight/fog uniforms |
| `player.js` | main | AABB body (X/Z follow the head, height follows the head), gravity, swim, fly, auto-step, snap/smooth turn, teleport, vignette |
| `interact.js` | main | Raycast + physical-touch targeting, break (hardness/tool, crack, particles, haptics) and place, held item + VR mittens |
| `inventory.js` | main | 36 slots (0..8 hotbar), add/remove/swap/wear, JSON |
| `ui.js` | main | Wrist (VR) / bottom-of-view (desktop) hotbar, tabbed modal panel (Pack/Blocks, Settings), toasts, laser pointer |
| `models.js` | main | Item 3D models (block cubes, extruded sprites) and 64 px icons |
| `drops.js` | main | `ItemDrop` entity |
| `audio.js` | main | Per-material hit/break/place/step sounds, ambience (wind, birds by day, crickets at night) |
| `events.js` | main | Event bus |

## The `game` object

```
game.ctx, scene, input, settings, seed, mode ('survival'|'creative'), time (s since launch)
game.events      on(name, fn) → unsubscribe, once, off, emit
game.world       World (below)
game.player      Player: position (feet centre), eye, velocity, feetY, width, height, scale,
                 onGround, inWater, headInWater, flying, teleport(x,y,z), push(vx,vy,vz)
game.inventory   Inventory: slots, selected, selectedStack, add(id,n) → leftover, removeItem(id,n),
                 count(id), takeFromSlot(i,n), setSlot(i,stack), swap(a,b), wearSelected(n), canFit(id)
game.sky         time (0 midnight, .25 sunrise, .5 noon, .75 sunset), day, daylight (0.2..1), isNight,
                 elevation, setTime(t), dayLength (s, default 1200)
game.ui          addTab(), open(tabId), close(), toggle(tabId), toast(text), modalOpen, slotButton()
game.interact    breakBlock(x,y,z,{drops,wear}), target (current targeted cell or null)
game.audio       material(kind, 'break'|'hit'|'place'|'step', pos), pop(pos), click(), splash(pos), sfx (kit Sfx)
game.models      create(itemId) → Object3D, icon(itemId) → canvas
game.atlas       layer(tileName), canvases (tile canvases), avg (average colours)
game.mats        uniforms (shared chunk uniforms), opaque, water, item
game.entities    array of { update(dt) → false to remove, dispose(), dead }
game.rigInv      inverse rig matrix captured at frame start (world pose → rig-local)

game.spawnDrop(id, count, pos, vel?)   game.addEntity(e)   game.breakBlock(x,y,z,opts)
game.damagePlayer(amount, cause, source)  → emits 'playerDamaged' (phase 2 owns health)
game.setMode(m)  game.setSetting(key, value)  game.setRenderDistance(n)  game.save()  game.toast(msg)
```

Frame order (`update` in index.js): capture `rigInv` → hotbar/menu input → `player.update` →
`world.update` (streaming, apply ≤2 meshes) → `sky.update` + fog → `interact.update` → entities →
`ui.update` → ambience → `events.emit('tick', { dt, time })` → autosave (20 s) → desktop HUD line.

## Events

| event | payload | notes |
|---|---|---|
| `tick` | `{ dt, time }` | every frame, after the built-in systems (the same object is reused) |
| `blockBreak` | `{ x,y,z,id, cancel }` | before a player break; set `cancel = true` to veto |
| `blockBroken` | `{ x,y,z,id, drops, by }` | after |
| `blockPlace` | `{ x,y,z,id, cancel }` | before a player place; cancellable |
| `blockPlaced` | `{ x,y,z,id, by }` | after |
| `blockChanged` | `{ x,y,z,id, prev, cause }` | any `world.setBlock` |
| `blockUse` | `{ x,y,z,id, stack, handled }` | main grip on a block whose def has `interact: true`; set `handled` to stop placing |
| `useItem` | `{ stack, target, handled }` | main grip while holding a non-block item (food, buckets…) |
| `itemPickedUp` | `{ id, count }` | |
| `inventoryChanged` | `{ inventory }` | |
| `toolBroken` | `{ id }` | |
| `playerLanded` | `{ fall }` | fall distance in blocks |
| `playerDamaged` | `{ amount, cause, source }` | emitted for fall damage in survival (> 3.5 blocks) and by `game.damagePlayer` |
| `modeChanged`, `settingChanged` | `{ mode }`, `{ key, value }` | |
| `chunkLoaded`, `chunkUnloaded` | `{ cx, cz, chunk? }` | e.g. spawn creatures per chunk |
| `save` | `{ data }` | add your own fields to `data` before it is written |
| `load` | `{ data }` | the saved object (or `{}` for a new world), after the player is placed |
| `dispose` | `{}` | clean up your listeners/objects |

## World API

```
world.getBlock(x,y,z)  → id, −1 if the chunk isn't loaded (treat as solid)
world.setBlock(x,y,z,id,{cause}) → bool. Records the edit, updates the worker, remeshes
world.getLight(x,y,z,out?) → { sky 0..15, block 0..15 }  (sky = potential skylight; × sky.daylight for the
                       current level. Mob spawning: sky*daylight and block both low → dark)
world.isSolid(x,y,z)   world.isLoaded(x,z)   world.surfaceY(x,z,fromY) → top face y or −1
world.raycast(origin, dir, maxDist, out, skip?) → out { hit, x,y,z, nx,ny,nz, id, dist }
world.renderDistance, setRenderDistance(n), chunks (Map), edits (Map 'cx,cz' → Map(idx → id))
```

Chunk arrays: `Uint8Array(16*16*96)`, index `x + z*16 + y*256` (local coords). Light arrays same
layout, `(sky << 4) | block`.

## Data formats

**Block def** (see the header of `blocks.js`): `id, key, name, tiles, render ('cube'|'cutout'|'liquid'|'cross'), solid,
light, lightOpacity, hardness, tool, minTier, drops, sound, replaceable, wave, creative, interact`.

**Item def**: `id, key, name, kind ('block'|'tool'|'material'|…), block, sprite, stack, tool { type, tier, speed, durability }`.
Tool tiers: 1 driftwood, 2 slate, 3 copper, 4 moonsilver, 5 skyglass. A block drops only if the held tool
type matches `def.tool` and its tier ≥ `def.minTier`. Break time = hardness × 1.5 (÷ tool speed if it matches;
hardness × 5 without the required tier). Creative: 0.12 s, no drops, nothing consumed.

**Inventory stack**: `{ id, count, dur? }`.

**Vertex format** (chunk meshes, 12 bytes): `position Uint16×3` in 1/16 block, `uv Uint8×2` in 1/16,
`data Uint8×4 = [layer, face | ao<<3 | flags<<5, sky*17, block*17]`. Faces 0..5 = +x −x +y −y +z −z, 6 = plant.

**Saves** (`ctx.save`, localStorage):
- `voxel:meta` → `{ seed, settings }`
- `voxel:world:<seed>` → `{ v: 1, mode, edits: { 'cx,cz': base64([idxLo, idxHi, id] × n) }, player: { x,y,z,yaw,flying }, inv, time, day, …fields added on 'save' }`

Only player edits are stored; terrain regenerates from the seed.

## Extension recipes

**New block** (phase 2 crafting): append to `blocks.js` with a new id (≤255, never reuse ids), paint its
tiles in `textures.js` with `registerTile`. It becomes an item automatically. Register at module load
time (before `create` builds the atlas and the worker table). Blocks that only exist on the main thread
are fine for meshing (the worker receives the compiled table), but world generation only knows blocks
from `blocks.js`. For a chest/bench set `interact: true` and handle `blockUse`.

**New item / tool**: `registerItem({ id: 300+, ... })` in `items.js` (or a module imported before
`create`), plus `registerSprite(name, painter)`. New tool types work through `tool.type` matching
`blockDef.tool`.

**New panel tab** (crafting, smelting, chest): `game.ui.addTab({ id, label, draw(c, W, H, panel, ui) })`, then
`game.ui.open(id)`. Draw into y ∈ [100, H−20] of the 1024×737 canvas; register buttons with
`panel.button(...)` or item slots with `ui.slotButton(panel, id, x, y, size, stack, onClick)`.

**Creatures**: push objects with `update(dt)`/`dispose()` into `game.entities` (`game.addEntity`).
Use `world.getBlock/isSolid/raycast` for movement, `world.getLight` + `sky.daylight`/`sky.isNight`
for spawning, `player.position/eye/push` for chasing and knockback, `game.damagePlayer` for hits,
`events.on('chunkLoaded')` to populate, `sky.hemi`/`sky.dir` already light standard materials.
Use the `blockBreak` event to let melee hits on creatures take precedence if needed.

**Health/hunger**: listen to `playerDamaged` (fall damage already emitted in survival), store values
on `game.player`, persist through the `save`/`load` events, add a HUD via a `ui` tab or your own panel.

**Day/night threats**: `sky.time`, `sky.isNight`, `sky.elevation`; change `sky.dayLength` to tune.

## Controls

VR: off stick move (or teleport in Settings), main stick X snap/smooth turn, main stick Y flick or B =
next hotbar slot, main A jump (double-tap: fly in Creative, hold to rise/swim up), main trigger break
(also with the hand physically inside a block), main grip place/use, off X pack, off Y tap settings
(hold = hub), off stick click toggles sprint. Point at the wrist hotbar to pick a slot.

Desktop: WASD move, mouse look, Space jump (double-tap to fly in Creative, Shift descends), Shift/Ctrl
sprint, LMB break, RMB place, 1-9 / wheel hotbar, E pack, O settings, F toggle fly (Creative).

## Performance notes

Generation + meshing ≈ 5 + 3.5 ms per chunk on a desktop CPU, all in the worker; the main thread caps
loads in flight (3) and uploads ≤2 meshes per frame. One draw call per chunk for opaque + cutout + plants,
one for water. Chunk bounds are tight in y for frustum culling. Day/night changes only uniforms.

## Crafting plugin (phase 2)

Files: `plugins/crafting.js` (install, systems), `plugins/crafting/content.js` (blocks, items, tags,
recipes, smelting, fuel), `art.js` (tiles + sprites), `shapes.js` (shape layer + iso icons),
`panel.js` (the Craft tab). **Owns block ids 100–199 and item ids 600–699** — other plugins pick
ids outside these ranges.

**Content.** Stations: Joiner's Bench (100), Clay Kiln (101, lit variant 102 glows, light 13),
Cedar Chest (103). Farming: Tilled Loam (104), Sun Barley (105–108) and Earthroot (109–112) crop
stages, Barley Seeds / Earthroot (plantable), Barley Loaf, Hearth-Roasted Root. Building: Rushlight
(cross, light 14), Sunstone Lamp, Paper Screen, Slate Tiles, Dune Bricks, Oat/Ink/Peach felt (plus
dye recipes for the 5 phase-1 felts), slabs ×4, steps ×2 (4 facings each), Pine Rail + Rubble Wall
(connecting), Twig Ladder (4 facings), Plank Door + Paper Door (16 ids each: facing + open·4 +
upper·8). Materials: Meadow Fiber, Copper/Moonsilver Ingot, Fired Brick, Reed Paper. Tools: Blade
and Tiller for all 5 tiers (620–629); every tool has a top-level `damage`. Meadow tufts now drop
fiber / seeds / earthroot. A new survival world starts empty-handed (log → planks → bench → tools);
existing saves keep their inventory.

**Recipes** (`content.js`): `{ out: [key, n], in: [[key | '#tag', n]…], st: 'hand' | 'bench', cat }`.
Tags: `#planks`, `#log`. Hand recipes work anywhere from the Craft tab; bench recipes need the tab
opened by using a Joiner's Bench. Runtime: `game.crafting.addRecipe({...})`.

**Kiln.** `SMELT` (`{ in, out, count, time }`) and `FUEL` (`key → seconds`) tables. Any item def may
also carry `smelt: { to: 'key', count?, time? }` (e.g. raw creature meat → roast) and `fuel: seconds`;
they are picked up at install (call `game.crafting.refreshSmelting()` after registering later).
Kilns tick on a 0.25 s timer (only active ones), swap to the lit block while burning, and persist.

**Food.** Items carry `food: { hunger, saturation }` (the survival plugin eats them):
earthroot 2/1, barley_loaf 5/6, roasted_earthroot 6/7.

**Shapes.** Blocks with `shape` (array of `[x0,y0,z0,x1,y1,z1]` boxes in 1/16, or `'fence'`) use
`render: 'none'` so the worker skips them; `shapes.js` builds one small mesh per chunk on the main
thread in the chunk vertex format with the shared opaque material (faces take the light of the cell
they face). Collision is still per full cell (`solid`): slabs/steps collide as full blocks and
auto-step handles them; open doors and ladders are not solid.

**Saves.** `data.crafting = { v: 1, kilns: { 'x,y,z': { i, f, o, b, bm, p } }, chests: { 'x,y,z': [27 stacks] } }`.
Breaking a kiln/chest (any `blockChanged` away from it) spills its contents.

**Events.** Emits `itemCrafted { id, count }`. Uses `blockUse` (bench/kiln/chest/door/ladder),
`useItem` (doors, ladders, tiller, seeds — sets `handled`), `blockPlaced` (orients steps),
`blockChanged`, `chunkLoaded/Unloaded`, `tick`, `save`, `load`.

**Debug / tests.** `game.crafting.craftKey(key, n)`, `.kilns`, `.chests`, `.sys` (panel state),
`.debug.grow(n)` (force n crop growth steps), `.debug.fastKilns(seconds)`.

**Controls.** Craft tab: desktop C, VR main-stick click, or the tab in the pack panel. Use (grip /
RMB) a bench, kiln or chest to open it; tap pack items to load a kiln / move into a chest, tap a
station slot to take back. Grip a door to open/close it. Ladders: walk into one and push forward (or
hold jump) to climb, back to descend; in VR grab the ladder with either grip and pull yourself up.
Tiller: grip on turf/loam. Seeds/earthroot: grip on tilled loam.
