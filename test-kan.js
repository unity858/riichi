// Run with: node test-kan.js
import {
  draw, discard, tsumo, claim, canRon, canTsumo, kanOptions, declareKan, openKanOptions, chiiOptions,
  autoDiscardDue, declareRiichi, tileLabel, checkIntegrity,
} from './game.js';
import { parse, table, stackWall, passClaims, check, done } from './test-helpers.js';

const labels = (tiles) => tiles.map(tileLabel).join(' ');
const liveDead = (s) => [s.wall.length, s.deadWall.filter(Boolean).length];
// Seat 0 (dealer) in its discard phase holding `hand` + `drawn`, with no dora set up.
function turn(hand, drawn, more = {}) {
  const s = table({ hands: { 0: hand, ...more.hands }, drawn });
  s.doraIndicators = [s.deadWall[4]];
  return s;
}

// --- Closed kan ---
{
  const s = turn('111m456p789s23s55m', '1m');
  const [wall0, dead0] = liveDead(s);
  const replacement = s.deadWall[0];
  const kanIndicator = s.deadWall[6];
  check('a closed kan is offered with four in hand', kanOptions(s, 0).map((o) => `${o.type} ${o.kind}`).join() === 'ankan 0');
  declareKan(s, 0, 0);
  const [meld] = s.players[0].melds;
  check('it makes a closed meld of the four tiles', meld.type === 'kan' && meld.kanType === 'ankan' && !meld.open &&
    labels(meld.tiles) === '1m 1m 1m 1m' && s.players[0].hand.length === 10);
  check('a closed kan reveals its new dora indicator at once', s.doraIndicators.length === 2 && s.doraIndicators[1] === kanIndicator);
  check('the player draws the replacement tile and keeps their turn',
    s.players[0].drawn === replacement && s.players[0].rinshan && s.current === 0 && s.phase === 'discard');
  check('the last live tile moves to the dead wall: one draw fewer, dead wall still 14',
    s.wall.length === wall0 - 1 && liveDead(s)[1] === dead0 && checkIntegrity(s));
}

{
  // After the kan the hand waits on 1s/4s; the replacement tile is a 4s.
  const s = turn('111m456p789s23s55m', '1m');
  s.deadWall[0] = parse('4s', 7000)[0];
  declareKan(s, 0, 0);
  check('winning on the replacement tile can tsumo', canTsumo(s, 0));
  s.players[0].discards = parse('9p', 1950); // not the first draw
  tsumo(s, 0);
  const sc = s.result.scores[0];
  const names = sc.yaku.map((y) => y.name);
  check('rinshan kaihou, and a closed kan keeps the hand closed (menzen tsumo)',
    names.includes('Rinshan kaihou') && names.includes('Menzen tsumo') && !names.includes('Pinfu'));
}

// --- Added kan, chankan ---
const withPon = (s, seat, ponTiles, from = 3) => {
  const tiles = parse(ponTiles, 3000);
  s.players[seat].melds.push({ type: 'pon', open: true, tiles, from, calledId: tiles[0].id });
};

{
  const s = turn('456p789s23s55m9p', '5z');
  withPon(s, 0, '555z');
  s.players[0].hand = parse('456p789s23s55m9p', 1000).slice(0, 10);
  check('an added kan is offered for the fourth tile of a pon', kanOptions(s, 0).some((o) => o.type === 'kakan' && o.kind === 31));
  declareKan(s, 0, 31);
  const meld = s.players[0].melds[0];
  check('nobody can rob it: the pon becomes a kan and the player draws a replacement',
    meld.type === 'kan' && meld.kanType === 'kakan' && meld.tiles.length === 4 && !!meld.addedId && s.players[0].rinshan);
  check('an added kan\'s indicator waits for the next discard', s.doraIndicators.length === 1 && s.pendingKanDora === 1);
  discard(s, s.players[0].drawn.id);
  check('and is revealed when the player discards', s.doraIndicators.length === 2);
}

