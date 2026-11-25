import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { makeGlowTexture } from './assets.js';

// Night river: gradient sky, stars, moon, hills, riverside houses with lit windows, an arched bridge,
// hanging lantern strings, drifting river lanterns with reflections, a dock and glowing lanes.
// Everything reacts cheaply to `pulse` (0..1, decays after each kick/snare) via material colours.

export const WATER_Y = -0.32;
export const LANE_X = [-0.66, -0.22, 0.22, 0.66];

function vcol(geo, col) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
}

export function buildEnvironment(scene, { hitZ, spawnZ }) {
  const disposables = [];
  scene.background = new THREE.Color(0x070a1c);
  scene.fog = new THREE.Fog(0x120d2a, 30, 230);

  // Sky dome with vertex gradient
  const skyG = new THREE.SphereGeometry(500, 24, 14);
  {
    const p = skyG.attributes.position, c = new Float32Array(p.count * 3);
    const top = new THREE.Color(0x040615), mid = new THREE.Color(0x1a1440), hor = new THREE.Color(0x4a2550), tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 500;
      if (y > 0.25) tmp.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6)); else tmp.copy(hor).lerp(mid, Math.max(0, y / 0.25));
      c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
    }
    skyG.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const sky = new THREE.Mesh(skyG, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);

  // Stars
  {
    const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2, v = 0.08 + Math.random() * 0.92, r = 450;
      const y = Math.pow(v, 0.7);
      const h = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(u) * h * r; pos[i * 3 + 1] = y * r; pos[i * 3 + 2] = Math.sin(u) * h * r;
      const b = 0.4 + Math.random() * 0.6; col[i * 3] = b; col[i * 3 + 1] = b * 0.95; col[i * 3 + 2] = b * (0.8 + Math.random() * 0.3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false })));
  }

  // Moon + halo + reflection streak
  const glowTex = makeGlowTexture('rgba(255,240,210,1)', 'rgba(255,200,150,0.18)');
  const moonPos = new THREE.Vector3(-70, 95, -320);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(11, 32), new THREE.MeshBasicMaterial({ color: 0xfff1d6, fog: false, toneMapped: false }));
  moon.position.copy(moonPos); moon.lookAt(0, 1.6, 0); scene.add(moon);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0x8870a0 }));
  halo.position.copy(moonPos).multiplyScalar(1.01); halo.lookAt(0, 1.6, 0); scene.add(halo);
  const streakTex = makeGlowTexture('rgba(255,230,190,0.9)', 'rgba(255,200,150,0.25)');
  const streak = new THREE.Mesh(new THREE.PlaneGeometry(9, 140), new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, color: 0x806a60 }));
  streak.rotation.x = -Math.PI / 2; streak.position.set(-22, WATER_Y + 0.02, -110); streak.rotation.z = -0.2; scene.add(streak);

  // Hills: three silhouette rings
  {
    const noise = new ImprovedNoise(), geos = [];
    const layers = [[150, 30, 0x1a1838], [220, 50, 0x141230], [320, 80, 0x0f0d26]];
    for (const [R, Hm, colHex] of layers) {
      const seg = 90, pos = [], col = new THREE.Color(colHex);
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        const h0 = Hm * (0.35 + 0.65 * Math.abs(noise.noise(Math.cos(a0) * 2.5, Math.sin(a0) * 2.5, R))) ;
        const h1 = Hm * (0.35 + 0.65 * Math.abs(noise.noise(Math.cos(a1) * 2.5, Math.sin(a1) * 2.5, R)));
        const x0 = Math.sin(a0) * R, z0 = -Math.cos(a0) * R, x1 = Math.sin(a1) * R, z1 = -Math.cos(a1) * R;
        pos.push(x0, -2, z0, x1, -2, z1, x1, h1, z1, x0, -2, z0, x1, h1, z1, x0, h0, z0);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals(); geos.push(vcol(g, col));
    }
    scene.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  // Water with a scrolling ripple texture
  const waterTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
    x.fillStyle = '#0b1432'; x.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(${120 + Math.random() * 80},${110 + Math.random() * 60},${170 + Math.random() * 60},${0.05 + Math.random() * 0.12})`; x.fillRect(Math.random() * 128, Math.random() * 256, 8 + Math.random() * 40, 1 + Math.random() * 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 40); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(36, 500), new THREE.MeshBasicMaterial({ map: waterTex, color: 0xb0b8ff }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, WATER_Y, -230); scene.add(water);

  // Banks, embankment, houses with lit windows, poles: one merged vertex-coloured mesh
  const houseCols = [];
  {
    const geos = [];
    const ground = new THREE.Color(0x0d1220), stone = new THREE.Color(0x2a2a3c), wall = new THREE.Color(0x1d1a2c), roof = new THREE.Color(0x0b0a16), win = new THREE.Color(0xffb35a), win2 = new THREE.Color(0xff7a3a), wood = new THREE.Color(0x2a1a12);
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(120, 500); g.rotateX(-Math.PI / 2); g.translate(side * 78, 0.3, -230); geos.push(vcol(g, ground));
      const e = new THREE.BoxGeometry(1.2, 1.3, 500); e.translate(side * 18.4, -0.3, -230); geos.push(vcol(e, stone));
      let z = 6;
      while (z > -200) {
        const w = 4 + Math.random() * 4, d = 4 + Math.random() * 3, h = 3 + Math.random() * 4;
        const x = side * (22 + Math.random() * 4 + d / 2);
        const b = new THREE.BoxGeometry(d, h, w); b.translate(x, h / 2 + 0.3, z - w / 2); geos.push(vcol(b, wall));
        // roof: a flattened prism with flared eaves
        const r = new THREE.CylinderGeometry(0.01, d * 0.85, 1.6 + Math.random(), 4, 1); r.rotateY(Math.PI / 4); r.scale(1, 1, w / d * 1.1);
        r.translate(x, h + 0.3 + 0.7, z - w / 2); geos.push(vcol(r, roof));
        // windows facing the river
        const nw = Math.floor(w / 1.6);
        for (let i = 0; i < nw; i++) for (let fl = 0; fl < Math.floor(h / 2.2); fl++) {
          if (Math.random() < 0.35) continue;
          const wq = new THREE.PlaneGeometry(0.7, 0.9); wq.rotateY(-side * Math.PI / 2);
          wq.translate(x - side * (d / 2 + 0.02), 1.4 + fl * 2.2, z - 0.8 - i * 1.6);
          geos.push(vcol(wq, Math.random() < 0.6 ? win : win2));
        }
        houseCols.push({ x: side * 19.2, z: z - w / 2 });
        z -= w + 0.6 + Math.random() * 3;
      }
      // lantern-string poles along the embankment
      for (let z2 = 2; z2 > -120; z2 -= 12) {
        const p = new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6); p.translate(side * 17.9, 2.1, z2); geos.push(vcol(p, wood));
      }
    }
    // Arched bridge across the river
    const bz = -70, span = 40, rise = 9, seg = 28;
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg;
      const x0 = -span / 2 + u0 * span, x1 = -span / 2 + u1 * span;
      const y0 = Math.sin(u0 * Math.PI) * rise, y1 = Math.sin(u1 * Math.PI) * rise;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const bx = new THREE.BoxGeometry(len + 0.05, 1.2, 4); bx.rotateZ(Math.atan2(y1 - y0, x1 - x0)); bx.translate((x0 + x1) / 2, (y0 + y1) / 2, bz);
      geos.push(vcol(bx, stone));
      const rail = new THREE.BoxGeometry(len + 0.05, 0.12, 0.12); rail.rotateZ(Math.atan2(y1 - y0, x1 - x0));
      const rl = rail.clone(); rail.translate((x0 + x1) / 2, (y0 + y1) / 2 + 1.5, bz + 1.9); rl.translate((x0 + x1) / 2, (y0 + y1) / 2 + 1.5, bz - 1.9);
      geos.push(vcol(rail, wood), vcol(rl, wood));
      if (i % 2 === 0) {
        const post = new THREE.BoxGeometry(0.15, 0.9, 0.15); const post2 = post.clone();
        post.translate(x0, y0 + 1.0, bz + 1.9); post2.translate(x0, y0 + 1.0, bz - 1.9); geos.push(vcol(post, wood), vcol(post2, wood));
      }
    }
    // Player dock: planks
    for (let i = 0; i < 7; i++) {
      const pl = new THREE.BoxGeometry(0.34, 0.08, 2.6); pl.translate(-1.05 + i * 0.35, -0.04, 0.2);
      geos.push(vcol(pl, new THREE.Color().setHSL(0.07, 0.35, 0.12 + (i % 3) * 0.025)));
    }
    for (const sx of [-1.25, 1.25]) for (const sz of [-1.05, 1.45]) { const pst = new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8); pst.translate(sx, -0.3, sz); geos.push(vcol(pst, wood)); }
    scene.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }

  // Hanging lantern strings: small glowing lanterns (instanced) + wires
  const smallLantern = new THREE.SphereGeometry(0.22, 10, 8); smallLantern.scale(1, 1.2, 1);
  const hangMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const hangPts = [];
  for (const side of [-1, 1]) {
    for (let z2 = 2; z2 > -120; z2 -= 12) {
      for (let k = 1; k < 6; k++) {
        const f = k / 6, sag = Math.sin(f * Math.PI) * 0.9;
        hangPts.push([side * 17.9, 4.1 - sag - 0.35, z2 - f * 12]);
      }
    }
  }
  const hang = new THREE.InstancedMesh(smallLantern, hangMat, hangPts.length);
  {
    const m = new THREE.Matrix4(), c = new THREE.Color();
    hangPts.forEach((p, i) => { m.makeTranslation(p[0], p[1], p[2]); hang.setMatrixAt(i, m); hang.setColorAt(i, c.setHSL(0.02 + Math.random() * 0.06, 0.9, 0.55)); });
  }
  hang.frustumCulled = false; scene.add(hang);
  {
    const wp = [];
    for (const side of [-1, 1]) for (let z2 = 2; z2 > -120; z2 -= 12) {
      let px = side * 17.9, py = 4.1, pz = z2;
      for (let k = 1; k <= 6; k++) { const f = k / 6, sag = Math.sin(f * Math.PI) * 0.9; const nx = side * 17.9, ny = 4.1 - sag, nz = z2 - f * 12; wp.push(px, py, pz, nx, ny, nz); px = nx; py = ny; pz = nz; }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2a2030 })));
  }

  // Drifting river lanterns (lotus boxes) + their reflection streaks
  const NF = 70;
  const floatG = new THREE.CylinderGeometry(0.16, 0.2, 0.22, 6); floatG.translate(0, 0.11, 0);
  const floatMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const floats = new THREE.InstancedMesh(floatG, floatMat, NF); floats.frustumCulled = false;
  const reflG = new THREE.PlaneGeometry(0.5, 2.4); reflG.rotateX(-Math.PI / 2);
  const reflMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffffff, toneMapped: false });
  const refl = new THREE.InstancedMesh(reflG, reflMat, NF); refl.frustumCulled = false;
  const fl = [];
  const fc = new THREE.Color();
  for (let i = 0; i < NF; i++) {
    let x = (Math.random() * 2 - 1) * 16; if (Math.abs(x) < 3.2) x = Math.sign(x || 1) * (3.2 + Math.random() * 3);
    fl.push({ x, z: -Math.random() * 180 - 3, ph: Math.random() * 6, sp: 0.25 + Math.random() * 0.3 });
    fc.setHSL(0.03 + Math.random() * 0.1, 0.95, 0.5 + Math.random() * 0.15);
    floats.setColorAt(i, fc); refl.setColorAt(i, fc.multiplyScalar(0.5));
  }
  scene.add(floats, refl);

  // Rising embers
  const NE = 160;
  const emPos = new Float32Array(NE * 3), emSpd = new Float32Array(NE);
  for (let i = 0; i < NE; i++) { emPos[i * 3] = (Math.random() * 2 - 1) * 14; emPos[i * 3 + 1] = Math.random() * 10; emPos[i * 3 + 2] = -Math.random() * 60 - 2; emSpd[i] = 0.2 + Math.random() * 0.4; }
  const emG = new THREE.BufferGeometry(); emG.setAttribute('position', new THREE.BufferAttribute(emPos, 3));
  const emMat = new THREE.PointsMaterial({ size: 0.09, map: glowTex, color: 0xffa860, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const embers = new THREE.Points(emG, emMat); embers.frustumCulled = false; scene.add(embers);

  // Lanes: glowing strips on the water from the dock to the spawn point, left pair red, right pair blue
  const laneMats = [];
  for (let side = 0; side < 2; side++) {
    const geos = [];
    for (let l = side * 2; l < side * 2 + 2; l++) {
      for (const dx of [-0.21, 0.21]) {
        const s = new THREE.PlaneGeometry(0.025, -spawnZ + 2); s.rotateX(-Math.PI / 2); s.translate(LANE_X[l] + dx, WATER_Y + 0.03, (spawnZ - 2) / 2 - 0.5);
        geos.push(s);
      }
      const fill = new THREE.PlaneGeometry(0.4, -spawnZ + 2); fill.rotateX(-Math.PI / 2); fill.translate(LANE_X[l], WATER_Y + 0.025, (spawnZ - 2) / 2 - 0.5);
      geos.push(fill);
    }
    // fade along z via vertex colours (bright near player, dark far)
    const g = mergeGeometries(geos.map(x => { x.deleteAttribute('uv'); x.deleteAttribute('normal'); return x; }));
    const p = g.attributes.position, c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const f = Math.max(0, 1 + p.getZ(i) / (-spawnZ + 3));
      const strip = (i % 12) < 8 ? 1 : 0.18; // 4 verts per plane: first two planes of each lane are strips
      const v = f * strip; c[i * 3] = v; c[i * 3 + 1] = v; c[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: side ? 0x3aa8ff : 0xff4a3a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    laneMats.push(mat);
    scene.add(new THREE.Mesh(g, mat));
  }
  // hit line across the lanes
  const hitLine = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.05), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  hitLine.rotation.x = -Math.PI / 2; hitLine.position.set(0, WATER_Y + 0.035, hitZ); scene.add(hitLine);

  scene.add(new THREE.HemisphereLight(0x8890ff, 0x201018, 1.2));

  const laneBase = [new THREE.Color(0xff4a3a), new THREE.Color(0x3aa8ff)];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();
  const flash = [0, 0];
  return {
    flashSide(side, amt = 1) { flash[side] = Math.max(flash[side], amt); },
    update(dt, t, pulse, playing) {
      waterTex.offset.y += dt * 0.08;
      // lanes pulse to the beat, flash per side on hits
      for (let i = 0; i < 2; i++) {
        flash[i] = Math.max(0, flash[i] - dt * 4);
        const k = (playing ? 0.35 + 0.65 * pulse : 0.3) + flash[i] * 1.2;
        laneMats[i].color.copy(laneBase[i]).multiplyScalar(k);
      }
      hitLine.material.opacity = 0.25 + 0.5 * pulse;
      hangMat.color.setScalar(0.65 + 0.5 * pulse);
      floatMat.color.setScalar(0.75 + 0.35 * pulse);
      halo.material.color.setRGB(0.5 + 0.12 * pulse, 0.42 + 0.1 * pulse, 0.6 + 0.12 * pulse);
      emMat.size = 0.08 + 0.05 * pulse;
      for (let i = 0; i < NF; i++) {
        const f = fl[i];
        f.z += f.sp * dt; if (f.z > 4) { f.z = -180; }
        const bob = Math.sin(t * 1.3 + f.ph) * 0.03;
        e.set(Math.sin(t * 0.9 + f.ph) * 0.08, f.ph, Math.cos(t * 0.7 + f.ph) * 0.08); q.setFromEuler(e);
        v.set(f.x, WATER_Y + bob, f.z); m4.compose(v, q, s3); floats.setMatrixAt(i, m4);
        v.y = WATER_Y + 0.01; q.identity(); m4.compose(v, q, s3); m4.elements[14] = f.z + 1.0; refl.setMatrixAt(i, m4);
      }
      floats.instanceMatrix.needsUpdate = true; refl.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < NE; i++) {
        emPos[i * 3 + 1] += emSpd[i] * dt; emPos[i * 3] += Math.sin(t + i) * dt * 0.1;
        if (emPos[i * 3 + 1] > 12) emPos[i * 3 + 1] = WATER_Y;
      }
      emG.attributes.position.needsUpdate = true;
    },
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}
