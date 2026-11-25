import * as THREE from 'three';
import { CFG } from './config.js';
import { audio } from './audio.js';
import { PhysicsWorld } from './physics.js';
import { FX } from './particles.js';
import { UIManager } from './ui.js';
import { buildEnvironment, refreshFontTextures } from './environment.js';
import { redrawTargetTextures, resetTargetTextures } from './targets.js';
import { Game } from './game.js';
import { WeaponSystem } from './weapons.js';
import { buildHUD } from './hud.js';
import { loadFonts } from './util.js';
import { bakeStatic } from './batch.js';
import { Teleporter, rotateRigAround } from '../../src/platform/kit.js';

// 百步穿杨 running inside the VR Playground platform.
export async function create(ctx) {
  const { scene, renderer, camera, rig, input } = ctx;
  resetTargetTextures();

  const physics = new PhysicsWorld();
  const fx = new FX(scene, CFG.particleCapacity);
  const ui = new UIManager(scene);
  const env = buildEnvironment(scene, physics);
  const game = new Game({ scene, physics, fx, ui, env });
  game.populate();
  const weapons = new WeaponSystem(scene, game, renderer);
  const hud = buildHUD(scene, ui, game, weapons);
  bakeStatic(env.root, new Set(physics.staticMeshes));
  weapons.bow.setSkin(game.skin);
  game.onSkin = (s) => weapons.bow.setSkin(s);

  audio.musicOn = game.settings.music;
  audio.init(ctx.audio.ctx, ctx.audio.out);
  loadFonts().then(() => { refreshFontTextures(); redrawTargetTextures(); ui.markAllDirty(); });

  // Teleport anywhere on the range floor; thumbstick click returns to the line.
  const tp = new Teleporter(scene, {
    color: 0xffd060,
    isValid: (p) => p.x > -15 && p.x < 15 && p.z > -94 && p.z < 7,
  });
  let snapReady = true;

  // Desktop: a scope overlay and the platform crosshair.
  const scopeEl = document.createElement('div');
  scopeEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle at center, transparent 0 34vmin, #000 35vmin)';
  scopeEl.innerHTML = '<div style="position:absolute;left:50%;top:15vmin;bottom:15vmin;width:1px;background:#111"></div><div style="position:absolute;top:50%;left:calc(50% - 35vmin);width:70vmin;height:1px;background:#111"></div>';
  scopeEl.hidden = true;
  document.body.appendChild(scopeEl);
  const crosshair = document.getElementById('crosshair');

  const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  const _cp = new THREE.Vector3(), _cq = new THREE.Quaternion();
  const _rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  const _cant = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.18);
  let heldTime = 0;

  // On desktop, pose the two hands so the bow and guns sit nicely in view.
  function desktopHands(dt) {
    const main = input.main, off = input.off;
    // WASD walks around the shooting platform
    const [mx, my] = off.axes;
    if (mx || my) {
      const yaw = input.yaw;
      const v = new THREE.Vector3(mx, 0, my).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(3 * dt);
      rig.position.add(v);
      rig.position.x = THREE.MathUtils.clamp(rig.position.x, -5.5, 5.5);
      rig.position.z = THREE.MathUtils.clamp(rig.position.z, -2.3, 5.5);
    }
    camera.updateMatrixWorld(true);
    camera.getWorldQuaternion(_cq); camera.getWorldPosition(_cp);
    _f.set(0, 0, -1).applyQuaternion(_cq); _r.set(1, 0, 0).applyQuaternion(_cq); _u.set(0, 1, 0).applyQuaternion(_cq);
    const B = CFG.weapons.bow;
    const down = input.mouse.left;
    heldTime = down ? heldTime + dt : 0;
    const draw = Math.min(B.maxDraw, (heldTime / 0.8) * B.maxDraw);
    off.gripPos.copy(_cp).addScaledVector(_f, 0.62).addScaledVector(_r, -0.2).addScaledVector(_u, -0.1);
    off.gripQuat.copy(_cq).multiply(_cant).multiply(_rotX90);
    if (weapons.current === 'bow') main.gripPos.copy(off.gripPos).addScaledVector(_f, -(B.braceHeight + (down ? Math.max(draw, 0.001) : 0.25)));
    else main.gripPos.copy(_cp).addScaledVector(_f, 0.4).addScaledVector(_r, 0.17).addScaledVector(_u, -0.17);
    main.gripQuat.copy(_cq);
    const big = weapons.current === 'rocket';
    main.rayPos.copy(_cp).addScaledVector(_f, big ? 0.3 : 0.38).addScaledVector(_r, big ? 0.3 : 0.17).addScaledVector(_u, big ? -0.3 : -0.15);
    main.rayQuat.copy(_cq);
    main.squeeze = 0; main.squeezeDown = false;
    // Sniper zoom on right mouse
    const zoom = input.mouse.right && weapons.current === 'sniper';
    weapons.desktopZoom = zoom;
    input.lookSensitivity = zoom ? 0.0004 : 0.0022;
    const fov = zoom ? 8 : 70;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 1 - Math.exp(-18 * dt)); camera.updateProjectionMatrix(); }
    scopeEl.hidden = !zoom;
    if (crosshair) crosshair.hidden = zoom;
    // Keyboard shortcuts
    for (let i = 0; i < 4; i++) if (input.keyDown('Digit' + (i + 1))) weapons.select(CFG.weaponOrder[i]);
    if (input.keyDown('KeyQ')) weapons.cycle(-1);
    if (input.keyDown('KeyE')) weapons.cycle(1);
    if (input.keyDown('KeyM')) { game.settings.music = audio.toggleMusic(); game.persist(); ui.markAllDirty(); }
    if (input.keyDown('KeyG')) game.onGong();
    return { aim: _f.clone(), aimPoint: _cp.clone().addScaledVector(_f, 40) };
  }

  function deskHud() {
    const id = weapons.current, W = CFG.weapons[id];
    const ammo = game.ammo[id] === Infinity ? '∞' : `${game.ammo[id]}/${game.ammoMax(id)}`;
    let extra = '';
    if (id === 'sniper' && weapons.charging) extra = ` · charge ${Math.round(weapons.charge * 100)}%`;
    if (id === 'bow' && weapons.bowState === 'drawing') extra = ` · draw ${Math.round(weapons.bow.draw / CFG.weapons.bow.maxDraw * 100)}%`;
    ctx.setHud(`<b style="color:#e2b85c">${W.cn}</b> ${W.en} · ${ammo}${extra} · <span style="color:#a8a0c0">${game.score} pts · ${game.coins} coins${game.roundActive ? ` · ${Math.ceil(game.roundTime)}s` : ''} · 1–4 weapons, G gong, Tab hub</span>`);
  }

  window.__game = { game, weapons, scene, camera, THREE, physics, ui };

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    update(realDt, elapsed) {
      const dt = realDt * game.timeScale;
      const xr = input.xr;
      input.leftHanded = game.settings.leftHanded;
      const headPos = input.head.pos, headFwd = input.head.fwd;
      game.playerPos.copy(headPos);
      game.playerFwd.set(headFwd.x, 0, headFwd.z).normalize();

      let deskAim = null;
      if (xr) {
        for (const h of [input.main, input.off]) {
          if (!h.present) continue;
          if (h.a) weapons.cycle(1);
          if (h.b) weapons.cycle(-1);
          if (h.stick) ctx.recenter(0, 0, 0);
        }
        tp.update(input, rig);
        let sx = 0;
        for (const h of [input.main, input.off]) if (h.present && Math.abs(h.axes[0]) > Math.abs(h.axes[1])) sx += h.axes[0];
        if (!tp.hand && Math.abs(sx) > CFG.stickDeadzone && snapReady) { rotateRigAround(rig, headPos, -Math.sign(sx) * THREE.MathUtils.degToRad(CFG.snapTurnDeg)); snapReady = false; }
        if (Math.abs(sx) < 0.3) snapReady = true;
      } else if (input.desktop) {
        deskAim = desktopHands(realDt);
      }

      // UI pointing: VR uses the main hand ray; desktop uses the crosshair.
      let uiHover = false;
      if (xr && input.main.present && !weapons.isBusy()) {
        const p = ui.pointer(input.main.rayPos, input.main.rayDir(), true);
        uiHover = !!p;
        if (p && input.main.triggerDown) { ui.click(p); input.main.triggerDown = false; }
      } else if (input.desktop && !weapons.isBusy()) {
        const p = ui.pointer(headPos, headFwd, false);
        uiHover = !!p?.button;
        if (p?.button && input.main.triggerDown) { ui.click(p); input.main.triggerDown = false; heldTime = 0; }
      } else ui.hideLaser();

      weapons.update(realDt, { main: input.main, off: input.off }, { pos: headPos, quat: input.head.quat },
        { desktop: input.desktop && !xr, desktopAim: deskAim?.aim, desktopAimPoint: deskAim?.aimPoint, uiHover });

      game.update(dt, realDt);
      for (const u of env.updaters) u(dt, elapsed, game);
      hud.update(realDt);
      ui.update(realDt, headPos);

      // Ammo/coins readout beside whatever you're holding
      const wrist = hud.wrist.mesh;
      const holder = weapons.current === 'bow' ? input.off : input.main;
      wrist.visible = xr && holder.present;
      if (wrist.visible) {
        if (weapons.current === 'bow') wrist.position.lerpVectors(holder.gripPos, headPos, 0.4).y -= 0.16;
        else {
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(holder.rayQuat);
          const side = new THREE.Vector3(1, 0, 0).applyQuaternion(holder.rayQuat).multiplyScalar(game.settings.leftHanded ? -1 : 1);
          wrist.position.copy(holder.rayPos).addScaledVector(up, 0.1).addScaledVector(side, 0.12);
        }
        wrist.lookAt(headPos);
      }
      if (input.desktop && !xr) deskHud();

      const vh = xr ? (renderer.xr.getCamera().cameras?.[0]?.viewport?.w || 1800) : renderer.domElement.height;
      fx.setViewportHeight(vh);
      audio.setListener(headPos, headFwd, input.head.up);
      weapons.renderScope(renderer, scene);
    },
    dispose() {
      game.persist();
      audio.shutdown();
      scopeEl.remove();
      if (crosshair) crosshair.hidden = !input.desktop;
      input.leftHanded = false;
      input.lookSensitivity = 0.0022;
      delete window.__game;
    },
  };
}
