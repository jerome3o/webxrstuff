import * as THREE from 'three';
import { CFG } from './config.js';
import { audio } from './audio.js';
import { PhysicsWorld } from './physics.js';
import { FX } from './particles.js';
import { UIManager } from './ui.js';
import { buildEnvironment, refreshFontTextures } from './environment.js';
import { redrawTargetTextures } from './targets.js';
import { Game } from './game.js';
import { WeaponSystem } from './weapons.js';
import { buildHUD } from './hud.js';
import { loadFonts, clamp } from './util.js';

// ── Renderer & scene ─────────────────────────────────────────
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

const scene = new THREE.Scene();
const rig = new THREE.Group(); scene.add(rig);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 3000);
camera.position.set(0, CFG.eyeHeightDesktop, 0);
rig.add(camera);

const physics = new PhysicsWorld();
const fx = new FX(scene, CFG.particleCapacity);
const ui = new UIManager(scene);
const env = buildEnvironment(scene, physics);
const game = new Game({ scene, physics, fx, ui, env });
game.populate();
const weapons = new WeaponSystem(scene, game, renderer);
const hud = buildHUD(scene, ui, game, weapons);
weapons.bow.setSkin(game.skin);
game.onSkin = (s) => weapons.bow.setSkin(s);
audio.musicOn = game.settings.music;

loadFonts().then(() => { refreshFontTextures(); redrawTargetTextures(); ui.markAllDirty(); });

// ── XR controllers ───────────────────────────────────────────
const xrHands = [0, 1].map((i) => {
  const ray = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  rig.add(ray, grip);
  const h = { ray, grip, source: null, prev: [] };
  ray.addEventListener('connected', (e) => { h.source = e.data; });
  ray.addEventListener('disconnected', () => { h.source = null; });
  return h;
});

function emptyHand() {
  return {
    present: false, gripPos: new THREE.Vector3(), gripQuat: new THREE.Quaternion(),
    rayPos: new THREE.Vector3(), rayQuat: new THREE.Quaternion(),
    trigger: 0, squeeze: 0, triggerDown: false, triggerUp: false, squeezeDown: false,
    a: false, b: false, stick: false, axes: [0, 0], haptic: () => { },
  };
}
const hands = { main: emptyHand(), off: emptyHand() };

function readXRHand(h, out) {
  const src = h.source;
  const gp = src?.gamepad;
  out.present = !!gp;
  if (!gp) return;
  h.grip.getWorldPosition(out.gripPos); h.grip.getWorldQuaternion(out.gripQuat);
  h.ray.getWorldPosition(out.rayPos); h.ray.getWorldQuaternion(out.rayQuat);
  const btn = (i) => gp.buttons[i] ? gp.buttons[i].value ?? (gp.buttons[i].pressed ? 1 : 0) : 0;
  const pressed = (i) => !!gp.buttons[i]?.pressed;
  const prevT = out.trigger, prevS = out.squeeze;
  out.trigger = btn(0); out.squeeze = btn(1);
  out.triggerDown = out.trigger > 0.55 && prevT <= 0.55;
  out.triggerUp = out.trigger < 0.3 && prevT >= 0.3;
  out.squeezeDown = out.squeeze > 0.6 && prevS <= 0.6;
  const edge = (i) => { const p = pressed(i); const was = h.prev[i]; h.prev[i] = p; return p && !was; };
  out.stick = edge(3); out.a = edge(4); out.b = edge(5);
  out.axes = [gp.axes[2] ?? gp.axes[0] ?? 0, gp.axes[3] ?? gp.axes[1] ?? 0];
  out.haptic = (intensity, ms) => {
    try {
      const act = gp.hapticActuators?.[0];
      if (act?.pulse) act.pulse(clamp(intensity, 0, 1), ms);
      else gp.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
    } catch { /* haptics are optional */ }
  };
}

// Snap turn around the head
let snapReady = true;
function snapTurn(dir, headPos) {
  const a = -dir * THREE.MathUtils.degToRad(CFG.snapTurnDeg);
  const off = rig.position.clone().sub(headPos); off.y = 0;
  off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
  rig.position.set(headPos.x + off.x, rig.position.y, headPos.z + off.z);
  rig.rotateY(a);
}

