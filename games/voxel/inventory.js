import { ITEMS } from './items.js';

// Player inventory: 36 slots, 0..8 are the hotbar. A slot is null or { id, count, dur? }.
// Mutate only through these methods so 'inventoryChanged' fires and the HUD redraws.
export const HOTBAR = 9, SLOTS = 36;

export class Inventory {
  constructor(events) {
    this.events = events;
    this.slots = new Array(SLOTS).fill(null);
    this.selected = 0;
  }
  get selectedStack() { return this.slots[this.selected]; }
  changed() { this.events.emit('inventoryChanged', { inventory: this }); }
  select(i) { this.selected = ((i % HOTBAR) + HOTBAR) % HOTBAR; this.changed(); }
  cycle(d) { this.select(this.selected + d); }

  // Add items; returns the count that didn't fit.
  add(id, count = 1, extra = null) {
    const def = ITEMS[id]; if (!def) return count;
    const max = def.stack ?? 64;
    for (let i = 0; i < SLOTS && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max && !s.dur) { const n = Math.min(count, max - s.count); s.count += n; count -= n; }
    }
    for (let i = 0; i < SLOTS && count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(count, max);
        this.slots[i] = { id, count: n, ...(def.tool ? { dur: def.tool.durability } : {}), ...(extra || {}) };
        count -= n;
      }
    }
    this.changed();
    return count;
  }
  canFit(id) {
    const max = ITEMS[id]?.stack ?? 64;
    return this.slots.some(s => !s || (s.id === id && s.count < max));
  }
  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }
  // remove n of item id from anywhere; returns how many were removed
  removeItem(id, n = 1) {
    let left = n;
    for (let i = SLOTS - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i]; if (!s || s.id !== id) continue;
      const k = Math.min(left, s.count); s.count -= k; left -= k; if (s.count <= 0) this.slots[i] = null;
    }
    this.changed(); return n - left;
  }
  takeFromSlot(i, n = 1) {
    const s = this.slots[i]; if (!s) return 0;
    const k = Math.min(n, s.count); s.count -= k; if (s.count <= 0) this.slots[i] = null;
    this.changed(); return k;
  }
  setSlot(i, stack) { this.slots[i] = stack; this.changed(); }
  swap(a, b) { const t = this.slots[a]; this.slots[a] = this.slots[b]; this.slots[b] = t; this.changed(); }
  // wear the selected tool; returns true if it broke
  wearSelected(amount = 1) {
    const s = this.selectedStack; if (!s || s.dur == null) return false;
    s.dur -= amount;
    if (s.dur <= 0) { this.slots[this.selected] = null; this.events.emit('toolBroken', { id: s.id }); this.changed(); return true; }
    this.changed(); return false;
  }
  clear() { this.slots.fill(null); this.changed(); }
  toJSON() { return { slots: this.slots, selected: this.selected }; }
  load(o) {
    if (!o || !Array.isArray(o.slots)) return;
    this.slots = new Array(SLOTS).fill(null);
    o.slots.forEach((s, i) => { if (i < SLOTS && s && ITEMS[s.id] && s.count > 0) this.slots[i] = s; });
    this.selected = o.selected | 0;
    this.changed();
  }
}
