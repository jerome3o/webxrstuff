// Map definitions. Board-local units: x in [-12, 12], z in [-9, 9] (+z faces the player), y up.
// Path graph edges are directed toward the city gate.
export const MAPS = [
  {
    id: 'jade', name: 'Jade Peak', cn: '翠峰', seed: 11,
    desc: 'Switchbacks up the peak, and a flanking road to the west.',
    island: { cx: 0, cz: 0.3, rx: 10.8, rz: 7.9 },
    city: { x: 0, z: -4.3, r: 2.55, h: 3.1 }, peak: 3.1, sigma: 4.6,
    nodes: {
      SL: [-8.6, 4.6], a1: [-6.2, 6.4], a2: [-3.4, 6.2], a3: [-5.6, 3.0], a4: [-7.8, 1.0], a5: [-6.8, -1.7], a6: [-3.6, -1.7],
      SR: [8.6, 4.6], b1: [6.2, 6.4], b2: [3.4, 6.2],
      m1: [0, 5.6], m2: [-3.0, 3.5], m3: [3.0, 1.4], G: [0, -1.75],
    },
    edges: [
      ['SL', 'a1'], ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a4'], ['a4', 'a5'], ['a5', 'a6'], ['a6', 'G'], ['a2', 'm1'],
      ['SR', 'b1'], ['b1', 'b2'], ['b2', 'm1'],
      ['m1', 'm2'], ['m2', 'm3'], ['m3', 'G'],
    ],
    spawns: ['SL', 'SR'], goal: 'G',
    kites: [[-11.5, 8.5], [11.5, 8.5], [0, 8.8], [-11.8, -2], [11.8, -2]],
    boats: [[-6, 7.6], [9.8, -4.5], [-10.6, -5.5]],
  },
  {
    id: 'mist', name: 'Mist Harbor', cn: '雾港', seed: 29,
    desc: 'A long coastal road with shortcuts. Raiders from two shores.',
    island: { cx: -0.3, cz: 0.2, rx: 11.0, rz: 8.0 },
    city: { x: 5.0, z: -4.2, r: 2.4, h: 2.7 }, peak: 2.7, sigma: 4.2,
    nodes: {
      SL: [-9.0, 4.4], c1: [-6.0, 5.8], c2: [-3.2, 3.9], c3: [-0.4, 5.6], c4: [2.5, 4.0], c5: [5.4, 5.4], c6: [8.2, 3.4], c7: [7.6, 0.6], G: [5.6, -1.85],
      SB: [-9.4, -3.4], d1: [-6.8, -5.4], d2: [-3.7, -4.6], d3: [-4.6, -1.6], d4: [-1.8, 0.6], e1: [0.6, -1.4], e2: [2.6, 1.3],
    },
    edges: [
      ['SL', 'c1'], ['c1', 'c2'], ['c2', 'c3'], ['c3', 'c4'], ['c4', 'c5'], ['c5', 'c6'], ['c6', 'c7'], ['c7', 'G'],
      ['c2', 'd4'], ['SB', 'd1'], ['d1', 'd2'], ['d2', 'd3'], ['d3', 'd4'], ['d4', 'e1'], ['e1', 'e2'], ['e2', 'G'], ['c4', 'e2'],
    ],
    spawns: ['SL', 'SB'], goal: 'G',
    kites: [[-11.8, 8.6], [-11.8, -8.6], [0, 8.8], [-4, -8.8], [11.8, 8.6]],
    boats: [[-2, 8.0], [10.5, -7.0], [-10.4, 0.8]],
  },
];
