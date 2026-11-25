import * as THREE from 'three';
import { makeCanvas, canvasTexture, roundRect, fitText, FONT_BRUSH, FONT_SERIF, FONT_LATIN } from './util.js';
import { audio } from './audio.js';

export const PAL = {
  lacquer: '#1c1411', lacquer2: '#2a1d17', gold: '#e2b85c', goldDim: '#8f7440',
  paper: '#f1e6cf', ink: '#1a1210', red: '#c0261d', redDim: '#6e1913', jade: '#6fbf98', dim: '#a8977a',
};

// A flat canvas-textured board in the world with clickable buttons.
export class Panel {
  constructor(ui, { width, height, px = 1024, draw }) {
    this.ui = ui;
    this.W = px; this.H = Math.round(px * height / width);
    this.canvas = makeCanvas(this.W, this.H);
    this.ctx = this.canvas.getContext('2d');
    this.tex = canvasTexture(this.canvas);
    this.drawFn = draw;
    this.buttons = [];
    this.hover = null;
    this.dirty = true;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false }));
    this.mesh.userData.panel = this;
    ui.panels.push(this);
  }
  markDirty() { this.dirty = true; }
  redraw() {
    if (!this.dirty) return;
    this.dirty = false;
    this.buttons = [];
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.drawFn(this.ctx, this.W, this.H, this);
    this.tex.needsUpdate = true;
  }
  // Called from draw functions: draws and registers a button.
  button(id, x, y, w, h, { cn, en, enabled = true, active = false, onClick }) {
    const c = this.ctx, hov = this.hover === id && enabled;
    roundRect(c, x, y, w, h, h * 0.18);
    c.fillStyle = active ? PAL.red : hov ? '#4a332a' : PAL.lacquer2; c.fill();
    c.lineWidth = hov || active ? 4 : 2; c.strokeStyle = enabled ? PAL.gold : PAL.goldDim; c.stroke();
    c.fillStyle = enabled ? (active ? PAL.paper : PAL.gold) : PAL.goldDim;
    c.textBaseline = 'middle';
    if (en) {
      fitText(c, cn, x + w / 2, y + h * 0.4, w - 16, h * 0.42, FONT_BRUSH);
      c.fillStyle = enabled ? PAL.paper : PAL.dim;
      fitText(c, en, x + w / 2, y + h * 0.78, w - 16, h * 0.2, FONT_LATIN);
    } else fitText(c, cn, x + w / 2, y + h / 2 + 2, w - 16, h * 0.5, FONT_BRUSH);
    this.buttons.push({ id, x, y, w, h, enabled, onClick });
  }
  buttonAt(uv) {
    const px = uv.x * this.W, py = (1 - uv.y) * this.H;
    return this.buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) ?? null;
  }
}

// Board backing: lacquered wood frame with a gold border, drawn in canvas.
export function drawBoard(c, W, H, title, sub) {
  roundRect(c, 0, 0, W, H, 28); c.fillStyle = PAL.lacquer; c.fill();
  c.lineWidth = 10; c.strokeStyle = PAL.redDim; c.stroke();
  roundRect(c, 14, 14, W - 28, H - 28, 20); c.lineWidth = 3; c.strokeStyle = PAL.gold; c.stroke();
  // fretwork corners
  c.strokeStyle = PAL.goldDim; c.lineWidth = 3;
  for (const [x, y, sx, sy] of [[30, 30, 1, 1], [W - 30, 30, -1, 1], [30, H - 30, 1, -1], [W - 30, H - 30, -1, -1]]) {
    c.beginPath(); c.moveTo(x, y + sy * 50); c.lineTo(x, y); c.lineTo(x + sx * 50, y);
    c.moveTo(x + sx * 12, y + sy * 36); c.lineTo(x + sx * 12, y + sy * 12); c.lineTo(x + sx * 36, y + sy * 12); c.stroke();
  }
  if (title) {
    c.fillStyle = PAL.gold; c.textBaseline = 'middle';
    fitText(c, title, W / 2, 78, W - 160, 76, FONT_BRUSH);
    if (sub) { c.fillStyle = PAL.dim; fitText(c, sub, W / 2, 130, W - 160, 28, FONT_LATIN); }
  }
}

