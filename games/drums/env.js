import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FONTS } from '../../src/platform/kit.js';

// Wooden temple hall: plank floor, red pillars, lattice windows, hanging lanterns,
// incense burner with smoke and a light haze. Static geometry merged per material.

function tex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  return t;
}

// Small equirect environment for metal reflections: warm hall with lantern hot spots.
export function makeEnvMap() {
  const t = tex(256, 128, (x, W, H) => {
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2a1a10'); g.addColorStop(0.4, '#6a3a1c'); g.addColorStop(0.55, '#3a2212'); g.addColorStop(1, '#140c08');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 14; i++) {
      const px = (i / 14) * W + 6, py = H * (0.22 + 0.08 * Math.sin(i * 2.1));
      const rg = x.createRadialGradient(px, py, 0, px, py, 16);
      rg.addColorStop(0, 'rgba(255,200,120,1)'); rg.addColorStop(0.4, 'rgba(255,110,40,0.6)'); rg.addColorStop(1, 'rgba(255,80,20,0)');
      x.fillStyle = rg; x.fillRect(px - 16, py - 16, 32, 32);
    }
    // windows band
    x.fillStyle = 'rgba(255,190,110,0.35)';
    for (let i = 0; i < 6; i++) x.fillRect(i * W / 6 + 8, H * 0.42, W / 6 - 16, H * 0.12);
  });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function buildTemple(scene) {
  scene.background = new THREE.Color(0x120a06);
  scene.fog = new THREE.Fog(0x1a0f08, 6, 18);

  scene.add(new THREE.HemisphereLight(0xffd2a0, 0x2a160c, 1.1));
  const key = new THREE.PointLight(0xffb070, 9, 9, 1.6); key.position.set(0.3, 2.8, 0.2); scene.add(key);
  const rim = new THREE.PointLight(0xff7a3a, 6, 10, 1.6); rim.position.set(-1.2, 2.4, -2.4); scene.add(rim);
  const dir = new THREE.DirectionalLight(0xffe2b8, 0.6); dir.position.set(2, 4, 3); scene.add(dir);

  const W = 12, D = 12, H = 5, z0 = 4.5, z1 = -7.5; // hall extents
  const cx = 0, cz = (z0 + z1) / 2;

  // floor
  const floorTex = tex(512, 512, (x, w, h) => {
    const pw = h / 8;
    for (let i = 0; i < 8; i++) {
      const l = 38 + (i * 37 % 13);
      x.fillStyle = `hsl(24, 42%, ${l * 0.5}%)`; x.fillRect(0, i * pw, w, pw);
      for (let k = 0; k < 30; k++) { x.strokeStyle = `rgba(20,8,2,${Math.random() * 0.12})`; x.beginPath(); const y = i * pw + Math.random() * pw; x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y); x.stroke(); }
      x.fillStyle = 'rgba(10,4,0,0.6)'; x.fillRect(0, i * pw, w, 2);
      const off = (i * 197) % w; x.fillRect(off, i * pw, 2, pw);
    }
  }, { repeat: [6, 6] });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, cz); scene.add(floor);

  // rug under the kit
  const rugTex = tex(512, 512, (x, w) => {
    const c = w / 2;
    x.fillStyle = '#6e1410'; x.beginPath(); x.arc(c, c, c - 2, 0, 6.28); x.fill();
    x.strokeStyle = '#d2a446'; x.lineWidth = 10; x.beginPath(); x.arc(c, c, c - 18, 0, 6.28); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.arc(c, c, c - 36, 0, 6.28); x.stroke();
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * 6.28; x.save(); x.translate(c + Math.cos(a) * (c - 60), c + Math.sin(a) * (c - 60)); x.rotate(a);
      x.strokeStyle = 'rgba(210,164,70,0.8)'; x.lineWidth = 3; x.beginPath(); x.arc(0, 0, 10, 0, Math.PI); x.stroke(); x.restore();
    }
    x.strokeStyle = 'rgba(210,164,70,0.35)'; x.lineWidth = 2;
    for (let r = 40; r < c - 80; r += 26) { x.beginPath(); x.arc(c, c, r, 0, 6.28); x.stroke(); }
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.7, 48), new THREE.MeshLambertMaterial({ map: rugTex, transparent: true }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.004, -0.35); scene.add(rug);

  // walls: wainscot + lattice windows (emissive glow)
  const wallDraw = (x, w, h, glow) => {
    if (!glow) {
      x.fillStyle = '#3a1d10'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#5a1810'; x.fillRect(0, h * 0.72, w, h * 0.28);
      x.fillStyle = '#2a140a'; x.fillRect(0, h * 0.7, w, 8);
      x.fillStyle = '#7a2014';
      for (let i = 0; i < 4; i++) x.fillRect(i * w / 4, 0, 12, h);
    } else { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); }
    // windows
    for (let i = 0; i < 4; i++) {
      const wx = i * w / 4 + 34, ww = w / 4 - 56, wy = h * 0.2, wh = h * 0.42;
      if (glow) {
        const g = x.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, '#ffcf8a'); g.addColorStop(1, '#c86a28');
        x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
        x.strokeStyle = '#000'; x.lineWidth = 5;
        for (let k = 1; k < 8; k++) { x.beginPath(); x.moveTo(wx + k * ww / 8, wy); x.lineTo(wx + k * ww / 8, wy + wh); x.stroke(); }
        for (let k = 1; k < 10; k++) { x.beginPath(); x.moveTo(wx, wy + k * wh / 10); x.lineTo(wx + ww, wy + k * wh / 10); x.stroke(); }
        x.lineWidth = 3;
        for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(wx + ww / 2, wy + wh / 2, 10 + k * 14, 0, 6.28); x.stroke(); }
      } else { x.fillStyle = '#1a0a04'; x.fillRect(wx - 8, wy - 8, ww + 16, wh + 16); }
    }
  };
  const wallTex = tex(512, 256, (x, w, h) => wallDraw(x, w, h, false));
  const wallGlow = tex(512, 256, (x, w, h) => wallDraw(x, w, h, true));
  const walls = [];
  const wallPlane = (w, px, py, pz, ry) => { const g = new THREE.PlaneGeometry(w, H); g.rotateY(ry); g.translate(px, py, pz); walls.push(g); };
  wallPlane(W, cx, H / 2, z1, 0);
  wallPlane(W, cx, H / 2, z0, Math.PI);
  wallPlane(D, cx - W / 2, H / 2, cz, Math.PI / 2);
  wallPlane(D, cx + W / 2, H / 2, cz, -Math.PI / 2);
  const wallMesh = new THREE.Mesh(mergeGeometries(walls), new THREE.MeshLambertMaterial({ map: wallTex, emissiveMap: wallGlow, emissive: 0xffffff, emissiveIntensity: 0.9 }));
  scene.add(wallMesh);

  // ceiling + beams
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshLambertMaterial({ color: 0x24120a }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, H, cz); scene.add(ceil);
  const beams = [];
  for (let i = 0; i < 6; i++) { const b = new THREE.BoxGeometry(W, 0.28, 0.3); b.translate(cx, H - 0.3, z1 + 1 + i * 2.1); beams.push(b); }
  for (const sx of [-3.2, 3.2]) { const b = new THREE.BoxGeometry(0.3, 0.32, D); b.translate(sx, H - 0.6, cz); beams.push(b); }
  // altar table at the back
  { const b = new THREE.BoxGeometry(2.6, 0.12, 0.8); b.translate(0, 0.9, z1 + 0.7); beams.push(b);
    for (const sx of [-1.15, 1.15]) for (const sz of [0.4, 1.0]) { const l = new THREE.BoxGeometry(0.1, 0.9, 0.1); l.translate(sx, 0.45, z1 + sz); beams.push(l); } }
  const beamMesh = new THREE.Mesh(mergeGeometries(beams), new THREE.MeshLambertMaterial({ color: 0x3a1e10 }));
  scene.add(beamMesh);

  // pillars (instanced) + stone bases (instanced)
  const pillarPos = [[-3.2, 2.6], [3.2, 2.6], [-3.2, -1.2], [3.2, -1.2], [-3.2, -4.8], [3.2, -4.8], [-1.6, -6.6], [1.6, -6.6]];
  const pillarGeo = new THREE.CylinderGeometry(0.17, 0.19, H, 14);
  const pillars = new THREE.InstancedMesh(pillarGeo, new THREE.MeshLambertMaterial({ color: 0x8a1810 }), pillarPos.length);
  const baseGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.22, 12);
  const bases = new THREE.InstancedMesh(baseGeo, new THREE.MeshLambertMaterial({ color: 0x6a645a }), pillarPos.length);
  const m = new THREE.Matrix4();
  pillarPos.forEach(([x, z], i) => { m.makeTranslation(x, H / 2, z); pillars.setMatrixAt(i, m); m.makeTranslation(x, 0.11, z); bases.setMatrixAt(i, m); });
  scene.add(pillars, bases);

  // plaque above the altar
  const plaqueTex = tex(512, 192, (x, w, h) => {
    x.fillStyle = '#1a0d06'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#d2a446'; x.lineWidth = 10; x.strokeRect(10, 10, w - 20, h - 20);
    x.fillStyle = '#e8c060'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `120px ${FONTS.brush}`; x.fillText('雷 音 殿', w / 2, h / 2 + 6);
  });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), new THREE.MeshBasicMaterial({ map: plaqueTex, toneMapped: false, fog: false }));
  plaque.position.set(0, 3.5, z1 + 0.05); scene.add(plaque);

  // incense burner (ding) on the altar + incense sticks
  const dingPts = [];
  for (let i = 0; i <= 10; i++) { const s = i / 10; dingPts.push(new THREE.Vector2(0.18 + 0.08 * Math.sin(s * Math.PI) + (s > 0.9 ? 0.03 : 0), s * 0.32)); }
  const ding = new THREE.Mesh(new THREE.LatheGeometry(dingPts, 20), new THREE.MeshLambertMaterial({ color: 0x5a4a2a, emissive: 0x1a1006 }));
  ding.position.set(0, 0.96, z1 + 0.7); scene.add(ding);
  const sticks = [];
  for (let i = 0; i < 3; i++) { const g = new THREE.CylinderGeometry(0.004, 0.004, 0.4, 4); g.rotateZ((i - 1) * 0.08); g.translate((i - 1) * 0.04, 1.42, z1 + 0.7); sticks.push(g); }
  scene.add(new THREE.Mesh(mergeGeometries(sticks), new THREE.MeshBasicMaterial({ color: 0xff6020 })));

  // smoke + haze sprites (additive, drifting)
  const smokeTex = tex(128, 256, (x, w, h) => {
    for (let i = 0; i < 40; i++) {
      const y = h - i * h / 40, px = w / 2 + Math.sin(i * 0.5) * w * 0.18 * (i / 40);
      const r = 6 + i * 0.8;
      const g = x.createRadialGradient(px, y, 0, px, y, r);
      g.addColorStop(0, `rgba(255,235,210,${0.12 * (1 - i / 44)})`); g.addColorStop(1, 'rgba(255,235,210,0)');
      x.fillStyle = g; x.fillRect(px - r, y - r, r * 2, r * 2);
    }
  });
  const smokeMat = new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 0.9 });
  const smokeGeo = []; for (let i = 0; i < 2; i++) { const g = new THREE.PlaneGeometry(0.6, 1.8); g.rotateY(i * Math.PI / 2); smokeGeo.push(g); }
  const smoke = new THREE.Mesh(mergeGeometries(smokeGeo), smokeMat); smoke.position.set(0, 2.5, z1 + 0.7); scene.add(smoke);

  const hazeTex = tex(256, 256, (x, w, h) => {
    for (let i = 0; i < 70; i++) {
      const px = Math.random() * w, py = Math.random() * h, r = 20 + Math.random() * 50;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,220,180,0.06)'); g.addColorStop(1, 'rgba(255,220,180,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    }
  }, { repeat: [2, 2] });
  const hazeMat = new THREE.MeshBasicMaterial({ map: hazeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, fog: false });
  const hazeGeos = [];
  for (let i = 0; i < 3; i++) { const g = new THREE.PlaneGeometry(10, 4); g.translate(0, 2, -2 - i * 1.6); hazeGeos.push(g); }
  const haze = new THREE.Mesh(mergeGeometries(hazeGeos), hazeMat); haze.renderOrder = 2; scene.add(haze);

  // light shafts from the left windows
  const shaftTex = tex(64, 256, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,210,150,0.32)'); g.addColorStop(1, 'rgba(255,210,150,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    const s = x.createLinearGradient(0, 0, w, 0); s.addColorStop(0, 'rgba(0,0,0,1)'); s.addColorStop(0.5, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = s; x.fillRect(0, 0, w, h);
  });
  const shaftGeos = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.9, 5.5); g.translate(0, -2.75, 0); g.rotateZ(0.75); g.rotateY(Math.PI / 2 - 0.15);
    g.translate(-W / 2 + 0.05, 3.3, -4.2 + i * 2.8); shaftGeos.push(g);
  }
  const shafts = new THREE.Mesh(mergeGeometries(shaftGeos), new THREE.MeshBasicMaterial({ map: shaftTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  scene.add(shafts);

  // lanterns (instanced body, caps, tassels)
  const lanternPos = [];
  for (let i = 0; i < 5; i++) { lanternPos.push([-2.1, 3.3 - (i % 2) * 0.25, 2.2 - i * 2.2]); lanternPos.push([2.1, 3.3 - ((i + 1) % 2) * 0.25, 2.2 - i * 2.2]); }
  lanternPos.push([-0.9, 3.6, -3.4], [0.9, 3.6, -3.4]);
  const N = lanternPos.length;
  const bodyGeo = new THREE.SphereGeometry(0.24, 16, 12); bodyGeo.scale(1, 0.82, 1); bodyGeo.translate(0, -0.45, 0);
  const capA = new THREE.CylinderGeometry(0.11, 0.13, 0.06, 12); capA.translate(0, -0.22, 0);
  const capB = new THREE.CylinderGeometry(0.13, 0.11, 0.06, 12); capB.translate(0, -0.68, 0);
  const cord = new THREE.CylinderGeometry(0.006, 0.006, 0.2, 4); cord.translate(0, -0.1, 0);
  const capGeo = mergeGeometries([capA, capB, cord]);
  const tassel = new THREE.CylinderGeometry(0.03, 0.012, 0.22, 6); tassel.translate(0, -0.82, 0);
  const lanternBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xd8301c, emissive: 0xff4a1a, emissiveIntensity: 0.9 }), N);
  const lanternCap = new THREE.InstancedMesh(capGeo, new THREE.MeshLambertMaterial({ color: 0xc89a3a, emissive: 0x3a2000 }), N);
  const lanternTassel = new THREE.InstancedMesh(tassel, new THREE.MeshLambertMaterial({ color: 0xb01810, emissive: 0x300000 }), N);
  scene.add(lanternBody, lanternCap, lanternTassel);
  // lantern ropes to the ceiling, static
  const ropeGeos = lanternPos.map(([x, y, z]) => { const g = new THREE.CylinderGeometry(0.006, 0.006, H - y, 4); g.translate(x, y + (H - y) / 2, z); return g; });
  scene.add(new THREE.Mesh(mergeGeometries(ropeGeos), new THREE.MeshLambertMaterial({ color: 0x1a0a04 })));

  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1);
  function update(dt, t) {
    for (let i = 0; i < N; i++) {
      const L = lanternPos[i];
      e.set(Math.sin(t * 0.7 + i) * 0.04, t * 0.1 + i, Math.cos(t * 0.53 + i * 1.7) * 0.04);
      q.setFromEuler(e); p.set(L[0], L[1], L[2]);
      m.compose(p, q, s1);
      lanternBody.setMatrixAt(i, m); lanternCap.setMatrixAt(i, m); lanternTassel.setMatrixAt(i, m);
    }
    lanternBody.instanceMatrix.needsUpdate = lanternCap.instanceMatrix.needsUpdate = lanternTassel.instanceMatrix.needsUpdate = true;
    smokeTex.offset.x = Math.sin(t * 0.4) * 0.05; smoke.rotation.y = t * 0.15;
    smoke.position.x = Math.sin(t * 0.3) * 0.05; void cx;
    hazeTex.offset.x = t * 0.004; hazeTex.offset.y = Math.sin(t * 0.05) * 0.05;
    key.intensity = 9 + Math.sin(t * 7.1) * 0.25 + Math.sin(t * 13.3) * 0.15;
  }
  update(0, 0);
  return { update };
}
