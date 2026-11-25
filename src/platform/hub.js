import * as THREE from 'three';
import { Panel, Pointer, roundRect, fitText, FONTS, Sfx, makeLabel } from './kit.js';

// The game selector: a moonlit stone terrace with game cards in an arc.
export async function createHub(ctx, games, launch) {
  const { scene, input } = ctx;
  scene.background = new THREE.Color(0x0b1020);
  scene.fog = new THREE.Fog(0x0b1020, 30, 120);
  scene.add(new THREE.HemisphereLight(0x8090c0, 0x202030, 1.2));
  const moon = new THREE.DirectionalLight(0xd8e0ff, 1.2); moon.position.set(-10, 20, -15); scene.add(moon);

  // Sky: gradient dome + stars
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 v; void main(){ float h = max(v.y,0.0); vec3 c = mix(vec3(0.16,0.14,0.28), vec3(0.02,0.03,0.08), pow(h,0.5)); gl_FragColor = vec4(c,1.0); }',
  }));
  scene.add(sky);
  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < 1500; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 0.9 + 0.08, Math.random() * 2 - 1).normalize().multiplyScalar(150);
    sp.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true, fog: false })));
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: 0xfff6dd, fog: false }));
  moonDisc.position.set(-40, 60, -90); moonDisc.lookAt(0, 1.6, 0); scene.add(moonDisc);

  // Terrace
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(7, 7.3, 0.3, 48), new THREE.MeshStandardMaterial({ color: 0x5a5866, roughness: 0.9 }));
  floor.position.y = -0.15; scene.add(floor);
  const inlay = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.35, 64), new THREE.MeshBasicMaterial({ color: 0xe2b85c, side: THREE.DoubleSide }));
  inlay.rotation.x = -Math.PI / 2; inlay.position.y = 0.01; scene.add(inlay);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x0a1428, roughness: 0.2, metalness: 0.6 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.6; scene.add(water);
  // Lanterns around the rim
  const lanterns = [];
  for (let i = 0; i < 12; i++) {
    if (i >= 5 && i <= 7) continue; // keep the view of the cards clear
    const a = (i / 12) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a20 }));
    post.position.set(Math.sin(a) * 6.6, 0.7, Math.cos(a) * 6.6); scene.add(post);
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc0261d, emissive: 0xff5020, emissiveIntensity: 1.2 }));
    l.scale.y = 1.25; l.position.set(post.position.x, 1.55, post.position.z); scene.add(l); lanterns.push(l);
  }

  // Title
  const title = new Panel({
    width: 3.2, height: 0.8, px: 1600,
    draw: (c, W, H) => {
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#e2b85c'; c.font = `220px ${FONTS.brush}`; c.fillText('游乐场', W / 2, H * 0.42);
      c.fillStyle = '#c8c0dd'; c.font = `56px ${FONTS.latin}`; c.fillText('VR Playground · point at a game and pull the trigger', W / 2, H * 0.88);
    },
  });
  title.mesh.position.set(0, 3.15, -3.6); title.redraw(); scene.add(title.mesh);

  const help = new Panel({
    width: 1.6, height: 0.34, px: 1024,
    draw: (c, W, H) => {
      roundRect(c, 0, 0, W, H, 30); c.fillStyle = 'rgba(20,20,36,0.85)'; c.fill();
      c.fillStyle = '#f1e6cf'; c.textAlign = 'center'; c.textBaseline = 'middle';
      fitText(c, 'In any game: hold X/Y (left) or B (right) for 1 s to come back here', W / 2, H * 0.36, W - 60, 40, FONTS.sans);
      c.fillStyle = '#a8a0c0';
      fitText(c, 'Desktop: Tab returns here · click to look around', W / 2, H * 0.72, W - 60, 34, FONTS.sans);
    },
  });
  help.mesh.position.set(0, 0.5, -1.6); help.mesh.rotation.x = -0.6; help.redraw(); scene.add(help.mesh);

  // Cards in two arcs
  const pointer = new Pointer(scene);
  const sfx = new Sfx(ctx.audio);
  pointer.onHover = () => sfx.tone({ freq: 1800, dur: 0.03, gain: 0.04 });
  const cards = [];
  const perRow = Math.ceil(games.length / 2);
  games.forEach((g, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    const n = Math.min(perRow, games.length - row * perRow);
    const spread = 1.55;
    const a = (col - (n - 1) / 2) * (spread / Math.max(1, n - 1)) * 1.4;
    const R = 3.2;
    const p = new Panel({
      width: 0.86, height: 1.1, px: 640,
      draw: (c, W, H, panel) => {
        const hov = panel.hover === 'play';
        roundRect(c, 4, 4, W - 8, H - 8, 36);
        const grd = c.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, g.color); grd.addColorStop(1, '#12121c');
        c.fillStyle = grd; c.fill();
        c.lineWidth = hov ? 12 : 4; c.strokeStyle = hov ? '#ffe7a0' : 'rgba(255,255,255,0.35)'; c.stroke();
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = 'rgba(255,255,255,0.92)'; c.font = `300px ${FONTS.brush}`; c.fillText(g.glyph, W / 2, H * 0.32);
        c.fillStyle = '#ffffff'; fitText(c, g.title, W / 2, H * 0.62, W - 60, 72, FONTS.sans);
        c.fillStyle = '#e8e0f0'; fitText(c, g.subtitle, W / 2, H * 0.72, W - 60, 40, FONTS.sans);
        c.fillStyle = '#ffd98a'; fitText(c, g.feature, W / 2, H * 0.81, W - 60, 32, FONTS.sans);
        if (panel._error) { c.fillStyle = '#ff8a7a'; fitText(c, panel._error, W / 2, H * 0.91, W - 60, 28, FONTS.sans); }
        else { c.fillStyle = hov ? '#ffe7a0' : 'rgba(255,255,255,0.55)'; fitText(c, hov ? '▶ PLAY' : '', W / 2, H * 0.91, W - 60, 40, FONTS.sans); }
        panel.buttons.push({ id: 'play', x: 0, y: 0, w: W, h: H, enabled: true, onClick: () => launch(g.id) });
      },
    });
    p.mesh.position.set(Math.sin(a) * R, row === 0 ? 2.05 : 0.88, -Math.cos(a) * R);
    p.mesh.lookAt(0, row === 0 ? 1.9 : 1.2, 0);
    scene.add(p.mesh); pointer.panels.push(p); cards.push({ p, g, base: p.mesh.position.clone(), scale: 1 });
  });

  // Return-from-game error message, if any
  if (ctx.lastError) {
    const lbl = makeLabel(`Couldn't load: ${ctx.lastError}`, { size: 0.12, color: '#ff9a8a', bg: 'rgba(20,10,10,0.8)' });
    lbl.position.set(0, 2.75, -2.5); scene.add(lbl);
    ctx.lastError = null;
  }

  return {
    update(dt, t) {
      const hit = pointer.update(input.main, { show: !input.desktop });
      for (const c of cards) {
        const target = c.p.hover ? 1.08 : 1;
        c.scale += (target - c.scale) * Math.min(1, dt * 12);
        c.p.mesh.scale.setScalar(c.scale);
      }
      if (hit?.button && input.main.triggerDown) { sfx.tone({ freq: 660, dur: 0.12, gain: 0.1 }); sfx.tone({ freq: 990, dur: 0.18, gain: 0.08, delay: 0.06 }); pointer.click(hit); }
      for (let i = 0; i < lanterns.length; i++) lanterns[i].position.y = 1.55 + Math.sin(t * 1.2 + i) * 0.03;
      title.mesh.position.y = 3.15 + Math.sin(t * 0.8) * 0.03;
    },
    dispose() { },
  };
}
