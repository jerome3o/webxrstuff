import * as THREE from 'three';
import { Panel, Pointer, FONTS, roundRect, rotateRigAround } from '../../src/platform/kit.js';
import { MAPS } from './maps.js';
import { buildWorld, buildRoom, buildLife, TABLE, BX, BZ, FRAME_BOTTOM } from './world.js';
import { TOWERS, TOWER_KEYS, towerModel, disposeTowerCache } from './towers.js';
import { ENEMIES, E, enemyGeometry, waveSpawns, hpScale, WAVES_TO_WIN, waveLabel } from './enemies.js';
import { FX } from './fx.js';
import { SiegeAudio } from './sfx.js';
import { GeoBuilder, mulberry32 } from './geo.js';

// Tabletop Siege: a tower-defence diorama on a table. Grab the whole board with both grips,
// pick towers from the tray, flick spirits off the road, paint with a giant ink brush,
// or shrink yourself down onto the city wall.

const DEF_SCALE = 0.05, MIN_SCALE = 0.02, MAX_SCALE = 0.22;
const START_GOLD = 250, START_LIVES = 20;
const FLICK_CD = 12, BRUSH_CD = 25, BRUSH_LIFE = 6, BRUSH_MAX = 64, BRUSH_LEN = 16, BRUSH_W = 0.45;
const TRAY_S = 0.032;
const MAXE = 256, MAXP = 160;
const TARGET_MODES = ['First', 'Strong', 'Near'];

