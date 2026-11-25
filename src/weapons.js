import * as THREE from 'three';
import { CFG } from './config.js';
import { ARROW_LEN, Projectile } from './projectiles.js';
import { audio } from './audio.js';
import { clamp, damp, makeCanvas, canvasTexture } from './util.js';

// ───────────────────────────────────────────────────────────────
// Bow: a Manchu-style horn bow with recurved "ears".
// Local frame: +Z = arrow direction, +Y = up, string behind the riser at -Z.
// Origin = arrow rest. The hand grips just below it.
// ───────────────────────────────────────────────────────────────

const SKINS = {
  default: { limb: 0x3b2516, belly: 0x2a1a10, ear: 0x1a120c, grip: 0xa31d1d, accent: 0xc9a14a, glow: 0x000000 },
  lacquer: { limb: 0x9e1b14, belly: 0x5e0f0a, ear: 0x1b1010, grip: 0x111111, accent: 0xe0b24e, glow: 0x000000 },
  jade: { limb: 0x4f9a7a, belly: 0x2e6e55, ear: 0xd9e8dd, grip: 0xf0e6d0, accent: 0xd8c27a, glow: 0x0b3a28 },
  dragon: { limb: 0xc99a2e, belly: 0x8a5d12, ear: 0xa81c1c, grip: 0xa81c1c, accent: 0xfff0b0, glow: 0x553300 },
};

function cylinderBetween(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(len, 1e-4), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}

