import * as THREE from 'three';
import { fbm1, makeCanvas, canvasTexture, rand, FONT_BRUSH } from './util.js';

// Layout (metres). Player stands at the origin facing -Z down the range.
// Range runs from z = -5 to z = -95, walled at x = ±16.

export const SUN_DIR = new THREE.Vector3(-0.35, 0.22, -0.9).normalize();
const FOG_COLOR = new THREE.Color(0xe9c9a0);

export function buildEnvironment(scene, physics) {
  const env = { updaters: [], banners: [], windUniform: { value: new THREE.Vector3(1, 0, 0) } };
  scene.fog = new THREE.Fog(FOG_COLOR, 60, 520);
  scene.background = FOG_COLOR.clone();

  // Lights: a warm low sun and a hemisphere fill. No shadow maps (standalone-headset budget).
  const hemi = new THREE.HemisphereLight(0xfbe3c0, 0x4d5a3a, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd7a0, 2.2); sun.position.copy(SUN_DIR).multiplyScalar(100); scene.add(sun);

  buildSky(scene);
  buildMountains(scene);
  buildGround(scene);
  buildCourtyard(scene, physics);
  buildWalls(scene, physics);
  buildGate(scene, physics);
  buildPagoda(scene, physics, new THREE.Vector3(42, 0, -125), 7);
  buildPagoda(scene, physics, new THREE.Vector3(-60, 0, -170), 5, 0.8);
  buildPavilion(scene, physics, new THREE.Vector3(-9, 0, 3));
  env.updaters.push(buildPond(scene, new THREE.Vector3(8.5, 0, 3.5)));
  env.updaters.push(buildPlumTree(scene, new THREE.Vector3(-4.2, 0, 1.8)));
  buildBamboo(scene, -21, -8, -90);
  buildBamboo(scene, 21, -8, -90);
  env.willow = buildWillow(scene, new THREE.Vector3(6, 0, -88));
  env.updaters.push(buildBanners(scene, env));
  env.incense = buildIncenseBurner(scene, new THREE.Vector3(-1.4, 0, -1.6));
  env.updaters.push(buildClouds(scene));
  env.updaters.push(buildCranes(scene, env));
  return env;
}

