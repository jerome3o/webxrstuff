// Every tunable number in one place, so iterating on feel means editing this file.

export const CFG = {
  gravity: -9.81,
  eyeHeightDesktop: 1.65,

  // ── Weapons ────────────────────────────────────────────────
  weapons: {
    bow: {
      id: 'bow', cn: '弓', pinyin: 'gōng', en: 'Horn bow',
      ammoStart: 20, ammoMax: 30,
      minSpeed: 18, maxSpeed: 62,      // m/s at zero / full draw
      maxDraw: 0.70,                   // metres of string pull for full power
      braceHeight: 0.17,
      drag: 0.0018,                    // quadratic drag coefficient
      windFactor: 0.35,
    },
    rocket: {
      id: 'rocket', cn: '火龙', pinyin: 'huǒlóng', en: 'Fire-dragon rocket',
      ammoStart: 4, ammoMax: 8,
      launchSpeed: 9, thrust: 26, maxSpeed: 34, burnTime: 2.4,
      gravityScale: 0.12,              // a little sag after the motor burns out
      blastRadius: 5.5,
      cooldown: 1.1,
    },
    sniper: {
      id: 'sniper', cn: '穿云', pinyin: 'chuān yún', en: 'Cloud-piercer rifle',
      ammoStart: 5, ammoMax: 10,
      chargeTime: 1.25,                // seconds of held trigger before it can fire
      muzzleSpeed: 850, drag: 0.00002, windFactor: 0.02,
      scopeFov: 6, cooldown: 0.6,
    },
    pistol: {
      id: 'pistol', cn: '手铳', pinyin: 'shǒuchòng', en: 'Hand cannon',
      ammoStart: Infinity, ammoMax: Infinity,
      muzzleSpeed: 140, drag: 0.0006, windFactor: 0.1,
      cooldown: 0.22,
    },
  },
  weaponOrder: ['bow', 'rocket', 'sniper', 'pistol'],

  // Supply crates: only the hand cannon opens them.
  crates: {
    maxAlive: 4,
    respawn: 4.5,
    give: { bow: 6, rocket: 2, sniper: 3 },
  },

  // ── Scoring ────────────────────────────────────────────────
  roundSeconds: 90,
  comboStep: 5,          // hits per multiplier step
  comboMaxMult: 4,
  freePlayTokenRate: 1 / 20,
  roundTokenRate: 1 / 10,

  // ── Comfort / input ───────────────────────────────────────
  snapTurnDeg: 30,
  stickDeadzone: 0.6,

  // ── Perf ──────────────────────────────────────────────────
  maxStuckProjectiles: 40,
  particleCapacity: 3000,
  scopeResolution: 512,
};

// Shop items bought with copper coins (铜钱).
export const SHOP = [
  { id: 'fireTips', cn: '火箭头', pinyin: 'huǒ jiàntóu', en: 'Fire arrowheads: arrows burst on impact', price: 300 },
  { id: 'focus', cn: '凝神', pinyin: 'níngshén', en: 'Focus: time slows at full draw or full charge', price: 400 },
  { id: 'quiver', cn: '大箭囊', pinyin: 'dà jiànnáng', en: 'Big quiver: +15 arrow capacity', price: 150 },
  { id: 'powder', cn: '火药桶', pinyin: 'huǒyào tǒng', en: 'Powder keg: +4 rocket capacity', price: 200 },
  { id: 'bandolier', cn: '弹带', pinyin: 'dàndài', en: 'Bandolier: +5 rifle capacity', price: 200 },
  { id: 'skinLacquer', cn: '朱漆弓', pinyin: 'zhūqī gōng', en: 'Vermilion lacquer bow', price: 150, skin: 'lacquer' },
  { id: 'skinJade', cn: '玉弓', pinyin: 'yù gōng', en: 'Jade bow', price: 450, skin: 'jade' },
  { id: 'skinDragon', cn: '金龙弓', pinyin: 'jīnlóng gōng', en: 'Golden dragon bow', price: 900, skin: 'dragon' },
];

export const COMBO_WORDS = [
  { at: 5, cn: '好!', en: 'Good!' },
  { at: 10, cn: '厉害!', en: 'Impressive!' },
  { at: 15, cn: '太棒了!', en: 'Fantastic!' },
  { at: 20, cn: '神射手!', en: 'Divine marksman!' },
  { at: 30, cn: '百发百中!', en: 'A hundred shots, a hundred hits!' },
];
