// Run with: node test-win.js
import { newHand, draw, discard, tsumo, claim, canTsumo, canRon, checkIntegrity } from './game.js';
import { parse, table, stackWall, check, done } from './test-helpers.js';
import { furitenStatus } from './game.js';

{
  const s = table({ hands: { 0: '123m456p789s1122z' }, drawn: '1z' });
  check('tsumo is offered on a complete hand', canTsumo(s, 0));
  check('tsumo is not offered to other seats', !canTsumo(s, 1));
  check('tsumo ends the hand', tsumo(s, 0) && s.phase === 'ended' &&
    s.result.type === 'tsumo' && s.result.winners[0] === 0 && s.result.tile.rank === 1);
}

{
  const s = table({ hands: { 0: '123m456p789s1122z' }, drawn: '3z' });
  check('no tsumo on an incomplete hand', !canTsumo(s, 0) && !tsumo(s, 0) && s.phase === 'discard');
}

{
  const s = table({ hands: { 0: '1234567m2468p13s', 1: '123m456p789s1122z' }, drawn: '1z' });
  const drawnId = s.players[0].drawn.id;
  discard(s, drawnId);
  check('discarding a winning tile opens a claim for that seat', s.phase === 'claim' && canRon(s, 1) && !canRon(s, 2));
  check('the next player does not draw during the claim', draw(s) === null && s.players[1].drawn === null);
  check('ron ends the hand', claim(s, 1, 'ron') && s.result.type === 'ron' &&
    s.result.winners.join() === '1' && s.result.from === 0 && s.result.tile.id === drawnId);
}

