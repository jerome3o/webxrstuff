import * as THREE from 'three';
import { buildBlockTable, BLOCKS, HEIGHT } from './blocks.js';
import { ITEMS, I } from './items.js';
import { buildAtlas, buildSprites, buildCrackTexture } from './textures.js';
import { createChunkMaterials, clearBlockGeometryCache } from './materials.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { Player } from './player.js';
import { Interaction } from './interact.js';
import { Inventory } from './inventory.js';
import { GameUI } from './ui.js';
import { GameAudio } from './audio.js';
import { ItemDrop } from './drops.js';
import { ItemModels } from './models.js';
import { Events } from './events.js';

// Blockfell: voxel mine-and-build sandbox. Entry point; wires the modules into one `game` object
// that is also the extension surface for later modules (see ARCHITECTURE.md).

const DEFAULT_SETTINGS = { renderDistance: 6, locomotion: 'smooth', turn: 'snap', snapDeg: 30, vignette: true, autoStep: true, sprint: false, giant: false };
const randomSeed = () => (Math.random() * 2147483647) | 0;
const SAVE_EVERY = 20;

export async function create(ctx) {
  const { scene, input, rig, camera } = ctx;
  const meta = ctx.load('voxel:meta', {}) || {};
  const settings = { ...DEFAULT_SETTINGS, renderDistance: ctx.isXR() ? 5 : 6, ...(meta.settings || {}) };
  const seed = Number.isFinite(meta.seed) ? meta.seed : randomSeed();
  const saved = ctx.load(`voxel:world:${seed}`, null);

  const game = {
    ctx, scene, input, settings, seed,
    events: new Events(),
    mode: saved?.mode === 'creative' ? 'creative' : 'survival',
    entities: [],               // { update(dt) → false to remove, dispose(), dead } — drops, creatures…
    time: 0,                    // seconds since launch
    rigInv: new THREE.Matrix4(),// inverse rig matrix at the start of the frame (controller poses → rig space)
    BLOCKS, ITEMS,
  };
  window.__voxel = game;

  game.atlas = buildAtlas();
  game.sprites = buildSprites();
  game.crackTexture = buildCrackTexture();
  game.mats = createChunkMaterials(game.atlas.texture);
  game.blockTable = buildBlockTable(game.atlas.layer);
  game.world = new World(game, { seed, table: game.blockTable, renderDistance: settings.renderDistance, edits: saved?.edits });
  game.models = new ItemModels(game);
  game.inventory = new Inventory(game.events);
  game.sky = new Sky(scene, game.mats, { time: saved?.time ?? 0.3 });
  game.sky.day = saved?.day ?? 0;
  game.audio = new GameAudio(ctx.audio);
  game.player = new Player(game);
  game.ui = new GameUI(game);
  game.interact = new Interaction(game);
  camera.far = 900; camera.updateProjectionMatrix();

  // ── API for other modules ────────────────────────────────
  game.toast = (msg, secs) => game.ui.toast(msg, secs);
  game.spawnDrop = (id, count, pos, vel) => { const d = new ItemDrop(game, id, count, pos, vel); game.entities.push(d); return d; };
  game.addEntity = (e) => { game.entities.push(e); return e; };
  game.breakBlock = (x, y, z, opts) => game.interact.breakBlock(x, y, z, opts);
  game.damagePlayer = (amount, cause = 'unknown', source = null) => game.events.emit('playerDamaged', { amount, cause, source });
  game.setMode = (m) => {
    if (m === game.mode) return;
    game.mode = m;
    if (m === 'creative' && !game.inventory.slots.some(Boolean)) creativeKit();
    game.events.emit('modeChanged', { mode: m });
    game.toast(m === 'creative' ? 'Creative: unlimited blocks, double-tap jump to fly' : 'Survival: gather what you break');
    game.ui.hotbar.markDirty(); game.ui.modal.markDirty();
    save();
  };
  game.setRenderDistance = (r) => {
    r = Math.max(2, Math.min(12, r));
    settings.renderDistance = r; game.world.setRenderDistance(r); saveMeta();
  };
  game.setSetting = (k, v) => { settings[k] = v; saveMeta(); game.events.emit('settingChanged', { key: k, value: v }); };
  game.newWorld = () => { game._nextSeed = randomSeed(); ctx.launch('voxel'); };
  game.save = () => save();

  function starterKit() {
    for (const k of ['driftwood_pick', 'driftwood_axe', 'driftwood_spade']) game.inventory.add(I[k], 1);
    game.inventory.add(I.lantern, 8);
  }
  function creativeKit() {
    const ids = ['turf', 'slate_brick', 'amber_planks', 'clear_pane', 'lantern', 'kiln_brick', 'felt_rose', 'thatch', 'blossom'];
    ids.forEach((k, i) => game.inventory.setSlot(i, { id: I[k], count: 64 }));
  }

  function saveMeta() { ctx.save('voxel:meta', { seed: game._nextSeed ?? seed, settings }); }
  function headYaw() { const f = input.head.fwd; return Math.atan2(-f.x, -f.z); }
  function save() {
    const p = game.player;
    const data = {
      v: 1, mode: game.mode, edits: game.world.exportEdits(),
      player: { x: p.position.x, y: p.feetY, z: p.position.z, yaw: input.desktop ? input.yaw : headYaw(), flying: p.flying },
      inv: game.inventory.toJSON(), time: game.sky.time, day: game.sky.day,
    };
    game.events.emit('save', { data });     // phase-2 modules add their own fields to data
    ctx.save(`voxel:world:${seed}`, data);
    saveMeta();
  }

  // ── spawn ────────────────────────────────────────────────
  let sp;
  if (saved?.player && Number.isFinite(saved.player.x)) sp = { ...saved.player };
  else { const s = await game.world.findSpawn(); sp = { x: s.x, y: s.y, z: s.z, yaw: 0 }; }
  if (saved?.inv) game.inventory.load(saved.inv);
  else if (game.mode === 'creative') creativeKit(); else starterKit();
  game.inventory.select(game.inventory.selected);
  ctx.recenter(sp.x, sp.z, sp.yaw ?? 0);
  if (input.desktop || !ctx.isXR()) { rig.position.x = sp.x; rig.position.z = sp.z; }
  rig.position.y = sp.y; game.player.feetY = sp.y; game.player.flying = !!sp.flying && game.mode === 'creative';
  // wait (briefly) for the ground under the player
  const t0 = performance.now();
  while (!game.world.isLoaded(sp.x, sp.z) && performance.now() - t0 < 8000) {
    await new Promise(r => setTimeout(r, 25));
    game.world.update(0.025, sp.x, sp.z);
  }
  if (!saved?.player) {
    let y = sp.y; const pl = game.player;
    while (y < HEIGHT - 2 && !pl._boxFree(sp.x - 0.3, y, sp.z - 0.3, sp.x + 0.3, y + 1.8, sp.z + 0.3)) y++;
    pl.feetY = y; rig.position.y = y;
  }
  game.events.emit('load', { data: saved ?? {} });
  if (!saved) game.toast('Welcome to Blockfell', 3);

  // save when the tab is hidden or closed (dispose() doesn't run then)
  const onHide = (e) => { if (e.type === 'pagehide' || document.visibilityState !== 'visible') { try { save(); } catch { } } };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);

  // ── per-frame ────────────────────────────────────────────
  let saveT = SAVE_EVERY, flickReady = true, offYStart = -1;
  const camPos = new THREE.Vector3(), lightOut = { sky: 15, block: 0 };
  const waterFog = new THREE.Color('#2f7f98');
  const tickEvent = { dt: 0, time: 0 };

  function handleInput() {
    const ui = game.ui, inv = game.inventory;
    if (input.desktop) {
      for (let i = 0; i < 9; i++) if (input.keyDown('Digit' + (i + 1))) inv.select(i);
      if (input.mouse.wheel && !ui.modalOpen) inv.cycle(input.mouse.wheel > 0 ? 1 : -1);
      if (input.keyDown('KeyE') || input.keyDown('KeyI')) ui.toggle('items');
      if (input.keyDown('KeyO')) ui.toggle('settings');
      if (input.keyDown('KeyF') && game.mode === 'creative') { game.player.flying = !game.player.flying; game.toast(game.player.flying ? 'Flying' : 'Walking'); }
    } else {
      const m = input.main;
      if (m.b && !ui.modalOpen) inv.cycle(1);
      const [x, y] = m.axes;
      if (!ui.modalOpen && Math.abs(y) > 0.75 && Math.abs(x) < 0.5 && flickReady) { inv.cycle(y > 0 ? 1 : -1); flickReady = false; m.haptic(0.2, 15); }
      if (Math.abs(y) < 0.3) flickReady = true;
      if (input.off.a) ui.toggle('items');
    }
    // off-hand Y: a short tap opens settings (holding it is the platform's back-to-hub gesture)
    const o = input.off;
    if (o.bHeld && offYStart < 0) offYStart = game.time;
    if (!o.bHeld && offYStart >= 0) { if (game.time - offYStart < 0.45) ui.toggle('settings'); offYStart = -1; }
    if (input.off.stick && !input.desktop) { game.setSetting('sprint', !settings.sprint); game.toast(settings.sprint ? 'Sprint on' : 'Sprint off'); }
  }

  function updateFog() {
    const u = game.mats.uniforms, p = game.player;
    const far = settings.renderDistance * 16 - 6;
    if (p.headInWater) {
      u.uFogNear.value = 0.5; u.uFogFar.value = 14 * p.scale;
      u.uFogColor.value.copy(waterFog).multiplyScalar(0.3 + 0.7 * game.sky.daylight);
    } else { u.uFogNear.value = far * 0.6; u.uFogFar.value = far; }
  }

  function hud() {
    if (!input.desktop) return;
    const p = game.player.position, sk = game.sky;
    const hh = Math.floor(sk.time * 24), mm = Math.floor((sk.time * 24 - hh) * 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const loading = game.world.pendingCount ? ' · loading…' : '';
    ctx.setHud(`${game.mode === 'creative' ? 'Creative' : 'Survival'}${game.player.flying ? ' (flying)' : ''} · ${p.x.toFixed(0)}, ${game.player.feetY.toFixed(0)}, ${p.z.toFixed(0)} · day ${sk.day + 1} ${clock}${loading} · E pack · O settings`);
  }

  return {
    get spawn() { const p = game.player; return { x: p.position.x, z: p.position.z, yaw: input.desktop ? input.yaw : headYaw() }; },
    update(dt) {
      game.time += dt;
      game.rigInv.copy(rig.matrixWorld).invert();
      handleInput();
      game.player.update(dt);
      const f = input.head.fwd;
      game.world.update(dt, game.player.position.x, game.player.position.z, f.x, f.z);
      camera.getWorldPosition(camPos);
      game.sky.update(dt, camPos);
      updateFog();
      game.interact.update(dt);
      const ents = game.entities;
      for (let i = ents.length - 1; i >= 0; i--) {
        const e = ents[i];
        let alive = true;
        try { alive = e.update(dt) !== false && !e.dead; } catch (err) { console.error('[voxel] entity update failed', err); alive = false; }
        if (!alive) { e.dispose?.(); ents.splice(i, 1); }
      }
      game.ui.update(dt);
      game.world.getLight(Math.floor(camPos.x), Math.floor(camPos.y), Math.floor(camPos.z), lightOut);
      game.audio.update(dt, { day: game.sky.daylight, sky: lightOut.sky / 15, underwater: game.player.headInWater, time: game.time });
      tickEvent.dt = dt; tickEvent.time = game.time;
      game.events.emit('tick', tickEvent);
      if ((saveT -= dt) <= 0) { saveT = SAVE_EVERY; save(); }
      hud();
    },
    dispose() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      try { save(); } catch (e) { console.error('[voxel] save failed', e); }
      if (game._nextSeed != null) ctx.save('voxel:meta', { seed: game._nextSeed, settings });
      game.events.emit('dispose', {});
      for (const e of game.entities) e.dispose?.();
      game.entities.length = 0;
      game.world.dispose();
      game.audio.dispose();
      game.ui.dispose(); game.interact.dispose(); game.player.dispose(); game.sky.dispose();
      game.models.dispose();
      clearBlockGeometryCache();
      game.events.clear();
      ctx.setHud('');
      if (window.__voxel === game) delete window.__voxel;
    },
  };
}
