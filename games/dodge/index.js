import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Panel, Pointer, Sfx, FONTS, roundRect, fitText, makeLabel } from '../../src/platform/kit.js';
import { buildEnvironment, colorize } from './env.js';
import { Music } from './music.js';
import { Chart, ROUTINES, K, HOLE } from './chart.js';
import { Sensei } from './sensei.js';
import { Fx } from './fx.js';

// ── Dodge Dojo ─────────────────────────────────────────────────────────────
// Body-movement fitness: your head is your body. Duck bamboo poles, lean past posts and
// swinging logs, slip through pose-shaped holes in paper walls, punch red (left) / blue (right)
// pads with the right technique, and raise both forearms to block shields. Everything is
// scheduled on the beat of a procedural WebAudio track.

const SPAWN_Z = -16, HEAD_R = 0.11, DESK_EYE = 1.6, KG = 70;
const SENSEI_Z = -19, SENSEI_SCALE = 2.4;
const LOG_L = 1.35, LOG_A = 0.36, LOG_HALF = 0.375, LOG_R = 0.12, POLE_R = 0.06;
const HOLE_HEAD_R = 0.2, HOLE_MARGIN = 0.07;
const COL_L = new THREE.Color(0xff5040), COL_R = new THREE.Color(0x4a8cff), COL_GOLD = new THREE.Color(0xffc860);
const COL_HURT = new THREE.Color(0xff2a10), COL_WOOD = new THREE.Color(0xe0b878), COL_PAPER = new THREE.Color(0xfff0d0);
const SUB_NAMES = ['Jab', 'Hook', 'Uppercut'];