export class Bow {
  constructor() {
    this.group = new THREE.Group();
    this.mats = {
      limb: new THREE.MeshStandardMaterial({ roughness: 0.55, side: THREE.DoubleSide }),
      belly: new THREE.MeshStandardMaterial({ roughness: 0.4, side: THREE.DoubleSide }),
      ear: new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide }),
      grip: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      accent: new THREE.MeshStandardMaterial({ metalness: 0.8, roughness: 0.3 }),
      string: new THREE.MeshBasicMaterial({ color: 0xefe6d2 }),
    };
    const brace = CFG.weapons.bow.braceHeight;
    // Riser + grip (grip centre sits 5 cm below the arrow rest)
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 10), this.mats.grip);
    grip.position.y = -0.05; this.group.add(grip);
    const riser = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25, 0.035), this.mats.limb);
    riser.position.set(0, -0.05, 0.006); this.group.add(riser);
    for (const y of [-0.105, 0.005]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 10), this.mats.accent);
      band.position.y = y; this.group.add(band);
    }
    // Limbs: upper built along a curve; lower is a mirrored copy.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.06, 0.0), new THREE.Vector3(0, 0.22, -0.035), new THREE.Vector3(0, 0.40, -0.095),
      new THREE.Vector3(0, 0.54, -0.15),
    ]);
    const earCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.535, -0.152), new THREE.Vector3(0, 0.60, -0.14), new THREE.Vector3(0, 0.66, -0.08), new THREE.Vector3(0, 0.69, -0.02),
    ]);
    this.flex = [];
    this.anchors = [];
    for (const sign of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.scale.y = sign;
      pivot.position.y = sign > 0 ? 0.005 : -0.105; // lower limb starts below the grip
      const flex = new THREE.Group();
      flex.position.y = 0.06; // hinge at the end of the riser
      const inner = new THREE.Group(); inner.position.y = -0.06;
      const limb = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.012, 6), this.mats.limb);
      limb.scale.x = 1.9; inner.add(limb);
      const belly = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.008, 5), this.mats.belly);
      belly.scale.x = 1.7; belly.position.z = -0.008; inner.add(belly);
      const ear = new THREE.Mesh(new THREE.TubeGeometry(earCurve, 12, 0.01, 6), this.mats.ear);
      ear.scale.x = 1.3; inner.add(ear);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.02), this.mats.accent);
      bridge.position.set(0, 0.545, -0.158); inner.add(bridge);
      const anchor = new THREE.Object3D(); anchor.position.set(0, 0.55, -brace); inner.add(anchor);
      flex.add(inner); pivot.add(flex); this.group.add(pivot);
      this.flex.push(flex); this.anchors.push(anchor);
    }
    // String (two thin cylinders meeting at the nock point)
    const sg = new THREE.CylinderGeometry(0.0015, 0.0015, 1, 4);
    this.str1 = new THREE.Mesh(sg, this.mats.string);
    this.str2 = new THREE.Mesh(sg, this.mats.string);
    this.group.add(this.str1, this.str2);
    // Tassel hanging off the lower ear: a few verlet strands
    this.tassel = this._makeTassel();

    this.nockedArrow = null;
    this.draw = 0;
    this.nockLocal = new THREE.Vector3(0, 0, -brace);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.setSkin('default');
    this.setDraw(0);
  }

  _makeTassel() {
    const mat = new THREE.LineBasicMaterial({ color: 0xc81e1e });
    const strands = [];
    for (let i = 0; i < 5; i++) {
      const pts = Array.from({ length: 6 }, () => new THREE.Vector3());
      const prev = pts.map(p => p.clone());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      strands.push({ pts, prev, geo, line, off: new THREE.Vector3((i - 2) * 0.004, 0, (i % 2) * 0.004) });
    }
    return { strands, root: new THREE.Object3D(), added: false };
  }

  setSkin(name) {
    const s = SKINS[name] ?? SKINS.default;
    this.mats.limb.color.set(s.limb); this.mats.belly.color.set(s.belly); this.mats.ear.color.set(s.ear);
    this.mats.grip.color.set(s.grip); this.mats.accent.color.set(s.accent);
    for (const m of [this.mats.limb, this.mats.ear]) { m.emissive.set(s.glow); }
    this.skin = name;
  }

  setDraw(d) {
    this.draw = d;
    const t = d / CFG.weapons.bow.maxDraw;
    for (const f of this.flex) f.rotation.x = -t * 0.22;
    this.nockLocal.set(0, 0, -CFG.weapons.bow.braceHeight - d);
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) {
      this.anchors[i].getWorldPosition(this._a);
      this.group.worldToLocal(this._a);
      cylinderBetween(i ? this.str2 : this.str1, this._a, this.nockLocal);
    }
    if (this.nockedArrow) {
      this.nockedArrow.position.set(0.0, 0, this.nockLocal.z + ARROW_LEN);
    }
  }

  nock(fire) {
    const p = new Projectile('arrow', { pos: new THREE.Vector3(), vel: new THREE.Vector3(0, 0, 1), fire });
    this.nockedArrow = p.mesh;
    this.nockedArrow.quaternion.identity();
    this.group.add(this.nockedArrow);
    this.setDraw(this.draw);
  }
  unnock() { if (this.nockedArrow) { this.nockedArrow.removeFromParent(); this.nockedArrow = null; } }

  updateTassel(dt, scene) {
    const T = this.tassel;
    if (!T.added) { this.group.add(T.root); T.root.position.set(0, -0.66, -0.05); for (const s of T.strands) scene.add(s.line); T.added = true; }
    const root = T.root.getWorldPosition(this._b);
    const g = -9.8 * dt * dt;
    for (const s of T.strands) {
      s.pts[0].copy(root).add(s.off);
      for (let i = 1; i < s.pts.length; i++) {
        const p = s.pts[i], q = s.prev[i];
        const vx = (p.x - q.x) * 0.96, vy = (p.y - q.y) * 0.96, vz = (p.z - q.z) * 0.96;
        q.copy(p);
        p.x += vx; p.y += vy + g; p.z += vz;
      }
      for (let k = 0; k < 3; k++) for (let i = 1; i < s.pts.length; i++) {
        const a = s.pts[i - 1], b = s.pts[i];
        const d = this._a.subVectors(b, a); const l = d.length() || 1e-5;
        b.copy(a).addScaledVector(d, 0.022 / l);
      }
      if (!isFinite(s.pts[5].x)) for (const p of s.pts) p.copy(root);
      const pa = s.geo.attributes.position;
      for (let i = 0; i < s.pts.length; i++) pa.setXYZ(i, s.pts[i].x, s.pts[i].y, s.pts[i].z);
      pa.needsUpdate = true;
    }
  }
  setVisible(v) { this.group.visible = v; for (const s of this.tassel.strands) s.line.visible = v; }
}

