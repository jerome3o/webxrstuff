import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Builds the temple drum kit inside `kitRoot` (kit-local space: origin on the floor under the
// player's feet, player faces -Z). Returns pads (analytic striking surfaces), reactors (visible
// motion after hits) and helpers. Everything static is merged per material.

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function skinTexture(accent) {
  return canvasTex(256, 256, (x, W) => {
    const cx = W / 2;
    const g = x.createRadialGradient(cx, cx, 10, cx, cx, cx);
    g.addColorStop(0, '#efe0bd'); g.addColorStop(0.8, '#e2cb9c'); g.addColorStop(1, '#b89462');
    x.fillStyle = g; x.fillRect(0, 0, W, W);
    // fibres
    for (let i = 0; i < 500; i++) {
      x.strokeStyle = `rgba(120,90,50,${Math.random() * 0.06})`;
      x.beginPath(); const a = Math.random() * 6.28, r = Math.random() * cx;
      x.moveTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r); x.lineTo(cx + Math.cos(a + 0.2) * r, cx + Math.sin(a + 0.2) * r); x.stroke();
    }
    // painted emblem: taiji-like swirl in vermilion + gold ring
    x.lineWidth = 5; x.strokeStyle = accent; x.globalAlpha = 0.75;
    x.beginPath(); x.arc(cx, cx, cx * 0.42, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 2; x.beginPath(); x.arc(cx, cx, cx * 0.5, 0, Math.PI * 2); x.stroke();
    x.fillStyle = accent;
    for (let k = 0; k < 3; k++) {
      x.save(); x.translate(cx, cx); x.rotate(k * Math.PI * 2 / 3);
      x.beginPath(); x.arc(cx * 0.16, 0, cx * 0.16, 0, Math.PI); x.arc(cx * 0.06, 0, cx * 0.06, Math.PI, 0, true); x.fill();
      x.restore();
    }
    x.globalAlpha = 1;
    // sweet-spot hint
    x.strokeStyle = 'rgba(90,50,20,0.25)'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cx, cx * 0.25, 0, Math.PI * 2); x.stroke();
  });
}

function metalTexture(base, rings, hammer) {
  return canvasTex(256, 256, (x, W) => {
    const cx = W / 2;
    x.fillStyle = base; x.fillRect(0, 0, W, W);
    for (let r = 4; r < cx; r += 2.2) {
      x.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,240,200' : '60,40,10'},${0.05 + Math.random() * rings})`;
      x.lineWidth = 1; x.beginPath(); x.arc(cx, cx, r, 0, Math.PI * 2); x.stroke();
    }
    for (let i = 0; i < hammer; i++) {
      const a = Math.random() * 6.28, r = Math.random() * cx * 0.95;
      x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,235,190' : '50,30,10'},0.12)`;
      x.beginPath(); x.ellipse(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 3 + Math.random() * 4, 2 + Math.random() * 3, a, 0, 6.28); x.fill();
    }
  });
}

function bellTexture() {
  // lathe UVs: u around, v along profile. Patinated bronze with rows of studs (mei) and bands.
  return canvasTex(256, 256, (x, W, H) => {
    x.fillStyle = '#7d6a3c'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 1200; i++) { x.fillStyle = `rgba(${Math.random() < 0.6 ? '60,110,90' : '150,120,60'},${Math.random() * 0.25})`; x.fillRect(Math.random() * W, Math.random() * H, 3, 3); }
    x.fillStyle = 'rgba(210,170,90,0.6)';
    for (const y of [0.25, 0.55, 0.85]) x.fillRect(0, H * (1 - y) - 3, W, 6);
    for (let face = 0; face < 2; face++) {
      for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) {
        const u = (face * 0.5 + 0.12 + (col % 3) * 0.04 + (row % 2) * 0.0) * W, v = H * (1 - (0.3 + row * 0.16));
        for (const s of [-1, 1]) {
          const uu = (face * 0.5 + 0.25 + s * (0.08 + col * 0.045)) * W;
          x.fillStyle = '#c9a259'; x.beginPath(); x.arc(uu, v, 5, 0, 6.28); x.fill();
          x.fillStyle = 'rgba(40,30,10,0.4)'; x.beginPath(); x.arc(uu + 1.5, v + 1.5, 4, 0, 6.28); x.fill();
        }
        void u;
      }
      // strike mark (sui) on each face: low centre
      x.strokeStyle = 'rgba(230,200,120,0.7)'; x.lineWidth = 2;
      x.beginPath(); x.arc((face * 0.5 + 0.25) * W, H * 0.86, 9, 0, 6.28); x.stroke();
    }
  });
}

