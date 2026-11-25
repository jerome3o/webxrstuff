import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { GeoBuilder, mulberry32, smoothstep, shade } from './geo.js';

export const BX = 12, BZ = 9;          // board half extents (local units)
const RES = 0.25;
const NX = Math.round(BX * 2 / RES), NZ = Math.round(BZ * 2 / RES);
export const FRAME_BOTTOM = -1.6;
const noise = new ImprovedNoise();

// ── Path graph ──────────────────────────────────────────────
function buildGraph(map) {
  const names = Object.keys(map.nodes);
  const idx = {}; names.forEach((n, i) => idx[n] = i);
  const nodes = names.map((n) => ({ name: n, x: map.nodes[n][0], z: map.nodes[n][1], y: 0, out: [], dist: Infinity }));
  const edges = map.edges.map(([a, b]) => {
    const A = nodes[idx[a]], B = nodes[idx[b]];
    const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz);
    return { a: idx[a], b: idx[b], ax: A.x, az: A.z, bx: B.x, bz: B.z, len, dx: dx / len, dz: dz / len };
  });
  edges.forEach((e, i) => nodes[e.a].out.push(i));
  const goal = idx[map.goal];
  nodes[goal].dist = 0;
  // Reverse Dijkstra (graphs are tiny; repeated relaxation is fine).
  for (let it = 0; it < nodes.length; it++) for (const e of edges) {
    const d = nodes[e.b].dist + e.len; if (d < nodes[e.a].dist) nodes[e.a].dist = d;
  }
  return { nodes, edges, goal, spawns: map.spawns.map(n => idx[n]) };
}

function segDist(px, pz, e) {
  let t = (px - e.ax) * e.dx + (pz - e.az) * e.dz;
  t = Math.max(0, Math.min(e.len, t));
  const qx = e.ax + e.dx * t, qz = e.az + e.dz * t;
  return { d: Math.hypot(px - qx, pz - qz), t };
}

