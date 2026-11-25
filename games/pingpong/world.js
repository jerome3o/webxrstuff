import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, TOP, HL, HW, THICK, NET_H, NET_HALF } from './physics.js';

// ── The hall: an old gymnasium at dusk, lit by pendant lamps ──
// Everything static is merged into a handful of meshes; no shadow maps (the ball gets a blob shadow).

const HALL_W = 18, HALL_L = 26, HALL_H = 7.5;

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function mergeColored(parts) {
  const g = mergeGeometries(parts); for (const p of parts) p.dispose(); return g;
}

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x120e16);
  scene.fog = new THREE.Fog(0x1a1420, 14, 34);

  // ── Lights: warm hemisphere + one key light + a spot over the table (no shadows) ──
  scene.add(new THREE.HemisphereLight(0xffe2c4, 0x2a2232, 1.05));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.3); key.position.set(1.5, 6, 2.5); scene.add(key, key.target);
  const spot = new THREE.SpotLight(0xffd9a8, 26, 12, 0.75, 0.6, 1.6); spot.position.set(0, 5.2, 0); spot.target.position.set(0, 0, 0);
  scene.add(spot, spot.target);

  // ── Floor: honey-coloured boards with a burgundy court mat and a baked light pool ──
  const floorTex = canvasTex(1024, 1024, (c, W, H) => {
    const rnd = rand(7);
    const plankW = W / 40;
    for (let i = 0; i < 40; i++) {
      const l = 0.32 + rnd() * 0.08;
      c.fillStyle = `hsl(${28 + rnd() * 6}, ${42 + rnd() * 10}%, ${l * 100 * 0.9}%)`;
      c.fillRect(i * plankW, 0, plankW, H);
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(i * plankW, 0, 1.5, H);
      for (let k = 0; k < 4; k++) { const y = rnd() * H; c.fillRect(i * plankW, y, plankW, 1.5); }
    }
    // court mat: 7 m x 13 m of the 18 x 26 hall
    const mx = W * (0.5 - 3.5 / HALL_W), mw = W * (7 / HALL_W), my = H * (0.5 - 6.8 / HALL_L), mh = H * (13.6 / HALL_L);
    c.fillStyle = '#5a1f26'; c.fillRect(mx, my, mw, mh);
    c.strokeStyle = 'rgba(240,220,190,0.55)'; c.lineWidth = 3; c.strokeRect(mx + 6, my + 6, mw - 12, mh - 12);
    // light pool
    const g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.42);
    g.addColorStop(0, 'rgba(255,225,180,0.30)'); g.addColorStop(0.45, 'rgba(255,200,150,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL_W, HALL_L), new THREE.MeshLambertMaterial({ map: floorTex }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  // ── Walls: dark wood wainscot, plaster above (one mesh) ──
  const wallTex = canvasTex(512, 512, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3a2c2e'); g.addColorStop(0.55, '#7a5f52'); g.addColorStop(0.78, '#8a6a58'); g.addColorStop(0.8, '#2c1d16'); g.addColorStop(1, '#3b271c');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.25)'; for (let x = 0; x < W; x += 64) c.fillRect(x, H * 0.8, 3, H * 0.2);
    c.fillStyle = 'rgba(255,230,200,0.12)'; c.fillRect(0, H * 0.795, W, 4);
  }, { repeat: null });
  wallTex.wrapS = THREE.RepeatWrapping;
  const wallParts = [];
  const addWall = (w, cx, cz, ry) => {
    const g = new THREE.PlaneGeometry(w, HALL_H); const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / 4);
    g.rotateY(ry); g.translate(cx, HALL_H / 2, cz); wallParts.push(g);
  };
  addWall(HALL_W, 0, -HALL_L / 2, 0); addWall(HALL_W, 0, HALL_L / 2, Math.PI);
  addWall(HALL_L, -HALL_W / 2, 0, Math.PI / 2); addWall(HALL_L, HALL_W / 2, 0, -Math.PI / 2);
  const walls = new THREE.Mesh(mergeGeometries(wallParts), new THREE.MeshLambertMaterial({ map: wallTex }));
  wallParts.forEach(g => g.dispose());
  scene.add(walls);

  // ── Dusk windows (unlit, one mesh): far wall + both long walls ──
  const skyTex = canvasTex(512, 256, (c, W, H) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b1f4a'); g.addColorStop(0.35, '#4a3170'); g.addColorStop(0.62, '#c0576a'); g.addColorStop(0.8, '#f29a5c'); g.addColorStop(0.9, '#ffc27a');
    g.addColorStop(1, '#ffd79a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const rnd = rand(3);
    // a far skyline + trees
    c.fillStyle = '#1c1428';
    for (let x = 0; x < W;) { const w = 10 + rnd() * 30, h = 10 + rnd() * 40; c.fillRect(x, H - h, w, h); x += w; }
    c.fillStyle = '#140f1c';
    for (let i = 0; i < 26; i++) { const x = rnd() * W, r = 8 + rnd() * 16; c.beginPath(); c.arc(x, H - 4, r, 0, Math.PI * 2); c.fill(); }
    // first stars
    c.fillStyle = 'rgba(255,255,255,0.8)'; for (let i = 0; i < 40; i++) c.fillRect(rnd() * W, rnd() * H * 0.35, 1.2, 1.2);
    // mullions
    c.fillStyle = '#1a1210';
    for (let x = 0; x <= W; x += W / 4) c.fillRect(x - 3, 0, 6, H);
    c.fillRect(0, H * 0.45 - 3, W, 6); c.fillRect(0, 0, W, 6); c.fillRect(0, H - 6, W, 6);
  });
  const winParts = [];
  const addWin = (w, h, cx, cy, cz, ry) => { const g = new THREE.PlaneGeometry(w, h); g.rotateY(ry); g.translate(cx, cy, cz); winParts.push(g); };
  for (let i = -1; i <= 1; i++) addWin(4.2, 2.6, i * 5.2, 4.3, -HALL_L / 2 + 0.02, 0);
  for (let i = -2; i <= 2; i++) { addWin(3.6, 2.2, -HALL_W / 2 + 0.02, 4.7, i * 4.8, Math.PI / 2); addWin(3.6, 2.2, HALL_W / 2 - 0.02, 4.7, i * 4.8, -Math.PI / 2); }
  const windows = new THREE.Mesh(mergeGeometries(winParts), new THREE.MeshBasicMaterial({ map: skyTex, fog: false }));
  winParts.forEach(g => g.dispose());
  scene.add(windows);

  // ── Ceiling + beams (vertex colours) and pendant lamps ──
  const ceilParts = [];
  { const g = new THREE.PlaneGeometry(HALL_W, HALL_L); g.rotateX(Math.PI / 2); g.translate(0, HALL_H, 0); ceilParts.push(colored(g, 0x241a1c)); }
  for (let z = -12; z <= 12; z += 3) { const b = new THREE.BoxGeometry(HALL_W, 0.35, 0.25); b.translate(0, HALL_H - 0.18, z); ceilParts.push(colored(b, 0x3a2618)); }
  // benches along the long walls
  for (const sx of [-1, 1]) for (let z = -9; z <= 9; z += 4.5) {
    const seat = new THREE.BoxGeometry(0.45, 0.06, 3.2); seat.translate(sx * (HALL_W / 2 - 0.8), 0.45, z); ceilParts.push(colored(seat, 0x6b4428));
    for (const dz of [-1.4, 1.4]) { const leg = new THREE.BoxGeometry(0.4, 0.45, 0.06); leg.translate(sx * (HALL_W / 2 - 0.8), 0.225, z + dz); ceilParts.push(colored(leg, 0x2b2b30)); }
  }
  // court surrounds (low barriers) — draw them with a canvas texture below instead
  const ceiling = new THREE.Mesh(mergeColored(ceilParts), new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(ceiling);

  const lampParts = [], lampGlow = [];
  const lampAt = (x, y, z, r) => {
    const shade = new THREE.CylinderGeometry(r * 0.25, r, r * 0.7, 20, 1, true); shade.translate(x, y, z); lampParts.push(colored(shade, 0x1f3a34));
    const cord = new THREE.CylinderGeometry(0.008, 0.008, HALL_H - y, 4); cord.translate(x, y + (HALL_H - y) / 2, z); lampParts.push(colored(cord, 0x111111));
    const glow = new THREE.CircleGeometry(r * 0.92, 20); glow.rotateX(Math.PI / 2); glow.translate(x, y - r * 0.3, z); lampGlow.push(glow);
  };
  lampAt(0, 3.4, -0.9, 0.38); lampAt(0, 3.4, 0.9, 0.38);
  for (const sx of [-1, 1]) for (let z = -9; z <= 9; z += 6) lampAt(sx * 5, 4.6, z, 0.3);
  const lamps = new THREE.Mesh(mergeColored(lampParts), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const glows = new THREE.Mesh(mergeGeometries(lampGlow), new THREE.MeshBasicMaterial({ color: 0xffe2b0, side: THREE.DoubleSide }));
  lampGlow.forEach(g => g.dispose());
  scene.add(lamps, glows);

  // ── Court surrounds with painted lettering (one mesh) ──
  const surTex = canvasTex(1024, 128, (c, W, H) => {
    c.fillStyle = '#16233a'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e2b85c'; c.fillRect(0, 6, W, 4); c.fillRect(0, H - 10, W, 4);
    c.font = `600 54px "Inter", system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#f1e6cf'; c.fillText('PADDLE DUEL', W * 0.3, H / 2 + 2);
    c.fillStyle = '#7fb6e8'; c.fillText('·  DUSK  OPEN  ·', W * 0.74, H / 2 + 2);
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(W * 0.53, H / 2, 16, 0, Math.PI * 2); c.fill();
  });
  const surParts = [];
  const sx0 = 3.4, sz0 = 6.6, sh = 0.7;
  const addSur = (len, cx, cz, ry) => {
    for (let s = -len / 2; s < len / 2 - 0.01; s += 2.2) {
      const w = Math.min(2.2, len / 2 - s) - 0.06;
      const g = new THREE.PlaneGeometry(w, sh); g.translate(s + w / 2, sh / 2, 0); g.rotateY(ry); g.translate(cx, 0, cz); surParts.push(g);
    }
  };
  addSur(sx0 * 2, 0, -sz0, 0); addSur(sx0 * 2, 0, sz0, Math.PI);
  addSur(sz0 * 2, -sx0, 0, Math.PI / 2); addSur(sz0 * 2, sx0, 0, -Math.PI / 2);
  const surrounds = new THREE.Mesh(mergeGeometries(surParts), new THREE.MeshLambertMaterial({ map: surTex, side: THREE.DoubleSide }));
  surParts.forEach(g => g.dispose());
  scene.add(surrounds);

  // ── Table ──
  const topTex = canvasTex(512, 1024, (c, W, H) => {
    c.fillStyle = '#1d4f86'; c.fillRect(0, 0, W, H);
    const rnd = rand(11); c.fillStyle = 'rgba(255,255,255,0.025)'; for (let i = 0; i < 3000; i++) c.fillRect(rnd() * W, rnd() * H, 2, 2);
    const lw = W * 0.02 / 1.525;          // 2 cm white edges
    c.fillStyle = '#f4f2ec';
    c.fillRect(0, 0, W, lw * 1.9); c.fillRect(0, H - lw * 1.9, W, lw * 1.9);
    c.fillRect(0, 0, lw * 1.9, H); c.fillRect(W - lw * 1.9, 0, lw * 1.9, H);
    c.fillRect(W / 2 - lw * 0.3, 0, lw * 0.6, H);   // 3 mm centre line (doubles)
  });
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, THICK, HL * 2), new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.55, metalness: 0.0 }));
  tableTop.position.y = TOP - THICK / 2; scene.add(tableTop);

  const frameParts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.BoxGeometry(0.05, TOP - THICK, 0.05); leg.translate(sx * (HW - 0.18), (TOP - THICK) / 2, sz * (HL - 0.35)); frameParts.push(colored(leg, 0x26272c));
    const foot = new THREE.BoxGeometry(0.4, 0.04, 0.07); foot.translate(sx * (HW - 0.18), 0.02, sz * (HL - 0.35)); frameParts.push(colored(foot, 0x18181b));
  }
  for (const sz of [-1, 1]) { const b = new THREE.BoxGeometry(HW * 2 - 0.3, 0.06, 0.05); b.translate(0, TOP - THICK - 0.04, sz * (HL - 0.35)); frameParts.push(colored(b, 0x26272c)); }
  { const b = new THREE.BoxGeometry(0.06, 0.06, HL * 2 - 0.5); b.translate(0, TOP - THICK - 0.04, 0); frameParts.push(colored(b, 0x26272c)); }
  { const apron = new THREE.BoxGeometry(HW * 2 - 0.04, 0.05, HL * 2 - 0.04); apron.translate(0, TOP - THICK - 0.025, 0); frameParts.push(colored(apron, 0x14263c)); }
  // net posts + clamps
  for (const sx of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.02, 8); post.translate(sx * (NET_HALF + 0.012), TOP + NET_H / 2, 0); frameParts.push(colored(post, 0x1b1b1f));
    const clamp = new THREE.BoxGeometry(0.06, 0.05, 0.05); clamp.translate(sx * (HW + 0.03), TOP - 0.01, 0); frameParts.push(colored(clamp, 0x1b1b1f));
    const arm = new THREE.BoxGeometry(NET_HALF - HW + 0.02, 0.015, 0.02); arm.translate(sx * (HW + (NET_HALF - HW) / 2), TOP + 0.008, 0); frameParts.push(colored(arm, 0x1b1b1f));
  }
  const frame = new THREE.Mesh(mergeColored(frameParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }));
  scene.add(frame);

  const netTex = canvasTex(512, 64, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    c.strokeStyle = 'rgba(20,24,34,0.95)'; c.lineWidth = 1.6;
    for (let x = 0; x <= W; x += 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y <= H; y += 5) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#f4f2ec'; c.fillRect(0, 0, W, 7);
  });
  const net = new THREE.Mesh(new THREE.PlaneGeometry(NET_HALF * 2, NET_H), new THREE.MeshLambertMaterial({ map: netTex, transparent: false, alphaTest: 0.4, side: THREE.DoubleSide }));
  net.position.set(0, TOP + NET_H / 2, 0); scene.add(net);

  // ── Scoreboard frame on the far wall + stand ──
  return { floor, tableTop, net };
}

// ── Ball + blob shadow + trail ───────────────────────────────
export function makeBallVisuals(scene) {
  const ballTex = canvasTex(128, 64, (c, W, H) => {
    c.fillStyle = '#fbf6ec'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#e9e1d2'; c.fillRect(0, H / 2 - 1, W, 2);           // seam
    c.fillStyle = '#d0402e'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('★★', W * 0.25, H * 0.32);                                   // logo, makes spin visible
    c.fillRect(W * 0.7, H * 0.25, 10, 6);
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45, emissive: 0x3a3226, emissiveIntensity: 1 }));
  scene.add(ball);
  const shadowTex = canvasTex(64, 64, (c, W, H) => {
    const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(0.5, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }, { srgb: false });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 2;
  scene.add(shadow);
  // trail: a short fading line strip
  const N = 14;
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const col = new Float32Array(N * 4); for (let i = 0; i < N; i++) { col[i * 4] = 1; col[i * 4 + 1] = 0.95; col[i * 4 + 2] = 0.85; col[i * 4 + 3] = (1 - i / (N - 1)) * 0.55; }
  tGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  trail.frustumCulled = false;
  scene.add(trail);
  return { ball, shadow, trail, trailN: N };
}

// ── The opponent: a hovering practice bot with a head, torso and paddle arm ──
export function makeBot(scene, paddleMesh) {
  const root = new THREE.Group();
  const bodyParts = [];
  { const t = new THREE.CapsuleGeometry(0.19, 0.42, 6, 14); t.scale(1, 1, 0.7); t.translate(0, 1.12, 0); bodyParts.push(colored(t, 0x2a6fb0)); }
  { const s = new THREE.CylinderGeometry(0.21, 0.17, 0.12, 16); s.translate(0, 0.78, 0); bodyParts.push(colored(s, 0xe8e3d8)); }
  { const n = new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10); n.translate(0, 1.47, 0); bodyParts.push(colored(n, 0x30333a)); }
  { const sh = new THREE.BoxGeometry(0.56, 0.1, 0.2); sh.translate(0, 1.36, 0); bodyParts.push(colored(sh, 0xe8e3d8)); }
  { const st = new THREE.BoxGeometry(0.4, 0.05, 0.02); st.translate(0, 1.18, 0.14); bodyParts.push(colored(st, 0xe2b85c)); }
  { const hv = new THREE.CylinderGeometry(0.16, 0.06, 0.24, 16); hv.translate(0, 0.6, 0); bodyParts.push(colored(hv, 0x30333a)); }
  const body = new THREE.Mesh(mergeColored(bodyParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 }));
  root.add(body);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.5, depthWrite: false }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; root.add(glow);

  const head = new THREE.Group(); head.position.y = 1.62; root.add(head);
  const headParts = [];
  { const h = new THREE.SphereGeometry(0.14, 18, 12); h.scale(1, 0.92, 1); headParts.push(colored(h, 0xe8e3d8)); }
  { const v = new THREE.SphereGeometry(0.125, 18, 10, -Math.PI * 0.35, Math.PI * 0.7, Math.PI * 0.32, Math.PI * 0.3); v.scale(1.04, 1, 1.06); headParts.push(colored(v, 0x15181f)); }
  const headMesh = new THREE.Mesh(mergeColored(headParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2 }));
  head.add(headMesh);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.01), new THREE.MeshBasicMaterial({ color: 0x7fe8ff }));
  eyes.position.set(0, 0.005, 0.133); head.add(eyes);

  // arm: unit cylinder along +Y scaled between shoulder and hand each frame
  const armGeo = new THREE.CylinderGeometry(0.035, 0.03, 1, 8); armGeo.translate(0, 0.5, 0);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x30333a, roughness: 0.5, metalness: 0.3 });
  const arm = new THREE.Mesh(armGeo, armMat); scene.add(arm);
  const offArm = new THREE.Mesh(armGeo, armMat); scene.add(offArm);
  scene.add(root);
  scene.add(paddleMesh);
  // Bot faces +Z (towards the player)
  return { root, body, head, eyes, arm, offArm, paddle: paddleMesh, glow };
}

// ── Ball machine for practice mode ───────────────────────────
export function makeMachine(scene) {
  const parts = [];
  { const b = new THREE.BoxGeometry(0.34, 0.26, 0.34); b.translate(0, 0, 0); parts.push(colored(b, 0xd8d2c4)); }
  { const h = new THREE.CylinderGeometry(0.2, 0.12, 0.22, 16, 1, true); h.translate(0, 0.24, 0); parts.push(colored(h, 0xe2b85c)); }
  { const n = new THREE.CylinderGeometry(0.04, 0.05, 0.22, 12); n.rotateX(Math.PI / 2); n.translate(0, 0.05, 0.2); parts.push(colored(n, 0x22262c)); }
  { const s = new THREE.CylinderGeometry(0.02, 0.02, 0.92, 6); s.translate(0, -0.6, 0); parts.push(colored(s, 0x22262c)); }
  { const f = new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16); f.translate(0, -1.05, 0); parts.push(colored(f, 0x22262c)); }
  { const l = new THREE.BoxGeometry(0.06, 0.03, 0.01); l.translate(0.1, 0.06, 0.171); parts.push(colored(l, 0x5ad07a)); }
  const m = new THREE.Mesh(mergeColored(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }));
  scene.add(m);
  return m;
}