function woodTexture(base, dark) {
  return canvasTex(256, 256, (x, W, H) => {
    x.fillStyle = base; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      x.strokeStyle = `rgba(${dark},${0.08 + Math.random() * 0.15})`; x.lineWidth = 1 + Math.random() * 2;
      x.beginPath(); const y = Math.random() * H; x.moveTo(0, y);
      for (let k = 1; k <= 8; k++) x.lineTo(k * W / 8, y + Math.sin(k + i) * 4);
      x.stroke();
    }
  });
}

// Membrane ripple shader (Lambert + vertex displacement along local +Z).
function membraneMaterial(map, R) {
  const mat = new THREE.MeshLambertMaterial({ map, color: 0xffffff });
  const u = {
    uR: { value: R }, uHit: { value: new THREE.Vector2() }, uT: { value: 10 }, uAmp: { value: 0 },
    uT2: { value: 10 }, uHit2: { value: new THREE.Vector2() }, uAmp2: { value: 0 },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uR, uT, uAmp, uT2, uAmp2; uniform vec2 uHit, uHit2;
float ripple(vec2 p, vec2 h, float t, float a) {
  if (a <= 0.0) return 0.0;
  float r = length(p) / uR; float edge = max(0.0, 1.0 - r * r);
  float d = distance(p, h) / uR;
  float front = t * 7.0;
  float wave = sin(d * 22.0 - t * 70.0) * exp(-abs(d - front) * 3.0) * smoothstep(front + 0.15, front - 0.1, d);
  float fund = cos(t * 55.0) * (1.0 - r * r);
  return a * exp(-t * 6.0) * edge * (0.7 * fund + 0.6 * wave);
}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.z += ripple(position.xy, uHit, uT, uAmp) + ripple(position.xy, uHit2, uT2, uAmp2);`);
  };
  mat.customProgramCacheKey = () => 'drum-membrane';
  return mat;
}

export function buildKit(kitRoot, envMap) {
  const mats = {
    wood: new THREE.MeshLambertMaterial({ map: woodTexture('#4a2c19', '20,10,4') }),
    red: new THREE.MeshStandardMaterial({ color: 0x8e1b12, roughness: 0.38, metalness: 0.05, envMap, envMapIntensity: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd2a446, roughness: 0.32, metalness: 0.85, envMap, envMapIntensity: 1.1 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x1c120c }),
    bronze: new THREE.MeshStandardMaterial({ map: bellTexture(), roughness: 0.42, metalness: 0.7, envMap, envMapIntensity: 1.2, color: 0xffffff }),
    gong: new THREE.MeshStandardMaterial({ map: metalTexture('#b4823a', 0.12, 250), roughness: 0.3, metalness: 0.85, envMap, envMapIntensity: 1.3, side: THREE.DoubleSide }),
    cym: new THREE.MeshStandardMaterial({ map: metalTexture('#d4ab5a', 0.18, 60), roughness: 0.25, metalness: 0.9, envMap, envMapIntensity: 1.3, side: THREE.DoubleSide }),
    fish: new THREE.MeshStandardMaterial({ map: woodTexture('#8a3a18', '40,10,0'), roughness: 0.4, metalness: 0.05, envMap, envMapIntensity: 0.5 }),
    block: new THREE.MeshStandardMaterial({ map: woodTexture('#a8642c', '60,25,5'), roughness: 0.45, metalness: 0.0, envMap, envMapIntensity: 0.4 }),
  };
  const statics = { wood: [], red: [], gold: [], dark: [] };
  const addStatic = (key, geo, matrix) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    statics[key].push(g);
  };
  const tmpObj = new THREE.Object3D();
  const mtx = (px, py, pz, rx = 0, ry = 0, rz = 0, s = 1, sy = s, sz = s) => {
    tmpObj.position.set(px, py, pz); tmpObj.rotation.set(rx, ry, rz); tmpObj.scale.set(s, sy, sz); tmpObj.updateMatrix();
    return tmpObj.matrix.clone();
  };
  // Box spanning two points (a post / beam)
  const beam = (key, a, b, w, d = w) => {
    const len = a.distanceTo(b);
    const geo = new THREE.BoxGeometry(w, len, d);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
    addStatic(key, geo, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  };
  const rod = (key, a, b, r, seg = 8) => {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(r, r, len, seg, 1);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
    addStatic(key, geo, new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const polar = (deg, dist, h) => { const a = THREE.MathUtils.degToRad(deg); return V(Math.sin(a) * dist, h, -Math.cos(a) * dist); };

  const pads = [];
  const reactors = [];
  // A group placed at `c` whose local +Z is `n` (and local +Y as close to world up as possible)
  const frame = (c, n, upHint = UP) => {
    const g = new THREE.Group();
    g.position.copy(c);
    const zA = n.clone().normalize();
    let xA = new THREE.Vector3().crossVectors(upHint, zA);
    if (xA.lengthSq() < 1e-4) xA.set(1, 0, 0);
    xA.normalize();
    const yA = new THREE.Vector3().crossVectors(zA, xA);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
    kitRoot.add(g);
    return g;
  };
  const makeReactor = (pivot, k, c, kind) => { const r = { pivot, kind, k, c, rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0, awake: false }; reactors.push(r); return r; };
  const addPad = (p) => {
    p.index = pads.length;
    // local axes in kit space
    if (p.group) {
      p.u = new THREE.Vector3(1, 0, 0).applyQuaternion(p.group.quaternion);
      p.v = new THREE.Vector3(0, 1, 0).applyQuaternion(p.group.quaternion);
      if (!p.n) p.n = new THREE.Vector3(0, 0, 1).applyQuaternion(p.group.quaternion);
    }
    pads.push(p); return p;
  };

  // ── Barrel drum (taiko-style / tanggu) ─────────────────────
  const barrel = (c, n, R, L, bulge, headMatAccent, id, label, family, stand) => {
    const g = frame(c, n);
    const pts = [];
    for (let i = 12; i >= 0; i--) { const s = i / 12; pts.push(new THREE.Vector2(R * (1.02 + bulge * Math.sin(Math.PI * s)), -s * L)); }
    const lathe = new THREE.LatheGeometry(pts, 28); lathe.rotateX(Math.PI / 2);
    g.updateMatrix();
    addStatic('red', lathe, g.matrix);
    // gold tack rings and studs
    for (const z of [-0.012, -L + 0.012]) {
      const tor = new THREE.TorusGeometry(R * 1.035, 0.011, 6, 32);
      addStatic('gold', tor, g.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, z)));
    }
    const studs = Math.round(R * 70);
    for (let i = 0; i < studs; i++) {
      const a = i / studs * Math.PI * 2;
      const s = new THREE.SphereGeometry(0.008, 5, 4);
      addStatic('gold', s, g.matrix.clone().multiply(new THREE.Matrix4().makeTranslation(Math.cos(a) * R * 1.04, Math.sin(a) * R * 1.04, -0.035)));
    }
    // carrying rings
    for (const sx of [-1, 1]) addStatic('gold', new THREE.TorusGeometry(0.035, 0.007, 6, 12), g.matrix.clone().multiply(mtx(sx * R * (1.02 + bulge) , 0, -L / 2, 0, Math.PI / 2, 0)));
    // head
    const headMat = membraneMaterial(skinTexture(headMatAccent), R);
    const head = new THREE.Mesh(new THREE.RingGeometry(0.0005, R, 36, 8), headMat);
    head.position.z = 0.002;
    g.add(head);
    stand?.(g);
    return addPad({ id, label, family, kind: 'disc', group: g, c: c.clone(), R, hitR: R * 1.12, rimR: R * 0.97, head: headMat.userData.u });
  };

  // Taiko: front centre, tilted toward the player
  const taikoN = V(0, Math.cos(THREE.MathUtils.degToRad(38)), Math.sin(THREE.MathUtils.degToRad(38)));
  barrel(V(0, 0.9, -0.62), taikoN, 0.29, 0.5, 0.14, '#a61e14', 'taiko', 'Great Drum', 'drum', (g) => {
    // wooden cradle stand
    const bottom = V(0, 0.9, -0.62).addScaledVector(taikoN, -0.5);
    for (const sx of [-1, 1]) {
      beam('wood', V(sx * 0.36, 0, -0.45), V(sx * 0.36, 0.86, -0.62), 0.05);
      beam('wood', V(sx * 0.36, 0, -1.0), V(sx * 0.36, 0.62, -0.9), 0.05);
      beam('wood', V(sx * 0.36, 0.05, -0.45), V(sx * 0.36, 0.05, -1.0), 0.06);
    }
    beam('wood', V(-0.36, 0.62, -0.88), V(0.36, 0.62, -0.88), 0.05);
    beam('wood', V(-0.36, 0.7, -0.6), V(0.36, 0.7, -0.6), 0.05);
    void g; void bottom;
  });
  // Toms (tanggu), angled toward the player
  const tomStand = (c, n) => () => {
    const base = c.clone().addScaledVector(n, -0.2);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.3;
      rod('wood', V(base.x + Math.cos(a) * 0.17, 0, base.z + Math.sin(a) * 0.17), V(base.x, base.y - 0.06, base.z), 0.012);
    }
    rod('wood', V(base.x, base.y - 0.08, base.z), base, 0.02);
  };
  const tomLc = polar(-27, 0.56, 0.8), tomLn = V(0.3, 0.85, 0.42).normalize();
  const tomRc = polar(27, 0.56, 0.8), tomRn = V(-0.3, 0.85, 0.42).normalize();
  barrel(tomLc, tomLn, 0.155, 0.24, 0.12, '#c8902c', 'tomL', 'Low Tom', 'drum', tomStand(tomLc, tomLn));
  barrel(tomRc, tomRn, 0.135, 0.22, 0.12, '#c8902c', 'tomR', 'High Tom', 'drum', tomStand(tomRc, tomRn));

  // ── Bian-zhong bell rack ───────────────────────────────────
  const rackZ = -0.98, beamY = 1.62;
  for (const sx of [-1, 1]) {
    beam('red', V(sx * 0.66, 0, rackZ), V(sx * 0.66, beamY + 0.12, rackZ), 0.07);
    addStatic('gold', new THREE.CylinderGeometry(0.06, 0.08, 0.06, 12), mtx(sx * 0.66, 0.03, rackZ));
    addStatic('wood', new THREE.BoxGeometry(0.3, 0.05, 0.3), mtx(sx * 0.66, 0.025, rackZ));
  }
  beam('red', V(-0.78, beamY, rackZ), V(0.78, beamY, rackZ), 0.07, 0.08);
  beam('wood', V(-0.82, beamY + 0.08, rackZ), V(0.82, beamY + 0.08, rackZ), 0.05, 0.11);
  for (const sx of [-1, 1]) addStatic('gold', new THREE.SphereGeometry(0.05, 10, 8), mtx(sx * 0.82, beamY + 0.08, rackZ, 0, 0, 0, 1, 0.8, 1));
  // bell geometry: almond (flattened) lathe with crown and hanging shank
  const bellPts = [];
  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    bellPts.push(new THREE.Vector2(0.052 + 0.033 * Math.pow(s, 1.25) + 0.004 * Math.sin(s * Math.PI), -s * 0.16));
  }
  bellPts.push(new THREE.Vector2(0.078, -0.158));
  bellPts.reverse();
  const bellBody = new THREE.LatheGeometry(bellPts, 22);
  const crown = new THREE.CircleGeometry(0.052, 22); crown.rotateX(-Math.PI / 2);
  const shank = new THREE.CylinderGeometry(0.012, 0.016, 0.07, 8); shank.translate(0, 0.035, 0);
  const ring = new THREE.TorusGeometry(0.018, 0.005, 5, 10); ring.translate(0, 0.075, 0);
  for (const gg of [crown, shank, ring]) { gg.deleteAttribute('uv'); gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2)); }
  const bellGeo = mergeGeometries([bellBody.toNonIndexed(), crown.toNonIndexed(), shank.toNonIndexed(), ring.toNonIndexed()]);
  bellGeo.scale(1, 1, 0.72); // almond cross-section
  bellGeo.computeVertexNormals();
  const BELL_F = [293.66, 329.63, 369.99, 440.0, 493.88]; // D4 E4 F#4 A4 B4
  const BELL_S = [1.28, 1.16, 1.06, 0.96, 0.86];
  const bellX = [-0.48, -0.24, 0, 0.24, 0.48];
  for (let i = 0; i < 5; i++) {
    const s = BELL_S[i];
    const hang = V(bellX[i], beamY - 0.04, rackZ + Math.abs(bellX[i]) * 0.12);
    const g = frame(hang, Z);
    const pivot = new THREE.Group(); g.add(pivot);
    const mesh = new THREE.Mesh(bellGeo, mats.bronze);
    mesh.scale.setScalar(s); mesh.position.y = -0.085 * s;
    pivot.add(mesh);
    rod('gold', V(hang.x, beamY, hang.z), V(hang.x, hang.y + 0.01, hang.z), 0.006);
    const center = hang.clone(); center.y -= (0.085 + 0.08) * s;
    const rx = makeReactor(pivot, 30, 2.2, 'bell');
    addPad({ id: 'bell' + i, label: `Bell ${i + 1}`, family: 'bell', kind: 'sphere', c: center, R: 0.088 * s, hitR: 0.088 * s, n: Z.clone(), u: V(1, 0, 0), v: V(0, 1, 0), reactor: rx, freq: BELL_F[i], low: 1 - i / 4, group: g });
  }

  // ── Gongs ─────────────────────────────────────────────────
  const gongGeo = (R, boss) => {
    const pts = [V(0, 0, 0)];
    const pp = [];
    pp.push(new THREE.Vector2(0.0005, boss ? 0.03 : 0.006));
    if (boss) { pp.push(new THREE.Vector2(R * 0.12, 0.028)); pp.push(new THREE.Vector2(R * 0.2, 0.004)); }
    pp.push(new THREE.Vector2(R * 0.85, 0.0)); pp.push(new THREE.Vector2(R * 0.95, -0.01)); pp.push(new THREE.Vector2(R, -0.04)); pp.push(new THREE.Vector2(R * 0.98, -0.045));
    void pts;
    const geo = new THREE.LatheGeometry(pp, 40); geo.rotateX(Math.PI / 2); // axis Y → Z: profile height maps to +Z
    // planar UVs from xy for the hammered texture
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * R), 0.5 + pos.getY(i) / (2 * R));
    return geo;
  };
  const gongFrame = (c, n, R, H) => {
    // two posts and a crossbar; gong hangs from the bar
    const g = frame(c, n);
    g.updateMatrix();
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    const top = c.y + R + 0.14;
    for (const sx of [-1, 1]) {
      const p = c.clone().addScaledVector(side, sx * (R + 0.08)).addScaledVector(n, -0.04);
      beam('red', V(p.x, 0, p.z), V(p.x, top + 0.05, p.z), 0.045);
      addStatic('wood', new THREE.BoxGeometry(0.22, 0.05, 0.22), mtx(p.x, 0.025, p.z, 0, Math.atan2(side.x, side.z)));
      addStatic('gold', new THREE.SphereGeometry(0.035, 8, 6), mtx(p.x, top + 0.08, p.z));
    }
    const a = c.clone().addScaledVector(side, -(R + 0.12)).addScaledVector(n, -0.04), b = c.clone().addScaledVector(side, R + 0.12).addScaledVector(n, -0.04);
    a.y = b.y = top; beam('red', a, b, 0.045);
    // cords
    for (const sx of [-0.5, 0.5]) {
      const cp = c.clone().addScaledVector(side, sx * R * 0.7).addScaledVector(n, -0.04);
      rod('dark', V(cp.x, top, cp.z), V(cp.x, c.y + R * 0.75, cp.z), 0.004, 4);
    }
    void H;
    return g;
  };
  const gongDef = (c, n, R, boss, id, label) => {
    const g = gongFrame(c, n, R);
    const pivot = new THREE.Group(); pivot.position.y = R + 0.1; g.add(pivot);
    const mesh = new THREE.Mesh(gongGeo(R, boss), mats.gong); mesh.position.y = -(R + 0.1);
    pivot.add(mesh);
    const rx = makeReactor(pivot, id === 'gong' ? 9 : 18, id === 'gong' ? 0.7 : 1.2, 'gong');
    return addPad({ id, label, family: 'gong', kind: 'disc', group: g, c: c.clone(), R, hitR: R * 1.02, reactor: rx });
  };
  {
    const c = polar(-66, 0.88, 1.12), n = V(-c.x, 0, -c.z).normalize(); n.y = 0.08; n.normalize();
    gongDef(c, n, 0.27, true, 'gong', 'Great Gong');
  }
  {
    const c = polar(63, 0.84, 1.2), n = V(-c.x, 0, -c.z).normalize(); n.y = 0.1; n.normalize();
    gongDef(c, n, 0.15, false, 'luo', 'Opera Gong');
  }

  // ── Cymbals on stands ─────────────────────────────────────
  const cymGeo = (R) => {
    const pp = [new THREE.Vector2(0.0005, 0.03), new THREE.Vector2(R * 0.12, 0.028), new THREE.Vector2(R * 0.24, 0.012), new THREE.Vector2(R * 0.6, 0.004), new THREE.Vector2(R, -0.008)];
    const geo = new THREE.LatheGeometry(pp, 36); geo.rotateX(Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * R), 0.5 + pos.getY(i) / (2 * R));
    return geo;
  };
  const cymDef = (c, R, id, label) => {
    const toward = V(-c.x, 0, -c.z).normalize();
    const n = V(0, 1, 0).addScaledVector(toward, 0.4).normalize();
    const g = frame(c, n, V(toward.x, 0, toward.z).negate());
    const pivot = new THREE.Group(); g.add(pivot);
    const mesh = new THREE.Mesh(cymGeo(R), mats.cym); pivot.add(mesh);
    // stand
    const base = V(c.x, 0, c.z);
    rod('dark', base, V(c.x, c.y - 0.03, c.z), 0.011);
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; rod('dark', V(c.x + Math.cos(a) * 0.2, 0, c.z + Math.sin(a) * 0.2), V(c.x, 0.32, c.z), 0.009, 5); }
    addStatic('gold', new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), mtx(c.x, c.y - 0.03, c.z));
    const rx = makeReactor(pivot, 140, 2.0, 'cym');
    return addPad({ id, label, family: 'cymbal', kind: 'disc', group: g, c: c.clone(), R, hitR: R * 1.02, reactor: rx });
  };
  cymDef(polar(-41, 0.76, 1.14), 0.19, 'cymL', 'Bo Cymbal');
  cymDef(polar(42, 0.8, 1.2), 0.22, 'cymR', 'Crash Cymbal');

  // ── Wooden fish (muyu) and temple block ────────────────────
  {
    const c = polar(-52, 0.5, 0.86);
    // round, slit wooden fish on a cushion stand
    const g = frame(c, V(-c.x, 0, -c.z).normalize(), UP);
    const pivot = new THREE.Group(); g.add(pivot);
    const fishGeo = new THREE.SphereGeometry(0.1, 20, 14); fishGeo.scale(1.1, 0.85, 1);
    const mesh = new THREE.Mesh(fishGeo, mats.fish); pivot.add(mesh);
    const slit = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.009, 5, 18, Math.PI * 1.1), mats.dark);
    slit.rotation.set(0, Math.PI / 2, Math.PI * 0.95); slit.position.set(0, -0.02, 0.0); slit.scale.set(1, 1, 1);
    pivot.add(slit);
    addStatic('red', new THREE.CylinderGeometry(0.09, 0.1, 0.05, 16), mtx(c.x, c.y - 0.1, c.z));
    rod('wood', V(c.x, 0, c.z), V(c.x, c.y - 0.12, c.z), 0.025);
    addStatic('wood', new THREE.CylinderGeometry(0.14, 0.16, 0.04, 12), mtx(c.x, 0.02, c.z));
    const rx = makeReactor(pivot, 120, 6, 'wood');
    addPad({ id: 'muyu', label: 'Wooden Fish', family: 'wood', kind: 'sphere', c: c.clone(), R: 0.1, hitR: 0.1, n: V(-c.x, 0, -c.z).normalize(), u: V(1, 0, 0), v: V(0, 1, 0), reactor: rx, group: g });
  }
  {
    const c = polar(53, 0.5, 0.88);
    const g = frame(c, V(-c.x, 0, -c.z).normalize(), UP);
    const pivot = new THREE.Group(); g.add(pivot);
    const blockGeo = new THREE.CapsuleGeometry(0.05, 0.12, 4, 12); blockGeo.rotateZ(Math.PI / 2); blockGeo.scale(1, 0.9, 1);
    const mesh = new THREE.Mesh(blockGeo, mats.block); pivot.add(mesh);
    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.008, 0.02), mats.dark); slit.position.set(0, -0.005, 0.045); pivot.add(slit);
    rod('wood', V(c.x, 0, c.z), V(c.x, c.y - 0.06, c.z), 0.02);
    addStatic('wood', new THREE.BoxGeometry(0.2, 0.03, 0.08), mtx(c.x, c.y - 0.055, c.z, 0, Math.atan2(-c.x, -c.z)));
    addStatic('wood', new THREE.CylinderGeometry(0.13, 0.15, 0.04, 12), mtx(c.x, 0.02, c.z));
    const rx = makeReactor(pivot, 160, 8, 'wood');
    addPad({ id: 'block', label: 'Temple Block', family: 'wood', kind: 'sphere', c: c.clone(), R: 0.075, hitR: 0.08, n: V(-c.x, 0, -c.z).normalize(), u: V(1, 0, 0), v: V(0, 1, 0), reactor: rx, group: g });
  }

  // merge statics
  for (const key of Object.keys(statics)) {
    if (!statics[key].length) continue;
    const merged = mergeGeometries(statics[key]);
    for (const gg of statics[key]) gg.dispose();
    const m = new THREE.Mesh(merged, mats[key]);
    m.matrixAutoUpdate = false;
    kitRoot.add(m);
  }

  for (const p of pads) {
    p.worldPos = new THREE.Vector3();
    p.qInv = p.group ? p.group.quaternion.clone().invert() : new THREE.Quaternion();
  }
  return { pads, reactors, mats };
}

// ── Reactions ───────────────────────────────────────────────
// hitN: kit-local direction the stick was moving (into the surface); lx, ly: hit offset in pad frame.
export function reactPad(pad, vel, lx, ly, hitDirKit) {
  if (pad.head) {
    const u = pad.head;
    // two ripple slots: reuse the older one
    if (u.uT.value > u.uT2.value) { u.uT.value = 0; u.uHit.value.set(lx, ly); u.uAmp.value = 0.004 + 0.016 * vel * (pad.R / 0.29); }
    else { u.uT2.value = 0; u.uHit2.value.set(lx, ly); u.uAmp2.value = 0.004 + 0.016 * vel * (pad.R / 0.29); }
  }
  const r = pad.reactor;
  if (!r) return;
  r.awake = true;
  if (r.kind === 'cym') {
    const R = pad.R, s = 2.4 + 6 * vel;
    r.vx += -(ly / R) * s * 0.5; // push the struck side down
    r.vy += (lx / R) * s * 0.5;
    r.vx = THREE.MathUtils.clamp(r.vx, -8, 8); r.vy = THREE.MathUtils.clamp(r.vy, -8, 8);
  } else {
    // pendulum: convert push direction into the pad's frame
    _v.copy(hitDirKit).applyQuaternion(pad.qInv);
    const s = (r.kind === 'gong' ? 0.9 : r.kind === 'bell' ? 2.2 : 1.2) * (0.3 + vel);
    r.vx += -_v.z * s;
    r.vz += _v.x * s;
    if (r.kind === 'gong') r.vy += (lx / pad.R) * 0.6 * s;
    if (r.kind === 'wood') { r.vx *= 0.6; r.vz *= 0.6; }
  }
}

export function updateReactors(reactors, pads, dt) {
  for (const r of reactors) {
    if (!r.awake) continue;
    const k = r.k, c = r.c;
    r.vx += (-k * r.rx - c * r.vx) * dt; r.rx += r.vx * dt;
    r.vy += (-k * r.ry - c * r.vy) * dt; r.ry += r.vy * dt;
    r.vz += (-k * r.rz - c * r.vz) * dt; r.rz += r.vz * dt;
    const lim = r.kind === 'wood' ? 0.12 : 0.6;
    r.rx = Math.max(-lim, Math.min(lim, r.rx)); r.rz = Math.max(-lim, Math.min(lim, r.rz)); r.ry = Math.max(-lim, Math.min(lim, r.ry));
    r.pivot.rotation.set(r.rx, r.ry, r.rz);
    if (Math.abs(r.rx) + Math.abs(r.ry) + Math.abs(r.rz) + 0.05 * (Math.abs(r.vx) + Math.abs(r.vy) + Math.abs(r.vz)) < 1e-4) { r.awake = false; r.pivot.rotation.set(0, 0, 0); r.rx = r.ry = r.rz = r.vx = r.vy = r.vz = 0; }
  }
  for (const p of pads) {
    if (!p.head) continue;
    p.head.uT.value += dt; p.head.uT2.value += dt;
    if (p.head.uT.value > 1.2) p.head.uAmp.value = 0;
    if (p.head.uT2.value > 1.2) p.head.uAmp2.value = 0;
  }
}

// ── Swept collision ─────────────────────────────────────────
// p0 → p1 in kit space. Fills `out` and returns the fraction along the segment, or -1.
export function sweepPad(pad, p0, p1, out) {
  if (pad.kind === 'disc') {
    const n = pad.n, c = pad.c;
    const d0 = (p0.x - c.x) * n.x + (p0.y - c.y) * n.y + (p0.z - c.z) * n.z;
    const d1 = (p1.x - c.x) * n.x + (p1.y - c.y) * n.y + (p1.z - c.z) * n.z;
    if (!(d0 > 0 && d1 <= 0)) return -1;
    const f = d0 / (d0 - d1);
    const hx = p0.x + (p1.x - p0.x) * f - c.x, hy = p0.y + (p1.y - p0.y) * f - c.y, hz = p0.z + (p1.z - p0.z) * f - c.z;
    const lx = hx * pad.u.x + hy * pad.u.y + hz * pad.u.z, ly = hx * pad.v.x + hy * pad.v.y + hz * pad.v.z;
    const rr = Math.hypot(lx, ly);
    if (rr > pad.hitR) return -1;
    out.lx = lx; out.ly = ly; out.r = rr / pad.R; out.depth = d0 - d1;
    out.hx = hx + c.x; out.hy = hy + c.y; out.hz = hz + c.z;
    return f;
  }
  const c = pad.c, R = pad.hitR;
  const mx = p0.x - c.x, my = p0.y - c.y, mz = p0.z - c.z;
  const cc = mx * mx + my * my + mz * mz - R * R;
  if (cc <= 0) return -1; // started inside
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const a = dx * dx + dy * dy + dz * dz; if (a < 1e-10) return -1;
  const b = mx * dx + my * dy + mz * dz;
  const disc = b * b - a * cc; if (disc < 0) return -1;
  const f = (-b - Math.sqrt(disc)) / a;
  if (f < 0 || f > 1) return -1;
  const hx = mx + dx * f, hy = my + dy * f, hz = mz + dz * f;
  const nx = hx / R, ny = hy / R, nz = hz / R;
  out.nx = nx; out.ny = ny; out.nz = nz;
  out.depth = -(dx * nx + dy * ny + dz * nz);
  out.lx = nx * pad.u.x + ny * pad.u.y + nz * pad.u.z; out.ly = ny;
  // horizontal angle away from the pad's front (for bells: sui vs gu)
  out.front = nx * pad.n.x + nz * pad.n.z;
  out.side = (nx * pad.n.z - nz * pad.n.x);
  out.r = Math.sqrt(Math.max(0, 1 - out.front * out.front));
  out.hx = hx + c.x; out.hy = hy + c.y; out.hz = hz + c.z;
  return f;
}

// Ray (origin o, dir d, kit space) vs pad. Returns distance or -1, fills out like sweepPad.
export function rayPad(pad, o, d, out, maxDist = 4) {
  _p1.copy(o).addScaledVector(d, maxDist);
  // reuse sweep logic: ray as a long segment
  const f = sweepPad(pad, o, _p1, out);
  return f < 0 ? -1 : f * maxDist;
}
const _p1 = new THREE.Vector3();

// ── Drumsticks ──────────────────────────────────────────────
export const STICK_LEN = 0.41;
export function makeStick() {
  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.0065, 0.0105, STICK_LEN - 0.02, 10, 1); shaft.rotateX(-Math.PI / 2); shaft.translate(0, 0, -(STICK_LEN - 0.02) / 2 + 0.06);
  const tip = new THREE.SphereGeometry(0.013, 10, 8); tip.translate(0, 0, -STICK_LEN + 0.07 + 0.0);
  const wrap = new THREE.CylinderGeometry(0.0125, 0.0125, 0.12, 10, 1); wrap.rotateX(-Math.PI / 2); wrap.translate(0, 0, 0.0);
  const butt = new THREE.SphereGeometry(0.012, 8, 6); butt.translate(0, 0, 0.06);
  const colorize = (g, hex) => {
    const c = new THREE.Color(hex); const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g.toNonIndexed();
  };
  parts.push(colorize(shaft, 0xc89a62), colorize(tip, 0xe6c48c), colorize(wrap, 0x9a1c14), colorize(butt, 0xd4a24a));
  const geo = mergeGeometries(parts);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.frustumCulled = false;
  return mesh;
}
// Tip position in grip space
export const STICK_TIP = new THREE.Vector3(0, 0, -STICK_LEN + 0.07);
void _q; void _m;
