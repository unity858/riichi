// Hand scoring: yaku, han, fu and points. No game state here.
// Tile kinds use game.js's indexing: m1-9 = 0-8, p1-9 = 9-17, s1-9 = 18-26,
// winds E S W N = 27-30, dragons Haku Hatsu Chun = 31-33. Yakuman are not scored yet.

const SUITS = ['m', 'p', 's', 'z'];
const WIND_NAMES = ['East', 'South', 'West', 'North'];
const DRAGON_NAMES = ['Haku', 'Hatsu', 'Chun'];

const kindOf = (tile) => SUITS.indexOf(tile.suit) * 9 + tile.rank - 1;
const isHonor = (k) => k >= 27;
const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);
const isTerminalOrHonor = (k) => isHonor(k) || isTerminal(k);
const isDragon = (k) => k >= 31;

// The tile kind an indicator makes dora: the next one in its suit, winds and dragons wrapping.
function doraFromIndicator(k) {
  if (k < 27) return Math.floor(k / 9) * 9 + ((k % 9) + 1) % 9;
  if (k < 31) return 27 + ((k - 27 + 1) % 4);
  return 31 + ((k - 31 + 1) % 3);
}

// --- Points ---

// Basic points before the ron/tsumo multipliers.
export function basicPoints(han, fu) {
  if (han >= 13) return 8000; // kazoe yakuman
  if (han >= 11) return 6000; // sanbaiman
  if (han >= 8) return 4000; // baiman
  if (han >= 6) return 3000; // haneman
  if (han >= 5) return 2000; // mangan
  return Math.min(fu * 2 ** (2 + han), 2000); // mangan cap for high-fu 3 and 4 han hands
}

const LIMIT_NAMES = { 2000: 'Mangan', 3000: 'Haneman', 4000: 'Baiman', 6000: 'Sanbaiman', 8000: 'Kazoe yakuman' };
const roundUp100 = (x) => Math.ceil(x / 100) * 100;

// What each payer pays. Ron: the discarder pays `ron`. Tsumo: a dealer win is `all` from
// each player; a non-dealer win is `dealer` from the dealer and `nonDealer` from the others.
export function payments(basic, { dealer, tsumo }) {
  if (!tsumo) return { ron: roundUp100(basic * (dealer ? 6 : 4)) };
  if (dealer) return { all: roundUp100(basic * 2) };
  return { dealer: roundUp100(basic * 2), nonDealer: roundUp100(basic) };
}

// Point changes per seat for one winner's score. from is the discarder for ron.
export function pointDeltas(score, { winner, dealer, from, tsumo }) {
  const deltas = [0, 0, 0, 0];
  for (let seat = 0; seat < 4; seat++) {
    if (seat === winner) continue;
    let pay = 0;
    if (!tsumo) pay = seat === from ? score.payment.ron : 0;
    else if (winner === dealer) pay = score.payment.all;
    else pay = seat === dealer ? score.payment.dealer : score.payment.nonDealer;
    deltas[seat] -= pay;
    deltas[winner] += pay;
  }
  return deltas;
}

// --- Hand readings ---