// ── Terrain + static decor for one map ──────────────────────
export function buildWorld(map) {
  const rand = mulberry32(map.seed * 977);
  const I = map.island, C = map.city;
  const graph = buildGraph(map);
  const sd = map.seed * 3.7;

  const base = (x, z) => {
    const n1 = noise.noise(x * 0.22 + sd, z * 0.22, 0.5);
    const e = Math.hypot((x - I.cx) / I.rx, (z - I.cz) / I.rz) + n1 * 0.16;
    const land = smoothstep(1.03, 0.82, e);
    const hills = 0.5 + 0.45 * noise.noise(x * 0.33 + 10 + sd, z * 0.33, 2.5) + 0.18 * noise.noise(x * 0.9, z * 0.9 + 5 + sd, 7.1);
    const dc = Math.hypot(x - C.x, z - C.z);
    const mount = map.peak * Math.exp(-dc * dc / (2 * map.sigma * map.sigma));
    return -0.75 + land * 1.05 + land * land * (Math.max(0, hills) * 0.75 + mount);
  };

  // Node heights: along the base, gate = city plateau height.
  for (const n of graph.nodes) n.y = Math.max(0.3, base(n.x, n.z));
  graph.nodes[graph.goal].y = C.h;
  // Smooth intermediate node heights so roads climb steadily toward the gate.
  for (const n of graph.nodes) if (n.dist > 0) {
    const tgt = C.h * Math.max(0, 1 - n.dist / 22) + 0.35;
    n.y = n.y * 0.4 + tgt * 0.6;
  }

  const W = NX + 1, Hn = NZ + 1;
  const H = new Float32Array(W * Hn), PD = new Float32Array(W * Hn), PAD = new Float32Array(W * Hn).fill(99);
  const BASE = new Float32Array(W * Hn);
  const vx = (i) => -BX + i * RES, vz = (j) => -BZ + j * RES;

  const pathInfo = (x, z) => {
    let best = 99, h = 0;
    for (const e of graph.edges) {
      const r = segDist(x, z, e);
      if (r.d < best) { best = r.d; const u = r.t / e.len; h = graph.nodes[e.a].y * (1 - u) + graph.nodes[e.b].y * u; }
    }
    return { d: best, h };
  };

  for (let j = 0; j < Hn; j++) for (let i = 0; i < W; i++) {
    const x = vx(i), z = vz(j), k = j * W + i;
    let h = base(x, z); BASE[k] = h;
    const p = pathInfo(x, z);
    PD[k] = p.d;
    const w = 1 - smoothstep(0.55, 1.35, p.d);
    h = h * (1 - w) + p.h * w;
    const dc = Math.hypot(x - C.x, z - C.z);
    const cw = 1 - smoothstep(C.r + 0.25, C.r + 1.3, dc);
    h = h * (1 - cw) + C.h * cw;
    H[k] = h;
  }

  const sample = (arr, x, z) => {
    const fx = Math.min(NX - 0.001, Math.max(0, (x + BX) / RES)), fz = Math.min(NZ - 0.001, Math.max(0, (z + BZ) / RES));
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j, k = j * W + i;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + W] * (1 - u) + arr[k + W + 1] * u) * v;
  };

  // ── Build pads along roads ──
  const pads = [];
  const okPad = (x, z) => {
    if (Math.abs(x) > BX - 1.1 || Math.abs(z) > BZ - 1.0) return false;
    if (Math.hypot(x - C.x, z - C.z) < C.r + 1.15) return false;
    for (const e of graph.edges) if (segDist(x, z, e).d < 1.05) return false;
    for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < 1.75) return false;
    if (sample(BASE, x, z) < 0.42) return false;
    for (const s of graph.spawns) if (Math.hypot(graph.nodes[s].x - x, graph.nodes[s].z - z) < 2.2) return false;
    return true;
  };
  // Process edges nearest the city first so the best spots fill early.
  const order = graph.edges.map((e, i) => i).sort((a, b) => graph.nodes[graph.edges[a].b].dist - graph.nodes[graph.edges[b].b].dist);
  for (const ei of order) {
    const e = graph.edges[ei];
    for (let t = 0.6; t < e.len; t += 1.2) for (const side of [1, -1]) for (const off of [1.3, 1.6, 1.95]) {
      const x = e.ax + e.dx * t - e.dz * off * side, z = e.az + e.dz * t + e.dx * off * side;
      if (pads.length < 28 && okPad(x, z)) { pads.push({ x, z, y: 0, tower: null, i: pads.length }); break; }
    }
  }
  // Flatten under pads.
  for (const p of pads) p.y = Math.max(0.35, sample(H, p.x, p.z)) + 0.04;
  for (let j = 0; j < Hn; j++) for (let i = 0; i < W; i++) {
    const x = vx(i), z = vz(j), k = j * W + i;
    for (const p of pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < 1.2) { const w = 1 - smoothstep(0.62, 1.15, d); H[k] = H[k] * (1 - w) + (p.y - 0.04) * w; if (d < PAD[k]) PAD[k] = d; }
    }
  }
  for (const n of graph.nodes) n.y = sample(H, n.x, n.z);

  // ── Terrain mesh (non-indexed, flat-coloured faces) ──
  const B = new GeoBuilder(map.seed);
  {
    const tris = NX * NZ * 2;
    const pos = new Float32Array(tris * 9), col = new Float32Array(tris * 9);
    const c = new THREE.Color(), c2 = new THREE.Color();
    const SAND = new THREE.Color(0xe2cd96), SAND_W = new THREE.Color(0xa99a6c), DEEP = new THREE.Color(0x3d6a6a),
      G1 = new THREE.Color(0x6e9b3c), G2 = new THREE.Color(0x4c7d33), HIGH = new THREE.Color(0x87955a), ROCK = new THREE.Color(0x8c8676),
      PATH = new THREE.Color(0xc79f62), PATH_E = new THREE.Color(0x9a8a4e), PAVE = new THREE.Color(0xb7a98d), PADC = new THREE.Color(0x9b968a), FOAM = new THREE.Color(0xf2f0e0);
    let o = 0;
    const put = (i, j) => { const k = j * W + i; pos[o++] = vx(i); pos[o++] = H[k]; pos[o++] = vz(j); };
    const tri = (a, b, cc) => {
      const start = o;
      put(...a); put(...b); put(...cc);
      const ka = a[1] * W + a[0], kb = b[1] * W + b[0], kc = cc[1] * W + cc[0];
      const h = (H[ka] + H[kb] + H[kc]) / 3, hmin = Math.min(H[ka], H[kb], H[kc]), hmax = Math.max(H[ka], H[kb], H[kc]);
      const pd = (PD[ka] + PD[kb] + PD[kc]) / 3, padd = (PAD[ka] + PAD[kb] + PAD[kc]) / 3;
      const x = (pos[start] + pos[start + 3] + pos[start + 6]) / 3, z = (pos[start + 2] + pos[start + 5] + pos[start + 8]) / 3;
      const dc = Math.hypot(x - C.x, z - C.z);
      const slope = (hmax - hmin) / RES;
      const n = noise.noise(x * 0.6, z * 0.6, 3.3);
      if (h < -0.06) c.copy(SAND_W).lerp(DEEP, smoothstep(-0.1, -0.7, h));
      else if (h < 0.08 && hmin < 0.0) c.copy(FOAM);
      else if (dc < C.r + 0.2) c.copy(PAVE);
      else if (padd < 0.62) c.copy(PADC);
      else if (pd < 0.5) c.copy(PATH);
      else if (pd < 0.68 && h > 0.25) c.copy(PATH_E);
      else if (h < 0.34) c.copy(SAND);
      else if (slope > 1.1) c.copy(ROCK);
      else { c.copy(G1).lerp(G2, smoothstep(-0.3, 0.4, n)); if (h > 1.6) c.lerp(HIGH, smoothstep(1.6, 2.6, h)); if (slope > 0.7) c.lerp(ROCK, (slope - 0.7) * 1.5); }
      const k = 1 + (rand() - 0.5) * 0.07;
      for (let v = 0; v < 3; v++) { col[start + v * 3] = c.r * k; col[start + v * 3 + 1] = c.g * k; col[start + v * 3 + 2] = c.b * k; }
    };
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      if ((i + j) % 2) { tri([i, j], [i, j + 1], [i + 1, j]); tri([i + 1, j], [i, j + 1], [i + 1, j + 1]); }
      else { tri([i, j], [i, j + 1], [i + 1, j + 1]); tri([i, j], [i + 1, j + 1], [i + 1, j]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    B.addRaw(g);
    c2.set(0);
  }

  // ── Frame (wooden diorama box) ──
  const WOOD = 0x6b4426, WOOD_D = 0x4a2e1a;
  const FT = 0.45, top = 0.18, fh = top - FRAME_BOTTOM;
  B.box(WOOD, BX * 2 + FT * 2, fh, FT, { y: FRAME_BOTTOM + fh / 2, z: BZ + FT / 2, jitter: 0.02 });
  B.box(WOOD, BX * 2 + FT * 2, fh, FT, { y: FRAME_BOTTOM + fh / 2, z: -BZ - FT / 2, jitter: 0.02 });
  B.box(WOOD, FT, fh, BZ * 2, { y: FRAME_BOTTOM + fh / 2, x: BX + FT / 2, jitter: 0.02 });
  B.box(WOOD, FT, fh, BZ * 2, { y: FRAME_BOTTOM + fh / 2, x: -BX - FT / 2, jitter: 0.02 });
  B.box(WOOD_D, BX * 2 + FT * 2 + 0.1, 0.12, FT + 0.1, { y: top + 0.06, z: BZ + FT / 2, jitter: 0 });
  B.box(WOOD_D, BX * 2 + FT * 2 + 0.1, 0.12, FT + 0.1, { y: top + 0.06, z: -BZ - FT / 2, jitter: 0 });
  B.box(WOOD_D, FT + 0.1, 0.12, BZ * 2 + FT * 2, { y: top + 0.06, x: BX + FT / 2, jitter: 0 });
  B.box(WOOD_D, FT + 0.1, 0.12, BZ * 2 + FT * 2, { y: top + 0.06, x: -BX - FT / 2, jitter: 0 });
  B.box(0x2a1a10, BX * 2, 0.2, BZ * 2, { y: FRAME_BOTTOM + 0.1, jitter: 0 });
  // Brass corner caps
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0xc9a04a, FT + 0.16, 0.16, FT + 0.16, { x: sx * (BX + FT / 2), z: sz * (BZ + FT / 2), y: top + 0.09, jitter: 0 });

  // ── City ──
  const city = buildCity(B, map, rand, graph);

  // ── Pads: stone discs ──
  for (const p of pads) {
    B.cyl(0x8d897e, 0.62, 0.66, 0.1, 8, { x: p.x, z: p.z, y: p.y - 0.03 });
    B.cyl(0xa8a397, 0.5, 0.5, 0.04, 8, { x: p.x, z: p.z, y: p.y + 0.02 });
  }

  // ── Spawn grottos (ink pools) ──
  for (const s of graph.spawns) {
    const n = graph.nodes[s];
    B.cyl(0x1a1820, 0.9, 1.0, 0.06, 10, { x: n.x, z: n.z, y: sample(H, n.x, n.z) + 0.02, jitter: 0.1 });
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; B.ball(0x5c5866, 0.22 + rand() * 0.12, 0, { x: n.x + Math.cos(a) * 1.1, z: n.z + Math.sin(a) * 1.1, y: sample(H, n.x, n.z) + 0.05, sy: 0.7 }); }
  }

  // ── Trees and rocks ──
  const treeOk = (x, z) => {
    const h = sample(H, x, z);
    if (h < 0.42) return false;
    if (Math.hypot(x - C.x, z - C.z) < C.r + 0.55) return false;
    for (const e of graph.edges) if (segDist(x, z, e).d < 0.8) return false;
    for (const p of pads) if (Math.hypot(p.x - x, p.z - z) < 0.85) return false;
    return true;
  };
  let trees = 0;
  for (let k = 0; k < 900 && trees < 170; k++) {
    const x = (rand() * 2 - 1) * (BX - 0.6), z = (rand() * 2 - 1) * (BZ - 0.6);
    if (!treeOk(x, z)) continue;
    const y = sample(H, x, z), s = 0.75 + rand() * 0.6, kind = rand();
    if (y > 1.9 && kind < 0.5 || kind < 0.38) {        // pine
      B.cyl(0x5a3c22, 0.04 * s, 0.05 * s, 0.2 * s, 5, { x, z, y: y + 0.1 * s });
      B.cone(shade(0x2f5e34, 0.9 + rand() * 0.25), 0.26 * s, 0.42 * s, 6, { x, z, y: y + 0.36 * s, ry: rand() * 3 });
      B.cone(shade(0x3a6e3c, 0.9 + rand() * 0.25), 0.19 * s, 0.34 * s, 6, { x, z, y: y + 0.6 * s, ry: rand() * 3 });
    } else if (kind < 0.86) {                            // round broadleaf
      B.cyl(0x5a3c22, 0.04 * s, 0.05 * s, 0.24 * s, 5, { x, z, y: y + 0.12 * s });
      B.ball(shade(0x5a8f3a, 0.85 + rand() * 0.3), 0.22 * s, 0, { x, z, y: y + 0.38 * s, ry: rand() * 3 });
    } else {                                             // blossom
      B.cyl(0x4a2e20, 0.035 * s, 0.05 * s, 0.26 * s, 5, { x, z, y: y + 0.13 * s, rz: 0.15 });
      B.ball(rand() < 0.5 ? 0xf0a6c2 : 0xf6c4d6, 0.21 * s, 0, { x: x + 0.03, z, y: y + 0.38 * s, ry: rand() * 3 });
    }
    trees++;
  }
  for (let k = 0; k < 60; k++) {
    const x = (rand() * 2 - 1) * (BX - 0.6), z = (rand() * 2 - 1) * (BZ - 0.6);
    if (!treeOk(x, z) && sample(H, x, z) > -0.1) continue;
    B.add(new THREE.DodecahedronGeometry(0.12 + rand() * 0.14, 0), shade(0x8a8478, 0.8 + rand() * 0.4), { x, z, y: sample(H, x, z) + 0.03, sy: 0.6, ry: rand() * 3 });
  }

  const staticGeo = B.build();
  const staticMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const staticMesh = new THREE.Mesh(staticGeo, staticMat);
  staticMesh.matrixAutoUpdate = false;

  // ── Water ──
  const waterGeo = new THREE.PlaneGeometry(BX * 2, BZ * 2, 1, 1); waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({ color: 0x3d93ad, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.72, depthWrite: false }));
  water.position.y = 0.02; water.renderOrder = 2;

  const group = new THREE.Group();
  group.add(staticMesh, water);

  return {
    map, graph, pads, city, group,
    height: (x, z) => sample(H, x, z),
    nearestOnGraph(x, z, out) {
      let best = 1e9;
      for (let i = 0; i < graph.edges.length; i++) {
        const e = graph.edges[i];
        let t = (x - e.ax) * e.dx + (z - e.az) * e.dz; t = Math.max(0, Math.min(e.len, t));
        const qx = e.ax + e.dx * t, qz = e.az + e.dz * t, d = Math.hypot(x - qx, z - qz);
        if (d < best) { best = d; out.edge = i; out.t = t; out.x = qx; out.z = qz; out.d = d; }
      }
      return out;
    },
    dispose() { staticGeo.dispose(); staticMat.dispose(); waterGeo.dispose(); water.material.dispose(); },
  };
}

