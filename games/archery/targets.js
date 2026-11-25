import * as THREE from 'three';
import { Collider } from './physics.js';
import { audio } from './audio.js';
import { CFG } from './config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeCanvas, canvasTexture, rand, pick, FONT_BRUSH, FONT_SERIF } from './util.js';

// Every target answers hits with { response, points, label, sub, coins, color }.
// response: 'stick' | 'pass' | 'bounce' | 'die'

const _v = new THREE.Vector3();
const fontRedraws = [];
export function redrawTargetTextures() { for (const f of fontRedraws) f(); }
export function resetTargetTextures() { fontRedraws.length = 0; _lanternCache = null; }

function charTexture(draw, w = 256, h = 256) {
  const c = makeCanvas(w, h);
  const tex = canvasTexture(c);
  const run = () => { const x = c.getContext('2d'); x.clearRect(0, 0, w, h); draw(x, w, h); tex.needsUpdate = true; };
  run(); fontRedraws.push(run);
  return tex;
}

export class Target {
  constructor(game, kind) {
    this.game = game; this.kind = kind;
    this.group = new THREE.Group();
    this.colliders = [];
    this.alive = true;
    this.active = true;
    this.respawnAt = 0;
    game.scene.add(this.group);
  }
  addCollider(obj, shape, params, material, opts = {}) {
    const c = new Collider(obj, shape, params, { material, owner: this, ...opts });
    this.colliders.push(c); this.game.physics.add(c);
    return c;
  }
  setActive(v) {
    this.active = v; this.group.visible = v;
    for (const c of this.colliders) c.enabled = v;
    if (!v) this.game.dropStuckOn(this);
  }
  worldPos(v = new THREE.Vector3()) { return this.group.getWorldPosition(v); }
  distance() { return this.worldPos(_v).distanceTo(this.game.playerPos); }
  onHit() { return { response: 'stick' }; }
  onBlast(info) { return this.onHit({ point: info.point, collider: info.collider, blast: true, normal: new THREE.Vector3(0, 1, 0), material: info.collider.material }, null); }
  update() { }
  destroy() {
    this.alive = false;
    for (const c of this.colliders) this.game.physics.remove(c);
    this.game.dropStuckOn(this);
    this.group.removeFromParent();
  }
}

