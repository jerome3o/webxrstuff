// Thunder Drums: groove styles, lesson charts and pattern parsing.
// Patterns are 16 steps per bar, bars separated by '|'. 'x' = hit, '.' = rest.
// In the 'bells' track a digit 0-4 picks the bell (0 = lowest).
// Melody tracks use digits as degrees of a D major pentatonic scale (0 = D4).

export const PENTA = [0, 2, 4, 7, 9];
// Degree index (0..14) → frequency. Degree 0 = D4 (MIDI 62).
export function degFreq(d, octaveShift = 0) {
  const oct = Math.floor(d / 5), deg = ((d % 5) + 5) % 5;
  const midi = 62 + (oct + octaveShift) * 12 + PENTA[deg];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Backing groove styles. 2-bar phrases (32 steps).
export const STYLES = [
  {
    id: 'walk', name: 'Temple Walk', bpm: 92,
    kick: 'x.......x..x....|x.......x.......',
    shaker: '..x...x...x...x.|..x...x...x.x.x.',
    melody: '7...9.8.7...5...|6...7.5.4...2...',
    pad: [0, 3],
  },
  {
    id: 'parade', name: 'Dragon Parade', bpm: 108,
    kick: 'x.....x.x.......|x.....x.x...x...',
    shaker: 'x.x.x.x.x.x.x.x.|x.x.x.x.x.x.xxx.',
    melody: '7.7.9.7.5...7...|5.5.4.3.2...0...',
    pad: [0, 4],
  },
  {
    id: 'mist', name: 'Mountain Mist', bpm: 80,
    kick: 'x...............|x.......x.......',
    shaker: '....x.......x...|....x.......x...',
    melody: '5...7...8...9...|7...6...5...4...',
    pad: [0, 2],
  },
];

// Lessons: increasing difficulty. Tracks repeat to fill `bars`.
export const LESSONS = [
  {
    id: 'l1', name: 'First Thunder', stars: 1, bpm: 80, style: 'mist', bars: 8,
    hint: 'Strike the big drum on every beat.',
    tracks: {
      taiko: 'x...x...x...x...|x...x...x...x...|x...x...x...x...|x.......x.......',
    },
  },
  {
    id: 'l2', name: 'Twin Toms', stars: 2, bpm: 88, style: 'walk', bars: 8,
    hint: 'Big drum, then the small drums left and right.',
    tracks: {
      taiko: 'x.......x.......|x.......x.......',
      tomL: '....x...........|....x.x.........',
      tomR: '............x...|............x.x.',
    },
  },
  {
    id: 'l3', name: 'Bronze Bells', stars: 2, bpm: 92, style: 'mist', bars: 8,
    hint: 'Play the bell melody; hit bells at the front centre.',
    tracks: {
      taiko: 'x...............|........x.......',
      bells: '....0...1...2...|3...4.......3...|....2...1...0...|....1...2...0...',
    },
  },
  {
    id: 'l4', name: 'Dragon Parade', stars: 3, bpm: 104, style: 'parade', bars: 8,
    hint: 'Drums, temple block, cymbal and gong together.',
    tracks: {
      taiko: 'x..x..x.x.......|x..x..x.x.......',
      tomL: '..........x.....|..........x.x...',
      tomR: '............x...|..............x.',
      block: '....x...........|....x...........',
      cymR: 'x...............|................',
      gong: '................|x...............',
    },
  },
  {
    id: 'l5', name: 'Thunder Storm', stars: 4, bpm: 120, style: 'parade', bars: 8,
    hint: 'Everything at once. Keep both sticks moving.',
    tracks: {
      taiko: 'x.x.x.x.x...x...|........x.x.x.x.|................|x...x...x.x.x...',
      cymL: 'x...............|................|................|................',
      tomL: '................|x.x.............|................|................',
      tomR: '................|....x.x.........|................|................',
      bells: '................|................|0.1.2.4.3.2.1.0.|................',
      gong: '................|................|................|..............x.',
      cymR: '................|................|x...............|..............x.',
      muyu: '....x.......x...|................|................|................',
      luo: '................|..............x.|................|................',
    },
  },
];

// Parse a pattern into an array of step indices that are hits (or digit values).
export function parsePattern(str, bars) {
  const s = str.replace(/[|\s]/g, '');
  const out = [];
  const total = bars * 16;
  if (!s.length) return out;
  for (let i = 0; i < total; i++) {
    const ch = s[i % s.length];
    if (ch !== '.') out.push({ step: i, ch });
  }
  return out;
}

// Build sorted note list for a lesson: [{ beat, pad }]
export function lessonNotes(lesson) {
  const notes = [];
  for (const [track, pat] of Object.entries(lesson.tracks)) {
    for (const { step, ch } of parsePattern(pat, lesson.bars)) {
      const pad = track === 'bells' ? 'bell' + ch : track;
      notes.push({ beat: step / 4, pad });
    }
  }
  notes.sort((a, b) => a.beat - b.beat);
  return notes;
}

// Pre-parse a style into per-step lookups (32 steps).
export function compileStyle(st) {
  const strip = (p) => p.replace(/[|\s]/g, '');
  const kick = strip(st.kick), shaker = strip(st.shaker), mel = strip(st.melody);
  const steps = [];
  for (let i = 0; i < 32; i++) {
    steps.push({
      kick: kick[i % kick.length] === 'x',
      shaker: shaker[i % shaker.length] === 'x',
      mel: mel[i % mel.length] === '.' ? -1 : parseInt(mel[i % mel.length], 10),
    });
  }
  return { ...st, steps };
}
