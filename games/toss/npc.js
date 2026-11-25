import * as THREE from 'three';
import { Builder } from './env.js';
import { FONTS, roundRect } from '../../src/platform/kit.js';

// Stall operator: a little vertex-coloured figure that bobs, turns toward the player,
// waves while talking, and shows a speech bubble (canvas sprite, redrawn only when the text changes).
export class Operator {
  constructor(scene, frame, lx, lz, { robe = 0xb03a2e, trim = 0xe2b85c, skin = 0xf0c8a0, hair = 0x1a1410, hat = 'cap', name = '' } = {}, material) {
    this.frame = frame;
    this.group = new THREE.Group();
    frame.toWorld(lx, 0, lz, this.group.position);
    this.baseYaw = frame.yaw;
    this.group.rotation.y = this.baseYaw;
    const b = new Builder();
    b.cyl(null, 0, 0.55, 0, 0.17, 0.24, 1.1, robe, 12);                // robe
    b.cyl(null, 0, 1.0, 0, 0.13, 0.17, 0.12, trim, 12);                // collar band
    b.cyl(null, 0, 0.62, 0, 0.215, 0.215, 0.07, trim, 12);             // sash
    b.sphere(null, 0, 1.25, 0, 0.13, 0.15, 0.13, skin, 12);            // head
    b.sphere(null, 0, 1.31, -0.02, 0.135, 0.12, 0.135, hair, 10);      // hair
    b.sphere(null, -0.045, 1.26, 0.118, 0.016, 0.02, 0.01, 0x201810, 6); // eyes
    b.sphere(null, 0.045, 1.26, 0.118, 0.016, 0.02, 0.01, 0x201810, 6);
    b.sphere(null, 0, 1.19, 0.12, 0.03, 0.012, 0.01, 0xa04040, 6);       // smile
    b.sphere(null, -0.09, 1.21, 0.1, 0.025, 0.018, 0.01, 0xf09090, 6);  // cheeks
    b.sphere(null, 0.09, 1.21, 0.1, 0.025, 0.018, 0.01, 0xf09090, 6);
    if (hat === 'cap') { b.cyl(null, 0, 1.4, 0, 0.12, 0.14, 0.07, trim, 12); b.sphere(null, 0, 1.45, 0, 0.03, 0.03, 0.03, 0xc0261d, 6); }
    else if (hat === 'straw') b.cone(null, 0, 1.43, 0, 0.3, 0.14, 0xd8b870, 16);
    else if (hat === 'bun') b.sphere(null, 0, 1.44, -0.04, 0.06, 0.06, 0.06, hair, 8);
    // static left arm hanging
    b.cyl(null, -0.2, 0.82, 0.02, 0.05, 0.065, 0.36, robe, 8, 0, 0, -0.15);
    b.sphere(null, -0.23, 0.62, 0.03, 0.045, 0.045, 0.045, skin, 8);
    this.body = new THREE.Mesh(b.geometry(), material);
    this.group.add(this.body);
    // waving right arm (pivot at the shoulder)
    const a = new Builder();
    a.cyl(null, 0, -0.17, 0, 0.05, 0.065, 0.36, robe, 8);
    a.sphere(null, 0, -0.38, 0, 0.045, 0.045, 0.045, skin, 8);
    this.arm = new THREE.Mesh(a.geometry(), material);
    this.arm.position.set(0.2, 1.0, 0.02);
    this.group.add(this.arm);
    scene.add(this.group);

    // speech bubble
    this.canvas = document.createElement('canvas'); this.canvas.width = 768; this.canvas.height = 192;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, fog: false }));
    this.bubble.scale.set(1.2, 0.3, 1);
    this.bubble.position.set(0, 1.85, 0);
    this.bubble.visible = false;
    this.group.add(this.bubble);
    this.name = name;
    this.sayT = 0; this.talkT = 0; this.phase = Math.random() * 10;
    this.text = '';
  }
  say(text, dur = 4) {
    this.sayT = dur; this.talkT = Math.min(dur, 1.6);
    if (text === this.text) { this.bubble.visible = true; return; }
    this.text = text;
    const c = this.canvas.getContext('2d'), W = this.canvas.width, H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    c.font = `600 46px ${FONTS.sans}`;
    // wrap into up to 2 lines
    const words = text.split(' '); const lines = ['']; const maxW = W - 80;
    for (const w of words) {
      const t = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + w : w;
      if (c.measureText(t).width > maxW && lines[lines.length - 1]) lines.push(w); else lines[lines.length - 1] = t;
    }
    const L = lines.slice(0, 2);
    const bh = L.length === 1 ? 96 : 150, by = (H - 24 - bh);
    roundRect(c, 12, by, W - 24, bh, 36); c.fillStyle = 'rgba(255,248,232,0.96)'; c.fill();
    c.lineWidth = 6; c.strokeStyle = '#c0261d'; c.stroke();
    c.beginPath(); c.moveTo(W / 2 - 22, by + bh - 2); c.lineTo(W / 2, H - 2); c.lineTo(W / 2 + 22, by + bh - 2); c.closePath(); c.fillStyle = 'rgba(255,248,232,0.96)'; c.fill();
    c.fillStyle = '#2a1a10'; c.textAlign = 'center'; c.textBaseline = 'middle';
    L.forEach((l, i) => { if (L.length > 1 && i === 1 && lines.length > 2) l += '…'; c.fillText(l, W / 2, by + bh / 2 + (i - (L.length - 1) / 2) * 54); });
    this.tex.needsUpdate = true;
    this.bubble.visible = true;
  }
  update(dt, t, headPos) {
    const ph = t + this.phase;
    this.body.position.y = Math.sin(ph * 2.2) * 0.008;
    // turn toward the player when nearby
    const dx = headPos.x - this.group.position.x, dz = headPos.z - this.group.position.z;
    const d = Math.hypot(dx, dz);
    let target = this.baseYaw;
    if (d < 7) {
      const yawTo = Math.atan2(dx, dz);
      let diff = yawTo - this.baseYaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      target = this.baseYaw + THREE.MathUtils.clamp(diff, -0.9, 0.9);
    }
    let cur = this.group.rotation.y, dd = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
    this.group.rotation.y = cur + dd * Math.min(1, dt * 3);
    // arm
    if (this.talkT > 0) {
      this.talkT -= dt;
      this.arm.rotation.z = 2.4 + Math.sin(ph * 9) * 0.35;
    } else this.arm.rotation.z += (0.15 + Math.sin(ph * 0.7) * 0.05 - this.arm.rotation.z) * Math.min(1, dt * 4);
    this.arm.position.y = 1.0 + this.body.position.y;
    if (this.sayT > 0) { this.sayT -= dt; if (this.sayT <= 0) this.bubble.visible = false; }
    this.bubble.position.y = 1.85 + Math.sin(ph * 1.5) * 0.015;
    return d;
  }
}
