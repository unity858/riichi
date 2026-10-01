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
  //   deadWall[0-3]:  replacement tiles drawn after a kan, in order (see drawRinshan)
  //   deadWall[4, 5]: the dora indicator and the ura dora indicator under it
  //   deadWall[6, 7], [8, 9], [10, 11], [12, 13]: the indicators each kan reveals, with ura
  // A replacement tile's slot is emptied (null) when drawn, and each kan moves the last tile
  // of the live wall onto the end of the dead wall.
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
    // Melds, public: { type: 'chi' | 'pon' | 'kan', open, tiles, from, calledId }. For a called
    // meld tiles[0] is the called tile, taken from seat `from`. A kan also has kanType
    // ('ankan' closed, 'daiminkan' open, 'kakan' added to a pon) and, if added, addedId.
    melds: [],
    rinshan: false, // holding a replacement tile drawn after a kan (a tsumo on it is rinshan kaihou)
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
    callChoices: {}, // { kan, pon, chii: { seat, tiles } } as they are chosen
    callMade: false, // any call or kan this hand (ends the chance of a double riichi)
    rinshanUsed: 0, // replacement tiles drawn so far
    pendingKanDora: 0, // open and added kans whose indicator is revealed at the next discard
    kanPending: null, // { seat, type, tile, meldIndex } while others may rob a kan (chankan)
    robbed: null, // the tile won by chankan from an added kan (it is in no hand or meld)
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
  player.rinshan = false;
  sortHand(player.hand);
  player.discards.push(tile);
  player.tsumogiri.push(fromDraw);
  player.called.push(false);
  // An open or added kan's new indicator is revealed now, before anyone can ron this tile.
  revealPendingKanDora(state);

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
    const kan = openKanTiles(state, p, tile);
    const chii = p.seat === state.current ? chiiPairs(state, p, tile) : [];
    if (ron || pon.length > 0 || kan.length > 0 || chii.length > 0) options[p.seat] = { ron, pon, kan, chii };
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
// Returns true if a riichi was settled; if that made four riichi, the hand is aborted
// (suucha riichi) and true is returned too.
function settleRiichi(state) {
  if (state.pendingRiichi === null) return false;
  state.scores[state.pendingRiichi] -= 1000;
  state.riichiSticks++;
  state.pendingRiichi = null;
  if (state.players.every((p) => p.riichi)) {
    endHand(state, abortiveDraw('suucha riichi', state.players.map((p) => p.seat)));
  }
  return true;
}

// Nobody took the discard: the next player draws, or the hand ends if the wall is empty.
// Four kans by more than one player abort the hand once the fourth kan's discard passes.
function afterDiscard(state) {
  clearClaims(state);
  settleRiichi(state);
  if (state.phase === 'ended') return; // suucha riichi
  const kanOwners = state.players.filter((p) => p.melds.some((m) => m.type === 'kan')).length;
  if (kanCount(state) === 4 && kanOwners > 1) endHand(state, abortiveDraw('suukaikan', []));
  else if (state.wall.length === 0) endHand(state, exhaustiveDraw(state));
  else state.phase = 'draw';
}

// --- Abortive draws ---
// The hand ends with no payments; riichi sticks stay on the table, and (see match.js) the
// dealer repeats with one more honba.
//   kyuushu kyuuhai: a player declares it on their first draw, before any call, holding at
//                    least 9 different terminals and honors (it is optional);
//   suucha riichi:   the fourth riichi stands (its discard is not ronned);
//   suukaikan:       four kans by more than one player, once the fourth kan's discard passes.
// revealed: the seats whose hands are shown.
function abortiveDraw(reason, revealed) {
  return { type: 'abortiveDraw', reason, revealed, deltas: [0, 0, 0, 0] };
}

export function canKyuushu(state, seat) {
  const player = state.players[seat];
  if (state.phase !== 'discard' || state.current !== seat || !player.drawn) return false;
  if (player.discards.length > 0 || state.callMade) return false;
  const kinds = new Set([...player.hand, player.drawn].map(tileIndex).filter((k) => TERMINALS_AND_HONORS.includes(k)));
  return kinds.size >= 9;
}