// ───────────────────────────────────────────────────────────────
// Gun models. Barrel points along -Z (matches the controller ray).
// ───────────────────────────────────────────────────────────────
const GM = {
  bronze: new THREE.MeshStandardMaterial({ color: 0x8c6a32, metalness: 0.85, roughness: 0.35 }),
  darkBronze: new THREE.MeshStandardMaterial({ color: 0x4a3a22, metalness: 0.8, roughness: 0.45 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x5a3418, roughness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa81c1c, roughness: 0.65 }),
  bamboo: new THREE.MeshStandardMaterial({ color: 0x9a9a52, roughness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 0.9, roughness: 0.3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x151515, metalness: 0.5, roughness: 0.4 }),
};
function cyl(r1, r2, len, mat, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  return m;
}

function buildPistol() {
  const g = new THREE.Group();
  const barrel = cyl(0.018, 0.022, 0.24, GM.bronze); barrel.position.set(0, 0.03, -0.12); g.add(barrel);
  const flare = cyl(0.03, 0.018, 0.04, GM.bronze); flare.position.set(0, 0.03, -0.25); g.add(flare);
  const chamber = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), GM.bronze); chamber.position.set(0, 0.03, 0.0); chamber.scale.z = 1.3; g.add(chamber);
  for (const z of [-0.06, -0.15]) { const r = cyl(0.025, 0.025, 0.012, GM.darkBronze); r.position.set(0, 0.03, z); g.add(r); }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.04), GM.wood);
  grip.position.set(0, -0.03, 0.03); grip.rotation.x = 0.35; g.add(grip);
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.05, 6), GM.red); tassel.position.set(0, -0.1, 0.06); g.add(tassel);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, -0.28); g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}

function buildLauncher() {
  const g = new THREE.Group();
  const tube = cyl(0.06, 0.06, 0.9, GM.bamboo, 12); tube.position.set(0, 0.07, -0.2); g.add(tube);
  for (const z of [0.15, -0.1, -0.35, -0.6]) { const n = cyl(0.064, 0.064, 0.02, GM.bamboo, 12); n.position.set(0, 0.07, z); g.add(n); }
  const wrap = cyl(0.063, 0.063, 0.22, GM.red, 12); wrap.position.set(0, 0.07, -0.22); g.add(wrap);
  // dragon-head muzzle
  const head = cyl(0.09, 0.065, 0.14, GM.gold, 12); head.position.set(0, 0.07, -0.7); g.add(head);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.12, 5), GM.gold);
    horn.position.set(s * 0.05, 0.17, -0.66); horn.rotation.x = -0.9; horn.rotation.z = s * -0.3; g.add(horn);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    eye.position.set(s * 0.07, 0.11, -0.71); g.add(eye);
  }
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.04), GM.wood); grip.position.set(0, -0.02, 0.0); grip.rotation.x = 0.25; g.add(grip);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.07, -0.8); g.add(muzzle);
  g.userData.muzzle = muzzle;
  // Ammo pips showing loaded rockets
  return g;
}

