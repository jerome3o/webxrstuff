import * as THREE from 'three';
import { CFG } from './config.js';

// Projectile meshes all point along +Z with the tip at the origin,
// so `pos` is always the leading point used for swept collision.

const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _prev = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _dir = new THREE.Vector3();

export const ARROW_LEN = 0.95;

const M = {
  shaft: new THREE.MeshStandardMaterial({ color: 0xcfb07a, roughness: 0.7 }),
  node: new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.7 }),
  head: new THREE.MeshStandardMaterial({ color: 0x6f6a62, metalness: 0.9, roughness: 0.35 }),
  fletchRed: new THREE.MeshStandardMaterial({ color: 0xb3201c, roughness: 0.9, side: THREE.DoubleSide }),
  fletchWhite: new THREE.MeshStandardMaterial({ color: 0xf0ebe0, roughness: 0.9, side: THREE.DoubleSide }),
  nock: new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.5 }),
  fireHead: new THREE.MeshStandardMaterial({ color: 0x3a2a1a, emissive: 0xff5a10, emissiveIntensity: 1.5 }),
  rocketBody: new THREE.MeshStandardMaterial({ color: 0xb8231d, roughness: 0.6 }),
  rocketGold: new THREE.MeshStandardMaterial({ color: 0xd9a63a, metalness: 0.8, roughness: 0.35 }),
  bullet: new THREE.MeshBasicMaterial({ color: 0xfff1c0 }),
  ball: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.8, roughness: 0.4 }),
};

function buildArrow(fire = false) {
  const g = new THREE.Group();
  const L = ARROW_LEN;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, L - 0.05, 6), M.shaft);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = -(L - 0.05) / 2 - 0.05; g.add(shaft);
  // bamboo nodes
  for (const z of [-0.3, -0.62]) {
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.008, 6), M.node);
    n.rotation.x = Math.PI / 2; n.position.z = z; g.add(n);
  }
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.06, 4), fire ? M.fireHead : M.head);
  head.rotation.x = Math.PI / 2; head.position.z = -0.03; g.add(head);
  // three vanes, one "cock feather" in white
  const vaneGeo = new THREE.BufferGeometry();
  vaneGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.028, -0.04, 0, 0.028, -0.15, 0, 0, -0.17, 0, 0, 0, 0, 0.028, -0.15], 3));
  vaneGeo.computeVertexNormals();
  for (let i = 0; i < 3; i++) {
    const v = new THREE.Mesh(vaneGeo, i === 0 ? M.fletchWhite : M.fletchRed);
    v.position.z = -L + 0.2; v.rotation.z = i * Math.PI * 2 / 3; g.add(v);
  }
  const nock = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.005, 0.02, 6), M.nock);
  nock.rotation.x = Math.PI / 2; nock.position.z = -L + 0.01; g.add(nock);
  return g;
}

function buildRocket() {
  // 火龙出水: a bamboo-and-paper dragon rocket
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.55, 10), M.rocketBody);
  body.rotation.x = Math.PI / 2; body.position.z = -0.33; g.add(body);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 10), M.rocketGold);
  head.rotation.x = Math.PI / 2; head.position.z = -0.05; g.add(head);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.08), M.rocketGold);
  jaw.position.set(0, -0.04, -0.12); g.add(jaw);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.08, 0.12), M.rocketGold);
    const a = i * Math.PI / 2;
    fin.position.set(Math.cos(a) * 0.06, Math.sin(a) * 0.06, -0.56); fin.rotation.z = a; g.add(fin);
  }
  return g;
}

function buildBullet(big) {
  const g = new THREE.Group();
  // A short glowing tracer so you can follow the shot.
  const tracer = new THREE.Mesh(new THREE.CylinderGeometry(big ? 0.012 : 0.008, big ? 0.004 : 0.003, big ? 1.6 : 0.5, 5), M.bullet);
  tracer.rotation.x = Math.PI / 2; tracer.position.z = big ? -0.8 : -0.25; g.add(tracer);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.012 : 0.015, 6, 4), M.ball);
  g.add(ball);
  return g;
}

let _uid = 1;

