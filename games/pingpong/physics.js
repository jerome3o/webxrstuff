import * as THREE from 'three';

// ── Ball + table physics for Paddle Duel ─────────────────────
// Units: metres, seconds, kilograms. Table centred on the world origin, long axis = Z.
// Player end is +Z, opponent end is -Z. Everything here is allocation-free once loaded.

export const G = 9.81;
export const R = 0.02;            // 40 mm ball
export const M = 0.0027;          // 2.7 g
export const TOP = 0.76;          // table surface height
export const HL = 1.37;           // half length (2.74)
export const HW = 0.7625;         // half width (1.525)
export const THICK = 0.03;        // table top thickness
export const NET_H = 0.1525;      // net height above surface
export const NET_HALF = 0.915;    // net half length (1.83, overhangs sides by 15.25 cm)
export const NET_T = 0.003;       // net half thickness
export const NET_TOP = TOP + NET_H;
export const H = 1 / 480;         // fixed physics step (480 Hz)

const RHO = 1.2, CD = 0.5, AREA = Math.PI * R * R;
export const KD = 0.5 * RHO * CD * AREA / M;   // quadratic drag, ≈0.14 1/m → terminal speed ≈ 8.4 m/s
export const KM = 0.005;                        // Magnus: a = KM (ω × v)
export const SPIN_DECAY = 0.2;                  // 1/s

export const EV_NONE = 0, EV_TABLE = 1, EV_NET = 2, EV_FLOOR = 3;

export function makeBall() { return { p: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3() }; }
export function copyBall(d, s) { d.p.copy(s.p); d.v.copy(s.v); d.w.copy(s.w); return d; }

// Free flight: gravity, quadratic drag, Magnus lift, spin decay. Semi-implicit Euler.
export function integrate(b, h) {
  const v = b.v, w = b.w;
  const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const d = -KD * sp;
  const ax = d * v.x + KM * (w.y * v.z - w.z * v.y);
  const ay = d * v.y + KM * (w.z * v.x - w.x * v.z) - G;
  const az = d * v.z + KM * (w.x * v.y - w.y * v.x);
  v.x += ax * h; v.y += ay * h; v.z += az * h;
  b.p.x += v.x * h; b.p.y += v.y * h; b.p.z += v.z * h;
  const k = 1 - SPIN_DECAY * h;
  w.x *= k; w.y *= k; w.z *= k;
}

// Impulse contact between the ball and a (very heavy) surface.
// n: unit normal pointing from the surface towards the ball centre. s: surface velocity at the contact point.
// e: normal restitution. mu: Coulomb friction. The tangential impulse either stops the contact
// point slipping (ball leaves rolling on the surface: spin transfer) or is limited by mu * Jn.
// Returns the approach speed (>0) if an impulse was applied, else 0.
export function contact(b, nx, ny, nz, sx, sy, sz, e, mu) {
  const v = b.v, w = b.w;
  const wnx = w.y * nz - w.z * ny, wny = w.z * nx - w.x * nz, wnz = w.x * ny - w.y * nx; // ω × n
  const ux = v.x - R * wnx - sx, uy = v.y - R * wny - sy, uz = v.z - R * wnz - sz;    // contact point rel. velocity
  const un = ux * nx + uy * ny + uz * nz;
  if (un >= 0) return 0;
  const tx = ux - un * nx, ty = uy - un * ny, tz = uz - un * nz;
  const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
  const jn = -(1 + e) * un;                       // Δv along n
  // Hollow sphere: I = 2/3 m r² → tangential effective mass = m / (1 + m r²/I) = 0.4 m.
  let k = 0.4;
  if (tl > 1e-9 && 0.4 * tl > mu * jn) k = mu * jn / tl;
  const jx = -k * tx, jy = -k * ty, jz = -k * tz;  // tangential Δv
  v.x += jn * nx + jx; v.y += jn * ny + jy; v.z += jn * nz + jz;
  const c = -1.5 / R;                              // Δω = (r_c × J)/I = -(1.5/r) (n × Δv_t)
  w.x += c * (ny * jz - nz * jy); w.y += c * (nz * jx - nx * jz); w.z += c * (nx * jy - ny * jx);
  return -un;
}

