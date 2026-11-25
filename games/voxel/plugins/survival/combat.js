import * as THREE from 'three';
import { BLOCKS } from '../../blocks.js';
import { ITEMS, I } from '../../items.js';
import { meleeDamage, isBlade } from './items.js';

// Player combat: VR melee by physically swinging the held item (hand velocity), laser/crosshair
// strikes (VR trigger at close range, desktop LMB), the twine sling (hold grip/RMB to draw,
// release to loose a stone), and use/hit of the bedroll and death pouches.

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _tip = new THREE.Vector3(), _v = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const MAXP = 12;

export class Combat {
  constructor(game, creatures, vitals, sx, fx) {
    this.game = game; this.cr = creatures; this.vitals = vitals; this.sx = sx; this.fx = fx;
    this.cool = 0; this.swingCool = 0;
    this.aim = null;          // creature under the crosshair / laser
    this.aimProp = null;      // 'bed' | pouch object
    this.blockAim = false;    // last frame: something we own is being aimed at → veto block break/place
    this.charge = -1;
    this._rc = { c: null, t: 0 }; this._hit = { hit: false };
    this.stones = [];
    this.stoneMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshLambertMaterial({ color: 0x9aa3b5, flatShading: true }), MAXP);
    this.stoneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.stoneMesh.count = 0; this.stoneMesh.frustumCulled = false; this.stoneMesh.visible = false;
    game.scene.add(this.stoneMesh);
  }

  get reach() { return (this.game.input.desktop ? 3.6 : 3.2) * this.game.player.scale; }

  update(dt) {
    const g = this.game, input = g.input, h = input.main;
    this.cool -= dt; this.swingCool -= dt;
    this._stones(dt);
    const busy = g.ui.modalOpen || g.ui.pointerOnPanel || this.vitals.dead || this.vitals.sleepT >= 0;
    this.aim = null; this.aimProp = null;
    if (!h.present || busy) { this.blockAim = false; this.charge = -1; return; }

    // ── what is the main ray pointing at? ──
    _o.copy(h.rayPos); _d.copy(h.rayDir());
    const reach = this.reach;
    const blk = g.world.raycast(_o, _d, reach + 1, this._hit);
    const blockDist = blk.hit ? blk.dist : Infinity;
    const r = this.cr.raycast(_o, _d, reach, this._rc);
    if (r && r.t < blockDist) this.aim = r.c;
    if (!this.aim) this.aimProp = this._propAt(_o, _d, Math.min(blockDist + 0.6, 4.5));
    this.blockAim = !!(this.aim || this.aimProp);
    if (this.blockAim && g.interact) { g.interact.progress = 0; g.interact.crack.visible = false; }

    const stack = g.inventory.selectedStack, def = stack ? ITEMS[stack.id] : null;
    const sling = def?.weapon?.ranged;

    // ── strikes with trigger / LMB ──
    if (h.triggerDown || (h.trigger > 0.55 && this.cool <= 0 && (this.aim))) {
      if (this.aim && this.cool <= 0) this.strike(this.aim, stack, _d, 1);
      else if (this.aimProp && h.triggerDown) this._hitProp(this.aimProp);
      else if (h.triggerDown && !this.aim && !blk.hit) { this.sx.swing(); if (g.interact) g.interact.swing = 1; }
    }
    // ── grip on the bedroll: sleep / set spawn ──
    if (h.squeezeDown && this.aimProp === 'bed') this.vitals.trySleep();

    // ── VR: physical swings ──
    if (!input.desktop && this.swingCool <= 0) {
      const speed = h.velocity.length();
      if (speed > 2.0) {
        const len = def && def.kind !== 'block' ? 0.32 : 0.12;
        _tip.copy(h.gripPos).addScaledVector(h.rayDir(), len * g.player.scale);
        const c = this.cr.touching(_tip, 0.12) || this.cr.touching(h.gripPos, 0.08);
        if (c) {
          _v.copy(h.velocity).normalize();
          this.strike(c, stack, _v, THREE.MathUtils.clamp(speed / 3.5, 0.7, 1.5));
          this.swingCool = isBlade(stack) ? 0.28 : 0.38;
        }
      }
    }

    // ── sling ──
    if (sling) this._sling(dt, h, def);
    else this.charge = -1;
  }

  strike(c, stack, dir, mult) {
    const g = this.game, h = g.input.main;
    const base = meleeDamage(stack);
    const dmg = base * mult;
    const heavy = dmg >= 5 || mult > 1.25;
    const dx = dir.x, dz = dir.z, l = Math.hypot(dx, dz) || 1;
    const killed = this.cr.hit(c, dmg, dx / l, dz / l, 'player', heavy);
    this.cool = isBlade(stack) ? 0.35 : 0.5;
    this.sx.hit(c.pos, heavy);
    h.haptic?.(heavy ? 0.9 : 0.6, heavy ? 80 : 45);
    if (g.interact) g.interact.swing = 1;
    _v.set(c.pos.x, c.pos.y + c.k.cy * c.scale, c.pos.z);
    this.fx.burst(_v, heavy ? 8 : 4, { colors: [0xffffff, 0xfff2c2], speed: 3, life: 0.2, size: 0.04, grav: 0 });
    if (g.mode === 'survival') {
      this.vitals.exh += 0.1;
      if (stack && ITEMS[stack.id]?.tool) g.inventory.wearSelected(1);
    }
    return killed;
  }

  _propAt(o, d, maxD) {
    const v = this.vitals;
    let best = null, bt = maxD;
    const test = (x, y, z, r, obj) => {
      const ox = o.x - x, oy = o.y - y, oz = o.z - z;
      const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
      if (disc < 0) return; const t = -b - Math.sqrt(disc);
      if (t >= 0 && t < bt) { bt = t; best = obj; }
    };
    if (v.bed) test(v.bed.x, v.bed.y + 0.15, v.bed.z, 0.6, 'bed');
    for (const p of v.pouches) test(p.x, p.y + 0.2, p.z, 0.35, p);
    return best;
  }
  _hitProp(p) {
    if (p === 'bed') this.vitals.pickUpBed();
    else if (this.game.mode === 'survival') this.vitals.collectPouch(p);
  }

  _sling(dt, h, def) {
    const g = this.game;
    const held = h.squeeze > 0.5;
    if (held) {
      if (this.charge < 0) { this.charge = 0; }
      const before = this.charge;
      this.charge = Math.min(1, this.charge + dt / 0.8);
      if (Math.floor(before * 4) !== Math.floor(this.charge * 4) && this.charge < 1) { this.sx.charge(); h.haptic?.(0.15 + this.charge * 0.3, 20); }
      if (g.interact) g.interact.swing = Math.max(g.interact.swing, this.charge * 0.6);
    } else if (this.charge >= 0) {
      const c = this.charge; this.charge = -1;
      if (c < 0.15) return;
      let ammo = null;
      if (g.mode === 'creative') ammo = -1;
      else for (const k of def.weapon.ammo) if (I[k] != null && g.inventory.count(I[k]) > 0) { ammo = I[k]; break; }
      if (ammo == null) { g.toast('The sling needs stones: Slate Rubble or Shingle', 2); return; }
      if (ammo > 0) g.inventory.removeItem(ammo, 1);
      this.fire(h.rayPos, h.rayDir(), 10 + c * 18, 2 + c * 4);
      h.haptic?.(0.6, 40);
    }
  }
  fire(pos, dir, speed, dmg) {
    if (this.stones.length >= MAXP) this.stones.shift();
    const p = pos.clone().addScaledVector(dir, 0.3);
    this.stones.push({ pos: p, vel: dir.clone().multiplyScalar(speed), life: 4, dmg });
    this.sx.sling();
  }
  _stones(dt) {
    const w = this.game.world;
    let n = 0;
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i];
      s.life -= dt;
      s.vel.y -= 14 * dt;
      // substeps so fast stones don't tunnel
      let gone = s.life <= 0;
      for (let k = 0; k < 3 && !gone; k++) {
        s.pos.addScaledVector(s.vel, dt / 3);
        const c = this.cr.touching(s.pos, 0.08);
        if (c) {
          _v.copy(s.vel).setY(0); const l = _v.length() || 1;
          this.cr.hit(c, s.dmg, _v.x / l, _v.z / l, 'player', s.dmg >= 5);
          this.sx.hit(c.pos, false);
          gone = true; break;
        }
        const id = w.getBlock(Math.floor(s.pos.x), Math.floor(s.pos.y), Math.floor(s.pos.z));
        if (id < 0 || BLOCKS[id]?.solid) {
          this.fx.burst(s.pos, 4, { colors: [0x9aa3b5, 0x68738a], speed: 1.5, life: 0.4, size: 0.04 });
          this.game.audio.material('stone', 'hit', s.pos);
          gone = true;
        }
      }
      if (gone) { this.stones.splice(i, 1); continue; }
    }
    for (const s of this.stones) { _m.compose(s.pos, _q, _s); this.stoneMesh.setMatrixAt(n++, _m); }
    this.stoneMesh.count = n; this.stoneMesh.visible = n > 0;
    if (n) this.stoneMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.stoneMesh.removeFromParent(); this.stoneMesh.geometry.dispose(); this.stoneMesh.material.dispose(); }
}
