import * as THREE from 'three';
import { Panel, Pointer, FONTS, roundRect, fitText, rotateRigAround } from '../../src/platform/kit.js';
import { AREAS, COLORS, NCOL, mixColor, buildGarden, lanternGeometry, lanternCapGeometry, koiGeometry, toWorld, mulberry, MOON_DIR } from './garden.js';
import { GlowBatch, makeAmbientFlies, makeStars } from './glow.js';
import { Hands } from './hands.js';
import { GardenAudio } from './sound.js';

// Firefly Garden: catch fireflies with your hands and guide them into paper lanterns.
// Hand tracking: pinch, cupped hands, open-palm release, point to call, fist to squeeze orbs.
// Controllers / desktop drive a stylised hand posed by trigger and grip.

const FREE = 0, CARRIED = 1, GUIDED = 2, LANTERN = 3, HIDDEN = 4;
const SAVE_KEY = 'fireflies:progress';

export async function create(ctx) {
  const { scene, input, rig } = ctx;
  scene.background = new THREE.Color(0x090c1a);
  scene.fog = new THREE.FogExp2(0x141a30, 0.03);
  scene.add(new THREE.HemisphereLight(0x6a7ab8, 0x22222c, 1.15));
  const moon = new THREE.DirectionalLight(0xbfd0ff, 0.75);
  moon.position.copy(MOON_DIR).multiplyScalar(30); scene.add(moon, moon.target);
  const areaLight = new THREE.PointLight(0xffb060, 0.3, 7, 1.6);
  scene.add(areaLight);

  const garden = buildGarden(scene);
  const rand = mulberry(1234);

  // ── save data ──────────────────────────────────────────────
  const fresh = () => ({ v: 1, unlocked: 1, area: 0, music: true, lit: AREAS.map(a => a.lanterns.map(() => false)) });
  let save = ctx.load(SAVE_KEY, null);
  if (!save || save.v !== 1 || !Array.isArray(save.lit) || save.lit.length !== AREAS.length) save = fresh();
  save.unlocked = Math.max(1, Math.min(AREAS.length, save.unlocked | 0));
  save.area = Math.max(0, Math.min(save.unlocked - 1, save.area | 0));
  const persist = () => ctx.save(SAVE_KEY, save);

  // ── lanterns ───────────────────────────────────────────────
  const lanterns = garden.lanternDefs.map((d, i) => ({
    ...d, idx: i, fill: new Uint8Array(NCOL), lit: false, litT: 99, pulse: 0, shake: 0,
    color: mixColor(d.need, 0, [0, 0, 0]), slot: d.area, local: 0,
  }));
  { const cnt = AREAS.map(() => 0); for (const L of lanterns) L.local = cnt[L.area]++; }
  const LANT_UNLIT = new THREE.Color(0.07, 0.018, 0.012);
  const lanternBody = new THREE.InstancedMesh(lanternGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), lanterns.length);
  const lanternCaps = new THREE.InstancedMesh(lanternCapGeometry(), new THREE.MeshLambertMaterial({ color: 0x3a1a12 }), lanterns.length);
  lanternBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage); lanternCaps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(lanternBody, lanternCaps);

  const applySaveToLanterns = () => {
    for (const L of lanterns) {
      L.fill.fill(0); L.lit = false; L.litT = 99; L.pulse = 0;
      if (save.lit[L.area]?.[L.local]) { for (let k = 0; k < NCOL; k++) L.fill[k] = L.need[k]; L.lit = true; }
    }
  };
  applySaveToLanterns();

  // ── fireflies ──────────────────────────────────────────────
  const specs = [];
  AREAS.forEach((a, ai) => { for (const [c, type, n] of a.flies) for (let k = 0; k < n; k++) specs.push({ ai, c, type }); });
  const N = specs.length;
  const P = new Float32Array(N * 3), V = new Float32Array(N * 3), HOME = new Float32Array(N * 3);
  const COMP = new Uint8Array(N * NCOL), RGB = new Float32Array(N * 3);
  const fCol = new Uint8Array(N), fType = new Uint8Array(N), fArea = new Uint8Array(N), fState = new Uint8Array(N);
  const fOwner = new Int8Array(N), fTarget = new Int16Array(N), fTimer = new Float32Array(N), fPhase = new Float32Array(N);
  const fOrb = new Uint8Array(N), fLand = new Int8Array(N), fFade = new Float32Array(N), fFlash = new Float32Array(N);
  const _w = new THREE.Vector3();
  specs.forEach((s, i) => {
    const a = AREAS[s.ai];
    const [r0, r1, y0, y1] = s.type === 2 ? [1.6, 2.6, 1.0, 2.1] : s.type === 1 ? [0.9, 2.0, 0.9, 1.9] : [0.45, 1.45, 0.8, 1.8];
    const th = (rand() - 0.5) * Math.PI * 1.35, rr = r0 + rand() * (r1 - r0);
    toWorld(a, Math.sin(th) * rr, y0 + rand() * (y1 - y0), -Math.cos(th) * rr, _w);
    HOME[i * 3] = _w.x; HOME[i * 3 + 1] = _w.y; HOME[i * 3 + 2] = _w.z;
    P[i * 3] = _w.x; P[i * 3 + 1] = _w.y; P[i * 3 + 2] = _w.z;
    fCol[i] = s.c; fType[i] = s.type; fArea[i] = s.ai; fPhase[i] = rand() * 100; fFade[i] = 1;
    COMP[i * NCOL + s.c] = 1; mixColor(COMP, i * NCOL, RGB, i * 3);
  });
  const resetFly = (i, spread = 0.2) => {
    fState[i] = FREE; fOrb[i] = 0; fLand[i] = 0; fOwner[i] = -1; fTarget[i] = -1; fTimer[i] = 0; fFade[i] = 0;
    for (let k = 0; k < NCOL; k++) COMP[i * NCOL + k] = 0;
    COMP[i * NCOL + fCol[i]] = 1; mixColor(COMP, i * NCOL, RGB, i * 3);
    for (let e = 0; e < 3; e++) { P[i * 3 + e] = HOME[i * 3 + e] + (rand() - 0.5) * spread; V[i * 3 + e] = 0; }
  };
  for (let i = 0; i < N; i++) { fOwner[i] = -1; fTarget[i] = -1; }
  const unlockedArea = (ai) => ai < save.unlocked;

  // ── visuals: glow batches, ambient, stars ─────────────────
  const flyGlow = new GlowBatch(N + 8, { core: 1.0, halo: 0.55, renderOrder: 6 });
  const fxGlow = new GlowBatch(320, { core: 0.5, halo: 0.7, renderOrder: 7 });
  scene.add(flyGlow.mesh, fxGlow.mesh);
  const ambient = makeAmbientFlies(900, [[0, 0, -15, 30, 3.5, 40]], rand);
  const stars = makeStars(900, rand);
  scene.add(ambient, stars);

  // ── hands ─────────────────────────────────────────────────
  const hands = new Hands(scene);
  const HL = hands.L, HR = hands.R;
  const handOf = (side) => side === 'left' ? HL : HR;
  const handIdx = (h) => h === HL ? 0 : 1;
  const pinched = [-1, -1];
  const carryCount = [0, 0], carryTotal = [0, 0], carryOrb = [0, 0];
  const fistT = [0, 0], feedT = [0, 0], landCd = [0, 0];
  let blowCd = 0;

  // ── fish + ripples ────────────────────────────────────────
  const fish = [];
  AREAS.forEach((a, ai) => {
    if (!a.fish) return;
    const pond = garden.ponds.find(p => p.area === ai);
    for (let k = 0; k < a.fish; k++) fish.push({
      pond, ang: rand() * 6.28, rad: 0.35 + rand() * 0.45, spd: (0.12 + rand() * 0.12) * (rand() < 0.5 ? -1 : 1),
      jumping: false, jt: 0, sx: 0, sz: 0, tx: 0, ty: 0, tz: 0, cd: 2 + rand() * 4, prey: -1,
      pos: new THREE.Vector3(), q: new THREE.Quaternion(), dir: new THREE.Vector3(0, 0, -1), color: [[1, 0.45, 0.15], [0.95, 0.92, 0.88], [1, 0.75, 0.2], [0.95, 0.3, 0.2]][k % 4],
    });
  });
  const koi = new THREE.InstancedMesh(koiGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a1a0c }), Math.max(1, fish.length));
  koi.instanceMatrix.setUsage(THREE.DynamicDrawUsage); koi.count = fish.length; koi.frustumCulled = false;
  fish.forEach((f, i) => koi.setColorAt(i, new THREE.Color(...f.color)));
  scene.add(koi);
  const RIPPLES = 10;
  const rippleMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.85, 1, 28).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), RIPPLES);
  rippleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); rippleMesh.frustumCulled = false;
  const ripples = Array.from({ length: RIPPLES }, () => ({ x: 0, y: 0, z: 0, t: 9, s: 1 }));
  for (let i = 0; i < RIPPLES; i++) rippleMesh.setColorAt(i, new THREE.Color(0, 0, 0));
  scene.add(rippleMesh);
  let rippleNext = 0;
  const addRipple = (x, y, z, s = 1) => { const r = ripples[rippleNext++ % RIPPLES]; r.x = x; r.y = y + 0.005; r.z = z; r.t = 0; r.s = s; };

  // ── travel disc ───────────────────────────────────────────
  const disc = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 8, 32), new THREE.MeshBasicMaterial({ color: 0xfff2cc, toneMapped: false }));
  disc.visible = false; scene.add(disc);
  let discTarget = -1;

  // ── hint board (one canvas plane, redrawn on change) ──────
  const board = { canvas: document.createElement('canvas'), dirty: true, msg: '', msgT: 0 };
  board.canvas.width = 768; board.canvas.height = 400;
  const boardTex = new THREE.CanvasTexture(board.canvas); boardTex.colorSpace = THREE.SRGBColorSpace;
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.448), new THREE.MeshBasicMaterial({ map: boardTex, transparent: true, toneMapped: false, depthWrite: false }));
  scene.add(boardMesh);
  let curArea = save.area;
  const litN = new Int32Array(AREAS.length), litTot = new Int32Array(AREAS.length);
  for (const L of lanterns) litTot[L.area]++;
  const countLit = () => { litN.fill(0); for (const L of lanterns) if (L.lit) litN[L.area]++; };
  const areaDone = (ai) => litN[ai] === litTot[ai];
  const usingHands = () => HL.mode === 'tracked' || HR.mode === 'tracked';
  function drawBoard() {
    const c = board.canvas.getContext('2d'), W = 768, H = 400, a = AREAS[curArea];
    c.clearRect(0, 0, W, H);
    roundRect(c, 6, 6, W - 12, H - 12, 28); c.fillStyle = 'rgba(14,16,30,0.78)'; c.fill();
    c.lineWidth = 3; c.strokeStyle = 'rgba(226,184,92,0.7)'; c.stroke();
    c.fillStyle = '#e2b85c'; c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    c.font = `72px ${FONTS.brush}`; c.fillText(a.zh, 32, 92);
    c.fillStyle = '#f1e6cf'; c.font = `44px ${FONTS.latin}`; c.fillText(a.name, 190, 84);
    const n = litN[curArea], t = litTot[curArea];
    c.textAlign = 'right'; c.font = `30px ${FONTS.sans}`; c.fillStyle = n === t ? '#b8f08a' : '#cfc6b0';
    c.fillText(unlockedArea(curArea) ? `${n} / ${t} lit` : 'locked', W - 32, 80);
    c.textAlign = 'left'; c.fillStyle = '#e8e0cc'; c.font = `29px ${FONTS.sans}`;
    let y = 150;
    if (!unlockedArea(curArea)) { c.fillText('Light every lantern in the earlier', 32, y); c.fillText('gardens to wake the fireflies here.', 32, y + 40); }
    else {
      for (const line of a.hint) { fitText(c, line, 32, y, W - 64, 29, FONTS.sans); y += 40; }
      if (!usingHands()) { c.fillStyle = '#a9b4cc'; fitText(c, input.desktop ? 'Desktop: LMB catch · RMB release at a lantern · E call · G squeeze' : a.hintCtl, 32, y + 8, W - 64, 24, FONTS.sans); }
    }
    if (board.msg) {
      roundRect(c, 24, H - 84, W - 48, 60, 18); c.fillStyle = 'rgba(226,184,92,0.18)'; c.fill();
      c.fillStyle = '#ffe9a8'; c.textAlign = 'center'; fitText(c, board.msg, W / 2, H - 43, W - 80, 30, FONTS.sans);
    }
    boardTex.needsUpdate = true;
  }
  function placeBoard() {
    const an = garden.hintAnchors[curArea];
    boardMesh.position.copy(an.pos); boardMesh.rotation.set(0, an.yaw, 0);
    board.dirty = true;
  }
  const say = (msg, dur = 6) => { board.msg = msg; board.msgT = dur; board.dirty = true; toast = msg; toastT = dur; };
  let toast = '', toastT = 0;

  // ── audio ─────────────────────────────────────────────────
  const sound = new GardenAudio(ctx.audio);
  sound.music = save.music !== false;

  // ── wrist / floating menu ─────────────────────────────────
  let resetArm = 0;
  const menu = new Panel({
    width: 0.3, height: 0.172, px: 720, draw: (c, W, H, p) => {
      roundRect(c, 4, 4, W - 8, H - 8, 30); c.fillStyle = 'rgba(16,18,34,0.94)'; c.fill();
      c.lineWidth = 4; c.strokeStyle = '#e2b85c'; c.stroke();
      c.fillStyle = '#e2b85c'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `46px ${FONTS.brush}`; c.fillText('萤园 Firefly Garden', W / 2, 52);
      const bw = (W - 60) / 2, bh = 62;
      AREAS.forEach((a, i) => {
        const x = 20 + (i % 2) * (bw + 20), y = 96 + Math.floor(i / 2) * (bh + 12);
        const ok = unlockedArea(i), done = ok && areaDone(i);
        p.button('area' + i, x, y, bw, bh, `${a.zh} ${a.name}${done ? ' ✓' : ok ? '' : ' · locked'}`, () => travel(i), { enabled: ok, active: i === curArea, activeBg: '#5a4a1d', size: 26 });
      });
      const y2 = 96 + 3 * (bh + 12) - 74 + 74, w4 = (W - 40 - 30) / 4;
      if (AREAS.length % 2 === 1) { /* fifth slot already on the left of row three */ }
      const labels = [[`Music ${sound.music ? 'on' : 'off'}`, () => { sound.setMusic(!sound.music); save.music = sound.music; persist(); }],
        [resetArm > 0 ? 'Sure?' : 'Reset', () => { if (resetArm > 0) resetProgress(); else resetArm = 3; }],
        ['Close', () => setMenu(false)], ['Hub', () => ctx.exit()]];
      labels.forEach(([l, fn], i) => p.button('b' + i, 20 + i * (w4 + 10), y2 + 10, w4, 58, l, fn, { size: 24, active: l === 'Sure?' }));
    },
  });
  menu.mesh.visible = false; menu.mesh.renderOrder = 20;
  scene.add(menu.mesh);
  const pointer = new Pointer(scene, 0xffe2a0);
  pointer.panels.push(menu);
  let menuOpen = false, menuMode = 'float', palmUpT = 0, palmDownT = 0, pokeReady = true;
  function setMenu(open, mode = 'float') {
    menuOpen = open; menuMode = mode; menu.mesh.visible = open; menu.markDirty();
    if (open && mode === 'float') {
      const f = _v1.copy(input.head.fwd); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
      menu.mesh.position.copy(input.head.pos).addScaledVector(f, 0.62); menu.mesh.position.y -= 0.12;
      menu.mesh.lookAt(input.head.pos);
    }
  }

  // ── helpers ───────────────────────────────────────────────
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _dir = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _col = new THREE.Color(), _col2 = new THREE.Color();
  const _rgb = [0, 0, 0];
  const haptic = (h, a, ms) => { if (h.mode === 'ctrl') input[h.side].haptic(a, ms); };

  function accepts(L, i) {
    if (L.lit || !unlockedArea(L.area)) return false;
    const ci = i * NCOL;
    let n = 0;
    if (L.orb) {
      if (!fOrb[i]) return false;
      for (let k = 0; k < NCOL; k++) { if (L.fill[k]) return false; if (COMP[ci + k] !== L.need[k]) return false; }
      return true;
    }
    for (let k = 0; k < NCOL; k++) { if (L.fill[k] + COMP[ci + k] > L.need[k]) return false; n += COMP[ci + k]; }
    return n > 0;
  }
  function chooseLantern(i, dir, maxD = 1.8) {
    let best = -1, bs = 1e9;
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    for (const L of lanterns) {
      if (L.lit || !unlockedArea(L.area)) continue;
      const dx = L.pos.x - px, dy = L.pos.y - py, dz = L.pos.z - pz, d = Math.hypot(dx, dy, dz);
      if (d > maxD) continue;
      const along = d > 1e-4 ? (dx * dir.x + dy * dir.y + dz * dir.z) / d : 1;
      const s = d - along * 0.7 + (accepts(L, i) ? 0 : 1.2);
      if (s < bs) { bs = s; best = L.idx; }
    }
    return best;
  }
  function releaseFly(i, dir, speed, lanternIdx = -2) {
    const t = lanternIdx === -2 ? chooseLantern(i, dir) : lanternIdx;
    fOwner[i] = -1; fLand[i] = 0;
    V[i * 3] = dir.x * speed; V[i * 3 + 1] = dir.y * speed; V[i * 3 + 2] = dir.z * speed;
    if (t >= 0) { fState[i] = GUIDED; fTarget[i] = t; fTimer[i] = 7; }
    else { fState[i] = FREE; fTarget[i] = -1; fTimer[i] = 0; }
  }
  function releaseHand(hi, dir, speed, lanternIdx = -2) {
    let n = 0;
    for (let i = 0; i < N; i++) if (fState[i] === CARRIED && fOwner[i] === hi) { releaseFly(i, dir, speed * (0.8 + rand() * 0.4), lanternIdx); n++; }
    if (n) sound.release(hands.list[hi].holdPt);
    pinched[hi] = -1;
    return n;
  }
  function capture(i, hi) {
    fState[i] = CARRIED; fOwner[i] = hi; fLand[i] = 0; fTarget[i] = -1; fFlash[i] = 1;
  }
  function flee(i, fromX, fromY, fromZ, k = 2.5) {
    let dx = P[i * 3] - fromX, dy = P[i * 3 + 1] - fromY, dz = P[i * 3 + 2] - fromZ; const d = Math.hypot(dx, dy, dz) || 1;
    V[i * 3] += dx / d * k; V[i * 3 + 1] += (dy / d + 0.3) * k; V[i * 3 + 2] += dz / d * k;
  }
  // nearest catchable firefly within radius of a point
  function nearestFly(p, radius, includeStill = false) {
    let best = -1, bd = radius * radius;
    for (let i = 0; i < N; i++) {
      const st = fState[i];
      if ((st !== FREE && st !== GUIDED) || !unlockedArea(fArea[i]) || fFade[i] < 0.5) continue;
      if (fType[i] === 2 && !includeStill) continue;
      const dx = P[i * 3] - p.x, dy = P[i * 3 + 1] - p.y, dz = P[i * 3 + 2] - p.z, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  // firefly closest to a ray (angle), for the desktop crosshair
  function rayFly(o, dir, maxAng = 0.075, maxD = 9) {
    let best = -1, ba = maxAng;
    for (let i = 0; i < N; i++) {
      const st = fState[i];
      if ((st !== FREE && st !== GUIDED) || !unlockedArea(fArea[i]) || fFade[i] < 0.5) continue;
      const dx = P[i * 3] - o.x, dy = P[i * 3 + 1] - o.y, dz = P[i * 3 + 2] - o.z, d = Math.hypot(dx, dy, dz);
      if (d > maxD || d < 0.05) continue;
      const a = Math.acos(Math.min(1, (dx * dir.x + dy * dir.y + dz * dir.z) / d));
      if (a < ba) { ba = a; best = i; }
    }
    return best;
  }
  function rayLantern(o, dir, maxAng = 0.16) {
    let best = -1, ba = maxAng;
    for (const L of lanterns) {
      _v3.copy(L.pos).sub(o); const d = _v3.length(); if (d > 12) continue;
      const a = Math.acos(Math.min(1, _v3.dot(dir) / d)) - 0.06 / d;
      if (a < ba) { ba = a; best = L.idx; }
    }
    return best;
  }
  function tryPinch(h) {
    const hi = handIdx(h);
    let i;
    if (input.desktop && h.mode === 'ctrl' && h === handOf(input.main.handedness)) {
      _dir.set(0, 0, -1).applyQuaternion(input.main.rayQuat);
      i = rayFly(input.main.rayPos, _dir);
      if (i < 0) {
        const s = rayFly(input.main.rayPos, _dir, 0.1, 9);
        if (s >= 0 && fType[s] === 2) say('Rose fireflies only come to a still, open hand.', 4);
        return;
      }
      if (fType[i] === 2) { flee(i, input.main.rayPos.x, input.main.rayPos.y, input.main.rayPos.z, 1); say('Rose fireflies only come to a still, open hand.', 4); return; }
    } else {
      i = nearestFly(h.pinchPt, h.mode === 'tracked' ? 0.11 : 0.13);
      if (i < 0) {
        const s = nearestFly(h.pinchPt, 0.2, true);
        if (s >= 0 && fType[s] === 2) { flee(s, h.pinchPt.x, h.pinchPt.y, h.pinchPt.z, 1.2); say('Rose fireflies only come to a still, open hand.', 4); }
        return;
      }
    }
    if (fType[i] === 1 && h.speed > 0.45) { flee(i, h.palm.x, h.palm.y, h.palm.z, 3); return; }
    capture(i, hi);
    if (!(input.desktop && h.mode === 'ctrl' && h.side === input.main.handedness)) pinched[hi] = i;
    sound.grab(h.pinchPt); haptic(h, 0.35, 25);
  }
  function scoop(center, radius, hiA, hiB) {
    let n = 0, alt = 0;
    for (let i = 0; i < N; i++) {
      const st = fState[i];
      if ((st !== FREE && st !== GUIDED) || !unlockedArea(fArea[i]) || fFade[i] < 0.5 || fType[i] === 2) continue;
      const dx = P[i * 3] - center[0], dy = P[i * 3 + 1] - center[1], dz = P[i * 3 + 2] - center[2];
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      if (fType[i] === 1 && Math.max(HL.speed, HR.speed) > 0.5) { flee(i, center[0], center[1], center[2], 3); continue; }
      capture(i, (alt++ & 1) ? hiB : hiA); n++;
    }
    return n;
  }
  function squeezeOrb(hi) {
    let first = -1, total = 0;
    for (let i = 0; i < N; i++) {
      if (fState[i] !== CARRIED || fOwner[i] !== hi) continue;
      if (first < 0) { first = i; for (let k = 0; k < NCOL; k++) total += COMP[i * NCOL + k]; continue; }
      for (let k = 0; k < NCOL; k++) { COMP[first * NCOL + k] += COMP[i * NCOL + k]; total += COMP[i * NCOL + k]; }
      fState[i] = HIDDEN; fTimer[i] = 8 + rand() * 4; fOwner[i] = -1;
    }
    if (first < 0 || total < 2) return false;
    fOrb[first] = 1; fFlash[first] = 1.5; fTimer[first] = 0;
    mixColor(COMP, first * NCOL, RGB, first * 3);
    if (pinched[hi] >= 0 && pinched[hi] !== first) pinched[hi] = -1;
    const h = hands.list[hi];
    sound.squeeze(h.holdPt); haptic(h, 0.8, 120);
    say(`A light orb of ${total}!`, 3);
    return true;
  }
  function enterLantern(i, L) {
    if (!accepts(L, i)) {
      fState[i] = FREE; fTarget[i] = -1;
      _v1.set(P[i * 3] - L.pos.x, 0.3, P[i * 3 + 2] - L.pos.z).normalize();
      V[i * 3] = _v1.x * 1.2; V[i * 3 + 1] = 0.5; V[i * 3 + 2] = _v1.z * 1.2;
      L.shake = 1; sound.reject(L.pos);
      if (L.orb && !fOrb[i]) say('Round lanterns only take a squeezed light orb.', 4);
      else if (L.orb) say('That orb is not the right mix for this lantern.', 4);
      else say('This lantern wants other colours: see its beads.', 3);
      return;
    }
    for (let k = 0; k < NCOL; k++) L.fill[k] += COMP[i * NCOL + k];
    fState[i] = LANTERN; fTarget[i] = L.idx; L.pulse = 1;
    let full = true; for (let k = 0; k < NCOL; k++) if (L.fill[k] < L.need[k]) full = false;
    if (!full) { sound.ding(L.pos, L.fill.reduce((a, b) => a + b, 0)); return; }
    L.lit = true; L.litT = 0; countLit();
    sound.chime(L.pos, L.local * 2);
    save.lit[L.area][L.local] = true;
    if (areaDone(L.area)) {
      if (L.area + 1 < AREAS.length && save.unlocked <= L.area + 1) {
        save.unlocked = L.area + 2;
        say(`The ${AREAS[L.area].name} glows. ${AREAS[L.area + 1].name} awakens: touch the moon ring.`, 10);
      } else if (AREAS.every((_, ai) => areaDone(ai))) {
        say('Every lantern is lit. The whole garden glows. Thank you.', 14);
      } else say(`The ${AREAS[L.area].name} glows.`, 6);
      bloomT = 0; bloomArea = L.area;
      sound.fanfare();
    } else say('A lantern glows.', 2.5);
    persist(); menu.markDirty(); board.dirty = true;
  }
  let bloomT = 99, bloomArea = 0;

  function travel(ai) {
    if (!unlockedArea(ai)) return;
    const a = AREAS[ai];
    recenterArea(a);
    curArea = ai; save.area = ai; persist(); placeBoard();
    setMenu(false); discTarget = -1;
    say(`${a.zh}  ${a.name}`, 3);
  }
  function recenterArea(a) {
    // desktop has a narrow view: stand half a metre back so the lanterns fit on screen
    if (input.desktop || !ctx.isXR()) { toWorld(a, 0, 0, 0.5, _v1); ctx.recenter(_v1.x, _v1.z, a.yaw); }
    else ctx.recenter(a.x, a.z, a.yaw);
    rig.position.y = 0;
  }
  function resetProgress() {
    save = fresh(); persist(); resetArm = 0;
    applySaveToLanterns(); countLit();
    for (let i = 0; i < N; i++) resetFly(i, 0.1);
    pinched[0] = pinched[1] = -1;
    travel(0);
    say('A new evening in the garden.', 4);
  }

  // ── per-frame ─────────────────────────────────────────────
  const tips = [4, 9, 14, 19, 24];
  const spawnA = AREAS[curArea];
  placeBoard();
  let hudT = 0;

  function updateMenu(dt) {
    if (resetArm > 0) { resetArm -= dt; if (resetArm <= 0) menu.markDirty(); }
    const off = handOf(input.off.handedness), main = handOf(input.main.handedness);
    const toggle = input.main.b || input.off.b || input.keyDown('KeyM');
    if (off.mode === 'tracked') {
      // palm-up-to-open, anchored above the off hand
      _v1.copy(input.head.pos).sub(off.palm).normalize();
      const facing = off.normal.dot(_v1) > (menuOpen ? 0.5 : 0.72) && !off.fist && !off.pinch && !hands.cup.cup
        && off.palm.y > input.head.pos.y - 0.42 && off.palm.distanceTo(main.palm) > 0.12;
      if (facing) { palmUpT += dt; palmDownT = 0; } else { palmDownT += dt; palmUpT = 0; }
      if (!menuOpen && palmUpT > 0.35) setMenu(true, 'wrist');
      if (menuOpen && menuMode === 'wrist' && palmDownT > 0.5) setMenu(false);
      if (menuOpen && menuMode === 'wrist') {
        menu.mesh.position.copy(off.palm).addScaledVector(off.normal, 0.1).addScaledVector(off.fwd, 0.04);
        menu.mesh.lookAt(input.head.pos);
      }
    } else if (toggle) setMenu(!menuOpen, 'float');
    if (!menuOpen) { pointer.update(null, { show: false }); return; }
    menu.mesh.updateMatrixWorld();
    if (main.mode === 'tracked') {
      // poke with the index fingertip
      menu.mesh.worldToLocal(_v2.copy(main.tip));
      const hw = 0.15, hh = 0.086;
      let hover = null;
      if (Math.abs(_v2.x) < hw && Math.abs(_v2.y) < hh && _v2.z < 0.06 && _v2.z > -0.03) {
        _uv.x = _v2.x / (2 * hw) + 0.5; _uv.y = _v2.y / (2 * hh) + 0.5;
        const b = menu.buttonAt(_uv);
        hover = b?.enabled ? b.id : null;
        if (b?.enabled && pokeReady && _v2.z < 0.01) { pokeReady = false; b.onClick(); menu.markDirty(); sound.grab(main.tip); }
      }
      if (_v2.z > 0.025) pokeReady = true;
      if (menu.hover !== hover) { menu.hover = hover; menu.markDirty(); }
      menu.redraw();
      pointer.update(null, { show: false });
    } else {
      const hit = pointer.update(input.main, { show: true });
      if (hit?.button && input.main.triggerDown) pointer.click(hit);
    }
  }

  function updateHandsActions(dt, t) {
    const blockMain = menuOpen && menuMode === 'float';
    const mainSide = input.main.handedness;
    for (const h of hands.list) {
      const hi = handIdx(h);
      if (!h.present) { if (carryCount[hi]) releaseHand(hi, _v1.set(0, 0.3, 0), 0.2); fistT[hi] = 0; continue; }
      const isMain = h.side === mainSide;
      if (blockMain && isMain) continue;
      if (menuOpen && menuMode === 'wrist' && h.side !== mainSide) continue;
      const desktopMain = input.desktop && isMain && h.mode === 'ctrl';
      // pinch: grab one
      if (h.pinchDown) {
        if (discTarget >= 0 && desktopMain) {
          _dir.set(0, 0, -1).applyQuaternion(input.main.rayQuat);
          _v1.copy(disc.position).sub(input.main.rayPos);
          if (_v1.angleTo(_dir) < 0.12) { travel(discTarget); continue; }
        }
        tryPinch(h);
      }
      if (h.pinchUp && pinched[hi] >= 0) {
        const i = pinched[hi]; pinched[hi] = -1;
        if (fState[i] === CARRIED && fOwner[i] === hi) {
          // let go at a lantern (or with a flick) sends it off; otherwise it settles in the palm
          const vel = input[h.side].velocity, sp = vel.length();
          let near = false;
          for (const L of lanterns) if (!L.lit && L.pos.distanceTo(h.pinchPt) < 0.35 * L.scale) near = true;
          if (near || sp > 0.6) {
            _dir.copy(sp > 0.25 ? vel : input.head.fwd).normalize();
            releaseFly(i, _dir, Math.min(1.5, sp * 0.8 + 0.1));
            sound.release(h.pinchPt);
          }
        }
      }
      // grip (controllers): scoop / release.  Desktop RMB: release toward the crosshair.
      if (desktopMain && h.grabDown) {
        _dir.set(0, 0, -1).applyQuaternion(input.main.rayQuat);
        const L = rayLantern(input.main.rayPos, _dir);
        const n = releaseHand(0, _dir, 1.6, L) + releaseHand(1, _dir, 1.6, L);
        if (!n) say('Click a firefly to catch it first.', 2.5);
      } else if (h.mode === 'ctrl') {
        if (h.grabDown && !hands.cup.cup && !h.pinch) { if (scoop(h.palm.toArray(_rgb), 0.17, hi, hi)) { sound.grab(h.palm); haptic(h, 0.4, 40); } }
        if (h.grab && !h.pinch) { // keep scooping gently while held
          if (scoop(h.palm.toArray(_rgb), 0.1, hi, hi)) haptic(h, 0.2, 15);
        }
        if (h.grabUp && carryCount[hi]) {
          const vel = input[h.side].velocity, sp = vel.length();
          _dir.copy(sp > 0.3 ? vel : input.head.fwd).normalize();
          releaseHand(hi, _dir, Math.min(1.6, sp * 0.8 + 0.15));
        }
      }
      // fist: squeeze into an orb
      const fistNow = h.fist || (desktopMain && input.key('KeyG'));
      if (fistNow && carryCount[hi] >= 1 && carryTotal[hi] >= 2 && !(carryCount[hi] === 1 && carryOrb[hi])) {
        fistT[hi] += dt;
        if (fistT[hi] > 0.7) { squeezeOrb(hi); fistT[hi] = -1.5; }
        else if (fistT[hi] > 0) haptic(h, 0.1 + fistT[hi] * 0.3, 16);
      } else if (fistT[hi] > 0 || !fistNow) fistT[hi] = Math.min(0, fistT[hi] + dt);
      // tracked: open palm pushed away releases this hand's carry
      if (h.mode === 'tracked' && h.open && carryCount[hi] && !hands.cup.cup) {
        const vel = input[h.side].velocity;
        if (vel.length() > 0.7 && vel.dot(h.normal) > 0.5) releaseHand(hi, _dir.copy(vel).normalize(), 1.2);
      }
      // still, open hand: rose fireflies come to land
      landCd[hi] -= dt;
      const palmOk = h.mode === 'tracked' ? h.normal.y > 0.2 : true;
      if (h.open && palmOk && h.stillT > 1.0 && landCd[hi] <= 0) {
        landCd[hi] = 1.4;
        let best = -1, bd = 3.4 * 3.4, landing = 0;
        for (let i = 0; i < N; i++) if (fLand[i] === hi + 1) landing++;
        if (landing >= 2) bd = 0;
        for (let i = 0; i < N; i++) {
          if (fType[i] !== 2 || fState[i] !== FREE || fLand[i] || !unlockedArea(fArea[i]) || fFade[i] < 0.5) continue;
          const dx = P[i * 3] - h.holdPt.x, dy = P[i * 3 + 1] - h.holdPt.y, dz = P[i * 3 + 2] - h.holdPt.z, d = dx * dx + dy * dy + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0) fLand[best] = hi + 1;
      }
      // hold carried fireflies at a lantern: they stream in
      feedT[hi] -= dt;
      if (carryCount[hi] && feedT[hi] <= 0) {
        for (const L of lanterns) {
          if (L.lit || h.holdPt.distanceTo(L.pos) > 0.17 * L.scale) continue;
          for (let i = 0; i < N; i++) if (fState[i] === CARRIED && fOwner[i] === hi && accepts(L, i)) {
            releaseFly(i, _dir.copy(L.pos).sub(h.holdPt).normalize(), 0.4, L.idx); feedT[hi] = 0.22;
            if (pinched[hi] === i) pinched[hi] = -1;
            break;
          }
          break;
        }
      }
      // travel ring: touch it
      if (discTarget >= 0 && !input.desktop && (h.tip.distanceTo(disc.position) < 0.12 || h.palm.distanceTo(disc.position) < 0.13)) { travel(discTarget); return; }
    }
    // tracked two-hand cup: scoop and carry
    if (hands.cup.cup && HL.mode === 'tracked' && HR.mode === 'tracked') {
      const n = scoop(hands.cup.center, hands.cupDown ? 0.22 : 0.14, 0, 1);
      if (n && hands.cupDown) sound.grab(HL.palm);
    }
    if (hands.cup.cup && HL.mode === 'ctrl' && HR.mode === 'ctrl' && hands.cupDown) {
      if (scoop(hands.cup.center, 0.3, 0, 1)) { sound.grab(HL.palm); haptic(HL, 0.4, 40); haptic(HR, 0.4, 40); }
    }
    // tracked: open hands drawn apart ("blow") releases everything carried
    blowCd -= dt;
    if (HL.mode === 'tracked' && HR.mode === 'tracked' && !hands.cup.cup && blowCd <= 0 && (carryCount[0] + carryCount[1]) > 0) {
      const sep = HL.palm.distanceTo(HR.palm);
      if (!HL.fist && !HR.fist && !HL.pinch && !HR.pinch && hands.sepSpeed > 0.35 && sep < 0.55 && (HL.open || HR.open)) {
        _dir.copy(input.head.fwd); _dir.y = Math.max(_dir.y, 0) + 0.25; _dir.normalize();
        releaseHand(0, _dir, 0.9); releaseHand(1, _dir, 0.9); blowCd = 0.6;
      }
    }
  }

  function simFlies(dt, t) {
    carryCount[0] = carryCount[1] = carryTotal[0] = carryTotal[1] = carryOrb[0] = carryOrb[1] = 0;
    const damp = 1 / (1 + 1.6 * dt);
    const cupOn = hands.cup.cup;
    const deskMainHand = input.desktop ? handOf(input.main.handedness) : null;
    for (let i = 0; i < N; i++) {
      const st = fState[i];
      if (!unlockedArea(fArea[i]) || st === LANTERN) continue;
      if (st === HIDDEN) { fTimer[i] -= dt; if (fTimer[i] <= 0) resetFly(i); continue; }
      const i3 = i * 3, ph = fPhase[i];
      let px = P[i3], py = P[i3 + 1], pz = P[i3 + 2], vx = V[i3], vy = V[i3 + 1], vz = V[i3 + 2];
      if (fFade[i] < 1) fFade[i] = Math.min(1, fFade[i] + dt * 0.5);
      if (fFlash[i] > 0) fFlash[i] = Math.max(0, fFlash[i] - dt * 1.5);
      if (st === CARRIED) {
        const hi = fOwner[i], h = hands.list[hi];
        if (!h || !h.present) { fState[i] = FREE; fOwner[i] = -1; continue; }
        carryCount[hi]++; if (fOrb[i]) carryOrb[hi]++;
        for (let k = 0; k < NCOL; k++) carryTotal[hi] += COMP[i * NCOL + k];
        let tx, ty, tz;
        if (pinched[hi] === i) { tx = h.pinchPt.x; ty = h.pinchPt.y; tz = h.pinchPt.z; }
        else {
          const r = fOrb[i] ? 0 : 0.022 + (i % 5) * 0.006, a = t * (1.8 + (i % 3) * 0.4) + ph;
          if (cupOn && h.mode === 'tracked') { tx = hands.cup.center[0]; ty = hands.cup.center[1]; tz = hands.cup.center[2]; }
          else { tx = h.holdPt.x; ty = h.holdPt.y; tz = h.holdPt.z; }
          const sq = h.fist ? 0.3 : 1;
          tx += Math.cos(a) * r * sq; ty += Math.sin(a * 1.7) * 0.012 * sq; tz += Math.sin(a) * r * sq;
        }
        const k = 1 - Math.exp(-16 * dt);
        const nx = px + (tx - px) * k, ny = py + (ty - py) * k, nz = pz + (tz - pz) * k;
        if (dt > 0) { V[i3] = (nx - px) / dt; V[i3 + 1] = (ny - py) / dt; V[i3 + 2] = (nz - pz) / dt; }
        P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
        continue;
      }
      if (st === GUIDED) {
        const L = lanterns[fTarget[i]];
        const dx = L.pos.x - px, dy = L.pos.y - py, dz = L.pos.z - pz, d = Math.hypot(dx, dy, dz);
        if (d < 0.07 * L.scale) { P[i3] = L.pos.x; P[i3 + 1] = L.pos.y; P[i3 + 2] = L.pos.z; enterLantern(i, L); continue; }
        const sp = Math.min(1.4, 0.35 + d * 2.2), k = Math.min(1, dt * 5);
        vx += (dx / d * sp - vx) * k + Math.sin(t * 7 + ph) * 0.4 * dt;
        vy += (dy / d * sp - vy) * k + Math.cos(t * 6 + ph) * 0.4 * dt;
        vz += (dz / d * sp - vz) * k;
        fTimer[i] -= dt; if (fTimer[i] <= 0) { fState[i] = FREE; fTarget[i] = -1; }
      } else {
        // FREE: home wander + flowing field
        const type = fType[i];
        const hx = HOME[i3] + Math.sin(t * 0.13 + ph) * 0.28, hy = HOME[i3 + 1] + Math.sin(t * 0.21 + ph * 2) * 0.14, hz = HOME[i3 + 2] + Math.cos(t * 0.11 + ph) * 0.28;
        const fx = Math.sin(py * 1.7 + t * 0.5 + ph) + Math.cos(pz * 1.3 - t * 0.37);
        const fy = 0.6 * Math.sin(pz * 1.9 + t * 0.43 + ph * 0.7) + 0.4 * Math.cos(px * 1.1 + t * 0.21);
        const fz = Math.sin(px * 1.5 - t * 0.41 + ph) + Math.cos(py * 1.2 + t * 0.29);
        const fs = type === 1 ? 0.75 : type === 2 ? 0.3 : 0.45, hk = type === 2 ? 0.35 : 0.55;
        let ax = fx * fs + (hx - px) * hk, ay = fy * fs + (hy - py) * hk, az = fz * fs + (hz - pz) * hk;
        let maxSp = type === 1 ? 1.0 : 0.7;
        for (let hi = 0; hi < 2; hi++) {
          const h = hands.list[hi];
          if (!h.present) continue;
          // shy ones flee fast hands
          if (type === 1 && h.speed > 0.4) {
            const dx = px - h.palm.x, dy = py - h.palm.y, dz = pz - h.palm.z, d = Math.hypot(dx, dy, dz);
            if (d < 0.9 && d > 1e-4) { const f = (1 - d / 0.9) * 9 * Math.min(2, h.speed); ax += dx / d * f; ay += (dy / d + 0.2) * f; az += dz / d * f; maxSp = 2.4; }
          }
          // pointing calls fireflies along the finger
          if (h.point && type !== 2 && !(type === 1 && h.speed > 0.25)) {
            const o = (h === deskMainHand) ? input.main.rayPos : h.tip;
            const dirx = h.pointDir.x, diry = h.pointDir.y, dirz = h.pointDir.z;
            const rx = px - o.x, ry = py - o.y, rz = pz - o.z, along = rx * dirx + ry * diry + rz * dirz;
            if (along > -0.05 && along < 5.5) {
              const r2 = rx * rx + ry * ry + rz * rz - along * along, cone = 0.14 + along * 0.42;
              if (r2 < cone * cone) {
                const gx = h.tip.x + dirx * 0.07, gy = h.tip.y + diry * 0.07, gz = h.tip.z + dirz * 0.07;
                const tx = gx - px, ty = gy - py, tz = gz - pz, d = Math.hypot(tx, ty, tz) || 1;
                const f = Math.min(3.5, 1.2 + d * 1.5);
                ax += tx / d * f * 2 - fx * fs * 0.8; ay += ty / d * f * 2 - fy * fs * 0.8; az += tz / d * f * 2 - fz * fs * 0.8;
                ax -= (hx - px) * hk; ay -= (hy - py) * hk; az -= (hz - pz) * hk;
                maxSp = Math.max(maxSp, Math.min(1.6, d * 2.5 + 0.1));
                if (d < 0.12) { vx *= 0.9; vy *= 0.9; vz *= 0.9; }
              }
            }
          }
        }
        // rose fireflies landing on a still palm
        if (fLand[i]) {
          const h = hands.list[fLand[i] - 1];
          if (!h.present || !h.open || h.speed > 0.3) { fLand[i] = 0; if (h.present) flee(i, h.palm.x, h.palm.y, h.palm.z, 1.5); }
          else {
            const tx = h.holdPt.x - px, ty = h.holdPt.y + 0.02 - py, tz = h.holdPt.z - pz, d = Math.hypot(tx, ty, tz) || 1;
            if (d < 0.05) { capture(i, fLand[i] - 1); sound.grab(h.holdPt); haptic(h, 0.25, 20); continue; }
            const sp = Math.min(0.55, d * 1.2 + 0.08), k = Math.min(1, dt * 3);
            ax = 0; ay = 0; az = 0;
            vx += (tx / d * sp - vx) * k; vy += (ty / d * sp - vy) * k; vz += (tz / d * sp - vz) * k;
          }
        }
        vx += ax * dt; vy += ay * dt; vz += az * dt;
        vx *= damp; vy *= damp; vz *= damp;
        const sp = Math.hypot(vx, vy, vz);
        if (sp > maxSp) { const s = maxSp / sp; vx *= s; vy *= s; vz *= s; }
        if (py < 0.3) vy += (0.3 - py) * 6 * dt;
        if (fOrb[i]) { fTimer[i] += dt; if (fTimer[i] > 14) { fState[i] = HIDDEN; fTimer[i] = 1.5; continue; } }
      }
      px += vx * dt; py += vy * dt; pz += vz * dt;
      P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz; V[i3] = vx; V[i3 + 1] = vy; V[i3 + 2] = vz;
    }
  }

  function updateFish(dt, t) {
    for (let k = 0; k < fish.length; k++) {
      const f = fish[k], p = f.pond;
      if (!f.jumping) {
        f.ang += f.spd * dt / Math.max(0.5, f.rad);
        f.rad += Math.sin(t * 0.3 + k) * 0.02 * dt;
        f.rad = Math.min(0.85, Math.max(0.25, f.rad));
        const x = p.x + Math.cos(f.ang) * p.rx * f.rad, z = p.z + Math.sin(f.ang) * p.rz * f.rad;
        f.dir.set(x - f.pos.x, 0, z - f.pos.z);
        f.pos.set(x, p.waterY - 0.14 + Math.sin(t * 1.3 + k) * 0.02, z);
        f.cd -= dt;
        if (f.cd <= 0 && unlockedArea(p.area)) {
          let prey = -1, bd = 1.7;
          for (let i = 0; i < N; i++) {
            if (fState[i] !== FREE || fArea[i] !== p.area || fLand[i] || fFade[i] < 1) continue;
            const x0 = P[i * 3], y0 = P[i * 3 + 1], z0 = P[i * 3 + 2];
            if (y0 > p.waterY + 1.25) continue;
            if (((x0 - p.x) / p.rx) ** 2 + ((z0 - p.z) / p.rz) ** 2 > 0.8) continue;
            const d = Math.hypot(x0 - x, z0 - z);
            if (d < bd) { bd = d; prey = i; }
          }
          if (prey >= 0 || f.cd < -12) {
            f.jumping = true; f.jt = 0; f.prey = prey; f.sx = x; f.sz = z;
            if (prey >= 0) { f.tx = P[prey * 3] + V[prey * 3] * 0.3; f.ty = P[prey * 3 + 1] + 0.05; f.tz = P[prey * 3 + 2] + V[prey * 3 + 2] * 0.3; }
            else { f.tx = x + f.dir.x * 8; f.tz = z + f.dir.z * 8; f.ty = p.waterY + 0.35; }
            addRipple(x, p.waterY, z, 0.6); sound.splash(f.pos);
          } else if (f.cd <= 0) f.cd = 0.4;
        }
      } else {
        const T = 0.85; f.jt += dt;
        const s = Math.min(1, f.jt / T);
        const hx = f.sx + (f.tx - f.sx) * 2 * s, hz = f.sz + (f.tz - f.sz) * 2 * s;
        const y = p.waterY + (f.ty - p.waterY) * (1 - (2 * s - 1) ** 2);
        f.dir.set(hx - f.pos.x, y - f.pos.y, hz - f.pos.z);
        f.pos.set(hx, y, hz);
        if (f.prey >= 0 && s > 0.4 && s < 0.6) {
          const i = f.prey;
          if (fState[i] === FREE && Math.hypot(P[i * 3] - hx, P[i * 3 + 1] - y, P[i * 3 + 2] - hz) < 0.2) {
            fState[i] = HIDDEN; fTimer[i] = 6 + rand() * 3; f.prey = -1;
            if (AREAS[p.area] && curArea === p.area) say('A koi snapped up a firefly! Keep them high or carry them.', 3);
          }
        }
        if (s >= 1) {
          f.jumping = false; f.cd = 3 + rand() * 5;
          f.ang = Math.atan2((hz - p.z) / p.rz, (hx - p.x) / p.rx);
          f.rad = Math.min(0.85, Math.hypot((hz - p.z) / p.rz, (hx - p.x) / p.rx));
          addRipple(hx, p.waterY, hz, 1); sound.splash(f.pos);
        }
      }
      if (f.dir.lengthSq() > 1e-8) { _v1.copy(f.dir).normalize(); f.q.setFromUnitVectors(_v2.set(0, 0, -1), _v1); }
      _m.compose(f.pos, f.q, _s.set(1.5, 1.5, 1.5)); koi.setMatrixAt(k, _m);
    }
    koi.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < RIPPLES; i++) {
      const r = ripples[i]; r.t += dt;
      const a = Math.max(0, 1 - r.t / 1.6), s = (0.08 + r.t * 0.45) * r.s;
      _m.compose(_v1.set(r.x, r.y, r.z), _q.identity(), _s.set(s, 1, s)); rippleMesh.setMatrixAt(i, _m);
      rippleMesh.setColorAt(i, _col.setRGB(0.35 * a, 0.4 * a, 0.5 * a));
    }
    rippleMesh.instanceMatrix.needsUpdate = true; rippleMesh.instanceColor.needsUpdate = true;
  }

  function renderVisuals(dt, t) {
    // fireflies
    flyGlow.begin();
    for (let i = 0; i < N; i++) {
      const st = fState[i];
      if (st === LANTERN || st === HIDDEN || !unlockedArea(fArea[i])) continue;
      const ph = fPhase[i], type = fType[i];
      let b;
      if (fOrb[i]) b = 1.1 + 0.15 * Math.sin(t * 3 + ph);
      else if (st === CARRIED) b = 0.8 + 0.2 * Math.sin(t * 4 + ph);
      else if (type === 1) { const s = 0.5 + 0.5 * Math.sin(t * 4.3 + ph); b = 0.25 + 0.75 * s * s; }
      else if (type === 2) b = 0.45 + 0.4 * Math.sin(t * 0.9 + ph);
      else { const s = 0.5 + 0.5 * Math.sin(t * 1.7 + ph); b = 0.2 + 0.8 * s * s * s; }
      b = (b + fFlash[i]) * fFade[i];
      let n = 1; if (fOrb[i]) { n = 0; for (let k = 0; k < NCOL; k++) n += COMP[i * NCOL + k]; }
      const size = fOrb[i] ? 0.05 + n * 0.009 : (type === 2 ? 0.04 : 0.034);
      flyGlow.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], RGB[i * 3] * b, RGB[i * 3 + 1] * b, RGB[i * 3 + 2] * b, size * (0.85 + 0.25 * b));
    }
    flyGlow.commit();

    fxGlow.begin();
    // lanterns: body colour, halo, bead pips
    for (const L of lanterns) {
      const unlocked = unlockedArea(L.area);
      let filled = 0, need = 0; for (let k = 0; k < NCOL; k++) { filled += L.fill[k]; need += L.need[k]; }
      L.pulse = Math.max(0, L.pulse - dt * 1.5); L.shake = Math.max(0, L.shake - dt * 2.5); L.litT += dt;
      const sway = Math.sin(t * 0.8 + L.idx) * 0.04 + Math.sin(t * 17) * L.shake * 0.12;
      _q.setFromAxisAngle(_v1.set(1, 0, 0.4).normalize(), sway);
      const pop = L.lit ? 1 + Math.max(0, 0.25 - L.litT * 0.5) : 1 + L.pulse * 0.08;
      _m.compose(L.pos, _q, _s.setScalar(L.scale * pop));
      lanternBody.setMatrixAt(L.idx, _m); lanternCaps.setMatrixAt(L.idx, _m);
      const flick = 0.92 + 0.08 * Math.sin(t * 9 + L.idx * 3) * Math.sin(t * 5.3 + L.idx);
      const [cr, cg, cb] = L.color;
      if (L.lit) {
        _col.setRGB(cr * 0.85 + 0.16, cg * 0.85 + 0.12, cb * 0.85 + 0.08).multiplyScalar(flick);
        const hs = 0.55 * L.scale * (1 + Math.max(0, 1 - L.litT) * 0.8);
        fxGlow.push(L.pos.x, L.pos.y, L.pos.z, cr * 0.75 * flick, cg * 0.75 * flick, cb * 0.75 * flick, hs);
      } else {
        const f = unlocked ? filled / need : 0;
        _col.copy(LANT_UNLIT).lerp(_col2.setRGB(cr * 0.6 + 0.15, cg * 0.6 + 0.1, cb * 0.6 + 0.08), f * 0.7);
        _col.r += L.pulse * 0.4; _col.g += L.pulse * 0.3; _col.b += L.pulse * 0.2;
        if (f > 0) fxGlow.push(L.pos.x, L.pos.y, L.pos.z, cr * 0.18 * f, cg * 0.18 * f, cb * 0.18 * f, 0.3 * L.scale);
      }
      lanternBody.setColorAt(L.idx, _col);
      // beads: one per required firefly, hanging in a ring below the lantern
      if (unlocked && !L.lit) {
        let j = 0;
        const by = L.pos.y - 0.2 * L.scale, R = 0.05 * L.scale;
        for (let k = 0; k < NCOL; k++) for (let m = 0; m < L.need[k]; m++) {
          const a = (j / need) * Math.PI * 2 + t * 0.4;
          const on = m < L.fill[k];
          const c = COLORS[k].rgb, br = on ? 1.1 : 0.45 + 0.12 * Math.sin(t * 2 + j);
          fxGlow.push(L.pos.x + Math.cos(a) * R, by, L.pos.z + Math.sin(a) * R, c[0] * br, c[1] * br, c[2] * br, L.orb ? 0.03 : 0.024);
          j++;
        }
        if (L.orb) fxGlow.push(L.pos.x, by, L.pos.z, 0.3, 0.3, 0.32, 0.03 + 0.01 * Math.sin(t * 2));
      }
    }
    lanternBody.instanceMatrix.needsUpdate = lanternCaps.instanceMatrix.needsUpdate = true;
    if (lanternBody.instanceColor) lanternBody.instanceColor.needsUpdate = true;
    // stone lanterns glow for finished areas
    for (const s of garden.stoneLights) {
      const on = areaDone(s.area) ? 1 : unlockedArea(s.area) ? 0.25 : 0.08;
      const f = on * (0.85 + 0.15 * Math.sin(t * 6 + s.pos.x));
      fxGlow.push(s.pos.x, s.pos.y, s.pos.z, 0.6 * f, 0.38 * f, 0.15 * f, 0.18 + on * 0.2);
    }
    // fingertips + carried halos
    for (const h of hands.list) {
      if (!h.present) continue;
      for (let k = 0; k < 5; k++) {
        const j = tips[k], P2 = h.joints, warm = (k < 2 ? h.glowPinch : 0);
        const b = (h.point && k === 1 ? 1 : 0.45) + warm * 0.6;
        fxGlow.push(P2[j * 3], P2[j * 3 + 1], P2[j * 3 + 2], 0.9 * b, 0.75 * b, 0.4 * b, 0.016 + warm * 0.01);
      }
      const hi = handIdx(h);
      if (carryCount[hi]) fxGlow.push(h.holdPt.x, h.holdPt.y, h.holdPt.z, 0.12, 0.1, 0.05, 0.12 + carryCount[hi] * 0.01);
      if (fistT[hi] > 0) { const q = fistT[hi] / 0.7; fxGlow.push(h.holdPt.x, h.holdPt.y, h.holdPt.z, 0.5 * q, 0.45 * q, 0.3 * q, 0.06 + q * 0.06); }
      if (h.point) { // faint guide along the finger
        for (let s = 1; s <= 6; s++) { const d = s * 0.22, f = 0.12 * (1 - s / 7); fxGlow.push(h.tip.x + h.pointDir.x * d, h.tip.y + h.pointDir.y * d, h.tip.z + h.pointDir.z * d, f, f * 0.9, f * 0.6, 0.012); }
      }
    }
    if (hands.cup.cup) fxGlow.push(hands.cup.center[0], hands.cup.center[1], hands.cup.center[2], 0.12, 0.12, 0.08, 0.16);
    // travel ring
    if (disc.visible) {
      const f = 0.8 + 0.2 * Math.sin(t * 3);
      fxGlow.push(disc.position.x, disc.position.y, disc.position.z, 0.5 * f, 0.47 * f, 0.38 * f, 0.16);
    }
    // area bloom: a burst of sparks over the finished area
    if (bloomT < 4) {
      bloomT += dt;
      const a = AREAS[bloomArea];
      for (let k = 0; k < 40; k++) {
        const an = k * 2.39996, r = 0.3 + bloomT * 0.6 * (0.5 + (k % 7) / 7), y = 1.2 + bloomT * 0.35 * (k % 5) / 4 + Math.sin(bloomT * 3 + k) * 0.05;
        toWorld(a, Math.cos(an) * r, y, Math.sin(an) * r - 0.5, _v1);
        const f = Math.max(0, 1 - bloomT / 4) * (0.6 + 0.4 * Math.sin(t * 8 + k));
        const c = COLORS[k % NCOL].rgb;
        fxGlow.push(_v1.x, _v1.y, _v1.z, c[0] * f, c[1] * f, c[2] * f, 0.025);
      }
    }
    fxGlow.commit();

    hands.render(false);
  }

  // ── controller / desktop locomotion (sticks / WASD), allocation-free ─
  let snapReady = true;
  function locomote(dt) {
    const off = input.off;
    if (off.present && !(menuOpen && menuMode === 'float' && !input.desktop)) {
      const [x, y] = off.axes;
      if (Math.hypot(x, y) > 0.15) {
        _v1.copy(input.head.fwd); _v1.y = 0; if (_v1.lengthSq() < 1e-4) _v1.set(0, 0, -1); _v1.normalize();
        const sp = 1.6 * dt;
        rig.position.x += (_v1.x * -y + -_v1.z * x) * sp;
        rig.position.z += (_v1.z * -y + _v1.x * x) * sp;
        rig.position.x = Math.max(-16, Math.min(16, rig.position.x));
        rig.position.z = Math.max(-35, Math.min(5.5, rig.position.z));
      }
    }
    if (!input.desktop && input.main.present) {
      const x = input.main.axes[0];
      if (Math.abs(x) > 0.6 && snapReady) { rotateRigAround(rig, input.head.pos, -Math.sign(x) * Math.PI / 6); snapReady = false; }
      if (Math.abs(x) < 0.3) snapReady = true;
    }
  }

  // initial placement for desktop (VR is recentred by the platform via spawn)
  recenterArea(spawnA);
  say(`${spawnA.zh}  ${spawnA.name}`, 4);
  let lastUsingHands = null;
  const handOpts = { pointHeld: (side) => input[side].aHeld };
  const _uv = { x: 0, y: 0 };
  countLit();

  const game = {
    spawn: { x: spawnA.x, z: spawnA.z, yaw: spawnA.yaw },
    update(dt, t) {
      hands.update(dt, input, handOpts);
      if (input.desktop) {
        const m = handOf(input.main.handedness);
        if (input.key('KeyG') && m.present) { m.fist = true; m.holdPt.copy(m.palm).addScaledVector(m.normal, 0.03); }
      }
      locomote(dt);
      // which area are we in?
      let best = curArea, bd = 1e9;
      for (let i = 0; i < AREAS.length; i++) { const d = Math.hypot(input.head.pos.x - AREAS[i].x, input.head.pos.z - AREAS[i].z); if (d < bd) { bd = d; best = i; } }
      if (best !== curArea && bd < 4) { curArea = best; placeBoard(); if (unlockedArea(best)) { save.area = best; persist(); } }
      const uh = usingHands(); if (uh !== lastUsingHands) { lastUsingHands = uh; board.dirty = true; }

      updateMenu(dt);
      updateHandsActions(dt, t);
      simFlies(dt, t);
      updateFish(dt, t);

      // travel ring after finishing an area
      discTarget = -1;
      if (areaDone(curArea) && curArea + 1 < save.unlocked && unlockedArea(curArea + 1) && !areaDone(curArea + 1)) discTarget = curArea + 1;
      disc.visible = discTarget >= 0;
      if (disc.visible) {
        toWorld(AREAS[curArea], 0, 1.0 + Math.sin(t * 1.2) * 0.02, -0.38, disc.position);
        disc.rotation.set(0, AREAS[curArea].yaw + t * 0.6, 0);
      }

      // garden brightness follows progress
      let lit = 0; for (const L of lanterns) if (L.lit) lit++;
      const prog = lit / lanterns.length;
      ambient.material.uniforms.uTime.value = t; ambient.material.uniforms.uBright.value = 0.35 + prog * 0.75;
      stars.material.uniforms.uTime.value = t;
      const an = litN[curArea], at = litTot[curArea];
      let cx = 0, cy = 0, cz = 0, cn = 0; for (const L of lanterns) if (L.area === curArea) { cx += L.pos.x; cy += L.pos.y; cz += L.pos.z; cn++; }
      areaLight.position.set(cx / cn, cy / cn + 0.2, cz / cn);
      areaLight.intensity += ((0.25 + (an / at) * 2.2) - areaLight.intensity) * Math.min(1, dt * 2);

      renderVisuals(dt, t);

      // board, audio, HUD
      if (board.msgT > 0) { board.msgT -= dt; if (board.msgT <= 0) { board.msg = ''; board.dirty = true; } }
      if (board.dirty) { board.dirty = false; drawBoard(); }
      sound.update(dt, prog);
      sound.setListener(input.head.pos, input.head.fwd, input.head.up);
      if (toastT > 0) toastT -= dt;
      hudT -= dt;
      if (hudT <= 0 && input.desktop) {
        hudT = 0.2;
        const a = AREAS[curArea], c = carryCount[0] + carryCount[1];
        ctx.setHud(`${a.zh} ${a.name} · lanterns ${an}/${at} · carrying ${c}${toastT > 0 ? ' · <b>' + toast + '</b>' : ''}<br>` +
          `<small>LMB catch · RMB release toward a lantern · hold E call · hold G squeeze orb · hold still for rose · M menu · WASD walk${discTarget >= 0 ? ' · click the moon ring to travel' : ''}</small>`);
      }
    },
    dispose() { sound.dispose(); ctx.setHud(''); },
    onXRStart() { setMenu(false); board.dirty = true; },
    onXREnd() { setMenu(false); board.dirty = true; },
  };
  // test hooks
  game._debug = { P, V, fState, fType, fArea, fOrb, COMP, fLand, lanterns, hands, save: () => save, travel, carryCount, carryTotal, carryOrb, fistT, N, enterLantern, squeezeOrb, capture, menu, setMenu, get curArea() { return curArea; }, get discTarget() { return discTarget; } };
  return game;
}