function buildSniper(scopeTexture) {
  const g = new THREE.Group();
  const barrel = cyl(0.011, 0.014, 0.95, GM.black); barrel.position.set(0, 0.045, -0.5); g.add(barrel);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.55), GM.wood); stock.position.set(0, 0.02, -0.05); g.add(stock);
  const butt = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.12, 0.2), GM.wood); butt.position.set(0, -0.01, 0.3); g.add(butt);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.04), GM.wood); grip.position.set(0, -0.04, 0.03); grip.rotation.x = 0.3; g.add(grip);
  for (const z of [-0.3, -0.7]) { const band = cyl(0.016, 0.016, 0.02, GM.gold); band.position.set(0, 0.045, z); g.add(band); }
  const brake = cyl(0.02, 0.02, 0.06, GM.gold); brake.position.set(0, 0.045, -0.99); g.add(brake);
  // Scope: lens on the back shows a magnified render.
  const scope = new THREE.Group(); scope.position.set(0, 0.11, -0.12); g.add(scope);
  const tube = cyl(0.022, 0.022, 0.3, GM.bronze, 14); scope.add(tube);
  const bell = cyl(0.032, 0.022, 0.08, GM.bronze, 14); bell.position.z = -0.18; scope.add(bell);
  const eyeBell = cyl(0.026, 0.022, 0.05, GM.bronze, 14); eyeBell.position.z = 0.16; scope.add(eyeBell);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), new THREE.MeshBasicMaterial({ map: scopeTexture, toneMapped: false }));
  lens.position.z = 0.186; scope.add(lens);
  const reticle = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), new THREE.MeshBasicMaterial({ map: makeReticle(), transparent: true, depthWrite: false, toneMapped: false }));
  reticle.position.z = 0.187; scope.add(reticle);
  // Charge ring: 24 pips around the eyepiece
  const pips = [];
  const pipGeo = new THREE.BoxGeometry(0.004, 0.004, 0.002);
  for (let i = 0; i < 24; i++) {
    const a = Math.PI / 2 - i / 24 * Math.PI * 2;
    const p = new THREE.Mesh(pipGeo, new THREE.MeshBasicMaterial({ color: 0x553311 }));
    p.position.set(Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.188); scope.add(p); pips.push(p);
  }
  const scopeCamAnchor = new THREE.Object3D(); scopeCamAnchor.position.z = -0.22; scope.add(scopeCamAnchor);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.045, -1.03); g.add(muzzle);
  g.userData = { muzzle, pips, scopeCamAnchor, lens };
  return g;
}

function makeReticle() {
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  const grd = x.createRadialGradient(128, 128, 90, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.95)');
  x.fillStyle = grd; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(20,10,5,0.95)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, 128); x.lineTo(110, 128); x.moveTo(146, 128); x.lineTo(256, 128); x.moveTo(128, 0); x.lineTo(128, 110); x.moveTo(128, 146); x.lineTo(128, 256); x.stroke();
  x.lineWidth = 1; x.beginPath(); x.moveTo(118, 128); x.lineTo(138, 128); x.moveTo(128, 118); x.lineTo(128, 138); x.stroke();
  // drop marks
  x.fillStyle = 'rgba(200,30,20,0.95)';
  for (let i = 1; i <= 4; i++) x.fillRect(122, 128 + i * 16, 12, 1.5);
  x.beginPath(); x.arc(128, 128, 2, 0, Math.PI * 2); x.fill();
  return canvasTexture(c);
}

function buildGlove() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 0.8 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.09), mat); g.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.022, 0.06), mat);
    f.position.set(-0.027 + i * 0.018, -0.012, -0.065); f.rotation.x = 0.6; g.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.02, 0.05), mat); thumb.position.set(0.045, 0, -0.02); thumb.rotation.y = -0.6; g.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0xa81c1c, roughness: 0.7 }));
  cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.07; g.add(cuff);
  // thumb ring (扳指), the archer's jade ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.004, 6, 12), new THREE.MeshStandardMaterial({ color: 0x5fae8a, roughness: 0.2 }));
  ring.position.set(0.05, 0.004, -0.035); ring.rotation.y = -0.6; g.add(ring);
  return g;
}

