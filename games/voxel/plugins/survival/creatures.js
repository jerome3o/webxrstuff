import * as THREE from 'three';
import { BLOCKS, B, HEIGHT, SEA } from '../../blocks.js';
import { I } from '../../items.js';
import { WorldGen, BIOME } from '../../worldgen.js';
import { MODELS, buildPart } from './models.js';

// Blockfell fauna. All creatures of a kind share InstancedMeshes (one per body part), animated by
// code each frame (walk cycles, flaps, bobbing). AI "thinks" on a staggered 0.25–0.4 s timer
// (steering, state changes, light sampling); movement + telegraphed attacks run per frame.
//
// Kinds:  mossback (passive grazer)   hornbloom (neutral, charges when provoked)   skykite (day glider)
//         lanternmoth (night flier)   glimmerfin (fish)   inkshade (night hostile, burns at dawn)
//         cragcrab (cave hostile)     deepwyrm (rare cave boss, burrows through stone)

const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _P = new THREE.Vector3(), _S = new THREE.Vector3();
const _E = new THREE.Euler(), _Eb = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _mb = new THREE.Matrix4(), _ml = new THREE.Matrix4(), _mm = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color(), _ray = { hit: false };
const LIGHT = { sky: 15, block: 0 };
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// part: [name, pivot, glow, perSegment]
export const KINDS = {
  mossback: {
    name: 'Mossback', type: 'walker', temper: 'passive', hp: 8, speed: 1.1, run: 4.2, w: 0.38, h: 0.95, radius: 0.55, cy: 0.5, cap: 8, group: [2, 3],
    drops: [['mossback_haunch', 1, 2, 1], ['moss_hide', 1, 1, 0.6]], call: [7, 16], avoidWater: true, maxDrop: 2,
    parts: [['body', [0, 0, 0]], ['head', [0, 0.6, -0.46]], ['legsA', [0, 0.3, 0]], ['legsB', [0, 0.3, 0]]],
  },
  hornbloom: {
    name: 'Hornbloom', type: 'walker', temper: 'neutral', hp: 14, speed: 1.3, run: 4.6, chase: 3.6, charge: 8.5, dmg: 5, w: 0.34, h: 1.75, radius: 0.65, cy: 1.05, cap: 3, group: [1, 2],
    drops: [['hornbloom_venison', 1, 2, 1], ['hornbloom_antler', 1, 1, 0.5]], call: [10, 22], avoidWater: true, maxDrop: 2,
    windup: 0.85, attackRange: 3.2, aggroRange: 20, knock: 7, hitExtra: 0.4,
    parts: [['body', [0, 0, 0]], ['head', [0, 1.62, -0.62]], ['legsA', [0, 0.82, 0]], ['legsB', [0, 0.82, 0]]],
  },
  skykite: {
    name: 'Sky Kite', type: 'flier', temper: 'passive', hp: 4, speed: 4.2, radius: 0.55, cy: 0, cap: 4, group: [1, 2], alt: [9, 17],
    drops: [['kite_plume', 1, 2, 1]], call: [6, 14],
    parts: [['body', [0, 0, 0]], ['wingL', [-0.04, 0, 0]], ['wingR', [0.04, 0, 0]]],
  },
  lanternmoth: {
    name: 'Lantern Moth', type: 'flier', temper: 'passive', hp: 2, speed: 1.3, radius: 0.3, cy: 0, cap: 6, group: [2, 3], alt: [1.2, 3.5],
    drops: [['moth_dust', 1, 1, 1]], call: [3, 8],
    parts: [['body', [0, 0, 0]], ['wingL', [-0.02, 0, 0]], ['wingR', [0.02, 0, 0]], ['glow', [0, 0, 0], true]],
  },
  glimmerfin: {
    name: 'Glimmerfin', type: 'swimmer', temper: 'passive', hp: 3, speed: 1.5, radius: 0.3, cy: 0, cap: 8, group: [2, 4],
    drops: [['glimmerfin', 1, 1, 1]], call: [99, 99],
    parts: [['body', [0, 0, 0]], ['tail', [0, 0, 0.2]]],
  },
  inkshade: {
    name: 'Ink Shade', type: 'walker', temper: 'hostile', hp: 12, speed: 1.0, chase: 3.0, lunge: 7, dmg: 3, w: 0.36, h: 1.3, radius: 0.6, cy: 0.7, cap: 6, group: [1, 2],
    drops: [['ink_essence', 0, 2, 1]], call: [5, 11], avoidWater: true, maxDrop: 3, burns: true,
    windup: 0.55, attackRange: 2.0, aggroRange: 22, knock: 5,
    parts: [['body', [0, 0, 0]], ['drips', [0, 0, 0]], ['eyes', [0, 0, 0], true]],
  },
  cragcrab: {
    name: 'Cragcrab', type: 'walker', temper: 'hostile', hp: 18, armor: 1, speed: 0.8, chase: 2.3, lunge: 5, dmg: 4, w: 0.45, h: 0.8, radius: 0.62, cy: 0.4, cap: 4, group: [1, 2],
    drops: [['crab_shell', 1, 2, 1], ['raw_copper', 1, 1, 0.3], ['skyglass_shard', 1, 1, 0.08]], call: [4, 10], avoidWater: true, maxDrop: 3,
    windup: 0.6, attackRange: 1.8, aggroRange: 11, knock: 4,
    parts: [['shell', [0, 0, 0]], ['crystals', [0, 0, 0], true], ['clawL', [-0.42, 0.36, -0.32]], ['clawR', [0.42, 0.36, -0.32]], ['legs', [0, 0, 0]]],
  },
  deepwyrm: {
    name: 'Deep Wyrm', type: 'wyrm', temper: 'boss', hp: 120, speed: 3.0, lunge: 13, dmg: 7, radius: 1.05, cy: 0, cap: 1, segs: 11, group: [1, 1],
    drops: [['wyrm_heart', 1, 1, 1], ['wyrm_scale', 6, 9, 1], ['sunstone_shard', 2, 4, 1]], call: [6, 12],
    windup: 0.95, attackRange: 6.5, aggroRange: 30, knock: 11, hitExtra: 1.2,
    parts: [['head', [0, 0, 0]], ['eyes', [0, 0, 0], true], ['seg', [0, 0, 0], false, true]],
  },
};
export const KIND_NAMES = Object.keys(KINDS);
const HOSTILE = (k) => k.temper === 'hostile';

let NEXT_ID = 1;

export class Creatures {
  constructor(game, sx, fx) {
    this.game = game; this.sx = sx; this.fx = fx;
    this.list = []; this.byKind = {};
    this.gen = new WorldGen(game.seed); this._col = { h: 0, biome: 0 };
    this.lambert = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.root = new THREE.Group(); this.root.name = 'creatures';
    game.scene.add(this.root);
    this.meshes = {};
    for (const key of KIND_NAMES) {
      const k = KINDS[key]; k.key = key;
      this.byKind[key] = [];
      const capacity = (k.cap + 4) * 1;
      this.meshes[key] = k.parts.map(([name, pivot, glow, perSeg]) => {
        const geo = buildPart(MODELS[key][name]);
        const n = perSeg ? capacity * k.segs : capacity;
        const m = new THREE.InstancedMesh(geo, glow ? this.glowMat : this.lambert, n);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.setColorAt(0, _col.set(1, 1, 1));
        m.count = 0; m.frustumCulled = false; m.visible = false;
        m.userData = { name, pivot: pivot ?? [0, 0, 0], glow: !!glow, perSeg: !!perSeg };
        this.root.add(m);
        return m;
      });
    }
    this.spawnT = 2; this.spawnCycle = 0; this.wyrmCooldown = 120;
    this.enabled = true;
    this.counts = { passive: 0, hostile: 0, water: 0, air: 0, boss: 0 };
  }

