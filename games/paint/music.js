// Soft generative ambience: a breathing drone plus sparse plucked pentatonic notes
// through a generated reverb. Everything is synthesised with WebAudio.

const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27];   // minor pentatonic, two octaves
const ROOT = 146.83;   // D3

export class Music {
  constructor(audio) {
    this.audio = audio; this.on = false; this.nodes = null; this.next = 0; this.step = 4; this.phrase = 0;
  }
  get ac() { return this.audio?.ctx ?? null; }

  _impulse(ac, secs = 3.2) {
    const len = Math.floor(ac.sampleRate * secs), b = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    return b;
  }

  start() {
    const ac = this.ac; if (!ac || this.nodes) { this.on = !!ac; return; }
    this.on = true;
    const t = ac.currentTime;
    const bus = ac.createGain(); bus.gain.setValueAtTime(0, t); bus.gain.linearRampToValueAtTime(0.55, t + 3);
    bus.connect(this.audio.out);
    const verb = ac.createConvolver(); verb.buffer = this._impulse(ac);
    const wet = ac.createGain(); wet.gain.value = 0.55; verb.connect(wet).connect(bus);
    const dry = ac.createGain(); dry.gain.value = 0.6; dry.connect(bus);
    const delay = ac.createDelay(2); delay.delayTime.value = 0.62;
    const fb = ac.createGain(); fb.gain.value = 0.32; delay.connect(fb).connect(delay);
    const dsend = ac.createGain(); dsend.gain.value = 0.3; dsend.connect(delay); delay.connect(verb);
    // drone: two soft tones breathing slowly
    const droneG = ac.createGain(); droneG.gain.value = 0.035;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
    droneG.connect(lp); lp.connect(dry); lp.connect(verb);
    const oscs = [];
    for (const [f, type, g] of [[ROOT / 2, 'sine', 1], [ROOT * 0.75, 'triangle', 0.35], [ROOT / 2 * 1.003, 'sine', 0.7]]) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
      const og = ac.createGain(); og.gain.value = g; o.connect(og).connect(droneG); o.start(); oscs.push(o);
    }
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.06;
    const lfoG = ac.createGain(); lfoG.gain.value = 0.022; lfo.connect(lfoG).connect(droneG.gain); lfo.start(); oscs.push(lfo);
    this.nodes = { bus, verb, dry, dsend, oscs };
    this.next = t + 1.5;
  }

  stop(immediate = false) {
    this.on = false;
    const n = this.nodes; if (!n) return;
    this.nodes = null;
    const ac = this.ac, t = ac.currentTime, fade = immediate ? 0.05 : 1.5;
    try { n.bus.gain.cancelScheduledValues(t); n.bus.gain.setValueAtTime(n.bus.gain.value, t); n.bus.gain.linearRampToValueAtTime(0, t + fade); } catch { }
    for (const o of n.oscs) try { o.stop(t + fade + 0.05); } catch { }
    setTimeout(() => { try { n.bus.disconnect(); } catch { } }, (fade + 0.3) * 1000);
  }

  _pluck(t, semi, vel) {
    const ac = this.ac, n = this.nodes;
    const f = ROOT * Math.pow(2, semi / 12);
    const o1 = ac.createOscillator(); o1.type = 'triangle'; o1.frequency.setValueAtTime(f * 1.004, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const o2 = ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g2 = ac.createGain(); g2.gain.value = 0.25;
    const flt = ac.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.setValueAtTime(3200, t); flt.frequency.exponentialRampToValueAtTime(700, t + 1.2);
    const env = ac.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.09 * vel, t + 0.006); env.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o1.connect(flt); o2.connect(g2).connect(flt); flt.connect(env);
    env.connect(n.dry); env.connect(n.verb); env.connect(n.dsend);
    o1.start(t); o2.start(t); o1.stop(t + 2.8); o2.stop(t + 2.8);
  }

  update() {
    if (!this.on || !this.nodes) return;
    const ac = this.ac, now = ac.currentTime;
    if (this.next < now - 1) this.next = now + 0.2;
    while (this.next < now + 0.25) {
      // gentle random walk on the scale, phrases of 3-6 notes then a rest
      this.step = Math.max(0, Math.min(SCALE.length - 1, this.step + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
      const vel = 0.5 + Math.random() * 0.5;
      this._pluck(this.next, SCALE[this.step], vel);
      if (Math.random() < 0.18) this._pluck(this.next + 0.02, SCALE[Math.max(0, this.step - 2)] - 12, vel * 0.6);
      this.phrase++;
      if (this.phrase > 3 + Math.random() * 3) { this.phrase = 0; this.next += 3.5 + Math.random() * 3; }
      else this.next += [0.55, 0.8, 1.1, 1.6][Math.floor(Math.random() * 4)];
    }
  }
  dispose() { this.stop(true); }
}