// ── Desktop controls ─────────────────────────────────────────
const desk = {
  active: false, yaw: 0, pitch: 0, mouseDown: false, mouseDownEdge: false, rmb: false,
  heldTime: 0, keys: new Set(), locked: false,
};
const crosshair = document.getElementById('crosshair');
const deskHud = document.getElementById('deskhud');
const scopeOverlay = document.getElementById('scope');

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!desk.active) return;
  if (e.button === 2) { desk.rmb = true; return; }
  if (e.button !== 0) return;
  if (!desk.locked) {
    // Unlocked: clicking a board works with the mouse cursor, anything else locks the pointer.
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    const p = ui.pick(rc.ray.origin, rc.ray.direction);
    if (p?.button) { ui.click(p); return; }
    try { const req = renderer.domElement.requestPointerLock(); req?.catch?.(() => { }); } catch { }
    return;
  }
  desk.mouseDown = true; desk.mouseDownEdge = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) desk.mouseDown = false; if (e.button === 2) desk.rmb = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => { desk.locked = document.pointerLockElement === renderer.domElement; });
document.addEventListener('mousemove', (e) => {
  if (!desk.active || !desk.locked || desk.freezeLook) return;
  const k = desk.rmb && weapons.current === 'sniper' ? 0.0004 : 0.0022;
  desk.yaw -= e.movementX * k; desk.pitch = clamp(desk.pitch - e.movementY * k, -1.4, 1.4);
});
window.addEventListener('keydown', (e) => {
  desk.keys.add(e.code);
  if (!desk.active) return;
  if (e.code.startsWith('Digit')) { const i = +e.code.slice(5) - 1; if (CFG.weaponOrder[i]) weapons.select(CFG.weaponOrder[i]); }
  if (e.code === 'KeyQ') weapons.cycle(-1);
  if (e.code === 'KeyE') weapons.cycle(1);
  if (e.code === 'KeyM') { game.settings.music = audio.toggleMusic(); game.persist(); ui.markAllDirty(); }
  if (e.code === 'KeyG') game.onGong();
});
window.addEventListener('keyup', (e) => desk.keys.delete(e.code));

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _cant = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.18);

function desktopHands(dt) {
  camera.rotation.set(desk.pitch, desk.yaw, 0, 'YXZ');
  // WASD walk around the platform
  const mv = new THREE.Vector3();
  if (desk.keys.has('KeyW')) mv.z -= 1; if (desk.keys.has('KeyS')) mv.z += 1;
  if (desk.keys.has('KeyA')) mv.x -= 1; if (desk.keys.has('KeyD')) mv.x += 1;
  if (mv.lengthSq()) {
    mv.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), desk.yaw).multiplyScalar(3 * dt);
    camera.position.add(mv);
    camera.position.x = clamp(camera.position.x, -5.5, 5.5); camera.position.z = clamp(camera.position.z, -2.3, 5.5);
  }
  camera.updateMatrixWorld(true);
  const cq = camera.getWorldQuaternion(new THREE.Quaternion());
  const cp = camera.getWorldPosition(new THREE.Vector3());
  _f.set(0, 0, -1).applyQuaternion(cq); _r.set(1, 0, 0).applyQuaternion(cq); _u.set(0, 1, 0).applyQuaternion(cq);

  const B = CFG.weapons.bow;
  if (desk.mouseDown) desk.heldTime += dt; else desk.heldTime = 0;
  const draw = Math.min(B.maxDraw, (desk.heldTime / 0.8) * B.maxDraw);

  const off = hands.off, main = hands.main;
  off.present = main.present = true;
  off.gripPos.copy(cp).addScaledVector(_f, 0.62).addScaledVector(_r, -0.2).addScaledVector(_u, -0.1);
  off.gripQuat.copy(cq).multiply(_cant).multiply(_rotX90);
  if (weapons.current === 'bow') {
    main.gripPos.copy(off.gripPos).addScaledVector(_f, -(B.braceHeight + (desk.mouseDown ? Math.max(draw, 0.001) : 0.25)));
  } else main.gripPos.copy(cp).addScaledVector(_f, 0.4).addScaledVector(_r, 0.17).addScaledVector(_u, -0.17);
  main.gripQuat.copy(cq);
  const big = weapons.current === 'rocket';
  main.rayPos.copy(cp).addScaledVector(_f, big ? 0.3 : 0.38).addScaledVector(_r, big ? 0.3 : 0.17).addScaledVector(_u, big ? -0.3 : -0.15);
  main.rayQuat.copy(cq);
  const prevT = main.trigger;
  main.trigger = desk.mouseDown ? 1 : 0;
  main.triggerDown = desk.mouseDownEdge; desk.mouseDownEdge = false;
  main.triggerUp = prevT > 0 && main.trigger === 0;
  main.squeeze = 0; main.squeezeDown = false;

  // Desktop sniper zoom
  const zoom = desk.rmb && weapons.current === 'sniper';
  weapons.desktopZoom = zoom;
  const fov = zoom ? 8 : 70;
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 1 - Math.exp(-18 * dt)); camera.updateProjectionMatrix(); }
  scopeOverlay.hidden = !zoom;
  crosshair.hidden = zoom;
  return { aim: _f.clone(), aimPoint: cp.clone().addScaledVector(_f, 40) };
}

