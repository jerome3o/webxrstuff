import * as THREE from 'three';
import { Panel, Pointer, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { BLOCKS } from './blocks.js';
import { ITEMS } from './items.js';
import { HOTBAR } from './inventory.js';

// In-world UI: hotbar (off-hand wrist in VR, bottom of view on desktop), a pointable modal panel
// with tabs (Inventory/Blocks, Settings, + tabs added by other modules), and toasts.
//
// Extension: game.ui.addTab({ id, label, draw(c, W, H, panel, ui), onOpen?(), onClose?() })
//   draw() paints into the content area y ∈ [100, H-20] and registers buttons via panel.button(...)
//   ui.open(tabId) / ui.close() / ui.toggle(tabId); ui.slotButton(...) draws an item slot.

const COL = {
  ink: 'rgba(24,19,38,0.86)', inkSolid: '#1d1830', paper: '#f8f1e3', cream: '#f3e6cf', dim: '#b9aed0',
  btn: '#2c2544', btnHover: '#41375f', sage: '#7fb685', rose: '#e58f9f', gold: '#ffd27a',
};
const BTN = { bg: COL.btn, hoverBg: COL.btnHover, border: '#a99cc8', fg: COL.paper, activeBg: '#5f8f6a', font: FONTS.sans };
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class GameUI {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.pointer = new Pointer(scene, 0xffe1a8);
    this.pointer.onClick = () => game.audio.click();
    this.tabs = [];
    this.activeTab = null;
    this.modalOpen = false;
    this.pointerOnPanel = false;
    this.carry = null;            // survival: stack picked up with the pointer
    this.hoverText = '';
    this.confirmNew = 0;

    // hotbar
    this.hotbar = new Panel({ width: 0.36, height: 0.075, px: 1024, draw: (c, W, H, p) => this._drawHotbar(c, W, H, p) });
    this.hotbar.mesh.renderOrder = 1500;
    this.hotbar.mesh.material.depthTest = false;
    game.ctx.rig.add(this.hotbar.mesh);
    this.pointer.panels.push(this.hotbar);

    // modal
    this.modal = new Panel({ width: 1.0, height: 0.72, px: 1024, draw: (c, W, H, p) => this._drawModal(c, W, H, p) });
    this.modal.mesh.visible = false; this.modal.mesh.renderOrder = 1400;
    scene.add(this.modal.mesh);
    this.pointer.panels.push(this.modal);

    // toast
    this.toastText = ''; this.toastT = 0;
    this.toastPanel = new Panel({ width: 0.5, height: 0.06, px: 512, draw: (c, W, H) => {
      c.fillStyle = COL.ink; roundRect(c, 4, 4, W - 8, H - 8, 18); c.fill();
      c.fillStyle = COL.paper; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, this.toastText, W / 2, H / 2 + 2, W - 40, 30, FONTS.sans);
    } });
    this.toastPanel.mesh.visible = false; this.toastPanel.mesh.renderOrder = 1600; this.toastPanel.mesh.material.depthTest = false;
    game.ctx.rig.add(this.toastPanel.mesh);

    this.addTab({ id: 'items', label: () => game.mode === 'creative' ? 'Blocks' : 'Pack', draw: (c, W, H, p) => this._drawItems(c, W, H, p), onClose: () => this._dropCarry() });
    this.addTab({ id: 'settings', label: 'Settings', draw: (c, W, H, p) => this._drawSettings(c, W, H, p) });
    game.events.on('inventoryChanged', () => { this.hotbar.markDirty(); if (this.modalOpen) this.modal.markDirty(); });
  }

  addTab(tab) { this.tabs.push(tab); this.modal.markDirty(); return tab; }
  toggle(id) { if (this.modalOpen && this.activeTab === id) this.close(); else this.open(id); }
  open(id) {
    const g = this.game;
    const tab = this.tabs.find(t => t.id === id) ?? this.tabs[0];
    if (this.activeTab && this.activeTab !== tab.id) this.tabs.find(t => t.id === this.activeTab)?.onClose?.();
    this.activeTab = tab.id; tab.onOpen?.();
    if (!this.modalOpen) { this._placeModal(); g.audio.click(); }
    this.modalOpen = true; this.modal.mesh.visible = true; this.modal.markDirty();
  }
  // world-fixed, level, in front of the head
  _placeModal() {
    const g = this.game, head = g.input.head, s = g.player.scale;
    _v.copy(head.fwd); _v.y = 0; if (_v.lengthSq() < 1e-4) _v.set(0, 0, -1); _v.normalize();
    const dist = (g.input.desktop ? 0.95 : 0.8) * s;
    this.modal.mesh.position.copy(head.pos).addScaledVector(_v, dist); this.modal.mesh.position.y -= (g.input.desktop ? 0.02 : 0.12) * s;
    _w.copy(head.pos); _w.y = this.modal.mesh.position.y;
    this.modal.mesh.lookAt(_w);
    this.modal.mesh.scale.setScalar(s);
  }
  close() {
    if (!this.modalOpen) return;
    this.tabs.find(t => t.id === this.activeTab)?.onClose?.();
    this.modalOpen = false; this.modal.mesh.visible = false; this.confirmNew = 0;
    this.game.audio.click();
  }
  toast(text, secs = 1.6) { this.toastText = text; this.toastT = secs; this.toastPanel.markDirty(); }

  update(dt) {
    const g = this.game, input = g.input, cam = g.ctx.camera, s = g.player.scale;
    // hotbar placement
    const hb = this.hotbar.mesh;
    if (input.desktop) {
      hb.position.copy(cam.position); hb.quaternion.copy(cam.quaternion);
      hb.translateY(-0.205); hb.translateZ(-0.5);
      hb.scale.setScalar(0.92);
      hb.visible = true;
    } else {
      const o = input.off;
      hb.visible = o.present;
      if (o.present) {
        hb.position.copy(o.gripPos).applyMatrix4(g.rigInv);
        _q.setFromRotationMatrix(_m.extractRotation(g.rigInv)).multiply(o.gripQuat);
        _v.set(0, 0.07, 0.05).applyQuaternion(_q); hb.position.add(_v);
        hb.scale.setScalar(0.85);
        cam.getWorldPosition(_w);
        hb.lookAt(_w);
      }
    }
    // keep the modal near the player (e.g. while falling or after a teleport)
    if (this.modalOpen && this.modal.mesh.position.distanceTo(input.head.pos) > 2.2 * s) this._placeModal();
    // toast
    const tp = this.toastPanel.mesh;
    if (this.toastT > 0) {
      this.toastT -= dt;
      tp.visible = true;
      tp.position.copy(cam.position); tp.quaternion.copy(cam.quaternion);
      if (input.desktop) { tp.translateY(0.12); tp.translateZ(-0.6); tp.scale.setScalar(0.7); }
      else { tp.translateY(-0.22); tp.translateZ(-0.9); tp.scale.setScalar(1); }
      this.toastPanel.redraw();
    } else tp.visible = false;
    // pointer: always active on the modal, and on the wrist hotbar in VR
    const hit = this.pointer.update(input.main, { show: !input.desktop, far: 3 * s });
    this.pointerOnPanel = !!hit && !(input.desktop && hit.panel === this.hotbar);
    if (hit && input.main.triggerDown) this.pointer.click(hit);
    const hov = hit?.button?.id ?? '';
    if (hov !== this._hov) { this._hov = hov; if (this.modalOpen) this.modal.markDirty(); }
    if (this.confirmNew > 0 && (this.confirmNew -= dt) <= 0) this.modal.markDirty();
  }

  // ── drawing ───────────────────────────────────────────────
  slotButton(p, id, x, y, size, stack, onClick, { active = false, hoverName = true } = {}) {
    p.button(id, x, y, size, size, '', onClick, { ...BTN, active, activeBg: '#4b3f6e', border: active ? COL.gold : '#6f6390' });
    const c = p.ctx;
    if (active) { c.lineWidth = 6; c.strokeStyle = COL.gold; roundRect(c, x + 1, y + 1, size - 2, size - 2, size * 0.2); c.stroke(); }
    if (stack) {
      const icon = this.game.models.icon(stack.id);
      c.imageSmoothingEnabled = false;
      const pad = size * 0.12;
      c.drawImage(icon, x + pad, y + pad, size - pad * 2, size - pad * 2);
      if (stack.count > 1 || (this.game.mode !== 'creative' && stack.count > 1)) {
        c.font = `700 ${Math.round(size * 0.3)}px ${FONTS.sans}`; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
        c.lineWidth = 5; c.strokeStyle = COL.inkSolid; c.strokeText(String(stack.count), x + size - 8, y + size - 8);
        c.fillStyle = COL.paper; c.fillText(String(stack.count), x + size - 8, y + size - 8);
      }
      const max = ITEMS[stack.id]?.tool?.durability;
      if (max && stack.dur != null && stack.dur < max) {
        const f = Math.max(0, stack.dur / max);
        c.fillStyle = '#1d1830'; c.fillRect(x + 10, y + size - 14, size - 20, 7);
        c.fillStyle = f > 0.5 ? COL.sage : f > 0.2 ? COL.gold : COL.rose; c.fillRect(x + 10, y + size - 14, (size - 20) * f, 7);
      }
      if (hoverName && p.hover === id) this.hoverText = ITEMS[stack.id]?.name ?? '';
    }
  }

  _drawHotbar(c, W, H, p) {
    const inv = this.game.inventory;
    c.fillStyle = COL.ink; roundRect(c, 4, 4, W - 8, 140, 30); c.fill();
    const size = 100, gap = 10, x0 = (W - (HOTBAR * size + (HOTBAR - 1) * gap)) / 2;
    for (let i = 0; i < HOTBAR; i++) this.slotButton(p, 'hb' + i, x0 + i * (size + gap), 22, size, inv.slots[i], () => inv.select(i), { active: i === inv.selected, hoverName: false });
    const st = inv.selectedStack;
    const name = st ? ITEMS[st.id]?.name ?? '' : '';
    if (name) {
      c.font = `600 40px ${FONTS.sans}`; const w = c.measureText(name).width + 50;
      c.fillStyle = COL.ink; roundRect(c, (W - w) / 2, 152, w, 56, 22); c.fill();
      c.fillStyle = COL.paper; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(name, W / 2, 182);
    }
  }

  _drawModal(c, W, H, p) {
    const g = this.game;
    this.hoverText = '';
    c.fillStyle = 'rgba(24,19,38,0.94)'; roundRect(c, 4, 4, W - 8, H - 8, 34); c.fill();
    c.lineWidth = 3; c.strokeStyle = '#6f6390'; c.stroke();
    c.fillStyle = COL.gold; c.font = `800 44px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('Blockfell', 34, 52);
    let x = 270;
    for (const t of this.tabs) {
      const label = typeof t.label === 'function' ? t.label() : t.label;
      p.button('tab:' + t.id, x, 24, 170, 56, label, () => { this.open(t.id); }, { ...BTN, active: this.activeTab === t.id });
      x += 180;
    }
    p.button('close', W - 90, 24, 60, 56, '×', () => this.close(), { ...BTN, size: 40 });
    c.fillStyle = '#3d3458'; c.fillRect(30, 92, W - 60, 2);
    const tab = this.tabs.find(t => t.id === this.activeTab);
    tab?.draw(c, W, H, p, this);
    if (this.hoverText) {
      c.fillStyle = COL.dim; c.font = `500 30px ${FONTS.sans}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(this.hoverText, W / 2, H - 30);
    }
  }

  _drawItems(c, W, H, p) {
    const g = this.game, inv = g.inventory;
    if (g.mode === 'creative') {
      const list = this.paletteList || (this.paletteList = ITEMS.filter(d => d && (d.kind !== 'block' || BLOCKS[d.id]?.creative !== false)).map(d => d.id));
      const cols = 12, size = 68, gap = 8, x0 = (W - (cols * size + (cols - 1) * gap)) / 2, y0 = 106;
      list.forEach((id, i) => {
        const cx = x0 + (i % cols) * (size + gap), cy = y0 + Math.floor(i / cols) * (size + gap);
        const def = ITEMS[id];
        this.slotButton(p, 'pal' + id, cx, cy, size, { id, count: 1 }, () => {
          inv.setSlot(inv.selected, { id, count: def.stack ?? 64, ...(def.tool ? { dur: def.tool.durability } : {}) });
        });
      });
      this._hotbarRow(c, W, H, p, 616, (i) => inv.select(i));
      c.fillStyle = COL.dim; c.font = `400 24px ${FONTS.sans}`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('Pick a block or tool: it goes into the highlighted hotbar slot.', W / 2, 597);
      return;
    }
    // survival pack: 27 storage + hotbar; click to pick up / put down / swap / merge
    const size = 86, gap = 8, x0 = (W - (9 * size + 8 * gap)) / 2;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 9; k++) {
      const i = 9 + r * 9 + k;
      this.slotButton(p, 'inv' + i, x0 + k * (size + gap), 112 + r * (size + gap), size, inv.slots[i], () => this._clickSlot(i));
    }
    c.fillStyle = COL.dim; c.font = `400 24px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('Hotbar', x0, 418);
    this._hotbarRow(c, W, H, p, 440, (i) => this._clickSlot(i), size);
    if (this.carry) {
      const icon = g.models.icon(this.carry.id);
      c.drawImage(icon, x0, 560, 64, 64);
      c.fillStyle = COL.paper; c.font = `600 30px ${FONTS.sans}`; c.textAlign = 'left';
      c.fillText(`Holding ${ITEMS[this.carry.id]?.name ?? ''} ×${this.carry.count}`, x0 + 80, 592);
    } else {
      c.fillStyle = COL.dim; c.font = `400 26px ${FONTS.sans}`; c.textAlign = 'left';
      c.fillText('Point and pull the trigger to pick up a stack, again to put it down.', x0, 592);
    }
  }
  _hotbarRow(c, W, H, p, y, onClick, size = 80) {
    const inv = this.game.inventory, gap = 8, x0 = (W - (9 * size + 8 * gap)) / 2;
    for (let i = 0; i < HOTBAR; i++) this.slotButton(p, 'mhb' + i, x0 + i * (size + gap), y, size, inv.slots[i], () => onClick(i), { active: i === inv.selected && this.game.mode === 'creative' });
  }
  _clickSlot(i) {
    const inv = this.game.inventory, s = inv.slots[i], c = this.carry;
    if (!c) { if (s) { this.carry = s; inv.setSlot(i, null); } }
    else if (!s) { inv.setSlot(i, c); this.carry = null; }
    else if (s.id === c.id && !s.dur && !c.dur) {
      const max = ITEMS[s.id]?.stack ?? 64, n = Math.min(c.count, max - s.count);
      s.count += n; c.count -= n; if (c.count <= 0) this.carry = null; inv.changed();
    } else { inv.setSlot(i, c); this.carry = s; }
    this.modal.markDirty();
  }
  _dropCarry() {
    if (!this.carry) return;
    const left = this.game.inventory.add(this.carry.id, this.carry.count, this.carry.dur != null ? { dur: this.carry.dur } : null);
    if (left > 0) this.game.spawnDrop(this.carry.id, left, this.game.player.eye);
    this.carry = null;
  }

  _drawSettings(c, W, H, p) {
    const g = this.game, s = g.settings;
    const rows = [];
    const row = (label, opts) => rows.push({ label, opts });
    row('Mode', [['Survival', g.mode === 'survival', () => g.setMode('survival')], ['Creative', g.mode === 'creative', () => g.setMode('creative')]]);
    row('View distance', [['−', false, () => g.setRenderDistance(s.renderDistance - 1)], [`${s.renderDistance} chunks`, false, null], ['+', false, () => g.setRenderDistance(s.renderDistance + 1)]]);
    row('Move', [['Smooth', s.locomotion === 'smooth', () => g.setSetting('locomotion', 'smooth')], ['Teleport', s.locomotion === 'teleport', () => g.setSetting('locomotion', 'teleport')]]);
    row('Turn', [['Snap 30°', s.turn === 'snap' && s.snapDeg === 30, () => { g.setSetting('turn', 'snap'); g.setSetting('snapDeg', 30); }], ['Snap 45°', s.turn === 'snap' && s.snapDeg === 45, () => { g.setSetting('turn', 'snap'); g.setSetting('snapDeg', 45); }], ['Smooth', s.turn === 'smooth', () => g.setSetting('turn', 'smooth')]]);
    row('Comfort', [['Vignette', s.vignette, () => g.setSetting('vignette', !s.vignette)], ['Auto-step', s.autoStep, () => g.setSetting('autoStep', !s.autoStep)], ['Sprint', s.sprint, () => g.setSetting('sprint', !s.sprint)]]);
    row('Scale', [['Normal', !s.giant, () => g.setSetting('giant', false)], ['Giant', s.giant, () => g.setSetting('giant', true)]]);
    if (g.mode === 'creative') row('Creative', [['Fly', g.player.flying, () => { g.player.flying = !g.player.flying; }], ['Day', false, () => g.sky.setTime(0.3)], ['Dusk', false, () => g.sky.setTime(0.73)], ['Night', false, () => g.sky.setTime(0.0)]]);
    row('World', [[this.confirmNew > 0 ? 'Tap again: new world' : 'New world', this.confirmNew > 0, () => {
      if (this.confirmNew > 0) { this.confirmNew = 0; g.newWorld(); } else { this.confirmNew = 3; }
    }], [`Seed ${g.seed}`, false, null]]);
    let y = 112;
    for (const r of rows) {
      c.fillStyle = COL.cream; c.font = `600 30px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText(r.label, 44, y + 28);
      let x = 270;
      for (const [label, active, fn] of r.opts) {
        const w = Math.max(120, Math.min(300, 40 + label.length * 17));
        if (fn) p.button('set:' + r.label + label, x, y, w, 54, label, fn, { ...BTN, active });
        else { c.fillStyle = COL.dim; c.font = `500 28px ${FONTS.sans}`; c.textAlign = 'center'; c.fillText(label, x + w / 2, y + 28); }
        x += w + 12;
      }
      y += 64;
    }
    c.fillStyle = COL.dim; c.font = `400 22px ${FONTS.sans}`; c.textAlign = 'left';
    c.fillText(g.input.desktop ? 'Desktop: E pack · O settings · Space jump (double-tap to fly in Creative)' : 'Off-hand X: pack · off-hand Y (tap): settings · hold Y: back to hub', 44, H - 48);
  }

  dispose() {
    for (const m of [this.hotbar.mesh, this.modal.mesh, this.toastPanel.mesh, this.pointer.line, this.pointer.dot]) m.removeFromParent();
  }
}
