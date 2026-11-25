import * as THREE from 'three';
import { GeoBuilder } from './geo.js';

// Ink-spirit types. speed in board units/s, size = rough height.
export const ENEMIES = [
  { id: 'wisp', name: 'Ink Wisp', hp: 40, speed: 1.1, reward: 6, dmg: 1, size: 0.36, armor: 0, max: 96 },
  { id: 'dart', name: 'Dart', hp: 30, speed: 2.0, reward: 7, dmg: 1, size: 0.3, armor: 0, max: 64 },
  { id: 'shell', name: 'Shellback', hp: 115, speed: 0.72, reward: 12, dmg: 2, size: 0.44, armor: 7, max: 48 },
  { id: 'kite', name: 'Ink Kite', hp: 55, speed: 1.2, reward: 10, dmg: 1, size: 0.5, armor: 0, flying: true, max: 40 },
  { id: 'split', name: 'Splitter', hp: 130, speed: 0.85, reward: 10, dmg: 2, size: 0.5, armor: 0, splits: 3, max: 32 },
  { id: 'mite', name: 'Mite', hp: 22, speed: 1.35, reward: 3, dmg: 1, size: 0.24, armor: 0, max: 96 },
  { id: 'boss', name: 'Great Smudge', hp: 2400, speed: 0.48, reward: 220, dmg: 10, size: 1.2, armor: 5, boss: true, max: 4 },
];
export const E = {}; ENEMIES.forEach((d, i) => { d.idx = i; E[d.id] = i; });

const INK = 0x232235, INK2 = 0x38324c, EYE = 0xfaf6ea, RED = 0xc0302a;

export function enemyGeometry(id) {
  const b = new GeoBuilder(id.length * 13);
  if (id === 'wisp' || id === 'mite') {
    b.ball(INK, 0.17, 1, { y: 0.19, sy: 1.1, jitter: 0.06 });
    b.cone(INK2, 0.1, 0.24, 6, { y: 0.16, z: -0.17, rx: -Math.PI / 2 - 0.4 });
    for (const sx of [-1, 1]) { b.ball(EYE, 0.045, 0, { x: sx * 0.07, y: 0.24, z: 0.13, jitter: 0 }); b.ball(INK, 0.022, 0, { x: sx * 0.07, y: 0.24, z: 0.17, jitter: 0 }); }
    if (id === 'mite') b.ball(0x8a3aa0, 0.05, 0, { y: 0.37, jitter: 0 });
  } else if (id === 'dart') {
    b.ball(INK, 0.13, 1, { y: 0.15, sz: 1.8, jitter: 0.06 });
    b.cone(INK2, 0.08, 0.3, 4, { y: 0.17, z: -0.3, rx: -Math.PI / 2 });
    b.cone(0xe0b030, 0.04, 0.16, 4, { y: 0.27, z: -0.05, rx: -0.6 });
    for (const sx of [-1, 1]) b.ball(0xffd84a, 0.035, 0, { x: sx * 0.06, y: 0.19, z: 0.18, jitter: 0 });
  } else if (id === 'shell') {
    b.ball(INK, 0.2, 1, { y: 0.2, jitter: 0.05 });
    b.add(new THREE.DodecahedronGeometry(0.21, 0), 0x8a8a90, { y: 0.31, sy: 0.75, z: -0.03 });
    b.box(0x6a6a72, 0.3, 0.05, 0.08, { y: 0.34, z: 0.14 });
    for (const sx of [-1, 1]) b.ball(0xff6a4a, 0.035, 0, { x: sx * 0.08, y: 0.25, z: 0.17, jitter: 0 });
  } else if (id === 'kite') {
    // diamond paper kite with ink face, flies at +y offset (origin = kite centre)
    const g = new THREE.BufferGeometry();
    const v = new Float32Array([0, 0.32, 0, -0.24, 0, 0, 0, -0.36, 0, 0, 0.32, 0, 0, -0.36, 0, 0.24, 0, 0]);
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    const g2 = g.clone(); g2.rotateY(Math.PI);
    g.rotateX(-0.5); g2.rotateX(-0.5);
    b.add(g, 0xd8402e, { jitter: 0.02 }); b.add(g2, 0xb8302a, { jitter: 0.02 });
    b.box(INK, 0.02, 0.62, 0.02, { rx: -0.5, jitter: 0 });
    b.box(INK, 0.44, 0.02, 0.02, { jitter: 0 });
    b.ball(INK, 0.1, 0, { y: 0.02, z: 0.06, sz: 0.5 });
    for (const sx of [-1, 1]) b.ball(EYE, 0.03, 0, { x: sx * 0.05, y: 0.06, z: 0.1, jitter: 0 });
    for (let k = 0; k < 4; k++) b.box(k % 2 ? 0xf0d040 : INK, 0.06, 0.03, 0.08, { y: -0.36 - k * 0.12, z: -0.08 - k * 0.09, rz: 0.4 * (k % 2 ? 1 : -1), jitter: 0 });
  } else if (id === 'split') {
    b.ball(INK, 0.19, 1, { x: -0.09, y: 0.21, jitter: 0.06 });
    b.ball(INK2, 0.17, 1, { x: 0.11, y: 0.19, z: -0.03, jitter: 0.06 });
    b.ball(INK, 0.12, 1, { y: 0.36, z: -0.02, jitter: 0.06 });
    for (const sx of [-1, 1]) b.ball(0xd88aff, 0.04, 0, { x: sx * 0.08, y: 0.27, z: 0.16, jitter: 0 });
    b.torus(0x8a3aa0, 0.2, 0.02, 3, 10, Math.PI * 2, { y: 0.14, rx: Math.PI / 2 });
  } else if (id === 'boss') {
    b.ball(INK, 0.5, 1, { y: 0.52, sy: 1.05, jitter: 0.06 });
    b.ball(INK2, 0.3, 1, { y: 0.3, z: -0.42, jitter: 0.06 });
    b.cone(INK2, 0.2, 0.6, 6, { y: 0.3, z: -0.8, rx: -Math.PI / 2 - 0.3 });
    for (const sx of [-1, 1]) {
      b.cone(0xd8b040, 0.07, 0.42, 5, { x: sx * 0.26, y: 0.98, z: 0.05, rz: -sx * 0.55 });
      b.ball(0xffd040, 0.09, 1, { x: sx * 0.18, y: 0.64, z: 0.4, jitter: 0 });
      b.ball(RED, 0.04, 0, { x: sx * 0.18, y: 0.64, z: 0.48, jitter: 0 });
    }
    for (let k = 0; k < 5; k++) b.cone(0xc0302a, 0.05, 0.18, 4, { x: (k - 2) * 0.1, y: 1.0, z: -0.08 });
    b.box(0xf6f0e0, 0.34, 0.05, 0.05, { y: 0.4, z: 0.46, jitter: 0 });
  }
  return b.build();
}