// ── 箭靶: ring target with a straw boss ───────────────────────
export class RingTarget extends Target {
  constructor(game, pos, radius = 0.6, opts = {}) {
    super(game, 'ring');
    this.radius = radius;
    this.base = pos.clone();
    this.slide = opts.slide ?? null;
    this.group.position.copy(pos);
    const face = new THREE.Group(); face.position.y = 0; this.group.add(face); this.face = face;
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, 0.32, 24), new THREE.MeshLambertMaterial({ color: 0xc8a660 }));
    straw.rotation.x = Math.PI / 2; face.add(straw);
    const tex = charTexture((x, w) => {
      const cx = w / 2, rings = ['#f4efe2', '#f4efe2', '#1f1f1f', '#1f1f1f', '#2a5c9a', '#2a5c9a', '#c0261d', '#c0261d', '#e8b43a', '#e8b43a'];
      for (let i = 0; i < 10; i++) {
        x.beginPath(); x.arc(cx, cx, cx * (1 - i / 10), 0, Math.PI * 2);
        x.fillStyle = rings[i]; x.fill();
        x.strokeStyle = i < 2 ? '#555' : '#d8d0c0'; x.lineWidth = 1.5; x.stroke();
      }
      x.fillStyle = '#8a1410'; x.font = `${w * 0.13}px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('中', cx, cx + w * 0.008);
    }, 512, 512);
    const front = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), new THREE.MeshLambertMaterial({ map: tex }));
    front.position.z = 0.161; face.add(front);
    const rope = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.05, 0.02, 5, 32), new THREE.MeshLambertMaterial({ color: 0x8a6a3a }));
    rope.position.z = 0.1; face.add(rope);
    // A-frame stand
    // A-frame stand merged into one mesh
    const legH = pos.y + radius * 0.6;
    const parts = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const s of [-1, 1]) {
      e.set(-0.12, 0, s * 0.12); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(s * radius * 0.7, -pos.y + legH / 2 - 0.1, -0.25), q, new THREE.Vector3(1, 1, 1));
      parts.push(new THREE.BoxGeometry(0.08, legH + 0.3, 0.08).applyMatrix4(m4));
    }
    e.set(0.35, 0, 0); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(0, -pos.y + legH / 2, -0.6), q, new THREE.Vector3(1, 1, 1));
    parts.push(new THREE.BoxGeometry(0.08, legH, 0.08).applyMatrix4(m4));
    this.group.add(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshLambertMaterial({ color: 0x5a3a20 })));
    this.addCollider(face, 'disk', { r: radius * 1.05, h: 0.16 }, 'straw');
  }
  update(dt, t) {
    if (this.slide && this.game.roundActive) {
      this.group.position.x = this.base.x + Math.sin(t * this.slide.speed) * this.slide.amp;
    } else this.group.position.x += (this.base.x - this.group.position.x) * Math.min(1, dt * 2);
  }
  onHit(hit, proj) {
    if (hit.blast) return { response: 'die', points: 10, label: '轰!', sub: 'Blast' };
    const local = this.face.worldToLocal(hit.point.clone());
    const rr = Math.hypot(local.x, local.y) / this.radius;
    const ring = Math.max(1, 10 - Math.floor(rr * 10));
    audio.impact('straw', hit.point);
    this.game.fx.dust(hit.point, 0xd8c08a, 8);
    if (ring === 10 && rr < 0.05) {
      audio.bullseye(hit.point);
      return { response: 'stick', points: 25, label: '正中靶心!', sub: 'zhèng zhòng bǎxīn · dead centre', coins: 5, color: '#ffd560', ring };
    }
    return { response: 'stick', points: ring, label: ring >= 9 ? `${ring} 中!` : `${ring}`, sub: ring >= 9 ? 'zhòng · hit!' : '', color: ring >= 9 ? '#ffd560' : '#ffffff', ring };
  }
}

// ── 灯笼: hanging red lantern on a rope ────────────────────────
// One merged, vertex-coloured mesh for body + caps + tassel, plus one glyph plane:
// 2 draw calls per lantern instead of 7. Geometry, material and glyphs are shared.
let _lanternCache = null;
function lanternParts() {
  if (_lanternCache) return _lanternCache;
  const paint = (geo, hex) => {
    geo = geo.index ? geo : geo;
    const c = new THREE.Color(hex), n = geo.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI; pts.push(new THREE.Vector2(Math.cos(a) * 0.3 + 0.02, Math.sin(a) * 0.34)); }
  const parts = [paint(new THREE.LatheGeometry(pts, 14), 0xe0301c)];
  for (const y of [0.34, -0.34]) parts.push(paint(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 12).translate(0, y, 0), 0xf0c050));
  parts.push(paint(new THREE.ConeGeometry(0.06, 0.3, 8).rotateX(Math.PI).translate(0, -0.52, 0), 0xf0c040));
  const geo = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0xff3a10, emissiveIntensity: 0.55 });
  const glyphs = ['福', '喜', '春', '吉', '寿'].map(ch => charTexture((x, w) => { x.fillStyle = '#ffd36a'; x.font = `${w * 0.6}px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, w / 2, w / 2 + 6); }, 128, 128));
  const glyphMats = glyphs.map(t => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  const glyphGeo = new THREE.PlaneGeometry(0.28, 0.28);
  return (_lanternCache = { geo, mat, glyphMats, glyphGeo });
}
function lanternMesh(scale = 1) {
  const P = lanternParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(P.geo, P.mat));
  const p = new THREE.Mesh(P.glyphGeo, pick(P.glyphMats)); p.position.z = 0.325; g.add(p);
  g.scale.setScalar(scale);
  return g;
}

