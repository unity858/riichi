// Run with: node test-abortive.js
import {
  draw, discard, claim, canKyuushu, declareKyuushu, declareRiichi, canTsumo, riichiDiscards,
} from './game.js';
import { newMatch, recordHand, handLabel } from './match.js';
import { parse, table, passClaims, check, done } from './test-helpers.js';

// --- Kyuushu kyuuhai ---
// Seat 0 (dealer) on its first draw.
const firstDraw = (hand, drawn) => table({ hands: { 0: hand }, drawn });

check('9 different terminals and honors on the first draw allow kyuushu kyuuhai',
  canKyuushu(firstDraw('19m19p19s123z456m7p', '5p'), 0));
check('8 are not enough', !canKyuushu(firstDraw('19m19p19s12z456m78p', '5p'), 0));
check('duplicates do not count: 11m 99m is two kinds', !canKyuushu(firstDraw('1199m19p19s12z567m', '5p'), 0));
check('the drawn tile counts towards the 9', canKyuushu(firstDraw('19m19p19s12z456m78p', '3z'), 0));

{
  const s = firstDraw('19m19p19s123z456m7p', '5p');
  s.players[0].discards = parse('9p', 1950);
  check('only on the first draw', !canKyuushu(s, 0));
}
{
  const s = firstDraw('19m19p19s123z456m7p', '5p');
  s.callMade = true;
  check('not after any call', !canKyuushu(s, 0));
}
{
  // Seat 1 has 9 kinds; it's seat 0's turn.
  const s = table({ hands: { 1: '19m19p19s123z456m7p' }, drawn: '5p' });
  check('only on your own turn', !canKyuushu(s, 1) && !declareKyuushu(s, 1) && s.phase === 'discard');
}

{
  const s = firstDraw('19m19p19s123z456m7p', '5p');
  s.riichiSticks = 2;
  check('declaring it ends the hand as an abortive draw with no payments', declareKyuushu(s, 0) && s.phase === 'ended' &&
    s.result.type === 'abortiveDraw' && s.result.reason === 'kyuushu kyuuhai' && s.result.deltas.every((d) => d === 0) &&
    s.result.revealed.join() === '0' && s.riichiSticks === 2);
  const m = newMatch();
  m.riichiSticks = 2;
  recordHand(m, s);
  check('after an abortive draw the dealer repeats with one more honba, and the sticks stay',
    handLabel(m) === 'East 1' && m.dealer === 0 && m.honba === 1 && m.riichiSticks === 2);
}

{
  // Non-dealer first draw.
  const s = table({ hands: { 1: '19m19p19s123z456m7p' }, drawn: '5m' });
  discard(s, s.players[0].drawn.id);
  for (const seat of Object.keys(s.claims)) claim(s, Number(seat), 'pass');
  s.wall[0] = parse('5p', 6000)[0];
  draw(s);
  check('a non-dealer can declare it on their first draw too', canKyuushu(s, 1));
}

// --- Suucha riichi ---
// Seats 1-3 are already in riichi (3 sticks on the table); seat 0 declares the fourth.
const PINFU = '123m456p789s23s55m'; // waits 1s/4s
function threeInRiichi(hands, drawn) {
  const s = table({ hands: { 0: PINFU, ...hands }, drawn });
  for (const seat of [1, 2, 3]) {
    s.players[seat].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
    s.players[seat].discards = parse('9p', 1950 + seat);
    s.scores[seat] -= 1000;
  }
  s.riichiSticks = 3;
  return s;
}

{
  const s = threeInRiichi({}, '7z');
  declareRiichi(s, 0, s.players[0].drawn.id);
  check('the fourth riichi standing ends the hand: suucha riichi', s.phase === 'ended' &&
    s.result.type === 'abortiveDraw' && s.result.reason === 'suucha riichi' && s.result.revealed.join() === '0,1,2,3');
  check('all four sticks stay on the table, with no other payments',
    s.riichiSticks === 4 && s.scores.join() === '24000,24000,24000,24000' && s.result.deltas.every((d) => d === 0));
  const m = newMatch();
  recordHand(m, s);
  check('the dealer repeats with one more honba, sticks carried', m.dealer === 0 && m.honba === 1 && m.riichiSticks === 4);
}

