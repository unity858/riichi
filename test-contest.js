// Run with: node test-contest.js
import { newHand, createTiles, draw, discard, claim, tsumo, canRon, canKyuushu, riichiDiscards, declareRiichi, declareKan, checkIntegrity, isYakuman, isWild, tileLabel, chooseExchange, DERANGEMENTS, randomDerangement } from './game.js';
import { newMatch, handSettings, normalizeSettings, recordHand } from './match.js';
import { table, parse, passClaims, check, done } from './test-helpers.js';

// A Baiman contest hand: everyone on 0.
function contest(opts) {
  const s = table({ ...opts, scores: [0, 0, 0, 0] });
  s.rules.contest = true;
  s.doraIndicators = [];
  s.uraIndicators = [];
  return s;
}
// Discards the current player's drawn tile, then lets everyone pass.
function throwDraw(s) {
  discard(s, s.players[s.current].drawn.id);
  passClaims(s);
}

// 9 han (chinitsu 6, ittsu 2, pinfu 1) waiting on 1m/4m: a baiman by ron.
const BAIMAN_4M = '123456789m11m23m';
// One-han hands waiting on 1m/4m (yakuhai): no points.
const HAKU_4M = '23m456p789s55s555z';
const HATSU_4M = '23m456p789s55s666z';

{
  const s = contest({ hands: { 0: '123m456p789s23s55m' }, drawn: '4s' });
  s.callMade = true; // not tenhou (a yakuman would end the hand)
  check('a tsumo is allowed', tsumo(s, 0));
  check('the hand goes on: no result, the next player is due to draw',
    s.result === null && s.phase === 'draw' && s.current === 1 && s.players[0].won?.type === 'tsumo');
  check('the winner shows tsumo; a small win scores 0 points, and nobody loses any', s.players[0].callout === 'tsumo' && s.scores.join() === '0,0,0,0');
  check('the winning tile stays with the winner', s.players[0].drawn?.rank === 4 && checkIntegrity(s));
  draw(s);
  check('the next player draws', s.current === 1 && !!s.players[1].drawn);
  throwDraw(s); draw(s); // seat 2
  throwDraw(s); draw(s); // seat 3
  throwDraw(s); draw(s);
  check('the winner is skipped: after seat 3 comes seat 1', s.current === 1 && s.players[0].drawn.rank === 4);
  check('the winner\'s callout stays up', s.players[0].callout === 'tsumo');
}

{
  const s = contest({ hands: { 1: BAIMAN_4M }, drawn: '4m' });
  discard(s, s.players[0].drawn.id);
  passClaims(s, 1);
  claim(s, 1, 'ron');
  check('a ron is allowed and the hand goes on from the next player still in',
    s.result === null && s.phase === 'draw' && s.current === 2 && s.players[1].won?.type === 'ron');
  check('the ronned discard stays in the pond, marked called', s.players[0].called.join() === 'true' && checkIntegrity(s));
  check('it is scored now, worth 1 point as a baiman, and the point counts at once',
    s.players[1].won.points === 1 && s.players[1].won.score.limit === 'Baiman' && s.scores.join() === '0,1,0,0');
  check('the discarder loses nothing', s.scores[0] === 0);
}

{
  // Seats 1, 2 and 3 all ron seat 0's 4m: the third winner ends the hand.
  const s = contest({ hands: { 1: BAIMAN_4M, 2: HAKU_4M, 3: HATSU_4M }, drawn: '4m' });
  discard(s, s.players[0].drawn.id);
  for (const seat of [1, 2, 3]) claim(s, seat, 'ron');
  const r = s.result;
  check('three winners end the hand', r?.type === 'contest' && r.reason === 'three winners' && r.winners.join() === '1,2,3');
  check('only the baiman scores a point, counted once; nobody loses any', r.deltas.join() === '0,1,0,0' && s.scores.join() === '0,1,0,0');
  check('each win keeps its score (no fu needed for the points)', r.scores.length === 3 && r.wins.map((w) => w.points).join() === '1,0,0');
}

