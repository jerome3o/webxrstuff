import * as THREE from 'three';

export const FONT_BRUSH = '"Ma Shan Zheng", "Noto Serif SC", "Songti SC", "SimSun", serif';
export const FONT_SERIF = '"Noto Serif SC", "Songti SC", "SimSun", serif';
export const FONT_LATIN = '"Cormorant Garamond", Georgia, serif';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Cheap deterministic 1D value noise + fbm, for mountains and wind gusts.
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
export function fbm1(x, oct = 4) {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise1(x * f + i * 17.3); f *= 2.03; a *= 0.5; }
  return s;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(canvas, { srgb = true, repeat = null, mips = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 4;
  t.generateMipmaps = mips;
  return t;
}

// Text helper that centers and auto-shrinks to a max width.
export function fitText(ctx, text, x, y, maxW, sizePx, font, align = 'center') {
  let s = sizePx;
  ctx.font = `${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 8) { s -= 2; ctx.font = `${s}px ${font}`; }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Persisted save; every access guarded because storage can be unavailable.
const SAVE_KEY = 'baibu-chuanyang-save-v1';
export function loadSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function writeSave(obj) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

// Ensure the web fonts used on canvas are actually loaded before we paint them.
export async function loadFonts() {
  if (!document.fonts) return;
  const sample = '百步穿杨中开始福到了铜钱弓火龙穿云手铳风分数连击最高命中率补给箭弹狙好厉害太棒神射手发凝神囊药桶带朱漆玉金宝库时间剩余一炷香东南西北结束再来准备';
  const tries = [
    `64px "Ma Shan Zheng"`, `32px "Noto Serif SC"`, `32px "Cormorant Garamond"`,
  ];
  try {
    await Promise.race([
      Promise.all(tries.map(f => document.fonts.load(f, sample + 'Abc123'))),
      new Promise(r => setTimeout(r, 4000)),
    ]);
  } catch { /* fallback fonts are fine */ }
}

export const tmpV = () => new THREE.Vector3();
