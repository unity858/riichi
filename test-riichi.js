// Run with: node test-riichi.js
import {
  newHand, draw, discard, tsumo, claim, canTsumo, riichiDiscards, canRiichi, declareRiichi, autoDiscardDue,
  checkIntegrity,
} from './game.js';
import { parse, table, stackWall, check, done } from './test-helpers.js';

const PINFU = '123m456p789s23s55m'; // waits 1s/4s
const TENPAI = '123m456p789s1122z'; // waits 1z/2z

// Seat 0 (dealer) holds PINFU plus a drawn 7z, so discarding the 7z is its only riichi.
function riichiTable(opts = {}) {
  const s = table({ hands: { 0: PINFU, ...opts.hands }, drawn: opts.drawn ?? '7z', wall: opts.wall, scores: opts.scores });
  s.doraIndicators = [];
  s.uraIndicators = [];
  return s;
}

// Each other seat discards its draw until it is seat 0's turn again.
function roundTrip(s) {
  for (let i = 0; i < 3; i++) {
    draw(s);
    discard(s, s.players[s.current].drawn.id);
  }
  draw(s);
}

{
  const s = riichiTable();
  const sevenZ = s.players[0].drawn.id;
  check('riichi is offered, only with the discards that keep tenpai', canRiichi(s, 0) && riichiDiscards(s, 0).join() === String(sevenZ));
  check('riichi is not offered to other seats', !canRiichi(s, 1));
  check('declaring with a discard that breaks tenpai is refused', !declareRiichi(s, 0, s.players[0].hand[0].id) && !s.players[0].riichi);
  check('no riichi under 1000 points', !canRiichi(riichiTable({ scores: [900, 25000, 25000, 25100] }), 0));
  check('no riichi with fewer than 4 wall tiles', !canRiichi(riichiTable({ wall: 3 }), 0) && canRiichi(riichiTable({ wall: 4 }), 0));

  declareRiichi(s, 0, sevenZ);
  const r = s.players[0].riichi;
  check('declaring records the turn, the riichi tile and ippatsu', r.turn === 0 && r.discardIndex === 0 && r.ippatsu);
  check('riichi on the first uninterrupted discard is a double riichi', r.double);
  check('the stick is paid once the discard passes', s.scores[0] === 24000 && s.riichiSticks === 1 && s.phase === 'draw');
  check('riichi cannot be declared twice', (() => { roundTrip(s); return !canRiichi(s, 0); })());
}

{
  const s = riichiTable();
  s.players[0].discards = parse('9p', 1950);
  declareRiichi(s, 0, s.players[0].drawn.id);
  check('a later riichi is not double', !s.players[0].riichi.double && s.players[0].riichi.discardIndex === 1);
}

{
  // Riichi, then win on the very next draw: ippatsu.
  const s = riichiTable();
  s.players[0].discards = parse('9p', 1950);
  declareRiichi(s, 0, s.players[0].drawn.id);
  stackWall(s, '9m9m9m4s');
  roundTrip(s);
  check('a winning draw is not auto-discarded', canTsumo(s, 0) && !autoDiscardDue(s));
  tsumo(s, 0);
  const names = s.result.scores[0].yaku.map((y) => y.name);
  check('tsumo on the next draw scores riichi and ippatsu', names.includes('Riichi') && names.includes('Ippatsu') &&
    names.includes('Menzen tsumo') && names.includes('Pinfu'));
  check('the winner collects the riichi stick', s.result.sticks === 1 && s.riichiSticks === 0 && s.scores[0] === 24000 + s.result.deltas[0] &&
    s.scores.reduce((a, b) => a + b) === 100000);
}

