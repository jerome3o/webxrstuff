import * as THREE from 'three';

// Day/night: gradient sky dome, painted sun + moon, stars, drifting pixel clouds, and the
// light/fog values every chunk material reads. timeOfDay: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.

const K = (h) => new THREE.Color(h);
const KEYS = [ // elevation → palette (sRGB hex, converted to linear by THREE.Color)
  { e: -0.35, zen: K('#0d1230'), hor: K('#232a4e'), light: K('#7f93d8'), sun: K('#000000') },
  { e: -0.08, zen: K('#2b3366'), hor: K('#7a6a9a'), light: K('#9aa0d8'), sun: K('#ff9a6a') },
  { e: 0.06, zen: K('#6d86c6'), hor: K('#f4b493'), light: K('#ffd1b0'), sun: K('#ffb07a') },
  { e: 0.3, zen: K('#82b6e4'), hor: K('#d6e7f2'), light: K('#f6f0e4'), sun: K('#fff0d0') },
  { e: 1.0, zen: K('#6faee6'), hor: K('#cfe5f4'), light: K('#f4f1ea'), sun: K('#fff6e0') },
];

function paintSun() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,230,1)'); grd.addColorStop(0.42, 'rgba(255,236,190,1)');
  grd.addColorStop(0.5, 'rgba(255,214,150,0.55)'); grd.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(240,150,90,0.55)'; g.lineWidth = 2; g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function paintMoon() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 6, 32, 32, 32);
  grd.addColorStop(0, 'rgba(220,230,255,0.25)'); grd.addColorStop(1, 'rgba(200,210,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#eef2ff'; g.beginPath(); g.arc(32, 32, 12, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(38, 28, 11, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(160,170,210,0.6)'; g.fillRect(24, 34, 2, 2); g.fillRect(27, 40, 3, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function paintClouds() {
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  let s = 1234567; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
  const grid = []; const G = 8; for (let i = 0; i < G * G; i++) grid.push(rnd());
  const val = (x, y) => { const fx = x / (N / G), fy = y / (N / G), ix = Math.floor(fx), iy = Math.floor(fy); let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); const a = grid[(ix % G) + (iy % G) * G], b = grid[((ix + 1) % G) + (iy % G) * G], cc = grid[(ix % G) + ((iy + 1) % G) * G], d = grid[((ix + 1) % G) + ((iy + 1) % G) * G]; return (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + d * tx) * ty; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = val(x, y) * 0.75 + val((x * 2) % N, (y * 2) % N) * 0.25;
    const i = (x + y * N) * 4, on = v > 0.6;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = on ? (v > 0.66 ? 235 : 170) : 0;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sky {
  constructor(scene, mats, { dayLength = 1200, time = 0.3 } = {}) {
    this.scene = scene; this.mats = mats;
    this.dayLength = dayLength; this.time = time; this.day = 0;
    this.daylight = 1; this.sunDir = new THREE.Vector3(); this.elevation = 1;
    this.zenith = new THREE.Color(); this.horizon = new THREE.Color(); this.lightColor = new THREE.Color(); this.sunColor = new THREE.Color();
    this.root = new THREE.Group(); this.root.name = 'sky';
    scene.add(this.root);
    scene.background = null;

    this.domeU = { uZen: { value: this.zenith }, uHor: { value: this.horizon }, uSunDir: { value: this.sunDir }, uSunCol: { value: this.sunColor } };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), new THREE.ShaderMaterial({
      uniforms: this.domeU, side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 uZen, uHor, uSunDir, uSunCol; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = max(d.y, 0.0);
          vec3 c = mix(uHor, uZen, pow(h, 0.55));
          if (d.y < 0.0) c = mix(uHor, uHor * 0.82, min(1.0, -d.y * 3.0));
          float s = max(dot(d, uSunDir), 0.0);
          c += uSunCol * (pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.12) * (1.0 - h * 0.6);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    dome.renderOrder = -100; dome.frustumCulled = false;
    this.dome = dome; this.root.add(dome);

    // stars
    const N = 700, sp = new Float32Array(N * 3);
    let s = 99; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = r * Math.cos(a) * 450; sp[i * 3 + 1] = Math.abs(u) * 450; sp[i * 3 + 2] = r * Math.sin(a) * 450;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xf4f0ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
    this.stars.renderOrder = -99; this.stars.frustumCulled = false;
    this.starPivot = new THREE.Group(); this.starPivot.add(this.stars); this.root.add(this.starPivot);

    const disc = (tex, size) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending }));
      m.renderOrder = -98; m.frustumCulled = false; this.root.add(m); return m;
    };
    this.sun = disc(paintSun(), 80); this.sun.material.blending = THREE.NormalBlending;
    this.moon = disc(paintMoon(), 60); this.moon.material.blending = THREE.NormalBlending;

    // clouds: one big plane, texture scrolls; world-anchored via uv offset
    const ct = paintClouds();
    this.cloudU = { map: { value: ct }, uOff: { value: new THREE.Vector2() }, uCol: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 1 / 384 } };
    const cm = new THREE.ShaderMaterial({
      uniforms: this.cloudU, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      vertexShader: `uniform vec2 uOff; uniform float uScale; varying vec2 vUv; varying float vD; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vUv = w.xz * uScale + uOff; vec4 mv = viewMatrix * w; vD = length(mv.xz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uCol; varying vec2 vUv; varying float vD; void main(){ vec4 t = texture2D(map, vUv); float a = t.a * (1.0 - smoothstep(160.0, 420.0, vD)); if (a < 0.01) discard; gl_FragColor = vec4(uCol, a * 0.85);
        #include <colorspace_fragment>
      }`,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), cm);
    this.clouds.rotation.x = -Math.PI / 2; this.clouds.renderOrder = 1; this.clouds.frustumCulled = false;
    this.root.add(this.clouds);

    // scene lights for entities (drops, hands, creatures): follow the sun
    this.hemi = new THREE.HemisphereLight(0xdfeaff, 0x7a6a5a, 1.2);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.4);
    this.dir.target = new THREE.Object3D();
    scene.add(this.hemi, this.dir, this.dir.target);
    this._tmp = new THREE.Color();
  }

  get isNight() { return this.elevation < -0.05; }

  update(dt, camPos) {
    this.time += dt / this.dayLength;
    if (this.time >= 1) { this.time -= 1; this.day++; }
    const th = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(th), Math.sin(th), 0.28).normalize();
    const e = this.elevation = this.sunDir.y;
    // palette interpolation
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    const t = e <= KEYS[0].e ? 0 : e >= 1 ? 1 : (e - a.e) / (b.e - a.e);
    this.zenith.copy(a.zen).lerp(b.zen, t); this.horizon.copy(a.hor).lerp(b.hor, t);
    this.lightColor.copy(a.light).lerp(b.light, t); this.sunColor.copy(a.sun).lerp(b.sun, t);
    const dayF = THREE.MathUtils.smoothstep(e, -0.15, 0.2);
    this.daylight = 0.2 + 0.8 * dayF;

    const u = this.mats.uniforms;
    u.uDaylight.value = this.daylight;
    u.uSkyLight.value.copy(this.lightColor);
    u.uFogColor.value.copy(this.horizon);
    u.uTime.value += dt;
    u.uSunDir.value.copy(e > 0 ? this.sunDir : this.sunDir).multiplyScalar(e > -0.05 ? 1 : -1);
    u.uSunAmt.value = 0.34 * dayF + 0.08 * (1 - dayF);

    this.root.position.copy(camPos);
    this.sun.position.copy(this.sunDir).multiplyScalar(420);
    this.sun.lookAt(this.root.position);
    this.moon.position.copy(this.sunDir).multiplyScalar(-420);
    this.moon.lookAt(this.root.position);
    this.sun.visible = e > -0.2; this.moon.visible = e < 0.2;
    this.stars.material.opacity = THREE.MathUtils.clamp(-e * 3, 0, 1);
    this.stars.visible = this.stars.material.opacity > 0.01;
    this.starPivot.rotation.set(th * 0.5, 0, 0.3);
    // clouds sit at world y≈118 and drift east
    this.clouds.position.set(0, 118 - camPos.y, 0);
    this.cloudU.uOff.value.set(u.uTime.value * 0.004, 0);
    this.cloudU.uCol.value.copy(this.lightColor).multiplyScalar(0.25 + 0.75 * dayF).lerp(this.horizon, 0.25);

    this.hemi.intensity = 0.35 + 1.0 * dayF; this.hemi.color.copy(this.lightColor);
    this.dir.intensity = 1.5 * dayF; this.dir.color.copy(this.lightColor);
    this.dir.position.copy(camPos).addScaledVector(this.sunDir, 50); this.dir.target.position.copy(camPos);
  }

  setTime(t) { this.time = ((t % 1) + 1) % 1; }

  dispose() { this.root.removeFromParent(); this.hemi.removeFromParent(); this.dir.removeFromParent(); this.dir.target.removeFromParent(); }
}
