// Blockfell phase 2: creatures, combat and survival (health, hunger, breath, death pouch, bedroll).
// Default export install(game, ctx) → { dispose() }. Submodules live in ./survival/.
// Public surface: game.survival = { vitals, creatures, combat, spawn(kind,…), debug helpers } (see ARCHITECTURE.md).
import * as THREE from 'three';
import { B, BLOCKS, HEIGHT } from '../blocks.js';
import { ITEMS, I } from '../items.js';
import { FONTS, roundRect } from '../../../src/platform/kit.js';
import './survival/items.js';
import { Fx } from './survival/fx.js';
import { SurvivalSfx } from './survival/sfx.js';
import { Creatures, KINDS, KIND_NAMES } from './survival/creatures.js';
import { Vitals, MAX_HP, MAX_FOOD } from './survival/vitals.js';
import { Combat } from './survival/combat.js';

const BTN = { bg: '#2c2544', hoverBg: '#41375f', border: '#a99cc8', fg: '#f8f1e3', activeBg: '#5f8f6a', font: FONTS.sans };

export default async function install(game, ctx) {
  const fx = new Fx(game);
  const sx = new SurvivalSfx(game);
  const vitals = new Vitals(game, sx, fx);
  const creatures = new Creatures(game, sx, fx);
  const combat = new Combat(game, creatures, vitals, sx, fx);
  const seen = new Set();

  const api = game.survival = {
    vitals, creatures, combat, fx, sfx: sx, KINDS,
    // debug / scripting hooks
    spawn(kind, x, y, z, opts) {
      const p = game.player;
      if (x == null) { const f = game.input.head.fwd; x = p.position.x + f.x * 4; z = p.position.z + f.z * 4; y = null; }
      if (y == null) {
        const k = KINDS[kind];
        if (k?.type === 'flier') y = p.eye.y + 1;
        else if (k?.type === 'wyrm') y = p.eye.y + 2;
        else if (k?.type === 'swimmer') y = p.eye.y;
        else { y = Math.floor(p.feetY) + 3; while (y > 1 && !game.world.isSolid(Math.floor(x), y - 1, Math.floor(z))) y--; }
      }
      return creatures.spawn(kind, x, y, z, { emerge: false, ...(opts || {}) });
    },
    setTime(t) { game.sky.setTime(t); },
    damage(n, cause = 'unknown') { return game.damagePlayer(n, cause); },
    heal(n = MAX_HP) { vitals.heal(n); },
    feed(n = MAX_FOOD) { vitals.hunger = Math.min(MAX_FOOD, vitals.hunger + n); },
    kill(cause = 'testing') { vitals.die(cause); },
    respawn() { if (vitals.dead) vitals.respawn(); },
    clearCreatures() { creatures.clear(); },
    setSpawning(on) { creatures.enabled = !!on; },
    get state() { return { hp: vitals.hp, hunger: vitals.hunger, sat: vitals.sat, breath: vitals.breath, dead: vitals.dead, bed: vitals.bed, spawn: vitals.spawn, pouches: vitals.pouches.length, creatures: creatures.list.length }; },
  };

  // ── events ───────────────────────────────────────────────
  const offs = [];
  const on = (n, f) => offs.push(game.events.on(n, f));
  on('playerDamaged', (e) => vitals.onDamaged(e));
  on('blockBreak', (e) => { if (combat.blockAim || vitals.dead) e.cancel = true; });
  on('blockPlace', (e) => { if (combat.blockAim || vitals.dead) e.cancel = true; });
  on('useItem', (e) => {
    const st = e.stack; if (!st) return;
    if (st.id === I.bedroll) {
      e.handled = true;
      const t = e.target;
      if (!t || t.ny !== 1 || t.physical) { game.toast('Lay the bedroll on flat ground', 1.6); return; }
      const x = t.x + 0.5, y = t.y + 1, z = t.z + 0.5;
      const here = game.world.getBlock(t.x, t.y + 1, t.z), above = game.world.getBlock(t.x, t.y + 2, t.z);
      if ((here > 0 && !BLOCKS[here]?.replaceable) || (above > 0 && BLOCKS[above]?.solid)) { game.toast('Not enough room here', 1.6); return; }
      const f = game.input.head.fwd;
      vitals.placeBed(x, y, z, Math.atan2(-f.x, -f.z) + Math.PI);
      if (game.mode === 'survival') game.inventory.takeFromSlot(game.inventory.selected, 1);
      game.audio.material('cloth', 'place', new THREE.Vector3(x, y, z));
      game.toast('Bedroll laid: you will wake here. Grip it at night to sleep', 3);
      if (game.sky.time > 0.78 || game.sky.time < 0.2) vitals.trySleep();
    } else if (ITEMS[st.id]?.food) e.handled = true;
  });
  // foraging: tufts sometimes hide dewberries, blossoms drop plums
  on('blockBroken', (e) => {
    if (game.mode !== 'survival' || e.by !== 'player') return;
    const p = new THREE.Vector3(e.x + 0.5, e.y + 0.4, e.z + 0.5);
    if (e.id === B.tuft && Math.random() < 0.12) game.spawnDrop(I.dewberry, 1, p);
    else if (e.id === B.blossom && Math.random() < 0.1) game.spawnDrop(I.plumfruit, 1, p);
    else if (e.id === B.amber_leaves && Math.random() < 0.04) game.spawnDrop(I.dewberry, 1, p);
  });
  on('creatureKilled', (e) => { if (e.kind === 'deepwyrm') game.toast('The Deep Wyrm falls! Its ember heart glows', 4); });
  on('creatureSpawned', (e) => {
    const k = e.creature.key;
    if (k === 'deepwyrm') game.toast('The ground trembles… a Deep Wyrm stirs', 3.5);
    seen.add(k);
  });
  on('modeChanged', () => { vitals._hudKey = -1; if (game.mode === 'creative' && vitals.dead) vitals.respawn(); });
  on('settingChanged', (e) => { if (e.key === 'peaceful') { game.toast(e.value ? 'Peaceful: no hostile creatures' : 'Peaceful off: nights are dangerous', 2); game.ui.modal.markDirty(); } });

  on('save', (e) => { e.data.survival = { ...vitals.toJSON(), seen: [...seen] }; });
  on('load', (e) => {
    const s = e.data?.survival;
    const p = game.player;
    vitals.spawn = { x: p.position.x, y: p.feetY, z: p.position.z };
    if (s) { vitals.load(s); for (const k of s.seen ?? []) seen.add(k); }
    else if (game.mode === 'survival') {
      // first survival session in this world: a few things to get going
      game.inventory.add(I.sling, 1); game.inventory.add(I.bedroll, 1); game.inventory.add(I.dewberry, 4);
    }
  });

  on('tick', (e) => {
    const dt = e.dt, t = e.time;
    vitals.update(dt, t);
    combat.update(dt);
    creatures.update(dt, t);
    fx.update(dt);
    if (game.ui.modalOpen && game.ui.activeTab === 'vitals') { tabT -= dt; if (tabT <= 0) { tabT = 0.5; game.ui.modal.markDirty(); } }
  });
  let tabT = 0;

  // ── Vitals tab ─────────────────────────────────────────────
  game.ui.addTab({
    id: 'vitals', label: 'Vitals',
    draw(c, W, H, panel) {
      const v = vitals, s = game.settings;
      c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillStyle = '#ffd27a'; c.font = `700 34px ${FONTS.sans}`;
      c.fillText(game.mode === 'creative' ? 'Creative: creatures are harmless here' : v.dead ? 'Felled' : 'Survival', 44, 130);
      const bar = (y, label, val, max, col) => {
        c.fillStyle = '#f3e6cf'; c.font = `600 28px ${FONTS.sans}`; c.fillText(label, 44, y + 18);
        c.fillStyle = '#1d1830'; roundRect(c, 230, y, 420, 36, 14); c.fill();
        c.fillStyle = col; roundRect(c, 232, y + 2, Math.max(0, 416 * Math.min(1, val / max)), 32, 12); c.fill();
        c.fillStyle = '#f8f1e3'; c.font = `600 24px ${FONTS.sans}`; c.textAlign = 'center'; c.fillText(`${Math.ceil(val)} / ${max}`, 440, y + 19); c.textAlign = 'left';
      };
      bar(170, 'Health', v.hp, MAX_HP, '#e8607a');
      bar(220, 'Hunger', v.hunger, MAX_FOOD, '#f0a54f');
      bar(270, 'Saturation', v.sat, MAX_FOOD, '#c9b26a');
      bar(320, 'Breath', v.breath, 10, '#8fd0f0');
      c.fillStyle = '#b9aed0'; c.font = `400 24px ${FONTS.sans}`;
      const sp = v.bed ? `bedroll at ${v.bed.x.toFixed(0)}, ${v.bed.y.toFixed(0)}, ${v.bed.z.toFixed(0)}` : 'world spawn';
      c.fillText(`Wake point: ${sp}`, 44, 386);
      if (v.pouches.length) c.fillText(`Lost pouches: ${v.pouches.map(p => `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`).join('  ·  ')}`, 44, 420);
      // settings
      c.fillStyle = '#f3e6cf'; c.font = `600 28px ${FONTS.sans}`; c.fillText('Difficulty', 690, 188);
      panel.button('sv:peace', 690, 214, 140, 54, 'Peaceful', () => game.setSetting('peaceful', true), { ...BTN, active: !!s.peaceful });
      panel.button('sv:normal', 840, 214, 140, 54, 'Normal', () => game.setSetting('peaceful', false), { ...BTN, active: !s.peaceful });
      // creatures met
      c.fillStyle = '#f3e6cf'; c.font = `600 28px ${FONTS.sans}`; c.fillText('Creatures met', 690, 300);
      c.font = `400 24px ${FONTS.sans}`;
      let y = 336;
      for (const k of KIND_NAMES) {
        const met = seen.has(k);
        c.fillStyle = met ? '#f8f1e3' : '#5f557a';
        c.textAlign = 'left'; c.fillText(met ? KINDS[k].name : '???', 690 + ((y - 336) / 32 >= 4 ? 165 : 0), 336 + (((y - 336) / 32) % 4) * 32);
        y += 32;
      }
      c.fillStyle = '#b9aed0'; c.font = `400 24px ${FONTS.sans}`; c.textAlign = 'left';
      const help = game.input.desktop
        ? ['LMB: strike a creature · hold RMB with food selected: eat', 'Sling: hold RMB to draw, release to loose · RMB the bedroll at night: sleep']
        : ['Swing your held item to strike · hold food to your mouth: eat', 'Sling: hold grip to draw, release to loose · grip the bedroll at night: sleep'];
      c.fillText(help[0], 44, 470); c.fillText(help[1], 44, 504);
    },
  });

  return {
    dispose() {
      for (const off of offs) off();
      vitals.dispose(); creatures.dispose(); combat.dispose(); fx.dispose();
      if (game.survival === api) delete game.survival;
    },
  };
}