{
  // Riichi, one useless draw, then the win: no ippatsu.
  const s = riichiTable();
  s.players[0].discards = parse('9p', 1950);
  declareRiichi(s, 0, s.players[0].drawn.id);
  stackWall(s, '9m9m9m8p9m9m9m4s');
  roundTrip(s);
  const drawnId = s.players[0].drawn.id;
  check('a useless draw in riichi is due for auto-discard', autoDiscardDue(s));
  check('the hand is locked: hand tiles cannot be discarded', discard(s, s.players[0].hand[0].id) === null && s.phase === 'discard');
  check('the drawn tile can be discarded, ending ippatsu', discard(s, drawnId) !== null && !s.players[0].riichi.ippatsu);
  // The discard above already moved play on, so finish the trip without seat 0's own discard.
  for (let i = 0; i < 3; i++) {
    draw(s);
    discard(s, s.players[s.current].drawn.id);
  }
  draw(s);
  tsumo(s, 0);
  const names = s.result.scores[0].yaku.map((y) => y.name);
  check('a later tsumo keeps riichi but not ippatsu', names.includes('Riichi') && !names.includes('Ippatsu'));
}

{
  // Seat 0 declares riichi with 1z, which seat 1 rons.
  const s = riichiTable({ hands: { 1: TENPAI }, drawn: '1z' });
  declareRiichi(s, 0, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('a ronned riichi tile cancels the riichi and pays no stick', s.players[0].riichi === null &&
    s.riichiSticks === 0 && s.result.deltas[0] === -s.result.scores[0].total && s.result.sticks === 0);
}

{
  // Seat 1 is in riichi and rons seat 0's 4s: ura dora count (4m indicator -> 5m, two in hand).
  const s = riichiTable({ hands: { 1: PINFU }, drawn: '4s' });
  s.players[1].riichi = { turn: 0, discardIndex: 0, double: false, ippatsu: false };
  s.players[1].discards = parse('7z', 1970);
  s.uraIndicators = parse('4m', 4100);
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('ura dora count for a riichi winner and are shown', s.result.scores[0].dora.ura === 2 &&
    s.result.uraIndicators[0].rank === 4);
}

{
  // A draw with a stick on the table: the stick carries into the next hand.
  const s = riichiTable({ wall: 4 });
  declareRiichi(s, 0, s.players[0].drawn.id);
  while (s.phase !== 'ended') {
    if (s.phase === 'discard') discard(s, s.players[s.current].drawn.id);
    draw(s);
  }
  const next = newHand({ scores: s.scores, riichiSticks: s.riichiSticks });
  check('riichi sticks stay on the table after a draw and carry over', s.result.type === 'exhaustiveDraw' &&
    next.riichiSticks === 1 && next.scores.reduce((a, b) => a + b) + next.riichiSticks * 1000 === 100000);
}

// Random chained hands: players discard random tiles, declare riichi whenever they can,
// and win whenever they can. Points plus sticks on the table always total 100000.
let scores;
let sticks = 0;
let riichis = 0;
let ok = true;
for (let i = 0; i < 300; i++) {
  const s = newHand(scores ? { scores, riichiSticks: sticks } : {});
  for (let steps = 0; s.phase !== 'ended' && steps < 1000; steps++) {
    if (s.phase === 'discard') {
      const seat = s.current;
      const me = s.players[seat];
      if (tsumo(s, seat)) break;
      const options = riichiDiscards(s, seat);
      if (options.length) {
        declareRiichi(s, seat, options[0]);
        riichis++;
      } else if (me.riichi) {
        discard(s, me.drawn.id);
      } else {
        const tiles = [...me.hand, me.drawn];
        discard(s, tiles[Math.floor(Math.random() * tiles.length)].id);
      }
    } else if (s.phase === 'claim') {
      for (const seat of Object.keys(s.claims)) claim(s, Number(seat), 'ron');
    }
    draw(s);
  }
  ok &&= s.phase === 'ended' && checkIntegrity(s) &&
    s.scores.reduce((a, b) => a + b) + s.riichiSticks * 1000 === 100000;
  scores = s.scores;
  sticks = s.riichiSticks;
}
check(`300 chained random hands with riichi keep points + sticks at 100000 (${riichis} riichi declared)`, ok && riichis > 0);

done();