// Seat 0 has a pon of 6m and draws the fourth; seat 1 waits on 3m/6m and holds no 6m.
function addedKanOf6m() {
  const s = turn('456p789s23s55m9p', '6m', { hands: { 1: '45m123p456p789s11z' } });
  withPon(s, 0, '666m');
  s.players[0].hand = parse('456p789s23s55m9p', 1000).slice(0, 10);
  s.players[0].discards = parse('1p', 1960);
  declareKan(s, 0, 5);
  return s;
}
{
  const s = addedKanOf6m();
  check('an added kan can be robbed: the others get a chance to ron', s.phase === 'claim' && canRon(s, 1) && s.lastDiscard.chankan);
  claim(s, 1, 'ron');
  const names = s.result.scores[0].yaku.map((y) => y.name);
  check('robbing it is a ron with chankan, paid by the kan player', s.result.type === 'ron' && s.result.chankan &&
    names.includes('Chankan') && s.result.from === 0 && s.result.winners.join() === '1');
  check('the kan never happens: the pon stays a pon, no replacement drawn', s.players[0].melds[0].type === 'pon' &&
    !s.players[0].drawn && s.doraIndicators.length === 1 && checkIntegrity(s));
}

{
  const s = addedKanOf6m();
  claim(s, 1, 'pass');
  check('if nobody robs it, the kan goes ahead', s.players[0].melds[0].type === 'kan' && s.players[0].rinshan && s.current === 0);
}

{
  // Seat 1 is kokushi tenpai on 1m; seat 2 waits on 1m with an ordinary hand. Seat 0 closed-kans 1m.
  const s = turn('111m456p789s23s55m', '1m', { hands: { 1: '9m19p19s12345677z', 2: '23m456p789s23455s' } });
  declareKan(s, 0, 0);
  check('only kokushi may rob a closed kan', s.phase === 'claim' && canRon(s, 1) && !canRon(s, 2));
  claim(s, 1, 'ron');
  check('and it scores as kokushi with chankan', s.result.scores[0].yaku.some((y) => y.name.startsWith('Kokushi')) && s.result.chankan);
}

// --- Open kan ---
{
  // Seat 0 discards a 5m; seat 2 holds three, seat 1 could chii it.
  const s = turn('1234567m2468p13s', '5m', { hands: { 1: '46m123p456p789s12z', 2: '555m123p456p78s12z' } });
  const wall0 = s.wall.length;
  discard(s, s.players[0].drawn.id);
  check('three in hand offer an open kan on the discard', openKanOptions(s, 2).length === 1 && chiiOptions(s, 1).length > 0);
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  claim(s, 2, 'kan', openKanOptions(s, 2)[0]);
  const meld = s.players[2].melds[0];
  check('an open kan beats a chii', s.players[1].melds.length === 0 && meld?.type === 'kan' && meld.kanType === 'daiminkan');
  check('it is an open meld of four with the called tile, and the caller draws a replacement',
    meld.open && meld.tiles.length === 4 && meld.from === 0 && s.current === 2 && s.players[2].rinshan &&
    s.players[0].called.join() === 'true' && s.wall.length === wall0 - 1);
  check('its indicator waits for the caller\'s discard', s.doraIndicators.length === 1 && s.pendingKanDora === 1);
  // Seat 3 waits on 9p; seat 2 discards the 9p it drew... we give it one.
  s.players[2].drawn = parse('9p', 7100)[0];
  s.players[3].hand = parse('123m456p789s78p11z', 1300);
  discard(s, s.players[2].drawn.id);
  check('the indicator is revealed at that discard, before the ron on it', s.doraIndicators.length === 2 && canRon(s, 3));
  passClaims(s, 3);
  claim(s, 3, 'ron');
  check('so the ron on that discard sees the new dora indicator', s.result.type === 'ron' && checkIntegrity(s));
}

{
  const s = turn('1234567m2468p13s', '5m', { hands: { 2: '555m123p456p78s12z', 3: '34m123p456p789s11z' } });
  discard(s, s.players[0].drawn.id);
  claim(s, 2, 'kan', openKanOptions(s, 2)[0]);
  passClaims(s, 3); // seat 1 could chii the 5m
  claim(s, 3, 'ron');
  check('ron beats an open kan', s.result?.type === 'ron' && s.players[2].melds.length === 0);
}

// --- Riichi ---
{
  // Waits on 1s/4s with 444m always a triplet.
  const s = turn('444m456p789s23s55m', '4m');
  s.players[0].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: true };
  s.players[0].discards = parse('9p', 1950);
  check('in riichi a closed kan is allowed if every reading keeps the triplet', kanOptions(s, 0).length === 1);
  check('and the auto-discard waits so it can be declared', !autoDiscardDue(s));
}