// ── Sky dome: golden-hour gradient with a sun disc ────────────
function buildSky(scene) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uSun;
      void main(){
        float h = vDir.y;
        vec3 zenith = vec3(0.22,0.34,0.52);
        vec3 mid = vec3(0.78,0.62,0.50);
        vec3 horizon = vec3(0.98,0.80,0.58);
        vec3 col = mix(horizon, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.15, 0.75, h));
        float s = max(dot(vDir, uSun), 0.0);
        col += vec3(1.0,0.55,0.25) * pow(s, 8.0) * 0.45;
        col += vec3(1.0,0.75,0.45) * pow(s, 64.0) * 0.8;
        col = mix(col, vec3(1.0,0.93,0.78), smoothstep(0.9985, 0.9992, s));
        if (h < 0.0) col = mix(horizon, vec3(0.85,0.72,0.58), smoothstep(0.0,-0.2,h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
}

// ── Shan-shui mountains: layered karst ridges fading into mist ─
function buildMountains(scene) {
  const layers = [
    { r: 260, h: 70, col: 0x4b5b5a, mist: 0xd9b996, seed: 1, peaks: 22 },
    { r: 360, h: 110, col: 0x6d7a77, mist: 0xe2c3a0, seed: 7, peaks: 18 },
    { r: 480, h: 150, col: 0x8f9894, mist: 0xe8caa6, seed: 13, peaks: 14 },
    { r: 620, h: 190, col: 0xaeb0a6, mist: 0xedd0ad, seed: 21, peaks: 10 },
  ];
  for (const L of layers.reverse()) {
    const segs = 220;
    const pos = [], col = [], idx = [];
    const cTop = new THREE.Color(L.col), cBot = new THREE.Color(L.mist);
    // Random rounded karst peaks
    const bumps = Array.from({ length: L.peaks }, (_, i) => ({ a: (i / L.peaks) * Math.PI * 2 + rand(-0.15, 0.15), w: rand(0.03, 0.09), h: rand(0.4, 1.0) }));
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      let h = 0.18 + 0.12 * fbm1(a * 6 + L.seed);
      for (const b of bumps) {
        let d = Math.abs(a - b.a); d = Math.min(d, Math.PI * 2 - d);
        h = Math.max(h, b.h * Math.exp(-(d * d) / (2 * b.w * b.w)) * (1 + 0.05 * fbm1(a * 40)));
      }
      const x = Math.sin(a) * L.r, z = -Math.cos(a) * L.r;
      pos.push(x, h * L.h, z, x, -20, z);
      const top = cTop.clone().lerp(cBot, 0.15);
      col.push(top.r, top.g, top.b, cBot.r, cBot.g, cBot.b);
      if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
    m.renderOrder = -5;
    scene.add(m);
  }
}

function buildGround(scene) {
  // Grass with painted variation
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#6f7a45'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const g = 90 + Math.random() * 50;
    x.fillStyle = `rgba(${g * 0.8 | 0},${g | 0},${g * 0.45 | 0},${Math.random() * 0.35})`;
    x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2 + Math.random() * 6);
  }
  const tex = canvasTexture(c, { repeat: [60, 60] });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);

  // Sand strip down the range
  const s = makeCanvas(256, 256), sx = s.getContext('2d');
  sx.fillStyle = '#c8b08a'; sx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) { sx.fillStyle = `rgba(120,95,60,${Math.random() * 0.25})`; sx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
  const range = new THREE.Mesh(new THREE.PlaneGeometry(31, 92), new THREE.MeshLambertMaterial({ map: canvasTexture(s, { repeat: [6, 18] }) }));
  range.rotation.x = -Math.PI / 2; range.position.set(0, 0.01, -50); scene.add(range);
}