export function declareKyuushu(state, seat) {
  if (!canKyuushu(state, seat)) return false;
  endHand(state, abortiveDraw('kyuushu kyuuhai', [seat]));
  return true;
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
    return { type: 'exhaustiveDraw', tenpai, nagashi, revealed: revealedAtDraw(tenpai, nagashi), deltas };
  }

  const deltas = [0, 0, 0, 0];
  if (tenpai.length > 0 && tenpai.length < 4) {
    for (let seat = 0; seat < 4; seat++) {
      deltas[seat] = tenpai.includes(seat) ? NOTEN_PAYMENT / tenpai.length : -NOTEN_PAYMENT / (4 - tenpai.length);
    }
  }
  return { type: 'exhaustiveDraw', tenpai, nagashi, revealed: revealedAtDraw(tenpai, nagashi), deltas };
}

// After an exhaustive draw, tenpai players and nagashi mangan winners show their hands.
function revealedAtDraw(tenpai, nagashi) {
  return [...new Set([...tenpai, ...nagashi])].sort((a, b) => a - b);
}

// result: { type: 'tsumo' | 'ron', winners: [seat...], scores: [score per winner], tile, from, deltas,
//           sticks (riichi sticks collected), honbaBonus (points from honba) }
//      or { type: 'exhaustiveDraw', tenpai: [seat...], nagashi: [seat...], revealed: [seat...], deltas: [points per seat] }
//      or { type: 'abortiveDraw', reason, revealed: [seat...], deltas } (see abortiveDraw).
function endHand(state, result) {
  state.result = result;
  state.phase = 'ended';
  result.deltas?.forEach((d, seat) => (state.scores[seat] += d));
}

// --- Winning ---
// Any complete shape wins for now: a hand with no yaku may still win but scores 0 points.

// Scores seat's win on tile (see scoring.js), with their melds. A tsumo on a replacement tile
// is rinshan kaihou; chankan is a ron on a tile robbed from a kan.
function scoreWin(state, seat, tile, tsumo, { chankan = false } = {}) {
  const lastTile = state.wall.length === 0;
  const { riichi, rinshan } = state.players[seat];
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
    rinshan: tsumo && rinshan,
    chankan,
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
  // Winning on the replacement tile after an open or added kan reveals its indicator first.
  revealPendingKanDora(state);
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
// The three hand tiles (by id) seat could reveal for an open kan on the discard, as a
// one-option list like the others.
export const openKanOptions = (state, seat) => callOptions(state, seat, 'kan');

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

// action is 'ron', 'kan', 'pon' or 'chii' (tiles = one of that call's options), or 'pass'.
// Once every seat that can act has decided, the priority is ron > pon/kan > chii: everyone
// who called ron wins (double and triple ron are allowed); otherwise an open kan or a pon is
// made; otherwise a chii; otherwise play continues. Two players can never both pon or kan
// the same tile (it would take five copies), so each call has at most one taker.
// The same claim step also covers chankan (robbing a kan), where only ron is offered: if
// nobody rons, the kan goes ahead.
export function claim(state, seat, action, tiles = null) {
  if (state.phase !== 'claim' || state.claims[seat] !== null) return false;
  if (action === 'ron') {
    if (!canRon(state, seat)) return false;
  } else if (action === 'pon' || action === 'chii' || action === 'kan') {
    const option = callOptions(state, seat, action)
      .find((o) => tiles && o.length === tiles.length && o.every((id, i) => id === tiles[i]));
    if (!option) return false;
    state.callChoices[action] = { seat, tiles: option };
  } else if (action !== 'pass') {
    return false;
  }
  state.claims[seat] = action;
  if (Object.values(state.claims).includes(null)) return true;

  const { tile, from, chankan } = state.lastDiscard;
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
    // A robbed kan doesn't happen. An added kan's tile is in no hand or meld any more.
    if (chankan) {
      if (state.kanPending.type === 'kakan') state.robbed = tile;
      state.kanPending = null;
    }
    // With several winners, the discarder pays each of them.
    const scores = winners.map((w) => scoreWin(state, w, tile, false, { chankan }));
    const deltas = sumDeltas(scores.map((score, i) =>
      pointDeltas(score, { winner: winners[i], dealer: state.dealer, from, tsumo: false })));
    const sticks = collectSticks(state, winners[0], deltas);
    const honbaBonus = payHonba(state, winners[0], from, deltas);
    endHand(state, { type: 'ron', winners, scores, tile, from, deltas, sticks, honbaBonus, chankan: !!chankan, ...revealUra(state, winners) });
  } else if (state.kanPending) {
    finishKan(state); // nobody robbed the kan
  } else if (state.callChoices.kan) {
    makeCall(state, 'kan', state.callChoices.kan);
  } else if (state.callChoices.pon) {
    makeCall(state, 'pon', state.callChoices.pon);
  } else if (state.callChoices.chii) {
    makeCall(state, 'chi', state.callChoices.chii);
  } else {
    afterDiscard(state);
  }
  return true;
}

