// Core game state and turn logic. No DOM access here.

import { scoreHand, payments, pointDeltas } from './scoring.js';

export const SUITS = ['m', 'p', 's', 'z'];
export const HONOR_NAMES = ['E', 'S', 'W', 'N', 'Wh', 'G', 'R'];
export const WINDS = ['E', 'S', 'W', 'N'];
export const STARTING_SCORE = 25000;
// Paid in total by the noten players to the tenpai players at an exhaustive draw.
const NOTEN_PAYMENT = 3000;

// Build the 136 tiles: 4 copies of 34 kinds, one red five per number suit.
export function createTiles() {
  const tiles = [];
  let id = 0;
  for (const suit of SUITS) {
    const maxRank = suit === 'z' ? 7 : 9;
    for (let rank = 1; rank <= maxRank; rank++) {
      for (let copy = 0; copy < 4; copy++) {
        const red = suit !== 'z' && rank === 5 && copy === 0;
        tiles.push({ id: id++, suit, rank, red });
      }
    }
  }
  return tiles;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createWall() {
  return shuffle(createTiles());
}

// Single point of tile -> display text. Swap for SVG later.
export function tileLabel(tile) {
  if (tile.suit === 'z') return HONOR_NAMES[tile.rank - 1];
  return `${tile.red ? 0 : tile.rank}${tile.suit}`;
}

export function compareTiles(a, b) {
  const sa = SUITS.indexOf(a.suit);
  const sb = SUITS.indexOf(b.suit);
  if (sa !== sb) return sa - sb;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.id - b.id;
}

export function sortHand(hand) {
  return hand.sort(compareTiles);
}

// scores and riichiSticks (unclaimed 1000-point riichi deposits) carry over from the
// previous hand.
export function newHand({
  dealer = 0,
  roundWind = 0,
  scores = [0, 1, 2, 3].map(() => STARTING_SCORE),
  riichiSticks = 0,
} = {}) {
  const wall = createWall();
  // The dead wall is 7 stacks of 2: stack i is deadWall[2i] on top of deadWall[2i + 1].
  // The dora indicator is the top of the third stack; the ura dora indicator is under it.
  const deadWall = wall.splice(wall.length - 14, 14);
  const doraIndicators = [deadWall[4]];
  const uraIndicators = [deadWall[5]];

  const players = [0, 1, 2, 3].map((seat) => ({
    seat,
    hand: [],
    drawn: null,
    discards: [],
    // Set on declaration: { turn, discardIndex, double, ippatsu }. turn is state.turnCount
    // when declared, discardIndex the riichi tile's index in discards.
    riichi: null,
  }));

  // Deal in real order starting from the dealer: 3 rounds of 4 tiles each, then 1 tile each.
  const order = [0, 1, 2, 3].map((i) => (dealer + i) % 4);
  for (let round = 0; round < 3; round++) {
    for (const seat of order) players[seat].hand.push(...wall.splice(0, 4));
  }
  for (const seat of order) players[seat].hand.push(wall.shift());
  for (const p of players) sortHand(p.hand);

  const state = {
    wall,
    deadWall,
    doraIndicators,
    uraIndicators,
    players,
    dealer,
    current: dealer,
    phase: 'draw',
    roundWind,
    scores: [...scores],
    riichiSticks,
    pendingRiichi: null, // seat whose riichi discard is waiting to pass before the stick is paid
    turnCount: 0,
    discardLog: [], // every discard in order: { tile, from, turn }, turn = turnCount before it
    lastDiscard: null, // { tile, from } while other players may claim it
    claims: {}, // seat -> null (undecided) | 'ron' | 'pass', during the 'claim' phase
    result: null, // set when the hand ends, see endHand()
  };

  // Dealer takes their 14th tile, so play starts in their discard phase.
  draw(state);
  return state;
}

export function draw(state) {
  if (state.phase !== 'draw') return null;
  if (state.wall.length === 0) {
    endHand(state, exhaustiveDraw(state));
    return null;
  }
  const tile = state.wall.shift();
  state.players[state.current].drawn = tile;
  state.phase = 'discard';
  return tile;
}

export function discard(state, tileId) {
  if (state.phase !== 'discard') return null;
  const player = state.players[state.current];

  // After riichi the hand is locked: only the drawn tile may be discarded, except for the
  // declaration discard itself. Any later discard ends ippatsu.
  if (player.riichi) {
    const declaring = player.riichi.discardIndex === player.discards.length;
    if (!declaring) {
      if (!player.drawn || player.drawn.id !== tileId) return null;
      player.riichi.ippatsu = false;
    }
  }

  let tile;
  if (player.drawn && player.drawn.id === tileId) {
    tile = player.drawn;
  } else {
    const idx = player.hand.findIndex((t) => t.id === tileId);
    if (idx === -1) return null;
    tile = player.hand.splice(idx, 1)[0];
    if (player.drawn) player.hand.push(player.drawn);
  }
  player.drawn = null;
  sortHand(player.hand);
  player.discards.push(tile);

  const turn = state.turnCount;
  state.turnCount++;
  state.current = (state.current + 1) % 4;

  // Anyone who can win on this tile gets to decide before play moves on.
  // This includes the last discard of the hand, after the wall is empty.
  // Furiten players can't ron (they may still tsumo). The check runs before this tile is
  // logged, so it doesn't count as a tile they already let pass.
  const claims = {};
  for (const p of state.players) {
    if (p.seat !== player.seat && isComplete(toCounts([...p.hand, tile])) && !isFuritenNow(state, p.seat)) {
      claims[p.seat] = null;
    }
  }
  state.discardLog.push({ tile, from: player.seat, turn });
  if (Object.keys(claims).length > 0) {
    state.lastDiscard = { tile, from: player.seat };
    state.claims = claims;
    state.phase = 'claim';
  } else {
    afterDiscard(state);
  }
  return tile;
}

// Nobody took the discard: the next player draws, or the hand ends if the wall is empty.
// A riichi declared on this discard now stands, so its 1000-point stick goes on the table.
function afterDiscard(state) {
  state.lastDiscard = null;
  state.claims = {};
  if (state.pendingRiichi !== null) {
    state.scores[state.pendingRiichi] -= 1000;
    state.riichiSticks++;
    state.pendingRiichi = null;
  }
  if (state.wall.length === 0) endHand(state, exhaustiveDraw(state));
  else state.phase = 'draw';
}

// Noten players pay NOTEN_PAYMENT in total, split evenly, to the tenpai players, who
// split it evenly. Nobody pays if everyone or nobody is tenpai. Tenpai here needs no yaku.
//
// Nagashi mangan: a player whose discards are all terminals and honors, none of them
// called, is paid a mangan as if by tsumo. When anyone gets it, it replaces the noten
// payments. There are no calls yet, so every discard counts as uncalled.
function exhaustiveDraw(state) {
  const tenpai = state.players.filter((p) => isTenpai(p.hand)).map((p) => p.seat);
  const nagashi = state.players
    .filter((p) => p.discards.length > 0 && p.discards.every((t) => TERMINALS_AND_HONORS.includes(tileIndex(t))))
    .map((p) => p.seat);

  if (nagashi.length > 0) {
    const deltas = sumDeltas(nagashi.map((seat) => pointDeltas(
      { payment: payments(2000, { dealer: seat === state.dealer, tsumo: true }) },
      { winner: seat, dealer: state.dealer, from: null, tsumo: true },
    )));
    return { type: 'exhaustiveDraw', tenpai, nagashi, deltas };
  }

  const deltas = [0, 0, 0, 0];
  if (tenpai.length > 0 && tenpai.length < 4) {
    for (let seat = 0; seat < 4; seat++) {
      deltas[seat] = tenpai.includes(seat) ? NOTEN_PAYMENT / tenpai.length : -NOTEN_PAYMENT / (4 - tenpai.length);
    }
  }
  return { type: 'exhaustiveDraw', tenpai, nagashi, deltas };
}

// result: { type: 'tsumo' | 'ron', winners: [seat...], scores: [score per winner], tile, from, deltas }
//      or { type: 'exhaustiveDraw', tenpai: [seat...], nagashi: [seat...], deltas: [points per seat] }.
function endHand(state, result) {
  state.result = result;
  state.phase = 'ended';
  result.deltas?.forEach((d, seat) => (state.scores[seat] += d));
}

// --- Winning ---
// Any complete shape wins for now: a hand with no yaku may still win but scores 0 points.
// Furiten is not enforced.

// Scores seat's win on tile (see scoring.js). There are no calls or riichi yet, so hands are
// always closed and riichi, ippatsu, rinshan and chankan never apply.
function scoreWin(state, seat, tile, tsumo) {
  const lastTile = state.wall.length === 0;
  const { riichi } = state.players[seat];
  const ctx = {
    tsumo,
    dealer: seat === state.dealer,
    seatWind: (seat - state.dealer + 4) % 4,
    roundWind: state.roundWind,
    doraIndicators: state.doraIndicators,
    uraIndicators: state.uraIndicators, // only counted for riichi hands
    riichi: !!riichi && !riichi.double,
    doubleRiichi: !!riichi?.double,
    ippatsu: !!riichi?.ippatsu,
    haitei: tsumo && lastTile,
    houtei: !tsumo && lastTile,
  };
  // Kokushi has no standard reading and is not scored until yakuman are added.
  return scoreHand(state.players[seat].hand, tile, [], ctx) ?? {
    yaku: [], dora: { dora: 0, aka: 0, ura: 0 }, han: 0, fu: 0, basic: 0, limit: null,
    payment: payments(0, ctx), total: 0,
  };
}

function sumDeltas(list) {
  return list.reduce((acc, d) => acc.map((x, seat) => x + d[seat]), [0, 0, 0, 0]);
}

// The winner takes every riichi stick on the table (with several winners, the first in
// turn order after the discarder). Adds them to deltas and returns how many there were.
function collectSticks(state, winner, deltas) {
  const sticks = state.riichiSticks;
  deltas[winner] += sticks * 1000;
  state.riichiSticks = 0;
  return sticks;
}

export function canTsumo(state, seat) {
  const player = state.players[seat];
  return state.phase === 'discard' && state.current === seat && !!player.drawn &&
    isComplete(toCounts([...player.hand, player.drawn]));
}

export function tsumo(state, seat) {
  if (!canTsumo(state, seat)) return false;
  const tile = state.players[seat].drawn;
  const score = scoreWin(state, seat, tile, true);
  const deltas = pointDeltas(score, { winner: seat, dealer: state.dealer, from: null, tsumo: true });
  const sticks = collectSticks(state, seat, deltas);
  endHand(state, { type: 'tsumo', winners: [seat], scores: [score], tile, from: null, deltas, sticks, ...revealUra(state, [seat]) });
  return true;
}

// Ura dora are shown at the end of a hand won by a riichi player.
function revealUra(state, winners) {
  return winners.some((s) => state.players[s].riichi) ? { uraIndicators: state.uraIndicators } : {};
}

export function canRon(state, seat) {
  return state.phase === 'claim' && state.claims[seat] === null;
}

// action is 'ron' or 'pass'. Once every eligible player has decided, everyone who called
// ron wins (double and triple ron are allowed); if nobody did, play continues.
export function claim(state, seat, action) {
  if (!canRon(state, seat) || (action !== 'ron' && action !== 'pass')) return false;
  state.claims[seat] = action;
  if (Object.values(state.claims).includes(null)) return true;

  const { tile, from } = state.lastDiscard;
  const winners = Object.keys(state.claims)
    .map(Number)
    .filter((s) => state.claims[s] === 'ron')
    .sort((a, b) => ((a - from + 4) % 4) - ((b - from + 4) % 4)); // turn order after the discarder
  if (winners.length > 0) {
    // A riichi declared on the ronned tile never stands: no stick is paid.
    if (state.pendingRiichi === from) {
      state.players[from].riichi = null;
      state.pendingRiichi = null;
    }
    // With several winners, the discarder pays each of them.
    const scores = winners.map((w) => scoreWin(state, w, tile, false));
    const deltas = sumDeltas(scores.map((score, i) =>
      pointDeltas(score, { winner: winners[i], dealer: state.dealer, from, tsumo: false })));
    const sticks = collectSticks(state, winners[0], deltas);
    endHand(state, { type: 'ron', winners, scores, tile, from, deltas, sticks, ...revealUra(state, winners) });
  } else {
    afterDiscard(state);
  }
  return true;
}

// --- Riichi ---

// Tiles (by id) the current player could discard to declare riichi: the ones that leave
// the hand tenpai. Empty if riichi isn't allowed right now: it needs a closed hand (hands
// are always closed until calls exist), no riichi yet, 1000 points for the stick, and at
// least 4 tiles left in the wall.
export function riichiDiscards(state, seat) {
  const player = state.players[seat];
  if (state.phase !== 'discard' || state.current !== seat || !player.drawn || player.riichi) return [];
  if (state.scores[seat] < 1000 || state.wall.length < 4) return [];
  const tiles = [...player.hand, player.drawn];
  return tiles.filter((t) => isTenpai(tiles.filter((x) => x !== t))).map((t) => t.id);
}

export function canRiichi(state, seat) {
  return riichiDiscards(state, seat).length > 0;
}

// Declares riichi by discarding tileId. It is a double riichi on the player's first discard
// of the hand with no calls before it (there are no calls yet, so the first go-around is
// always uninterrupted). The stick is paid once the discard passes without a ron.
export function declareRiichi(state, seat, tileId) {
  if (!riichiDiscards(state, seat).includes(tileId)) return false;
  const player = state.players[seat];
  player.riichi = {
    turn: state.turnCount,
    discardIndex: player.discards.length,
    double: player.discards.length === 0 && state.turnCount < 4,
    ippatsu: true,
  };
  state.pendingRiichi = seat;
  discard(state, tileId);
  return true;
}

// True when the current player is in riichi holding a draw they can't use, so the server
// should show it briefly and then discard it for them. A draw that wins stops this so the
// player can choose Tsumo (or decline by discarding it). Kans will stop it too once they exist.
export function autoDiscardDue(state) {
  const player = state.players[state.current];
  return state.phase === 'discard' && !!player.riichi && !!player.drawn &&
    player.riichi.discardIndex !== player.discards.length && !canTsumo(state, state.current);
}

// --- Hand shape analysis ---
// Tile kinds are indexed 0-33: m1-9 = 0-8, p1-9 = 9-17, s1-9 = 18-26, z1-7 = 27-33.
// Red fives count as normal fives.

const TERMINALS_AND_HONORS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function tileIndex(tile) {
  return SUITS.indexOf(tile.suit) * 9 + tile.rank - 1;
}

export function kindLabel(index) {
  const suit = SUITS[Math.floor(index / 9)];
  const rank = (index % 9) + 1;
  return suit === 'z' ? HONOR_NAMES[rank - 1] : `${rank}${suit}`;
}

export function toCounts(tiles) {
  const counts = new Array(34).fill(0);
  for (const t of tiles) counts[tileIndex(t)]++;
  return counts;
}

// True if the counts split entirely into triplets and sequences.
// The lowest remaining tile must belong to some set, so only two branches need trying.
function canFormSets(counts) {
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return true;

  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = canFormSets(counts);
    counts[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    const ok = canFormSets(counts);
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

function isStandardComplete(counts) {
  for (let k = 0; k < 34; k++) {
    if (counts[k] < 2) continue;
    counts[k] -= 2;
    const ok = canFormSets(counts);
    counts[k] += 2;
    if (ok) return true;
  }
  return false;
}

// Seven distinct pairs; four of a kind does not count as two pairs.
function isChiitoitsu(counts) {
  return counts.filter((c) => c === 2).length === 7;
}

function isKokushi(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  return total === 14 && TERMINALS_AND_HONORS.every((k) => counts[k] >= 1) &&
    TERMINALS_AND_HONORS.reduce((sum, k) => sum + counts[k], 0) === 14;
}

// Complete winning shape. Works for closed tiles of size 3n+2 (open melds excluded);
// chiitoitsu and kokushi only match a full 14-tile closed hand.
export function isComplete(counts) {
  return isStandardComplete(counts) || isChiitoitsu(counts) || isKokushi(counts);
}

// Tile kinds (as indices) that would complete the hand.
// Empty tenpai (karaten) counts as ready here: a wait on a kind whose four copies
// are all in your own hand or already visible is still reported.
export function getWaits(tiles) {
  const counts = toCounts(tiles);
  const waits = [];
  for (let k = 0; k < 34; k++) {
    counts[k]++;
    if (isComplete(counts)) waits.push(k);
    counts[k]--;
  }
  return waits;
}

export function isTenpai(tiles) {
  return getWaits(tiles).length > 0;
}

// --- Furiten ---
// A player who is furiten can't ron, only tsumo. Red fives count as fives. Three kinds,
// each "one of the hand's waits is in a set of discarded tiles":
//   discard:   the player's own discards (permanent);
//   temporary: anything discarded since the player's own last discard, i.e. a winning tile
//              they let pass. Lifts at their next discard;
//   riichi:    anything discarded since they declared riichi (permanent for the hand).
// Declining a winning tsumo needs no extra rule: the tile goes into their own discards.

// Tile kinds discarded by anyone after the given turn. The discard still open for a ron
// is left out: it hasn't passed yet.
function discardedAfter(state, turn) {
  const open = state.phase === 'claim' ? state.lastDiscard?.tile.id : null;
  return new Set(state.discardLog.filter((d) => d.turn > turn && d.tile.id !== open).map((d) => tileIndex(d.tile)));
}

export function furitenStatus(state, seat) {
  const player = state.players[seat];
  const waits = getWaits(player.hand);
  const hits = (kinds) => waits.some((k) => kinds.has(k));
  const ownDiscards = state.discardLog.filter((d) => d.from === seat);
  const lastOwnTurn = ownDiscards.length ? ownDiscards[ownDiscards.length - 1].turn : -1;
  return {
    discard: hits(new Set(player.discards.map(tileIndex))),
    temporary: hits(discardedAfter(state, lastOwnTurn)),
    riichi: !!player.riichi && hits(discardedAfter(state, player.riichi.turn)),
  };
}

function isFuritenNow(state, seat) {
  const f = furitenStatus(state, seat);
  return f.discard || f.temporary || f.riichi;
}

// Debug helper: confirms every tile id appears exactly once.
export function checkIntegrity(state) {
  const ids = [
    ...state.wall,
    ...state.deadWall,
    ...state.players.flatMap((p) => [...p.hand, ...(p.drawn ? [p.drawn] : []), ...p.discards]),
  ].map((t) => t.id);
  const unique = new Set(ids);
  return ids.length === 136 && unique.size === 136;
}
