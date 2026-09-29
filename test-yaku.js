// Run with: node test-yaku.js
import { scoreHand, basicPoints, payments } from './scoring.js';
import { parse, check, done } from './test-helpers.js';

// --- Points table ---
const ron = (han, fu, dealer = false) => payments(basicPoints(han, fu), { dealer, tsumo: false }).ron;
const tsumoPay = (han, fu, dealer = false) => payments(basicPoints(han, fu), { dealer, tsumo: true });

const table = [
  [1, 30, 1000], [1, 40, 1300], [2, 25, 1600], [2, 70, 4500], [3, 25, 3200], [3, 60, 7700],
  [4, 30, 7700], [3, 70, 8000], [4, 40, 8000], [5, 30, 8000], [6, 30, 12000], [7, 30, 12000],
  [8, 30, 16000], [10, 30, 16000], [11, 30, 24000], [12, 30, 24000], [13, 30, 32000], [20, 30, 32000],
];
check('non-dealer ron table', table.every(([han, fu, pts]) => ron(han, fu) === pts));
check('dealer ron table', ron(1, 30, true) === 1500 && ron(4, 30, true) === 11600 && ron(5, 30, true) === 12000 && ron(13, 30, true) === 48000);
const t1 = tsumoPay(1, 30);
const t3 = tsumoPay(3, 40);
check('non-dealer tsumo pays dealer/non-dealer', t1.dealer === 500 && t1.nonDealer === 300 && t3.dealer === 2600 && t3.nonDealer === 1300);
check('dealer tsumo pays all', tsumoPay(2, 20, true).all === 700 && tsumoPay(5, 30, true).all === 4000);

// The full Akagi quick-reference table (riichi-ref/Scoring_Table.png).
// Each cell: [han, fu, ron, tsumo] where non-dealer tsumo is [dealer pays, others pay],
// dealer tsumo is what each player pays, and null means the table lists no tsumo value.
const NON_DEALER = [
  [1, 30, 1000, [500, 300]], [1, 40, 1300, [700, 400]], [1, 50, 1600, [800, 400]], [1, 60, 2000, [1000, 500]],
  [1, 70, 2300, [1200, 600]], [1, 80, 2600, [1300, 700]], [1, 90, 2900, [1500, 800]], [1, 100, 3200, [1600, 800]],
  [1, 110, 3600, [1800, 900]],
  [2, 20, 1300, [700, 400]], [2, 25, 1600, null], [2, 30, 2000, [1000, 500]], [2, 40, 2600, [1300, 700]],
  [2, 50, 3200, [1600, 800]], [2, 60, 3900, [2000, 1000]], [2, 70, 4500, [2300, 1200]], [2, 80, 5200, [2600, 1300]],
  [2, 90, 5800, [2900, 1500]], [2, 100, 6400, [3200, 1600]], [2, 110, 7100, [3600, 1800]],
  [3, 20, 2600, [1300, 700]], [3, 25, 3200, [1600, 800]], [3, 30, 3900, [2000, 1000]], [3, 40, 5200, [2600, 1300]],
  [3, 50, 6400, [3200, 1600]], [3, 60, 7700, [3900, 2000]], [3, 70, 8000, [4000, 2000]],
  [4, 20, 5200, [2600, 1300]], [4, 25, 6400, [3200, 1600]], [4, 30, 7700, [3900, 2000]], [4, 40, 8000, [4000, 2000]],
  [5, 30, 8000, [4000, 2000]], [6, 30, 12000, [6000, 3000]], [7, 30, 12000, [6000, 3000]],
  [8, 30, 16000, [8000, 4000]], [10, 30, 16000, [8000, 4000]], [11, 30, 24000, [12000, 6000]],
  [12, 30, 24000, [12000, 6000]], [13, 30, 32000, [16000, 8000]],
];
const DEALER = [
  [1, 30, 1500, 500], [1, 40, 2000, 700], [1, 50, 2400, 800], [1, 60, 2900, 1000], [1, 70, 3400, 1200],
  [1, 80, 3900, 1300], [1, 90, 4400, 1500], [1, 100, 4800, 1600], [1, 110, 5300, 1800],
  [2, 20, 2000, 700], [2, 25, 2400, null], [2, 30, 2900, 1000], [2, 40, 3900, 1300], [2, 50, 4800, 1600],
  [2, 60, 5800, 2000], [2, 70, 6800, 2300], [2, 80, 7700, 2600], [2, 90, 8700, 2900], [2, 100, 9600, 3200],
  [2, 110, 10600, 3600],
  [3, 20, 3900, 1300], [3, 25, 4800, 1600], [3, 30, 5800, 2000], [3, 40, 7700, 2600], [3, 50, 9600, 3200],
  [3, 60, 11600, 3900], [3, 70, 12000, 4000],
  [4, 20, 7700, 2600], [4, 25, 9600, 3200], [4, 30, 11600, 3900], [4, 40, 12000, 4000],
  [5, 30, 12000, 4000], [6, 30, 18000, 6000], [8, 30, 24000, 8000], [11, 30, 36000, 12000], [13, 30, 48000, 16000],
];
const badCells = [];
for (const [han, fu, ronPts, t] of NON_DEALER) {
  const tp = tsumoPay(han, fu);
  if (ron(han, fu) !== ronPts || (t && (tp.dealer !== t[0] || tp.nonDealer !== t[1]))) badCells.push(`${han}/${fu}`);
}
for (const [han, fu, ronPts, all] of DEALER) {
  if (ron(han, fu, true) !== ronPts || (all && tsumoPay(han, fu, true).all !== all)) badCells.push(`dealer ${han}/${fu}`);
}
check(`every cell of the reference scoring table (${NON_DEALER.length + DEALER.length} cells)${badCells.length ? ` — wrong: ${badCells.join(', ')}` : ''}`, badCells.length === 0);