export async function create(ctx) {
  const { scene, input, rig, camera } = ctx;
  const rand = mulberry32(Date.now() & 0xffff);
  const UP = new THREE.Vector3(0, 1, 0);
  // Reusable temporaries (no allocations in the frame loop)
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _m1 = new THREE.Matrix4(), _s1 = new THREE.Vector3(), _c1 = new THREE.Color(), _e1 = new THREE.Euler();
  const rayO = new THREE.Vector3(), rayD = new THREE.Vector3(), hitP = new THREE.Vector3();

  // ── Scene, lights, room ───────────────────────────────────
  scene.background = new THREE.Color(0x221a2a);
  scene.fog = new THREE.Fog(0x221a2a, 7, 16);
  scene.add(new THREE.HemisphereLight(0xfff2e0, 0x3a2a34, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7); sun.position.set(2.5, 6, 3); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9ab0ff, 0.35); fill.position.set(-3, 2, -2); scene.add(fill);
  const room = buildRoom(); scene.add(room.room, room.lanterns);

  const sfx = new SiegeAudio(ctx.audio);

  // ── Diorama root ──────────────────────────────────────────
  const root = new THREE.Group(); scene.add(root);
  const invRoot = new THREE.Matrix4();
  const DEF_POS = new THREE.Vector3(0, TABLE.y - FRAME_BOTTOM * DEF_SCALE, TABLE.z - 0.07);
  const board = { s: DEF_SCALE, yaw: 0, pos: DEF_POS.clone() };
  function applyBoard() {
    root.position.copy(board.pos); root.rotation.set(0, board.yaw, 0); root.scale.setScalar(board.s);
    root.updateMatrixWorld(true); invRoot.copy(root.matrixWorld).invert();
    // blob shadow on the table follows the board
    const lift = board.pos.y + FRAME_BOTTOM * board.s - TABLE.y;
    shadow.position.set(board.pos.x, TABLE.y + 0.002, board.pos.z);
    shadow.rotation.set(-Math.PI / 2, 0, board.yaw);
    shadow.scale.set((BX * 2 + 3) * board.s, (BZ * 2 + 3) * board.s, 1);
    shadow.material.opacity = Math.max(0, 0.55 - lift * 1.5);
    shadow.visible = shadow.material.opacity > 0.02 && Math.abs(board.pos.x) < TABLE.w / 2 + 0.4;
  }
  const shadow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 20, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.5 }));
    m.renderOrder = 1; scene.add(m); return m;
  })();
  applyBoard();

  const towerMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const towersGroup = new THREE.Group(); root.add(towersGroup);
  const fx = new FX(root);

  // Range ring + pad markers
  const rangeRing = new THREE.Mesh((() => { const g = new THREE.RingGeometry(0.95, 1, 64); g.rotateX(-Math.PI / 2); return g; })(),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
  rangeRing.visible = false; rangeRing.renderOrder = 3; root.add(rangeRing);
  const rangeDisc = new THREE.Mesh((() => { const g = new THREE.CircleGeometry(1, 48); g.rotateX(-Math.PI / 2); return g; })(),
    new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.1, depthWrite: false, toneMapped: false }));
  rangeRing.add(rangeDisc);
  const padMarkGeo = new THREE.RingGeometry(0.42, 0.56, 24); padMarkGeo.rotateX(-Math.PI / 2);
  const padMarks = new THREE.InstancedMesh(padMarkGeo, new THREE.MeshBasicMaterial({ color: 0x9fffb0, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }), 32);
  padMarks.visible = false; padMarks.frustumCulled = false; padMarks.renderOrder = 3; root.add(padMarks);

  // ── Enemy rendering (one InstancedMesh per type) ──────────
  const enemyMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const eMeshes = ENEMIES.map((d) => {
    const m = new THREE.InstancedMesh(enemyGeometry(d.id), enemyMat, d.max);
    m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, _c1.set(0xffffff));
    root.add(m); return m;
  });
  const eCounts = new Int32Array(ENEMIES.length);
  const barGeo = new THREE.PlaneGeometry(1, 0.09);
  const barBg = new THREE.InstancedMesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x1a1010, toneMapped: false, depthWrite: false, transparent: true, opacity: 0.8 }), MAXE);
  const barFg = new THREE.InstancedMesh(barGeo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false }), MAXE);
  barFg.setColorAt(0, _c1.set(0xffffff));
  for (const m of [barBg, barFg]) { m.frustumCulled = false; m.count = 0; root.add(m); }
  barBg.renderOrder = 6; barFg.renderOrder = 7;
  const kshGeo = new THREE.CircleGeometry(0.22, 12); kshGeo.rotateX(-Math.PI / 2);
  const kiteShadows = new THREE.InstancedMesh(kshGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }), 48);
  kiteShadows.frustumCulled = false; kiteShadows.count = 0; root.add(kiteShadows);

  // ── Projectile meshes ─────────────────────────────────────
  const projGeo = [
    (() => { const b = new GeoBuilder(1); b.box(0x8a6a3a, 0.025, 0.025, 0.34, { jitter: 0 }); b.cone(0xd0d0d0, 0.03, 0.08, 4, { z: 0.2, rx: Math.PI / 2, jitter: 0 }); b.box(0xf0f0f0, 0.05, 0.005, 0.07, { z: -0.15, jitter: 0 }); return b.build(); })(),
    (() => { const b = new GeoBuilder(2); b.cyl(0xd8402e, 0.045, 0.045, 0.26, 6, { rx: Math.PI / 2, jitter: 0 }); b.cone(0xf0d040, 0.045, 0.1, 6, { z: 0.18, rx: Math.PI / 2, jitter: 0 }); b.cyl(0x7a4a2a, 0.008, 0.008, 0.3, 3, { z: -0.2, rx: Math.PI / 2, jitter: 0 }); return b.build(); })(),
    new THREE.IcosahedronGeometry(0.13, 0),
  ];
  const projMats = [enemyMat, enemyMat, new THREE.MeshBasicMaterial({ color: 0xffa030, toneMapped: false })];
  const pMeshes = projGeo.map((g, i) => { const m = new THREE.InstancedMesh(g, projMats[i], MAXP); m.frustumCulled = false; m.count = 0; root.add(m); return m; });
  const pCounts = new Int32Array(3);

  // ── Ink brush ribbon ──────────────────────────────────────
  const brushGeo = new THREE.BufferGeometry();
  const brushPos = new Float32Array(BRUSH_MAX * 2 * 3);
  brushGeo.setAttribute('position', new THREE.BufferAttribute(brushPos, 3).setUsage(THREE.DynamicDrawUsage));
  { const idx = []; for (let i = 0; i < BRUSH_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } brushGeo.setIndex(idx); }
  brushGeo.setDrawRange(0, 0);
  const brushMat = new THREE.MeshBasicMaterial({ color: 0x0c0c14, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const brushMesh = new THREE.Mesh(brushGeo, brushMat); brushMesh.frustumCulled = false; brushMesh.renderOrder = 3; root.add(brushMesh);
  const brush = { drawing: false, active: false, n: 0, len: 0, life: 0, xs: new Float32Array(BRUSH_MAX), zs: new Float32Array(BRUSH_MAX), hand: null };

  // ── Hand markers (VR) ─────────────────────────────────────
  const handMarks = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0, toneMapped: false }));
    m.visible = false; scene.add(m); return m;
  });
  const brushTip = (() => {
    const b = new GeoBuilder(5);
    b.cyl(0x6a3a1a, 0.006, 0.006, 0.12, 6, { y: 0.07, jitter: 0 });
    b.cone(0x101010, 0.012, 0.045, 8, { y: -0.012, rx: Math.PI, jitter: 0 });
    const m = new THREE.Mesh(b.build(), towerMat); m.visible = false; scene.add(m); return m;
  })();

  // ── Tray (world space at the near table edge) ─────────────
  const tray = new THREE.Group();
  tray.position.set(0, TABLE.y, TABLE.z + TABLE.d / 2 - 0.085);
  scene.add(tray);
  {
    const b = new GeoBuilder(3);
    b.box(0x4a2c18, 0.66, 0.02, 0.12, { y: 0.01, jitter: 0 });
    for (let i = 0; i <= 5; i++) b.box(0x6b4426, 0.01, 0.03, 0.12, { x: -0.3 + i * 0.12, y: 0.03, jitter: 0 });
    b.box(0x6b4426, 0.62, 0.03, 0.01, { y: 0.03, z: -0.055, jitter: 0 });
    b.box(0x6b4426, 0.62, 0.012, 0.01, { y: 0.02, z: 0.055, jitter: 0 });
    for (let i = 0; i < 5; i++) b.box(0xb8a27a, 0.1, 0.004, 0.1, { x: -0.24 + i * 0.12, y: 0.022, jitter: 0 });
    const m = new THREE.Mesh(b.build(), towerMat); tray.add(m);
  }
  const slots = TOWER_KEYS.map((type, i) => {
    const mdl = towerModel(type, 0);
    const mini = new THREE.Mesh(mdl.merged, towerMat);
    mini.position.set(-0.24 + i * 0.12, 0.024, 0); mini.scale.setScalar(TRAY_S); mini.rotation.y = 0.5;
    tray.add(mini);
    return { type, mini, world: new THREE.Vector3(), hover: 0 };
  });
  tray.updateMatrixWorld(true);
  for (const s of slots) { s.world.set(s.mini.position.x, 0.045, 0).applyMatrix4(tray.matrixWorld); }
  const trayLabel = new Panel({
    width: 0.62, height: 0.05, px: 1024, transparent: true,
    draw: (c, W, H) => {
      c.fillStyle = 'rgba(30,18,10,0.92)'; roundRect(c, 0, 0, W, H, 16); c.fill();
      for (let i = 0; i < 5; i++) {
        const t = TOWERS[TOWER_KEYS[i]], x = W * (i + 0.5) / 5.17 + 12, afford = S.gold >= t.cost;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = `600 26px ${FONTS.sans}`; c.fillStyle = hold && hold.type === TOWER_KEYS[i] ? '#ffe08a' : '#f1e6cf';
        c.fillText(`${i + 1} ${t.short}`, x, H * 0.32);
        c.font = `800 26px ${FONTS.sans}`; c.fillStyle = afford ? '#e2b85c' : '#e0584a';
        c.fillText(`${t.cost}g`, x, H * 0.74);
      }
    },
  });
  trayLabel.mesh.position.set(0, 0.032, 0.075); trayLabel.mesh.rotation.x = -0.9; tray.add(trayLabel.mesh);

  // ── Panels ────────────────────────────────────────────────
  const pointer = new Pointer(scene, 0xffd060);
  pointer.onClick = () => sfx.click();
  const boardPanel = new Panel({ width: 0.84, height: 0.5, px: 1100, draw: drawBoard });
  boardPanel.mesh.position.set(0, 1.32, -1.78); boardPanel.mesh.lookAt(0, 1.55, 0);
  scene.add(boardPanel.mesh); pointer.panels.push(boardPanel);
  const towerPanel = new Panel({ width: 0.34, height: 0.17, px: 760, draw: drawTowerPanel });
  towerPanel.mesh.visible = false; scene.add(towerPanel.mesh); pointer.panels.push(towerPanel);
  const wristPanel = new Panel({ width: 0.16, height: 0.09, px: 512, draw: drawWrist });
  wristPanel.mesh.visible = false; scene.add(wristPanel.mesh); pointer.panels.push(wristPanel);

  // ── Game state ────────────────────────────────────────────
  const S = {
    mode: 'menu', mapIdx: ctx.load('siege:map', 0) % MAPS.length, wave: 0, phase: 'idle', countdown: 0,
    spawnList: null, spawnI: 0, spawnT: 0, spawnAlt: 0,
    gold: START_GOLD, lives: START_LIVES, maxLives: START_LIVES, speed: 1, paused: false, endless: false, result: '',
    flickCd: 0, brushCd: 0, brushArmed: false, kills: 0, msg: '', msgT: 0, time: 0, newBest: false,
  };
  let world = null, life = null, portals = [];
  const towers = [];
  let selected = null, hold = null;
  const enemies = []; for (let i = 0; i < MAXE; i++) enemies.push({ alive: false, uid: 0, type: 0, def: null, hp: 0, maxHp: 0, armor: 0, speed: 1, edge: 0, t: 0, off: 0, x: 0, y: 0, z: 0, yaw: 0, slowT: 0, slowF: 0, state: 0, vx: 0, vy: 0, vz: 0, sx: 0, sz: 0, tx: 0, tz: 0, kp: 0, klen: 1, remain: 0, phase: 0, hitT: 0, age: 0, rx: 0, rz: 0, flickDmg: 0, brushTick: 0 });
  let eCursor = 0, uidSeq = 1, aliveCount = 0;
  const projs = []; for (let i = 0; i < MAXP; i++) projs.push({ alive: false, kind: 0, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, target: null, uid: 0, u: 0, dur: 1, arc: 1, dmg: 0, splash: 0, pierce: false, air: true, ttl: 0, level: 0 });
  let pCursor = 0;
  const nearest = { edge: 0, t: 0, x: 0, z: 0, d: 0 };

  function loadMap(i) {
    if (world) { root.remove(world.group); world.dispose(); }
    if (life) { root.remove(life.group); life.dispose(); }
    for (const p of portals) { root.remove(p); p.geometry.dispose(); }
    portals = [];
    S.mapIdx = i; ctx.save('siege:map', i);
    world = buildWorld(MAPS[i]);
    life = buildLife(world);
    root.add(world.group, life.group);
    for (const si of world.graph.spawns) {
      const n = world.graph.nodes[si];
      const g = new THREE.TorusGeometry(0.62, 0.07, 4, 20); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, portalMat); m.position.set(n.x, world.height(n.x, n.z) + 0.1, n.z);
      root.add(m); portals.push(m);
    }
  }
  const portalMat = new THREE.MeshBasicMaterial({ color: 0x8a4ad0, toneMapped: false });

  function clearField() {
    for (const tw of towers) { towersGroup.remove(tw.group); tw.pad.tower = null; }
    towers.length = 0;
    for (const e of enemies) e.alive = false;
    for (const p of projs) p.alive = false;
    aliveCount = 0;
    fx.clear(); brush.active = brush.drawing = false; brushGeo.setDrawRange(0, 0);
    selectTower(null); cancelHold();
  }
  function startGame() {
    clearField();
    Object.assign(S, { mode: 'play', wave: 0, phase: 'idle', countdown: 0, spawnList: null, spawnI: 0, spawnT: 0, gold: START_GOLD, lives: START_LIVES, speed: 1, paused: false, endless: false, result: '', flickCd: 0, brushCd: 0, brushArmed: false, kills: 0, newBest: false });
    flash('Place towers from the tray, then start wave 1.');
    sfx.gong(boardCenterWorld());
  }
  function toMenu() { clearField(); S.mode = 'menu'; S.paused = false; if (shrink.on) exitShrink(); }
  function flash(msg, t = 4) { S.msg = msg; S.msgT = t; }
  function bestOf(i) { return ctx.load('siege:best:' + MAPS[i].id, 0); }

  function boardCenterWorld() { return _v3.set(0, 1, 0).applyMatrix4(root.matrixWorld); }
  function localToWorld(x, y, z) { return _v3.set(x, y, z).applyMatrix4(root.matrixWorld); }

  // ── Waves ─────────────────────────────────────────────────
  function startWave() {
    if (S.mode !== 'play' || S.phase === 'wave') return;
    if (S.phase === 'build' && S.countdown > 1) { const bonus = Math.floor(S.countdown) * 2; S.gold += bonus; flash(`Called early: +${bonus} gold`); }
    S.wave++;
    S.spawnList = waveSpawns(S.wave, rand); S.spawnI = 0; S.spawnT = 0; S.phase = 'wave';
    sfx.gong(boardCenterWorld());
    if (S.wave % 10 === 0 || S.spawnList.some(s => s.type === E.boss)) flash('A Great Smudge approaches!', 5);
  }
  function endWave() {
    const interest = Math.min(30, Math.floor(S.gold * 0.05));
    const bonus = 25 + S.wave * 4;
    S.gold += bonus + interest;
    flash(`Wave ${S.wave} cleared: +${bonus} gold, +${interest} interest`);
    sfx.coin(boardCenterWorld());
    saveBest(S.wave);
    if (S.wave >= WAVES_TO_WIN && !S.endless) { endGame(true); return; }
    S.phase = 'build'; S.countdown = 20;
  }
  function saveBest(reached) {
    const key = 'siege:best:' + MAPS[S.mapIdx].id;
    if (reached > ctx.load(key, 0)) { ctx.save(key, reached); S.newBest = true; }
  }
  function endGame(win) {
    if (S.mode !== 'play') return;
    saveBest(win ? S.wave : S.phase === 'wave' ? S.wave - 1 : S.wave);
    S.mode = 'end'; S.result = win ? 'win' : 'lose';
    sfx.fanfare(win);
    selectTower(null); cancelHold();
    if (shrink.on) exitShrink();
    const c = world.city;
    if (win) for (let i = 0; i < 6; i++) fx.firework(c.cx + (rand() - 0.5) * 4, c.y + 2 + rand() * 2, c.cz + (rand() - 0.5) * 3, [0xff5040, 0xffd040, 0x40d0ff, 0xff60e0][i % 4], 0xffffff, 1.4);
  }

  // ── Enemies ───────────────────────────────────────────────
  function allocEnemy() {
    for (let k = 0; k < MAXE; k++) { const i = (eCursor + k) % MAXE; if (!enemies[i].alive) { eCursor = (i + 1) % MAXE; return enemies[i]; } }
    return null;
  }
  function chooseEdge(e, ni) {
    const g = world.graph, out = g.nodes[ni].out;
    if (out.length === 1) { e.edge = out[0]; return; }
    let best = 1e9;
    for (let i = 0; i < out.length; i++) { const ed = g.edges[out[i]]; best = Math.min(best, ed.len + g.nodes[ed.b].dist); }
    let sum = 0;
    for (let i = 0; i < out.length; i++) { const ed = g.edges[out[i]]; sum += Math.exp(-(ed.len + g.nodes[ed.b].dist - best) / 5); }
    let r = rand() * sum;
    for (let i = 0; i < out.length; i++) { const ed = g.edges[out[i]]; r -= Math.exp(-(ed.len + g.nodes[ed.b].dist - best) / 5); if (r <= 0) { e.edge = out[i]; return; } }
    e.edge = out[out.length - 1];
  }
  function spawnEnemy(type, from = null) {
    const e = allocEnemy(); if (!e) return null;
    const d = ENEMIES[type];
    e.alive = true; e.uid = uidSeq++; e.type = type; e.def = d;
    e.maxHp = e.hp = Math.round(d.hp * hpScale(Math.max(1, S.wave)));
    e.armor = d.armor; e.speed = d.speed * (0.92 + rand() * 0.16);
    e.slowT = 0; e.slowF = 0; e.hitT = 0; e.age = 0; e.phase = rand() * 6.28; e.brushTick = 0;
    e.off = d.boss ? 0 : (rand() - 0.5) * 0.5;
    if (d.flying) {
      const k = world.map.kites[Math.floor(rand() * world.map.kites.length)];
      e.state = 3; e.sx = k[0]; e.sz = k[1]; e.tx = world.city.cx; e.tz = world.city.cz;
      e.kp = 0; e.klen = Math.hypot(e.tx - e.sx, e.tz - e.sz); e.x = e.sx; e.z = e.sz; e.y = 2.2;
      e.yaw = Math.atan2(e.tx - e.sx, e.tz - e.sz);
    } else if (from) {
      e.state = 0; e.edge = from.edge; e.t = Math.max(0, Math.min(world.graph.edges[from.edge].len - 0.01, from.t + (rand() - 0.5) * 0.6));
      e.yaw = from.yaw ?? 0; placeOnEdge(e);
    } else {
      const sp = world.graph.spawns[S.spawnAlt++ % world.graph.spawns.length];
      e.state = 0; chooseEdge(e, sp); e.t = 0; placeOnEdge(e);
      const ed = world.graph.edges[e.edge]; e.yaw = Math.atan2(ed.dx, ed.dz);
    }
    aliveCount++;
    return e;
  }
  function placeOnEdge(e) {
    const ed = world.graph.edges[e.edge];
    e.x = ed.ax + ed.dx * e.t - ed.dz * e.off; e.z = ed.az + ed.dz * e.t + ed.dx * e.off;
    e.y = world.height(e.x, e.z);
    e.remain = ed.len - e.t + world.graph.nodes[ed.b].dist;
  }
  function damage(e, amt, pierce = false) {
    if (!e.alive) return;
    const eff = pierce ? amt : Math.max(amt * 0.25, amt - e.armor);
    e.hp -= eff; e.hitT = 0.12;
    if (e.hp <= 0) kill(e);
  }
  const _from = { edge: 0, t: 0, yaw: 0 };
  function kill(e, drowned = false) {
    if (!e.alive) return;
    e.alive = false; aliveCount--;
    const d = e.def;
    S.gold += d.reward; S.kills++;
    if (drowned) { fx.burst(1, e.x, 0.05, e.z, 10, 1.4, 0.5, 0.05, 0, 0xc0f0ff, -4, 2); sfx.splash(localToWorld(e.x, e.y, e.z)); }
    fx.inkPuff(e.x, e.y, e.z, d.boss ? 3 : d.size * 2.4);
    fx.burst(1, e.x, e.y + d.size, e.z, 3, 0.6, 0.6, 0.04, 0.02, 0xffd040, 1.5, 1.5);
    sfx.pop(localToWorld(e.x, e.y, e.z), !!d.boss);
    if (d.boss) { fx.addRing(e.x, e.y + 0.1, e.z, 0.2, 3, 0.8, 0x8a6aff); }
    const nKids = d.splits ? d.splits : d.boss ? 5 : 0;
    if (nKids) {
      if (e.state === 0) { _from.edge = e.edge; _from.t = e.t; }
      else { world.nearestOnGraph(e.x, e.z, nearest); _from.edge = nearest.edge; _from.t = nearest.t; }
      _from.yaw = e.yaw;
      for (let k = 0; k < nKids; k++) spawnEnemy(d.boss ? E.wisp : E.mite, _from);
    }
  }
  function leak(e) {
    if (!e.alive) return;
    e.alive = false; aliveCount--;
    S.lives -= e.def.dmg;
    const c = world.city, g = world.city.gate;
    fx.addRing(g.x, c.y + 0.1, g.z, 0.3, 2.2, 0.7, 0xff3020);
    fx.inkPuff(e.x, e.y, e.z, 1.2);
    sfx.leak(localToWorld(g.x, c.y, g.z));
    input.left.haptic(0.4, 60); input.right.haptic(0.4, 60);
    flash(`The walls are hit! (${Math.max(0, S.lives)} left)`, 2.5);
    if (S.lives <= 0) { S.lives = 0; endGame(false); }
  }

  function updateEnemies(dt) {
    const g = world.graph;
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      e.age += dt; if (e.hitT > 0) e.hitT -= dt;
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowF = 0; }
      const sp = e.speed * (1 - e.slowF);
      if (e.state === 0) {
        e.t += sp * dt;
        let ed = g.edges[e.edge];
        let guard = 0;
        while (e.t >= ed.len && guard++ < 4) {
          const over = e.t - ed.len, nb = ed.b;
          if (nb === g.goal) { leak(e); break; }
          chooseEdge(e, nb); ed = g.edges[e.edge]; e.t = over;
        }
        if (!e.alive) continue;
        placeOnEdge(e);
        const ty = Math.atan2(ed.dx, ed.dz);
        e.yaw = lerpAngle(e.yaw, ty, Math.min(1, dt * 8));
      } else if (e.state === 1) {             // flicked through the air
        e.vy -= 16 * dt;
        e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
        if (Math.abs(e.x) > BX - 0.3) { e.x = Math.sign(e.x) * (BX - 0.3); e.vx *= -0.4; }
        if (Math.abs(e.z) > BZ - 0.3) { e.z = Math.sign(e.z) * (BZ - 0.3); e.vz *= -0.4; }
        e.yaw += dt * 14;
        const h = world.height(e.x, e.z);
        if (e.y <= Math.max(h, 0.0) && e.vy < 0) {
          if (h < 0.02) { kill(e, true); continue; }
          e.y = h;
          fx.burst(0, e.x, h + 0.05, e.z, 5, 0.8, 0.4, 0.07, 0, 0x9a8a6a, -1, 0.5);
          damage(e, e.flickDmg, true);
          if (!e.alive) continue;
          world.nearestOnGraph(e.x, e.z, nearest);
          e.state = 2; e.edge = nearest.edge; e.t = nearest.t;
          const ed = g.edges[e.edge];
          e.rx = ed.ax + ed.dx * e.t - ed.dz * e.off; e.rz = ed.az + ed.dz * e.t + ed.dx * e.off;
          e.slowT = 1.0; e.slowF = 0.6;
        }
      } else if (e.state === 2) {             // walking back to the road
        const dx = e.rx - e.x, dz = e.rz - e.z, d = Math.hypot(dx, dz);
        if (d < 0.08) { e.state = 0; placeOnEdge(e); }
        else { const st = Math.min(d, sp * dt); e.x += dx / d * st; e.z += dz / d * st; e.y = world.height(e.x, e.z); e.yaw = lerpAngle(e.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8)); }
        e.remain = d + g.edges[e.edge].len - e.t + g.nodes[g.edges[e.edge].b].dist;
      } else if (e.state === 3) {             // kite
        e.kp += sp * dt;
        const u = e.kp / e.klen, dx = (e.tx - e.sx) / e.klen, dz = (e.tz - e.sz) / e.klen;
        const weave = Math.sin(e.kp * 1.3 + e.phase) * 0.6 * Math.min(1, (1 - u) * 3);
        e.x = e.sx + dx * e.kp - dz * weave; e.z = e.sz + dz * e.kp + dx * weave;
        const c = world.city;
        const alt = 2.0 + (c.y + 1.4 - 2.0) * Math.min(1, u * 1.2);
        e.y = Math.max(alt, world.height(e.x, e.z) + 1.1) + Math.sin(S.time * 2 + e.phase) * 0.12;
        e.yaw = Math.atan2(dx, dz);
        e.remain = e.klen - e.kp;
        if (Math.hypot(e.x - c.cx, e.z - c.cz) < c.r * 0.55) leak(e);
      }
    }
  }
  function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

  // ── Towers ────────────────────────────────────────────────
  function placeTower(type, pad, free = false) {
    const def = TOWERS[type];
    if (!pad || pad.tower) return null;
    if (!free && S.gold < def.cost) return null;
    if (!free) S.gold -= def.cost;
    const group = new THREE.Group(); group.position.set(pad.x, pad.y, pad.z);
    const tw = { type, level: 0, pad, group, base: null, head: null, cd: 0.3, aim: rand() * 6, target: null, spent: def.cost, mode: 0, buff: 0, swing: 0, healT: def.heal ? def.heal[0] : 0, anim: 0 };
    buildTowerMeshes(tw);
    towersGroup.add(group);
    pad.tower = tw; towers.push(tw);
    recomputeBuffs();
    fx.addRing(pad.x, pad.y + 0.05, pad.z, 0.3, 1.1, 0.4, 0xffe0a0);
    fx.burst(0, pad.x, pad.y + 0.1, pad.z, 8, 1.2, 0.5, 0.09, 0, 0xb0a080, -1, 0.3);
    sfx.place(localToWorld(pad.x, pad.y, pad.z));
    return tw;
  }
  function buildTowerMeshes(tw) {
    if (tw.base) tw.group.remove(tw.base, tw.head);
    const m = towerModel(tw.type, tw.level);
    tw.base = new THREE.Mesh(m.base, towerMat); tw.head = new THREE.Mesh(m.head, towerMat);
    tw.head.position.y = m.headY; tw.headY = m.headY; tw.top = m.top;
    tw.group.add(tw.base, tw.head);
    tw.anim = 0;
  }
  function upgradeTower(tw) {
    const def = TOWERS[tw.type];
    if (!tw || tw.level >= 2) return false;
    const cost = def.up[tw.level];
    if (S.gold < cost) { sfx.deny(); return false; }
    S.gold -= cost; tw.spent += cost; tw.level++;
    buildTowerMeshes(tw); recomputeBuffs();
    const p = tw.pad;
    fx.burst(1, p.x, p.y + 0.6, p.z, 18, 1.6, 0.8, 0.06, 0.01, 0xffe070, -1, 1);
    fx.addRing(p.x, p.y + 0.05, p.z, 0.3, 1.4, 0.6, 0xffd040);
    sfx.upgrade(localToWorld(p.x, p.y, p.z));
    return true;
  }
  function sellTower(tw) {
    const refund = Math.floor(tw.spent * 0.7);
    S.gold += refund;
    towersGroup.remove(tw.group); tw.pad.tower = null;
    towers.splice(towers.indexOf(tw), 1);
    const p = tw.pad;
    fx.inkPuff(p.x, p.y, p.z, 1.5);
    sfx.sell(localToWorld(p.x, p.y, p.z));
    if (selected === tw) selectTower(null);
    recomputeBuffs();
    return refund;
  }
  function recomputeBuffs() {
    for (const tw of towers) tw.buff = 0;
    for (const m of towers) if (m.type === 'monk') {
      const r = TOWERS.monk.range[m.level], a = TOWERS.monk.aura[m.level];
      for (const tw of towers) if (tw !== m && tw.type !== 'monk' && Math.hypot(tw.pad.x - m.pad.x, tw.pad.z - m.pad.z) <= r) tw.buff = Math.max(tw.buff, a);
    }
  }
  function findTarget(tw, range, air, ground, exclude) {
    const px = tw.pad.x, pz = tw.pad.z, r2 = range * range;
    let best = null, bestV = 1e9;
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i];
      if (!e.alive || e === exclude) continue;
      const flying = e.state === 3 || e.state === 1;
      if (flying ? !air : !ground) continue;
      const dx = e.x - px, dz = e.z - pz, d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const v = tw.mode === 0 ? e.remain : tw.mode === 1 ? -e.hp : d2;
      if (v < bestV) { bestV = v; best = e; }
    }
    return best;
  }
  function allocProj() {
    for (let k = 0; k < MAXP; k++) { const i = (pCursor + k) % MAXP; if (!projs[i].alive) { pCursor = (i + 1) % MAXP; return projs[i]; } }
    return null;
  }
  function fire(tw, e, kind) {
    const p = allocProj(); if (!p) return;
    const def = TOWERS[tw.type], L = tw.level;
    p.alive = true; p.kind = kind; p.target = e; p.uid = e.uid; p.level = L;
    p.sx = p.x = p.px = tw.pad.x; p.sy = p.y = p.py = tw.pad.y + tw.headY + (kind === 0 ? 0.3 : 0.35); p.sz = p.z = p.pz = tw.pad.z;
    p.tx = e.x; p.ty = e.y + e.def.size * 0.5; p.tz = e.z;
    p.dmg = def.dmg[L]; p.splash = def.splash ? def.splash[L] : 0; p.pierce = !!def.pierce; p.air = def.air; p.u = 0; p.ttl = 3;
    const dist = Math.hypot(p.tx - p.sx, p.tz - p.sz);
    if (kind === 1) { p.dur = 0.45 + dist / 6; p.arc = 1.0 + dist * 0.25 + rand() * 0.4; }
    if (kind === 2) {
      p.dur = 0.35 + dist / 8; p.arc = 0.5 + dist * 0.12;
      if (e.state === 0) { // lead the target along its road
        const ed = world.graph.edges[e.edge], lead = Math.min(ed.len - e.t, e.speed * (1 - e.slowF) * p.dur);
        p.tx = e.x + ed.dx * lead; p.tz = e.z + ed.dz * lead; p.ty = world.height(p.tx, p.tz) + 0.15;
      }
    }
  }
  function updateTowers(dt) {
    for (let i = 0; i < towers.length; i++) {
      const tw = towers[i], def = TOWERS[tw.type], L = tw.level, p = tw.pad;
      if (tw.anim < 1) { tw.anim = Math.min(1, tw.anim + dt * 3); }
      tw.cd -= dt * (1 + tw.buff);
      if (tw.type === 'monk') {
        tw.healT -= dt;
        if (tw.healT <= 0) {
          tw.healT = def.heal[L];
          if (S.lives < S.maxLives && S.mode === 'play') {
            S.lives++;
            const c = world.city;
            fx.burst(1, p.x, p.y + 0.8, p.z, 10, 0.6, 1.0, 0.05, 0.01, 0x90ffb0, 1.2, 0.8);
            fx.addRing(c.gate.x, c.y + 0.1, c.gate.z, 0.3, 1.6, 0.9, 0x60ff90);
            sfx.chime(localToWorld(p.x, p.y, p.z));
            flash('A monk mends the walls (+1)', 2);
          }
        }
        continue;
      }
      if (tw.type === 'bell') {
        if (tw.cd <= 0 && findTarget(tw, def.range[L], true, true, null)) {
          tw.cd = 1 / def.rate[L]; tw.swing = 1;
          const r2 = def.range[L] * def.range[L];
          for (let k = 0; k < MAXE; k++) {
            const e = enemies[k]; if (!e.alive) continue;
            const dx = e.x - p.x, dz = e.z - p.z; if (dx * dx + dz * dz > r2) continue;
            e.slowF = Math.max(e.slowF, e.def.boss ? def.slow[L] * 0.5 : def.slow[L]); e.slowT = 1.7;
            damage(e, def.dmg[L], true);
          }
          fx.addRing(p.x, p.y + 0.15, p.z, 0.3, def.range[L], 0.7, 0x80e0ff);
          fx.addRing(p.x, p.y + 0.6, p.z, 0.2, def.range[L] * 0.6, 0.5, 0xc0f0ff);
          sfx.bell(localToWorld(p.x, p.y + 1, p.z), L);
        }
        continue;
      }
      // Aim + shoot
      if (!tw.target || !tw.target.alive || tw.cd <= 0.15) tw.target = findTarget(tw, def.range[L], def.air, def.ground, null);
      const e = tw.target;
      if (e && e.alive) {
        const want = Math.atan2(e.x - p.x, e.z - p.z);
        tw.aim = lerpAngle(tw.aim, want, Math.min(1, dt * 10));
        if (tw.cd <= 0) {
          tw.cd = 1 / def.rate[L];
          const kind = tw.type === 'archer' ? 0 : tw.type === 'rocket' ? 1 : 2;
          fire(tw, e, kind);
          if (def.shots && def.shots[L] > 1) { const e2 = findTarget(tw, def.range[L], def.air, def.ground, e) || e; fire(tw, e2, kind); }
          const wp = localToWorld(p.x, p.y + 0.6, p.z);
          if (kind === 0) sfx.arrow(wp);
          else if (kind === 1) { sfx.rocketLaunch(wp); fx.burst(0, p.x, p.y + 0.5, p.z, 4, 0.5, 0.5, 0.08, 0, 0xc0c0c0, 0.5, 0.4); }
          else { sfx.cannon(wp); tw.recoil = 1; fx.burst(0, p.x + Math.sin(tw.aim) * 0.6, p.y + tw.headY + 0.2, p.z + Math.cos(tw.aim) * 0.6, 6, 0.8, 0.5, 0.1, 0, 0x707070, 0.6, 0.2); fx.burst(1, p.x + Math.sin(tw.aim) * 0.6, p.y + tw.headY + 0.2, p.z + Math.cos(tw.aim) * 0.6, 6, 1.0, 0.3, 0.06, 0, 0xffa030, 0, 0); }
        }
      }
    }
  }
  function explode(p) {
    const r2 = p.splash * p.splash;
    for (let k = 0; k < MAXE; k++) {
      const e = enemies[k]; if (!e.alive) continue;
      const flying = e.state === 3 || e.state === 1;
      if (flying && !p.air) continue;
      const dx = e.x - p.x, dz = e.z - p.z, dy = flying ? (e.y - p.y) * 0.5 : 0;
      if (dx * dx + dz * dz + dy * dy <= r2) damage(e, p.dmg, p.pierce);
    }
    const wp = localToWorld(p.x, p.y, p.z);
    if (p.kind === 1) {
      const cols = [0xff4a3a, 0xffd040, 0x50d0ff, 0xff70e0, 0x80ff70];
      fx.firework(p.x, p.y + 0.1, p.z, cols[Math.floor(rand() * 5)], cols[Math.floor(rand() * 5)], 0.7 + p.level * 0.15);
      sfx.firework(wp);
    } else {
      fx.burst(1, p.x, p.y + 0.1, p.z, 14, 1.8, 0.5, 0.07, 0.01, 0xff8a20, -1);
      fx.burst(0, p.x, p.y + 0.1, p.z, 8, 1.0, 0.7, 0.14, 0, 0x5a4a40, 0.6, 0.6);
      fx.addRing(p.x, p.y + 0.05, p.z, 0.1, p.splash, 0.35, 0xff7020);
      sfx.boom(wp);
    }
  }
  function updateProjectiles(dt) {
    for (let i = 0; i < MAXP; i++) {
      const p = projs[i]; if (!p.alive) continue;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      const t = p.target, live = t && t.alive && t.uid === p.uid;
      if (p.kind === 0) {
        if (live) { p.tx = t.x; p.ty = t.y + t.def.size * 0.5; p.tz = t.z; }
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, d = Math.hypot(dx, dy, dz), step = 13 * dt;
        p.ttl -= dt;
        if (d <= step + 0.05 || p.ttl <= 0) { if (live) damage(t, p.dmg, p.pierce); p.alive = false; continue; }
        p.x += dx / d * step; p.y += dy / d * step + 0.0; p.z += dz / d * step;
      } else {
        if (live && p.kind === 1) { p.tx = t.x; p.ty = t.y + t.def.size * 0.4; p.tz = t.z; }
        p.u += dt / p.dur;
        const u = Math.min(1, p.u), h = p.arc * 4 * u * (1 - u);
        p.x = p.sx + (p.tx - p.sx) * u; p.y = p.sy + (p.ty - p.sy) * u + h; p.z = p.sz + (p.tz - p.sz) * u;
        if (p.kind === 1 && rand() < 0.7) fx.emit(1, p.x, p.y, p.z, (rand() - 0.5) * 0.3, -0.2, (rand() - 0.5) * 0.3, 0.35, 0.04, 0, 0xffc060, 0, 1);
        if (p.kind === 2 && rand() < 0.6) fx.emit(0, p.x, p.y, p.z, 0, 0.3, 0, 0.4, 0.06, 0, 0x6a6060, 0, 1);
        if (p.u >= 1) { p.alive = false; explode(p); }
      }
    }
  }

  // ── Abilities: hand-of-god flick and ink brush ────────────
  function flickAt(lx, lz, dx, dz, power) {
    if (S.flickCd > 0 || S.mode !== 'play') return false;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    let hits = 0;
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i]; if (!e.alive) continue;
      const d = Math.hypot(e.x - lx, e.z - lz);
      if (d > 1.25 + e.def.size) continue;
      hits++;
      if (e.def.boss) { damage(e, e.maxHp * 0.06, true); if (e.state === 0) { e.t = Math.max(0, e.t - 1.5); placeOnEdge(e); } continue; }
      if (e.state === 3) { damage(e, e.maxHp * 0.35, true); if (!e.alive) continue; e.sx = e.x + dx * 3; e.sz = e.z + dz * 3; e.kp = 0; e.klen = Math.hypot(e.tx - e.sx, e.tz - e.sz); continue; }
      e.state = 1;
      const sp = power * (0.75 + rand() * 0.5);
      e.vx = dx * sp + (e.x - lx) * 1.5; e.vz = dz * sp + (e.z - lz) * 1.5; e.vy = 5 + rand() * 2.5;
      e.flickDmg = e.maxHp * 0.3;
    }
    if (!hits) return false;
    S.flickCd = FLICK_CD;
    fx.addRing(lx, world.height(lx, lz) + 0.1, lz, 0.2, 1.6, 0.4, 0xffffff);
    fx.burst(0, lx, world.height(lx, lz) + 0.1, lz, 6, 1.5, 0.4, 0.08, 0, 0xc0b090, -1, 0.5);
    sfx.flick(localToWorld(lx, 1, lz));
    flash(`Flicked ${hits} spirit${hits > 1 ? 's' : ''}!`, 2);
    return true;
  }
  function brushStart(hand) {
    if (S.brushCd > 0 || brush.drawing || S.mode !== 'play') return;
    brush.drawing = true; brush.active = true; brush.n = 0; brush.len = 0; brush.life = BRUSH_LIFE; brush.hand = hand;
    S.brushArmed = false; brushMat.opacity = 0.88;
  }
  function brushAdd(x, z) {
    if (!brush.drawing) return;
    x = Math.max(-BX + 0.2, Math.min(BX - 0.2, x)); z = Math.max(-BZ + 0.2, Math.min(BZ - 0.2, z));
    const n = brush.n;
    if (n > 0) {
      const d = Math.hypot(x - brush.xs[n - 1], z - brush.zs[n - 1]);
      if (d < 0.28) return;
      brush.len += d;
    }
    brush.xs[n] = x; brush.zs[n] = z; brush.n++;
    if (rand() < 0.5) sfx.brush(localToWorld(x, 1, z));
    for (let k = 0; k < 3; k++) fx.emit(0, x, world.height(x, z) + 0.1, z, (rand() - 0.5), 0.6, (rand() - 0.5), 0.5, 0.07, 0, 0x101018, -0.5, 1);
    rebuildBrush();
    if (brush.n >= BRUSH_MAX || brush.len >= BRUSH_LEN) brushEnd();
  }
  function brushEnd() {
    if (!brush.drawing) return;
    brush.drawing = false; brush.hand = null;
    if (brush.n < 2) { brush.active = false; brushGeo.setDrawRange(0, 0); return; }
    brush.life = BRUSH_LIFE; S.brushCd = BRUSH_CD;
  }
  function rebuildBrush() {
    const n = brush.n;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = brush.xs[b] - brush.xs[a], tz = brush.zs[b] - brush.zs[a]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const taper = Math.min(1, (i + 1) / 3, (n - i) / 2 + 0.3) * (0.85 + 0.15 * Math.sin(i * 1.7));
      const w = BRUSH_W * taper;
      const x = brush.xs[i], z = brush.zs[i];
      const x1 = x - tz * w, z1 = z + tx * w, x2 = x + tz * w, z2 = z - tx * w;
      brushPos[i * 6] = x1; brushPos[i * 6 + 1] = Math.max(0.03, world.height(x1, z1)) + 0.07; brushPos[i * 6 + 2] = z1;
      brushPos[i * 6 + 3] = x2; brushPos[i * 6 + 4] = Math.max(0.03, world.height(x2, z2)) + 0.07; brushPos[i * 6 + 5] = z2;
    }
    brushGeo.attributes.position.needsUpdate = true;
    brushGeo.setDrawRange(0, Math.max(0, n - 1) * 6);
  }
  function updateBrush(dt) {
    if (!brush.active) return;
    if (!brush.drawing) {
      brush.life -= dt;
      brushMat.opacity = 0.88 * Math.min(1, brush.life / 1.2);
      if (brush.life <= 0) { brush.active = false; brushGeo.setDrawRange(0, 0); return; }
    }
    const dps = 34 * hpScale(Math.max(1, S.wave)) * 0.75;
    const n = brush.n; if (n < 2) return;
    const r2 = (BRUSH_W + 0.1) * (BRUSH_W + 0.1);
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i]; if (!e.alive || e.state === 3 || e.state === 1) continue;
      let hit = false;
      for (let k = 0; k < n - 1 && !hit; k++) {
        const ax = brush.xs[k], az = brush.zs[k], bx = brush.xs[k + 1], bz = brush.zs[k + 1];
        const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
        let t = ((e.x - ax) * vx + (e.z - az) * vz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + vx * t - e.x, qz = az + vz * t - e.z;
        if (qx * qx + qz * qz < r2) hit = true;
      }
      if (hit) {
        e.slowF = Math.max(e.slowF, 0.5); e.slowT = Math.max(e.slowT, 0.3);
        damage(e, dps * dt, true);
        e.brushTick -= dt;
        if (e.alive && e.brushTick <= 0) { e.brushTick = 0.25; fx.emit(0, e.x, e.y + 0.2, e.z, (rand() - 0.5) * 0.5, 0.8, (rand() - 0.5) * 0.5, 0.5, 0.06, 0, 0x14141c, 0, 1); }
      }
    }
  }

  // ── Simulation step ───────────────────────────────────────
  function sim(dt) {
    S.time += dt;
    if (S.flickCd > 0) S.flickCd = Math.max(0, S.flickCd - dt);
    if (S.brushCd > 0 && !brush.drawing) S.brushCd = Math.max(0, S.brushCd - dt);
    if (S.mode === 'play') {
      if (S.phase === 'build') { S.countdown -= dt; if (S.countdown <= 0) startWave(); }
      else if (S.phase === 'wave') {
        S.spawnT += dt;
        const L = S.spawnList;
        while (S.spawnI < L.length && L[S.spawnI].t <= S.spawnT) { spawnEnemy(L[S.spawnI].type); S.spawnI++; }
      }
    }
    updateEnemies(dt);
    updateTowers(dt);
    updateProjectiles(dt);
    updateBrush(dt);
    if (S.mode === 'play' && S.phase === 'wave' && S.spawnI >= S.spawnList.length && aliveCount <= 0) endWave();
  }

  // ── Visual sync (once per frame) ──────────────────────────
  const camLocalQ = new THREE.Quaternion(), barRight = new THREE.Vector3();
  function renderEnemies(t) {
    eCounts.fill(0);
    let nb = 0, nk = 0;
    // billboard orientation for health bars in board-local space
    root.getWorldQuaternion(_q2).invert();
    camLocalQ.copy(_q2).multiply(input.head.quat);
    barRight.set(1, 0, 0).applyQuaternion(camLocalQ);
    for (let i = 0; i < MAXE; i++) {
      const e = enemies[i]; if (!e.alive) continue;
      const ti = e.type, d = e.def, mesh = eMeshes[ti], k = eCounts[ti];
      if (k >= d.max) continue;
      eCounts[ti]++;
      const sq = Math.sin(t * 9 + e.phase), grow = Math.min(1, e.age * 4);
      const pop = 1 + Math.max(0, e.hitT) * 2.5;
      let s = grow * pop * 1.3;
      if (e.state === 3) {
        _e1.set(-0.25 + Math.sin(t * 2.2 + e.phase) * 0.15, e.yaw, Math.sin(t * 1.7 + e.phase) * 0.35, 'YXZ');
        _q1.setFromEuler(_e1); _s1.set(s, s, s);
        if (nk < 48) { _v1.set(e.x, Math.max(0.03, world.height(e.x, e.z)) + 0.04, e.z); _m1.compose(_v1, _q2.identity(), _s1.set(1, 1, 1)); kiteShadows.setMatrixAt(nk++, _m1); _s1.set(s, s, s); }
      } else {
        _q1.setFromAxisAngle(UP, e.yaw);
        if (e.state === 1) { _e1.set(e.yaw * 0.7, e.yaw, 0, 'YXZ'); _q1.setFromEuler(_e1); }
        _s1.set(s * (1 - sq * 0.06), s * (1 + sq * 0.12), s * (1 - sq * 0.06));
      }
      _v1.set(e.x, e.y + (e.state === 0 ? Math.max(0, sq) * 0.04 : 0), e.z);
      _m1.compose(_v1, _q1, _s1);
      mesh.setMatrixAt(k, _m1);
      if (e.slowT > 0) _c1.setRGB(0.6, 0.85, 1.7); else _c1.setRGB(1, 1, 1);
      mesh.setColorAt(k, _c1);
      // health bar
      if (e.hp < e.maxHp || d.boss) {
        const ratio = Math.max(0, e.hp / e.maxHp), w = d.boss ? 1.4 : 0.5;
        const by = e.y + d.size * 1.3 + (e.state === 3 ? 0.45 : 0.18);
        _v1.set(e.x, by, e.z); _s1.set(w, d.boss ? 1.6 : 1, 1);
        _m1.compose(_v1, camLocalQ, _s1); barBg.setMatrixAt(nb, _m1);
        _v1.addScaledVector(barRight, -(1 - ratio) * w * 0.5);
        _v2.copy(_v1); _s1.set(w * ratio, d.boss ? 1.6 : 1, 1);
        _m1.compose(_v2, camLocalQ, _s1); barFg.setMatrixAt(nb, _m1);
        _c1.setRGB(ratio > 0.5 ? (1 - ratio) * 2 : 1, ratio > 0.5 ? 1 : ratio * 2, 0.15);
        barFg.setColorAt(nb, _c1);
        nb++;
      }
    }
    for (let i = 0; i < eMeshes.length; i++) { const m = eMeshes[i]; m.count = eCounts[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    barBg.count = barFg.count = nb; barBg.instanceMatrix.needsUpdate = barFg.instanceMatrix.needsUpdate = true; if (barFg.instanceColor) barFg.instanceColor.needsUpdate = true;
    kiteShadows.count = nk; kiteShadows.instanceMatrix.needsUpdate = true;
  }
  const _fwd = new THREE.Vector3(0, 0, 1);
  function renderProjectiles(t) {
    pCounts.fill(0);
    for (let i = 0; i < MAXP; i++) {
      const p = projs[i]; if (!p.alive) continue;
      const k = pCounts[p.kind]++;
      _v2.set(p.x - p.px, p.y - p.py, p.z - p.pz);
      if (_v2.lengthSq() < 1e-8) _v2.set(0, 0, 1); else _v2.normalize();
      _q1.setFromUnitVectors(_fwd, _v2);
      _v1.set(p.x, p.y, p.z);
      const s = p.kind === 2 ? 1 + p.level * 0.25 + Math.sin(t * 30) * 0.1 : 1;
      _s1.set(s, s, s); _m1.compose(_v1, _q1, _s1);
      pMeshes[p.kind].setMatrixAt(k, _m1);
    }
    for (let i = 0; i < 3; i++) { pMeshes[i].count = pCounts[i]; pMeshes[i].instanceMatrix.needsUpdate = true; }
  }
  function renderTowers(t, dt) {
    for (let i = 0; i < towers.length; i++) {
      const tw = towers[i];
      const a = tw.anim; const bounce = a < 1 ? 1 + Math.sin(a * Math.PI) * 0.25 : 1;
      tw.group.scale.set(1 / Math.sqrt(bounce), bounce, 1 / Math.sqrt(bounce));
      if (tw.type === 'bell') { tw.swing = Math.max(0, tw.swing - dt * 1.2); tw.head.rotation.x = Math.sin(t * 11) * 0.5 * tw.swing; }
      else if (tw.type === 'monk') tw.head.rotation.y += dt * (1.5 + tw.level);
      else {
        tw.head.rotation.y = tw.aim;
        if (tw.recoil) { tw.recoil = Math.max(0, tw.recoil - dt * 4); tw.head.position.z = 0; tw.head.position.x = 0; tw.head.position.y = tw.headY - tw.recoil * 0.05; }
      }
    }
  }

  // ── Board raycasting helpers ──────────────────────────────
  function toLocalRay(origin, dir) {
    rayO.copy(origin).applyMatrix4(invRoot);
    rayD.copy(dir).transformDirection(invRoot);
  }
  // March the local ray against the terrain heightfield (water counts as a surface).
  function marchTerrain(out) {
    let t0 = 0, t1 = 1e4;
    const o = rayO, d = rayD;
    const slab = (oa, da, mn, mx) => {
      if (Math.abs(da) < 1e-9) return oa >= mn && oa <= mx;
      let a = (mn - oa) / da, b = (mx - oa) / da; if (a > b) { const tmp = a; a = b; b = tmp; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); return t0 <= t1;
    };
    if (!slab(o.x, d.x, -BX, BX) || !slab(o.z, d.z, -BZ, BZ) || !slab(o.y, d.y, -1, 7)) return false;
    const step = 0.12;
    let prev = t0;
    for (let t = t0; t <= t1; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= Math.max(0.02, world.height(x, z))) {
        let lo = prev, hi = t;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; const yy = o.y + d.y * m; if (yy <= Math.max(0.02, world.height(o.x + d.x * m, o.z + d.z * m))) hi = m; else lo = m; }
        out.set(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
        return true;
      }
      prev = t;
    }
    return false;
  }
  function rayTower() {
    let best = null, bt = 1e9;
    for (const tw of towers) {
      const cx = tw.pad.x, cy = tw.pad.y + 0.55, cz = tw.pad.z, r = 0.62;
      const ox = rayO.x - cx, oy = rayO.y - cy, oz = rayO.z - cz;
      const b = ox * rayD.x + oy * rayD.y + oz * rayD.z, c = ox * ox + oy * oy + oz * oz - r * r, disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t > 0 && t < bt) { bt = t; best = tw; }
    }
    return best;
  }
  function nearestPad(x, z, maxD) {
    let best = null, bd = maxD;
    for (const p of world.pads) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  const tipW = [new THREE.Vector3(), new THREE.Vector3()], tipL = [new THREE.Vector3(), new THREE.Vector3()];
  function fingertip(h, out) {
    const th = input.trackedHand(h.handedness);
    const j = th?.joints?.['index-finger-tip'];
    if (j) return j.getWorldPosition(out);
    return out.copy(h.rayPos);
  }

  // ── Selection / panels ────────────────────────────────────
  function selectTower(tw) {
    selected = tw;
    towerPanel.mesh.visible = !!tw;
    towerPanel.markDirty();
    if (tw) sfx.pick(localToWorld(tw.pad.x, tw.pad.y, tw.pad.z));
  }
  function startHold(type, hand, button) {
    if (S.mode !== 'play') return;
    hold = { type, hand, button, pad: null, valid: false, frame: frameNo };
    selectTower(null);
    if (S.gold < TOWERS[type].cost) flash(`Not enough gold for ${TOWERS[type].name} (${TOWERS[type].cost}g)`, 2);
    sfx.pick(hand ? hand.gripPos : boardCenterWorld());
    ghost.geometry = towerModel(type, 0).merged;
    trayLabel.markDirty();
  }
  function cancelHold() { hold = null; ghost.visible = false; padMarks.visible = false; if (!selected) rangeRing.visible = false; trayLabel.markDirty(); }
  const ghostMatOk = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.7, color: 0xb0ffb0, depthWrite: false });
  const ghostMatBad = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.7, color: 0xff5040, emissive: 0x400000, depthWrite: false });
  const ghost = new THREE.Mesh(towerModel('archer', 0).merged, ghostMatOk); ghost.visible = false; ghost.renderOrder = 8; scene.add(ghost);

  function updateHold() {
    if (!hold) return;
    const def = TOWERS[hold.type];
    // where is the hand / crosshair over the board?
    let pad = null, have = false;
    if (input.desktop || !hold.hand) {
      toLocalRay(input.main.rayPos, _v2.set(0, 0, -1).applyQuaternion(input.main.rayQuat));
      if (marchTerrain(hitP)) { have = true; pad = nearestPad(hitP.x, hitP.z, 1.6); }
    } else {
      const tl = _v1.copy(fingertip(hold.hand, _v1)).applyMatrix4(invRoot);
      if (Math.abs(tl.x) < BX + 1 && Math.abs(tl.z) < BZ + 1) {
        pad = nearestPad(tl.x, tl.z, 1.6);
        if (pad && tl.y - pad.y > 6) pad = null;
        hitP.copy(tl); have = true;
      }
    }
    hold.pad = pad;
    hold.valid = !!pad && !pad.tower && S.gold >= def.cost;
    // pad markers
    let n = 0;
    for (const p of world.pads) {
      if (p.tower || n >= 32) continue;
      _v1.set(p.x, p.y + 0.06, p.z); _s1.set(1, 1, 1); _m1.compose(_v1, _q1.identity(), _s1); padMarks.setMatrixAt(n++, _m1);
    }
    padMarks.count = n; padMarks.instanceMatrix.needsUpdate = true; padMarks.visible = true;
    padMarks.material.opacity = 0.45 + Math.sin(S.time * 6) * 0.2;
    ghost.visible = true;
    if (pad) {
      ghost.material = hold.valid ? ghostMatOk : ghostMatBad;
      ghost.position.set(pad.x, pad.y, pad.z).applyMatrix4(root.matrixWorld);
      ghost.quaternion.copy(root.quaternion); ghost.scale.setScalar(board.s);
      rangeRing.visible = def.range !== undefined;
      rangeRing.position.set(pad.x, pad.y + 0.08, pad.z); rangeRing.scale.setScalar(def.range[0]);
      rangeRing.material.color.set(hold.valid ? 0xc0ffc0 : 0xff6050); rangeDisc.material.color.copy(rangeRing.material.color);
    } else {
      ghost.material = ghostMatOk;
      rangeRing.visible = false;
      if (!input.desktop && hold.hand) {
        ghost.position.copy(hold.hand.gripPos); ghost.position.y -= 0.02;
        ghost.quaternion.copy(root.quaternion); ghost.scale.setScalar(TRAY_S);
      } else if (have) {
        ghost.position.copy(hitP).applyMatrix4(root.matrixWorld); ghost.quaternion.copy(root.quaternion); ghost.scale.setScalar(board.s);
        ghost.material = ghostMatBad;
      } else ghost.visible = false;
    }
  }
  function tryPlaceHeld() {
    if (!hold) return false;
    if (hold.valid) { const type = hold.type; placeTower(type, hold.pad); cancelHold(); return true; }
    if (hold.pad && S.gold < TOWERS[hold.type].cost) { sfx.deny(); flash('Not enough gold', 1.5); }
    else if (hold.pad && hold.pad.tower) { sfx.deny(); flash('That pad is taken', 1.5); }
    cancelHold(); return false;
  }

  // ── Board grab (one or two hands) ─────────────────────────
  const grab = { hands: [], pos0: new THREE.Vector3(), yaw0: 0, s0: 1, a0: new THREE.Vector3(), b0: new THREE.Vector3(), hyaw0: 0 };
  function handYaw(h) { _v1.set(0, 0, -1).applyQuaternion(h.gripQuat); return Math.atan2(_v1.x, _v1.z); }
  function grabInit() {
    grab.pos0.copy(board.pos); grab.yaw0 = board.yaw; grab.s0 = board.s;
    if (grab.hands.length >= 1) { grab.a0.copy(grab.hands[0].gripPos); grab.hyaw0 = handYaw(grab.hands[0]); }
    if (grab.hands.length >= 2) grab.b0.copy(grab.hands[1].gripPos);
  }
  function grabUpdate() {
    if (!grab.hands.length) return;
    if (grab.hands.length === 1) {
      const h = grab.hands[0];
      let dy = handYaw(h) - grab.hyaw0; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      _v1.copy(grab.pos0).sub(grab.a0).applyAxisAngle(UP, dy).add(h.gripPos);
      board.pos.copy(_v1); board.yaw = grab.yaw0 + dy;
    } else {
      const a = grab.hands[0].gripPos, b = grab.hands[1].gripPos;
      const ang0 = Math.atan2(grab.b0.x - grab.a0.x, grab.b0.z - grab.a0.z), ang = Math.atan2(b.x - a.x, b.z - a.z);
      let dy = ang - ang0; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      const d0 = Math.max(0.05, grab.a0.distanceTo(grab.b0)), d = a.distanceTo(b);
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, grab.s0 * d / d0)), r = s / grab.s0;
      _v2.copy(grab.a0).add(grab.b0).multiplyScalar(0.5);
      _v1.copy(grab.pos0).sub(_v2).applyAxisAngle(UP, dy).multiplyScalar(r);
      _v2.copy(a).add(b).multiplyScalar(0.5);
      board.pos.copy(_v1).add(_v2); board.yaw = grab.yaw0 + dy; board.s = s;
    }
    board.pos.y = Math.max(0.3, Math.min(2.2, board.pos.y));
    applyBoard();
  }
  function zoomBoard(factor) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, board.s * factor));
    // keep the board's bottom on the same height, scale around centre
    const bottom = board.pos.y + FRAME_BOTTOM * board.s;
    board.s = s; board.pos.y = bottom - FRAME_BOTTOM * s;
    applyBoard();
  }
  function resetBoard() { board.s = DEF_SCALE; board.yaw = 0; board.pos.copy(DEF_POS); applyBoard(); }

  // ── Shrink-down mode ──────────────────────────────────────
  const shrink = { on: false, k: 1, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 1, yaw: 0, pitch: 0, snapReady: true };
  function enterShrink() {
    if (shrink.on || !world) return;
    cancelHold(); selectTower(null); grab.hands.length = 0;
    shrink.on = true;
    shrink.pos.copy(rig.position); shrink.quat.copy(rig.quaternion); shrink.scale = rig.scale.x; shrink.yaw = input.yaw; shrink.pitch = input.pitch;
    const c = world.city, a = c.ga + 0.2, rr = c.r * Math.cos(Math.PI / 10) / Math.cos(0.2);
    const lx = c.cx + Math.cos(a) * rr, lz = c.cz + Math.sin(a) * rr, ly = c.y + 0.56;
    const k = board.s * 0.42 / 1.6; shrink.k = k;
    const dx = Math.cos(c.ga), dz = Math.sin(c.ga);
    const yaw = board.yaw + Math.atan2(-dx, -dz);
    rig.scale.setScalar(k); rig.rotation.set(0, yaw, 0);
    const P = localToWorld(lx, ly, lz);
    const hx = ctx.isXR() ? camera.position.x : 0, hz = ctx.isXR() ? camera.position.z : 0;
    _v1.set(hx * k, 0, hz * k).applyAxisAngle(UP, yaw);
    rig.position.set(P.x - _v1.x, P.y, P.z - _v1.z);
    if (!ctx.isXR()) { input.yaw = 0; input.pitch = -0.25; }
    rig.updateMatrixWorld(true);
    scene.fog.near = 7 / k; scene.fog.far = 16 / k;
    flash('You are on the city wall. Stick/WASD to walk, B or H to return.', 5);
    sfx.chime(boardCenterWorld());
  }
  function exitShrink() {
    if (!shrink.on) return;
    shrink.on = false;
    rig.position.copy(shrink.pos); rig.quaternion.copy(shrink.quat); rig.scale.setScalar(shrink.scale);
    if (!ctx.isXR()) { input.yaw = shrink.yaw; input.pitch = shrink.pitch; }
    rig.updateMatrixWorld(true);
    scene.fog.near = 7; scene.fog.far = 16;
    wristPanel.mesh.visible = false;
  }
  function updateShrink(dt) {
    const off = input.off;
    const [ax, ay] = off.axes;
    if (Math.hypot(ax, ay) > 0.15) {
      _v1.copy(input.head.fwd); _v1.y = 0; _v1.normalize();
      _v2.set(-_v1.z, 0, _v1.x);
      const sp = 1.1 * board.s * dt;
      _v3.set(0, 0, 0).addScaledVector(_v1, -ay * sp).addScaledVector(_v2, ax * sp);
      rig.position.add(_v3);
      // follow the ground, stay on the board
      _v1.copy(input.head.pos).add(_v3).applyMatrix4(invRoot);
      _v1.x = Math.max(-BX + 0.5, Math.min(BX - 0.5, _v1.x)); _v1.z = Math.max(-BZ + 0.5, Math.min(BZ - 0.5, _v1.z));
      const gy = Math.max(0.02, world.height(_v1.x, _v1.z));
      const wy = _v2.set(_v1.x, gy, _v1.z).applyMatrix4(root.matrixWorld).y;
      rig.position.y += (wy - rig.position.y) * Math.min(1, dt * 10);
    }
    if (!input.desktop) {
      const x = input.main.axes[0];
      if (Math.abs(x) > 0.6 && shrink.snapReady) { rotateRigAround(rig, input.head.pos, -Math.sign(x) * Math.PI / 6); shrink.snapReady = false; }
      if (Math.abs(x) < 0.3) shrink.snapReady = true;
    }
    if (ctx.isXR() && input.off.present) {
      const wp = wristPanel.mesh;
      wp.visible = true;
      wp.position.copy(input.off.gripPos).addScaledVector(input.head.up, 0.09 * shrink.k);
      wp.scale.setScalar(shrink.k);
      wp.lookAt(input.head.pos);
    }
  }

  // ── Panel drawing ─────────────────────────────────────────
  function drawBoard(c, W, H, panel) {
    c.fillStyle = 'rgba(18,14,26,0.94)'; roundRect(c, 0, 0, W, H, 36); c.fill();
    c.lineWidth = 6; c.strokeStyle = '#e2b85c'; roundRect(c, 6, 6, W - 12, H - 12, 32); c.stroke();
    c.textBaseline = 'middle';
    c.fillStyle = '#e2b85c'; c.font = `120px ${FONTS.brush}`; c.textAlign = 'left'; c.fillText('城', 40, 92);
    c.font = `700 64px ${FONTS.latin}`; c.fillText('Tabletop Siege', 180, 76);
    c.font = `26px ${FONTS.sans}`; c.fillStyle = '#a8a0c0';
    if (S.mode === 'menu') {
      c.fillText('Defend the tiny walled city from the ink spirits.', 182, 128);
      for (let i = 0; i < MAPS.length; i++) {
        const m = MAPS[i], x = 50 + i * 510, y = 175;
        panel.button('map' + i, x, y, 490, 150, '', () => { if (S.mapIdx !== i) { loadMap(i); } }, { active: S.mapIdx === i, activeBg: '#4a2a5a' });
        c.textAlign = 'left'; c.fillStyle = '#f1e6cf'; c.font = `700 44px ${FONTS.latin}`; c.fillText(`${m.name}`, x + 26, y + 40);
        c.fillStyle = '#e2b85c'; c.font = `40px ${FONTS.brush}`; c.fillText(m.cn, x + 380, y + 40);
        c.fillStyle = '#c8c0d8'; c.font = `22px ${FONTS.sans}`; c.fillText(m.desc, x + 26, y + 86);
        c.fillStyle = '#e2b85c'; c.font = `600 24px ${FONTS.sans}`; c.fillText(`Best: wave ${bestOf(i)}`, x + 26, y + 122);
      }
      panel.button('start', 330, 350, 440, 96, 'Defend the city', startGame, { bg: '#7a1f1a', size: 44 });
      c.textAlign = 'left'; c.fillStyle = '#a8a0c0'; c.font = `22px ${FONTS.sans}`;
      const lines = ['Grip with both hands to move, turn and scale the diorama. Lean in to look closer.',
        'Pick towers from the tray at the table edge and drop them on glowing pads.',
        'Swipe fast over the road to flick spirits. A button arms the ink brush.'];
      lines.forEach((l, i) => c.fillText(l, 50, 490 + i * 34));
      return;
    }
    if (S.mode === 'end') {
      c.textAlign = 'center'; c.fillStyle = S.result === 'win' ? '#ffe08a' : '#ff7a6a';
      c.font = `700 80px ${FONTS.latin}`; c.fillText(S.result === 'win' ? 'Victory!' : 'The walls have fallen', W / 2, 200);
      c.fillStyle = '#f1e6cf'; c.font = `30px ${FONTS.sans}`;
      const reached = S.result === 'win' ? S.wave : S.wave - 1;
      c.fillText(`${MAPS[S.mapIdx].name}: survived ${reached} wave${reached === 1 ? '' : 's'} · ${S.kills} spirits inked`, W / 2, 275);
      c.fillStyle = '#e2b85c'; c.fillText(S.newBest ? 'New best!' : `Best: wave ${bestOf(S.mapIdx)}`, W / 2, 320);
      let x = 90;
      if (S.result === 'win') { panel.button('endless', x, 400, 300, 100, 'Endless mode', () => { S.mode = 'play'; S.endless = true; S.phase = 'build'; S.countdown = 15; S.result = ''; flash('Endless: how long can the walls hold?'); }, { bg: '#2a5a3a' }); x += 330; }
      else x += 165;
      panel.button('retry', x, 400, 280, 100, 'Retry', startGame, { bg: '#7a1f1a' }); x += 310;
      panel.button('menu', x, 400, 280, 100, 'Maps', toMenu);
      return;
    }
    // play
    c.textAlign = 'left';
    c.fillText(`${MAPS[S.mapIdx].name}${S.endless ? ' · endless' : ''}`, 182, 128);
    const stat = (label, val, x, col) => { c.fillStyle = '#a8a0c0'; c.font = `24px ${FONTS.sans}`; c.fillText(label, x, 178); c.fillStyle = col; c.font = `800 52px ${FONTS.sans}`; c.fillText(val, x, 222); };
    stat('Gold', `${Math.floor(S.gold)}`, 50, '#e2b85c');
    stat('Walls', `${S.lives}/${S.maxLives}`, 300, S.lives <= 5 ? '#ff6a5a' : '#9fe0a0');
    stat('Wave', `${S.wave}${S.endless ? '' : ' / ' + WAVES_TO_WIN}`, 560, '#f1e6cf');
    stat('Kills', `${S.kills}`, 860, '#c8c0d8');
    c.fillStyle = '#f1e6cf'; c.font = `24px ${FONTS.sans}`;
    let info;
    if (S.phase === 'wave') info = `Spirits remaining: ${aliveCount + (S.spawnList.length - S.spawnI)}`;
    else if (S.phase === 'build') info = `Next wave in ${Math.ceil(S.countdown)}s: ${waveLabel(S.wave + 1)}`;
    else info = `Wave 1: ${waveLabel(1)}`;
    c.fillText(info.length > 80 ? info.slice(0, 78) + '…' : info, 50, 272);
    const by = 305, bh = 86;
    if (S.phase !== 'wave') panel.button('wave', 40, by, 330, bh, S.phase === 'idle' ? 'Start wave 1' : `Call wave (+${Math.max(0, Math.floor(S.countdown) * 2)}g)`, startWave, { bg: '#7a1f1a' });
    else panel.button('wave', 40, by, 330, bh, 'Wave in progress', null, { enabled: false });
    panel.button('speed', 390, by, 200, bh, S.speed === 2 ? 'Speed 2x' : 'Speed 1x', () => { S.speed = S.speed === 1 ? 2 : 1; }, { active: S.speed === 2, activeBg: '#2a5a7a' });
    panel.button('pause', 610, by, 200, bh, S.paused ? 'Resume' : 'Pause', () => { S.paused = !S.paused; }, { active: S.paused, activeBg: '#5a4a1a' });
    panel.button('shrink', 830, by, 230, bh, shrink.on ? 'Return' : 'Shrink in', () => { shrink.on ? exitShrink() : enterShrink(); }, { bg: '#3a2a5a' });
    const by2 = by + bh + 18;
    panel.button('brush', 40, by2, 330, bh, S.brushCd > 0 ? `Ink brush ${Math.ceil(S.brushCd)}s` : S.brushArmed ? 'Brush armed: draw!' : 'Ink brush (A / E)', () => { if (S.brushCd <= 0) S.brushArmed = !S.brushArmed; }, { active: S.brushArmed, activeBg: '#1a1a2a', enabled: S.brushCd <= 0 });
    panel.button('flick', 390, by2, 420, bh, S.flickCd > 0 ? `Flick recharging ${Math.ceil(S.flickCd)}s` : 'Flick ready: swipe the road', null, { enabled: false });
    panel.button('reset', 830, by2, 230, bh, 'Reset table', resetBoard);
    c.textAlign = 'left'; c.font = `24px ${FONTS.sans}`;
    c.fillStyle = S.msgT > 0 ? '#ffe08a' : '#7a7290';
    c.fillText(S.msgT > 0 ? S.msg : 'Grip both hands: move/turn/scale board · Trigger on a tower: upgrade/sell', 50, by2 + bh + 40);
    panel.button('quit', W - 200, 36, 160, 64, 'Maps', toMenu, { size: 26 });
  }
  function drawTowerPanel(c, W, H, panel) {
    const tw = selected; if (!tw) return;
    const def = TOWERS[tw.type], L = tw.level;
    c.fillStyle = 'rgba(18,14,26,0.95)'; roundRect(c, 0, 0, W, H, 30); c.fill();
    c.lineWidth = 5; c.strokeStyle = def.color; roundRect(c, 5, 5, W - 10, H - 10, 26); c.stroke();
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#f1e6cf'; c.font = `700 44px ${FONTS.latin}`; c.fillText(def.name, 30, 50);
    c.font = `700 34px ${FONTS.sans}`; c.textAlign = 'right';
    for (let i = 0; i < 3; i++) { c.fillStyle = i <= L ? '#ffd040' : '#4a4458'; c.fillText('★', W - 30 - (2 - i) * 38, 50); }
    c.textAlign = 'left'; c.font = `24px ${FONTS.sans}`; c.fillStyle = '#c8c0d8';
    const nx = Math.min(2, L + 1);
    const fmt = (arr, suf = '') => L < 2 ? `${arr[L]}${suf} → ${arr[nx]}${suf}` : `${arr[L]}${suf}`;
    let lines;
    if (tw.type === 'monk') lines = [`Mends 1 wall every ${fmt(def.heal, 's')}`, `Speeds towers in ${fmt(def.range)} by ${fmt(def.aura.map(a => Math.round(a * 100)), '%')}`];
    else if (tw.type === 'bell') lines = [`Slow ${fmt(def.slow.map(a => Math.round(a * 100)), '%')} · dmg ${fmt(def.dmg)}`, `Range ${fmt(def.range)} · tolls ${fmt(def.rate, '/s')}`];
    else lines = [`Damage ${fmt(def.dmg)}${def.splash ? ` · splash ${def.splash[L]}` : ''}${def.shots && def.shots[nx] > 1 ? ` · ${def.shots[L]}→${def.shots[nx]} shots` : ''}`, `Range ${fmt(def.range)} · rate ${fmt(def.rate, '/s')}${tw.buff ? ` (+${Math.round(tw.buff * 100)}%)` : ''}`];
    lines.forEach((l, i) => c.fillText(l, 30, 100 + i * 34));
    const upCost = L < 2 ? def.up[L] : 0;
    panel.button('up', 24, 178, 340, 84, L < 2 ? `Upgrade ${upCost}g` : 'Max level', () => { upgradeTower(tw); towerPanel.markDirty(); }, { enabled: L < 2 && S.gold >= upCost, bg: '#2a5a3a' });
    panel.button('sell', 384, 178, 340, 84, `Sell +${Math.floor(tw.spent * 0.7)}g`, () => sellTower(tw), { bg: '#5a2a1a' });
    if (tw.type !== 'monk' && tw.type !== 'bell') {
      for (let i = 0; i < 3; i++) panel.button('mode' + i, 24 + i * 180, 278, 166, 70, TARGET_MODES[i], () => { tw.mode = i; tw.target = null; }, { active: tw.mode === i, activeBg: '#4a3a6a', size: 28 });
    }
    panel.button('close', 584, 278, 140, 70, 'Close', () => selectTower(null), { size: 28 });
  }
  function drawWrist(c, W, H, panel) {
    c.fillStyle = 'rgba(18,14,26,0.92)'; roundRect(c, 0, 0, W, H, 24); c.fill();
    c.fillStyle = '#e2b85c'; c.font = `700 34px ${FONTS.sans}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`${Math.floor(S.gold)}g · ${S.lives} walls · W${S.wave}`, W / 2, 50);
    panel.button('ret', 40, 110, W - 80, 140, 'Return to table', exitShrink, { bg: '#3a2a5a', size: 40 });
  }

  // ── Input handling ────────────────────────────────────────
  let frameNo = 0;
  const handsArr = [input.main, input.off];
  const digitCodes = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
  function nearSlot(pos) {
    let best = null, bd = 0.075;
    for (const s of slots) { const d = s.world.distanceTo(pos); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  function raySlot(origin, dir) {
    for (const s of slots) {
      _v4.copy(s.world).sub(origin); const t = _v4.dot(dir); if (t < 0) continue;
      _v4.copy(origin).addScaledVector(dir, t); if (_v4.distanceTo(s.world) < 0.045) return s;
    }
    return null;
  }

  function handleInput(dt) {
    frameNo++;
    const xr = ctx.isXR(), desk = input.desktop;
    const main = input.main;
    // Panels: laser on the main hand / crosshair
    const hit = pointer.update(main, { show: !desk });
    let mainConsumed = false;
    if (hit) { if (main.triggerDown) { pointer.click(hit); mainConsumed = true; } else if (main.trigger > 0.5 || main.squeezeDown) mainConsumed = true; }

    // Keyboard shortcuts (desktop)
    if (desk) {
      if (S.mode === 'menu') {
        for (let i = 0; i < MAPS.length; i++) if (input.keyDown(digitCodes[i])) loadMap(i);
        if (input.keyDown('Enter') || input.keyDown('KeyN')) startGame();
      } else if (S.mode === 'play') {
        for (let i = 0; i < 5; i++) if (input.keyDown(digitCodes[i]) && !shrink.on) startHold(TOWER_KEYS[i], null, 'click');
        if (input.keyDown('KeyN') || input.keyDown('Enter')) startWave();
        if (input.keyDown('KeyT')) S.speed = S.speed === 1 ? 2 : 1;
        if (input.keyDown('KeyP') || input.keyDown('Space')) S.paused = !S.paused;
        if (input.keyDown('Escape')) { cancelHold(); selectTower(null); S.brushArmed = false; }
        if (input.keyDown('KeyU') && selected) upgradeTower(selected);
        if (input.keyDown('KeyG') && !shrink.on) {
          toLocalRay(main.rayPos, _v2.set(0, 0, -1).applyQuaternion(main.rayQuat));
          if (marchTerrain(hitP)) { if (!flickAt(hitP.x, hitP.z, rayD.x, rayD.z, 9) && S.flickCd <= 0) flash('Nothing to flick there', 1.2); }
        }
      } else if (S.mode === 'end') {
        if (input.keyDown('Enter') || input.keyDown('KeyN')) startGame();
      }
      if (input.keyDown('KeyH') && S.mode === 'play') shrink.on ? exitShrink() : enterShrink();
      if (input.mouse.wheel && !shrink.on) zoomBoard(Math.pow(1.1, -input.mouse.wheel));
    }
    if (main.a && S.mode === 'play' && !shrink.on) { if (S.brushCd <= 0) { S.brushArmed = !S.brushArmed; flash(S.brushArmed ? 'Brush armed: hold trigger and paint the road' : 'Brush put away', 2); } else flash(`Ink brush recharging (${Math.ceil(S.brushCd)}s)`, 1.5); }
    if (shrink.on) {
      if (main.b) exitShrink();
      updateShrink(dt);
      if (!desk) return;
    }

    // Main stick (desktop: arrow keys) rotates / scales the board
    if (!shrink.on && !grab.hands.length) {
      const [sx, sy] = main.axes;
      if (Math.abs(sx) > 0.2) { board.yaw -= sx * 1.2 * dt; applyBoard(); }
      if (Math.abs(sy) > 0.3) zoomBoard(Math.exp(-sy * 0.8 * dt));
    }

    // Per-hand world interactions
    for (let hi = 0; hi < 2; hi++) {
      const h = handsArr[hi]; if (!h.present) continue;
      const isMain = h === main;
      const tip = fingertip(h, tipW[hi]);
      tipL[hi].copy(tip).applyMatrix4(invRoot);
      const consumed = isMain && mainConsumed;

      // Holding a tower: release / click to place
      if (hold && (hold.hand === h || (!hold.hand && isMain))) {
        if (hold.button === 'click') {
          if (h.triggerDown && hold.frame !== frameNo && !consumed) tryPlaceHeld();
          else if (h.squeezeDown) cancelHold();
        } else if ((hold.button === 'trigger' && h.triggerUp) || (hold.button === 'squeeze' && h.squeezeUp)) tryPlaceHeld();
        continue;
      }
      // Brush painting
      if (brush.drawing && brush.hand === h) {
        if (h.trigger < 0.3) brushEnd();
        else if (desk) { toLocalRay(h.rayPos, _v2.set(0, 0, -1).applyQuaternion(h.rayQuat)); if (marchTerrain(hitP)) brushAdd(hitP.x, hitP.z); }
        else if (Math.abs(tipL[hi].x) < BX && Math.abs(tipL[hi].z) < BZ && tipL[hi].y - world.height(tipL[hi].x, tipL[hi].z) < 4) brushAdd(tipL[hi].x, tipL[hi].z);
        continue;
      }
      if (consumed) continue;
      const tDown = h.triggerDown, gDown = h.squeezeDown;
      if (tDown || gDown) {
        if (S.mode === 'play' && !shrink.on) {
          // 1) tray
          const slot = desk ? (isMain ? raySlot(h.rayPos, _v2.set(0, 0, -1).applyQuaternion(h.rayQuat)) : null) : nearSlot(tip);
          if (slot) { startHold(slot.type, desk ? null : h, desk ? 'click' : (tDown ? 'trigger' : 'squeeze')); h.haptic(0.3, 30); continue; }
          // 2) brush
          if (tDown && S.brushArmed && isMain) {
            brushStart(h);
            if (desk) { toLocalRay(h.rayPos, _v2.set(0, 0, -1).applyQuaternion(h.rayQuat)); if (marchTerrain(hitP)) brushAdd(hitP.x, hitP.z); }
            else brushAdd(tipL[hi].x, tipL[hi].z);
            continue;
          }
          // 3) towers: hand touch (VR) or ray
          let tw = null;
          if (!desk) for (const t of towers) if (Math.hypot(t.pad.x - tipL[hi].x, t.pad.z - tipL[hi].z) < 0.7 && tipL[hi].y - t.pad.y < t.top + 0.4 && tipL[hi].y > t.pad.y - 0.3) { tw = t; break; }
          if (!tw && (tDown || desk) && (isMain || !desk)) { toLocalRay(h.rayPos, _v2.set(0, 0, -1).applyQuaternion(h.rayQuat)); tw = rayTower(); }
          if (tw) { selectTower(tw === selected ? null : tw); h.haptic(0.25, 25); continue; }
          if (tDown && selected) { selectTower(null); continue; }
        }
        // 4) grab the board (VR squeeze)
        if (gDown && !desk && !shrink.on) { grab.hands.push(h); grabInit(); h.haptic(0.2, 30); }
      }
      if (h.squeezeUp && grab.hands.includes(h)) { grab.hands.splice(grab.hands.indexOf(h), 1); grabInit(); }
      // Hand of god: fast swipe near the board surface
      if (!desk && !shrink.on && S.flickCd <= 0 && !grab.hands.includes(h) && h.velocity.length() > 1.3) {
        const tl = tipL[hi];
        if (Math.abs(tl.x) < BX && Math.abs(tl.z) < BZ && tl.y - Math.max(0, world.height(tl.x, tl.z)) < 1.0) {
          _v1.copy(h.velocity).transformDirection(invRoot);
          if (flickAt(tl.x, tl.z, _v1.x, _v1.z, Math.min(12, 4 + h.velocity.length() * 3))) h.haptic(0.8, 80);
        }
      }
    }
    if (grab.hands.length) { for (const h of grab.hands) if (!h.present || h.squeeze < 0.3) { grab.hands.length = 0; break; } grabUpdate(); }
  }

  function updateHands(dt) {
    const xr = ctx.isXR();
    for (let i = 0; i < 2; i++) {
      const h = handsArr[i], m = handMarks[i];
      m.visible = xr && h.present && !shrink.on;
      if (m.visible) { m.position.copy(tipW[i]); m.material.color.set(grab.hands.includes(h) ? 0x9fe0ff : 0xffe0a0); }
    }
    // brush tip indicator on the main hand
    const showBrush = S.brushArmed || (brush.drawing);
    brushTip.visible = showBrush && !shrink.on;
    if (brushTip.visible) {
      if (input.desktop) {
        toLocalRay(input.main.rayPos, _v2.set(0, 0, -1).applyQuaternion(input.main.rayQuat));
        if (marchTerrain(hitP)) { brushTip.position.copy(hitP).applyMatrix4(root.matrixWorld); brushTip.scale.setScalar(Math.max(0.6, board.s * 12)); brushTip.quaternion.identity(); }
        else brushTip.visible = false;
      } else { brushTip.position.copy(tipW[0]); brushTip.quaternion.copy(input.main.gripQuat); brushTip.scale.setScalar(1); }
    }
    // tray hover
    const deskSlot = input.desktop && S.mode === 'play' && !shrink.on ? raySlot(input.main.rayPos, _v2.set(0, 0, -1).applyQuaternion(input.main.rayQuat)) : null;
    for (const s of slots) {
      let near = false;
      if (S.mode === 'play' && !shrink.on) {
        if (input.desktop) near = deskSlot === s;
        else near = (input.main.present && s.world.distanceTo(tipW[0]) < 0.075) || (input.off.present && s.world.distanceTo(tipW[1]) < 0.075);
      }
      s.hover += ((near || (hold && hold.type === s.type) ? 1 : 0) - s.hover) * Math.min(1, dt * 10);
      s.mini.scale.setScalar(TRAY_S * (1 + s.hover * 0.25));
      s.mini.rotation.y += dt * (0.2 + s.hover * 2);
      s.mini.visible = !(hold && hold.type === s.type && ghost.visible && !input.desktop && hold.hand);
    }
  }

  function placeTowerPanel() {
    if (!selected) { if (!hold) rangeRing.visible = false; return; }
    const tw = selected, def = TOWERS[tw.type];
    _v1.set(tw.pad.x, tw.pad.y + tw.top + 0.4, tw.pad.z).applyMatrix4(root.matrixWorld);
    // float above the tower, nudged toward the viewer
    _v2.copy(input.head.pos).sub(_v1); const dist = _v2.length(); _v2.normalize();
    towerPanel.mesh.position.copy(_v1).addScaledVector(_v2, Math.min(0.15, dist * 0.3)).add(_v3.set(0, 0.14, 0));
    towerPanel.mesh.lookAt(input.head.pos);
    const sc = shrink.on ? shrink.k * 3 : Math.min(1.2, Math.max(0.6, dist / 0.9));
    towerPanel.mesh.scale.setScalar(sc);
    rangeRing.visible = true;
    rangeRing.position.set(tw.pad.x, tw.pad.y + 0.08, tw.pad.z); rangeRing.scale.setScalar(def.range[tw.level]);
    rangeRing.material.color.set(tw.type === 'monk' ? 0xa0ffb0 : 0xfff0b0); rangeDisc.material.color.copy(rangeRing.material.color);
  }

  // ── HUD (desktop) ─────────────────────────────────────────
  let hudT = 0, boardT = 0, lastKey = '';
  function updateHud(dt) {
    hudT -= dt; boardT -= dt;
    if (boardT <= 0) {
      boardT = 0.25;
      const key = `${S.mode}|${Math.floor(S.gold)}|${S.lives}|${S.wave}|${S.phase}|${Math.ceil(S.countdown)}|${S.speed}|${S.paused}|${Math.ceil(S.flickCd)}|${Math.ceil(S.brushCd)}|${S.brushArmed}|${S.msgT > 0 ? S.msg : ''}|${aliveCount}|${S.spawnI}|${S.kills}|${S.mapIdx}|${shrink.on}`;
      if (key !== lastKey) { lastKey = key; boardPanel.markDirty(); trayLabel.markDirty(); if (selected) towerPanel.markDirty(); wristPanel.markDirty(); }
      trayLabel.redraw();
    }
    if (hudT > 0) return;
    hudT = 0.25;
    if (S.mode === 'menu') ctx.setHud(`<b>Tabletop Siege</b> · 1/2 choose map (${MAPS[S.mapIdx].name}) · Enter start · wheel zoom · ←→ rotate`);
    else if (S.mode === 'end') ctx.setHud(`${S.result === 'win' ? 'Victory!' : 'Defeat'} · wave ${S.wave} · Enter retry`);
    else ctx.setHud(`Gold <b>${Math.floor(S.gold)}</b> · Walls <b>${S.lives}</b> · Wave <b>${S.wave}</b>${S.phase === 'build' ? ` (next ${Math.ceil(S.countdown)}s)` : ''}${S.paused ? ' · PAUSED' : ''}${S.speed === 2 ? ' · 2x' : ''} · 1-5 tower · LMB place · RMB tower · N wave · T speed · P pause · E brush · G flick${S.flickCd > 0 ? ` (${Math.ceil(S.flickCd)})` : ''} · H shrink · wheel/←→ board`);
  }

  // ── Boot ──────────────────────────────────────────────────
  loadMap(S.mapIdx);
  input.pitch = -0.62;

  // Debug / test hook
  const debug = {
    get S() { return S; }, get towers() { return towers; }, get enemies() { return enemies.filter(e => e.alive); }, get pads() { return world.pads; }, get graph() { return world.graph; },
    get board() { return board; }, get shrink() { return shrink.on; }, get hold() { return hold; }, get selected() { return selected; },
    startGame, startWave, loadMap, toMenu, enterShrink, exitShrink, resetBoard, zoomBoard,
    place(type, padIdx, free = false) { return !!placeTower(type, world.pads[padIdx], free); },
    upgrade(i) { return upgradeTower(towers[i]); }, sell(i) { return sellTower(towers[i]); }, select(i) { selectTower(towers[i] ?? null); },
    setGold(g) { S.gold = g; }, setLives(l) { S.lives = l; if (l <= 0) endGame(false); },
    killAll() { for (const e of enemies) if (e.alive) kill(e); },
    skipTo(w) { for (const e of enemies) if (e.alive) { e.alive = false; } aliveCount = 0; S.wave = w - 1; S.phase = 'build'; S.countdown = 0.01; S.spawnList = null; },
    win() { S.wave = WAVES_TO_WIN; S.phase = 'wave'; S.spawnList = []; S.spawnI = 0; for (const e of enemies) e.alive = false; aliveCount = 0; },
    simulate(sec, step = 1 / 30) { const n = Math.ceil(sec / step); for (let i = 0; i < n; i++) sim(step); renderEnemies(S.time); renderProjectiles(S.time); fx.update(step); return { wave: S.wave, alive: aliveCount, gold: S.gold, lives: S.lives, mode: S.mode, kills: S.kills }; },
    flick(x, z, dx = 0, dz = -1) { S.flickCd = 0; return flickAt(x, z, dx, dz, 9); },
    brushLine(pts) { S.brushCd = 0; brushStart(null); for (const [x, z] of pts) brushAdd(x, z); brushEnd(); return brush.n; },
    drawCalls: () => ctx.renderer.info.render.calls,
    focus(x, z, s = 0.15, wx = 0, wy = 1.0, wz = -0.75) { board.s = s; board.yaw = 0; const y = world.height(x, z); board.pos.set(wx - x * s, wy - y * s, wz - z * s); applyBoard(); },
  };
  window.__siege = debug;

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    update(dt, time) {
      handleInput(dt);
      const gdt = S.paused ? 0 : dt * S.speed;
      if (gdt > 0) { const n = Math.ceil(gdt / 0.034); for (let i = 0; i < n; i++) sim(gdt / n); }
      if (S.msgT > 0) S.msgT -= dt;
      updateHold();
      if (life) life.update(dt, time);
      for (let i = 0; i < portals.length; i++) { portals[i].rotation.y = time * 1.5 + i; portals[i].scale.setScalar(1 + Math.sin(time * 3 + i) * 0.06); }
      renderEnemies(time);
      renderProjectiles(time);
      renderTowers(time, gdt);
      fx.update(gdt > 0 ? gdt : 0);
      placeTowerPanel();
      updateHands(dt);
      updateHud(dt);
      sfx.listener(input.head);
    },
    onXRStart() { if (shrink.on) exitShrink(); },
    onXREnd() { if (shrink.on) exitShrink(); grab.hands.length = 0; },
    dispose() {
      if (shrink.on) exitShrink();
      if (window.__siege === debug) delete window.__siege;
      if (world) world.dispose(); if (life) life.dispose();
      disposeTowerCache();
      ctx.setHud('');
    },
  };
}
