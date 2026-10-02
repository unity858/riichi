// Run with: node test-wild.js
// The Baiman contest's wild tile (1A): it stands for any kind when winning, and is never discarded.
import {
  createTiles, shuffle, toCounts, isComplete, getWaits, isTenpai, isCompleteTiles, waitsOnAnything, isWild, WILD_KIND,
  draw, discard, claim, tsumo, canTsumo, canRon, riichiDiscards, declareRiichi, waitYaku, discardPreview, checkIntegrity,
} from './game.js';
import { parse, table, passClaims, check, done } from './test-helpers.js';

// --- Waits, checked against brute force ---
// The slow way: a kind is a wait if some value of the wild tile (any of the 34) completes the
// hand with it, by the ordinary check.
function bruteWaits(tiles) {
  const counts = toCounts(tiles);
  const wilds = tiles.filter(isWild).length;
  const waits = [];
  for (let t = 0; t < 34; t++) {
    counts[t]++;
    let ok = false;
    if (wilds === 0) ok = isComplete(counts);
    for (let w = 0; w < 34 && wilds === 1 && !ok; w++) {
      counts[w]++;
      ok = isComplete(counts);
      counts[w]--;
    }
    counts[t]--;
    if (ok) waits.push(t);
  }
  return waits;
}
const WILD = parse('1A', 999)[0];
const kinds = (k) => createTiles().filter((t) => t.suit === 'mpsz'[Math.floor(k / 9)] && t.rank === (k % 9) + 1);
{
  let mismatches = 0;
  let tried = 0;
  const compare = (regular) => {
    const hand = [...regular, WILD];
    tried++;
    if (getWaits(hand).join() !== bruteWaits(hand).join()) mismatches++;
  };
  // Random hands of 12, 9, 6 and 3 regular tiles (the rest of the hand in open melds).
  for (let i = 0; i < 3000; i++) compare(shuffle(createTiles()).slice(0, [12, 9, 6, 3][i % 4]));
  // Near seven pairs and near kokushi, where those shapes matter.
  const TH = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  for (let i = 0; i < 500; i++) {
    const ks = shuffle([...Array(34).keys()]);
    const pairs = 4 + (i % 3); // 4-6 pairs, then singles
    const tiles = [];
    for (let j = 0; tiles.length < 12; j++) tiles.push(...kinds(ks[j]).slice(0, j < pairs ? 2 : 1));
    compare(tiles.slice(0, 12));
    const th = shuffle([...TH]);
    compare([...th.slice(0, 11), th[i % 11]].map((k) => kinds(k)[1]));
  }
  check(`waits with the wild tile match brute force on ${tried} hands`, mismatches === 0);
}
check('with no wild tile, waits are as before', getWaits(parse('123m456p789s23s55m')).join() === bruteWaits(parse('123m456p789s23s55m')).join() &&
  getWaits(parse('123m456p789s23s55m')).length === 2);

// --- Examples ---
const kindsOf = (hand) => getWaits(parse(hand)).length;
check('12 tiles + wild: 123m 456p 789s 23s 5m waits on 1s, 4s (wild pairs the 5m) and more',
  ['1s', '4s', '5m'].every((t) => isCompleteTiles(parse(`123m456p789s23s5m${t}1A`))));
check('a wild tile completes a hand only as one of the 34: 123m456p789s23s55m + 1A is a complete 14-tile hand',
  isCompleteTiles(parse('123m456p789s23s55m1A')));
{
  const sets = parse('123m456p789s111z1A');
  check('four complete sets + wild: wins on any tile, shown as the wild tile alone',
    getWaits(sets).length === 34 && waitsOnAnything(sets));
  const pairs = parse('11m22p33s44z55z66z1A');
  check('six distinct pairs + wild: shown as the wild tile alone too, and it waits on exactly the 28 other kinds',
    waitsOnAnything(pairs) && getWaits(pairs).length === 28 && !getWaits(pairs).includes(0));
  const peikou = parse('112233m445566p1A');
  check('six pairs that also read as runs (112233m 445566p) win on all 34 kinds', waitsOnAnything(peikou) && getWaits(peikou).length === 34);
  check('an ordinary wild tile hand is not "wins on anything"', !waitsOnAnything(parse('123m456p789s23s5m1A')));
  check('nor is a hand without a wild tile', !waitsOnAnything(parse('123m456p789s111z1m')));
}
check('kokushi with the wild tile: 12 of the 13 terminals and honors + wild is tenpai',
  isTenpai(parse('19m19p19s1234567z'.replace('7z', '') + '1A'.replace('1A', '') + '1A').slice(0, 13)) &&
  isCompleteTiles(parse('19m19p19s123456z1A7z')));

