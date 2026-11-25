import * as THREE from 'three';
import { Panel, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { Builder, Frame } from './env.js';
import { Operator } from './npc.js';
import { drawSign, staticBox } from './stalls.js';

// Prize catalogue: tickets buy plush toys and lanterns that then live on the home shelf.
export const PRIZES = [
  { id: 'lantern', name: 'Paper Lantern', cost: 5 },
  { id: 'rabbit', name: 'Jade Rabbit', cost: 8 },
  { id: 'koi', name: 'Koi Plush', cost: 12 },
  { id: 'tiger', name: 'Tiger Cub', cost: 18 },
  { id: 'panda', name: 'Panda Plush', cost: 25 },
  { id: 'cat', name: 'Lucky Cat', cost: 40 },
  { id: 'dragon', name: 'Dragon Plush', cost: 60 },
];

const cache = new Map();
export function prizeGeometry(id) {
  if (cache.has(id)) return cache.get(id);
  const b = new Builder();
  switch (id) {
    case 'lantern':
      b.sphere(null, 0, 0.13, 0, 0.1, 0.11, 0.1, 0xff3020, 12);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI; b.box(null, 0, 0.13, 0, 0.004, 0.2, 0.205, 0xa01810, 0, a, 0); }
      b.cyl(null, 0, 0.03, 0, 0.05, 0.05, 0.03, 0xffc040, 10); b.cyl(null, 0, 0.235, 0, 0.045, 0.045, 0.03, 0xffc040, 10);
      b.cyl(null, 0, 0.275, 0, 0.004, 0.004, 0.06, 0x402010, 4);
      b.cyl(null, 0, -0.02, 0, 0.012, 0.004, 0.08, 0xffc040, 6);
      break;
    case 'rabbit':
      b.sphere(null, 0, 0.07, 0, 0.07, 0.07, 0.065, 0x9fe0b8, 10);
      b.sphere(null, 0, 0.165, 0.01, 0.05, 0.05, 0.05, 0xb0f0c8, 10);
      for (const s of [-1, 1]) { b.sphere(null, s * 0.022, 0.25, 0, 0.014, 0.05, 0.012, 0xb0f0c8, 6); b.sphere(null, s * 0.02, 0.175, 0.052, 0.008, 0.009, 0.004, 0x103020, 6); }
      b.sphere(null, 0, 0.155, 0.058, 0.008, 0.006, 0.004, 0xff80a0, 6);
      b.sphere(null, 0, 0.06, -0.07, 0.025, 0.025, 0.025, 0xffffff, 6);
      break;
    case 'koi':
      b.sphere(null, 0, 0.09, 0, 0.06, 0.07, 0.14, 0xfff4ee, 12);
      b.sphere(null, 0.0, 0.12, 0.02, 0.05, 0.05, 0.08, 0xff6020, 10);
      b.sphere(null, 0.0, 0.08, -0.07, 0.045, 0.04, 0.05, 0xff6020, 8);
      b.cone(null, 0, 0.09, -0.17, 0.06, 0.08, 0xff6020, 6, -Math.PI / 2, 0, 0);
      for (const s of [-1, 1]) b.sphere(null, s * 0.045, 0.11, 0.1, 0.012, 0.012, 0.01, 0x101010, 6);
      b.cyl(null, 0, 0.02, 0, 0.04, 0.05, 0.04, 0x8a5a30, 8);
      break;
    case 'tiger':
      b.sphere(null, 0, 0.075, 0, 0.08, 0.075, 0.07, 0xffa030, 10);
      b.sphere(null, 0, 0.185, 0.01, 0.065, 0.06, 0.06, 0xffa030, 10);
      b.sphere(null, 0, 0.17, 0.06, 0.032, 0.025, 0.02, 0xfff0e0, 8);
      for (const s of [-1, 1]) {
        b.sphere(null, s * 0.045, 0.24, 0, 0.02, 0.02, 0.012, 0xffa030, 6);
        b.sphere(null, s * 0.025, 0.2, 0.055, 0.009, 0.01, 0.005, 0x101010, 6);
        b.sphere(null, s * 0.05, 0.02, 0.04, 0.025, 0.02, 0.03, 0xffa030, 6);
      }
      for (let i = 0; i < 3; i++) b.box(null, 0, 0.06 + i * 0.03, 0.06, 0.1, 0.008, 0.02, 0x201008);
      b.box(null, 0, 0.235, 0.05, 0.01, 0.03, 0.01, 0x201008);
      break;
    case 'panda':
      b.sphere(null, 0, 0.08, 0, 0.085, 0.08, 0.075, 0xf4f4f0, 10);
      b.sphere(null, 0, 0.2, 0.01, 0.07, 0.065, 0.065, 0xf8f8f4, 10);
      for (const s of [-1, 1]) {
        b.sphere(null, s * 0.055, 0.26, 0, 0.022, 0.022, 0.015, 0x181818, 6);
        b.sphere(null, s * 0.028, 0.21, 0.052, 0.018, 0.022, 0.01, 0x181818, 6);
        b.sphere(null, s * 0.075, 0.1, 0.02, 0.025, 0.045, 0.03, 0x181818, 6);
        b.sphere(null, s * 0.045, 0.02, 0.05, 0.03, 0.022, 0.035, 0x181818, 6);
      }
      b.sphere(null, 0, 0.185, 0.066, 0.01, 0.007, 0.005, 0x181818, 6);
      break;
    case 'cat':
      b.cyl(null, 0, 0.09, 0, 0.065, 0.08, 0.17, 0xfff8f0, 12);
      b.sphere(null, 0, 0.215, 0.0, 0.075, 0.065, 0.065, 0xfff8f0, 10);
      for (const s of [-1, 1]) { b.cone(null, s * 0.045, 0.285, 0, 0.022, 0.04, 0xfff8f0, 5); b.box(null, s * 0.028, 0.225, 0.06, 0.025, 0.005, 0.005, 0x201010); }
      b.cyl(null, 0.075, 0.24, 0.0, 0.02, 0.022, 0.09, 0xfff8f0, 8);  // raised paw
      b.sphere(null, 0.075, 0.29, 0, 0.022, 0.022, 0.022, 0xffe0e0, 6);
      b.cyl(null, 0, 0.13, 0.065, 0.04, 0.04, 0.012, 0xffc030, 12, Math.PI / 2, 0, 0); // gold coin
      b.cyl(null, 0, 0.16, 0.03, 0.07, 0.07, 0.012, 0xd02020, 12);      // collar
      b.sphere(null, 0, 0.152, 0.075, 0.012, 0.012, 0.012, 0xffd040, 6);
      break;
    case 'dragon': {
      for (let i = 0; i < 7; i++) { const a = i / 6; b.sphere(null, Math.sin(a * 5) * 0.06, 0.05 + a * 0.12, -0.12 + a * 0.2, 0.05 - a * 0.012, 0.05 - a * 0.012, 0.05, i % 2 ? 0x3ab05a : 0x2a9a4a, 8); }
      b.box(null, 0.0, 0.24, 0.12, 0.09, 0.08, 0.1, 0x3ab05a); b.box(null, 0, 0.225, 0.18, 0.07, 0.05, 0.06, 0x3ab05a);
      for (const s of [-1, 1]) { b.cone(null, s * 0.03, 0.3, 0.1, 0.012, 0.06, 0xffc040, 5); b.sphere(null, s * 0.03, 0.255, 0.165, 0.012, 0.012, 0.01, 0xffffff, 6); }
      b.cone(null, 0, 0.12, -0.2, 0.04, 0.08, 0xffc040, 5, -1.2, 0, 0);
      for (let i = 0; i < 4; i++) b.cone(null, 0, 0.12 + i * 0.035, -0.06 + i * 0.05, 0.015, 0.04, 0xff5030, 4);
      break;
    }
  }
  const g = b.geometry();
  cache.set(id, g);
  return g;
}