function buildCourtyard(scene, physics) {
  // Stone tile platform under the player
  const c = makeCanvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#8d8a83'; x.fillRect(0, 0, 512, 512);
  const n = 8, s = 512 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 125 + Math.random() * 30;
    x.fillStyle = `rgb(${v},${v - 3},${v - 9})`;
    x.fillRect(i * s + 2, j * s + 2, s - 4, s - 4);
    for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(60,55,50,${Math.random() * 0.15})`; x.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2, 2); }
  }
  const plat = new THREE.Mesh(new THREE.BoxGeometry(12, 0.15, 10), [
    new THREE.MeshLambertMaterial({ color: 0x77736c }), new THREE.MeshLambertMaterial({ color: 0x77736c }),
    new THREE.MeshLambertMaterial({ map: canvasTexture(c, { repeat: [3, 2.5] }) }),
    new THREE.MeshLambertMaterial({ color: 0x77736c }), new THREE.MeshLambertMaterial({ color: 0x77736c }), new THREE.MeshLambertMaterial({ color: 0x77736c }),
  ]);
  plat.position.set(0, -0.07, 1); scene.add(plat);
  // Shooting line: a red lacquered rail at waist height in front
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9e1b14, roughness: 0.5 });
  for (const xpos of [-3.5, -1.2, 1.2, 3.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), railMat);
    post.position.set(xpos, 0.45, -2.6); scene.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.3 }));
    cap.position.set(xpos, 0.92, -2.6); scene.add(cap);
  }
  for (const [a, b] of [[-3.5, -1.2], [1.2, 3.5]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.06, 0.08), railMat);
    rail.position.set((a + b) / 2, 0.82, -2.6); scene.add(rail);
  }
}

function tileCapMaterial() { return new THREE.MeshLambertMaterial({ color: 0x3b4446 }); }

function buildWalls(scene, physics) {
  // Vermilion palace walls with dark tile caps, either side of the range
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x9a2a1e });
  const capMat = tileCapMaterial();
  for (const sx of [-16, 16]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.2, 92), wallMat);
    wall.position.set(sx, 1.6, -51); scene.add(wall); physics.addStatic(wall, 'stone');
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.25, 92.5), capMat);
    cap.position.set(sx, 3.3, -51); scene.add(cap);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 92.5), capMat);
    ridge.position.set(sx, 3.55, -51); scene.add(ridge);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.4, 92), new THREE.MeshLambertMaterial({ color: 0x6e6a62 }));
    base.position.set(sx, 0.2, -51); scene.add(base);
  }
  // Back wall behind the furthest targets, with a giant 中 character
  const back = new THREE.Mesh(new THREE.BoxGeometry(33, 6, 0.8), wallMat);
  back.position.set(0, 3, -97.5); scene.add(back); physics.addStatic(back, 'stone');
  const bc = new THREE.Mesh(new THREE.BoxGeometry(34, 0.35, 1.6), capMat); bc.position.set(0, 6.15, -97.5); scene.add(bc);
  const c = makeCanvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#e9d9b0'; x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#7a1510'; x.font = `190px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('射', 128, 140);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 32), new THREE.MeshLambertMaterial({ map: canvasTexture(c) }));
  disc.position.set(-9, 3.2, -97.05); scene.add(disc);
  disc.userData.redraw = () => { };
  env_backDisc = { canvas: c, mesh: disc };
}
let env_backDisc = null;
export function refreshFontTextures() {
  if (env_backDisc) {
    const x = env_backDisc.canvas.getContext('2d');
    x.clearRect(0, 0, 256, 256);
    x.fillStyle = '#e9d9b0'; x.beginPath(); x.arc(128, 128, 120, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#7a1510'; x.font = `190px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('射', 128, 140);
    env_backDisc.mesh.material.map.needsUpdate = true;
  }
  for (const f of _fontRedraws) f();
}
const _fontRedraws = [];

// Curved Chinese roof: a 4-sided lathe with a concave profile → swooping eaves.
export function makeRoof(width, height, mat) {
  const pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const r = width * 0.5 * (1 - t) * 1.414;
    const y = height * Math.pow(t, 0.55) - (1 - t) * (1 - t) * height * 0.1;
    pts.push(new THREE.Vector2(Math.max(r, 0.001), y));
  }
  const g = new THREE.LatheGeometry(pts, 4);
  g.rotateY(Math.PI / 4);
  // flip upward the corners slightly (tips of the eaves)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const corner = Math.abs(Math.abs(x) - Math.abs(z)) < width * 0.05 ? 1 : 0;
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (width * 0.5);
    if (edge > 0.85) p.setY(i, y + Math.pow((edge - 0.85) / 0.15, 2) * height * 0.25 * (0.4 + 0.6 * corner));
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  return m;
}

