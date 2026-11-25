import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Panel, Pointer, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { generate, makeSampler, COURSES, VILLAGES, PERCH, HALF, mulberry, RIVER } from './terrain.js';
import { buildWorld, billboardMat, canvasTex } from './world.js';
import { FlightModel } from './model.js';
import { Wings } from './wings.js';
import { Hud } from './hud.js';
import { FlightAudio } from './audio.js';

// Crane Flight (鹤): arm-driven gliding over a karst landscape.
// Arms out = glide, tilt the line between your hands = bank, sweep back = dive,
// flap (fast downward strokes with arms out) = lift/thrust, both hands forward = flare/brake.

const RING_R = 5.6;
const FEATHER_COUNT = 40;
const SAVE_BEST = (id) => `flight:best:${id}`;
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export async function create(ctx) {
  const { scene, input, rig, camera } = ctx;
  camera.far = 9000; camera.updateProjectionMatrix();

  // ── World ──────────────────────────────────────────────
  const gen = generate();
  const sampler = makeSampler(gen.height);
  const world = buildWorld(scene, gen, sampler);
  const perchY = world.perchY;

  // ── Rings (instanced lacquer frames + glowing lanterns) ─
  const MAXR = Math.max(...COURSES.map(c => c.pts.length));
  const ringGeo = new THREE.TorusGeometry(RING_R, 0.3, 8, 40);
  const ringFrames = new THREE.InstancedMesh(ringGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a0804 }), MAXR);
  const lanternParts = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const g = new THREE.SphereGeometry(0.55, 10, 8).scale(1, 1.25, 1).translate(Math.cos(a) * RING_R, Math.sin(a) * RING_R - 0.75, 0);
    lanternParts.push(g);
  }
  const lanternGeo = mergeGeometries(lanternParts);
  const ringLanterns = new THREE.InstancedMesh(lanternGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAXR);
  ringFrames.frustumCulled = ringLanterns.frustumCulled = false;
  for (let i = 0; i < MAXR; i++) { ringFrames.setColorAt(i, new THREE.Color(0xb3241a)); ringLanterns.setColorAt(i, new THREE.Color(0xffb050)); }
  ringFrames.count = ringLanterns.count = 0;
  scene.add(ringFrames, ringLanterns);
  const nextRing = new THREE.Mesh(new THREE.TorusGeometry(RING_R + 0.35, 0.18, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  nextRing.visible = false; scene.add(nextRing);
  const ringGlowTex = canvasTex(128, 128, (c, W) => {
    const g = c.createRadialGradient(W / 2, W / 2, W * 0.3, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(255,200,90,0)'); g.addColorStop(0.55, 'rgba(255,190,80,0.55)'); g.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  });
  const ringGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), billboardMat(ringGlowTex, { additive: true, opacity: 1, color: 0xffc070 }), 1);
  ringGlow.frustumCulled = false; ringGlow.visible = false; scene.add(ringGlow);

  const courses = COURSES.map(c => {
    const centers = c.pts.map(p => new THREE.Vector3(p[0], p[2], p[1]));
    const normals = centers.map((p, i) => {
      const a = centers[Math.max(0, i - 1)], b = centers[Math.min(centers.length - 1, i + 1)];
      const n = new THREE.Vector3().subVectors(b, a); n.y *= 0.5; return n.normalize();
    });
    return { ...c, centers, normals };
  });
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), Z = new THREE.Vector3(0, 0, 1);
  function layoutRings(course) {
    if (!course) { ringFrames.count = ringLanterns.count = 0; return; }
    ringFrames.count = ringLanterns.count = course.centers.length;
    course.centers.forEach((p, i) => {
      _q.setFromUnitVectors(Z, course.normals[i]); _s.setScalar(1);
      _m4.compose(p, _q, _s); ringFrames.setMatrixAt(i, _m4); ringLanterns.setMatrixAt(i, _m4);
    });
    ringFrames.instanceMatrix.needsUpdate = ringLanterns.instanceMatrix.needsUpdate = true;
    colorRings(course, 0);
  }
  function colorRings(course, next) {
    for (let i = 0; i < course.centers.length; i++) {
      const passed = i < next, last = i === course.centers.length - 1;
      _c.setHex(passed ? 0x4a4a4a : last ? 0xe8b840 : 0xb3241a); ringFrames.setColorAt(i, _c);
      _c.setHex(passed ? 0x5a4a3a : 0xffb050); ringLanterns.setColorAt(i, _c);
    }
    ringFrames.instanceColor.needsUpdate = ringLanterns.instanceColor.needsUpdate = true;
  }

  // ── Golden feathers ─────────────────────────────────────
  const feathers = [];
  {
    const rnd = mulberry(2024);
    const tall = gen.peaks.filter(p => !p.flat && Math.max(Math.abs(p.x), Math.abs(p.z)) < HALF - 250).sort((a, b) => b.h - a.h);
    for (let i = 0; i < 16 && i < tall.length; i++) { const p = tall[i * 2 % tall.length]; feathers.push([p.x, sampler.groundY(p.x, p.z) + 14, p.z]); }
    for (const v of VILLAGES) feathers.push([v.x + 10, sampler.groundY(v.x, v.z) + 170 + rnd() * 90, v.z - 10]);
    for (let i = 1; i < RIVER.length - 1 && feathers.length < 32; i++) {
      const [ax, az] = RIVER[i], [bx, bz] = RIVER[i + 1];
      const x = (ax + bx) / 2, z = (az + bz) / 2;
      if (Math.max(Math.abs(x), Math.abs(z)) > HALF - 200) continue;
      feathers.push([x, 9 + rnd() * 6, z]);
    }
    while (feathers.length < FEATHER_COUNT) {
      const x = (rnd() * 2 - 1) * (HALF - 300), z = (rnd() * 2 - 1) * (HALF - 300);
      const g = sampler.surfaceY(x, z);
      if (g > 40) continue;
      feathers.push([x, g + 30 + rnd() * 40, z]);
    }
  }
  const featherGeo = (() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, -1); shape.quadraticCurveTo(0.38, -0.2, 0.12, 1); shape.quadraticCurveTo(0, 1.1, -0.1, 1); shape.quadraticCurveTo(-0.34, 0, 0, -1);
    const g = new THREE.ShapeGeometry(shape, 6); g.scale(1.1, 1.1, 1.1); return g;
  })();
  const featherMesh = new THREE.InstancedMesh(featherGeo, new THREE.MeshBasicMaterial({ color: 0xffcf4a, side: THREE.DoubleSide, fog: true }), FEATHER_COUNT);
  featherMesh.frustumCulled = false; featherMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const featherGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), billboardMat(canvasTex(64, 64, (c, W) => {
    const g = c.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    g.addColorStop(0, 'rgba(255,230,150,0.9)'); g.addColorStop(0.3, 'rgba(255,200,90,0.35)'); g.addColorStop(1, 'rgba(255,180,60,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, W);
  }), { additive: true, color: 0xffd080 }), FEATHER_COUNT);
  featherGlow.frustumCulled = false;
  scene.add(featherMesh, featherGlow);
  let collected = new Set(ctx.load('flight:feathers', []));
  function layoutFeatherGlow() {
    feathers.forEach((f, i) => {
      const s = collected.has(i) ? 0 : 9;
      _m4.makeScale(s, s, 1); _m4.setPosition(f[0], f[1], f[2]); featherGlow.setMatrixAt(i, _m4);
    });
    featherGlow.instanceMatrix.needsUpdate = true;
  }
  layoutFeatherGlow();
  const _fe = new THREE.Euler(), _fp = new THREE.Vector3();
  function animateFeathers(t) {
    for (let i = 0; i < FEATHER_COUNT; i++) {
      const f = feathers[i], s = collected.has(i) ? 0 : 1.6;
      _fe.set(0.3 * Math.sin(t * 1.3 + i), t * 1.6 + i, 0.25); _q.setFromEuler(_fe);
      _fp.set(f[0], f[1] + Math.sin(t * 1.1 + i * 0.7) * 0.6, f[2]); _s.setScalar(s);
      _m4.compose(_fp, _q, _s); featherMesh.setMatrixAt(i, _m4);
    }
    featherMesh.instanceMatrix.needsUpdate = true;
  }

  // ── Player rig, wings, HUD, audio ──────────────────────
  rig.position.set(PERCH.x, perchY, PERCH.z);
  const wings = new Wings(rig);
  const hud = new Hud(rig, camera);
  const audio = new FlightAudio(ctx.audio);
  const model = new FlightModel();

  const settings = Object.assign({ vignette: 1, tunnel: false }, ctx.load('flight:comfort', {}));
  const VIG_LEVELS = [0, 0.75, 1.3];
  const bests = Object.fromEntries(COURSES.map(c => [c.id, ctx.load(SAVE_BEST(c.id), null)]));

  const S = {
    state: 'perch',        // perch | ready | flying | landing | landed
    mode: null,            // null = free flight, else course object
    ringIdx: 0, time: 0, running: false, finished: false, lastTime: null, newBest: false,
    msg: '', msgT: 0, msgColor: '#ffd77a',
    boostT: 0, slide: 0, slideDir: new THREE.Vector3(), takeoff: 0,
    fade: 0, fadeTarget: 0, onFaded: null,
    stallCue: 0, flapCue: 0, sessionFeathers: 0, grace: 0,
  };
  function say(msg, secs = 2.5, color = '#ffd77a') { S.msg = msg; S.msgT = secs; S.msgColor = color; }

  // ── Course select panel at the perch ───────────────────
  const pointer = new Pointer(scene);
  pointer.onClick = () => audio.click();
  const panel = new Panel({
    width: 1.3, height: 0.92, px: 1024,
    draw: (c, W, H, p) => {
      roundRect(c, 6, 6, W - 12, H - 12, 36);
      c.fillStyle = 'rgba(14,22,30,0.88)'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#e2b85c'; c.stroke();
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#e2b85c'; c.font = `92px ${FONTS.brush}`; c.fillText('鹤', 110, 92);
      c.fillStyle = '#f1e6cf'; fitText(c, 'Crane Flight', W / 2 + 30, 70, 600, 64, FONTS.latin);
      c.fillStyle = '#a8c0c8'; fitText(c, `Golden feathers ${collected.size}/${FEATHER_COUNT}`, W / 2 + 30, 128, 600, 30, FONTS.sans);
      if (S.state === 'ready') {
        const name = S.mode ? S.mode.name : 'Free Flight';
        c.fillStyle = '#ffd77a'; fitText(c, `Ready: ${name}`, W / 2, 230, W - 80, 58, FONTS.sans);
        c.fillStyle = '#f1e6cf';
        const lines = ['Spread your arms wide like wings,', 'then flap down hard (or pull the trigger) to leap.', 'Tilt your arms to turn, sweep back to dive,', 'reach forward to brake. A/B: back to the perch.'];
        lines.forEach((l, i) => fitText(c, l, W / 2, 320 + i * 54, W - 80, 36, FONTS.sans));
        p.button('back', W / 2 - 160, H - 130, 320, 86, 'Back', () => { S.state = 'perch'; p.markDirty(); });
        return;
      }
      let y = 175;
      p.button('free', 60, y, W - 120, 84, 'Free Flight  ·  explore & collect feathers', () => select(null), { size: 34 });
      y += 100;
      for (const co of courses) {
        const b = bests[co.id];
        p.button(co.id, 60, y, W - 120, 84, `${co.cn}  ${co.name}  ·  ${co.pts.length} rings  ·  best ${b ? fmt(b) : '—'}`, () => select(co), { size: 34 });
        y += 100;
      }
      y += 10;
      c.fillStyle = '#cfe4ea'; c.textAlign = 'left'; fitText(c, 'Vignette', 70, y + 38, 200, 32, FONTS.sans); c.textAlign = 'center';
      ['Off', 'Low', 'High'].forEach((l, i) => p.button('vig' + i, 230 + i * 130, y, 120, 76, l, () => { settings.vignette = i; ctx.save('flight:comfort', settings); }, { active: settings.vignette === i, size: 30 }));
      p.button('tun', 640, y, 230, 76, settings.tunnel ? 'Tunnel: On' : 'Tunnel: Off', () => { settings.tunnel = !settings.tunnel; ctx.save('flight:comfort', settings); }, { active: settings.tunnel, size: 30 });
      p.button('exit', W - 140, y, 90, 76, 'Exit', () => ctx.exit(), { size: 28 });
    },
  });
  panel.mesh.position.set(PERCH.x - 1.15, perchY + 1.3, PERCH.z - 1.25);
  panel.mesh.rotation.y = 0.75;
  scene.add(panel.mesh);
  pointer.panels.push(panel);

  function select(course) {
    S.mode = course; S.state = 'ready';
    layoutRings(course);
    S.ringIdx = 0; S.time = 0; S.running = false; S.finished = false; S.newBest = false;
    panel.markDirty();
  }

  // ── Arm reading ────────────────────────────────────────
  const headL = new THREE.Vector3(), HL = new THREE.Vector3(), HR = new THREE.Vector3(), SL = new THREE.Vector3(), SR = new THREE.Vector3(), SC = new THREE.Vector3();
  const prevHL = new THREE.Vector3(), prevHR = new THREE.Vector3(), prevHead = new THREE.Vector3();
  const fwd = new THREE.Vector3(), rgt = new THREE.Vector3(), back = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const ctl = { spread: 1, sweep: 0, pitch: 0, brake: 0, bank: 0, flap: 0 };
  let bodyYaw = 0, haveBody = false, armSpan = 1.45, havePrev = false, flapS = 0, flapLv = 0, flapRv = 0;
  let deskPhase = 0, deskAmp = 0, deskBank = 0, deskFo = 0;
  let debugArms = null, debugHud = false;

  function headYawLocal() {
    tmp.set(0, 0, -1).applyQuaternion(camera.quaternion);
    return Math.atan2(-tmp.x, -tmp.z);
  }
  function setFrame(yaw) {
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); rgt.set(Math.cos(yaw), 0, -Math.sin(yaw)); back.copy(fwd).negate();
  }
  function bodyPoint(out, x, y, z) { return out.copy(headL).addScaledVector(rgt, x).addScaledVector(fwd, z).y += y, out; }

  function readArms(dt) {
    headL.copy(camera.position);
    const hy = headYawLocal();
    const desktop = input.desktop && !ctx.isXR();
    let shoulderFwd = -0.04, shoulderDrop = 0.24;
    if (debugArms) {
      const by = debugArms.yaw ?? hy;
      setFrame(by); bodyYaw = by; haveBody = true;
      bodyPoint(HL, debugArms.l[0], debugArms.l[1], debugArms.l[2]);
      bodyPoint(HR, debugArms.r[0], debugArms.r[1], debugArms.r[2]);
    } else if (desktop) {
      bodyYaw = hy; haveBody = true; setFrame(hy);
      const W = input.key('KeyW') || (S.state === 'ready' && input.mouse.left);
      deskAmp += ((W ? 0.34 : 0) - deskAmp) * Math.min(1, dt * 6);
      if (deskAmp > 0.01) deskPhase += dt * Math.PI * 2 * 1.4; else deskPhase = 0;
      const bk = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
      deskBank += (bk - deskBank) * Math.min(1, dt * 4);
      const p = input.pitch;
      let fo = p < 0 ? Math.max(-0.3, p * 0.55) : Math.min(0.28, p * 0.5);
      if (input.key('KeyS')) fo = 0.5;
      deskFo += (fo - deskFo) * Math.min(1, dt * 5);
      const tuck = input.key('Space') ? 0.3 : 1;
      const lat = 0.22 + 0.7 * tuck, yy = -0.5 + deskAmp * Math.cos(deskPhase);
      shoulderFwd = 0.35; shoulderDrop = 0.5;
      bodyPoint(HL, -lat, yy + 0.24 * deskBank, shoulderFwd + deskFo + 0.04);
      bodyPoint(HR, lat, yy - 0.24 * deskBank, shoulderFwd + deskFo + 0.04);
    } else {
      const L = input.left, R = input.right;
      if (L.present) { HL.copy(L.gripPos); rig.worldToLocal(HL); }
      if (R.present) { HR.copy(R.gripPos); rig.worldToLocal(HR); }
      let target = hy;
      if (L.present && R.present) {
        const rx = HR.x - HL.x, rz = HR.z - HL.z, sep = Math.hypot(rx, rz);
        const armYaw = Math.atan2(-rz, rx);
        const diff = wrap(armYaw - hy);
        let w = clamp01((sep - 0.45) / 0.35);
        if (Math.abs(diff) > 1.5) w = 0;
        target = hy + w * diff;
      } else {
        // a missing controller: synthesize a mirrored hand so you can still glide
        setFrame(bodyYaw);
        if (!L.present && R.present) { tmp.subVectors(HR, headL); HL.copy(headL).addScaledVector(rgt, -tmp.dot(rgt)).addScaledVector(fwd, tmp.dot(fwd)).y = HR.y; }
        else if (!R.present && L.present) { tmp.subVectors(HL, headL); HR.copy(headL).addScaledVector(rgt, -tmp.dot(rgt)).addScaledVector(fwd, tmp.dot(fwd)).y = HL.y; }
        else { bodyPoint(HL, -0.7, -0.3, 0.1); bodyPoint(HR, 0.7, -0.3, 0.1); }
      }
      if (!haveBody) { bodyYaw = target; haveBody = true; }
      bodyYaw += wrap(target - bodyYaw) * Math.min(1, dt * 5);
      setFrame(bodyYaw);
    }
    // shoulders
    SC.copy(headL).addScaledVector(fwd, shoulderFwd); SC.y -= shoulderDrop;
    SL.copy(SC).addScaledVector(rgt, -0.19); SR.copy(SC).addScaledVector(rgt, 0.19);
    // controls
    tmp.subVectors(HR, HL);
    const lat = tmp.dot(rgt);
    if (lat > armSpan) armSpan += (Math.min(1.9, lat) - armSpan) * Math.min(1, dt * 0.5);
    ctl.spread = clamp01((lat - 0.35) / (armSpan * 0.88 - 0.35));
    const fo = 0.5 * (tmp.subVectors(HL, SC).dot(fwd) + tmp2.subVectors(HR, SC).dot(fwd));
    ctl.sweep = clamp01(-fo / 0.26);
    ctl.pitch = clamp01((fo - 0.14) / 0.14);
    ctl.brake = clamp01((fo - 0.3) / 0.2);
    const dy = HL.y - HR.y;
    let b = Math.atan2(dy, Math.max(0.3, Math.abs(lat)));
    b = Math.sign(b) * Math.max(0, Math.abs(b) - 0.05) * 1.6;
    ctl.bank = Math.max(-0.8, Math.min(0.8, b)) * clamp01((ctl.spread - 0.15) / 0.4);
    // flapping: downward hand speed relative to the head, with arms out
    if (havePrev && dt > 0) {
      const hv = (headL.y - prevHead.y) / dt;
      flapLv = -((HL.y - prevHL.y) / dt - hv); flapRv = -((HR.y - prevHR.y) / dt - hv);
      const raw = 0.5 * (Math.max(0, flapLv) + Math.max(0, flapRv)) * clamp01((ctl.spread - 0.2) / 0.35);
      flapS += (raw - flapS) * Math.min(1, dt * (raw > flapS ? 20 : 7));
    }
    prevHL.copy(HL); prevHR.copy(HR); prevHead.copy(headL); havePrev = true;
    ctl.flap = Math.max(0, flapS - 0.35);
  }

  // ── Air: thermals, ridge lift, wind ─────────────────────
  const wind = new THREE.Vector3(), grad = { x: 0, z: 0 };
  const thermBase = VILLAGES.map(v => sampler.groundY(v.x, v.z));
  function airUp(x, y, z, t) {
    let w = 0;
    for (let i = 0; i < VILLAGES.length; i++) {
      const v = VILLAGES[i], dx = x - v.x, dz = z - v.z, d2 = dx * dx + dz * dz;
      if (d2 > 200 * 200) continue;
      const agl = y - thermBase[i];
      const hf = agl < 0 ? 0 : agl < 380 ? 1 : Math.max(0, 1 - (agl - 380) / 120);
      w += (v.thermal + 0.8) * Math.exp(-d2 / (2 * 60 * 60)) * hf;
    }
    // ridge lift where the wind meets a slope
    const g = sampler.groundY(x, z), agl = y - g;
    if (agl < 90) {
      sampler.grad(x, z, grad);
      w += Math.min(3, Math.max(0, wind.x * grad.x + wind.z * grad.z) * 1.3) * (1 - agl / 90);
    }
    if (y > 620) w -= (y - 620) * 0.08;
    return w;
  }

  // ── State changes ──────────────────────────────────────
  function launch(V = 12.5, gamma = -0.05) {
    model.reset(V, gamma);
    S.state = 'flying'; S.slide = 0; S.takeoff = 0;
    if (S.mode && !S.running && !S.finished) { S.running = true; S.time = 0; S.ringIdx = 0; colorRings(S.mode, 0); }
    say(S.mode ? `Go! Ring 1 of ${S.mode.centers.length}` : 'Free flight — find the golden feathers', 3);
    audio.flap(2);
    input.left.haptic(0.4, 60); input.right.haptic(0.4, 60);
  }
  function goPerch() {
    if (S.fadeTarget === 1) return;
    S.fadeTarget = 1;
    S.onFaded = () => {
      if (ctx.isXR()) ctx.recenter(PERCH.x, PERCH.z, 0);
      else { rig.rotation.set(0, 0, 0); rig.position.set(PERCH.x, 0, PERCH.z); input.yaw = 0; input.pitch = 0; }
      rig.position.y = perchY;
      S.state = 'perch'; S.msg = ''; S.msgT = 0; S.running = false; S.finished = false; S.mode = null; layoutRings(null);
      model.reset(0, 0); havePrev = false; haveBody = false;
      panel.markDirty();
      S.fadeTarget = 0;
    };
  }
  function rotateRig(angle) {
    // rotate the rig about the head (world) by angle, allocation-free
    camera.getWorldPosition(tmp);
    const ox = rig.position.x - tmp.x, oz = rig.position.z - tmp.z, c = Math.cos(angle), s = Math.sin(angle);
    rig.position.x = tmp.x + ox * c + oz * s;
    rig.position.z = tmp.z - ox * s + oz * c;
    rig.rotation.y += angle;
  }

  // ── Per-frame ──────────────────────────────────────────
  const headW = new THREE.Vector3(), prevHeadW = new THREE.Vector3(), hit = new THREE.Vector3();
  let havePrevW = false, frame = 0;
  const desk = () => input.desktop && !ctx.isXR();

  function checkRing() {
    const co = S.mode; if (!co || !S.running) return;
    const i = S.ringIdx; if (i >= co.centers.length) return;
    const c = co.centers[i], n = co.normals[i];
    const s0 = tmp.subVectors(prevHeadW, c).dot(n), s1 = tmp.subVectors(headW, c).dot(n);
    if (s0 < 0 && s1 >= 0) {
      const t = s0 / (s0 - s1);
      hit.copy(prevHeadW).lerp(headW, t);
      if (hit.distanceTo(c) < RING_R + 0.9) {
        S.ringIdx++;
        colorRings(co, S.ringIdx);
        audio.ring(i);
        input.left.haptic(0.8, 80); input.right.haptic(0.8, 80);
        S.boostT = 1.1;
        if (S.ringIdx >= co.centers.length) {
          S.running = false; S.finished = true; S.lastTime = S.time;
          const best = bests[co.id];
          S.newBest = !best || S.time < best;
          if (S.newBest) { bests[co.id] = S.time; ctx.save(SAVE_BEST(co.id), S.time); }
          audio.finish();
          say(S.newBest ? `Finished ${fmt(S.time)} — new best!` : `Finished ${fmt(S.time)} (best ${fmt(best)})`, 8, '#9fffb0');
        } else say(`Ring ${S.ringIdx}/${co.centers.length} — boost!`, 1.6);
      }
    }
  }
  function checkFeathers() {
    for (let i = 0; i < FEATHER_COUNT; i++) {
      if (collected.has(i)) continue;
      const f = feathers[i], dx = headW.x - f[0], dy = headW.y - 0.4 - f[1], dz = headW.z - f[2];
      if (dx * dx + dy * dy + dz * dz < 5.5 * 5.5) {
        collected.add(i); S.sessionFeathers++;
        ctx.save('flight:feathers', [...collected]);
        layoutFeatherGlow(); audio.feather();
        input.left.haptic(0.5, 40); input.right.haptic(0.5, 40);
        say(`Golden feather ${collected.size}/${FEATHER_COUNT}`, 2, '#ffe08a');
        panel.markDirty();
      }
    }
  }

  let lastTurn = 0, vy = 0, groundSpeed = 0, airW = 0;
  function fly(dt, t) {
    // wind: gentle westerly with slow gusts
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.31 + 1);
    wind.set(1.1 + 0.9 * gust, 0, 0.5 * Math.sin(t * 0.05));
    const boost = S.boostT > 0 ? 5.5 : 0;
    S.boostT = Math.max(0, S.boostT - dt);
    model.step(dt, ctl, boost);
    // heading
    const turn = -model.turnRate * dt;
    if (desk() && !debugArms) input.yaw += turn; else rotateRig(turn);
    lastTurn = model.turnRate;
    const yaw = rig.rotation.y + bodyYaw + (desk() && !debugArms ? turn : 0);
    const vh = model.V * Math.cos(model.gamma);
    camera.getWorldPosition(headW);
    airW = airUp(headW.x, rig.position.y, headW.z, t);
    let vx = -Math.sin(yaw) * vh + wind.x, vz = -Math.cos(yaw) * vh + wind.z;
    vy = model.V * Math.sin(model.gamma) + airW;
    // soft world boundary: the air pushes you back towards the valley
    const lim = HALF - 260;
    if (Math.abs(headW.x) > lim) vx -= Math.sign(headW.x) * (Math.abs(headW.x) - lim) * 0.12;
    if (Math.abs(headW.z) > lim) vz -= Math.sign(headW.z) * (Math.abs(headW.z) - lim) * 0.12;
    if ((Math.abs(headW.x) > lim || Math.abs(headW.z) > lim) && S.msgT <= 0) say('The mountain winds turn you back', 2, '#cfe4ea');
    rig.position.x += vx * dt; rig.position.z += vz * dt; rig.position.y += vy * dt;
    groundSpeed = Math.hypot(vx, vz);
    // ground contact
    camera.getWorldPosition(headW);
    const gy = sampler.surfaceY(headW.x, headW.z);
    const onDeck = Math.hypot(headW.x - PERCH.x, headW.z - PERCH.z) < 12 && rig.position.y > perchY - 3;
    if (onDeck && rig.position.y < perchY) rig.position.y = perchY;
    S.grace = Math.max(0, S.grace - dt);
    if (S.grace > 0 && rig.position.y < gy) rig.position.y = gy;
    if (rig.position.y <= gy && !onDeck && S.grace <= 0) {
      const sl = sampler.slope(headW.x, headW.z);
      rig.position.y = gy;
      S.state = 'landing';
      S.slide = sl > 1 ? Math.min(groundSpeed, 4) : groundSpeed;
      S.slideDir.set(vx, 0, vz).normalize();
      const hard = model.V > 16 || vy < -6;
      audio.land(hard);
      input.left.haptic(hard ? 0.9 : 0.4, 120); input.right.haptic(hard ? 0.9 : 0.4, 120);
      say(hard ? 'Oof — rough landing' : 'Touchdown', 2);
    }
    // stall cue
    if (model.stall > 0.4 && S.stallCue <= 0) { audio.stall(); S.stallCue = 1.2; say('Stall — sweep back to gain speed', 1.5, '#ff9a7a'); input.left.haptic(0.3, 50); input.right.haptic(0.3, 50); }
    S.stallCue -= dt;
    // flap cue
    if (ctl.flap > 0.6 && S.flapCue <= 0) { audio.flap(ctl.flap); S.flapCue = 0.35; input.left.haptic(0.25, 30); input.right.haptic(0.25, 30); }
    S.flapCue -= dt;
  }

  function slideOnGround(dt) {
    S.slide *= Math.exp(-dt * 2.4);
    rig.position.x += S.slideDir.x * S.slide * dt; rig.position.z += S.slideDir.z * S.slide * dt;
    camera.getWorldPosition(headW);
    const gy = sampler.surfaceY(headW.x, headW.z);
    rig.position.y += (gy - rig.position.y) * Math.min(1, dt * 8);
    groundSpeed = S.slide; vy = 0;
    if (S.slide < 0.4) { S.state = 'landed'; S.takeoff = 0; say('Landed. Flap hard (or trigger) to take off · A/B: perch', 6, '#cfe4ea'); }
  }

  const hudOpts = { desktop: false, showBoard: false, tunnel: false, vignette: 0, target: null, time: 0, speed: 0 };
  function anyButton() { return input.left.a || input.left.b || input.right.a || input.right.b; }
  function anyTrigger() { return input.left.triggerDown || input.right.triggerDown; }

  function update(dt, t) {
    frame++;
    readArms(dt);
    // fade (teleports happen while black)
    if (S.fadeTarget !== S.fade) {
      S.fade = S.fadeTarget > S.fade ? Math.min(1, S.fade + dt * 4) : Math.max(0, S.fade - dt * 3);
      if (S.fade >= 1 && S.onFaded) { const f = S.onFaded; S.onFaded = null; f(); }
    }
    hud.fade = S.fade;

    const st = S.state;
    if (st === 'perch' || st === 'ready') {
      rig.position.y = perchY;
      panel.mesh.visible = true;
      const h = pointer.update(input.main);
      let clicked = false;
      if (h?.button && input.main.triggerDown) clicked = pointer.click(h);
      if (desk()) {
        for (let k = 0; k < 4; k++) if (input.keyDown('Digit' + (k + 1))) select(k === 0 ? null : courses[k - 1]);
      }
      if (S.state === 'ready' && !clicked && (anyTrigger() || ctl.flap > 1.1 || (desk() && input.key('KeyW')))) {
        panel.mesh.visible = false; pointer.update(null);
        launch(12.5, 0.12);
      }
    } else {
      panel.mesh.visible = false;
      if (anyButton() || (desk() && (input.keyDown('KeyE') || input.keyDown('KeyR')))) goPerch();
      if (S.state === 'flying') fly(dt, t);
      else if (S.state === 'landing') slideOnGround(dt);
      else if (S.state === 'landed') {
        camera.getWorldPosition(headW);
        rig.position.y = sampler.surfaceY(headW.x, headW.z);
        groundSpeed = 0; vy = 0;
        S.takeoff += ctl.flap * dt;
        if (S.takeoff > 0.45 || anyTrigger()) { rig.position.y += 0.3; launch(10.5, 0.55); S.grace = 1.2; say('Airborne!', 1.5); }
      }
      if (S.running) S.time += dt;
    }

    rig.updateMatrixWorld(true);
    camera.getWorldPosition(headW);
    if (havePrevW && (S.state === 'flying' || S.state === 'landing')) { checkRing(); checkFeathers(); }
    prevHeadW.copy(headW); havePrevW = true;

    // visuals
    const speed = S.state === 'flying' ? model.V : 0;
    wings.update(SL, HL, SR, HR, back, ctl, flapLv, flapRv, t, speed);
    animateFeathers(t);
    world.update(t);
    if (S.mode && S.ringIdx < S.mode.centers.length && S.state !== 'perch') {
      const c = S.mode.centers[S.ringIdx];
      nextRing.visible = true; nextRing.position.copy(c);
      nextRing.quaternion.setFromUnitVectors(Z, S.mode.normals[S.ringIdx]);
      nextRing.scale.setScalar(1 + 0.06 * Math.sin(t * 5));
      ringGlow.visible = true; _m4.makeScale(RING_R * 3.4, RING_R * 3.4, 1); _m4.setPosition(c); ringGlow.setMatrixAt(0, _m4); ringGlow.instanceMatrix.needsUpdate = true;
    } else { nextRing.visible = false; ringGlow.visible = false; }
    ringLanterns.material.color.setScalar(0.85 + 0.15 * Math.sin(t * 3));

    // HUD
    S.msgT -= dt; if (S.msgT <= 0) S.msg = '';
    const flying = S.state === 'flying' || S.state === 'landing' || S.state === 'landed';
    if ((frame % 6) === 0) {
      const agl = flying ? Math.max(0, rig.position.y - sampler.surfaceY(headW.x, headW.z)) : 0;
      const kmh = Math.round((flying ? (S.state === 'flying' ? model.V : groundSpeed) : 0) * 3.6);
      let top, mid;
      if (S.mode) {
        top = `${S.mode.name}  ·  ${fmt(S.finished ? S.lastTime : S.time)}`;
        if (S.finished) mid = S.newBest ? 'New best time!' : 'Course complete';
        else { const c = S.mode.centers[S.ringIdx]; mid = `Ring ${S.ringIdx + 1}/${S.mode.centers.length}  ·  ${Math.round(c.distanceTo(headW))} m`; }
      } else { top = 'Free Flight'; mid = `Feathers ${collected.size}/${FEATHER_COUNT}`; }
      const lift = airW > 0.8 ? `  ·  rising air +${airW.toFixed(1)}` : '';
      const bot = `${kmh} km/h  ·  ${Math.round(agl)} m${lift}`;
      hud.setLines(top, mid, bot, S.msg, S.msgColor);
      if (desk()) {
        if (S.state === 'perch') ctx.setHud('Aim at the board and click · or press 1 Free · 2 River · 3 Stone Forest · 4 Cloud Gate');
        else if (S.state === 'ready') ctx.setHud('W (hold) to flap and leap · mouse steers · Tab: hub');
        else ctx.setHud(`${top} · ${mid} · ${bot}${S.msg ? ' · ' + S.msg : ''} — W flap · S brake · A/D bank · look down = dive · Space tuck · E: perch`);
      }
    }
    const vigBase = Math.min(1, Math.abs(lastTurn) * 2.2 + Math.max(0, (model.V - 18) / 22) + Math.abs(vy) / 25);
    const ho = hudOpts;
    ho.desktop = desk(); ho.showBoard = flying && (!ho.desktop || debugHud); ho.tunnel = settings.tunnel && flying;
    ho.vignette = S.state === 'flying' ? vigBase * VIG_LEVELS[settings.vignette] : 0;
    ho.target = S.mode && !S.finished && S.state !== 'perch' && S.state !== 'ready' && S.ringIdx < S.mode.centers.length ? S.mode.centers[S.ringIdx] : null;
    ho.time = t; ho.speed = groundSpeed;
    hud.update(dt, camera.position, bodyYaw, ho);
    audio.update(S.state === 'flying' ? model.V : groundSpeed, flying);
  }

  // ── Debug / test hook ──────────────────────────────────
  window.__flight = {
    get state() { return S.state; }, get S() { return S; }, model, ctl, courses, feathers, sampler,
    setArms(a) { debugArms = a; havePrev = false; },
    showHud(v) { debugHud = v; },
    select(i) { select(i < 0 ? null : courses[i]); },
    launch: (V, g) => launch(V, g),
    perch: () => goPerch(),
    teleport(x, y, z, yaw = 0) { if (desk()) { input.yaw = yaw; rig.rotation.set(0, 0, 0); } rig.position.set(x - camera.position.x, y, z - camera.position.z); havePrevW = false; },
    get collected() { return collected.size; },
    resetFeathers() { collected = new Set(); ctx.save('flight:feathers', []); layoutFeatherGlow(); },
    stats: () => ({ calls: ctx.renderer.info.render.calls, tris: ctx.renderer.info.render.triangles }),
  };

  return {
    spawn: { x: PERCH.x, z: PERCH.z, yaw: 0 },
    update,
    onXRStart() { havePrev = false; haveBody = false; rig.position.y = S.state === 'perch' || S.state === 'ready' ? perchY : rig.position.y; },
    onXREnd() { havePrev = false; },
    dispose() {
      audio.dispose();
      hud.dispose();
      world.terrain.material.userData.detail?.dispose();
      if (window.__flight) delete window.__flight;
    },
  };
}
