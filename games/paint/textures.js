import * as THREE from 'three';

// Procedural canvas textures for brushes and the environment. No network assets.

export function canvasTex(c, { repeatU = false, repeatV = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeatU ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repeatV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ink wash: u runs along the stroke (tileable), v across. White with alpha:
// soft bell-shaped edges plus dry-brush fibre streaks that break up near the edges.
export function makeInkTexture() {
  const W = 256, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
  const rnd = mulberry32(7);
  // per-row fibre parameters (periodic in u so the texture tiles)
  const rows = [];
  for (let j = 0; j < H; j++) rows.push({ f1: 1 + Math.floor(rnd() * 3), f2: 3 + Math.floor(rnd() * 5), p1: rnd() * 6.28, p2: rnd() * 6.28, k: rnd() });
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H, e = Math.abs(v * 2 - 1);
    const edge = Math.pow(Math.max(0, 1 - Math.pow(e, 2.2)), 1.3);
    const r = rows[j];
    for (let i = 0; i < W; i++) {
      const u = i / W * Math.PI * 2;
      const fib = 0.5 + 0.5 * Math.sin(u * r.f1 + r.p1) * Math.sin(u * r.f2 + r.p2);
      // near the edges fibres break up more (dry brush)
      const dry = THREE.MathUtils.smoothstep(e, 0.35, 0.95);
      let a = edge * (1 - dry * 0.85 * (1 - fib) - 0.12 * r.k * fib * dry);
      a = Math.max(0, Math.min(1, a));
      const o = (j * W + i) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = Math.round(a * 255);
    }
  }
  x.putImageData(img, 0, 0);
  return canvasTex(c, { repeatU: true, srgb: false });
}

// Glow profile across the neon ribbon: hot core, soft falloff.
export function makeGlowTexture() {
  const W = 4, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
  for (let j = 0; j < H; j++) {
    const e = Math.abs(((j + 0.5) / H) * 2 - 1);
    const core = Math.exp(-e * e * 28), halo = Math.pow(1 - e, 2.2) * 0.55;
    const a = Math.min(1, core + halo);
    const w = Math.round(255 * Math.min(1, 0.55 + core * 0.9));
    for (let i = 0; i < W; i++) { const o = (j * W + i) * 4; d[o] = d[o + 1] = d[o + 2] = w; d[o + 3] = Math.round(a * 255); }
  }
  x.putImageData(img, 0, 0);
  return canvasTex(c, { srgb: false });
}

// Shading across a solid ribbon so flat gradient ribbons read as rounded.
export function makeRibbonShadeTexture() {
  const W = 4, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H), d = img.data;
  for (let j = 0; j < H; j++) {
    const e = Math.abs(((j + 0.5) / H) * 2 - 1);
    const s = 0.72 + 0.28 * Math.cos(e * Math.PI * 0.5) + (e < 0.25 ? 0.1 * (1 - e / 0.25) : 0);
    const a = e > 0.92 ? (1 - e) / 0.08 : 1;
    for (let i = 0; i < W; i++) { const o = (j * W + i) * 4; d[o] = d[o + 1] = d[o + 2] = Math.round(Math.min(1, s) * 255); d[o + 3] = Math.round(a * 255); }
  }
  x.putImageData(img, 0, 0);
  return canvasTex(c, { srgb: false });
}

// Bamboo leaf: base at v=0, tip at v=1, white with alpha, darker midrib.
export function makeLeafTexture() {
  const W = 64, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  // canvas y=0 is the top = texture v=1 (tip) because flipY
  x.translate(W / 2, H);
  x.beginPath();
  x.moveTo(0, -2);
  x.bezierCurveTo(W * 0.42, -H * 0.12, W * 0.48, -H * 0.55, 0, -H + 3);
  x.bezierCurveTo(-W * 0.46, -H * 0.55, -W * 0.4, -H * 0.12, 0, -2);
  x.closePath();
  const g = x.createLinearGradient(0, 0, 0, -H);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.85)');
  x.fillStyle = g; x.fill();
  // midrib
  x.globalCompositeOperation = 'destination-out';
  x.strokeStyle = 'rgba(0,0,0,0.35)'; x.lineWidth = 2.2;
  x.beginPath(); x.moveTo(0, -6); x.quadraticCurveTo(2, -H * 0.5, 0, -H * 0.92); x.stroke();
  // a few dry streaks
  const rnd = mulberry32(3);
  x.lineWidth = 1;
  for (let k = 0; k < 7; k++) {
    const ox = (rnd() - 0.5) * W * 0.5;
    x.strokeStyle = `rgba(0,0,0,${0.1 + rnd() * 0.15})`;
    x.beginPath(); x.moveTo(ox * 0.3, -H * 0.1); x.quadraticCurveTo(ox, -H * 0.5, ox * 0.2, -H * 0.85); x.stroke();
  }
  return canvasTex(c, { srgb: false });
}

// Pre-rendered HSV colour wheel (hue = angle, saturation = radius, value = 1).
export function makeWheelCanvas(R) {
  const S = R * 2;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
  const col = new THREE.Color();
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const dx = i + 0.5 - R, dy = j + 0.5 - R, r = Math.hypot(dx, dy) / R;
    const o = (j * S + i) * 4;
    if (r > 1) { d[o + 3] = 0; continue; }
    const h = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    hsvToRgb(h, Math.min(1, r), 1, col);
    d[o] = col.r * 255; d[o + 1] = col.g * 255; d[o + 2] = col.b * 255;
    d[o + 3] = r > 0.985 ? Math.round((1 - r) / 0.015 * 255) : 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

// HSV -> sRGB components 0..1 written into out (r,g,b). Plain numbers, no colour management.
export function hsvToRgb(h, s, v, out) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (((i % 6) + 6) % 6) {
    case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break; default: r = v; g = p; b = q;
  }
  out.r = r; out.g = g; out.b = b; return out;
}
export function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}
export function hexOf(r, g, b) {
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}
export function cssHex(hex) { return '#' + hex.toString(16).padStart(6, '0'); }