{
  // A win by seat 1, then a later discard seat 1's hand would complete: they can't win again.
  const s = contest({ hands: { 1: BAIMAN_4M }, drawn: '4m' });
  discard(s, s.players[0].drawn.id);
  passClaims(s, 1);
  claim(s, 1, 'ron');
  s.wall.unshift({ id: 5000, suit: 'm', rank: 1, red: false }); // seat 2 draws a 1m
  draw(s);
  discard(s, s.players[2].drawn.id);
  check('a player who has won can\'t ron again', !canRon(s, 1) && !(1 in s.claimOptions));
}

{
  const s = contest({ drawn: '9z', wall: 0 });
  discard(s, s.players[0].drawn.id);
  passClaims(s);
  check('the wall running out ends the hand with no winners',
    s.result?.type === 'contest' && s.result.reason === 'wall' && s.result.winners.length === 0 && s.scores.join() === '0,0,0,0');
}

{
  const s = contest({ hands: { 0: '123m456p789s23s55m' }, drawn: '7z' });
  check('riichi needs no points', riichiDiscards(s, 0).length > 0);
  declareRiichi(s, 0, s.players[0].drawn.id);
  passClaims(s);
  check('and costs none: no stick, scores unchanged', s.players[0].riichi && s.riichiSticks === 0 && s.scores.join() === '0,0,0,0');
}

{
  const settings = normalizeSettings({ format: 'baiman', bust: true, extension: true });
  check('the format is a setting, standard by default', normalizeSettings({}).format === 'standard' && settings.format === 'baiman');
  check('going bust and sudden death are off in a Baiman contest', !settings.bust && !settings.extension);
  const m = newMatch(settings);
  check('everyone starts on 0, and hands get the contest rule',
    m.scores.join() === '0,0,0,0' && handSettings(m).rules.contest === true && handSettings(newMatch()).rules.contest === false);
}

// --- Dealer repeats (honba) ---
{
  check('the dealer repeat setting defaults to "only after a baiman", and keeps valid values only',
    normalizeSettings({}).contestRepeat === 'baiman' && normalizeSettings({ contestRepeat: 'none' }).contestRepeat === 'none' &&
    normalizeSettings({ contestRepeat: 'always' }).contestRepeat === 'baiman');
  // Records a made-up contest hand for a match, from wins [[seat, points], ...].
  const hand = (m, wins, type = 'contest') => recordHand(m, {
    scores: [...m.scores],
    result: { type, reason: 'wall', winners: wins.map(([seat]) => seat), wins: wins.map(([seat, points]) => ({ seat, points })),
      deltas: [0, 0, 0, 0], tenpai: [0, 1, 2, 3], nagashi: [] },
  });
  const m = newMatch({ format: 'baiman', contestRepeat: 'baiman' });
  hand(m, [[0, 1]]);
  check('"only after a baiman": a dealer baiman repeats the dealer, one honba', m.dealer === 0 && m.honba === 1);
  hand(m, [[2, 1], [0, 1]]);
  check('even as one of several winners: two honba', m.dealer === 0 && m.honba === 2);
  hand(m, [[0, 0]]);
  check('a dealer win worth no point passes the deal, and honba go back to 0', m.dealer === 1 && m.honba === 0);
  hand(m, []);
  check('so does a hand nobody won, even with the dealer tenpai', m.dealer === 2 && m.honba === 0);
  m.history.length = 0;
  recordHand(m, { scores: [...m.scores], result: { type: 'abortiveDraw', reason: 'kyuushu kyuuhai', revealed: [2], deltas: [0, 0, 0, 0] } });
  check('and kyuushu kyuuhai', m.dealer === 3 && m.honba === 0);

  const never = newMatch({ format: 'baiman', contestRepeat: 'none' });
  hand(never, [[0, 1]]);
  check('"never": even a dealer baiman passes the deal', never.dealer === 1 && never.honba === 0);
}

