import * as THREE from 'three';
import { Panel, FONTS, roundRect, fitText } from '../../../../src/platform/kit.js';
import { BLOCKS, HEIGHT } from '../../blocks.js';
import { ITEMS, I } from '../../items.js';
import { foodOf } from './items.js';
import { pouchGeometry, bedrollGeometry } from './models.js';

// Health, hunger, breath; the wrist/HUD readout; damage overlay; eating; death pouch; respawn;
// bedroll + sleeping. State lives on game.survival.vitals and is persisted via 'save'/'load'.

export const MAX_HP = 20, MAX_FOOD = 20, MAX_BREATH = 10;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const INK = 'rgba(24,19,38,0.86)';

export class Vitals {
  constructor(game, sx, fx) {
    this.game = game; this.sx = sx; this.fx = fx;
    this.hp = MAX_HP; this.hunger = MAX_FOOD; this.sat = 5; this.exh = 0; this.breath = MAX_BREATH;
    this.dead = false; this.deathT = 0; this.deathCause = ''; this.deathPos = new THREE.Vector3();
    this.iframe = 0; this.regenT = 0; this.starveT = 0; this.drownT = 0;
    this.hurt = 0; this.eatT = 0; this.munchT = 0;
    this.sleepT = -1; this.sleepDone = false;
    this.spawn = null; this.bed = null; this.pouches = [];
    const scene = game.scene, rig = game.ctx.rig;

    // full-view overlay: red hurt flash, low-health pulse, drowning tint, sleep/death fade
    this.overlayU = { uHurt: { value: 0 }, uLow: { value: 0 }, uDrown: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 }, uDeath: { value: 0 } };
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.overlayU, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uHurt, uLow, uDrown, uFade, uTime, uDeath; varying vec2 vUv;
        void main(){
          float r = length(vUv);
          float edge = smoothstep(0.3, 1.05, r);
          float aR = edge * (uHurt * 0.85 + uLow * (0.22 + 0.14 * sin(uTime * 5.0)));
          float aB = edge * uDrown * 0.55;
          vec3 c = (vec3(0.78, 0.06, 0.16) * aR + vec3(0.08, 0.28, 0.55) * aB) / max(aR + aB, 1e-4);
          float a = clamp(aR + aB, 0.0, 0.92);
          vec3 fc = mix(vec3(0.03, 0.02, 0.06), vec3(0.22, 0.02, 0.06), uDeath);
          c = mix(c, fc, uFade); a = max(a, uFade);
          gl_FragColor = vec4(c, a);
        }`,
    }));
    this.overlay.renderOrder = 1300; this.overlay.frustumCulled = false; this.overlay.visible = false;
    rig.add(this.overlay);

    // HUD: hearts + berries (+ bubbles), wrist in VR, above the hotbar on desktop
    this.hud = new Panel({ width: 0.3, height: 0.05, px: 768, draw: (c, W, H) => this._drawHud(c, W, H) });
    this.hud.mesh.renderOrder = 1501; this.hud.mesh.material.depthTest = false;
    rig.add(this.hud.mesh);
    this._hudKey = -1;

    // death card
    this.deathPanel = new Panel({ width: 0.62, height: 0.3, px: 1024, draw: (c, W, H) => this._drawDeath(c, W, H) });
    this.deathPanel.mesh.renderOrder = 1700; this.deathPanel.mesh.material.depthTest = false; this.deathPanel.mesh.visible = false;
    rig.add(this.deathPanel.mesh);

    // bedroll + pouch meshes
    this.pouchGeo = pouchGeometry();
    this.bedGeo = bedrollGeometry();
    this.propMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.beamGeo = new THREE.CylinderGeometry(0.05, 0.12, 14, 6, 1, true); this.beamGeo.translate(0, 7, 0);
    this.bedMesh = new THREE.Mesh(this.bedGeo, this.propMat); this.bedMesh.visible = false;
    scene.add(this.bedMesh);
  }

  get creative() { return this.game.mode !== 'survival'; }
  get peaceful() { return !!this.game.settings.peaceful; }

  // ── damage / healing ────────────────────────────────────────
  onDamaged(e) {
    if (this.dead || this.creative || this.sleepT >= 0 && e.cause === 'creature') { e.applied = false; return; }
    if (e.cause === 'creature' && this.iframe > 0) { e.applied = false; return; }
    const amount = Math.max(0, +e.amount || 0);
    if (amount <= 0) return;
    e.applied = true;
    this.hp = Math.max(0, this.hp - amount);
    this.iframe = 0.5;
    this.hurt = Math.min(1, 0.45 + amount * 0.12);
    this.exh += 0.1;
    this.sx.hurt();
    const inp = this.game.input;
    inp.main.haptic?.(Math.min(1, 0.5 + amount * 0.1), 90); inp.off.haptic?.(Math.min(1, 0.4 + amount * 0.1), 90);
    if (this.hp <= 0) this.die(e.cause === 'creature' ? (e.source?.name ? `by ${/^[AEIOU]/.test(e.source.name) ? 'an' : 'a'} ${e.source.name}` : 'by a creature') : CAUSES[e.cause] ?? e.cause ?? '');
  }
  heal(n) { if (this.dead) return; this.hp = Math.min(MAX_HP, this.hp + n); }

  die(cause) {
    const g = this.game;
    if (this.dead) return;
    this.dead = true; this.deathT = 0; this.deathCause = cause;
    const p = g.player;
    this.deathPos.set(p.position.x, Math.max(1, p.feetY), p.position.z);
    if (g.ui.modalOpen) g.ui.close();
    // everything you carried goes into a pouch at the spot
    const slots = g.inventory.slots.filter(Boolean).map(s => ({ ...s }));
    if (g.ui.carry) { slots.push({ ...g.ui.carry }); g.ui.carry = null; }
    if (slots.length) {
      let y = Math.floor(this.deathPos.y);
      if (p.feetY < 0 || y < 1) { const s = this.spawn; this.deathPos.set(s.x, s.y, s.z); y = Math.floor(s.y); }
      while (y < HEIGHT - 2 && g.world.isSolid(Math.floor(this.deathPos.x), y, Math.floor(this.deathPos.z))) y++;
      this.addPouch(this.deathPos.x, y + 0.02, this.deathPos.z, slots);
      g.inventory.clear();
    }
    this.sx.death();
    this.deathPanel.markDirty();
    g.events.emit('playerDied', { cause, pos: this.deathPos.clone() });
  }

  respawn() {
    const g = this.game, p = g.player;
    const bedOk = this.bed && this._bedIntact();
    const t = bedOk ? this.bed : this.spawn;
    let y = Math.floor(t.y);
    const x = t.x, z = t.z;
    if (g.world.isLoaded(x, z)) while (y < HEIGHT - 2 && !p._boxFree(x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3)) y++;
    p.teleport(x, y, z);
    if (!g.input.desktop) { /* teleport already re-centres the rig on the head */ }
    this.dead = false; this.hp = MAX_HP; this.hunger = MAX_FOOD; this.sat = 5; this.exh = 0; this.breath = MAX_BREATH;
    this.iframe = 2; this.hurt = 0;
    this.deathPanel.mesh.visible = false;
    this.sx.respawn();
    if (!bedOk && this.bed) { this.bed = null; this.bedMesh.visible = false; g.toast('Your bedroll was lost: woke at the world spawn', 3); }
    else g.toast(bedOk ? 'You wake at your bedroll' : 'You wake at the world spawn', 2.5);
    g.events.emit('playerRespawned', { pos: new THREE.Vector3(x, y, z), bed: !!bedOk });
  }
  _bedIntact() {
    const b = this.bed, w = this.game.world;
    if (!w.isLoaded(b.x, b.z)) return true;
    const below = w.getBlock(Math.floor(b.x), Math.floor(b.y) - 1, Math.floor(b.z));
    return below < 0 || !!BLOCKS[below]?.solid;
  }

  // ── pouches ─────────────────────────────────────────────────
  addPouch(x, y, z, slots) {
    const mesh = new THREE.Mesh(this.pouchGeo, this.propMat);
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    mesh.add(beam);
    mesh.position.set(x, y, z);
    this.game.scene.add(mesh);
    const pouch = { x, y, z, slots, mesh, t: Math.random() * 6 };
    this.pouches.push(pouch);
    return pouch;
  }
  collectPouch(pouch) {
    const g = this.game;
    const left = [];
    for (const s of pouch.slots) {
      const extra = s.dur != null ? { dur: s.dur } : null;
      const n = g.inventory.add(s.id, s.count, extra);
      if (n > 0) left.push({ ...s, count: n });
    }
    pouch.slots = left;
    this.sx.pickup();
    if (!left.length) { pouch.mesh.removeFromParent(); this.pouches.splice(this.pouches.indexOf(pouch), 1); g.toast('Pouch recovered', 2); }
    else g.toast('Pack is full: some things stay in the pouch', 2.5);
  }

  // ── bedroll ─────────────────────────────────────────────────
  placeBed(x, y, z, yaw) {
    this.bed = { x, y, z, yaw };
    this.bedMesh.position.set(x, y, z); this.bedMesh.rotation.set(0, yaw, 0); this.bedMesh.visible = true;
  }
  pickUpBed() {
    if (!this.bed) return;
    const g = this.game;
    this.bed = null; this.bedMesh.visible = false;
    if (g.mode === 'survival') { const left = g.inventory.add(I.bedroll, 1); if (left) g.spawnDrop(I.bedroll, 1, this.bedMesh.position); }
    this.sx.pickup();
    g.toast('Bedroll rolled up: respawn point is the world spawn again', 2.5);
  }
  trySleep() {
    const g = this.game, sky = g.sky;
    if (this.sleepT >= 0 || this.dead) return;
    if (!(sky.time > 0.78 || sky.time < 0.2)) { g.toast('Respawn point set. You can only sleep at night', 2.5); return; }
    const hostiles = g.survival.creatures.nearbyHostiles(g.player.position, 14);
    if (hostiles > 0) { g.toast('You cannot rest: something stirs nearby', 2.5); return; }
    this.sleepT = 0; this.sleepDone = false;
    this.sx.sleep();
  }

  // ── per frame ───────────────────────────────────────────────
  update(dt, time) {
    const g = this.game, input = g.input, p = g.player;
    this.overlayU.uTime.value = time;
    if (this.iframe > 0) this.iframe -= dt;
    const survival = !this.creative;

    if (this.dead) {
      this.deathT += dt;
      p.velocity.set(0, 0, 0);
      const anyKey = input.desktop ? (input.main.triggerDown || input.keyDown('Space') || input.keyDown('Enter')) : (input.main.triggerDown || input.off.triggerDown || input.main.a);
      if (this.deathT > 1.2 && anyKey) this.respawn();
    } else if (survival) {
      // hunger
      if (this.peaceful) {
        this.exh = 0; this.regenT += dt;
        if (this.regenT > 2) { this.regenT = 0; if (this.hp < MAX_HP) this.hp++; else if (this.hunger < MAX_FOOD) this.hunger++; }
      } else {
        const sprint = p.speed > 4.6 * p.scale;
        this.exh += dt / 45 + p.speed * dt * (sprint ? 0.03 : 0.01) / p.scale;
        while (this.exh >= 1) { this.exh -= 1; if (this.sat > 0) this.sat = Math.max(0, this.sat - 1); else this.hunger = Math.max(0, this.hunger - 1); }
        if (this.hunger >= 15 && this.hp < MAX_HP) {
          this.regenT += dt;
          if (this.regenT >= (this.sat > 0 ? 1.6 : 3.2)) { this.regenT = 0; this.hp++; this.exh += 0.4; }
        } else this.regenT = 0;
        if (this.hunger <= 0) { this.starveT += dt; if (this.starveT >= 4) { this.starveT = 0; g.damagePlayer(1, 'starve'); } } else this.starveT = 0;
      }
      // breath
      if (p.headInWater) {
        const b0 = Math.ceil(this.breath);
        this.breath = Math.max(0, this.breath - dt);
        if (Math.ceil(this.breath) !== b0) { this.sx.bubble(); this.fx.burst(_v.copy(input.head.pos).addScaledVector(input.head.fwd, 0.2), 3, { color: 0xd8f4ff, speed: 0.3, up: 1, grav: -3, life: 1.2, size: 0.03 }); }
        if (this.breath <= 0) { this.drownT += dt; if (this.drownT >= 1) { this.drownT = 0; g.damagePlayer(2, 'drown'); } }
      } else { this.breath = Math.min(MAX_BREATH, this.breath + dt * 4); this.drownT = 0; }
      this._eating(dt);
    } else { this.breath = MAX_BREATH; this.eatT = 0; }

    this._sleep(dt);
    this._pouches(dt, time);
    this._overlay(dt);
    this._placeHud();
  }

  _eating(dt) {
    const g = this.game, input = g.input, inv = g.inventory;
    const stack = inv.selectedStack, food = foodOf(stack);
    let want = false;
    if (food && !g.ui.modalOpen) {
      const hungry = this.hunger < MAX_FOOD || food.always || (food.heal && this.hp < MAX_HP);
      if (input.desktop) want = input.main.squeeze > 0.5;
      else {
        const h = input.head;
        _v.copy(h.pos).addScaledVector(h.up, -0.08).addScaledVector(h.fwd, 0.04);
        want = input.main.present && input.main.gripPos.distanceTo(_v) < 0.2;
      }
      if (want && !hungry) { if (!this._fullToast) { g.toast('You are full', 1.2); this._fullToast = true; } want = false; }
    }
    if (!want) { this.eatT = 0; this.munchT = 0; this._fullToast = false; return; }
    this.eatT += dt;
    if ((this.munchT -= dt) <= 0) {
      this.munchT = 0.26;
      this.sx.munch();
      const h = input.head;
      _v.copy(h.pos).addScaledVector(h.fwd, 0.18).addScaledVector(h.up, -0.1);
      this.fx.burst(_v, 4, { colors: CRUMBS[ITEMS[stack.id]?.key] ?? [0xf3e6cf, 0xe48a80, 0xffd27a], speed: 0.8, life: 0.5, size: 0.025, grav: 8 });
      input.main.haptic?.(0.25, 30);
      if (g.interact) g.interact.swing = Math.max(g.interact.swing, 0.35);
    }
    if (this.eatT >= 1.05) {
      this.eatT = 0;
      inv.takeFromSlot(inv.selected, 1);
      this.hunger = Math.min(MAX_FOOD, this.hunger + (food.hunger ?? 0));
      this.sat = Math.min(this.hunger, this.sat + (food.saturation ?? 0));
      if (food.heal) this.heal(food.heal);
      this.sx.gulp();
      g.events.emit('playerAte', { id: stack.id, food });
    }
  }

  _sleep(dt) {
    if (this.sleepT < 0) { if (this.overlayU.uDeath.value === 0 && !this.dead) this.fade = Math.max(0, (this.fade ?? 0) - dt * 2); return; }
    const g = this.game;
    this.sleepT += dt;
    if (this.sleepT < 1.2) this.fade = this.sleepT / 1.2;
    else if (!this.sleepDone) {
      this.sleepDone = true;
      const sky = g.sky;
      if (sky.time > 0.5) sky.day++;
      sky.setTime(0.235);
      this.heal(6); this.exh += 1.5;
      if (this.bed) g.player.teleport(this.bed.x, this.bed.y, this.bed.z);
      for (const c of [...g.survival.creatures.list]) if (c.k.temper === 'hostile') g.survival.creatures.remove(c);
      g.events.emit('playerSlept', { day: sky.day });
      g.save();
    } else if (this.sleepT < 2.2) this.fade = 1;
    else { this.fade = Math.max(0, 1 - (this.sleepT - 2.2) / 1.5); if (this.fade <= 0) { this.sleepT = -1; g.toast(`Morning of day ${g.sky.day + 1}`, 2.5); } }
  }

  _pouches(dt, time) {
    const g = this.game, p = g.player;
    for (let i = this.pouches.length - 1; i >= 0; i--) {
      const pc = this.pouches[i];
      pc.mesh.rotation.y = time * 0.8 + pc.t;
      pc.mesh.position.y = pc.y + Math.sin(time * 2 + pc.t) * 0.04;
      if (!this.dead && g.mode === 'survival') {
        const dx = p.position.x - pc.x, dz = p.position.z - pc.z, dy = p.feetY + 0.5 - pc.y;
        if (dx * dx + dz * dz < 1.6 * 1.6 && Math.abs(dy) < 2 && (pc.cool ?? 0) <= time) { pc.cool = time + 3; this.collectPouch(pc); }
      }
    }
  }

  _overlay(dt) {
    const U = this.overlayU, g = this.game;
    this.hurt = Math.max(0, this.hurt - dt * 2.2);
    U.uHurt.value = this.hurt;
    U.uLow.value += (((!this.dead && !this.creative && this.hp <= 6) ? (7 - this.hp) / 6 : 0) - U.uLow.value) * Math.min(1, dt * 3);
    U.uDrown.value += ((g.player.headInWater && this.breath < 3 && !this.creative ? 1 - this.breath / 3 : 0) - U.uDrown.value) * Math.min(1, dt * 3);
    let fade = this.fade ?? 0;
    if (this.dead) { fade = Math.min(0.8, this.deathT * 1.2); U.uDeath.value = 1; } else if (this.sleepT < 0) U.uDeath.value = Math.max(0, U.uDeath.value - dt * 2);
    U.uFade.value = fade;
    const vis = U.uHurt.value > 0.01 || U.uLow.value > 0.01 || U.uDrown.value > 0.01 || fade > 0.01;
    this.overlay.visible = vis;
    if (vis) {
      const cam = g.ctx.camera;
      this.overlay.position.copy(cam.position); this.overlay.quaternion.copy(cam.quaternion); this.overlay.translateZ(-0.25);
    }
    // death card
    const dp = this.deathPanel.mesh;
    dp.visible = this.dead && this.deathT > 0.6;
    if (dp.visible) {
      const cam = g.ctx.camera;
      dp.position.copy(cam.position); dp.quaternion.copy(cam.quaternion);
      dp.translateZ(g.input.desktop ? -0.62 : -0.9); dp.translateY(g.input.desktop ? 0.02 : -0.05);
      if (this.deathT > 1.2 && !this._readyDrawn) { this._readyDrawn = true; this.deathPanel.markDirty(); }
      this.deathPanel.redraw();
    } else this._readyDrawn = false;
  }

  _placeHud() {
    const g = this.game, input = g.input, hb = this.hud.mesh, cam = g.ctx.camera;
    const show = !this.creative && !this.dead;
    if (input.desktop) {
      hb.visible = show && !g.ui.modalOpen;
      hb.position.copy(cam.position); hb.quaternion.copy(cam.quaternion);
      hb.translateY(-0.142); hb.translateZ(-0.5); hb.scale.setScalar(0.92);
    } else {
      const o = input.off;
      hb.visible = show && o.present;
      if (hb.visible) {
        hb.position.copy(o.gripPos).applyMatrix4(g.rigInv);
        _q.setFromRotationMatrix(_m.extractRotation(g.rigInv)).multiply(o.gripQuat);
        _v.set(0, 0.118, 0.05).applyQuaternion(_q); hb.position.add(_v);
        hb.scale.setScalar(0.85);
        cam.getWorldPosition(_w); hb.lookAt(_w);
      }
    }
    if (!hb.visible) return;
    const key = Math.ceil(this.hp) * 1e6 + Math.ceil(this.hunger) * 1e4 + Math.ceil(this.breath) * 100 + (this.hurt > 0.3 ? 1 : 0) + (this.hp <= 6 ? 2 : 0);
    if (key !== this._hudKey) { this._hudKey = key; this.hud.markDirty(); }
    this.hud.redraw();
  }

  _drawHud(c, W, H) {
    const rowY = H - 36, size = 30;
    c.fillStyle = INK; roundRect(c, 6, rowY - 26, W - 12, 52, 22); c.fill();
    const hp = this.hp, food = this.hunger;
    for (let i = 0; i < 10; i++) {
      const x = 30 + i * 34, v = Math.max(0, Math.min(2, hp - i * 2));
      heart(c, x, rowY, size, v, this.hurt > 0.3);
    }
    for (let i = 0; i < 10; i++) {
      const x = W - 30 - i * 34, v = Math.max(0, Math.min(2, food - i * 2));
      berry(c, x, rowY, size, v);
    }
    if (this.breath < MAX_BREATH) {
      c.fillStyle = INK; roundRect(c, W - 360, 4, 354, 46, 20); c.fill();
      const n = Math.ceil(this.breath);
      for (let i = 0; i < 10; i++) bubble(c, W - 30 - i * 34, 27, 24, i < n);
    }
  }
  _drawDeath(c, W, H) {
    c.fillStyle = 'rgba(24,10,24,0.92)'; roundRect(c, 6, 6, W - 12, H - 12, 36); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#e58f9f'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffd27a'; c.font = `800 70px ${FONTS.sans}`; c.fillText('You were felled', W / 2, 110);
    c.fillStyle = '#f3e6cf'; fitText(c, this.deathCause ? `(${this.deathCause})` : '', W / 2, 200, W - 80, 44, FONTS.sans);
    c.fillStyle = '#b9aed0'; fitText(c, this.pouches.length ? 'Your belongings wait in a pouch where you fell.' : '', W / 2, 280, W - 80, 36, FONTS.sans);
    const ready = this.deathT > 1.2;
    c.fillStyle = ready ? '#7fb685' : '#6f6390';
    roundRect(c, 70, 340, W - 140, 100, 30); c.fill();
    c.fillStyle = '#f8f1e3';
    const where = this.bed ? 'at your bedroll' : 'at the world spawn';
    fitText(c, this.game.input.desktop ? `Click or Space: wake ${where}` : `Pull the trigger: wake ${where}`, W / 2, 392, W - 200, 44, FONTS.sans);
  }

  // ── save / load ─────────────────────────────────────────────
  toJSON() {
    return {
      hp: this.dead ? MAX_HP : this.hp, hunger: this.dead ? MAX_FOOD : this.hunger, sat: this.sat, exh: this.exh,
      spawn: this.spawn, bed: this.bed,
      pouches: this.pouches.map(p => ({ x: p.x, y: p.y, z: p.z, slots: p.slots })),
    };
  }
  load(o) {
    if (!o) return;
    const num = (v, d) => Number.isFinite(v) ? v : d;
    this.hp = Math.max(1, Math.min(MAX_HP, num(o.hp, MAX_HP)));
    this.hunger = Math.max(0, Math.min(MAX_FOOD, num(o.hunger, MAX_FOOD)));
    this.sat = num(o.sat, 5); this.exh = num(o.exh, 0);
    if (o.spawn && Number.isFinite(o.spawn.x)) this.spawn = o.spawn;
    if (o.bed && Number.isFinite(o.bed.x)) this.placeBed(o.bed.x, o.bed.y, o.bed.z, o.bed.yaw ?? 0);
    for (const p of o.pouches ?? []) if (Number.isFinite(p.x) && Array.isArray(p.slots)) this.addPouch(p.x, p.y, p.z, p.slots.filter(s => s && ITEMS[s.id]));
  }

  dispose() {
    for (const m of [this.overlay, this.hud.mesh, this.deathPanel.mesh, this.bedMesh]) m.removeFromParent();
    for (const p of this.pouches) p.mesh.removeFromParent();
    this.pouchGeo.dispose(); this.bedGeo.dispose(); this.beamGeo.dispose(); this.propMat.dispose(); this.beamMat.dispose();
    this.hud.tex.dispose(); this.deathPanel.tex.dispose();
  }
}

const CAUSES = { fall: 'a long fall', starve: 'hunger', drown: 'drowned', void: 'the void', unknown: '' };
const CRUMBS = {
  dewberry: [0x7a74d0, 0xa9a8ec, 0xeef0ff], plumfruit: [0x9e6bb8, 0xc79ad6, 0xfbe3d6], glimmerfin: [0x6cc9c0, 0xf6d77a],
  wyrm_heart: [0xffb38a, 0xc23a5a, 0xfff1d6],
};

// ── HUD icons ───────────────────────────────────────────────
function heart(c, x, y, s, v, flash) {
  const path = () => {
    c.beginPath();
    const k = s / 30;
    c.moveTo(x, y + 11 * k);
    c.bezierCurveTo(x - 16 * k, y + 1 * k, x - 14 * k, y - 13 * k, x - 6 * k, y - 11 * k);
    c.bezierCurveTo(x - 2 * k, y - 10 * k, x, y - 7 * k, x, y - 6 * k);
    c.bezierCurveTo(x, y - 7 * k, x + 2 * k, y - 10 * k, x + 6 * k, y - 11 * k);
    c.bezierCurveTo(x + 14 * k, y - 13 * k, x + 16 * k, y + 1 * k, x, y + 11 * k);
    c.closePath();
  };
  path(); c.fillStyle = '#3d2a44'; c.fill();
  if (v > 0) {
    c.save(); path(); c.clip();
    c.fillStyle = flash ? '#fff0f0' : '#e8607a';
    c.fillRect(x - s / 2 - 2, y - s / 2 - 2, v >= 2 ? s + 4 : (s + 4) / 2, s + 4);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(x - 9 * s / 30, y - 8 * s / 30, 4 * s / 30, 4 * s / 30);
    c.restore();
  }
  path(); c.lineWidth = 2.5; c.strokeStyle = '#1d1830'; c.stroke();
}
function berry(c, x, y, s, v) {
  const r = s * 0.36;
  const circ = () => { c.beginPath(); c.arc(x, y + 2, r, 0, Math.PI * 2); };
  circ(); c.fillStyle = '#3a3346'; c.fill();
  if (v > 0) {
    c.save(); circ(); c.clip();
    c.fillStyle = '#f0a54f';
    c.fillRect(x - r - 2, y + 2 - r - 2, v >= 2 ? 2 * r + 4 : r + 2, 2 * r + 4);
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.arc(x - r * 0.35, y + 2 - r * 0.35, r * 0.25, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  circ(); c.lineWidth = 2.5; c.strokeStyle = '#1d1830'; c.stroke();
  c.fillStyle = '#7fb685'; c.beginPath(); c.ellipse(x + 3, y - r + 1, 6, 3, -0.5, 0, Math.PI * 2); c.fill();
}
function bubble(c, x, y, s, on) {
  c.beginPath(); c.arc(x, y, s * 0.4, 0, Math.PI * 2);
  c.fillStyle = on ? 'rgba(170,225,255,0.9)' : 'rgba(80,90,120,0.4)'; c.fill();
  c.lineWidth = 2; c.strokeStyle = '#1d1830'; c.stroke();
  if (on) { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(x - 3, y - 3, 2.5, 0, Math.PI * 2); c.fill(); }
}