// --- Hands ---
// Non-dealer in the South seat, East round, no dora unless given.
function score(hand, win, { melds = [], ...ctx } = {}) {
  const meldTiles = melds.map(([type, tiles, open = true], i) => ({ type, open, tiles: parse(tiles, 3000 + i * 10) }));
  return scoreHand(parse(hand), parse(win, 2000)[0], meldTiles, {
    tsumo: false, dealer: false, seatWind: 1, roundWind: 0, doraIndicators: [], uraIndicators: [], ...ctx,
    doraIndicators: parse(ctx.dora ?? '', 4000), uraIndicators: parse(ctx.ura ?? '', 5000),
  });
}
const names = (s) => s.yaku.map((y) => y.name).sort().join(', ');
function hand(label, s, { yaku, han, fu, total }) {
  const ok = s && (yaku === undefined || names(s) === [...yaku].sort().join(', ')) &&
    (han === undefined || s.han === han) && (fu === undefined || s.fu === fu) && (total === undefined || s.total === total);
  check(`${label}${ok ? '' : ` — got ${s ? `[${names(s)}] ${s.han} han ${s.fu} fu ${s.total}` : 'null'}`}`, ok);
}

const PINFU = '123m456p789s23s55m'; // waits 1s/4s, two-sided

hand('pinfu ron: 1 han 30 fu', score(PINFU, '4s'), { yaku: ['Pinfu'], han: 1, fu: 30, total: 1000 });
hand('pinfu tsumo: 20 fu, no tsumo fu', score(PINFU, '4s', { tsumo: true }), { yaku: ['Pinfu', 'Menzen tsumo'], han: 2, fu: 20, total: 1500 });
hand('dealer pinfu ron', score(PINFU, '4s', { dealer: true, seatWind: 0 }), { han: 1, fu: 30, total: 1500 });
hand('dealer pinfu tsumo: 700 all', score(PINFU, '4s', { dealer: true, seatWind: 0, tsumo: true }), { han: 2, fu: 20, total: 2100 });
hand('tanyao pinfu', score('234m567p345s66p45s', '6s'), { yaku: ['Pinfu', 'Tanyao'], han: 2, fu: 30, total: 2000 });
hand('iipeikou pinfu tanyao', score('223344m567p34s88p', '5s'), { yaku: ['Iipeikou', 'Pinfu', 'Tanyao'], han: 3, fu: 30, total: 3900 });
hand('ryanpeikou beats the seven-pairs reading', score('223344m556677p8s', '8s'), { yaku: ['Ryanpeikou', 'Tanyao'], han: 4, fu: 40, total: 8000 });
hand('chiitoitsu ron: 25 fu', score('1199m2255p3377s4z', '4z'), { yaku: ['Chiitoitsu'], han: 2, fu: 25, total: 1600 });
hand('chiitoitsu tsumo', score('1199m2255p3377s4z', '4z', { tsumo: true }), { yaku: ['Chiitoitsu', 'Menzen tsumo'], han: 3, fu: 25, total: 3200 });
hand('toitoi sanankou, ron on a shanpon opens that triplet', score('111m333p555s33z44z', '4z'), { yaku: ['Sanankou', 'Toitoi'], han: 4, fu: 50, total: 8000 });
hand('closed sanshoku doujun, tanki', score('123m123p123s456m9p', '9p'), { yaku: ['Sanshoku doujun'], han: 2, fu: 40, total: 2600 });
hand('open sanshoku is 1 han and 30 fu', score('123m123p456m9p', '9p', { melds: [['chi', '123s']] }), { yaku: ['Sanshoku doujun'], han: 1, fu: 30, total: 1000 });
hand('ittsu honitsu seat-wind triplet: haneman', score('123456789m1122z', '2z'), { yaku: ['Honitsu', 'Ittsu', 'Yakuhai: seat wind (South)'], han: 6, total: 12000 });
hand('chanta with round wind', score('123m789p789s99m11z', '1z'), { yaku: ['Chanta', 'Yakuhai: round wind (East)'], han: 3, fu: 40, total: 5200 });
hand('junchan', score('123m789p789s123s9m', '9m'), { yaku: ['Junchan'], han: 3, fu: 40, total: 5200 });
const chin = score('123456789p1133p', '3p');
hand('chinitsu supersedes honitsu', chin, { total: 16000 });
check('chinitsu listed without honitsu', chin.yaku.some((y) => y.name === 'Chinitsu') && !chin.yaku.some((y) => y.name === 'Honitsu'));
hand('honroutou toitoi sanankou round wind', score('111m999p111s99s11z', '1z'), { yaku: ['Honroutou', 'Sanankou', 'Toitoi', 'Yakuhai: round wind (East)'], han: 7, total: 12000 });
hand('shousangen with two dragon triplets', score('555z666z77z123m45p', '6p'), { yaku: ['Shousangen', 'Yakuhai: Haku', 'Yakuhai: Hatsu'], han: 4, fu: 50, total: 8000 });
hand('open tanyao rounds 22 fu up to 30', score('345m678s66p34s', '5s', { melds: [['pon', '222p']] }), { yaku: ['Tanyao'], han: 1, fu: 30, total: 1000 });
hand('closed kan of honors: 70 fu', score('123m456p789s5p', '5p', { melds: [['kan', '1111z', false]] }), { yaku: ['Yakuhai: round wind (East)'], han: 1, fu: 70, total: 2300 });
hand('double wind pair is 4 fu', score('123m456p789s23s11z', '4s', { dealer: true, seatWind: 0, riichi: true }), { yaku: ['Riichi'], han: 1, fu: 40, total: 2000 });
hand('dora and red five', score('123m456p789s23s05m', '4s', { dora: '4m' }), { yaku: ['Pinfu'], han: 4, fu: 30, total: 7700 });
hand('riichi ippatsu ura dora', score(PINFU, '4s', { riichi: true, ippatsu: true, ura: '4m' }), { yaku: ['Ippatsu', 'Pinfu', 'Riichi'], han: 5, total: 8000 });
hand('ura dora need riichi', score(PINFU, '4s', { ura: '4m' }), { han: 1, total: 1000 });
hand('double riichi supersedes riichi', score(PINFU, '4s', { riichi: true, doubleRiichi: true }), { yaku: ['Double riichi', 'Pinfu'], han: 3 });
hand('haitei on the last tile', score(PINFU, '4s', { tsumo: true, haitei: true }), { yaku: ['Haitei raoyue', 'Menzen tsumo', 'Pinfu'], han: 3 });
hand('houtei on the last discard', score(PINFU, '4s', { houtei: true }), { yaku: ['Houtei raoyui', 'Pinfu'], han: 2 });
hand('the winning tile is read as a two-sided wait when that scores more', score('12345m678p456s99p', '3m'), { yaku: ['Pinfu'], fu: 30, total: 1000 });
hand('no yaku scores 0, and dora alone do not count', score('123m456p789s12s55m', '3s', { dora: '4m' }), { yaku: [], han: 0, total: 0 });
check('kokushi is not scored until yakuman exist', score('19m19p19s1234567z', '1m') === null);