// ── Waves ───────────────────────────────────────────────────
// Group: [type, count, interval (s), start delay (s), spawn (-1 alternate)]
export const WAVES_TO_WIN = 20;
const W = [
  [['wisp', 8, 1.2, 0]],
  [['wisp', 12, 0.9, 0]],
  [['wisp', 8, 1.0, 0], ['dart', 6, 0.7, 6]],
  [['shell', 4, 2.0, 0], ['wisp', 10, 0.8, 3]],
  [['kite', 6, 1.6, 0], ['wisp', 10, 0.8, 2]],
  [['dart', 14, 0.5, 0], ['split', 2, 3.0, 5]],
  [['shell', 8, 1.3, 0], ['wisp', 14, 0.6, 4]],
  [['kite', 10, 1.0, 0], ['dart', 12, 0.5, 4]],
  [['split', 6, 1.8, 0], ['shell', 6, 1.6, 3]],
  [['boss', 1, 1, 4], ['wisp', 16, 0.6, 0]],
  [['dart', 22, 0.35, 0], ['kite', 8, 1.0, 3]],
  [['shell', 14, 0.9, 0], ['split', 5, 2.0, 4]],
  [['kite', 16, 0.7, 0], ['wisp', 22, 0.45, 2]],
  [['split', 10, 1.2, 0], ['dart', 18, 0.4, 3]],
  [['boss', 1, 1, 6], ['shell', 10, 1.0, 0], ['kite', 10, 0.9, 3]],
  [['dart', 32, 0.28, 0], ['shell', 12, 0.9, 4]],
  [['kite', 22, 0.55, 0], ['split', 10, 1.0, 3]],
  [['shell', 22, 0.6, 0], ['dart', 22, 0.35, 2]],
  [['wisp', 30, 0.3, 0], ['split', 12, 0.9, 2], ['kite', 16, 0.6, 5], ['shell', 12, 0.8, 8]],
  [['boss', 2, 8, 6], ['shell', 16, 0.7, 0], ['kite', 18, 0.6, 3], ['dart', 24, 0.3, 8]],
];

export function hpScale(wave) { const w = wave - 1; return 1 + 0.09 * w + 0.010 * w * w; }

// Returns a flat sorted list of { t, type } for this wave (1-based).
export function waveSpawns(wave, rand) {
  let groups;
  if (wave <= W.length) groups = W[wave - 1];
  else {
    const k = wave - W.length;
    const pool = ['wisp', 'dart', 'shell', 'kite', 'split'];
    groups = [];
    const n = 3 + Math.min(3, Math.floor(k / 4));
    for (let i = 0; i < n; i++) groups.push([pool[Math.floor(rand() * pool.length)], 12 + k * 2, Math.max(0.2, 0.6 - k * 0.02), i * 2.5]);
    if (wave % 5 === 0) groups.push(['boss', 1 + Math.floor(k / 10), 6, 5]);
  }
  const list = [];
  for (const [type, count, iv, start] of groups) for (let i = 0; i < count; i++) list.push({ t: start + i * iv, type: E[type] });
  list.sort((a, b) => a.t - b.t);
  return list;
}

export function waveLabel(wave) {
  if (wave > W.length) return wave % 5 === 0 ? 'Endless + boss' : 'Endless';
  const g = W[wave - 1];
  return g.map(([t, c]) => `${c} ${ENEMIES[E[t]].name}${c > 1 && t !== 'boss' ? 's' : ''}`).join(', ');
}