function buildGate(scene, physics) {
  // 牌坊 memorial archway framing the range, with the game's name on the plaque
  const g = new THREE.Group(); g.position.set(0, 0, -8);
  const red = new THREE.MeshStandardMaterial({ color: 0xa3231a, roughness: 0.55 });
  const blue = new THREE.MeshLambertMaterial({ color: 0x2c5a6e });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd2a447, metalness: 0.7, roughness: 0.35 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2f3a3d, side: THREE.DoubleSide });
  for (const x of [-8.5, -4.8, 4.8, 8.5]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 7.5, 12), red);
    col.position.set(x, 3.75, 0); g.add(col); physics.addStatic(col, 'wood');
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), new THREE.MeshLambertMaterial({ color: 0x77736c }));
    base.position.set(x, 0.3, 0); g.add(base);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(18.5, 0.6, 0.5), blue); beam.position.set(0, 7.2, 0); g.add(beam); physics.addStatic(beam, 'wood');
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(18.5, 0.35, 0.45), red); beam2.position.set(0, 6.3, 0); g.add(beam2); physics.addStatic(beam2, 'wood');
  for (const [w, x, y] of [[10, 0, 7.6], [5.6, -6.6, 7.1], [5.6, 6.6, 7.1]]) {
    const roof = makeRoof(1, 1, roofMat); roof.scale.set(w, 1.3, 1.6); roof.position.set(x, y, 0); g.add(roof);
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.18, 0.18), roofMat); ridge.position.set(x, y + 1.3, 0); g.add(ridge);
  }
  // Plaque
  const c = makeCanvas(1024, 256);
  const drawPlaque = () => {
    const x = c.getContext('2d');
    x.fillStyle = '#1d2b3a'; x.fillRect(0, 0, 1024, 256);
    x.strokeStyle = '#d2a447'; x.lineWidth = 14; x.strokeRect(10, 10, 1004, 236);
    x.fillStyle = '#e9c46a'; x.font = `180px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('百 步 穿 杨', 512, 138);
  };
  drawPlaque();
  const plaqueTex = canvasTexture(c);
  _fontRedraws.push(() => { drawPlaque(); plaqueTex.needsUpdate = true; });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshBasicMaterial({ map: plaqueTex }));
  plaque.position.set(0, 6.75, 0.27); g.add(plaque);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.55, 0.12), gold); frame.position.set(0, 6.75, 0.2); g.add(frame);
  // Hanging lantern pair on the gate (decor)
  for (const x of [-4.8, 4.8]) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc0201a, emissive: 0xff4a1a, emissiveIntensity: 0.9 }));
    l.scale.y = 1.2; l.position.set(x, 5.4, 0.5); g.add(l);
  }
  scene.add(g);
}

function buildPagoda(scene, physics, pos, tiers, scale = 1) {
  const g = new THREE.Group(); g.position.copy(pos); g.scale.setScalar(scale);
  const wall = new THREE.MeshLambertMaterial({ color: 0xd9cdb2 });
  const red = new THREE.MeshLambertMaterial({ color: 0x9a2a1e });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x2f4f4a, side: THREE.DoubleSide });
  let y = 0;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.5, 1.5, 8), new THREE.MeshLambertMaterial({ color: 0x8b877e }));
  base.position.y = 0.75; g.add(base); y = 1.5;
  for (let i = 0; i < tiers; i++) {
    const w = 9 - i * 0.9, h = i === 0 ? 5 : 3.2;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.47, h, 8), i % 2 ? wall : red);
    body.position.y = y + h / 2; g.add(body);
    // tiny glowing windows
    for (let k = 0; k < 4; k++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.1), new THREE.MeshBasicMaterial({ color: 0xffb860 }));
      const a = k * Math.PI / 2 + Math.PI / 8;
      win.position.set(Math.sin(a) * w * 0.455, y + h * 0.55, Math.cos(a) * w * 0.455); win.rotation.y = a; g.add(win);
    }
    y += h;
    const roof = makeRoof(1, 1, roofMat); roof.scale.set(w * 1.55, 1.6, w * 1.55); roof.position.y = y - 0.3; g.add(roof);
    y += 0.6;
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.35, 6, 8), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.3 }));
  spire.position.y = y + 3; g.add(spire);
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.55 - k * 0.08, 0.08, 6, 16), spire.material); b.rotation.x = Math.PI / 2; b.position.y = y + 1 + k * 0.8; g.add(b); }
  scene.add(g);
}

function buildPavilion(scene, physics, pos) {
  // 亭: a small hexagonal pavilion beside the shooting platform
  const g = new THREE.Group(); g.position.copy(pos);
  const red = new THREE.MeshStandardMaterial({ color: 0xa3231a, roughness: 0.55 });
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3, 8), red);
    c.position.set(Math.cos(a) * 2, 1.5, Math.sin(a) * 2); g.add(c);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.3, 1.8, 6, 1, true), new THREE.MeshLambertMaterial({ color: 0x2f4f4a, side: THREE.DoubleSide }));
  roof.position.y = 3.9; g.add(roof);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.3 }));
  knob.position.y = 4.85; g.add(knob);
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.6, 0.3, 6), new THREE.MeshLambertMaterial({ color: 0x8d8a83 }));
  floor.position.y = 0.15; g.add(floor);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.4, 0.8, 12), new THREE.MeshLambertMaterial({ color: 0x9a968c }));
  table.position.y = 0.7; g.add(table);
  // teapot!
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshStandardMaterial({ color: 0x7a3e22, roughness: 0.6 }));
  pot.scale.y = 0.8; pot.position.y = 1.2; g.add(pot);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.15, 6), pot.material); spout.position.set(0.14, 1.24, 0); spout.rotation.z = -0.9; g.add(spout);
  scene.add(g);
}

function buildPond(scene, pos) {
  const g = new THREE.Group(); g.position.copy(pos);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.25, 6, 32), new THREE.MeshLambertMaterial({ color: 0x7d7a72 }));
  rim.rotation.x = Math.PI / 2; rim.scale.set(1, 0.7, 1); rim.position.y = 0.12; g.add(rim);
  const waterMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uTime;
      void main(){ vec2 p = vUv*10.0; float w = sin(p.x*1.3+uTime*1.1)*sin(p.y*1.7-uTime*0.9)+sin((p.x+p.y)*2.1+uTime*1.7)*0.5;
        vec3 c = mix(vec3(0.12,0.28,0.30), vec3(0.75,0.66,0.52), 0.25+0.12*w);
        gl_FragColor = vec4(c, 0.92); }`,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.5, 32), waterMat);
  water.rotation.x = -Math.PI / 2; water.scale.y = 0.7; water.position.y = 0.08; g.add(water);
  // Lily pads
  for (let i = 0; i < 6; i++) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10, 0.3, Math.PI * 1.8), new THREE.MeshLambertMaterial({ color: 0x4b7a3a, side: THREE.DoubleSide }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(rand(-1.8, 1.8), 0.1, rand(-1.1, 1.1)); g.add(pad);
    if (i % 2 === 0) { const lotus = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.1, 6), new THREE.MeshLambertMaterial({ color: 0xf2a6c0 })); lotus.position.copy(pad.position).add(new THREE.Vector3(0, 0.05, 0)); lotus.rotation.x = Math.PI; g.add(lotus); }
  }
  // Koi swimming laps
  const koi = [];
  const koiGeo = new THREE.SphereGeometry(0.1, 8, 6); koiGeo.scale(0.5, 0.35, 1.4);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(koiGeo, new THREE.MeshLambertMaterial({ color: i % 3 === 0 ? 0xf2f0ea : i % 3 === 1 ? 0xf07a20 : 0xd8401a }));
    m.position.y = 0.04; g.add(m);
    koi.push({ m, r: rand(0.6, 1.9), s: rand(0.25, 0.6) * (i % 2 ? 1 : -1), o: rand(0, 6.28) });
  }
  scene.add(g);
  return (dt, t) => {
    waterMat.uniforms.uTime.value = t;
    for (const k of koi) {
      const a = k.o + t * k.s;
      k.m.position.x = Math.cos(a) * k.r; k.m.position.z = Math.sin(a) * k.r * 0.6;
      k.m.rotation.y = -a + (k.s > 0 ? 0 : Math.PI) + Math.sin(t * 6 + k.o) * 0.2;
    }
  };
}

