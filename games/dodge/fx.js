import * as THREE from 'three';
import { makeLabel, FONTS } from '../../src/platform/kit.js';

// Pooled effects: additive spark particles (one Points draw), floating feedback words,
// and a camera-attached red vignette for damage.

const NP = 260;
export const WORDS = {
  GREAT: ['GREAT!', '#ffe27a'], GOOD: ['GOOD', '#ffffff'], OK: ['OK', '#c8c0d8'], MISS: ['MISS', '#8a8aa0'],
  DODGE: ['DODGE', '#9fffc8'], BLOCK: ['BLOCK!', '#ffd27a'], OUCH: ['OUCH', '#ff5040'], HARDER: ['HARDER!', '#ffb060'],
  WRONG: ['OTHER FIST', '#ff9ad0'], JAB: ['JAB IT', '#ffb060'], HOOK: ['HOOK IT', '#ffb060'], UPPER: ['UPPERCUT', '#ffb060'],
};

export class Fx {
  constructor(parent, camera) {
    this.camera = camera;
    this.pos = new Float32Array(NP * 3); this.col = new Float32Array(NP * 3); this.base = new Float32Array(NP * 3);
    this.vel = new Float32Array(NP * 3); this.life = new Float32Array(NP); this.max = new Float32Array(NP);
    for (let i = 0; i < NP; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    this.pa = new THREE.BufferAttribute(this.pos, 3); this.ca = new THREE.BufferAttribute(this.col, 3);
    this.pa.setUsage(THREE.DynamicDrawUsage); this.ca.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('color', this.ca);
    const sprite = document.createElement('canvas'); sprite.width = sprite.height = 64;
    const sc = sprite.getContext('2d'), rg = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.35, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    sc.fillStyle = rg; sc.fillRect(0, 0, 64, 64);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.07, map: new THREE.CanvasTexture(sprite), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.points.frustumCulled = false;
    parent.add(this.points);
    this.next = 0; this.alive = 0;

    // floating words: 2 sprites per word
    this.words = {}; this.wordList = [];
    for (const k in WORDS) {
      const arr = [];
      for (let i = 0; i < 2; i++) {
        const s = makeLabel(WORDS[k][0], { size: 0.11, color: WORDS[k][1], font: FONTS.sans, px: 72 });
        s.material.depthTest = false; s.renderOrder = 20; s.visible = false; s.userData.life = 0; s.userData.base = s.scale.clone();
        parent.add(s); arr.push(s); this.wordList.push(s);
      }
      this.words[k] = arr;
    }

    // damage vignette
    const vc = document.createElement('canvas'); vc.width = vc.height = 256;
    const vx = vc.getContext('2d'), vg = vx.createRadialGradient(128, 128, 50, 128, 128, 128);
    vg.addColorStop(0, 'rgba(255,0,0,0)'); vg.addColorStop(0.6, 'rgba(255,20,10,0.35)'); vg.addColorStop(1, 'rgba(255,30,10,0.95)');
    vx.fillStyle = vg; vx.fillRect(0, 0, 256, 256);
    const vt = new THREE.CanvasTexture(vc); vt.colorSpace = THREE.SRGBColorSpace;
    this.vig = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({ map: vt, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    this.vig.position.z = -0.22; this.vig.renderOrder = 1000; this.vig.visible = false; this.vig.frustumCulled = false;
    camera.add(this.vig);
    this.flashA = 0;
  }

  burst(x, y, z, color, n = 24, speed = 2.5, life = 0.6) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % NP;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.6);
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = r * Math.cos(th) * sp; this.vel[i * 3 + 1] = u * sp + 0.6; this.vel[i * 3 + 2] = r * Math.sin(th) * sp + 0.8;
      this.base[i * 3] = color.r; this.base[i * 3 + 1] = color.g; this.base[i * 3 + 2] = color.b;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6);
    }
    this.alive = 1;
  }

  word(key, x, y, z) {
    const arr = this.words[key]; if (!arr) return;
    const s = arr[0].userData.life <= arr[1].userData.life ? arr[0] : arr[1];
    s.position.set(x, y, z); s.userData.life = 0.75; s.visible = true; s.material.opacity = 1;
  }

  flash(a = 1) { this.flashA = Math.max(this.flashA, a); }

  update(dt) {
    if (this.alive) {
      let any = 0;
      for (let i = 0; i < NP; i++) {
        if (this.life[i] <= 0) continue;
        this.life[i] -= dt;
        const j = i * 3;
        if (this.life[i] <= 0) { this.pos[j + 1] = -999; this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
        any = 1;
        this.vel[j + 1] -= 5 * dt;
        this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
        const f = this.life[i] / this.max[i];
        this.col[j] = this.base[j] * f; this.col[j + 1] = this.base[j + 1] * f; this.col[j + 2] = this.base[j + 2] * f;
      }
      this.pa.needsUpdate = true; this.ca.needsUpdate = true;
      this.alive = any;
    }
    for (let i = 0; i < this.wordList.length; i++) {
      const s = this.wordList[i]; if (!s.visible) continue;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { s.visible = false; continue; }
      s.position.y += dt * 0.35;
      s.material.opacity = Math.min(1, s.userData.life * 3);
    }
    if (this.flashA > 0) {
      this.flashA = Math.max(0, this.flashA - dt * 2.2);
      this.vig.material.opacity = this.flashA; this.vig.visible = this.flashA > 0.01;
    }
  }

  dispose() {
    this.vig.removeFromParent();
    this.vig.geometry.dispose(); this.vig.material.map.dispose(); this.vig.material.dispose();
  }
}