export async function create(ctx) {
  const { scene, input, camera } = ctx;
  const env = buildEnvironment(scene);
  const sfx = new Sfx(ctx.audio);
  const music = new Music(ctx.audio);
  const chart = new Chart();
  const track = new THREE.Group(); scene.add(track);     // origin = calibrated mat centre
  const fx = new Fx(track, camera);
  const sensei = new Sensei();
  sensei.root.position.set(0, 0.3, SENSEI_Z); sensei.root.scale.setScalar(SENSEI_SCALE);
  track.add(sensei.root);

  // ── persistent data ──
  const saved = ctx.load('dodge:calib', null);
  let best = ctx.load('dodge:best', {}) || {};
  let totals = ctx.load('dodge:totals', { kcal: 0, sessions: 0 }) || { kcal: 0, sessions: 0 };

  const S = {
    mode: 'calib1', H: DESK_EYE, reach: 0.65, cx: 0, cz: 0,
    sample: 0, sumY: 0, sumX: 0, sumZ: 0, n: 0, tposeHold: 0, msg: '',
    routine: ROUTINES[0], songT: 0, endT: Infinity, hearts: 0, newBest: false, aborted: false, defeated: false,
  };
  const stats = { score: 0, combo: 0, maxCombo: 0, punches: 0, punchHits: 0, great: 0, dodges: 0, obstacles: 0, hitsTaken: 0, blocks: 0, shields: 0, kcal: 0, time: 0, resolved: 0, success: 0 };
  const log = []; // ring of resolved events for tests: {t, at, kind, ok}
  const head = new THREE.Vector3(), headPrev = new THREE.Vector3(), hl = new THREE.Vector3();
  let headSpeed = 0;

  // ── materials & geometry ──
  const padGeo = makePadGeo(0.13, 0.07), shieldGeo = makePadGeo(0.24, 0.08);
  const padMats = [];
  for (const side of [-1, 1]) for (let sub = 0; sub < 3; sub++) padMats.push(new THREE.MeshLambertMaterial({ map: padTexture(side, sub), emissive: side < 0 ? 0x501010 : 0x102050 }));
  const shieldMat = new THREE.MeshLambertMaterial({ map: shieldTexture(), emissive: 0x3a2808 });
  const bambooMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const paperTex = paperTexture(); paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping; paperTex.repeat.set(1.6, 1.6);
  const wallMat = new THREE.MeshLambertMaterial({ map: paperTex, side: THREE.DoubleSide, emissive: 0x201008 });
  const hpoleGeo = bambooGeo(4.4, POLE_R, true), vpoleGeo = bambooGeo(3.6, 0.055, false);
  const logGeo = makeLogGeo();
  let wallGeos = [], holePolys = [], frameGeo = null, geoH = -1;
  function buildHeightGeos() {
    if (Math.abs(geoH - S.H) < 0.005) return;
    geoH = S.H;
    for (const g of wallGeos) g.dispose(); frameGeo?.dispose();
    wallGeos = []; holePolys = [];
    for (let h = 0; h < 5; h++) { const poly = holePoly(h, S.H); holePolys.push(poly); wallGeos.push(makeWallGeo(poly, S.H)); }
    frameGeo = makeFrameGeo(S.H + LOG_L * Math.cos(LOG_A));
    for (const it of items) { if (it.kind === K.WALL) it.obj.geometry = wallGeos[0]; if (it.kind === K.LOG) it.frame.geometry = frameGeo; }
  }

  // ── item pools ──
  const items = [];
  function addItem(kind, obj, extra) { obj.visible = false; track.add(obj); const it = { kind, obj, active: false, done: false, t: 0, side: 0, sub: 0, hole: 0, speed: 0, zPlane: 0, x: 0, y: 0, z: 0, prevZ: 0, warned: false, ...extra }; items.push(it); return it; }
  for (let i = 0; i < 16; i++) addItem(K.PAD, new THREE.Mesh(padGeo, padMats[0]));
  for (let i = 0; i < 3; i++) addItem(K.SHIELD, new THREE.Mesh(shieldGeo, shieldMat));
  for (let i = 0; i < 4; i++) addItem(K.HPOLE, new THREE.Mesh(hpoleGeo, bambooMat));
  for (let i = 0; i < 4; i++) addItem(K.VPOLE, new THREE.Mesh(vpoleGeo, bambooMat));
  for (let i = 0; i < 4; i++) addItem(K.WALL, new THREE.Mesh(new THREE.BufferGeometry(), wallMat));
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group(), frame = new THREE.Mesh(new THREE.BufferGeometry(), bambooMat), swing = new THREE.Mesh(logGeo, bambooMat);
    g.add(frame, swing); addItem(K.LOG, g, { frame, swing });
  }
  buildHeightGeos();

  // ── gloves ──
  const gloveGeo = new RoundedBoxGeometry(0.09, 0.085, 0.12, 2, 0.03);
  const fists = [-1, 1].map((side) => {
    const glove = new THREE.Mesh(gloveGeo, new THREE.MeshLambertMaterial({ color: side < 0 ? 0xd8302a : 0x2a62d8, emissive: side < 0 ? 0x300808 : 0x081838 }));
    scene.add(glove);
    return { side, glove, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), present: false, punchT: -1, target: new THREE.Vector3(), hasPrev: false };
  });
  const desk = { crouch: 0, lean: 0, guard: 0, nextHand: 1 };

  // ── mat + boundary ring ──
  const matTex = matTexture();
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshLambertMaterial({ map: matTex }));
  mat.rotation.x = -Math.PI / 2; mat.position.y = 0.015; track.add(mat);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.8, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1.0, 72), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; track.add(ring);
  const warnLbl = makeLabel('Step back to the centre of the mat', { size: 0.07, color: '#ffffff', bg: 'rgba(170,20,10,0.9)', px: 56 });
  warnLbl.material.depthTest = false; warnLbl.renderOrder = 30; warnLbl.visible = false; track.add(warnLbl);

  // ── panels ──
  const pointer = new Pointer(scene);
  pointer.onHover = () => sfx.tone({ freq: 900, dur: 0.03, gain: 0.04 });
  pointer.onClick = () => sfx.tone({ freq: 660, dur: 0.08, gain: 0.12, type: 'triangle' });
  const panel = new Panel({ width: 1.3, height: 0.95, px: 1024, draw: drawPanel });
  track.add(panel.mesh); pointer.panels.push(panel);
  const hud = new Panel({ width: 1.5, height: 0.34, px: 1024, draw: drawHud });
  hud.mesh.visible = false; track.add(hud.mesh);
  let hudTimer = 0, deskHudTimer = 0;

  function placePanels() {
    panel.mesh.position.set(0, S.H - 0.08, -1.45);
    hud.mesh.position.set(0, S.H + 0.68, -2.4); hud.mesh.rotation.x = 0.25;
    warnLbl.position.set(0, S.H - 0.25, -0.9);
  }

  function setMode(m) {
    S.mode = m;
    const menuLike = m !== 'play';
    panel.mesh.visible = menuLike; hud.mesh.visible = m === 'play';
    if (!menuLike) { pointer.line.visible = pointer.dot.visible = false; }
    placePanels(); panel.markDirty(); hud.markDirty();
  }

  // ── calibration ──
  function finishCalib1() {
    S.H = THREE.MathUtils.clamp(S.sumY / S.n, 1.0, 2.1);
    S.cx = S.sumX / S.n; S.cz = S.sumZ / S.n;
    track.position.set(S.cx, 0, S.cz);
    buildHeightGeos();
    setMode('calib2');
  }
  function finishCalib2(reach) {
    S.reach = THREE.MathUtils.clamp(reach, 0.45, 0.85);
    ctx.save('dodge:calib', { h: S.H, reach: S.reach });
    sfx.tone({ freq: 523, dur: 0.15, gain: 0.15 }); sfx.tone({ freq: 784, dur: 0.25, gain: 0.15, delay: 0.12 });
    setMode('menu');
  }
  function useDesktopCalib() {
    S.H = DESK_EYE; S.cx = 0; S.cz = 0; track.position.set(0, 0, 0); buildHeightGeos();
  }

  // ── routine flow ──
  function startRoutine(r) {
    S.routine = r; S.newBest = false; S.aborted = false; S.defeated = false;
    for (const k in stats) stats[k] = 0;
    S.hearts = r.hearts ?? 0;
    for (const it of items) release(it);
    log.length = 0;
    buildHeightGeos();
    const seed = (Math.random() * 1e9) | 0;
    chart.reset(r, seed);
    music.start(r.bpm, r.style, 2, seed);
    S.songT = music.t;
    S.endT = Number.isFinite(r.bars) ? r.bars * 4 * chart.spb : Infinity;
    if (Number.isFinite(S.endT)) music.endAt(S.endT);
    setMode('play');
  }
  function finish({ aborted = false, defeated = false } = {}) {
    S.aborted = aborted; S.defeated = defeated;
    if (aborted) music.fadeOut(0.4);
    else if (defeated || !Number.isFinite(S.endT)) { music.fadeOut(1.2); sfx.tone({ freq: 110, dur: 2.5, gain: 0.3 }); sfx.tone({ freq: 163, dur: 2, gain: 0.15 }); }
    for (const it of items) release(it);
    if (!aborted) {
      const id = S.routine.id, prev = best[id];
      if (stats.score > 0 && (!prev || stats.score > prev.score)) { best[id] = { score: stats.score, combo: stats.maxCombo, kcal: +stats.kcal.toFixed(1), grade: grade() }; S.newBest = stats.score > 0; ctx.save('dodge:best', best); }
      totals.kcal = (totals.kcal || 0) + stats.kcal; totals.sessions = (totals.sessions || 0) + 1; ctx.save('dodge:totals', totals);
      sfx.tone({ freq: 392, dur: 0.3, gain: 0.12, type: 'triangle' }); sfx.tone({ freq: 587, dur: 0.5, gain: 0.12, type: 'triangle', delay: 0.15 });
    }
    sensei.bow = 1;
    if (input.desktop && !ctx.isXR()) { input.yaw = 0; input.pitch = 0; }
    setMode(aborted ? 'menu' : 'results');
  }
  function accuracy() { return stats.resolved ? stats.success / stats.resolved : 0; }
  function grade() { const a = accuracy(); return a >= 0.95 ? 'S' : a >= 0.85 ? 'A' : a >= 0.7 ? 'B' : a >= 0.5 ? 'C' : 'D'; }
  function mult() { return Math.min(4, 1 + Math.floor(stats.combo / 8)); }

  // ── spawning ──
  function planeFor(kind, sub) {
    if (kind === K.PAD) return sub === 0 ? -S.reach * 0.85 : sub === 1 ? -S.reach * 0.6 : -S.reach * 0.55;
    if (kind === K.SHIELD) return -0.5;
    return 0;
  }
  function travelOf(e) { return (planeFor(e.kind, e.sub) - SPAWN_Z) / e.speed; }
  function acquire(kind) { for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.kind === kind && !it.active) return it; } return null; }
  function release(it) { it.active = false; it.obj.visible = false; }
  function spawn(e) {
    const it = acquire(e.kind); if (!it) return;
    it.active = true; it.done = false; it.warned = false;
    it.t = e.t; it.side = e.side; it.sub = e.sub; it.hole = e.hole; it.speed = e.speed;
    it.zPlane = planeFor(e.kind, e.sub);
    const sh = S.H - 0.22;
    it.x = 0; it.y = 0;
    const o = it.obj;
    o.rotation.set(0, 0, 0); o.scale.setScalar(1);
    switch (e.kind) {
      case K.PAD:
        o.material = padMats[(e.side < 0 ? 0 : 3) + e.sub];
        if (e.sub === 0) { it.x = e.side * 0.17; it.y = sh + 0.02; }
        else if (e.sub === 1) { it.x = e.side * 0.32; it.y = sh + 0.03; o.rotation.y = e.side * 0.35; }
        else { it.x = e.side * 0.14; it.y = sh - 0.2; o.rotation.x = 0.45; }
        stats.punches++;
        break;
      case K.SHIELD: it.y = S.H - 0.05; stats.shields++; break;
      case K.HPOLE: it.y = S.H - 0.12; stats.obstacles++; break;
      case K.VPOLE: it.x = -e.side * 0.07; stats.obstacles++; break;
      case K.WALL: o.geometry = wallGeos[e.hole]; stats.obstacles++; break;
      case K.LOG: stats.obstacles++; it.swing.position.y = S.H + LOG_L * Math.cos(LOG_A); break;
    }
    it.z = it.prevZ = it.zPlane - it.speed * (it.t - S.songT);
    o.position.set(it.x, it.y, it.z);
    o.visible = true;
  }

  // ── resolution helpers ──
  function addScore(base) { stats.combo++; stats.maxCombo = Math.max(stats.maxCombo, stats.combo); stats.score += Math.round(base * mult()); stats.success++; stats.resolved++; hud.markDirty(); }
  function logEvent(it, ok) { if (log.length >= 128) log.shift(); log.push({ t: it.t, at: S.songT, kind: it.kind, ok, hx: +hl.x.toFixed(2), hy: +hl.y.toFixed(2) }); }
  function takeHit(it, x, y, z) {
    stats.hitsTaken++; stats.combo = 0; stats.resolved++;
    fx.flash(1); fx.burst(x, y, z, COL_HURT, 30, 2.2); fx.word('OUCH', x, y + 0.25, z - 0.4);
    sfx.noise({ freq: 300, dur: 0.25, gain: 0.5, type: 'lowpass' }); sfx.tone({ freq: 90, freqEnd: 50, dur: 0.3, gain: 0.4 });
    input.left.haptic(1, 160); input.right.haptic(1, 160);
    logEvent(it, false); hud.markDirty();
    if (S.hearts > 0) { S.hearts--; if (S.hearts <= 0) S.pendingDefeat = true; }
  }
  function dodged(it) {
    stats.dodges++; addScore(60); logEvent(it, true);
    fx.word('DODGE', hl.x, S.H + 0.32, -0.9);
    sfx.noise({ freq: 1400, freqEnd: 500, dur: 0.18, gain: 0.12 });
  }
  function padHit(it, fist, quality, dirOk) {
    it.done = true; release(it);
    stats.punchHits++; if (quality === 2 && dirOk) stats.great++;
    const base = !dirOk ? 40 : quality === 2 ? 120 : 80;
    addScore(base); logEvent(it, true);
    const wx = it.x, wy = it.y, wz = it.z;
    fx.burst(wx, wy, wz, it.side < 0 ? COL_L : COL_R, 26, 2.8);
    fx.word(!dirOk ? (it.sub === 0 ? 'JAB' : it.sub === 1 ? 'HOOK' : 'UPPER') : quality === 2 ? 'GREAT' : 'GOOD', wx, wy + 0.2, wz);
    sfx.noise({ freq: 900, dur: 0.07, gain: 0.5, type: 'bandpass', q: 0.8 }); sfx.tone({ freq: quality === 2 ? 220 : 180, freqEnd: 90, dur: 0.12, gain: 0.35 });
    (fist.side < 0 ? input.left : input.right).haptic(quality === 2 ? 0.9 : 0.6, 45);
  }
  function blocked(it) {
    it.done = true; release(it);
    stats.blocks++; addScore(150); logEvent(it, true);
    fx.burst(it.x, it.y, it.z, COL_GOLD, 34, 3); fx.word('BLOCK', 0, it.y + 0.3, it.z - 0.2);
    sfx.tone({ freq: 620, dur: 0.6, gain: 0.18, type: 'triangle' }); sfx.tone({ freq: 931, dur: 0.5, gain: 0.1, type: 'sine' }); sfx.noise({ freq: 3000, dur: 0.1, gain: 0.2 });
    input.left.haptic(0.8, 80); input.right.haptic(0.8, 80);
  }
  function missed(it) {
    it.done = true; stats.combo = 0; stats.resolved++; logEvent(it, false);
    fx.word('MISS', it.x, it.y + 0.15, it.z); hud.markDirty();
  }

  // swept distance of fist (relative to the moving pad) from the pad centre
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ab = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  function sweptDist(fist, it) {
    _a.set(fist.prev.x - track.position.x - it.x, fist.prev.y - it.y, fist.prev.z - track.position.z - it.prevZ);
    _b.set(fist.pos.x - track.position.x - it.x, fist.pos.y - it.y, fist.pos.z - track.position.z - it.z);
    _ab.subVectors(_b, _a); const L2 = _ab.lengthSq();
    let t = L2 > 1e-8 ? -_a.dot(_ab) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return _w.copy(_a).addScaledVector(_ab, t).length();
  }
  function tryPadVR(it) {
    for (let k = 0; k < 2; k++) {
      const f = fists[k]; if (!f.present || !f.hasPrev) continue;
      if (sweptDist(f, it) > 0.16) continue;
      if (f.side !== it.side) { if (!it.warned) { it.warned = true; fx.word('WRONG', it.x, it.y + 0.2, it.z); sfx.tone({ freq: 200, dur: 0.1, gain: 0.1, type: 'square' }); } continue; }
      const sp = f.vel.length();
      if (sp < S.routine.minPunch) { if (!it.warned) { it.warned = true; fx.word('HARDER', it.x, it.y + 0.2, it.z); sfx.tone({ freq: 300, dur: 0.06, gain: 0.08 }); } continue; }
      let d;
      if (it.sub === 0) d = -f.vel.z / sp; else if (it.sub === 1) d = (it.side < 0 ? f.vel.x : -f.vel.x) / sp; else d = f.vel.y / sp;
      const dirOk = d > (it.sub === 0 ? 0.45 : 0.35);
      padHit(it, f, sp > S.routine.minPunch * 1.6 ? 2 : 1, dirOk);
      return;
    }
  }

  // desktop: LMB punches toward the crosshair; the fist matching the pad colour is used
  function desktopPunch(forced) {
    let bestIt = forced ?? null, bestD = forced ? 0 : 0.26;
    const fwd = input.head.fwd;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; if (!it.active || it.done || it.kind !== K.PAD) continue;
      _v.set(track.position.x + it.x - head.x, it.y - head.y, track.position.z + it.z - head.z);
      const along = _v.dot(fwd); if (along < 0.15 || along > S.reach + 1.5) continue;
      let perp = _w.copy(_v).addScaledVector(fwd, -along).length();
      // also accept aiming at where the pad will be struck (low frame rates / fast pads)
      _v.z = track.position.z + it.zPlane - head.z;
      const a2 = _v.dot(fwd); if (a2 > 0.15) perp = Math.min(perp, _w.copy(_v).addScaledVector(fwd, -a2).length());
      if (perp < bestD) { bestD = perp; bestIt = it; }
    }
    const side = bestIt ? bestIt.side : (desk.nextHand = -desk.nextHand);
    const f = fists[side < 0 ? 0 : 1];
    f.punchT = 0;
    if (bestIt) {
      f.target.set(track.position.x + bestIt.x, bestIt.y, track.position.z + bestIt.z);
      const timing = Math.abs(S.songT - bestIt.t);
      padHit(bestIt, f, timing < 0.16 ? 2 : 1, true);
    } else {
      f.target.copy(head).addScaledVector(fwd, S.reach);
      sfx.noise({ freq: 700, freqEnd: 300, dur: 0.1, gain: 0.06 });
    }
  }

  function blockPose() {
    // both fists in front of the face, forearms up
    for (let k = 0; k < 2; k++) {
      const f = fists[k]; if (!f.present) return false;
      const dz = f.pos.z - head.z;
      if (dz > -0.1 || dz < -0.65 || f.pos.y < head.y - 0.22 || Math.abs(f.pos.x - head.x) > 0.32) return false;
    }
    return true;
  }

  // ── collision tests (track-local head hl) ──
  function hitsObstacle(it) {
    switch (it.kind) {
      case K.HPOLE: return hl.y + HEAD_R > it.y - POLE_R;
      case K.VPOLE: return Math.abs(hl.x - it.x) < POLE_R + HEAD_R;
      case K.WALL: return !inHole(holePolys[it.hole], hl.x, hl.y);
      case K.LOG: {
        const th = logAngleAt(it, it.t + (hl.z - it.zPlane) / it.speed), py = S.H + LOG_L * Math.cos(LOG_A);
        const cx = LOG_L * Math.sin(th), cy = py - LOG_L * Math.cos(th), ux = Math.cos(th), uy = Math.sin(th);
        let s = (hl.x - cx) * ux + (hl.y - cy) * uy; s = s < -LOG_HALF ? -LOG_HALF : s > LOG_HALF ? LOG_HALF : s;
        const dx = hl.x - (cx + ux * s), dy = hl.y - (cy + uy * s);
        return dx * dx + dy * dy < (LOG_R + HEAD_R) * (LOG_R + HEAD_R);
      }
    }
    return false;
  }
  // log swings with the beat: at its hit time it sits at the extreme on the side opposite the dodge
  function logAngle(it) { return logAngleAt(it, S.songT); }
  function logAngleAt(it, t) { return -it.side * LOG_A * Math.cos(Math.PI * (t - it.t) / chart.spb); }

  // ── shadow sensei telegraph ──
  function senseiContrib(kind, side, sub, hole, tHit, travel) {
    const peak = tHit - travel * 0.85 + 0.1, d = S.songT - peak, W = 0.34;
    if (d < -W || d > W) return;
    const w = 0.5 + 0.5 * Math.cos(Math.PI * d / W);
    switch (kind) {
      case K.HPOLE: sensei.crouch = Math.max(sensei.crouch, w); break;
      case K.VPOLE: case K.LOG: sensei.lean += side * w; break;
      case K.WALL:
        if (hole === HOLE.DUCK || hole === HOLE.LOWLEFT || hole === HOLE.LOWRIGHT) sensei.crouch = Math.max(sensei.crouch, w * 0.9);
        if (hole === HOLE.LEFT || hole === HOLE.LOWLEFT) sensei.lean -= w; else if (hole === HOLE.RIGHT || hole === HOLE.LOWRIGHT) sensei.lean += w;
        break;
      case K.PAD: { const k = side < 0 ? 0 : 1; if (w > sensei.amt[k]) { sensei.amt[k] = w; sensei.act[k] = sub + 1; } break; }
      case K.SHIELD: for (let k = 0; k < 2; k++) if (w > sensei.amt[k]) { sensei.amt[k] = w; sensei.act[k] = 4; } break;
    }
  }
  function updateSensei(dt, beatPhase) {
    sensei.crouch = 0; sensei.lean = 0; sensei.amt[0] = sensei.amt[1] = 0;
    if (S.mode === 'play') {
      sensei.bow = 0;
      for (let i = 0; i < items.length; i++) { const it = items[i]; if (it.active) senseiContrib(it.kind, it.side, it.sub, it.hole, it.t, (it.zPlane - SPAWN_Z) / it.speed); }
      const n = chart.count;
      for (let i = 0; i < n; i++) { const e = chart.at(i); const tr = travelOf(e); if (e.t - tr > S.songT + 0.6) break; senseiContrib(e.kind, e.side, e.sub, e.hole, e.t, tr); }
      sensei.lean = THREE.MathUtils.clamp(sensei.lean, -1, 1);
      sensei.bob = Math.exp(-beatPhase * 5);
    } else { sensei.bob = 0; sensei.bow = S.mode === 'results' ? 1 : 0; }
    sensei.update(dt);
  }

  // ── per-frame helpers ──
  const _off = new THREE.Vector3();
  function updateHeadAndFists(dt) {
    const xr = ctx.isXR();
    if (!xr && input.desktop) {
      const ap = debug.autopilot;
      const cT = ap ? (ap.crouch || 0) : (input.key('KeyC') ? 1 : 0);
      const lT = ap ? (ap.lean || 0) : (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
      const gT = ap ? (ap.guard || 0) : (input.mouse.right || input.key('KeyF') ? 1 : 0);
      const k = 1 - Math.exp(-20 * dt);
      desk.crouch += (cT - desk.crouch) * k; desk.lean += (lT - desk.lean) * k; desk.guard += (gT - desk.guard) * (1 - Math.exp(-25 * dt));
      camera.position.set(desk.lean * 0.36, DESK_EYE - desk.crouch * 0.56, 0);
      camera.updateMatrixWorld();
    }
    camera.getWorldPosition(head);
    hl.set(head.x - track.position.x, head.y, head.z - track.position.z);
    if (dt > 0) { const sp = head.distanceTo(headPrev) / dt; headSpeed += (Math.min(sp, 4) - headSpeed) * Math.min(1, dt * 4); }
    headPrev.copy(head);

    for (let k = 0; k < 2; k++) {
      const f = fists[k];
      f.prev.copy(f.pos);
      if (xr) {
        const h = f.side < 0 ? input.left : input.right;
        f.present = h.present;
        if (h.present) {
          f.pos.copy(_off.set(0, 0, -0.03).applyQuaternion(h.gripQuat)).add(h.gripPos);
          f.vel.copy(h.velocity);
          f.glove.quaternion.copy(h.gripQuat);
        }
      } else if (input.desktop) {
        f.present = true;
        _off.set(f.side * 0.24, -0.3, -0.55).lerp(_v.set(f.side * 0.09, -0.05, -0.32), desk.guard);
        f.pos.copy(_off); camera.localToWorld(f.pos);
        if (f.punchT >= 0) {
          f.punchT += dt / 0.22;
          const kk = Math.sin(Math.PI * Math.min(1, f.punchT));
          f.pos.lerp(f.target, kk * 0.9);
          if (f.punchT >= 1) f.punchT = -1;
        }
        if (dt > 0) f.vel.subVectors(f.pos, f.prev).divideScalar(dt);
        camera.getWorldQuaternion(f.glove.quaternion);
      } else f.present = false;
      if (!f.hasPrev) f.prev.copy(f.pos);
      f.hasPrev = f.present;
      f.glove.visible = f.present;
      f.glove.position.copy(f.pos);
    }
  }

  function updateBoundary() {
    const d = Math.hypot(hl.x, hl.z);
    const warn = d > 0.9 && S.mode !== 'calib1';
    ringMat.color.setHex(d > 0.9 ? 0xff3020 : d > 0.7 ? 0xffa040 : 0xfff2c0);
    warnLbl.visible = warn;
  }

  function updateCalories(dt) {
    let hand = 0;
    if (ctx.isXR()) hand = (fists[0].present ? Math.min(6, fists[0].vel.length()) : 0) * 0.5 + (fists[1].present ? Math.min(6, fists[1].vel.length()) : 0) * 0.5;
    const met = 2.8 + Math.min(7.2, headSpeed * 5 + hand * 0.9);
    stats.kcal += met * 3.5 * KG / 200 / 60 * dt;
  }

  // ── play loop ──
  function updatePlay(dt) {
    S.songT = debug.hold != null ? debug.hold : music.update(dt);
    stats.time = Math.max(0, S.songT);
    chart.ensure(S.songT + 4);
    // spawn every chart event whose object has reached the spawn point
    let e;
    while ((e = chart.peek()) && S.songT >= e.t - travelOf(e)) { chart.shift(); spawn(e); }
    const ap = debug.autopilot;
    if (ap) autopilot(ap);
    if (input.desktop && !ctx.isXR() && (input.mouse.leftDown || (ap && ap.punch))) desktopPunch(ap?.punch || null);

    for (let i = 0; i < items.length; i++) {
      const it = items[i]; if (!it.active) continue;
      it.prevZ = it.z;
      it.z = it.zPlane - it.speed * (it.t - S.songT);
      const o = it.obj;
      o.position.z = it.z;
      const grow = Math.min(1, (it.z - SPAWN_Z) / 1.2 + 0.05);
      switch (it.kind) {
        case K.PAD:
          o.scale.setScalar(grow);
          if (!it.done) {
            if (ctx.isXR()) tryPadVR(it);
            if (!it.done && it.z > hl.z + 0.3) missed(it);
          }
          if (it.z > 2.5) release(it);
          break;
        case K.SHIELD:
          o.scale.setScalar(grow); o.rotation.z += dt * 2;
          if (!it.done && it.prevZ < hl.z - 0.45 && it.z >= hl.z - 0.45) {
            if (blockPose()) blocked(it); else { it.done = true; takeHit(it, hl.x, hl.y, -0.4); }
          }
          if (it.z > 2.5) release(it);
          break;
        default:
          if (it.kind === K.LOG) it.swing.rotation.z = logAngle(it);
          if (!it.done && it.prevZ < hl.z && it.z >= hl.z) {
            it.done = true;
            if (hitsObstacle(it)) takeHit(it, hl.x, hl.y, hl.z - 0.25); else dodged(it);
          }
          if (it.z > 3) release(it);
      }
    }
    if (S.pendingDefeat) { S.pendingDefeat = false; finish({ defeated: true }); return; }
    if (S.songT >= S.endT) { finish(); return; }
    updateCalories(dt);
    if (input.main.b) { finish({ aborted: true }); return; }
  }

  // Debug autopilot (tests only): reads upcoming items and drives the desktop body.
  function autopilot(ap) {
    ap.crouch = 0; ap.lean = 0; ap.guard = 0; ap.punch = false;
    let pad = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]; if (!it.active || it.done) continue;
      const dtHit = it.t - S.songT;
      if (it.kind === K.PAD) { if (it.z < hl.z - 0.15 && (!pad || it.t < pad.t)) pad = it; continue; }
      if (dtHit > 0.7 || dtHit < -0.2) continue;
      if (it.kind === K.SHIELD) ap.guard = 1;
      else if (it.kind === K.HPOLE) ap.crouch = 1;
      else if (it.kind === K.VPOLE || it.kind === K.LOG) ap.lean = it.side;
      else if (it.kind === K.WALL) {
        if (it.hole === HOLE.DUCK || it.hole >= HOLE.LOWLEFT) ap.crouch = 1;
        if (it.hole === HOLE.LEFT || it.hole === HOLE.LOWLEFT) ap.lean = -1; else if (it.hole === HOLE.RIGHT || it.hole === HOLE.LOWRIGHT) ap.lean = 1;
      }
    }
    if (pad && pad.t - S.songT < 0.6) {
      // aim at the pad's hit point; strike once it is close
      const dx = track.position.x + pad.x - head.x, dy = pad.y - head.y, dz = track.position.z + pad.zPlane - head.z;
      input.yaw = Math.atan2(-dx, -dz); input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (pad.t - S.songT < 0.16 && pad.z > -S.reach - 1.4) ap.punch = pad;
    }
  }

  // ── panel drawing ──
  function bg(c, W, H) {
    roundRect(c, 6, 6, W - 12, H - 12, 28);
    c.fillStyle = 'rgba(16,12,24,0.9)'; c.fill();
    c.lineWidth = 4; c.strokeStyle = '#e2b85c'; c.stroke();
  }
  function text(c, s, x, y, size, color = '#f1e6cf', font = FONTS.sans, align = 'center', maxW = 900) {
    c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; fitText(c, s, x, y, maxW, size, font);
  }
  function drawPanel(c, W, H, p) {
    bg(c, W, H);
    const xr = ctx.isXR();
    if (S.mode === 'calib1') {
      text(c, '拳 Dodge Dojo', W / 2, 90, 76, '#e2b85c', FONTS.brush);
      text(c, 'Step 1 of 2 · Stand tall', W / 2, 180, 40, '#ffffff');
      text(c, 'Stand in the middle of the mat, feet apart, look straight ahead.', W / 2, 250, 30, '#d8cfe8');
      text(c, xr ? 'Pull a trigger when you are standing at full height.' : 'Desktop: click to use a 1.6 m eye height.', W / 2, 300, 30, '#d8cfe8');
      text(c, 'Clear about 2 × 2 m around you. Every move stays within 1 m.', W / 2, 370, 26, '#ffb070');
      p.button('tall', W / 2 - 220, 430, 440, 110, S.sample > 0 ? 'Measuring…' : 'I’m standing tall', () => beginSample(), { size: 40 });
      if (saved) p.button('saved', W / 2 - 220, 570, 440, 90, `Use saved (${saved.h.toFixed(2)} m)`, () => useSaved(), { size: 32 });
    } else if (S.mode === 'calib2') {
      text(c, 'Step 2 of 2 · Arm reach', W / 2, 90, 46, '#ffffff');
      text(c, `Eye height ${S.H.toFixed(2)} m`, W / 2, 160, 30, '#e2b85c');
      text(c, xr ? 'Spread both arms straight out to the sides, like a T,' : 'Desktop: arm reach uses the 0.65 m default.', W / 2, 240, 30, '#d8cfe8');
      text(c, xr ? 'and pull both triggers (or hold the pose for 2 seconds).' : 'Click to continue.', W / 2, 285, 30, '#d8cfe8');
      if (xr) {
        const pr = Math.min(1, S.tposeHold / 2);
        c.fillStyle = '#2a2436'; c.fillRect(W / 2 - 300, 340, 600, 26); c.fillStyle = '#e2b85c'; c.fillRect(W / 2 - 300, 340, 600 * pr, 26);
        if (S.msg) text(c, S.msg, W / 2, 400, 28, '#ff9a70');
      }
      p.button('treach', W / 2 - 220, 450, 440, 100, xr ? 'Capture T-pose' : 'Continue', () => captureTpose(true), { size: 38 });
      p.button('defreach', W / 2 - 220, 580, 440, 80, 'Use default reach (0.65 m)', () => finishCalib2(0.65), { size: 30 });
    } else if (S.mode === 'menu') {
      text(c, '拳 Dodge Dojo', W / 2, 74, 70, '#e2b85c', FONTS.brush);
      text(c, `Eye ${S.H.toFixed(2)} m · Reach ${S.reach.toFixed(2)} m · Lifetime ${Math.round(totals.kcal || 0)} kcal`, W / 2, 140, 26, '#bfb4d4');
      const bw = 440, bh = 150;
      ROUTINES.forEach((r, i) => {
        const x = i % 2 ? W / 2 + 15 : W / 2 - bw - 15, y = 185 + Math.floor(i / 2) * (bh + 22);
        p.button('r' + i, x, y, bw, bh, '', () => startRoutine(r), { bg: '#241c30', hoverBg: '#3c2c4a' });
        text(c, r.cn, x + 52, y + bh / 2, 64, '#e2b85c', FONTS.brush);
        text(c, `${i + 1}. ${r.name}`, x + 100, y + 38, 34, '#ffffff', FONTS.sans, 'left', bw - 110);
        text(c, `${r.bpm} BPM · ${Number.isFinite(r.bars) ? fmtTime(r.bars * 4 * 60 / r.bpm) : '∞'}`, x + 100, y + 78, 24, '#cfc4e0', FONTS.sans, 'left', bw - 110);
        const b = best[r.id];
        text(c, b ? `Best ${b.score} · ${b.grade} · ${b.kcal} kcal` : r.desc, x + 100, y + 114, 22, b ? '#ffd27a' : '#9a90b0', FONTS.sans, 'left', bw - 110);
      });
      p.button('recal', W / 2 - 200, 545, 400, 70, 'Recalibrate', () => { S.sample = 0; setMode('calib1'); }, { size: 30 });
      text(c, 'Red pad = left fist · blue = right · ● jab  → hook  ↑ uppercut · shield = both forearms up', W / 2, 650, 23, '#d8cfe8', FONTS.sans, 'center', 960);
      text(c, ctx.isXR() ? 'Stay on the mat (1 m ring). Right B quits a routine.' : 'Desktop: C crouch · A/D lean · LMB punch · RMB/F block · R quit · 1–4 start', W / 2, 690, 23, '#ffb070', FONTS.sans, 'center', 960);
    } else if (S.mode === 'results') {
      const r = S.routine;
      text(c, S.defeated ? `${r.name} · spirit broken` : `${r.name} · complete`, W / 2, 70, 40, '#ffffff');
      text(c, grade(), 170, 230, 170, '#e2b85c', FONTS.latin);
      text(c, String(stats.score), 560, 190, 110, '#ffffff', FONTS.sans);
      if (S.newBest) text(c, 'NEW PERSONAL BEST', 560, 270, 34, '#ffd27a');
      const lines = [
        [`Accuracy ${(accuracy() * 100).toFixed(0)}%`, `Max combo ${stats.maxCombo}`],
        [`Punches ${stats.punchHits}/${stats.punches} (${stats.great} great)`, `Dodges ${stats.dodges}/${stats.obstacles}`],
        [`Blocks ${stats.blocks}/${stats.shields} · Hits taken ${stats.hitsTaken}`, `${stats.kcal.toFixed(1)} kcal in ${fmtTime(stats.time)}`],
      ];
      lines.forEach(([a, b], i) => { text(c, a, 80, 350 + i * 52, 30, '#e8def5', FONTS.sans, 'left', 460); text(c, b, 560, 350 + i * 52, 30, '#e8def5', FONTS.sans, 'left', 400); });
      const pb = best[r.id];
      text(c, pb ? `Personal best ${pb.score} (${pb.grade}) · calories estimated for ${KG} kg` : '', W / 2, 520, 22, '#9a90b0');
      p.button('retry', W / 2 - 430, 580, 400, 110, 'Again', () => startRoutine(S.routine), { size: 40 });
      p.button('menu', W / 2 + 30, 580, 400, 110, 'Routines', () => setMode('menu'), { size: 40 });
    }
  }
  function drawHud(c, W, H) {
    roundRect(c, 4, 4, W - 8, H - 8, 24); c.fillStyle = 'rgba(14,10,22,0.72)'; c.fill();
    if (S.songT < 0) {
      const beatsLeft = Math.ceil(-S.songT / chart.spb);
      text(c, beatsLeft <= 4 ? String(beatsLeft) : S.routine.name, W / 2, H / 2, beatsLeft <= 4 ? 150 : 80, '#e2b85c', beatsLeft <= 4 ? FONTS.sans : FONTS.latin);
      return;
    }
    text(c, String(stats.score), 40, 95, 96, '#ffffff', FONTS.sans, 'left', 380);
    text(c, `combo ${stats.combo}`, 470, 70, 52, stats.combo >= 8 ? '#ffd27a' : '#e8def5', FONTS.sans, 'left', 300);
    text(c, `×${mult()}`, 470, 135, 50, '#e2b85c', FONTS.sans, 'left', 200);
    text(c, `${stats.kcal.toFixed(1)} kcal`, W - 40, 70, 44, '#ffb070', FONTS.sans, 'right', 300);
    if (S.routine.hearts) {
      for (let i = 0; i < S.routine.hearts; i++) { c.fillStyle = i < S.hearts ? '#ff4a5a' : '#3a3046'; c.beginPath(); c.arc(W - 60 - i * 50, 140, 17, 0, Math.PI * 2); c.fill(); }
    } else text(c, fmtTime(Math.max(0, S.endT - S.songT)), W - 40, 140, 44, '#cfc4e0', FONTS.sans, 'right', 300);
    const pr = Number.isFinite(S.endT) ? Math.min(1, S.songT / S.endT) : (S.songT % 60) / 60;
    c.fillStyle = '#2a2436'; c.fillRect(40, H - 50, W - 80, 14); c.fillStyle = '#e2b85c'; c.fillRect(40, H - 50, (W - 80) * pr, 14);
  }

  function beginSample() { if (S.sample > 0) return; S.sample = ctx.isXR() ? 0.5 : 0.01; S.sumX = S.sumY = S.sumZ = 0; S.n = 0; panel.markDirty(); }
  function useSaved() { S.H = saved.h; S.reach = saved.reach; S.cx = head.x; S.cz = head.z; track.position.set(S.cx, 0, S.cz); if (!ctx.isXR()) useDesktopCalib(); buildHeightGeos(); setMode('menu'); }
  function captureTpose(fromButton) {
    if (!ctx.isXR()) { finishCalib2(0.65); return; }
    const L = input.left, R = input.right;
    if (!L.present || !R.present) { S.msg = 'Both controllers needed'; panel.markDirty(); return; }
    const span = Math.hypot(L.gripPos.x - R.gripPos.x, L.gripPos.z - R.gripPos.z);
    if (span < 0.9) { S.msg = 'Spread your arms wider (out to the sides)'; panel.markDirty(); return; }
    finishCalib2((span + 0.1 - 0.36) / 2);
  }

  function updateCalib(dt) {
    if (S.mode === 'calib1') {
      if (S.sample > 0) {
        S.sumX += head.x; S.sumY += head.y; S.sumZ += head.z; S.n++;
        S.sample -= dt;
        if (S.sample <= 0) { S.sample = 0; if (!ctx.isXR()) { useDesktopCalib(); setMode('calib2'); } else finishCalib1(); }
      }
    } else if (S.mode === 'calib2' && ctx.isXR()) {
      const L = input.left, R = input.right;
      const ok = L.present && R.present && Math.hypot(L.gripPos.x - R.gripPos.x, L.gripPos.z - R.gripPos.z) > 1.0 && Math.abs(L.gripPos.y - R.gripPos.y) < 0.3 && L.gripPos.y > S.H - 0.6;
      const prev = S.tposeHold;
      S.tposeHold = ok ? S.tposeHold + dt : 0;
      if (Math.floor(prev * 8) !== Math.floor(S.tposeHold * 8)) panel.markDirty();
      if (S.tposeHold >= 2) { S.tposeHold = 0; captureTpose(false); }
    }
  }

  function anyTriggerDown() { return input.left.triggerDown || input.right.triggerDown; }

  const debug = {
    autopilot: null, hold: null,
    get mode() { return S.mode; }, get songT() { return S.songT; }, get state() { return S; },
    stats, log, music, chart, items, fists,
    start(id) { if (S.mode === 'calib1' || S.mode === 'calib2') { useDesktopCalib(); } startRoutine(ROUTINES.find(r => r.id === id) ?? ROUTINES[0]); },
    finish() { if (S.mode === 'play') finish(); },
    calibrateDesktop() { useDesktopCalib(); setMode('menu'); },
    // tests: stop the chart and inject one event that arrives `inSec` from now (snapped to the beat)
    sandbox() { chart.head = chart.tail; chart.nextBar = 1e9; for (const it of items) release(it); },
    inject(kind, side = 0, sub = 0, hole = 0, inSec = 1.5) {
      const beat = Math.ceil((S.songT + inSec) / chart.spb);
      spawn({ t: beat * chart.spb, kind, side, sub, hole, speed: S.routine.speed });
      return beat * chart.spb;
    },
    get audioStopped() { return music.disposed; },
  };

  placePanels();
  setMode('calib1');

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    _debug: debug,
    update(dt) {
      updateHeadAndFists(dt);
      const beatPhase = S.mode === 'play' ? (((S.songT / chart.spb) % 1) + 1) % 1 : 0;
      if (S.mode === 'play') {
        updatePlay(dt);
        if (input.desktop && !ctx.isXR()) { deskHudTimer -= dt; if (deskHudTimer <= 0) { deskHudTimer = 0.25; ctx.setHud(`Score <b>${stats.score}</b> · combo ${stats.combo} ×${mult()} · ${stats.kcal.toFixed(1)} kcal${S.routine.hearts ? ' · spirit ' + S.hearts : ''} · C crouch · A/D lean · LMB punch · RMB block · R quit`); } }
        hudTimer -= dt; if (S.songT < 0.1 || hudTimer <= 0) { hudTimer = 0.2; hud.markDirty(); }
        hud.redraw();
      } else {
        S.songT = music.update(dt);
        const hit = pointer.update(input.main, { show: true });
        let clicked = false;
        if (hit?.button && input.main.triggerDown) clicked = pointer.click(hit);
        if (!clicked && (S.mode === 'calib1') && anyTriggerDown()) beginSample();
        else if (!clicked && S.mode === 'calib2' && anyTriggerDown() && (!ctx.isXR() || (input.left.trigger > 0.5 && input.right.trigger > 0.5))) captureTpose(false);
        updateCalib(dt);
        if (S.mode === 'menu' && input.desktop) for (let i = 0; i < 4; i++) if (input.keyDown('Digit' + (i + 1))) startRoutine(ROUTINES[i]);
        if (S.mode === 'results' && input.main.a) startRoutine(S.routine);
        if (input.desktop && !ctx.isXR()) ctx.setHud(S.mode === 'menu' ? 'Aim with the mouse, click a routine (or press 1–4). C crouch · A/D lean' : S.mode === 'results' ? 'Click Again / Routines (E = again)' : 'Click to continue');
      }
      env.update(beatPhase, S.mode === 'play' && S.songT > 0 ? 1 : 0.15);
      updateSensei(dt, beatPhase);
      updateBoundary();
      fx.update(dt);
    },
    onXRStart() { if (S.mode === 'play') finish({ aborted: true }); S.sample = 0; setMode('calib1'); },
    onXREnd() { if (S.mode === 'play') finish({ aborted: true }); useDesktopCalib(); setMode('menu'); },
    dispose() {
      music.dispose();
      fx.dispose();
      for (const f of fists) f.glove.removeFromParent();
      if (!ctx.isXR()) camera.position.set(0, DESK_EYE, 0);
      ctx.setHud('');
      for (const g of wallGeos) g.dispose();
    },
  };
}