function buildPlumTree(scene, pos) {
  const g = new THREE.Group(); g.position.copy(pos);
  const bark = new THREE.MeshLambertMaterial({ color: 0x3a2a22 });
  const blossoms = [];
  function branch(p, dir, len, r, depth) {
    const end = p.clone().addScaledVector(dir, len);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r, len, 6), bark);
    c.position.copy(p).addScaledVector(dir, len / 2);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.add(c);
    if (depth === 0 || len < 0.25) { blossoms.push(end); return; }
    const n = depth > 2 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3(rand(-0.9, 0.9), rand(0.1, 0.6), rand(-0.9, 0.9))).normalize();
      branch(end, d, len * rand(0.6, 0.8), r * 0.65, depth - 1);
      if (Math.random() < 0.5) blossoms.push(end.clone().addScaledVector(d, len * 0.3));
    }
  }
  branch(new THREE.Vector3(), new THREE.Vector3(0.15, 1, 0).normalize(), 1.4, 0.12, 4);
  const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshLambertMaterial({ color: 0xf6b8c8, emissive: 0x401018 }), blossoms.length * 6);
  const m = new THREE.Matrix4(); let k = 0;
  for (const b of blossoms) for (let i = 0; i < 6; i++) {
    m.makeTranslation(b.x + rand(-0.25, 0.25), b.y + rand(-0.2, 0.2), b.z + rand(-0.25, 0.25));
    inst.setMatrixAt(k++, m);
  }
  g.add(inst);
  scene.add(g);
  const worldBlossoms = blossoms.map(b => b.clone().add(pos));
  let acc = 0;
  return (dt, t, game) => {
    acc += dt;
    if (acc > 0.25 && game) {
      acc = 0;
      const p = worldBlossoms[Math.floor(Math.random() * worldBlossoms.length)];
      game.fx.matter.emit({ pos: p, count: 1, color: 0xf6b8c8, color2: 0xffe0ea, vel: game.wind.clone().multiplyScalar(0.4), speed: 0.2, life: 6, size: 0.05, sizeEnd: 0.05, gravity: -0.25, drag: 0.8 });
    }
  };
}

