import * as THREE from 'three';

// Tiny collision layer for fast projectiles.
// Projectiles test a swept segment (previous position → new position) each step,
// so even a 850 m/s rifle round can't tunnel through a 2 cm leaf.
//
// Colliders live in an Object3D's local space, so they follow animated / scaled objects.
//   sphere:   { r }               local centre at `offset`
//   box:      { half: Vector3 }   local AABB centred at `offset`
//   disk:     { r, h }            thin cylinder along local Z, centred at `offset`
// A collider may define `passFilter(localPoint) => bool` to let a projectile pass through
// (used for the square hole of the cash coin).

const _inv = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class Collider {
  constructor(object, shape, params, opts = {}) {
    this.object = object;
    this.shape = shape;
    this.r = params.r ?? 0.5;
    this.h = params.h ?? 0.05;
    this.half = params.half ?? new THREE.Vector3(0.5, 0.5, 0.5);
    this.offset = params.offset ?? new THREE.Vector3();
    this.material = opts.material ?? 'wood';
    this.owner = opts.owner ?? null;      // the Target that handles hits
    this.tag = opts.tag ?? null;
    this.passFilter = opts.passFilter ?? null;
    this.enabled = true;
  }

  // Returns { t, local, normalLocal } or null. a,b are world-space.
  intersect(a, b) {
    _inv.copy(this.object.matrixWorld).invert();
    _a.copy(a).applyMatrix4(_inv).sub(this.offset);
    _b.copy(b).applyMatrix4(_inv).sub(this.offset);
    _d.subVectors(_b, _a);
    let t = null;
    if (this.shape === 'sphere') {
      const A = _d.dot(_d), B = 2 * _a.dot(_d), C = _a.dot(_a) - this.r * this.r;
      if (C < 0) { t = 0; _n.copy(_a).normalize(); }
      else {
        const disc = B * B - 4 * A * C;
        if (disc < 0 || A === 0) return null;
        const t0 = (-B - Math.sqrt(disc)) / (2 * A);
        if (t0 < 0 || t0 > 1) return null;
        t = t0;
        _p.copy(_a).addScaledVector(_d, t);
        _n.copy(_p).normalize();
      }
    } else if (this.shape === 'box') {
      let tmin = 0, tmax = 1, axis = -1, sign = 1;
      for (let i = 0; i < 3; i++) {
        const o = _a.getComponent(i), dd = _d.getComponent(i), h = this.half.getComponent(i);
        if (Math.abs(dd) < 1e-9) { if (o < -h || o > h) return null; continue; }
        let t1 = (-h - o) / dd, t2 = (h - o) / dd, s = -1;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
      t = tmin;
      _n.set(0, 0, 0); if (axis >= 0) _n.setComponent(axis, sign); else _n.copy(_d).negate().normalize();
    } else if (this.shape === 'disk') {
      // Slab along z, then radial check.
      const h = this.h;
      if (Math.abs(_d.z) < 1e-9) return null;
      const enterZ = _d.z < 0 ? h : -h;
      const te = (enterZ - _a.z) / _d.z;
      if (te < 0 || te > 1) return null;
      _p.copy(_a).addScaledVector(_d, te);
      if (_p.x * _p.x + _p.y * _p.y > this.r * this.r) return null;
      t = te;
      _n.set(0, 0, _d.z < 0 ? 1 : -1);
    }
    if (t === null) return null;
    _p.copy(_a).addScaledVector(_d, t);
    if (this.passFilter && this.passFilter(_p)) return { t, pass: true, local: _p.clone() };
    return { t, local: _p.clone(), normalLocal: _n.clone() };
  }

  worldNormal(nLocal) {
    _nm.getNormalMatrix(this.object.matrixWorld);
    return nLocal.clone().applyMatrix3(_nm).normalize();
  }
}

export class PhysicsWorld {
  constructor() {
    this.colliders = new Set();
    this.staticMeshes = [];          // environment meshes hit by raycast (walls, gates)
    this.raycaster = new THREE.Raycaster();
    this.groundY = 0;
  }
  add(c) { this.colliders.add(c); return c; }
  remove(c) { this.colliders.delete(c); }
  addStatic(mesh, material = 'wood') { mesh.userData.material = material; this.staticMeshes.push(mesh); }

  // Nearest hit along segment a→b. `ignore` is a Set of colliders to skip.
  sweep(a, b, ignore) {
    let best = null;
    const passes = [];
    for (const c of this.colliders) {
      if (!c.enabled || (ignore && ignore.has(c))) continue;
      if (!c.object.visible && !c.object.parent) continue;
      const hit = c.intersect(a, b);
      if (!hit) continue;
      if (hit.pass) { passes.push({ collider: c, t: hit.t }); continue; }
      if (!best || hit.t < best.t) best = { ...hit, collider: c };
    }
    // Environment
    const len = a.distanceTo(b);
    if (len > 1e-6 && this.staticMeshes.length) {
      _d.subVectors(b, a).divideScalar(len);
      this.raycaster.set(a, _d);
      this.raycaster.far = len;
      const hits = this.raycaster.intersectObjects(this.staticMeshes, false);
      if (hits.length) {
        const h = hits[0], t = h.distance / len;
        if (!best || t < best.t) {
          const nrm = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : _d.clone().negate();
          best = { t, point: h.point.clone(), normal: nrm, static: h.object, material: h.object.userData.material || 'stone' };
        }
      }
    }
    // Ground plane
    if (a.y >= this.groundY && b.y < this.groundY) {
      const t = (a.y - this.groundY) / (a.y - b.y);
      if (!best || t < best.t) best = { t, ground: true, normal: new THREE.Vector3(0, 1, 0), material: 'ground' };
    }
    if (best && !best.point) best.point = new THREE.Vector3().lerpVectors(a, b, best.t);
    if (best && best.collider) best.normal = best.collider.worldNormal(best.normalLocal);
    const passed = passes.filter(p => !best || p.t < best.t).map(p => p.collider);
    return { hit: best, passed };
  }

  // All colliders whose owner lies within radius of p (for explosions).
  overlapOwners(p, radius) {
    const owners = new Map();
    const wp = new THREE.Vector3();
    for (const c of this.colliders) {
      if (!c.enabled || !c.owner) continue;
      wp.copy(c.offset).applyMatrix4(c.object.matrixWorld);
      const d = wp.distanceTo(p);
      const ext = c.shape === 'box' ? c.half.length() : c.r;
      if (d - ext < radius) {
        const prev = owners.get(c.owner);
        if (!prev || d < prev.dist) owners.set(c.owner, { collider: c, dist: Math.max(0, d - ext), point: wp.clone() });
      }
    }
    return owners;
  }
}
