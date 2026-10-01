// Run with: node test-yakuman.js
import fs from 'node:fs';
import { scoreHand } from './scoring.js';
import { newHand, draw, discard, tsumo, claim, chiiOptions, tileLabel } from './game.js';
import { wallFromSeed } from './seed.js';
import { parse, table, check, done } from './test-helpers.js';

// Non-dealer in the South seat, East round, ron unless given.
function score(hand, win, { melds = [], ...ctx } = {}) {
  const meldTiles = melds.map(([type, tiles, open = true], i) => ({ type, open, tiles: parse(tiles, 3000 + i * 10) }));
  return scoreHand(parse(hand), parse(win, 2000)[0], meldTiles, {
    tsumo: false, dealer: false, seatWind: 1, roundWind: 0, ...ctx,
    doraIndicators: parse(ctx.dora ?? '', 4000), uraIndicators: [],
  });
}
const names = (s) => s.yaku.map((y) => y.name).sort().join(', ');
function yakuman(label, s, { yaku, count, total }) {
  const ok = s && s.yakuman === count && names(s) === [...yaku].sort().join(', ') && (total === undefined || s.total === total);
  check(`${label}${ok ? '' : ` — got ${s ? `[${names(s)}] x${s.yakuman} ${s.total}` : 'null'}`}`, ok);
}

// Single yakuman: 32000 from a non-dealer ron.
yakuman('kokushi musou, single wait', score('19m19p19s1234566z', '7z'), { yaku: ['Kokushi musou'], count: 1, total: 32000 });
yakuman('kokushi 13-sided wait is a double yakuman', score('19m19p19s1234567z', '1m'), { yaku: ['Kokushi musou (13-sided wait)'], count: 2, total: 64000 });
yakuman('suuankou on a single wait (tanki) is a double yakuman', score('111m333p555s777s9m', '9m'), { yaku: ['Suuankou tanki (single wait)'], count: 2, total: 64000 });
yakuman('suuankou by tsumo on a shanpon', score('111m333p555s77s99m', '7s', { tsumo: true }), { yaku: ['Suuankou'], count: 1, total: 32000 });
{
  const s = score('111m333p555s77s99m', '7s');
  check('a shanpon ron is not suuankou: that triplet counts as open (toitoi + sanankou instead)',
    !s.yakuman && names(s) === 'Sanankou, Toitoi');
}
yakuman('daisangen', score('555z666z777z123m4p', '4p'), { yaku: ['Daisangen'], count: 1, total: 32000 });
yakuman('daisangen with open pons', score('123m4p', '4p', { melds: [['pon', '555z'], ['pon', '666z'], ['pon', '777z']] }),
  { yaku: ['Daisangen'], count: 1, total: 32000 });
yakuman('shousuushi', score('111z222z333z44z12m', '3m'), { yaku: ['Shousuushi'], count: 1, total: 32000 });
yakuman('tsuuiisou as seven pairs', score('1122334455667z', '7z'), { yaku: ['Tsuuiisou'], count: 1, total: 32000 });
yakuman('ryuuiisou', score('223344s666s888s6z', '6z'), { yaku: ['Ryuuiisou'], count: 1, total: 32000 });
yakuman('chuuren poutou', score('1113345678999m', '2m'), { yaku: ['Chuuren poutou'], count: 1, total: 32000 });
yakuman('9-sided chuuren is a double yakuman', score('1112345678999m', '5m'), { yaku: ['Junsei chuuren poutou (9-sided wait)'], count: 2, total: 64000 });
yakuman('suukantsu', score('5p', '5p', { melds: [['kan', '1111m'], ['kan', '2222p'], ['kan', '3333s'], ['kan', '9999m']] }),
  { yaku: ['Suukantsu'], count: 1, total: 32000 });

// Yakuman stack.
yakuman('daisangen + tsuuiisou + suuankou tanki stack to a quadruple yakuman', score('555z666z777z111z2z', '2z'),
  { yaku: ['Daisangen', 'Suuankou tanki (single wait)', 'Tsuuiisou'], count: 4, total: 128000 });
yakuman('daisuushi supersedes shousuushi, and stacks with suuankou tanki', score('111z222z333z444z5m', '5m'),
  { yaku: ['Daisuushi', 'Suuankou tanki (single wait)'], count: 4, total: 128000 });