// ───────────────────────────────────────────────────────────────
// WeaponSystem: turns hand input into shots.
// hands: { main, off } with { present, gripPos, gripQuat, rayPos, rayQuat,
//   trigger, squeeze, triggerDown, triggerUp, haptic(i, ms) }
// ───────────────────────────────────────────────────────────────
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class WeaponSystem {
  constructor(scene, game, renderer) {
    this.scene = scene; this.game = game; this.renderer = renderer;
    this.current = 'bow';
    this.bow = new Bow();
    scene.add(this.bow.group);
    this.bowState = 'idle';
    this.lastHapticDraw = 0;
    this.bowAim = new THREE.Vector3(0, 0, -1);
    this.fullDrawTime = 0;

    // Scope render target
    const res = CFG.scopeResolution;
    this.scopeRT = new THREE.WebGLRenderTarget(res, res, { samples: 0 });
    this.scopeRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.scopeCam = new THREE.PerspectiveCamera(CFG.weapons.sniper.scopeFov, 1, 0.1, 2000);

    this.models = {
      pistol: buildPistol(),
      rocket: buildLauncher(),
      sniper: buildSniper(this.scopeRT.texture),
    };
    for (const m of Object.values(this.models)) { m.visible = false; scene.add(m); }
    this.gloves = { main: buildGlove(), off: buildGlove() };
    scene.add(this.gloves.main, this.gloves.off);

    this.cooldown = 0;
    this.charge = 0;
    this.charging = false;
    this.chargeReadyPlayed = false;
    this.lastChargeTick = 0;
    this.nockHighlight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.5, depthWrite: false }));
    scene.add(this.nockHighlight);
    this.desktopZoom = false;
  }

  select(id) {
    if (id === this.current) return;
    if (this.bowState === 'drawing') this._cancelDraw();
    this.charging = false; this.charge = 0;
    this.current = id;
    audio.weaponSwap();
    this.game.onWeaponChanged(id);
  }
  cycle(dir = 1) {
    const order = CFG.weaponOrder;
    const i = order.indexOf(this.current);
    this.select(order[(i + dir + order.length) % order.length]);
  }

  isBusy() { return this.bowState === 'drawing' || this.charging; }

  update(dt, hands, head, opts = {}) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const { main, off } = hands;
    const isBow = this.current === 'bow';
    this.bow.setVisible(isBow && off.present);
    for (const [id, m] of Object.entries(this.models)) m.visible = id === this.current && main.present && !(id === 'sniper' && this.desktopZoom);

    // Gloves follow grips (hidden on desktop where hands aren't tracked)
    this._placeGlove(this.gloves.main, main, opts.desktop);
    this._placeGlove(this.gloves.off, off, opts.desktop || isBow);
    this.nockHighlight.visible = false;

    if (isBow) this._updateBow(dt, main, off, head, opts);
    else if (main.present) this._updateGun(dt, main, opts);
  }

  _placeGlove(g, hand, hide) {
    g.visible = hand.present && !hide;
    if (!g.visible) return;
    g.position.copy(hand.gripPos); g.quaternion.copy(hand.gripQuat);
  }

  // ── Bow ─────────────────────────────────────────────────────
  _updateBow(dt, main, off, head, opts) {
    if (!off.present) return;
    const B = CFG.weapons.bow;
    const bow = this.bow;
    // Fist axis = grip -Z
    const fist = _v.set(0, 0, -1).applyQuaternion(off.gripQuat).normalize();
    let aim;
    if (this.bowState === 'drawing') {
      aim = _v2.subVectors(off.gripPos, main.gripPos);
      const dist = aim.length();
      aim.divideScalar(dist || 1);
      const draw = clamp(dist - B.braceHeight, 0, B.maxDraw);
      // haptic "creak" every 2.5 cm of draw
      if (Math.abs(draw - this.lastHapticDraw) > 0.025) {
        this.lastHapticDraw = draw;
        main.haptic(0.12 + 0.5 * draw / B.maxDraw, 12);
        off.haptic(0.05 + 0.25 * draw / B.maxDraw, 10);
      }
      if (draw >= B.maxDraw * 0.98) {
        this.fullDrawTime += dt;
        if (Math.random() < 0.2) off.haptic(0.06, 8); // strain tremble
        if (this.game.has('focus') && this.fullDrawTime > 0.25) this.game.requestSlowmo();
      } else this.fullDrawTime = 0;
      bow.setDraw(draw);
      this.bowAim.copy(aim);
    } else {
      // Idle: aim roughly away from the head, perpendicular to the fist axis.
      aim = _v2.subVectors(off.gripPos, head.pos); aim.y *= 0.3;
      if (opts.desktop) aim.copy(opts.desktopAim);
      aim.addScaledVector(fist, -aim.dot(fist)).normalize();
      this.bowAim.lerp(aim, 1 - Math.exp(-40 * dt)).normalize();
      aim = this.bowAim;
      if (bow.draw > 0) bow.setDraw(damp(bow.draw, 0, 30, dt) < 0.002 ? 0 : damp(bow.draw, 0, 30, dt));
    }
    // Build bow orientation: z = aim, y = fist axis orthogonalised
    const up = _v3.copy(fist).addScaledVector(aim, -fist.dot(aim));
    if (up.lengthSq() < 1e-4) up.copy(UP);
    up.normalize();
    const x = new THREE.Vector3().crossVectors(up, aim).normalize();
    _m.makeBasis(x, up, aim);
    bow.group.quaternion.setFromRotationMatrix(_m);
    bow.group.position.copy(off.gripPos).addScaledVector(up, 0.05);
    bow.group.updateMatrixWorld(true);
    bow.setDraw(bow.draw);
    bow.updateTassel(Math.min(dt, 1 / 30), this.scene);

    if (!main.present) return;
    const nockWorld = bow.group.localToWorld(new THREE.Vector3(0, 0, -B.braceHeight));
    const near = main.gripPos.distanceTo(nockWorld) < 0.2;
    const pressed = main.triggerDown || main.squeezeDown;
    if (this.bowState === 'idle') {
      if (near && !opts.uiHover) {
        this.nockHighlight.visible = true; this.nockHighlight.position.copy(nockWorld);
        this.nockHighlight.material.opacity = 0.35 + Math.sin(performance.now() / 120) * 0.15;
      }
      if (pressed && (near || opts.desktop) && !opts.uiHover) {
        if (this.game.ammo.bow <= 0) { audio.dryFire(); this.game.toastAmmo('bow'); main.haptic(0.3, 30); this.select('pistol'); return; }
        bow.nock(this.game.has('fireTips'));
        this.bowState = 'drawing';
        this.lastHapticDraw = 0;
        main.haptic(0.4, 20);
      }
    } else if (this.bowState === 'drawing') {
      const held = main.trigger > 0.3 || main.squeeze > 0.3;
      if (!held) {
        if (bow.draw > 0.08) this._releaseArrow(main, off);
        else this._cancelDraw();
      }
    }
  }

  _cancelDraw() { this.bow.unnock(); this.bowState = 'idle'; this.bow.setDraw(0); }

  _releaseArrow(main, off) {
    const B = CFG.weapons.bow, bow = this.bow;
    const t = bow.draw / B.maxDraw;
    const speed = B.minSpeed + (B.maxSpeed - B.minSpeed) * Math.pow(t, 0.9);
    const tip = bow.nockedArrow.getWorldPosition(new THREE.Vector3());
    const dir = this.bowAim.clone();
    bow.unnock();
    this.bowState = 'idle';
    this.game.spendAmmo('bow');
    this.game.spawnProjectile(new Projectile('arrow', { pos: tip, vel: dir.multiplyScalar(speed), fire: this.game.has('fireTips') }));
    audio.bowTwang(t, tip);
    main.haptic(0.9, 40); off.haptic(1.0, 70);
    bow.setDraw(0);
    this.fullDrawTime = 0;
  }

  // ── Guns ────────────────────────────────────────────────────
  _updateGun(dt, main, opts) {
    const model = this.models[this.current];
    model.position.copy(main.rayPos); model.quaternion.copy(main.rayQuat);
    model.updateMatrixWorld(true);
    const id = this.current;
    const W = CFG.weapons[id];
    const muzzle = model.userData.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(main.rayQuat);
    if (opts.desktop) dir.subVectors(opts.desktopAimPoint, muzzle).normalize();

    if (id === 'sniper') {
      const S = CFG.weapons.sniper;
      if (main.triggerDown && !opts.uiHover && this.cooldown <= 0) {
        if (this.game.ammo.sniper <= 0) { audio.dryFire(); this.game.toastAmmo('sniper'); this.select('pistol'); }
        else { this.charging = true; this.charge = 0; this.chargeReadyPlayed = false; }
      }
      if (this.charging) {
        this.charge = Math.min(1, this.charge + dt / S.chargeTime);
        if (this.charge < 1 && performance.now() - this.lastChargeTick > 90) { audio.sniperCharge(this.charge); this.lastChargeTick = performance.now(); main.haptic(0.05 + this.charge * 0.2, 10); }
        if (this.charge >= 1 && !this.chargeReadyPlayed) { audio.sniperReady(); this.chargeReadyPlayed = true; main.haptic(0.5, 40); }
        if (this.charge >= 1 && this.game.has('focus')) this.game.requestSlowmo();
        if (main.trigger < 0.3) {
          if (this.charge >= 1) {
            this.game.spendAmmo('sniper');
            this.game.spawnProjectile(new Projectile('sniper', { pos: muzzle, vel: dir.clone().multiplyScalar(S.muzzleSpeed) }));
            this.game.fx.muzzle(muzzle, dir, true);
            audio.sniperShot(muzzle);
            main.haptic(1, 120);
            this.cooldown = S.cooldown;
            this.game.kick(0.04);
          }
          this.charging = false; this.charge = 0;
        }
      }
      // charge pips
      const pips = model.userData.pips;
      const lit = Math.floor(this.charge * pips.length);
      for (let i = 0; i < pips.length; i++) pips[i].material.color.setHex(i < lit ? (this.charge >= 1 ? 0xff3a20 : 0xffc040) : 0x332211);
      return;
    }

    if (main.triggerDown && !opts.uiHover && this.cooldown <= 0) {
      if (id === 'pistol') {
        this.game.spawnProjectile(new Projectile('pistol', { pos: muzzle, vel: dir.clone().multiplyScalar(W.muzzleSpeed) }));
        this.game.fx.muzzle(muzzle, dir, false);
        audio.pistolShot(muzzle);
        main.haptic(0.7, 50);
        this.cooldown = W.cooldown;
      } else if (id === 'rocket') {
        if (this.game.ammo.rocket <= 0) { audio.dryFire(); this.game.toastAmmo('rocket'); this.select('pistol'); return; }
        this.game.spendAmmo('rocket');
        this.game.spawnProjectile(new Projectile('rocket', { pos: muzzle, vel: dir.clone().multiplyScalar(W.launchSpeed) }));
        this.game.fx.muzzle(muzzle, dir, true);
        audio.rocketLaunch(muzzle);
        main.haptic(1, 160);
        this.cooldown = W.cooldown;
      }
    }
  }

  // Render the scope view (call before the main render each frame).
  renderScope(renderer, scene) {
    if (this.current !== 'sniper' || !this.models.sniper.visible) return;
    const anchor = this.models.sniper.userData.scopeCamAnchor;
    anchor.getWorldPosition(this.scopeCam.position);
    anchor.getWorldQuaternion(this.scopeCam.quaternion);
    this.scopeCam.updateMatrixWorld(true);
    const xrOn = renderer.xr.enabled;
    const prevRT = renderer.getRenderTarget();
    renderer.xr.enabled = false;
    // Hide the rifle itself so we don't see the inside of the scope.
    this.models.sniper.visible = false;
    renderer.setRenderTarget(this.scopeRT);
    renderer.render(scene, this.scopeCam);
    renderer.setRenderTarget(prevRT);
    this.models.sniper.visible = true;
    renderer.xr.enabled = xrOn;
  }
}