export class HangingLantern extends Target {
  constructor(game, anchor, ropeLen = 1.2) {
    super(game, 'lantern');
    this.group.position.copy(anchor);
    this.pivot = new THREE.Group(); this.group.add(this.pivot);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, ropeLen, 4), new THREE.MeshLambertMaterial({ color: 0x3a2a1a }));
    rope.position.y = -ropeLen / 2; this.pivot.add(rope);
    this.lantern = lanternMesh(1); this.lantern.position.y = -ropeLen - 0.34; this.pivot.add(this.lantern);
    this.ax = rand(-0.1, 0.1); this.az = rand(-0.1, 0.1); this.vx = 0; this.vz = 0; this.len = ropeLen + 0.34;
    this.addCollider(this.lantern, 'sphere', { r: 0.34 }, 'paper');
  }
  update(dt, t) {
    if (!this.active) { if (t > this.respawnAt) { this.setActive(true); this.lantern.scale.setScalar(0.01); } return; }
    if (this.lantern.scale.x < 1) this.lantern.scale.setScalar(Math.min(1, this.lantern.scale.x + dt * 2));
    const w = this.game.wind;
    const g = 9.8 / this.len;
    this.vx += (-g * Math.sin(this.ax) + w.z * 0.04 + Math.sin(t * 1.3 + this.group.position.x) * 0.02) * dt;
    this.vz += (-g * Math.sin(this.az) - w.x * 0.04) * dt;
    this.vx *= Math.exp(-0.4 * dt); this.vz *= Math.exp(-0.4 * dt);
    this.ax += this.vx * dt; this.az += this.vz * dt;
    this.pivot.rotation.set(this.ax, 0, this.az);
  }
  onHit(hit) {
    const p = this.lantern.getWorldPosition(new THREE.Vector3());
    this.game.fx.paper(p);
    audio.lanternPop(p);
    this.setActive(false);
    this.respawnAt = this.game.time + rand(4, 7);
    return { response: hit.blast ? 'die' : 'pass', points: 15, label: '灯笼!', sub: 'dēnglong · lantern', color: '#ff8a5a' };
  }
}

// ── 孔明灯: sky lantern drifting upward ────────────────────────
export class SkyLantern extends Target {
  constructor(game, pos) {
    super(game, 'skylantern');
    this.group.position.copy(pos);
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.9, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0xf5d6a0, emissive: 0xff9a40, emissiveIntensity: 1.1, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
    this.group.add(paper);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.42, 10), paper.material); top.rotation.x = -Math.PI / 2; top.position.y = 0.45; this.group.add(top);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffe0a0 })); flame.position.y = -0.4; this.group.add(flame);
    this.vy = rand(0.9, 1.6);
    this.phase = rand(0, 6);
    this.addCollider(this.group, 'sphere', { r: 0.5 }, 'paper');
  }
  update(dt, t) {
    const p = this.group.position;
    p.y += this.vy * dt;
    p.x += (this.game.wind.x * 0.25 + Math.sin(t * 0.6 + this.phase) * 0.15) * dt;
    p.z += this.game.wind.z * 0.25 * dt;
    this.group.rotation.y += dt * 0.2;
    if (Math.random() < 0.3) this.game.fx.glow.emit({ pos: _v.copy(p).add(new THREE.Vector3(0, -0.4, 0)), count: 1, color: 0xffa040, speed: 0.3, life: 0.4, size: 0.12, sizeEnd: 0.02, gravity: 1 });
    if (p.y > 70) this.destroy();
  }
  onHit(hit) {
    const p = this.group.position.clone();
    this.game.fx.paper(p, 40);
    this.game.fx.sparks(p, 0xffb050, 30, 5);
    audio.lanternPop(p);
    this.destroy();
    const h = Math.round(p.y);
    return { response: hit.blast ? 'die' : 'pass', points: 25 + Math.floor(h / 2), label: '孔明灯!', sub: `kǒngmíng dēng · sky lantern at ${h} m`, color: '#ffc070' };
  }
}