// A chosen pon, chii or open kan: the hand tiles and the discard form an open meld (the
// called tile first; see calledTilePosition for where it is shown sideways). The discard
// stays in the discarder's pond, marked as called. The turn goes to the caller, skipping any
// seats in between. After a pon or chii they discard without drawing, so the draws left
// don't change; after an open kan they draw a replacement tile, and the kan's indicator is
// revealed at their next discard.
// A call ends every riichi player's ippatsu and any chance of a double riichi.
function makeCall(state, type, { seat, tiles: ids }) {
  const { tile, from } = state.lastDiscard;
  const caller = state.players[seat];
  const taken = ids.map((id) => caller.hand.splice(caller.hand.findIndex((t) => t.id === id), 1)[0]);
  const meld = { type, open: true, tiles: [tile, ...taken.sort(compareTiles)], from, calledId: tile.id };
  if (type === 'kan') meld.kanType = 'daiminkan';
  caller.melds.push(meld);
  const discarder = state.players[from];
  discarder.called[discarder.discards.length - 1] = true;

  clearClaims(state);
  interruptFirstGoAround(state);
  settleRiichi(state); // the riichi stands even though its tile was called
  if (state.phase === 'ended') return; // suucha riichi
  if (type === 'kan') {
    state.pendingKanDora++;
    drawRinshan(state, seat);
    return;
  }
  state.current = seat;
  state.phase = 'discard';
}

// Any call or kan: every riichi player loses ippatsu, and the first go-around no longer
// counts as uninterrupted (no double riichi, chiihou, tenhou or kyuushu kyuuhai after it).
function interruptFirstGoAround(state) {
  state.callMade = true;
  for (const p of state.players) if (p.riichi) p.riichi.ippatsu = false;
}

// Where a meld's sideways (called) tile goes, as an index into its tiles as shown: the side
// it came from. From the player on your left (the previous seat) it goes first, from the
// player opposite second, from the player on your right last. A chii is always from the left.
export function calledTilePosition(meld, seat) {
  const size = (meld.tiles?.length ?? 3) - (meld.addedId ? 1 : 0); // an added kan shows as a pon plus one
  return { 3: 0, 2: 1, 1: size - 1 }[(meld.from - seat + 4) % 4];
}

// --- Kan ---

const kanCount = (state) => state.players.reduce((n, p) => n + p.melds.filter((m) => m.type === 'kan').length, 0);

// Reveals the next kan dora indicator, and the ura dora indicator under it.
function revealKanDora(state) {
  const n = state.doraIndicators.length;
  state.doraIndicators.push(state.deadWall[4 + 2 * n]);
  state.uraIndicators.push(state.deadWall[5 + 2 * n]);
}
function revealPendingKanDora(state) {
  for (; state.pendingKanDora > 0; state.pendingKanDora--) revealKanDora(state);
}

