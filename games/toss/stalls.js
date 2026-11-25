import * as THREE from 'three';
import { Panel, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { Body, SPHERE, BOX, CYL, TORUS, CUP } from './physics.js';
import { Frame, Builder } from './env.js';
import { Operator } from './npc.js';
import { PropSet } from './props.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);
const _m4 = new THREE.Matrix4();

// Static collider box in a stall frame (local centre, size, optional local rotation).
export function staticBox(game, frame, cx, cy, cz, sx, sy, sz, { rx = 0, ry = 0, rz = 0, restitution = 0.25, friction = 0.6, tag = '' } = {}) {
  const b = new Body({ kind: BOX, hx: sx / 2, hy: sy / 2, hz: sz / 2 }, { restitution, friction, tag });
  frame.toWorld(cx, cy, cz, b.pos); frame.quat(rx, ry, rz, b.quat);
  game.world.add(b);
  return b;
}
export function staticShape(game, frame, shape, cx, cy, cz, opts = {}) {
  const b = new Body(shape, { restitution: opts.restitution ?? 0.25, friction: opts.friction ?? 0.6, tag: opts.tag ?? '' });
  frame.toWorld(cx, cy, cz, b.pos); frame.quat(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0, b.quat);
  game.world.add(b);
  return b;
}

// ── Base stall ───────────────────────────────────────────────
export class Stall {
  constructor(game, o) {
    this.game = game;
    this.id = o.id; this.name = o.name; this.cn = o.cn; this.rules = o.rules;
    this.color = o.color; this.accent = o.accent ?? 0xe2b85c;
    this.frame = new Frame(o.x, o.z, o.yaw);
    this.projectiles = [];
    this.state = 'idle'; this.stateT = 0; this.settleT = 0; this.lastThrowT = -99;
    this.message = o.intro ?? 'Step right up!';
    this.best = game.data.best?.[this.id] ?? 0;
    this.lastTickets = 0;
    this.playZ = o.playZ ?? -0.5;
    this.assistSpeed = true;
    this.lines = o.lines ?? ['Step right up!'];
    this.barkT = 4 + Math.random() * 6;
    this.targetsOut = [];
    this.buildBooth(o);
    this.buildPanel();
    this.operator = new Operator(game.scene, this.frame, o.opX ?? -1.25, o.opZ ?? -0.85, o.op ?? {}, game.mats.figure);
    this.stripT = 0; this.stripN = 0;
    this.strip = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1), game.mats.ticket);
    this.strip.geometry.translate(0, -0.5, 0);
    this.strip.visible = false;
    this.frame.toWorld(o.stripX ?? -1.0, 0.98, 0.03, this.strip.position);
    this.strip.quaternion.copy(this.frame.q);
    game.scene.add(this.strip);
  }

  // Counter, walls, canopy, sign, lamps
  buildBooth(o) {
    const g = this.game, F = this.frame.m, L = g.lit, fr = this.frame;
    const wood = 0x6a4128, dark = 0x3a2416, cloth = this.color, accent = this.accent;
    // floor deck
    L.box(F, 0, 0.006, -2.2, 3.8, 0.012, 4.6, 0x4a3426);
    // side & back walls (cloth over wood)
    for (const sx of [-1, 1]) {
      L.box(F, sx * 1.9, 1.3, -2.15, 0.08, 2.6, 4.7, cloth);
      L.box(F, sx * 1.86, 0.45, -2.15, 0.02, 0.9, 4.7, wood);
      staticBox(g, fr, sx * 1.9, 1.3, -2.15, 0.08, 2.6, 4.7);
    }
    L.box(F, 0, 1.3, -4.5, 3.8, 2.6, 0.08, cloth);
    L.box(F, 0, 1.6, -4.45, 3.4, 0.08, 0.02, accent);
    staticBox(g, fr, 0, 1.3, -4.5, 3.8, 2.6, 0.08);
    // posts
    for (const sx of [-1, 1]) { L.box(F, sx * 1.85, 1.45, 0.15, 0.12, 2.9, 0.12, 0xa8261c); L.box(F, sx * 1.85, 0.05, 0.15, 0.18, 0.1, 0.18, 0xe2b85c); }
    // counter
    if (o.counter !== false) {
      L.box(F, 0, 0.5, -0.225, 3.0, 0.96, 0.45, wood);
      L.box(F, 0, 0.98, -0.225, 3.1, 0.04, 0.5, 0x8a5a36);
      for (let i = 0; i < 6; i++) L.box(F, -1.25 + i * 0.5, 0.5, 0.005, 0.36, 0.55, 0.01, i % 2 ? accent : cloth);
      L.box(F, 0, 0.12, 0.005, 3.0, 0.06, 0.012, accent);
      staticBox(g, fr, 0, 0.5, -0.225, 3.1, 1.0, 0.5, { friction: 0.7, restitution: 0.15 });
      // low lips so things resting on the counter don't roll off
      staticBox(g, fr, 0, 1.015, 0.0, 3.1, 0.03, 0.02);
      staticBox(g, fr, 0, 1.012, -0.46, 3.1, 0.024, 0.02);
      L.box(F, 0, 1.015, 0.0, 3.1, 0.03, 0.02, 0xe2b85c);
      L.box(F, 0, 1.012, -0.46, 3.1, 0.024, 0.02, 0xe2b85c);
    }
    // canopy: striped sloped roof
    const n = 8, slope = Math.atan2(0.55, 5.2);
    for (let i = 0; i < n; i++) {
      const x = -1.95 + (i + 0.5) * 3.9 / n;
      L.box(F, x, 3.0, -2.0, 3.9 / n, 0.04, 5.3, i % 2 ? 0xf1e6cf : cloth, -slope);
    }
    // valance flags along the front edge
    for (let i = 0; i < 13; i++) {
      const x = -1.9 + i * 3.8 / 12;
      L.cone(F, x, 2.6, 0.62, 0.11, 0.22, i % 2 ? accent : cloth, 3, Math.PI, 0, 0);
    }
    L.box(F, 0, 2.75, 0.62, 4.0, 0.08, 0.04, accent);
    // sign
    L.box(F, 0, 2.38, 0.2, 2.7, 0.5, 0.06, dark);
    L.box(F, 0, 2.38, 0.17, 2.76, 0.56, 0.02, accent);
    const row = g.signs.add((c, W, H) => drawSign(c, W, H, this.cn, this.name, cloth, accent));
    g.signs.plane(F, 0, 2.38, 0.235, 2.6, 0.325, row);
    // lamps inside the booth (baked) + one realtime light
    const lp = fr.toWorld(0, 2.5, -1.4), lp2 = fr.toWorld(0, 2.4, -3.4);
    g.lamps.push({ x: lp.x, y: lp.y, z: lp.z, color: new THREE.Color(1, 0.62, 0.32), intensity: 1.5, range: 5.5 });
    g.lamps.push({ x: lp2.x, y: lp2.y, z: lp2.z, color: new THREE.Color(1, 0.55, 0.3), intensity: 1.2, range: 4.5 });
    g.addLight(fr.toWorld(0, 2.4, -2.2), 0xffb070, 5, 7);
    // bulbs on the canopy edge & lanterns at the posts
    for (let i = 0; i <= 10; i++) g.bulbs.push(fr.toWorld(-1.9 + i * 0.38, 2.52 + Math.sin(i / 10 * Math.PI) * -0.08, 0.63));
    g.lanterns.push({ p: fr.toWorld(-1.85, 2.2, 0.3), s: 1 }, { p: fr.toWorld(1.85, 2.2, 0.3), s: 1 });
  }

  buildPanel() {
    const g = this.game, fr = this.frame;
    this.panel = new Panel({
      width: 0.62, height: 0.5, px: 640,
      draw: (c, W, H, p) => {
        roundRect(c, 4, 4, W - 8, H - 8, 26); c.fillStyle = 'rgba(20,14,26,0.92)'; c.fill();
        c.lineWidth = 6; c.strokeStyle = '#e2b85c'; c.stroke();
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
        c.fillStyle = '#e2b85c'; c.font = `64px ${FONTS.brush}`; c.fillText(this.cn, 28, 84);
        const cw = c.measureText(this.cn).width;
        c.fillStyle = '#f1e6cf'; fitText(c, this.name, 28 + cw + 22, 78, W - cw - 80, 44, FONTS.latin);
        c.font = `26px ${FONTS.sans}`; c.fillStyle = '#c8bca8';
        wrap(c, this.rules, 28, 122, W - 56, 30, 2);
        const thrown = this.thrownCount();
        c.font = `600 34px ${FONTS.sans}`; c.fillStyle = '#f1e6cf';
        c.fillText(`Throws ${thrown}/${this.projectiles.length}`, 28, 222);
        c.fillText(this.scoreText(), 300, 222);
        c.font = `28px ${FONTS.sans}`; c.fillStyle = this.state === 'done' ? (this.lastTickets > 0 ? '#ffd060' : '#ff9a80') : '#9fd8ff';
        wrap(c, this.message, 28, 268, W - 56, 32, 2);
        c.font = `24px ${FONTS.sans}`; c.fillStyle = '#a8a0c0';
        c.fillText(`Best: ${this.bestText()}`, 28, H - 40);
        p.button('reset', W - 230, H - 98, 200, 70, 'Reset', () => { this.resetRound(true); g.sounds.click(); }, { size: 34, bg: '#5a1a14', border: '#e2b85c' });
      },
    });
    const pp = fr.toWorld(1.58, 1.45, 0.32);
    this.panel.mesh.position.copy(pp);
    this.panel.mesh.quaternion.copy(fr.quat(0, -0.55, 0));
    g.scene.add(this.panel.mesh);
    g.pointer.panels.push(this.panel);
  }

  addProjectile(body, set, color) {
    this.game.world.add(body);
    set.add(body, color);
    body.user = { grabbable: true, stall: this, inPlay: false, released: false, home: this.projectiles.length, strayT: 0, thrownAt: -99, thrower: null, spent: false, kind: this.projKind };
    this.projectiles.push(body);
    return body;
  }
  returnToTray(b) {
    const u = b.user;
    this.trayPose(u.home, _v, _q);
    b.enabled = true; b.hidden = false; b.pinned = false; b.held = false;
    b.place(_v.x, _v.y, _v.z, _q);
    b.sleeping = true;
    u.inPlay = false; u.released = false; u.spent = false; u.strayT = 0; u.thrownAt = -99;
  }
  thrownCount() { let n = 0; for (const p of this.projectiles) if (p.user.inPlay || p.user.spent) n++; return n; }
  resetRound(manual = false) {
    for (const p of this.projectiles) { if (p.held) this.game.grabber.forceDrop(p); this.returnToTray(p); }
    this.resetTargets();
    this.state = 'idle'; this.stateT = 0; this.settleT = 0;
    this.message = manual ? 'Fresh round, good luck!' : this.introMsg();
    this.panel.markDirty();
  }
  introMsg() { return this.lines[0]; }
  bestText() { return String(this.best); }
  isRested(p, t) {
    const u = p.user;
    if (u.spent || p.pinned || p.sleeping || !p.enabled) return true;
    return p.vel.lengthSq() < 0.01 && p.angVel.lengthSq() < 1 && t - u.thrownAt > 1.2;
  }
  update(dt, t, headPos) {
    const fr = this.frame;
    let thrown = 0, settled = 0, changed = false;
    for (const p of this.projectiles) {
      const u = p.user;
      if (p.held) { u.strayT = 0; continue; }
      if (!p.enabled) { if (u.spent) { thrown++; settled++; } continue; }
      fr.toLocal(p.pos, _v);
      if (!u.inPlay && u.released && _v.z < this.playZ && Math.abs(_v.x) < 1.95) {
        u.inPlay = true; this.lastThrowT = t; changed = true;
        if (this.state === 'idle') { this.state = 'playing'; this.stateT = 0; }
        if (this.state === 'done') { /* thrown during result display: ignore */ }
      }
      if (p.pos.y < -2 || Math.abs(p.pos.x) > 30 || Math.abs(p.pos.z) > 40) { this.returnToTray(p); continue; }
      if (!u.inPlay && !u.spent) {
        this.trayPose(u.home, _v2, _q);
        if (p.pos.distanceToSquared(_v2) > 0.05 && (p.sleeping || p.vel.lengthSq() < 0.01)) {
          u.strayT += dt;
          if (u.strayT > 3.5) { this.returnToTray(p); changed = true; }
        } else u.strayT = 0;
      }
      if (u.inPlay || u.spent) { thrown++; if (this.isRested(p, t)) settled++; }
    }
    this.updateGame(dt, t);
    if (this.state === 'playing') {
      const all = thrown === this.projectiles.length;
      if ((all || this.allDone()) && settled === thrown) { this.settleT += dt; if (this.settleT > 0.9) this.finish(t); }
      else this.settleT = 0;
      if (all && t - this.lastThrowT > 9 && this.state === 'playing') this.finish(t);
    } else if (this.state === 'done') {
      this.stateT += dt;
      if (this.stateT > 4.5) this.resetRound();
    }
    if (changed) this.panel.markDirty();
    // operator
    const d = this.operator.update(dt, t, headPos);
    this.barkT -= dt;
    if (this.barkT <= 0) {
      this.barkT = 14 + Math.random() * 12;
      if (d < 6 && this.state === 'idle') this.operator.say(this.lines[(Math.random() * this.lines.length) | 0], 4.5);
    }
    // ticket strip
    if (this.stripT > 0) {
      this.stripT -= dt;
      const grow = Math.min(1, (3.2 - this.stripT) / 1.2);
      const len = Math.max(0.001, this.stripN * 0.05 * (this.stripT < 0.6 ? this.stripT / 0.6 : grow));
      this.strip.scale.y = len; this.strip.visible = true;
      const uv = this.strip.geometry.attributes.uv;
      uv.setY(0, len / 0.05); uv.setY(1, len / 0.05); uv.setY(2, 0); uv.setY(3, 0); uv.needsUpdate = true;
      if (this.stripT <= 0) this.strip.visible = false;
    }
  }
  finish(t) {
    const score = this.finalScore();
    const tickets = this.ticketsFor(score);
    this.state = 'done'; this.stateT = 0; this.lastTickets = tickets;
    if (this.isBetter(score)) { this.best = score; this.game.data.best[this.id] = score; this.game.persist(); }
    this.message = tickets > 0 ? `${this.resultText(score)}  +${tickets} ticket${tickets > 1 ? 's' : ''}!` : `${this.resultText(score)}. No prize this time.`;
    const top = this.frame.toWorld(0, 2.6, 0.9);
    if (tickets > 0) {
      this.game.addTickets(tickets, this);
      this.stripN = Math.min(20, tickets); this.stripT = 3.2;
      this.game.sounds.tickets(this.strip.position, tickets);
      this.operator.say(tickets >= this.bigWin ? 'Incredible! A big winner!' : (this.winLines ?? ['Winner! Here are your tickets.'])[(Math.random() * (this.winLines?.length ?? 1)) | 0], 4.5);
      this.game.celebrate(top, tickets >= this.bigWin);
      const c = this.frame.toWorld(0, 1.9, 0.2, _v);
      this.game.fireworks.confetti(c.x, c.y, c.z, 40 + tickets * 4);
    } else {
      this.operator.say(['So close! Try again?', 'Ah, unlucky! Another go?', 'Nearly had it!'][(Math.random() * 3) | 0], 4);
      this.game.sounds.miss(top);
    }
    this.panel.markDirty();
  }
  isBetter(s) { return s > this.best; }
  resultText(s) { return `Score ${s}`; }
  // overridables
  updateGame() { }
  resetTargets() { }
  allDone() { return false; }
  finalScore() { return this.liveScore(); }
  liveScore() { return 0; }
  scoreText() { return `Score ${this.liveScore()}`; }
  ticketsFor() { return 0; }
  aimTargets() { return this.targetsOut; }
  onImpact() { }
  get bigWin() { return 6; }
}

