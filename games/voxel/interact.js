import * as THREE from 'three';
import { BLOCKS, B, HEIGHT } from './blocks.js';
import { ITEMS, breakInfo, rollDrops } from './items.js';

// Targeting, breaking and placing blocks with the main hand (laser or physical touch),
// highlight + crack overlay, block particles, and the item held in the main hand.
//
// Cancellable events (set e.cancel = true): 'blockBreak' { x,y,z,id }, 'blockPlace' { x,y,z,id }
// Notifications: 'blockBroken' { x,y,z,id, drops }, 'blockPlaced' { x,y,z,id }
// Hooks (set e.handled = true to consume the grip press):
//   'blockUse' { x,y,z,id, stack }  grip on a block whose def has interact: true (chests, benches...)
//   'useItem'  { stack, target }    grip while holding a non-block item (food, buckets...)

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const MAXP = 96;

export class Interaction {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.hit = { hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, id: 0, dist: 0 };
    this.target = null;            // { x,y,z,nx,ny,nz,id, physical }
    this.progress = 0; this.breakKey = ''; this.tickT = 0; this.repeatT = 0; this.placeT = 0;

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x241d33, transparent: true, opacity: 0.75 }));
    this.outline.visible = false;
    this.faceTint = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.faceTint.visible = false;
    this.crackTex = game.crackTexture;
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.006, 1.006, 1.006), new THREE.MeshBasicMaterial({ map: this.crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.crack.visible = false;
    scene.add(this.outline, this.faceTint, this.crack);

    // VR laser
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.35 }));
    this.laser.frustumCulled = false; this.laser.visible = false;
    game.ctx.rig.add(this.laser);

    // particles
    this.pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), MAXP);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.setColorAt(0, new THREE.Color());
    this.pMesh.count = 0; this.pMesh.frustumCulled = false;
    scene.add(this.pMesh);
    this.parts = []; for (let i = 0; i < MAXP; i++) this.parts.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), s: 0.1, c: new THREE.Color() });

    // hands: main hand holds the selected item; small mittens show where the controllers are (VR)
    this.held = new THREE.Group(); this.heldId = -1; this.heldObj = null; this.swing = 0;
    game.ctx.rig.add(this.held);
    const mitten = (color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.09), new THREE.MeshLambertMaterial({ color }));
      m.visible = false; game.ctx.rig.add(m); return m;
    };
    this.mainMitten = mitten(0xf1d3c0); this.offMitten = mitten(0xf1d3c0);
  }

  get reach() { return (this.game.input.desktop ? 5.5 : 5) * this.game.player.scale; }

  update(dt) {
    const g = this.game, input = g.input, world = g.world, h = input.main;
    const uiOpen = g.ui.modalOpen || g.ui.pointerOnPanel;
    this._updateParticles(dt);
    this._updateHands(dt);
    this.target = null;
    if (!h.present || uiOpen) { this._hideTarget(); this.progress = 0; this.laser.visible = false; return; }

    // physical touch: controller tip inside a block (VR only)
    let physical = false;
    if (!input.desktop) {
      _p.copy(h.rayDir()).multiplyScalar(0.07 * g.player.scale).add(h.gripPos);
      const id = world.getBlock(Math.floor(_p.x), Math.floor(_p.y), Math.floor(_p.z));
      const d = BLOCKS[id];
      if (id > 0 && d && d.render !== 'liquid') {
        physical = true;
        this.target = this._setT(Math.floor(_p.x), Math.floor(_p.y), Math.floor(_p.z), 0, 1, 0, id, true);
      }
    }
    if (!physical) {
      _o.copy(h.rayPos); _d.copy(h.rayDir());
      const r = world.raycast(_o, _d, this.reach, this.hit);
      if (r.hit) this.target = this._setT(r.x, r.y, r.z, r.nx, r.ny, r.nz, r.id, false);
    }
    // laser (VR)
    if (!input.desktop) {
      this.laser.visible = true;
      const len = this.target && !physical ? this.hit.dist : this.reach;
      this.laser.position.copy(h.rayPos).applyMatrix4(g.rigInv);
      this.laser.quaternion.setFromRotationMatrix(_m.extractRotation(g.rigInv)).multiply(h.rayQuat);
      this.laser.scale.set(1, 1, Math.max(0.01, len / g.player.scale));
    } else this.laser.visible = false;

    this._showTarget();
    this._breaking(dt);
    this._placing(dt);
  }

  _setT(x, y, z, nx, ny, nz, id, physical) {
    const t = this._t || (this._t = {});
    t.x = x; t.y = y; t.z = z; t.nx = nx; t.ny = ny; t.nz = nz; t.id = id; t.physical = physical;
    return t;
  }
  _hideTarget() { this.outline.visible = this.faceTint.visible = this.crack.visible = false; }
  _showTarget() {
    const t = this.target;
    if (!t) { this._hideTarget(); return; }
    const d = BLOCKS[t.id];
    const cross = d?.render === 'cross';
    this.outline.visible = true;
    this.outline.position.set(t.x + 0.5, t.y + (cross ? 0.4 : 0.5), t.z + 0.5);
    this.outline.scale.set(cross ? 0.75 : 1, cross ? 0.8 : 1, cross ? 0.75 : 1);
    this.faceTint.visible = !t.physical && !cross;
    if (this.faceTint.visible) {
      this.faceTint.position.set(t.x + 0.5 + t.nx * 0.502, t.y + 0.5 + t.ny * 0.502, t.z + 0.5 + t.nz * 0.502);
      _d.set(t.nx, t.ny, t.nz);
      this.faceTint.quaternion.setFromUnitVectors(_o.set(0, 0, 1), _d);
    }
    this.crack.visible = this.progress > 0.02 && !cross;
    if (this.crack.visible) {
      this.crack.position.set(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      this.crackTex.offset.x = Math.min(7, Math.floor(this.progress * 8)) / 8;
    }
  }

  _breaking(dt) {
    const g = this.game, h = g.input.main, t = this.target;
    const holding = h.trigger > 0.55;
    if (!holding || !t) { this.progress = 0; this.breakKey = ''; this.repeatT = 0; return; }
    const def = BLOCKS[t.id];
    if (!def || def.hardness === Infinity) { this.progress = 0; return; }
    const key = t.x + ',' + t.y + ',' + t.z;
    if (key !== this.breakKey) { this.breakKey = key; this.progress = 0; this.tickT = 0; }
    const creative = g.mode === 'creative';
    const info = breakInfo(def, g.inventory.selectedStack, creative);
    if (creative) {
      this.repeatT -= dt;
      if (h.triggerDown || this.repeatT <= 0) { this.repeatT = 0.22; this.breakBlock(t.x, t.y, t.z, { drops: false }); h.haptic(0.5, 30); }
      return;
    }
    this.progress += dt / info.time;
    this.swing = Math.max(this.swing, 0.4);
    this.tickT -= dt;
    if (this.tickT <= 0) {
      this.tickT = 0.22;
      g.audio.material(def.sound, 'hit', _p.set(t.x + 0.5, t.y + 0.5, t.z + 0.5));
      h.haptic(0.25 + this.progress * 0.4, 25);
      this._burst(t, def, 3, 0.6);
      this.swing = 1;
    }
    if (this.progress >= 1) {
      this.progress = 0; this.breakKey = '';
      this.breakBlock(t.x, t.y, t.z, { drops: info.drops, wear: true });
      h.haptic(0.8, 60);
    }
  }

  // Break a block as the player would. opts: { drops: bool, wear: bool }
  breakBlock(x, y, z, opts = {}) {
    const g = this.game, world = g.world;
    const id = world.getBlock(x, y, z);
    if (id <= 0) return false;
    const def = BLOCKS[id];
    const ev = g.events.emit('blockBreak', { x, y, z, id, cancel: false });
    if (ev.cancel) return false;
    world.setBlock(x, y, z, 0, { cause: 'player' });
    const drops = opts.drops ? rollDrops(def) : [];
    for (const d of drops) g.spawnDrop(d.id, d.count, _p.set(x + 0.5, y + 0.4, z + 0.5));
    this._burst({ x, y, z }, def, 14, 1);
    g.audio.material(def.sound, 'break', _p.set(x + 0.5, y + 0.5, z + 0.5));
    if (opts.wear && def.hardness > 0) g.inventory.wearSelected(1);
    g.events.emit('blockBroken', { x, y, z, id, drops, by: 'player' });
    // plants and dunecaps lose their support
    const above = world.getBlock(x, y + 1, z);
    if (above > 0 && BLOCKS[above].render === 'cross') this.breakBlock(x, y + 1, z, { drops: opts.drops });
    return true;
  }

  _placing(dt) {
    const g = this.game, h = g.input.main, t = this.target;
    if (h.squeeze < 0.5) { this.placeT = 0; return; }
    const first = h.squeezeDown;
    this.placeT -= dt;
    if (!first && this.placeT > 0) return;
    this.placeT = first ? 0.32 : 0.2;
    if (!t) return;
    const stack = g.inventory.selectedStack;
    const tdef = BLOCKS[t.id];
    if (tdef?.interact && first) {
      const e = g.events.emit('blockUse', { x: t.x, y: t.y, z: t.z, id: t.id, stack, handled: false });
      if (e.handled) return;
    }
    if (!stack) return;
    const idef = ITEMS[stack.id];
    if (!idef || idef.kind !== 'block') {
      if (first) g.events.emit('useItem', { stack, target: t, handled: false });
      return;
    }
    if (t.physical) return;
    let x = t.x, y = t.y, z = t.z;
    if (!tdef?.replaceable) { x += t.nx; y += t.ny; z += t.nz; }
    if (y < 0 || y >= HEIGHT) return;
    const cur = g.world.getBlock(x, y, z);
    if (cur < 0 || (cur !== 0 && !BLOCKS[cur]?.replaceable)) return;
    const def = BLOCKS[stack.id];
    if (def.solid && this._intersectsPlayer(x, y, z)) return;
    if (def.render === 'cross') { const below = g.world.getBlock(x, y - 1, z); if (!(below > 0 && BLOCKS[below].solid)) return; }
    const ev = g.events.emit('blockPlace', { x, y, z, id: stack.id, cancel: false });
    if (ev.cancel) return;
    g.world.setBlock(x, y, z, stack.id, { cause: 'player' });
    g.audio.material(def.sound, 'place', _p.set(x + 0.5, y + 0.5, z + 0.5));
    h.haptic(0.4, 25);
    this.swing = 1;
    if (g.mode !== 'creative') g.inventory.takeFromSlot(g.inventory.selected, 1);
    g.events.emit('blockPlaced', { x, y, z, id: stack.id, by: 'player' });
  }

  _intersectsPlayer(x, y, z) {
    const p = this.game.player, w = p.width / 2, e = 0.02;
    const px = p.position.x, pz = p.position.z, py = p.feetY;
    return x < px + w - e && x + 1 > px - w + e && z < pz + w - e && z + 1 > pz - w + e && y < py + p.height - e && y + 1 > py + e;
  }

  _burst(t, def, n, speed) {
    const g = this.game;
    const tileName = def.tiles?.side ?? def.tiles?.all ?? def.tiles?.top;
    const c = g.atlas.avg.get(tileName) ?? [0.6, 0.6, 0.6];
    for (let i = 0; i < n; i++) {
      const q = this.parts.find(pp => pp.life <= 0);
      if (!q) break;
      q.life = 0.5 + Math.random() * 0.5;
      q.p.set(t.x + 0.2 + Math.random() * 0.6, t.y + 0.2 + Math.random() * 0.6, t.z + 0.2 + Math.random() * 0.6);
      q.v.set((Math.random() - 0.5) * 3 * speed, (1 + Math.random() * 2.5) * speed, (Math.random() - 0.5) * 3 * speed);
      q.s = 0.06 + Math.random() * 0.07;
      const k = 0.8 + Math.random() * 0.35;
      q.c.setRGB(Math.pow(c[0] * k, 2.2), Math.pow(c[1] * k, 2.2), Math.pow(c[2] * k, 2.2));
    }
  }
  _updateParticles(dt) {
    let n = 0;
    const world = this.game.world;
    for (const q of this.parts) {
      if (q.life <= 0) continue;
      q.life -= dt;
      q.v.y -= 16 * dt;
      q.p.addScaledVector(q.v, dt);
      const id = world.getBlock(Math.floor(q.p.x), Math.floor(q.p.y - q.s / 2), Math.floor(q.p.z));
      if (id > 0 && BLOCKS[id].solid && q.v.y < 0) { q.p.y = Math.floor(q.p.y - q.s / 2) + 1 + q.s / 2; q.v.set(q.v.x * 0.4, 0, q.v.z * 0.4); }
      const s = q.s * Math.min(1, q.life * 3);
      _m.makeScale(s, s, s).setPosition(q.p);
      this.pMesh.setMatrixAt(n, _m); this.pMesh.setColorAt(n, q.c); n++;
    }
    this.pMesh.count = n;
    if (n) { this.pMesh.instanceMatrix.needsUpdate = true; this.pMesh.instanceColor.needsUpdate = true; }
  }

  _updateHands(dt) {
    const g = this.game, input = g.input;
    const stack = g.inventory.selectedStack;
    const id = stack ? stack.id : 0;
    if (id !== this.heldId) {
      if (this.heldObj) { this.heldObj.removeFromParent(); }
      this.heldObj = id ? g.models.create(id) : null;
      if (this.heldObj) {
        const isBlock = id < 256;
        this.heldObj.scale.setScalar(isBlock ? 0.085 : 0.15);
        if (isBlock) { this.heldObj.position.set(0, 0.0, -0.07); this.heldObj.rotation.set(0, 0.6, 0); }
        else { this.heldObj.rotation.set(-0.85, 1.15, -Math.PI / 4, 'YXZ'); this.heldObj.position.set(0, 0.04, -0.05); }
        this.held.add(this.heldObj);
      }
      this.heldId = id;
    }
    const m = input.main, o = input.off;
    this.held.visible = m.present;
    if (m.present) {
      // rig-local pose of the main grip (captured before locomotion moved the rig this frame)
      this.held.position.copy(m.gripPos).applyMatrix4(g.rigInv);
      _q.setFromRotationMatrix(_m.extractRotation(g.rigInv)).multiply(m.gripQuat);
      this.held.quaternion.copy(_q);
      this.swing = Math.max(0, this.swing - dt * 5);
      _e.set(-this.swing * 0.7, 0, 0); this.held.quaternion.multiply(_q.setFromEuler(_e));
      if (this.heldObj?.userData.blockMesh) {
        const L = g.world.getLight(Math.floor(m.gripPos.x), Math.floor(m.gripPos.y), Math.floor(m.gripPos.z), this._lo || (this._lo = { sky: 15, block: 0 }));
        this.heldObj.userData.blockMesh.userData.itemLight = Math.max(Math.pow(0.8, 15 - L.sky), Math.pow(0.8, 15 - L.block) / Math.max(0.2, g.sky.daylight));
      }
    }
    const vr = !input.desktop;
    this._mitten(this.mainMitten, m, vr);
    this._mitten(this.offMitten, o, vr);
  }
  _mitten(mit, hand, vr) {
    mit.visible = vr && hand.present;
    if (!mit.visible) return;
    const g = this.game;
    mit.position.copy(hand.gripPos).applyMatrix4(g.rigInv);
    mit.quaternion.setFromRotationMatrix(_m.extractRotation(g.rigInv)).multiply(hand.gripQuat);
  }

  dispose() {
    for (const o of [this.outline, this.faceTint, this.crack, this.laser, this.pMesh, this.held, this.mainMitten, this.offMitten]) o.removeFromParent();
  }
}
