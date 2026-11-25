import { FONTS, roundRect, fitText } from '../../../../src/platform/kit.js';
import { ITEMS } from '../../items.js';

// The "Craft" tab of the modal panel. One tab, four modes (keeps the tab bar short):
//   craft  – recipe browser; hand recipes anywhere, bench recipes when opened at a Joiner's Bench
//   kiln   – a Clay Kiln's input / fuel / output + your pack
//   chest  – a Cedar Chest's 27 slots + your pack
// Everything is point + trigger: big slots and buttons, no dragging.

const COL = { paper: '#f8f1e3', cream: '#f3e6cf', dim: '#b9aed0', gold: '#ffd27a', sage: '#7fb685', rose: '#e58f9f', ink: '#1d1830', card: 'rgba(52,43,78,0.9)' };
const BTN = { bg: '#2c2544', hoverBg: '#41375f', border: '#a99cc8', fg: COL.paper, activeBg: '#5f8f6a', font: FONTS.sans };
const CATS = [['all', 'All'], ['tools', 'Tools'], ['build', 'Building'], ['deco', 'Décor'], ['farm', 'Food & Farm'], ['misc', 'Stations']];
const COLS = 6, ROWS = 5, PER_PAGE = COLS * ROWS;

export class CraftPanel {
  constructor(sys) {
    this.sys = sys;
    this.cat = 'all'; this.makeable = false; this.page = 0; this.sel = null;
  }

  label() { const m = this.sys.mode; return m === 'kiln' ? 'Kiln' : m === 'chest' ? 'Chest' : m === 'bench' ? 'Bench' : 'Craft'; }

  draw(c, W, H, p, ui) {
    const m = this.sys.mode;
    if (m === 'kiln') this._kiln(c, W, H, p, ui);
    else if (m === 'chest') this._chest(c, W, H, p, ui);
    else this._craft(c, W, H, p, ui);
  }