yakuman('daisuushi is a double yakuman', score('444z5m', '5m', { melds: [['pon', '111z'], ['pon', '222z'], ['pon', '333z']] }),
  { yaku: ['Daisuushi'], count: 2, total: 64000 });
yakuman('chinroutou + suuankou tanki', score('111m999m111p999p1s', '1s'), { yaku: ['Chinroutou', 'Suuankou tanki (single wait)'], count: 3, total: 96000 });

// Payments, and what doesn't count.
yakuman('tenhou: dealer tsumo on the first draw, 16000 all', score('123m456p789s23s55m', '4s', { tsumo: true, dealer: true, seatWind: 0, tenhou: true }),
  { yaku: ['Tenhou'], count: 1, total: 48000 });
yakuman('chiihou: non-dealer tsumo on the first draw, 8000/16000', score('123m456p789s23s55m', '4s', { tsumo: true, chiihou: true }),
  { yaku: ['Chiihou'], count: 1, total: 32000 });
yakuman('tenhou + 13-sided kokushi: triple yakuman, 48000 all', score('19m19p19s1234567z', '1m', { tsumo: true, dealer: true, seatWind: 0, tenhou: true }),
  { yaku: ['Kokushi musou (13-sided wait)', 'Tenhou'], count: 3, total: 144000 });
yakuman('dealer ron on a yakuman is 48000', score('555z666z777z123m4p', '4p', { dealer: true, seatWind: 0 }), { yaku: ['Daisangen'], count: 1, total: 48000 });
{
  const s = score('555z666z777z123m4p', '4p', { dora: '3m', riichi: true });
  check('dora and other yaku are not added to a yakuman', s.yakuman === 1 && s.total === 32000 && names(s) === 'Daisangen' && s.han === null);
}
check('tenhou and chiihou need a tsumo', !score('123m456p789s23s55m', '4s', { tenhou: true }).yakuman);
check('a normal hand is unaffected', score('123m456p789s23s55m', '4s').yakuman === undefined);

// --- In the game ---
{
  // seeds/tenhou.txt: the dealer is dealt a complete hand.
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/tenhou.txt', 'utf8')) });
  tsumo(s, 0);
  const [sc] = s.result.scores;
  check('seeds/tenhou.txt scores tenhou: 16000 all', names(sc) === 'Tenhou' && sc.yakuman === 1 &&
    sc.payment.all === 16000 && s.result.deltas.join() === '48000,-16000,-16000,-16000');
}

{
  // seeds/kokushi-turn2.txt: tenpai on turn 1, tsumo on turn 2. Not the first draw, so no tenhou.
  const s = newHand({ wall: wallFromSeed(fs.readFileSync('seeds/kokushi-turn2.txt', 'utf8')) });
  const east = s.players[0];
  discard(s, [...east.hand, east.drawn].find((t) => t.suit === 'm' && t.rank === 5).id);
  for (let i = 0; i < 3; i++) {
    draw(s);
    discard(s, s.players[s.current].drawn.id);
  }
  draw(s);
  tsumo(s, 0);
  const [sc] = s.result.scores;
  check('seeds/kokushi-turn2.txt scores kokushi (single wait) without tenhou: 16000 all',
    names(sc) === 'Kokushi musou' && sc.yakuman === 1 && s.result.deltas[0] === 48000);
}

{
  // Seat 1 is dealt a complete hand and wins on its first draw: chiihou.
  const s = table({ hands: { 1: '123m456p789s23s55m' }, drawn: '9m' });
  discard(s, s.players[0].drawn.id);
  s.wall[0] = parse('4s', 6000)[0];
  draw(s);
  tsumo(s, 1);
  check('a non-dealer tsumo on the first draw is chiihou', names(s.result.scores[0]) === 'Chiihou');
}

{
  // The same, but seat 0's first discard was called (chii) by seat 1 before seat 2's first draw.
  const s = table({ hands: { 1: '78m123p456p789s12z', 2: '123m456p789s23s55m' }, drawn: '9m' });
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'chii', chiiOptions(s, 1)[0]);
  discard(s, s.players[1].hand.find((t) => t.suit === 'z').id);
  s.wall[0] = parse('4s', 6000)[0];
  draw(s);
  tsumo(s, 2);
  check('no chiihou after a call', !s.result.scores[0].yakuman);
}

done();
