// Run with: node test-rebalance.js
import { scoreHand } from './scoring.js';
import { newHand, discard, claim, canRon } from './game.js';
import { newMatch, handSettings, normalizeSettings } from './match.js';
import { parse, table, check, done } from './test-helpers.js';

// Non-dealer in the South seat, East round, ron, no dora; rebalance on or off.
function score(hand, win, rebalance, { melds = [], ...ctx } = {}) {
  const meldTiles = melds.map(([type, tiles, open = true], i) => ({ type, open, tiles: parse(tiles, 3000 + i * 10) }));
  return scoreHand(parse(hand), parse(win, 2000)[0], meldTiles, {
    tsumo: false, dealer: false, seatWind: 1, roundWind: 0, doraIndicators: [], uraIndicators: [], rebalance, ...ctx,
  });
}
const han = (s, name) => s.yaku.find((y) => y.name === name)?.han;
const yakuman = (s, name) => s.yaku.find((y) => y.name === name)?.yakuman;

{
  const hand = ['111m111p111s45s99m', '3s'];
  check('sanshoku doukou: 2 han, 3 with the rebalance', han(score(...hand, false), 'Sanshoku doukou') === 2 &&
    han(score(...hand, true), 'Sanshoku doukou') === 3);
}
{
  // 111m 111p and a pair of 1s, with 234s 567s: shoutate.
  const hand = ['111m111p11s234s56s', '7s'];
  check('shoutate: 2 han with the rebalance', han(score(...hand, true), 'Shoutate') === 2);
  check('and no shoutate without it', han(score(...hand, false), 'Shoutate') === undefined);
  check('shoutate needs the pair in the third suit', han(score('111m111p11z234s56s', '7s', true), 'Shoutate') === undefined);
}
{
  const kans = { melds: [['kan', '2222m'], ['kan', '3333p'], ['kan', '4444s']] };
  const standard = score('12m55p', '3m', false, kans);
  const rebalanced = score('12m55p', '3m', true, kans);
  check('sankantsu: 2 han, a yakuman with the rebalance', han(standard, 'Sankantsu') === 2 && !standard.yakuman &&
    yakuman(rebalanced, 'Sankantsu') === 1 && rebalanced.total === 32000);
}
{
  const kans = { melds: [['kan', '2222m'], ['kan', '3333p'], ['kan', '4444s'], ['kan', '6666m']] };
  check('suukantsu: a yakuman, a double yakuman with the rebalance',
    score('5p', '5p', false, kans).yakuman === 1 && yakuman(score('5p', '5p', true, kans), 'Suukantsu') === 2 &&
    score('5p', '5p', true, kans).total === 64000);
}

{
  // Nagashi for the dealer (seat 0), with and without the rebalance.
  const nagashi = (rebalance) => {
    const s = table({ drawn: '9s', wall: 0 });
    s.rules.yakuRebalance = rebalance;
    s.players[0].discards = parse('19m1z', 1950);
    discard(s, s.players[0].drawn.id);
    return s.result.deltas.join();
  };
  check('nagashi: mangan (4000 all from the dealer), baiman (8000 all) with the rebalance',
    nagashi(false) === '12000,-4000,-4000,-4000' && nagashi(true) === '24000,-8000,-8000,-8000');
}

{
  check('the rebalance is a room setting, off by default',
    normalizeSettings({}).yakuRebalance === false && normalizeSettings({ yakuRebalance: true }).yakuRebalance === true);
  const m = newMatch({ yakuRebalance: true });
  const s = newHand(handSettings(m));
  check('the match passes it into every hand', s.rules.yakuRebalance === true && newHand().rules.yakuRebalance === false);
}

// --- Ryanpeikou ---
{
  const hand = ['223344m556677p8s', '8s'];
  check('ryanpeikou: 3 han, 6 with the rebalance', han(score(...hand, false), 'Ryanpeikou') === 3 &&
    han(score(...hand, true), 'Ryanpeikou') === 6);
  check('iipeikou is still 1 han', han(score('223344m567p34s88p', '5s', true), 'Iipeikou') === 1);
}

// --- Renhou ---
// Seat 1 (not the dealer, no discards yet) waits on 2p/5p with no yaku of its own.
const NO_YAKU = '111m234p567s789s5p';
function renhouTable({ rebalance = true, hand = NO_YAKU, drawn = '5p' } = {}) {
  const s = table({ hands: { 1: hand }, drawn });
  s.rules.yakuRebalance = rebalance;
  s.doraIndicators = parse('4p', 4000); // the 5p would be dora
  return s;
}
{
  const s = renhouTable();
  discard(s, s.players[0].drawn.id);
  check('renhou: a ron before your first draw is a yaku, even for a hand with none', canRon(s, 1) && claim(s, 1, 'ron'));
  const sc = s.result.scores[0];
  check('it is a flat baiman (16000 for a non-dealer ron), with no other yaku and no dora',
    sc.yaku.map((y) => y.name).join() === 'Renhou' && sc.han === 8 && sc.limit === 'Baiman' && sc.total === 16000 &&
    sc.dora.dora === 0);
}
{
  const s = renhouTable({ rebalance: false });
  discard(s, s.players[0].drawn.id);
  check('without the rebalance there is no renhou (and this hand has no yaku)', !canRon(s, 1));
}
{
  const s = renhouTable();
  s.players[1].discards = parse('9p', 1950);
  discard(s, s.players[0].drawn.id);
  check('no renhou after your first draw', !canRon(s, 1));
}
{
  const s = renhouTable();
  s.callMade = true;
  discard(s, s.players[0].drawn.id);
  check('no renhou after a call', !canRon(s, 1));
}
{
  // Seat 1 waits on Chun with daisangen: worth more than renhou, so the yakuman is scored.
  const s = renhouTable({ hand: '555z666z77z123m44p', drawn: '7z' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('a hand worth more without renhou keeps that score (daisangen)', s.result.scores[0].yaku.map((y) => y.name).join() === 'Daisangen');
}
{
  // Pinfu + tanyao + a red five + plenty of dora: worth more than renhou's baiman as a
  // normal hand, so the normal score (with its dora) is kept.
  const s = renhouTable({ hand: '234m0p67p345s66p45s', drawn: '6s' });
  s.doraIndicators = parse('5p3s2m5p', 4000); // dora 6p (x2 indicators), 4s, 3m
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  const sc = s.result.scores[0];
  check(`a hand worth more with its other yaku and dora keeps that score (${sc.han} han, ${sc.limit})`,
    !sc.yaku.some((y) => y.name === 'Renhou') && sc.dora.dora > 0 && sc.total > 16000);
}
check('renhou is only by ron, not tsumo',
  !score('123m456p789s23s55m', '4s', true, { tsumo: true, renhou: true }).yaku.some((y) => y.name === 'Renhou'));

// --- Nagashi ignores dora ---
{
  // East's discards and hand are full of dora and red fives; the payment doesn't change.
  const s = table({ hands: { 0: '0m0p0s5m5p5s1234567m' }, drawn: '9s', wall: 0 });
  s.players[0].hand = parse('0m0p0s5m5p5s1234567m', 1000).slice(0, 13);
  s.players[0].discards = parse('19m1z9p', 1950);
  s.doraIndicators = parse('8s9s4m', 4000); // dora 9s, 1s, 5m
  discard(s, s.players[0].drawn.id);
  check('nagashi pays the same with dora: 4000 all', s.result.nagashi.join() === '0' && s.result.deltas.join() === '12000,-4000,-4000,-4000');
}

done();
