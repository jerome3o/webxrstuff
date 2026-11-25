import * as THREE from 'three';
import { Input } from './input.js';
import * as kit from './kit.js';
import { createHub } from './hub.js';
import { GAMES } from '../../games/registry.js';

// ── Renderer, camera rig ─────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.0);
document.getElementById('stage').appendChild(renderer.domElement);

const DESK_EYE = 1.6;
const rig = new THREE.Group(); rig.name = 'rig';
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 3000);
camera.position.set(0, DESK_EYE, 0);
rig.add(camera);
const input = new Input(renderer, rig, camera, renderer.domElement);
const platformChildren = new Set([camera, ...input.ctrl.flatMap(c => [c.ray, c.grip, c.hand])]);

// ── Shared audio ─────────────────────────────────────────────
const audio = {
  ctx: null, out: null,
  ensure() {
    if (this.ctx) { this.ctx.resume?.(); return this.ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4;
    this.out = this.ctx.createGain(); this.out.gain.value = 0.9;
    this.out.connect(comp).connect(this.ctx.destination);
    return this.ctx;
  },
};

// ── Game context handed to every game ────────────────────────
const params = new URLSearchParams(location.search);
let scene = new THREE.Scene();
let current = null, currentId = null, loading = false;
const hudEl = document.getElementById('deskhud');

const ctx = {
  THREE, renderer, camera, rig, input, audio, kit, params, GAMES,
  get scene() { return scene; },
  isXR: () => renderer.xr.isPresenting,
  exit: () => launch('hub'),
  launch: (id) => launch(id),
  // Put the player's head at (x, z) facing yaw (0 = looking down -Z).
  recenter(x = 0, z = 0, yaw = 0) {
    if (renderer.xr.isPresenting) {
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      const ry = yaw - e.y;
      rig.rotation.set(0, ry, 0);
      const off = new THREE.Vector3(camera.position.x, 0, camera.position.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      rig.position.set(x - off.x, rig.position.y, z - off.z);
    } else {
      rig.rotation.set(0, 0, 0); rig.position.set(x, rig.position.y, z);
      input.yaw = yaw; input.pitch = 0;
    }
  },
  save(key, value) { try { localStorage.setItem('vrp:' + key, JSON.stringify(value)); } catch { } },
  load(key, fallback = null) { try { const v = localStorage.getItem('vrp:' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  // Desktop-only status line at the bottom of the screen (ignored in VR).
  setHud(html) { if (hudEl._last !== html) { hudEl.innerHTML = html ?? ''; hudEl._last = html; } hudEl.hidden = !html || renderer.xr.isPresenting || !input.desktop; },
  lastError: null,
};

function resetRig() {
  for (const parent of [rig, ...input.ctrl.flatMap(c => [c.ray, c.grip])]) {
    for (const ch of [...parent.children]) if (!platformChildren.has(ch)) { parent.remove(ch); kit.disposeObject(ch); }
  }
  rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); rig.scale.set(1, 1, 1);
  if (!renderer.xr.isPresenting) camera.position.set(0, DESK_EYE, 0);
  camera.fov = 70; camera.near = 0.05; camera.far = 3000; camera.updateProjectionMatrix();
  input.yaw = 0; input.pitch = 0; input.lookEnabled = true; input.lookSensitivity = 0.0022;
}

async function launch(id) {
  if (loading) return;
  loading = true;
  const prev = current;
  current = null;
  try { prev?.dispose?.(); } catch (e) { console.error('dispose failed', e); }
  scene.remove(rig);
  kit.disposeObject(scene);
  resetRig();
  ctx.setHud('');
  const lbl = kit.makeLabel('Loading…', { size: 0.15, color: '#e2b85c' });
  lbl.position.set(0, 1.6, -2);
  if (renderer.xr.isPresenting) ctx.recenter(0, 0, 0);
  const meta = GAMES.find(g => g.id === id);
  document.title = id === 'hub' ? '游乐场 VR Playground' : `${meta?.title ?? id} · VR Playground`;
  try {
    const next = new THREE.Scene(); next.background = new THREE.Color(0x0b1020); next.add(rig); next.add(lbl);
    scene = next;
    if (id === 'hub') current = await createHub(ctx, GAMES, launch);
    else {
      const mod = await import(`../../games/${id}/index.js`);
      current = await mod.create(ctx);
    }
    currentId = id;
    lbl.removeFromParent();
    if (id !== 'hub') showExitHint();
    if (renderer.xr.isPresenting) ctx.recenter(current?.spawn?.x ?? 0, current?.spawn?.z ?? 0, current?.spawn?.yaw ?? 0);
  } catch (e) {
    console.error(`Failed to load game "${id}"`, e);
    ctx.lastError = `${meta?.title ?? id}: ${e.message ?? e}`;
    loading = false;
    if (id !== 'hub') return launch('hub');
  }
  loading = false;
}

// ── Return-to-hub gesture: hold X or Y on the left controller, or B on the right, for 1 s (desktop: Tab) ─
const holdBar = new THREE.Group();
{
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.018), new THREE.MeshBasicMaterial({ color: 0x222233, depthTest: false, transparent: true }));
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.018), new THREE.MeshBasicMaterial({ color: 0xe2b85c, depthTest: false, transparent: true }));
  fg.position.z = 0.001; fg.geometry.translate(0.06, 0, 0); fg.position.x = -0.06;
  bg.renderOrder = fg.renderOrder = 999;
  holdBar.add(bg, fg); holdBar.userData.fg = fg;
  const lbl = kit.makeLabel('Hold to return to hub', { size: 0.022, color: '#ffffff' }); lbl.position.y = 0.025; lbl.material.depthTest = false; lbl.renderOrder = 999; holdBar.add(lbl);
}
let holdTime = 0;
// A short reminder, floating in view for a few seconds after a game starts (VR only).
let hintSprite = null, hintTimer = 0;
function showExitHint() {
  hintSprite?.removeFromParent();
  hintSprite = kit.makeLabel('Hold X/Y (left) or B (right) for 1 s to return to the hub', { size: 0.035, color: '#ffe7a0', bg: 'rgba(10,12,24,0.75)' });
  hintSprite.material.depthTest = false; hintSprite.renderOrder = 999;
  hintSprite.position.set(0, -0.18, -0.7);
  camera.add(hintSprite);
  hintTimer = 5;
}
function updateExitHint(dt) {
  if (!hintSprite) return;
  hintSprite.visible = renderer.xr.isPresenting;
  if ((hintTimer -= dt) <= 0) { hintSprite.removeFromParent(); hintSprite.material.map?.dispose(); hintSprite.material.dispose(); hintSprite = null; }
}
function updateExitGesture(dt) {
  if (currentId === 'hub' || loading) { holdTime = 0; holdBar.removeFromParent(); return; }
  if (input.desktop && input.keyDown('Tab')) { launch('hub'); return; }
  const L = input.left, R = input.right;
  const holding = !input.desktop && ((L.present && (L.bHeld || L.aHeld)) || (R.present && R.bHeld));
  if (holding) {
    holdTime += dt;
    if (holdTime > 0.25) {
      // show the progress bar in front of the eyes so it's visible whatever the hands are doing
      if (!holdBar.parent) scene.add(holdBar);
      holdBar.position.copy(input.head.pos).addScaledVector(input.head.fwd, 0.6).addScaledVector(input.head.up, -0.12);
      holdBar.lookAt(input.head.pos);
      holdBar.userData.fg.scale.x = Math.min(1, (holdTime - 0.25) / 0.75);
    }
    if (holdTime >= 1.0) { holdTime = 0; holdBar.removeFromParent(); launch('hub'); }
  } else { holdTime = 0; holdBar.removeFromParent(); }
}

