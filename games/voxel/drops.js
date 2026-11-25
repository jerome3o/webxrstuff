import * as THREE from 'three';
import { BLOCKS } from './blocks.js';

// Dropped item entity: a small spinning item that falls, rests on blocks and is pulled into the
// player when near. Follows the entity interface: { update(dt) → false when finished, dispose(), dead }.
const _t = new THREE.Vector3();
const lightOut = { sky: 15, block: 0 };
const AXES = ['x', 'z'];

export class ItemDrop {
  constructor(game, id, count, pos, vel = null) {
    this.game = game; this.id = id; this.count = count;
    this.kind = 'item';
    this.pos = pos.clone(); this.vel = vel ? vel.clone() : new THREE.Vector3((Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2);
    this.age = 0; this.dead = false; this.spin = Math.random() * 6;
    this.obj = game.models.create(id);
    const isBlock = !!game.models && id < 256;
    this.obj.scale.setScalar(isBlock ? 0.26 : 0.34);
    this.half = isBlock ? 0.13 : 0.1;
    game.scene.add(this.obj);
    this._lightT = 0;
  }
  update(dt) {
    const g = this.game, p = this.pos, v = this.vel;
    this.age += dt;
    const target = g.player.position, s = g.player.scale;
    _t.set(target.x, target.y + 0.9 * s, target.z);
    const d = _t.distanceTo(p);
    if (this.age > 0.6 && d < 2.4 * s && g.inventory.canFit(this.id)) {
      // magnet
      _t.sub(p).normalize().multiplyScalar(Math.min(14, 4 + (2.4 * s - d) * 8));
      v.lerp(_t, 1 - Math.exp(-dt * 10));
      p.addScaledVector(v, dt);
      if (d < 0.55 * s) {
        const left = g.inventory.add(this.id, this.count);
        g.events.emit('itemPickedUp', { id: this.id, count: this.count - left });
        g.audio.pop(null);
        if (left > 0) this.count = left; else { this.dead = true; return false; }
      }
    } else {
      v.y -= 18 * dt;
      v.x *= Math.exp(-dt * 2); v.z *= Math.exp(-dt * 2);
      // y collision against the block below
      const ny = p.y + v.y * dt;
      const below = g.world.getBlock(Math.floor(p.x), Math.floor(ny - this.half), Math.floor(p.z));
      if (v.y < 0 && (below < 0 || BLOCKS[below]?.solid)) { p.y = Math.floor(ny - this.half) + 1 + this.half; v.y = 0; v.x *= 0.6; v.z *= 0.6; }
      else p.y = ny;
      for (const ax of AXES) {
        const n = p[ax] + v[ax] * dt;
        const q = ax === 'x' ? g.world.getBlock(Math.floor(n), Math.floor(p.y), Math.floor(p.z)) : g.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(n));
        if (q < 0 || BLOCKS[q]?.solid) v[ax] = 0; else p[ax] = n;
      }
      // in water: float up gently
      const here = g.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (BLOCKS[here]?.render === 'liquid') { v.y = Math.min(v.y + 30 * dt, 1); }
      // pushed out if a block was placed into us
      if (BLOCKS[here]?.solid) p.y = Math.floor(p.y) + 1 + this.half;
    }
    this.spin += dt * 1.6;
    this.obj.position.set(p.x, p.y + Math.sin(this.age * 2.5) * 0.04 + 0.04, p.z);
    this.obj.rotation.set(0, this.spin, 0);
    if ((this._lightT -= dt) <= 0) {
      this._lightT = 0.4;
      const bm = this.obj.userData.blockMesh;
      if (bm) {
        g.world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), lightOut);
        const sky = Math.pow(0.8, 15 - lightOut.sky), blk = Math.pow(0.8, 15 - lightOut.block);
        bm.userData.itemLight = Math.max(sky, blk / Math.max(0.2, g.sky.daylight));
      }
    }
    if (this.age > 300) { this.dead = true; return false; }
    return true;
  }
  dispose() { this.obj.removeFromParent(); }
}
