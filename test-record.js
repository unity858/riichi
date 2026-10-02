// Run with: node test-record.js
// Recording and replaying hands: random hands are played out, then rebuilt from their seed and
// their action log (state.log), and must end exactly the same way.
import {
  newHand, createTiles, draw, discard, claim, tsumo, canTsumo, canRon, canKyuushu, declareKyuushu,
  declareRiichi, riichiDiscards, declareKan, kanOptions, ponOptions, chiiOptions, openKanOptions,
  autoDiscardDue, tileCode, checkIntegrity,
} from './game.js';
import { seedFromWall } from './seed.js';
import { replayHand, replaySteps } from './replay.js';
import { check, done } from './test-helpers.js';

// A small seeded random number generator (mulberry32), so failures can be repeated.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

// The tile that helps the hand least: fewest copies and neighbors of it (ties at random), so
// hands get to tenpai and win often enough to test wins.
function weakestTile(r, tiles) {
  const worth = (t) => tiles.reduce((sum, u) => {
    if (u === t || u.suit !== t.suit) return sum;
    const gap = Math.abs(u.rank - t.rank);
    return sum + (gap === 0 ? 3 : t.suit !== 'z' && gap <= 2 ? 3 - gap : 0);
  }, 0);
  const scored = tiles.map((t) => ({ t, w: worth(t) + r() * 0.5 }));
  return scored.reduce((a, b) => (b.w < a.w ? b : a)).t;
}

// Plays a hand with random but legal choices, leaning towards calls, kans and riichi so every
// kind of action shows up.
function playRandomHand(seed, start) {
  const r = rng(seed);
  const wall = createTiles();
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  const s = newHand({ ...start, wall });
  for (let steps = 0; s.phase !== 'ended' && steps < 1000; steps++) {
    if (s.phase === 'draw' || s.phase === 'rinshan') {
      draw(s);
    } else if (s.phase === 'claim') {
      for (const seat of Object.keys(s.claims).map(Number)) {
        if (s.claims[seat] !== null || s.phase !== 'claim') continue;
        if (canRon(s, seat) && r() < 0.8) claim(s, seat, 'ron');
        else if (openKanOptions(s, seat).length && r() < 0.5) claim(s, seat, 'kan', openKanOptions(s, seat)[0]);
        else if (ponOptions(s, seat).length && r() < 0.4) claim(s, seat, 'pon', pick(r, ponOptions(s, seat)));
        else if (chiiOptions(s, seat).length && r() < 0.4) claim(s, seat, 'chii', pick(r, chiiOptions(s, seat)));
        else claim(s, seat, 'pass');
      }
    } else {
      const seat = s.current;
      const p = s.players[seat];
      if (canTsumo(s, seat) && r() < 0.8) tsumo(s, seat);
      else if (canKyuushu(s, seat) && r() < 0.5) declareKyuushu(s, seat);
      else if (kanOptions(s, seat).length && r() < 0.5) declareKan(s, seat, pick(r, kanOptions(s, seat)).kind);
      else if (riichiDiscards(s, seat).length && r() < 0.6) declareRiichi(s, seat, pick(r, riichiDiscards(s, seat)));
      else if (autoDiscardDue(s) || p.riichi) discard(s, p.drawn.id);
      else {
        const tiles = [...p.hand, ...(p.drawn ? [p.drawn] : [])]; // after a call there is no draw
        discard(s, (r() < 0.15 ? pick(r, tiles) : weakestTile(r, tiles)).id);
      }
    }
  }
  return { s, seed: seedFromWall(wall) };
}

// What must come out the same: the result, scores, ponds, melds and hands. Tiles are compared
// by kind and look (seed notation): a seed records which tile is where, not the server's ids
// for identical copies.
const asCodes = (key, value) => (value && typeof value === 'object' && 'suit' in value && 'rank' in value ? tileCode(value) : value);
const summary = (s) => JSON.stringify({
  phase: s.phase,
  result: s.result,
  scores: s.scores,
  riichiSticks: s.riichiSticks,
  players: s.players.map((p) => ({
    hand: p.hand.map(tileCode),
    discards: p.discards.map(tileCode),
    called: p.called,
    melds: p.melds.map((m) => [m.type, m.kanType, m.tiles.map(tileCode)]),
    riichi: p.riichi,
  })),
  dora: s.doraIndicators.map(tileCode),
}, asCodes);

