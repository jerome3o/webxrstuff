import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FONTS } from '../../src/platform/kit.js';
import { canvasTex, mulberry32 } from './textures.js';

// Three switchable surroundings + two reference models.
export const ENVS = ['Studio', 'Night Sky', 'Paper Void'];

function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function merged(list) { const g = mergeGeometries(list, false); for (const x of list) x.dispose(); return g; }
function box(w, h, d, x, y, z, ry = 0) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; }

// ── textures ──
function woodFloorTex() {
  const [c, x] = cnv(512, 512), rnd = mulberry32(11);
  const planks = 8;
  for (let i = 0; i < planks; i++) {
    const y0 = i * 64;
    const base = 58 + rnd() * 18;
    x.fillStyle = `hsl(28, 32%, ${base * 0.42}%)`; x.fillRect(0, y0, 512, 64);
    for (let k = 0; k < 40; k++) {
      x.strokeStyle = `hsla(26, 35%, ${18 + rnd() * 16}%, ${0.08 + rnd() * 0.12})`; x.lineWidth = 1 + rnd() * 2;
      const yy = y0 + rnd() * 64; x.beginPath(); x.moveTo(0, yy);
      for (let xx = 0; xx <= 512; xx += 32) x.lineTo(xx, yy + Math.sin(xx * 0.02 + k) * 2.5);
      x.stroke();
    }
    x.fillStyle = 'rgba(20,12,6,0.6)'; x.fillRect(0, y0, 512, 2);
    const cut = rnd() * 512; x.fillRect(cut, y0, 2, 64);
  }
  const t = canvasTex(c, { repeatU: true, repeatV: true }); t.repeat.set(5, 5); return t;
}
function shojiTex() {
  const [c, x] = cnv(512, 512);
  const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#f1e8d4'); g.addColorStop(1, '#e6dbc2');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  const rnd = mulberry32(5);
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(150,120,80,${rnd() * 0.05})`; x.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1); }
  x.fillStyle = '#4a3220';
  for (let i = 0; i <= 4; i++) x.fillRect(i * 128 - 5, 0, 10, 512);
  for (let j = 0; j <= 6; j++) x.fillRect(0, j * (512 / 6) - 4, 512, 8);
  x.fillStyle = '#3a2616'; x.fillRect(0, 0, 512, 14); x.fillRect(0, 498, 512, 14);
  const t = canvasTex(c, { repeatU: true, repeatV: false }); return t;
}
function plasterTex() {
  const [c, x] = cnv(512, 512), rnd = mulberry32(13);
  x.fillStyle = '#ece3cf'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) { const r = 4 + rnd() * 30; x.fillStyle = `rgba(${rnd() < 0.5 ? '160,140,110' : '255,250,235'},${rnd() * 0.05})`; x.beginPath(); x.arc(rnd() * 512, rnd() * 512, r, 0, 7); x.fill(); }
  x.fillStyle = '#3a2616'; x.fillRect(0, 490, 512, 22);
  return canvasTex(c, { repeatU: true });
}
function rugTex() {
  const [c, x] = cnv(512, 384);
  x.fillStyle = '#c9b98a'; x.fillRect(0, 0, 512, 384);
  for (let j = 0; j < 384; j += 3) { x.fillStyle = j % 6 ? 'rgba(120,100,50,0.10)' : 'rgba(255,250,220,0.10)'; x.fillRect(0, j, 512, 2); }
  x.strokeStyle = '#2a3a2e'; x.lineWidth = 22; x.strokeRect(11, 11, 490, 362);
  x.strokeStyle = '#b89a52'; x.lineWidth = 3; x.strokeRect(26, 26, 460, 332);
  return canvasTex(c);
}
function moonWindowTex() {
  const [c, x] = cnv(512, 512), rnd = mulberry32(21);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#f6dcb0'); g.addColorStop(0.55, '#f3e6cc'); g.addColorStop(1, '#d9cfb8');
  x.fillStyle = g; x.fillRect(0, 0, 512, 512);
  // distant hills
  x.fillStyle = 'rgba(120,130,135,0.35)';
  x.beginPath(); x.moveTo(0, 512); for (let i = 0; i <= 512; i += 8) x.lineTo(i, 360 - 40 * Math.sin(i * 0.013) - 25 * Math.sin(i * 0.031 + 1)); x.lineTo(512, 512); x.fill();
  // bamboo silhouettes
  for (let k = 0; k < 7; k++) {
    const bx = 30 + k * 72 + rnd() * 30, wdt = 7 + rnd() * 6, lean = (rnd() - 0.5) * 40;
    x.strokeStyle = `rgba(40,55,45,${0.55 + rnd() * 0.35})`; x.lineWidth = wdt; x.lineCap = 'butt';
    for (let y = 512; y > -20; y -= 70) {
      x.beginPath(); x.moveTo(bx + lean * (1 - y / 512), y); x.lineTo(bx + lean * (1 - (y - 64) / 512), y - 64); x.stroke();
    }
    x.fillStyle = x.strokeStyle;
    for (let l = 0; l < 6; l++) {
      const ly = 60 + rnd() * 300, lx = bx + lean * (1 - ly / 512), dir = rnd() < 0.5 ? -1 : 1;
      x.save(); x.translate(lx, ly); x.rotate(dir * (0.6 + rnd() * 0.6));
      x.beginPath(); x.ellipse(0, -28, 6, 30, 0, 0, Math.PI * 2); x.fill(); x.restore();
    }
  }
  return canvasTex(c);
}
function scrollTex() {
  const [c, x] = cnv(256, 640), rnd = mulberry32(31);
  x.fillStyle = '#5b4632'; x.fillRect(0, 0, 256, 640);
  x.fillStyle = '#efe4cb'; x.fillRect(22, 70, 212, 500);
  // plum branch
  x.strokeStyle = 'rgba(30,25,20,0.9)'; x.lineCap = 'round';
  const branch = (px, py, ang, len, w, depth) => {
    if (depth > 4 || len < 8) return;
    const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
    x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo((px + ex) / 2 + (rnd() - 0.5) * 20, (py + ey) / 2, ex, ey); x.stroke();
    if (rnd() < 0.8) { x.fillStyle = `rgba(${190 + rnd() * 40},${40 + rnd() * 30},${50 + rnd() * 30},0.85)`; for (let k = 0; k < 5; k++) { x.beginPath(); x.arc(ex + Math.cos(k * 1.26) * 4, ey + Math.sin(k * 1.26) * 4, 3.6, 0, 7); x.fill(); } }
    branch(ex, ey, ang - 0.5 - rnd() * 0.4, len * 0.7, w * 0.65, depth + 1);
    branch(ex, ey, ang + 0.4 + rnd() * 0.4, len * 0.6, w * 0.6, depth + 1);
  };
  branch(40, 540, -1.2, 120, 9, 0);
  x.fillStyle = '#1e1a16'; x.font = `44px ${FONTS.brush}`; x.textAlign = 'center';
  ['静', '心', '墨', '韵'].forEach((ch, i) => x.fillText(ch, 196, 130 + i * 52));
  x.fillStyle = '#b8281e'; x.fillRect(180, 352, 30, 30);
  x.fillStyle = '#efe4cb'; x.font = `22px ${FONTS.brush}`; x.fillText('印', 195, 375);
  x.fillStyle = '#3a2a1c'; x.fillRect(0, 0, 256, 14); x.fillRect(0, 626, 256, 14);
  return canvasTex(c);
}
function glowDiscTex(inner, outer) {
  const [c, x] = cnv(256, 256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, inner); g.addColorStop(0.42, inner); g.addColorStop(0.5, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return canvasTex(c);
}
function porcelainTex() {
  const [c, x] = cnv(1024, 512), rnd = mulberry32(41);
  x.fillStyle = '#f4f3ee'; x.fillRect(0, 0, 1024, 512);
  const blue = (a) => `rgba(28,52,128,${a})`;
  // canvas y: 0 = top of vase (lip), 512 = foot
  x.fillStyle = blue(0.9); x.fillRect(0, 0, 1024, 22); x.fillRect(0, 488, 1024, 24);
  x.fillStyle = blue(0.75); x.fillRect(0, 96, 1024, 6); x.fillRect(0, 380, 1024, 6);
  // ruyi cloud collar on the shoulder
  for (let k = 0; k < 8; k++) {
    const cx = k * 128 + 64;
    x.fillStyle = blue(0.75); x.beginPath(); x.moveTo(cx - 60, 102); x.quadraticCurveTo(cx - 40, 170, cx, 178); x.quadraticCurveTo(cx + 40, 170, cx + 60, 102); x.fill();
    x.fillStyle = '#f4f3ee'; x.beginPath(); x.moveTo(cx - 44, 106); x.quadraticCurveTo(cx - 28, 156, cx, 162); x.quadraticCurveTo(cx + 28, 156, cx + 44, 106); x.fill();
    x.fillStyle = blue(0.5); x.beginPath(); x.arc(cx, 132, 12, 0, 7); x.fill();
  }
  // lotus scroll on the body
  x.strokeStyle = blue(0.8); x.lineWidth = 5;
  x.beginPath(); for (let i = 0; i <= 1024; i += 8) { const y = 280 + 34 * Math.sin(i / 1024 * Math.PI * 8); if (i) x.lineTo(i, y); else x.moveTo(i, y); } x.stroke();
  for (let k = 0; k < 8; k++) {
    const cx = k * 128 + 32, cy = 280 + 34 * Math.sin((cx / 1024) * Math.PI * 8) - 40 * (k % 2 ? -1 : 1);
    x.fillStyle = blue(0.85);
    for (let p = 0; p < 7; p++) { x.save(); x.translate(cx, cy); x.rotate(-1.4 + p * 0.47); x.beginPath(); x.ellipse(0, -20, 8, 22, 0, 0, 7); x.fill(); x.restore(); }
    x.fillStyle = blue(0.45);
    for (let l = 0; l < 3; l++) { x.beginPath(); x.ellipse(cx + 40 + l * 6, cy + (rnd() - 0.5) * 30, 14, 6, rnd(), 0, 7); x.fill(); }
  }
  // lotus panels at the foot
  for (let k = 0; k < 16; k++) {
    const cx = k * 64 + 32;
    x.strokeStyle = blue(0.8); x.lineWidth = 4;
    x.beginPath(); x.moveTo(cx - 26, 486); x.lineTo(cx - 26, 420); x.quadraticCurveTo(cx, 392, cx + 26, 420); x.lineTo(cx + 26, 486); x.stroke();
  }
  return canvasTex(c, { repeatU: true });
}

// ── environments ──
export function buildEnvironments(scene) {
  const envs = [buildStudio(), buildNight(), buildPaper()];
  for (const e of envs) { e.group.visible = false; scene.add(e.group); }
  return envs;
}

function buildStudio() {
  const group = new THREE.Group();
  const out = { group, bg: new THREE.Color(0x2a2018), fog: null, light: true };
  group.add(new THREE.HemisphereLight(0xfff2dc, 0x8a7458, 1.7));
  const sun = new THREE.DirectionalLight(0xffe4bc, 1.3); sun.position.set(-1.5, 4, -3); group.add(sun);

  const W = 4.6, ZB = -6.2, ZF = 3.6, H = 3.4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, ZF - ZB), new THREE.MeshLambertMaterial({ map: woodFloorTex() }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = (ZF + ZB) / 2; group.add(floor);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6), new THREE.MeshLambertMaterial({ map: rugTex() }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.004, -0.4); group.add(rug);

  // shoji walls (one merged mesh); u repeats per metre-ish
  const wt = shojiTex();
  const wallGeo = [];
  const wall = (len, x, z, ry) => { const g = new THREE.PlaneGeometry(len, H); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 1.6); g.rotateY(ry); g.translate(x, H / 2, z); wallGeo.push(g); };
  wall(ZF - ZB, W, (ZF + ZB) / 2, -Math.PI / 2);
  wall(W * 2, 0, ZF, Math.PI);
  group.add(new THREE.Mesh(merged(wallGeo), new THREE.MeshLambertMaterial({ map: wt })));
  // plaster: back wall (a quiet backdrop for the painting) and the window wall on the left
  wallGeo.length = 0;
  wall(ZF - ZB, -W, (ZF + ZB) / 2, Math.PI / 2);
  wall(W * 2, 0, ZB, 0);
  group.add(new THREE.Mesh(merged(wallGeo), new THREE.MeshLambertMaterial({ map: plasterTex() })));

  // dark wood: ceiling beams, pillars, desk, window ring, lantern frames
  const dw = [];
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, ZF - ZB), new THREE.MeshLambertMaterial({ map: floor.material.map, color: 0x9a8068, emissive: 0x4a3626 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H, (ZF + ZB) / 2); group.add(ceil);
  for (let z = ZB + 1; z < ZF; z += 1.6) dw.push(box(W * 2, 0.16, 0.14, 0, H - 0.08, z));
  dw.push(box(0.14, 0.16, ZF - ZB, -1.6, H - 0.2, (ZF + ZB) / 2), box(0.14, 0.16, ZF - ZB, 1.6, H - 0.2, (ZF + ZB) / 2));
  for (const x of [-W + 0.08, W - 0.08]) for (const z of [ZB + 0.08, -1.3, ZF - 0.08]) dw.push(box(0.18, H, 0.18, x, H / 2, z));
  dw.push(box(W * 2, 0.12, 0.06, 0, 0.06, ZB + 0.03), box(0.06, 0.12, ZF - ZB, -W + 0.03, 0.06, (ZF + ZB) / 2), box(0.06, 0.12, ZF - ZB, W - 0.03, 0.06, (ZF + ZB) / 2));
  // low desk with ink stone and brush rack (back left)
  const dx = -2.7, dz = -4.6;
  dw.push(box(1.6, 0.06, 0.7, dx, 0.38, dz));
  for (const sx of [-0.72, 0.72]) for (const sz of [-0.28, 0.28]) dw.push(box(0.07, 0.35, 0.07, dx + sx, 0.175, dz + sz));
  dw.push(box(0.36, 0.04, 0.22, dx + 0.45, 0.43, dz - 0.05));
  dw.push(box(0.4, 0.03, 0.04, dx - 0.45, 0.6, dz - 0.22), box(0.03, 0.2, 0.03, dx - 0.63, 0.5, dz - 0.22), box(0.03, 0.2, 0.03, dx - 0.27, 0.5, dz - 0.22));
  // round window frame
  const ring = new THREE.TorusGeometry(1.0, 0.08, 8, 48); ring.rotateY(Math.PI / 2); ring.translate(-W + 0.05, 1.7, -1.2); dw.push(ring);
  // lantern frames
  for (const lx of [-3.4, 3.4]) { dw.push(box(0.5, 0.05, 0.5, lx, 0.04, -1.5), box(0.5, 0.05, 0.5, lx, 1.04, -1.5)); for (const sx of [-0.23, 0.23]) for (const sz of [-0.23, 0.23]) dw.push(box(0.035, 1.0, 0.035, lx + sx, 0.54, -1.5 + sz)); }
  // bamboo pot
  dw.push(box(0.42, 0.36, 0.42, 3.5, 0.18, -4.9));
  group.add(new THREE.Mesh(merged(dw.map(g => g.index ? g.toNonIndexed() : g)), new THREE.MeshLambertMaterial({ color: 0x3b2618 })));

  // window view (emissive), lantern glow, paper on the desk, brushes in the rack
  const win = new THREE.Mesh(new THREE.CircleGeometry(0.97, 48), new THREE.MeshBasicMaterial({ map: moonWindowTex(), toneMapped: false }));
  win.position.set(-W + 0.04, 1.7, -1.2); win.rotation.y = Math.PI / 2; group.add(win);
  const glow = [];
  for (const lx of [-3.4, 3.4]) glow.push(box(0.44, 0.94, 0.44, lx, 0.54, -1.5));
  const paper = box(0.55, 0.004, 0.4, dx - 0.15, 0.413, dz + 0.08); glow.push(paper);
  group.add(new THREE.Mesh(merged(glow), new THREE.MeshBasicMaterial({ color: 0xffe2b0, toneMapped: false })));
  const scroll = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.0), new THREE.MeshLambertMaterial({ map: scrollTex() }));
  scroll.position.set(-W + 0.03, 1.85, -3.9); scroll.rotation.y = Math.PI / 2; group.add(scroll);
  // bamboo stalks in the pot
  const bam = [], rnd = mulberry32(9);
  for (let k = 0; k < 5; k++) {
    const bx = 3.5 + (rnd() - 0.5) * 0.25, bz = -4.9 + (rnd() - 0.5) * 0.25, h = 1.9 + rnd() * 0.9;
    for (let y = 0.36; y < h; y += 0.42) { const g = new THREE.CylinderGeometry(0.022, 0.025, 0.4, 6); g.translate(bx + (y - 0.36) * 0.03 * (k - 2), y + 0.2, bz); bam.push(g); }
    for (let l = 0; l < 6; l++) { const g = new THREE.SphereGeometry(1, 6, 4); g.scale(0.02, 0.012, 0.16); g.rotateY(rnd() * 6.28); g.rotateZ((rnd() - 0.5) * 0.6); g.translate(bx + (rnd() - 0.5) * 0.3, h - rnd() * 0.8, bz + (rnd() - 0.5) * 0.3); bam.push(g); }
  }
  group.add(new THREE.Mesh(merged(bam.map(g => g.index ? g.toNonIndexed() : g)), new THREE.MeshLambertMaterial({ color: 0x5f7a3e })));
  return out;
}

function buildNight() {
  const group = new THREE.Group();
  const out = { group, bg: new THREE.Color(0x050914), fog: null, light: false };
  group.add(new THREE.HemisphereLight(0x8aa0ff, 0x10131c, 1.2));
  const moonL = new THREE.DirectionalLight(0xcfe0ff, 1.0); moonL.position.set(-2, 3, -4); group.add(moonL);
  // sky gradient sphere
  const sky = new THREE.SphereGeometry(80, 32, 16);
  const col = new Float32Array(sky.attributes.position.count * 3), c = new THREE.Color(), top = new THREE.Color(0x02040c), hor = new THREE.Color(0x1a2a52);
  for (let i = 0; i < sky.attributes.position.count; i++) { const y = sky.attributes.position.getY(i) / 80; c.copy(hor).lerp(top, Math.pow(Math.max(0, y), 0.5)); col.set([c.r, c.g, c.b], i * 3); }
  sky.setAttribute('color', new THREE.BufferAttribute(col, 3));
  group.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false })));
  // stars
  const N = 1600, sp = new Float32Array(N * 3), sc = new Float32Array(N * 3), rnd = mulberry32(77);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, y = Math.abs(u) * 0.95 + 0.03, r = Math.sqrt(1 - y * y);
    sp.set([Math.cos(th) * r * 70, y * 70, Math.sin(th) * r * 70], i * 3);
    const b = 0.4 + rnd() * 0.6, warm = rnd(); sc.set([b, b * (0.9 + warm * 0.1), b * (1.1 - warm * 0.3)], i * 3);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  group.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, toneMapped: false })));
  // moon
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: glowDiscTex('#fff6dc', 'rgba(255,240,200,0.25)'), transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  moon.position.set(-22, 30, -50); moon.lookAt(0, 1.6, 0); group.add(moon);
  // ground and distant hills
  const ground = new THREE.Mesh(new THREE.CircleGeometry(75, 48), new THREE.MeshLambertMaterial({ color: 0x0b1222 }));
  ground.rotation.x = -Math.PI / 2; group.add(ground);
  const hp = [], hi = [], seg = 160;
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * Math.PI * 2, h = 3 + 2.5 * Math.sin(a * 3 + 1) + 1.6 * Math.sin(a * 7.3) + 0.7 * Math.sin(a * 17);
    hp.push(Math.cos(a) * 45, -0.5, Math.sin(a) * 45, Math.cos(a) * 45, Math.max(1, h), Math.sin(a) * 45);
    if (i < seg) { const b = i * 2; hi.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); hg.setIndex(hi);
  group.add(new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0x0a1020, side: THREE.DoubleSide })));
  // soft ring under the player
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.43, 64), new THREE.MeshBasicMaterial({ color: 0x3a5a9a, transparent: true, opacity: 0.35 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.005; group.add(ring);
  return out;
}

function buildPaper() {
  const group = new THREE.Group();
  const bg = new THREE.Color(0xf3eee2);
  const out = { group, bg, fog: new THREE.Fog(0xf3eee2, 10, 40), light: true };
  group.add(new THREE.HemisphereLight(0xffffff, 0xd8d0c0, 2.0));
  const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(1, 3, 2); group.add(dl);
  const [c, x] = cnv(256, 256);
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(120,105,80,0.28)'); g.addColorStop(0.35, 'rgba(150,135,110,0.10)'); g.addColorStop(1, 'rgba(243,238,226,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: canvasTex(c), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.002, -0.6); group.add(shadow);
  return out;
}

// ── reference models (live inside the painting root so they move with it) ──
export function buildMannequin() {
  const parts = [], V = (x, y, z) => new THREE.Vector3(x, y, z);
  const limb = (a, b, r) => {
    const d = b.clone().sub(a), len = d.length();
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 0.6), 4, 10);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); parts.push(g);
  };
  const ell = (p, sx, sy, sz, rx = 0) => { const g = new THREE.SphereGeometry(1, 14, 10); g.scale(sx, sy, sz); if (rx) g.rotateX(rx); g.translate(p.x, p.y, p.z); parts.push(g); };
  const joint = (p, r) => ell(p, r, r, r);
  const pel = V(0, 0.98, 0), chest = V(0, 1.33, 0.01), neck = V(0, 1.55, 0.01), head = V(0, 1.69, 0.02);
  ell(pel, 0.15, 0.1, 0.1); ell(chest, 0.17, 0.2, 0.105); limb(pel, chest, 0.085);
  limb(V(0, 1.5, 0.01), V(0, 1.6, 0.015), 0.035); ell(head, 0.085, 0.11, 0.095); joint(neck, 0.04);
  // legs: weight on the left leg, right knee relaxed
  const hipL = V(-0.085, 0.94, 0), kneeL = V(-0.1, 0.51, 0.01), ankL = V(-0.11, 0.09, -0.01);
  const hipR = V(0.085, 0.94, 0), kneeR = V(0.13, 0.52, 0.07), ankR = V(0.15, 0.09, 0.02);
  for (const [h, k, a] of [[hipL, kneeL, ankL], [hipR, kneeR, ankR]]) {
    joint(h, 0.06); limb(h, k, 0.06); joint(k, 0.048); limb(k, a, 0.045); joint(a, 0.035);
    limb(a.clone().add(V(0, -0.04, -0.01)), a.clone().add(V(0, -0.05, 0.14)), 0.033);
  }
  // arms: right raised (as if reaching), left resting
  const shL = V(-0.2, 1.44, 0), elL = V(-0.27, 1.17, 0.03), wrL = V(-0.27, 0.92, 0.07);
  const shR = V(0.2, 1.44, 0), elR = V(0.42, 1.6, 0.02), wrR = V(0.5, 1.86, -0.03);
  for (const [s, e, w] of [[shL, elL, wrL], [shR, elR, wrR]]) {
    joint(s, 0.05); limb(s, e, 0.04); joint(e, 0.037); limb(e, w, 0.033); joint(w, 0.027);
    ell(w.clone().add(w.clone().sub(e).normalize().multiplyScalar(0.07)), 0.035, 0.06, 0.02);
  }
  // base plate
  const base = new THREE.CylinderGeometry(0.28, 0.3, 0.03, 24); base.translate(0, 0.015, 0.02); parts.push(base);
  const g = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p), false);
  for (const p of parts) p.dispose();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xc49a6c }));
  mesh.position.y = 0.03;
  const grp = new THREE.Group(); grp.add(mesh);
  return grp;
}

export function buildVase() {
  const grp = new THREE.Group();
  const prof = [[0.0, 0], [0.075, 0], [0.08, 0.02], [0.07, 0.06], [0.085, 0.16], [0.13, 0.3], [0.155, 0.4], [0.15, 0.46], [0.11, 0.52], [0.05, 0.56], [0.038, 0.6], [0.045, 0.62], [0.05, 0.635], [0.035, 0.635]];
  const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(pts, 48);
  const vase = new THREE.Mesh(lathe, new THREE.MeshPhongMaterial({ map: porcelainTex(), shininess: 90, specular: 0x666666, side: THREE.DoubleSide }));
  vase.position.y = 0.8; grp.add(vase);
  const st = [new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24).translate(0, 0.78, 0), new THREE.CylinderGeometry(0.05, 0.07, 0.74, 12).translate(0, 0.39, 0), new THREE.CylinderGeometry(0.22, 0.25, 0.04, 24).translate(0, 0.02, 0)];
  grp.add(new THREE.Mesh(merged(st), new THREE.MeshLambertMaterial({ color: 0x3b2618 })));
  return grp;
}
