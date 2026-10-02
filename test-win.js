// Run with: node test-win.js
import { newHand, draw, discard, tsumo, claim, canTsumo, canRon, checkIntegrity, declareKan, chiiOptions } from './game.js';
import { parse, table, stackWall, passClaims, check, done } from './test-helpers.js';
import { furitenStatus, waitYaku, kindLabel, discardPreview, tileIndex } from './game.js';

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

{
  const s = table({ drawn: '9s' });
  discard(s, s.players[0].drawn.id); // tsumogiri
  draw(s);
  discard(s, s.players[1].hand[0].id); // from the hand
  check('discards record whether they were tsumogiri',
    s.players[0].tsumogiri.join() === 'true' && s.players[1].tsumogiri.join() === 'false' &&
    s.players.every((p) => p.tsumogiri.length === p.discards.length));
}

// --- A win needs a yaku ---
// 111m 234p 567s 789s + 5p waits on 2p/5p and has no yaku of its own (dora don't count).
const NO_YAKU = '111m234p567s789s5p';

{
  const s = table({ hands: { 1: NO_YAKU }, drawn: '5p' });
  s.doraIndicators = parse('4p', 4000); // 5p is dora: still no yaku
  discard(s, s.players[0].drawn.id);
  check('no ron without a yaku, even with dora (a chii is still offered)', !canRon(s, 1) && !s.claimOptions[1]?.ron && chiiOptions(s, 1).length > 0);
}
{
  const s = table({ hands: { 1: NO_YAKU }, drawn: '5p', wall: 0 });
  discard(s, s.players[0].drawn.id);
  check('houtei alone is enough: ron on the last discard', canRon(s, 1) && claim(s, 1, 'ron') &&
    s.result.scores[0].yaku.map((y) => y.name).join() === 'Houtei raoyui');
}
{
  const s = table({ hands: { 1: NO_YAKU }, drawn: '5p' });
  s.players[1].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  s.players[1].discards = parse('9p', 1950);
  discard(s, s.players[0].drawn.id);
  check('riichi is a yaku: the same hand can ron after declaring', canRon(s, 1));
}

// Seat 0 has an open chii of 789s, so no menzen tsumo: 111m 234p 567s 5p + 789s waits on 2p/5p.
function openNoYaku(wall) {
  const s = table({ hands: { 0: NO_YAKU }, drawn: '5p', wall });
  s.players[0].hand = parse('111m234p567s5p', 1000);
  const chi = parse('789s', 3000);
  s.players[0].melds.push({ type: 'chi', open: true, tiles: chi, from: 3, calledId: chi[0].id });
  s.players[0].discards = parse('9p', 1950);
  return s;
}
check('no tsumo with an open hand and no yaku', !canTsumo(openNoYaku(), 0) && !tsumo(openNoYaku(), 0));
{
  const s = openNoYaku(0);
  check('haitei alone is enough: tsumo on the last tile', canTsumo(s, 0) && tsumo(s, 0) &&
    s.result.scores[0].yaku.map((y) => y.name).join() === 'Haitei raoyue');
}

{
  // Seat 1 waits on 3m/6m with no yaku (a triplet rules out pinfu). It can't ron a discarded 6m,
  // but it can rob seat 0's added kan of 6m: chankan is a yaku.
  const noYaku6m = '45m111p567s789s99p';
  const d = table({ hands: { 1: noYaku6m }, drawn: '6m' });
  discard(d, d.players[0].drawn.id);
  check('a yakuless hand can\'t ron the 6m as a discard', !canRon(d, 1));
  const s = table({ hands: { 0: '456p789s23s55m9p', 1: noYaku6m }, drawn: '6m' });
  s.players[0].hand = parse('456p789s23s55m9p', 1000).slice(0, 10);
  const pon = parse('666m', 3000);
  s.players[0].melds.push({ type: 'pon', open: true, tiles: pon, from: 3, calledId: pon[0].id });
  s.players[0].discards = parse('1p', 1960);
  declareKan(s, 0, 5);
  check('chankan alone is enough: it can rob an added kan of 6m', canRon(s, 1) && claim(s, 1, 'ron') &&
    s.result.scores[0].yaku.map((y) => y.name).join() === 'Chankan');
}

{
  // The open hand above, holding 111m and drawing the fourth: after a closed kan of 1m, the
  // replacement 5p completes it with rinshan as the only yaku.
  const s = table({ hands: { 0: NO_YAKU }, drawn: '1m' });
  s.players[0].hand = parse('111m234p567s5p', 1000);
  const chi = parse('789s', 3000);
  s.players[0].melds.push({ type: 'chi', open: true, tiles: chi, from: 3, calledId: chi[0].id });
  s.players[0].discards = parse('9p', 1950);
  s.deadWall[0] = parse('5p', 7000)[0];
  declareKan(s, 0, 0);
  draw(s);
  check('rinshan alone is enough: tsumo on the replacement tile with an open hand', canTsumo(s, 0) && tsumo(s, 0) &&
    s.result.scores[0].yaku.map((y) => y.name).join() === 'Rinshan kaihou');
}