// ── helpers: geometry & textures ─────────────────────────────────────────

function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function makePadGeo(r, depth) {
  const front = new THREE.CircleGeometry(r, 32); front.translate(0, 0, depth / 2);
  const side = new THREE.CylinderGeometry(r, r * 1.06, depth, 32, 1, true); side.rotateX(Math.PI / 2);
  const back = new THREE.CircleGeometry(r * 1.06, 32); back.rotateY(Math.PI); back.translate(0, 0, -depth / 2);
  for (const g of [side, back]) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.015, 0.015); }
  const parts = [front, side, back].map(g => { const n = g.toNonIndexed(); g.dispose(); return n; });
  const out = mergeGeometries(parts); parts.forEach(p => p.dispose());
  return out;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function padTexture(side, sub) {
  return canvasTex(256, 256, (x) => {
    const main = side < 0 ? '#e0372c' : '#2f6ae0', dark = side < 0 ? '#4a0c0c' : '#0c1a44', light = side < 0 ? '#ffa090' : '#a0c4ff';
    x.fillStyle = dark; x.fillRect(0, 0, 256, 256);
    const g = x.createRadialGradient(100, 96, 10, 128, 128, 128); g.addColorStop(0, light); g.addColorStop(0.45, main); g.addColorStop(1, dark);
    x.fillStyle = g; x.beginPath(); x.arc(128, 128, 125, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 8; x.beginPath(); x.arc(128, 128, 110, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.lineCap = 'round'; x.lineJoin = 'round';
    if (sub === 0) {
      x.lineWidth = 14; x.beginPath(); x.arc(128, 128, 60, 0, Math.PI * 2); x.stroke();
      x.beginPath(); x.arc(128, 128, 26, 0, Math.PI * 2); x.fill();
    } else {
      x.save(); x.translate(128, 128); x.rotate(sub === 2 ? -Math.PI / 2 : side < 0 ? 0 : Math.PI);
      x.lineWidth = 28;
      if (sub === 1) { x.beginPath(); x.arc(-10, 60, 80, -Math.PI * 0.85, -Math.PI * 0.35); x.stroke(); x.beginPath(); x.moveTo(78, -6); x.lineTo(18, -48); x.lineTo(30, 26); x.closePath(); x.fill(); }
      else { x.beginPath(); x.moveTo(-64, 0); x.lineTo(36, 0); x.stroke(); x.beginPath(); x.moveTo(76, 0); x.lineTo(20, -50); x.lineTo(20, 50); x.closePath(); x.fill(); }
      x.restore();
    }
    x.font = `bold 30px ${FONTS.sans}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = 'rgba(255,255,255,0.85)';
    x.fillText(side < 0 ? 'L' : 'R', 128, 214);
  });
}

function shieldTexture() {
  return canvasTex(256, 256, (x) => {
    x.fillStyle = '#3a2410'; x.fillRect(0, 0, 256, 256);
    const g = x.createRadialGradient(110, 100, 8, 128, 128, 128); g.addColorStop(0, '#ffe7a0'); g.addColorStop(0.5, '#c8902a'); g.addColorStop(1, '#5a3810');
    x.fillStyle = g; x.beginPath(); x.arc(128, 128, 125, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#5a3810'; x.lineWidth = 6;
    for (const r of [112, 86]) { x.beginPath(); x.arc(128, 128, r, 0, Math.PI * 2); x.stroke(); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.fillStyle = '#4a2c0c'; x.beginPath(); x.arc(128 + Math.cos(a) * 99, 128 + Math.sin(a) * 99, 5, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#3a1c06'; x.font = `110px ${FONTS.brush}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('守', 128, 134);
  });
}

function paperTexture() {
  return canvasTex(256, 256, (x) => {
    x.fillStyle = '#efe0c0'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = 'rgba(150,120,80,0.15)'; x.lineWidth = 1;
    for (let i = 0; i < 120; i++) { const a = Math.random() * 256, b = Math.random() * 256; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (Math.random() - 0.5) * 40, b + (Math.random() - 0.5) * 40); x.stroke(); }
    x.fillStyle = '#6a3a22';
    x.fillRect(0, 0, 256, 9); x.fillRect(0, 0, 9, 256); x.fillRect(124, 0, 8, 256); x.fillRect(0, 124, 256, 8);
  });
}

function matTexture() {
  return canvasTex(512, 512, (x, W, H) => {
    x.fillStyle = '#b8a768'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(90,80,30,0.25)'; x.lineWidth = 2;
    for (let y = 0; y < H; y += 6) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
    x.strokeStyle = '#2a2a24'; x.lineWidth = 22; x.strokeRect(11, 11, W - 22, H - 22);
    x.strokeStyle = 'rgba(140,30,20,0.85)'; x.lineWidth = 6;
    x.beginPath(); x.moveTo(W / 2 - 30, H / 2); x.lineTo(W / 2 + 30, H / 2); x.moveTo(W / 2, H / 2 - 30); x.lineTo(W / 2, H / 2 + 30); x.stroke();
    // footprints
    x.fillStyle = 'rgba(60,40,20,0.35)';
    for (const s of [-1, 1]) { x.beginPath(); x.ellipse(W / 2 + s * 62, H / 2 + 40, 22, 46, s * 0.1, 0, Math.PI * 2); x.fill(); }
  });
}

function bambooGeo(len, r, horizontal) {
  const parts = [];
  parts.push(colorize(new THREE.CylinderGeometry(r, r, len, 10, 1, false), '#9cb04a'));
  for (let y = -len / 2 + 0.25; y < len / 2; y += 0.42) parts.push(colorize(new THREE.CylinderGeometry(r * 1.13, r * 1.13, 0.03, 10), '#6d7a2c', { y }));
  // red warning wraps near the head zone
  parts.push(colorize(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.12, 10), '#c02a20', { y: horizontal ? -0.9 : 0 }));
  parts.push(colorize(new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.12, 10), '#c02a20', { y: horizontal ? 0.9 : 0.4 }));
  let g = mergeGeometries(parts); parts.forEach(p => p.dispose());
  if (horizontal) g.rotateZ(Math.PI / 2); else g.translate(0, len / 2, 0);
  return g;
}

