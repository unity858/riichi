// Shared helpers for the test-*.js scripts.
import { newHand, claim } from './game.js';

// Parse short notation like "123m456p11z" into tile objects (0 = red five).
// Ids start at `base` so hands built for different seats never share an id.
export function parse(str, base = 1000) {
  const tiles = [];
  let id = base;
  for (const [, digits, suit] of str.matchAll(/(\d+)([mpsz])/g)) {
    for (const d of digits) {
      tiles.push({ id: id++, suit, rank: d === '0' ? 5 : Number(d), red: d === '0' });
    }
  }
  return tiles;
}

// 13 tiles that no single tile can complete.
export const NOTEN = '1234567m2468p13s';

// A dealt hand with chosen hands; seats not given one get NOTEN so they can never win.
// Seat 0 is the dealer and is in its discard phase, holding `drawn` if given.
// `wall` truncates the live wall to that many tiles.
export function table({ hands = {}, drawn, wall, scores } = {}) {
  const state = newHand(scores ? { scores } : {});
  for (const seat of [0, 1, 2, 3]) {
    state.players[seat].hand = parse(hands[seat] ?? NOTEN, 1000 + seat * 100);
  }
  if (drawn) state.players[0].drawn = parse(drawn, 1900)[0];
  if (wall !== undefined) state.wall = state.wall.slice(0, wall);
  return state;
}

// Every undecided seat except `keep` passes on the open discard (ron and chii offers).
export function passClaims(state, keep = null) {
  for (const seat of Object.keys(state.claims).map(Number)) {
    if (seat !== keep && state.claims[seat] === null) claim(state, seat, 'pass');
  }
}

// Puts `tiles` at the front of the wall, so the next draws are exactly those tiles in order.
export function stackWall(state, tiles) {
  const stacked = parse(tiles, 6000);
  state.wall = [...stacked, ...state.wall.slice(stacked.length)];
}

let failures = 0;
export function check(name, ok) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
}

// Call at the end of a test script.
export function done() {
  process.exitCode = failures ? 1 : 0;
}