function wrap(c, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(' '); let line = '', n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y + n * lh); n++; line = w; if (n >= maxLines) return; }
    else line = t;
  }
  if (line && n < maxLines) c.fillText(line, x, y + n * lh);
}

function hex(c) { return '#' + new THREE.Color(c).getHexString(); }
export function drawSign(c, W, H, cn, en, color, accent) {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, hex(color)); g.addColorStop(1, '#2a0d08');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = hex(accent); c.lineWidth = 6; c.strokeRect(6, 6, W - 12, H - 12);
  c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillStyle = '#ffe9b0'; c.shadowColor = '#ffb040'; c.shadowBlur = 16;
  c.font = `86px ${FONTS.brush}`; const cw = c.measureText(cn).width;
  c.fillText(cn, 40 + cw / 2, H / 2 + 6);
  c.font = `italic 700 62px ${FONTS.latin}`; c.fillStyle = '#fff6e0';
  fitText(c, en, (80 + cw + W) / 2, H / 2 + 4, W - cw - 120, 62, FONTS.latin);
  c.shadowBlur = 0;
}

// ═════════════════════════════════════════════════════════════
// 1. Tin Tumble: knock pyramids of tins off the shelf with beanbags
// ═════════════════════════════════════════════════════════════
export class TinStall extends Stall {
  constructor(game, o) {
    super(game, { id: 'tins', name: 'Tin Tumble', cn: '罐塔', color: 0x8c1f1a, accent: 0xe2b85c, rules: 'Four beanbags. Knock every tin off the shelf for the top prize.',
      lines: ['Two towers, four beanbags. Easy, right?', 'Knock them all down for eight tickets!', 'Aim low, the bottom row holds it up!'], op: { robe: 0x2a5a8a, hat: 'cap' }, ...o });
    this.projKind = 'Beanbag';
    const fr = this.frame, F = fr.m, L = game.lit;
    // shelf + stand
    L.box(F, 0, 0.95, -3.0, 1.5, 0.1, 0.42, 0x8a5a36);
    L.box(F, 0, 0.45, -3.0, 1.3, 0.9, 0.3, 0x5a3a24);
    L.box(F, 0, 0.9, -2.79, 1.5, 0.03, 0.01, 0xe2b85c);
    staticBox(game, fr, 0, 0.95, -3.0, 1.5, 0.1, 0.42, { friction: 0.55, restitution: 0.1 });
    staticBox(game, fr, 0, 0.45, -3.0, 1.3, 0.9, 0.3);
    // curtain behind
    L.box(F, 0, 1.6, -4.4, 2.6, 1.8, 0.04, 0x3a1030);
    // tins
    const r = 0.036, hh = 0.06;
    const geo = tinGeometry(r, hh);
    this.tinSet = new PropSet(game.scene, geo, game.mats.tin, 12);
    this.tins = [];
    const cols = [0xffffff, 0xffe0c0, 0xe0f0ff];
    let k = 0;
    for (const ox of [-0.32, 0.32]) for (let row = 0; row < 3; row++) {
      const n = 3 - row;
      for (let i = 0; i < n; i++) {
        const t = new Body({ kind: CYL, r, hh }, { mass: 0.07, restitution: 0.15, friction: 0.45, rolling: 0.5, rimSamples: 12, tag: 'tin' });
        t.home = new THREE.Vector3(ox + (i - (n - 1) / 2) * (2 * r + 0.004), 1.0 + hh + row * (2 * hh + 0.001) + 0.0006, -3.0);
        game.world.add(t); this.tinSet.add(t, cols[k++ % 3]);
        t.user = { stall: this, tin: true };
        this.tins.push(t);
      }
    }
    // beanbags
    this.bagSet = new PropSet(game.scene, beanbagGeometry(), game.mats.cloth, 4);
    const bc = [0xd0402a, 0x2a70c0, 0x40a050, 0xe0b030];
    for (let i = 0; i < 4; i++) this.addProjectile(new Body({ kind: SPHERE, r: 0.05 }, { mass: 0.2, restitution: 0.04, friction: 0.9, rolling: 3, tag: 'bag' }), this.bagSet, bc[i]);
    this.targetsOut = [fr.toWorld(-0.32, 1.1, -3.0), fr.toWorld(0.32, 1.1, -3.0)];
    this.resetRound();
  }
  trayPose(i, p, q) { this.frame.toWorld(-0.45 + i * 0.3, 1.0 + 0.0505, -0.24, p); q.copy(this.frame.q); }
  resetTargets() {
    for (const t of this.tins) { const w = this.frame.toWorld(t.home.x, t.home.y, t.home.z, _v); t.place(w.x, w.y, w.z, this.frame.q); t.sleeping = true; }
  }
  isDown(t) {
    _up.set(0, 1, 0).applyQuaternion(t.quat);
    return _up.y < 0.75 || t.pos.y < 0.985 || this.frame.toLocal(t.pos, _v).z > -2.78 || _v.z < -3.22;
  }
  liveScore() { let n = 0; for (const t of this.tins) if (this.isDown(t)) n++; return n; }
  scoreText() { return `Down ${this.liveScore()}/12`; }
  allDone() { return this.liveScore() === 12; }
  ticketsFor(s) { return s >= 12 ? 8 : s >= 9 ? 4 : s >= 6 ? 2 : s >= 3 ? 1 : 0; }
  resultText(s) { return `${s} of 12 down`; }
  get bigWin() { return 8; }
  updateGame() {
    // tins knocked during play refresh the panel
    const s = this.liveScore();
    if (s !== this._ls) { this._ls = s; this.panel.markDirty(); }
  }
  onImpact(ev, body, other, speed) {
    const s = this.game.sounds;
    if (body.tag === 'tin' || other?.tag === 'tin') s.clank(ev, speed); else s.thud(ev, speed);
  }
}

