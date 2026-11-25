import * as THREE from 'three';
import { Panel, Pointer, Teleporter, Locomotion, FONTS, roundRect, fitText } from '../../src/platform/kit.js';
import { World, Body } from './physics.js';
import { Builder, SignAtlas, Frame, cobbleTexture, bake, rng } from './env.js';
import { Sounds } from './audio.js';
import { Fireworks, Steam } from './fx.js';
import { PropSet } from './props.js';
import { Grabber } from './grab.js';
import { TinStall, RingStall, DartStall, HoopStall, SkeeStall, CoinStall, drawSign, staticBox } from './stalls.js';
import { PrizeCounter, HomeShelf, PRIZES } from './prizes.js';

// Night Market Toss: a lantern-lit street of carnival throwing stalls.
// Feature: grab & throw physics (custom rigid-body engine in physics.js).
const BOUNDS = { x0: -1.75, x1: 1.75, z0: -17.1, z1: 3.1 };
const ASSIST_LEVELS = [0, 0.35, 0.65, 1];

export async function create(ctx) {
  const { scene, input, rig } = ctx;
  scene.background = new THREE.Color(0x070a18);
  scene.fog = new THREE.Fog(0x0a0d1c, 16, 48);
  scene.add(new THREE.HemisphereLight(0x8090c8, 0x4a3020, 1.1));
  const moon = new THREE.DirectionalLight(0x9ab0ff, 0.35); moon.position.set(-5, 10, 4); scene.add(moon);

  const data = Object.assign({ tickets: 0, prizes: [], best: {}, assist: 1, smoothTurn: false }, ctx.load('toss:data', {}) ?? {});
  if (!Array.isArray(data.prizes)) data.prizes = [];
  if (typeof data.best !== 'object' || !data.best) data.best = {};

  const world = new World({ dt: 1 / 240, iterations: 8, maxSubsteps: 12 });
  const sounds = new Sounds(ctx.audio);
  const pointer = new Pointer(scene);
  pointer.onClick = () => sounds.click();

  const mats = makeMaterials();
  const game = {
    ctx, scene, world, input, sounds, pointer, mats, data, Body,
    lit: new Builder(), glow: new Builder(), signs: new SignAtlas(24),
    lamps: [], bulbs: [], lanterns: [], substepHooks: [], lights: [],
    time: 0, stalls: [],
    addLight(p, color, intensity, distance) { const l = new THREE.PointLight(color, intensity, distance, 1.6); l.position.copy(p); scene.add(l); this.lights.push(l); return l; },
    persist() { ctx.save('toss:data', data); },
    addTickets(n, stall) { data.tickets += n; this.persist(); this.ticketsChanged(); },
    ticketsChanged() { prize?.panel.markDirty(); settings?.markDirty(); wrist?.markDirty(); },
    celebrate(p, big) { fireworks.launch(p.x, p.y + 0.6, p.z, big ? 5 : 2); sounds.win(p, big); },
    stallAt(p) {
      for (const s of this.stalls) {
        const l = s.frame.toLocal(p, _l);
        if (l.z > -0.8 && l.z < 2.4 && Math.abs(l.x) < 1.95) return s;
      }
      return null;
    },
  };
  const _l = new THREE.Vector3();
  world.onSubstep = (dt) => { for (const h of game.substepHooks) h(dt); };

  // ── stalls ──
  const L = Math.PI / 2, R = -Math.PI / 2;
  const stalls = game.stalls = [
    new TinStall(game, { x: -2, z: -3, yaw: L }),
    new DartStall(game, { x: 2, z: -3, yaw: R }),
    new RingStall(game, { x: -2, z: -8, yaw: L }),
    new HoopStall(game, { x: 2, z: -8, yaw: R }),
    new CoinStall(game, { x: -2, z: -13, yaw: L }),
    new SkeeStall(game, { x: 2, z: -13, yaw: R }),
  ];
  let prize = null, settings = null, wrist = null;
  game.grabber = new Grabber(game);
  prize = new PrizeCounter(game, 0, -17.6, 0);
  game.home = new HomeShelf(game, -2.15, 1.7, L);

  buildStreet(game);
  settings = buildSettings(game);

  // ── finalize merged / instanced scenery ──
  const litMesh = game.lit.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), game.lamps, { sky: new THREE.Color(0x2c3462), ground: new THREE.Color(0x3a2418) });
  scene.add(litMesh);
  scene.add(game.glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  scene.add(game.signs.mesh());
  scene.add(buildGround(game));
  const bulbMesh = buildBulbs(game);
  const lanternMesh = buildLanterns(game);
  const fireworks = new Fireworks(scene, sounds); game.fireworks = fireworks;
  const steam = new Steam(scene, game.steamEmitters);

  const propSets = [];
  for (const s of stalls) for (const k of Object.keys(s)) if (s[k] instanceof PropSet) propSets.push(s[k]);

  // ── locomotion ──
  const loco = new Locomotion({ speed: 2.2, smoothTurn: !!data.smoothTurn });
  const tele = new Teleporter(scene, { isValid: (p) => p.x > BOUNDS.x0 - 0.2 && p.x < BOUNDS.x1 + 0.2 && p.z > BOUNDS.z0 - 0.2 && p.z < BOUNDS.z1 + 0.2 });
  game.grabber.assist = ASSIST_LEVELS[data.assist] ?? 0.35;
  game.setTurn = (v) => { loco.smoothTurn = v; };

  // ── VR wrist ticket display ──
  wrist = new Panel({
    width: 0.13, height: 0.065, px: 260, draw: (c, W, H) => {
      roundRect(c, 2, 2, W - 4, H - 4, 18); c.fillStyle = 'rgba(30,10,10,0.9)'; c.fill(); c.strokeStyle = '#e2b85c'; c.lineWidth = 4; c.stroke();
      c.fillStyle = '#ffd060'; c.textAlign = 'center'; c.textBaseline = 'middle'; fitText(c, `${data.tickets} tickets`, W / 2, H / 2 + 2, W - 20, 48, FONTS.sans);
    },
  });
  wrist.mesh.visible = false; scene.add(wrist.mesh);

  if (!ctx.isXR()) ctx.recenter(0, 1.6, 0);
  sounds.startAmbience();
  for (const s of stalls) s.operator.say(s.lines[0], 3 + Math.random() * 3);

  const tmpV = new THREE.Vector3();
  let hudT = 0;

  function clampRig() {
    const hp = input.head.pos;
    let dx = 0, dz = 0;
    if (hp.x < BOUNDS.x0) dx = BOUNDS.x0 - hp.x; else if (hp.x > BOUNDS.x1) dx = BOUNDS.x1 - hp.x;
    if (hp.z < BOUNDS.z0) dz = BOUNDS.z0 - hp.z; else if (hp.z > BOUNDS.z1) dz = BOUNDS.z1 - hp.z;
    if (dx || dz) { rig.position.x += dx; rig.position.z += dz; hp.x += dx; hp.z += dz; }
  }

  // physics + game logic (also used by tests through debug.simulate)
  function logic(dt) {
    game.time += dt;
    const t = game.time;
    world.step(dt);
    for (let i = 0; i < world.impactCount; i++) {
      const ev = world.impacts[i], a = ev.a, b = ev.b;
      const st = a.user?.stall ?? b?.user?.stall;
      if (st) st.onImpact(ev, a, b, ev.speed);
      else if (ev.speed > 1) sounds.thud(ev, ev.speed);
      const u = a.user;
      if (u?.thrower && t - u.thrownAt < 4 && ev.speed > 1.2) u.thrower.haptic(Math.min(0.8, ev.speed * 0.08), 18);
    }
    for (const s of stalls) s.update(dt, t, input.head.pos);
    prize.update(dt, t, input.head.pos);
    for (const ps of propSets) ps.sync();
  }

  function update(dt, t) {
    sounds.update(dt, t);
    // movement
    const telePorted = tele.update(input, rig);
    if (!tele.hand) loco.update(dt, input, rig);
    if (telePorted) sounds.click();
    rig.updateMatrixWorld(true);
    input.head.pos.setFromMatrixPosition(ctx.camera.matrixWorld);
    clampRig();
    // grabbing (before physics so held bodies are posed this frame)
    game.grabber.update(dt, game.time + dt);
    logic(dt);
    // scenery animation
    swayLanterns(lanternMesh, game.lanterns, game.time);
    steam.update(dt);
    fireworks.update(dt);
    // panels: pointer from a free hand
    const gr = game.grabber;
    let ph = input.main;
    if (gr.isHolding(input.main) && input.off.present && !input.desktop) ph = input.off;
    const canPoint = !gr.isHolding(ph);
    const hit = pointer.update(canPoint ? ph : null, { show: true, far: 6 });
    if (hit && canPoint && ph.triggerDown) pointer.click(hit);
    // wrist display
    if (input.xr && input.off.present) {
      wrist.mesh.visible = true;
      wrist.mesh.position.copy(input.off.gripPos).addScaledVector(tmpV.set(0, 1, 0).applyQuaternion(input.off.gripQuat), 0.06);
      wrist.mesh.lookAt(input.head.pos);
      wrist.redraw();
    } else wrist.mesh.visible = false;
    // desktop HUD
    hudT -= dt;
    if (input.desktop && hudT <= 0) {
      hudT = 0.1;
      const held = gr.heldBy(input.main);
      const st = game.stallAt(input.head.pos);
      const ch = gr.chargeOf(input.main);
      let s = `<b style="color:#ffd060">${data.tickets} tickets</b>`;
      if (st) s += ` · ${st.name}: ${st.thrownCount()}/${st.projectiles.length} thrown, ${st.scoreText()}`;
      if (held) s += ch > 0 ? ` · Throw power <span style="letter-spacing:-2px;color:#ffb060">${'█'.repeat(Math.round(ch * 10))}${'░'.repeat(10 - Math.round(ch * 10))}</span>` : ` · Holding ${held.user.kind}: hold LMB to charge, release to throw (RMB drop)`;
      else if (gr.states[input.main.handedness].hover) s += ` · E / RMB to grab the ${gr.states[input.main.handedness].hover.user.kind.toLowerCase()}`;
      else s += ' · WASD walk · aim at a prop + E/RMB to grab · LMB clicks panels';
      ctx.setHud(s);
    }
  }

  return {
    spawn: { x: 0, z: 1.6, yaw: 0 },
    update,
    dispose() { sounds.dispose(); ctx.setHud(''); },
    debug: { game, world, stalls, prize, data, logic, PRIZES,
      simulate(sec, step = 1 / 60) { for (let k = 0; k < sec / step; k++) logic(step); },
      drawCalls: () => ctx.renderer.info.render.calls,
    },
  };
}