// --- Ura dora ---
for (const how of ['tsumo', 'ron']) {
  // East declares riichi on 7z holding 55m; the ura dora is 5m (indicator 4m).
  const s = contest({ hands: { 0: '123m456p789s23s55m' }, drawn: '7z' });
  s.uraIndicators = parse('4m', 4100);
  declareRiichi(s, 0, s.players[0].drawn.id);
  passClaims(s);
  if (how === 'tsumo') {
    s.wall.splice(3, 0, parse('4s', 5000)[0]); // East's next draw
    for (let i = 0; i < 3; i++) { draw(s); throwDraw(s); }
    draw(s);
    tsumo(s, 0);
  } else {
    draw(s);
    s.players[1].drawn = parse('4s', 5000)[0];
    discard(s, s.players[1].drawn.id);
    passClaims(s, 0);
    claim(s, 0, 'ron');
  }
  check(`a riichi ${how} counts the ura dora (2 for 55m)`, s.players[0].won?.score.dora.ura === 2);
}

// --- A ron interrupts like a call ---
{
  // Seat 1 rons the dealer's first discard; seat 3 is in riichi with ippatsu.
  const s = contest({ hands: { 1: BAIMAN_4M, 2: '19m19p19s1234567z' }, drawn: '4m' });
  s.players[3].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: true };
  discard(s, s.players[0].drawn.id);
  passClaims(s, 1);
  claim(s, 1, 'ron');
  check('a ron ends ippatsu for the other riichi players', s.players[3].riichi.ippatsu === false);
  check('and the uninterrupted first go-around (no double riichi, chiihou or renhou after it)', s.callMade === true);
  draw(s);
  check('so no kyuushu kyuuhai either, even on a first draw', s.current === 2 && !canKyuushu(s, 2));
}

// --- Suufon renda ---
{
  const winds = (s, n) => {
    for (let i = 0; i < n; i++) {
      discard(s, s.players[s.current].hand.find((t) => t.suit === 'z' && t.rank === 1).id);
      passClaims(s);
      draw(s);
    }
  };
  const hand = '123456m2468p13s1z';
  const s = contest({ hands: { 0: hand, 1: hand, 2: hand, 3: hand }, drawn: '9p' });
  winds(s, 4);
  check('suufon renda aborts a contest hand too', s.result?.type === 'abortiveDraw' && s.result.reason === 'suufon renda' &&
    s.scores.join() === '0,0,0,0');
  const m = newMatch(normalizeSettings({ format: 'baiman' }));
  recordHand(m, s);
  check('and never repeats the dealer', m.dealer === 1 && m.honba === 0);

  // Seat 1 (in riichi with the wild tile, so not furiten on 1z) rons the dealer's East.
  const r = contest({ hands: { 0: '12345m2468p13s11z', 1: '123m456p789s555m1A', 2: hand, 3: hand }, drawn: '9p' });
  r.players[1].riichi = { turn: -1, discardIndex: 0, double: false, ippatsu: false };
  discard(r, r.players[0].hand.find((t) => t.suit === 'z').id);
  passClaims(r, 1);
  claim(r, 1, 'ron');
  draw(r);
  winds(r, 3); // seats 2, 3 and 0, skipping the winner
  check('a ron before the fourth wind rules it out', r.players[1].won?.type === 'ron' && r.result === null &&
    r.discardLog.filter((d) => d.tile.suit === 'z').length === 4);
}