// Every way to split counts into sets. Each set is { type: 'seq' | 'trip', k } (k = lowest kind).
function splitIntoSets(counts) {
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return [[]];
  const splits = [];
  if (counts[i] >= 3) {
    counts[i] -= 3;
    for (const rest of splitIntoSets(counts)) splits.push([{ type: 'trip', k: i }, ...rest]);
    counts[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    for (const rest of splitIntoSets(counts)) splits.push([{ type: 'seq', k: i }, ...rest]);
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  return splits;
}

// The wait a sequence gave when completed by kind w.
function sequenceWait(k, w) {
  const offset = w - k;
  if (offset === 1) return 'kanchan';
  if ((offset === 2 && k % 9 === 0) || (offset === 0 && k % 9 === 6)) return 'penchan';
  return 'ryanmen';
}

// All readings of a complete hand: the pair, the sets (closed ones from the hand plus the
// melds), and which group the winning tile completed, since that decides the wait.
function readings(closedCounts, winKind, meldSets) {
  const result = [];
  for (let pair = 0; pair < 34; pair++) {
    if (closedCounts[pair] < 2) continue;
    closedCounts[pair] -= 2;
    for (const split of splitIntoSets(closedCounts)) {
      const closedSets = split.map((s) => ({ ...s, open: false }));
      const sets = [...closedSets, ...meldSets];
      if (pair === winKind) result.push({ pair, sets, wait: 'tanki', winSet: null });
      closedSets.forEach((s, idx) => {
        if (s.type === 'trip' && s.k === winKind) result.push({ pair, sets, wait: 'shanpon', winSet: idx });
        if (s.type === 'seq' && winKind >= s.k && winKind <= s.k + 2) {
          result.push({ pair, sets, wait: sequenceWait(s.k, winKind), winSet: idx });
        }
      });
    }
    closedCounts[pair] += 2;
  }
  return result;
}

// --- Yaku and fu for one reading ---

function yakuhaiKinds(ctx) {
  return { seat: 27 + ctx.seatWind, round: 27 + ctx.roundWind };
}

// Riichi and conditional yaku apply to every reading. The pairings the riichi wiki's
// compatibility table marks incompatible are enforced here even if ctx sets both flags:
//   - rinshan needs a kan, and its replacement tile is never the haitei tile;
//   - ippatsu can't combine with rinshan (the kan ends it) or houtei (riichi needs 4 wall
//     tiles left, so the next draw comes first);
//   - chankan robs an added kan, not a discard, so it is never houtei; and three copies of
//     the tile are in the kan, so the robbed tile must be the only one in the hand (which
//     rules out toitoi, honroutou, chiitoitsu, ryanpeikou and pair/triplet waits).
function situationalYaku(ctx, closed, { hasKan, winKindCount }) {
  const rinshan = ctx.rinshan && ctx.tsumo && hasKan;
  const chankan = ctx.chankan && !ctx.tsumo && winKindCount === 1;
  const yaku = [];
  if (ctx.doubleRiichi) yaku.push({ name: 'Double riichi', han: 2 });
  else if (ctx.riichi) yaku.push({ name: 'Riichi', han: 1 });
  if ((ctx.riichi || ctx.doubleRiichi) && ctx.ippatsu && !rinshan && !ctx.houtei) yaku.push({ name: 'Ippatsu', han: 1 });
  if (closed && ctx.tsumo) yaku.push({ name: 'Menzen tsumo', han: 1 });
  if (ctx.haitei && ctx.tsumo && !rinshan) yaku.push({ name: 'Haitei raoyue', han: 1 });
  if (ctx.houtei && !ctx.tsumo && !chankan) yaku.push({ name: 'Houtei raoyui', han: 1 });
  if (rinshan) yaku.push({ name: 'Rinshan kaihou', han: 1 });
  if (chankan) yaku.push({ name: 'Chankan', han: 1 });
  return yaku;
}

// Yaku that depend on the tiles alone, shared by the standard and seven-pairs readings.
function tileYaku(kinds, closed) {
  const yaku = [];
  if (kinds.every((k) => !isTerminalOrHonor(k))) yaku.push({ name: 'Tanyao', han: 1 });
  if (kinds.every(isTerminalOrHonor)) yaku.push({ name: 'Honroutou', han: 2 });
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map((k) => Math.floor(k / 9)));
  if (suits.size === 1) {
    // Chinitsu supersedes honitsu.
    if (kinds.some(isHonor)) yaku.push({ name: 'Honitsu', han: closed ? 3 : 2 });
    else yaku.push({ name: 'Chinitsu', han: closed ? 6 : 5 });
  }
  return yaku;
}

function isPinfu(reading, ctx, closed) {
  const { seat, round } = yakuhaiKinds(ctx);
  const { pair, sets, wait } = reading;
  return closed && sets.every((s) => s.type === 'seq') && wait === 'ryanmen' &&
    !isDragon(pair) && pair !== seat && pair !== round;
}

function standardYaku(reading, ctx, closed, kinds) {
  const { pair, sets } = reading;
  const { seat, round } = yakuhaiKinds(ctx);
  const seqs = sets.filter((s) => s.type === 'seq');
  const trips = sets.filter((s) => s.type !== 'seq'); // triplets and kans
  const has = (type, k) => sets.some((s) => (type === 'seq' ? s.type === 'seq' : s.type !== 'seq') && s.k === k);
  const yaku = [];

  if (isPinfu(reading, ctx, closed)) yaku.push({ name: 'Pinfu', han: 1 });

  for (const t of trips) {
    if (isDragon(t.k)) yaku.push({ name: `Yakuhai: ${DRAGON_NAMES[t.k - 31]}`, han: 1 });
    if (t.k === seat) yaku.push({ name: `Yakuhai: seat wind (${WIND_NAMES[ctx.seatWind]})`, han: 1 });
    if (t.k === round) yaku.push({ name: `Yakuhai: round wind (${WIND_NAMES[ctx.roundWind]})`, han: 1 });
  }

  // Ryanpeikou supersedes iipeikou. Both are closed only.
  if (closed) {
    const bySeq = {};
    for (const s of seqs) bySeq[s.k] = (bySeq[s.k] ?? 0) + 1;
    const pairsOfSeqs = Object.values(bySeq).reduce((n, c) => n + Math.floor(c / 2), 0);
    if (pairsOfSeqs === 2) yaku.push({ name: 'Ryanpeikou', han: 3 });
    else if (pairsOfSeqs === 1) yaku.push({ name: 'Iipeikou', han: 1 });
  }

  for (let r = 0; r < 7; r++) {
    if (has('seq', r) && has('seq', 9 + r) && has('seq', 18 + r)) {
      yaku.push({ name: 'Sanshoku doujun', han: closed ? 2 : 1 });
      break;
    }
  }
  for (let suit = 0; suit < 3; suit++) {
    if (has('seq', suit * 9) && has('seq', suit * 9 + 3) && has('seq', suit * 9 + 6)) {
      yaku.push({ name: 'Ittsu', han: closed ? 2 : 1 });
      break;
    }
  }

  // Chanta/junchan need a sequence; without one the hand is honroutou instead.
  // Junchan (no honors) supersedes chanta.
  const setHasTerminalOrHonor = (s) => (s.type === 'seq' ? s.k % 9 === 0 || s.k % 9 === 6 : isTerminalOrHonor(s.k));
  if (seqs.length > 0 && isTerminalOrHonor(pair) && sets.every(setHasTerminalOrHonor)) {
    if (kinds.some(isHonor)) yaku.push({ name: 'Chanta', han: closed ? 2 : 1 });
    else yaku.push({ name: 'Junchan', han: closed ? 3 : 2 });
  }

  if (trips.length === 4) yaku.push({ name: 'Toitoi', han: 2 });
  // A triplet completed by ron counts as open.
  const concealed = trips.filter((t) => !t.open && !(!ctx.tsumo && sets.indexOf(t) === reading.winSet));
  if (concealed.length >= 3) yaku.push({ name: 'Sanankou', han: 2 });
  for (let r = 0; r < 9; r++) {
    if (has('trip', r) && has('trip', 9 + r) && has('trip', 18 + r)) {
      yaku.push({ name: 'Sanshoku doukou', han: 2 });
      break;
    }
  }
  if (sets.filter((s) => s.type === 'kan').length === 3) yaku.push({ name: 'Sankantsu', han: 2 });
  if (trips.filter((t) => isDragon(t.k)).length === 2 && isDragon(pair)) yaku.push({ name: 'Shousangen', han: 2 });

  return [...yaku, ...tileYaku(kinds, closed)];
}

function standardFu(reading, ctx, closed, pinfu) {
  if (pinfu) return ctx.tsumo ? 20 : 30;
  const { seat, round } = yakuhaiKinds(ctx);
  let fu = 20;
  if (closed && !ctx.tsumo) fu += 10;
  if (ctx.tsumo) fu += 2;
  reading.sets.forEach((s, idx) => {
    if (s.type === 'seq') return;
    const concealed = !s.open && !(!ctx.tsumo && idx === reading.winSet);
    let setFu = isTerminalOrHonor(s.k) ? 4 : 2;
    if (concealed) setFu *= 2;
    if (s.type === 'kan') setFu *= 4;
    fu += setFu;
  });
  if (isDragon(reading.pair)) fu += 2;
  if (reading.pair === seat) fu += 2;
  if (reading.pair === round) fu += 2; // a double wind pair gets 4
  if (['kanchan', 'penchan', 'tanki'].includes(reading.wait)) fu += 2;
  fu = Math.ceil(fu / 10) * 10;
  if (!closed && fu === 20) fu = 30; // open pinfu shape
  return fu;
}

// --- Entry point ---

// Scores a won hand, keeping the reading worth the most points.
//   hand:    closed tiles, not including the winning tile
//   winTile: the tile won on
//   melds:   [{ type: 'chi' | 'pon' | 'kan', open, tiles }] (open is false for a closed kan)
//   ctx:     { tsumo, dealer, seatWind, roundWind, doraIndicators, uraIndicators, riichi,
//              doubleRiichi, ippatsu, haitei, houtei, rinshan, chankan }
// Returns null if the tiles aren't a complete hand. A hand with no yaku scores 0, and dora
// only count once there is at least one yaku.
export function scoreHand(hand, winTile, melds = [], ctx = {}) {
  const closedTiles = [...hand, winTile];
  const allTiles = [...closedTiles, ...melds.flatMap((m) => m.tiles)];
  const closed = melds.every((m) => !m.open);
  const kinds = allTiles.map(kindOf);
  const winKind = kindOf(winTile);
  const closedCounts = new Array(34).fill(0);
  for (const t of closedTiles) closedCounts[kindOf(t)]++;
  const meldSets = melds.map((m) => ({
    type: m.type === 'chi' ? 'seq' : m.type === 'pon' ? 'trip' : 'kan',
    k: Math.min(...m.tiles.map(kindOf)),
    open: m.open,
  }));

  const candidates = [];
  const situational = situationalYaku(ctx, closed, {
    hasKan: melds.some((m) => m.type === 'kan'),
    winKindCount: kinds.filter((k) => k === winKind).length,
  });
  for (const reading of readings(closedCounts, winKind, meldSets)) {
    const pinfu = isPinfu(reading, ctx, closed);
    candidates.push({
      yaku: [...situational, ...standardYaku(reading, ctx, closed, kinds)],
      fu: standardFu(reading, ctx, closed, pinfu),
      wait: reading.wait,
    });
  }
  // Seven pairs: seven different pairs, closed only. Fixed at 25 fu.
  if (melds.length === 0 && closedCounts.filter((c) => c === 2).length === 7) {
    candidates.push({
      yaku: [...situational, { name: 'Chiitoitsu', han: 2 }, ...tileYaku(kinds, closed)],
      fu: 25,
      wait: 'tanki',
    });
  }
  if (candidates.length === 0) return null;

  // Dora count toward han only for hands with a yaku; ura dora only with riichi.
  const countDora = (indicators) => {
    const doraKinds = (indicators ?? []).map((t) => doraFromIndicator(kindOf(t)));
    return kinds.reduce((n, k) => n + doraKinds.filter((d) => d === k).length, 0);
  };
  const dora = {
    dora: countDora(ctx.doraIndicators),
    aka: allTiles.filter((t) => t.red).length,
    ura: ctx.riichi || ctx.doubleRiichi ? countDora(ctx.uraIndicators) : 0,
  };
  const doraHan = dora.dora + dora.aka + dora.ura;

  let best = null;
  for (const c of candidates) {
    const yakuHan = c.yaku.reduce((n, y) => n + y.han, 0);
    const han = yakuHan > 0 ? yakuHan + doraHan : 0;
    const basic = han > 0 ? basicPoints(han, c.fu) : 0;
    const payment = payments(basic, ctx);
    const total = payment.ron ?? (payment.all ? payment.all * 3 : payment.dealer + payment.nonDealer * 2);
    const score = {
      yaku: c.yaku,
      dora: yakuHan > 0 ? dora : { dora: 0, aka: 0, ura: 0 },
      han,
      fu: c.fu,
      wait: c.wait,
      basic,
      limit: LIMIT_NAMES[basic] && han >= 3 ? LIMIT_NAMES[basic] : null,
      payment,
      total,
    };
    if (!best || score.total > best.total || (score.total === best.total && (han > best.han || (han === best.han && c.fu > best.fu)))) {
      best = score;
    }
  }
  return best;
}