{
  // 1112444m: winning on a 3 reads 111 234 44 (a 4 in a run), so 444 isn't always a triplet.
  const hand = '1112444m456p789s';
  const free = turn(hand, '4m');
  check('without riichi, 1112444 + 4 may closed kan the 4s', kanOptions(free, 0).some((o) => o.type === 'ankan' && o.kind === 3));
  const s = turn(hand, '4m');
  s.players[0].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  s.players[0].discards = parse('9p', 1950);
  check('in riichi 1112444 can\'t kan the 4s (the waits are the same but a reading changes)', kanOptions(s, 0).length === 0);
  check('so its useless draw is auto-discarded as usual', autoDiscardDue(s));
}

{
  // Riichi player with 444m in hand draws something else: no kan (only the drawn tile can kan).
  const s = turn('4444m56p789s23s55m', '9p');
  s.players[0].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  s.players[0].discards = parse('1p', 1950);
  check('in riichi only the tile just drawn can make the kan', !kanOptions(s, 0).some((o) => o.kind === 3));
}

{
  const s = turn('1234567m2468p13s', '5m', { hands: { 2: '555m123p456p78s12z' } });
  s.players[2].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  discard(s, s.players[0].drawn.id);
  check('no open kan while in riichi', openKanOptions(s, 2).length === 0);
}

{
  const s = turn('111m456p789s23s55m', '1m');
  s.players[2].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: true };
  declareKan(s, 0, 0);
  check('any kan, even a closed one, ends ippatsu and the uninterrupted first go-around', !s.players[2].riichi.ippatsu && s.callMade);
}

// --- Limits ---
{
  const s = turn('111m456p789s23s55m', '1m');
  s.wall = [];
  check('no kan on the last live tile', kanOptions(s, 0).length === 0);
}

{
  const s = turn('111m456p789s23s55m', '1m');
  for (const seat of [1, 2]) s.players[seat].melds.push({ type: 'kan', kanType: 'ankan', open: false, tiles: parse(seat === 1 ? '9999p' : '2222s', 3100 + seat * 10), from: seat, calledId: null });
  s.players[3].melds.push({ type: 'kan', kanType: 'ankan', open: false, tiles: parse('7777z', 3200), from: 3, calledId: null });
  s.players[1].hand = s.players[1].hand.slice(0, 10);
  s.players[2].hand = s.players[2].hand.slice(0, 10);
  s.players[3].hand = s.players[3].hand.slice(0, 10);
  s.doraIndicators = [s.deadWall[4], s.deadWall[6], s.deadWall[8], s.deadWall[10]];
  declareKan(s, 0, 0);
  check('the fourth kan is allowed, a fifth is not', s.players[0].melds.length === 1 && kanOptions(s, 0).length === 0);
  discard(s, s.players[0].drawn.id);
  passClaims(s);
  check('four kans by more than one player abort the hand once the fourth kan\'s discard passes',
    s.result?.type === 'abortiveDraw' && s.result.reason === 'suukaikan');
}

// --- Several kans ---
{
  // Closed kan of 1m, then the replacement is the fourth 9p for a second closed kan.
  const s = turn('111m999p789s23s55m', '1m');
  s.deadWall[0] = parse('9p', 7000)[0];
  declareKan(s, 0, 0);
  check('a replacement tile can make another kan', kanOptions(s, 0).some((o) => o.kind === 17));
  declareKan(s, 0, 17);
  check('two closed kans reveal two indicators, and two replacement draws shorten the live wall by two',
    s.doraIndicators.length === 3 && s.rinshanUsed === 2 && s.deadWall.filter(Boolean).length === 14 && checkIntegrity(s));
}

{
  // An open kan, then (before discarding) a closed kan with the replacement: the pending
  // indicator is revealed first.
  const s = turn('1234567m2468p13s', '5m', { hands: { 2: '555m111p456p78s1z' } });
  s.players[2].hand = parse('555m111p456p78s1z', 1200);
  discard(s, s.players[0].drawn.id);
  s.deadWall[0] = parse('1p', 7000)[0];
  claim(s, 2, 'kan', openKanOptions(s, 2)[0]);
  passClaims(s);
  declareKan(s, 2, 9);
  check('a second kan reveals the first kan\'s pending indicator, then its own', s.doraIndicators.length === 3 && s.pendingKanDora === 0);
}

done();
