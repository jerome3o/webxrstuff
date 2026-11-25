import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural meshes and canvas textures for lanterns, glyphs, incense pots and lattice walls.

export const LANTERN_R = 0.2;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function paint(geo, r, g, b) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = g; a[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function flatUV(geo, u = 0.5, v = 0.5) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = u; a[i * 2 + 1] = v; }
  geo.setAttribute('uv', new THREE.BufferAttribute(a, 2));
  return geo;
}
// Shade by normal.y to fake a top light on unlit materials.
function shade(geo, k = 0.45) {
  const n = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < c.count; i++) { const f = 1 - k + k * (0.5 + 0.5 * n.getY(i)); c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f); }
  return geo;
}

function lanternProfile() {
  const pts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + Math.PI * i / N;
    const r = Math.max(0.07, LANTERN_R * Math.pow(Math.cos(a), 0.8));
    pts.push(new THREE.Vector2(r, 0.21 * Math.sin(a)));
  }
  return pts;
}

// Paper texture: warm paper, horizontal bamboo ribs, faint fibres.
export function makePaperTexture() {
  return canvasTex(256, 256, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#b9a58a'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#b9a58a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(150,110,70,${Math.random() * 0.08})`; c.fillRect(Math.random() * W, Math.random() * H, 1, 6 + Math.random() * 20); }
    for (let i = 1; i < 10; i++) {
      const y = i * H / 10;
      c.fillStyle = 'rgba(80,40,15,0.45)'; c.fillRect(0, y - 2, W, 4);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(0, y + 2, W, 2);
    }
    for (let i = 0; i < 8; i++) { c.fillStyle = 'rgba(90,50,20,0.12)'; c.fillRect(i * W / 8, 0, 2, H); }
  });
}

// Full lantern: paper body (map × vertex colour × instance colour), dark rims, tassel.
export function makeLanternGeometry() {
  const body = paint(new THREE.LatheGeometry(lanternProfile(), 18), 1, 1, 1);
  const rimT = flatUV(paint(new THREE.CylinderGeometry(0.085, 0.085, 0.035, 18), 0.12, 0.1, 0.08)); rimT.translate(0, 0.215, 0);
  const rimB = rimT.clone(); rimB.translate(0, -0.43, 0);
  const hook = flatUV(paint(new THREE.TorusGeometry(0.03, 0.008, 6, 12), 0.15, 0.12, 0.1)); hook.translate(0, 0.26, 0);
  const tassel = flatUV(paint(new THREE.ConeGeometry(0.03, 0.14, 8), 0.75, 0.75, 0.75)); tassel.rotateX(Math.PI); tassel.translate(0, -0.3, 0);
  for (const g of [hook]) if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return mergeGeometries([body, rimT, rimB, hook, tassel].map(g => g.index ? g : g.toNonIndexed()));
}

// Half lantern on the +X side of the YZ plane, with a glowing cap on the cut face.
export function makeHalfGeometry() {
  const prof = lanternProfile();
  const shell = paint(new THREE.LatheGeometry(prof, 9, 0, Math.PI), 1, 1, 1);
  const sh = new THREE.Shape();
  sh.moveTo(prof[0].x, prof[0].y);
  for (let i = 1; i < prof.length; i++) sh.lineTo(prof[i].x, prof[i].y);
  for (let i = prof.length - 1; i >= 0; i--) sh.lineTo(-prof[i].x, prof[i].y);
  const cap = flatUV(paint(new THREE.ShapeGeometry(sh), 1.7, 1.5, 1.2), 0.5, 0.52);
  cap.rotateY(-Math.PI / 2);
  return mergeGeometries([shell, cap]);
}