// --- Nagashi ---
{
  let nagashiScores;
  const nagashi = (rebalance) => {
    // Only seat 2's discards are all terminals and honors; the hand's last two discards are 5s and 5p.
    const s = contest({ drawn: '5s' });
    s.rules.yakuRebalance = rebalance;
    s.wall = parse('5p', 6000); // the last tile, for seat 1
    s.players[2].discards = parse('19m', 1950);
    s.players[2].tsumogiri = [false, false];
    s.players[2].called = [false, false];
    discard(s, s.players[0].drawn.id);
    passClaims(s);
    draw(s);
    discard(s, s.players[1].drawn.id);
    passClaims(s);
    nagashiScores = s.scores;
    return s.result;
  };
  const plain = nagashi(false);
  check(`nagashi at the end of the wall: ${JSON.stringify(plain?.nagashi)}`,
    plain?.type === 'contest' && plain.nagashi.map((n) => n.seat).join() === '2' && plain.nagashi[0].points === 0);
  const rebalanced = nagashi(true);
  check('with the yaku rebalance it is a baiman: 1 point', rebalanced.nagashi[0].limit === 'Baiman' && rebalanced.deltas[2] === 1);
  check('the final score counts it once', nagashiScores.join() === '0,0,1,0');
}
{
  // Seat 0's only discard is ronned: it no longer counts for nagashi.
  const s = contest({ hands: { 1: '23m456p789s55s555z' }, drawn: '1m', wall: 1 });
  discard(s, s.players[0].drawn.id);
  passClaims(s, 1);
  claim(s, 1, 'ron');
  draw(s); // seat 2 draws the last tile
  discard(s, s.players[2].drawn.id);
  passClaims(s);
  check('a discard that was ronned loses nagashi', s.result?.type === 'contest' && !s.result.nagashi.some((n) => n.seat === 0));
}