// ── Walled city on the plateau ──────────────────────────────
function buildCity(B, map, rand, graph) {
  const C = map.city, cx = C.x, cz = C.z, y0 = C.h;
  const gate = graph.nodes[graph.goal];
  const ga = Math.atan2(gate.z - cz, gate.x - cx);
  const N = 10, R = C.r;
  const STONE = 0xb9b2a2, STONE_D = 0x8f887a, ROOF = 0x3d4f63, RED = 0xa8322a, GOLD = 0xd8aa3c, WOODC = 0x7a4a2a;
  const corners = [];
  for (let i = 0; i < N; i++) { const a = ga + Math.PI / N + i * Math.PI * 2 / N; corners.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); }
  const wallH = 0.55, wallT = 0.24;
  for (let i = 0; i < N; i++) {
    const [x1, z1] = corners[i], [x2, z2] = corners[(i + 1) % N];
    const len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const isGate = i === N - 1;
    const ry = -ang;
    if (isGate) {
      // two stubs + gatehouse
      for (const s of [-1, 1]) {
        const sx = mx + Math.cos(ang) * s * len * 0.36, sz = mz + Math.sin(ang) * s * len * 0.36;
        B.box(STONE, len * 0.28, wallH, wallT, { x: sx, z: sz, y: y0 + wallH / 2, ry });
        B.box(STONE_D, 0.24, wallH + 0.35, 0.36, { x: mx + Math.cos(ang) * s * 0.3, z: mz + Math.sin(ang) * s * 0.3, y: y0 + (wallH + 0.35) / 2, ry });
      }
      B.box(STONE, 0.84, 0.16, 0.4, { x: mx, z: mz, y: y0 + wallH + 0.12, ry });
      B.box(RED, 0.7, 0.24, 0.3, { x: mx, z: mz, y: y0 + wallH + 0.32, ry });
      B.add(new THREE.ConeGeometry(0.62, 0.28, 4), ROOF, { x: mx, z: mz, y: y0 + wallH + 0.58, ry: ry + Math.PI / 4, sz: 0.7 });
      B.ball(GOLD, 0.05, 0, { x: mx, z: mz, y: y0 + wallH + 0.75 });
    } else {
      B.box(STONE, len + 0.05, wallH, wallT, { x: mx, z: mz, y: y0 + wallH / 2, ry });
      const nb = Math.floor(len / 0.22);
      for (let k = 0; k < nb; k += 2) {
        const t = (k + 0.5) / nb - 0.5;
        B.box(STONE_D, 0.11, 0.1, wallT + 0.02, { x: mx + Math.cos(ang) * t * len, z: mz + Math.sin(ang) * t * len, y: y0 + wallH + 0.05, ry, jitter: 0 });
      }
    }
  }
  for (const [x, z] of corners) {
    B.cyl(STONE_D, 0.22, 0.26, wallH + 0.3, 8, { x, z, y: y0 + (wallH + 0.3) / 2 });
    B.cone(RED, 0.3, 0.3, 8, { x, z, y: y0 + wallH + 0.45 });
  }
  // Central pagoda
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const s = 1 - t * 0.17, yy = y0 + t * 0.42;
    B.box(t === 0 ? STONE : 0xe9dcc0, 0.62 * s, 0.32, 0.62 * s, { x: cx, z: cz, y: yy + 0.16 });
    B.box(RED, 0.64 * s, 0.05, 0.64 * s, { x: cx, z: cz, y: yy + 0.3, jitter: 0 });
    B.add(new THREE.ConeGeometry(0.62 * s, 0.2, 4), 0x2f6a5a, { x: cx, z: cz, y: yy + 0.42, ry: Math.PI / 4 });
  }
  B.cyl(GOLD, 0.02, 0.04, 0.45, 5, { x: cx, z: cz, y: y0 + tiers * 0.42 + 0.3 });
  B.ball(GOLD, 0.06, 0, { x: cx, z: cz, y: y0 + tiers * 0.42 + 0.52 });
  // Houses
  const gdx = Math.cos(ga), gdz = Math.sin(ga);
  const houses = [];
  for (let k = 0; k < 140 && houses.length < 26; k++) {
    const a = rand() * Math.PI * 2, r = 0.75 + rand() * (R - 1.05);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // keep the main street clear
    const along = (x - cx) * gdx + (z - cz) * gdz, perp = Math.abs(-(x - cx) * gdz + (z - cz) * gdx);
    if (along > 0 && perp < 0.32) continue;
    if (houses.some(h => Math.hypot(h[0] - x, h[1] - z) < 0.48)) continue;
    houses.push([x, z]);
    const w = 0.3 + rand() * 0.18, d = 0.26 + rand() * 0.14, h = 0.2 + rand() * 0.18, ry = a + (rand() < 0.5 ? 0 : Math.PI / 2);
    const wallC = rand() < 0.7 ? 0xeee2c8 : 0xd9c3a0;
    B.box(wallC, w, h, d, { x, z, y: y0 + h / 2, ry });
    B.box(WOODC, w + 0.02, 0.03, d + 0.02, { x, z, y: y0 + h * 0.55, ry, jitter: 0 });
    const roofC = [ROOF, 0x8a3a2c, 0x4c6a48, 0x5a5560][Math.floor(rand() * 4)];
    const rg = new THREE.ConeGeometry(0.72, 0.22, 4); rg.rotateY(Math.PI / 4);
    B.add(rg, roofC, { x, z, y: y0 + h + 0.1, ry, sx: w * 1.05, sz: d * 1.1 });
  }
  // A few blossom trees and lanterns in the city
  for (let k = 0; k < 5; k++) {
    const a = rand() * Math.PI * 2, r = 0.9 + rand() * (R - 1.2);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (houses.some(h => Math.hypot(h[0] - x, h[1] - z) < 0.3)) continue;
    B.cyl(0x4a2e20, 0.03, 0.04, 0.22, 5, { x, z, y: y0 + 0.11 });
    B.ball(0xf3b0c8, 0.17, 0, { x, z, y: y0 + 0.32 });
  }
  return { cx, cz, y: y0, r: R, ga, houses, gate: { x: gate.x, z: gate.z } };
}

