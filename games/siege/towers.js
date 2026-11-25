import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geo.js';

// Tower stats per level (index 0..2). Ranges in board units, rates in shots/s.
export const TOWERS = {
  archer: {
    name: 'Archer Pavilion', short: 'Archers', key: 1, cost: 70, up: [65, 130], color: '#c84a3a',
    range: [3.0, 3.4, 3.9], dmg: [12, 20, 30], rate: [1.5, 1.8, 2.2], shots: [1, 1, 2], air: true, ground: true,
    blurb: 'Fast arrows. Hits kites.',
  },
  rocket: {
    name: 'Firework Battery', short: 'Fireworks', key: 2, cost: 120, up: [100, 180], color: '#e0a030',
    range: [3.4, 3.8, 4.3], dmg: [18, 30, 46], splash: [1.0, 1.15, 1.35], rate: [0.5, 0.6, 0.7], shots: [1, 1, 2], air: true, ground: true,
    blurb: 'Rockets burst in splash damage.',
  },
  bell: {
    name: 'Bell Tower', short: 'Bell', key: 3, cost: 90, up: [70, 130], color: '#4aa0a0',
    range: [2.3, 2.7, 3.1], dmg: [3, 6, 10], slow: [0.35, 0.45, 0.55], rate: [0.75, 0.85, 1.0], air: true, ground: true,
    blurb: 'Tolls slow every spirit nearby.',
  },
  cannon: {
    name: 'Dragon Cannon', short: 'Dragon', key: 4, cost: 160, up: [130, 220], color: '#a83a5a',
    range: [2.8, 3.15, 3.5], dmg: [50, 85, 140], splash: [0.6, 0.72, 0.85], rate: [0.4, 0.45, 0.52], air: false, ground: true, pierce: true,
    blurb: 'Heavy fireballs pierce armour. Ground only.',
  },
  monk: {
    name: 'Monk Shrine', short: 'Monk', key: 5, cost: 110, up: [90, 150], color: '#e08a30',
    range: [2.4, 2.8, 3.2], heal: [18, 13, 9], aura: [0.1, 0.18, 0.28], air: false, ground: false,
    blurb: 'Mends the walls (+1 life) and speeds nearby towers.',
  },
};
export const TOWER_KEYS = ['archer', 'rocket', 'bell', 'cannon', 'monk'];

// ── Procedural models ───────────────────────────────────────
// Each model: { base, head, headY, top }. Geometries are cached and shared.
const cache = new Map();
const STONE = 0x9e988a, STONE_D = 0x7d776b, WOOD = 0x7a4a2a, RED = 0xb0302a, GOLD = 0xe0b040, BRONZE = 0xb07a3a, SKIN = 0xf0cfa8, JADE = 0x3f9a7a;