// Prize counter at the end of the street: panel with buy buttons + display shelf.
export class PrizeCounter {
  constructor(game, x, z, yaw) {
    this.game = game;
    const fr = this.frame = new Frame(x, z, yaw), F = fr.m, L = game.lit;
    const wood = 0x6a4128;
    L.box(F, 0, 0.006, -1.2, 3.8, 0.012, 2.5, 0x4a3426);
    L.box(F, 0, 0.5, -0.3, 3.2, 1.0, 0.6, wood);
    L.box(F, 0, 1.02, -0.3, 3.3, 0.04, 0.66, 0x8a5a36);
    for (let i = 0; i < 8; i++) L.box(F, -1.4 + i * 0.4, 0.55, 0.005, 0.3, 0.6, 0.01, i % 2 ? 0xc0261d : 0xe2b85c);
    for (const sx of [-1, 1]) { L.box(F, sx * 1.9, 1.5, -1.2, 0.1, 3.0, 2.6, 0x7a1a14); L.box(F, sx * 1.85, 1.45, 0.15, 0.14, 2.9, 0.14, 0xa8261c); }
    L.box(F, 0, 1.5, -2.45, 3.8, 3.0, 0.1, 0x5a1410);
    // display shelves with one of each prize
    for (let t = 0; t < 2; t++) L.box(F, 0.35, 1.25 + t * 0.55, -2.2, 2.6, 0.04, 0.4, 0x8a5a36);
    this.display = [];
    PRIZES.forEach((p, i) => {
      const tier = i < 4 ? 0 : 1, n = tier === 0 ? 4 : 3, k = tier === 0 ? i : i - 4;
      const lx = 0.35 + (k - (n - 1) / 2) * 0.62, ly = 1.27 + tier * 0.55;
      const m = new THREE.Mesh(prizeGeometry(p.id), game.mats.prize);
      fr.toWorld(lx, ly, -2.15, m.position); m.quaternion.copy(fr.q); m.scale.setScalar(1.6);
      game.scene.add(m); this.display.push(m);
      const row = game.signs.add((c, W, H) => {
        c.fillStyle = '#fff3d8'; c.fillRect(0, 0, W, H); c.strokeStyle = '#c0261d'; c.lineWidth = 10; c.strokeRect(5, 5, W - 10, H - 10);
        c.fillStyle = '#3a1a10'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, `${p.name} · ${p.cost} tickets`, W / 2, H / 2 + 4, W - 40, 70, FONTS.sans);
      });
      game.signs.plane(F, lx, ly - 0.04, -1.99, 0.52, 0.065, row);
    });
    // canopy and sign
    for (let i = 0; i < 8; i++) L.box(F, -1.95 + (i + 0.5) * 3.9 / 8, 3.05, -1.1, 3.9 / 8, 0.04, 2.9, i % 2 ? 0xf1e6cf : 0xc0261d, -0.08);
    L.box(F, 0, 2.45, 0.2, 3.0, 0.6, 0.06, 0x2a1008);
    const row = game.signs.add((c, W, H) => drawSign(c, W, H, '奖品', 'Prize Counter', 0xc0261d, 0xffd060));
    game.signs.plane(F, 0, 2.45, 0.235, 2.9, 0.3625, row);
    const lp = fr.toWorld(0, 2.6, -1.5);
    game.lamps.push({ x: lp.x, y: lp.y, z: lp.z, color: new THREE.Color(1, 0.7, 0.4), intensity: 1.8, range: 6 });
    game.lamps.push({ ...fr.toWorld(0.3, 2.2, -1.5), color: new THREE.Color(1, 0.75, 0.5), intensity: 1.2, range: 3 });
    game.addLight(fr.toWorld(0.3, 2.3, -1.2), 0xffc080, 4, 5);
    for (let i = 0; i <= 10; i++) game.bulbs.push(fr.toWorld(-1.9 + i * 0.38, 2.75 - Math.sin(i / 10 * Math.PI) * 0.06, 0.25));
    game.lanterns.push({ p: fr.toWorld(-1.85, 2.3, 0.3), s: 1.2 }, { p: fr.toWorld(1.85, 2.3, 0.3), s: 1.2 });
    this.operator = new Operator(game.scene, fr, 1.35, -0.75, { robe: 0xd0a020, hat: 'cap', trim: 0xc0261d }, game.mats.figure);
    this.operator.say('Trade your tickets for treasures!', 5);
    this.barkT = 10;
    this.flash = '';
    // shop panel
    this.panel = new Panel({
      width: 1.1, height: 0.8, px: 1100,
      draw: (c, W, H, p) => {
        roundRect(c, 4, 4, W - 8, H - 8, 30); c.fillStyle = 'rgba(24,12,18,0.94)'; c.fill(); c.lineWidth = 6; c.strokeStyle = '#e2b85c'; c.stroke();
        c.fillStyle = '#e2b85c'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = `76px ${FONTS.brush}`; c.fillText('奖品', 36, 96);
        c.fillStyle = '#f1e6cf'; c.font = `600 46px ${FONTS.sans}`; c.fillText('Prize Counter', 200, 88);
        c.textAlign = 'right'; c.fillStyle = '#ffd060'; c.font = `700 52px ${FONTS.sans}`; c.fillText(`${game.data.tickets} tickets`, W - 40, 90);
        const rowH = 92, y0 = 130;
        PRIZES.forEach((pr, i) => {
          const y = y0 + i * rowH, own = game.data.prizes.filter(x => x === pr.id).length;
          c.textAlign = 'left'; c.fillStyle = '#f1e6cf'; c.font = `40px ${FONTS.sans}`; c.fillText(pr.name, 40, y + 56);
          c.fillStyle = '#a8a0c0'; c.font = `30px ${FONTS.sans}`; c.fillText(own ? `owned ×${own}` : '', 420, y + 56);
          const can = game.data.tickets >= pr.cost;
          p.button('buy-' + pr.id, W - 330, y + 10, 290, rowH - 18, `${pr.cost} tickets`, () => this.buy(pr), { size: 36, bg: can ? '#3a5a1a' : '#2a2430', border: can ? '#e2b85c' : '#6a6070', fg: can ? '#f1e6cf' : '#8a8090' });
        });
        c.textAlign = 'center'; c.fillStyle = '#ffd060'; c.font = `34px ${FONTS.sans}`;
        c.fillText(this.flash || 'Prizes go to your shelf by the entrance gate.', W / 2, H - 34);
      },
    });
    this.panel.mesh.position.copy(fr.toWorld(-1.05, 1.5, -0.1));
    this.panel.mesh.quaternion.copy(fr.quat(-0.1, 0.35, 0));
    game.scene.add(this.panel.mesh);
    game.pointer.panels.push(this.panel);
    staticBox(game, fr, 0, 0.52, -0.3, 3.3, 1.04, 0.66);
  }
  buy(pr) {
    const g = this.game;
    if (g.data.tickets < pr.cost) { g.sounds.denied(); this.flash = `You need ${pr.cost - g.data.tickets} more tickets for the ${pr.name}.`; this.operator.say('Win a few more games first!', 3); this.panel.markDirty(); return false; }
    g.data.tickets -= pr.cost;
    g.data.prizes.push(pr.id);
    g.persist();
    g.sounds.register();
    g.home.rebuild();
    this.flash = `${pr.name} is waiting on your shelf!`;
    this.operator.say(`Enjoy your ${pr.name}!`, 3.5);
    g.celebrate(this.frame.toWorld(0, 2.6, -1), false);
    g.ticketsChanged();
    this.panel.markDirty();
    return true;
  }
  update(dt, t, head) {
    const d = this.operator.update(dt, t, head);
    this.barkT -= dt;
    if (this.barkT <= 0) { this.barkT = 18 + Math.random() * 10; if (d < 6) this.operator.say(['Plush tigers! Lucky cats!', 'Dragons for the brave!', 'Every ticket counts!'][(Math.random() * 3) | 0], 4); }
    for (let i = 0; i < this.display.length; i++) this.display[i].rotation.y = this.frame.yaw + Math.sin(t * 0.6 + i) * 0.4;
  }
}