  // ── recipe browser ───────────────────────────────────────
  _craft(c, W, H, p, ui) {
    const sys = this.sys, bench = sys.mode === 'bench';
    let x = 30;
    for (const [id, label] of CATS) {
      p.button('cc:' + id, x, 104, 124, 50, label, () => { this.cat = id; this.page = 0; }, { ...BTN, active: this.cat === id, size: 22 });
      x += 132;
    }
    p.button('cc:mk', x, 104, 150, 50, this.makeable ? '✓ Can make' : 'Can make', () => { this.makeable = !this.makeable; this.page = 0; }, { ...BTN, active: this.makeable, size: 22 });

    const list = sys.recipes.filter(r => (this.cat === 'all' || r.cat === this.cat) && (!this.makeable || (sys.stationOk(r) && sys.maxCraft(r) > 0)));
    // makeable first, then hand before bench
    list.sort((a, b) => (sys.score(b) - sys.score(a)) || (a.order - b.order));
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    if (this.page >= pages) this.page = pages - 1;
    if (!this.sel || !list.includes(this.sel)) this.sel = list[0] ?? null;
    const size = 78, gap = 8, x0 = 30, y0 = 168;
    for (let i = 0; i < PER_PAGE; i++) {
      const r = list[this.page * PER_PAGE + i]; if (!r) break;
      const cx = x0 + (i % COLS) * (size + gap), cy = y0 + Math.floor(i / COLS) * (size + gap);
      ui.slotButton(p, 'rc:' + r.order, cx, cy, size, { id: r.outId, count: r.outN }, () => { this.sel = r; }, { active: this.sel === r });
      const ok = sys.stationOk(r), can = ok && sys.maxCraft(r) > 0;
      if (!can) { c.fillStyle = 'rgba(24,19,38,0.55)'; roundRect(c, cx + 3, cy + 3, size - 6, size - 6, 12); c.fill(); }
      if (!ok) { c.fillStyle = COL.gold; c.font = `700 18px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('⚒', cx + 6, cy + 4); }
    }
    if (!list.length) { c.fillStyle = COL.dim; c.font = `400 26px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('Nothing to show here yet.', x0, y0 + 30); }
    // paging
    p.button('pg:prev', x0, 606, 90, 56, '◀', () => { this.page = (this.page + pages - 1) % pages; }, { ...BTN, enabled: pages > 1 });
    c.fillStyle = COL.dim; c.font = `500 26px ${FONTS.sans}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`${this.page + 1} / ${pages}`, x0 + 258, 634);
    p.button('pg:next', x0 + 426, 606, 90, 56, '▶', () => { this.page = (this.page + 1) % pages; }, { ...BTN, enabled: pages > 1 });

    // detail card
    const dx = 566, dy = 168, dw = W - dx - 30, dh = 494;
    c.fillStyle = COL.card; roundRect(c, dx, dy, dw, dh, 22); c.fill();
    const r = this.sel;
    c.textAlign = 'left'; c.textBaseline = 'middle';
    if (!r) return;
    const icon = sys.game.models.icon(r.outId);
    c.imageSmoothingEnabled = false; c.drawImage(icon, dx + 18, dy + 16, 88, 88);
    c.fillStyle = COL.paper; c.textAlign = 'center'; fitText(c, ITEMS[r.outId]?.name ?? '?', dx + 116 + (dw - 130) / 2, dy + 46, dw - 136, 34, FONTS.sans);
    c.textAlign = 'left';
    c.fillStyle = COL.dim; c.font = `500 22px ${FONTS.sans}`;
    c.fillText(`makes ${r.outN} · ${r.st === 'bench' ? "Joiner's Bench" : 'by hand'}`, dx + 122, dy + 84);
    let iy = dy + 128;
    for (const inp of r.ins) {
      const have = sys.haveOf(inp);
      c.drawImage(sys.game.models.icon(inp.ids[0] ?? 0), dx + 22, iy, 52, 52);
      c.fillStyle = COL.cream; c.font = `500 24px ${FONTS.sans}`; c.textAlign = 'left';
      fitText(c, inp.label, dx + 86, iy + 27, dw - 210, 24, FONTS.sans);
      c.textAlign = 'right'; c.font = `700 26px ${FONTS.sans}`; c.fillStyle = have >= inp.n ? COL.sage : COL.rose;
      c.fillText(`${have} / ${inp.n}`, dx + dw - 20, iy + 27);
      c.textAlign = 'left';
      iy += 62;
    }
    const ok = sys.stationOk(r), max = ok ? sys.maxCraft(r) : 0;
    if (!ok) { c.fillStyle = COL.gold; c.font = `600 22px ${FONTS.sans}`; c.fillText("Needs a Joiner's Bench — use one to craft this.", dx + 20, dy + dh - 112); }
    p.button('cr:1', dx + 16, dy + dh - 84, (dw - 44) / 2, 68, 'Craft 1', () => sys.craft(r, 1), { ...BTN, enabled: max > 0, size: 30 });
    p.button('cr:max', dx + 28 + (dw - 44) / 2, dy + dh - 84, (dw - 44) / 2, 68, max > 1 ? `Craft ${max}` : 'Craft max', () => sys.craft(r, max), { ...BTN, enabled: max > 0, size: 30 });
    if (!bench && sys.mode !== 'bench') {
      c.fillStyle = COL.dim; c.font = `400 20px ${FONTS.sans}`; c.textAlign = 'left';
      c.fillText('⚒ = bench recipe', x0 + 120, 690);
    }
  }

  // ── kiln ─────────────────────────────────────────────────
  _kiln(c, W, H, p, ui) {
    const sys = this.sys, k = sys.openKiln();
    if (!k) { this._gone(c, W); return; }
    const S = 96;
    const ix = 250, iy = 116, fx = 250, fy = 262, ox = 640, oy = 176;
    c.fillStyle = COL.dim; c.font = `500 22px ${FONTS.sans}`; c.textAlign = 'right'; c.textBaseline = 'middle';
    c.fillText('Input', ix - 14, iy + S / 2); c.fillText('Fuel', fx - 14, fy + S / 2);
    c.textAlign = 'left'; c.fillText('Output', ox + S + 34, oy + 58);
    ui.slotButton(p, 'k:in', ix, iy, S, k.input, () => sys.kilnTake('input'));
    ui.slotButton(p, 'k:fuel', fx, fy, S, k.fuel, () => sys.kilnTake('fuel'));
    ui.slotButton(p, 'k:out', ox, oy, S + 20, k.output, () => sys.kilnTake('output'));
    // flame
    const fl = k.burnMax > 0 ? Math.max(0, k.burn / k.burnMax) : 0;
    const fx0 = ix + S / 2 - 18, fy0 = iy + S + 10, fh = fy - fy0 - 10;
    c.fillStyle = '#3d3458'; roundRect(c, fx0, fy0, 36, fh, 10); c.fill();
    if (fl > 0) { c.fillStyle = '#ffb36b'; roundRect(c, fx0, fy0 + fh * (1 - fl), 36, fh * fl, 10); c.fill(); }
    // progress arrow
    const rec = sys.kilnRecipe(k), prog = rec ? Math.min(1, k.progress / rec.time) : 0;
    const ax = ix + S + 40, ay = oy + 44, aw = ox - ax - 40;
    c.fillStyle = '#3d3458'; roundRect(c, ax, ay, aw, 30, 12); c.fill();
    if (prog > 0) { c.fillStyle = COL.gold; roundRect(c, ax, ay, Math.max(24, aw * prog), 30, 12); c.fill(); }
    c.beginPath(); c.moveTo(ax + aw, ay - 14); c.lineTo(ax + aw + 34, ay + 15); c.lineTo(ax + aw, ay + 44); c.closePath(); c.fillStyle = prog > 0 ? COL.gold : '#3d3458'; c.fill();
    c.fillStyle = COL.cream; c.font = `500 22px ${FONTS.sans}`; c.textAlign = 'center';
    const status = k.burn > 0 ? (rec ? `Firing… ${Math.ceil(Math.max(0, rec.time - k.progress))} s` : 'Burning (nothing to fire)') : rec ? (k.fuel ? 'Ready' : 'Add fuel') : 'Add something to fire';
    c.fillText(status, ax + aw / 2, ay + 74);
    c.fillStyle = COL.dim; c.font = `400 20px ${FONTS.sans}`;
    c.fillText('Tap a pack item to load it · tap a kiln slot to take it back', W / 2, 390);
    this._pack(c, W, p, ui, 412, 60, (i) => sys.kilnPut(i));
  }

  // ── chest ────────────────────────────────────────────────
  _chest(c, W, H, p, ui) {
    const sys = this.sys, slots = sys.openChest();
    if (!slots) { this._gone(c, W); return; }
    const size = 62, gap = 7, x0 = (W - (9 * size + 8 * gap)) / 2;
    c.fillStyle = COL.dim; c.font = `500 22px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillText('Cedar Chest — tap a stack to move it across', x0, 116);
    for (let i = 0; i < 27; i++) ui.slotButton(p, 'ch:' + i, x0 + (i % 9) * (size + gap), 134 + Math.floor(i / 9) * (size + gap), size, slots[i], () => sys.chestTake(i));
    c.fillStyle = COL.dim; c.fillText('Your pack', x0, 360);
    this._pack(c, W, p, ui, 378, size, (i) => sys.chestPut(i));
  }

  // pack: 27 storage rows then the hotbar row, all tappable
  _pack(c, W, p, ui, y0, size, onClick) {
    const inv = this.sys.game.inventory, gap = 7, x0 = (W - (9 * size + 8 * gap)) / 2;
    for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) {
      const i = r < 3 ? 9 + r * 9 + k : k;
      const y = y0 + r * (size + gap) + (r === 3 ? 8 : 0);
      ui.slotButton(p, 'pk:' + i, x0 + k * (size + gap), y, size, inv.slots[i], () => onClick(i));
    }
  }
  _gone(c, W) { c.fillStyle = COL.dim; c.font = `500 28px ${FONTS.sans}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('It is no longer there.', W / 2, 300); }
}
