import * as THREE from 'three';
import { Panel, Pointer, makeLabel, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { DrumAudio, PRESETS } from './audio.js';
import { buildKit, reactPad, updateReactors, sweepPad, rayPad, makeStick, STICK_TIP } from './instruments.js';
import { buildTemple, makeEnvMap } from './env.js';
import { STYLES, LESSONS, lessonNotes, compileStyle, degFreq } from './music.js';

// Thunder Drums: temple percussion with velocity-sensitive, spatialized synthesis.
// Sticks follow the grips; the tip's path from last frame to this frame is swept against
// each instrument's striking surface. Speed along the surface normal sets loudness/brightness.

const LOOP_BEATS = 8;
const LEAD = 1.6;            // seconds a lesson marker is visible before its hit time
const WIN_PERFECT = 0.05, WIN_GOOD = 0.11, WIN_MISS = 0.15;
const FAMILY_COLOR = { drum: 0xff6a3a, bell: 0xc8f08a, gong: 0xffc040, cymbal: 0x8ad8ff, wood: 0xe0a8ff };
const UP = new THREE.Vector3(0, 1, 0);
const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

export async function create(ctx) {
  const { scene, input, rig } = ctx;

  // ── world ────────────────────────────────────────────────
  const envMap = makeEnvMap();
  const temple = buildTemple(scene);
  const kitRoot = new THREE.Group(); kitRoot.name = 'kit';
  scene.add(kitRoot);
  const { pads, reactors } = buildKit(kitRoot, envMap);
  const padById = Object.fromEntries(pads.map(p => [p.id, p]));
  for (const p of pads) {
    p.land = p.kind === 'disc' ? p.c.clone().addScaledVector(p.n, 0.012) : p.c.clone().addScaledVector(p.n, p.R);
    p.approach = UP.clone().addScaledVector(p.n, 0.7).normalize();
    p.ringQ = p.kind === 'disc' ? p.group.quaternion.clone() : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.n);
    p.color = new THREE.Color(FAMILY_COLOR[p.family]);
  }

  // ── settings / saves ─────────────────────────────────────
  const saved = ctx.load('drums:settings', {}) ?? {};
  const S = {
    kitX: saved.kitX ?? 0, kitZ: saved.kitZ ?? 0, kitYaw: saved.kitYaw ?? 0, kitDY: saved.kitDY ?? 0,
    bpm: saved.bpm ?? 92, style: saved.style ?? 0, latencyMs: saved.latencyMs ?? 0,
  };
  const saveSettings = () => ctx.save('drums:settings', S);
  let headH = 1.62;
  const autoY = () => THREE.MathUtils.clamp((headH - 1.62) * 0.65, -0.45, 0.3);
  const kitInv = new THREE.Matrix4();
  let kitMoved = true;
  function placeKit() {
    kitRoot.position.set(S.kitX, autoY() + S.kitDY, S.kitZ);
    kitRoot.rotation.set(0, S.kitYaw, 0);
    kitRoot.updateMatrixWorld(true);
    kitInv.copy(kitRoot.matrixWorld).invert();
    for (const p of pads) p.worldPos.copy(p.c).applyMatrix4(kitRoot.matrixWorld);
    kitMoved = true;
    for (const st of sticks) st.hasPrev = false;
  }

  // ── audio (created lazily once the platform has an AudioContext) ─
  let A = null;
  function ensureAudio() {
    if (A || !ctx.audio.ctx) return A;
    A = new DrumAudio(ctx.audio.ctx, ctx.audio.out);
    for (const p of pads) p.src = A.addSource(p.family === 'gong' ? 0.5 : p.family === 'bell' ? 0.45 : p.family === 'cymbal' ? 0.32 : 0.28);
    kitMoved = true;
    tr.t0 = A.ac.currentTime + 0.1; tr.nextStep = 0; tr.schedBeat = 0; tr.running = true;
    return A;
  }
  const latency = () => (A ? (A.ac.outputLatency || A.ac.baseLatency || 0) : 0) + S.latencyMs / 1000;

  // ── transport ────────────────────────────────────────────
  const tr = { running: false, t0: 0, bpm: S.bpm, nextStep: 0, schedBeat: 0 };
  const beatAt = (t) => (t - tr.t0) * tr.bpm / 60;
  const timeAtBeat = (b) => tr.t0 + b * 60 / tr.bpm;
  function setBpm(b) {
    b = THREE.MathUtils.clamp(Math.round(b), 60, 160);
    if (A && tr.running) { const now = A.ac.currentTime, cur = beatAt(now); tr.bpm = b; tr.t0 = now - cur * 60 / b; }
    else tr.bpm = b;
    if (mode === 'free') { S.bpm = b; saveSettings(); }
  }
  let styles = STYLES.map(compileStyle);
  let groove = false;
  let mode = 'free'; // 'free' | 'lesson'
  let activeStyle = styles[S.style % styles.length];

  // ── recorder ─────────────────────────────────────────────
  const rec = { state: 'idle', startBeat: 0, cur: [] };
  const layers = [];
  function recToggle() {
    if (mode !== 'free' || !A) return;
    if (rec.state !== 'idle') { rec.state = 'idle'; rec.cur = []; return; }
    const b = beatAt(A.ac.currentTime);
    let sb = Math.ceil(b / 4) * 4; if (sb - b < 0.75) sb += 4;
    rec.startBeat = sb; rec.cur = []; rec.state = 'armed';
  }
  function recCapture(padIdx, vel, hit, t) {
    if (rec.state !== 'rec' && !(rec.state === 'armed' && beatAt(t) > rec.startBeat - 0.2)) return;
    const b = beatAt(t);
    const rel = b - rec.startBeat;
    if (rel < -0.2 || rel >= LOOP_BEATS) return;
    rec.cur.push({ beat: (((b % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS), pad: padIdx, vel, r: hit.r, lx: hit.lx, ly: hit.ly, side: hit.side ?? 0 });
  }

  // ── visuals: sticks, flashes, markers, labels ─────────────
  const sticks = [input.left, input.right].map((hand) => {
    const mesh = makeStick(); scene.add(mesh); mesh.visible = false;
    return { hand, mesh, prevTip: new THREE.Vector3(), hasPrev: false, theta: 0, omega: 0, axis: new THREE.Vector3(1, 0, 0), lastHit: new Float64Array(pads.length).fill(-1) };
  });

  const FLASH_N = 10;
  const flashMesh = new THREE.InstancedMesh(new THREE.RingGeometry(0.55, 1, 28), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), FLASH_N);
  flashMesh.frustumCulled = false; flashMesh.count = 0; flashMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flashMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  kitRoot.add(flashMesh);
  const flashes = Array.from({ length: FLASH_N }, () => ({ age: 9, pos: new THREE.Vector3(), q: new THREE.Quaternion(), size: 0.1, color: new THREE.Color() }));
  let flashNext = 0;
  function spawnFlash(pad, hx, hy, hz, vel) {
    const f = flashes[flashNext]; flashNext = (flashNext + 1) % FLASH_N;
    f.age = 0; f.pos.set(hx, hy, hz).addScaledVector(pad.n, 0.004); f.q.copy(pad.ringQ);
    f.size = (pad.kind === 'disc' ? 0.05 : 0.035) + 0.07 * vel; f.color.copy(pad.color).multiplyScalar(0.4 + 0.8 * vel);
  }

  const MAXM = 24;
  const orbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 12, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), MAXM);
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), MAXM);
  for (const im of [orbs, rings]) { im.frustumCulled = false; im.count = 0; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, new THREE.Color()); kitRoot.add(im); }

  const JUDGE_STYLE = { perfect: ['PERFECT', '#ffe27a'], good: ['GOOD', '#8ae0ff'], miss: ['MISS', '#ff6a5a'] };
  const judgeSprites = [];
  for (const k of Object.keys(JUDGE_STYLE)) for (let i = 0; i < 3; i++) {
    const s = makeLabel(JUDGE_STYLE[k][0], { size: 0.06, color: JUDGE_STYLE[k][1], font: FONTS.sans, px: 56 });
    s.visible = false; s.material.depthTest = false; s.renderOrder = 10; s.userData = { kind: k, age: 9 };
    kitRoot.add(s); judgeSprites.push(s);
  }
  function showJudge(kind, pad) {
    let best = null;
    for (const s of judgeSprites) if (s.userData.kind === kind && (!best || s.userData.age > best.userData.age)) best = s;
    best.userData.age = 0; best.visible = true; best.position.copy(pad.land).addScaledVector(UP, 0.12);
  }

  const hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  hoverRing.visible = false; kitRoot.add(hoverRing);

  const moveLabel = makeLabel('MOVE KIT · hold both grips and drag · stick ↑↓ = height', { size: 0.05, color: '#ffe08a', bg: 'rgba(20,10,4,0.75)', px: 48 });
  moveLabel.position.set(0, 1.9, -0.5); moveLabel.visible = false; kitRoot.add(moveLabel);

  // scheduled visual reactions (loop playback): ring buffer
  const vq = Array.from({ length: 64 }, () => ({ t: 0, pad: 0, vel: 0, lx: 0, ly: 0, on: false }));
  let vqNext = 0;
  function queueVisual(t, padIdx, vel, lx, ly) { const e = vq[vqNext]; vqNext = (vqNext + 1) % vq.length; e.t = t; e.pad = padIdx; e.vel = vel; e.lx = lx; e.ly = ly; e.on = true; }

  // ── sound for a pad ──────────────────────────────────────
  // hit: { r, lx, ly, side, front }  r = normalized distance from centre (0 centre .. 1 edge)
  function soundPad(pad, vel, hit, t) {
    if (!A || !pad.src) return;
    const id = pad.id, src = pad.src;
    if (id === 'taiko') { if (hit.r > 0.98) A.wood(src, t, vel, PRESETS.ka); else A.membrane(src, t, vel, hit.r, PRESETS.taiko); }
    else if (id === 'tomL' || id === 'tomR') { if (hit.r > 1.0) A.wood(src, t, vel * 0.8, PRESETS.ka); else A.membrane(src, t, vel, hit.r, PRESETS[id]); }
    else if (pad.family === 'bell') A.bell(src, t, vel, pad.freq, Math.abs(hit.side ?? 0) > 0.45, pad.low);
    else if (id === 'gong' || id === 'luo') A.gong(src, t, vel, hit.r, PRESETS[id]);
    else if (pad.family === 'cymbal') A.cymbal(src, t, vel, hit.r, PRESETS[id]);
    else A.wood(src, t, vel, PRESETS[id]);
  }
  const hitDirTmp = new THREE.Vector3();
  // Player (or desktop) strike at audio time th (may be slightly in the past)
  function strike(pad, vel, hit, th, dirKit) {
    ensureAudio();
    const now = A ? A.ac.currentTime : 0;
    soundPad(pad, vel, hit, now);
    reactPad(pad, vel, hit.lx, hit.ly, dirKit);
    spawnFlash(pad, hit.hx, hit.hy, hit.hz, vel);
    stats.hits++; stats.lastVel = vel; stats.lastPad = pad.id; stats.lastR = hit.r;
    if (!A) return;
    if (mode === 'free') recCapture(pad.index, vel, hit, th);
    else if (lesson && !lesson.done) judgeHit(pad.index, th);
  }

  // ── lessons ──────────────────────────────────────────────
  let lesson = null;
  let results = null;
  function startLesson(i) {
    ensureAudio(); if (!A) return;
    const def = LESSONS[i];
    rec.state = 'idle'; rec.cur = [];
    mode = 'lesson'; results = null; tab = 'lessons';
    activeStyle = styles.find(s => s.id === def.style) ?? styles[0];
    tr.bpm = def.bpm; tr.t0 = A.ac.currentTime + 0.4; tr.nextStep = 0; tr.schedBeat = 0;
    const notes = lessonNotes(def).map(n => ({ beat: 4 + n.beat, pad: padById[n.pad].index, time: 0, judged: 0 }));
    for (const n of notes) n.time = timeAtBeat(n.beat);
    lesson = { def, index: i, notes, first: 0, score: 0, combo: 0, maxCombo: 0, perfect: 0, good: 0, miss: 0, done: false, endBeat: 4 + def.bars * 4 + 1 };
    menu.markDirty();
  }
  function stopLesson() {
    lesson = null; mode = 'free';
    activeStyle = styles[S.style % styles.length];
    if (A) { const now = A.ac.currentTime; tr.bpm = S.bpm; tr.t0 = now + 0.1; tr.nextStep = 0; tr.schedBeat = 0; }
    orbs.count = rings.count = 0;
    menu.markDirty();
  }
  function finishLesson() {
    const L = lesson; L.done = true;
    const total = L.notes.length;
    const acc = total ? (L.perfect + 0.5 * L.good) / total : 0;
    const grade = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
    const key = 'drums:best:' + L.def.id;
    const prev = ctx.load(key, null);
    const isBest = !prev || L.score > prev.score;
    if (isBest) ctx.save(key, { score: L.score, acc: Math.round(acc * 100), grade });
    results = { name: L.def.name, index: L.index, score: L.score, perfect: L.perfect, good: L.good, miss: L.miss, total, acc, grade, maxCombo: L.maxCombo, isBest, prevBest: prev?.score ?? 0 };
    stopLesson();
    results && (tab = 'lessons');
    menu.markDirty();
  }
  function award(kind, note) {
    const L = lesson;
    note.judged = kind === 'perfect' ? 1 : kind === 'good' ? 2 : 3;
    if (kind === 'miss') { L.miss++; L.combo = 0; }
    else {
      L.combo++; L.maxCombo = Math.max(L.maxCombo, L.combo);
      const base = kind === 'perfect' ? 100 : 50;
      L.score += Math.round(base * (1 + Math.min(L.combo, 30) / 30));
      if (kind === 'perfect') L.perfect++; else L.good++;
    }
    showJudge(kind, pads[note.pad]);
  }
  function judgeHit(padIdx, th) {
    const L = lesson, t = th - latency();
    let best = null, bestErr = WIN_MISS;
    for (let i = L.first; i < L.notes.length; i++) {
      const n = L.notes[i];
      if (n.time > t + WIN_MISS) break;
      if (n.judged || n.pad !== padIdx) continue;
      const err = Math.abs(n.time - t);
      if (err < bestErr) { bestErr = err; best = n; }
    }
    if (!best) return;
    award(bestErr <= WIN_PERFECT ? 'perfect' : bestErr <= WIN_GOOD ? 'good' : 'miss', best);
  }
  const _o = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _c = new THREE.Color();
  function updateLesson() {
    const L = lesson; if (!L || !A) return;
    const now = A.ac.currentTime - latency();
    // misses
    for (let i = L.first; i < L.notes.length; i++) {
      const n = L.notes[i];
      if (n.time > now - WIN_MISS) break;
      if (!n.judged) award('miss', n);
    }
    while (L.first < L.notes.length && L.notes[L.first].judged) L.first++;
    // markers
    let k = 0;
    for (let i = L.first; i < L.notes.length && k < MAXM; i++) {
      const n = L.notes[i];
      if (n.time > now + LEAD) break;
      if (n.judged) continue;
      const pad = pads[n.pad];
      const p = Math.max(0, (n.time - now) / LEAD);
      _o.copy(pad.land).addScaledVector(pad.approach, p * 0.8);
      _s.setScalar(0.7 + (1 - p) * 0.5);
      _m4.compose(_o, _q.identity(), _s); orbs.setMatrixAt(k, _m4);
      _c.copy(pad.color).multiplyScalar(0.45 + 0.75 * (1 - p)); orbs.setColorAt(k, _c);
      _s.setScalar(pad.R * (1.0 + 1.0 * p));
      _m4.compose(pad.land, pad.ringQ, _s); rings.setMatrixAt(k, _m4);
      _c.copy(pad.color).multiplyScalar(p > 0.75 ? 0 : 0.1 + 0.8 * (1 - p) * (1 - p)); rings.setColorAt(k, _c);
      k++;
    }
    orbs.count = rings.count = k;
    orbs.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = true;
    if (k) { orbs.instanceColor.needsUpdate = rings.instanceColor.needsUpdate = true; }
    if (beatAt(now) > L.endBeat && L.first >= L.notes.length) finishLesson();
  }

  // ── scheduler: backing groove, metronome, loop layers ─────
  function playStep(s, t) {
    if (mode === 'lesson') {
      if (s < 16) { if (s % 4 === 0) A.click(t, s === 0); return; }
      if (lesson && s / 4 > lesson.endBeat) return;
      backingStep(s - 16, t, 0.85);
      return;
    }
    if (groove) backingStep(s, t, 1);
    else if (rec.state !== 'idle' && s % 4 === 0) A.click(t, s % 16 === 0);
  }
  function backingStep(s, t, lvl) {
    const st = activeStyle, i = ((s % 32) + 32) % 32, step = st.steps[i];
    if (step.kick) A.kick(t, (i % 16 === 0 ? 1 : 0.75) * lvl);
    if (step.shaker) A.shaker(t, (i % 4 === 0 ? 1 : 0.6) * lvl);
    if (step.mel >= 0) A.pluck(t, degFreq(step.mel, -1), 0.9 * lvl, (s * 7) % 5 === 0);
    if (i === 0 || i === 16) A.pad(t, degFreq(st.pad[i === 0 ? 0 : 1], -2), 16 * 15 / tr.bpm);
  }
  const hitTmp = { r: 0, lx: 0, ly: 0, side: 0, front: 1, hx: 0, hy: 0, hz: 0 };
  function scheduleLayers(b0, b1) { for (const layer of layers) scheduleLayer(layer, b0, b1); }
  function scheduleLayer(layer, b0, b1) {
    for (const e of layer) {
      const k = Math.floor((b0 - e.beat) / LOOP_BEATS) + 1;
      const ab = e.beat + k * LOOP_BEATS;
      if (ab > b1) continue;
      const t = Math.max(timeAtBeat(ab), A.ac.currentTime);
      const pad = pads[e.pad];
      hitTmp.r = e.r; hitTmp.lx = e.lx; hitTmp.ly = e.ly; hitTmp.side = e.side;
      soundPad(pad, e.vel, hitTmp, t);
      queueVisual(t, e.pad, e.vel, e.lx, e.ly);
    }
  }
  function schedule(dt) {
    if (!A || !tr.running) return;
    const now = A.ac.currentTime;
    const horizon = now + Math.max(0.12, dt * 2 + 0.05);
    const endBeat = beatAt(horizon);
    while (tr.nextStep / 4 < endBeat) {
      const t = timeAtBeat(tr.nextStep / 4);
      if (t >= now - 0.03) playStep(tr.nextStep, Math.max(t, now));
      tr.nextStep++;
    }
    if (mode === 'free' && layers.length && endBeat > tr.schedBeat) scheduleLayers(tr.schedBeat, endBeat);
    tr.schedBeat = Math.max(tr.schedBeat, endBeat);
    // recorder state machine
    const b = beatAt(now);
    if (rec.state === 'armed' && b >= rec.startBeat) rec.state = 'rec';
    if (rec.state === 'rec' && b >= rec.startBeat + LOOP_BEATS) {
      if (rec.cur.length) {
        layers.push(rec.cur); if (layers.length > 8) layers.shift();
        // the look-ahead window may already cover the start of the next pass
        scheduleLayer(rec.cur, rec.startBeat + LOOP_BEATS - 0.001, tr.schedBeat);
      }
      rec.cur = []; rec.state = 'idle';
      // layer becomes audible from the next loop pass: don't re-schedule the window just played
    }
  }

  // ── menu panel ───────────────────────────────────────────
  let tab = 'free';
  const moveState = { on: false, grab: false, m0: new THREE.Vector3(), a0: 0, p0: new THREE.Vector3(), yaw0: 0 };
  const text = (c, s, x, y, size, color = '#f1e6cf', font = FONTS.sans, align = 'left') => { c.font = `${size}px ${font}`; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'middle'; c.fillText(s, x, y); };
  const bestOf = (id) => ctx.load('drums:best:' + id, null);
  const menu = new Panel({
    width: 0.84, height: 0.62, px: 1024, draw: (c, W, H, P) => {
      roundRect(c, 4, 4, W - 8, H - 8, 28); c.fillStyle = '#1a0e08'; c.fill();
      c.lineWidth = 4; c.strokeStyle = '#d2a446'; c.stroke();
      text(c, '雷鼓', 40, 62, 64, '#e8c060', FONTS.brush);
      text(c, 'Thunder Drums', 180, 66, 44, '#f1e6cf', FONTS.latin);
      const tabs = [['free', 'Free Play'], ['lessons', 'Lessons'], ['kit', 'Kit']];
      tabs.forEach(([id, label], i) => P.button('tab-' + id, 40 + i * 320, 110, 300, 66, label, () => { tab = id; }, { active: tab === id, size: 30 }));
      if (tab === 'free') {
        if (mode === 'lesson') { text(c, 'A lesson is running. Stop it in the Lessons tab.', 40, 240, 30); return; }
        text(c, 'BACKING GROOVE', 40, 218, 22, '#c8a868');
        P.button('groove', 40, 240, 280, 80, groove ? 'Groove: ON' : 'Groove: OFF', () => { groove = !groove; }, { active: groove });
        P.button('style', 340, 240, 640, 80, 'Style: ' + activeStyle.name, () => { S.style = (S.style + 1) % styles.length; activeStyle = styles[S.style]; setBpm(activeStyle.bpm); saveSettings(); });
        P.button('tdown', 40, 340, 120, 80, '−', () => setBpm(tr.bpm - 4), { size: 48 });
        text(c, `${tr.bpm} BPM`, 250, 382, 40, '#ffe7b0', FONTS.sans, 'center');
        P.button('tup', 340, 340, 120, 80, '+', () => setBpm(tr.bpm + 4), { size: 48 });
        text(c, 'LOOP RECORDER (2 bars)', 40, 458, 22, '#c8a868');
        const rl = rec.state === 'idle' ? '● Record' : rec.state === 'armed' ? 'Armed… cancel' : '● Recording';
        P.button('rec', 40, 480, 300, 80, rl, recToggle, { active: rec.state !== 'idle' });
        P.button('undo', 360, 480, 300, 80, 'Undo layer', () => { layers.pop(); }, { enabled: layers.length > 0 });
        P.button('clear', 680, 480, 300, 80, 'Clear', () => { layers.length = 0; }, { enabled: layers.length > 0 });
        let n = 0; for (const l of layers) n += l.length;
        text(c, `${layers.length} layer${layers.length === 1 ? '' : 's'} · ${n} hits looping`, 40, 600, 28, '#f1e6cf');
        text(c, 'Hit harder for louder, brighter tones. Drum centre = deep,', 40, 660, 24, '#a89878');
        text(c, 'edge = ringing. Bells: front = main tone, side = upper tone.', 40, 694, 24, '#a89878');
      } else if (tab === 'lessons') {
        if (results) {
          const R = results;
          text(c, `${R.name}`, 40, 230, 40, '#ffe7b0', FONTS.latin);
          text(c, R.grade, W - 90, 290, 150, R.grade === 'S' ? '#ffe27a' : '#e8c060', FONTS.latin, 'center');
          text(c, `Score ${R.score}${R.isBest ? '  · NEW BEST!' : `  · best ${R.prevBest}`}`, 40, 300, 36, R.isBest ? '#ffe27a' : '#f1e6cf');
          text(c, `Perfect ${R.perfect}   Good ${R.good}   Miss ${R.miss}   (of ${R.total})`, 40, 360, 30);
          text(c, `Accuracy ${Math.round(R.acc * 100)}%   ·   Max combo ${R.maxCombo}`, 40, 410, 30);
          P.button('retry', 40, 500, 440, 90, 'Retry', () => startLesson(R.index));
          P.button('back', 520, 500, 440, 90, 'All lessons', () => { results = null; });
          return;
        }
        if (mode === 'lesson' && lesson) {
          text(c, `${lesson.def.name}`, 40, 240, 44, '#ffe7b0', FONTS.latin);
          text(c, lesson.def.hint, 40, 300, 28);
          text(c, 'Hit each glowing marker as it lands on its instrument.', 40, 350, 26, '#a89878');
          P.button('stop', 40, 420, 440, 90, 'Stop lesson', stopLesson);
          return;
        }
        LESSONS.forEach((L, i) => {
          const b = bestOf(L.id);
          const label = `${i + 1}. ${L.name}   ${'★'.repeat(L.stars)}${'☆'.repeat(4 - L.stars)}   ${L.bpm} BPM   ${b ? `best ${b.score} (${b.grade ?? ''} ${b.acc}%)` : ''}`;
          P.button('les' + i, 40, 200 + i * 104, 944, 88, label, () => startLesson(i), { size: 30 });
        });
      } else {
        P.button('move', 40, 210, 450, 84, moveState.on ? 'Move kit: ON' : 'Move kit: OFF', () => { moveState.on = !moveState.on; moveLabel.visible = moveState.on; }, { active: moveState.on });
        P.button('recenter', 534, 210, 450, 84, 'Recenter to me', recenterKit);
        P.button('hdown', 40, 320, 120, 84, '▼', () => { S.kitDY = Math.max(-0.5, S.kitDY - 0.03); placeKit(); saveSettings(); }, { size: 40 });
        text(c, `Height ${S.kitDY >= 0 ? '+' : ''}${Math.round(S.kitDY * 100)} cm`, 290, 362, 32, '#ffe7b0', FONTS.sans, 'center');
        P.button('hup', 420, 320, 120, 84, '▲', () => { S.kitDY = Math.min(0.5, S.kitDY + 0.03); placeKit(); saveSettings(); }, { size: 40 });
        P.button('reset', 580, 320, 404, 84, 'Reset position', () => { S.kitX = S.kitZ = S.kitYaw = S.kitDY = 0; placeKit(); saveSettings(); });
        P.button('ldown', 40, 430, 120, 84, '−', () => { S.latencyMs -= 10; saveSettings(); }, { size: 44 });
        text(c, `Timing offset ${S.latencyMs} ms`, 290, 472, 30, '#ffe7b0', FONTS.sans, 'center');
        P.button('lup', 420, 430, 120, 84, '+', () => { S.latencyMs += 10; saveSettings(); }, { size: 44 });
        text(c, 'Move mode: hold BOTH grips, then drag and turn the kit.', 40, 580, 26);
        text(c, 'Thumbstick up/down adjusts height. Kit height follows', 40, 620, 26, '#a89878');
        text(c, 'your head height measured when VR starts.', 40, 654, 26, '#a89878');
      }
    },
  });
  {
    const a = THREE.MathUtils.degToRad(-122), d = 0.95;
    const px = Math.sin(a) * d, pz = -Math.cos(a) * d;
    menu.mesh.position.set(px, 1.2, pz);
    menu.mesh.rotation.set(-0.18, Math.atan2(-px, -pz), 0, 'YXZ');
  }
  kitRoot.add(menu.mesh);
  const pointer = new Pointer(scene);
  pointer.panels.push(menu);

  // status board above the bell rack
  const board = new Panel({
    width: 1.1, height: 0.3, px: 880, draw: (c, W, H) => {
      roundRect(c, 4, 4, W - 8, H - 8, 22); c.fillStyle = '#160c06'; c.fill(); c.lineWidth = 4; c.strokeStyle = '#a8782a'; c.stroke();
      const b = A ? beatAt(A.ac.currentTime - latency()) : 0;
      if (mode === 'lesson' && lesson) {
        const L = lesson;
        text(c, L.def.name, 30, 46, 34, '#e8c060', FONTS.latin);
        text(c, `${L.score}`, W - 30, 62, 64, '#ffe7b0', FONTS.sans, 'right');
        text(c, `combo ${L.combo}`, 30, 104, 30, L.combo >= 8 ? '#ffe27a' : '#f1e6cf');
        text(c, `✓ ${L.perfect + L.good}   ✗ ${L.miss}`, 300, 104, 30);
        const prog = THREE.MathUtils.clamp((b - 4) / (L.endBeat - 5), 0, 1);
        c.fillStyle = '#3a2412'; c.fillRect(30, 150, W - 60, 18); c.fillStyle = '#d2a446'; c.fillRect(30, 150, (W - 60) * prog, 18);
        if (b < 4 && b > -1) text(c, b < 0 ? 'Ready' : `${4 - Math.floor(b)}`, W / 2, 210, 48, '#ffe27a', FONTS.sans, 'center');
        else text(c, L.def.hint, 30, 210, 26, '#a89878');
      } else {
        text(c, '雷鼓', 30, 56, 52, '#e8c060', FONTS.brush);
        text(c, `${tr.bpm} BPM · ${groove ? activeStyle.name : 'groove off'}`, 150, 56, 32, '#f1e6cf');
        const rs = rec.state === 'idle' ? (layers.length ? `▶ ${layers.length} loop layer${layers.length > 1 ? 's' : ''}` : 'Free play') : rec.state === 'armed' ? `Recording in ${Math.max(1, Math.ceil(rec.startBeat - b))}…` : `● REC ${Math.floor(b - rec.startBeat) + 1}/8`;
        text(c, rs, 30, 120, 32, rec.state === 'rec' ? '#ff6a5a' : '#ffe7b0');
        const cur = ((Math.floor(b) % 8) + 8) % 8;
        for (let i = 0; i < 8; i++) {
          c.beginPath(); c.arc(W - 330 + i * 40, 120, i === cur ? 13 : 9, 0, 6.28);
          c.fillStyle = i === cur ? (rec.state === 'rec' ? '#ff6a5a' : '#ffe27a') : (i % 4 === 0 ? '#8a6a3a' : '#4a3420'); c.fill();
        }
        const pad = stats.lastPad ? padById[stats.lastPad] : null;
        text(c, pad ? `${pad.label}  ·  velocity ${Math.round(stats.lastVel * 127)}  ·  ${stats.lastR < 0.35 ? 'centre' : stats.lastR > 0.8 ? 'edge' : 'mid'}` : 'Strike any instrument with your sticks', 30, 196, 28, '#a89878');
      }
      void fitText;
    },
  });
  board.mesh.position.set(0, 1.97, -1.02);
  board.mesh.rotation.x = 0.12;
  kitRoot.add(board.mesh);
  const boardSig = new Float64Array(10), boardSigNew = new Float64Array(10);
  const stats = { hits: 0, lastVel: 0, lastPad: null, lastR: 0 };

  function recenterKit() {
    const h = input.head;
    headH = THREE.MathUtils.clamp(h.pos.y - rig.position.y, 1.0, 2.2);
    S.kitX = h.pos.x; S.kitZ = h.pos.z;
    S.kitYaw = Math.atan2(-h.fwd.x, -h.fwd.z);
    S.kitDY = 0;
    placeKit(); saveSettings();
  }

  // ── per-frame helpers ────────────────────────────────────
  const _tip = new THREE.Vector3(), _tipK = new THREE.Vector3(), _dir = new THREE.Vector3(), _nW = new THREE.Vector3(), _sd = new THREE.Vector3();
  const _ro = new THREE.Vector3(), _rd = new THREE.Vector3();
  const hitA = { r: 0, lx: 0, ly: 0, side: 0, front: 1, hx: 0, hy: 0, hz: 0, depth: 0, nx: 0, ny: 0, nz: 0 };
  const hitB = { r: 0, lx: 0, ly: 0, side: 0, front: 1, hx: 0, hy: 0, hz: 0, depth: 0, nx: 0, ny: 0, nz: 0 };
  const copyHit = (dst, src) => { dst.r = src.r; dst.lx = src.lx; dst.ly = src.ly; dst.side = src.side ?? 0; dst.front = src.front ?? 1; dst.hx = src.hx; dst.hy = src.hy; dst.hz = src.hz; dst.depth = src.depth; dst.nx = src.nx; dst.ny = src.ny; dst.nz = src.nz; };
  let sweepOnDesktop = false;
  let measureAt = -1, elapsed = 0;
  let menuRecSig = -1, menuLayerSig = -1, menuHitSig = -1, hudT = -1;

  function strikeFromStick(st, p0, p1, dt) {
    let best = -1, bestF = 2;
    const now = A ? A.ac.currentTime : elapsed;
    for (let i = 0; i < pads.length; i++) {
      hitA.side = 0; hitA.front = 1;
      const f = sweepPad(pads[i], p0, p1, hitA);
      if (f >= 0 && f < bestF && now - st.lastHit[i] > 0.06) { best = i; bestF = f; copyHit(hitB, hitA); }
    }
    if (best < 0) return;
    const pad = pads[best];
    const speed = hitB.depth / Math.max(dt, 1e-3);
    if (speed < 0.35) return;
    const v = THREE.MathUtils.clamp((speed - 0.35) / 5.0, 0, 1);
    const vel = 0.05 + 0.95 * Math.pow(v, 0.8);
    _dir.subVectors(p1, p0).normalize();
    st.lastHit[best] = now;
    strike(pad, vel, hitB, now - (1 - bestF) * dt, _dir);
    // haptics: metal rings longer
    const metal = pad.family === 'bell' || pad.family === 'gong' || pad.family === 'cymbal';
    st.hand.haptic(0.12 + 0.88 * vel, (metal ? 28 : 12) + 40 * vel);
    // bounce: rotate the visible stick so its tip moves back out along the surface normal
    if (pad.kind === 'disc') _nW.copy(pad.n); else _nW.set(hitB.nx, hitB.ny, hitB.nz);
    _nW.applyQuaternion(kitRoot.quaternion);
    _sd.set(0, 0, -1).applyQuaternion(st.hand.gripQuat);
    st.axis.crossVectors(_sd, _nW);
    if (st.axis.lengthSq() > 1e-6) { st.axis.normalize(); st.omega = Math.max(st.omega, 0) + 4 + 10 * vel; }
  }

  function desktopPick(out) {
    const h = input.main;
    _ro.copy(h.rayPos).applyMatrix4(kitInv);
    _rd.set(0, 0, -1).applyQuaternion(h.rayQuat).applyQuaternion(_q.copy(kitRoot.quaternion).invert());
    let best = -1, bestD = 1e9;
    for (let i = 0; i < pads.length; i++) {
      hitA.side = 0; hitA.front = 1;
      const d = rayPad(pads[i], _ro, _rd, hitA, 4);
      if (d >= 0 && d < bestD) { bestD = d; best = i; copyHit(out, hitA); }
    }
    return best;
  }

  placeKit();
  ensureAudio();
  if (ctx.isXR()) measureAt = 1.5;

  const debug = {
    get pads() { return pads.map(p => p.id); },
    get state() { return { mode, tab, groove, bpm: tr.bpm, rec: rec.state, layers: layers.length, layerHits: layers.reduce((a, l) => a + l.length, 0), voices: A?.voices.length ?? 0, hits: stats.hits, lastVel: stats.lastVel, lastPad: stats.lastPad, lastR: stats.lastR, lesson: lesson && { score: lesson.score, perfect: lesson.perfect, good: lesson.good, miss: lesson.miss, combo: lesson.combo, first: lesson.first, n: lesson.notes.length }, results, kit: { ...S }, disposed: A?.disposed ?? null }; },
    strike(id, vel = 0.7, r = 0.2, t = null) { const p = padById[id]; const h = { r, lx: r * p.R, ly: 0, side: 0, front: 1, hx: p.land.x, hy: p.land.y, hz: p.land.z }; strike(p, vel, h, t ?? (A ? A.ac.currentTime : 0), _dir.copy(p.n).negate()); },
    padWorld(id) { const p = padById[id]; return p.c.clone().applyMatrix4(kitRoot.matrixWorld).toArray(); },
    padNormalWorld(id) { const p = padById[id]; return p.n.clone().applyQuaternion(kitRoot.quaternion).toArray(); },
    set sweepOnDesktop(v) { sweepOnDesktop = v; },
    startLesson, stopLesson, recToggle, setBpm,
    setGroove(v) { groove = v; },
    setMove(v) { moveState.on = v; moveLabel.visible = v; menu.markDirty(); },
    kitPose: () => ({ x: kitRoot.position.x, y: kitRoot.position.y, z: kitRoot.position.z, yaw: kitRoot.rotation.y }),
    lessonNotes: () => lesson?.notes.map(n => ({ time: n.time, pad: pads[n.pad].id, judged: n.judged })),
    audioTime: () => A?.ac.currentTime, latency,
    get audio() { return A; },
    timeAtBeat, beatAt,
  };
  window.__drums = debug;

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    onXRStart() { measureAt = elapsed + 1.5; },
    update(dt, t) {
      elapsed = t;
      ensureAudio();
      temple.update(dt, t);
      if (A) A.setListener(input.head.pos, input.head.fwd, input.head.up);

      // head-height measure shortly after entering VR
      if (measureAt > 0 && elapsed >= measureAt && ctx.isXR()) {
        measureAt = -1;
        const hh = input.head.pos.y - rig.position.y;
        if (hh > 1.0 && hh < 2.2) { headH = hh; placeKit(); }
      }

      // move kit: two-handed grab
      if (moveState.on && !input.desktop) {
        const L = input.left, R = input.right;
        const both = L.present && R.present && L.squeeze > 0.6 && R.squeeze > 0.6;
        if (both) {
          const mx = (L.gripPos.x + R.gripPos.x) / 2, my = (L.gripPos.y + R.gripPos.y) / 2, mz = (L.gripPos.z + R.gripPos.z) / 2;
          const a = Math.atan2(R.gripPos.x - L.gripPos.x, R.gripPos.z - L.gripPos.z);
          if (!moveState.grab) { moveState.grab = true; moveState.m0.set(mx, my, mz); moveState.a0 = a; moveState.p0.copy(kitRoot.position); moveState.yaw0 = S.kitYaw; }
          let d = a - moveState.a0; d = Math.atan2(Math.sin(d), Math.cos(d));
          const ox = moveState.p0.x - moveState.m0.x, oz = moveState.p0.z - moveState.m0.z;
          const cs = Math.cos(d), sn = Math.sin(d);
          S.kitX = mx + ox * cs + oz * sn; S.kitZ = mz - ox * sn + oz * cs;
          S.kitYaw = moveState.yaw0 + d;
          S.kitDY = THREE.MathUtils.clamp(moveState.p0.y + (my - moveState.m0.y) - autoY(), -0.6, 0.6);
          placeKit();
        } else if (moveState.grab) { moveState.grab = false; saveSettings(); menu.markDirty(); }
        const ay = (Math.abs(L.axes[1]) > 0.3 ? L.axes[1] : 0) + (Math.abs(R.axes[1]) > 0.3 ? R.axes[1] : 0);
        if (ay && !moveState.grab) { S.kitDY = THREE.MathUtils.clamp(S.kitDY - ay * 0.25 * dt, -0.6, 0.6); placeKit(); }
      }
      if (kitMoved && A) { kitMoved = false; for (const p of pads) A.setSourcePos(p.src, p.worldPos); }

      // menu pointer (either hand in VR; crosshair on desktop)
      let ph = pointer.update(input.main, { show: !input.desktop }), phHand = input.main;
      if (!ph && !input.desktop) { ph = pointer.update(input.off); phHand = input.off; }
      let clicked = false;
      if (ph?.button && phHand.triggerDown) { clicked = pointer.click(ph); }

      // sticks
      const canSweep = !moveState.grab && (!input.desktop || sweepOnDesktop);
      for (const st of sticks) {
        const h = st.hand;
        if (!h.present) { st.mesh.visible = false; st.hasPrev = false; continue; }
        st.mesh.visible = true;
        _tip.copy(STICK_TIP).applyQuaternion(h.gripQuat).add(h.gripPos);
        _tipK.copy(_tip).applyMatrix4(kitInv);
        if (st.hasPrev && canSweep && dt > 0) strikeFromStick(st, st.prevTip, _tipK, dt);
        st.prevTip.copy(_tipK); st.hasPrev = true;
        st.omega += (-320 * st.theta - 22 * st.omega) * dt; st.theta += st.omega * dt;
        if (Math.abs(st.theta) < 1e-4 && Math.abs(st.omega) < 1e-3) st.theta = st.omega = 0;
        _q.setFromAxisAngle(st.axis, st.theta);
        st.mesh.quaternion.copy(_q).multiply(h.gripQuat);
        st.mesh.position.copy(h.gripPos);
      }

      // desktop: crosshair strike + hover ring
      if (input.desktop) {
        const pi = ph ? -1 : desktopPick(hitB);
        if (pi >= 0) {
          const pad = pads[pi];
          hoverRing.visible = true; hoverRing.position.copy(pad.land); hoverRing.quaternion.copy(pad.ringQ); hoverRing.scale.setScalar(pad.R * 1.08);
          if (input.main.triggerDown && !clicked) {
            const vel = input.key('ShiftLeft') || input.key('ShiftRight') ? 0.3 : 0.75;
            strike(pad, vel, hitB, A ? A.ac.currentTime : 0, _rd);
            const st = sticks[input.leftHanded ? 0 : 1];
            _sd.set(1, 0, 0).applyQuaternion(input.main.gripQuat); st.axis.copy(_sd); st.omega = -9;
          }
        } else hoverRing.visible = false;
        // desktop shortcuts
        if (input.keyDown('KeyG') && mode === 'free') { groove = !groove; menu.markDirty(); }
        if (input.keyDown('BracketLeft')) { setBpm(tr.bpm - 4); menu.markDirty(); }
        if (input.keyDown('BracketRight')) { setBpm(tr.bpm + 4); menu.markDirty(); }
        if (input.keyDown('KeyK')) { recToggle(); menu.markDirty(); }
        for (let i = 0; i < LESSONS.length; i++) if (input.keyDown(DIGITS[i])) startLesson(i);
        if (input.keyDown('Digit0') && mode === 'lesson') stopLesson();
      } else hoverRing.visible = false;

      // audio scheduling, lessons
      schedule(dt);
      updateLesson();

      // scheduled visual reactions (loop playback)
      if (A) {
        const now = A.ac.currentTime;
        for (const e of vq) if (e.on && e.t <= now) {
          e.on = false; const pad = pads[e.pad];
          _dir.copy(pad.n).negate();
          reactPad(pad, e.vel, e.lx, e.ly, _dir);
          spawnFlash(pad, pad.land.x + pad.u.x * e.lx + pad.v.x * e.ly * (pad.kind === 'disc' ? 1 : 0), pad.land.y + pad.u.y * e.lx + (pad.kind === 'disc' ? pad.v.y * e.ly : 0), pad.land.z + pad.u.z * e.lx + (pad.kind === 'disc' ? pad.v.z * e.ly : 0), e.vel * 0.7);
        }
      }

      updateReactors(reactors, pads, dt);

      // flashes
      let fc = 0;
      for (const f of flashes) {
        if (f.age > 0.3) continue;
        f.age += dt;
        const k = Math.min(1, f.age / 0.3);
        _s.setScalar(f.size * (0.4 + 1.2 * k));
        _m4.compose(f.pos, f.q, _s); flashMesh.setMatrixAt(fc, _m4);
        _c.copy(f.color).multiplyScalar(1 - k); flashMesh.setColorAt(fc, _c);
        fc++;
      }
      flashMesh.count = fc;
      if (fc) { flashMesh.instanceMatrix.needsUpdate = true; flashMesh.instanceColor.needsUpdate = true; }

      for (const s of judgeSprites) {
        if (!s.visible) continue;
        s.userData.age += dt;
        s.position.y += dt * 0.12;
        s.material.opacity = Math.max(0, 1 - s.userData.age / 0.7);
        if (s.userData.age > 0.7) s.visible = false;
      }

      // board/menu refresh only when something visible changed
      const bNow = A ? beatAt(A.ac.currentTime - latency()) : 0;
      boardSigNew[0] = mode === 'lesson' ? 1 : 0; boardSigNew[1] = tr.bpm; boardSigNew[2] = groove ? S.style + 1 : 0;
      boardSigNew[3] = rec.state === 'idle' ? 0 : rec.state === 'armed' ? 1 : 2; boardSigNew[4] = layers.length;
      boardSigNew[5] = Math.floor(bNow); boardSigNew[6] = stats.hits;
      boardSigNew[7] = lesson ? lesson.score * 1000 + lesson.combo : 0; boardSigNew[8] = lesson ? lesson.miss : 0;
      boardSigNew[9] = layers.length ? layers[layers.length - 1].length : 0;
      let changed = false;
      for (let i = 0; i < 10; i++) if (boardSig[i] !== boardSigNew[i]) { changed = true; boardSig[i] = boardSigNew[i]; }
      if (changed) {
        board.markDirty(); board.redraw();
        if (boardSigNew[3] !== menuRecSig || boardSigNew[4] !== menuLayerSig || boardSigNew[9] !== menuHitSig) { menuRecSig = boardSigNew[3]; menuLayerSig = boardSigNew[4]; menuHitSig = boardSigNew[9]; menu.markDirty(); }
      }

      if (input.desktop && (t - hudT > 0.25 || changed)) {
        hudT = t;
        const L = lesson;
        const status = mode === 'lesson' && L ? `<b>${L.def.name}</b> · score ${L.score} · combo ${L.combo} · miss ${L.miss}` : `${tr.bpm} BPM · groove ${groove ? 'on' : 'off'} · rec ${rec.state} · ${layers.length} layers`;
        ctx.setHud(`${status} &nbsp;|&nbsp; LMB strike (Shift soft) · G groove · [ ] tempo · K record · 1-5 lesson · 0 stop · menu on your left`);
      }
    },
    dispose() {
      if (A) A.dispose();
      A = null;
      if (window.__drums === debug) delete window.__drums;
    },
  };
}