// ── Start screen ─────────────────────────────────────────────
const overlay = document.getElementById('overlay');
const btnVR = document.getElementById('btn-vr');
const btnDesk = document.getElementById('btn-desk');
const vrNote = document.getElementById('vr-note');
const crosshair = document.getElementById('crosshair');
const btnHub = document.getElementById('btn-hub');

(async () => {
  if (!navigator.xr) { vrNote.textContent = 'WebXR isn’t available in this browser. Desktop mode still works.'; return; }
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    btnVR.disabled = !ok;
    vrNote.textContent = ok ? 'Headset detected.' : 'No VR headset detected. Desktop mode still works.';
  } catch { vrNote.textContent = 'VR is blocked in this frame. Open the page directly.'; }
})();

let pendingRecenter = 0;
btnVR.addEventListener('click', async () => {
  audio.ensure();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
    input.desktop = false;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
    await renderer.xr.setSession(session);
    overlay.hidden = true; crosshair.hidden = true; hudEl.hidden = true; btnHub.hidden = true;
    pendingRecenter = 30;
    current?.onXRStart?.();
    session.addEventListener('end', () => {
      overlay.hidden = false;
      camera.position.set(0, DESK_EYE, 0);
      current?.onXREnd?.();
    });
  } catch (err) { vrNote.textContent = `Couldn’t start VR: ${err.message ?? err}`; }
});
function startDesktop() {
  audio.ensure();
  input.desktop = true;
  overlay.hidden = true; crosshair.hidden = false; btnHub.hidden = false;
  try { const r = renderer.domElement.requestPointerLock(); r?.catch?.(() => { }); } catch { }
}
btnDesk.addEventListener('click', startDesktop);
btnHub.addEventListener('click', () => launch('hub'));
document.getElementById('btn-menu').addEventListener('click', () => { overlay.hidden = false; input.desktop = false; crosshair.hidden = true; hudEl.hidden = true; btnHub.hidden = true; try { document.exitPointerLock(); } catch { } });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Frame loop ───────────────────────────────────────────────
const clock = new THREE.Clock();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  input.update(dt);
  if (pendingRecenter > 0 && --pendingRecenter === 0) ctx.recenter(current?.spawn?.x ?? 0, current?.spawn?.z ?? 0, current?.spawn?.yaw ?? 0);
  if (!input.desktop && !renderer.xr.isPresenting) camera.rotation.set(-0.05, Math.sin(elapsed * 0.1) * 0.3, 0, 'YXZ');
  updateExitGesture(dt);
  updateExitHint(dt);
  if (current && !loading) {
    try { current.update(dt, elapsed); }
    catch (e) {
      console.error(`Game "${currentId}" crashed`, e);
      ctx.lastError = `${currentId}: ${e.message ?? e}`;
      if (currentId !== 'hub') launch('hub'); else current = null;
    }
  }
  input.endFrame();
  if (current?.render) current.render(renderer, scene, camera);
  else renderer.render(scene, camera);
});

// Boot: straight into the hub, or ?game=<id> (add &desktop=1 to skip the start screen).
launch(params.get('game') ?? 'hub');
if (params.get('desktop') === '1') startDesktop();

window.__platform = { ctx, launch, input, get current() { return current; }, get currentId() { return currentId; }, get scene() { return scene; } };
