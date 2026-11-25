import * as THREE from 'three';

// Merge static meshes that share an equivalent material into one mesh per material.
// Standalone headsets are draw-call bound, and the environment is hundreds of small pieces.
// Physics meshes (raycast targets) are merged visually but kept as hidden proxies. Skips: multi-material meshes, shader materials,
// instanced meshes, and anything flagged `userData.dynamic` (or under such a parent).

function matKey(m) {
  return [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.map?.uuid, m.side,
    m.transparent, m.opacity, m.vertexColors, m.metalness, m.roughness, m.fog, m.toneMapped, m.depthWrite].join('|');
}

export function bakeStatic(root, exclude = new Set()) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (Array.isArray(o.material) || o.material.isShaderMaterial) return;
    for (let p = o; p; p = p.parent) if (p.userData.dynamic) return;
    const k = matKey(o.material);
    if (!groups.has(k)) groups.set(k, { material: o.material, items: [] });
    groups.get(k).items.push(o);
  });
  let before = 0, after = 0;
  const m4 = new THREE.Matrix4();
  for (const { material, items } of groups.values()) {
    before += items.length;
    if (items.length < 2) { after += items.length; continue; }
    const geos = items.map((o) => {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      m4.multiplyMatrices(rootInv, o.matrixWorld);
      g.applyMatrix4(m4);
      if (m4.determinant() < 0) flipWinding(g);
      if (!g.attributes.normal) g.computeVertexNormals();
      return g;
    });
    const merged = mergeGeometries(geos, !!material.map, !!material.vertexColors);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'baked';
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    // Physics meshes stay in the scene as invisible raycast proxies (Raycaster ignores visibility).
    for (const o of items) { if (exclude.has(o)) o.visible = false; else o.removeFromParent(); }
    after++;
  }
  return { before, after };
}

function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name], n = a.itemSize, arr = a.array;
    for (let i = 0; i < a.count; i += 3) for (let k = 0; k < n; k++) {
      const t = arr[(i + 1) * n + k]; arr[(i + 1) * n + k] = arr[(i + 2) * n + k]; arr[(i + 2) * n + k] = t;
    }
  }
}

function mergeGeometries(geos, uv, color) {
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3);
  const uvs = uv ? new Float32Array(count * 2) : null;
  const col = color ? new Float32Array(count * 3) : null;
  let o = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    nrm.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (uvs && g.attributes.uv) uvs.set(g.attributes.uv.array.subarray(0, n * 2), o * 2);
    if (col) { if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3); else col.fill(1, o * 3, (o + n) * 3); }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