function updateDeskHud() {
  const id = weapons.current, W = CFG.weapons[id];
  const ammo = game.ammo[id] === Infinity ? '∞' : `${game.ammo[id]}/${game.ammoMax(id)}`;
  let extra = '';
  if (id === 'sniper' && weapons.charging) extra = ` · charge ${Math.round(weapons.charge * 100)}%`;
  if (id === 'bow' && weapons.bowState === 'drawing') extra = ` · draw ${Math.round(weapons.bow.draw / CFG.weapons.bow.maxDraw * 100)}%`;
  const html = `<b>${W.cn}</b> ${W.en} <span>${ammo}${extra}</span> <i>${game.score} pts · ${game.coins} coins${game.roundActive ? ` · ${Math.ceil(game.roundTime)}s` : ''}</i>`;
  if (deskHud._last !== html) { deskHud.innerHTML = html; deskHud._last = html; }
  crosshair.classList.toggle('charged', id === 'sniper' && weapons.charge >= 1);
}

// ── Start screen ─────────────────────────────────────────────
const overlay = document.getElementById('overlay');
const btnVR = document.getElementById('btn-vr');
const btnDesk = document.getElementById('btn-desk');
const vrNote = document.getElementById('vr-note');

async function checkXR() {
  if (!navigator.xr) { vrNote.textContent = 'WebXR isn’t available in this browser. Open the page in the headset browser over HTTPS.'; btnVR.disabled = true; return; }
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    btnVR.disabled = !ok;
    vrNote.textContent = ok ? 'Headset detected.' : 'No VR headset detected. Desktop mode still works.';
  } catch { btnVR.disabled = true; vrNote.textContent = 'VR is blocked here (for example inside an embedded frame). Open the page directly.'; }
}
checkXR();

btnVR.addEventListener('click', async () => {
  audio.init();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] });
    desk.active = false;
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); camera.fov = 70; camera.updateProjectionMatrix();
    await renderer.xr.setSession(session);
    overlay.hidden = true; deskHud.hidden = true; crosshair.hidden = true; scopeOverlay.hidden = true;
    session.addEventListener('end', () => { overlay.hidden = false; camera.position.set(0, CFG.eyeHeightDesktop, 0); });
  } catch (err) {
    vrNote.textContent = `Couldn’t start VR: ${err.message ?? err}`;
  }
});
btnDesk.addEventListener('click', () => {
  audio.init();
  desk.active = true;
  overlay.hidden = true; deskHud.hidden = false; crosshair.hidden = false;
  try { const req = renderer.domElement.requestPointerLock(); req?.catch?.(() => { }); } catch { }
});
document.getElementById('btn-menu').addEventListener('click', () => { overlay.hidden = false; desk.active = false; deskHud.hidden = true; crosshair.hidden = true; try { document.exitPointerLock(); } catch { } });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Frame loop ───────────────────────────────────────────────
const clock = new THREE.Clock();
const headPos = new THREE.Vector3(), headQuat = new THREE.Quaternion(), headFwd = new THREE.Vector3(), headUp = new THREE.Vector3();
let elapsed = 0;

