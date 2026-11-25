import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Simple leather climbing gloves that curl closed when gripping, with a wrist stamina meter.
// Glove frame follows the controller grip pose: -Z forward (knuckles), +Y back of the hand.
const BASE = new THREE.Color(0xc8935c), RED = new THREE.Color(0xd0301e);
const M_HI = new THREE.Color(0x6fd36a), M_MID = new THREE.Color(0xf2c14a), M_LO = new THREE.Color(0xe0402a);

export function makeGlove(isLeft) {
  const side = isLeft ? -1 : 1;
  const mat = new THREE.MeshLambertMaterial({ color: BASE.clone() });
  const group = new THREE.Group();
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.085, 0.036, 0.095, 2, 0.014), mat);
  group.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.037, 0.045, 10), new THREE.MeshLambertMaterial({ color: 0x6a7c8c }));
  cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.064; cuff.scale.set(1, 1, 0.75); group.add(cuff);
  // fingers hinge at the front edge of the palm
  const fingers = new THREE.Group(); fingers.position.set(0, -0.004, -0.046); group.add(fingers);
  const fg = new RoundedBoxGeometry(0.082, 0.028, 0.085, 2, 0.012); fg.translate(0, 0, -0.04);
  const fm = new THREE.Mesh(fg, mat); fingers.add(fm);
  // knuckle grooves (dark stripes) give the mitt finger definition
  const thumb = new THREE.Group(); thumb.position.set(-0.045 * side, -0.006, -0.01); group.add(thumb);
  const tg = new RoundedBoxGeometry(0.028, 0.026, 0.06, 2, 0.011); tg.translate(0, 0, -0.026);
  const tm = new THREE.Mesh(tg, mat); thumb.add(tm); thumb.rotation.y = 0.5 * side;
  // stamina meter on the back of the wrist
  const meterBg = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.008, 0.014), new THREE.MeshBasicMaterial({ color: 0x1a1d22 }));
  meterBg.position.set(0, 0.024, 0.03); group.add(meterBg);
  const meterMat = new THREE.MeshBasicMaterial({ color: M_HI.clone() });
  const mg = new THREE.BoxGeometry(0.07, 0.01, 0.012); mg.translate(0.035, 0, 0);
  const meter = new THREE.Mesh(mg, meterMat); meter.position.set(-0.035, 0.025, 0.03); group.add(meter);

  let closed = 0;
  return {
    group, mat,
    // c: 0 open .. 1 fist
    setClosed(c, dt) {
      closed += (c - closed) * Math.min(1, dt * 18);
      fingers.rotation.x = -closed * 1.7;
      thumb.rotation.x = -closed * 0.9;
      thumb.rotation.y = (0.5 - closed * 0.6) * side;
    },
    setStamina(s, flash) {
      meter.scale.x = Math.max(0.001, s);
      if (s > 0.5) meterMat.color.copy(M_MID).lerp(M_HI, (s - 0.5) * 2); else meterMat.color.copy(M_LO).lerp(M_MID, s * 2);
      const k = Math.min(1, Math.max(0, (0.5 - s) / 0.5));
      mat.color.copy(BASE).lerp(RED, k * (flash ? 1 : 0.75));
    },
  };
}
