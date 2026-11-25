import * as THREE from 'three';
import { Panel, Pointer, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { SONGS, DIRS, D, buildSong, Conductor } from './music.js';
import { LANTERN_R, makePaperTexture, makeLanternGeometry, makeHalfGeometry, makeGlyphTextures, makeBombGeometry, makeGlowTexture, makeLatticeTexture } from './assets.js';
import { buildEnvironment, WATER_Y, LANE_X } from './env.js';
import { Sparks, Halves, Rings, Popups, Trail } from './fx.js';

// Lantern Rush: slice paper lanterns to procedurally generated music.
// Timing model: song position comes from the AudioContext clock (corrected for output latency), the
// chart lives on the same 16th grid as the audio events, and every lantern is placed each frame at
// z = HIT_Z - (noteTime - songPos) * speed, so it crosses the hit plane exactly on its beat.

const HIT_Z = -1.25;            // hit plane (m in front of the player)
const TRAVEL = 20;              // metres travelled from spawn to the hit plane
const SPAWN_Z = HIT_Z - TRAVEL;
const MISS_Z = 0.45;            // passed the player
const BLADE_LEN = 1.0;
const HIT_R = 0.25;             // blade-to-lantern contact radius
const BOMB_R = 0.2;
const COLORS = [new THREE.Color(1.0, 0.33, 0.2), new THREE.Color(0.22, 0.66, 1.0)];
const BLADE_HEX = [0xff5030, 0x30a0ff];
const MAX_NOTES = 48, MAX_WALLS = 8;

export async function create(ctx) {
  const { scene, input, camera, rig } = ctx;
  const actx = ctx.audio.ctx;
  const env = buildEnvironment(scene, { hitZ: HIT_Z, spawnZ: SPAWN_Z });

  // ── audio ──
  const noise = actx ? (() => { const b = actx.createBuffer(1, actx.sampleRate, actx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; })() : null;
  const conductor = actx ? new Conductor(actx, ctx.audio.out, noise) : null;
  const sfxBus = actx ? actx.createGain() : null;
  if (sfxBus) { sfxBus.gain.value = 0.8; sfxBus.connect(ctx.audio.out); }
  let suspendedByUs = false;

  function sfxOut(pan) {
    const g = actx.createGain();
    if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(sfxBus); }
    else g.connect(sfxBus);
    return g;
  }
  function envTone(t, freq, type, peak, dur, dest, freqEnd = 0) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function envNoise(t, type, freq, q, peak, dur, dest, freqEnd = 0) {
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    s.buffer = noise; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q; if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  const sfx = {
    slice(pan, k) {
      if (!actx || actx.state !== 'running') return;
      const t = actx.currentTime, out = sfxOut(pan);
      envNoise(t, 'bandpass', 2500, 0.8, 0.5, 0.09, out, 9000);
      const def = song?.def, sc = def?.mode === 'major' ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
      const n = (def?.root ?? 50) + 24 + sc[k % 5] + 12 * (Math.floor(k / 5) % 2);
      envTone(t, 440 * Math.pow(2, (n - 69) / 12), 'triangle', 0.22, 0.35, out);
      envTone(t, 880 * Math.pow(2, (n - 69) / 12), 'sine', 0.08, 0.25, out);
    },
    bad(pan) { if (!actx || actx.state !== 'running') return; const t = actx.currentTime, out = sfxOut(pan); envTone(t, 160, 'square', 0.12, 0.18, out, 70); envNoise(t, 'lowpass', 600, 1, 0.3, 0.12, out); },
    bomb(pan) { if (!actx || actx.state !== 'running') return; const t = actx.currentTime, out = sfxOut(pan); envNoise(t, 'lowpass', 1800, 0.7, 0.9, 0.6, out, 90); envTone(t, 120, 'sine', 0.6, 0.5, out, 35); },
    wall() { if (!actx || actx.state !== 'running') return; const t = actx.currentTime, out = sfxOut(0); envTone(t, 90, 'sawtooth', 0.15, 0.3, out, 60); },
    miss() { if (!actx || actx.state !== 'running') return; const t = actx.currentTime, out = sfxOut(0); envNoise(t, 'lowpass', 400, 1, 0.12, 0.12, out); },
    click() { if (!actx || actx.state !== 'running') return; const t = actx.currentTime, out = sfxOut(0); envTone(t, 1320, 'sine', 0.12, 0.07, out); },
    fail() { if (!actx || actx.state !== 'running') return; const t = actx.currentTime, out = sfxOut(0); envTone(t, 300, 'sawtooth', 0.15, 1.1, out, 50); },
  };

  // ── lantern / bomb / wall instanced meshes ──
  const paper = makePaperTexture();
  const lanternMat = new THREE.MeshBasicMaterial({ map: paper, vertexColors: true, toneMapped: false });
  const bodies = new THREE.InstancedMesh(makeLanternGeometry(), lanternMat, MAX_NOTES);
  const glyphTex = makeGlyphTextures();
  const glyphGeo = new THREE.PlaneGeometry(0.26, 0.26);
  const arrows = new THREE.InstancedMesh(glyphGeo, new THREE.MeshBasicMaterial({ map: glyphTex.arrow, transparent: true, depthWrite: false, toneMapped: false }), MAX_NOTES);
  const dots = new THREE.InstancedMesh(glyphGeo, new THREE.MeshBasicMaterial({ map: glyphTex.dot, transparent: true, depthWrite: false, toneMapped: false }), MAX_NOTES);
  const glowTex = makeGlowTexture();
  const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_NOTES);
  const bombs = new THREE.InstancedMesh(makeBombGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 16);
  const latticeTex = makeLatticeTexture();
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ map: latticeTex, color: 0xff6040, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), MAX_WALLS);
  for (const m of [bodies, arrows, dots, glows, bombs, walls]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
  bodies.setColorAt(0, COLORS[0]); glows.setColorAt(0, COLORS[0]);
  arrows.renderOrder = dots.renderOrder = 2; glows.renderOrder = 1;
  scene.add(glows, bodies, arrows, dots, bombs, walls);

  const halfMat = new THREE.MeshBasicMaterial({ map: paper, vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const halves = new Halves(scene, makeHalfGeometry(), halfMat, 64);
  const sparks = new Sparks(scene, 700);
  const rings = new Rings(scene, 12);
  const popups = new Popups(scene, 8);

  // Red flash in front of the eyes when inside a wall or hitting a bomb.
  const vignette = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshBasicMaterial({ map: makeGlowTexture('rgba(255,40,20,0.0)', 'rgba(255,40,20,0.6)'), color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  vignette.renderOrder = 1000; vignette.visible = false; scene.add(vignette);

  // ── blades ──
  function makeBlade(side) {
    const g = new THREE.Group();
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.2, 10), new THREE.MeshBasicMaterial({ color: 0x5a2016 }));
    hilt.rotation.x = Math.PI / 2; hilt.position.z = 0.03;
    const guard = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 6, 14), new THREE.MeshBasicMaterial({ color: 0xc89838 }));
    guard.position.z = -0.075;
    const coreG = new THREE.CylinderGeometry(0.008, 0.011, BLADE_LEN - 0.08, 8); coreG.rotateX(Math.PI / 2); coreG.translate(0, 0, -0.08 - (BLADE_LEN - 0.08) / 2);
    const core = new THREE.Mesh(coreG, new THREE.MeshBasicMaterial({ color: new THREE.Color(BLADE_HEX[side]).lerp(new THREE.Color(1, 1, 1), 0.65), toneMapped: false }));
    const glowG = new THREE.CylinderGeometry(0.022, 0.03, BLADE_LEN - 0.06, 8, 1, true); glowG.rotateX(Math.PI / 2); glowG.translate(0, 0, -0.08 - (BLADE_LEN - 0.08) / 2);
    const glow = new THREE.Mesh(glowG, new THREE.MeshBasicMaterial({ color: BLADE_HEX[side], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    g.add(hilt, guard, core, glow);
    scene.add(g);
    const H = 24;
    return {
      side, group: g, glowMat: glow.material,
      base: new THREE.Vector3(), tip: new THREE.Vector3(), pBase: new THREE.Vector3(), pTip: new THREE.Vector3(),
      len: BLADE_LEN, dir: new THREE.Vector3(0, 0, -1), quat: new THREE.Quaternion(), hasPrev: false, active: true,
      histDir: new Float32Array(H * 3), histT: new Float64Array(H).fill(-1), histI: 0, H,
      trail: new Trail(scene, BLADE_HEX[side]), flash: 0,
      hand: null,
    };
  }
  const blades = [makeBlade(0), makeBlade(1)];

  // ── HUD panels (canvas, redrawn on change) ──
  function makeHud(w, h, px, x, y, z, ry) {
    const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
    return { c, x: c.getContext('2d'), tex, mesh: m };
  }
  const hudL = makeHud(0.7, 0.5, 512, -1.45, 1.0, -2.6, 0.38);
  const hudR = makeHud(0.7, 0.5, 512, 1.45, 1.0, -2.6, -0.38);

  // ── state ──
  let state = 'menu';
  let song = null, hard = ctx.load('rhythm:hard', false), offsetMs = ctx.load('rhythm:offset', 0);
  let songPos = -10, audioWait = 0, clockInit = false, useAudio = false, t0 = 0, fallbackPos = 0, lastPerf = 0;
  let nextNote = 0, nextWall = 0, kickIdx = 0, lastKick = -10, pulse = 0;
  let score = 0, combo = 0, maxCombo = 0, mult = 1, energy = 0.5, hits = 0, misses = 0, badCuts = 0, bombsHit = 0, maxScore = 1, multProgress = 0;
  let inWall = false, wallFlash = 0, failTimer = 0, hudDirty = true, hudTimer = 0, resumeTimer = 0, lastProgressDraw = -1;
  let rowY = [0.85, 1.25, 1.65], headY = 1.6;
  let deskActive = 1, results = null, lastBad = null, resumeAt = 0;
  const cursor = { x: 0.3, y: -0.1 };
  const timers = [];

  // pools
  const notePool = [], active = [];
  for (let i = 0; i < MAX_NOTES; i++) notePool.push({ t: 0, hand: 0, dir: 0, col: 0, row: 0, bomb: false, x: 0, y: 0, z: 0, pz: 0, ty: 0 });
  const wallPool = [], activeWalls = [];
  for (let i = 0; i < MAX_WALLS; i++) wallPool.push({ t: 0, dur: 0, type: 'left', x0: 0, x1: 0, y0: 0, y1: 0, zf: 0, zb: 0 });
  const pending = []; // follow-through scoring
  for (let i = 0; i < 16; i++) pending.push({ on: false, blade: null, t: 0, dir: new THREE.Vector3(), base: 0, pos: new THREE.Vector3(), mult: 1, side: 0 });

  const multFor = (c) => c < 2 ? 1 : c < 6 ? 2 : c < 14 ? 4 : 8;

  // ── clock ──
  function heardTime() {
    // Context time currently coming out of the speakers.
    try {
      const ts = actx.getOutputTimestamp?.();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const h = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        const lag = actx.currentTime - h;
        if (lag > -0.05 && lag < 0.5) return h;
      }
    } catch { }
    return actx.currentTime - Math.min(0.3, (actx.outputLatency || 0) + (actx.baseLatency || 0));
  }
  function latencyMs() {
    if (!actx) return 0;
    try {
      const ts = actx.getOutputTimestamp?.();
      if (ts && ts.contextTime > 0) return Math.round((actx.currentTime - ts.contextTime) * 1000);
    } catch { }
    return Math.round(((actx.outputLatency || 0) + (actx.baseLatency || 0)) * 1000);
  }
  function updateClock() {
    const now = performance.now(), rdt = Math.min(0.1, (now - lastPerf) / 1000); lastPerf = now;
    let raw;
    if (useAudio) {
      if (actx.state !== 'running') {
        // frozen while suspended; if the context never starts (autoplay blocked), fall back to a silent clock
        if (state === 'play' && (audioWait += rdt) > 1.5) { useAudio = false; stopMusic(0); fallbackPos = songPos; }
        return;
      }
      raw = heardTime() - t0 - offsetMs / 1000;
    } else { fallbackPos += rdt; raw = fallbackPos; }
    if (!clockInit || Math.abs(raw - songPos) > 0.06) { songPos = raw; clockInit = true; }
    else { songPos += rdt; songPos += (raw - songPos) * 0.15; }
  }

  // ── song lifecycle ──
  function startSong(i) {
    const def = SONGS[i];
    song = buildSong(def, hard);
    song.index = i;
    resetPlay();
    headY = Math.max(1.2, Math.min(2.0, input.head.pos.y - rig.position.y));
    rowY = [headY * 0.53, headY * 0.78, headY * 1.03];
    maxScore = 0; let c = 0;
    for (const n of song.notes) if (!n.bomb) maxScore += 115 * multFor(c++);
    useAudio = !!(actx && actx.state !== 'closed');
    if (actx && actx.state !== 'running') actx.resume?.();
    clockInit = false; lastPerf = performance.now(); audioWait = 0;
    if (useAudio) { t0 = actx.currentTime + 0.5; conductor.start(song, t0); }
    else { fallbackPos = -0.5; }
    songPos = -0.5;
    setState('play');
  }
  function resetPlay() {
    for (const n of active) notePool.push(n); active.length = 0;
    for (const w of activeWalls) wallPool.push(w); activeWalls.length = 0;
    for (const p of pending) p.on = false;
    halves.clear(); sparks.clear(); popups.clear();
    nextNote = 0; nextWall = 0; kickIdx = 0; lastKick = -10; pulse = 0;
    score = 0; combo = 0; maxCombo = 0; mult = 1; energy = 0.5; hits = 0; misses = 0; badCuts = 0; bombsHit = 0; multProgress = 0;
    inWall = false; wallFlash = 0; failTimer = 0; hudDirty = true; results = null;
    for (const b of blades) { b.hasPrev = false; b.trail.reset(); b.histT.fill(-1); }
  }
  function stopMusic(fade = 0.1) { conductor?.stop(fade); }
  function setState(s) {
    state = s;
    menu.mesh.visible = s === 'menu';
    pausePanel.mesh.visible = s === 'paused';
    resultsPanel.mesh.visible = s === 'results';
    const playing = s === 'play' || s === 'failing';
    hudL.mesh.visible = hudR.mesh.visible = playing || s === 'paused';
    for (const b of blades) { b.group.visible = playing; b.trail.mesh.visible = playing; if (!playing) b.trail.reset(); }
    if (input.desktop) {
      input.lookEnabled = !playing;
      if (playing) { input.yaw = 0; input.pitch = 0; }
    }
    if (!playing) { rig.position.x = 0; rig.position.y = 0; }
    menu.markDirty(); pausePanel.markDirty(); resultsPanel.markDirty();
  }
  function pause() {
    if (state !== 'play') return;
    // Stop the music where it is; resume restarts the scheduler from this song position.
    stopMusic(0.05);
    resumeTimer = 0;
    setState('paused');
  }
  function resume() {
    resumeTimer = 1.5; resumeAt = performance.now(); pausePanel.markDirty();
  }
  function finishResume() {
    resumeTimer = 0;
    if (useAudio && actx.state === 'running') {
      // continue seamlessly: visuals resume exactly at songPos, audio picks up from there
      const lat = actx.currentTime - heardTime();
      t0 = actx.currentTime - lat - songPos - offsetMs / 1000;
      conductor.start(song, t0, songPos);
    }
    lastPerf = performance.now(); audioWait = 0;
    for (const b of blades) b.hasPrev = false;
    setState('play');
  }
  function quitToMenu() {
    if (suspendedByUs) { actx.resume(); suspendedByUs = false; }
    stopMusic(0.2); resetPlay(); song = null; setState('menu');
  }
  function endSong(failed) {
    stopMusic(failed ? 0.9 : 1.5);
    const acc = Math.max(0, Math.min(1, score / maxScore));
    const grade = failed ? 'F' : acc >= 0.9 ? 'S' : acc >= 0.8 ? 'A' : acc >= 0.65 ? 'B' : acc >= 0.5 ? 'C' : 'D';
    const key = `rhythm:best:${song.def.id}:${hard ? 'hard' : 'normal'}`;
    const prev = ctx.load(key, null);
    const newBest = !failed && (!prev || score > prev.score);
    if (newBest) ctx.save(key, { score, grade, acc: Math.round(acc * 1000) / 10, combo: maxCombo });
    results = { failed, acc, grade, score, maxCombo, hits, misses, badCuts, bombsHit, newBest, prev, total: song.notes.filter(n => !n.bomb).length };
    for (const n of active) notePool.push(n); active.length = 0;
    for (const w of activeWalls) wallPool.push(w); activeWalls.length = 0;
    setState('results');
  }

  // ── panels ──
  const pointer = new Pointer(scene, 0xffd060);
  pointer.onClick = () => sfx.click();
  const bests = () => SONGS.map(s => ctx.load(`rhythm:best:${s.id}:${hard ? 'hard' : 'normal'}`, null));
  const menu = new Panel({
    width: 1.7, height: 1.25, px: 1280, draw: (c, W, H, p) => {
      bgCard(c, W, H);
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      c.fillStyle = '#e2b85c'; c.font = `120px ${FONTS.brush}`; c.fillText('灯斩', 60, 150);
      c.fillStyle = '#f1e6cf'; c.font = `italic 600 64px ${FONTS.latin}`; c.fillText('Lantern Rush', 300, 110);
      c.fillStyle = '#a8a0c0'; c.font = `26px ${FONTS.sans}`; c.fillText('Slice the lanterns on the beat. Pick a song.', 302, 152);
      const bs = bests();
      SONGS.forEach((s, i) => {
        const y = 200 + i * 150;
        p.button('song' + i, 60, y, W - 120, 130, '', () => startSong(i), { bg: 'rgba(30,24,48,0.92)', hoverBg: 'rgba(70,40,60,0.95)' });
        c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillStyle = i === 0 ? '#ffb070' : i === 1 ? '#8fe0c0' : '#ff7a5a'; c.font = `76px ${FONTS.brush}`; c.fillText(s.cn, 90, y + 68);
        c.fillStyle = '#f1e6cf'; c.font = `600 40px ${FONTS.sans}`; c.fillText(s.title, 330, y + 46);
        c.fillStyle = '#a8a0c0'; c.font = `26px ${FONTS.sans}`; c.fillText(`${s.bpm} BPM · ${s.mood}`, 330, y + 92);
        c.fillStyle = '#e2b85c'; c.font = `34px ${FONTS.sans}`; c.textAlign = 'right';
        c.fillText('●'.repeat(s.stars + (hard ? 1 : 0)) + '○'.repeat(4 - s.stars - (hard ? 1 : 0)), W - 90, y + 44);
        const b = bs[i];
        c.font = `26px ${FONTS.sans}`; c.fillStyle = b ? '#f1e6cf' : '#6a6480';
        c.fillText(b ? `Best ${b.grade} · ${b.score.toLocaleString()} · ${b.acc}%` : 'No clear yet', W - 90, y + 94);
      });
      const y2 = 670;
      c.textAlign = 'left'; c.fillStyle = '#a8a0c0'; c.font = `28px ${FONTS.sans}`; c.textBaseline = 'middle';
      c.fillText('Difficulty', 60, y2 + 40);
      p.button('normal', 210, y2, 170, 80, 'Normal', () => { hard = false; ctx.save('rhythm:hard', false); }, { active: !hard });
      p.button('hard', 395, y2, 170, 80, 'Hard', () => { hard = true; ctx.save('rhythm:hard', true); }, { active: hard });
      c.fillStyle = '#a8a0c0'; c.fillText('Sync', 620, y2 + 40);
      p.button('offm', 700, y2, 80, 80, '−', () => { offsetMs -= 10; ctx.save('rhythm:offset', offsetMs); });
      c.fillStyle = '#f1e6cf'; c.textAlign = 'center'; c.fillText(`${offsetMs > 0 ? '+' : ''}${offsetMs} ms`, 860, y2 + 40);
      p.button('offp', 940, y2, 80, 80, '+', () => { offsetMs += 10; ctx.save('rhythm:offset', offsetMs); });
      c.textAlign = 'left'; c.fillStyle = '#6a6480'; c.font = `22px ${FONTS.sans}`;
      c.fillText(`audio out ${latencyMs()} ms`, 1050, y2 + 40);
      c.fillStyle = '#a8a0c0'; c.font = `24px ${FONTS.sans}`;
      const help = input.desktop
        ? 'Desktop: move the mouse to swing (the blade on the cursor’s side cuts) · A/D lean, S duck · R pause'
        : 'Red blade left hand, blue right · swing along the brush stroke · ensō circle = any way · B pause';
      fitText(c, help, 60, y2 + 140, W - 120, 24, FONTS.sans);
      fitText(c, 'Don’t touch the incense pots · lean or duck past the lattice screens', 60, y2 + 180, W - 120, 24, FONTS.sans);
    },
  });
  menu.mesh.position.set(0, 1.45, -2.0);
  const pausePanel = new Panel({
    width: 0.9, height: 0.75, px: 900, draw: (c, W, H, p) => {
      bgCard(c, W, H);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#e2b85c'; c.font = `110px ${FONTS.brush}`; c.fillText(resumeTimer > 0 ? String(Math.ceil(resumeTimer / 0.5)) : '暂停', W / 2, 110);
      c.fillStyle = '#a8a0c0'; c.font = `28px ${FONTS.sans}`; c.fillText(song ? song.def.title : '', W / 2, 195);
      const en = resumeTimer <= 0;
      p.button('resume', 150, 250, W - 300, 100, 'Resume', resume, { enabled: en });
      p.button('restart', 150, 370, W - 300, 100, 'Restart', () => { const i = song.index; quitToMenu(); startSong(i); }, { enabled: en });
      p.button('quit', 150, 490, W - 300, 100, 'Song select', quitToMenu, { enabled: en });
      p.button('hub', 150, 610, W - 300, 80, 'Leave game', () => ctx.exit(), { enabled: en, size: 30 });
    },
  });
  pausePanel.mesh.position.set(0, 1.45, -1.6);
  const resultsPanel = new Panel({
    width: 1.3, height: 1.05, px: 1100, draw: (c, W, H, p) => {
      bgCard(c, W, H);
      if (!results || !song) return;
      const r = results;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#f1e6cf'; c.font = `italic 600 54px ${FONTS.latin}`; c.fillText(`${song.def.title} · ${hard ? 'Hard' : 'Normal'}`, W / 2, 70);
      c.fillStyle = r.failed ? '#ff6a50' : '#8fe0c0'; c.font = `40px ${FONTS.brush}`;
      c.fillText(r.failed ? '灯灭 — the lanterns went dark' : '完 — cleared', W / 2, 130);
      c.fillStyle = r.failed ? '#ff6a50' : '#e2b85c'; c.font = `260px ${FONTS.latin}`; c.fillText(r.grade, 250, 340);
      c.textAlign = 'left'; c.fillStyle = '#f1e6cf'; c.font = `600 64px ${FONTS.sans}`; c.fillText(r.score.toLocaleString(), 460, 230);
      c.font = `30px ${FONTS.sans}`; c.fillStyle = '#a8a0c0';
      const rows = [`Accuracy ${(r.acc * 100).toFixed(1)}%`, `Cut ${r.hits} / ${r.total} · missed ${r.misses} · bad ${r.badCuts}`, `Max combo ${r.maxCombo}`, `Incense pots hit ${r.bombsHit}`];
      rows.forEach((s, i) => c.fillText(s, 462, 300 + i * 46));
      c.fillStyle = r.newBest ? '#e2b85c' : '#6a6480'; c.font = `600 32px ${FONTS.sans}`;
      c.fillText(r.newBest ? 'New best!' : r.prev ? `Best ${r.prev.grade} · ${r.prev.score.toLocaleString()}` : '', 462, 500);
      p.button('retry', 120, 600, 400, 110, 'Retry', () => startSong(song.index));
      p.button('menu', W - 520, 600, 400, 110, 'Song select', () => { song = null; setState('menu'); });
    },
  });
  resultsPanel.mesh.position.set(0, 1.45, -1.9);
  scene.add(menu.mesh, pausePanel.mesh, resultsPanel.mesh);
  pointer.panels.push(menu, pausePanel, resultsPanel);

  function bgCard(c, W, H) {
    roundRect(c, 4, 4, W - 8, H - 8, 36);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(22,16,42,0.93)'); g.addColorStop(1, 'rgba(10,10,28,0.93)');
    c.fillStyle = g; c.fill(); c.lineWidth = 4; c.strokeStyle = 'rgba(226,184,92,0.75)'; c.stroke();
  }

  function drawHud() {
    hudDirty = false;
    {
      const { x: c, c: cv } = hudL, W = cv.width, H = cv.height;
      c.clearRect(0, 0, W, H);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(241,230,207,0.75)'; c.font = `600 30px ${FONTS.sans}`; c.fillText('COMBO', W / 2, 40);
      c.fillStyle = '#f1e6cf'; c.font = `600 120px ${FONTS.sans}`; c.fillText(String(combo), W / 2, 130);
      // multiplier ring
      const cx = W / 2, cy = 270, R = 62;
      c.lineWidth = 12; c.strokeStyle = 'rgba(255,255,255,0.15)'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
      const need = mult === 1 ? 2 : mult === 2 ? 4 : mult === 4 ? 8 : 1, have = mult === 8 ? 1 : multProgress / need;
      c.strokeStyle = '#e2b85c'; c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * have); c.stroke();
      c.fillStyle = '#e2b85c'; c.font = `600 56px ${FONTS.sans}`; c.fillText('×' + mult, cx, cy + 2);
      hudL.tex.needsUpdate = true;
    }
    {
      const { x: c, c: cv } = hudR, W = cv.width, H = cv.height;
      c.clearRect(0, 0, W, H);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(241,230,207,0.75)'; c.font = `600 30px ${FONTS.sans}`; c.fillText(song ? song.def.title.toUpperCase() : '', W / 2, 40);
      c.fillStyle = '#f1e6cf'; c.font = `600 96px ${FONTS.sans}`; c.fillText(score.toLocaleString(), W / 2, 125);
      // energy bar
      const bx = 50, by = 210, bw = W - 100, bh = 34;
      roundRect(c, bx, by, bw, bh, 12); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fill();
      roundRect(c, bx, by, Math.max(14, bw * energy), bh, 12); c.fillStyle = energy < 0.25 ? '#ff5a40' : '#e2b85c'; c.fill();
      c.fillStyle = 'rgba(241,230,207,0.75)'; c.font = `600 24px ${FONTS.sans}`; c.fillText('LANTERN LIGHT', W / 2, 272);
      // progress
      const prog = song ? Math.max(0, Math.min(1, songPos / song.duration)) : 0;
      roundRect(c, bx, 300, bw, 10, 5); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fill();
      roundRect(c, bx, 300, Math.max(10, bw * prog), 10, 5); c.fillStyle = '#8fe0c0'; c.fill();
      hudR.tex.needsUpdate = true;
    }
  }

  // ── blades: pose, collision, scoring ──
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const _T = new THREE.Vector3(), _cam = new THREE.Vector3(), _fwd = new THREE.Vector3(0, 0, -1), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _c = new THREE.Color();
  const _best = { d: 0, s: 0 };

  function segDist(ax, ay, az, bx, by, bz) {
    // distance from origin to segment a-b
    const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz;
    let t = l2 > 1e-9 ? -(ax * dx + ay * dy + az * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
    return Math.sqrt(x * x + y * y + z * z);
  }

  function poseBlades(dt, time) {
    const desk = input.desktop && !ctx.isXR();
    if (desk) {
      if (input.locked) { cursor.x = Math.max(-1, Math.min(1, cursor.x + input.mouse.dx * 0.0025)); cursor.y = Math.max(-1, Math.min(1, cursor.y - input.mouse.dy * 0.0025)); }
      else if (input.mouse.x || input.mouse.y) { cursor.x = input.mouse.x / window.innerWidth * 2 - 1; cursor.y = -(input.mouse.y / window.innerHeight * 2 - 1); }
      if (cursor.x < -0.04 && deskActive !== 0) { deskActive = 0; blades[0].hasPrev = false; }
      if (cursor.x > 0.04 && deskActive !== 1) { deskActive = 1; blades[1].hasPrev = false; }
      // lean / duck
      const lean = (input.key('KeyD') ? 0.35 : 0) - (input.key('KeyA') ? 0.35 : 0);
      rig.position.x += (lean - rig.position.x) * Math.min(1, dt * 12);
      const duck = input.key('KeyS') ? -0.45 : 0;
      rig.position.y += (duck - rig.position.y) * Math.min(1, dt * 12);
      camera.getWorldPosition(_cam);
      _T.set(cursor.x, cursor.y, 0.5).unproject(camera).sub(_cam).normalize();
      const k = (HIT_Z - _cam.z) / Math.min(-0.05, _T.z);
      _T.multiplyScalar(k).add(_cam);
    }
    for (const b of blades) {
      const hand = b.side === 0 ? input.left : input.right;
      b.hand = hand;
      b.pBase.copy(b.base); b.pTip.copy(b.tip);
      if (!hand.present) { b.group.visible = false; b.active = false; b.hasPrev = false; continue; }
      b.group.visible = true;
      b.base.copy(hand.gripPos);
      if (desk) {
        b.base.y -= 0.05; b.base.z -= 0.15; // keep the hilt out of the desktop camera's face
        b.active = b.side === deskActive;
        if (b.active) { b.dir.copy(_T).sub(b.base); b.len = Math.max(BLADE_LEN, Math.min(1.7, b.dir.length() + 0.35)); b.dir.normalize(); }
        else { b.dir.set(b.side ? 0.35 : -0.35, -1, -0.35).normalize(); b.len = BLADE_LEN; }
        b.quat.setFromUnitVectors(_fwd, b.dir);
      } else {
        b.active = true;
        b.quat.copy(hand.gripQuat);
        b.dir.copy(_fwd).applyQuaternion(b.quat);
        b.len = BLADE_LEN;
      }
      b.tip.copy(b.base).addScaledVector(b.dir, b.len);
      b.group.scale.z = b.len / BLADE_LEN;
      b.group.position.copy(b.base); b.group.quaternion.copy(b.quat);
      // direction history for swing-arc bonus
      b.histI = (b.histI + 1) % b.H;
      b.histDir[b.histI * 3] = b.dir.x; b.histDir[b.histI * 3 + 1] = b.dir.y; b.histDir[b.histI * 3 + 2] = b.dir.z; b.histT[b.histI] = time;
      b.trail.push(b.base, b.tip, dt);
      b.flash = Math.max(0, b.flash - dt * 5);
      b.glowMat.opacity = 0.45 + 0.4 * b.flash + 0.1 * pulse;
      if (!b.hasPrev) { b.pBase.copy(b.base); b.pTip.copy(b.tip); b.hasPrev = true; b.fresh = true; } else b.fresh = false;
    }
  }

  function dirAgo(b, time, ago) {
    // blade direction about `ago` seconds back (oldest sample if history is short)
    let best = b.histI;
    for (let k = 1; k < b.H; k++) {
      const i = (b.histI - k + b.H) % b.H;
      if (b.histT[i] < 0) break;
      best = i;
      if (time - b.histT[i] >= ago) break;
    }
    _w.set(b.histDir[best * 3], b.histDir[best * 3 + 1], b.histDir[best * 3 + 2]);
    return _w;
  }

  function contact(b, n, r) {
    // swept blade (prev->current) vs lantern moving prevZ->z; returns min distance and the blade fraction
    let bestD = 1e9, bestS = 0;
    for (let k = 0; k < 7; k++) {
      const s = 0.2 + k * (0.8 / 6);
      _p0.copy(b.pBase).lerp(b.pTip, s); _p1.copy(b.base).lerp(b.tip, s);
      const d = segDist(_p0.x - n.x, _p0.y - n.y, _p0.z - n.pz, _p1.x - n.x, _p1.y - n.y, _p1.z - n.z);
      if (d < bestD) { bestD = d; bestS = s; }
    }
    // also the current blade segment itself (blade lying through the lantern)
    const dNow = segDist(b.base.x - n.x, b.base.y - n.y, b.base.z - n.z, b.tip.x - n.x, b.tip.y - n.y, b.tip.z - n.z);
    _best.d = bestD; _best.s = bestS; _best.now = dNow;
    return bestD < r || dNow < r * 0.8;
  }

  const minSpeed = () => (input.desktop && !ctx.isXR()) ? 1.2 : 1.6;

  function collide(dt, time) {
    for (const b of blades) {
      if (!b.active || b.fresh || !b.group.visible) continue;
      for (let i = active.length - 1; i >= 0; i--) {
        const n = active[i];
        if (n.z < HIT_Z - 1.7 || n.z > MISS_Z) continue;
        if (n.bomb) {
          if (contact(b, n, BOMB_R)) { hitBomb(b, n); removeNote(i); }
          continue;
        }
        if (!contact(b, n, HIT_R)) continue;
        // blade velocity at the closest point
        _p0.copy(b.pBase).lerp(b.pTip, _best.s); _p1.copy(b.base).lerp(b.tip, _best.s);
        _v.copy(_p1).sub(_p0).divideScalar(Math.max(1e-3, dt));
        const speed = _v.length();
        if (speed < minSpeed()) { if (b.hand && !n.touched) { b.hand.haptic(0.15, 15); n.touched = true; } continue; }
        const vxy = Math.hypot(_v.x, _v.y);
        let ok = n.hand === b.side;
        if (ok && n.dir !== D.ANY) {
          const dd = DIRS[n.dir];
          ok = vxy > 0.5 && (_v.x * dd[0] + _v.y * dd[1]) / vxy > 0.45;
        }
        if (!ok) lastBad = { side: b.side, hand: n.hand, dir: n.dir, vx: +_v.x.toFixed(2), vy: +_v.y.toFixed(2), z: +n.z.toFixed(2) };
        if (ok) goodCut(b, n, time, _best.d);
        else badCut(b, n);
        removeNote(i);
      }
    }
  }

  function addCombo() {
    combo++; maxCombo = Math.max(maxCombo, combo);
    if (mult < 8) {
      multProgress++;
      const need = mult === 1 ? 2 : mult === 2 ? 4 : 8;
      if (multProgress >= need) { mult *= 2; multProgress = 0; }
    }
  }
  function breakCombo() { combo = 0; if (mult > 1) mult /= 2; multProgress = 0; hudDirty = true; }

  function goodCut(b, n, time, dist) {
    hits++;
    const thisMult = mult;
    addCombo();
    energy = Math.min(1, energy + 0.025);
    // immediate parts: pre-swing arc (up to 60), centre accuracy (20), timing (15)
    const ago = dirAgo(b, time, 0.25);
    const pre = 60 * Math.min(1, Math.acos(Math.max(-1, Math.min(1, ago.dot(b.dir)))) / (Math.PI * 0.45));
    const acc = 20 * Math.max(0, 1 - dist / HIT_R);
    const tim = 15 * Math.max(0, 1 - Math.abs(n.z - HIT_Z) / 0.7);
    const pd = pending.find(p => !p.on);
    _n.set(n.x, n.y, n.z);
    if (pd) { pd.on = true; pd.blade = b; pd.t = time; pd.dir.copy(b.dir); pd.base = pre + acc + tim; pd.pos.copy(_n); pd.mult = thisMult; pd.side = b.side; }
    else { score += Math.round((pre + acc + tim) * thisMult); }
    // split into halves along the swing
    const vx = _v.x, vy = _v.y, l = Math.hypot(vx, vy) || 1;
    const sx = vx / l, sy = vy / l;
    _s.set(-sy, sx, 0);
    halves.split(_n, Math.atan2(_s.y, _s.x), _s, COLORS[n.hand], _v);
    _w.copy(_v).normalize().multiplyScalar(0.8);
    sparks.burst(_n, COLORS[n.hand], 28, 3.2, _w, 0.9);
    sparks.burst(_n, _c.setRGB(1, 0.85, 0.5), 10, 1.5, null, 1);
    rings.spawn(_n, COLORS[n.hand], 0.9);
    b.flash = 1; env.flashSide(b.side, 0.8);
    b.hand?.haptic(0.9, 45);
    sfx.slice(n.x, combo);
    hudDirty = true;
  }
  function badCut(b, n) {
    badCuts++; breakCombo();
    energy -= 0.1;
    _n.set(n.x, n.y, n.z);
    sparks.burst(_n, _c.setRGB(0.6, 0.6, 0.7), 14, 2, null, 1);
    halves.split(_n, 0, _s.set(1, 0, 0), _c.copy(COLORS[n.hand]).multiplyScalar(0.4), _v.multiplyScalar(0.2));
    popups.spawn(_n, '✗', '#ff8a70', n.hand !== b.side ? 'wrong blade' : 'wrong way');
    b.hand?.haptic(0.35, 30);
    sfx.bad(n.x);
  }
  function hitBomb(b, n) {
    bombsHit++; breakCombo();
    energy -= 0.15;
    _n.set(n.x, n.y, n.z);
    sparks.burst(_n, _c.setRGB(1, 0.25, 0.05), 50, 4, null, 1);
    sparks.burst(_n, _c.setRGB(0.4, 0.38, 0.35), 30, 2, null, 1);
    rings.spawn(_n, _c.setRGB(1, 0.2, 0.05), 1.6);
    popups.spawn(_n, '香炉', '#ff6040', 'incense pot!');
    b.hand?.haptic(1, 160);
    wallFlash = 0.6;
    sfx.bomb(n.x);
  }
  function missNote(n) {
    misses++; breakCombo();
    energy -= 0.1;
    _n.set(n.x, n.y, HIT_Z + 0.3);
    popups.spawn(_n, '空', '#a8a0c0', 'miss');
    sfx.miss();
  }
  function removeNote(i) { const n = active[i]; active[i] = active[active.length - 1]; active.pop(); notePool.push(n); }

  function resolvePending(time) {
    for (const p of pending) {
      if (!p.on || time - p.t < 0.18) continue;
      p.on = false;
      const ang = Math.acos(Math.max(-1, Math.min(1, p.dir.dot(p.blade.dir))));
      const follow = 20 * Math.min(1, ang / (Math.PI / 3));
      const pts = Math.round(p.base + follow);
      score += pts * p.mult;
      const q = pts >= 105 ? '#e2b85c' : pts >= 85 ? '#f1e6cf' : '#a8a0c0';
      popups.spawn(p.pos, String(pts), q, p.mult > 1 ? `×${p.mult}` : '');
      hudDirty = true;
    }
  }

  // ── per-frame spawn & placement ──
  function travelTime() { return TRAVEL / song.speed; }
  function spawnAndMove(dt) {
    const tt = travelTime(), notes = song.notes;
    while (nextNote < notes.length && notes[nextNote].t - tt <= songPos) {
      const src = notes[nextNote++];
      if (src.t < songPos - 0.3) continue;
      const n = notePool.pop(); if (!n) break;
      n.t = src.t; n.hand = src.hand; n.dir = src.dir; n.col = src.col; n.row = src.row; n.bomb = src.bomb; n.touched = false;
      n.x = LANE_X[src.col]; n.ty = rowY[src.row]; n.y = WATER_Y; n.z = n.pz = SPAWN_Z;
      active.push(n);
    }
    const ws = song.walls;
    while (nextWall < ws.length && ws[nextWall].t - tt <= songPos) {
      const src = ws[nextWall++];
      const w = wallPool.pop(); if (!w) break;
      w.t = src.t; w.dur = src.dur; w.type = src.type;
      if (src.type === 'left') { w.x0 = -1.15; w.x1 = -0.1; w.y0 = WATER_Y; w.y1 = headY + 1.0; }
      else if (src.type === 'right') { w.x0 = 0.1; w.x1 = 1.15; w.y0 = WATER_Y; w.y1 = headY + 1.0; }
      else { w.x0 = -1.15; w.x1 = 1.15; w.y0 = headY - 0.28; w.y1 = headY + 0.9; }
      activeWalls.push(w);
    }
    for (let i = active.length - 1; i >= 0; i--) {
      const n = active[i];
      n.pz = n.z;
      n.z = HIT_Z - (n.t - songPos) * song.speed;
      const prog = 1 - (n.t - songPos) / tt;
      const rise = Math.min(1, prog / 0.22), e = 1 - Math.pow(1 - rise, 3);
      n.y = WATER_Y - 0.1 + (n.ty - WATER_Y + 0.1) * e;
      if (n.z > MISS_Z) { if (!n.bomb) missNote(n); removeNote(i); }
    }
    for (let i = activeWalls.length - 1; i >= 0; i--) {
      const w = activeWalls[i];
      w.zf = HIT_Z - (w.t - songPos) * song.speed;
      w.zb = w.zf - w.dur * song.speed;
      if (w.zb > 1.5) { activeWalls[i] = activeWalls[activeWalls.length - 1]; activeWalls.pop(); wallPool.push(w); }
    }
  }

  function checkWalls(dt) {
    const h = input.head.pos;
    let inside = false;
    for (const w of activeWalls) {
      const r = 0.1;
      if (h.z - r < w.zf && h.z + r > w.zb && h.x + r > w.x0 && h.x - r < w.x1 && h.y + r > w.y0 && h.y - r < w.y1) inside = true;
    }
    if (inside) {
      energy -= 0.3 * dt;
      wallFlash = Math.max(wallFlash, 0.5);
      if (!inWall) { breakCombo(); sfx.wall(); }
      if (Math.random() < dt * 12) { input.left.haptic(0.5, 30); input.right.haptic(0.5, 30); }
      hudDirty = true;
    }
    inWall = inside;
  }

  function renderInstances(time) {
    let nb = 0, na = 0, nd = 0, ng = 0, nbo = 0;
    for (const n of active) {
      const bob = Math.sin(time * 3 + n.t * 2) * 0.015;
      if (n.bomb) {
        _q.setFromAxisAngle(_n.set(0, 1, 0), time * 1.5 + n.t);
        _s.setScalar(1.1); _v.set(n.x, n.y + bob, n.z);
        _m.compose(_v, _q, _s); bombs.setMatrixAt(nbo++, _m);
        continue;
      }
      const sc = Math.min(1, 0.3 + (n.y - WATER_Y) * 1.2);
      _q.identity(); _s.setScalar(sc); _v.set(n.x, n.y + bob, n.z);
      _m.compose(_v, _q, _s); bodies.setMatrixAt(nb, _m); bodies.setColorAt(nb, COLORS[n.hand]); nb++;
      // glyph on the front face
      _v.z += LANTERN_R * sc + 0.012;
      if (n.dir === D.ANY) { _q.identity(); _m.compose(_v, _q, _s); dots.setMatrixAt(nd++, _m); }
      else {
        const d = DIRS[n.dir];
        _q.setFromAxisAngle(_n.set(0, 0, 1), Math.atan2(d[1], d[0]) + Math.PI / 2);
        _m.compose(_v, _q, _s); arrows.setMatrixAt(na++, _m);
      }
      // glow halo behind
      _v.z -= LANTERN_R * 2 * sc; _q.identity(); _s.setScalar(sc * (0.95 + 0.25 * pulse));
      _m.compose(_v, _q, _s); glows.setMatrixAt(ng, _m); _c.copy(COLORS[n.hand]).multiplyScalar(0.55); glows.setColorAt(ng, _c); ng++;
    }
    bodies.count = nb; arrows.count = na; dots.count = nd; glows.count = ng; bombs.count = nbo;
    for (const m of [bodies, arrows, dots, glows, bombs]) m.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    let nw = 0;
    for (const w of activeWalls) {
      const zf = Math.min(w.zf, 1.5), zb = Math.max(w.zb, SPAWN_Z - 10);
      if (zf <= zb) continue;
      const rise = Math.min(1, Math.max(0, (zf - SPAWN_Z) / 4));
      const y1 = w.y0 + (w.y1 - w.y0) * (w.type === 'top' ? 1 : rise);
      _v.set((w.x0 + w.x1) / 2, (w.y0 + y1) / 2, (zf + zb) / 2); _q.identity(); _s.set(w.x1 - w.x0, Math.max(0.01, y1 - w.y0), zf - zb);
      _m.compose(_v, _q, _s); walls.setMatrixAt(nw++, _m);
    }
    walls.count = nw; walls.instanceMatrix.needsUpdate = true;
  }

  // ── pause on headset removal / tab switch ──
  const onVis = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', onVis);

  setState('menu');
  ctx.recenter(0, 0, 0);

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    update(dt, time) {
      const playing = state === 'play' || state === 'failing';
      // menus
      if (!playing) {
        if (state === 'paused' && resumeTimer > 0) {
          const before = Math.ceil(resumeTimer / 0.5);
          resumeTimer = 1.5 - (performance.now() - resumeAt) / 1000;
          if (Math.ceil(resumeTimer / 0.5) !== before) pausePanel.markDirty();
          if (resumeTimer <= 0) finishResume();
        }
        const hit = pointer.update(input.main);
        if (hit?.button && input.main.triggerDown) pointer.click(hit);
      } else pointer.update(null, { show: false });

      if (state === 'play') {
        updateClock();
        if (input.main.b || (input.desktop && input.keyDown('Escape'))) { pause(); }
        else {
          spawnAndMove(dt);
          poseBlades(dt, time);
          collide(dt, time);
          resolvePending(time);
          checkWalls(dt);
          if (energy <= 0) {
            energy = 0; state = 'failing'; failTimer = 1.3; stopMusic(0.9); sfx.fail();
            for (const n of active) { _n.set(n.x, n.y, n.z); sparks.burst(_n, _c.setRGB(0.5, 0.45, 0.6), 6, 1, null, 1); }
            for (const n of active) notePool.push(n); active.length = 0;
          } else if (songPos > song.duration + 0.5 && active.length === 0) endSong(false);
        }
      } else if (state === 'failing') {
        poseBlades(dt, time);
        failTimer -= dt;
        if (failTimer <= 0) endSong(true);
      }

      // beat pulse from the kick/snare grid on the same clock
      if (song && (state === 'play' || state === 'paused')) {
        const k = song.kicks;
        while (kickIdx < k.length && k[kickIdx] <= songPos) lastKick = k[kickIdx++];
        pulse = Math.exp(-Math.max(0, songPos - lastKick) * 7);
      } else pulse = 0.25 + 0.2 * Math.sin(time * 1.6);

      renderInstances(time);
      halves.update(dt, WATER_Y);
      sparks.update(dt);
      rings.update(dt);
      popups.update(dt);
      env.update(dt, time, pulse, playing);

      // flash in front of the eyes
      wallFlash = Math.max(0, wallFlash - dt * 1.5);
      vignette.visible = wallFlash > 0.01;
      if (vignette.visible) {
        vignette.position.copy(input.head.pos).addScaledVector(input.head.fwd, 0.12);
        vignette.quaternion.copy(input.head.quat);
        vignette.material.opacity = Math.min(1, wallFlash * 1.6);
      }

      if (playing || state === 'paused') {
        hudTimer -= dt;
        const prog = song ? Math.floor(songPos / song.duration * 100) : 0;
        if (prog !== lastProgressDraw) { lastProgressDraw = prog; hudDirty = true; }
        if (hudDirty && hudTimer <= 0) { drawHud(); hudTimer = 0.08; }
      }
      if (playing) ctx.setHud(`<b>${song.def.title}</b> · score ${score.toLocaleString()} · combo ${combo} ×${mult} · light ${Math.round(energy * 100)}% · <i>mouse swings · A/D lean · S duck · R pause</i>`);
      else if (state === 'menu') ctx.setHud('Look at a song and click to play · Tab: hub');
      else ctx.setHud('');
    },
    onXREnd() { pause(); },
    dispose() {
      document.removeEventListener('visibilitychange', onVis);
      for (const t of timers) clearTimeout(t);
      stopMusic(0.05);
      if (suspendedByUs && actx) { actx.resume(); suspendedByUs = false; }
      try { sfxBus?.disconnect(); } catch { }
      input.lookEnabled = true;
      ctx.setHud('');
    },
    // test/debug hooks
    _debug: {
      get state() { return state; }, get songPos() { return songPos; }, get active() { return active; }, get song() { return song; },
      get stats() { return { lastBad, score, combo, maxCombo, mult, energy, hits, misses, badCuts, bombsHit, useAudio, state, songPos }; },
      get blades() { return blades; },
      start: (i, h = false) => { hard = h; startSong(i); },
      finish: () => endSong(false),
      setEnergy: (e) => { energy = e; },
      cursor,
    },
  };
}