// --- In play ---
function contest(hands, drawn) {
  const s = table({ hands, drawn, scores: [0, 0, 0, 0] });
  s.rules.contest = true;
  s.doraIndicators = [];
  s.uraIndicators = [];
  s.callMade = true; // no tenhou/chiihou
  return s;
}
{
  const s = contest({ 0: '123m456p789s23s5m1A' }, '7z');
  const wild = s.players[0].hand.find(isWild);
  check('the wild tile can never be discarded', discard(s, wild.id) === null && s.players[0].hand.includes(wild));
  check('it is never a riichi discard', !riichiDiscards(s, 0).includes(wild.id) && riichiDiscards(s, 0).includes(s.players[0].drawn.id));
  check('and the discard preview leaves it out', !(wild.id in discardPreview(s, 0)) && s.players[0].drawn.id in discardPreview(s, 0));
  declareRiichi(s, 0, s.players[0].drawn.id);
  check('riichi works as usual, discarding another tile', !!s.players[0].riichi && s.players[0].discards.length === 1);
  const waits = waitYaku(s, 0).map((w) => w.kind);
  check(`its waits come from the wild tile too (${waits.length} kinds)`, waits.length > 2 && waits.every((k) => k !== WILD_KIND));
}
{
  // Seat 0: 123m 456p 789s 23s 1z + wild, draws 4s: 234s, and the wild tile pairs the East.
  const s = contest({ 0: '123m456p789s23s1z1A' }, '4s');
  check('a tsumo with the wild tile completing the hand', canTsumo(s, 0) && tsumo(s, 0));
  const sc = s.players[0].won.score;
  check(`it is scored with the wild tile as the East it pairs (${sc.yaku.map((y) => y.name).join(', ')}; ${sc.han} han ${sc.fu} fu)`,
    sc.yaku.map((y) => y.name).join() === 'Menzen tsumo' && sc.fu === 30); // 20 + 2 tsumo + 4 double wind pair
}
{
  // Seat 1 holds four complete sets of simples + wild: it wins on anything (with a yaku).
  const s = contest({ 1: '234m456p678s345s1A' }, '5m');
  discard(s, s.players[0].drawn.id);
  check('a hand that wins on anything rons a 5m, the wild tile pairing it (tanyao)', canRon(s, 1));
  claim(s, 1, 'pass');
  passClaims(s);
  const seven = contest({ 1: '234m456p678s345s1A' }, '7z');
  discard(seven, seven.players[0].drawn.id);
  check('but not a Chun: the shape is complete, but with no yaku', isCompleteTiles([...seven.players[1].hand, seven.players[0].discards[0]]) && !canRon(seven, 1));
  const waits = waitYaku(s, 1);
  check('its waits are shown as the wild tile alone', waits.length === 1 && waits[0].kind === WILD_KIND && waits[0].any);
}
{
  // Dora: the wild tile counts as the kind it stands for.
  const s = contest({ 0: '234m456p678s34s5s1A' }, '2s'); // 234s, and the wild tile pairs the 5s
  s.doraIndicators = parse('4s', 4000); // dora 5s
  tsumo(s, 0);
  check(`the best value of the wild tile can be a dora (${JSON.stringify(s.players[0].won.score.dora)})`, s.players[0].won.score.dora.dora >= 2);
}

{
  // 112233m 445566p + wild, tsumo on 9s: seven pairs (2 han) or ryanpeikou with a 9s pair (3 han).
  const s = contest({ 0: '112233m445566p1A' }, '9s');
  tsumo(s, 0);
  const names = s.players[0].won.score.yaku.map((y) => y.name);
  check(`the wild tile is set for the most han: ryanpeikou, not seven pairs (${names.join(', ')})`,
    names.includes('Ryanpeikou') && !names.includes('Chiitoitsu'));
}

done();