function makeLogGeo() {
  // origin at the pivot; hangs down by LOG_L
  const parts = [];
  parts.push(colorize(new THREE.CylinderGeometry(LOG_R, LOG_R, LOG_HALF * 2, 12), '#7a5232', { y: -LOG_L, rz: Math.PI / 2 }));
  for (const s of [-1, 1]) {
    parts.push(colorize(new THREE.CylinderGeometry(LOG_R * 1.08, LOG_R * 1.08, 0.05, 12), '#3a3438', { x: s * 0.24, y: -LOG_L, rz: Math.PI / 2 }));
    parts.push(colorize(new THREE.CylinderGeometry(0.012, 0.012, LOG_L, 4), '#d8c8a0', { x: s * 0.24, y: -LOG_L / 2 }));
    parts.push(colorize(new THREE.CircleGeometry(LOG_R * 0.98, 12), '#d8b070', { x: s * (LOG_HALF + 0.001), y: -LOG_L, ry: s * Math.PI / 2 }));
  }
  const g = mergeGeometries(parts); parts.forEach(p => p.dispose());
  return g;
}

function makeFrameGeo(py) {
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(colorize(new THREE.CylinderGeometry(0.05, 0.06, py, 8), '#5a3a26', { x: s * 1.35, y: py / 2 }));
    parts.push(colorize(new THREE.BoxGeometry(0.4, 0.08, 0.4), '#3a2a20', { x: s * 1.35, y: 0.04 }));
  }
  parts.push(colorize(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8), '#5a3a26', { y: py, rz: Math.PI / 2 }));
  const g = mergeGeometries(parts); parts.forEach(p => p.dispose());
  return g;
}