// ── Room, table and tray (world space, never scaled) ────────
export const TABLE = { y: 0.775, z: -0.85, w: 1.7, d: 1.2 };
export function buildRoom() {
  const B = new GeoBuilder(7);
  const T = TABLE;
  // floor
  B.box(0x3a2a20, 12, 0.1, 12, { y: -0.05, jitter: 0 });
  for (let i = -5; i <= 5; i++) B.box(i % 2 ? 0x45322a : 0x40302a, 1.0, 0.012, 12, { x: i * 1.05, y: 0.006, jitter: 0.02 });
  // rug under table
  B.box(0x7a2a24, 2.8, 0.015, 2.2, { y: 0.012, z: T.z, jitter: 0 });
  B.box(0xc9a04a, 2.6, 0.016, 2.0, { y: 0.013, z: T.z, jitter: 0 });
  B.box(0x8a2f28, 2.5, 0.017, 1.9, { y: 0.014, z: T.z, jitter: 0 });
  // table top + skirt + legs
  B.box(0x5a3520, T.w, 0.05, T.d, { y: T.y - 0.025, z: T.z, jitter: 0.015 });
  B.box(0x3e2416, T.w - 0.1, 0.08, T.d - 0.1, { y: T.y - 0.09, z: T.z, jitter: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.box(0x3e2416, 0.08, T.y - 0.05, 0.08, { x: sx * (T.w / 2 - 0.1), z: T.z + sz * (T.d / 2 - 0.1), y: (T.y - 0.05) / 2, jitter: 0 });
  }
  // Pavilion pillars and back screen wall
  for (const sx of [-1, 1]) for (const z of [-3.5, 1.8]) {
    B.cyl(0x8a2a22, 0.12, 0.12, 3.4, 8, { x: sx * 3.2, z, y: 1.7, jitter: 0 });
    B.cyl(0x2a2a2a, 0.18, 0.2, 0.15, 8, { x: sx * 3.2, z, y: 0.075, jitter: 0 });
  }
  B.box(0x5a2a1e, 6.8, 0.25, 0.25, { y: 3.3, z: -3.5, jitter: 0 });
  B.box(0x5a2a1e, 6.8, 0.25, 0.25, { y: 3.3, z: 1.8, jitter: 0 });
  // paper lattice screen
  B.box(0xe8dcc0, 6.2, 2.6, 0.05, { y: 1.65, z: -3.6, jitter: 0 });
  for (let i = -6; i <= 6; i++) B.box(0x4a2a1a, 0.04, 2.6, 0.06, { x: i * 0.5, y: 1.65, z: -3.57, jitter: 0 });
  for (let j = 0; j <= 5; j++) B.box(0x4a2a1a, 6.2, 0.04, 0.06, { y: 0.4 + j * 0.5, z: -3.57, jitter: 0 });
  // Side railings
  for (const sx of [-1, 1]) {
    B.box(0x6a2a20, 0.08, 0.08, 5.3, { x: sx * 3.2, y: 0.9, z: -0.85, jitter: 0 });
    for (let k = 0; k < 9; k++) B.box(0x6a2a20, 0.04, 0.9, 0.04, { x: sx * 3.2, y: 0.45, z: -3.2 + k * 0.6, jitter: 0 });
  }
  // stools / tea set on the table corner
  B.cyl(0xe6e0d0, 0.04, 0.035, 0.06, 10, { x: 0.74, y: T.y + 0.03, z: T.z - 0.5, jitter: 0 });
  B.cyl(0x2f5a4a, 0.065, 0.06, 0.08, 10, { x: 0.68, y: T.y + 0.04, z: T.z - 0.41, jitter: 0 });
  B.cyl(0x2f5a4a, 0.01, 0.015, 0.06, 5, { x: 0.62, y: T.y + 0.08, z: T.z - 0.41, rz: 0.9, jitter: 0 });
  const geo = B.build();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const room = new THREE.Mesh(geo, mat); room.matrixAutoUpdate = false;

  // Lanterns (emissive, one mesh)
  const L = new GeoBuilder(3);
  for (const [x, z] of [[-2.4, -3.0], [2.4, -3.0], [-2.4, 1.2], [2.4, 1.2], [0, -3.1]]) {
    L.cyl(0xffb060, 0.16, 0.16, 0.34, 10, { x, z, y: 2.6, jitter: 0 });
    L.cyl(0x3a1a10, 0.1, 0.1, 0.05, 8, { x, z, y: 2.8, jitter: 0 });
    L.cyl(0x3a1a10, 0.1, 0.1, 0.05, 8, { x, z, y: 2.4, jitter: 0 });
  }
  const lgeo = L.build();
  const lmat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const lanterns = new THREE.Mesh(lgeo, lmat); lanterns.matrixAutoUpdate = false;
  return { room, lanterns };
}

// ── Tiny life: villagers, boats and clouds (instanced) ──────
export function buildLife(world) {
  const map = world.map, C = world.city;
  const rand = mulberry32(map.seed + 5);
  const vb = new GeoBuilder(4);
  vb.cone(0xffffff, 0.06, 0.16, 6, { y: 0.08, jitter: 0 });
  vb.ball(0xf1d2b0, 0.04, 0, { y: 0.19, jitter: 0 });
  vb.cone(0xd8c07a, 0.07, 0.04, 6, { y: 0.24, jitter: 0 }); // straw hat
  const vgeo = vb.build();
  const NV = 28;
  const villagers = new THREE.InstancedMesh(vgeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), NV);
  const vcols = [0x3b6fa8, 0xb84a3a, 0x5a8a4a, 0xd8a040, 0x7a5aa0, 0xeeeeee];
  const vs = [];
  const col = new THREE.Color();
  for (let i = 0; i < NV; i++) {
    const v = { x: C.cx, z: C.cz, tx: C.cx, tz: C.cz, wait: rand() * 3, sp: 0.18 + rand() * 0.15 };
    pickTarget(v); v.x = v.tx; v.z = v.tz; pickTarget(v);
    vs.push(v);
    villagers.setColorAt(i, col.set(vcols[i % vcols.length]));
  }
  function pickTarget(v) {
    for (let k = 0; k < 10; k++) {
      const a = rand() * Math.PI * 2, r = 0.3 + rand() * (C.r - 0.55);
      const x = C.cx + Math.cos(a) * r, z = C.cz + Math.sin(a) * r;
      if (C.houses.some(h => Math.hypot(h[0] - x, h[1] - z) < 0.28)) continue;
      if (Math.hypot(x - C.cx, z - C.cz) < 0.5) continue;
      v.tx = x; v.tz = z; return;
    }
  }
  // boats
  const bb = new GeoBuilder(9);
  bb.box(0x6a4428, 0.9, 0.16, 0.3, { y: 0.06 });
  bb.box(0x5a3820, 0.25, 0.12, 0.32, { x: 0.38, y: 0.12 });
  bb.cyl(0x3a2414, 0.02, 0.02, 0.8, 4, { y: 0.5 });
  bb.box(0xd8b878, 0.04, 0.55, 0.42, { x: 0.02, y: 0.55, rz: 0.1, jitter: 0 });
  const bgeo = bb.build();
  const boats = new THREE.InstancedMesh(bgeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), map.boats.length);
  // clouds
  const cb = new GeoBuilder(10);
  cb.ball(0xffffff, 0.6, 1, { sy: 0.6, jitter: 0.02 });
  cb.ball(0xffffff, 0.45, 1, { x: 0.6, y: -0.05, sy: 0.6, jitter: 0.02 });
  cb.ball(0xffffff, 0.42, 1, { x: -0.55, y: -0.08, sy: 0.6, jitter: 0.02 });
  const cgeo = cb.build();
  const NC = 5;
  const clouds = new THREE.InstancedMesh(cgeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.88, emissive: 0x444444 }), NC);
  const cl = [];
  for (let i = 0; i < NC; i++) cl.push({ x: (rand() * 2 - 1) * (BX - 4), z: (rand() * 2 - 1) * (BZ - 3), y: 4.2 + rand() * 1.2, s: 0.8 + rand() * 0.7, v: 0.12 + rand() * 0.1 });

  const group = new THREE.Group();
  group.add(villagers, boats, clouds);
  for (const m of [villagers, boats, clouds]) m.frustumCulled = false;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), E = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);
  return {
    group,
    update(dt, t) {
      for (let i = 0; i < NV; i++) {
        const v = vs[i];
        if (v.wait > 0) v.wait -= dt;
        else {
          const dx = v.tx - v.x, dz = v.tz - v.z, d = Math.hypot(dx, dz);
          if (d < 0.05) { v.wait = 1 + rand() * 4; pickTarget(v); }
          else { v.x += dx / d * v.sp * dt; v.z += dz / d * v.sp * dt; v.yaw = Math.atan2(dx, dz); }
        }
        const hop = v.wait > 0 ? 0 : Math.abs(Math.sin(t * 9 + i)) * 0.03;
        P.set(v.x, C.y + hop, v.z); Q.setFromAxisAngle(UP, v.yaw || 0); S.set(1, 1, 1);
        M.compose(P, Q, S); villagers.setMatrixAt(i, M);
      }
      villagers.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < map.boats.length; i++) {
        const [x, z] = map.boats[i];
        const bx = x + Math.sin(t * 0.1 + i * 2) * 0.6;
        E.set(Math.sin(t * 1.3 + i) * 0.08, i * 1.7 + Math.sin(t * 0.1 + i * 2) * 0.2, Math.sin(t * 1.1 + i * 3) * 0.06);
        Q.setFromEuler(E); P.set(bx, 0.0 + Math.sin(t * 1.7 + i) * 0.03, z); S.set(1, 1, 1);
        M.compose(P, Q, S); boats.setMatrixAt(i, M);
      }
      boats.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NC; i++) {
        const c = cl[i];
        c.x += c.v * dt; if (c.x > BX - 3) c.x = -BX + 3;
        const fade = Math.min(1, (BX - 3 - Math.abs(c.x)) / 2);
        P.set(c.x, c.y, c.z); Q.identity(); S.setScalar(c.s * Math.max(0.01, fade));
        M.compose(P, Q, S); clouds.setMatrixAt(i, M);
      }
      clouds.instanceMatrix.needsUpdate = true;
    },
    dispose() { for (const m of [villagers, boats, clouds]) { m.geometry.dispose(); m.material.dispose(); m.dispose(); } },
  };
}