// --- Yaku per wait (atozuke) ---
{
  const label = (s, seat) => waitYaku(s, seat).map((w) => `${kindLabel(w.kind)}:${w.ron ? 'ron' : w.tsumo ? 'tsumo' : 'none'}`).join(' ');
  const s = table({ hands: { 1: NO_YAKU, 2: '123m456p789s23s55m', 3: '1234567m2468p13s' } });
  check('a closed hand with no yaku can only win its waits by tsumo', label(s, 1) === '2p:tsumo 5p:tsumo');
  check('a pinfu hand has a yaku on every wait', label(s, 2) === '1s:ron 4s:ron');
  check('a hand that isn\'t tenpai has no waits', waitYaku(s, 3).length === 0);
  s.players[1].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  check('after riichi every wait can win by ron', label(s, 1) === '2p:ron 5p:ron');
  // Atozuke: 234m 234p 23s 77s with an open pon of 999s waits on 1s/4s. Winning on 4s makes
  // sanshoku doujun (234 in all three suits); winning on 1s makes nothing.
  const o = table({ hands: { 1: '234m234p23s77s' } });
  o.players[1].hand = parse('234m234p23s77s', 1100);
  const pon = parse('999s', 3000);
  o.players[1].melds.push({ type: 'pon', open: true, tiles: pon, from: 0, calledId: pon[0].id });
  o.players[1].discards = parse('1z', 1190);
  o.callMade = true;
  check('atozuke: an open hand with a yaku on only one wait', label(o, 1) === '1s:none 4s:ron');
}

// Atozuke in play: the same open hand can ron the wait with a yaku, not the other.
for (const [tile, can] of [['4s', true], ['1s', false]]) {
  const s = table({ hands: { 1: '234m234p23s77s' }, drawn: tile });
  s.players[1].hand = parse('234m234p23s77s', 1100);
  const pon = parse('999s', 3000);
  s.players[1].melds.push({ type: 'pon', open: true, tiles: pon, from: 0, calledId: pon[0].id });
  s.players[1].discards = parse('1z', 1190);
  s.callMade = true;
  s.doraIndicators = [];
  discard(s, s.players[0].drawn.id);
  check(`atozuke: ${can ? 'ron on the 4s (sanshoku doujun)' : 'no ron on the 1s (no yaku)'}`, canRon(s, 1) === can);
}

// --- Discard preview: the waits you would have after each discard ---
{
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '7z' });
  const before = JSON.stringify(s.players[0]);
  const preview = discardPreview(s, 0);
  const ids = Object.keys(preview).map(Number);
  const chun = s.players[0].drawn.id;
  const waits = (p) => p.waits.map((w) => `${kindLabel(w.kind)}:${w.ron ? 'ron' : w.tsumo ? 'tsumo' : 'none'}`).join(' ');
  check('only tiles that leave you tenpai get a preview: here the Chun, waiting on 1s/4s (pinfu)',
    ids.join() === String(chun) && waits(preview[chun]) === '1s:ron 4s:ron' && !preview[chun].furiten);
  check('trying the discards changes nothing', JSON.stringify(s.players[0]) === before && checkIntegrity(s));
  check('no preview on another player\'s turn', Object.keys(discardPreview(s, 1)).length === 0);
}
{
  // Drawing a 4s: throwing it back keeps the same waits but you would be furiten on 4s.
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '4s' });
  const fours = [...s.players[0].hand, s.players[0].drawn].filter((t) => kindLabel(tileIndex(t)) === '4s').map((t) => t.id);
  const preview = discardPreview(s, 0);
  check('discarding a tile you would wait on previews furiten', fours.every((id) => preview[id]?.furiten));
}

// --- Furiten ---
{
  // Seat 1 waits on 1z/2z but has already discarded a 1z.
  const s = table({ hands: { 0: '1234567m2468p13s', 1: '123m456p789s1122z' }, drawn: '2z' });
  s.players[1].discards = parse('1z', 1950);
  discard(s, s.players[0].drawn.id);
  check('furiten: no ron on any wait once one of them is in your own discards', !canRon(s, 1));
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
// Any open claim from the previous discard is passed first (pairs in these hands can be ponned).
const passTurn = (s) => { passClaims(s); draw(s); return discard(s, s.players[s.current].drawn.id); };

{
  const s = waitingSeat2('2z9m1z');
  check('a winning discard is offered before anything passes', canRon(s, 2) && !furitenStatus(s, 2).temporary);
  claim(s, 2, 'pass');
  check('passing it makes you temporarily furiten', furitenStatus(s, 2).temporary);
  passTurn(s); // seat 1 discards 2z
  check('temporary furiten: no ron on another wait before your next discard', !canRon(s, 2));
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
  check('riichi furiten: no ron for the rest of the hand', !canRon(s, 2));
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
      for (const seat of Object.keys(s.claims)) claim(s, Number(seat), canRon(s, Number(seat)) ? 'ron' : 'pass');
    }
    draw(s);
  }
  if (s.phase === 'ended' && s.result && checkIntegrity(s)) finished++;
  if (s.result?.type !== 'exhaustiveDraw') wins++;
}
check(`300 random hands all end with a result and all 136 tiles accounted for (${wins} won)`, finished === 300);

done();