// Keyhole silhouette (head circle on shoulders/torso), tilted and lowered per pose.
function holePoly(hole, H) {
  const low = hole === HOLE.DUCK || hole === HOLE.LOWLEFT || hole === HOLE.LOWRIGHT;
  const E = low ? H - 0.42 : H - 0.02;
  const off = hole === HOLE.LEFT || hole === HOLE.LOWLEFT ? -0.3 : hole === HOLE.RIGHT || hole === HOLE.LOWRIGHT ? 0.3 : 0;
  const b0 = 0.12, tw = 0.3, nw = 0.12, rH = HOLE_HEAD_R, sy = E - 0.27;
  const phi = -Math.asin(off / (E - b0));
  const pts = [[-tw, b0], [tw, b0], [tw, sy]];
  const a0 = Math.atan2(-Math.sqrt(rH * rH - nw * nw), nw), a1 = Math.PI - a0;
  for (let i = 0; i <= 16; i++) { const a = a0 + (a1 - a0) * i / 16; pts.push([Math.cos(a) * rH, E + Math.sin(a) * rH]); }
  pts.push([-tw, sy]);
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const out = new Float32Array(pts.length * 2);
  pts.forEach(([x, y], i) => { const dy = y - b0; out[i * 2] = x * cs - dy * sn; out[i * 2 + 1] = b0 + x * sn + dy * cs; });
  return out;
}

function inHole(poly, x, y) {
  const n = poly.length / 2;
  let inside = false, minD = Infinity;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2], yi = poly[i * 2 + 1], xj = poly[j * 2], yj = poly[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    const ex = xj - xi, ey = yj - yi, L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((x - xi) * ex + (y - yi) * ey) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (xi + ex * t), dy = y - (yi + ey * t), d = dx * dx + dy * dy;
    if (d < minD) minD = d;
  }
  return inside && Math.sqrt(minD) >= HOLE_MARGIN;
}

function makeWallGeo(poly, H) {
  const W = 1.8, top = H + 0.8;
  const shape = new THREE.Shape([new THREE.Vector2(-W, 0), new THREE.Vector2(W, 0), new THREE.Vector2(W, top), new THREE.Vector2(-W, top)]);
  const hp = [];
  for (let i = 0; i < poly.length; i += 2) hp.push(new THREE.Vector2(poly[i], poly[i + 1]));
  shape.holes.push(new THREE.Path(hp));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -0.025);
  return g;
}