  get peaceful() { return !!this.game.settings.peaceful; }
  canTargetPlayer() { const g = this.game; return g.mode === 'survival' && !this.peaceful && !(g.survival?.vitals?.dead); }
  dayF() { return THREE.MathUtils.clamp((this.game.sky.daylight - 0.2) / 0.8, 0, 1); }

  // ── spawning ─────────────────────────────────────────────────
  spawn(key, x, y, z, opts = {}) {
    const k = KINDS[key];
    if (!k) return null;
    if (this.byKind[key].length >= k.cap + 4) return null;
    const c = {
      id: NEXT_ID++, key, k, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
      yaw: opts.yaw ?? rand(0, TAU), pitch: 0, roll: 0, moveYaw: 0, wantSpeed: 0, moving: 0,
      hp: k.hp, state: 'wander', stateT: rand(1, 4), thinkT: rand(0, 0.3), seed: Math.random() * 100,
      walk: 0, graze: 0, light: 1, flash: 0, hitStop: 0, stepLag: 0, sink: 0, windup: 0, scale: opts.scale ?? rand(0.9, 1.1),
      onGround: false, inWater: false, callT: rand(k.call[0], k.call[1]), provokedT: 0, didHit: false,
      goal: new THREE.Vector3(x, y, z), home: new THREE.Vector3(x, y, z), airT: 0, dead: false, deathT: 0, age: 0,
    };
    c.moveYaw = c.yaw;
    if (key === 'inkshade' && opts.emerge !== false) { c.state = 'emerge'; c.stateT = 1.4; c.sink = 1.4; this.sx.voice('inkshade', 'emerge', c.pos); }
    if (k.type === 'wyrm') {
      c.scale = 1;
      c.trail = new Float32Array(3 * (k.segs * 2 + 2));
      for (let i = 0; i < c.trail.length; i += 3) { c.trail[i] = x; c.trail[i + 1] = y; c.trail[i + 2] = z + (i / 3) * 0.45; }
      c.trailDist = 0; c.pitch = 0;
      this.sx.voice('deepwyrm', 'call', c.pos);
    }
    this.list.push(c); this.byKind[key].push(c);
    this.game.events.emit('creatureSpawned', { creature: c });
    return c;
  }
  remove(c) {
    c.dead = true;
    let i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1);
    const a = this.byKind[c.key]; i = a.indexOf(c); if (i >= 0) a.splice(i, 1);
  }
  clear() { for (const c of [...this.list]) this.remove(c); }

  _countCats() {
    const n = this.counts; n.passive = n.hostile = n.water = n.air = n.boss = 0;
    for (const c of this.list) {
      const k = c.k;
      if (k.type === 'swimmer') n.water++; else if (k.type === 'flier') n.air++; else if (k.temper === 'boss') n.boss++;
      else if (HOSTILE(k)) n.hostile++; else n.passive++;
    }
    return n;
  }
  hostileCap() {
    const sky = this.game.sky;
    // dusk starts gentle, deep night and later days bring more
    const depth = THREE.MathUtils.clamp(-sky.elevation * 3, 0, 1);
    return sky.isNight ? Math.max(2, Math.round(1 + depth * Math.min(4, 1 + sky.day))) : 2;
  }

  _trySpawn() {
    const g = this.game, world = g.world, p = g.player.position;
    const n = this._countCats();
    const cyc = (this.spawnCycle = (this.spawnCycle + 1) % 5);
    const a = rand(0, TAU), d = rand(18, 42);
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!world.isLoaded(x, z)) return;
    const col = this.gen.column(x, z, this._col);
    const dayF = this.dayF();
    if (cyc === 0 || cyc === 3) {
      // surface: grazers by day, shades at night
      const y = world.surfaceY(x, z, HEIGHT - 1);
      if (y < 0 || !this._standable(x, y, z, 2)) return;
      const below = world.getBlock(x, y - 1, z);
      world.getLight(x, y, z, LIGHT);
      const dark = LIGHT.sky * dayF < 5 && LIGHT.block < 5;
      if (cyc === 3 && dark && g.sky.isNight && n.hostile < this.hostileCap() && !this.peaceful) {
        this.spawnGroup('inkshade', x, y, z); return;
      }
      if (cyc === 0 && n.passive < 9 && (below === B.turf || below === B.snowpack)) {
        if (col.biome === BIOME.forest && Math.random() < 0.3 && this.byKind.hornbloom.length < KINDS.hornbloom.cap) this.spawnGroup('hornbloom', x, y, z);
        else if ((col.biome === BIOME.plains || col.biome === BIOME.forest) && this.byKind.mossback.length < KINDS.mossback.cap) this.spawnGroup('mossback', x, y, z);
        else if (col.biome === BIOME.snow && this.byKind.hornbloom.length < KINDS.hornbloom.cap) this.spawnGroup('hornbloom', x, y, z);
      }
    } else if (cyc === 1) {
      // air: kites by day, moths at night
      if (n.air >= 7) return;
      const y = world.surfaceY(x, z, HEIGHT - 1); if (y < 0) return;
      if (dayF > 0.5 && col.biome !== BIOME.forest && this.byKind.skykite.length < KINDS.skykite.cap) this.spawnGroup('skykite', x + 0.5, Math.min(HEIGHT - 4, Math.max(y, SEA) + rand(10, 16)), z + 0.5);
      else if (dayF < 0.35 && (col.biome === BIOME.plains || col.biome === BIOME.forest) && this.byKind.lanternmoth.length < KINDS.lanternmoth.cap) this.spawnGroup('lanternmoth', x + 0.5, y + rand(1.5, 3), z + 0.5);
    } else if (cyc === 2) {
      // water
      if (n.water >= KINDS.glimmerfin.cap) return;
      const y = world.surfaceY(x, z, HEIGHT - 1);
      if (y < 0) return;
      if (world.getBlock(x, y, z) === B.water && world.getBlock(x, y + 1, z) === B.water) this.spawnGroup('glimmerfin', x + 0.5, y + 0.6, z + 0.5);
    } else {
      // caves: pick a y near the player and look for a dark floor
      let y = Math.floor(g.player.feetY + rand(-14, 8));
      y = Math.max(3, Math.min(SEA - 2, y));
      for (let k = 0; k < 10; k++, y--) if (this._standable(x, y, z, 2) && !world.isSolid(x, y, z)) break;
      if (!this._standable(x, y, z, 2)) return;
      world.getLight(x, y, z, LIGHT);
      if (LIGHT.sky > 5 || LIGHT.block > 4) return;
      if (y < 28 && n.boss === 0 && this.wyrmCooldown <= 0 && Math.random() < 0.04 && this._roomy(x, y + 2, z)) { this.spawn('deepwyrm', x + 0.5, y + 2.5, z + 0.5); this.wyrmCooldown = 240; return; }
      if (n.hostile >= this.hostileCap() || this.peaceful) return;
      if (Math.random() < 0.55 && this.byKind.cragcrab.length < KINDS.cragcrab.cap) this.spawnGroup('cragcrab', x, y, z);
      else this.spawnGroup('inkshade', x, y, z);
    }
  }
  spawnGroup(key, x, y, z) {
    const k = KINDS[key], n = randi(k.group[0], k.group[1]);
    const walker = k.type === 'walker';
    let made = 0;
    for (let i = 0; i < n; i++) {
      let px = x, pz = z, py = y;
      if (i > 0) {
        px = x + randi(-2, 2); pz = z + randi(-2, 2);
        if (walker) { if (!this._standable(px, py, pz, 2)) continue; }
        else if (k.type === 'swimmer' && this.game.world.getBlock(Math.floor(px), Math.floor(py), Math.floor(pz)) !== B.water) continue;
      }
      if (walker) { px += 0.5; pz += 0.5; }
      if (this.spawn(key, px, py, pz)) made++;
    }
    return made;
  }
  // feet cell (x,y,z) free and dry, ground solid below, `h` cells of headroom
  _standable(x, y, z, h) {
    const w = this.game.world;
    if (y < 1 || y >= HEIGHT - 2) return false;
    const below = w.getBlock(x, y - 1, z);
    if (below <= 0 || !BLOCKS[below]?.solid) return false;
    for (let i = 0; i < h; i++) { const id = w.getBlock(x, y + i, z); if (id < 0 || id === B.water || BLOCKS[id]?.solid) return false; }
    return true;
  }
  _roomy(x, y, z) {
    const w = this.game.world;
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (w.isSolid(x + dx, y + dy, z + dz)) return false;
    return true;
  }

  // ── per frame ────────────────────────────────────────────────
  update(dt, time) {
    const g = this.game;
    if (this.wyrmCooldown > 0) this.wyrmCooldown -= dt;
    if (this.enabled && (this.spawnT -= dt) <= 0) { this.spawnT = 0.35; if (g.player && !g.player.frozen) this._trySpawn(); }
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (!c) continue;
      c.age += dt;
      if (c.flash > 0) c.flash -= dt;
      if (c.hitStop > 0) { c.hitStop -= dt; continue; }
      if (c.state === 'dying') { this._dying(c, dt); continue; }
      if ((c.thinkT -= dt) <= 0) { c.thinkT = 0.25 + Math.random() * 0.15; this._think(c); if (c.dead) continue; }
      this._act(c, dt, time);
      switch (c.k.type) {
        case 'walker': this._moveWalker(c, dt); break;
        case 'flier': this._moveFlier(c, dt, time); break;
        case 'swimmer': this._moveSwimmer(c, dt); break;
        case 'wyrm': this._moveWyrm(c, dt); break;
      }
      if ((c.callT -= dt) <= 0) { c.callT = rand(c.k.call[0], c.k.call[1]); if (this._distToPlayer(c) < 22) this.sx.voice(c.key, 'call', c.pos); }
    }
    this._render(time);
  }

  _distToPlayer(c) { const p = this.game.player.position; return Math.hypot(c.pos.x - p.x, c.pos.z - p.z, (c.pos.y - p.y) * 0.8); }
  _yawTo(c, x, z) { return Math.atan2(-(x - c.pos.x), -(z - c.pos.z)); }

  _think(c) {
    const g = this.game, k = c.k, world = g.world, pl = g.player.position;
    const dist = this._distToPlayer(c);
    // despawn far away / unloaded
    const far = Math.min(72, world.renderDistance * 16 - 6);
    if (dist > far || !world.isLoaded(c.pos.x, c.pos.z) || (this.peaceful && HOSTILE(k)) || c.pos.y < -10) { this.remove(c); return; }
    if (k.type === 'wyrm' && dist > 56) { this.remove(c); return; }
    // light sample → instance tint
    world.getLight(Math.floor(c.pos.x), Math.floor(c.pos.y + Math.max(0.3, k.cy)), Math.floor(c.pos.z), LIGHT);
    const daylight = g.sky.daylight;
    // scene lights dim a lot at night; lift sky-lit creatures so they read like the terrain around them
    const nightLift = Math.max(1, 1.3 / (0.35 + 2.5 * this.dayF()));
    c.light = Math.max(0.12, Math.max(Math.pow(0.8, 15 - LIGHT.sky) * nightLift, Math.pow(0.8, 15 - LIGHT.block) / Math.max(0.2, daylight)));
    // hostiles dissolve in sunlight
    if (k.burns && c.state !== 'burn' && c.state !== 'emerge' && LIGHT.sky * this.dayF() > 9) { c.state = 'burn'; c.stateT = 1.6; this.sx.voice(c.key, 'burn', c.pos); return; }
    // night fauna fade away by day, kites roost at night
    if (c.key === 'lanternmoth' && this.dayF() > 0.6 && dist > 12) { this.remove(c); return; }
    if (c.key === 'skykite' && this.dayF() < 0.2 && dist > 16) { this.remove(c); return; }

    const canTarget = this.canTargetPlayer();
    if (c.provokedT > 0) c.provokedT -= 0.3;
    const st = c.state;
    if (st === 'windup' || st === 'strike' || st === 'recover' || st === 'emerge' || st === 'burn') return;

    const aggressive = (HOSTILE(k) || k.temper === 'boss' || (k.temper === 'neutral' && c.provokedT > 0)) && canTarget;
    if (aggressive && dist < k.aggroRange) {
      c.state = 'chase';
    } else if (st === 'chase') { c.state = 'wander'; c.stateT = rand(2, 4); }
    if (st === 'flee' && (c.stateT <= 0)) { c.state = 'wander'; c.stateT = rand(2, 5); }

    if (k.type === 'walker') this._thinkWalker(c, dist, pl);
    else if (k.type === 'flier') this._thinkFlier(c, dist, pl);
    else if (k.type === 'swimmer') this._thinkSwimmer(c, pl);
    else this._thinkWyrm(c, dist, pl);
  }

  _thinkWalker(c, dist, pl) {
    const k = c.k;
    let goal = c.moveYaw, speed = 0;
    if (c.state === 'chase') {
      goal = this._yawTo(c, pl.x, pl.z); speed = k.chase ?? k.run;
      if (dist < k.attackRange && Math.abs(pl.y - c.pos.y) < 2.2) {
        c.state = 'windup'; c.stateT = k.windup; c.yaw = goal; c.wantSpeed = 0;
        this.sx.voice(c.key, 'windup', c.pos); return;
      }
    } else if (c.state === 'flee') {
      goal = this._yawTo(c, pl.x, pl.z) + Math.PI + rand(-0.4, 0.4); speed = k.run;
    } else {
      // wander / graze / idle
      c.stateT -= 0.3;
      if (c.stateT <= 0) {
        const r = Math.random();
        if (r < 0.35) { c.state = 'idle'; c.stateT = rand(2, 5); c.graze = 0; }
        else if (r < 0.55 && c.key !== 'inkshade' && c.key !== 'cragcrab') { c.state = 'graze'; c.stateT = rand(2, 5); }
        else { c.state = 'wander'; c.stateT = rand(3, 7); c.goalYaw = rand(0, TAU); }
      }
      if (c.state === 'wander') { goal = c.goalYaw ?? c.moveYaw; speed = k.speed; }
    }
    if (speed > 0) {
      const maxDrop = c.state === 'chase' ? 4 : k.maxDrop ?? 2;
      const y = this._steer(c, goal, maxDrop, k.avoidWater && c.state !== 'chase');
      if (y === null) { speed = 0; if (c.state === 'wander') c.goalYaw = rand(0, TAU); }
      else c.moveYaw = y;
    }
    c.wantSpeed = speed;
  }
  // try the goal yaw, then increasingly wide detours; null if boxed in
  _steer(c, goal, maxDrop, avoidWater) {
    for (const off of STEER_OFFS) if (this._passable(c, goal + off, maxDrop, avoidWater)) return goal + off;
    return null;
  }
  _passable(c, yaw, maxDrop, avoidWater) {
    const w = this.game.world, k = c.k;
    const ahead = 0.55 + k.w;
    const x = Math.floor(c.pos.x - Math.sin(yaw) * ahead), z = Math.floor(c.pos.z - Math.cos(yaw) * ahead);
    const fy = Math.floor(c.pos.y + 0.05);
    const id = w.getBlock(x, fy, z);
    if (id < 0) return false;
    const hc = Math.ceil(k.h);
    if (BLOCKS[id]?.solid) { // needs a 1-block step up with headroom
      for (let i = 1; i <= hc; i++) if (w.isSolid(x, fy + i, z)) return false;
      return true;
    }
    for (let i = 1; i < hc; i++) if (w.isSolid(x, fy + i, z)) return false;
    if (avoidWater && id === B.water) return false;
    let d = 0;
    while (d <= maxDrop) { const b = w.getBlock(x, fy - 1 - d, z); if (b < 0) return false; if (BLOCKS[b]?.solid) break; if (avoidWater && b === B.water) return false; d++; }
    return d <= maxDrop;
  }

  _thinkFlier(c, dist, pl) {
    const k = c.k, w = this.game.world;
    if (c.state === 'flee') { /* goal set on hit */ }
    else {
      c.stateT -= 0.3;
      const dx = c.goal.x - c.pos.x, dz = c.goal.z - c.pos.z;
      if (c.stateT <= 0 || dx * dx + dz * dz < 4) {
        const a = rand(0, TAU), r = c.key === 'skykite' ? rand(8, 20) : rand(2, 6);
        let gx = c.pos.x + Math.cos(a) * r, gz = c.pos.z + Math.sin(a) * r;
        if (c.key === 'lanternmoth') { gx = c.home.x + Math.cos(a) * r; gz = c.home.z + Math.sin(a) * r; }
        const sy = w.surfaceY(gx, gz, HEIGHT - 1);
        const base = sy < 0 ? c.pos.y : (c.key === 'skykite' ? Math.max(sy, SEA) : sy);
        c.goal.set(gx, Math.min(HEIGHT - 3, base + rand(k.alt[0], k.alt[1])), gz);
        c.stateT = rand(3, 7);
      }
    }
  }
  _thinkSwimmer(c, pl) {
    c.stateT -= 0.3;
    if (c.state !== 'flee' && c.stateT <= 0) { c.goalYaw = c.yaw + rand(-1.5, 1.5); c.stateT = rand(2, 5); c.goalDy = rand(-0.4, 0.4); }
  }
  _thinkWyrm(c, dist, pl) {
    if (c.state === 'chase') {
      c.goal.set(pl.x, pl.y + 1, pl.z);
      if (dist < c.k.attackRange) { c.state = 'windup'; c.stateT = c.k.windup; this.sx.voice('deepwyrm', 'windup', c.pos); }
    } else {
      c.stateT -= 0.3;
      if (c.stateT <= 0 || c.pos.distanceToSquared(c.goal) < 4) {
        c.goal.set(c.home.x + rand(-12, 12), c.home.y + rand(-4, 4), c.home.z + rand(-12, 12));
        c.goal.y = Math.max(4, Math.min(SEA - 4, c.goal.y)); c.stateT = rand(4, 8);
      }
    }
  }

  // per-frame state actions (telegraphs, strikes, burns, emerge)
  _act(c, dt, time) {
    const k = c.k, g = this.game;
    if (c.state === 'graze') c.graze = Math.min(1, c.graze + dt * 2); else c.graze = Math.max(0, c.graze - dt * 3);
    if (c.state === 'emerge') {
      c.stateT -= dt; c.sink = Math.max(0, c.stateT);
      if ((time * 8 | 0) !== ((time - dt) * 8 | 0)) this.fx.burst(_v.set(c.pos.x, c.pos.y + 0.1, c.pos.z), 2, { colors: [0x2f2650, 0x4a3b7a, 0x6a5a48], speed: 1.2, life: 0.6, size: 0.08, collide: true });
      if (c.stateT <= 0) { c.state = 'wander'; c.stateT = 1; c.sink = 0; }
      return;
    }
    if (c.state === 'burn') {
      c.stateT -= dt; c.wantSpeed = 0;
      if (Math.random() < dt * 30) this.fx.burst(_v.set(c.pos.x, c.pos.y + 0.6 + Math.random() * 0.6, c.pos.z), 1, { colors: [0x3a2f5e, 0x7d6aa8, 0xffd9a0], speed: 0.6, up: 1.5, grav: -1.5, life: 1.0, size: 0.12, grow: 2 });
      c.sink = (1.6 - c.stateT) * 0.6;
      if (c.stateT <= 0) this.remove(c);
      return;
    }
    if (c.state === 'windup') {
      c.stateT -= dt; c.windup = Math.min(1, c.windup + dt / k.windup);
      const pl = g.player.position;
      if (k.type !== 'wyrm') c.yaw += angDiff(c.yaw, this._yawTo(c, pl.x, pl.z)) * Math.min(1, dt * 6);
      c.wantSpeed = 0;
      if (c.stateT <= 0) {
        c.state = 'strike'; c.stateT = k.type === 'wyrm' ? 0.6 : c.key === 'hornbloom' ? 0.9 : 0.45; c.didHit = false;
        this.sx.voice(c.key, 'attack', c.pos);
        if (k.type === 'walker') {
          c.moveYaw = c.yaw;
          const sp = k.charge ?? k.lunge ?? 5;
          c.vel.x = -Math.sin(c.yaw) * sp; c.vel.z = -Math.cos(c.yaw) * sp;
          if (c.key === 'inkshade') c.vel.y = 4.5;
          c.wantSpeed = k.charge ? sp : 0;
        } else if (k.type === 'wyrm') {
          _v.set(pl.x, pl.y + 1, pl.z).sub(c.pos).normalize();
          c.lungeDir = (c.lungeDir || new THREE.Vector3()).copy(_v);
        }
      }
      return;
    }
    c.windup = Math.max(0, c.windup - dt * 3);
    if (c.state === 'strike') {
      c.stateT -= dt;
      if (!c.didHit && this.canTargetPlayer()) {
        const p = g.player, s = p.scale;
        _v.set(p.position.x, p.feetY + 0.9 * s, p.position.z);
        _w.set(c.pos.x, c.pos.y + k.cy * c.scale, c.pos.z);
        if (_v.distanceTo(_w) < k.radius * c.scale + 0.55 * s + (k.hitExtra ?? 0)) {
          c.didHit = true;
          const e = g.damagePlayer(k.dmg, 'creature', { kind: c.key, name: k.name, pos: c.pos });
          if (e && e.applied) {
            _v.sub(_w).setY(0); if (_v.lengthSq() < 1e-4) _v.set(0, 0, 1); _v.normalize();
            g.player.push(_v.x * k.knock, 3 + k.knock * 0.25, _v.z * k.knock);
          }
          if (k.type === 'walker' && !k.charge) { c.vel.x *= -0.3; c.vel.z *= -0.3; }
        }
      }
      if (c.stateT <= 0) { c.state = 'recover'; c.stateT = k.type === 'wyrm' ? 1.6 : rand(1.0, 1.6); c.wantSpeed = 0; }
      return;
    }
    if (c.state === 'recover') { c.stateT -= dt; c.wantSpeed = 0; if (c.stateT <= 0) c.state = 'chase'; return; }
    if (c.state === 'flee') c.stateT -= dt;
  }

  // ── movement ────────────────────────────────────────────────
  _blocked(c, x, y, z) {
    const w = this.game.world, hw = c.k.w * c.scale, e = 1e-3;
    const y0 = Math.floor(y + 0.02), y1 = Math.floor(y + c.k.h * c.scale - 0.02);
    for (let yy = y0; yy <= y1; yy++)
      for (let q = 0; q < 4; q++) {
        const bx = Math.floor(x + ((q & 1) ? hw - e : -hw + e)), bz = Math.floor(z + ((q & 2) ? hw - e : -hw + e));
        if (w.isSolid(bx, yy, bz)) return true;
      }
    return false;
  }
  _moveWalker(c, dt) {
    const g = this.game, w = g.world, k = c.k;
    const id = w.getBlock(Math.floor(c.pos.x), Math.floor(c.pos.y + 0.3), Math.floor(c.pos.z));
    if (id < 0) return; // chunk not loaded: freeze
    c.inWater = id === B.water;
    // turn toward move direction
    if (c.wantSpeed > 0.05) c.yaw += angDiff(c.yaw, c.moveYaw) * Math.min(1, dt * 6);
    const tvx = -Math.sin(c.moveYaw) * c.wantSpeed, tvz = -Math.cos(c.moveYaw) * c.wantSpeed;
    const ctl = c.state === 'strike' && !k.charge ? 0 : (c.onGround || c.inWater ? 8 : 1.5);
    const a = Math.min(1, dt * ctl);
    c.vel.x += (tvx - c.vel.x) * a; c.vel.z += (tvz - c.vel.z) * a;
    if (c.inWater) { c.vel.y += (1.2 - c.vel.y) * Math.min(1, dt * 3); }
    else c.vel.y = Math.max(-30, c.vel.y - 24 * dt);
    // separation from the player
    const pl = g.player.position;
    const dx = c.pos.x - pl.x, dz = c.pos.z - pl.z, dd = dx * dx + dz * dz, rr = k.w * c.scale + 0.35;
    if (dd < rr * rr && dd > 1e-6 && Math.abs(c.pos.y - g.player.feetY) < 1.5) { const d = Math.sqrt(dd); c.vel.x += dx / d * 3 * dt * 10; c.vel.z += dz / d * 3 * dt * 10; }
    // x / z with 1-block step up
    let bumped = false;
    for (let ax = 0; ax < 2; ax++) {
      const d = (ax === 0 ? c.vel.x : c.vel.z) * dt;
      if (d === 0) continue;
      const nx = ax === 0 ? c.pos.x + d : c.pos.x, nz = ax === 0 ? c.pos.z : c.pos.z + d;
      if (!this._blocked(c, nx, c.pos.y, nz)) { c.pos.x = nx; c.pos.z = nz; continue; }
      if ((c.onGround || c.inWater) && !this._blocked(c, nx, c.pos.y + 1.02, nz) && !this._blocked(c, c.pos.x, c.pos.y + 1.02, c.pos.z)) {
        c.pos.y = Math.floor(c.pos.y + 0.05) + 1; c.stepLag += 1; c.pos.x = nx; c.pos.z = nz;
      } else { if (ax === 0) c.vel.x = 0; else c.vel.z = 0; bumped = true; }
    }
    if (bumped && c.state === 'wander') c.thinkT = Math.min(c.thinkT, 0.05);
    // y
    const ny = c.pos.y + c.vel.y * dt;
    c.onGround = false;
    if (c.vel.y <= 0) {
      if (this._blocked(c, c.pos.x, ny, c.pos.z)) { c.pos.y = Math.floor(ny) + 1; c.vel.y = 0; c.onGround = true; }
      else c.pos.y = ny;
    } else {
      if (this._blocked(c, c.pos.x, ny, c.pos.z)) c.vel.y = 0; else c.pos.y = ny;
    }
    c.stepLag = Math.max(0, c.stepLag - dt * 6);
    const sp = Math.hypot(c.vel.x, c.vel.z);
    c.moving += (Math.min(1, sp / Math.max(0.5, k.speed)) - c.moving) * Math.min(1, dt * 6);
    c.walk += sp * dt * (c.key === 'cragcrab' ? 9 : c.key === 'hornbloom' ? 3.2 : 5.5);
    c.bob = 0;
  }
  _moveFlier(c, dt, time) {
    const w = this.game.world, k = c.k;
    const dx = c.goal.x - c.pos.x, dy = c.goal.y - c.pos.y, dz = c.goal.z - c.pos.z;
    const gy = Math.atan2(-dx, -dz);
    const turn = angDiff(c.yaw, gy);
    const rate = c.key === 'skykite' ? 1.2 : 3.5;
    const t = THREE.MathUtils.clamp(turn, -rate * dt, rate * dt);
    c.yaw += t;
    c.roll += ((c.key === 'skykite' ? -t / dt * 0.45 : 0) - c.roll) * Math.min(1, dt * 3);
    const speed = c.state === 'flee' ? k.speed * 1.8 : k.speed;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    let vy = THREE.MathUtils.clamp(dy * 0.8, -2, 2.5);
    if (c.key === 'lanternmoth') vy += Math.sin(time * 3 + c.seed) * 0.6;
    const nx = c.pos.x + fx * speed * dt, nz = c.pos.z + fz * speed * dt;
    const ahead = w.getBlock(Math.floor(c.pos.x + fx * 1.2), Math.floor(c.pos.y), Math.floor(c.pos.z + fz * 1.2));
    if (ahead < 0) return;
    if (BLOCKS[ahead]?.solid || ahead === B.water) { vy = 2.5; c.yaw += dt * 2; }
    else { c.pos.x = nx; c.pos.z = nz; }
    const ny = c.pos.y + vy * dt;
    const yb = w.getBlock(Math.floor(c.pos.x), Math.floor(ny), Math.floor(c.pos.z));
    if (yb >= 0 && !BLOCKS[yb]?.solid && yb !== B.water) c.pos.y = ny; else c.pos.y += 1.5 * dt;
    c.pitch += (vy * 0.12 - c.pitch) * Math.min(1, dt * 3);
    c.climb = vy;
    c.moving = 1;
  }
  _moveSwimmer(c, dt) {
    const w = this.game.world, k = c.k;
    const here = w.getBlock(Math.floor(c.pos.x), Math.floor(c.pos.y), Math.floor(c.pos.z));
    if (here < 0) return;
    if (here !== B.water) {
      // stranded: flop
      c.airT += dt;
      c.vel.y -= 20 * dt;
      const ny = c.pos.y + c.vel.y * dt;
      if (w.isSolid(Math.floor(c.pos.x), Math.floor(ny - 0.1), Math.floor(c.pos.z))) { c.pos.y = Math.floor(ny - 0.1) + 1.1; c.vel.y = rand(2.5, 4); c.yaw += rand(-2, 2); }
      else c.pos.y = ny;
      c.roll = Math.PI / 2;
      if (c.airT > 8) this.hit(c, 99, 0, 0, null);
      return;
    }
    c.airT = 0; c.roll *= 0.9;
    if (c.goalYaw != null) c.yaw += angDiff(c.yaw, c.goalYaw) * Math.min(1, dt * 2);
    const sp = c.state === 'flee' ? k.speed * 2.2 : k.speed;
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    const ax = Math.floor(c.pos.x + fx * 0.6), az = Math.floor(c.pos.z + fz * 0.6);
    if (w.getBlock(ax, Math.floor(c.pos.y), az) !== B.water) { c.goalYaw = c.yaw + Math.PI * rand(0.6, 1.4); c.yaw += dt * 3; }
    else { c.pos.x += fx * sp * dt; c.pos.z += fz * sp * dt; }
    const vy = (c.goalDy ?? 0);
    const ny = c.pos.y + vy * dt;
    if (w.getBlock(Math.floor(c.pos.x), Math.floor(ny + 0.25), Math.floor(c.pos.z)) === B.water && w.getBlock(Math.floor(c.pos.x), Math.floor(ny - 0.2), Math.floor(c.pos.z)) === B.water) c.pos.y = ny;
    else c.goalDy = -vy;
    c.moving = sp / k.speed;
  }
  _moveWyrm(c, dt) {
    const k = c.k, w = this.game.world;
    if (w.getBlock(Math.floor(c.pos.x), Math.floor(c.pos.y), Math.floor(c.pos.z)) < 0) return;
    let speed = k.speed;
    let tx, ty, tz;
    if (c.state === 'strike' && c.lungeDir) { speed = k.lunge; tx = c.lungeDir.x; ty = c.lungeDir.y; tz = c.lungeDir.z; }
    else if (c.state === 'windup') { speed = -1.2; const p = this.game.player.position; _v.set(p.x, p.y + 1, p.z).sub(c.pos).normalize(); tx = _v.x; ty = _v.y; tz = _v.z; }
    else if (c.state === 'recover') { speed = 1; _v.copy(c.home).sub(c.pos).normalize(); tx = _v.x; ty = _v.y; tz = _v.z; }
    else { _v.copy(c.goal).sub(c.pos); const l = _v.length() || 1; tx = _v.x / l; ty = _v.y / l; tz = _v.z / l; if (c.state === 'chase') speed = k.speed * 1.5; }
    // steer heading (yaw/pitch) toward the target direction with a turn-rate limit
    const gy = Math.atan2(-tx, -tz), gp = Math.asin(THREE.MathUtils.clamp(ty, -1, 1));
    const rate = c.state === 'windup' ? 4 : 1.6;
    c.yaw += THREE.MathUtils.clamp(angDiff(c.yaw, gy), -rate * dt, rate * dt);
    c.pitch += THREE.MathUtils.clamp(gp - c.pitch, -rate * dt, rate * dt);
    c.pitch = THREE.MathUtils.clamp(c.pitch, -1.1, 1.1);
    const cp = Math.cos(c.pitch);
    const fx = -Math.sin(c.yaw) * cp, fy = Math.sin(c.pitch), fz = -Math.cos(c.yaw) * cp;
    const step = speed * dt;
    c.pos.x += fx * step; c.pos.y = THREE.MathUtils.clamp(c.pos.y + fy * step, 3, HEIGHT - 4); c.pos.z += fz * step;
    // never push the big head through the player's face (VR comfort): hold it at arm's length
    const eye = this.game.player.eye;
    _w.copy(c.pos).sub(eye); const dl = _w.length();
    if (dl < 2.3 && dl > 1e-3) { c.pos.copy(eye).addScaledVector(_w, 2.3 / dl); if (c.state === 'strike') { c.state = 'recover'; c.stateT = 1.6; } }
    // burrowing dust when the head is inside stone
    if (Math.random() < dt * 8 && w.isSolid(Math.floor(c.pos.x), Math.floor(c.pos.y), Math.floor(c.pos.z)))
      this.fx.burst(c.pos, 2, { colors: [0x8e9aae, 0x68738a, 0xb9c2d2], speed: 2, life: 0.7, size: 0.12, collide: true });
    // trail
    if (step > 0) {
      c.trailDist += step;
      const tr = c.trail;
      while (c.trailDist >= 0.45) {
        c.trailDist -= 0.45;
        tr.copyWithin(3, 0, tr.length - 3);
        tr[0] = c.pos.x; tr[1] = c.pos.y; tr[2] = c.pos.z;
      }
    }
    c.moving = 1;
    c.walk += Math.abs(step) * 2;
  }

  _dying(c, dt) {
    c.deathT += dt;
    if (c.k.type === 'walker') { c.roll = Math.min(1.5, c.deathT * 4); c.vel.y -= 20 * dt; }
    else if (c.k.type !== 'wyrm') c.pos.y -= dt * 2;
    const dur = c.k.type === 'wyrm' ? 1.8 : 0.7;
    if (c.k.type === 'wyrm' && Math.random() < dt * 20) {
      const i = (Math.random() * c.k.segs | 0) * 2 * 3;
      this.fx.burst(_v.set(c.trail[i], c.trail[i + 1], c.trail[i + 2]), 3, { colors: [0x6f82ad, 0xc9d6f5, 0xff9a6a], speed: 3, life: 0.8, size: 0.16 });
    }
    if (c.deathT >= dur) {
      _v.set(c.pos.x, c.pos.y + Math.max(0.3, c.k.cy * c.scale), c.pos.z);
      this.fx.burst(_v, c.k.type === 'wyrm' ? 30 : 12, { colors: POOF[c.key] ?? [0xffffff], speed: 2, life: 0.7, size: 0.1 });
      if (this.game.mode === 'survival' && !c.noDrops) for (const [item, lo, hi, ch] of c.k.drops) {
        if (Math.random() > ch || I[item] == null) continue;
        const n = randi(lo, hi); if (n <= 0) continue;
        this.game.spawnDrop(I[item], n, _v);
      }
      this.remove(c);
    }
  }

  // Damage a creature. dir (x,z) is the knockback direction; by: 'player' | null.
  hit(c, dmg, dx, dz, by = 'player', heavy = false) {
    if (c.dead || c.state === 'dying') return false;
    const k = c.k;
    dmg = Math.max(0.5, dmg - (k.armor ?? 0));
    c.hp -= dmg; c.flash = 0.18; c.hitStop = heavy ? 0.1 : 0.06;
    const kb = k.type === 'wyrm' ? 0.3 : heavy ? 7 : 4.5;
    if (k.type === 'walker') { c.vel.x += dx * kb; c.vel.z += dz * kb; c.vel.y = Math.max(c.vel.y, 3.2); c.onGround = false; }
    else if (k.type !== 'wyrm') { c.pos.x += dx * 0.3; c.pos.z += dz * 0.3; }
    _v.set(c.pos.x, c.pos.y + Math.max(0.2, k.cy * c.scale), c.pos.z);
    this.fx.burst(_v, 6, { colors: POOF[c.key] ?? [0xffffff], speed: 1.8, life: 0.45, size: 0.06 });
    if (c.hp <= 0) {
      c.state = 'dying'; c.deathT = 0; c.wantSpeed = 0;
      this.sx.voice(c.key, 'die', c.pos);
      this.game.events.emit('creatureKilled', { kind: c.key, name: k.name, pos: c.pos.clone(), by });
      return true;
    }
    this.sx.voice(c.key, 'hurt', c.pos);
    if (by === 'player') {
      if (k.temper === 'passive') {
        c.state = 'flee'; c.stateT = 5;
        if (k.type === 'flier') { c.goal.set(c.pos.x + dx * 18, c.pos.y + 6, c.pos.z + dz * 18); c.stateT = 4; }
        if (k.type === 'swimmer') c.goalYaw = Math.atan2(-dx, -dz);
        // the herd startles too
        for (const o of this.byKind[c.key]) if (o !== c && o.pos.distanceToSquared(c.pos) < 64 && o.state !== 'dying') { o.state = 'flee'; o.stateT = 4; }
      } else if (k.temper === 'neutral') {
        c.provokedT = 25;
        for (const o of this.byKind[c.key]) if (o.pos.distanceToSquared(c.pos) < 144) o.provokedT = 25;
        if (c.state !== 'strike' && c.state !== 'windup') c.state = 'chase';
      } else if (heavy && c.state === 'windup') { c.state = 'recover'; c.stateT = 0.5; c.windup = 0; }
      else if (c.state === 'wander' || c.state === 'idle') c.state = 'chase';
      c.thinkT = 0;
    }
    return false;
  }

  // Nearest creature along a ray within maxDist → { c, t } or null (also checks wyrm segments).
  raycast(o, d, maxDist, out = { c: null, t: 0 }) {
    out.c = null; out.t = maxDist;
    for (const c of this.list) {
      if (c.state === 'dying') continue;
      if (c.k.type === 'wyrm') {
        this._raySphere(o, d, c.pos.x, c.pos.y, c.pos.z, c.k.radius, c, out);
        const tr = c.trail;
        for (let i = 0; i < c.k.segs; i++) { const j = (i + 1) * 2 * 3; this._raySphere(o, d, tr[j], tr[j + 1], tr[j + 2], 0.65 * (1 - i / c.k.segs * 0.45), c, out); }
      } else this._raySphere(o, d, c.pos.x, c.pos.y + c.k.cy * c.scale - c.sink, c.pos.z, c.k.radius * c.scale, c, out);
    }
    return out.c ? out : null;
  }
  _raySphere(o, d, cx, cy, cz, r, c, out) {
    const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
    const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return;
    let t = -b - Math.sqrt(disc);
    if (t < 0) t = cc < 0 ? 0 : -1;
    if (t >= 0 && t < out.t) { out.t = t; out.c = c; }
  }
  // Creature whose hit volume contains point p (expanded by extra) → creature or null
  touching(p, extra) {
    let best = null, bd = Infinity;
    for (const c of this.list) {
      if (c.state === 'dying') continue;
      let d;
      if (c.k.type === 'wyrm') {
        d = Math.hypot(p.x - c.pos.x, p.y - c.pos.y, p.z - c.pos.z) - c.k.radius;
        const tr = c.trail;
        for (let i = 0; i < c.k.segs; i++) { const j = (i + 1) * 6; d = Math.min(d, Math.hypot(p.x - tr[j], p.y - tr[j + 1], p.z - tr[j + 2]) - 0.65); }
      } else d = Math.hypot(p.x - c.pos.x, p.y - (c.pos.y + c.k.cy * c.scale - c.sink), p.z - c.pos.z) - c.k.radius * c.scale;
      if (d < extra && d < bd) { bd = d; best = c; }
    }
    return best;
  }
  nearbyHostiles(p, r) {
    let n = 0;
    for (const c of this.list) if ((HOSTILE(c.k) || c.k.temper === 'boss' || c.provokedT > 0) && c.state !== 'dying' && c.pos.distanceTo(p) < r) n++;
    return n;
  }

  // ── rendering ───────────────────────────────────────────────
  _render(time) {
    for (const key of KIND_NAMES) {
      const arr = this.byKind[key], meshes = this.meshes[key];
      if (!arr.length) { for (const m of meshes) { m.count = 0; m.visible = false; } continue; }
      const k = KINDS[key];
      const counts = this._counts || (this._counts = new Int32Array(8));
      counts.fill(0);
      for (const c of arr) {
        const dyingS = c.state === 'dying' ? Math.max(0.05, 1 - c.deathT / (k.type === 'wyrm' ? 1.8 : 0.7) * 0.7) : 1;
        const burnS = c.state === 'burn' ? Math.max(0.05, c.stateT / 1.6) : 1;
        _Eb.set(c.pitch, c.yaw, c.roll, 'YXZ');
        _qb.setFromEuler(_Eb);
        _S.setScalar(c.scale * dyingS * burnS);
        _mb.compose(_v.set(c.pos.x, c.pos.y + (c.bob ?? 0) - c.stepLag - c.sink, c.pos.z), _qb, _S);
        const fl = c.flash > 0 ? 1 + c.flash * 6 : 1;
        for (let pi = 0; pi < meshes.length; pi++) {
          const m = meshes[pi], ud = m.userData;
          if (ud.perSeg) {
            this._renderSegs(c, m, counts, pi, fl, dyingS);
            continue;
          }
          const piv = ud.pivot;
          _P.set(piv[0], piv[1], piv[2]); _E.set(0, 0, 0); _S.set(1, 1, 1);
          ANIM[key](c, ud.name, _P, _E, _S, time);
          _ml.compose(_P, _q.setFromEuler(_E), _S);
          _mm.multiplyMatrices(_mb, _ml);
          const idx = counts[pi]++;
          m.setMatrixAt(idx, _mm);
          if (ud.glow) { const gl = (key === 'inkshade' ? 0.75 + c.windup * 0.8 : key === 'deepwyrm' ? 0.8 + c.windup * 1.2 : 1) * (c.state === 'burn' ? burnS : 1); _col.setRGB(gl, gl, gl); }
          else { const l = c.light * fl; _col.setRGB(l * (c.flash > 0 ? 1.25 : 1), l, l); }
          m.setColorAt(idx, _col);
        }
      }
      for (let pi = 0; pi < meshes.length; pi++) {
        const m = meshes[pi];
        m.count = counts[pi]; m.visible = m.count > 0;
        if (m.count) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
      }
    }
  }
  _renderSegs(c, m, counts, pi, fl, dyingS) {
    const k = c.k, tr = c.trail;
    for (let i = 0; i < k.segs; i++) {
      const j = (i + 1) * 2 * 3, jp = j - 6;
      _v.set(tr[j], tr[j + 1], tr[j + 2]);
      _w.set(tr[jp], tr[jp + 1], tr[jp + 2]);
      if (_v.distanceToSquared(_w) < 1e-6) _w.z -= 0.01;
      _ml.lookAt(_v, _w, _up);
      const s = (1 - i / k.segs * 0.45) * dyingS * (1 + Math.sin(c.walk * 0.8 - i * 0.7) * 0.04);
      _S.setScalar(s);
      _q.setFromRotationMatrix(_ml);
      _mm.compose(_v, _q, _S);
      const idx = counts[pi]++;
      m.setMatrixAt(idx, _mm);
      const l = c.light * fl; _col.setRGB(l, l, l);
      m.setColorAt(idx, _col);
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const key of KIND_NAMES) for (const m of this.meshes[key]) m.geometry.dispose();
    this.lambert.dispose(); this.glowMat.dispose();
    this.list.length = 0;
  }
}

