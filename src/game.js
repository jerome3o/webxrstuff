import * as THREE from 'three';
import { CFG, SHOP, COMBO_WORDS } from './config.js';
import { audio } from './audio.js';
import { rand, pick, loadSave, writeSave, damp } from './util.js';
import {
  RingTarget, HangingLantern, SkyLantern, Gong, Vase, Coin, WillowLeaf, FuPlaque, DragonKite, SupplyCrate, CraneTarget,
} from './targets.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Game {
  constructor({ scene, physics, fx, ui, env }) {
    Object.assign(this, { scene, physics, fx, ui, env });
    this.time = 0;
    this.timeScale = 1;
    this._slowmoReq = false;
    this.playerPos = new THREE.Vector3(0, 1.6, 0);
    this.playerFwd = new THREE.Vector3(0, 0, -1);
    this.projectiles = [];
    this.stuck = [];
    this.targets = [];
    this.wind = new THREE.Vector3(1.2, 0, 0);
    this.windTarget = this.wind.clone();
    this.windTimer = 0;
    this.listeners = new Set();

    const save = loadSave() ?? {};
    this.coins = save.coins ?? 0;
    this.owned = new Set(save.owned ?? []);
    this.skin = save.skin ?? 'default';
    this.best = save.best ?? 0;
    this.settings = { music: save.music ?? true, leftHanded: save.leftHanded ?? false };
    this.ammo = {};
    for (const id of CFG.weaponOrder) this.ammo[id] = save.ammo?.[id] ?? CFG.weapons[id].ammoStart;
    this.ammo.pistol = Infinity;

    this.score = 0; this.combo = 0; this.maxCombo = 0; this.shots = 0; this.hitShots = 0;
    this._coinFrac = 0;
    this.roundActive = false; this.roundTime = 0; this.lastRound = null;
    this._hintCool = 0;
    this._spawn = { sky: 2, crate: 1, fu: 8, dragon: 45 };
    this._scoredShots = new Set();
    this._shotCount = new Set();
  }

  // Simple change notification for HUD panels.
  onChange(fn) { this.listeners.add(fn); }
  emit() { for (const f of this.listeners) f(); }

  // ── Setup ───────────────────────────────────────────────────
  populate() {
    const ring = (x, y, z, r, opts) => this.addTarget(new RingTarget(this, new THREE.Vector3(x, y, z), r, opts));
    ring(-3, 1.25, -10, 0.6);
    ring(2.8, 1.3, -20, 0.7);
    ring(-1.5, 1.4, -35, 0.8, { slide: { amp: 4.5, speed: 0.6 } });
    ring(4.5, 1.5, -50, 0.9);
    ring(0, 1.8, -70, 1.2, { slide: { amp: 6, speed: 0.35 } });
    ring(-8, 1.6, -86, 1.0);
    for (const t of this.targets) t.group.rotation.y = Math.atan2(-t.group.position.x, -t.group.position.z) * 0.6;

    // Lantern lines strung across the range
    const ropeMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1a });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.6 });
    for (const [z, y, step] of [[-15, 6.2, 4], [-28, 7, 5], [-44, 7.5, 6]]) {
      for (const x of [-15, 15]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, y + 0.2, 8), postMat);
        post.position.set(x, (y + 0.2) / 2, z); this.env.root.add(post);
      }
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 30, 4), ropeMat);
      rope.rotation.z = Math.PI / 2; rope.position.set(0, y, z); this.env.root.add(rope);
      for (let x = -12; x <= 12.01; x += step) this.addTarget(new HangingLantern(this, new THREE.Vector3(x, y, z), rand(0.6, 1.3)));
    }
    this.gong = this.addTarget(new Gong(this, new THREE.Vector3(3.8, 0, -13)));
    this.gong.group.rotation.y = Math.atan2(-3.8, 13);
    for (const z of [-18, -40, -62]) for (const x of [-13, 13]) this.addTarget(new Vase(this, new THREE.Vector3(x, 0, z)));
    this.addTarget(new Coin(this, new THREE.Vector3(-6, 4.2, -32)));
    this.addTarget(new WillowLeaf(this, this.env.willow));
    for (const c of this.env.cranes) this.addTarget(new CraneTarget(this, c));
  }

  addTarget(t) { this.targets.push(t); return t; }

  // ── Projectiles ─────────────────────────────────────────────
  spawnProjectile(p) {
    this.scene.add(p.mesh);
    this.projectiles.push(p);
    if (p.kind !== 'pistol') { this.shots++; this._shotCount.add(p.shotId); }
  }

  registerStuck(p) {
    this.stuck.push(p);
    while (this.stuck.length > CFG.maxStuckProjectiles) this.stuck.shift().kill();
  }
  dropStuckOn(target) {
    this.stuck = this.stuck.filter(p => { if (p.attachedTo === target) { p.kill(); return false; } return true; });
  }

  onProjectileHit(proj, hit) {
    if (proj.kind === 'rocket') { this.explode(hit.point, CFG.weapons.rocket.blastRadius, proj); return 'die'; }
    const owner = hit.collider?.owner;
    if (owner) {
      const res = owner.onHit(hit, proj) ?? { response: 'stick' };
      this.applyResult(res, hit.point, proj, owner);
      if (proj.fire && proj.kind === 'arrow' && (res.response === 'stick' || res.response === 'bounce')) this.explode(hit.point, 2.5, proj, true);
      if (proj.kind !== 'arrow' && res.response === 'stick') return 'die';
      return res.response;
    }
    // Environment / ground
    const mat = hit.material ?? 'stone';
    audio.impact(mat, hit.point, 0.8);
    if (mat === 'ground') this.fx.dust(hit.point); else this.fx.splinters(hit.point, mat === 'stone' ? 0x9a9488 : 0xd9c79a);
    if (proj.kind !== 'arrow') { this.fx.sparks(hit.point, 0xffd080, 6, 2); }
    if (proj.fire && proj.kind === 'arrow') this.explode(hit.point, 2.5, proj, true);
    if (proj.kind === 'arrow') return hit.ground || mat === 'wood' ? 'stick' : (proj.vel.length() > 30 && Math.random() < 0.5 ? 'stick' : 'bounce');
    return 'die';
  }

  onProjectilePass(proj, collider) {
    const owner = collider.owner;
    if (!owner?.onPass) return;
    const res = owner.onPass(proj);
    if (res) this.applyResult(res, collider.object.getWorldPosition(new THREE.Vector3()), proj, owner);
  }

  explode(pos, radius, proj, small = false) {
    this.fx.explosion(pos, small ? radius * 0.6 : radius);
    audio.explosion(pos, small ? 0.5 : 1);
    const owners = this.physics.overlapOwners(pos, radius);
    let n = 0;
    for (const [owner, info] of owners) {
      if (!owner.alive || owner.active === false) continue;
      const res = owner.onBlast({ point: info.point, collider: info.collider, dist: info.dist });
      if (res) { this.applyResult(res, info.point, proj, owner, true); if (res.points > 0) n++; }
    }
    if (n >= 3) this._feat(pos, `${n} 连爆!`, `${n}-target blast`, n * 10);
  }

  applyResult(res, pos, proj, owner, blast = false) {
    if (!res) return;
    let pts = res.points ?? 0;
    if (pts > 0 && proj) {
      const d = pos.distanceTo(this.playerPos);
      const distMult = proj.kind === 'arrow' ? 1 + d / 30 : proj.kind === 'sniper' ? 1 + d / 90 : proj.kind === 'pistol' ? 0.5 : 1;
      pts = Math.round(pts * distMult * this.comboMult());
    }
    if (pts !== 0 || res.label) {
      if (!res.noCombo && pts > 0 && proj && proj.kind !== 'pistol') {
        if (!this._scoredShots.has(proj.shotId)) { this._scoredShots.add(proj.shotId); this.hitShots++; }
        proj.scored = true;
        this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
        const word = COMBO_WORDS.find(w => w.at === this.combo);
        if (word) { audio.comboChime(COMBO_WORDS.indexOf(word)); this.ui.popup(pos.clone().add(new THREE.Vector3(0, 1.2, 0)), word.cn, `${this.combo} combo · ${word.en}`, '#ffd56a', true); }
      }
      if (res.penalty) { this.combo = 0; }
      if (proj && pts !== 0) proj.scored = proj.scored || pts > 0;
      this.score = Math.max(0, this.score + pts);
      if (res.label) this.ui.popup(pos, res.label, pts > 0 ? `+${pts}${res.sub ? ' · ' + res.sub : ''}` : pts < 0 ? `${pts} · ${res.sub ?? ''}` : (res.sub ?? ''), res.color ?? '#ffffff', !!res.big);
      // coins
      const rate = this.roundActive ? CFG.roundTokenRate : CFG.freePlayTokenRate;
      this._coinFrac += Math.max(0, pts) * rate;
      const whole = Math.floor(this._coinFrac);
      this._coinFrac -= whole;
      const coins = whole + (res.coins ?? 0);
      if (coins > 0) { this.coins += coins; if (res.coins) { audio.coin(0.15); this.fx.coinBurst(pos); } }
      this.emit();
      this.persist();
    }
  }

  _feat(pos, label, sub, pts) {
    this.score += pts;
    this.ui.popup(pos.clone().add(new THREE.Vector3(0, 2, 0)), label, `+${pts} · ${sub}`, '#ffb070', true);
  }

  comboMult() { return Math.min(CFG.comboMaxMult, 1 + Math.floor(this.combo / CFG.comboStep) * 0.5); }
  accuracy() { return this.shots ? Math.round(100 * this.hitShots / this.shots) : 0; }

  onMiss(proj) {
    if (proj.kind === 'pistol') return;
    if (this._scoredShots.has(proj.shotId)) return;
    if (this.combo >= 5) this.ui.popup(proj.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), '断了', `combo broken at ${this.combo}`, '#c0a080');
    this.combo = 0;
    this.emit();
  }

  // ── Ammo & shop ─────────────────────────────────────────────
  ammoMax(id) {
    const base = CFG.weapons[id].ammoMax;
    if (id === 'bow' && this.has('quiver')) return base + 15;
    if (id === 'rocket' && this.has('powder')) return base + 4;
    if (id === 'sniper' && this.has('bandolier')) return base + 5;
    return base;
  }
  spendAmmo(id) {
    if (this.ammo[id] !== Infinity) this.ammo[id] = Math.max(0, this.ammo[id] - 1);
    const left = this.ammo[id];
    if (left === 3 || left === 1) { this._hintCool = 0; this.hint(`${CFG.weapons[id].cn} 还剩 ${left}`, `${left} left · hand cannon + glowing crates = more ammo`); }
    this.emit(); this.persist();
  }
  giveAmmo(id, n) {
    const before = this.ammo[id];
    this.ammo[id] = Math.min(this.ammoMax(id), before + n);
    this.emit(); this.persist();
    return this.ammo[id] - before;
  }
  toastAmmo(id) {
    const W = CFG.weapons[id];
    this._hintCool = 0;
    this.hint(`${W.cn} 没弹药了`, `${W.en} empty · switched to 手铳 · shoot the glowing crates`);
  }
  has(id) { return this.owned.has(id); }
  buy(item) {
    if (this.owned.has(item.id)) { if (item.skin) this.setSkin(item.skin); return; }
    if (this.coins < item.price) { audio.penalty(); this.hint('铜钱不够', `Need ${item.price - this.coins} more coins`); return; }
    this.coins -= item.price;
    this.owned.add(item.id);
    for (let i = 0; i < 6; i++) audio.coin(i * 0.05);
    if (item.skin) this.setSkin(item.skin);
    this.emit(); this.persist();
  }
  setSkin(s) { this.skin = s; this.onSkin?.(s); this.emit(); this.persist(); }

  persist() {
    const ammo = {}; for (const id of ['bow', 'rocket', 'sniper']) ammo[id] = this.ammo[id];
    writeSave({ coins: this.coins, owned: [...this.owned], skin: this.skin, best: this.best, music: this.settings.music, leftHanded: this.settings.leftHanded, ammo });
  }

  hint(cn, en) {
    if (this._hintCool > 0) return;
    this._hintCool = 2.5;
    const p = this.playerPos.clone().addScaledVector(this.playerFwd, 2.2); p.y = this.playerPos.y - 0.2;
    this.ui.popup(p, cn, en, '#ffe0a0');
  }

  onWeaponChanged() { this.emit(); }
  requestSlowmo() { this._slowmoReq = true; }
  kick() { }

  // ── Rounds: 一炷香, as long as a stick of incense ───────────
  onGong() {
    if (this.roundActive) return;
    this.startRound();
  }
  startRound() {
    this.roundActive = true;
    this.roundTime = CFG.roundSeconds;
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.shots = 0; this.hitShots = 0;
    this._scoredShots.clear();
    this._roundEvents = { dragon1: false, dragon2: false };
    audio.roundStart();
    this.gong.setLabel('一炷香', 'yì zhù xiāng · round on');
    const p = this.playerPos.clone().addScaledVector(this.playerFwd, 4); p.y += 0.6;
    this.ui.popup(p, '开始!', `${CFG.roundSeconds} seconds · one stick of incense`, '#ffd56a', true);
    // Top up a little so the round always starts playable
    this.ammo.bow = Math.max(this.ammo.bow, 12); this.ammo.rocket = Math.max(this.ammo.rocket, 2); this.ammo.sniper = Math.max(this.ammo.sniper, 3);
    this.emit();
  }
  endRound() {
    this.roundActive = false;
    const newBest = this.score > this.best;
    if (newBest) this.best = this.score;
    const bonus = Math.round(this.score * 0.05) + this.maxCombo;
    this.coins += bonus;
    this.lastRound = { score: this.score, best: this.best, newBest, combo: this.maxCombo, acc: this.accuracy(), bonus };
    audio.roundEnd();
    this.gong.setLabel('再来', 'zài lái · again');
    const p = this.playerPos.clone().addScaledVector(this.playerFwd, 5); p.y += 1;
    this.ui.popup(p, newBest ? '新纪录!' : '结束', `${this.score} points · +${bonus} coins`, '#ffd56a', true);
    for (let i = 0; i < (newBest ? 12 : 5); i++) setTimeout(() => {
      const fp = new THREE.Vector3(rand(-25, 25), rand(25, 45), rand(-40, -90));
      this.fx.firework(fp); audio.fireworkBoom(fp);
    }, i * 350);
    this.emit(); this.persist();
  }

  // ── Main update ────────────────────────────────────────────
  update(dt, realDt) {
    this.time += dt;
    this._hintCool -= realDt;
    // Slow-motion focus eases in/out
    this.timeScale = damp(this.timeScale, this._slowmoReq ? 0.35 : 1, 6, realDt);
    this._slowmoReq = false;

    // Wind wanders every ~15–25 s
    this.windTimer -= dt;
    if (this.windTimer <= 0) {
      this.windTimer = rand(15, 25);
      const a = rand(0, Math.PI * 2), s = rand(0, this.roundActive ? 4.5 : 3);
      this.windTarget.set(Math.cos(a) * s, 0, Math.sin(a) * s);
    }
    this.wind.lerp(this.windTarget, 1 - Math.exp(-0.3 * dt));
    audio.setWind(this.wind.length());

    // Projectiles with sub-stepping so fast shots stay accurate
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (const p of this.projectiles) {
      const before = p.state;
      for (let i = 0; i < steps && p.state === 'flying'; i++) {
        p.step(h, this.physics, this);
        if (p.state === 'flying' && p.kind === 'rocket' && i === 0) {
          const back = p.pos.clone().addScaledVector(p.vel.clone().normalize(), -0.6);
          if (p.age < CFG.weapons.rocket.burnTime) { this.fx.flame(back, p.vel.clone().multiplyScalar(-0.2)); if (Math.random() < 0.6) this.fx.smoke(back, 0.25); }
        }
      }
      if (p.state === 'flying') {
        if (p.fire) this.fx.flame(p.pos);
        else if (p.kind === 'arrow' && Math.random() < 0.5) this.fx.trail(p.pos, 0xfff2d0, 0.02, 0.25);
        if (p.kind === 'sniper') this.fx.trail(p.pos, 0xfff1c0, 0.05, 0.5);
      }
      if (p.state === 'stuck') p.step(dt, this.physics, this);
      if (before === 'flying' && p.state !== 'flying' && !p.scored) this.onMiss(p);
    }
    this.projectiles = this.projectiles.filter(p => p.state !== 'dead' && !(p.state === 'stuck' && !this.stuck.includes(p)));

    for (const t of this.targets) if (t.alive) t.update(dt, this.time);
    this.targets = this.targets.filter(t => t.alive);

    this._spawner(dt);

    if (this.roundActive) {
      this.roundTime -= dt;
      this.env.incense.set(Math.max(0, this.roundTime / CFG.roundSeconds));
      if (Math.random() < 0.5) this.fx.smoke(this.env.incense.tipWorld(new THREE.Vector3()), 0.03, new THREE.Vector3(this.wind.x * 0.05, 0.2, this.wind.z * 0.05));
      if (this.roundTime <= 0) this.endRound();
    } else {
      this.env.incense.set(1);
      if (Math.random() < 0.2) this.fx.smoke(this.env.incense.tipWorld(new THREE.Vector3()), 0.03, new THREE.Vector3(0, 0.2, 0));
    }
    this.fx.update(dt);
  }

  _count(kind) { let n = 0; for (const t of this.targets) if (t.kind === kind && t.alive) n++; return n; }

  _spawner(dt) {
    const S = this._spawn;
    for (const k in S) S[k] -= dt;
    const R = this.roundActive, rt = CFG.roundSeconds - this.roundTime;

    // Supply crates keep the ammo economy flowing.
    if (S.crate <= 0) {
      S.crate = CFG.crates.respawn;
      if (this._count('crate') < CFG.crates.maxAlive) {
        // Prefer the ammo type you're lowest on
        const need = ['bow', 'rocket', 'sniper'].map(id => ({ id, f: this.ammo[id] / this.ammoMax(id) + Math.random() * 0.5 }));
        need.sort((a, b) => a.f - b.f);
        const pos = new THREE.Vector3(rand(-10, 10), rand(1.8, 5), rand(-9, -38));
        this.addTarget(new SupplyCrate(this, pos, need[0].id));
      }
    }
    // Sky lanterns
    const skyEvery = !R ? 6 : rt < 30 ? 2.5 : rt < 60 ? 4 : 1.2;
    if (S.sky <= 0) {
      S.sky = skyEvery * rand(0.7, 1.3);
      if (this._count('skylantern') < (R ? 14 : 5)) this.addTarget(new SkyLantern(this, new THREE.Vector3(rand(-30, 30), 0.5, rand(-50, -110))));
    }
    // 福 plaques
    const fuEvery = !R ? 14 : rt < 30 ? 6 : rt < 60 ? 3 : 5;
    if (S.fu <= 0) {
      S.fu = fuEvery * rand(0.7, 1.3);
      if (this._count('fu') < (R ? 5 : 2)) this.addTarget(new FuPlaque(this, new THREE.Vector3(rand(-10, 10), rand(2, 6), rand(-14, -45)), R ? 12 : 20));
    }
    // Dragon kites: scripted in rounds, occasional in free play
    if (R) {
      if (!this._roundEvents.dragon1 && rt > 35) { this._roundEvents.dragon1 = true; this._dragon(); }
      if (!this._roundEvents.dragon2 && rt > 62) { this._roundEvents.dragon2 = true; this._dragon(); }
    } else if (S.dragon <= 0) {
      S.dragon = rand(60, 100);
      if (this._count('dragon') === 0) this._dragon();
    }
  }
  _dragon() {
    this.addTarget(new DragonKite(this, 40));
    this.ui.popup(this.playerPos.clone().addScaledVector(this.playerFwd, 6).add(new THREE.Vector3(0, 2.5, 0)), '龙来了!', 'lóng lái le · the dragon kite is up', '#ff7050', true);
    audio.firecrackers(null, 12);
  }
}