// After a kan the player draws a replacement tile from the dead wall. The last tile of the
// live wall moves to the dead wall, so the live wall (and everyone's remaining draws) is one
// tile shorter. A tsumo on the replacement tile is rinshan kaihou.
function drawRinshan(state, seat) {
  const tile = state.deadWall[state.rinshanUsed];
  state.deadWall[state.rinshanUsed] = null;
  state.rinshanUsed++;
  state.deadWall.push(state.wall.pop());
  const player = state.players[seat];
  player.drawn = tile;
  player.rinshan = true;
  state.current = seat;
  state.phase = 'discard';
}

// The three tiles of the discard's kind seat could reveal for an open kan, as a one-option
// list. Not in riichi, not on the last live tile and not past four kans.
function openKanTiles(state, player, tile) {
  if (player.riichi || state.wall.length === 0 || kanCount(state) >= 4) return [];
  const same = player.hand.filter((t) => t.suit === tile.suit && t.rank === tile.rank);
  return same.length === 3 ? [same.map((t) => t.id)] : [];
}

// Kans seat can declare on their own turn, after a draw (including a replacement draw):
//   { type: 'ankan', kind, tiles }: a closed kan of four tiles in hand;
//   { type: 'kakan', kind, tiles }: an added kan, the fourth tile onto your pon.
// Not on the last live tile (there is nothing to replace it with) and not past four kans.
// In riichi only a closed kan is allowed, of the tile just drawn, and only if every reading
// of the hand keeps those three tiles as a triplet (see riichiKanKeepsHand).
export function kanOptions(state, seat) {
  const player = state.players[seat];
  if (state.phase !== 'discard' || state.current !== seat || !player.drawn) return [];
  if (state.wall.length === 0 || kanCount(state) >= 4) return [];
  const tiles = [...player.hand, player.drawn];
  const options = [];
  for (const kind of new Set(tiles.map(tileIndex))) {
    const same = tiles.filter((t) => tileIndex(t) === kind);
    if (same.length < 4) continue;
    if (player.riichi && (tileIndex(player.drawn) !== kind || !riichiKanKeepsHand(player.hand, kind))) continue;
    options.push({ type: 'ankan', kind, tiles: same.map((t) => t.id) });
  }
  if (!player.riichi) {
    for (const meld of player.melds) {
      if (meld.type !== 'pon') continue;
      const kind = tileIndex(meld.tiles[0]);
      const fourth = tiles.find((t) => tileIndex(t) === kind);
      if (fourth) options.push({ type: 'kakan', kind, tiles: [fourth.id] });
    }
  }
  return options;
}

// In riichi a closed kan of kind k (three in hand plus the tile just drawn) may not change the
// hand: for every tile it waits on, every way of reading the winning hand must use those
// three as a triplet. So 1112444 can't kan the 4s, although the waits stay the same: winning
// on a 3 reads 111 234 44, using a 4 in a run.
function riichiKanKeepsHand(hand, k) {
  const counts = toCounts(hand);
  const waits = getWaits(hand).filter((w) => w !== k);
  return waits.length > 0 && waits.every((w) => {
    counts[w]++;
    const ok = everyReadingHasTriplet(counts, k);
    counts[w]--;
    return ok;
  });
}

// True if the complete hand splits into a pair and sets at least one way, and every way has
// a triplet of k. (Seven pairs and kokushi can't hold three of a kind.)
function everyReadingHasTriplet(counts, k) {
  let found = false;
  let all = true;
  const visit = (sets) => {
    found = true;
    if (!sets.some((s) => s.type === 'trip' && s.k === k)) all = false;
  };
  for (let pair = 0; pair < 34; pair++) {
    if (counts[pair] < 2) continue;
    counts[pair] -= 2;
    visitSplits(counts, [], visit);
    counts[pair] += 2;
  }
  return found && all;
}