const STEER_OFFS = [0, 0.6, -0.6, 1.2, -1.2, 2.0, -2.0, Math.PI];
const POOF = {
  mossback: [0xe3cfae, 0x8fbf72, 0xf2a7c3], hornbloom: [0xe9c7b9, 0xf6e6da, 0xf49ab8], skykite: [0xf4f6ff, 0xa9cdf2, 0xe58f9f],
  lanternmoth: [0xffe08a, 0xd9c7f0, 0xfff8d6], glimmerfin: [0x6cc9c0, 0xf6d77a, 0xbff4ff], inkshade: [0x2f2650, 0x4a3b7a, 0xa8f6ff],
  cragcrab: [0x8e9aae, 0x74dcef, 0xb9c2d2], deepwyrm: [0x6f82ad, 0xc9d6f5, 0xff9a6a],
};

// Per-kind part animation: (creature, partName, pivot P, euler E, scale S, time) → mutate P/E/S.
const ANIM = {
  mossback(c, part, P, E, S, t) {
    const ph = c.walk, mv = c.moving, sw = Math.sin(ph) * 0.55 * mv;
    switch (part) {
      case 'body': P.y += Math.abs(Math.sin(ph)) * 0.04 * mv + Math.sin(t * 2 + c.seed) * 0.008; E.z = Math.sin(ph) * 0.05 * mv; S.y = 1 + Math.sin(t * 2 + c.seed) * 0.015; break;
      case 'head':
        P.y += Math.abs(Math.sin(ph)) * 0.04 * mv - 0.2 * c.graze; P.z -= 0.06 * c.graze;
        E.x = -0.75 * c.graze + Math.sin(t * 1.3 + c.seed) * 0.07 + (c.graze > 0.5 ? Math.sin(t * 9) * 0.08 : 0);
        E.y = Math.sin(t * 0.6 + c.seed) * 0.35 * (1 - mv) * (1 - c.graze); break;
      case 'legsA': E.x = sw; break;
      case 'legsB': E.x = -sw; break;
    }
  },
  hornbloom(c, part, P, E, S, t) {
    const ph = c.walk, mv = c.moving, sw = Math.sin(ph) * 0.45 * mv;
    const lower = Math.max(c.windup, c.state === 'strike' ? 1 : 0);
    switch (part) {
      case 'body': P.y += Math.abs(Math.sin(ph)) * 0.05 * mv; E.x = lower * 0.12; break;
      case 'head':
        P.y += Math.abs(Math.sin(ph)) * 0.05 * mv - 0.45 * c.graze - 0.35 * lower; P.z -= 0.15 * c.graze + 0.15 * lower;
        E.x = -0.9 * c.graze - 0.95 * lower + Math.sin(t * 1.1 + c.seed) * 0.06;
        E.y = Math.sin(t * 0.5 + c.seed) * 0.4 * (1 - mv) * (1 - c.graze) * (1 - lower);
        if (c.windup > 0) E.z = Math.sin(t * 20) * 0.08 * c.windup; break;
      case 'legsA': E.x = sw; if (c.windup > 0 && c.state === 'windup') E.x = Math.sin(t * 14) * 0.35; break;
      case 'legsB': E.x = -sw; break;
    }
  },
  skykite(c, part, P, E, S, t) {
    const flap = c.climb > 0.3 || c.state === 'flee' ? Math.sin(t * 9 + c.seed) * 0.6 : Math.sin(t * 1.5 + c.seed) * 0.08;
    if (part === 'wingL') E.z = flap; else if (part === 'wingR') E.z = -flap;
    else P.y += Math.sin(t * 1.5 + c.seed) * 0.05;
  },
  lanternmoth(c, part, P, E, S, t) {
    const f = Math.sin(t * 24 + c.seed) * 0.9;
    if (part === 'wingL') E.z = f; else if (part === 'wingR') E.z = -f;
    else if (part === 'glow') S.setScalar(0.85 + Math.sin(t * 2.5 + c.seed) * 0.2);
  },
  glimmerfin(c, part, P, E, S, t) {
    const w = Math.sin(t * 9 * (0.6 + c.moving * 0.6) + c.seed);
    if (part === 'body') E.y = w * 0.12; else { E.y = w * 0.6; P.x = Math.sin(t * 9 + c.seed - 0.5) * 0.02; }
  },
  inkshade(c, part, P, E, S, t) {
    const br = Math.sin(t * 3 + c.seed), wu = c.windup;
    const ph = c.walk;
    if (part === 'body') { S.y = 1 + br * 0.05 + wu * 0.18; S.x = S.z = 1 - br * 0.03 + wu * 0.12; E.z = Math.sin(ph) * 0.08 * c.moving; E.x = -wu * 0.2; }
    else if (part === 'drips') { E.y = t * 0.6 + c.seed; S.y = 1 + Math.sin(t * 4 + c.seed) * 0.2; }
    else { P.y += (S.y - 1) + br * 0.05 + wu * 0.15; S.setScalar(1 + wu * 0.5); P.z -= wu * 0.08; E.x = -wu * 0.2; }
  },
  cragcrab(c, part, P, E, S, t) {
    const ph = c.walk, mv = c.moving, wu = c.windup;
    const strike = c.state === 'strike' ? 1 : 0;
    switch (part) {
      case 'shell': case 'crystals': P.y += Math.abs(Math.sin(ph)) * 0.03 * mv; E.z = Math.sin(ph) * 0.06 * mv; E.x = -wu * 0.15; break;
      case 'legs': P.y += Math.abs(Math.sin(ph * 2)) * 0.03 * mv; E.y = Math.sin(ph * 2) * 0.08 * mv; break;
      case 'clawL': E.x = -wu * 1.1 + strike * 0.6 + Math.sin(t * 2 + c.seed) * 0.08; E.y = 0.25 + Math.sin(t * 6) * 0.15 * wu; E.z = -wu * 0.3; P.y += wu * 0.12; break;
      case 'clawR': E.x = -wu * 1.1 + strike * 0.6 + Math.sin(t * 2 + c.seed + 1) * 0.08; E.y = -0.25 - Math.sin(t * 6) * 0.15 * wu; E.z = wu * 0.3; P.y += wu * 0.12; break;
    }
  },
  deepwyrm(c, part, P, E, S, t) {
    const wu = c.windup;
    if (part === 'head') { E.x = -wu * 0.3 + Math.sin(t * 2) * 0.05; E.z = Math.sin(t * 1.3) * 0.08; }
    else if (part === 'eyes') { E.x = -wu * 0.3 + Math.sin(t * 2) * 0.05; E.z = Math.sin(t * 1.3) * 0.08; S.setScalar(1 + wu * 0.6); }
  },
};
