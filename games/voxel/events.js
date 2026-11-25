// Tiny event bus. game.events.on('blockBroken', fn) returns an unsubscribe function.
// Handlers may set e.handled = true / e.cancel = true on cancellable events (see ARCHITECTURE.md).
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    let a = this.map.get(name); if (!a) { a = []; this.map.set(name, a); }
    a.push(fn); return () => this.off(name, fn);
  }
  once(name, fn) { const off = this.on(name, (e) => { off(); fn(e); }); return off; }
  off(name, fn) { const a = this.map.get(name); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(name, e) {
    const a = this.map.get(name);
    if (a) for (let i = 0; i < a.length; i++) { try { a[i](e); } catch (err) { console.error(`[voxel] '${name}' handler failed`, err); } }
    return e;
  }
  clear() { this.map.clear(); }
}