// --- Yakuman ---
{
  // Seat 1 has daisangen waiting on Chun; seat 2 could ron the same tile with a small hand.
  const s = contest({ hands: { 1: '555z666z77z123m44p', 2: '77z123m456p789s44s' }, drawn: '7z' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  claim(s, 2, 'ron');
  const r = s.result;
  check('a yakuman ends the hand at once', r?.type === 'contest' && r.reason === 'yakuman' && r.yakuman === true && r.winners.join() === '1,2');
  const m = newMatch({ format: 'baiman' });
  recordHand(m, { ...s, scores: [0, 0, 0, 0] });
  check('and the match', m.over && m.final.reason === 'yakuman');
  check('kazoe yakuman counts as a yakuman', isYakuman({ yakuman: 0, limit: 'Kazoe yakuman' }) && !isYakuman({ yakuman: 0, limit: 'Sanbaiman' }));
}

// --- Robbing a kan ---
{
  // Seat 0 has a pon of 6m and adds the fourth; seat 1 waits on 3m/6m and robs it.
  const s = contest({ hands: { 0: '456p789s23s55m9p', 1: '45m123p456p789s11z' }, drawn: '6m' });
  s.players[0].melds = [{ type: 'pon', open: true, tiles: parse('666m', 3000), from: 3, calledId: 3000 }];
  s.players[0].hand = parse('456p789s23s55m9p', 1000).slice(0, 10);
  s.players[0].discards = parse('1p', 1960);
  s.players[0].tsumogiri = [false];
  s.players[0].called = [false];
  declareKan(s, 0, 5);
  claim(s, 1, 'ron');
  check('a robbed added kan: the winner takes the tile, the pon stays a pon',
    s.players[1].won?.chankan && s.players[0].melds[0].type === 'pon' && checkIntegrity(s));
  check('and the kan player plays on as if they had discarded it: the next player still in draws',
    s.result === null && s.phase === 'draw' && s.current === 2);
}
{
  // Seat 1 is kokushi tenpai on 1m; seat 0 closed-kans 1m.
  const s = contest({ hands: { 0: '111m456p789s23s55m', 1: '9m19p19s12345677z' }, drawn: '1m' });
  s.callMade = true; // not a first-go-around hand
  declareKan(s, 0, 0);
  check('kokushi can rob a closed kan in a Baiman contest too', s.phase === 'claim' && canRon(s, 1));
  claim(s, 1, 'ron');
  check('it is a yakuman, so it ends the hand (and the match); the tile stays in the kan',
    s.result?.reason === 'yakuman' && s.result.wins[0].chankan && s.players[0].melds[0].tiles.length === 4 && checkIntegrity(s));
}

// --- The wild tile and the tile exchange ---
// Each seat passes its first three regular tiles; returns their ids per seat.
const firstThree = (s) => s.players.map((p) => p.hand.filter((t) => !isWild(t)).slice(0, 3).map((t) => t.id));
{
  const wall = createTiles(); // unshuffled: positions are easy to follow
  const s = newHand({ wall: [...wall], scores: [0, 0, 0, 0], rules: { contest: true } });
  const wilds = s.players.map((p) => p.hand.filter(isWild));
  check('every contest hand starts with 13 tiles, one of them the wild tile 1A',
    s.players.every((p) => p.hand.length === 13) && wilds.every((w) => w.length === 1 && tileLabel(w[0]) === '1A'));
  check('it sorts to the start (left) of the hand', s.players.every((p) => isWild(p.hand[0])));
  check('the wild tiles are extra: all 136 are still in play, and the deal takes 4 fewer from the wall',
    checkIntegrity(s) && s.wall.length === 136 - 14 - 48);
  check('a contest hand starts with the tile exchange: nobody has drawn yet, and no passes are known',
    s.phase === 'exchange' && !s.players[0].drawn && s.passes === null);
  const standard = newHand({ wall: [...wall] });
  check('a standard hand has no wild tile and no exchange', standard.players.every((p) => !p.hand.some(isWild)) &&
    standard.phase === 'discard' && standard.players[0].drawn.id === wall[52].id);

  // Picks that aren't allowed.
  const hand0 = s.players[0].hand;
  const wild = hand0.find(isWild);
  const regular = hand0.filter((t) => !isWild(t)).map((t) => t.id);
  check('a pick must be exactly three tiles', !chooseExchange(s, 0, regular.slice(0, 2)) && !chooseExchange(s, 0, regular.slice(0, 4)));
  check('never the wild tile', !chooseExchange(s, 0, [wild.id, regular[0], regular[1]]));
  check('three distinct tiles of your own hand', !chooseExchange(s, 0, [regular[0], regular[0], regular[1]]) &&
    !chooseExchange(s, 0, [regular[0], regular[1], s.players[1].hand[1].id]));
  check('and nothing else happens before the exchange: no discards', discard(s, regular[0]) === null);

  // Everyone picks; seat n's tiles go to seat sigma[n] = n + 1.
  const picks = firstThree(s);
  const passed = picks.map((ids, n) => ids.map((id) => s.players[n].hand.find((t) => t.id === id)));
  check('a valid pick is taken', chooseExchange(s, 0, picks[0]));
  check('and is final', !chooseExchange(s, 0, regular.slice(3, 6)));
  chooseExchange(s, 1, picks[1]);
  chooseExchange(s, 2, picks[2]);
  check('the exchange waits for all four', s.phase === 'exchange');
  chooseExchange(s, 3, picks[3], [1, 2, 3, 0]);
  check('then player n\'s three tiles go to player sigma[n]', [0, 1, 2, 3].every((n) =>
    passed[n].every((t) => s.players[(n + 1) % 4].hand.includes(t) && !s.players[n].hand.includes(t))));
  check('everyone still has 13 tiles, the wild tile kept, sorted', s.players.every((p) => p.hand.length === 13 && isWild(p.hand[0])) && checkIntegrity(s));
  check('and the dealer is due to draw', s.phase === 'draw' && s.current === 0);
  check('who passed to whom is public from then on', s.passes.join() === '1,2,3,0');
  draw(s);
  check('the dealer\'s first draw is wall position 48 (no 13th regular tile was dealt)', s.players[0].drawn.id === wall[48].id && s.phase === 'discard');

  // East tries to discard the wild tile: it never leaves the hand (see test-wild.js for the rest).
  check('the wild tile can\'t be discarded', discard(s, wild.id) === null && s.phase === 'discard' && s.players[0].hand.includes(wild));
}
{
  check('there are 9 derangements of [0, 1, 2, 3], none with a fixed point',
    DERANGEMENTS.length === 9 && DERANGEMENTS.every((p) => p.every((x, i) => x !== i) && [...p].sort().join() === '0,1,2,3'));
  const seen = new Map();
  for (let i = 0; i < 9000; i++) {
    const key = randomDerangement().join();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  check(`the random derangement takes all 9, about evenly (${[...seen.values()].join(' ')} of 9000)`,
    seen.size === 9 && [...seen.values()].every((n) => n > 800 && n < 1200));
}

done();