// Brush-ink glyphs: a chevron stroke (cut direction, pointing down = swing down) and an ensō (any direction).
function brushPath(c, pts, w0, w1, seed) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  let total = 0; const segs = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); total += l; }
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], l = segs[i - 1];
    const n = Math.ceil(l / 1.5);
    for (let k = 0; k < n; k++) {
      const f = k / n, u = (acc + f * l) / total;
      const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
      const w = (w0 + (w1 - w0) * u) * (u < 0.06 ? 0.6 + u * 6 : 1);
      c.globalAlpha = u > 0.8 ? 0.55 + rnd() * 0.45 : 0.92;
      c.beginPath(); c.ellipse(x + (rnd() - 0.5) * 2, y + (rnd() - 0.5) * 2, w, w * 0.8, 0.6, 0, Math.PI * 2); c.fill();
      if (u > 0.75 && rnd() < 0.3) { c.globalAlpha = 0.5; c.fillRect(x + (rnd() - 0.5) * w * 2, y + (rnd() - 0.5) * w * 2, 2, 2); }
    }
    acc += l;
  }
  c.globalAlpha = 1;
}
export function makeGlyphTextures() {
  const ink = '#1a0b08';
  const arrow = canvasTex(256, 256, (c) => {
    c.fillStyle = ink;
    brushPath(c, [[44, 70], [92, 120], [128, 176]], 20, 15, 7);
    brushPath(c, [[128, 176], [168, 124], [214, 66]], 15, 7, 11);
    c.fillStyle = 'rgba(255,240,210,0.0)';
  });
  const dot = canvasTex(256, 256, (c) => {
    c.fillStyle = ink;
    const pts = [];
    for (let i = 0; i <= 40; i++) { const a = -2.2 + i / 40 * Math.PI * 1.75; pts.push([128 + Math.cos(a) * 62, 128 + Math.sin(a) * 62]); }
    brushPath(c, pts, 17, 6, 5);
  });
  return { arrow, dot };
}

// Incense pot "bomb": bronze censer with a red ember. Vertex colours, unlit, top-lit shading baked.
export function makeBombGeometry() {
  const prof = [[0.0, -0.11], [0.1, -0.1], [0.155, -0.05], [0.165, 0.02], [0.14, 0.07], [0.15, 0.085], [0.0, 0.085]].map(p => new THREE.Vector2(p[0], p[1]));
  const body = shade(paint(new THREE.LatheGeometry(prof, 16), 0.55, 0.38, 0.18));
  const band = paint(new THREE.TorusGeometry(0.163, 0.012, 6, 24), 1.0, 0.25, 0.08); band.rotateX(Math.PI / 2); band.translate(0, 0.0, 0);
  const lid = shade(paint(new THREE.SphereGeometry(0.12, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0.5, 0.34, 0.16)); lid.scale(1, 0.75, 1); lid.translate(0, 0.085, 0);
  const knob = paint(new THREE.SphereGeometry(0.035, 10, 8), 1.6, 0.35, 0.1); knob.translate(0, 0.19, 0);
  const parts = [body, band, lid, knob];
  for (let i = 0; i < 3; i++) {
    const leg = shade(paint(new THREE.CylinderGeometry(0.018, 0.012, 0.09, 6), 0.4, 0.28, 0.12));
    const a = i * Math.PI * 2 / 3; leg.translate(Math.cos(a) * 0.1, -0.14, Math.sin(a) * 0.1); parts.push(leg);
  }
  // incense sticks
  for (let i = 0; i < 3; i++) {
    const st = paint(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 4), 0.6, 0.2, 0.1); st.rotateZ((i - 1) * 0.25); st.translate((i - 1) * 0.03, 0.27, 0); parts.push(st);
    const tip = paint(new THREE.SphereGeometry(0.009, 6, 4), 3, 0.8, 0.3); tip.translate((i - 1) * 0.03 - Math.sin((i - 1) * 0.25) * 0.08, 0.27 + Math.cos((i - 1) * 0.25) * 0.08, 0); parts.push(tip);
  }
  return mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g.index ? g : g.toNonIndexed(); }));
}

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.25)') {
  return canvasTex(128, 128, (c, W) => {
    const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, inner); g.addColorStop(0.25, mid); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  });
}

// Vermilion lattice screen for obstacle walls.
export function makeLatticeTexture() {
  return canvasTex(256, 256, (c, W, H) => {
    c.fillStyle = 'rgba(255,70,40,0.14)'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,140,90,0.75)'; c.lineWidth = 4;
    for (let i = 1; i < 6; i++) { c.beginPath(); c.moveTo(i * W / 6, 0); c.lineTo(i * W / 6, H); c.stroke(); c.beginPath(); c.moveTo(0, i * H / 6); c.lineTo(W, i * H / 6); c.stroke(); }
    c.strokeStyle = 'rgba(255,200,150,1)'; c.lineWidth = 14; c.strokeRect(7, 7, W - 14, H - 14);
  });
}

// Wooden ring texture for ripples/flash rings.
export function makeRingTexture() {
  return canvasTex(128, 128, (c, W) => {
    const g = c.createRadialGradient(W / 2, W / 2, W * 0.3, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  });
}
