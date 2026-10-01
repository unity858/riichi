// Run with: node test-seed.js
import fs from 'node:fs';
import { newHand, createWall, draw, discard, tsumo, declareRiichi, declareKyuushu, declareKan, canRon, tileLabel } from './game.js';
import { wallFromSeed, seedFromWall } from './seed.js';
import { passClaims, check, done } from './test-helpers.js';

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
  passClaims(s); // the next seat may be offered a chii or ron
  draw(s);
  check('the next seat then draws position 53', s.players[1].drawn.id === wall[53].id);
  check('the fixed wall is copied, not consumed', wall.length === 136);
}

// --- The seed files in seeds/ play out as their headers say ---

// East discards `firstDiscard` (declaring riichi with it if asked), everyone else discards
// their draw, then East tsumos. Returns East's score, or null if the scenario breaks.
function playSeed(file, { firstDiscard = null, riichi = false } = {}) {
  const s = newHand({ wall: wallFromSeed(fs.readFileSync(file, 'utf8')) });
  if (firstDiscard) {
    const east = s.players[0];
    const tile = [...east.hand, east.drawn].find((t) => tileLabel(t) === firstDiscard);
    if (riichi) declareRiichi(s, 0, tile.id); else discard(s, tile.id);
    for (let i = 0; i < 3; i++) {
      draw(s);
      if (s.phase !== 'discard') return null;
      discard(s, s.players[s.current].drawn.id);
      if (s.phase !== 'draw') return null; // somebody could call
    }
    draw(s);
  }
  return tsumo(s, 0) ? s.result.scores[0] : null;
}
const yakuNames = (sc) => sc?.yaku.map((y) => y.name).sort().join(', ');

{
  const sc = playSeed('seeds/riichi-ippatsu.txt', { firstDiscard: 'R', riichi: true });
  check('seeds/riichi-ippatsu.txt: double riichi ippatsu baiman, 8000 all', sc?.limit === 'Baiman' && sc.payment.all === 8000);
}
{
  const sc = playSeed('seeds/tenhou.txt');
  check('seeds/tenhou.txt: tenhou, 16000 all', yakuNames(sc) === 'Tenhou' && sc.payment.all === 16000);
}
{
  const sc = playSeed('seeds/kokushi-turn2.txt', { firstDiscard: '5m' });
  check('seeds/kokushi-turn2.txt: kokushi, 16000 all', yakuNames(sc) === 'Kokushi musou' && sc.payment.all === 16000);
}
{
  const sc = playSeed('seeds/chiitoi-turn2.txt', { firstDiscard: '3p' });
  check('seeds/chiitoi-turn2.txt: chiitoitsu + tanyao + menzen tsumo, 4 han 25 fu, 3200 all',
    yakuNames(sc) === 'Chiitoitsu, Menzen tsumo, Tanyao' && sc.han === 4 && sc.fu === 25 && sc.payment.all === 3200);
  const withRiichi = playSeed('seeds/chiitoi-turn2.txt', { firstDiscard: '3p', riichi: true });
  check('seeds/chiitoi-turn2.txt with riichi: double riichi + ippatsu haneman, 6000 all',
    withRiichi?.limit === 'Haneman' && withRiichi.han === 7 && withRiichi.payment.all === 6000);
}
{
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/kyuushu.txt', 'utf8')) });
  check('seeds/kyuushu.txt: the dealer can declare kyuushu kyuuhai on the first draw',
    declareKyuushu(s, 0) && s.result.reason === 'kyuushu kyuuhai');
}
{
  // Each player in turn declares riichi with the honor they drew.
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/suucha-riichi.txt', 'utf8')) });
  for (let i = 0; i < 4 && s.phase !== 'ended'; i++) {
    declareRiichi(s, s.current, s.players[s.current].drawn.id);
    draw(s);
  }
  check('seeds/suucha-riichi.txt: the fourth riichi ends the hand with 4 sticks on the table',
    s.result?.reason === 'suucha riichi' && s.riichiSticks === 4);
}

{
  // Closed kan on the first draw, then a tsumo on the replacement tile.
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/kan.txt', 'utf8')) });
  declareKan(s, 0, 0);
  draw(s);
  const sc = tsumo(s, 0) ? s.result.scores[0] : null;
  check('seeds/kan.txt: closed kan, then rinshan kaihou + menzen tsumo, 2 han 60 fu, 2000 all',
    yakuNames(sc) === 'Menzen tsumo, Rinshan kaihou' && sc.han === 2 && sc.fu === 60 && sc.payment.all === 2000);
}

// seeds/kan-manual.txt: closed kan of Chun on the first draw, a useless replacement tile,
// then the winning 4s on the next turn, with or without riichi on the replacement.
for (const riichi of [false, true]) {
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/kan-manual.txt', 'utf8')) });
  declareKan(s, 0, 33);
  draw(s);
  const replacement = s.players[0].drawn.id;
  if (riichi) declareRiichi(s, 0, replacement); else discard(s, replacement);
  for (let i = 0; i < 3 && s.phase === 'draw'; i++) {
    draw(s);
    discard(s, s.players[s.current].drawn.id);
  }
  draw(s);
  const sc = tsumo(s, 0) ? s.result.scores[0] : null;
  check(`seeds/kan-manual.txt ${riichi ? 'with riichi: sanbaiman, 12000 all' : 'without riichi: haneman, 6000 all'}`,
    riichi ? sc?.limit === 'Sanbaiman' && sc.payment.all === 12000 : sc?.limit === 'Haneman' && sc.payment.all === 6000);
}

{
  // seeds/nagashi.txt: everyone discards their draw (passing on any call) to the end.
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/nagashi.txt', 'utf8')) });
  for (let steps = 0; s.phase !== 'ended' && steps < 500; steps++) {
    if (s.phase === 'discard') discard(s, s.players[s.current].drawn.id);
    passClaims(s);
    draw(s);
  }
  check('seeds/nagashi.txt: exhaustive draw with nagashi mangan for East, 4000 all, East revealed',
    s.result?.type === 'exhaustiveDraw' && s.result.nagashi.join() === '0' &&
    s.result.deltas.join() === '12000,-4000,-4000,-4000' && s.result.revealed.join() === '0');
}

{
  // seeds/sanankou-tsumo.txt: 1113335577m 123s can't ron the 5m South throws, but tsumos the 7m.
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/sanankou-tsumo.txt', 'utf8')) });
  discard(s, s.players[0].drawn.id);
  draw(s);
  discard(s, s.players[1].drawn.id); // the 5m
  const ronOffered = canRon(s, 0);
  passClaims(s);
  for (let i = 0; i < 2; i++) {
    draw(s);
    discard(s, s.players[s.current].drawn.id);
  }
  draw(s);
  const sc = tsumo(s, 0) ? s.result.scores[0] : null;
  check('seeds/sanankou-tsumo.txt: no ron on the 5m, then tsumo on the 7m for sanankou, 2600 all',
    !ronOffered && yakuNames(sc) === 'Menzen tsumo, Sanankou' && sc.payment.all === 2600);
}

done();