{
  // Seat 1 (in riichi, waiting on 1z/2z) rons the fourth riichi tile.
  const s = threeInRiichi({ 1: '123m456p789s1122z' }, '1z');
  declareRiichi(s, 0, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('a ronned fourth riichi tile is a normal ron, not suucha riichi', s.result.type === 'ron' &&
    s.result.winners.join() === '1' && s.players[0].riichi === null && s.result.sticks === 3);
}

{
  const s = threeInRiichi({}, '7z');
  s.players[3].riichi = null;
  declareRiichi(s, 0, s.players[0].drawn.id);
  check('three riichi do not abort the hand', s.phase === 'draw' && s.riichiSticks === 4);
}

// --- Suufon renda ---
// Each seat holds one of `winds` (1z-7z, by seat) among tiles that can't win, pon or chii.
const WINDLESS = '123456m2468p13s';
function windTable(winds) {
  return table({ hands: Object.fromEntries(winds.map((w, seat) => [seat, WINDLESS + w])), drawn: '9p' });
}
// The current player discards their honor tile, everyone passes, and the next player draws.
function throwHonor(s) {
  discard(s, s.players[s.current].hand.find((t) => t.suit === 'z').id);
  passClaims(s);
  draw(s);
}

{
  const s = windTable(['1z', '1z', '1z', '1z']);
  s.riichiSticks = 1;
  for (let i = 0; i < 3; i++) throwHonor(s);
  check('three of the same wind do not abort the hand', s.phase === 'discard' && s.current === 3);
  throwHonor(s);
  check('the fourth of the same wind as everyone\'s first discard: suufon renda', s.phase === 'ended' &&
    s.result.type === 'abortiveDraw' && s.result.reason === 'suufon renda' && s.result.deltas.every((d) => d === 0) &&
    s.result.revealed.length === 0 && s.riichiSticks === 1);
  const m = newMatch();
  recordHand(m, s);
  check('the dealer repeats with one more honba', m.dealer === 0 && m.honba === 1);
}
{
  const s = windTable(['2z', '2z', '2z', '2z']);
  for (let i = 0; i < 4; i++) throwHonor(s);
  check('any wind counts, not just the round wind', s.result?.reason === 'suufon renda');
}
{
  const s = windTable(['1z', '1z', '2z', '1z']);
  for (let i = 0; i < 4; i++) throwHonor(s);
  check('not with different winds', s.phase === 'discard' && s.result === null);
}
{
  const s = windTable(['5z', '5z', '5z', '5z']);
  for (let i = 0; i < 4; i++) throwHonor(s);
  check('not with dragons', s.phase === 'discard' && s.result === null);
}
{
  const s = windTable(['1z', '1z', '1z', '1z']);
  throwHonor(s);
  s.callMade = true; // as after a pon, chii or kan
  for (let i = 0; i < 3; i++) throwHonor(s);
  check('not after any call or kan', s.phase === 'discard' && s.result === null);
}
{
  // Seat 3 declares riichi on the fourth wind: the riichi stands, then the hand aborts.
  const s = windTable(['1z', '1z', '1z', '123m456p789s23s44z']);
  for (let i = 0; i < 3; i++) throwHonor(s);
  s.players[3].drawn = parse('1z', 6100)[0];
  const declared = declareRiichi(s, 3, s.players[3].drawn.id);
  passClaims(s);
  check('a riichi on the fourth wind is paid before suufon renda', declared && s.result?.reason === 'suufon renda' &&
    s.riichiSticks === 1 && s.scores[3] === 24000);
}

done();
