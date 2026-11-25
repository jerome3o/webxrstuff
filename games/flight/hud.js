import * as THREE from 'three';
import { roundRect, fitText, FONTS } from '../../src/platform/kit.js';

// In-headset HUD, comfort vignette + fade, chaperone tunnel and the next-ring arrow.

export class Hud {
  constructor(rig, camera) {
    this.rig = rig; this.camera = camera;
    // ── status board (rig-local, follows head yaw lazily) ──
    this.canvas = document.createElement('canvas'); this.canvas.width = 640; this.canvas.height = 240;
    this.c2 = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.21), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
    this.board.renderOrder = 2000; this.board.frustumCulled = false;
    rig.add(this.board);
    this.boardYaw = 0;
    this.lines = { top: '', mid: '', bot: '', msg: '', msgColor: '#ffd77a' };
    this._key = '';
    this._timer = 0;

    // ── arrow to the next ring ──
    const ag = new THREE.ConeGeometry(0.035, 0.12, 12); ag.rotateX(Math.PI / 2); ag.translate(0, 0, 0.03);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: 0xffc040, depthTest: false, transparent: true, opacity: 0.9, fog: false, toneMapped: false }));
    this.arrow.renderOrder = 2001; this.arrow.visible = false; this.arrow.frustumCulled = false;
    rig.add(this.arrow);

    // ── vignette + fade (child of the camera, removed in dispose) ──
    this.vigMat = new THREE.ShaderMaterial({
      uniforms: { uInner: { value: 3 }, uFade: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy / 0.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec2 vP; uniform float uInner, uFade;
        void main(){ float r = length(vP); float a = smoothstep(uInner, uInner + 0.45, r); a = max(a, uFade); gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
      transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    });
    this.vig = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), this.vigMat);
    this.vig.position.z = -0.2; this.vig.renderOrder = 3000; this.vig.frustumCulled = false; this.vig.visible = false;
    camera.add(this.vig);
    this.vigAmount = 0; this.fade = 0;

    // ── chaperone tunnel: a faint rig-fixed cage that gives a stable rest frame ──
    const seg = [], R = 1.3, M = 20;
    for (let i = 0; i < M; i++) {
      const a0 = (i / M) * Math.PI * 2, a1 = ((i + 1) / M) * Math.PI * 2;
      for (const y of [0.05, 2.6]) seg.push(Math.cos(a0) * R, y, Math.sin(a0) * R, Math.cos(a1) * R, y, Math.sin(a1) * R);
      if (i % 2 === 0) seg.push(Math.cos(a0) * R, 0.05, Math.sin(a0) * R, Math.cos(a0) * R, 2.6, Math.sin(a0) * R);
    }
    for (let i = -3; i <= 3; i++) { const x = i * 0.4; const h = Math.sqrt(Math.max(0, R * R - x * x)); seg.push(x, 0.05, -h, x, 0.05, h, -h, 0.05, x, h, 0.05, x); }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.tunnel = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, fog: false, depthWrite: false }));
    this.tunnel.visible = false; this.tunnel.frustumCulled = false;
    rig.add(this.tunnel);

    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
  }

  setLines(top, mid, bot, msg, msgColor = '#ffd77a') {
    const L = this.lines; L.top = top; L.mid = mid; L.bot = bot; L.msg = msg; L.msgColor = msgColor;
  }

  _draw() {
    const c = this.c2, W = 640, H = 240, L = this.lines;
    const key = L.top + '|' + L.mid + '|' + L.bot + '|' + L.msg;
    if (key === this._key) return;
    this._key = key;
    c.clearRect(0, 0, W, H);
    roundRect(c, 4, 4, W - 8, H - 8, 26);
    c.fillStyle = 'rgba(10,18,26,0.55)'; c.fill();
    c.lineWidth = 3; c.strokeStyle = 'rgba(226,184,92,0.8)'; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#f1e6cf'; fitText(c, L.top, W / 2, 42, W - 40, 40, FONTS.sans);
    c.fillStyle = '#ffd77a'; fitText(c, L.mid, W / 2, 96, W - 40, 46, FONTS.sans);
    c.fillStyle = '#cfe4ea'; fitText(c, L.bot, W / 2, 150, W - 40, 34, FONTS.sans);
    if (L.msg) { c.fillStyle = L.msgColor; fitText(c, L.msg, W / 2, 200, W - 40, 36, FONTS.sans); }
    this.tex.needsUpdate = true;
  }

  // headLocal: camera position in rig space; bodyYaw: rig-local yaw of the body.
  update(dt, headLocal, bodyYaw, opts) {
    // board follows body yaw lazily
    let dy = bodyYaw - this.boardYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.boardYaw += dy * Math.min(1, dt * 2.5);
    const s = Math.sin(this.boardYaw), co = Math.cos(this.boardYaw);
    const dist = 0.85, drop = opts.desktop ? 0.42 : 0.42;
    this.board.position.set(headLocal.x - s * dist, headLocal.y - drop, headLocal.z - co * dist);
    this._e.set(-0.45, this.boardYaw, 0, 'YXZ'); this.board.quaternion.setFromEuler(this._e);
    this.board.visible = opts.showBoard;
    this._timer -= dt;
    if (this._timer <= 0) { this._timer = 0.2; this._draw(); }

    // arrow
    if (opts.target) {
      this.arrow.visible = true;
      this.arrow.position.set(headLocal.x - s * 0.9, headLocal.y - 0.2, headLocal.z - co * 0.9);
      this.arrow.lookAt(opts.target);
      const pulse = 0.85 + 0.15 * Math.sin(opts.time * 6);
      this.arrow.scale.setScalar(pulse);
    } else this.arrow.visible = false;

    // tunnel
    this.tunnel.visible = opts.tunnel;
    if (opts.tunnel) { this.tunnel.position.set(headLocal.x, headLocal.y - 1.6, headLocal.z); this.tunnel.material.opacity = 0.1 + 0.2 * Math.min(1, opts.speed / 20); }

    // vignette
    const target = opts.vignette;
    this.vigAmount += (target - this.vigAmount) * Math.min(1, dt * 4);
    this.vigMat.uniforms.uInner.value = 1.6 - 1.25 * Math.min(1, this.vigAmount);
    this.vigMat.uniforms.uFade.value = this.fade;
    this.vig.visible = this.vigAmount > 0.03 || this.fade > 0.01;
  }

  dispose() {
    this.vig.removeFromParent();
    this.vig.geometry.dispose(); this.vigMat.dispose();
  }
}
