// Point-mass glider model for a large bird (pure, no three.js).
// State: airspeed V, flight-path angle gamma. Heading is handled by the caller (turnRate).
// Controls (all 0..1 unless noted):
//   spread  wing area (arms out)      sweep  arms swept back (dive)
//   pitch   -1..1 extra angle of attack (hands slightly forward = +)
//   brake   flare/airbrake drag        bank   radians, + = turn right
//   flap    downstroke strength (m/s of hand speed, already gated by spread)

export const G = 9.8;
export const V_TRIM = 13;             // level-flight speed with full spread, neutral pitch
const K = G / (V_TRIM * V_TRIM);      // lift per V^2 per unit area*CL
const CD0 = 0.0034, KI = 0.75, CDB = 0.03;
export const V_STALL = 7.2;
export const V_MAX = 42;

export class FlightModel {
  constructor() { this.V = 13; this.gamma = 0; this.gdot = 0; this.stall = 0; this.aL = G; this.turnRate = 0; this.thrust = 0; }
  reset(V = 13, gamma = 0) { this.V = V; this.gamma = gamma; this.gdot = 0; this.stall = 0; this.turnRate = 0; this.thrust = 0; }
  // ctl: {spread, sweep, pitch, brake, bank, flap}; boost: extra forward accel (m/s^2)
  step(dt, ctl, boost = 0) {
    const V = Math.max(1, this.V);
    const area = 0.18 + 0.82 * ctl.spread * (1 - 0.55 * ctl.sweep);
    let cl = 1 + 0.55 * ctl.pitch + 0.6 * ctl.brake - 0.55 * ctl.sweep;
    cl = Math.max(0.2, cl);
    // stall: lift collapses below a speed that grows with demanded CL
    const vs = V_STALL * Math.sqrt(Math.max(0.6, 1 + 0.55 * ctl.pitch - 0.55 * ctl.sweep));
    const st = V < vs ? Math.min(1, (vs - V) / 3) : 0;
    this.stall += (st - this.stall) * Math.min(1, dt * 6);
    let aL = K * V * V * area * cl * (1 - 0.6 * this.stall);
    // flapping: thrust along the path + direct lift
    const flap = Math.min(4, ctl.flap);
    aL += 3.0 * flap * (0.5 + 0.5 * ctl.spread);
    aL = Math.min(aL, 3.2 * G);       // structural limit / comfort
    const aD = CD0 * V * V * (0.45 + 0.55 * area) + CDB * ctl.brake * V * V + KI * (aL * aL) / (V * V + 4) * (0.6 + 0.4 / Math.max(0.3, area));
    this.thrust = 2.6 * flap + boost;
    const cg = Math.cos(this.gamma), sg = Math.sin(this.gamma);
    const cb = Math.cos(ctl.bank), sb = Math.sin(ctl.bank);
    // speed
    let dV = this.thrust - aD - G * sg;
    this.V = Math.min(V_MAX, Math.max(2, V + dV * dt));
    // path angle with phugoid damping
    const raw = (aL * cb - G * cg) / V;
    this.gdot += (raw - this.gdot) * Math.min(1, dt * 5);
    this.gdot -= this.gdot * Math.min(1, dt * 3.2);
    this.gdot = Math.max(-0.7, Math.min(0.7, this.gdot));
    this.gamma = Math.max(-1.25, Math.min(1.0, this.gamma + this.gdot * dt));
    // pull the nose down when stalled
    if (this.stall > 0.05) this.gamma -= this.stall * 0.5 * dt;
    this.turnRate = (aL * sb) / (V * Math.max(0.4, cg));
    this.aL = aL;
    return this;
  }
}