export function tableRestitution(vn) { return Math.min(0.93, Math.max(0.7, 0.935 - 0.02 * vn)); }
export function paddleRestitution(vn) { return Math.min(0.88, Math.max(0.62, 0.88 - 0.012 * vn)); }
export const MU_TABLE = 0.22, MU_PADDLE = 0.75, MU_NET = 0.3, MU_FLOOR = 0.35;

// Ball vs table top/sides, net and floor for one step. `prev` = ball centre before integrate().
// Writes ev.{type,x,y,z,speed} and returns the event type (only "audible" contacts are reported).
export function collideStatic(b, prev, h, ev) {
  const p = b.p, v = b.v;
  ev.type = EV_NONE;
  // ── Net (thin box at z = 0) ──
  if ((prev.z > 0) !== (p.z > 0) || Math.abs(p.z) < R + NET_T) {
    let hit = false, nx = 0, ny = 0, nz = 0, cx = p.x, cy = p.y;
    const dirZ = p.z - prev.z;
    if ((prev.z > 0) !== (p.z > 0)) {
      const f = prev.z / (prev.z - p.z);
      cx = prev.x + (p.x - prev.x) * f; cy = prev.y + (p.y - prev.y) * f;
      if (Math.abs(cx) <= NET_HALF && cy < NET_TOP + R && cy > TOP) {
        const s = dirZ > 0 ? -1 : 1;                // normal faces the side the ball came from
        if (cy <= NET_TOP) { nz = s; p.set(cx, cy, s * (R + NET_T)); }
        else {
          const dy = cy - NET_TOP, dz = Math.sqrt(Math.max(0, R * R - dy * dy));
          ny = dy / R; nz = s * dz / R; p.set(cx, NET_TOP + dy, s * (dz + NET_T));
        }
        hit = true;
      }
    } else if (Math.abs(p.x) <= NET_HALF && p.y < NET_TOP + R && p.y > TOP) {
      const qy = Math.min(p.y, NET_TOP), qz = Math.max(-NET_T, Math.min(NET_T, p.z));
      const dy = p.y - qy, dz = p.z - qz, dl = Math.sqrt(dy * dy + dz * dz);
      if (dl < R && dl > 1e-7) { ny = dy / dl; nz = dz / dl; p.y = qy + ny * R; p.z = qz + nz * R; hit = true; }
    }
    if (hit) {
      const s = contact(b, nx, ny, nz, 0, 0, 0, 0.18, MU_NET);
      if (s > 0.05) { ev.type = EV_NET; ev.x = p.x; ev.y = p.y; ev.z = p.z; ev.speed = s; return EV_NET; }
    }
  }
  // ── Table top ──
  const top = TOP + R;
  if (p.y < top && prev.y >= top - 0.004 && v.y < 0) {
    const f = prev.y > p.y ? Math.min(1, Math.max(0, (prev.y - top) / (prev.y - p.y))) : 1;
    const cx = prev.x + (p.x - prev.x) * f, cz = prev.z + (p.z - prev.z) * f;
    if (Math.abs(cx) <= HW + R * 0.5 && Math.abs(cz) <= HL + R * 0.5) {
      const vn = -v.y;
      const s = contact(b, 0, 1, 0, 0, 0, 0, tableRestitution(vn), MU_TABLE);
      const rem = (1 - f) * h;
      p.set(cx + v.x * rem, top + Math.max(0, v.y * rem), cz + v.z * rem);
      if (s > 0.3) { ev.type = EV_TABLE; ev.x = cx; ev.y = top; ev.z = cz; ev.speed = s; return EV_TABLE; }
      return EV_NONE;
    }
  }
  // ── Table edges / sides (no valid bounce) ──
  if (p.y < top && p.y > TOP - THICK - R && Math.abs(p.x) < HW + R && Math.abs(p.z) < HL + R) {
    const qx = Math.max(-HW, Math.min(HW, p.x)), qy = Math.max(TOP - THICK, Math.min(TOP, p.y)), qz = Math.max(-HL, Math.min(HL, p.z));
    const dx = p.x - qx, dy = p.y - qy, dz = p.z - qz, dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < R && dl > 1e-7) {
      p.set(qx + dx / dl * R, qy + dy / dl * R, qz + dz / dl * R);
      contact(b, dx / dl, dy / dl, dz / dl, 0, 0, 0, 0.5, 0.2);
    }
  }
  // ── Floor ──
  if (p.y < R && v.y < 0) {
    const vn = -v.y;
    p.y = R;
    const s = contact(b, 0, 1, 0, 0, 0, 0, 0.72, MU_FLOOR);
    if (vn > 0.4) { ev.type = EV_FLOOR; ev.x = p.x; ev.y = 0; ev.z = p.z; ev.speed = s; return EV_FLOOR; }
  }
  return EV_NONE;
}