{
  const types = new Map();
  const results = new Map();
  let mismatches = 0;
  let errors = 0;
  let firstProblem = null;
  const HANDS = 600;
  for (let i = 0; i < HANDS; i++) {
    // Vary the dealer, round, honba, sticks and the yaku rebalance.
    const start = {
      dealer: i % 4, roundWind: i % 2, scores: [25000, 25000, 25000, 25000], riichiSticks: i % 3, honba: i % 2,
      rules: { yakuRebalance: i % 5 === 0 },
    };
    const { s, seed } = playRandomHand(1000 + i, start);
    for (const a of s.log) types.set(a.type, (types.get(a.type) ?? 0) + 1);
    results.set(s.result?.type ?? s.phase, (results.get(s.result?.type ?? s.phase) ?? 0) + 1);
    try {
      const replayed = replayHand({ seed, ...start }, s.log);
      if (summary(replayed) !== summary(s) || !checkIntegrity(replayed)) {
        mismatches++;
        firstProblem ??= `hand ${1000 + i}: replay differs`;
      }
    } catch (err) {
      errors++;
      firstProblem ??= `hand ${1000 + i}: ${err.message}`;
    }
  }
  const counts = (m) => [...m].map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`  actions: ${counts(types)}`);
  console.log(`  results: ${counts(results)}`);
  check(`${HANDS} random hands replay exactly from their seed and actions${firstProblem ? ` (first problem: ${firstProblem})` : ''}`,
    mismatches === 0 && errors === 0);
  check('and they cover every kind of action',
    ['discard', 'chii', 'pon', 'kan', 'ankan', 'kakan', 'ron', 'tsumo', 'kyuushu'].every((t) => types.get(t) > 0));
}

{
  // Stepping through hands, as the replay page does: the start, each draw, each action, and an
  // end step if the last discard was still open. Every step can be reached on its own, and the
  // last is the hand's end.
  let problems = 0;
  let steps = 0;
  let first = null;
  for (let i = 0; i < 60; i++) {
    const start = { dealer: i % 4, roundWind: 0, scores: [25000, 25000, 25000, 25000], riichiSticks: 0, honba: 0, rules: {} };
    const { s, seed } = playRandomHand(5000 + i, start);
    const hand = { seed, ...start };
    const full = replaySteps(hand, s.log);
    const draws = full.steps.filter((t) => t.type === 'draw').length;
    const ends = full.steps.filter((t) => t.type === 'end').length;
    const shape = full.steps[0].type === 'start' && full.steps.length === 1 + draws + s.log.length + ends && ends <= 1 &&
      summary(full.state) === summary(s) && full.state.phase === 'ended';
    if (!shape) {
      problems++;
      first ??= `hand ${5000 + i}: ${full.steps.length} steps, ended ${full.state.phase}`;
    }
    for (let k = 0; k < full.steps.length; k++) {
      steps++;
      const at = replaySteps(hand, s.log, k);
      const actionsSoFar = full.steps.slice(0, k + 1).filter((t) => !['start', 'draw', 'end'].includes(t.type)).length;
      const same = at.steps.length === k + 1 && JSON.stringify(at.steps) === JSON.stringify(full.steps.slice(0, k + 1)) &&
        at.state.log.length === actionsSoFar && (full.steps[k].type !== 'draw' || !!at.state.players[full.steps[k].seat].drawn);
      if (!same) {
        problems++;
        first ??= `hand ${5000 + i}, step ${k} (${full.steps[k].type})`;
      }
    }
  }
  check(`stepping through 60 hands (${steps} steps, draws and actions): every step reached on its own, the last the hand's end${first ? ` (first problem: ${first})` : ''}`,
    problems === 0);
}

{
  // An unfinished hand (say the server stopped mid-hand) replays up to its last action.
  const { s, seed } = playRandomHand(7, { dealer: 0 });
  const half = s.log.slice(0, Math.floor(s.log.length / 2));
  const partial = replayHand({ seed, dealer: 0 }, half);
  check('a hand cut off mid-way replays up to where it stopped', partial.log.length === half.length &&
    JSON.stringify(partial.log) === JSON.stringify(half) && checkIntegrity(partial));
}

{
  const { seed } = playRandomHand(8, { dealer: 0 });
  let threw = false;
  try {
    replayHand({ seed, dealer: 0 }, [{ type: 'discard', seat: 2, tile: '5m', tsumogiri: false, riichi: false }]);
  } catch {
    threw = true;
  }
  check('an action that doesn\'t fit (seat 2 discarding on the dealer\'s turn) is reported', threw);
}

done();