// ═════════════════════════════════════════════════════════════
// 2. Bottle Rings: toss rings over bottle necks
// ═════════════════════════════════════════════════════════════
export class RingStall extends Stall {
  constructor(game, o) {
    super(game, { id: 'rings', name: 'Bottle Rings', cn: '套圈', color: 0x1f5a3a, accent: 0xe2b85c, rules: 'Five rings. Land a ring around a bottle neck: 2, 5, then 10 tickets.',
      lines: ['Ring a bottle, win a prize!', 'Gentle wrist, flat throw!', 'Each ring that sticks counts!'], op: { robe: 0x7a2a6a, hat: 'straw' }, ...o });
    this.projKind = 'Ring';
    const fr = this.frame, F = fr.m, L = game.lit;
    // table
    L.box(F, 0, 0.8, -2.0, 1.0, 0.1, 0.9, 0xa02a24);
    L.box(F, 0, 0.38, -2.0, 0.9, 0.76, 0.8, 0x5a2a1a);
    staticBox(game, fr, 0, 0.8, -2.0, 1.0, 0.1, 0.9, { friction: 0.5, restitution: 0.2 });
    staticBox(game, fr, 0, 0.38, -2.0, 0.9, 0.76, 0.8);
    // bottles 4x4
    this.bottles = [];
    const prof = []; // lathe profile for a bottle (y from 0)
    for (const [r, y] of [[0.0, 0], [0.03, 0], [0.031, 0.01], [0.03, 0.17], [0.024, 0.19], [0.014, 0.21], [0.011, 0.22], [0.011, 0.3], [0.013, 0.305], [0.0, 0.305]]) prof.push(new THREE.Vector2(r, y));
    const bgeo = new THREE.LatheGeometry(prof, 10);
    const glass = [0x2f8a4a, 0x8a5a20, 0x2a6aa0, 0x3a9a6a];
    const top = 0.85;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const x = -0.27 + i * 0.18, z = -2.0 - 0.27 + j * 0.18;
      L.geo(F, bgeo, x, top, z, 1, 1, 1, glass[(i + j) % 4]);
      staticShape(game, fr, { kind: CYL, r: 0.03, hh: 0.095 }, x, top + 0.095, z, { restitution: 0.3, friction: 0.3 });
      staticShape(game, fr, { kind: CYL, r: 0.02, hh: 0.012 }, x, top + 0.198, z, { restitution: 0.3, friction: 0.3 });
      staticShape(game, fr, { kind: CYL, r: 0.012, hh: 0.045 }, x, top + 0.26, z, { restitution: 0.3, friction: 0.3 });
      const w = fr.toWorld(x, top, z);
      this.bottles.push(w);
      this.targetsOut.push(fr.toWorld(x, top + 0.31, z));
    }
    game.lamps.push({ ...fr.toWorld(0, 1.6, -2.0), color: new THREE.Color(0.5, 0.9, 0.6), intensity: 0.5, range: 1.6 });
    // rings
    const rgeo = new THREE.TorusGeometry(0.065, 0.008, 6, 24); rgeo.rotateX(Math.PI / 2);
    this.ringSet = new PropSet(game.scene, rgeo, game.mats.ring, 5);
    const rc = [0xff4a3a, 0xffd040, 0x40c0ff, 0x60ff80, 0xff70d0];
    for (let i = 0; i < 5; i++) this.addProjectile(new Body({ kind: TORUS, R: 0.065, r: 0.008 }, { mass: 0.03, restitution: 0.25, friction: 0.35, rolling: 0.4, rimSamples: 20, angDamp: 0.3, tag: 'ring' }), this.ringSet, rc[i]);
    this.top = top;
    this.resetRound();
  }
  trayPose(i, p, q) { this.frame.toWorld(-0.6 + i * 0.3, 1.0 + 0.0085, -0.24, p); q.copy(this.frame.q); }
  ringedBottle(r) {
    _up.set(0, 1, 0).applyQuaternion(r.quat);
    if (Math.abs(_up.y) < 0.35) return -1;
    for (let k = 0; k < this.bottles.length; k++) {
      const b = this.bottles[k];
      const y = r.pos.y - (_up.x * (b.x - r.pos.x) + _up.z * (b.z - r.pos.z)) / _up.y;
      if (y < this.top - 0.01 || y > this.top + 0.3) continue;
      const dx = b.x - r.pos.x, dy = y - r.pos.y, dz = b.z - r.pos.z;
      if (dx * dx + dy * dy + dz * dz < 0.057 * 0.057) return k;
    }
    return -1;
  }
  liveScore() { let n = 0; for (const r of this.projectiles) if (!r.held && r.user.inPlay && (r.sleeping || r.vel.lengthSq() < 0.02) && this.ringedBottle(r) >= 0) n++; return n; }
  scoreText() { return `Ringed ${this.liveScore()}`; }
  ticketsFor(s) { return s >= 3 ? 10 + (s - 3) * 2 : s === 2 ? 5 : s === 1 ? 2 : 0; }
  resultText(s) { return `${s} ring${s === 1 ? '' : 's'} on`; }
  get bigWin() { return 5; }
  updateGame() { const s = this.liveScore(); if (s !== this._ls) { if (s > (this._ls ?? 0)) { this.game.sounds.score(this.frame.toWorld(0, 1, -2)); this.operator.say('Ringer!', 2); } this._ls = s; this.panel.markDirty(); } }
  resetTargets() { this._ls = 0; }
  onImpact(ev, body, other, speed) { if (other && other.isStatic && this.frame.toLocal(ev, _v).z < -1.4 && _v.y > 0.86) this.game.sounds.clink(ev, speed); else this.game.sounds.wood(ev, speed * 0.6); }
}

