// Run with: node test-scoring.js
import { newHand, draw, discard, tsumo, claim, checkIntegrity, STARTING_SCORE } from './game.js';
import { parse, table, passClaims, check, done } from './test-helpers.js';

// Waits on 1z/2z, so it stays tenpai when seat 0 discards 9s.
const TENPAI = '123m456p789s1122z';
// Waits on 2p/5p and would have no yaku if it won by ron (a terminal triplet rules out
// pinfu and tanyao, and there are no honors or one-suit shapes).
const YAKULESS_TENPAI = '111m234p567s789s5p';

// Ends the hand in an exhaustive draw: seat 0 discards its drawn 5s with the wall empty.
// (A simple, so it doesn't give seat 0 nagashi mangan.)
function drawWith(hands, scores) {
  const s = table({ hands, drawn: '5s', wall: 0, scores });
  discard(s, s.players[0].drawn.id);
  return s;
}

check('everyone starts at 25000', newHand().scores.every((x) => x === STARTING_SCORE && x === 25000));

{
  const s = drawWith({ 1: TENPAI });
  check('one tenpai: receives 3000, each noten pays 1000',
    s.result.type === 'exhaustiveDraw' && s.result.tenpai.join() === '1' &&
    s.result.deltas.join() === '-1000,3000,-1000,-1000' && s.scores.join() === '24000,28000,24000,24000');
}

{
  const s = drawWith({ 0: TENPAI, 2: TENPAI });
  check('two tenpai: each receives 1500, each noten pays 1500',
    s.result.deltas.join() === '1500,-1500,1500,-1500' && s.scores.join() === '26500,23500,26500,23500');
}

{
  const s = drawWith({ 0: TENPAI, 1: TENPAI, 3: TENPAI });
  check('three tenpai: each receives 1000, the noten player pays 3000',
    s.result.deltas.join() === '1000,1000,-3000,1000' && s.scores.join() === '26000,26000,22000,26000');
}

{
  const all = drawWith({ 0: TENPAI, 1: TENPAI, 2: TENPAI, 3: TENPAI });
  const none = drawWith({});
  check('everyone or nobody tenpai: no payment',
    all.result.tenpai.length === 4 && none.result.tenpai.length === 0 &&
    [all, none].every((s) => s.result.deltas.every((d) => d === 0) && s.scores.every((x) => x === 25000)));
}

{
  const s = drawWith({ 2: YAKULESS_TENPAI });
  check('yakuless tenpai counts as tenpai', s.result.tenpai.join() === '2' && s.result.deltas[2] === 3000);
}

{
  const s = drawWith({ 1: TENPAI }, [30000, 20000, 25000, 25000]);
  const next = newHand({ dealer: s.dealer, scores: s.scores });
  check('scores carry over into the next hand', next.scores.join() === '29000,23000,24000,24000');
  next.scores[0] = 0;
  check('the next hand gets its own copy of the scores', s.scores[0] === 29000);
}

// --- Nagashi mangan ---

// Seat 0 (the dealer) discards `drawn` into an empty wall after `earlier` discards.
function drawAfterDiscards(earlier, drawn, hands = {}) {
  const s = table({ hands, drawn, wall: 0 });
  s.players[0].discards = parse(earlier, 1950);
  discard(s, s.players[0].drawn.id);
  return s;
}

{
  const s = drawAfterDiscards('19m1z7z', '9s', { 2: TENPAI });
  check('dealer nagashi mangan: 4000 all, replacing noten payments',
    s.result.nagashi.join() === '0' && s.result.tenpai.join() === '2' &&
    s.result.deltas.join() === '12000,-4000,-4000,-4000');
}

{
  const s = table({ wall: 0 });
  s.current = 1;
  s.players[1].discards = parse('1p9p3z', 1950);
  s.players[1].drawn = parse('1s', 1990)[0];
  s.players[0].discards = parse('5m', 1960); // the dealer threw a simple
  discard(s, s.players[1].drawn.id);
  check('non-dealer nagashi mangan: 4000 from the dealer, 2000 from the others',
    s.result.nagashi.join() === '1' && s.result.deltas.join() === '-4000,8000,-2000,-2000');
}

{
  const s = drawAfterDiscards('19m5p', '9s');
  check('one simple discard rules out nagashi mangan', s.result.nagashi.length === 0 && s.result.deltas.every((d) => d === 0));
}

