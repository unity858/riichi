// Run with: node test-callout.js
import { draw, discard, claim, tsumo, declareRiichi, declareKan, kanOptions, ponOptions, chiiOptions } from './game.js';
import { table, check, done } from './test-helpers.js';

const callouts = (s) => s.players.map((p) => p.callout ?? '-').join();

{
  // Seat 1 can chii the 3m, seat 3 can pon it: the pon is shown only once it is made.
  const s = table({ hands: { 1: '45m123p456p789s12z', 3: '33m123p456p789s12z' }, drawn: '3m' });
  check('no callouts at the start of a hand', callouts(s) === '-,-,-,-');
  discard(s, s.players[0].drawn.id);
  claim(s, 3, 'pon', ponOptions(s, 3)[0]);
  check('a pon still waiting on another seat shows nothing yet', callouts(s) === '-,-,-,-');
  claim(s, 1, 'pass');
  check('the pon shows once it is made', callouts(s) === '-,-,-,pon');
  discard(s, s.players[3].hand.find((t) => t.suit === 'z').id);
  check('and clears when the caller discards', callouts(s) === '-,-,-,-');
}

{
  const s = table({ hands: { 1: '45m123p456p789s12z' }, drawn: '3m' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  check('a chii shows as chii', callouts(s) === '-,chii,-,-');
}

{
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '7z' });
  declareRiichi(s, 0, s.players[0].drawn.id);
  check('a riichi shows after its discard', callouts(s) === 'riichi,-,-,-');
  draw(s);
  check('and clears at the next draw', callouts(s) === '-,-,-,-');
}

{
  // Seat 0 declares riichi on 7z; seat 2 pons it.
  const s = table({ hands: { 0: '123m456p789s23s55m', 2: '77z123m456p789s12z' }, drawn: '7z' });
  declareRiichi(s, 0, s.players[0].drawn.id);
  claim(s, 2, 'pon', ponOptions(s, 2)[0]);
  check('a call on the riichi tile replaces the riichi callout', callouts(s) === '-,-,pon,-' && s.players[0].riichi);
}

{
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '4s' });
  tsumo(s, 0);
  check('a tsumo shows as tsumo', callouts(s) === 'tsumo,-,-,-' && s.phase === 'ended');
}

{
  // Seats 2 and 3 both ron the 3m.
  const s = table({ hands: { 2: '12m456p789s55s555z', 3: '12m456p789s55s666z' }, drawn: '3m' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'pass'); // seat 1 could chii it
  claim(s, 3, 'ron');
  check('nothing shows while a ron is undecided', callouts(s) === '-,-,-,-');
  claim(s, 2, 'ron');
  check('every ron winner shows ron', s.result?.type === 'ron' && callouts(s) === '-,-,ron,ron');
}

{
  const s = table({ hands: { 0: '1111m456p789s23s5m' }, drawn: '9z' });
  declareKan(s, 0, kanOptions(s, 0)[0].kind);
  check('a closed kan shows as kan', callouts(s) === 'kan,-,-,-' && s.phase === 'rinshan');
  draw(s);
  check('it stays through the replacement draw', callouts(s) === 'kan,-,-,-');
  discard(s, s.players[0].drawn.id);
  check('and clears at the discard after it', callouts(s) === '-,-,-,-');
}

done();