// ── Prediction ───────────────────────────────────────────────
// Simulates a copy of the ball with static collisions only and records every step and event.
export class Predictor {
  constructor(maxSteps = 1500) {
    this.max = maxSteps;
    this.pos = new Float32Array(maxSteps * 3);
    this.n = 0;
    this.evType = new Int8Array(16); this.evStep = new Int32Array(16); this.evX = new Float32Array(16); this.evZ = new Float32Array(16);
    this.nev = 0;
    this.b = makeBall(); this.prev = new THREE.Vector3(); this.ev = { type: 0, x: 0, y: 0, z: 0, speed: 0 };
  }
  // Runs from state `src` for up to `steps`. Stops at the floor (or the second floor bounce if keepFloor).
  run(src, steps = this.max) {
    const b = copyBall(this.b, src), prev = this.prev, ev = this.ev;
    this.n = 0; this.nev = 0;
    steps = Math.min(steps, this.max);
    for (let i = 0; i < steps; i++) {
      prev.copy(b.p);
      integrate(b, H);
      const t = collideStatic(b, prev, H, ev);
      const o = i * 3; this.pos[o] = b.p.x; this.pos[o + 1] = b.p.y; this.pos[o + 2] = b.p.z;
      this.n = i + 1;
      if (t !== EV_NONE && this.nev < 16) {
        const k = this.nev++;
        this.evType[k] = t; this.evStep[k] = i; this.evX[k] = ev.x; this.evZ[k] = ev.z;
      }
      if (t === EV_FLOOR || b.p.y < 0.1) break;
    }
    return this;
  }
  // First table/floor contact after free flight, or null-ish index -1
  firstEvent(type, from = 0) { for (let k = from; k < this.nev; k++) if (this.evType[k] === type) return k; return -1; }
}

// ── Shot solver ──────────────────────────────────────────────
// Finds the launch velocity from p0 (with spin w0) that lands on the table plane at (tx, tz)
// after ~T seconds, accounting for drag and Magnus (shooting method). Returns false if it fails.
const _sb = makeBall();
export function solveShot(p0, w0, tx, tz, T, outV) {
  const top = TOP + R;
  outV.set((tx - p0.x) / T, (top - p0.y + 0.5 * G * T * T) / T, (tz - p0.z) / T);
  // drag pre-compensation
  outV.x *= 1.1; outV.z *= 1.1;
  for (let it = 0; it < 16; it++) {
    _sb.p.copy(p0); _sb.v.copy(outV); _sb.w.copy(w0);
    let t = 0, lx = 0, lz = 0, landed = false;
    for (let i = 0; i < 1500; i++) {
      const py = _sb.p.y, px = _sb.p.x, pz = _sb.p.z;
      integrate(_sb, H); t += H;
      if (t > 0.04 && _sb.v.y < 0 && _sb.p.y <= top) {
        const f = (py - top) / (py - _sb.p.y);
        lx = px + (_sb.p.x - px) * f; lz = pz + (_sb.p.z - pz) * f; t -= H * (1 - f);
        landed = true; break;
      }
    }
    if (!landed) { outV.y *= 0.7; continue; }
    const ex = tx - lx, ez = tz - lz, et = T - t;
    if (Math.abs(ex) < 0.004 && Math.abs(ez) < 0.004 && Math.abs(et) < 0.005) return true;
    outV.x += ex / t; outV.z += ez / t; outV.y += et * G * 0.5;
  }
  return false;
}

// ── Paddle geometry (shared by player + bot) ─────────────────
// Paddle local frame: origin at the grip (palm), handle along local Z, blade centred at
// (0, 0, -BLADE_Z), face normals = ±local X (forehand face = +X, red).
export const BLADE_Z = 0.155, BLADE_AY = 0.076, BLADE_AZ = 0.08, BLADE_HT = 0.0075;
