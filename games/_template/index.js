import * as THREE from 'three';
import { Locomotion, Sfx } from '../../src/platform/kit.js';

// Minimal working game: shoot spheres with the main trigger, move with the left stick.
// Copy this folder to start a new game. Contract details: GAMES.md.
export async function create(ctx) {
  const { scene, input, rig } = ctx;
  scene.background = new THREE.Color(0x223344);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x556677 }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  const loco = new Locomotion({ speed: 2 });
  const sfx = new Sfx(ctx.audio);
  const balls = [];
  let score = 0;

  return {
    spawn: { x: 0, z: 0, yaw: 0 },
    update(dt, t) {
      loco.update(dt, input, rig);
      const h = input.main;
      if (h.present && h.triggerDown) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffaa33 }));
        b.position.copy(h.rayPos); b.userData.v = h.rayDir().multiplyScalar(8);
        scene.add(b); balls.push(b); score++;
        sfx.tone({ freq: 600, dur: 0.1 }); h.haptic(0.5, 30);
      }
      for (const b of balls) { b.userData.v.y -= 9.8 * dt; b.position.addScaledVector(b.userData.v, dt); }
      ctx.setHud(`Shots: ${score}`);
    },
    dispose() { /* scene contents are disposed by the platform; remove window listeners / DOM / timers here */ },
  };
}