// ── 锣: the gong. Shoot it to start a round. ──────────────────
export class Gong extends Target {
  constructor(game, pos) {
    super(game, 'gong');
    this.group.position.copy(pos);
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a1a14, roughness: 0.6 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), wood); p.position.set(s * 1.0, 1.4, 0); this.group.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.14, 0.14), wood); bar.position.y = 2.75; this.group.add(bar);
    for (const s of [-1, 1]) { const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 4), new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 0.8, roughness: 0.3 })); cap.position.set(s * 1.25, 2.75, 0); cap.rotation.z = -s * Math.PI / 2; this.group.add(cap); }
    this.swing = new THREE.Group(); this.swing.position.y = 2.68; this.group.add(this.swing);
    const disc = new THREE.Group(); disc.position.y = -1.0; this.swing.add(disc); this.disc = disc;
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3 }));
    plate.rotation.x = Math.PI / 2; disc.add(plate);
    this.labelTex = charTexture((x, w) => {
      const r = this._label ?? ['开始', 'kāishǐ · START'];
      const grd = x.createRadialGradient(w / 2, w / 2, w * 0.05, w / 2, w / 2, w / 2);
      grd.addColorStop(0, '#e6c06a'); grd.addColorStop(0.6, '#b08a3a'); grd.addColorStop(0.62, '#7a5a20'); grd.addColorStop(0.7, '#b08a3a'); grd.addColorStop(1, '#6a4a18');
      x.fillStyle = grd; x.beginPath(); x.arc(w / 2, w / 2, w / 2, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#7a1510'; x.font = `${w * 0.26}px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(r[0], w / 2, w * 0.46);
      x.font = `${w * 0.06}px ${FONT_SERIF}`; x.fillText(r[1], w / 2, w * 0.7);
    }, 512, 512);
    this._redraw = fontRedraws[fontRedraws.length - 1];
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.72, 32), new THREE.MeshStandardMaterial({ map: this.labelTex, metalness: 0.6, roughness: 0.35 }));
    face.position.z = 0.027; disc.add(face);
    for (const s of [-1, 1]) { const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.4, 4), new THREE.MeshLambertMaterial({ color: 0xc81e1e })); cord.position.set(s * 0.3, -0.25, 0); cord.rotation.z = s * 0.6; this.swing.add(cord); }
    this.ang = 0; this.vel = 0;
    this.addCollider(disc, 'disk', { r: 0.72, h: 0.04 }, 'metal');
  }
  setLabel(cn, sub) { this._label = [cn, sub]; this._redraw(); }
  update(dt) {
    this.vel += -9.8 / 1.0 * Math.sin(this.ang) * dt; this.vel *= Math.exp(-0.6 * dt);
    this.ang += this.vel * dt; this.swing.rotation.x = this.ang;
    this.disc.rotation.z = Math.sin(performance.now() / 70) * 0.01 * Math.min(1, Math.abs(this.vel));
  }
  onHit(hit, proj) {
    audio.gong(hit.point);
    this.vel -= 2.2;
    this.game.fx.sparks(hit.point, 0xffe090, 20, 3);
    this.game.onGong();
    return { response: hit.blast ? 'die' : 'bounce', points: this.game.roundActive ? 5 : 0, label: '咚!', sub: 'dōng', color: '#ffe090', noCombo: !this.game.roundActive };
  }
}

// ── 青花瓷: blue-and-white porcelain vase on a pedestal ───────
let _vaseTex = null;
function vaseTexture() {
  if (_vaseTex) return _vaseTex;
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#f4f6fa'; x.fillRect(0, 0, 256, 256);
  x.strokeStyle = '#1f3f8f'; x.fillStyle = '#1f3f8f';
  x.lineWidth = 6; for (const y of [18, 34, 222, 238]) { x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); }
  x.lineWidth = 3;
  for (let i = 0; i < 8; i++) { // scroll clouds / lotus petals
    const cx = i * 32 + 16;
    x.beginPath(); x.arc(cx, 205, 12, Math.PI, 0); x.stroke();
    x.beginPath(); x.moveTo(cx, 60); x.bezierCurveTo(cx - 20, 90, cx + 20, 120, cx, 150); x.stroke();
    x.beginPath(); x.arc(cx + 8, 100, 9, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.arc(cx - 6, 135, 6, 0, Math.PI * 2); x.fill();
  }
  return (_vaseTex = canvasTexture(c));
}
export class Vase extends Target {
  constructor(game, pos) {
    super(game, 'vase');
    this.group.position.copy(pos);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.0, 8), new THREE.MeshLambertMaterial({ color: 0x4a2c1a }));
    ped.position.y = 0.5; this.group.add(ped);
    const pts = [[0.1, 0], [0.2, 0.08], [0.26, 0.3], [0.22, 0.5], [0.09, 0.62], [0.08, 0.72], [0.12, 0.78]].map(([r, y]) => new THREE.Vector2(r, y));
    this.vase = new THREE.Mesh(new THREE.LatheGeometry(pts, 16), new THREE.MeshStandardMaterial({ map: vaseTexture(), roughness: 0.15, metalness: 0.05 }));
    this.vase.position.y = 1.0; this.group.add(this.vase);
    this.addCollider(this.vase, 'sphere', { r: 0.27, offset: new THREE.Vector3(0, 0.35, 0) }, 'porcelain');
  }
  update(dt, t) {
    if (!this.active && t > this.respawnAt) { this.setActive(true); this.vase.scale.setScalar(0.01); }
    if (this.vase.scale.x < 1) this.vase.scale.setScalar(Math.min(1, this.vase.scale.x + dt * 1.5));
  }
  onHit(hit) {
    const p = this.vase.localToWorld(new THREE.Vector3(0, 0.35, 0));
    this.game.fx.shards(p);
    audio.shatter(p);
    this.setActive(false);
    this.vase.scale.setScalar(0.001);
    this.respawnAt = this.game.time + rand(5, 8);
    return { response: hit.blast ? 'die' : 'pass', points: 20, label: '碎!', sub: 'suì · shattered', color: '#9cc0ff' };
  }
  setActive(v) { this.active = v; for (const c of this.colliders) c.enabled = v; if (!v) this.game.dropStuckOn(this); }
}

