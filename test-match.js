// Run with: node test-match.js
import { newMatch, recordHand, handLabel, handSettings, ranking, normalizeSettings, DEFAULT_SETTINGS } from './match.js';
import { newHand, draw, discard, tsumo, claim, HONBA_POINTS } from './game.js';
import { parse, table, check, done } from './test-helpers.js';

// A finished hand as recordHand sees it: the result plus the scores and sticks after it.
const win = (winners, scores, sticks = 0) => ({ result: { type: 'ron', winners, deltas: [0, 0, 0, 0] }, scores, riichiSticks: sticks });
const drawHand = (tenpai, scores, sticks = 0) => ({ result: { type: 'exhaustiveDraw', tenpai, deltas: [0, 0, 0, 0] }, scores, riichiSticks: sticks });
const even = [25000, 25000, 25000, 25000];

check('settings keep only valid values', JSON.stringify(normalizeSettings({ length: 'north', bust: 'yes', extension: false, extra: 1 })) ===
  JSON.stringify({ ...DEFAULT_SETTINGS, extension: false }));

{
  const m = newMatch();
  check('a match starts at East 1 with the first seat dealing', handLabel(m) === 'East 1' && m.dealer === 0 && m.honba === 0 && m.scores.join() === '25000,25000,25000,25000');
  recordHand(m, win([2], even));
  check('a non-dealer win passes the deal on', handLabel(m) === 'East 2' && m.dealer === 1 && m.honba === 0);
  recordHand(m, win([1], even));
  check('a dealer win repeats the deal and adds a honba', handLabel(m) === 'East 2' && m.dealer === 1 && m.honba === 1);
  recordHand(m, drawHand([1], even));
  check('the dealer tenpai at a draw repeats, with another honba', handLabel(m) === 'East 2' && m.honba === 2);
  recordHand(m, drawHand([0, 2], even));
  check('a draw with the dealer noten passes the deal on but still adds a honba', handLabel(m) === 'East 3' && m.dealer === 2 && m.honba === 3);
  recordHand(m, win([0], even));
  check('a non-dealer win resets honba', handLabel(m) === 'East 4' && m.honba === 0);
  recordHand(m, win([0], even));
  check('after East 4 the round wind advances: South 1, dealt by the first seat again', handLabel(m) === 'South 1' && m.dealer === 0);
  check('handSettings is what newHand needs', JSON.stringify(handSettings(m)) === JSON.stringify({ dealer: 0, roundWind: 1, scores: even, riichiSticks: 0, honba: 0, rules: { yakuRebalance: false } }));
}

{
  const m = newMatch({ length: 'south' });
  for (let i = 0; i < 7; i++) recordHand(m, win([(m.dealer + 1) % 4], even));
  check('a dealer win in a double ron repeats too', (() => { recordHand(m, win([(m.dealer + 1) % 4, m.dealer], even)); return m.dealer === 3 && m.honba === 1; })());
  recordHand(m, win([0], [31000, 25000, 25000, 19000], 2));
  check('South 4 ends a hanchan when someone has 30000; leftover sticks go to first place',
    m.over && m.final.reason === 'last hand' && m.final.ranking[0].seat === 0 && m.final.ranking[0].score === 33000);
}

{
  const m = newMatch({ length: 'east' });
  for (let i = 0; i < 3; i++) recordHand(m, win([(m.dealer + 1) % 4], even));
  recordHand(m, win([0], [29000, 25000, 25000, 21000]));
  check('an East match with nobody at 30000 goes into South (sudden death)', !m.over && handLabel(m) === 'South 1');
  recordHand(m, win([1], [29000, 30000, 25000, 16000]));
  check('the extension ends as soon as someone has 30000', m.over && m.final.reason === 'target reached' && m.final.ranking[0].seat === 1);
}

{
  const m = newMatch({ length: 'east', extension: false });
  for (let i = 0; i < 3; i++) recordHand(m, win([(m.dealer + 1) % 4], even));
  recordHand(m, win([0], [29000, 25000, 25000, 21000]));
  check('without extension, East 4 ends an East match regardless of 30000', m.over && m.final.reason === 'last hand');
}

