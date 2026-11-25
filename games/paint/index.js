import * as THREE from 'three';
import { Panel, Pointer, Locomotion, Sfx, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { Engine, BRUSHES, SYMS, SYM_C } from './engine.js';
import { buildEnvironments, ENVS, buildMannequin, buildVase } from './env.js';
import { Music } from './music.js';
import { buildDemo } from './demo.js';
import { makeWheelCanvas, hsvToRgb, hexOf, cssHex, rgbToHsv } from './textures.js';

// Ink in the Air — paint ribbons, tubes, glow and ink wash in 3D inside a scholar's studio.
// Main hand: brush (trigger pressure = width/opacity). Off hand: palette board.
// Grips grab the painting (one = move, two = move/rotate/scale).

const SWATCHES = [0x15120f, 0x55504a, 0xf3eee2, 0xc8402c, 0xe8b04a, 0x2f6b4a, 0x2c4a8a, 0x7a3fa0, 0x26c6da, 0xff4fa0];
const SLOTS = 6;
const TIP = 0.078;           // brush tip distance in front of the controller ray origin
const SIZE_MIN = 0.003, SIZE_MAX = 0.12;

const BTN = { bg: '#f7f0e0', fg: '#2a2420', border: '#7a5c3e', hoverBg: '#eadcbc', activeBg: '#2a2420', font: FONTS.sans };
const act = (on, extra = {}) => ({ ...BTN, active: on, fg: on ? '#f7f0e0' : BTN.fg, ...extra });

export async function create(ctx) {
  const { scene, input, rig, camera } = ctx;
  try { await Promise.race([document.fonts.load('40px "Ma Shan Zheng"'), new Promise(r => setTimeout(r, 700))]); } catch { }

  // ── persistent settings ──
  const saved = ctx.load('paint:settings', {}) ?? {};
  const st = {
    brush: saved.brush ?? 0, size: saved.size ?? 0.025, smooth: saved.smooth ?? 0.35,
    hsv: saved.hsv ?? { h: 0.08, s: 0.25, v: 0.08 },
    env: saved.env ?? 0, music: saved.music ?? true, mannequin: saved.mannequin ?? false, vase: saved.vase ?? true,
    sym: 0, line: false, eraser: false, tab: 'paint', depth: 1.3,
    toast: '', toastT: 0, confirm: null, confirmT: 0,
  };
  const colorRGB = { r: 0, g: 0, b: 0 };
  const colorHex = () => { hsvToRgb(st.hsv.h, st.hsv.s, st.hsv.v, colorRGB); return hexOf(colorRGB.r, colorRGB.g, colorRGB.b); };
  const toast = (m) => { st.toast = m; st.toastT = 2.6; palette.markDirty(); };

  // ── world: painting root (grabbable), environments, reference models ──
  const world = new THREE.Group(); world.name = 'painting'; scene.add(world);
  const engine = new Engine(world);
  const envs = buildEnvironments(scene);
  const mannequin = buildMannequin(); mannequin.position.set(2.35, 0, -0.95); mannequin.rotation.y = -1.0; world.add(mannequin);
  const vase = buildVase(); vase.position.set(-1.75, 0, -1.25); world.add(vase);
  function applyEnv() {
    envs.forEach((e, i) => { e.group.visible = i === st.env; });
    const e = envs[st.env]; scene.background = e.bg; scene.fog = e.fog;
    engine.setLightBackground(e.light && st.env === 2);
    mannequin.visible = st.mannequin; vase.visible = st.vase;
  }
  applyEnv();

  // symmetry guides (painting-local)
  const symGuide = new THREE.Group(); world.add(symGuide);
  const guideMat = new THREE.MeshBasicMaterial({ color: 0x6a8fd8, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x6a8fd8, transparent: true, opacity: 0.45 });
  const mirrorPlane = new THREE.Group();
  {
    const g = new THREE.PlaneGeometry(2.6, 2.6);
    const m = new THREE.Mesh(g, guideMat); mirrorPlane.add(m);
    mirrorPlane.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), lineMat));
    mirrorPlane.position.set(SYM_C.x, 1.3, SYM_C.z); mirrorPlane.rotation.y = Math.PI / 2;
  }
  const radialAxis = new THREE.Group();
  {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.6, 0)];
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; pts.push(new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(Math.sin(a) * 0.5, 1.3, Math.cos(a) * 0.5)); }
    radialAxis.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    radialAxis.position.set(SYM_C.x, 0, SYM_C.z);
  }
  symGuide.add(mirrorPlane, radialAxis);
  const updateSymGuide = () => { mirrorPlane.visible = st.sym === 1; radialAxis.visible = st.sym === 2; };
  updateSymGuide();

  // ── brush model + cursor ──
  const brushModel = new THREE.Group(); scene.add(brushModel);
  const handleMat = new THREE.MeshLambertMaterial({ color: 0x9a7a4a });
  const tuftMat = new THREE.MeshLambertMaterial({ color: 0x15120f });
  {
    const h = new THREE.CylinderGeometry(0.0085, 0.011, 0.17, 10); h.rotateX(Math.PI / 2); h.translate(0, 0, 0.06);
    brushModel.add(new THREE.Mesh(h, handleMat));
    for (const z of [0.0, 0.07, 0.13]) { const n = new THREE.TorusGeometry(0.0105, 0.0016, 4, 12); n.translate(0, 0, z); brushModel.add(new THREE.Mesh(n, handleMat)); }
    const f = new THREE.CylinderGeometry(0.0115, 0.0095, 0.022, 10); f.rotateX(Math.PI / 2); f.translate(0, 0, -0.03);
    brushModel.add(new THREE.Mesh(f, new THREE.MeshLambertMaterial({ color: 0x2a2420 })));
    const t = new THREE.ConeGeometry(0.0105, 0.04, 12); t.rotateX(-Math.PI / 2); t.translate(0, 0, -0.06);
    brushModel.userData.tuft = new THREE.Mesh(t, tuftMat); brushModel.add(brushModel.userData.tuft);
  }
  const cursorMat = new THREE.MeshBasicMaterial({ color: 0x15120f, transparent: true, opacity: 0.3, depthWrite: false });
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), cursorMat); scene.add(cursor);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x15120f, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), ringMat); scene.add(ring);
  const eraserMat = new THREE.MeshBasicMaterial({ color: 0xe0607a, transparent: true, opacity: 0.35, depthWrite: false, wireframe: true });
  const eraserBall = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), eraserMat); scene.add(eraserBall);

  // ── audio ──
  const sfx = new Sfx(ctx.audio);
  const music = new Music(ctx.audio);
  if (st.music) music.start();
  let swish = null;
  function swishGain(v) {
    const ac = ctx.audio?.ctx; if (!ac) return;
    if (!swish) {
      if (v <= 0.001) return;
      const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
      let last = 0; for (let i = 0; i < d.length; i++) { last = last * 0.6 + (Math.random() * 2 - 1) * 0.4; d[i] = last; }
      const src = ac.createBufferSource(); src.buffer = b; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.7;
      const g = ac.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(ctx.audio.out); src.start();
      swish = { src, g, f, v: 0 };
    }
    if (Math.abs(swish.v - v) > 0.004) { swish.v = v; swish.g.gain.setTargetAtTime(v, ac.currentTime, 0.06); }
  }
  const click = () => sfx.tone({ freq: 1250, dur: 0.04, gain: 0.05, type: 'triangle' });

  // ── undo / redo ──
  const undoStack = [], redoStack = [];
  const pushAction = (a) => { undoStack.push(a); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; };
  function applyAction(a, forward) {
    if (a.type === 'add') for (const s of a.strokes) forward ? engine.add(s) : engine.remove(s);
    else if (a.type === 'erase') for (const s of a.strokes) forward ? engine.remove(s) : engine.add(s);
    else if (a.type === 'replace') { engine.clear(); for (const s of (forward ? a.after : a.before)) engine.add(s); }
  }
  function undo() { if (live) return; const a = undoStack.pop(); if (!a) { toast('Nothing to undo'); return; } applyAction(a, false); redoStack.push(a); click(); palette.markDirty(); }
  function redo() { if (live) return; const a = redoStack.pop(); if (!a) { toast('Nothing to redo'); return; } applyAction(a, true); undoStack.push(a); click(); palette.markDirty(); }
  function replaceAll(fill, msg) {
    if (live) return;
    const before = engine.strokes.slice();
    engine.clear(); fill();
    pushAction({ type: 'replace', before, after: engine.strokes.slice() });
    if (msg) toast(msg); palette.markDirty();
  }
  const clearAll = () => replaceAll(() => { }, 'Canvas cleared (undo to restore)');
  const loadDemo = () => { replaceAll(() => { for (const s of buildDemo()) engine.add(s); }, 'Demo sketch loaded'); resetWorld(); };
  function resetWorld() { world.position.set(0, 0, 0); world.quaternion.identity(); world.scale.setScalar(1); }

  // ── gallery ──
  const slotKey = (i) => `paint:slot${i}`;
  const meta = ctx.load('paint:slots', null) ?? new Array(SLOTS).fill(null);
  const thumbs = new Array(SLOTS).fill(null);
  function thumbImage(i) {
    const m = meta[i]; if (!m?.thumb) return null;
    if (!thumbs[i]) { const im = new Image(); im.onload = () => palette.markDirty(); im.src = m.thumb; thumbs[i] = im; }
    return thumbs[i].complete && thumbs[i].naturalWidth ? thumbs[i] : null;
  }
  function makeThumb() {
    const c = document.createElement('canvas'); c.width = 176; c.height = 136;
    const x = c.getContext('2d'); x.fillStyle = '#f3eee2'; x.fillRect(0, 0, c.width, c.height);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of engine.strokes) { x0 = Math.min(x0, s.min[0]); x1 = Math.max(x1, s.max[0]); y0 = Math.min(y0, s.min[1]); y1 = Math.max(y1, s.max[1]); }
    if (!isFinite(x0)) return c.toDataURL('image/jpeg', 0.7);
    const sc = Math.min((c.width - 12) / Math.max(0.1, x1 - x0), (c.height - 12) / Math.max(0.1, y1 - y0));
    const ox = (c.width - (x1 - x0) * sc) / 2, oy = (c.height - (y1 - y0) * sc) / 2;
    x.lineCap = x.lineJoin = 'round';
    for (const s of engine.strokes) {
      x.strokeStyle = cssHex(s.hex); x.globalAlpha = s.b.id === 'ink' ? 0.55 : 0.9;
      x.lineWidth = Math.max(0.6, s.size * sc * 0.6);
      x.beginPath();
      const step = Math.max(1, Math.floor(s.n / 40));
      for (let i = 0; i < s.n; i += step) { const px = ox + (s.pos[i * 3] - x0) * sc, py = c.height - (oy + (s.pos[i * 3 + 1] - y0) * sc); i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.stroke();
    }
    return c.toDataURL('image/jpeg', 0.7);
  }
  function saveSlot(i) {
    if (meta[i] && !(st.confirm === 'save' + i && st.confirmT > 0)) { st.confirm = 'save' + i; st.confirmT = 2.5; toast(`Slot ${i + 1} is used: tap Save again to overwrite`); return; }
    st.confirm = null;
    const data = engine.serialize();
    ctx.save(slotKey(i), data);
    let ok = false;
    try { ok = !!localStorage.getItem('vrp:' + slotKey(i)); } catch { }
    if (!ok) { toast('Save failed: storage is full'); return; }
    meta[i] = { n: data.s.length, date: Date.now(), thumb: makeThumb() };
    thumbs[i] = null;
    ctx.save('paint:slots', meta);
    toast(`Saved to slot ${i + 1} (${data.s.length} strokes)`);
    sfx.tone({ freq: 660, dur: 0.12, gain: 0.08 }); sfx.tone({ freq: 990, dur: 0.18, gain: 0.06, delay: 0.09 });
  }
  function loadSlot(i) {
    const data = ctx.load(slotKey(i), null);
    if (!data) { toast(`Slot ${i + 1} is empty`); return; }
    replaceAll(() => engine.deserialize(data), `Loaded slot ${i + 1}`);
    resetWorld();
    sfx.tone({ freq: 520, dur: 0.15, gain: 0.07 });
  }

  // ── palette (kit Panel) ──
  const WH = { cx: 228, cy: 318, r: 178 };
  const wheelCanvas = makeWheelCanvas(WH.r);
  const VAL = { x: 50, y: 520, w: 356, h: 40 };
  const SZ = { x: 462, y: 600, w: 520, h: 36 }, SM = { x: 462, y: 690, w: 520, h: 36 };
  const dragIds = new Set(['wheel', 'val', 'size', 'smooth']);
  const sizeT = () => Math.log(st.size / SIZE_MIN) / Math.log(SIZE_MAX / SIZE_MIN);
  const region = (panel, id, x, y, w, h) => panel.buttons.push({ id, x, y, w, h, onClick: () => { }, enabled: true });
  function slider(c, id, R, t, label, panel) {
    c.fillStyle = '#2a2420'; c.font = `30px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText(label, R.x, R.y - 12);
    roundRect(c, R.x, R.y + R.h / 2 - 6, R.w, 12, 6); c.fillStyle = '#d8c9a8'; c.fill();
    roundRect(c, R.x, R.y + R.h / 2 - 6, Math.max(12, R.w * t), 12, 6); c.fillStyle = '#7a5c3e'; c.fill();
    c.beginPath(); c.arc(R.x + R.w * t, R.y + R.h / 2, panel.hover === id ? 20 : 16, 0, 7); c.fillStyle = '#2a2420'; c.fill();
    c.lineWidth = 3; c.strokeStyle = '#f7f0e0'; c.stroke();
    region(panel, id, R.x - 20, R.y - 10, R.w + 40, R.h + 20);
  }
  function drawPalette(c, W, H, panel) {
    roundRect(c, 4, 4, W - 8, H - 8, 36); c.fillStyle = '#efe6d2'; c.fill();
    c.lineWidth = 8; c.strokeStyle = '#5a4030'; c.stroke();
    c.fillStyle = '#2a2420'; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = `56px ${FONTS.brush}`; c.fillText('墨', 40, 60);
    c.font = `italic 40px ${FONTS.latin}`; c.fillText('Ink in the Air', 104, 62);
    panel.button('tab-paint', 560, 24, 200, 70, 'Brushes', () => { st.tab = 'paint'; }, act(st.tab === 'paint'));
    panel.button('tab-studio', 772, 24, 200, 70, 'Studio', () => { st.tab = 'studio'; }, act(st.tab === 'studio'));
    if (st.tab === 'paint') drawPaintTab(c, W, H, panel); else drawStudioTab(c, W, H, panel);
    // bottom row
    const by = 790;
    panel.button('undo', 40, by, 200, 80, '↶ Undo', undo, { ...BTN, enabled: undoStack.length > 0 });
    panel.button('redo', 252, by, 200, 80, 'Redo ↷', redo, { ...BTN, enabled: redoStack.length > 0 });
    const conf = st.confirm === 'clear' && st.confirmT > 0;
    panel.button('clear', 464, by, 200, 80, conf ? 'Sure?' : 'Clear', () => {
      if (conf) { st.confirm = null; clearAll(); } else { st.confirm = 'clear'; st.confirmT = 2.5; }
    }, conf ? act(true, { activeBg: '#c0261d' }) : BTN);
    c.fillStyle = '#5a4030'; c.textAlign = 'left'; c.textBaseline = 'middle';
    const msg = st.toastT > 0 ? st.toast : `${engine.strokes.length} strokes`;
    fitText(c, msg, 684, by + 40, 310, 30, FONTS.sans);
  }
  function drawPaintTab(c, W, H, panel) {
    // colour wheel
    c.drawImage(wheelCanvas, WH.cx - WH.r, WH.cy - WH.r);
    c.beginPath(); c.arc(WH.cx, WH.cy, WH.r, 0, 7); c.fillStyle = `rgba(0,0,0,${(1 - st.hsv.v) * 0.7})`; c.fill();
    c.lineWidth = 4; c.strokeStyle = '#5a4030'; c.stroke();
    const a = st.hsv.h * Math.PI * 2, mx = WH.cx + Math.cos(a) * st.hsv.s * WH.r, my = WH.cy + Math.sin(a) * st.hsv.s * WH.r;
    c.beginPath(); c.arc(mx, my, 14, 0, 7); c.lineWidth = 5; c.strokeStyle = st.hsv.v > 0.5 ? '#2a2420' : '#f7f0e0'; c.stroke();
    region(panel, 'wheel', WH.cx - WH.r, WH.cy - WH.r, WH.r * 2, WH.r * 2);
    // current colour
    const hex = colorHex();
    c.beginPath(); c.arc(70, 170, 38, 0, 7); c.fillStyle = cssHex(hex); c.fill(); c.lineWidth = 5; c.strokeStyle = '#5a4030'; c.stroke();
    // value slider
    hsvToRgb(st.hsv.h, st.hsv.s, 1, colorRGB);
    const gr = c.createLinearGradient(VAL.x, 0, VAL.x + VAL.w, 0);
    gr.addColorStop(0, '#000'); gr.addColorStop(1, cssHex(hexOf(colorRGB.r, colorRGB.g, colorRGB.b)));
    roundRect(c, VAL.x, VAL.y, VAL.w, VAL.h, 12); c.fillStyle = gr; c.fill(); c.lineWidth = 3; c.strokeStyle = '#5a4030'; c.stroke();
    const vx = VAL.x + st.hsv.v * VAL.w;
    c.beginPath(); c.rect(vx - 6, VAL.y - 6, 12, VAL.h + 12); c.fillStyle = '#f7f0e0'; c.fill(); c.strokeStyle = '#2a2420'; c.stroke();
    region(panel, 'val', VAL.x - 10, VAL.y - 10, VAL.w + 20, VAL.h + 20);
    // swatches
    SWATCHES.forEach((sw, k) => {
      const x = 46 + (k % 5) * 74, y = 590 + Math.floor(k / 5) * 74, css = cssHex(sw);
      panel.button('sw' + k, x, y, 64, 64, '', () => { const r = ((sw >> 16) & 255) / 255, g = ((sw >> 8) & 255) / 255, b = (sw & 255) / 255; st.hsv = rgbToHsv(r, g, b); }, { bg: css, hoverBg: css, border: hex === sw ? '#c0261d' : '#5a4030' });
    });
    // brushes + eraser
    const items = BRUSHES.map((b, i) => ({ id: 'b' + i, label: `${i + 1}  ${b.glyph} ${b.name}`, on: !st.eraser && st.brush === i, fn: () => { st.brush = i; st.eraser = false; } }));
    items.push({ id: 'eraser', label: '9  擦 Eraser', on: st.eraser, fn: () => { st.eraser = !st.eraser; } });
    items.forEach((it, k) => panel.button(it.id, 462 + (k % 2) * 264, 116 + Math.floor(k / 2) * 84, 254, 74, it.label, it.fn, act(it.on, { size: 30 })));
    panel.button('line', 462, 456, 200, 70, '8  ⟋ Line', () => { st.line = !st.line; }, act(st.line, { size: 30 }));
    panel.button('sym', 674, 456, 308, 70, `0  Symmetry: ${SYMS[st.sym]}`, () => { st.sym = (st.sym + 1) % 3; updateSymGuide(); }, act(st.sym > 0, { size: 30 }));
    slider(c, 'size', SZ, sizeT(), `Size ${(st.size * 100).toFixed(1)} cm`, panel);
    slider(c, 'smooth', SM, st.smooth / 0.9, `Stabilizer ${Math.round(st.smooth / 0.9 * 100)}%`, panel);
    c.fillStyle = '#8a7656'; c.textAlign = 'left'; c.textBaseline = 'middle';
    fitText(c, 'Trigger: paint (squeeze harder = bolder) · Grip: grab · Both grips: turn & scale · A/B: undo/redo · X: eraser · Stick: size', 44, 758, 940, 22, FONTS.sans);
  }
  function drawStudioTab(c, W, H, panel) {
    c.fillStyle = '#5a4030'; c.font = `30px ${FONTS.sans}`; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.fillText('Surroundings', 44, 140);
    ENVS.forEach((n, i) => panel.button('env' + i, 40 + i * 316, 154, 304, 66, n, () => { st.env = i; applyEnv(); }, act(st.env === i)));
    c.textAlign = 'left'; c.fillText('Reference models & sound', 44, 266);
    panel.button('mann', 40, 280, 228, 66, 'Mannequin', () => { st.mannequin = !st.mannequin; applyEnv(); }, act(st.mannequin));
    panel.button('vase', 278, 280, 228, 66, 'Vase', () => { st.vase = !st.vase; applyEnv(); }, act(st.vase));
    panel.button('music', 516, 280, 228, 66, st.music ? '♪ Music on' : '♪ Music off', () => { st.music = !st.music; st.music ? music.start() : music.stop(); }, act(st.music));
    panel.button('demo', 754, 280, 228, 66, 'Demo sketch', loadDemo, BTN);
    c.fillStyle = '#5a4030'; c.textAlign = 'left'; c.fillText('Gallery: 6 sketch slots', 44, 392);
    for (let i = 0; i < SLOTS; i++) {
      const x = 40 + (i % 3) * 316, y = 404 + Math.floor(i / 3) * 186;
      roundRect(c, x, y, 304, 176, 16); c.fillStyle = '#e4d8bd'; c.fill();
      const im = thumbImage(i);
      if (im) c.drawImage(im, x + 8, y + 20, 176, 136);
      else { c.fillStyle = '#d4c6a6'; c.fillRect(x + 8, y + 20, 176, 136); c.fillStyle = '#8a7656'; c.textAlign = 'center'; c.font = `26px ${FONTS.sans}`; c.fillText(meta[i] ? `${meta[i].n} strokes` : 'empty', x + 96, y + 96); c.textAlign = 'left'; }
      c.fillStyle = '#5a4030'; c.font = `22px ${FONTS.sans}`; c.fillText(`${i + 1}`, x + 12, y + 16);
      panel.button('save' + i, x + 192, y + 16, 104, 66, 'Save', () => saveSlot(i), act(st.confirm === 'save' + i && st.confirmT > 0, { activeBg: '#c0261d', size: 28 }));
      panel.button('load' + i, x + 192, y + 94, 104, 66, 'Load', () => loadSlot(i), { ...BTN, enabled: !!meta[i], size: 28 });
      c.font = `30px ${FONTS.sans}`;
    }
  }
  const palette = new Panel({ width: 0.34, height: 0.3, px: 1024, draw: drawPalette });
  scene.add(palette.mesh);
  const pointer = new Pointer(scene, 0xc0261d);
  pointer.panels.push(palette);
  function dragUI(id, uv) {
    const px = uv.x * palette.W, py = (1 - uv.y) * palette.H;
    if (id === 'wheel') {
      const dx = px - WH.cx, dy = py - WH.cy;
      st.hsv = { h: (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1, s: Math.min(1, Math.hypot(dx, dy) / WH.r), v: st.hsv.v < 0.15 ? 0.85 : st.hsv.v };
    } else if (id === 'val') st.hsv = { ...st.hsv, v: THREE.MathUtils.clamp((px - VAL.x) / VAL.w, 0, 1) };
    else if (id === 'size') { const t = THREE.MathUtils.clamp((px - SZ.x) / SZ.w, 0, 1); st.size = SIZE_MIN * Math.pow(SIZE_MAX / SIZE_MIN, t); }
    else if (id === 'smooth') st.smooth = THREE.MathUtils.clamp((px - SM.x) / SM.w, 0, 1) * 0.9;
    palette.markDirty();
  }
  function placeDesktopPalette() {
    // in front-left of the current view, tilted toward the eye
    const yaw = input.yaw;
    const p = new THREE.Vector3(-0.5, -0.32, -0.78).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(input.head.pos);
    palette.mesh.position.copy(p); palette.mesh.lookAt(input.head.pos);
  }

  // ── content on launch: autosave or the demo ──
  const auto = ctx.load('paint:autosave', null);
  if (auto && auto.v === 1) engine.deserialize(auto);
  else for (const s of buildDemo()) engine.add(s);
  engine.flush();

  // ── per-frame scratch ──
  const tipW = new THREE.Vector3(), tipS = new THREE.Vector3(), tipL = new THREE.Vector3(), lastL = new THREE.Vector3();
  const upW = new THREE.Vector3(), fwdW = new THREE.Vector3(), upL = new THREE.Vector3(), fwdL = new THREE.Vector3();
  const side = new THREE.Vector3(), prevSide = new THREE.Vector3(), tan = new THREE.Vector3(), alt = new THREE.Vector3(), nrm = new THREE.Vector3();
  const lineStart = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), camPos = new THREE.Vector3();
  const planeP = new THREE.Vector3(), planeN = new THREE.Vector3(), rayO = new THREE.Vector3(), rayD = new THREE.Vector3();
  const invWorld = new THREE.Matrix4(), qTmp = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const hits = [];
  const loco = new Locomotion({ speed: 1.6 });
  let live = null, liveAction = null, eraseAction = null, uiCapture = false, pressure = 0, lineP = 0, hapT = 0;
  let deskPaletteInit = false, wasXR = false;

  // ── grab the painting ──
  const grab = { n: 0, h0: new THREE.Vector3(), w0: new THREE.Vector3(), a0: new THREE.Vector3(), mid0: new THREE.Vector3(), q0: new THREE.Quaternion(), s0: 1, len0: 1, yaw0: 0 };
  function updateGrab() {
    const M = input.main, O = input.off;
    const gm = M.present && M.squeeze > 0.5, go = O.present && O.squeeze > 0.5;
    const n = (gm ? 1 : 0) + (go ? 1 : 0);
    if (n !== grab.n) {
      grab.n = n; grab.w0.copy(world.position); grab.q0.copy(world.quaternion); grab.s0 = world.scale.x;
      if (n === 1) { grab.hand = gm ? M : O; grab.h0.copy(grab.hand.gripPos); grab.hand.haptic(0.3, 30); }
      if (n === 2) {
        grab.a0.subVectors(O.gripPos, M.gripPos); grab.len0 = Math.max(0.05, grab.a0.length());
        grab.yaw0 = Math.atan2(grab.a0.x, grab.a0.z); grab.mid0.addVectors(O.gripPos, M.gripPos).multiplyScalar(0.5);
        M.haptic(0.3, 30); O.haptic(0.3, 30);
      }
    }
    if (n === 1) world.position.copy(grab.w0).add(tmp.subVectors(grab.hand.gripPos, grab.h0));
    else if (n === 2) {
      tmp.subVectors(O.gripPos, M.gripPos);
      const len = Math.max(0.05, tmp.length()), yaw = Math.atan2(tmp.x, tmp.z);
      const sNew = THREE.MathUtils.clamp(grab.s0 * len / grab.len0, 0.08, 12), k = sNew / grab.s0;
      qTmp.setFromAxisAngle(Y, yaw - grab.yaw0);
      tmp2.addVectors(O.gripPos, M.gripPos).multiplyScalar(0.5);
      world.position.copy(grab.w0).sub(grab.mid0).multiplyScalar(k).applyQuaternion(qTmp).add(tmp2);
      world.quaternion.copy(qTmp).multiply(grab.q0);
      world.scale.setScalar(sNew);
    }
    return n > 0;
  }
  function transformWorldAbout(pivot, angle, k) {
    qTmp.setFromAxisAngle(Y, angle);
    const s = THREE.MathUtils.clamp(world.scale.x * k, 0.08, 12); k = s / world.scale.x;
    world.position.sub(pivot).multiplyScalar(k).applyQuaternion(qTmp).add(pivot);
    world.quaternion.premultiply(qTmp); world.scale.setScalar(s);
  }

  // ── stroke recording ──
  function brushSide(first) {
    // ribbon side follows the brush roll (controller up), falls back to facing the viewer
    side.copy(upL).addScaledVector(tan, -upL.dot(tan));
    const len = side.length();
    alt.crossVectors(fwdL, tan);
    const al = alt.length();
    if (al > 1e-4) alt.divideScalar(al); else alt.copy(prevSide);
    if (len > 1e-4) side.divideScalar(len); else side.copy(alt);
    if (len < 0.45) { if (alt.dot(side) < 0) alt.negate(); side.lerp(alt, 1 - len / 0.45).normalize(); }
    if (!first) {
      if (side.dot(prevSide) < 0) side.negate();
      side.lerp(prevSide, 0.35);
      side.addScaledVector(tan, -side.dot(tan)).normalize();
    }
    if (!isFinite(side.x) || side.lengthSq() < 0.5) side.copy(prevSide.lengthSq() > 0.5 ? prevSide : Y);
    nrm.crossVectors(side, tan).normalize();
    prevSide.copy(side);
  }
  function pushPoint(s, p) {
    s.push(tipL.x, tipL.y, tipL.z, side.x, side.y, side.z, nrm.x, nrm.y, nrm.z, p);
  }
  function beginStroke() {
    const sc = world.scale.x;
    live = engine.begin(st.brush, colorHex(), st.size / sc, st.sym);
    liveAction = { type: 'add', strokes: [live] };
    prevSide.copy(upL); tan.copy(fwdL); brushSide(true);
    lastL.copy(tipL); lineStart.copy(tipL); lineP = pressure;
    pushPoint(live, pressure);
  }
  function continueStroke() {
    if (st.line) {
      lineP = Math.max(lineP, pressure);
      tan.subVectors(tipL, lineStart); const L = tan.length();
      if (L < 1e-3) return;
      tan.divideScalar(L); prevSide.copy(upL); brushSide(true);
      live.resetPoints();
      const n = Math.min(engine.maxPoints(live) - 2, Math.max(2, Math.ceil(L / 0.01) + 1));
      for (let i = 0; i < n; i++) { tmp.copy(lineStart).lerp(tipL, i / (n - 1)); live.push(tmp.x, tmp.y, tmp.z, side.x, side.y, side.z, nrm.x, nrm.y, nrm.z, lineP); }
      engine.reemit(live);
      return;
    }
    const minSp = Math.max(0.0025, live.size * 0.15);
    tan.subVectors(tipL, lastL); const d = tan.length();
    if (d < minSp) return;
    tan.divideScalar(d);
    brushSide(live.n === 1);
    if (live.n >= engine.maxPoints(live) - 1) {
      // split very long strokes; the continuation is part of the same undo step
      engine.finish(live);
      const prev = live;
      live = engine.begin(prev.brush, prev.hex, prev.size, prev.sym);
      liveAction.strokes.push(live);
      const o = (prev.n - 1) * 3;
      live.push(prev.pos[o], prev.pos[o + 1], prev.pos[o + 2], side.x, side.y, side.z, nrm.x, nrm.y, nrm.z, prev.prs[prev.n - 1]);
    }
    pushPoint(live, pressure);
    lastL.copy(tipL);
    if (!engine.pump(live)) endStroke();
  }
  function endStroke() {
    if (!live) return;
    const kept = [];
    for (const s of liveAction.strokes) if (s === live ? engine.finish(s) : true) kept.push(s);
    if (kept.length) pushAction({ type: 'add', strokes: kept });
    live = null; liveAction = null;
    palette.markDirty();
  }

  function setCursorColor() {
    const hex = colorHex();
    cursorMat.color.setHex(hex); ringMat.color.setHex(hex); tuftMat.color.setHex(hex);
  }

  // ── keyboard (desktop) ──
  function handleKeys(dt) {
    for (let i = 0; i < 7; i++) if (input.keyDown('Digit' + (i + 1))) { st.brush = i; st.eraser = false; palette.markDirty(); click(); }
    if (input.keyDown('Digit8')) { st.line = !st.line; palette.markDirty(); click(); }
    if (input.keyDown('Digit9')) { st.eraser = !st.eraser; palette.markDirty(); click(); }
    if (input.keyDown('Digit0')) { st.sym = (st.sym + 1) % 3; updateSymGuide(); palette.markDirty(); click(); }
    const ctrl = input.key('ControlLeft') || input.key('ControlRight');
    if (ctrl && input.keyDown('KeyZ')) undo();
    if (ctrl && input.keyDown('KeyY')) redo();
    if (input.keyDown('BracketLeft')) { st.size = Math.max(SIZE_MIN, st.size / 1.25); palette.markDirty(); }
    if (input.keyDown('BracketRight')) { st.size = Math.min(SIZE_MAX, st.size * 1.25); palette.markDirty(); }
    if (input.keyDown('KeyT')) { st.env = (st.env + 1) % ENVS.length; applyEnv(); palette.markDirty(); }
    if (input.keyDown('KeyM')) { st.music = !st.music; st.music ? music.start() : music.stop(); palette.markDirty(); }
    if (input.keyDown('KeyP')) placeDesktopPalette();
    if (input.keyDown('KeyL')) { st.line = !st.line; palette.markDirty(); }
    if (input.mouse.wheel) st.depth = THREE.MathUtils.clamp(st.depth - input.mouse.wheel * 0.08, 0.35, 5);
    const rot = (input.key('Period') ? 1 : 0) - (input.key('Comma') ? 1 : 0);
    const zoom = (input.key('Equal') ? 1 : 0) - (input.key('Minus') ? 1 : 0);
    if (rot || zoom) { tmp2.set(SYM_C.x, 1.2, SYM_C.z).applyMatrix4(world.matrixWorld); transformWorldAbout(tmp2, rot * dt * 1.2, Math.exp(zoom * dt * 0.8)); }
    if (input.keyDown('Backspace')) resetWorld();
  }

  window.__paint = { st, engine, applyEnv, updateSymGuide, undoStack, redoStack, world, palette, pointer, saveSlot, loadSlot, loadDemo, clearAll, undo, redo, meta };

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    update(dt, time) {
      const xr = ctx.isXR();
      const M = input.main, O = input.off;
      if (!xr && !deskPaletteInit) { placeDesktopPalette(); deskPaletteInit = true; }
      if (wasXR && !xr) placeDesktopPalette();
      wasXR = xr;
      if (st.toastT > 0) { st.toastT -= dt; if (st.toastT <= 0) palette.markDirty(); }
      if (st.confirmT > 0) { st.confirmT -= dt; if (st.confirmT <= 0) { st.confirm = null; palette.markDirty(); } }

      // palette on the off hand in VR
      if (xr) {
        palette.mesh.visible = O.present;
        if (O.present) {
          tmp.set(input.leftHanded ? -0.02 : 0.02, 0.09, -0.12).applyQuaternion(O.gripQuat).add(O.gripPos);
          palette.mesh.position.copy(tmp);
          palette.mesh.quaternion.copy(O.gripQuat).multiply(qTmp.setFromAxisAngle(tmp2.set(1, 0, 0), -1.0));
        }
      } else palette.mesh.visible = true;
      if (!input.desktop || xr) loco.update(dt, input, rig, { move: true, turn: true });
      else loco.update(dt, input, rig, { move: true, turn: false });

      // brush pose
      world.updateMatrixWorld();
      invWorld.copy(world.matrixWorld).invert();
      upW.set(0, 1, 0).applyQuaternion(M.rayQuat); fwdW.set(0, 0, -1).applyQuaternion(M.rayQuat);
      if (xr) tipW.copy(M.rayPos).addScaledVector(fwdW, TIP);
      else {
        camera.getWorldPosition(camPos);
        rayO.copy(M.rayPos); rayD.copy(fwdW);
        if (live && !st.eraser) {
          const den = rayD.dot(planeN);
          const t = den > 1e-3 ? tmp.subVectors(planeP, rayO).dot(planeN) / den : st.depth;
          tipW.copy(rayO).addScaledVector(rayD, THREE.MathUtils.clamp(t, 0.2, 20));
        } else {
          tipW.copy(rayO).addScaledVector(rayD, st.depth);
          planeN.copy(rayD); planeP.copy(tipW);
        }
      }
      // stabilizer
      if (!live || st.smooth < 0.02 || st.line) tipS.copy(tipW);
      else tipS.lerp(tipW, 1 - Math.exp(-(3 + 60 * Math.pow(1 - st.smooth / 0.9, 2.2)) * dt));

      // palette pointer
      const hit = (live || grab.n) ? null : pointer.update(M, { show: true, far: xr ? 0.9 : 8 });
      if (live || grab.n) { pointer.line.visible = pointer.dot.visible = false; palette.redraw(); }
      if (hit && !live) {
        if (M.triggerDown) { uiCapture = true; if (hit.button) { pointer.click(hit); click(); M.haptic(0.2, 15); } }
        if (hit.button && dragIds.has(hit.button.id) && M.trigger > 0.5) dragUI(hit.button.id, hit.uv);
      }
      if (uiCapture && M.trigger < 0.1) uiCapture = false;

      // grab / desktop keys / buttons
      const grabbing = updateGrab();
      if (input.desktop && !xr) handleKeys(dt);
      if (M.a) undo();
      if (M.b) redo();
      if (xr && O.a) { st.eraser = !st.eraser; palette.markDirty(); click(); }
      if (xr && O.stick) { st.env = (st.env + 1) % ENVS.length; applyEnv(); palette.markDirty(); }
      if (Math.abs(M.axes[1]) > 0.3) { st.size = THREE.MathUtils.clamp(st.size * Math.exp(-M.axes[1] * dt * 1.6), SIZE_MIN, SIZE_MAX); palette.markDirty(); }

      // local brush frame
      tipL.copy(tipS).applyMatrix4(invWorld);
      upL.copy(upW).transformDirection(invWorld); fwdL.copy(fwdW).transformDirection(invWorld);

      // pressure
      const trig = M.present ? M.trigger : 0;
      const raw = input.desktop && !xr ? (trig > 0.5 ? (input.key('ShiftLeft') || input.key('ShiftRight') ? 0.4 : 1) : 0) : THREE.MathUtils.clamp((trig - 0.04) / 0.9, 0, 1);
      pressure += (Math.max(0.04, raw) - pressure) * Math.min(1, dt * 25);

      // paint / erase
      const canPaint = M.present && !uiCapture && !hit && !(grabbing && M.squeeze > 0.5);
      if (st.eraser) {
        if (live) endStroke();
        if (canPaint && trig > 0.3) {
          const r = Math.max(0.02, st.size * 0.8) / world.scale.x;
          engine.hitTest(tipL.x, tipL.y, tipL.z, r, hits);
          if (hits.length) {
            eraseAction ??= { type: 'erase', strokes: [] };
            for (const s of hits) { engine.remove(s); eraseAction.strokes.push(s); }
            M.haptic(0.6, 40); sfx.noise({ freq: 900, dur: 0.12, gain: 0.08 }); palette.markDirty();
          }
        } else if (eraseAction) { pushAction(eraseAction); eraseAction = null; palette.markDirty(); }
      } else {
        if (eraseAction) { pushAction(eraseAction); eraseAction = null; }
        const down = xr ? trig > 0.06 : trig > 0.5;
        if (!live && down && canPaint) { tipS.copy(tipW); tipL.copy(tipS).applyMatrix4(invWorld); beginStroke(); }
        else if (live && (xr ? trig < 0.03 : trig < 0.5)) endStroke();
        else if (live) continueStroke();
      }
      // brush sound + haptics while painting
      const speed = live ? M.velocity.length() : 0;
      swishGain(live && xr ? Math.min(0.06, speed * 0.05 * (0.3 + pressure)) : 0);
      if (live && xr) { hapT -= dt; if (hapT <= 0) { hapT = 0.05; M.haptic(Math.min(0.25, 0.04 + speed * 0.1) * pressure, 12); } }
      engine.flush();
      engine.uTime.value = time;

      // brush visuals
      setCursorColor();
      const w = st.size * (st.brush === 3 ? 0.9 : 0.5) * (live ? (0.3 + 0.7 * pressure) : 1);
      brushModel.visible = xr && M.present;
      if (brushModel.visible) { brushModel.position.copy(M.rayPos); brushModel.quaternion.copy(M.rayQuat); brushModel.userData.tuft.visible = !st.eraser; }
      eraserBall.visible = st.eraser && M.present;
      if (eraserBall.visible) { eraserBall.position.copy(tipW); eraserBall.scale.setScalar(Math.max(0.02, st.size * 0.8)); }
      cursor.visible = xr && !st.eraser && M.present && !hit;
      if (cursor.visible) { cursor.position.copy(tipS); cursor.scale.setScalar(Math.max(0.002, w)); }
      ring.visible = !xr && !st.eraser && !hit;
      if (ring.visible) { ring.position.copy(tipS); ring.quaternion.copy(M.rayQuat); ring.scale.setScalar(Math.max(0.004, w)); }

      music.update();
      if (input.desktop && !xr) {
        const b = st.eraser ? 'Eraser' : BRUSHES[st.brush].name;
        ctx.setHud(`<b>${b}</b>${st.line ? ' · line' : ''} · ${(st.size * 100).toFixed(1)} cm · depth ${st.depth.toFixed(2)} m · symmetry ${SYMS[st.sym]} · ${engine.strokes.length} strokes` +
          `<br><small>LMB paint (Shift = light) · wheel depth · 1–7 brush · 8 line · 9 eraser · 0 symmetry · Ctrl+Z / E undo · Ctrl+Y / R redo · [ ] size · RMB/F grab · , . rotate · − = scale · T scene · M music · P palette</small>`);
      }
    },
    onXREnd() { ctx.save('paint:autosave', engine.serialize()); },
    dispose() {
      if (live) endStroke();
      ctx.save('paint:autosave', engine.serialize());
      ctx.save('paint:settings', { brush: st.brush, size: st.size, smooth: st.smooth, hsv: st.hsv, env: st.env, music: st.music, mannequin: st.mannequin, vase: st.vase });
      music.dispose();
      if (swish) { try { swish.src.stop(); swish.g.disconnect(); } catch { } swish = null; }
      if (window.__paint?.engine === engine) delete window.__paint;
    },
  };
}