function buildBamboo(scene, x0, z0, z1) {
  const count = 120;
  const geo = new THREE.CylinderGeometry(0.06, 0.07, 1, 6); geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x6f8a3a });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const leafGeo = new THREE.ConeGeometry(0.6, 1.6, 5); leafGeo.translate(0, -0.6, 0);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x4e6b2a }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const h = rand(6, 11);
    p.set(x0 + rand(-3.5, 3.5) * Math.sign(x0) + Math.sign(x0) * 2, 0, rand(z1, z0));
    q.setFromEuler(new THREE.Euler(rand(-0.06, 0.06), 0, rand(-0.06, 0.06)));
    s.set(1, h, 1); m.compose(p, q, s); inst.setMatrixAt(i, m);
    s.set(rand(0.8, 1.4), rand(1, 1.6), rand(0.8, 1.4)); p.y = h + 0.3; m.compose(p, q, s); leaves.setMatrixAt(i, m);
  }
  scene.add(inst, leaves);
}

function buildWillow(scene, pos) {
  const g = new THREE.Group(); g.position.copy(pos);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 5, 8), new THREE.MeshLambertMaterial({ color: 0x4a3b2c }));
  trunk.position.y = 2.5; trunk.rotation.z = 0.08; g.add(trunk);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), new THREE.MeshLambertMaterial({ color: 0x7e9a4a }));
  canopy.position.y = 5.6; canopy.scale.set(1.2, 0.6, 1.2); g.add(canopy);
  // drooping strands
  const strandMat = new THREE.MeshLambertMaterial({ color: 0x8fae52 });
  const strandGeo = new THREE.BoxGeometry(0.05, 3, 0.05); strandGeo.translate(0, -1.5, 0);
  const strands = [];
  for (let i = 0; i < 50; i++) {
    const a = rand(0, Math.PI * 2), r = rand(1.2, 3.0);
    const s = new THREE.Mesh(strandGeo, strandMat);
    s.position.set(Math.cos(a) * r, 5.4, Math.sin(a) * r); s.scale.y = rand(0.6, 1.2); g.add(s); strands.push(s);
  }
  // The branch that holds the legendary leaf hangs toward the archer.
  const branchAnchor = new THREE.Object3D(); branchAnchor.position.set(-1.5, 4.2, 2.6); g.add(branchAnchor);
  scene.add(g);
  return { group: g, strands, branchAnchor };
}

