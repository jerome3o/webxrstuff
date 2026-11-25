import * as THREE from 'three';
import { BLOCKS, B, HEIGHT } from '../blocks.js';
import { ITEMS, I } from '../items.js';
import './crafting/art.js';
import { RECIPES, CROPS, DOORS, LADDER0, STAIRS, tagIds, buildLookups, smeltFor, fuelFor } from './crafting/content.js';
import { ShapeLayer, shapeIcon, isShape } from './crafting/shapes.js';
import { CraftPanel } from './crafting/panel.js';

// Blockfell phase-2 crafting plugin: recipes (hand / Joiner's Bench), Clay Kilns (fuel + input →
// output over time, persisted), Cedar Chests (persisted), doors, ladders (VR grab-climb), steps,
// slabs, rails, farming (tiller, seeds, crops on random ticks) and a modest survival start.
// See ARCHITECTURE.md → "Crafting plugin".

const KILN_TICK = 0.25, CROP_TICK = 2.5, CROP_CHANCE = 0.045;
const nkey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const pkey = (x, y, z) => x + ',' + y + ',' + z;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const lightOut = { sky: 0, block: 0 };

export default async function install(game, ctx) {
  buildLookups();
  const { events, world, inventory: inv, input } = game;
  const offs = [];
  const on = (n, f) => offs.push(events.on(n, f));

  // ── state ───────────────────────────────────────────────
  const kilns = new Map();       // 'x,y,z' → { input, fuel, output, burn, burnMax, progress }
  const chests = new Map();      // 'x,y,z' → Array(27)
  const crops = new Map();       // nkey → Set(local idx) of crop cells in loaded chunks
  const cropStage = new Int16Array(256).fill(-1), cropNext = new Uint8Array(256);
  for (const k in CROPS) CROPS[k].ids.forEach((id, s, a) => { cropStage[id] = s; cropNext[id] = s < 3 ? a[s + 1] : 0; });
  const KILN = B.clay_kiln, KILN_LIT = B.clay_kiln_lit, CHEST = B.cedar_chest, BENCH = B.joiner_bench, TILLED = B.tilled_loam;
  const isKiln = (id) => id === KILN || id === KILN_LIT;

  const sys = {
    game, mode: 'craft', at: null,
    recipes: RECIPES.map((r, order) => ({
      order, st: r.st, cat: r.cat, outId: I[r.out[0]], outN: r.out[1],
      ins: r.in.map(([k, n]) => ({ ids: tagIds(k), n, label: k[0] === '#' ? `any ${k.slice(1)}` : ITEMS[I[k]]?.name ?? k })),
    })).filter(r => r.outId && r.ins.every(i => i.ids.length)),
  };
  const shapes = new ShapeLayer(game);
  const panel = new CraftPanel(sys);

  // ── recipes ─────────────────────────────────────────────
  sys.haveOf = (inp) => { let n = 0; for (const id of inp.ids) n += inv.count(id); return n; };
  sys.stationOk = (r) => r.st === 'hand' || (sys.mode === 'bench');
  sys.maxCraft = (r) => { let m = 64; for (const inp of r.ins) m = Math.min(m, Math.floor(sys.haveOf(inp) / inp.n)); return Math.max(0, m); };
  sys.score = (r) => (sys.stationOk(r) && sys.maxCraft(r) > 0 ? 2 : 0) + (r.st === 'hand' ? 1 : 0);
  sys.craft = (r, times) => {
    times = Math.min(times | 0, sys.maxCraft(r));
    if (!sys.stationOk(r) || times <= 0) return 0;
    for (const inp of r.ins) {
      let need = inp.n * times;
      const ids = inp.ids.slice().sort((a, b) => inv.count(b) - inv.count(a));   // use the most plentiful first
      for (const id of ids) { if (need <= 0) break; need -= inv.removeItem(id, Math.min(need, inv.count(id))); }
    }
    give(r.outId, r.outN * times);
    const h = input.main; h.haptic(0.55, 45); input.off.haptic?.(0.2, 30);
    chime(r.outId);
    events.emit('itemCrafted', { id: r.outId, count: r.outN * times });
    return times;
  };
  function give(id, n) {
    const def = ITEMS[id], max = def?.stack ?? 64;
    while (n > 0) {
      const k = Math.min(n, max); n -= k;
      const left = inv.add(id, k);
      if (left > 0) game.spawnDrop(id, left, game.player.eye);
    }
  }
  function chime(id) {
    const sfx = game.audio?.sfx; if (!sfx || !game.audio.enabled) return;
    const base = ITEMS[id]?.kind === 'tool' ? 660 : 520;
    sfx.tone({ freq: base, freqEnd: base * 1.5, dur: 0.09, type: 'triangle', gain: 0.1 });
    sfx.tone({ freq: base * 1.5, dur: 0.14, type: 'sine', gain: 0.08, delay: 0.08 });
  }

  // ── panel tab ───────────────────────────────────────────
  const tab = game.ui.addTab({
    id: 'craft', label: () => panel.label(),
    draw: (c, W, H, p, ui) => panel.draw(c, W, H, p, ui),
    onClose: () => { sys.mode = 'craft'; sys.at = null; },
  });
  const openAt = (mode, x, y, z) => { sys.mode = mode; sys.at = { x, y, z }; game.ui.open('craft'); sys.mode = mode; sys.at = { x, y, z }; game.ui.modal.markDirty(); };
  // keep stations valid: close the station view if it vanished or the player walked away
  function checkStation() {
    if (!sys.at || !game.ui.modalOpen || game.ui.activeTab !== 'craft') return;
    const { x, y, z } = sys.at, id = world.getBlock(x, y, z);
    const want = sys.mode === 'kiln' ? isKiln(id) : sys.mode === 'chest' ? id === CHEST : id === BENCH;
    _v.set(x + 0.5, y + 0.5, z + 0.5);
    if (!want || _v.distanceTo(game.player.eye) > 7 * game.player.scale) { sys.mode = 'craft'; sys.at = null; game.ui.modal.markDirty(); }
  }

  // ── kilns ───────────────────────────────────────────────
  const newKiln = () => ({ input: null, fuel: null, output: null, burn: 0, burnMax: 0, progress: 0 });
  function kilnAt(x, y, z, create = true) { const k = pkey(x, y, z); let s = kilns.get(k); if (!s && create) { s = newKiln(); kilns.set(k, s); } return s; }
  sys.openKiln = () => sys.at ? kilnAt(sys.at.x, sys.at.y, sys.at.z) : null;
  sys.kilnRecipe = (k) => {
    if (!k.input) return null;
    const r = smeltFor(k.input.id); if (!r) return null;
    const max = ITEMS[r.out]?.stack ?? 64;
    if (k.output && (k.output.id !== r.out || k.output.count + r.count > max)) return null;
    return r;
  };
  function stepKiln(k, dt) {
    let changed = false;
    const r = sys.kilnRecipe(k);
    if (k.burn <= 0 && r && k.fuel) {
      const f = fuelFor(k.fuel.id);
      if (f > 0) { k.burn = k.burnMax = f; if (--k.fuel.count <= 0) k.fuel = null; changed = true; }
    }
    if (k.burn > 0) {
      k.burn = Math.max(0, k.burn - dt);
      if (r) {
        k.progress += dt;
        if (k.progress >= r.time) {
          k.progress = 0; changed = true;
          if (k.output) k.output.count += r.count; else k.output = { id: r.out, count: r.count };
          if (--k.input.count <= 0) k.input = null;
        }
      } else k.progress = 0;
    } else if (k.progress > 0) k.progress = Math.max(0, k.progress - dt * 2);
    return changed;
  }
  let kilnT = 0;
  function tickKilns(dt) {
    if ((kilnT += dt) < KILN_TICK) return;
    const step = kilnT; kilnT = 0;
    let view = false;
    for (const [key, k] of kilns) {
      const active = k.burn > 0 || (k.fuel && k.input) || k.progress > 0;
      if (!active) continue;
      stepKiln(k, step);
      syncKilnBlock(key, k);
      if (sys.mode === 'kiln' && sys.at && pkey(sys.at.x, sys.at.y, sys.at.z) === key) view = true;
    }
    if (view && game.ui.modalOpen) game.ui.modal.markDirty();
  }
  function syncKilnBlock(key, k) {
    const [x, y, z] = key.split(',').map(Number);
    const id = world.getBlock(x, y, z);
    const want = k.burn > 0 ? KILN_LIT : KILN;
    if (isKiln(id) && id !== want) world.setBlock(x, y, z, want, { cause: 'kiln' });
  }
  // put the pack slot i into the open kiln (input if it fires, else fuel)
  sys.kilnPut = (i) => {
    const k = sys.openKiln(), s = inv.slots[i]; if (!k || !s) return;
    const canFire = !!smeltFor(s.id), canFuel = fuelFor(s.id) > 0;
    let slot = null;
    if (k.input && k.input.id === s.id && canFire) slot = 'input';
    else if (k.fuel && k.fuel.id === s.id && canFuel) slot = 'fuel';
    else if (canFire && !k.input) slot = 'input';
    else if (canFuel && !k.fuel) slot = 'fuel';
    if (!slot) { game.toast(canFire || canFuel ? 'That kiln slot is full' : "That won't fire or burn"); return; }
    const max = ITEMS[s.id]?.stack ?? 64;
    if (!k[slot]) { k[slot] = { id: s.id, count: 0 }; }
    const n = Math.min(s.count, max - k[slot].count);
    k[slot].count += n; inv.takeFromSlot(i, n);
    input.main.haptic(0.3, 20);
  };
  sys.kilnTake = (slot) => {
    const k = sys.openKiln(); if (!k || !k[slot]) return;
    const s = k[slot], left = inv.add(s.id, s.count);
    if (left > 0) s.count = left; else k[slot] = null;
    if (slot === 'input') k.progress = 0;
    input.main.haptic(0.3, 20); game.ui.modal.markDirty();
  };

  // ── chests ──────────────────────────────────────────────
  function chestAt(x, y, z, create = true) { const k = pkey(x, y, z); let s = chests.get(k); if (!s && create) { s = new Array(27).fill(null); chests.set(k, s); } return s; }
  sys.openChest = () => sys.at ? chestAt(sys.at.x, sys.at.y, sys.at.z) : null;
  const extraOf = (s) => { const e = {}; let any = false; for (const k in s) if (k !== 'id' && k !== 'count') { e[k] = s[k]; any = true; } return any ? e : null; };
  sys.chestTake = (i) => {
    const slots = sys.openChest(); const s = slots?.[i]; if (!s) return;
    const left = inv.add(s.id, s.count, extraOf(s));
    if (left > 0) s.count = left; else slots[i] = null;
    input.main.haptic(0.3, 20); game.ui.modal.markDirty();
  };
  sys.chestPut = (i) => {
    const slots = sys.openChest(), s = inv.slots[i]; if (!slots || !s) return;
    const max = ITEMS[s.id]?.stack ?? 64;
    let n = s.count;
    if (s.dur == null) for (let j = 0; j < 27 && n > 0; j++) { const t = slots[j]; if (t && t.id === s.id && t.dur == null && t.count < max) { const k = Math.min(n, max - t.count); t.count += k; n -= k; } }
    for (let j = 0; j < 27 && n > 0; j++) if (!slots[j]) { slots[j] = { ...s, count: n }; n = 0; }
    if (n === s.count) { game.toast('The chest is full'); return; }
    inv.takeFromSlot(i, s.count - n);
    input.main.haptic(0.3, 20);
  };
  function spill(list, x, y, z) {
    _v.set(x + 0.5, y + 0.5, z + 0.5);
    for (const s of list) if (s && s.count > 0) {
      // worn tools keep their wear by going straight to the pack (drops carry no durability)
      const left = s.dur != null ? inv.add(s.id, s.count, extraOf(s)) : s.count;
      if (left > 0) game.spawnDrop(s.id, left, _v);
    }
  }

  // ── doors, ladders, steps, crops, placement ─────────────
  function look() { const f = input.head.fwd; return Math.abs(f.x) > Math.abs(f.z) ? (f.x > 0 ? 0 : 2) : (f.z > 0 ? 3 : 1); }
  // look(): facing index of the cell side nearest the player (0 −x, 1 +z, 2 +x, 3 −z)
  function toggleDoor(x, y, z, id) {
    const d = BLOCKS[id].door, i = id - d.base, lowY = d.upper ? y - 1 : y;
    const ni = i ^ 4;
    world.setBlock(x, lowY, z, d.base + (ni & 7), { cause: 'door' });
    const up = world.getBlock(x, lowY + 1, z);
    if (BLOCKS[up]?.door?.base === d.base) world.setBlock(x, lowY + 1, z, d.base + (ni & 7) + 8, { cause: 'door' });
    const open = (ni >> 2) & 1;
    game.audio.material(BLOCKS[id].sound, 'place', _v.set(x + 0.5, y + 0.5, z + 0.5));
    if (game.audio.enabled) game.audio.sfx.tone({ freq: open ? 240 : 180, freqEnd: open ? 320 : 120, dur: 0.12, type: 'triangle', gain: 0.07, pos: _v });
  }
  function freeCell(x, y, z) { const c = world.getBlock(x, y, z); return c === 0 || (c > 0 && BLOCKS[c]?.replaceable && BLOCKS[c].render !== 'liquid'); }
  function consume() { if (game.mode !== 'creative') inv.takeFromSlot(inv.selected, 1); input.main.haptic(0.4, 25); game.interact.swing = 1; }
  function placeCell(t) {
    const tdef = BLOCKS[t.id];
    if (tdef?.replaceable) return [t.x, t.y, t.z];
    return [t.x + t.nx, t.y + t.ny, t.z + t.nz];
  }
  function onUseItem(e) {
    if (e.handled || !e.stack || !e.target) return;
    const def = ITEMS[e.stack.id], t = e.target;
    if (!def) return;
    // tiller: turf / loam → tilled loam
    if (def.tool?.type === 'tiller') {
      if ((t.id === B.turf || t.id === B.loam) && !t.physical && freeCell(t.x, t.y + 1, t.z)) {
        const above = world.getBlock(t.x, t.y + 1, t.z);
        if (above > 0) world.setBlock(t.x, t.y + 1, t.z, 0, { cause: 'till' });
        world.setBlock(t.x, t.y, t.z, TILLED, { cause: 'player' });
        game.audio.material('dirt', 'place', _v.set(t.x + 0.5, t.y + 1, t.z + 0.5));
        if (game.mode !== 'creative') inv.wearSelected(1);
        input.main.haptic(0.4, 30); game.interact.swing = 1; e.handled = true;
      }
      return;
    }
    // seeds / roots on tilled loam
    if (def.plant) {
      if (t.id === TILLED && world.getBlock(t.x, t.y + 1, t.z) === 0) {
        world.setBlock(t.x, t.y + 1, t.z, CROPS[def.plant].ids[0], { cause: 'player' });
        game.audio.material('plant', 'place', _v.set(t.x + 0.5, t.y + 1, t.z + 0.5));
        consume(); e.handled = true;
      }
      return;
    }
    if (t.physical) return;
    // doors: two cells tall, closed panel on the side nearest the player
    if (DOORS[def.key] != null) {
      const [x, y, z] = placeCell(t), base = DOORS[def.key];
      if (y < 1 || y + 1 >= HEIGHT || !freeCell(x, y, z) || !freeCell(x, y + 1, z) || !BLOCKS[world.getBlock(x, y - 1, z)]?.solid) { game.toast('A door needs two free cells on solid ground'); return; }
      const f = look();
      world.setBlock(x, y, z, base + f, { cause: 'player' });
      world.setBlock(x, y + 1, z, base + f + 8, { cause: 'player' });
      game.audio.material(BLOCKS[base].sound, 'place', _v.set(x + 0.5, y + 0.5, z + 0.5));
      consume(); e.handled = true; return;
    }
    // ladders: against the clicked wall (or the side the player faces when clicking a floor)
    if (def.key === 'twig_ladder') {
      const [x, y, z] = placeCell(t);
      if (!freeCell(x, y, z)) return;
      let f;
      if (t.nx || t.nz) f = t.nx > 0 ? 0 : t.nx < 0 ? 2 : t.nz > 0 ? 3 : 1;   // wall is opposite the face normal
      else f = (look() + 2) & 3;
      if (BLOCKS[world.getBlock(x, y, z)]?.render === 'cross') world.setBlock(x, y, z, 0, { cause: 'player' });
      world.setBlock(x, y, z, LADDER0 + f, { cause: 'player' });
      game.audio.material('wood', 'place', _v.set(x + 0.5, y + 0.5, z + 0.5));
      consume(); e.handled = true;
    }
  }
  function onBlockUse(e) {
    if (e.handled) return;
    const def = BLOCKS[e.id]; if (!def) return;
    if (e.id === BENCH) { openAt('bench', e.x, e.y, e.z); e.handled = true; }
    else if (isKiln(e.id)) { kilnAt(e.x, e.y, e.z); openAt('kiln', e.x, e.y, e.z); e.handled = true; }
    else if (e.id === CHEST) { chestAt(e.x, e.y, e.z); openAt('chest', e.x, e.y, e.z); e.handled = true; }
    else if (def.door) { toggleDoor(e.x, e.y, e.z, e.id); e.handled = true; }
    else if (def.ladder && !input.desktop) e.handled = tryGrab();
  }
  function onPlaced(e) {
    const def = BLOCKS[e.id];
    if (def?.stairBase === e.id) world.setBlock(e.x, e.y, e.z, e.id + ((look() + 2) & 3), { cause: 'player' });
  }
  function onChanged(e) {
    shapes.changed(e.x, e.y, e.z, e.id, e.prev);
    // crop bookkeeping
    if (cropStage[e.id] >= 0 || cropStage[e.prev] >= 0) {
      const k = nkey(e.x >> 4, e.z >> 4), idx = (e.x & 15) + ((e.z & 15) << 4) + (e.y << 8);
      let s = crops.get(k);
      if (cropStage[e.id] >= 0) { if (!s) crops.set(k, s = new Set()); s.add(idx); } else if (s) s.delete(idx);
    }
    // kilns / chests that vanished spill their contents
    const key = pkey(e.x, e.y, e.z);
    if (isKiln(e.prev) && !isKiln(e.id)) { const k = kilns.get(key); if (k) { spill([k.input, k.fuel, k.output], e.x, e.y, e.z); kilns.delete(key); } }
    if (e.prev === CHEST && e.id !== CHEST) { const c = chests.get(key); if (c) { spill(c, e.x, e.y, e.z); chests.delete(key); } }
    // a broken door half takes its partner with it
    const pd = BLOCKS[e.prev]?.door;
    if (pd && e.cause !== 'door' && BLOCKS[e.id]?.door?.base !== pd.base) {
      const oy = pd.upper ? e.y - 1 : e.y + 1;
      if (BLOCKS[world.getBlock(e.x, oy, e.z)]?.door?.base === pd.base) {
        world.setBlock(e.x, oy, e.z, 0, { cause: 'door' });
        // the item drops from the lower half; if the upper half was broken, drop it here
        if (pd.upper && e.cause === 'player' && game.mode !== 'creative') game.spawnDrop(I[BLOCKS[pd.base].drops], 1, _v.set(e.x + 0.5, oy + 0.4, e.z + 0.5));
      }
    }
    // tilled loam under a crop that lost its soil
    if (e.prev === TILLED && e.id !== TILLED) { const up = world.getBlock(e.x, e.y + 1, e.z); if (cropStage[up] >= 0) game.breakBlock(e.x, e.y + 1, e.z, { drops: game.mode !== 'creative' }); }
  }
  function scanChunk(c) {
    shapes.scan(c);
    const b = c.blocks; if (!b) return;
    let s = null;
    for (let i = 0; i < b.length; i++) if (cropStage[b[i]] >= 0) { if (!s) s = new Set(); s.add(i); }
    const k = nkey(c.cx, c.cz);
    if (s) crops.set(k, s); else crops.delete(k);
    // kilns in this chunk: make the block match the saved burn state (chunk may have been unloaded)
    for (const [key, kl] of kilns) { const [x, , z] = key.split(',').map(Number); if ((x >> 4) === c.cx && (z >> 4) === c.cz) syncKilnBlock(key, kl); }
  }

  // ── crops (random ticks over tracked crop cells only) ──
  let cropT = 0;
  function growOne(x, y, z, id) {
    world.setBlock(x, y, z, cropNext[id], { cause: 'grow' });
  }
  function tickCrops(dt, force = 0) {
    if (!force && (cropT += dt) < CROP_TICK) return;
    cropT = 0;
    const day = game.sky.daylight;
    for (const [k, set] of crops) {
      const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
      const c = world.chunkAt(cx, cz); if (!c?.blocks) continue;
      for (const idx of set) {
        const id = c.blocks[idx];
        if (cropStage[id] < 0 || cropStage[id] >= 3) continue;
        const x = cx * 16 + (idx & 15), z = cz * 16 + ((idx >> 4) & 15), y = idx >> 8;
        if (!force) {
          world.getLight(x, y, z, lightOut);
          if (lightOut.sky * day < 8 && lightOut.block < 9) continue;
          const wet = world.getBlock(x, y - 1, z) === TILLED ? 1 : 0.35;
          if (Math.random() > CROP_CHANCE * wet) continue;
        }
        growOne(x, y, z, id);
      }
    }
  }

  // ── ladders: walk-up anywhere, grab-climb in VR ─────────
  const grab = { active: false, hand: null, last: new THREE.Vector3() };
  function ladderAt(x, y, z) { const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return id > 0 && !!BLOCKS[id]?.ladder; }
  function handInLadder(h) { const p = h.gripPos; return ladderAt(p.x, p.y, p.z) || ladderAt(p.x, p.y - 0.25, p.z) || ladderAt(p.x, p.y + 0.25, p.z); }
  function tryGrab() {
    for (const h of [input.main, input.off]) if (h.present && handInLadder(h)) { startGrab(h); return true; }
    return false;
  }
  function startGrab(h) { grab.active = true; grab.hand = h; grab.last.copy(h.gripPos).applyMatrix4(game.rigInv); h.haptic(0.35, 30); }
  function tickLadder(dt) {
    const p = game.player, s = p.scale, rig = ctx.rig;
    if (!input.desktop) {
      // the off hand grabs a ladder with its grip (main grip goes through blockUse); a fresh grab
      // with either hand takes over from the other (hand over hand)
      const o = input.off;
      if (o.present && o.squeezeDown && handInLadder(o)) startGrab(o);
      else if (grab.active && grab.hand === input.off && input.main.squeezeDown && handInLadder(input.main)) startGrab(input.main);
    }
    if (grab.active) {
      const h = grab.hand;
      if (!h.present || h.squeeze < 0.4 || !handInLadder(h)) {
        // hand-over-hand: if the other hand is already holding the ladder, continue with it
        const o2 = h === input.main ? input.off : input.main;
        grab.active = false;
        if (o2.present && o2.squeeze >= 0.4 && handInLadder(o2)) startGrab(o2);
      }
      else {
        _w.copy(h.gripPos).applyMatrix4(game.rigInv);                // rig-local hand
        _v.copy(_w).sub(grab.last).applyQuaternion(rig.quaternion).multiplyScalar(rig.scale.x);   // world delta of the hand
        grab.last.copy(_w);
        // move the body opposite to the hand: pulling down lifts you
        const dy = THREE.MathUtils.clamp(-_v.y, -0.25, 0.25);
        const px = p.position.x, pz = p.position.z, w = 0.3 * s;
        if (dy && p._boxFree(px - w, p.feetY + dy, pz - w, px + w, p.feetY + p.height + dy, pz + w)) { p.feetY += dy; rig.position.y += dy; }
        p.velocity.set(0, 26 * s * dt, 0);   // cancel next frame's gravity
        p._fallTop = null;
        return;
      }
    }
    // walk-up: inside a ladder cell, forward stick / jump climbs, otherwise slide slowly
    // (also counts a ladder right in front of you, so letting go in VR slides instead of dropping)
    const pos = p.position, f = input.head.fwd, fl = Math.hypot(f.x, f.z) || 1;
    const fx = pos.x + f.x / fl * 0.45 * s, fz = pos.z + f.z / fl * 0.45 * s;
    if (!(ladderAt(pos.x, p.feetY + 0.1, pos.z) || ladderAt(pos.x, p.feetY + 0.9 * s, pos.z) ||
      ladderAt(fx, p.feetY + 0.1, fz) || ladderAt(fx, p.feetY + 0.9 * s, fz))) return;
    const ay = input.off.axes[1];
    const up = ay < -0.3 || (input.desktop ? input.key('Space') : input.main.aHeld);
    const down = ay > 0.3 || (input.desktop && input.key('ShiftLeft'));
    p.velocity.y = up ? 3.2 * s : down ? -2.5 * s : 26 * s * dt * 0.9;   // idle: gravity almost cancelled (slow slide)
    p._fallTop = null;
  }

  // ── debug / API for tests and other plugins ─────────────
  game.crafting = {
    recipes: sys.recipes, kilns, chests, sys,
    addRecipe(r) { RECIPES.push(r); const o = { order: sys.recipes.length, st: r.st ?? 'bench', cat: r.cat ?? 'misc', outId: I[r.out[0]], outN: r.out[1], ins: r.in.map(([k, n]) => ({ ids: tagIds(k), n, label: k[0] === '#' ? `any ${k.slice(1)}` : ITEMS[I[k]]?.name ?? k })) }; if (o.outId) sys.recipes.push(o); return o; },
    refreshSmelting: () => buildLookups(),
    craftKey(key, times = 1) { const r = sys.recipes.find(q => ITEMS[q.outId]?.key === key); if (!r) return 0; const m = sys.mode; if (r.st === 'bench') sys.mode = 'bench'; const n = sys.craft(r, times); sys.mode = m; return n; },
    open: (mode, x, y, z) => mode === 'craft' ? game.ui.open('craft') : openAt(mode, x, y, z),
    debug: {
      grow(n = 1) { for (let i = 0; i < n; i++) tickCrops(0, 1); },
      fastKilns(dt = 5) { for (const [key, k] of kilns) { stepKiln(k, dt); syncKilnBlock(key, k); } },
      shapes,
    },
  };

  // ── icons for shape items, wiring ───────────────────────
  for (const d of ITEMS) if (d && d.kind === 'block' && isShape[d.id]) game.models.icons.set(d.id, shapeIcon(game, d.id));
  for (const c of world.chunks.values()) if (c.blocks) scanChunk(c);

  on('chunkLoaded', (e) => { if (e.chunk) scanChunk(e.chunk); });
  on('chunkUnloaded', (e) => { shapes.unload(e.cx, e.cz); crops.delete(nkey(e.cx, e.cz)); });
  on('blockChanged', onChanged);
  on('blockPlaced', onPlaced);
  on('blockUse', onBlockUse);
  on('useItem', onUseItem);
  on('tick', (e) => {
    const dt = e.dt;
    shapes.update(dt);
    tickKilns(dt);
    tickCrops(dt);
    tickLadder(dt);
    checkStation();
    if (input.desktop ? input.keyDown('KeyC') : input.main.stick) game.ui.toggle('craft');
  });
  on('save', (e) => {
    const k = {}, c = {};
    for (const [key, v] of kilns) if (v.input || v.fuel || v.output || v.burn > 0) k[key] = { i: v.input, f: v.fuel, o: v.output, b: +v.burn.toFixed(2), bm: v.burnMax, p: +v.progress.toFixed(2) };
    for (const [key, v] of chests) if (v.some(Boolean)) c[key] = v;
    e.data.crafting = { v: 1, kilns: k, chests: c };
  });
  on('load', (e) => {
    const d = e.data?.crafting;
    const valid = (s) => s && ITEMS[s.id] && s.count > 0 ? s : null;
    if (d?.kilns) for (const key in d.kilns) { const s = d.kilns[key]; kilns.set(key, { input: valid(s.i), fuel: valid(s.f), output: valid(s.o), burn: s.b || 0, burnMax: s.bm || 0, progress: s.p || 0 }); }
    if (d?.chests) for (const key in d.chests) { const a = new Array(27).fill(null); (d.chests[key] || []).forEach((s, i) => { if (i < 27) a[i] = valid(s); }); chests.set(key, a); }
    for (const c of world.chunks.values()) if (c.blocks) for (const [key, kl] of kilns) { const [x, , z] = key.split(',').map(Number); if ((x >> 4) === c.cx && (z >> 4) === c.cz) syncKilnBlock(key, kl); }
    // a fresh survival world starts empty-handed: punch a log → planks → bench → tools
    if (!e.data?.inv && game.mode === 'survival') {
      for (const k of ['driftwood_pick', 'driftwood_axe', 'driftwood_spade', 'lantern']) if (I[k]) inv.removeItem(I[k], 64);
      game.toast('Punch a tree, then open Craft (C / main stick click)', 5);
    }
  });

  return {
    dispose() {
      for (const f of offs) f();
      shapes.dispose();
      const i = game.ui.tabs.indexOf(tab); if (i >= 0) game.ui.tabs.splice(i, 1);
      delete game.crafting;
    },
  };
}