// ═════════════════════════════════════════════════════════════
// 3. Balloon Burst: darts at a balloon wall
// ═════════════════════════════════════════════════════════════
export class DartStall extends Stall {
  constructor(game, o) {
    super(game, { id: 'darts', name: 'Balloon Burst', cn: '飞镖', color: 0x6a2a8a, accent: 0xffc040, rules: 'Five darts. One ticket per balloon, +3 bonus if all five darts pop one.',
      lines: ['Pop, pop, pop! Step up!', 'Darts fly straight, aim true!', 'Every balloon is a ticket!'], op: { robe: 0xc04a20, hat: 'bun' }, ...o });
    this.projKind = 'Dart';
    this.assistSpeed = false;
    const fr = this.frame, F = fr.m, L = game.lit;
    // cork board
    L.box(F, 0, 1.5, -2.72, 2.3, 1.5, 0.2, 0xa07850);
    L.box(F, 0, 1.5, -2.83, 2.5, 1.7, 0.05, 0xe2b85c);
    L.box(F, 0, 0.38, -2.72, 2.2, 0.76, 0.18, 0x4a2a1a);
    staticBox(game, fr, 0, 1.5, -2.72, 2.3, 1.5, 0.2, { tag: 'dartboard', restitution: 0.05, friction: 0.9 });
    staticBox(game, fr, 0, 0.38, -2.72, 2.2, 0.76, 0.18);
    // balloons
    this.balloons = [];
    const bg = new THREE.SphereGeometry(0.085, 14, 10); bg.scale(1, 1.18, 0.9);
    const knot = new THREE.ConeGeometry(0.014, 0.025, 6); knot.rotateX(Math.PI); knot.translate(0, -0.108, 0);
    const merged = mergeTwo(bg, knot);
    this.balloonMesh = new THREE.InstancedMesh(merged, game.mats.balloon, 24);
    this.balloonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const bc = [0xff3030, 0xffd020, 0x30a0ff, 0x40e060, 0xff60c0, 0xff8a20];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
      const idx = this.balloons.length;
      const lp = new THREE.Vector3(-0.75 + i * 0.3 + (j % 2) * 0.06, 1.0 + j * 0.3, -2.52);
      this.balloons.push({ lp, p: fr.toWorld(lp.x, lp.y, lp.z), alive: true, phase: Math.random() * 6 });
      this.balloonMesh.setColorAt(idx, new THREE.Color(bc[(i + j * 2) % bc.length]));
    }
    game.scene.add(this.balloonMesh);
    // darts
    this.dartSet = new PropSet(game.scene, dartGeometry(), game.mats.dart, 5);
    const dc = [0xff4040, 0x40a0ff, 0x40ff80, 0xffd040, 0xff60ff];
    for (let i = 0; i < 5; i++) {
      const d = this.addProjectile(new Body({ kind: SPHERE, r: 0.012 }, { mass: 0.03, restitution: 0.1, friction: 0.8, noRotate: true, rolling: 0, tag: 'dart' }), this.dartSet, dc[i]);
      d.user.prev = new THREE.Vector3(); d.user.dart = true;
    }
    this.popped = 0;
    this.resetRound();
  }
  trayPose(i, p, q) { this.frame.toWorld(-0.5 + i * 0.25, 1.0 + 0.0125, -0.18, p); q.copy(this.frame.q); }
  resetTargets() {
    this.popped = 0;
    for (const b of this.balloons) b.alive = true;
    this.panel?.markDirty();
  }
  aimTargets() { this.targetsOut.length = 0; for (const b of this.balloons) if (b.alive) this.targetsOut.push(b.p); return this.targetsOut; }
  liveScore() { return this.popped; }
  scoreText() { return `Popped ${this.popped}`; }
  finalScore() { return this.popped; }
  allDone() { return this.popped === this.balloons.length; }
  ticketsFor(s) { let hitters = 0; for (const d of this.projectiles) if (d.user.popper) hitters++; return s + (hitters >= 5 ? 3 : 0); }
  resultText(s) { return `${s} balloon${s === 1 ? '' : 's'} popped`; }
  get bigWin() { return 6; }
  returnToTray(b) { super.returnToTray(b); b.user.popper = false; b.user.prev.copy(b.pos); }
  updateGame(dt, t) {
    const m = _m4;
    // balloons bob; dead ones are hidden
    for (let i = 0; i < this.balloons.length; i++) {
      const b = this.balloons[i];
      const s = b.alive ? 1 : 0;
      b.p.copy(this.frame.toWorld(b.lp.x, b.lp.y + Math.sin(t * 1.3 + b.phase) * 0.008, b.lp.z, _v));
      m.makeRotationY(this.frame.yaw + Math.sin(t * 0.8 + b.phase) * 0.2).scale(_v2.set(s, s, s)).setPosition(b.p);
      this.balloonMesh.setMatrixAt(i, m);
    }
    this.balloonMesh.instanceMatrix.needsUpdate = true;
    for (const d of this.projectiles) {
      const u = d.user;
      if (!d.enabled) continue;
      if (u.released && !d.pinned && !d.held) {
        // point along the flight direction, and test the swept segment against balloons
        const sp = d.vel.length();
        if (sp > 1.5 && d.touching === 0) { _v.copy(d.vel).divideScalar(sp); _q.setFromUnitVectors(FWD, _v); d.quat.slerp(_q, Math.min(1, dt * 25)); }
        for (const b of this.balloons) {
          if (!b.alive) continue;
          if (segDist2(u.prev, d.pos, b.p) < 0.1 * 0.1) {
            b.alive = false; this.popped++; u.popper = true;
            this.game.sounds.pop(b.p); this.game.fireworks.confetti(b.p.x, b.p.y, b.p.z, 26);
            u.thrower?.haptic(0.8, 50);
            this.panel.markDirty();
            if (this.popped % 3 === 0) this.operator.say(['Pop!', 'Great shot!', 'Bullseye!'][(Math.random() * 3) | 0], 1.6);
          }
        }
      }
      u.prev.copy(d.pos);
    }
  }
  onImpact(ev, body, other, speed) {
    const s = this.game.sounds;
    if (body.user?.dart && other?.tag === 'dartboard' && speed > 2.2 && !body.pinned) {
      // stick into the cork
      body.pinned = true; body.vel.set(0, 0, 0); body.angVel.set(0, 0, 0);
      this.frame.dirToWorld(_v.set(0, 0, -1), _v2);
      body.pos.addScaledVector(_v2, 0.006);
      s.thunk(ev);
      body.user.thrower?.haptic(0.5, 30);
    } else s.wood(ev, speed * 0.5);
  }
}
const FWD = new THREE.Vector3(0, 0, -1);
function segDist2(a, b, p) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
  return dx * dx + dy * dy + dz * dz;
}