// ── materials & textures ─────────────────────────────────────
function makeMaterials() {
  const tinTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#c8c8d0'; x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#c0261d'; x.fillRect(0, 18, 256, 92);
    x.fillStyle = '#ffd060'; x.fillRect(0, 22, 256, 8); x.fillRect(0, 98, 256, 8);
    x.fillStyle = '#ffe8a0'; x.font = `60px ${FONTS.brush}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('福', 64, 66); x.fillText('喜', 192, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ticketTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#d02a1f'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = '#ffd060'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('票', 32, 34);
    x.fillStyle = '#5a0a08'; for (let i = 0; i < 64; i += 8) x.fillRect(i, 0, 4, 3);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; return t;
  })();
  return {
    figure: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a2a22 }),
    prize: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x181008 }),
    tin: new THREE.MeshPhongMaterial({ map: tinTex, shininess: 90, specular: 0x777777, emissive: 0x100808 }),
    cloth: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x100808 }),
    ring: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x281810 }),
    balloon: new THREE.MeshPhongMaterial({ shininess: 110, specular: 0x777777, emissive: 0x200808 }),
    dart: new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x101010 }),
    pearl: new THREE.MeshPhongMaterial({ shininess: 140, specular: 0xaaaaaa, emissive: 0x2a2428 }),
    skee: new THREE.MeshPhongMaterial({ shininess: 100, specular: 0x888888, emissive: 0x181010 }),
    water: new THREE.MeshPhongMaterial({ color: 0x0a3a4a, shininess: 120, specular: 0x8ab0c0, transparent: true, opacity: 0.82, emissive: 0x041418 }),
    koi: new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x200800 }),
    bowl: new THREE.MeshPhongMaterial({ shininess: 90, specular: 0x888888, emissive: 0x141414, side: THREE.DoubleSide }),
    coin: new THREE.MeshPhongMaterial({ color: 0xffc840, shininess: 90, specular: 0xffeeaa, emissive: 0x3a2800 }),
    ticket: new THREE.MeshBasicMaterial({ map: ticketTex, side: THREE.DoubleSide }),
  };
}

// ── street scenery ───────────────────────────────────────────
function buildStreet(game) {
  const L = game.lit, G = game.glow, r = rng(42);
  // gate behind the spawn (facing -Z, into the market)
  const gate = new Frame(0, 3.7, Math.PI);
  for (const sx of [-1, 1]) {
    L.box(gate.m, sx * 2.3, 2.0, 0, 0.3, 4.0, 0.3, 0xa8261c);
    L.box(gate.m, sx * 2.3, 0.15, 0, 0.5, 0.3, 0.5, 0x5a5a60);
  }
  L.box(gate.m, 0, 3.75, 0, 5.4, 0.3, 0.4, 0xa8261c);
  L.box(gate.m, 0, 4.05, 0, 6.0, 0.12, 0.9, 0x1a4a3a);
  L.box(gate.m, 0, 3.25, 0, 4.4, 0.12, 0.25, 0xe2b85c);
  const gr = game.signs.add((c, W, H) => drawSign(c, W, H, '夜市', 'Night Market Toss', 0x8a1a14, 0xffd060));
  game.signs.plane(gate.m, 0, 3.75, 0.21, 2.8, 0.35, gr);
  game.signs.plane(gate.m, 0, 3.75, -0.21, 2.8, 0.35, gr, Math.PI);
  game.lanterns.push({ p: gate.toWorld(-1.4, 3.0, 0), s: 1.4 }, { p: gate.toWorld(1.4, 3.0, 0), s: 1.4 });
  game.lamps.push({ x: 0, y: 3.0, z: 3.4, color: new THREE.Color(1, 0.6, 0.35), intensity: 1.2, range: 6 });

  // poles + string lights zig-zagging across the street
  const zs = [2.6, -5.5, -10.5, -15.5];
  const wires = [];
  for (const z of zs) for (const sx of [-1, 1]) {
    L.box(null, sx * 1.95, 1.9, z, 0.1, 3.8, 0.1, 0x6a1a14);
    L.box(null, sx * 1.95, 3.82, z, 0.16, 0.06, 0.16, 0xe2b85c);
  }
  for (let i = 0; i < zs.length; i++) {
    wires.push([-1.95, zs[i], 1.95, zs[i]]);
    if (i + 1 < zs.length) { wires.push([-1.95, zs[i], 1.95, zs[i + 1]]); wires.push([1.95, zs[i], -1.95, zs[i + 1]]); }
    game.lamps.push({ x: 0, y: 3.2, z: zs[i], color: new THREE.Color(1, 0.75, 0.45), intensity: 0.9, range: 5 });
    for (const lx of [-0.8, 0.8]) game.lanterns.push({ p: new THREE.Vector3(lx, 3.65 - 0.45 * (1 - (lx / 1.95) ** 2) - 0.25, zs[i]), s: 0.9 });
  }
  const lineP = [];
  for (const [x0, z0, x1, z1] of wires) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(8, Math.round(len / 0.35));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const f = k / n, x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f, y = 3.75 - Math.sin(f * Math.PI) * 0.5;
      const p = new THREE.Vector3(x, y, z);
      if (prev) lineP.push(prev.x, prev.y, prev.z, x, y, z);
      if (k > 0 && k < n) game.bulbs.push(p.clone().add(new THREE.Vector3(0, -0.04, 0)));
      prev = p;
    }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lineP, 3));
  game.scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x201810 })));

  // food carts with steamers in the gaps between stalls
  game.steamEmitters = [];
  const cartCols = [0x2a6a8a, 0x8a3a2a, 0x3a7a3a, 0x7a5a2a];
  [[-1, -5.5], [1, -5.5], [-1, -10.5], [1, -10.5], [-1, -16.2], [1, -16.2]].forEach(([sx, z], i) => {
    const f = new Frame(sx * 2.6, z, sx < 0 ? Math.PI / 2 : -Math.PI / 2), F = f.m;
    L.box(F, 0, 0.5, 0, 0.8, 0.8, 0.55, cartCols[i % 4]);
    L.box(F, 0, 0.92, 0, 0.86, 0.04, 0.6, 0x8a5a36);
    for (const wx of [-0.3, 0.3]) L.cyl(F, wx, 0.14, 0.3, 0.14, 0.14, 0.04, 0x2a1a10, 10, 0, 0, Math.PI / 2);
    for (let k = 0; k < 3; k++) L.cyl(F, -0.15, 1.0 + k * 0.09, 0, 0.16, 0.16, 0.08, k % 2 ? 0xd8b070 : 0xc8a060, 12);
    L.cyl(F, -0.15, 1.3, 0, 0.12, 0.17, 0.05, 0xd8b070, 12);
    L.cyl(F, 0.25, 1.0, 0, 0.12, 0.1, 0.12, 0x3a3a40, 10);
    L.cyl(F, 0, 1.6, -0.2, 0.02, 0.02, 1.4, 0x5a3a20, 4);
    L.cone(F, 0, 2.3, -0.2, 0.6, 0.25, i % 2 ? 0xc0261d : 0xe2b85c, 8);
    const s = f.toWorld(-0.15, 1.35, 0); game.steamEmitters.push(s);
    game.lamps.push({ ...f.toWorld(0, 1.9, 0.2), color: new THREE.Color(1, 0.65, 0.35), intensity: 0.8, range: 2.5 });
    G.box(F, 0, 0.6, 0.28, 0.6, 0.18, 0.01, 0xffd890);
  });

  // background buildings with lit windows
  const bcol = [0x1e1a26, 0x241c22, 0x1a1e28, 0x2a2024];
  for (const sx of [-1, 1]) {
    for (let z = 5; z > -26; z -= 3.6 + r() * 1.5) {
      const w = 3 + r() * 1.2, h = 4.5 + r() * 5, d = 3 + r() * 2, x = sx * (7.3 + d / 2 + r() * 0.5);
      L.box(null, x, h / 2, z, d, h, w, bcol[(r() * 4) | 0]);
      L.box(null, x, h + 0.15, z, d + 0.6, 0.3, w + 0.6, 0x1a2a28);
      for (let fy = 1.5; fy < h - 0.8; fy += 1.3) for (let fz = -w / 2 + 0.6; fz < w / 2 - 0.4; fz += 0.9) {
        if (r() < 0.45) G.box(null, x - sx * (d / 2 + 0.01), fy, z + fz, 0.02, 0.6, 0.45, r() < 0.5 ? 0xffc070 : 0xff9a50);
      }
      if (r() < 0.5) game.lanterns.push({ p: new THREE.Vector3(x - sx * (d / 2 + 0.3), Math.min(h - 0.5, 3.6), z), s: 1.1 });
    }
  }
  for (let x = -12; x < 12; x += 3.5 + r()) {
    const h = 5 + r() * 6;
    L.box(null, x, h / 2, -24 - r() * 2, 3.4, h, 3, bcol[(r() * 4) | 0]);
    for (let fy = 1.5; fy < h - 0.8; fy += 1.3) for (let fx = -1.2; fx < 1.3; fx += 0.9) if (r() < 0.4) G.box(null, x + fx, fy, -22.4 - 0.1, 0.45, 0.6, 0.02, 0xffc070);
    const h2 = 5 + r() * 6, z2 = 7.5 + r() * 2;
    L.box(null, x, h2 / 2, z2, 3.4, h2, 3, bcol[(r() * 4) | 0]);
    for (let fy = 1.5; fy < h2 - 0.8; fy += 1.3) for (let fx = -1.2; fx < 1.3; fx += 0.9) if (r() < 0.45) G.box(null, x + fx, fy, z2 - 1.51, 0.45, 0.6, 0.02, r() < 0.5 ? 0xffc070 : 0xff9a50);
    if (r() < 0.6) game.lanterns.push({ p: new THREE.Vector3(x, 3.4, z2 - 1.8), s: 1.1 });
  }
  // sky dome, stars, moon
  const sky = new THREE.SphereGeometry(90, 24, 12);
  const col = [], p = sky.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 90, c = new THREE.Color(0x1a1530).lerp(new THREE.Color(0x03040c), Math.max(0, y)); if (y < 0.08) c.lerp(new THREE.Color(0x3a1e20), (0.08 - y) * 4); col.push(c.r, c.g, c.b); }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  game.scene.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const sp = [];
  for (let i = 0; i < 400; i++) { const a = r() * Math.PI * 2, e = 0.15 + r() * 1.3; sp.push(Math.cos(a) * Math.cos(e) * 85, Math.sin(e) * 85, Math.sin(a) * Math.cos(e) * 85); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  game.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xdde4ff, size: 1.2, sizeAttenuation: false, fog: false })));
  const mc = document.createElement('canvas'); mc.width = mc.height = 128; const mx = mc.getContext('2d');
  const mg = mx.createRadialGradient(64, 64, 20, 64, 64, 64); mg.addColorStop(0, 'rgba(255,248,225,1)'); mg.addColorStop(0.45, 'rgba(255,240,210,0.95)'); mg.addColorStop(0.5, 'rgba(255,230,200,0.25)'); mg.addColorStop(1, 'rgba(255,220,180,0)');
  mx.fillStyle = mg; mx.fillRect(0, 0, 128, 128);
  const mt = new THREE.CanvasTexture(mc); mt.colorSpace = THREE.SRGBColorSpace;
  const moonS = new THREE.Sprite(new THREE.SpriteMaterial({ map: mt, fog: false, depthWrite: false }));
  moonS.position.set(-30, 40, -55); moonS.scale.setScalar(12); game.scene.add(moonS);
}

function buildGround(game) {
  const g = new THREE.PlaneGeometry(44, 54, 44, 54); g.rotateX(-Math.PI / 2); g.translate(0, 0, -8);
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3).fill(1);
  bake(p.array, n.array, col, game.lamps, { sky: new THREE.Color(0x2c3462), ground: new THREE.Color(0x3a2418) });
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tex = cobbleTexture(); tex.repeat.set(22, 27);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }));
  m.matrixAutoUpdate = false;
  return m;
}

function buildBulbs(game) {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), game.bulbs.length);
  const mat = new THREE.Matrix4(), c = new THREE.Color(), cols = [0xfff0c0, 0xffc060, 0xff6040, 0xffe080, 0x80ffb0];
  game.bulbs.forEach((p, i) => { m.setMatrixAt(i, mat.makeTranslation(p.x, p.y, p.z)); m.setColorAt(i, c.set(cols[i % cols.length]).multiplyScalar(1.6)); });
  game.scene.add(m);
  return m;
}

function buildLanterns(game) {
  const b = new Builder();
  b.sphere(null, 0, 0, 0, 0.17, 0.15, 0.17, 0xff4a28, 12);
  b.cyl(null, 0, 0.15, 0, 0.08, 0.08, 0.04, 0xffc040, 10);
  b.cyl(null, 0, -0.15, 0, 0.08, 0.08, 0.04, 0xffc040, 10);
  b.cyl(null, 0, -0.24, 0, 0.015, 0.005, 0.14, 0xffd060, 5);
  b.cyl(null, 0, 0.3, 0, 0.004, 0.004, 0.26, 0x201008, 3);
  const g = b.geometry();
  g.translate(0, -0.42, 0); // hang from the top of the string
  const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }), game.lanterns.length);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (const l of game.lanterns) { l.ph = Math.random() * 10; l.p.y += 0.42 * l.s; }
  game.scene.add(m);
  swayLanterns(m, game.lanterns, 0);
  return m;
}
const _lm = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _le = new THREE.Euler(), _ls = new THREE.Vector3();
function swayLanterns(mesh, list, t) {
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    _lq.setFromEuler(_le.set(Math.sin(t * 1.1 + l.ph) * 0.06, 0, Math.sin(t * 0.9 + l.ph * 1.3) * 0.08));
    _lm.compose(l.p, _lq, _ls.setScalar(l.s));
    mesh.setMatrixAt(i, _lm);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// Settings / welcome board next to the spawn
function buildSettings(game) {
  const fr = new Frame(2.0, 1.4, -Math.PI / 2), F = fr.m, L = game.lit, data = game.data;
  L.box(F, 0, 0.75, -0.45, 1.4, 1.5, 0.06, 0x3a2016);
  for (const sx of [-1, 1]) L.box(F, sx * 0.72, 1.0, -0.45, 0.08, 2.0, 0.08, 0xa8261c);
  L.box(F, 0, 2.02, -0.45, 1.6, 0.1, 0.2, 0xe2b85c);
  const labels = ['Off', 'Low', 'Med', 'High'];
  const p = new Panel({
    width: 1.3, height: 0.95, px: 1100, draw: (c, W, H, panel) => {
      roundRect(c, 4, 4, W - 8, H - 8, 30); c.fillStyle = 'rgba(20,14,26,0.94)'; c.fill(); c.lineWidth = 6; c.strokeStyle = '#e2b85c'; c.stroke();
      c.fillStyle = '#e2b85c'; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.font = `80px ${FONTS.brush}`; c.fillText('夜市', 40, 100);
      c.fillStyle = '#f1e6cf'; c.font = `600 50px ${FONTS.sans}`; c.fillText('Night Market Toss', 210, 92);
      c.font = `30px ${FONTS.sans}`; c.fillStyle = '#c8bca8';
      const lines = game.ctx.input.desktop
        ? ['Aim at a beanbag, ring, dart or ball: E / RMB grabs it.', 'Hold LMB to wind up, release to throw. WASD to walk.', 'Win tickets, spend them at the Prize Counter (far end).']
        : ['Squeeze grip near a prop to grab it, swing and let go to throw.', 'Pass it hand to hand. Left stick walks, push forward to teleport.', 'Win tickets, spend them at the Prize Counter (far end).'];
      lines.forEach((l, i) => fitText(c, l, 40 + 0, 160 + i * 44, W - 80, 30, FONTS.sans));
      c.fillStyle = '#f1e6cf'; c.font = `600 38px ${FONTS.sans}`; c.fillText('Aim assist', 40, 350);
      labels.forEach((lb, i) => panel.button('assist' + i, 300 + i * 190, 300, 170, 74, lb, () => { data.assist = i; game.grabber.assist = ASSIST_LEVELS[i]; game.persist(); }, { size: 34, active: data.assist === i }));
      c.fillStyle = '#f1e6cf'; c.fillText('Turning', 40, 460);
      panel.button('snap', 300, 410, 260, 74, 'Snap', () => { data.smoothTurn = false; game.persist(); game.setTurn?.(false); }, { size: 34, active: !data.smoothTurn });
      panel.button('smooth', 580, 410, 260, 74, 'Smooth', () => { data.smoothTurn = true; game.persist(); game.setTurn?.(true); }, { size: 34, active: !!data.smoothTurn });
      c.fillStyle = '#ffd060'; c.font = `700 46px ${FONTS.sans}`; c.fillText(`${data.tickets} tickets`, 40, 580);
      c.fillStyle = '#a8a0c0'; c.font = `30px ${FONTS.sans}`; c.fillText(`${data.prizes.length} prize${data.prizes.length === 1 ? '' : 's'} on your shelf (opposite)`, 40, 630);
      c.fillText('Each stall has a Reset button on its post.', 40, 680);
    },
  });
  p.mesh.position.copy(fr.toWorld(0, 1.35, -0.4));
  p.mesh.quaternion.copy(fr.q);
  game.scene.add(p.mesh);
  game.pointer.panels.push(p);
  return p;
}
