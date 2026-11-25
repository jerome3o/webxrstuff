import * as THREE from 'three';

// One InstancedMesh per kind of physics prop (tins, beanbags, rings...). Bodies keep a back-reference
// so the grab system can tint the hovered instance.
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), _zero = new THREE.Vector3(0, 0, 0);
const _q = new THREE.Quaternion(), _p = new THREE.Vector3();

export class PropSet {
  constructor(scene, geometry, material, max, { visualQuat = null } = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.bodies = [];
    this.colors = [];
    this.visualQuat = visualQuat; // extra local rotation applied to the visual
    scene.add(this.mesh);
  }
  add(body, color = 0xffffff) {
    const i = this.bodies.length;
    this.bodies.push(body);
    this.colors.push(new THREE.Color(color));
    body.prop = { set: this, index: i };
    this.mesh.count = this.bodies.length;
    this.mesh.setColorAt(i, this.colors[i]);
    this.mesh.instanceColor.needsUpdate = true;
    return body;
  }
  highlight(body, k) {
    const i = body.prop.index;
    _c.copy(this.colors[i]);
    if (k > 0) _c.lerp(HL, k);
    this.mesh.setColorAt(i, _c);
    this.mesh.instanceColor.needsUpdate = true;
  }
  sync() {
    const b = this.bodies;
    for (let i = 0; i < b.length; i++) {
      const body = b[i];
      if (!body.enabled || body.hidden) _m.compose(body.pos, body.quat, _zero);
      else if (this.visualQuat) { _q.copy(body.quat).multiply(this.visualQuat); _m.compose(body.pos, _q, _s); }
      else _m.compose(body.pos, body.quat, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const HL = new THREE.Color(1, 0.95, 0.6);