// ── 铜钱: a giant cash coin. Thread the square hole. ──────────
export class Coin extends Target {
  constructor(game, pos) {
    super(game, 'coin');
    this.group.position.copy(pos);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 3, 4), new THREE.MeshLambertMaterial({ color: 0xc81e1e }));
    string.position.y = 1.5 + 0.7; this.group.add(string);
    this.spin = new THREE.Group(); this.group.add(this.spin);
    const R = 0.7, H = 0.16;
    this.hole = H;
    const shape = new THREE.Shape(); shape.absarc(0, 0, R, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.moveTo(-H, -H); hole.lineTo(H, -H); hole.lineTo(H, H); hole.lineTo(-H, H); hole.lineTo(-H, -H);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1, curveSegments: 32 });
    geo.translate(0, 0, -0.03);
    const tex = charTexture((x, w) => {
      x.fillStyle = '#b07a32'; x.fillRect(0, 0, w, w);
      x.fillStyle = '#5a3a12'; x.font = `${w * 0.17}px ${FONT_SERIF}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      const c = w / 2, d = w * 0.3;
      x.fillText('乾', c, c - d); x.fillText('隆', c, c + d); x.fillText('通', c + d, c); x.fillText('宝', c - d, c);
    }, 256, 256);
    // ExtrudeGeometry UVs are in shape units; remap to 0..1 over the face.
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * R) + 0.5, uv.getY(i) / (2 * R) + 0.5);
    const coin = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, metalness: 0.75, roughness: 0.35, color: 0xffe0b0 }));
    this.spin.add(coin);
    this.addCollider(this.spin, 'disk', { r: R, h: 0.05 }, 'metal', { passFilter: (p) => Math.abs(p.x) < H * 0.92 && Math.abs(p.y) < H * 0.92 });
    this.cool = 0;
  }
  update(dt, t) { this.spin.rotation.y = Math.sin(t * 0.35) * 0.9; this.cool -= dt; }
  onPass(proj) {
    if (this.cool > 0) return null;
    this.cool = 0.5;
    const p = this.spin.getWorldPosition(new THREE.Vector3());
    this.game.fx.coinBurst(p); this.game.fx.firework(p.clone().add(new THREE.Vector3(0, 3, 0)), [0xffd56a, 0xfff3c0]);
    audio.bullseye(p); for (let i = 0; i < 8; i++) audio.coin(i * 0.05);
    return { points: 300, label: '钱眼穿心!', sub: 'Through the square hole!', coins: 25, color: '#ffd56a' };
  }
  onHit(hit) {
    audio.impact('metal', hit.point);
    this.game.fx.sparks(hit.point, 0xffd080, 12, 3);
    return { response: hit.blast ? 'die' : 'bounce', points: 5, label: '叮', sub: 'dīng · aim for the hole', color: '#e0c080' };
  }
  onBlast() { return { response: 'die', points: 5, label: '叮', sub: 'dīng' }; }
}

// ── 杨柳叶: the legendary willow leaf at a hundred paces ──────
export class WillowLeaf extends Target {
  constructor(game, willow) {
    super(game, 'leaf');
    this.anchor = willow.branchAnchor;
    this.twig = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1.2, 4), new THREE.MeshLambertMaterial({ color: 0x5a4a2a }));
    this.twig.position.y = 0.6;
    this.leafPivot = new THREE.Group(); this.group.add(this.leafPivot); this.leafPivot.add(this.twig);
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.quadraticCurveTo(0.05, 0.08, 0, 0.2); shape.quadraticCurveTo(-0.05, 0.08, 0, 0);
    this.leaf = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x9acb4a, emissive: 0x3a6a10, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
    this.leaf.rotation.z = Math.PI; this.leafPivot.add(this.leaf);
    // A little golden glint marks it so you can find it.
    this.glint = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
    this.glint.position.y = -0.1; this.leafPivot.add(this.glint);
    this.addCollider(this.leafPivot, 'sphere', { r: 0.11, offset: new THREE.Vector3(0, -0.1, 0) }, 'paper');
  }
  update(dt, t) {
    this.anchor.getWorldPosition(this.group.position);
    this.leafPivot.rotation.z = Math.sin(t * 1.1) * 0.15 + this.game.wind.x * 0.03;
    this.leafPivot.rotation.x = Math.sin(t * 0.8) * 0.1;
    this.glint.scale.setScalar(0.6 + Math.sin(t * 5) * 0.4);
    if (!this.active && t > this.respawnAt) this.setActive(true);
  }
  onHit(hit, proj) {
    if (hit.blast) return { response: 'die', points: 0, label: '太粗鲁了', sub: 'Too crude — a rocket?' };
    const p = this.leafPivot.getWorldPosition(new THREE.Vector3());
    this.game.fx.matter.emit({ pos: p, count: 20, color: 0x9acb4a, speed: 1, life: 3, size: 0.05, gravity: -0.6, drag: 2 });
    this.setActive(false);
    this.respawnAt = this.game.time + 10;
    const byBow = proj && proj.kind === 'arrow';
    if (byBow) {
      for (let i = 0; i < 6; i++) setTimeout(() => { const fp = p.clone().add(new THREE.Vector3(rand(-15, 15), rand(15, 30), rand(-10, 10))); this.game.fx.firework(fp); audio.fireworkBoom(fp); }, i * 280);
      return { response: 'pass', points: 500, label: '百步穿杨!', sub: 'bǎi bù chuān yáng · legendary', coins: 50, color: '#a6ff70', big: true };
    }
    return { response: 'pass', points: 120, label: '穿杨', sub: 'Only counts as legendary with the bow', coins: 5, color: '#a6ff70' };
  }
}

// ── 福: floating diamond plaque. Upside down, because 倒 sounds like 到. ─
export class FuPlaque extends Target {
  constructor(game, pos, life = 20) {
    super(game, 'fu');
    this.group.position.copy(pos);
    this.base = pos.clone();
    this.life = life;
    const tex = charTexture((x, w) => {
      x.fillStyle = '#c0201a'; x.fillRect(0, 0, w, w);
      x.strokeStyle = '#e9c46a'; x.lineWidth = w * 0.04; x.strokeRect(w * 0.06, w * 0.06, w * 0.88, w * 0.88);
      x.save(); x.translate(w / 2, w / 2); x.rotate(Math.PI * 0.75);
      x.fillStyle = '#1a1210'; x.font = `${w * 0.62}px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('福', 0, w * 0.03);
      x.restore();
    }, 256, 256);
    this.plate = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.04), [
      new THREE.MeshLambertMaterial({ color: 0x8a1410 }), new THREE.MeshLambertMaterial({ color: 0x8a1410 }),
      new THREE.MeshLambertMaterial({ color: 0x8a1410 }), new THREE.MeshLambertMaterial({ color: 0x8a1410 }),
      new THREE.MeshStandardMaterial({ map: tex, emissive: 0x330000 }), new THREE.MeshStandardMaterial({ map: tex, emissive: 0x330000 }),
    ]);
    this.plate.rotation.z = Math.PI / 4; this.group.add(this.plate);
    this.addCollider(this.plate, 'box', { half: new THREE.Vector3(0.4, 0.4, 0.04) }, 'paper');
    this.phase = rand(0, 6);
    this.group.scale.setScalar(0.01);
  }
  update(dt, t) {
    this.life -= dt;
    const s = this.life < 1 ? Math.max(0.01, this.life) : Math.min(1, this.group.scale.x + dt * 2);
    this.group.scale.setScalar(s);
    this.group.position.y = this.base.y + Math.sin(t * 1.3 + this.phase) * 0.4;
    this.group.position.x = this.base.x + Math.sin(t * 0.5 + this.phase) * 2;
    this.group.rotation.y = Math.sin(t * 0.9 + this.phase) * 0.6;
    if (this.life <= 0) this.destroy();
  }
  onHit(hit) {
    const p = this.group.position.clone();
    this.game.fx.paper(p, 40); this.game.fx.coinBurst(p);
    audio.firecrackers(p, 10);
    this.destroy();
    return { response: hit.blast ? 'die' : 'pass', points: 30, label: '福到了!', sub: 'fú dào le · luck has arrived', coins: 8, color: '#ffd56a' };
  }
}

