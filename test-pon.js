// Run with: node test-pon.js
import {
  draw, discard, claim, canRon, ponOptions, chiiOptions, calledTilePosition, tileLabel, checkIntegrity,
} from './game.js';
import { table, stackWall, passClaims, check, done } from './test-helpers.js';

// Seat 1 (the next seat) gets a hand with no man tiles unless a test gives it one, so it
// can't chii the man discards used here.
const NO_MAN = '123p456p789p1234z';

// Seat 0 (dealer) discards `drawn`; the other seats react.
function afterDiscard(drawn, hands, opts = {}) {
  const s = table({ hands: { 1: NO_MAN, ...hands }, drawn, wall: opts.wall });
  s.doraIndicators = [];
  s.uraIndicators = [];
  if (opts.stack) stackWall(s, opts.stack);
  discard(s, s.players[0].drawn.id);
  return s;
}
const labels = (s, seat) => ponOptions(s, seat)
  .map((pair) => pair.map((id) => tileLabel(s.players[seat].hand.find((t) => t.id === id))).join(''))
  .sort()
  .join(' ');

// None of these hands can win on the tiles thrown at them.
const PON_5M = '55m123p456p789s12z';

{
  const s = afterDiscard('5m', { 2: PON_5M, 3: PON_5M });
  check('any seat with two copies can pon, not just the next one', ponOptions(s, 2).length === 1 && ponOptions(s, 3).length === 1);
  check('a pon is not a chii: seat 1 gets nothing', ponOptions(s, 1).length === 0 && chiiOptions(s, 1).length === 0);
}

{
  const s = afterDiscard('5m', { 2: '550m123p456p78s12z' });
  check('distinct pairs: two plain fives, or a plain five with the red one', labels(s, 2) === ['5m0m', '5m5m'].sort().join(' '));
}

{
  const s = afterDiscard('5m', { 2: '555m123p456p78s12z' });
  check('three plain copies still give one pon option', labels(s, 2) === '5m5m');
}

{
  const s = afterDiscard('1z', { 2: '11z123m456p789s12s' });
  check('honors can be ponned', labels(s, 2) === 'EE');
}

{
  const s = afterDiscard('5m', { 2: PON_5M }, { wall: 0 });
  check('no pon on the last discard', ponOptions(s, 2).length === 0 && s.result?.type === 'exhaustiveDraw');
}

{
  const s = table({ hands: { 2: PON_5M }, drawn: '5m' });
  s.players[2].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  discard(s, s.players[0].drawn.id);
  check('no pon while in riichi', ponOptions(s, 2).length === 0);
}

{
  const s = afterDiscard('5m', { 2: PON_5M }, { stack: '9p' });
  const wallBefore = s.wall.length;
  claim(s, 2, 'pon', ponOptions(s, 2)[0]);
  const [meld] = s.players[2].melds;
  check('pon makes an open meld with the called tile first',
    meld.type === 'pon' && meld.open && meld.from === 0 && meld.tiles.map(tileLabel).join(' ') === '5m 5m 5m' &&
    meld.tiles[0].id === meld.calledId);
  check('the turn jumps to the caller, skipping seat 1, with no draw and the wall unchanged',
    s.current === 2 && s.phase === 'discard' && !s.players[1].drawn && !s.players[2].drawn &&
    s.players[2].hand.length === 11 && s.wall.length === wallBefore);
  check('the called tile stays in the discarder\'s pond, marked called', s.players[0].called.join() === 'true' && checkIntegrity(s));
  discard(s, s.players[2].hand.find((t) => t.suit === 'z').id);
  passClaims(s);
  draw(s);
  check('play continues after the caller: seat 3 draws next', s.current === 3 && s.players[3].drawn?.rank === 9);
}

{
  // Seat 1 can chii the 3m, seat 3 can pon it. Pon wins whichever is chosen first.
  for (const order of [['chii', 'pon'], ['pon', 'chii']]) {
    const s = afterDiscard('3m', { 1: '45m123p456p789s12z', 3: '33m123p456p789s12z' });
    for (const call of order) {
      if (call === 'chii') claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
      else claim(s, 3, 'pon', ponOptions(s, 3)[0]);
    }
    check(`pon beats chii (${order.join(' then ')})`, s.players[3].melds[0]?.type === 'pon' &&
      s.players[1].melds.length === 0 && s.current === 3);
  }
}

{
  // Seat 2 can pon the 3m; seat 3 can ron it (12m waits on 3m).
  const s = afterDiscard('3m', { 2: '33m123p456p789s12z', 3: '12m456p789s123s55z' });
  claim(s, 2, 'pon', ponOptions(s, 2)[0]);
  check('a pon waits for players who can ron', s.phase === 'claim' && canRon(s, 3));
  claim(s, 3, 'ron');
  check('ron beats pon', s.result?.type === 'ron' && s.result.winners.join() === '3' && s.players[2].melds.length === 0);
}

{
  const s = afterDiscard('3m', { 1: '334m5m123p456p78s1z' });
  check('the next seat can be offered both pon and chii', ponOptions(s, 1).length === 1 && chiiOptions(s, 1).length > 0);
  claim(s, 1, 'pon', ponOptions(s, 1)[0]);
  check('and choose the pon', s.players[1].melds[0].type === 'pon');
}

{
  const meld = (from) => ({ from });
  check('the called tile sits on the side it came from: left first, opposite middle, right last',
    calledTilePosition(meld(0), 1) === 0 && calledTilePosition(meld(0), 2) === 1 && calledTilePosition(meld(0), 3) === 2 &&
    calledTilePosition(meld(3), 0) === 0 && calledTilePosition(meld(1), 0) === 2);
}

{
  // Seat 2 pons Haku, discards 1s and waits on 2s (tanki); seat 3 then discards 2s.
  const s = afterDiscard('5z', { 2: '55z123m456p789s12s' }, { stack: '2s' });
  claim(s, 2, 'pon', ponOptions(s, 2)[0]);
  discard(s, s.players[2].hand.find((t) => t.suit === 's' && t.rank === 1).id);
  passClaims(s);
  draw(s);
  discard(s, s.players[3].drawn.id);
  passClaims(s, 2); // seat 0 could chii the 2s
  claim(s, 2, 'ron');
  const score = s.result.scores[0];
  check('an open pon of Haku scores yakuhai: 1 han 30 fu (20 + 4 open honor pon + 2 tanki)',
    score.yaku.map((y) => y.name).join() === 'Yakuhai: Haku' && score.han === 1 && score.fu === 30 && score.total === 1000);
}

{
  const s = afterDiscard('5m', { 2: PON_5M });
  s.players[1].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: true };
  claim(s, 2, 'pon', ponOptions(s, 2)[0]);
  check('a pon ends ippatsu for riichi players', !s.players[1].riichi.ippatsu && s.callMade);
}

done();
