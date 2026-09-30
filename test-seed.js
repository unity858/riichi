// Run with: node test-seed.js
import { newHand, createWall, draw, discard, tileLabel } from './game.js';
import { wallFromSeed, seedFromWall } from './seed.js';
import { check, done } from './test-helpers.js';

const throwsWith = (seed, text) => {
  try {
    wallFromSeed(seed);
    return false;
  } catch (err) {
    return err.message.includes(text);
  }
};

check('non-notation seeds are rejected', throwsWith('hello', 'tile notation'));
check('a fifth copy is rejected', throwsWith('11111m', 'more 1m than exist'));
check('a second red five is rejected', throwsWith('00m', 'one red five'));
check('four plain 5s are rejected, since one 5 is red', throwsWith('5555p', 'red 0'));
check('honors only go up to 7z', throwsWith('8z', 'no tile 8z') && throwsWith('0z', 'no tile 0z'));

{
  const wall = createWall();
  const seed = seedFromWall(wall);
  const again = wallFromSeed(seed);
  check('a full seed reproduces the wall exactly', again.map(tileLabel).join() === wall.map(tileLabel).join() &&
    again.every((t, i) => t.red === wall[i].red) && seedFromWall(again) === seed);
}

{
  const wall = wallFromSeed('123m7z0p');
  const ids = new Set(wall.map((t) => t.id));
  check('a partial seed fixes the first positions and fills the rest',
    wall.length === 136 && ids.size === 136 && wall.slice(0, 5).map(tileLabel).join(' ') === '1m 2m 3m R 0p' && wall[4].red); // 7z is Chun (R)
}

check('comments and whitespace are ignored',
  wallFromSeed('# a comment\n 1 2 3m  # another\n4p\n').slice(0, 4).map(tileLabel).join(' ') === '1m 2m 3m 4p');

{
  // Positions from seed.js: the deal, the dealer's first draw, the next draws and the dead wall.
  const wall = createWall();
  const s = newHand({ wall });
  const ids = (tiles) => tiles.map((t) => t.id).sort((a, b) => a - b).join();
  const at = (...ranges) => ranges.flatMap(([a, b]) => wall.slice(a, b + 1));
  check('the dealer is dealt positions 0-3, 16-19, 32-35 and 48',
    ids(s.players[0].hand) === ids(at([0, 3], [16, 19], [32, 35], [48, 48])));
  check('the next seat is dealt positions 4-7, 20-23, 36-39 and 49',
    ids(s.players[1].hand) === ids(at([4, 7], [20, 23], [36, 39], [49, 49])));
  check('seats 2 and 3 get the remaining deal positions',
    ids(s.players[2].hand) === ids(at([8, 11], [24, 27], [40, 43], [50, 50])) &&
    ids(s.players[3].hand) === ids(at([12, 15], [28, 31], [44, 47], [51, 51])));
  check('the dealer draws position 52', s.players[0].drawn.id === wall[52].id);
  check('the dora indicator is position 126 and the ura indicator 127',
    s.doraIndicators[0].id === wall[126].id && s.uraIndicators[0].id === wall[127].id);
  discard(s, s.players[0].drawn.id);
  draw(s);
  check('the next seat then draws position 53', s.players[1].drawn.id === wall[53].id);
  check('the fixed wall is copied, not consumed', wall.length === 136);
}

done();