// ═════════════════════════════════════════════════════════════
// 4. Dragon's Pearl: shoot pearls through a hoop held by a bobbing dragon
// ═════════════════════════════════════════════════════════════
export class HoopStall extends Stall {
  constructor(game, o) {
    super(game, { id: 'hoop', name: "Dragon's Pearl", cn: '龙珠', color: 0x9a2018, accent: 0xffc040, rules: 'Three pearls. Feed them through the dragon’s hoop: 2 tickets each, sweep for +3.',
      lines: ['Feed the dragon its pearls!', 'He bobs, you lob!', 'Through the hoop for luck!'], op: { robe: 0x2a6a4a, hat: 'cap' }, ...o });
    this.projKind = 'Pearl';
    const fr = this.frame, F = fr.m, L = game.lit;
    // dragon body coils painted on the back wall + pillar
    L.box(F, 0, 1.1, -3.6, 0.3, 2.2, 0.3, 0x7a1a14);
    for (let i = 0; i < 7; i++) L.sphere(F, -1.2 + i * 0.4, 2.2 + Math.sin(i * 1.2) * 0.25, -4.35, 0.2, 0.2, 0.1, i % 2 ? 0x2a8a4a : 0x3aa05a, 8);
    // moving dragon head + hoop
    this.dragon = new THREE.Group();
    const b = new Builder();
    const red = 0xc8301c, gold = 0xffc040, green = 0x2aa04a, dk = 0x8a1a10;
    b.sphere(null, 0, 0.12, -0.08, 0.27, 0.24, 0.3, red, 14);         // skull
    b.sphere(null, 0, 0.06, 0.2, 0.19, 0.13, 0.2, red, 12);           // snout
    b.sphere(null, 0, -0.1, 0.12, 0.17, 0.06, 0.22, dk, 10);          // lower jaw (open)
    b.sphere(null, 0, -0.03, 0.16, 0.14, 0.05, 0.17, 0x3a0606, 10);   // mouth
    b.sphere(null, 0, 0.1, 0.38, 0.08, 0.06, 0.04, 0xe04a2a, 8);      // nose
    for (const sx of [-1, 1]) {
      b.sphere(null, sx * 0.13, 0.22, 0.14, 0.065, 0.065, 0.05, 0xffffff, 10);   // eyes
      b.sphere(null, sx * 0.135, 0.22, 0.18, 0.032, 0.04, 0.02, 0x101010, 8);
      b.sphere(null, sx * 0.13, 0.29, 0.13, 0.08, 0.025, 0.05, gold, 8);          // brows
      b.cone(null, sx * 0.13, 0.42, -0.22, 0.035, 0.32, gold, 6, -0.7, 0, sx * 0.35); // horns
      b.cyl(null, sx * 0.3, 0.02, 0.36, 0.006, 0.006, 0.5, gold, 4, 0.3, 0, sx * 1.2); // whiskers
      b.sphere(null, sx * 0.05, 0.1, 0.4, 0.018, 0.014, 0.01, 0x200808, 6);     // nostrils
      b.cone(null, sx * 0.07, -0.05, 0.3, 0.018, 0.05, 0xffffff, 4, Math.PI, 0, 0); // fangs
      for (let k = 0; k < 3; k++) b.cone(null, sx * (0.24 + k * 0.03), 0.05 - k * 0.07, -0.1 - k * 0.03, 0.05, 0.22, green, 5, 0, 0, sx * (1.9 + k * 0.2)); // mane
    }
    for (let i = 0; i < 5; i++) b.cone(null, 0, 0.36 - i * 0.05, -0.3 - i * 0.07, 0.05, 0.18, green, 5, -1.4 - i * 0.1, 0, 0);
    // body coils trailing behind
    for (let i = 0; i < 6; i++) {
      const a = i * 0.7;
      b.sphere(null, Math.sin(a) * 0.25, -0.05 + Math.cos(a) * 0.12 - i * 0.04, -0.45 - i * 0.2, 0.15 - i * 0.012, 0.15 - i * 0.012, 0.15, i % 2 ? red : 0xd84020, 10);
      b.cone(null, Math.sin(a) * 0.25, 0.11 + Math.cos(a) * 0.12 - i * 0.05, -0.45 - i * 0.2, 0.04, 0.12, green, 5);
    }
    // hoop + net
    const hoopY = -0.35, hoopZ = 0.5, R = 0.17;
    b.torus(null, 0, hoopY, hoopZ, R, 0.012, gold, Math.PI / 2, 0, 0);
    b.box(null, 0, hoopY + 0.03, hoopZ - R - 0.03, 0.04, 0.06, 0.12, gold);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      b.cyl(null, Math.cos(a) * R * 0.8, hoopY - 0.12, hoopZ + Math.sin(a) * R * 0.8, 0.004, 0.004, 0.25, 0xf0f0f0, 3, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    }
    b.torus(null, 0, hoopY - 0.12, hoopZ, R * 0.8, 0.006, 0xf0f0f0, Math.PI / 2, 0, 0);
    this.dragonMesh = new THREE.Mesh(b.geometry(), game.mats.figure);
    this.dragon.add(this.dragonMesh);
    game.scene.add(this.dragon);
    this.R = R; this.hoopLocal = new THREE.Vector3(0, hoopY, hoopZ);
    this.base = new THREE.Vector3(0, 1.95, -3.35);
    this.headBody = staticShape(game, fr, { kind: BOX, hx: 0.25, hy: 0.24, hz: 0.3 }, 0, 0, 0, { restitution: 0.4 });
    this.hoopBody = staticShape(game, fr, { kind: TORUS, R, r: 0.012 }, 0, 0, 0, { restitution: 0.45, friction: 0.4, tag: 'hoop' });
    this.neckBody = staticShape(game, fr, { kind: BOX, hx: 0.02, hy: 0.03, hz: 0.06 }, 0, 0, 0, { restitution: 0.3 });
    this.headBody.moving = this.hoopBody.moving = this.neckBody.moving = true;
    this.hoopW = new THREE.Vector3();
    // pearls (with cradle rings on the counter)
    this.ballSet = new PropSet(game.scene, new THREE.SphereGeometry(0.075, 16, 12), game.mats.pearl, 3);
    const pc = [0xfff4e8, 0xffd8e8, 0xd8ecff];
    for (let i = 0; i < 3; i++) {
      this.addProjectile(new Body({ kind: SPHERE, r: 0.075 }, { mass: 0.15, restitution: 0.55, friction: 0.6, rolling: 0.4, tag: 'pearl' }), this.ballSet, pc[i]);
      const c = this.cradle(i);
      L.torus(F, c.x, 1.0 + 0.012, c.z, 0.05, 0.012, gold, Math.PI / 2);
      staticShape(game, fr, { kind: TORUS, R: 0.05, r: 0.012 }, c.x, 1.012, c.z, { restitution: 0.1 });
    }
    this.baskets = 0;
    this.targetsOut = [new THREE.Vector3()];
    this.time = 0;
    this.updateDragon(0, 0.016);
    this.resetRound();
  }
  cradle(i) { return { x: -0.35 + i * 0.35, z: -0.24 }; }
  trayPose(i, p, q) { const c = this.cradle(i); this.frame.toWorld(c.x, 1.012 + 0.0705, c.z, p); q.copy(this.frame.q); }
  updateDragon(t, dt) {
    const fr = this.frame;
    const lx = this.base.x + Math.sin(t * 0.55) * 0.45, ly = this.base.y + Math.sin(t * 1.1) * 0.15;
    fr.toWorld(lx, ly, this.base.z, this.dragon.position);
    this.dragon.quaternion.copy(fr.q).multiply(_q.setFromAxisAngle(Y, Math.sin(t * 0.55 + 1) * 0.15));
    this.dragon.updateMatrixWorld();
    const set = (body, x, y, z) => {
      _v.set(x, y, z).applyMatrix4(this.dragon.matrixWorld);
      body.vel.copy(_v).sub(body.pos).divideScalar(Math.max(dt, 1e-3));
      if (body.vel.lengthSq() > 4) body.vel.set(0, 0, 0);
      body.pos.copy(_v); body.quat.copy(this.dragon.quaternion);
    };
    set(this.headBody, 0, 0.05, 0);
    set(this.hoopBody, this.hoopLocal.x, this.hoopLocal.y, this.hoopLocal.z);
    set(this.neckBody, 0, this.hoopLocal.y + 0.03, this.hoopLocal.z - this.R - 0.03);
    this.hoopW.copy(this.hoopBody.pos);
    this.targetsOut[0].copy(this.hoopW).y += 0.08;
  }
  resetTargets() { this.baskets = 0; for (const p of this.projectiles) p.user.lastRel = 1; }
  liveScore() { return this.baskets; }
  scoreText() { return `Baskets ${this.baskets}`; }
  allDone() { return this.baskets >= 3; }
  ticketsFor(s) { return s * 2 + (s >= 3 ? 3 : 0); }
  resultText(s) { return `${s} pearl${s === 1 ? '' : 's'} through`; }
  get bigWin() { return 6; }
  updateGame(dt, t) {
    this.time += dt;
    this.updateDragon(this.time, dt);
    const h = this.hoopW;
    for (const p of this.projectiles) {
      const u = p.user;
      if (p.held || !p.enabled) { u.lastRel = 1; continue; }
      const rel = p.pos.y - h.y;
      const dx = p.pos.x - h.x, dz = p.pos.z - h.z;
      if (u.lastRel > 0 && rel <= 0 && p.vel.y < 0 && dx * dx + dz * dz < (this.R - 0.035) ** 2 && u.released) {
        this.baskets++; this.panel.markDirty();
        this.game.sounds.swish(h); this.game.sounds.score(h, this.baskets);
        this.game.fireworks.confetti(h.x, h.y, h.z, 30, [1, 0.85, 0.3]);
        u.thrower?.haptic(0.7, 60);
        this.operator.say(['Swish!', 'The dragon is pleased!', 'Right through!'][this.baskets % 3], 2);
      }
      u.lastRel = rel;
    }
  }
  onImpact(ev, body, other, speed) { if (other?.tag === 'hoop') this.game.sounds.clank(ev, speed * 0.6); else this.game.sounds.bounce(ev, speed); }
}