export class UIManager {
  constructor(scene) {
    this.scene = scene;
    this.panels = [];
    this.raycaster = new THREE.Raycaster();
    this.hoverPanel = null;
    this.popups = [];
    this._initPopups();
    // Laser pointer
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.8 }));
    this.laser.frustumCulled = false; this.laser.visible = false;
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe080 }));
    this.dot.visible = false;
    scene.add(this.laser, this.dot);
  }

  // Returns { panel, button, point } for a ray, or null.
  pick(origin, dir, maxDist = 8) {
    this.raycaster.set(origin, dir); this.raycaster.far = maxDist;
    const meshes = this.panels.filter(p => p.mesh.visible && p.mesh.parent).map(p => p.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const panel = hit.object.userData.panel;
    return { panel, button: panel.buttonAt(hit.uv), point: hit.point, distance: hit.distance };
  }

  // Update hover state + laser from a ray; returns the pick.
  pointer(origin, dir, showLaser) {
    const p = this.pick(origin, dir);
    const newHover = p?.button?.enabled ? p.button.id : null;
    for (const panel of this.panels) {
      const h = p && p.panel === panel ? newHover : null;
      if (panel.hover !== h) { if (h) audio.uiHover(); panel.hover = h; panel.markDirty(); }
    }
    if (showLaser && p) {
      this.laser.visible = true; this.dot.visible = true;
      this.laser.position.copy(origin);
      this.laser.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
      this.laser.scale.setScalar(p.distance);
      this.dot.position.copy(p.point);
    } else { this.laser.visible = false; this.dot.visible = false; }
    return p;
  }
  click(p) {
    if (p?.button?.enabled && p.button.onClick) { audio.uiClick(); p.button.onClick(); for (const pn of this.panels) pn.markDirty(); return true; }
    return false;
  }
  hideLaser() { this.laser.visible = false; this.dot.visible = false; }
  update(dt, camPos) {
    for (const p of this.panels) p.redraw();
    this._updatePopups(dt, camPos);
  }
  markAllDirty() { for (const p of this.panels) p.markDirty(); }

  // ── Floating score popups ───────────────────────────────────
  _initPopups() {
    for (let i = 0; i < 14; i++) {
      const c = makeCanvas(512, 256);
      const tex = canvasTexture(c, { mips: false });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      s.renderOrder = 100; s.visible = false;
      this.scene.add(s);
      this.popups.push({ s, c, tex, life: 0, max: 1, vel: new THREE.Vector3() });
    }
    this._pi = 0;
  }
  popup(pos, label, sub = '', color = '#ffffff', big = false) {
    const p = this.popups[this._pi]; this._pi = (this._pi + 1) % this.popups.length;
    const x = p.c.getContext('2d');
    x.clearRect(0, 0, 512, 256);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round';
    x.font = `${big ? 120 : 96}px ${FONT_BRUSH}`;
    x.strokeStyle = 'rgba(20,10,5,0.85)'; x.lineWidth = 14; x.strokeText(label, 256, 100);
    x.fillStyle = color; x.fillText(label, 256, 100);
    if (sub) {
      x.font = `34px ${FONT_LATIN}`;
      x.strokeStyle = 'rgba(20,10,5,0.85)'; x.lineWidth = 8; x.strokeText(sub, 256, 190, 500);
      x.fillStyle = '#f1e6cf'; x.fillText(sub, 256, 190, 500);
    }
    p.tex.needsUpdate = true;
    p.s.position.copy(pos);
    p.life = p.max = big ? 2.6 : 1.7;
    p.big = big;
    p.vel.set(0, big ? 0.9 : 0.7, 0);
    p.s.visible = true;
  }
  _updatePopups(dt, camPos) {
    for (const p of this.popups) {
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.life -= dt;
      p.s.position.addScaledVector(p.vel, dt);
      const d = camPos ? p.s.position.distanceTo(camPos) : 5;
      const k = Math.max(0.5, d * 0.09) * (p.big ? 1.5 : 1);
      const t = 1 - p.life / p.max;
      const pop = t < 0.1 ? 0.6 + t * 4 : 1;
      p.s.scale.set(2 * k * pop, k * pop, 1);
      p.s.material.opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    }
  }
}