{
  const m = newMatch({ length: 'east' });
  for (let i = 0; i < 7; i++) recordHand(m, win([(m.dealer + 1) % 4], even));
  check('the extension lasts one wind: South 4 still to play', !m.over && handLabel(m) === 'South 4');
  recordHand(m, win([0], even));
  check('and after it the match is over even below 30000', m.over && m.final.reason === 'extension over');
}

{
  // East 4: seat 3 deals.
  const setup = (settings) => {
    const m = newMatch({ length: 'east', ...settings });
    for (let i = 0; i < 3; i++) recordHand(m, win([(m.dealer + 1) % 4], even));
    return m;
  };
  const m = setup({});
  recordHand(m, win([3], [20000, 25000, 20000, 35000]));
  check('agari-yame: the last dealer repeating in first place with 30000 ends the match', m.over && m.final.reason === 'agari-yame');
  const off = setup({ agariYame: false });
  recordHand(off, win([3], [20000, 25000, 20000, 35000]));
  check('without agari-yame the last dealer keeps dealing', !off.over && handLabel(off) === 'East 4' && off.honba === 1);
  const notTop = setup({});
  recordHand(notTop, win([3], [40000, 25000, 5000, 30000]));
  check('a last dealer repeating but not in first place keeps dealing', !notTop.over && notTop.honba === 1);
}

{
  const m = newMatch();
  recordHand(m, win([1], [-100, 50100, 25000, 25000]));
  check('bust: the match ends as soon as someone is below 0', m.over && m.final.reason === 'bust');
  const off = newMatch({ bust: false });
  recordHand(off, win([1], [-100, 50100, 25000, 25000]));
  check('without bust it goes on', !off.over);
}

{
  const m = newMatch();
  m.scores = [30000, 20000, 30000, 20000];
  check('equal scores rank by turn order from the starting dealer', ranking(m).join() === '0,2,1,3');
}

// --- Honba in the game ---
{
  // Seat 1 rons seat 0's 4s with pinfu (1000) at 2 honba: seat 0 pays 1000 + 600.
  const s = table({ hands: { 1: '123m456p789s23s55m' }, drawn: '4s' });
  s.honba = 2;
  s.doraIndicators = [];
  discard(s, s.players[0].drawn.id);
  claim(s, 1, 'ron');
  check('honba on a ron: the discarder pays 300 each', s.result.honbaBonus === 2 * HONBA_POINTS &&
    s.result.deltas.join() === '-1600,1600,0,0');
}

{
  // Seat 0 (dealer) tsumos at 1 honba, not on its first draw: each other player pays 100 more.
  const s = table({ hands: { 0: '123m456p789s23s55m' }, drawn: '4s' });
  s.players[0].discards = parse('9p', 1950);
  s.honba = 1;
  s.doraIndicators = [];
  tsumo(s, 0);
  const base = s.result.scores[0].payment.all;
  check('honba on a tsumo: 100 each from the other three', s.result.deltas.join() === [3 * (base + 100), -(base + 100), -(base + 100), -(base + 100)].join());
}

{
  // Real hands through a whole match (everyone discards their draw, so mostly draws with
  // nobody tenpai): the dealer and honba are carried into newHand each time.
  const m = newMatch();
  let ok = true;
  let hands = 0;
  for (; hands < 40 && !m.over; hands++) {
    const s = newHand(handSettings(m));
    ok &&= s.dealer === m.dealer && s.honba === m.honba && s.current === m.dealer;
    while (s.phase !== 'ended') {
      if (s.phase === 'discard') discard(s, s.players[s.current].drawn.id);
      for (const seat of Object.keys(s.claims)) claim(s, Number(seat), 'pass');
      draw(s);
    }
    recordHand(m, s);
    ok &&= m.scores.reduce((a, b) => a + b) + m.riichiSticks * 1000 === 100000;
  }
  check(`real hands carry dealer, honba and scores through a whole match (${hands} hands, ended: ${m.final?.reason})`, ok && m.over);
}

done();