export function towerModel(type, level) {
  const k = type + level;
  if (cache.has(k)) return cache.get(k);
  const b = new GeoBuilder(level * 7 + type.length), h = new GeoBuilder(level * 3 + 1);
  let headY = 0.4, top = 1.2;
  const L = level;
  if (type === 'archer') {
    const baseH = 0.22 + L * 0.08;
    b.cyl(STONE, 0.48, 0.55, baseH, 6, { y: baseH / 2 });
    if (L === 2) b.cyl(GOLD, 0.5, 0.5, 0.03, 6, { y: baseH - 0.01, jitter: 0 });
    b.cyl(WOOD, 0.44, 0.44, 0.05, 6, { y: baseH + 0.025 });
    const postH = 0.55 + L * 0.12;
    for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; b.box(RED, 0.06, postH, 0.06, { x: Math.cos(a) * 0.33, z: Math.sin(a) * 0.33, y: baseH + postH / 2 }); }
    let ry = baseH + postH;
    const roofC = L === 2 ? 0x8a2a24 : 0x2f4a5f;
    for (let t = 0; t <= L; t++) {
      const s = 1 - t * 0.22;
      b.cone(roofC, 0.62 * s, 0.26, 6, { y: ry + 0.13 });
      b.cyl(RED, 0.35 * s, 0.35 * s, 0.14, 6, { y: ry + 0.3 });
      ry += 0.3;
    }
    b.cone(roofC, 0.3 * (1 - L * 0.15), 0.2, 6, { y: ry + 0.1 });
    b.cyl(GOLD, 0.015, 0.025, 0.2, 4, { y: ry + 0.25 });
    if (L >= 1) { b.cyl(WOOD, 0.012, 0.012, 0.6, 4, { x: 0.36, z: 0.36, y: baseH + postH + 0.4 }); b.box(L === 2 ? GOLD : 0xd8b040, 0.02, 0.16, 0.12, { x: 0.36, z: 0.42, y: baseH + postH + 0.6, jitter: 0 }); }
    if (L === 2) b.ball(GOLD, 0.06, 0, { y: ry + 0.38 });
    top = ry + 0.3;
    headY = baseH + 0.05;
    const robe = L === 2 ? 0xd8a840 : L === 1 ? 0x3a6a3a : 0x3a5a8a;
    h.cone(robe, 0.1, 0.26, 6, { y: 0.13 });
    h.ball(SKIN, 0.06, 0, { y: 0.31 });
    h.cone(0x3a2a1a, 0.08, 0.05, 6, { y: 0.37 });
    h.torus(WOOD, 0.13, 0.012, 3, 8, Math.PI, { z: 0.1, y: 0.2, rz: Math.PI / 2, ry: Math.PI / 2 });
    if (L === 2) { h.cone(robe, 0.08, 0.2, 6, { x: 0.16, y: 0.1 }); h.ball(SKIN, 0.05, 0, { x: 0.16, y: 0.24 }); }
  } else if (type === 'rocket') {
    b.box(STONE, 0.86, 0.18, 0.86, { y: 0.09 });
    b.box(WOOD, 0.7, 0.12, 0.6, { y: 0.24 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0x3a2a1a, 0.1, 0.1, 0.05, 8, { x: sx * 0.37, z: sz * 0.2, y: 0.24, rz: Math.PI / 2 });
    if (L >= 1) for (const sx of [-1, 1]) { b.cyl(WOOD, 0.012, 0.012, 0.7, 4, { x: sx * 0.36, z: -0.32, y: 0.6 }); b.box(L === 2 ? GOLD : RED, 0.02, 0.2, 0.14, { x: sx * 0.36, z: -0.25, y: 0.85, jitter: 0 }); }
    if (L === 2) for (const sx of [-1, 1]) { b.ball(0xff7040, 0.07, 0, { x: sx * 0.32, z: 0.3, y: 0.42 }); }
    headY = 0.32; top = 1.0;
    const rows = L + 1, cols = 3;
    h.box(WOOD, 0.5, 0.06, 0.36, { y: 0.03 });
    h.box(WOOD, 0.06, 0.25, 0.06, { y: 0.15 });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const col = (r + c) % 2 ? (L === 2 ? GOLD : 0xe0c040) : RED;
      h.cyl(col, 0.045, 0.045, 0.42, 6, { x: (c - 1) * 0.11, y: 0.3 + r * 0.09, z: 0.02 + r * -0.04, rx: 0.85 });
      h.cone(0xf0e0c0, 0.045, 0.08, 6, { x: (c - 1) * 0.11, y: 0.3 + r * 0.09 + 0.18, z: 0.02 + r * -0.04 + 0.21, rx: 0.85 });
    }
  } else if (type === 'bell') {
    const baseH = 0.28 + L * 0.06;
    b.box(STONE, 0.72, baseH, 0.72, { y: baseH / 2 });
    const pH = 0.72 + L * 0.14;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(RED, 0.07, pH, 0.07, { x: sx * 0.26, z: sz * 0.26, y: baseH + pH / 2 });
    b.box(WOOD, 0.64, 0.06, 0.08, { y: baseH + pH - 0.05 });
    const roofC = L === 2 ? GOLD : 0x2f7a6a;
    let ry = baseH + pH;
    for (let t = 0; t <= Math.min(L, 1); t++) {
      const s = 1 - t * 0.35;
      const rg = new THREE.ConeGeometry(0.62 * s, 0.3, 4); rg.rotateY(Math.PI / 4);
      b.add(rg, roofC, { y: ry + 0.15 });
      if (t < Math.min(L, 1)) b.box(RED, 0.3, 0.14, 0.3, { y: ry + 0.35 });
      ry += 0.36;
    }
    b.ball(GOLD, 0.05, 0, { y: ry + 0.02 });
    if (L === 2) for (const sx of [-1, 1]) b.box(GOLD, 0.03, 0.03, 0.75, { x: sx * 0.36, y: baseH + 0.02, jitter: 0 });
    top = ry + 0.1;
    headY = baseH + pH - 0.08;
    const bellC = L === 2 ? GOLD : L === 1 ? 0x8a9a6a : BRONZE;
    const bs = 1 + L * 0.12;
    h.cyl(0x3a2a1a, 0.01, 0.01, 0.06, 4, { y: -0.03 });
    h.lathe(bellC, [[0.001, 0], [0.06, -0.01], [0.09, -0.08], [0.11, -0.2], [0.16, -0.27], [0.165, -0.29], [0.001, -0.29]], 10, { y: -0.04, s: bs });
    h.ball(0x3a2a1a, 0.03, 0, { y: -0.31 * bs });
  } else if (type === 'cannon') {
    b.cyl(STONE, 0.5, 0.56, 0.3, 8, { y: 0.15 });
    b.cyl(STONE_D, 0.42, 0.42, 0.08, 8, { y: 0.34 });
    if (L >= 1) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.box(STONE_D, 0.12, 0.12, 0.12, { x: Math.cos(a) * 0.48, z: Math.sin(a) * 0.48, y: 0.36 }); }
    if (L === 2) b.cyl(GOLD, 0.44, 0.44, 0.03, 8, { y: 0.39, jitter: 0 });
    headY = 0.42; top = 0.95;
    const barrel = L === 2 ? GOLD : L === 1 ? JADE : BRONZE;
    const dragon = L === 2 ? 0xc02a2a : L === 1 ? 0x2a7a4a : 0xb04a2a;
    const bs = 1 + L * 0.14;
    h.box(WOOD, 0.36, 0.16, 0.4, { y: 0.02 });
    h.cyl(barrel, 0.1 * bs, 0.14 * bs, 0.66 * bs, 8, { y: 0.16, z: 0.08, rx: Math.PI / 2 - 0.12 });
    h.ball(barrel, 0.14 * bs, 0, { y: 0.17, z: -0.24 * bs });
    for (const t of [-0.12, 0.08]) h.torus(GOLD, 0.13 * bs, 0.02, 3, 8, Math.PI * 2, { y: 0.16 + t * -0.12, z: 0.08 + t * bs * 1.6 });
    // dragon head at the muzzle
    const mz = 0.42 * bs;
    h.box(dragon, 0.24 * bs, 0.16 * bs, 0.2 * bs, { y: 0.21, z: mz });
    h.box(dragon, 0.18 * bs, 0.07 * bs, 0.18 * bs, { y: 0.15, z: mz + 0.1 * bs });
    for (const sx of [-1, 1]) {
      h.cone(GOLD, 0.03, 0.18, 4, { x: sx * 0.08 * bs, y: 0.33, z: mz - 0.06, rx: -0.6 });
      h.ball(0xffe060, 0.025, 0, { x: sx * 0.08 * bs, y: 0.25, z: mz + 0.1 * bs });
      if (L === 2) h.cyl(GOLD, 0.008, 0.008, 0.3, 3, { x: sx * 0.16, y: 0.15, z: mz + 0.12, rz: sx * 1.2 });
    }
  } else if (type === 'monk') {
    b.cyl(STONE, 0.48, 0.55, 0.18, 8, { y: 0.09 });
    b.cyl(WOOD, 0.4, 0.42, 0.07, 8, { y: 0.21 });
    b.cone(0xd86a20, 0.17, 0.3, 8, { y: 0.39 });
    b.ball(SKIN, 0.08, 1, { y: 0.6 });
    b.box(0xd86a20, 0.3, 0.06, 0.12, { y: 0.32, z: 0.06 });
    b.cyl(BRONZE, 0.05, 0.04, 0.06, 6, { z: 0.3, y: 0.27 });
    b.cyl(0x3a2a1a, 0.004, 0.004, 0.12, 3, { z: 0.3, y: 0.35 });
    if (L >= 1) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(RED, 0.05, 0.7, 0.05, { x: sx * 0.3, z: sz * 0.3, y: 0.58 });
      const rg = new THREE.ConeGeometry(0.58, 0.26, 4); rg.rotateY(Math.PI / 4);
      b.add(rg, L === 2 ? GOLD : 0x8a3a2a, { y: 1.05 });
      b.ball(GOLD, 0.04, 0, { y: 1.2 });
    }
    if (L === 2) for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.cone(0xf4b0c8, 0.07, 0.16, 4, { x: Math.cos(a) * 0.42, z: Math.sin(a) * 0.42, y: 0.3, rx: Math.sin(a) * 0.5, rz: -Math.cos(a) * 0.5 }); }
    headY = 0.62; top = L >= 1 ? 1.25 : 0.9;
    const ringC = L === 2 ? GOLD : L === 1 ? JADE : 0x6a3a1a;
    h.torus(ringC, 0.16 + L * 0.02, 0.02, 4, 14, Math.PI * 2, { rx: Math.PI / 2 + 0.25, y: L === 2 ? 0.12 : -0.08 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; h.ball(L === 2 ? 0xfff0a0 : 0xe0a050, 0.025, 0, { x: Math.cos(a) * (0.16 + L * 0.02), z: Math.sin(a) * (0.16 + L * 0.02), y: L === 2 ? 0.12 : -0.08 }); }
  }
  const m = { base: b.build(), head: h.build(), headY, top };
  // merged copy for tray minis and ghosts
  const hc = m.head.clone(); hc.translate(0, headY, 0);
  m.merged = mergeGeometries([m.base.clone(), hc]);
  m.merged.computeBoundingBox();
  cache.set(k, m);
  return m;
}

export function disposeTowerCache() {
  for (const m of cache.values()) { m.base.dispose(); m.head.dispose(); m.merged.dispose(); }
  cache.clear();
}