// ═════════════════════════════════════════════════════════════
// 5. Lantern Roll: skee-style lane with scoring holes
// ═════════════════════════════════════════════════════════════
export class SkeeStall extends Stall {
  constructor(game, o) {
    super(game, { id: 'skee', name: 'Lantern Roll', cn: '滚珠', color: 0x1a3a7a, accent: 0xffc040, counter: false, playZ: -1.0, rules: 'Six balls. Roll up the lane, jump the hump, sink them in the holes. 1 ticket per 30 points.',
      lines: ['Roll it, don’t throw it!', 'The hundreds are in the corners!', 'Gentle and smooth wins!'], opX: -1.3, opZ: -1.2, stripX: 0.55, op: { robe: 0x8a5a1a, hat: 'straw' }, ...o });
    this.projKind = 'Ball';
    this.assistSpeed = false;
    const fr = this.frame, F = fr.m, L = game.lit;
    const laneCol = 0xc89a5a, railCol = 0x7a2a1a;
    // lane: z +0.38 (y 0.80) to z -2.9 (y 0.98)
    const z0 = 0.38, z1 = -2.9, y0 = 0.8, y1 = 0.98;
    const len = Math.hypot(z0 - z1, y1 - y0), a = Math.atan2(y1 - y0, z0 - z1);
    const cz = (z0 + z1) / 2, cy = (y0 + y1) / 2;
    const off = (d) => [cy - Math.cos(a) * d, cz - Math.sin(a) * d]; // move along lane normal (downwards)
    let [by, bz] = off(0.04);
    L.box(F, 0, by, bz, 0.66, 0.08, len, laneCol, a);
    staticBox(game, fr, 0, by, bz, 0.66, 0.08, len, { rx: a, friction: 0.5, restitution: 0.1 });
    for (let i = 1; i < 6; i++) L.box(F, 0, by + 0.041, bz - len / 2 + i * len / 6, 0.64, 0.002, 0.03, 0x9a6a3a, a);
    [by, bz] = off(-0.07);
    for (const sx of [-1, 1]) {
      L.box(F, sx * 0.35, by, bz, 0.04, 0.14, len, railCol, a);
      staticBox(game, fr, sx * 0.35, by, bz, 0.04, 0.22, len, { rx: a, restitution: 0.3 });
    }
    L.box(F, 0, 0.4, -1.2, 0.7, 0.8, 3.0, 0x4a2a1a);
    // end cap at the player's end
    L.box(F, 0, 0.86, 0.42, 0.74, 0.12, 0.05, railCol);
    staticBox(game, fr, 0, 0.86, 0.42, 0.74, 0.14, 0.05, { restitution: 0.2 });
    // hump (z -2.9 -> -3.15 rising to 1.12)
    const ha = Math.atan2(0.14, 0.25);
    L.box(F, 0, 1.05 - 0.045, -3.025, 0.66, 0.08, 0.29, 0xe0b060, ha);
    staticBox(game, fr, 0, 1.05 - 0.045, -3.025, 0.66, 0.08, 0.29, { rx: ha, friction: 0.4, restitution: 0.1 });
    // gutter floor (gap z -3.15 .. -3.42)
    L.box(F, 0, 0.55, -3.3, 0.9, 0.04, 0.4, 0x201010);
    staticBox(game, fr, 0, 0.55, -3.3, 0.9, 0.04, 0.4);
    // target board: from (z -3.42, y 0.98) to (z -4.32, y 1.6)
    const tz0 = -3.42, tz1 = -4.32, ty0 = 0.98, ty1 = 1.6;
    this.tLen = Math.hypot(tz0 - tz1, ty1 - ty0); this.tA = Math.atan2(ty1 - ty0, tz0 - tz1);
    this.tz0 = tz0; this.ty0 = ty0;
    const tcz = (tz0 + tz1) / 2, tcy = (ty0 + ty1) / 2;
    staticBox(game, fr, 0, tcy - Math.cos(this.tA) * 0.03, tcz - Math.sin(this.tA) * 0.03, 0.9, 0.06, this.tLen, { rx: this.tA, friction: 0.45, restitution: 0.15 });
    L.box(F, 0, tcy - Math.cos(this.tA) * 0.04, tcz - Math.sin(this.tA) * 0.04, 0.92, 0.06, this.tLen + 0.02, 0x3a1a10, this.tA);
    L.box(F, 0, 0.5, -3.9, 0.9, 1.0, 1.0, 0x2a1810);
    // walls around the target + roof net
    for (const sx of [-1, 1]) {
      L.box(F, sx * 0.49, 1.45, -3.6, 0.04, 1.3, 1.6, 0x6a2a8a);
      staticBox(game, fr, sx * 0.49, 1.45, -3.6, 0.06, 1.5, 1.7);
    }
    staticBox(game, fr, 0, 1.7, -4.45, 1.0, 1.6, 0.1);
    L.box(F, 0, 1.7, -4.42, 1.0, 1.4, 0.04, 0x2a1a40);
    staticBox(game, fr, 0, 2.15, -3.6, 1.0, 0.05, 1.7);
    L.box(F, 0, 2.15, -3.6, 1.0, 0.02, 1.7, 0x2a2a30);
    // board face texture (holes + rings)
    this.holes = [
      { u: 0, v: 0.2, r: 0.11, pts: 10 }, { u: 0, v: 0.42, r: 0.085, pts: 20 }, { u: 0, v: 0.62, r: 0.075, pts: 30 },
      { u: 0, v: 0.8, r: 0.07, pts: 40 }, { u: 0, v: 0.96, r: 0.065, pts: 50 }, { u: -0.33, v: 0.98, r: 0.06, pts: 100 }, { u: 0.33, v: 0.98, r: 0.06, pts: 100 },
    ];
    const tex = skeeBoardTexture(this.holes, 0.9, this.tLen);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.9, this.tLen), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.copy(fr.toWorld(0, tcy + 0.001, tcz + 0.001));
    face.quaternion.copy(fr.quat(-Math.PI / 2 + this.tA, 0, 0));
    game.scene.add(face);
    game.lamps.push({ ...fr.toWorld(0, 2.0, -3.6), color: new THREE.Color(1, 0.8, 0.5), intensity: 0.8, range: 2.2 });
    // balls
    this.ballSet = new PropSet(game.scene, new THREE.SphereGeometry(0.05, 14, 10), game.mats.skee, 6);
    const cc = [0xff6040, 0xffc040, 0x60c0ff, 0x80ff80, 0xff80d0, 0xffffff];
    for (let i = 0; i < 6; i++) this.addProjectile(new Body({ kind: SPHERE, r: 0.05 }, { mass: 0.17, restitution: 0.25, friction: 0.5, rolling: 0.12, linDamp: 0.05, tag: 'skee' }), this.ballSet, cc[i]);
    this.points = 0;
    this.laneA = a; this.laneZ0 = z0; this.laneY0 = y0;
    this.targetsOut = [fr.toWorld(0, 1.0, -2.95)];
    this.resetRound();
  }
  trayPose(i, p, q) {
    // resting against the end cap, along the lane surface
    const z = 0.33, y = this.laneY0 + (this.laneZ0 - z) * Math.tan(this.laneA) / 1 + 0.05 / Math.cos(this.laneA) + 0.0005;
    this.frame.toWorld(-0.25 + i * 0.1, y, z, p); q.copy(this.frame.q);
  }
  resetTargets() { this.points = 0; this.sunk = 0; }
  liveScore() { return this.points; }
  scoreText() { return `Points ${this.points}`; }
  ticketsFor(s) { return Math.floor(s / 30); }
  resultText(s) { return `${s} points`; }
  get bigWin() { return 8; }
  updateGame(dt, t) {
    const fr = this.frame;
    for (const p of this.projectiles) {
      const u = p.user;
      if (p.held || !p.enabled || u.spent) continue;
      fr.toLocal(p.pos, _v);
      // rolled back down to the player: allow a re-roll
      if (u.inPlay && _v.z > -0.6 && _v.y < 1.0) { u.inPlay = false; u.released = false; }
      // gutter / fell behind the target
      if (_v.z < -3.1 && _v.y < 0.75 && Math.abs(_v.x) < 0.5) { this.sink(p, 0); continue; }
      // target board coordinates
      const dz = this.tz0 - _v.z, dy = _v.y - this.ty0;
      const along = dz * Math.cos(this.tA) + dy * Math.sin(this.tA);
      const h = -dz * Math.sin(this.tA) + dy * Math.cos(this.tA);
      if (along > 0 && along < this.tLen && h < 0.05 + 0.02 && Math.abs(_v.x) < 0.45) {
        for (const hole of this.holes) {
          const du = _v.x - hole.u, dv = along - hole.v;
          if (du * du + dv * dv < (hole.r - 0.012) ** 2) { this.sink(p, hole.pts); break; }
        }
      }
    }
  }
  sink(p, pts) {
    const u = p.user;
    u.spent = true; u.inPlay = true; p.enabled = false; p.hidden = true;
    this.points += pts;
    if (pts > 0) {
      this.game.sounds.score(p.pos, pts / 10); this.game.fireworks.confetti(p.pos.x, p.pos.y, p.pos.z, 12 + pts / 4);
      u.thrower?.haptic(0.6, 40);
      if (pts >= 50) this.operator.say(pts >= 100 ? 'A hundred! Amazing!' : 'Fifty! Lovely roll!', 2.2);
    } else this.game.sounds.thud(p.pos, 2);
    if (this.state === 'idle') this.state = 'playing';
    this.lastThrowT = this.game.time;
    this.panel.markDirty();
  }
  onImpact(ev, body, other, speed) { this.game.sounds.wood(ev, speed); }
}

