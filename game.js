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

// scores, riichiSticks (unclaimed 1000-point riichi deposits) and honba (the repeat counter,
// worth HONBA_POINTS each to the winner) carry over from the previous hand; see match.js.
// wall replaces the random shuffle with a fixed order of all 136 tiles (see seed.js for how
// the positions are used).
export function newHand({
  dealer = 0,
  roundWind = 0,
  scores = [0, 1, 2, 3].map(() => STARTING_SCORE),
  riichiSticks = 0,
  honba = 0,
  wall: fixedWall = null,
} = {}) {
  const wall = fixedWall ? [...fixedWall] : createWall();
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
    tsumogiri: [], // per discard: true if it was the tile just drawn
    called: [], // per discard: true if another player called it (it stays in the pond)
    // Open melds, public: { type: 'chi' | 'pon', open, tiles, from, calledId }. tiles[0] is the
    // called tile, taken from seat `from`.
    melds: [],
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
    honba,
    pendingRiichi: null, // seat whose riichi discard is waiting to pass before the stick is paid
    turnCount: 0,
    discardLog: [], // every discard in order: { tile, from, turn }, turn = turnCount before it
    lastDiscard: null, // { tile, from } while other players may claim it
    // During the 'claim' phase, for each seat that can act on the discard:
    //   claimOptions: seat -> { ron: bool, pon: [[tileId, tileId], ...], chii: [...] }
    //   claims:       seat -> null (undecided) | 'ron' | 'pon' | 'chii' | 'pass'
    claimOptions: {},
    claims: {},
    callChoices: {}, // { pon: { seat, tiles }, chii: { seat, tiles } } as they are chosen
    callMade: false, // any call this hand (ends the chance of a double riichi)
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
  const fromDraw = !!player.drawn && player.drawn.id === tileId;
  if (fromDraw) {
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
  player.tsumogiri.push(fromDraw);
  player.called.push(false);

  const turn = state.turnCount;
  state.turnCount++;
  state.current = (state.current + 1) % 4;

  // Anyone who can act on this tile decides before play moves on: ron for anyone it
  // completes (including on the last discard, after the wall is empty), pon for anyone
  // holding two more, chii for the next player. Furiten players can't ron (they may still
  // tsumo). The check runs before this tile is logged, so it doesn't count as a tile they
  // already let pass.
  const options = {};
  for (const p of state.players) {
    if (p.seat === player.seat) continue;
    const ron = isComplete(toCounts([...p.hand, tile])) && !isFuritenNow(state, p.seat);
    const pon = ponPairs(state, p, tile);
    const chii = p.seat === state.current ? chiiPairs(state, p, tile) : [];
    if (ron || pon.length > 0 || chii.length > 0) options[p.seat] = { ron, pon, chii };
  }
  state.discardLog.push({ tile, from: player.seat, turn });
  if (Object.keys(options).length > 0) {
    state.lastDiscard = { tile, from: player.seat };
    state.claimOptions = options;
    state.claims = Object.fromEntries(Object.keys(options).map((seat) => [seat, null]));
    state.phase = 'claim';
  } else {
    afterDiscard(state);
  }
  return tile;
}

function clearClaims(state) {
  state.lastDiscard = null;
  state.claimOptions = {};
  state.claims = {};
  state.callChoices = {};
}

// A riichi declared on the discard that just passed (not ronned) now stands, so its
// 1000-point stick goes on the table.
function settleRiichi(state) {
  if (state.pendingRiichi === null) return;
  state.scores[state.pendingRiichi] -= 1000;
  state.riichiSticks++;
  state.pendingRiichi = null;
}

// Nobody took the discard: the next player draws, or the hand ends if the wall is empty.
function afterDiscard(state) {
  clearClaims(state);
  settleRiichi(state);
  if (state.wall.length === 0) endHand(state, exhaustiveDraw(state));
  else state.phase = 'draw';
}

// Noten players pay NOTEN_PAYMENT in total, split evenly, to the tenpai players, who
// split it evenly. Nobody pays if everyone or nobody is tenpai. Tenpai here needs no yaku.
//
// Nagashi mangan: a player whose discards are all terminals and honors, none of them
// called, is paid a mangan as if by tsumo. When anyone gets it, it replaces the noten
// payments.
function exhaustiveDraw(state) {
  const tenpai = state.players.filter((p) => isTenpai(p.hand)).map((p) => p.seat);
  const nagashi = state.players
    .filter((p) => p.discards.length > 0 && !p.called.some(Boolean) &&
      p.discards.every((t) => TERMINALS_AND_HONORS.includes(tileIndex(t))))
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

// result: { type: 'tsumo' | 'ron', winners: [seat...], scores: [score per winner], tile, from, deltas,
//           sticks (riichi sticks collected), honbaBonus (points from honba) }
//      or { type: 'exhaustiveDraw', tenpai: [seat...], nagashi: [seat...], deltas: [points per seat] }.
function endHand(state, result) {
  state.result = result;
  state.phase = 'ended';
  result.deltas?.forEach((d, seat) => (state.scores[seat] += d));
}

// --- Winning ---
// Any complete shape wins for now: a hand with no yaku may still win but scores 0 points.

// Scores seat's win on tile (see scoring.js), with their open melds. There are no kans
// yet, so rinshan and chankan never apply.
function scoreWin(state, seat, tile, tsumo) {
  const lastTile = state.wall.length === 0;
  const { riichi } = state.players[seat];
  // A tsumo on your very first draw, with nobody having called: tenhou for the dealer,
  // chiihou for anyone else.
  const firstDraw = tsumo && state.players[seat].discards.length === 0 && !state.callMade;
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
    tenhou: firstDraw && seat === state.dealer,
    chiihou: firstDraw && seat !== state.dealer,
  };
  // The game only lets complete hands win, so the fallback is just a safeguard.
  return scoreHand(state.players[seat].hand, tile, state.players[seat].melds, ctx) ?? {
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

// Each honba adds HONBA_POINTS to the win, going to the same winner as the riichi sticks:
// on a ron the discarder pays it all, on a tsumo each other player pays a third.
export const HONBA_POINTS = 300;
function payHonba(state, winner, from, deltas) {
  const bonus = state.honba * HONBA_POINTS;
  if (from === null) {
    for (let seat = 0; seat < 4; seat++) if (seat !== winner) deltas[seat] -= bonus / 3;
  } else {
    deltas[from] -= bonus;
  }
  deltas[winner] += bonus;
  return bonus;
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
  const honbaBonus = payHonba(state, seat, null, deltas);
  endHand(state, {
    type: 'tsumo', winners: [seat], scores: [score], tile, from: null, deltas, sticks, honbaBonus, ...revealUra(state, [seat]),
  });
  return true;
}

// Ura dora are shown at the end of a hand won by a riichi player.
function revealUra(state, winners) {
  return winners.some((s) => state.players[s].riichi) ? { uraIndicators: state.uraIndicators } : {};
}

export function canRon(state, seat) {
  return state.phase === 'claim' && state.claims[seat] === null && !!state.claimOptions[seat]?.ron;
}

// The pairs of hand tiles (by id) seat could reveal to pon or chii the open discard.
function callOptions(state, seat, type) {
  if (state.phase !== 'claim' || state.claims[seat] !== null) return [];
  return state.claimOptions[seat]?.[type] ?? [];
}
export const ponOptions = (state, seat) => callOptions(state, seat, 'pon');
export const chiiOptions = (state, seat) => callOptions(state, seat, 'chii');

// Distinct pairs of hand tiles of the discard's kind, for a pon: two plain copies, or a plain
// one with the red five. Anyone but the discarder may pon, except on the last discard or
// while in riichi.
function ponPairs(state, player, tile) {
  if (player.riichi || state.wall.length === 0) return [];
  const same = player.hand.filter((t) => t.suit === tile.suit && t.rank === tile.rank);
  const plain = same.filter((t) => !t.red);
  const red = same.find((t) => t.red);
  const pairs = [];
  if (plain.length >= 2) pairs.push([plain[0].id, plain[1].id]);
  if (plain.length >= 1 && red) pairs.push([plain[0].id, red.id]);
  return pairs;
}

// Distinct pairs of hand tiles that make a run with the discard; a red five counts as
// different from a plain five, since revealing it matters. No chii on honors, on the last
// discard (the wall is empty), or while in riichi. Kuikae is not restricted yet.
function chiiPairs(state, player, tile) {
  if (tile.suit === 'z' || player.riichi || state.wall.length === 0) return [];
  // One tile of the rank for each look (plain and red).
  const looks = (rank) => {
    const byLook = new Map();
    for (const t of player.hand) {
      if (t.suit === tile.suit && t.rank === rank && !byLook.has(t.red)) byLook.set(t.red, t);
    }
    return [...byLook.values()];
  };
  const r = tile.rank;
  const pairs = [];
  for (const [a, b] of [[r - 2, r - 1], [r - 1, r + 1], [r + 1, r + 2]]) {
    if (a < 1 || b > 9) continue;
    for (const x of looks(a)) for (const y of looks(b)) pairs.push([x.id, y.id]);
  }
  return pairs;
}

// action is 'ron', 'pon' or 'chii' (tiles = one of that call's options), or 'pass'. Once
// every seat that can act has decided, the priority is ron > pon > chii: everyone who called
// ron wins (double and triple ron are allowed); otherwise a pon is made; otherwise a chii;
// otherwise play continues. Two players can never both pon the same tile (it would take
// five copies), so each call has at most one taker.
export function claim(state, seat, action, tiles = null) {
  if (state.phase !== 'claim' || state.claims[seat] !== null) return false;
  if (action === 'ron') {
    if (!canRon(state, seat)) return false;
  } else if (action === 'pon' || action === 'chii') {
    const option = callOptions(state, seat, action)
      .find((o) => tiles && o.length === tiles.length && o.every((id, i) => id === tiles[i]));
    if (!option) return false;
    state.callChoices[action] = { seat, tiles: option };
  } else if (action !== 'pass') {
    return false;
  }
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
    const honbaBonus = payHonba(state, winners[0], from, deltas);
    endHand(state, { type: 'ron', winners, scores, tile, from, deltas, sticks, honbaBonus, ...revealUra(state, winners) });
  } else if (state.callChoices.pon) {
    makeCall(state, 'pon', state.callChoices.pon);
  } else if (state.callChoices.chii) {
    makeCall(state, 'chi', state.callChoices.chii);
  } else {
    afterDiscard(state);
  }
  return true;
}

// A chosen pon or chii: the two hand tiles and the discard form an open meld (the called tile
// first; see calledTilePosition for where it is shown sideways). The discard stays in the
// discarder's pond, marked as called. The turn goes to the caller, skipping any seats in
// between, and they discard next without drawing, so the draws left don't change.
// A call ends every riichi player's ippatsu and any chance of a double riichi.
function makeCall(state, type, { seat, tiles: ids }) {
  const { tile, from } = state.lastDiscard;
  const caller = state.players[seat];
  const taken = ids.map((id) => caller.hand.splice(caller.hand.findIndex((t) => t.id === id), 1)[0]);
  caller.melds.push({ type, open: true, tiles: [tile, ...taken.sort(compareTiles)], from, calledId: tile.id });
  const discarder = state.players[from];
  discarder.called[discarder.discards.length - 1] = true;

  clearClaims(state);
  settleRiichi(state);
  state.callMade = true;
  for (const p of state.players) if (p.riichi) p.riichi.ippatsu = false;
  state.current = seat;
  state.phase = 'discard';
}

// Where a meld's sideways (called) tile goes, as an index into the three tiles shown: the
// side it came from. From the player on your left (the previous seat) it goes first, from
// the player opposite in the middle, from the player on your right last. A chii is always
// from the left.
export function calledTilePosition(meld, seat) {
  return { 3: 0, 2: 1, 1: 2 }[(meld.from - seat + 4) % 4];
}

// --- Riichi ---

// Tiles (by id) the current player could discard to declare riichi: the ones that leave
// the hand tenpai. Empty if riichi isn't allowed right now: it needs a closed hand (no open
// melds), no riichi yet, 1000 points for the stick, and at least 4 tiles left in the wall.
export function riichiDiscards(state, seat) {
  const player = state.players[seat];
  if (state.phase !== 'discard' || state.current !== seat || !player.drawn || player.riichi) return [];
  if (player.melds.some((m) => m.open)) return [];
  if (state.scores[seat] < 1000 || state.wall.length < 4) return [];
  const tiles = [...player.hand, player.drawn];
  return tiles.filter((t) => isTenpai(tiles.filter((x) => x !== t))).map((t) => t.id);
}

export function canRiichi(state, seat) {
  return riichiDiscards(state, seat).length > 0;
}

// Declares riichi by discarding tileId. It is a double riichi on the player's first discard
// of the hand with no calls before it. The stick is paid once the discard passes without a ron.
export function declareRiichi(state, seat, tileId) {
  if (!riichiDiscards(state, seat).includes(tileId)) return false;
  const player = state.players[seat];
  player.riichi = {
    turn: state.turnCount,
    discardIndex: player.discards.length,
    double: player.discards.length === 0 && state.turnCount < 4 && !state.callMade,
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

// Debug helper: confirms every tile id appears exactly once. A called tile is counted in
// the discarder's pond, where it still shows, not again in the caller's meld.
export function checkIntegrity(state) {
  const meldTiles = (p) => p.melds.flatMap((m) => m.tiles.filter((t) => t.id !== m.calledId));
  const ids = [
    ...state.wall,
    ...state.deadWall,
    ...state.players.flatMap((p) => [...p.hand, ...(p.drawn ? [p.drawn] : []), ...p.discards, ...meldTiles(p)]),
  ].map((t) => t.id);
  const unique = new Set(ids);
  return ids.length === 136 && unique.size === 136;
}
