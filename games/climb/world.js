import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeLabel, FONTS } from '../../src/platform/kit.js';
import { TOWERS, ROUTES, MASSIF, TERRACE, VALLEY_Y, towerR, profileR, surfacePoint, R0 } from './routes.js';

// Builds every static and animated piece of the Cliffside world.
// Draw calls are kept low: one merged rock mesh, one merged structure mesh, one valley mesh,
// instanced holds / tokens / lanterns / clouds / birds.

export const SUN_DIR = new THREE.Vector3(0.45, 0.42, 0.79).normalize();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function rand(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Give a geometry a uniform attribute set so everything can be merged.
function prep(geo, color, { uv = true } = {}) {
  if (!geo.index) { /* all our generators are indexed */ }
  const n = geo.attributes.position.count;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.color) {
    const c = new Float32Array(n * 3); _c.set(color);
    for (let i = 0; i < n; i++) { c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  if (uv && !geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (!uv && geo.attributes.uv) geo.deleteAttribute('uv');
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) geo.deleteAttribute(k);
  if (!geo.index) {
    const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  return geo;
}
function tint(geo, fn) {
  const p = geo.attributes.position, nrm = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) { fn(_c, p.getX(i), p.getY(i), p.getZ(i), nrm.getY(i)); c.setXYZ(i, _c.r, _c.g, _c.b); }
}

// ── Textures ────────────────────────────────────────────────
function rockTexture() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), r = rand(42);
  // tileable multi-octave value noise
  const N = (cells, seed) => { const rr = rand(seed), v = new Float32Array(cells * cells); for (let i = 0; i < v.length; i++) v[i] = rr(); return v; };
  const octs = [[4, 0.45], [8, 0.25], [16, 0.15], [32, 0.09], [64, 0.06]].map(([c, w], k) => ({ c, w, v: N(c, 11 + k) }));
  const sample = (o, x, y) => {
    const fx = x / S * o.c, fy = y / S * o.c, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), c = o.c;
    const at = (i, j) => o.v[((j % c + c) % c) * c + ((i % c + c) % c)];
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  const img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let n = 0; for (const o of octs) n += sample(o, x, y) * o.w;
    // streaks: stretched noise (low freq in x, very low in y)
    const st = sample(octs[3], x, y * 0.12) - 0.5;
    let l = 150 + (n - 0.5) * 120 - Math.max(0, st) * 70;
    const warm = sample(octs[1], x + 97, y + 31);
    const i = (y * S + x) * 4;
    d[i] = l + 8 + warm * 10; d[i + 1] = l + 4 + warm * 4; d[i + 2] = l - 6; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // pits and cracks
  for (let i = 0; i < 260; i++) { const x = r() * S, y = r() * S; g.fillStyle = `rgba(60,56,50,${0.06 + r() * 0.12})`; g.beginPath(); g.arc(x, y, 0.6 + r() * 1.6, 0, 6.3); g.fill(); }
  g.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    let x = r() * S, y = r() * S; g.strokeStyle = `rgba(45,40,34,${0.12 + r() * 0.18})`; g.lineWidth = 0.7 + r() * 0.9;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 14; y += 4 + r() * 12; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.generateMipmaps = true;
  return t;
}
function pavingTexture() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), r = rand(7);
  g.fillStyle = '#6f6a5e'; g.fillRect(0, 0, S, S);
  const rows = 6;
  for (let j = 0; j < rows; j++) {
    let x = -r() * 60; const h = S / rows;
    while (x < S) {
      const w = 60 + r() * 70, l = 140 + r() * 40;
      g.fillStyle = `rgb(${l},${l - 4},${l - 14})`;
      g.fillRect(x + 3, j * h + 3, w - 6, h - 6);
      g.fillStyle = `rgba(80,110,60,${r() * 0.25})`; g.fillRect(x + 3, j * h + h - 10, w - 6, 7);
      x += w;
    }
  }
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 9); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function cloudTexture() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), r = rand(99);
  for (let i = 0; i < 22; i++) {
    const x = S / 2 + (r() - 0.5) * S * 0.5, y = S / 2 + (r() - 0.5) * S * 0.5, rad = S * (0.12 + r() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── Tower / massif geometry ─────────────────────────────────
function pillarGeometry(t, { y0 = -2, dy = 0.5, NS = 80, cap = true }) {
  const rows = [];
  for (let y = y0; ; y += dy) { const yy = Math.min(y, t.H); rows.push(yy); if (yy >= t.H) break; }
  const pos = [], uv = [], idx = [];
  const R0v = R0(t);
  const pushRow = (fn) => { for (let i = 0; i <= NS; i++) { const phi = -Math.PI + (i / NS) * Math.PI * 2; const p = fn(phi); pos.push(p[0], p[1], p[2]); uv.push(phi * R0v / 1.7, p[1] / 1.7); } };
  for (const y of rows) pushRow((phi) => { const r = towerR(t, phi, y); return [t.cx + r * Math.sin(phi), y, t.cz + r * Math.cos(phi)]; });
  let nRows = rows.length;
  if (cap) {
    for (const f of [0.93, 0.7, 0.4, 0]) {
      pushRow((phi) => { const r = towerR(t, phi, t.H) * f; return [t.cx + r * Math.sin(phi), t.H + (f > 0.9 ? 0.0 : 0.02), t.cz + r * Math.cos(phi)]; });
      for (let i = 0; i <= NS; i++) { const k = uv.length - (NS + 1 - i) * 2, pi = pos.length - (NS + 1 - i) * 3; uv[k] = pos[pi] / 1.7; uv[k + 1] = pos[pi + 2] / 1.7; }
      nRows++;
    }
  }
  for (let j = 0; j < nRows - 1; j++) for (let i = 0; i < NS; i++) {
    const a = j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function rockColor(c, x, y, z, ny, seed) {
  const n = 0.5 + 0.25 * Math.sin(x * 1.3 + y * 0.7 + seed) + 0.25 * Math.sin(z * 1.1 - y * 1.9 + seed * 2);
  c.setRGB(0.86 + 0.1 * n, 0.83 + 0.09 * n, 0.77 + 0.08 * n);
  // dark water-stain bands
  const stain = smooth(0.6, 1.0, Math.sin(x * 2.1 + z * 1.7 + seed) * Math.sin(y * 0.23 + seed));
  c.multiplyScalar(1 - 0.25 * stain);
  // shrubs and moss cling to ledges, seams and upward faces
  const patch = Math.sin(x * 0.8 + y * 0.31 + seed) * 0.5 + Math.sin(z * 0.9 - y * 0.43 + seed * 3) * 0.5 + Math.sin(y * 1.7 + x * 0.3) * 0.25;
  const moss = Math.max(smooth(0.35, 0.8, ny), smooth(0.45, 0.9, patch) * (ny > -0.25 ? 0.85 : 0));
  c.lerp(_c2.setRGB(0.33 + 0.08 * n, 0.47 + 0.06 * n, 0.24), Math.min(0.92, moss));
  if (ny < -0.15) c.multiplyScalar(0.8);
}
const _c2 = new THREE.Color();

// ── Main builder ────────────────────────────────────────────
export function buildWorld(scene) {
  const W = { grabs: [], holds: [], bars: [], surfaces: [], tokens: [], cps: [[], [], []], starts: [], lanterns: null, update: null };

  // Sky dome with a warm misty horizon and soft sun glow
  {
    const g = new THREE.SphereGeometry(2400, 40, 20), p = g.attributes.position, col = new Float32Array(p.count * 3);
    const zen = new THREE.Color(0x5d8fc4), hor = new THREE.Color(0xf0dcc6), below = new THREE.Color(0xc5d0d2), sun = new THREE.Color(0xfff0d0);
    for (let i = 0; i < p.count; i++) {
      _v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const y = _v.y;
      if (y > 0) _c.copy(hor).lerp(zen, Math.pow(Math.min(1, y * 1.6), 0.7)); else _c.copy(hor).lerp(below, Math.min(1, -y * 6));
      const sd = Math.max(0, _v.dot(SUN_DIR));
      _c.lerp(sun, Math.pow(sd, 12) * 0.8 + Math.pow(sd, 3) * 0.12);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10; scene.add(sky);
  }
  scene.background = new THREE.Color(0xcdd6d8);
  scene.fog = new THREE.Fog(0xd3d9d6, 90, 1700);
  scene.add(new THREE.HemisphereLight(0xe4ecf4, 0x5b6450, 1.25));
  const sunL = new THREE.DirectionalLight(0xffe4bf, 1.9); sunL.position.copy(SUN_DIR).multiplyScalar(100); scene.add(sunL);

  // ── Rock: towers, massif, ledges (one mesh) ──
  const rockGeos = [];
  TOWERS.forEach((t) => {
    const g = pillarGeometry(t, { y0: -2, dy: 0.5, NS: 84, cap: true });
    prep(g, 0xffffff); tint(g, (c, x, y, z, ny) => rockColor(c, x, y, z, ny, t.seed));
    rockGeos.push(g);
  });
  {
    const g = pillarGeometry(MASSIF, { y0: -178, dy: 3, NS: 110, cap: false });
    prep(g, 0xffffff); tint(g, (c, x, y, z, ny) => { rockColor(c, x, y, z, ny, 3); const veg = smooth(0.6, 0.9, Math.sin(x * 0.11 + y * 0.07) * 0.5 + 0.5 + Math.sin(z * 0.13 - y * 0.05) * 0.4); c.lerp(_c2.setRGB(0.28, 0.42, 0.22), veg * 0.8); });
    rockGeos.push(g);
  }
  // Ledges (also standing surfaces + checkpoints)
  ROUTES.forEach((rt) => {
    const t = TOWERS[rt.tower];
    rt.ledges.forEach((L, li) => {
      const R0v = R0(t), phi0 = L.s0 / R0v, phi1 = L.s1 / R0v;
      let rmax = 0; for (let k = 0; k <= 10; k++) rmax = Math.max(rmax, towerR(t, phi0 + (phi1 - phi0) * k / 10, L.y), towerR(t, phi0 + (phi1 - phi0) * k / 10, L.y - 0.4));
      const rOut = rmax + L.depth;
      const segs = Math.max(4, Math.ceil((phi1 - phi0) * rOut / 0.25));
      const g = new THREE.CylinderGeometry(rOut, rOut - 0.45, 0.42, segs, 1, false, phi0, phi1 - phi0);
      g.translate(t.cx, L.y - 0.21, t.cz);
      prep(g, 0xffffff); tint(g, (c, x, y, z, ny) => { rockColor(c, x, y, z, ny, 5); if (ny > 0.5) c.setRGB(0.55, 0.6, 0.42); });
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, g.attributes.position.getX(i) / 3, g.attributes.position.getZ(i) / 3 + g.attributes.position.getY(i) / 3);
      rockGeos.push(g);
      const surf = { kind: 'sector', tower: t, phi0, phi1, rOut, y: L.y, route: rt.id, cp: L.cp, name: `ledge ${li + 1}` };
      W.surfaces.push(surf);
      if (L.cp) {
        const phiC = (phi0 + phi1) / 2, rr = towerR(t, phiC, L.y + 1.6) + 0.65;
        W.cps[rt.id].push(surf.cpEntry = { kind: 'ledge', surface: surf, x: t.cx + Math.sin(phiC) * rr, z: t.cz + Math.cos(phiC) * rr, y: L.y, yaw: phiC, lantern: null,
          lanternPos: new THREE.Vector3(t.cx + Math.sin(phi1 - 0.25 / R0v) * (rOut - 0.3), L.y + 0.55, t.cz + Math.cos(phi1 - 0.25 / R0v) * (rOut - 0.3)) });
      }
    });
    W.surfaces.push({ kind: 'disc', cx: t.cx, cz: t.cz, rad: Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(k => towerR(t, k * Math.PI / 4, t.H))) - 0.15, y: t.H, route: rt.id, summit: true, name: 'summit' });
  });
  W.surfaces.push({ kind: 'disc', cx: TERRACE.cx, cz: TERRACE.cz, rad: TERRACE.walk, y: 0, route: -1, terrace: true, name: 'terrace' });

  const rockTex = rockTexture();
  const rockMat = new THREE.MeshLambertMaterial({ map: rockTex, vertexColors: true, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(mergeGeometries(rockGeos), rockMat));
  rockGeos.forEach(g => g.dispose());

  // Terrace paving
  {
    const g = new THREE.CircleGeometry(TERRACE.disc, 96); g.rotateX(-Math.PI / 2); g.translate(TERRACE.cx, 0.002, TERRACE.cz);
    const uv = g.attributes.uv, p = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 50, p.getZ(i) / 50);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: pavingTexture() })));
  }

  // ── Valley: terrain, distant karst, water ──
  {
    const geos = [];
    const riverZ = (x) => 230 + 90 * Math.sin(x / 260) + 40 * Math.sin(x / 97 + 2);
    const g = new THREE.PlaneGeometry(4400, 4400, 150, 150); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const dr = Math.abs(z - riverZ(x));
      let h = 6 * Math.sin(x / 90) * Math.sin(z / 110) + 4 * Math.sin(x / 37 + z / 53) + 12 * smooth(400, 1500, Math.hypot(x, z));
      h *= smooth(20, 90, dr);
      h -= 6 * (1 - smooth(10, 40, dr));
      p.setY(i, VALLEY_Y + 1 + h);
    }
    g.computeVertexNormals();
    prep(g, 0xffffff, { uv: false });
    tint(g, (c, x, y, z) => {
      const dr = Math.abs(z - riverZ(x));
      const f = 0.5 + 0.5 * Math.sin(x / 23) * Math.sin(z / 31);
      c.setRGB(0.42 + 0.12 * f, 0.55 + 0.08 * f, 0.3); // paddies / fields
      if (Math.sin(x / 61 + z / 47) > 0.4) c.setRGB(0.27, 0.4, 0.24); // woods
      c.lerp(_c2.setRGB(0.78, 0.74, 0.6), 1 - smooth(14, 26, dr)); // sandbanks
    });
    geos.push(g);
    // distant karst towers
    const r = rand(1234);
    for (let i = 0; i < 90; i++) {
      const ang = r() * Math.PI * 2, dist = 110 + Math.pow(r(), 0.8) * 1300;
      const x = Math.sin(ang) * dist, z = Math.cos(ang) * dist - 8;
      if (Math.abs(z - riverZ(x)) < 45) continue;
      const rad = 14 + r() * 30, hgt = dist < 380 && Math.cos(ang) > -0.2 ? 60 + r() * 95 : 90 + r() * 210 + (dist > 600 ? 60 : 0);
      const pts = [];
      const bulge = 0.9 + r() * 0.35;
      for (let k = 0; k <= 10; k++) { const u = k / 10; const rr = rad * (u < 0.85 ? (1.15 - 0.25 * u + 0.18 * Math.sin(u * 7 + i) * bulge) : (1.15 - 0.25 * u) * Math.sqrt(Math.max(0, (1 - u) / 0.15))); pts.push(new THREE.Vector2(Math.max(0.01, rr), u * hgt)); }
      const lg = new THREE.LatheGeometry(pts, 12);
      lg.translate(x, VALLEY_Y - 4, z);
      prep(lg, 0xffffff, { uv: false });
      const shade = 0.75 + r() * 0.25;
      tint(lg, (c, px, py, pz, ny) => { const u = (py - VALLEY_Y) / hgt; c.setRGB(0.36 * shade, 0.47 * shade, 0.33 * shade); if (Math.sin(py * 0.08 + px * 0.05) > 0.55 && ny < 0.5) c.setRGB(0.62 * shade, 0.62 * shade, 0.56 * shade); if (u > 0.85) c.setRGB(0.3 * shade, 0.44 * shade, 0.28 * shade); });
      geos.push(lg);
    }
    const merged = mergeGeometries(geos); geos.forEach(x => x.dispose());
    scene.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(4400, 4400), new THREE.MeshPhongMaterial({ color: 0x7a98a0, specular: 0x667777, shininess: 40 }));
    water.rotation.x = -Math.PI / 2; water.position.y = VALLEY_Y - 1.5; scene.add(water);
  }

  // ── Structures: railing, ladders, summit buildings, trees, posts (one mesh) ──
  const sg = [];
  const box = (w, h, d, x, y, z, color, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); sg.push(prep(g, color, { uv: false })); return g; };
  const cyl = (rt, rb, h, x, y, z, color, seg = 8) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(x, y, z); sg.push(prep(g, color, { uv: false })); };
  const roof = (w, h, x, y, z, color) => { const g = new THREE.ConeGeometry(w, h, 4, 1); g.rotateY(Math.PI / 4); g.translate(x, y + h / 2, z); sg.push(prep(g, color, { uv: false })); };
  // railing (stone posts + timber rails) around the terrace
  {
    const N = 80, R = TERRACE.rail;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, x = TERRACE.cx + Math.sin(a) * R, z = TERRACE.cz + Math.cos(a) * R;
      box(0.16, 1.05, 0.16, x, 0.52, z, 0x9a958a, a);
      const a2 = ((i + 0.5) / N) * Math.PI * 2, len = 2 * Math.PI * R / N;
      const xm = TERRACE.cx + Math.sin(a2) * R, zm = TERRACE.cz + Math.cos(a2) * R;
      box(len, 0.08, 0.08, xm, 0.98, zm, 0x7a3b22, a2);
      box(len, 0.06, 0.06, xm, 0.55, zm, 0x7a3b22, a2);
    }
  }
  // ladders (rails; rungs are grabbable bars added below)
  ROUTES.forEach((rt) => {
    const t = TOWERS[rt.tower];
    for (const L of rt.ladders) {
      for (const s of [L.s0 - 0.04, L.s1 + 0.04]) {
        const a = surfacePoint(t, s, L.y0, L.out, { x: 0, y: 0, z: 0 }), b = surfacePoint(t, s, L.y1, L.out, { x: 0, y: 0, z: 0 });
        const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const g = new THREE.BoxGeometry(0.06, len, 0.05);
        _v.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize(); _q.setFromUnitVectors(UP, _v);
        g.applyQuaternion(_q); g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        sg.push(prep(g, 0x8a5a32, { uv: false }));
        // brackets into rock
        for (let y = L.y0 + 0.3; y < L.y1; y += 1.4) { const p = surfacePoint(t, s, y, L.out / 2, { x: 0, y: 0, z: 0 }); box(0.04, 0.04, L.out + 0.25, p.x, p.y, p.z, 0x555555, s / R0(t)); }
      }
    }
  });
  // Summit 1: a memorial archway (paifang) with a tiled hip roof
  {
    const t = TOWERS[0], x = t.cx, z = t.cz - 0.6, y = t.H;
    for (const dx of [-1.1, 1.1]) { box(0.24, 2.7, 0.24, x + dx, y + 1.35, z, 0xa8322a); box(0.55, 0.3, 0.55, x + dx, y + 0.15, z, 0x8f8a80); }
    box(2.6, 0.2, 0.22, x, y + 2.25, z, 0xa8322a);
    box(1.0, 0.42, 0.06, x, y + 2.6, z + 0.02, 0x2b3b33); box(0.8, 0.3, 0.07, x, y + 2.6, z + 0.03, 0xe2b85c);
    box(2.8, 0.18, 0.4, x, y + 2.88, z, 0x6b2a1f);
    const g = new THREE.ConeGeometry(1, 0.6, 4, 1); g.rotateY(Math.PI / 4); g.scale(2.3, 1, 0.55); g.translate(x, y + 3.27, z); sg.push(prep(g, 0x2f4038, { uv: false }));
    box(1.4, 0.1, 0.1, x, y + 3.55, z, 0x2f4038);
  }
  // Summit 2: a small pavilion
  {
    const t = TOWERS[1], x = t.cx, z = t.cz - 0.4, y = t.H;
    box(3.2, 0.3, 3.2, x, y + 0.15, z, 0x9a958a);
    for (const dx of [-1.3, 1.3]) for (const dz of [-1.3, 1.3]) cyl(0.1, 0.1, 2.4, x + dx, y + 1.5, z + dz, 0xa8322a);
    box(3.0, 0.18, 3.0, x, y + 2.75, z, 0x6b2a1f);
    roof(3.0, 1.3, x, y + 2.84, z, 0x2f4038);
    cyl(0.05, 0.12, 0.5, x, y + 4.3, z, 0xe2b85c, 6);
  }
  // Summit 3: the five-tier pagoda
  {
    const t = TOWERS[2], x = t.cx, z = t.cz - 0.3; let y = t.H;
    box(4.6, 0.4, 4.6, x, y + 0.2, z, 0x9a958a); y += 0.4;
    for (let i = 0; i < 5; i++) {
      const w = 3.3 - i * 0.48, h = i === 0 ? 1.9 : 1.25;
      box(w, h, w, x, y + h / 2, z, 0x9d2f25);
      box(w * 0.5, h * 0.55, 0.04, x, y + h * 0.45, z + w / 2 + 0.01, 0x3a2018);
      box(w + 0.3, 0.14, w + 0.3, x, y + h, z, 0xe8dcc0);
      roof(w * 1.12, 0.75, x, y + h + 0.07, z, 0x2b3b36);
      y += h + 0.55;
    }
    cyl(0.04, 0.06, 2.2, x, y + 0.9, z, 0xe2b85c, 6);
    for (let k = 0; k < 4; k++) { const g = new THREE.SphereGeometry(0.16 - k * 0.025, 8, 6); g.translate(x, y + 0.3 + k * 0.38, z); sg.push(prep(g, 0xe2b85c, { uv: false })); }
  }
  // pines on summits and terrace edge
  {
    const r = rand(77);
    const pine = (x, y, z, s) => {
      cyl(0.06 * s, 0.09 * s, 1.0 * s, x, y + 0.5 * s, z, 0x5a4030, 5);
      for (let k = 0; k < 3; k++) { const g = new THREE.ConeGeometry((0.9 - k * 0.22) * s, 0.9 * s, 7); g.translate(x, y + (0.9 + k * 0.5) * s, z); sg.push(prep(g, k % 2 ? 0x2e5a3a : 0x356a40, { uv: false })); }
    };
    TOWERS.forEach((t) => {
      const R = profileR(t, t.H) - 0.9;
      for (let i = 0; i < 6; i++) { const a = Math.PI * 0.55 + r() * Math.PI * 0.9 + (r() < 0.5 ? 0 : Math.PI * 0.6); const rr = R * (0.5 + r() * 0.45); pine(t.cx + Math.sin(a) * rr, t.H, t.cz + Math.cos(a) * rr, 0.7 + r() * 0.6); }
    });
    for (let i = 0; i < 14; i++) { const a = Math.PI * 0.62 + (i / 14) * Math.PI * 0.76 + (r() - 0.5) * 0.1; const rr = TERRACE.walk - 0.8 - r() * 0.6; if (Math.abs(Math.sin(a)) < 0.25) continue; pine(TERRACE.cx + Math.sin(a) * rr, 0, TERRACE.cz + Math.cos(a) * rr, 1.1 + r() * 0.7); }
  }
  // stone lanterns + steles at route starts
  const startLbls = [];
  ROUTES.forEach((rt) => {
    const t = TOWERS[rt.tower], rr = profileR(t, 1) + 2.2, phi = 0;
    const x = t.cx + Math.sin(phi) * rr, z = t.cz + Math.cos(phi) * rr;
    W.cps[rt.id].unshift({ kind: 'start', x, z: z + 0.4, y: 0, yaw: 0, lantern: null, lanternPos: new THREE.Vector3(x + 1.6, 1.25, z - 0.7) });
    W.starts.push({ x, z: z + 0.4, yaw: 0 });
    box(0.5, 0.9, 0.5, x + 1.6, 0.45, z - 0.7, 0x8f8a80); box(0.75, 0.12, 0.75, x + 1.6, 0.96, z - 0.7, 0x77726a);
    roof(0.62, 0.32, x + 1.6, 1.5, z - 0.7, 0x55524c);
    box(0.9, 1.4, 0.18, x - 1.7, 0.7, z - 0.6, 0x6d6a62); box(1.05, 0.12, 0.3, x - 1.7, 1.46, z - 0.6, 0x4a4842);
    const lbl = makeLabel(`${rt.zh}  ${rt.id + 1}`, { size: 0.24, color: rt.color, font: FONTS.brush, bg: 'rgba(20,18,16,0.85)', px: 72 });
    lbl.position.set(x - 1.7, 1.85, z - 0.5); scene.add(lbl); startLbls.push(lbl);
  });
  // ledge lantern posts
  W.cps.forEach((list) => list.forEach((cp) => { if (cp.kind === 'ledge') cyl(0.03, 0.03, 0.42, cp.lanternPos.x, cp.y + 0.21, cp.lanternPos.z, 0x3a2a20, 5); }));

  scene.add(new THREE.Mesh(mergeGeometries(sg), new THREE.MeshLambertMaterial({ vertexColors: true })));
  sg.forEach(g => g.dispose());

  // ── Holds (instanced per type) ──
  const holdGeos = {
    jug: (() => { const g = new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62); g.rotateX(Math.PI / 2); g.scale(1.55, 0.95, 1.0); return g; })(),
    crimp: (() => { const g = new RoundedBoxGeometry(0.17, 0.032, 0.06, 2, 0.012); g.translate(0, 0, 0.015); return g; })(),
    crumble: (() => { const g = new THREE.DodecahedronGeometry(0.075, 0); g.scale(1.25, 0.85, 0.8); return g; })(),
    moving: (() => { const g = new THREE.CylinderGeometry(0.075, 0.09, 0.06, 14); g.rotateX(Math.PI / 2); return g; })(),
    piton: (() => { const a = new THREE.TorusGeometry(0.04, 0.01, 6, 14); a.translate(0, -0.03, 0.05); const b = new THREE.CylinderGeometry(0.012, 0.004, 0.12, 6); b.rotateX(Math.PI / 2); b.translate(0, 0, 0.0); return mergeGeometries([prep(a, 0xffffff), prep(b, 0xffffff)]); })(),
  };
  const holdMats = {
    jug: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    crimp: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    crumble: new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    moving: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x0d4a36 }),
    piton: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 }),
  };
  const holdCols = { jug: 0xd99a4e, crimp: 0xf2eee2, crumble: 0x9a5a3c, moving: 0x5ec99a, piton: 0xc8ccd4 };
  const counts = { jug: 0, crimp: 0, crumble: 0, moving: 0, piton: 3 };
  ROUTES.forEach((rt) => rt.holds.forEach((h) => counts[h.type]++));
  const meshes = {};
  for (const k in holdGeos) {
    const m = new THREE.InstancedMesh(holdGeos[k], holdMats[k], Math.max(1, counts[k]));
    m.count = 0; m.frustumCulled = false; meshes[k] = m; scene.add(m);
  }
  const rnd = rand(5);
  const setHoldMatrix = (h, extraX = 0, extraY = 0) => {
    _v.copy(h.pos); _v.x += extraX; _v.y += extraY;
    _m.makeBasis(h.right, h.up, h.normal); _m.scale(_s.setScalar(h.scale)); _m.setPosition(_v);
    if (h.broken) _m.makeScale(0, 0, 0);
    h.mesh.setMatrixAt(h.idx, _m); h.mesh.instanceMatrix.needsUpdate = true;
  };
  const addHold = (type, routeId, tower, pos, normal, opts = {}) => {
    const mesh = meshes[type];
    const h = {
      kind: 'hold', type, route: routeId, tower, pos: pos.clone(), base: pos.clone(), normal: normal.clone(), up: new THREE.Vector3(), right: new THREE.Vector3(),
      tangent: new THREE.Vector3(), mv: opts.mv ?? null, broken: false, crumbleT: 0, restoreT: 0, mesh, idx: mesh.count++, scale: opts.scale ?? 1, overhang: !!opts.overhang, active: opts.active ?? true,
    };
    const roll = (rnd() - 0.5) * (type === 'crimp' ? 0.25 : 0.7);
    // up = world up projected on the face plane (or radial for top-of-tower holds)
    if (Math.abs(normal.y) > 0.8) h.up.set(pos.x - tower.cx, 0, pos.z - tower.cz).normalize(); else h.up.copy(UP).addScaledVector(normal, -normal.dot(UP)).normalize();
    h.right.crossVectors(h.up, h.normal).normalize();
    h.tangent.copy(h.right);
    _q.setFromAxisAngle(h.normal, roll); h.up.applyQuaternion(_q); h.right.applyQuaternion(_q);
    _c.set(holdCols[type]).offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
    mesh.setColorAt(h.idx, _c);
    setHoldMatrix(h);
    W.holds.push(h); W.grabs.push(h);
    return h;
  };
  W.setHoldMatrix = setHoldMatrix;
  const P = { x: 0, y: 0, z: 0 };
  const OUT = { jug: 0.045, crimp: 0.01, crumble: 0.04, moving: 0.03, piton: 0.02 };
  ROUTES.forEach((rt) => {
    const t = TOWERS[rt.tower], R0v = R0(t);
    for (const hd of rt.holds) {
      const phi = hd.s / R0v;
      let normal;
      if (hd.top) {
        const r = towerR(t, phi, t.H) - 0.32;
        P.x = t.cx + Math.sin(phi) * r; P.y = t.H + 0.03; P.z = t.cz + Math.cos(phi) * r;
        normal = _v2.set(0, 1, 0);
      } else {
        surfacePoint(t, hd.s, hd.y, OUT[hd.type], P);
        // face normal from the surface gradient
        const e = 0.05, r = towerR(t, phi, hd.y), drdy = (towerR(t, phi, hd.y + e) - towerR(t, phi, hd.y - e)) / (2 * e);
        normal = _v2.set(Math.sin(phi), -drdy * 0.8, Math.cos(phi)).normalize();
        void r;
      }
      const slope = (profileR(t, hd.y + 0.6) - profileR(t, hd.y - 0.6)) / 1.2;
      const h = addHold(hd.type, rt.id, t, _v.set(P.x, P.y, P.z), normal, { mv: hd.mv, scale: hd.big ? 1.6 : 1, overhang: slope > 0.12 });
      if (hd.mv) {
        const R = towerR(t, phi, hd.y) + OUT[hd.type];
        h.mv = { ...hd.mv, phi, R, y: hd.y, t };
      }
    }
  });
  // piton pool (placed by the player)
  W.pitons = [];
  for (let i = 0; i < 3; i++) {
    const h = addHold('piton', -1, TOWERS[0], _v.set(0, -999, 0), _v2.set(0, 0, 1), { active: false });
    h.broken = true; setHoldMatrix(h); W.pitons.push(h);
  }

  // ── Bars: ropes, chains, ladder rungs ──
  const ropeGeos = [];
  const linkPos = [];
  const A = { x: 0, y: 0, z: 0 }, B = { x: 0, y: 0, z: 0 };
  ROUTES.forEach((rt) => {
    const t = TOWERS[rt.tower];
    for (const bd of rt.bars) {
      surfacePoint(t, bd.a.s, bd.a.y, bd.a.out, A); surfacePoint(t, bd.b.s, bd.b.y, bd.b.out, B);
      const bar = { kind: 'bar', type: bd.type, route: rt.id, tower: t, a: new THREE.Vector3(A.x, A.y, A.z), b: new THREE.Vector3(B.x, B.y, B.z), overhang: false, active: true };
      W.bars.push(bar); W.grabs.push(bar);
      const len = bar.a.distanceTo(bar.b);
      if (bd.type === 'rope' || bd.type === 'rung') {
        const g = new THREE.CylinderGeometry(bd.type === 'rope' ? 0.022 : 0.018, bd.type === 'rope' ? 0.022 : 0.018, len, 7);
        _v.subVectors(bar.b, bar.a).normalize(); _q.setFromUnitVectors(UP, _v); g.applyQuaternion(_q);
        g.translate((bar.a.x + bar.b.x) / 2, (bar.a.y + bar.b.y) / 2, (bar.a.z + bar.b.z) / 2);
        ropeGeos.push(prep(g, bd.type === 'rope' ? 0xc9ae7a : 0x9a6a3c, { uv: false }));
        if (bd.type === 'rope') { // anchor bolt + knot
          const k = new THREE.SphereGeometry(0.05, 8, 6); k.translate(bar.a.x, bar.a.y, bar.a.z); ropeGeos.push(prep(k, 0xb09060, { uv: false }));
          const k2 = new THREE.SphereGeometry(0.04, 8, 6); k2.translate(bar.b.x, bar.b.y, bar.b.z); ropeGeos.push(prep(k2, 0xb09060, { uv: false }));
        }
      } else {
        const n = Math.ceil(len / 0.075);
        for (let i = 0; i <= n; i++) linkPos.push({ p: new THREE.Vector3().lerpVectors(bar.a, bar.b, i / n), dir: new THREE.Vector3().subVectors(bar.b, bar.a).normalize(), odd: i % 2 });
        for (const e of [bar.a, bar.b]) { const k = new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8); k.rotateX(Math.PI / 2); _q.setFromUnitVectors(_v.set(0, 0, 1), _v2.set(e.x - t.cx, 0, e.z - t.cz).normalize()); k.applyQuaternion(_q); k.translate(e.x, e.y, e.z); ropeGeos.push(prep(k, 0x444444, { uv: false })); }
      }
    }
  });
  if (ropeGeos.length) { scene.add(new THREE.Mesh(mergeGeometries(ropeGeos), new THREE.MeshLambertMaterial({ vertexColors: true }))); ropeGeos.forEach(g => g.dispose()); }
  if (linkPos.length) {
    const lm = new THREE.InstancedMesh(new THREE.TorusGeometry(0.03, 0.009, 5, 10), new THREE.MeshLambertMaterial({ color: 0x6d7077, emissive: 0x15161a }), linkPos.length);
    linkPos.forEach((L, i) => {
      _q.setFromUnitVectors(_v.set(1, 0, 0), L.dir);
      if (L.odd) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), Math.PI / 2));
      _m.compose(L.p, _q, _s.set(1.2, 0.8, 1)); lm.setMatrixAt(i, _m);
    });
    scene.add(lm);
  }

  // ── Jade tokens ──
  {
    let n = 0; ROUTES.forEach(rt => n += rt.tokens.length);
    const tm = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.085, 0), new THREE.MeshLambertMaterial({ color: 0x7fe0b0, emissive: 0x1f7a52 }), n);
    tm.frustumCulled = false;
    let i = 0;
    ROUTES.forEach((rt) => { const t = TOWERS[rt.tower]; for (const tk of rt.tokens) { surfacePoint(t, tk.s, tk.y, 0.45, P); W.tokens.push({ route: rt.id, pos: new THREE.Vector3(P.x, P.y, P.z), idx: i++, taken: false, phase: i * 1.3 }); } });
    W.tokenMesh = tm; scene.add(tm);
    // soft glow halos (sprites would cost a draw each; use a second instanced quad instead)
  }

  // ── Checkpoint lanterns (instanced, unlit) ──
  {
    let n = 0; W.cps.forEach(l => n += l.length);
    const lg = new THREE.SphereGeometry(0.14, 12, 8); lg.scale(1, 1.25, 1);
    const lm = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    let i = 0;
    W.cps.forEach((list) => list.forEach((cp) => { cp.lantern = i; _m.makeTranslation(cp.lanternPos.x, cp.lanternPos.y, cp.lanternPos.z); lm.setMatrixAt(i, _m); lm.setColorAt(i, _c.set(0x5a1a14)); i++; }));
    W.lanterns = lm; scene.add(lm);
  }

  // ── Clouds below and around ──
  const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
  {
    const N = 70, r = rand(31);
    const cg = new THREE.PlaneGeometry(1, 1); cg.rotateX(-Math.PI / 2);
    const cm = new THREE.InstancedMesh(cg, new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, opacity: 0.9, color: 0xfbf7f0 }), N);
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, d = 45 + Math.pow(r(), 0.7) * 700, y = -150 + r() * 115, s = 50 + r() * 140;
      _q.setFromAxisAngle(UP, r() * 6.28);
      _m.compose(_v.set(Math.sin(a) * d, y, Math.cos(a) * d - 8), _q, _s.set(s, 1, s * (0.5 + r() * 0.5)));
      cm.setMatrixAt(i, _m);
    }
    cm.renderOrder = 2; cloudGroup.add(cm);
  }

  // ── Birds (swifts circling the massif) ──
  const birds = [];
  const birdMesh = (() => {
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([0, 0, -0.15, -0.55, 0.05, 0.12, 0, 0, 0.12, 0, 0, -0.15, 0, 0, 0.12, 0.55, 0.05, 0.12]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3)); g.computeVertexNormals();
    const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x2a2a30, side: THREE.DoubleSide }), 18);
    m.frustumCulled = false;
    const r = rand(8);
    for (let i = 0; i < 18; i++) birds.push({ rad: 34 + r() * 70, y: -35 + r() * 75, a: r() * 6.28, w: (0.12 + r() * 0.12) * (r() < 0.3 ? -1 : 1), flap: 6 + r() * 4, ph: r() * 6, s: 1.2 + r() * 0.8, bob: r() * 3 });
    scene.add(m); return m;
  })();

  // ── Dust particles for crumbling holds ──
  const DUST = 60;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST * 3).fill(-9999);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xa08470, size: 0.05, transparent: true, opacity: 0.9 }));
  dust.frustumCulled = false; scene.add(dust);
  const dustVel = new Float32Array(DUST * 3), dustLife = new Float32Array(DUST);
  let dustNext = 0;
  W.emitDust = (p, n = 16) => {
    for (let k = 0; k < n; k++) {
      const i = dustNext; dustNext = (dustNext + 1) % DUST;
      dustPos[i * 3] = p.x + (Math.random() - 0.5) * 0.1; dustPos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.1; dustPos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.1;
      dustVel[i * 3] = (Math.random() - 0.5) * 1.2; dustVel[i * 3 + 1] = Math.random() * 0.8; dustVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      dustLife[i] = 1.4 + Math.random();
    }
  };

  // ── Per-frame animation ──
  W.update = (dt, time) => {
    cloudGroup.rotation.y += dt * 0.004;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i]; b.a += b.w * dt;
      const x = Math.sin(b.a) * b.rad, z = Math.cos(b.a) * b.rad - 8, y = b.y + Math.sin(time * 0.3 + b.bob) * 3;
      _q.setFromAxisAngle(UP, b.a + (b.w > 0 ? Math.PI / 2 : -Math.PI / 2));
      const f = Math.sin(time * b.flap + b.ph);
      _m.compose(_v.set(x, y, z), _q, _s.set(b.s, b.s * (0.2 + 1.4 * f), b.s));
      birdMesh.setMatrixAt(i, _m);
    }
    birdMesh.instanceMatrix.needsUpdate = true;
    // moving holds
    for (const h of W.holds) {
      if (!h.mv || h.broken) continue;
      const m = h.mv, u = Math.sin(time * m.speed + m.phase) * m.amp;
      if (m.axis === 's') { const phi = m.phi + u / m.R; const r = m.R; h.pos.set(m.t.cx + Math.sin(phi) * r, m.y, m.t.cz + Math.cos(phi) * r); }
      else h.pos.set(h.base.x, m.y + u, h.base.z);
      setHoldMatrix(h);
    }
    // tokens spin
    const tm = W.tokenMesh;
    for (const tk of W.tokens) {
      if (tk.taken) _m.makeScale(0, 0, 0);
      else { _q.setFromAxisAngle(UP, time * 1.6 + tk.phase); _m.compose(_v.copy(tk.pos).setY(tk.pos.y + Math.sin(time * 2 + tk.phase) * 0.04), _q, _s.set(1, 1.4, 1)); }
      tm.setMatrixAt(tk.idx, _m);
    }
    tm.instanceMatrix.needsUpdate = true;
    // dust
    let any = false;
    for (let i = 0; i < DUST; i++) {
      if (dustLife[i] <= 0) continue; any = true;
      dustLife[i] -= dt;
      dustVel[i * 3 + 1] -= 4 * dt;
      dustPos[i * 3] += dustVel[i * 3] * dt; dustPos[i * 3 + 1] += dustVel[i * 3 + 1] * dt; dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
      if (dustLife[i] <= 0) dustPos[i * 3 + 1] = -9999;
    }
    if (any) dustGeo.attributes.position.needsUpdate = true;
  };
  W.setLantern = (cp, on) => { W.lanterns.setColorAt(cp.lantern, _c.set(on ? 0xffb347 : 0x5a1a14)); W.lanterns.instanceColor.needsUpdate = true; };
  W.startLabels = startLbls;
  return W;
}