function buildBanners(scene, env) {
  // Flags on poles atop the walls; a vertex shader ripples them in the wind direction.
  const flags = [];
  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uWind: { value: 1 }, uColor: { value: new THREE.Color(0xb3201c) }, uMap: { value: null } },
    vertexShader: `uniform float uTime; uniform float uWind; varying vec2 vUv; varying float vShade;
      void main(){ vUv = uv; vec3 p = position; float k = uv.x;
        float w = sin(k*6.0 - uTime*(4.0+uWind*3.0) + p.y*1.5) * k * (0.15 + 0.1*uWind);
        p.z += w; p.y -= k*k*0.3*(1.0-min(uWind,1.5)/1.5);
        vShade = 0.75 + 2.0*w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform sampler2D uMap; varying vec2 vUv; varying float vShade;
      void main(){ vec4 t = texture2D(uMap, vUv); vec3 c = mix(uColor, t.rgb, t.a); gl_FragColor = vec4(c*clamp(vShade,0.5,1.2), 1.0); }`,
  });
  const c = makeCanvas(256, 128);
  const drawFlag = () => {
    const x = c.getContext('2d'); x.clearRect(0, 0, 256, 128);
    x.fillStyle = '#e9c46a'; x.font = `96px ${FONT_BRUSH}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('风', 110, 70);
    x.fillStyle = '#e9c46a'; for (let i = 0; i < 6; i++) x.fillRect(230, 10 + i * 20, 26, 10);
  };
  drawFlag();
  const tex = canvasTexture(c); mat.uniforms.uMap.value = tex;
  _fontRedraws.push(() => { drawFlag(); tex.needsUpdate = true; });
  for (const [x, z] of [[-16, -12], [16, -12], [-16, -45], [16, -45], [-16, -80], [16, -80]]) {
    const pole = new THREE.Group(); pole.position.set(x, 3.4, z);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 6), new THREE.MeshLambertMaterial({ color: 0x3a2a1a })); stick.position.y = 2; pole.add(stick);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 0.8, roughness: 0.3 })); top.position.y = 4.1; pole.add(top);
    const flagGeo = new THREE.PlaneGeometry(2, 1, 16, 4); flagGeo.translate(1, 0, 0);
    const flag = new THREE.Mesh(flagGeo, mat); flag.position.y = 3.4; pole.add(flag);
    scene.add(pole); flags.push(flag);
  }
  return (dt, t, game) => {
    mat.uniforms.uTime.value = t;
    if (!game) return;
    const w = game.wind;
    const s = Math.hypot(w.x, w.z);
    mat.uniforms.uWind.value = s;
    const yaw = Math.atan2(-w.z, w.x);
    for (const f of flags) f.rotation.y = yaw;
  };
}

function buildIncenseBurner(scene, pos) {
  // 鼎 bronze tripod; its incense stick is the round timer (一炷香, "one stick of incense").
  const g = new THREE.Group(); g.position.copy(pos);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x5e4a2a, metalness: 0.8, roughness: 0.45 });
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), bronze);
  bowl.position.y = 0.75; g.add(bowl);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 20), bronze); lip.rotation.x = Math.PI / 2; lip.position.y = 0.88; g.add(lip);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.6, 6), bronze); leg.position.set(Math.cos(a) * 0.18, 0.3, Math.sin(a) * 0.18); g.add(leg);
  }
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 5, 10, Math.PI), bronze); ear.position.set(s * 0.22, 0.93, 0); ear.rotation.y = Math.PI / 2; g.add(ear);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshLambertMaterial({ color: 0xbab3a6 })); ash.rotation.x = -Math.PI / 2; ash.position.y = 0.85; g.add(ash);
  const stickGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 5); stickGeo.translate(0, 0.5, 0);
  const stick = new THREE.Mesh(stickGeo, new THREE.MeshLambertMaterial({ color: 0x9a4a2a })); stick.position.y = 0.85; stick.scale.y = 0.45; g.add(stick);
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff5010 })); g.add(ember);
  scene.add(g);
  return {
    group: g, stick, ember,
    set(frac) { stick.scale.y = 0.03 + 0.42 * frac; ember.position.set(0, 0.85 + stick.scale.y, 0); },
    tipWorld(v) { return ember.getWorldPosition(v); },
  };
}

function buildClouds(scene) {
  const c = makeCanvas(256, 128), x = c.getContext('2d');
  for (let i = 0; i < 30; i++) {
    const gx = 40 + Math.random() * 176, gy = 50 + Math.random() * 40, r = 20 + Math.random() * 30;
    const grd = x.createRadialGradient(gx, gy, 0, gx, gy, r);
    grd.addColorStop(0, 'rgba(255,240,225,0.5)'); grd.addColorStop(1, 'rgba(255,240,225,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 256, 128);
  }
  const tex = canvasTexture(c);
  const clouds = [];
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, opacity: 0.85 }));
    const a = rand(-1.4, 1.4), r = rand(300, 500);
    s.position.set(Math.sin(a) * r, rand(70, 160), -Math.cos(a) * r);
    s.scale.set(rand(120, 220), rand(40, 70), 1);
    scene.add(s); clouds.push({ s, sp: rand(0.5, 2) });
  }
  return (dt) => { for (const c of clouds) { c.s.position.x += c.sp * dt; if (c.s.position.x > 500) c.s.position.x = -500; } };
}

function buildCranes(scene, env) {
  // 仙鹤: decorative cranes gliding across. Shooting one costs points.
  const cranes = [];
  const white = new THREE.MeshLambertMaterial({ color: 0xf5f2ea, side: THREE.DoubleSide });
  const black = new THREE.MeshLambertMaterial({ color: 0x1a1a1a, side: THREE.DoubleSide });
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), white); body.scale.set(0.6, 0.6, 1.6); g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.8, 5), white); neck.rotation.x = Math.PI / 2 - 0.2; neck.position.set(0, 0.1, -0.7); g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshLambertMaterial({ color: 0xc81e1e })); head.position.set(0, 0.2, -1.1); g.add(head);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 4), black); legs.rotation.x = Math.PI / 2; legs.position.set(0, -0.05, 0.75); g.add(legs);
    const wings = [];
    for (const s of [-1, 1]) {
      const wg = new THREE.Group();
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), white); w.position.x = s * 0.7; w.rotation.x = -Math.PI / 2; wg.add(w);
      const tip = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.55), black); tip.position.x = s * 1.55; tip.rotation.x = -Math.PI / 2; wg.add(tip);
      g.add(wg); wings.push({ wg, s });
    }
    scene.add(g);
    cranes.push({ g, wings, phase: rand(0, 6), y: rand(22, 38), z: rand(-60, -140), speed: rand(5, 8), x: rand(-150, 150) });
  }
  env.cranes = cranes;
  return (dt, t) => {
    for (const c of cranes) {
      c.x += c.speed * dt;
      if (c.x > 180) { c.x = -180; c.z = rand(-50, -150); c.y = rand(20, 40); }
      c.g.position.set(c.x, c.y + Math.sin(t * 0.7 + c.phase) * 1.5, c.z);
      c.g.rotation.y = -Math.PI / 2;
      const flap = Math.sin(t * 3 + c.phase) * 0.55;
      for (const w of c.wings) w.wg.rotation.z = w.s * flap;
    }
  };
}
