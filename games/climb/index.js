import * as THREE from 'three';
import { Panel, Pointer, Locomotion, Sfx, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { TOWERS, ROUTES, MASSIF, towerR } from './routes.js';
import { buildWorld } from './world.js';
import { makeGlove } from './gloves.js';

// Cliffside (攀崖): hand-over-hand climbing up karst towers above a misty river valley.
//
// Climbing model: when a hand grips a hold we remember the world anchor point. Every frame the hand's
// position is taken in rig-local space (so moving the rig never feeds back into it) and transformed by the
// current rig matrix; the rig is then shifted by (anchor − hand) so the hand stays on the hold.
// Two hands average their corrections. Letting go of everything flings the rig with its recent velocity.

const RATE = { jug: 0.035, rung: 0.02, crimp: 0.11, crumble: 0.05, moving: 0.05, piton: 0.03, rope: 0.06, chain: 0.06 };
const GRAB_R = 0.15, DESK_REACH = 2.1, G = 9.8, DEATH_FALL = 8, PITONS = 3, HEAD_PAD = 0.3;
const SPAWN = { x: 0, z: 5, yaw: 0 };

const fmt = (t) => { if (t == null) return '--:--.-'; const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

export async function create(ctx) {
  const { scene, input, rig, camera } = ctx;
  const W = buildWorld(scene);
  const sfx = new Sfx(ctx.audio);
  const loco = new Locomotion({ speed: 2.2 });
  const pointer = new Pointer(scene, 0xffd060);

  // ── Temps (no allocations in the frame loop) ──
  const invRig = new THREE.Matrix4();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  const _hw = new THREE.Vector3(), _corr = new THREE.Vector3(), _head = new THREE.Vector3(), _dir = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), UPV = new THREE.Vector3(0, 1, 0);
  const prevRig = new THREE.Vector3(), climbVel = new THREE.Vector3(), vel = new THREE.Vector3(), lastRig = new THREE.Vector3();
  const pick = { g: null, t: 0, pt: new THREE.Vector3(), d: 0 };

  // ── Persistent data ──
  const best = ctx.load('climb:best', { t: [null, null, null], j: [0, 0, 0] });
  let comfort = ctx.load('climb:vignette', true);

  // ── State ──
  let mode = 'ground'; // ground | climb | air | belay
  let groundSurf = W.surfaces.find(s => s.terrace);
  let peakY = 0, speedSm = 0, vigSm = 0;
  let run = null;
  const fade = { a: 0, target: 0, speed: 1.6, cb: null };
  let hudT = 0, wristT = 0, windT = 0, deskTarget = null;
  const deskTargetPt = new THREE.Vector3();

  // ── Hands ──
  const hands = [0, 1].map((i) => {
    const glove = makeGlove(i === 1 ? !input.leftHanded : input.leftHanded);
    scene.add(glove.group);
    const marker = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 24), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffe08a : 0x9fe8ff, transparent: true, opacity: 0.85, depthWrite: false }));
    marker.visible = false; scene.add(marker);
    return {
      i, glove, marker, held: null, t: 0, offset: new THREE.Vector3(), local: new THREE.Vector3(), world: new THREE.Vector3(), deskLocal: new THREE.Vector3(),
      stamina: 1, cooldown: 0, warnT: 0, value: 0, prevValue: 0, tickT: 0,
      get inp() { return i === 0 ? input.main : input.off; },
    };
  });

  // Wrist display on the off-hand glove (route, time, jade, pitons)
  const wristCv = document.createElement('canvas'); wristCv.width = 256; wristCv.height = 112;
  const wristTex = new THREE.CanvasTexture(wristCv); wristTex.colorSpace = THREE.SRGBColorSpace;
  const wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.044), new THREE.MeshBasicMaterial({ map: wristTex, transparent: true, toneMapped: false }));
  wrist.position.set(0, 0.032, 0.075); wrist.rotation.x = -Math.PI / 2 + 0.35;
  hands[1].glove.group.add(wrist);
  function drawWrist() {
    const g = wristCv.getContext('2d'), Wd = 256, H = 112;
    g.clearRect(0, 0, Wd, H);
    roundRect(g, 2, 2, Wd - 4, H - 4, 16); g.fillStyle = 'rgba(12,16,24,0.88)'; g.fill(); g.lineWidth = 3; g.strokeStyle = '#e2b85c'; g.stroke();
    const rt = ROUTES[run.route];
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = rt.color; g.font = `34px ${FONTS.brush}`; g.fillText(rt.zh, 14, 32);
    g.fillStyle = '#f1e6cf'; g.font = `600 34px ${FONTS.sans}`; g.textAlign = 'right';
    g.fillText(run.finished ? fmt(run.time) : run.started ? fmt(run.time) : 'ready', Wd - 14, 32);
    g.textAlign = 'left'; g.font = `500 26px ${FONTS.sans}`;
    g.fillStyle = '#7fe0b0'; g.fillText(`◆ ${run.jade}/${rt.tokens.length}`, 14, 80);
    g.fillStyle = '#c8ccd4'; g.textAlign = 'right'; g.fillText(`piton ×${run.pitonsLeft}`, Wd - 14, 80);
    wristTex.needsUpdate = true;
  }

  // ── Comfort / fade overlay (child of the camera) ──
  const overlayMat = new THREE.ShaderMaterial({
    uniforms: { fade: { value: 0 }, vig: { value: 0 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float fade; uniform float vig; varying vec2 vP; void main(){ float r = length(vP) / 0.07; float v = smoothstep(0.42, 1.25, r) * vig; gl_FragColor = vec4(0.02, 0.03, 0.05, max(fade, v)); }',
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false,
  });
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), overlayMat);
  overlay.position.z = -0.07; overlay.renderOrder = 9999; overlay.frustumCulled = false; overlay.visible = false;
  camera.add(overlay);

  // Belay rope (shown while hanging from a piton after a respawn)
  const belayGeo = new THREE.BufferGeometry(); belayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const belay = new THREE.Line(belayGeo, new THREE.LineBasicMaterial({ color: 0xd8b878 })); belay.frustumCulled = false; belay.visible = false; scene.add(belay);

  // ── Wind ambience ──
  let wind = null;
  if (ctx.audio.ctx) {
    const ac = ctx.audio.ctx, buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < d.length; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6; }
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.5;
    const g = ac.createGain(); g.gain.value = 0.0;
    src.connect(f).connect(g).connect(ctx.audio.out); src.start();
    wind = { src, f, g };
  }

  // ── Panels ──
  const panel = new Panel({
    width: 1.5, height: 1.0, px: 1024, draw: (g, Wd, H, p) => {
      roundRect(g, 4, 4, Wd - 8, H - 8, 28); g.fillStyle = 'rgba(14,18,26,0.92)'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#e2b85c'; g.stroke();
      g.textBaseline = 'alphabetic'; g.textAlign = 'left';
      g.fillStyle = '#e2b85c'; g.font = `96px ${FONTS.brush}`; g.fillText('攀崖', 40, 118);
      g.fillStyle = '#f1e6cf'; g.font = `italic 600 52px ${FONTS.latin}`; g.fillText('Cliffside', 250, 92);
      g.fillStyle = '#a8a0c0'; g.font = `24px ${FONTS.sans}`; g.fillText('Grip near a hold to grab. Pull down to rise. Let go mid-pull to leap.', 250, 128);
      ROUTES.forEach((rt, i) => {
        const y = 165 + i * 128, active = run && run.route === i;
        roundRect(g, 32, y, Wd - 64, 112, 18); g.fillStyle = active ? 'rgba(226,184,92,0.13)' : 'rgba(255,255,255,0.04)'; g.fill();
        g.fillStyle = rt.color; g.fillRect(32, y + 14, 8, 84);
        g.fillStyle = rt.color; g.font = `56px ${FONTS.brush}`; g.fillText(rt.zh, 60, y + 72);
        g.fillStyle = '#f1e6cf'; g.font = `600 34px ${FONTS.sans}`; g.fillText(`${i + 1}. ${rt.name}`, 200, y + 48);
        g.fillStyle = '#a8a0c0'; g.font = `24px ${FONTS.sans}`;
        const tw = TOWERS[rt.tower];
        g.fillText(`${'●'.repeat(rt.grade)}${'○'.repeat(3 - rt.grade)}   ${tw.H} m   jade ${best.j[i]}/${rt.tokens.length}   best ${fmt(best.t[i])}`, 200, y + 88);
        p.button(`r${i}`, Wd - 250, y + 18, 200, 76, active && mode !== 'ground' ? 'Restart' : 'Climb', () => selectRoute(i), { active, size: 34 });
      });
      g.fillStyle = '#a8a0c0'; g.font = `22px ${FONTS.sans}`;
      g.fillText('A/X: place piton (checkpoint, 3 per climb)   B: back to checkpoint   light grip on rope: slide', 40, H - 40);
      p.button('vig', 40, H - 140, 330, 64, `Comfort vignette: ${comfort ? 'On' : 'Off'}`, () => { comfort = !comfort; ctx.save('climb:vignette', comfort); }, { size: 26 });
      p.button('base', 390, H - 140, 260, 64, 'Base camp', () => toBase(), { size: 26 });
    },
  });
  panel.mesh.position.set(-2.3, 1.45, 3.0); panel.mesh.lookAt(SPAWN.x, 1.5, SPAWN.z + 0.5);
  scene.add(panel.mesh); pointer.panels.push(panel);

  let summitInfo = null;
  const summit = new Panel({
    width: 1.0, height: 0.62, px: 800, draw: (g, Wd, H, p) => {
      roundRect(g, 4, 4, Wd - 8, H - 8, 26); g.fillStyle = 'rgba(14,18,26,0.92)'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#e2b85c'; g.stroke();
      if (!summitInfo) return;
      const rt = ROUTES[summitInfo.route];
      g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.fillStyle = '#e2b85c'; g.font = `84px ${FONTS.brush}`; g.fillText('登顶', Wd / 2, 100);
      g.fillStyle = '#f1e6cf'; g.font = `600 34px ${FONTS.sans}`; g.fillText(`${rt.name} — summit!`, Wd / 2, 150);
      g.font = `600 52px ${FONTS.sans}`; g.fillText(fmt(summitInfo.time), Wd / 2, 215);
      g.fillStyle = summitInfo.newBest ? '#7fe0b0' : '#a8a0c0'; g.font = `26px ${FONTS.sans}`;
      g.fillText(`${summitInfo.newBest ? 'New best!' : 'Best ' + fmt(best.t[summitInfo.route])}   ·   jade ${summitInfo.jade}/${rt.tokens.length}`, Wd / 2, 258);
      p.button('again', 30, H - 150, 230, 90, 'Climb again', () => selectRoute(summitInfo.route), { size: 30 });
      p.button('next', 285, H - 150, 230, 90, 'Next route', () => selectRoute((summitInfo.route + 1) % ROUTES.length), { size: 30 });
      p.button('base', 540, H - 150, 230, 90, 'Base camp', () => toBase(), { size: 30 });
    },
  });
  summit.mesh.visible = false; scene.add(summit.mesh); pointer.panels.push(summit);
  pointer.onClick = () => sfx.tone({ freq: 880, dur: 0.05, gain: 0.08 });

  // ── Geometry helpers ──
  function syncRig() { rig.updateMatrix(); rig.matrixWorld.copy(rig.matrix); }
  function headWorld(out) { return out.copy(camera.position).applyMatrix4(rig.matrixWorld); }
  function anchorOf(h, out) {
    const g = h.held;
    if (g.kind === 'hold') out.copy(g.pos); else out.lerpVectors(g.a, g.b, h.t);
    return out.add(h.offset);
  }
  function closestOnBar(bar, p) {
    _c.subVectors(bar.b, bar.a); const L2 = _c.lengthSq();
    let t = L2 > 0 ? _d.subVectors(p, bar.a).dot(_c) / L2 : 0; t = Math.max(0, Math.min(1, t));
    return t;
  }
  // nearest grabbable to a point → pick
  function nearest(p, maxD) {
    pick.g = null; pick.d = maxD;
    for (const g of W.grabs) {
      if (!g.active || g.broken) continue;
      if (g.kind === 'hold') { const d = g.pos.distanceTo(p); if (d < pick.d) { pick.d = d; pick.g = g; pick.t = 0; pick.pt.copy(g.pos); } }
      else {
        const t = closestOnBar(g, p); _a.lerpVectors(g.a, g.b, t); const d = _a.distanceTo(p);
        if (d < pick.d) { pick.d = d; pick.g = g; pick.t = t; pick.pt.copy(_a); }
      }
    }
    return pick.g;
  }
  // nearest grabbable to a ray (desktop crosshair)
  function nearestRay(o, dir, reach) {
    pick.g = null; let bestS = 1e9;
    for (const g of W.grabs) {
      if (!g.active || g.broken) continue;
      let t = 0;
      if (g.kind === 'hold') _a.copy(g.pos);
      else {
        _c.subVectors(g.b, g.a); _d.subVectors(g.a, o);
        const A = _c.dot(_c), B = _c.dot(dir), D = _c.dot(_d), E = dir.dot(_d), den = A - B * B;
        t = den > 1e-6 ? (B * E - D) / den : 0; t = Math.max(0, Math.min(1, t));
        _a.copy(g.a).addScaledVector(_c, t);
      }
      _b.subVectors(_a, o); const along = _b.dot(dir);
      if (along < 0.1 || along > reach) continue;
      const perp = _b.addScaledVector(dir, -along).length();
      if (perp > 0.1 + along * 0.05) continue;
      const score = perp + along * 0.02;
      if (score < bestS) { bestS = score; pick.g = g; pick.t = t; pick.pt.copy(_a); }
    }
    return pick.g;
  }
  function inside(s, x, z, e) {
    if (s.kind === 'disc') return Math.hypot(x - s.cx, z - s.cz) <= s.rad + e;
    const t = s.tower, dx = x - t.cx, dz = z - t.cz, d = Math.hypot(dx, dz), phi = Math.atan2(dx, dz), pe = e / Math.max(1, d);
    return phi >= s.phi0 - pe && phi <= s.phi1 + pe && d <= s.rOut + e;
  }
  function supportBelow(x, z, y, e = 0) {
    let bestS = null;
    for (const s of W.surfaces) if (s.y <= y + 0.06 && (!bestS || s.y > bestS.y) && inside(s, x, z, e)) bestS = s;
    return bestS;
  }
  // keep the head outside the rock; returns true if pushed
  function collide() {
    headWorld(_head);
    let pushed = false;
    for (let k = 0; k <= TOWERS.length; k++) {
      const t = k < TOWERS.length ? TOWERS[k] : MASSIF;
      if (_head.y > t.H + 0.05 || _head.y < -180) continue;
      if (t === MASSIF && _head.y > -0.3) continue;
      const dx = _head.x - t.cx, dz = _head.z - t.cz, d = Math.hypot(dx, dz);
      if (d > 50) continue;
      const rr = towerR(t, Math.atan2(dx, dz), _head.y) + HEAD_PAD;
      if (d < rr && d > 1e-3) { const push = rr - d; rig.position.x += dx / d * push; rig.position.z += dz / d * push; pushed = true; _head.x += dx / d * push; _head.z += dz / d * push; }
    }
    if (pushed) syncRig();
    return pushed;
  }

  // ── Sounds / haptics ──
  const buzz = (h, i, ms) => h.inp.haptic?.(i, ms);
  const sGrab = (p) => { sfx.noise({ freq: 1400, q: 0.7, dur: 0.05, gain: 0.18, pos: p }); sfx.tone({ freq: 160, dur: 0.06, gain: 0.08, pos: p }); };
  const sSlip = (p) => sfx.noise({ freq: 3200, freqEnd: 500, q: 1.2, dur: 0.4, gain: 0.25, pos: p });
  const sThud = () => sfx.noise({ freq: 180, q: 0.8, dur: 0.18, gain: 0.35 });
  const sChime = () => { sfx.tone({ freq: 1320, dur: 0.25, gain: 0.12, type: 'triangle' }); sfx.tone({ freq: 1760, dur: 0.35, gain: 0.1, type: 'triangle', delay: 0.08 }); };
  const sGong = () => { sfx.tone({ freq: 196, dur: 2.0, gain: 0.2, type: 'sine' }); sfx.tone({ freq: 293, dur: 1.6, gain: 0.08, type: 'triangle' }); sfx.tone({ freq: 523, dur: 1.0, gain: 0.04 }); };

  // ── Grabbing ──
  function attach(h, g, pt, t) {
    if (h.held === g && g.kind === 'hold') return;
    h.held = g; h.t = t;
    syncRig();
    if (input.desktop) { h.offset.set(0, 0, 0); h.deskLocal.copy(pt).applyMatrix4(invRig.copy(rig.matrixWorld).invert()); }
    else { _hw.copy(h.local).applyMatrix4(rig.matrixWorld); h.offset.subVectors(_hw, pt); if (h.offset.length() > 0.1) h.offset.setLength(0.1); }
    if (mode !== 'climb') { mode = 'climb'; prevRig.copy(rig.position); climbVel.set(0, 0, 0); belay.visible = false; }
    if (run && !run.started && !run.finished) run.started = true;
    sGrab(pt); buzz(h, 0.45, 35);
  }
  function release(h, why) {
    if (!h.held) return;
    if (why === 'slip') { sSlip(anchorOf(h, _a)); buzz(h, 1.0, 160); h.cooldown = 0.6; }
    else if (why === 'break') { buzz(h, 1.0, 220); h.cooldown = 0.4; }
    h.held = null;
  }
  function releaseAll() { for (const h of hands) h.held = null; }
  const anyHeld = () => hands[0].held || hands[1].held;

  // after the last hand lets go
  function leaveClimb(jump) {
    syncRig(); headWorld(_head);
    const sup = supportBelow(_head.x, _head.z, rig.position.y, 0.05);
    if (sup && rig.position.y - sup.y < 0.08 && !jump) { land(sup, 0); return; }
    // mantle onto a ledge / summit lip when the head is already above it
    let m = null;
    for (const s of W.surfaces) if (_head.y > s.y + 0.25 && rig.position.y < s.y + 0.05 && rig.position.y > s.y - 1.9 && inside(s, _head.x, _head.z, 0.8) && (!m || s.y > m.y)) m = s;
    if (m && !jump) {
      // step inwards so the head is over the surface
      if (m.kind === 'disc') { const dx = _head.x - m.cx, dz = _head.z - m.cz, d = Math.hypot(dx, dz), lim = m.rad - 0.3; if (d > lim) { rig.position.x -= dx / d * (d - lim); rig.position.z -= dz / d * (d - lim); } }
      else { const t = m.tower, dx = _head.x - t.cx, dz = _head.z - t.cz, d = Math.hypot(dx, dz), lim = m.rOut - 0.3; if (d > lim) { rig.position.x -= dx / d * (d - lim); rig.position.z -= dz / d * (d - lim); } }
      rig.position.y = m.y; land(m, 0); sfx.noise({ freq: 600, dur: 0.12, gain: 0.15 }); return;
    }
    mode = 'air';
    vel.copy(climbVel).multiplyScalar(1.15);
    if (vel.length() > 7) vel.setLength(7);
    if (jump) { vel.y = Math.max(vel.y, 0) + 3.4; _dir.copy(input.head.fwd).setY(0).normalize(); vel.addScaledVector(_dir, -0.6); }
    peakY = rig.position.y;
  }
  function land(s, fall) {
    mode = 'ground'; groundSurf = s; vel.set(0, 0, 0); rig.position.y = s.y; syncRig();
    if (fall > 1.2) { sThud(); for (const h of hands) buzz(h, Math.min(1, fall / 5), 80); }
    onSurface(s);
  }
  function onSurface(s) {
    if (!run) return;
    if (s.cp && s.route === run.route) {
      const cp = s.cpEntry;
      if (cp && run.cp !== cp) { if (run.cp?.lantern != null) W.setLantern(run.cp, false); run.cp = cp; W.setLantern(cp, true); sGong(); }
    }
    if (s.summit && s.route === run.route && run.started && !run.finished) finish();
  }

  // ── Runs, checkpoints, respawn ──
  function newRun(i) {
    for (const list of W.cps) for (const cp of list) W.setLantern(cp, false);
    run = { route: i, started: false, finished: false, time: 0, jade: 0, pitonsLeft: PITONS, cp: W.cps[i][0] };
    W.setLantern(run.cp, true);
    for (const tk of W.tokens) if (tk.route === i) tk.taken = false;
    for (const p of W.pitons) { p.broken = true; p.active = false; W.setHoldMatrix(p); }
    restoreHolds();
    summit.mesh.visible = false;
    panel.markDirty(); drawWrist();
  }
  function restoreHolds() { for (const h of W.holds) if (h.type === 'crumble' && (h.broken || h.crumbleT > 0)) { h.broken = false; h.crumbleT = 0; W.setHoldMatrix(h); } }
  function fadeThen(cb) { if (fade.cb) return; fade.target = 1; fade.cb = cb; }
  function placeStanding(x, y, z, yaw) {
    releaseAll(); ctx.recenter(x, z, yaw); rig.position.y = y; syncRig();
    mode = 'ground'; groundSurf = supportBelow(x, z, y + 0.01) ?? W.surfaces.find(s => s.terrace);
    vel.set(0, 0, 0); climbVel.set(0, 0, 0); belay.visible = false; lastRig.copy(rig.position);
  }
  function respawn() {
    for (const h of hands) { h.held = null; h.stamina = 1; h.cooldown = 0; }
    restoreHolds();
    const cp = run.cp;
    if (cp.kind === 'piton') {
      const p = cp.hold.pos, t = cp.hold.tower, dx = p.x - t.cx, dz = p.z - t.cz, d = Math.hypot(dx, dz), phi = Math.atan2(dx, dz);
      const hx = p.x + dx / d * 0.6, hz = p.z + dz / d * 0.6, hy = p.y - 0.45;
      ctx.recenter(hx, hz, phi); rig.position.y = hy - camera.position.y; syncRig();
      mode = 'belay'; vel.set(0, 0, 0); climbVel.set(0, 0, 0); belay.visible = true; lastRig.copy(rig.position);
    } else placeStanding(cp.x, cp.y, cp.z, cp.yaw);
  }
  function die() {
    if (fade.cb) return;
    sfx.noise({ freq: 900, freqEnd: 200, q: 0.6, dur: 1.0, gain: 0.25 });
    fadeThen(respawn);
  }
  function selectRoute(i) { fadeThen(() => { newRun(i); respawn(); }); }
  function toBase() { fadeThen(() => { summit.mesh.visible = false; placeStanding(SPAWN.x, 0, SPAWN.z, SPAWN.yaw); panel.markDirty(); }); }
  function finish() {
    run.finished = true;
    const i = run.route, newBest = best.t[i] == null || run.time < best.t[i];
    if (newBest) best.t[i] = Math.round(run.time * 10) / 10;
    best.j[i] = Math.max(best.j[i], run.jade);
    ctx.save('climb:best', best);
    summitInfo = { route: i, time: run.time, jade: run.jade, newBest };
    sGong(); [523, 659, 784, 1047].forEach((f, k) => sfx.tone({ freq: f, dur: 0.4, gain: 0.1, type: 'triangle', delay: 0.15 * k + 0.3 }));
    for (const h of hands) buzz(h, 0.6, 120);
    headWorld(_head); _dir.copy(input.head.fwd).setY(0); if (_dir.lengthSq() < 1e-4) _dir.set(0, 0, -1); _dir.normalize();
    summit.mesh.position.copy(_head).addScaledVector(_dir, 1.3); summit.mesh.position.y = _head.y - 0.15;
    summit.mesh.lookAt(_head.x, summit.mesh.position.y, _head.z);
    summit.mesh.visible = true; summit.markDirty(); panel.markDirty();
  }
  function collect(tk) {
    tk.taken = true; sChime(); W.emitDust(tk.pos, 6);
    if (run && tk.route === run.route) { run.jade++; drawWrist(); }
    for (const h of hands) buzz(h, 0.3, 40);
  }
  function placePiton(h) {
    if (!run || run.pitonsLeft <= 0 || (mode !== 'climb' && mode !== 'belay')) { sfx.tone({ freq: 140, dur: 0.12, gain: 0.08, type: 'square' }); return; }
    if (h.held) anchorOf(h, _a); else _a.copy(h.local).applyMatrix4(rig.matrixWorld);
    for (const t of TOWERS) {
      if (_a.y > t.H || _a.y < 0.3) continue;
      const dx = _a.x - t.cx, dz = _a.z - t.cz, d = Math.hypot(dx, dz), phi = Math.atan2(dx, dz), r = towerR(t, phi, _a.y);
      if (d - r > 0.7 || d - r < -0.4) continue;
      const p = W.pitons[PITONS - run.pitonsLeft];
      p.tower = t; p.route = run.route;
      p.normal.set(Math.sin(phi), 0, Math.cos(phi));
      p.pos.set(t.cx + Math.sin(phi) * (r + 0.02), _a.y + 0.08, t.cz + Math.cos(phi) * (r + 0.02)); p.base.copy(p.pos);
      p.up.set(0, 1, 0); p.right.crossVectors(p.up, p.normal).normalize();
      p.broken = false; p.active = true; W.setHoldMatrix(p);
      run.pitonsLeft--;
      if (run.cp?.lantern != null) W.setLantern(run.cp, false);
      run.cp = { kind: 'piton', hold: p };
      sfx.tone({ freq: 2600, dur: 0.06, gain: 0.08, type: 'square', pos: p.pos }); sfx.tone({ freq: 2900, dur: 0.08, gain: 0.08, type: 'square', delay: 0.12, pos: p.pos });
      buzz(h, 0.7, 40); drawWrist();
      return;
    }
    sfx.tone({ freq: 140, dur: 0.12, gain: 0.08, type: 'square' });
  }

  newRun(0);
  placeStanding(SPAWN.x, 0, SPAWN.z, SPAWN.yaw);
  ctx.recenter(SPAWN.x, SPAWN.z, SPAWN.yaw);

  // ── Frame ──
  function update(dt, time) {
    syncRig();
    invRig.copy(rig.matrixWorld).invert();
    const desk = input.desktop;
    const busy = !!fade.cb;

    // hand positions in rig-local space
    for (const h of hands) {
      const inp = h.inp;
      h.prevValue = h.value;
      if (desk) {
        h.value = h.held ? 1 : 0;
        if (h.held) h.local.copy(h.deskLocal); else h.local.copy(inp.gripPos).applyMatrix4(invRig);
      } else {
        h.value = inp.present ? Math.max(inp.squeeze, inp.trigger) : 0;
        h.local.copy(inp.gripPos).applyMatrix4(invRig);
      }
      h.cooldown = Math.max(0, h.cooldown - dt);
    }

    // panels
    const hit = busy ? null : pointer.update(input.main, { show: true });
    let clicked = false;
    if (hit?.button && input.main.triggerDown) clicked = pointer.click(hit);

    // snap turn (VR) and stick walking on flat ground
    if (!desk && !busy) { const ry = rig.rotation.y; loco.update(dt, input, rig, { move: false, turn: true }); if (rig.rotation.y !== ry) syncRig(); }
    if (mode === 'ground' && !busy) {
      const d = loco.update(dt, input, rig, { move: true, turn: false });
      if (d.lengthSq() > 0) {
        syncRig(); headWorld(_head);
        if (!inside(groundSurf, _head.x, _head.z, 0)) { rig.position.sub(d); syncRig(); }
      }
    }

    // ── grabs and releases ──
    if (!busy) {
      if (desk) {
        _dir.set(0, 0, -1).applyQuaternion(input.main.rayQuat);
        deskTarget = nearestRay(input.main.rayPos, _dir, DESK_REACH) ? pick.g : null;
        if (deskTarget) deskTargetPt.copy(pick.pt);
        const dt0 = pick.t;
        if (input.mouse.leftDown && !hit?.button) { // desktop: click a jade token within reach to collect it
          for (const tk of W.tokens) { if (tk.taken) continue; _b.subVectors(tk.pos, input.main.rayPos); const al = _b.dot(_dir); if (al > 0 && al < DESK_REACH + 0.4 && _b.addScaledVector(_dir, -al).length() < 0.2) collect(tk); }
        }
        if (!clicked && !hit?.button) {
          if (input.mouse.leftDown && deskTarget && hands[0].stamina > 0.05 && !hands[0].cooldown) attach(hands[0], deskTarget, deskTargetPt, dt0);
          if (input.mouse.rightDown && deskTarget && hands[1].stamina > 0.05 && !hands[1].cooldown) attach(hands[1], deskTarget, deskTargetPt, dt0);
        }
        const pulling = (input.mouse.left && hands[0].held) || (input.mouse.right && hands[1].held);
        input.lookEnabled = !pulling;
        if (pulling) {
          const k = 0.0035, yaw = input.yaw;
          let mx = input.mouse.dx * k, my = -input.mouse.dy * k;
          const m = Math.hypot(mx, my); if (m > 0.2) { mx *= 0.2 / m; my *= 0.2 / m; }
          for (const h of hands) if (h.held) { h.deskLocal.x += Math.cos(yaw) * mx; h.deskLocal.z += -Math.sin(yaw) * mx; h.deskLocal.y += my; h.local.copy(h.deskLocal); }
        }
        // desktop arms are telescopic: drift the body in towards the wall while hanging
        let nh = 0; _c.set(0, 0, 0);
        for (const h of hands) if (h.held) { _c.add(h.deskLocal); nh++; }
        if (nh) {
          _c.multiplyScalar(1 / nh).sub(camera.position); _c.y = 0;
          const L = _c.length();
          if (L > 0.5) { const step = Math.min(L - 0.5, 1.2 * dt) / L; for (const h of hands) if (h.held) { h.deskLocal.addScaledVector(_c, -step); h.local.copy(h.deskLocal); } }
        }
        if (input.keyDown('Space')) {
          if (anyHeld()) { releaseAll(); leaveClimb(true); }
          else if (mode === 'ground') { mode = 'air'; vel.set(0, 3.2, 0); peakY = rig.position.y; }
        }
      } else {
        for (const h of hands) {
          if (!h.inp.present) { if (h.held) release(h); continue; }
          if (h.held && h.value < 0.3) release(h);
          else if (!h.held && h.value > 0.6 && h.prevValue <= 0.6 && !(h.i === 0 && (clicked || hit?.button)) && h.stamina > 0.05 && !h.cooldown) {
            _hw.copy(h.local).applyMatrix4(rig.matrixWorld);
            if (nearest(_hw, GRAB_R)) attach(h, pick.g, pick.pt, pick.t);
          }
        }
      }
      for (const h of hands) if (h.inp.a) placePiton(h);
      if (input.main.b && run && !fade.cb) { sfx.tone({ freq: 330, dur: 0.1, gain: 0.06 }); fadeThen(respawn); }
    }

    // ── holds: crumbling, ropes sliding ──
    for (const g of W.holds) {
      if (g.type !== 'crumble') continue;
      if (g.broken) { g.restoreT -= dt; if (g.restoreT <= 0) { g.broken = false; g.crumbleT = 0; W.setHoldMatrix(g); } continue; }
      const heldBy = (hands[0].held === g) + (hands[1].held === g);
      if (heldBy) {
        g.crumbleT += dt;
        if (g.crumbleT > 0.9) {
          const j = (g.crumbleT - 0.9) * 0.02;
          W.setHoldMatrix(g, Math.sin(time * 70) * j, Math.cos(time * 53) * j);
          for (const h of hands) if (h.held === g) { h.tickT -= dt; if (h.tickT <= 0) { h.tickT = 0.12; buzz(h, 0.35, 25); sfx.noise({ freq: 400, dur: 0.05, gain: 0.08, pos: g.pos }); } }
        }
        if (g.crumbleT > 1.7) {
          g.broken = true; g.restoreT = 9; W.setHoldMatrix(g); W.emitDust(g.pos, 20);
          sfx.noise({ freq: 220, q: 0.6, dur: 0.7, gain: 0.45, pos: g.pos });
          for (const h of hands) if (h.held === g) release(h, 'break');
        }
      } else if (g.crumbleT > 0) { g.crumbleT = Math.max(0, g.crumbleT - dt * 0.4); if (g.crumbleT < 0.9) W.setHoldMatrix(g); }
    }
    for (const h of hands) {
      const g = h.held;
      if (!g || g.kind !== 'bar' || (g.type !== 'rope' && g.type !== 'chain') || g.a.y - g.b.y < 1) continue;
      const slide = desk ? input.key('ShiftLeft') || input.key('ShiftRight') : h.value < 0.8;
      if (slide && h.t < 1) {
        h.t = Math.min(1, h.t + dt * 2.2 / g.a.distanceTo(g.b));
        h.tickT -= dt; if (h.tickT <= 0) { h.tickT = 0.08; buzz(h, 0.2, 20); sfx.noise({ freq: 2200, q: 2, dur: 0.06, gain: 0.05 }); }
      }
    }

    // ── locomotion by climbing / physics ──
    let supported = mode === 'ground';
    if (mode === 'climb') {
      if (!anyHeld()) leaveClimb(false);
      else {
        const prevY = rig.position.y;
        prevRig.copy(rig.position);
        _corr.set(0, 0, 0); let n = 0;
        for (const h of hands) {
          if (!h.held) continue;
          anchorOf(h, _a); _hw.copy(h.local).applyMatrix4(rig.matrixWorld);
          _corr.add(_a.sub(_hw)); n++;
        }
        rig.position.addScaledVector(_corr, 1 / n);
        syncRig(); headWorld(_head);
        const sup = supportBelow(_head.x, _head.z, prevY);
        if (sup && rig.position.y < sup.y) rig.position.y = sup.y;
        supported = !!sup && rig.position.y - sup.y < 0.06;
        if (supported) groundSurf = sup;
        collide();
        if (dt > 0) climbVel.lerp(_b.subVectors(rig.position, prevRig).divideScalar(dt), 0.35);
        if (supported && sup) onSurface(sup);
      }
    } else if (mode === 'air') {
      const prevY = rig.position.y;
      vel.y -= G * dt; vel.multiplyScalar(1 - 0.12 * dt);
      rig.position.addScaledVector(vel, dt);
      syncRig();
      if (collide()) { vel.x *= 0.3; vel.z *= 0.3; }
      peakY = Math.max(peakY, rig.position.y);
      headWorld(_head);
      if (vel.y <= 0) {
        let s0 = null;
        for (const s of W.surfaces) if (s.y <= prevY + 0.01 && s.y >= rig.position.y && inside(s, _head.x, _head.z, 0.25) && (!s0 || s.y > s0.y)) s0 = s;
        if (s0) { const fall = peakY - s0.y; land(s0, fall); if (fall > DEATH_FALL) die(); }
      }
      if (mode === 'air' && (peakY - rig.position.y > DEATH_FALL || rig.position.y < -60)) die();
      if (fade.cb && fade.a > 0.98) vel.set(0, 0, 0);
    } else if (mode === 'ground') {
      headWorld(_head);
      if (Math.abs(rig.position.y - groundSurf.y) > 0.05) { mode = 'air'; vel.set(0, 0, 0); peakY = rig.position.y; }
      else if (!inside(groundSurf, _head.x, _head.z, 0.1)) { // stepped off (room-scale)
        const s = supportBelow(_head.x, _head.z, rig.position.y, 0);
        if (s && Math.abs(s.y - rig.position.y) < 0.05) groundSurf = s;
        else { mode = 'air'; vel.set(0, 0, 0); peakY = rig.position.y; }
      }
      collide();
    } else if (mode === 'belay') {
      collide();
      const arr = belayGeo.attributes.position.array, p = run.cp.hold?.pos;
      if (p) { headWorld(_head); arr[0] = p.x; arr[1] = p.y; arr[2] = p.z; arr[3] = _head.x; arr[4] = _head.y - 0.6; arr[5] = _head.z; belayGeo.attributes.position.needsUpdate = true; }
    }
    syncRig();

    // ── stamina ──
    const nHeld = (hands[0].held ? 1 : 0) + (hands[1].held ? 1 : 0);
    for (const h of hands) {
      if (h.held) {
        const g = h.held;
        const drain = (RATE[g.type] ?? 0.04) * (nHeld === 1 ? 1.8 : 1) * (g.overhang ? 1.6 : 1) * (supported ? 0.15 : 1);
        h.stamina -= drain * dt;
        if (h.stamina <= 0) { h.stamina = 0; release(h, 'slip'); }
        else if (h.stamina < 0.25) { h.warnT -= dt; if (h.warnT <= 0) { h.warnT = 0.2 + h.stamina * 2; buzz(h, 0.3, 30); } }
      } else {
        h.stamina = Math.min(1, h.stamina + (supported || mode === 'ground' ? 0.45 : 0.1) * dt);
      }
    }
    if (mode === 'climb' && !anyHeld()) leaveClimb(false);

    // ── gloves, markers ──
    for (const h of hands) {
      const inp = h.inp, gl = h.glove.group;
      gl.visible = inp.present;
      if (h.held) anchorOf(h, h.world); else h.world.copy(h.local).applyMatrix4(rig.matrixWorld);
      gl.position.copy(h.world);
      if (desk && h.held) {
        // rest the glove over the hold, fingers curling onto it
        const g = h.held;
        if (g.kind === 'hold') _c.copy(g.normal); else _c.set(h.world.x - g.tower.cx, 0, h.world.z - g.tower.cz).normalize();
        _d.copy(_c).addScaledVector(UPV, 1).normalize(); _c.sub(UPV).normalize(); _b.crossVectors(_d, _c);
        _m4.makeBasis(_b, _d, _c); gl.quaternion.setFromRotationMatrix(_m4);
        gl.position.addScaledVector(_d, 0.03);
      } else gl.quaternion.copy(desk ? input.head.quat : inp.gripQuat);
      h.glove.setClosed(h.held ? 1 : h.value * 0.6, dt);
      h.glove.setStamina(h.stamina, h.stamina < 0.25 && (time * 6) % 1 < 0.5);
      // target marker
      let show = false;
      if (!busy && !h.held) {
        if (desk) { if (h.i === 0 && deskTarget) { h.marker.position.copy(deskTargetPt); show = true; } }
        else if (inp.present && nearest(h.world, GRAB_R * 1.4)) { h.marker.position.copy(pick.pt); show = true; }
      }
      h.marker.visible = show;
      if (show) { h.marker.lookAt(input.head.pos); h.marker.material.opacity = h.stamina > 0.05 && !h.cooldown ? 0.85 : 0.25; }
    }

    // ── tokens ──
    headWorld(_head);
    for (const tk of W.tokens) {
      if (tk.taken) continue;
      if (tk.pos.distanceToSquared(_head) < 0.16 || tk.pos.distanceToSquared(hands[0].world) < 0.09 || tk.pos.distanceToSquared(hands[1].world) < 0.09) collect(tk);
    }

    // ── run timer / hud ──
    if (run && run.started && !run.finished) run.time += dt;
    wristT -= dt; if (wristT <= 0) { wristT = 0.25; drawWrist(); }

    // ── comfort vignette, fade ──
    const moved = _b.subVectors(rig.position, lastRig).length() / Math.max(dt, 1e-3);
    lastRig.copy(rig.position);
    speedSm += (Math.min(moved, 20) - speedSm) * Math.min(1, dt * 6);
    vigSm += ((comfort && mode !== 'ground' ? Math.min(0.9, Math.max(0, (speedSm - 1.0) / 2.5)) : 0) - vigSm) * Math.min(1, dt * 5);
    if (fade.a !== fade.target) {
      fade.a += Math.sign(fade.target - fade.a) * fade.speed * dt;
      if ((fade.target === 1 && fade.a >= 1) || (fade.target === 0 && fade.a <= 0)) fade.a = fade.target;
      if (fade.a === 1 && fade.cb) { const cb = fade.cb; cb(); fade.cb = null; fade.target = 0; lastRig.copy(rig.position); speedSm = 0; }
    }
    overlayMat.uniforms.fade.value = fade.a; overlayMat.uniforms.vig.value = vigSm;
    overlay.visible = fade.a > 0.002 || vigSm > 0.01;

    // ── ambience ──
    W.update(dt, time);
    windT -= dt;
    if (wind && windT <= 0) { windT = 0.2; const lvl = 0.025 + Math.min(1, Math.max(0, rig.position.y / 34)) * 0.07 + Math.min(0.08, speedSm * 0.012); wind.g.gain.setTargetAtTime(lvl, ctx.audio.ctx.currentTime, 0.4); wind.f.frequency.setTargetAtTime(380 + speedSm * 60, ctx.audio.ctx.currentTime, 0.4); }

    if (desk) {
      hudT -= dt;
      if (hudT <= 0) {
        hudT = 0.1;
        const rt = ROUTES[run.route];
        const st = (s) => '▮'.repeat(Math.round(s * 5)) + '▯'.repeat(5 - Math.round(s * 5));
        ctx.setHud(`${rt.name} ${run.started || run.finished ? fmt(run.time) : 'ready'} · ◆${run.jade}/${rt.tokens.length} · piton ${run.pitonsLeft} · L${st(hands[1].stamina)} R${st(hands[0].stamina)} · aim+LMB/RMB grab, hold+drag pull, Space let go, Shift slide, E piton, R checkpoint`);
      }
    }
  }

  return {
    spawn: SPAWN,
    update,
    onXRStart() { releaseAll(); placeStanding(SPAWN.x, 0, SPAWN.z, SPAWN.yaw); },
    onXREnd() { releaseAll(); placeStanding(SPAWN.x, 0, SPAWN.z, SPAWN.yaw); },
    dispose() {
      camera.remove(overlay); overlay.geometry.dispose(); overlayMat.dispose();
      if (wind) { try { wind.g.gain.setTargetAtTime(0, ctx.audio.ctx.currentTime, 0.05); wind.src.stop(ctx.audio.ctx.currentTime + 0.3); } catch { } }
      input.lookEnabled = true;
    },
    // test / debug hooks
    debug: {
      W, hands, get mode() { return mode; }, get run() { return run; }, get fade() { return fade.a; },
      grab(i, gi) { const g = W.grabs[gi]; syncRig(); invRig.copy(rig.matrixWorld).invert(); attach(hands[i], g, g.kind === 'hold' ? g.pos : g.a, 0); },
      pull(dy, dx = 0) { for (const h of hands) if (h.held) { h.deskLocal.y -= dy; h.deskLocal.x += dx; } },
      releaseAll() { releaseAll(); leaveClimb(false); },
      jump() { releaseAll(); leaveClimb(true); },
      selectRoute, toBase, die,
    },
  };
}
