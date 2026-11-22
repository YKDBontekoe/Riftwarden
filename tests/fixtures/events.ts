// One valid sample per replicated event tag (shapes copied from the real emitters); shared by the event and codec tests.
const CFG = { base: 'standard', weapon: 'autocannon', core: 'standard_core', modifier: 'none' };
export const V = [1, 2, 3];

/** One valid sample per tag (shapes copied from the real emitters). */
export const SAMPLES: Record<string, unknown[]> = {
  f: ['f', 'burst', [{ v: V }]],
  w: ['w', 'arc', [{ v: V }, { v: V }]],
  s: ['s', 'shoot', { volume: 0.5 }, V],
  u: ['u', 'alert', { text: 'x', tone: 'red' }],
  t: ['t', 'marker', 4, [{ v: V }]],
  o: ['o', 'lob', 9, [{ v: V }]],
  ev: ['ev', 'routes', 1],
  hz: ['hz', 12.5, -4, 1.8, 'slag', 5],
  es: ['es', 7, 'walker', [], null, 1, 100, 0, 1, 2, 0.5, 1, 'north'],
  ek: ['ek', 7, 1],
  er: ['er', 7],
  ed: ['ed', 7, 0],
  el: ['el', 7, 3],
  'T+': ['T+', 1, CFG, V, 0.2, 'Alpha', ''],
  'T-': ['T-', 1],
  Tc: ['Tc', 1, CFG, 2],
  dp: ['dp', 'wall', [1, 0, 2], 0.5, 6, 3],
  'L+': ['L+', 3, { uid: 'a.1' }, V, V, 4],
  'L-': ['L-', 3, 1],
  up: ['up', 'w_vent', 'Alpha'],
  offer: ['offer', ['a', 'b', 'c'], 'player-1', 'Alpha', 30],
  vote: ['vote', 0, 1],
  bank: ['bank', 5, 1, 10, 20, 3, 2],
  def: ['def'],
  h: ['h', 12.5, 0, V],
  k: ['k', V, 9],
  mv: ['mv', V],
  left: ['left', 'p1', 'Alpha'],
  shot: ['shot', 'p1', 'rail', V],
};