export class Projectile {
  constructor(kind, opts) {
    this.id = _uid++;
    this.kind = kind;            // 'arrow' | 'rocket' | 'sniper' | 'pistol'
    this.weapon = opts.weapon ?? kind;
    this.shotId = opts.shotId ?? this.id;
    this.pos = opts.pos.clone();
    this.vel = opts.vel.clone();
    this.age = 0;
    this.state = 'flying';
    this.fire = !!opts.fire;
    this.ignore = new Set();
    this.scored = false;
    this.hits = 0;
    this.stuckTime = 0;
    this.wobble = 0;
    this.lastTrail = 0;
    this.mesh = kind === 'arrow' ? buildArrow(this.fire)
      : kind === 'rocket' ? buildRocket()
        : buildBullet(kind === 'sniper');
    this.mesh.position.copy(this.pos);
    this._orient();
    const W = CFG.weapons;
    this.params = kind === 'arrow' ? { g: 1, drag: W.bow.drag, wind: W.bow.windFactor }
      : kind === 'rocket' ? { g: W.rocket.gravityScale, drag: 0.0, wind: 0.05 }
        : kind === 'sniper' ? { g: 1, drag: W.sniper.drag, wind: W.sniper.windFactor }
          : { g: 1, drag: W.pistol.drag, wind: W.pistol.windFactor };
  }

  _orient() {
    _dir.copy(this.vel);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    _q.setFromUnitVectors(Z, _dir);
    this.mesh.quaternion.copy(_q);
  }

  // Advance and sweep. Calls game.onProjectileHit for hits/passes.
  step(dt, world, game) {
    if (this.state === 'stuck') {
      this.stuckTime += dt;
      if (this.wobble > 0) {
        this.wobble = Math.max(0, this.wobble - dt);
        const w = Math.sin(this.stuckTime * 55) * 0.06 * (this.wobble / 0.7);
        this.mesh.quaternion.copy(this.baseQuat);
        this.mesh.rotateX(w); this.mesh.rotateY(w * 0.6);
      }
      return;
    }
    if (this.state !== 'flying') return;
    this.age += dt;
    const p = this.params;
    _acc.set(0, CFG.gravity * p.g, 0);
    if (this.kind === 'rocket') {
      const R = CFG.weapons.rocket;
      if (this.age < R.burnTime) {
        _dir.copy(this.vel).normalize();
        _acc.addScaledVector(_dir, R.thrust);
        // A little corkscrew wobble, like a real black-powder rocket.
        _acc.x += Math.sin(this.age * 21 + this.id) * 2.2;
        _acc.y += Math.cos(this.age * 17 + this.id) * 2.2;
      }
    }
    // Air drag relative to the moving air.
    _rel.copy(this.vel).addScaledVector(game.wind, -p.wind * 3);
    const sp = _rel.length();
    if (p.drag > 0) _acc.addScaledVector(_rel, -p.drag * sp);
    if (p.wind && this.kind !== 'rocket') _acc.addScaledVector(game.wind, p.wind * 0.6);

    this.vel.addScaledVector(_acc, dt);
    if (this.kind === 'rocket') {
      const max = CFG.weapons.rocket.maxSpeed, s = this.vel.length();
      if (s > max) this.vel.multiplyScalar(max / s);
    }
    _prev.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);

    const { hit, passed } = world.sweep(_prev, this.pos, this.ignore);
    for (const c of passed) { this.ignore.add(c); game.onProjectilePass(this, c); }
    if (hit) {
      const response = game.onProjectileHit(this, hit);
      if (response === 'pass') {
        if (hit.collider) this.ignore.add(hit.collider);
        this.vel.multiplyScalar(this.kind === 'sniper' ? 0.9 : 0.75);
      } else if (response === 'bounce') {
        this.pos.copy(hit.point).addScaledVector(hit.normal, 0.02);
        const n = hit.normal;
        this.vel.addScaledVector(n, -2 * this.vel.dot(n)).multiplyScalar(0.3);
        this.vel.x += (Math.random() - 0.5) * 2; this.vel.z += (Math.random() - 0.5) * 2;
        if (hit.collider) this.ignore.add(hit.collider);
      } else if (response === 'stick') {
        this.stick(hit, game);
      } else {
        this.kill();
      }
    }

    if (this.state === 'flying') {
      this.mesh.position.copy(this.pos);
      this._orient();
      if (this.pos.y < -20 || this.age > 12 || this.pos.lengthSq() > 900 * 900) this.kill();
    }
  }

  stick(hit, game) {
    this.state = 'stuck';
    const depth = Math.min(0.25, (hit.material === 'straw' ? 0.22 : 0.1) * this.vel.length() / 50);
    this.pos.copy(hit.point).addScaledVector(this.vel.clone().normalize(), depth);
    this.mesh.position.copy(this.pos);
    this._orient();
    this.mesh.updateMatrixWorld(true);
    const parent = hit.collider ? hit.collider.object : hit.static ? hit.static : null;
    if (parent) parent.attach(this.mesh);
    this.baseQuat = this.mesh.quaternion.clone();
    this.wobble = 0.7;
    this.attachedTo = hit.collider?.owner ?? null;
    game.registerStuck(this);
  }

  kill() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.mesh.removeFromParent();
  }
}