function frame() {
  const realDt = Math.min(clock.getDelta(), 0.05);
  const dt = realDt * game.timeScale;
  elapsed += dt;
  const xr = renderer.xr.isPresenting;
  rig.updateMatrixWorld(true);

  // Head pose (in XR, three copies last frame's head pose onto the camera)
  camera.getWorldPosition(headPos); camera.getWorldQuaternion(headQuat);
  headFwd.set(0, 0, -1).applyQuaternion(headQuat); headUp.set(0, 1, 0).applyQuaternion(headQuat);
  game.playerPos.copy(headPos);
  game.playerFwd.set(headFwd.x, 0, headFwd.z).normalize();

  // Input
  let deskAim = null;
  if (xr) {
    const right = xrHands.find(h => h.source?.handedness === 'right');
    const left = xrHands.find(h => h.source?.handedness === 'left');
    const mainSrc = game.settings.leftHanded ? left : right;
    const offSrc = game.settings.leftHanded ? right : left;
    if (mainSrc) readXRHand(mainSrc, hands.main); else hands.main.present = false;
    if (offSrc) readXRHand(offSrc, hands.off); else hands.off.present = false;
    // Buttons: A/X next weapon, B/Y previous; thumbstick snaps turn.
    for (const h of [hands.main, hands.off]) {
      if (!h.present) continue;
      if (h.a) weapons.cycle(1);
      if (h.b) weapons.cycle(-1);
    }
    const sx = (hands.main.present ? hands.main.axes[0] : 0) + (hands.off.present ? hands.off.axes[0] : 0);
    if (Math.abs(sx) > CFG.stickDeadzone && snapReady) { snapTurn(Math.sign(sx), headPos); snapReady = false; }
    if (Math.abs(sx) < 0.3) snapReady = true;
  } else if (desk.active) {
    deskAim = desktopHands(realDt);
  } else {
    hands.main.present = hands.off.present = false;
    // Attract mode: slow pan on the start screen
    camera.rotation.set(-0.03, Math.sin(elapsed * 0.08) * 0.35, 0, 'YXZ');
  }

  // UI pointing: VR uses the main hand ray; desktop uses the crosshair.
  let uiHover = false;
  if (xr && hands.main.present && !weapons.isBusy()) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(hands.main.rayQuat);
    const p = ui.pointer(hands.main.rayPos, dir, true);
    uiHover = !!p;
    if (p && hands.main.triggerDown) { ui.click(p); hands.main.triggerDown = false; }
  } else if (desk.active && desk.locked && !weapons.isBusy()) {
    const p = ui.pointer(headPos, headFwd, false);
    uiHover = !!p?.button;
    if (p?.button && hands.main.triggerDown) { ui.click(p); hands.main.triggerDown = false; desk.mouseDown = false; }
  } else ui.hideLaser();

  weapons.update(realDt, hands, { pos: headPos, quat: headQuat }, { desktop: desk.active && !xr, desktopAim: deskAim?.aim, desktopAimPoint: deskAim?.aimPoint, uiHover });

  game.update(dt, realDt);
  for (const u of env.updaters) u(dt, elapsed, game);
  hud.update(realDt);
  ui.update(realDt, headPos);

  // Wrist display rides on the off hand
  const wrist = hud.wrist.mesh;
  wrist.visible = xr && hands.off.present;
  if (wrist.visible) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(hands.off.gripQuat);
    wrist.position.copy(hands.off.gripPos).addScaledVector(back, 0.16).add(new THREE.Vector3(0, 0.06, 0));
    wrist.lookAt(headPos);
  }
  if (desk.active && !xr) updateDeskHud();

  // Particle size scale per eye viewport height
  const vh = xr ? (renderer.xr.getCamera().cameras?.[0]?.viewport?.w || 1800) : renderer.domElement.height;
  fx.setViewportHeight(vh);

  audio.setListener(headPos, headFwd, headUp);
  weapons.renderScope(renderer, scene);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(frame);

// Debug handle for iterating from the console.
window.__game = { game, weapons, scene, camera, THREE, physics, desk, ui };
