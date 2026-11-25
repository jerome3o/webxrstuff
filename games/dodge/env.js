import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { FONTS } from '../../src/platform/kit.js';

// Mountain-top dojo: open pavilion over the player, a long wooden runway, a stone dais for the
// shadow sensei and a gate framing the sunset. Static parts are merged by material (vertex colours),
// so the whole environment costs ~9 draw calls.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

// Bake a geometry into a list for merging: non-indexed, position+normal+color only.
export function colorize(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, jitter = 0 } = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g === geo) g = geo.clone();
  geo.dispose();
  g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  _c.set(color);
  const j = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
  for (let i = 0; i < n; i++) { col[i * 3] = _c.r * j; col[i * 3 + 1] = _c.g * j; col[i * 3 + 2] = _c.b * j; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildEnvironment(scene) {
  scene.background = new THREE.Color(0x2b2a4a);
  scene.fog = new THREE.Fog(0xd99a7a, 35, 340);
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x40303a, 1.5));
  const sun = new THREE.DirectionalLight(0xffc48a, 1.6); sun.position.set(-8, 12, -20); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fb4ff, 0.7); fill.position.set(2, 5, 8); scene.add(fill);

  // ── Sky dome (gradient + low sun behind the gate) ──
  const skyTex = canvasTex(1024, 512, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#141a3a'); g.addColorStop(0.28, '#3a3566'); g.addColorStop(0.42, '#a8607a');
    g.addColorStop(0.49, '#f2a170'); g.addColorStop(0.52, '#e7a284'); g.addColorStop(0.62, '#6c5068'); g.addColorStop(1, '#2a2236');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const sx = W * 0.75, sy = H * 0.455;
    const rg = c.createRadialGradient(sx, sy, 4, sx, sy, 150);
    rg.addColorStop(0, 'rgba(255,240,200,1)'); rg.addColorStop(0.12, 'rgba(255,214,150,0.95)'); rg.addColorStop(0.4, 'rgba(255,160,100,0.25)'); rg.addColorStop(1, 'rgba(255,140,90,0)');
    c.fillStyle = rg; c.fillRect(sx - 160, sy - 160, 320, 320);
    // faint stars high up
    c.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 160; i++) { const x = Math.random() * W, y = Math.random() * H * 0.25; c.fillRect(x, y, 1.2, 1.2); }
    // wispy cloud bands
    c.globalAlpha = 0.18; c.fillStyle = '#ffd8c0';
    for (let i = 0; i < 26; i++) { const y = H * (0.36 + Math.random() * 0.1), x = Math.random() * W; c.beginPath(); c.ellipse(x, y, 60 + Math.random() * 120, 3 + Math.random() * 4, 0, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10; scene.add(sky);

  // ── Mountain ridges (three rings, fog does the aerial perspective) ──
  {
    const noise = new ImprovedNoise(), parts = [];
    const rings = [{ r: 70, h: 18, base: -40, col: '#2c2840', f: 3.1 }, { r: 140, h: 42, base: -60, col: '#4a3f5e', f: 2.2 }, { r: 240, h: 85, base: -80, col: '#6f5d78', f: 1.6 }];
    for (const [ri, R] of rings.entries()) {
      const N = 128, pos = [], col = [];
      _c.set(R.col); const top = _c.clone().offsetHSL(0, -0.05, 0.08);
      for (let i = 0; i < N; i++) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
        const hf = (a) => { let n = 0, amp = 1, fr = R.f; for (let o = 0; o < 4; o++) { n += Math.abs(noise.noise(Math.cos(a) * fr + ri * 10, Math.sin(a) * fr, ri * 3.7)) * amp; amp *= 0.5; fr *= 2.1; } return 3 + n * R.h; };
        const h0 = hf(a0), h1 = hf(a1);
        const x0 = Math.sin(a0) * R.r, z0 = -Math.cos(a0) * R.r, x1 = Math.sin(a1) * R.r, z1 = -Math.cos(a1) * R.r;
        pos.push(x0, R.base, z0, x1, R.base, z1, x1, h1, z1, x0, R.base, z0, x1, h1, z1, x0, h0, z0);
        for (const t of [0, 0, 1, 0, 1, 1]) { const cc = t ? top : _c; col.push(cc.r, cc.g, cc.b); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      parts.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    parts.forEach(p => p.dispose());
    scene.add(m);
  }

  // ── Lit static props (one merged mesh) ──
  const lit = [], glow = [];
  const L = (geo, col, o) => lit.push(colorize(geo, col, o));
  const G = (geo, col, o) => glow.push(colorize(geo, col, o));
  // cliff block under the deck
  L(new THREE.CylinderGeometry(7.5, 4, 26, 9, 3), '#4a4048', { y: -13.1, z: -8, sx: 0.9, sz: 1.9 });
  L(new THREE.DodecahedronGeometry(3.2, 0), '#5a4e55', { x: -6, y: -2.2, z: 1 });
  L(new THREE.DodecahedronGeometry(2.6, 0), '#544850', { x: 6.2, y: -1.8, z: -12 });
  // deck rim beams
  L(new THREE.BoxGeometry(0.25, 0.3, 22), '#4b2a1e', { x: -4.05, y: -0.12, z: -7.5 });
  L(new THREE.BoxGeometry(0.25, 0.3, 22), '#4b2a1e', { x: 4.05, y: -0.12, z: -7.5 });
  L(new THREE.BoxGeometry(8.3, 0.3, 0.25), '#4b2a1e', { y: -0.12, z: 3.5 });
  // runway
  L(new THREE.BoxGeometry(2.2, 0.02, 17.5), '#3a1f22', { y: 0.005, z: -7.3 });
  // pillars + beams
  const lacquer = '#8e2a22', beam = '#5a2a1c';
  for (const z of [2.8, -2.6, -8, -13.4]) for (const x of [-3.5, 3.5]) {
    L(new THREE.CylinderGeometry(0.13, 0.15, 3.9, 10), lacquer, { x, y: 1.95, z });
    L(new THREE.CylinderGeometry(0.24, 0.26, 0.2, 10), '#6d6066', { x, y: 0.1, z });
  }
  for (const x of [-3.5, 3.5]) L(new THREE.BoxGeometry(0.22, 0.3, 16.8), beam, { x, y: 3.95, z: -5.3 });
  for (const z of [2.8, -2.6]) L(new THREE.BoxGeometry(7.4, 0.28, 0.22), beam, { y: 3.95, z });
  // roof over the player: two slopes + ridge
  L(new THREE.BoxGeometry(4.3, 0.12, 7.6), '#2a2830', { x: -2.0, y: 4.45, z: 0.1, rz: 0.28 });
  L(new THREE.BoxGeometry(4.3, 0.12, 7.6), '#2a2830', { x: 2.0, y: 4.45, z: 0.1, rz: -0.28 });
  L(new THREE.BoxGeometry(0.3, 0.3, 7.9), '#1e1c22', { y: 5.05, z: 0.1 });
  // eave tips
  for (const s of [-1, 1]) for (const z of [-3.7, 3.9]) L(new THREE.ConeGeometry(0.12, 0.6, 6), '#1e1c22', { x: s * 4.1, y: 4.0, z, rz: -s * 2.1 });
  // sensei dais
  L(new THREE.CylinderGeometry(1.7, 1.9, 0.3, 24), '#6b6268', { y: 0.15, z: -19 });
  L(new THREE.CylinderGeometry(2.1, 2.3, 0.15, 24), '#4f474e', { y: 0.075, z: -19 });
  L(new THREE.BoxGeometry(14, 0.3, 10), '#4a4048', { y: -0.15, z: -22.5 });
  // gate behind the sensei
  for (const x of [-4.4, 4.4]) { L(new THREE.CylinderGeometry(0.28, 0.32, 8, 10), lacquer, { x, y: 4, z: -25 }); L(new THREE.BoxGeometry(0.9, 0.5, 0.9), '#3a3238', { x, y: 0.25, z: -25 }); }
  L(new THREE.BoxGeometry(11.5, 0.45, 0.6), '#2a1e22', { y: 8.1, z: -25 });
  L(new THREE.BoxGeometry(10, 0.35, 0.45), lacquer, { y: 6.9, z: -25 });
  L(new THREE.BoxGeometry(12.4, 0.18, 1.0), '#1e1c22', { y: 8.42, z: -25 });
  // training dummies + weapon rack at the deck sides (decor)
  for (const [x, z] of [[-2.8, -4.5], [2.8, -10.5]]) {
    L(new THREE.CylinderGeometry(0.16, 0.18, 1.7, 10), '#6b4630', { x, y: 0.85, z });
    for (const [y, ry] of [[1.25, 0.4], [1.0, -0.6], [0.7, 1.2]]) L(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), '#5a3a26', { x: x + Math.sin(ry) * 0.25 * (x < 0 ? 1 : -1), y, z: z + Math.cos(ry) * 0.2, rz: Math.PI / 2, ry });
  }
  // bamboo groves on both sides
  const rnd = mulberry(7);
  for (let i = 0; i < 70; i++) {
    const side = i % 2 ? 1 : -1, x = side * (4.8 + rnd() * 3.5), z = 4 - rnd() * 26, h = 5 + rnd() * 4, r = 0.035 + rnd() * 0.035;
    const lean = (rnd() - 0.5) * 0.12;
    L(new THREE.CylinderGeometry(r, r * 1.1, h, 6), rnd() < 0.5 ? '#6f8a3a' : '#5d7a34', { x, y: h / 2 - 0.4, z, rz: lean, jitter: 0.25 });
    if (rnd() < 0.6) L(new THREE.IcosahedronGeometry(0.5 + rnd() * 0.5, 0), '#3f5a2a', { x: x - Math.sin(lean) * h, y: h - 0.6, z, sy: 1.6, jitter: 0.3 });
  }
  // stone path lanterns at deck corners (bodies)
  for (const [x, z] of [[-3.0, 2.2], [3.0, 2.2], [-3.0, -16], [3.0, -16]]) {
    L(new THREE.CylinderGeometry(0.09, 0.14, 0.7, 6), '#77707a', { x, y: 0.35, z });
    L(new THREE.ConeGeometry(0.28, 0.2, 6), '#5d565f', { x, y: 1.05, z });
    G(new THREE.BoxGeometry(0.26, 0.26, 0.26), '#ffcf7a', { x, y: 0.83, z });
  }
  // hanging paper lanterns
  for (const z of [-5.3, -10.7, -15]) for (const x of [-3.1, 3.1]) {
    G(new THREE.SphereGeometry(0.2, 10, 8), '#ff8a4a', { x, y: 3.1, z, sy: 1.25 });
    L(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 3), '#222', { x, y: 3.6, z });
  }
  for (const x of [-1.8, 1.8]) G(new THREE.SphereGeometry(0.18, 10, 8), '#ff9050', { x, y: 3.4, z: -2.6, sy: 1.25 });
  const litMesh = new THREE.Mesh(mergeGeometries(lit), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const glowMesh = new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true }));
  lit.forEach(g => g.dispose()); glow.forEach(g => g.dispose());
  scene.add(litMesh, glowMesh);

  // ── Wooden deck (texture) ──
  const deckTex = canvasTex(512, 512, (c, W, H) => {
    const n = 8, pw = W / n;
    for (let i = 0; i < n; i++) {
      const l = 30 + Math.random() * 10;
      c.fillStyle = `hsl(24, 38%, ${l}%)`; c.fillRect(i * pw, 0, pw, H);
      c.strokeStyle = 'rgba(30,15,8,0.12)';
      for (let k = 0; k < 14; k++) { const x = i * pw + Math.random() * pw; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 6, H * 0.3, x - 6, H * 0.6, x + 3, H); c.stroke(); }
      c.fillStyle = 'rgba(20,10,5,0.7)'; c.fillRect(i * pw, 0, 2, H);
      const cut = Math.random() * H; c.fillRect(i * pw, cut, pw, 2);
    }
  });
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping; deckTex.repeat.set(4, 11);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(8, 22), new THREE.MeshLambertMaterial({ map: deckTex }));
  deck.rotation.x = -Math.PI / 2; deck.position.set(0, 0, -7.5); scene.add(deck);

  // ── Glowing runway inlays (pulse with the beat) ──
  const laneMat = new THREE.MeshBasicMaterial({ color: 0xff7040, transparent: true, opacity: 0.9, toneMapped: false });
  {
    const parts = [];
    for (const x of [-1.15, 1.15]) parts.push(colorize(new THREE.BoxGeometry(0.05, 0.012, 17.3), '#ffffff', { x, y: 0.012, z: -7.2 }));
    for (let i = 0; i < 9; i++) parts.push(colorize(new THREE.BoxGeometry(2.3, 0.012, 0.03), '#ffffff', { y: 0.012, z: -1.5 - i * 1.8 }));
    const g = mergeGeometries(parts); parts.forEach(p => p.dispose()); g.deleteAttribute('color');
    scene.add(new THREE.Mesh(g, laneMat));
  }

  // ── Gate plaque ──
  {
    const tex = canvasTex(512, 256, (c, W, H) => {
      c.fillStyle = '#1a1416'; c.fillRect(0, 0, W, H);
      c.strokeStyle = '#e2b85c'; c.lineWidth = 10; c.strokeRect(14, 14, W - 28, H - 28);
      c.fillStyle = '#e2b85c'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `150px ${FONTS.brush}`; c.fillText('避 拳', W / 2, H / 2 + 8);
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: tex }));
    plaque.position.set(0, 7.5, -24.65); scene.add(plaque);
  }

  return {
    laneMat,
    update(beatPhase, energy) {
      // beatPhase 0..1 within the beat; flash right after the downbeat
      const k = Math.exp(-beatPhase * 6) * energy;
      laneMat.color.setRGB(0.55 + 0.9 * k, 0.25 + 0.4 * k, 0.12 + 0.2 * k);
    },
  };
}

export function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
