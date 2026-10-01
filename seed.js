// Wall seeds: a fixed order for the 136 tiles in place of a random shuffle, for debugging.
// Server-side only.
//
// A seed is written in tile notation, read left to right as wall positions 0, 1, 2, ...:
// "123m" is 1m, 2m, 3m; 0m/0p/0s are the red fives; honors are 1z-7z (E S W N Haku Hatsu
// Chun). A seed shorter than 136 tiles fixes only the first positions; the tiles it doesn't
// use are shuffled into the rest.
//
// How newHand uses the positions (seats counted from the dealer, who is seat 0 for now):
//   0-47     the deal, 4 tiles at a time: 0-3 dealer, 4-7 next seat, 8-11, 12-15, 16-19 dealer, ...
//   48-51    one more tile each, dealer first
//   52       the dealer's first draw
//   53-121   the remaining draws in turn order (53 is the seat after the dealer)
//   122-135  the dead wall:
//              122-125  replacement tiles drawn after a kan, in that order
//              126, 127 the dora indicator and the ura dora indicator
//              128/129, 130/131, 132/133, 134/135  the indicator (and ura) each kan reveals
//            Each kan also moves the last live-wall tile (121, then 120, ...) to the dead wall.

import { createTiles, shuffle } from './game.js';

// Removes '#' comments and all whitespace, so seed files can be annotated.
function stripComments(text) {
  return text.replace(/#.*$/gm, '').replace(/\s+/g, '');
}

// Turns seed text into a full 136-tile wall. Throws with a readable message if the seed
// asks for a tile that doesn't exist or has run out.
export function wallFromSeed(text) {
  const seed = stripComments(text);
  if (!/^(\d+[mpsz])*$/.test(seed)) throw new Error('seed must be tile notation like 123m456p11z (0 = red five)');

  // Unused copies of each tile, keyed like "5m" or "0m" (the red five).
  const unused = new Map();
  for (const tile of createTiles()) {
    const key = `${tile.red ? 0 : tile.rank}${tile.suit}`;
    if (!unused.has(key)) unused.set(key, []);
    unused.get(key).push(tile);
  }

  const wall = [];
  for (const [, digits, suit] of seed.matchAll(/(\d+)([mpsz])/g)) {
    for (const d of digits) {
      const key = `${d}${suit}`;
      if (!unused.has(key)) throw new Error(`there is no tile ${key}`);
      const copies = unused.get(key);
      if (copies.length === 0) {
        const note = d === '0' ? ' (each suit has one red five)' : d === '5' ? ' (one of the four 5s is the red 0)' : '';
        throw new Error(`the seed uses more ${key} than exist${note}`);
      }
      wall.push(copies.shift());
    }
  }
  if (wall.length > 136) throw new Error(`the seed has ${wall.length} tiles; a wall has 136`);
  return [...wall, ...shuffle([...unused.values()].flat())];
}

// The seed that reproduces a wall exactly (136 tiles, runs of the same suit grouped).
export function seedFromWall(wall) {
  let out = '';
  let run = '';
  let runSuit = null;
  for (const t of wall) {
    if (t.suit !== runSuit && runSuit !== null) {
      out += run + runSuit;
      run = '';
    }
    runSuit = t.suit;
    run += t.red ? '0' : String(t.rank);
  }
  return runSuit === null ? '' : out + run + runSuit;
}