// ── 龙风筝: a long dragon kite. Head shot brings it down. ─────
export class DragonKite extends Target {
  constructor(game, life = 40) {
    super(game, 'dragon');
    this.life = life;
    this.segs = [];
    const N = 14;
    const red = new THREE.MeshStandardMaterial({ color: 0xc0201a, emissive: 0x300800, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe0b040, emissive: 0x302000, metalness: 0.5, roughness: 0.4 });
    for (let i = 0; i < N; i++) {
      const head = i === 0;
      const s = new THREE.Group();
      const r = head ? 0.9 : 0.65 * (1 - i / N * 0.6);
      const body = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), i % 2 ? gold : red); body.scale.set(1, 0.8, 1.3); s.add(body);
      if (head) {
        for (const sx of [-1, 1]) {
          const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.9, 5), gold); horn.position.set(sx * 0.4, 0.8, 0.4); horn.rotation.x = 0.6; s.add(horn);
          const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff080 })); eye.position.set(sx * 0.45, 0.3, -0.85); s.add(eye);
          const whisker = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.01, 1.6, 4), gold); whisker.position.set(sx * 0.7, -0.2, -0.9); whisker.rotation.z = sx * 1.2; s.add(whisker);
        }
        const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.9), red); jaw.position.set(0, -0.45, -0.7); s.add(jaw);
      } else if (i % 3 === 0) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 4), gold); fin.position.y = r * 0.9; s.add(fin);
      }
      s.scale.setScalar(1.7);
      this.group.add(s);
      this.segs.push({ g: s, r, hits: 0 });
      this.addCollider(s, 'sphere', { r: r * 1.05 }, 'paper', { tag: i });
    }
    this.history = [];
    this.t0 = game.time;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.dead = false;
    this.fallV = 0;
  }
  headPath(t) {
    const u = (t - this.t0) * 0.12 * this.dir;
    return new THREE.Vector3(Math.sin(u * 2.1) * 26, 24 + Math.sin(u * 3.3) * 6, -62 + Math.cos(u * 1.7) * 18);
  }
  update(dt, t) {
    this.life -= dt;
    if (this.dead) {
      this.fallV += 9.8 * dt;
      for (const s of this.segs) { s.g.position.y -= this.fallV * dt; s.g.rotation.x += dt * 2; }
      if (this.segs[0].g.position.y < -3) this.destroy();
      return;
    }
    const head = this.life < 0 ? this.segs[0].g.position.clone().add(new THREE.Vector3(0, dt * 8, 0)) : this.headPath(t);
    this.history.unshift(head.clone());
    if (this.history.length > 800) this.history.pop();
    // body follows the head's path at fixed spacing
    let idx = 0, acc = 0;
    for (let i = 0; i < this.segs.length; i++) {
      const target = i * 1.95;
      while (idx < this.history.length - 1 && acc < target) { acc += this.history[idx].distanceTo(this.history[idx + 1]); idx++; }
      const p = this.history[Math.min(idx, this.history.length - 1)];
      const s = this.segs[i].g;
      const prev = s.position.clone();
      s.position.copy(p); s.position.y += Math.sin(t * 3 - i * 0.6) * 0.3;
      if (prev.distanceToSquared(s.position) > 1e-6) s.lookAt(prev); // -Z (the face) leads
    }
    if (this.life < -8) this.destroy();
  }
  onHit(hit, proj) {
    const i = hit.collider.tag;
    const p = this.segs[i].g.position.clone();
    if (i === 0) {
      this.dead = true;
      for (const c of this.colliders) c.enabled = false;
      this.game.fx.explosion(p, 3); this.game.fx.paper(p, 60);
      audio.firecrackers(p, 24);
      return { response: 'pass', points: 200, label: '屠龙!', sub: 'tú lóng · dragon slain', coins: 20, color: '#ff7050', big: true };
    }
    this.game.fx.paper(p, 15);
    audio.impact('paper', p);
    this.segs[i].g.scale.multiplyScalar(0.85);
    return { response: 'pass', points: 20, label: '龙鳞', sub: 'lóng lín · dragon scale', color: '#ffb070' };
  }
}