{
  const s = table({ wall: 0 });
  s.current = 1;
  s.players[0].discards = parse('1m9m', 1940);
  s.players[1].discards = parse('1p', 1950);
  s.players[1].drawn = parse('9p', 1990)[0];
  discard(s, s.players[1].drawn.id);
  check('two players with nagashi mangan are both paid',
    s.result.nagashi.join() === '0,1' && s.result.deltas.join() === '8000,4000,-6000,-6000' &&
    s.result.deltas.reduce((a, b) => a + b) === 0);
}

// --- Wins pay out ---
// Seat 0 is the East dealer in the East round: 111z is both seat and round wind.

{
  // An earlier discard, so this isn't the dealer's first draw (which would be tenhou).
  const s = table({ hands: { 0: TENPAI }, drawn: '1z' });
  s.players[0].discards = parse('9p', 1950);
  s.doraIndicators = [];
  tsumo(s, 0);
  const [score] = s.result.scores;
  check('dealer tsumo: 3 han 30 fu is 2000 all', score.han === 3 && score.fu === 30 &&
    s.result.deltas.join() === '6000,-2000,-2000,-2000' && s.scores.join() === '31000,23000,23000,23000');
}

{
  // Seat 1 (South, non-dealer) rons seat 0's 4s with pinfu: 1 han 30 fu, 1000 from the discarder only.
  const s = table({ hands: { 1: '123m456p789s23s55m' }, drawn: '4s' });
  s.doraIndicators = [];
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('ron is paid by the discarder alone', s.result.scores[0].total === 1000 &&
    s.result.deltas.join() === '-1000,1000,0,0');
}

{
  // Seats 2 and 3 both ron seat 1's 1z; seat 1 pays each of them.
  const s = table({ hands: { 2: TENPAI, 3: '234m567p789s1133z' } });
  s.doraIndicators = [];
  s.current = 1;
  s.players[1].drawn = parse('1z', 1990)[0];
  discard(s, s.players[1].drawn.id);
  claim(s, 2, 'ron');
  claim(s, 3, 'ron');
  const [a, b] = s.result.scores;
  check('double ron: the discarder pays both winners', a.total > 0 && b.total > 0 &&
    s.result.deltas[1] === -(a.total + b.total) && s.result.deltas[2] === a.total && s.result.deltas[3] === b.total);
}

{
  const s = table({ hands: { 1: YAKULESS_TENPAI }, drawn: '5p' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('a yakuless win pays nothing', s.result.type === 'ron' && s.result.scores[0].han === 0 &&
    s.scores.every((x) => x === 25000));
}

{
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '4s', wall: 0 });
  s.players[0].discards = parse('9p', 1950); // not the first draw, so not tenhou
  s.doraIndicators = [];
  tsumo(s, 0);
  check('tsumo on the last tile scores haitei', s.result.scores[0].yaku.some((y) => y.name === 'Haitei raoyue'));
}

// Real deals: every hand ends and every tile is accounted for.
let ok = true;
for (let i = 0; i < 100; i++) {
  const s = newHand();
  for (let steps = 0; s.phase !== 'ended' && steps < 1000; steps++) {
    if (s.phase === 'discard') discard(s, s.players[s.current].drawn.id);
    passClaims(s);
    draw(s);
  }
  ok &&= s.phase === 'ended' && checkIntegrity(s) && s.scores.reduce((a, b) => a + b) === 100000;
}
check('100 random deals end with all tiles accounted for and 100000 points in play', ok);

// Chained hands where random seats are tenpai and the wall is short, so payments actually
// happen and carry over: the total always stays at 100000.
let scores;
let paid = 0;
ok = true;
for (let i = 0; i < 300; i++) {
  const hands = {};
  for (let seat = 0; seat < 4; seat++) {
    if (Math.random() < 0.5) hands[seat] = Math.random() < 0.5 ? TENPAI : YAKULESS_TENPAI;
  }
  const s = table({ hands, drawn: '9s', wall: Math.floor(Math.random() * 6), scores });
  for (let steps = 0; s.phase !== 'ended' && steps < 100; steps++) {
    if (s.phase === 'discard') {
      if (!tsumo(s, s.current)) discard(s, s.players[s.current].drawn.id);
    } else if (s.phase === 'claim') {
      for (const seat of Object.keys(s.claims)) claim(s, Number(seat), 'pass');
    }
    draw(s);
  }
  if (s.result?.deltas?.some((d) => d !== 0)) paid++;
  ok &&= s.phase === 'ended' && s.scores.reduce((a, b) => a + b) === 100000;
  scores = s.scores;
}
check(`300 chained hands keep the total at 100000 (${paid} paid out; final ${scores.join(', ')})`, ok && paid > 0);

done();