// Calls visit(sets) for every way to split counts into sets ({ type: 'trip' | 'seq', k }).
function visitSplits(counts, sets, visit) {
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return visit(sets);
  if (counts[i] >= 3) {
    counts[i] -= 3;
    visitSplits(counts, [...sets, { type: 'trip', k: i }], visit);
    counts[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    visitSplits(counts, [...sets, { type: 'seq', k: i }], visit);
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
}

// Declares a kan on your own turn (kind = one of kanOptions). A closed kan reveals its new
// indicator at once; an added kan's is revealed at the next discard. Either way the other
// players first get the chance to rob it (chankan): any winning hand may ron an added kan's
// tile, but only kokushi may rob a closed kan (as in Mahjong Soul).
export function declareKan(state, seat, kind) {
  const option = kanOptions(state, seat).find((o) => o.kind === kind);
  if (!option) return false;
  const player = state.players[seat];
  revealPendingKanDora(state); // an earlier open or added kan's indicator comes first
  player.hand.push(player.drawn);
  player.drawn = null;
  player.rinshan = false;
  const take = (ids) => ids.map((id) => player.hand.splice(player.hand.findIndex((t) => t.id === id), 1)[0]);
  if (option.type === 'ankan') {
    const tiles = take(option.tiles).sort(compareTiles);
    player.melds.push({ type: 'kan', kanType: 'ankan', open: false, tiles, from: seat, calledId: null });
    sortHand(player.hand);
    revealKanDora(state);
    state.kanPending = { seat, type: 'ankan', tile: tiles[0] };
  } else {
    const [tile] = take(option.tiles);
    sortHand(player.hand);
    const meldIndex = player.melds.findIndex((m) => m.type === 'pon' && tileIndex(m.tiles[0]) === kind);
    state.kanPending = { seat, type: 'kakan', tile, meldIndex };
  }
  openChankan(state, option.type === 'ankan');
  return true;
}

// Lets the other players rob the pending kan: those whose hand the tile completes (only for
// kokushi on a closed kan), who aren't furiten. If nobody can, the kan goes ahead.
function openChankan(state, kokushiOnly) {
  const { seat, tile } = state.kanPending;
  const options = {};
  for (const p of state.players) {
    if (p.seat === seat) continue;
    const counts = toCounts([...p.hand, tile]);
    const ron = (kokushiOnly ? p.melds.length === 0 && isKokushi(counts) : isComplete(counts)) && !isFuritenNow(state, p.seat);
    if (ron) options[p.seat] = { ron: true, pon: [], kan: [], chii: [] };
  }
  if (Object.keys(options).length === 0) return finishKan(state);
  state.lastDiscard = { tile, from: seat, chankan: true };
  state.claimOptions = options;
  state.claims = Object.fromEntries(Object.keys(options).map((s) => [s, null]));
  state.phase = 'claim';
}

// The kan stands: an added kan joins its pon, and the player draws a replacement tile.
function finishKan(state) {
  const { seat, type, tile, meldIndex } = state.kanPending;
  state.kanPending = null;
  clearClaims(state);
  if (type === 'kakan') {
    const meld = state.players[seat].melds[meldIndex];
    meld.type = 'kan';
    meld.kanType = 'kakan';
    meld.tiles.push(tile);
    meld.addedId = tile.id;
    state.pendingKanDora++;
  }
  interruptFirstGoAround(state);
  drawRinshan(state, seat);
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
// player can choose Tsumo (or decline by discarding it), and so does a draw allowing a legal closed kan.
export function autoDiscardDue(state) {
  const player = state.players[state.current];
  return state.phase === 'discard' && !!player.riichi && !!player.drawn &&
    player.riichi.discardIndex !== player.discards.length && !canTsumo(state, state.current) &&
    kanOptions(state, state.current).length === 0;
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
    ...state.deadWall.filter(Boolean), // drawn replacement tiles leave empty slots
    ...state.players.flatMap((p) => [...p.hand, ...(p.drawn ? [p.drawn] : []), ...p.discards, ...meldTiles(p)]),
    ...(state.robbed ? [state.robbed] : []),
  ].map((t) => t.id);
  const unique = new Set(ids);
  return ids.length === 136 && unique.size === 136;
}