// ═════════════════════════════════════════════════════════════
// 6. Lucky Bowls: toss coins into bowls floating on a pond
// ═════════════════════════════════════════════════════════════
export class CoinStall extends Stall {
  constructor(game, o) {
    super(game, { id: 'coins', name: 'Lucky Bowls', cn: '投钱', color: 0x0f5a6a, accent: 0xffd060, rules: 'Six coins. Blue bowls 1, red 2, gold 3 tickets. Coins in the water sink!',
      lines: ['A coin in the bowl brings luck!', 'Toss it soft, like a feather!', 'The gold bowl pays triple!'], op: { robe: 0xa03050, hat: 'bun' }, ...o });
    this.projKind = 'Coin';
    const fr = this.frame, F = fr.m, L = game.lit;
    const pc = new THREE.Vector3(0, 0, -2.4), PR = 1.3;
    this.pondC = fr.toWorld(pc.x, 0, pc.z); this.PR = PR;
    this.waterY = 0.3;
    // stone rim: 18 segments
    const segs = 18;
    for (let i = 0; i < segs; i++) {
      const a = (i + 0.5) / segs * Math.PI * 2;
      const x = pc.x + Math.cos(a) * (PR + 0.08), z = pc.z + Math.sin(a) * (PR + 0.08);
      const w = 2 * Math.PI * (PR + 0.08) / segs + 0.03;
      L.box(F, x, 0.2, z, 0.18, 0.4, w, (i % 2) ? 0x6a6a70 : 0x5a5a62, 0, -a, 0);
      staticBox(game, fr, x, 0.2, z, 0.18, 0.4, w, { ry: -a });
    }
    // pond floor + lotus pads
    L.cyl(F, pc.x, 0.01, pc.z, PR, PR, 0.02, 0x0a2a2a, 24);
    for (let i = 0; i < 7; i++) {
      const a = i * 2.4 + 0.3, rr = 0.5 + (i % 3) * 0.25;
      L.cyl(F, pc.x + Math.cos(a) * rr, this.waterY + 0.005, pc.z + Math.sin(a) * rr, 0.12, 0.12, 0.01, 0x2a7a3a, 10);
      if (i % 3 === 0) L.sphere(F, pc.x + Math.cos(a) * rr, this.waterY + 0.04, pc.z + Math.sin(a) * rr, 0.04, 0.05, 0.04, 0xff90c0, 6);
    }
    // water
    const water = new THREE.Mesh(new THREE.CircleGeometry(PR, 32), game.mats.water);
    water.rotation.x = -Math.PI / 2; water.position.set(this.pondC.x, this.waterY, this.pondC.z);
    game.scene.add(water);
    // koi under the water
    const koiGeo = new THREE.SphereGeometry(0.06, 8, 6); koiGeo.scale(0.6, 0.35, 1.6);
    this.koi = new THREE.InstancedMesh(koiGeo, game.mats.koi, 4);
    this.koi.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 4; i++) this.koi.setColorAt(i, new THREE.Color([0xff7020, 0xffffff, 0xff4010, 0xffc060][i]));
    game.scene.add(this.koi);
    // bowls
    const prof = [];
    for (const [r, y] of [[0, -0.035], [0.7, -0.035], [0.92, -0.01], [1, 0.035], [0.9, 0.035], [0.8, 0.0], [0, 0.0]]) prof.push(new THREE.Vector2(r, y));
    const bowlGeo = new THREE.LatheGeometry(prof, 20);
    this.bowlMesh = new THREE.InstancedMesh(bowlGeo, game.mats.bowl, 5);
    this.bowlMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bowls = [];
    const defs = [{ R: 0.15, v: 1, c: 0xe8f0ff, rho: 0.75, w: 0.18 }, { R: 0.15, v: 1, c: 0xd8e8ff, rho: 0.45, w: -0.25 }, { R: 0.14, v: 1, c: 0xe0f0ff, rho: 0.9, w: 0.12 },
      { R: 0.12, v: 2, c: 0xff5040, rho: 0.5, w: 0.22 }, { R: 0.095, v: 3, c: 0xffc830, rho: 0.85, w: -0.15 }];
    defs.forEach((d, i) => {
      const body = staticShape(game, fr, { kind: CUP, R: d.R, hh: 0.035, t: 0.012, depth: 0.035 }, 0, 0, 0, { restitution: 0.15, friction: 0.7, tag: 'bowl' });
      body.bound = Math.hypot(d.R, 0.035); body.moving = true;
      this.bowls.push({ ...d, body, a0: i * 1.3 });
      this.bowlMesh.setColorAt(i, new THREE.Color(d.c));
    });
    game.scene.add(this.bowlMesh);
    // coins
    const cg = coinGeometry();
    this.coinSet = new PropSet(game.scene, cg, game.mats.coin, 6);
    for (let i = 0; i < 6; i++) {
      const c = this.addProjectile(new Body({ kind: CYL, r: 0.017, hh: 0.0025 }, { mass: 0.01, restitution: 0.3, friction: 0.5, rolling: 0.3, rimSamples: 10, angDamp: 0.3, tag: 'coin' }), this.coinSet, 0xffffff);
      c.user.coin = true;
    }
    this.time = 0;
    this.updateBowls(0, 0.016);
    this.resetRound();
    // water drag on sinking coins
    game.substepHooks.push((dt) => {
      for (const c of this.projectiles) {
        if (c.held || !c.enabled || c.sleeping) continue;
        if (c.pos.y < this.waterY && this.inPond(c.pos)) {
          if (!c.user.wet) { c.user.wet = true; this.splashQueue = c; }
          const k = Math.max(0, 1 - 7 * dt);
          c.vel.multiplyScalar(k); c.angVel.multiplyScalar(k); c.vel.y += 8.6 * dt;
        }
      }
    });
  }
  inPond(p) { const dx = p.x - this.pondC.x, dz = p.z - this.pondC.z; return dx * dx + dz * dz < this.PR * this.PR; }
  trayPose(i, p, q) { this.frame.toWorld(-0.6 + i * 0.24, 1.0 + 0.0026, -0.24, p); q.copy(this.frame.q); }
  returnToTray(b) { super.returnToTray(b); b.user.wet = false; }
  updateBowls(t, dt) {
    const m = _m4, s = _v2;
    this.bowls.forEach((b, i) => {
      const a = b.a0 + t * b.w;
      const x = this.pondC.x + Math.cos(a) * b.rho, z = this.pondC.z + Math.sin(a) * b.rho;
      const y = this.waterY + 0.012 + Math.sin(t * 1.7 + i) * 0.006;
      const body = b.body;
      body.vel.set((x - body.pos.x) / Math.max(dt, 1e-3), (y - body.pos.y) / Math.max(dt, 1e-3), (z - body.pos.z) / Math.max(dt, 1e-3));
      if (body.vel.lengthSq() > 1) body.vel.set(0, 0, 0);
      body.pos.set(x, y, z);
      m.compose(body.pos, body.quat, s.set(b.R, 1, b.R));
      this.bowlMesh.setMatrixAt(i, m);
    });
    this.bowlMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 4; i++) {
      const a = t * (0.3 + i * 0.07) + i * 1.6, rr = 0.4 + i * 0.18;
      const x = this.pondC.x + Math.cos(a) * rr, z = this.pondC.z + Math.sin(a) * rr;
      m.makeRotationY(-a + Math.sin(t * 3 + i) * 0.2).setPosition(x, this.waterY - 0.07, z);
      this.koi.setMatrixAt(i, m);
    }
    this.koi.instanceMatrix.needsUpdate = true;
  }
  bowlOf(c) {
    for (const b of this.bowls) {
      const dx = c.pos.x - b.body.pos.x, dz = c.pos.z - b.body.pos.z, dy = c.pos.y - b.body.pos.y;
      if (dx * dx + dz * dz < (b.R - 0.01) ** 2 && dy > -0.02 && dy < 0.06) return b;
    }
    return null;
  }
  liveScore() { let s = 0; for (const c of this.projectiles) if (!c.held && c.user.inPlay && !c.user.wet) { const b = this.bowlOf(c); if (b && c.vel.lengthSq() < 0.3) s += b.v; } return s; }
  scoreText() { return `Lucky ${this.liveScore()}`; }
  isRested(p, t) { return super.isRested(p, t) || (p.user.wet && p.pos.y < 0.1) || (!!this.bowlOf(p) && t - p.user.thrownAt > 1.5); }
  ticketsFor(s) { return s; }
  resultText(s) { return `${s} luck point${s === 1 ? '' : 's'}`; }
  get bigWin() { return 5; }
  updateGame(dt, t) {
    this.time += dt;
    this.updateBowls(this.time, dt);
    if (this.splashQueue) { this.game.sounds.splash(this.splashQueue.pos); this.game.fireworks.confetti(this.splashQueue.pos.x, this.waterY, this.splashQueue.pos.z, 8, [0.4, 0.7, 1]); this.splashQueue = null; }
    const s = this.liveScore();
    if (s !== this._ls) { if (s > (this._ls ?? 0)) { this.game.sounds.score(this.pondC); this.operator.say('Lucky coin!', 1.8); } this._ls = s; this.panel.markDirty(); }
  }
  resetTargets() { this._ls = 0; }
  aimTargets() { this.targetsOut.length = 0; for (const b of this.bowls) this.targetsOut.push(b.body.pos); return this.targetsOut; }
  onImpact(ev, body, other, speed) { if (other?.tag === 'bowl') this.game.sounds.clink(ev, speed); else this.game.sounds.coin(ev, speed); }
}