// ── 补给箱: supply crate. Only the hand cannon cracks it open. ─
const CRATE_TYPES = {
  bow: { cn: '箭', en: 'Arrows', color: '#c0201a' },
  rocket: { cn: '火', en: 'Rockets', color: '#e06a10' },
  sniper: { cn: '弹', en: 'Rifle rounds', color: '#2a4f8a' },
};
export class SupplyCrate extends Target {
  constructor(game, pos, ammoType) {
    super(game, 'crate');
    this.ammoType = ammoType;
    this.base = pos.clone();
    this.group.position.copy(pos);
    const T = CRATE_TYPES[ammoType];
    const tex = charTexture((x, w) => {
      x.fillStyle = '#7a4a22'; x.fillRect(0, 0, w, w);
      for (let i = 0; i < 6; i++) { x.fillStyle = `rgba(40,20,5,${0.15 + Math.random() * 0.2})`; x.fillRect(0, i * w / 6 + 2, w, 3); }
      x.strokeStyle = '#3a2210'; x.lineWidth = w * 0.06; x.strokeRect(w * 0.03, w * 0.03, w * 0.94, w * 0.94);
      x.fillStyle = T.color; x.beginPath(); x.arc(w / 2, w / 2, w * 0.3, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#fff3d6'; x.font = `${w * 0.38}px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(T.cn, w / 2, w / 2 + 4);
    }, 256, 256);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    this.box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), mat);
    this.group.add(this.box);
    // Gold bands so it reads as treasure
    const band = new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 0.8, roughness: 0.3 });
    for (const y of [-0.22, 0.22]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.62), band); b.position.y = y; this.box.add(b); }
    // Little red parachute-lantern holding it up
    const balloon = lanternMesh(0.8); balloon.position.y = 1.0; this.group.add(balloon);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4), new THREE.MeshLambertMaterial({ color: 0x3a2a1a })); rope.position.y = 0.5; this.group.add(rope);
    this.addCollider(this.box, 'box', { half: new THREE.Vector3(0.32, 0.32, 0.32) }, 'wood');
    this.addCollider(balloon, 'sphere', { r: 0.3 }, 'paper', { tag: 'balloon' });
    // Loot beam so crates are easy to spot from the shooting line
    const beamColor = { bow: 0xff5040, rocket: 0xffa020, sniper: 0x60a0ff }[ammoType];
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.3, 14, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.beam.position.y = 7.5; this.group.add(this.beam);
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 6, 24), new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.halo.rotation.x = Math.PI / 2; this.group.add(this.halo);
    this.phase = rand(0, 6);
    this.group.scale.setScalar(0.01);
  }
  update(dt, t) {
    if (this.group.scale.x < 1) this.group.scale.setScalar(Math.min(1, this.group.scale.x + dt * 1.5));
    this.group.position.y = this.base.y + Math.sin(t * 0.9 + this.phase) * 0.35;
    this.group.position.x = this.base.x + Math.sin(t * 0.3 + this.phase) * 1.2;
    this.box.rotation.y += dt * 0.4;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4 + this.phase);
    this.beam.material.opacity = 0.12 + 0.14 * pulse;
    this.halo.scale.setScalar(0.9 + 0.25 * pulse);
  }
  onHit(hit, proj) {
    if (!proj || proj.kind !== 'pistol') {
      audio.impact('wood', hit.point);
      this.game.hint('用手铳打开!', 'Crack crates with the hand cannon');
      return { response: hit.blast ? 'die' : (proj && proj.kind === 'arrow' ? 'stick' : 'bounce'), points: 0, noCombo: true };
    }
    const p = this.box.getWorldPosition(new THREE.Vector3());
    const n = this.game.giveAmmo(this.ammoType, CFG.crates.give[this.ammoType]);
    this.game.fx.splinters(p, 0x8a5a2a, 30); this.game.fx.coinBurst(p);
    audio.crateOpen(p);
    this.destroy();
    const T = CRATE_TYPES[this.ammoType];
    return { response: 'pass', points: 10, label: `+${n} ${T.cn}`, sub: `${T.en} restocked`, color: '#9cf0a0' };
  }
  onBlast() { this.game.hint('用手铳打开!', 'Crack crates with the hand cannon'); return { response: 'die', points: 0, noCombo: true }; }
}

// ── 仙鹤: don't shoot the cranes ─────────────────────────────
export class CraneTarget extends Target {
  constructor(game, crane) {
    super(game, 'crane');
    this.group.removeFromParent();
    this.crane = crane;
    this.cool = 0;
    this.addCollider(crane.g, 'sphere', { r: 0.9 }, 'paper');
  }
  update(dt) { this.cool -= dt; }
  onHit(hit) {
    if (this.cool > 0) return { response: 'pass', points: 0, noCombo: true };
    this.cool = 2;
    this.game.fx.feathers(hit.point);
    audio.penalty();
    return { response: 'pass', points: -50, label: '不要射鹤!', sub: 'Don’t shoot the cranes!', color: '#ff6060', penalty: true };
  }
}