// Home corner shelf: owned prizes appear here (saved with ctx.save).
export class HomeShelf {
  constructor(game, x, z, yaw) {
    this.game = game;
    const fr = this.frame = new Frame(x, z, yaw), F = fr.m, L = game.lit;
    // rug, shelf unit, little lantern
    L.box(F, 0, 0.005, 0.0, 1.6, 0.01, 1.0, 0x7a2030);
    L.box(F, 0, 0.007, 0.0, 1.4, 0.01, 0.8, 0xc08a30);
    const W = 1.6, tiers = 3;
    for (const sx of [-1, 1]) L.box(F, sx * W / 2, 0.85, -0.55, 0.05, 1.7, 0.4, 0x5a3420);
    L.box(F, 0, 0.85, -0.74, W, 1.7, 0.02, 0x3a2016);
    for (let t = 0; t <= tiers; t++) L.box(F, 0, 0.1 + t * 0.5, -0.55, W, 0.04, 0.4, 0x8a5a36);
    L.box(F, 0, 1.72, -0.55, W + 0.1, 0.05, 0.45, 0x6a3a22);
    const row = game.signs.add((c, Wc, H) => drawSign(c, Wc, H, '我的', 'My Prize Shelf', 0x7a2030, 0xffd060));
    game.signs.plane(F, 0, 1.95, -0.6, 1.6, 0.2, row);
    game.lamps.push({ ...fr.toWorld(0, 2.0, 0.2), color: new THREE.Color(1, 0.7, 0.45), intensity: 1.3, range: 3.2 });
    game.lanterns.push({ p: fr.toWorld(-0.9, 2.1, -0.3), s: 0.9 }, { p: fr.toWorld(0.9, 2.1, -0.3), s: 0.9 });
    this.slots = [];
    for (let t = tiers - 1; t >= 0; t--) for (let i = 0; i < 5; i++) this.slots.push(fr.toWorld(-0.6 + i * 0.3, 0.12 + t * 0.5, -0.5)); // top tier first
    this.meshes = [];
    this.label = null;
    this.rebuild();
  }
  rebuild() {
    const g = this.game;
    for (const m of this.meshes) m.removeFromParent();
    this.meshes = [];
    const list = g.data.prizes;
    const shown = list.slice(-this.slots.length);
    shown.forEach((id, i) => {
      const m = new THREE.Mesh(prizeGeometry(id), g.mats.prize);
      m.position.copy(this.slots[i]); m.quaternion.copy(this.frame.q); m.scale.setScalar(1.25);
      g.scene.add(m); this.meshes.push(m);
    });
    this.count = list.length;
  }
}