{
  const s = table({ hands: { 0: '1234567m2468p13s', 1: '123m456p789s1122z' }, drawn: '1z' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'pass');
  check('skipping the ron resumes play', s.phase === 'draw' && s.lastDiscard === null && draw(s) && s.players[1].drawn);
}

{
  // Seats 2 and 3 both wait on 1z; the winners are listed in turn order after the discarder (seat 1).
  const s = table({ hands: { 2: '123m456p789s1122z', 3: '234m567p789s1133z' } });
  s.current = 1;
  s.players[1].drawn = parse('1z', 1990)[0];
  discard(s, s.players[1].drawn.id);
  check('two seats can ron the same tile', canRon(s, 2) && canRon(s, 3));
  claim(s, 3, 'ron');
  check('the hand waits until every eligible seat decides', s.phase === 'claim');
  claim(s, 2, 'ron');
  check('double ron lists both winners in turn order', s.result.type === 'ron' && s.result.winners.join() === '2,3');
}

{
  const s = table({ hands: { 0: '1234567m2468p13s', 1: '123m456p789s1122z' }, drawn: '1z', wall: 0 });
  discard(s, s.players[0].drawn.id);
  check('the last discard can still be ronned', s.phase === 'claim' && canRon(s, 1));
  claim(s, 1, 'pass');
  check('skipping the last discard ends in an exhaustive draw', s.phase === 'ended' && s.result.type === 'exhaustiveDraw');
}

{
  const s = table({ hands: { 0: '1234567m2468p13s' }, drawn: '9s', wall: 0 });
  discard(s, s.players[0].drawn.id);
  check('no claim when nobody can win', s.phase === 'ended' && s.result.type === 'exhaustiveDraw');
}

{
  const s = table({ hands: { 0: '1234567m2468p13s', 1: '123m456p789s1122z' }, drawn: '1z' });
  discard(s, s.players[0].drawn.id);
  check('seats that cannot ron cannot claim', !claim(s, 2, 'ron') && s.phase === 'claim');
  check('unknown claim actions are rejected', !claim(s, 1, 'pon') && canRon(s, 1));
}

// --- Furiten ---
{
  // Seat 1 waits on 1z/2z but has already discarded a 1z.
  const s = table({ hands: { 0: '1234567m2468p13s', 1: '123m456p789s1122z' }, drawn: '2z' });
  s.players[1].discards = parse('1z', 1950);
  discard(s, s.players[0].drawn.id);
  check('furiten: no ron on any wait once one of them is in your own discards', s.phase === 'draw' && !canRon(s, 1));
}

{
  const s = table({ hands: { 1: '123m456p789s1122z' }, drawn: '2z' });
  s.players[1].discards = parse('9m', 1950);
  discard(s, s.players[0].drawn.id);
  check('discards that are not waits do not cause furiten', canRon(s, 1));
}

{
  // Seat 1 waits on 5p and discarded a red 5p earlier.
  const s = table({ hands: { 1: '111m234p567s789s5p' }, drawn: '5p' });
  s.players[1].discards = parse('0p', 1950);
  discard(s, s.players[0].drawn.id);
  check('a red five in your discards makes a five wait furiten', !canRon(s, 1));
}

{
  const s = table({ hands: { 0: '123m456p789s1122z' }, drawn: '1z' });
  s.players[0].discards = parse('2z', 1950);
  check('furiten still allows tsumo', canTsumo(s, 0) && tsumo(s, 0));
}

// Seat 2 waits on 1z/2z. Seat 0 opens by discarding a 1z; the next draws are stacked.
function waitingSeat2(wall, riichi = false) {
  const s = table({ hands: { 2: '123m456p789s1122z' }, drawn: '1z' });
  if (riichi) {
    s.players[2].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
    s.players[2].discards = parse('9p', 1950);
  }
  stackWall(s, wall);
  discard(s, s.players[0].drawn.id);
  return s;
}
// The current player discards their draw; returns the discarded tile.
const passTurn = (s) => { draw(s); return discard(s, s.players[s.current].drawn.id); };

{
  const s = waitingSeat2('2z9m1z');
  check('a winning discard is offered before anything passes', canRon(s, 2) && !furitenStatus(s, 2).temporary);
  claim(s, 2, 'pass');
  check('passing it makes you temporarily furiten', furitenStatus(s, 2).temporary);
  passTurn(s); // seat 1 discards 2z
  check('temporary furiten: no ron on another wait before your next discard', s.phase === 'draw' && !canRon(s, 2));
  passTurn(s); // seat 2 discards 9m
  check('your own discard lifts temporary furiten', !furitenStatus(s, 2).temporary);
  passTurn(s); // seat 3 discards 1z
  check('after your discard you can ron again', canRon(s, 2));
}

{
  const s = waitingSeat2('9m9m2z');
  claim(s, 2, 'pass');
  passTurn(s); // seat 1 discards 9m
  passTurn(s); // seat 2 discards 9m
  check('temporary furiten does not carry past your next discard', !furitenStatus(s, 2).temporary && !furitenStatus(s, 2).discard);
}

{
  const s = waitingSeat2('9m9m1z9m9m9m2z', true);
  claim(s, 2, 'pass');
  passTurn(s); // seat 1
  passTurn(s); // seat 2 discards (hand is locked in riichi)
  const f = furitenStatus(s, 2);
  check('riichi furiten stays after your next discard', f.riichi && !f.temporary);
  passTurn(s); // seat 3 discards 1z
  check('riichi furiten: no ron for the rest of the hand', s.phase === 'draw' && !canRon(s, 2));
  passTurn(s); passTurn(s); passTurn(s); // seats 0, 1, 2
  draw(s); // seat 3 draws 2z
  discard(s, s.players[3].drawn.id);
  check('riichi furiten still blocks ron a full go-around later', !canRon(s, 2));
}

{
  // Riichi furiten still allows tsumo.
  const s = waitingSeat2('9m2z', true);
  claim(s, 2, 'pass');
  passTurn(s); // seat 1 discards 9m
  draw(s); // seat 2 draws 2z
  check('riichi furiten still allows tsumo', furitenStatus(s, 2).riichi && canTsumo(s, 2));
}

{
  // Tiles discarded before a riichi don't cause riichi furiten.
  const s = waitingSeat2('9m9m');
  claim(s, 2, 'pass');
  passTurn(s); // seat 1
  s.players[2].riichi = { turn: s.turnCount, discardIndex: s.players[2].discards.length, double: false, ippatsu: true };
  passTurn(s); // seat 2 declares with a 9m
  check('only tiles after the riichi call count for riichi furiten', !furitenStatus(s, 2).riichi);
}

// Random full hands: always tsumo or ron when possible, otherwise discard the drawn tile.
let finished = 0;
let wins = 0;
for (let i = 0; i < 300; i++) {
  const s = newHand();
  for (let steps = 0; s.phase !== 'ended' && steps < 1000; steps++) {
    if (s.phase === 'discard') {
      if (!tsumo(s, s.current)) discard(s, s.players[s.current].drawn.id);
    } else if (s.phase === 'claim') {
      for (const seat of Object.keys(s.claims)) claim(s, Number(seat), 'ron');
    }
    draw(s);
  }
  if (s.phase === 'ended' && s.result && checkIntegrity(s)) finished++;
  if (s.result?.type !== 'exhaustiveDraw') wins++;
}
check(`300 random hands all end with a result and all 136 tiles accounted for (${wins} won)`, finished === 300);

done();
