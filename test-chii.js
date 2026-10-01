// Run with: node test-chii.js
import {
  draw, discard, claim, canRon, chiiOptions, riichiDiscards, declareRiichi, tileLabel, checkIntegrity,
} from './game.js';
import { parse, table, stackWall, passClaims, check, done } from './test-helpers.js';

// Seat 0 (dealer) discards `drawn`; seat 1 is next and may chii it.
function afterDiscard(drawn, hands, opts = {}) {
  const s = table({ hands, drawn, wall: opts.wall });
  s.doraIndicators = [];
  s.uraIndicators = [];
  if (opts.stack) stackWall(s, opts.stack);
  discard(s, s.players[0].drawn.id);
  return s;
}
const labels = (s, seat) => chiiOptions(s, seat)
  .map((pair) => pair.map((id) => tileLabel(s.players[seat].hand.find((t) => t.id === id))).join(''))
  .sort()
  .join(' ');

{
  const s = afterDiscard('3m', { 1: '12445m0m123p456p7s', 2: '45m123p456p789s12z' });
  check('the next player gets every distinct pair, a red five counted separately',
    s.phase === 'claim' && labels(s, 1) === ['1m2m', '2m4m', '4m0m', '4m5m'].sort().join(' '));
  check('only the next player can chii', chiiOptions(s, 2).length === 0);
}

{
  const s = afterDiscard('3z', { 1: '12z45m123p456p789s' });
  check('no chii on honors', chiiOptions(s, 1).length === 0 && s.phase === 'draw');
}

{
  const s = afterDiscard('3m', { 1: '45m123p456p789s12z' }, { wall: 0 });
  check('no chii on the last discard', chiiOptions(s, 1).length === 0 && s.result?.type === 'exhaustiveDraw');
}

{
  const s = table({ hands: { 1: '45m123p456p789s12z' }, drawn: '3m' });
  s.players[1].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  discard(s, s.players[0].drawn.id);
  check('no chii while in riichi', chiiOptions(s, 1).length === 0);
}

{
  const s = afterDiscard('3m', { 1: '45m123p456p789s12z' });
  const wallBefore = s.wall.length;
  const [pair] = chiiOptions(s, 1);
  check('chii with tiles that are not an option is refused', !claim(s, 1, 'chii', [pair[1], pair[0]]) && !claim(s, 1, 'chii', null));
  check('a seat that cannot chii cannot claim', !claim(s, 2, 'chii', pair));
  claim(s, 1, 'chii', pair);
  const caller = s.players[1];
  const [meld] = caller.melds;
  check('chii makes an open meld with the called tile first',
    meld.type === 'chi' && meld.open && meld.from === 0 && meld.calledId === meld.tiles[0].id &&
    meld.tiles.map(tileLabel).join(' ') === '3m 4m 5m');
  check('the caller discards next without drawing, and the wall is unchanged',
    s.current === 1 && s.phase === 'discard' && caller.drawn === null && caller.hand.length === 11 && s.wall.length === wallBefore);
  check('the called tile stays in the discarder\'s pond, marked called',
    s.players[0].discards.length === 1 && s.players[0].called.join() === 'true' && checkIntegrity(s));
  discard(s, caller.hand.find((t) => t.suit === 'z').id);
  draw(s);
  check('play continues from the caller: the next seat draws', s.current === 2 && !!s.players[2].drawn && s.wall.length === wallBefore - 1);
}

{
  // Seat 1 can chii the 3m, seat 2 can ron it (12m waits on 3m).
  const s = afterDiscard('3m', { 1: '45m123p456p789s12z', 2: '12m456p789s55s555z' });
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  check('a chii waits for players who can ron', s.phase === 'claim' && canRon(s, 2));
  claim(s, 2, 'ron');
  check('ron beats chii', s.result?.type === 'ron' && s.result.winners.join() === '2' && s.players[1].melds.length === 0);
}

{
  const s = afterDiscard('3m', { 1: '45m123p456p789s12z' });
  s.players[3].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: true };
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  check('a chii ends ippatsu for riichi players', !s.players[3].riichi.ippatsu && s.callMade);
}

{
  // After seat 1's chii, seat 2's first discard would have been a double riichi.
  const s = afterDiscard('3m', { 1: '45m123p456p789s12z', 2: '123m456p789s23s55m' }, { stack: '7z' });
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  discard(s, s.players[1].hand.find((t) => t.suit === 'z').id);
  draw(s); // seat 2 draws 7z
  declareRiichi(s, 2, s.players[2].drawn.id);
  check('no double riichi after a call', s.players[2].riichi && !s.players[2].riichi.double);
}

{
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '7z' });
  s.players[0].melds = [{ type: 'chi', open: true, tiles: parse('123p', 3000), from: 3, calledId: 3000 }];
  s.players[0].hand = parse('456p789s23s55m', 1000);
  check('no riichi with an open meld', riichiDiscards(s, 0).length === 0);
}

{
  // Seat 0 discards 9m, seat 1 chiis it with 78m; then everyone throws terminals until the wall is empty.
  const s = afterDiscard('9m', { 1: '78m123p456p789s12z' }, { wall: 4, stack: '1p9p1s9s' });
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  discard(s, s.players[1].hand.find((t) => t.suit === 'z').id);
  while (s.phase !== 'ended') {
    draw(s);
    if (s.phase === 'discard') discard(s, s.players[s.current].drawn.id);
    passClaims(s);
  }
  check('a player whose discard was called loses nagashi mangan',
    !s.result.nagashi.includes(0) && s.result.nagashi.join() === '1,2,3');
}

{
  // Seat 1 chiis 5m with 46m, discards 9p, and waits on 2m (tanki); seat 2 then discards 2m.
  const s = afterDiscard('5m', { 1: '46m345p678s234s2m9p' }, { stack: '2m' });
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  discard(s, s.players[1].hand.find((t) => t.suit === 'p' && t.rank === 9).id);
  draw(s);
  discard(s, s.players[2].drawn.id);
  check('the caller can ron with the open hand', canRon(s, 1));
  passClaims(s, 1); // seat 3 could chii the 2m
  claim(s, 1, 'ron');
  const score = s.result.scores[0];
  check('an open hand scores open tanyao at 30 fu, and no closed-only yaku',
    score.yaku.map((y) => y.name).join() === 'Tanyao' && score.han === 1 && score.fu === 30 && score.total === 1000);
}

done();