// ── prop geometries ──────────────────────────────────────────
function mergeTwo(a, b) {
  const A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b;
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const x = A.attributes[name], y = B.attributes[name];
    const arr = new Float32Array(x.array.length + y.array.length); arr.set(x.array); arr.set(y.array, x.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return g;
}
function tinGeometry(r, hh) {
  const g = new THREE.CylinderGeometry(r, r, hh * 2, 18, 1, false);
  return g;
}
function beanbagGeometry() {
  const g = new THREE.SphereGeometry(0.056, 12, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.08 * Math.sin(x * 60) * Math.sin(z * 50);
    p.setXYZ(i, x * k, y * 0.78 - 0.004, z * k);
  }
  g.computeVertexNormals();
  return g;
}
function dartGeometry() {
  // tip at z = -0.012, tail toward +Z; vertex colours: steel tip, body, coloured flights
  const b = new Builder();
  b.cone(null, 0, 0, -0.02, 0.004, 0.03, 0xd0d0d8, 6, -Math.PI / 2, 0, 0);
  b.cyl(null, 0, 0, 0.03, 0.007, 0.006, 0.08, 0xffffff, 8, Math.PI / 2, 0, 0);
  b.cyl(null, 0, 0, 0.085, 0.003, 0.003, 0.04, 0x303030, 4, Math.PI / 2, 0, 0);
  b.box(null, 0, 0, 0.1, 0.05, 0.002, 0.045, 0xffffff);
  b.box(null, 0, 0, 0.1, 0.002, 0.05, 0.045, 0xffffff);
  return b.geometry();
}
function coinGeometry() {
  const g = new THREE.CylinderGeometry(0.017, 0.017, 0.005, 16, 1);
  return g;
}
function skeeBoardTexture(holes, w, h) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const x = c.getContext('2d'), sx = c.width / w, sy = c.height / h;
  x.fillStyle = '#5a2a6a'; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = '#ffd060'; x.lineWidth = 6; x.strokeRect(3, 3, c.width - 6, c.height - 6);
  const cxp = c.width / 2;
  for (const [r, col] of [[0.43, '#7a3a8a'], [0.34, '#9a4aa0'], [0.25, '#b85ab0'], [0.16, '#d070c0']]) {
    x.fillStyle = col; x.beginPath(); x.ellipse(cxp, (h - 0.82) * sy, r * sx, r * sy * 1.25, 0, 0, Math.PI * 2); x.fill();
  }
  for (const hole of holes) {
    const px = cxp + hole.u * sx, py = (h - hole.v) * sy;
    x.fillStyle = '#ffd060'; x.beginPath(); x.arc(px, py, (hole.r + 0.012) * sx, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#0a0508'; x.beginPath(); x.arc(px, py, hole.r * sx, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff2c0'; x.font = `bold ${hole.pts >= 100 ? 34 : 38}px ${FONTS.sans}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(hole.pts), px, py - (hole.r + 0.045) * sy);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