// --- Compatibility (riichi-ref/yaku-compatibility.png) ---
const KAN_HAND = ['123m456p789s5p', '5p', { melds: [['kan', '1111z', false]] }]; // closed kan, tanki wait
const withKan = (ctx) => score(KAN_HAND[0], KAN_HAND[1], { ...KAN_HAND[2], ...ctx });
hand('rinshan after a kan', withKan({ tsumo: true, rinshan: true }), { yaku: ['Menzen tsumo', 'Rinshan kaihou', 'Yakuhai: round wind (East)'] });
hand('rinshan needs a kan', score(PINFU, '4s', { tsumo: true, rinshan: true }), { yaku: ['Menzen tsumo', 'Pinfu'] });
hand('ippatsu ✗ rinshan: the kan ends ippatsu', withKan({ tsumo: true, rinshan: true, riichi: true, ippatsu: true }),
  { yaku: ['Menzen tsumo', 'Riichi', 'Rinshan kaihou', 'Yakuhai: round wind (East)'] });
hand('rinshan ✗ haitei: the replacement tile is not the last wall tile', withKan({ tsumo: true, rinshan: true, haitei: true }),
  { yaku: ['Menzen tsumo', 'Rinshan kaihou', 'Yakuhai: round wind (East)'] });
hand('ippatsu ✗ houtei', score(PINFU, '4s', { riichi: true, ippatsu: true, houtei: true }), { yaku: ['Houtei raoyui', 'Pinfu', 'Riichi'] });
hand('ippatsu ✓ haitei', score(PINFU, '4s', { tsumo: true, riichi: true, ippatsu: true, haitei: true }),
  { yaku: ['Haitei raoyue', 'Ippatsu', 'Menzen tsumo', 'Pinfu', 'Riichi'] });
hand('chankan on a single copy of the tile', score(PINFU, '4s', { chankan: true }), { yaku: ['Chankan', 'Pinfu'] });
hand('chankan ✗ houtei', score(PINFU, '4s', { chankan: true, houtei: true }), { yaku: ['Chankan', 'Pinfu'] });
hand('chankan ✗ toitoi: a shanpon wait needs two copies in hand', score('111m333p555s33z44z', '4z', { chankan: true }), { yaku: ['Sanankou', 'Toitoi'] });
hand('chankan ✗ chiitoitsu', score('1199m2255p3377s4z', '4z', { chankan: true }), { yaku: ['Chiitoitsu'] });
hand('chankan ✗ ryanpeikou', score('223344m556677p8s', '8s', { chankan: true }), { yaku: ['Ryanpeikou', 'Tanyao'] });
hand('chankan ✓ iipeikou when the robbed tile is outside the pair of sequences', score('223344m567p34s88p', '5s', { chankan: true }),
  { yaku: ['Chankan', 'Iipeikou', 'Pinfu', 'Tanyao'] });

done();
