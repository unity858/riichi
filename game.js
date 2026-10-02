// Core game state and turn logic. No DOM access here.

import { scoreHand, payments, pointDeltas } from './scoring.js';

export const SUITS = ['m', 'p', 's', 'z'];
// The wild tile (Baiman contest only), written 1A. It is not one of the 136: every contest hand
// deals one to each player in place of their 13th tile (see newHand). It can never be discarded
// or called with, and only counts when winning: a hand wins if the wild tile can stand for some
// kind (any of the 34, never a red five, even one whose four copies are all elsewhere) that
// makes it complete. The win is scored as whichever kind gives the most han (see scoreWin). Riichi,
// pon, chii and kan work as usual with the other tiles.
export const WILD = 'A';
export const WILD_KIND = 34; // its tileIndex, after the 34 real kinds (0-33)
export const isWild = (tile) => tile.suit === WILD;
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
  if (isWild(tile)) return '1A';
  if (tile.suit === 'z') return HONOR_NAMES[tile.rank - 1];
  return `${tile.red ? 0 : tile.rank}${tile.suit}`;
}

const SUIT_ORDER = [WILD, ...SUITS]; // a wild tile sorts first, at the left of the hand
export function compareTiles(a, b) {
  const sa = SUIT_ORDER.indexOf(a.suit);
  const sb = SUIT_ORDER.indexOf(b.suit);
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
// the positions are used; a Baiman contest deals one fewer each, see the wild tile above).
export function newHand({
  dealer = 0,
  roundWind = 0,
  scores = [0, 1, 2, 3].map(() => STARTING_SCORE),
  riichiSticks = 0,
  honba = 0,
  rules = {}, // { yakuRebalance, contest } from the room settings
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
    // The player's latest call, shown briefly above their name: 'chii' | 'pon' | 'kan' |
    // 'riichi' | 'ron' | 'tsumo', or null. It clears when they next discard; a riichi (whose
    // discard is the call) clears at the next draw or call instead.
    callout: null,
    // Baiman contest: set when the player wins, { seat, type, tile, from, score, points, chankan,
    // robbed }. They then sit out the rest of the hand, their hand still hidden (see wins).
    won: null,
  }));

  // Deal in real order starting from the dealer: 3 rounds of 4 tiles each, then 1 tile each.
  // In a Baiman contest that last tile is everyone's wild tile, from outside the wall.
  const order = [0, 1, 2, 3].map((i) => (dealer + i) % 4);
  for (let round = 0; round < 3; round++) {
    for (const seat of order) players[seat].hand.push(...wall.splice(0, 4));
  }
  for (const seat of order) {
    players[seat].hand.push(rules.contest ? { id: 136 + seat, suit: WILD, rank: 1, red: false } : wall.shift());
  }
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
    // contest: the Baiman contest format (see "Baiman contest" below).
    rules: { yakuRebalance: !!rules.yakuRebalance, contest: !!rules.contest },
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
    wins: [], // Baiman contest: every win so far this hand, in order (each player's won)
    // Baiman contest: the tile exchange before the first draw (see chooseExchange), while it lasts.
    exchange: rules.contest ? { picks: [null, null, null, null] } : null,
    passes: null, // Baiman contest: sigma once the exchange is made (player n passed to passes[n])
    pauseTurn: null, // Baiman contest: whose turn to show in the pause after a win
  };

  // Dealer takes their 14th tile, so play starts in their discard phase. A Baiman contest hand
  // first has its tile exchange.
  if (rules.contest) state.phase = 'exchange';
  else draw(state);
  return state;
}

// The next draw: from the live wall in the 'draw' phase, or the replacement tile after a kan
// in the 'rinshan' phase.
export function draw(state) {
  if (state.phase === 'rinshan') return drawRinshan(state);
  if (state.phase !== 'draw') return null;
  if (state.wall.length === 0) {
    if (state.rules.contest) finishContest(state, 'wall');
    else endHand(state, exhaustiveDraw(state));
    return null;
  }
  state.pauseTurn = null;
  const tile = state.wall.shift();
  clearRiichiCallouts(state);
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

  if (player.hand.some((t) => t.id === tileId && isWild(t))) return null; // never discarded
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
  player.callout = null;
  sortHand(player.hand);
  player.discards.push(tile);
  player.tsumogiri.push(fromDraw);
  player.called.push(false);
  // An open or added kan's new indicator is revealed now, before anyone can ron this tile.
  revealPendingKanDora(state);

  const turn = state.turnCount;
  state.turnCount++;
  state.current = nextActive(state, state.current);

  // Anyone who can act on this tile decides before play moves on: ron for anyone it
  // completes (including on the last discard, after the wall is empty), pon for anyone
  // holding two more, chii for the next player. Furiten players can't ron (they may still
  // tsumo). The check runs before this tile is logged, so it doesn't count as a tile they
  // already let pass.
  const options = {};
  for (const p of state.players) {
    if (p.seat === player.seat || p.won) continue;
    const ron = isCompleteTiles([...p.hand, tile]) && !isFuritenNow(state, p.seat) && hasYaku(state, p.seat, tile, false);
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

function clearRiichiCallouts(state) {
  for (const p of state.players) if (p.callout === 'riichi') p.callout = null;
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
  if (state.rules.contest) {
    // No points change hands in a Baiman contest: riichi is free, and four riichi don't abort.
    state.pendingRiichi = null;
    return true;
  }
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
  if (state.rules.contest) {
    if (state.wall.length === 0) finishContest(state, 'wall');
    else state.phase = 'draw';
  } else if (kanCount(state) === 4 && kanOwners > 1) endHand(state, abortiveDraw('suukaikan', []));
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
// Nagashi: a player whose discards are all terminals and honors, none of them
// called, is paid a mangan (a baiman with the yaku rebalance) as if by tsumo. When anyone gets
// it, it replaces the noten payments.
function exhaustiveDraw(state) {
  const tenpai = state.players.filter((p) => isTenpai(p.hand)).map((p) => p.seat);
  const nagashi = state.players
    .filter((p) => p.discards.length > 0 && !p.called.some(Boolean) &&
      p.discards.every((t) => TERMINALS_AND_HONORS.includes(tileIndex(t))))
    .map((p) => p.seat);

  if (nagashi.length > 0) {
    const deltas = sumDeltas(nagashi.map((seat) => pointDeltas(
      { payment: payments(state.rules.yakuRebalance ? 4000 : 2000, { dealer: seat === state.dealer, tsumo: true }) },
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

// After an exhaustive draw, tenpai players and nagashi winners show their hands.
function revealedAtDraw(tenpai, nagashi) {
  return [...new Set([...tenpai, ...nagashi])].sort((a, b) => a - b);
}

// result: { type: 'tsumo' | 'ron', winners: [seat...], scores: [score per winner], tile, from, deltas,
//           sticks (riichi sticks collected), honbaBonus (points from honba) }
//      or { type: 'exhaustiveDraw', tenpai: [seat...], nagashi: [seat...], revealed: [seat...], deltas: [points per seat] }
//      or { type: 'abortiveDraw', reason, revealed: [seat...], deltas } (see abortiveDraw).
// paid: the deltas are already in the scores (Baiman contest points count as each win happens).
function endHand(state, result, { paid = false } = {}) {
  state.result = result;
  state.phase = 'ended';
  if (!paid) result.deltas?.forEach((d, seat) => (state.scores[seat] += d));
}

// --- Winning ---
// A complete hand can only win (by ron or tsumo) with at least one yaku: dora don't count,
// but situational yaku do (riichi, ippatsu, menzen tsumo, haitei, houtei, rinshan, chankan,
// tenhou, chiihou), as do yakuman.
function hasYaku(state, seat, tile, tsumo, opts) {
  const score = scoreWin(state, seat, tile, tsumo, opts);
  return score.yakuman > 0 || score.han > 0;
}

// Each tile seat waits on, and whether winning on it would have a yaku right now, by ron and
// by tsumo: [{ kind, ron, tsumo }]. A hand may have a yaku on only some of its waits
// (atozuke); it can win on those. Uses the hand as it stands between draws; [] mid-turn.
export function waitYaku(state, seat) {
  const { hand } = state.players[seat];
  if (hand.length % 3 !== 1) return [];
  // With a wild tile, yaku aren't checked per wait yet, and a hand that wins on anything shows
  // the wild tile as its one wait (see waitsOnAnything).
  if (hand.some(isWild)) {
    if (waitsOnAnything(hand)) return [{ kind: WILD_KIND, ron: true, tsumo: true, any: true }];
    return getWaits(hand).map((kind) => ({ kind, ron: true, tsumo: true }));
  }
  const tileOf = (k) => ({ id: -1, suit: SUITS[Math.floor(k / 9)], rank: (k % 9) + 1, red: false });
  return getWaits(hand).map((kind) => ({
    kind,
    ron: hasYaku(state, seat, tileOf(kind), false),
    tsumo: hasYaku(state, seat, tileOf(kind), true),
  }));
}

// For the current player on their turn: each tile they could discard to be tenpai, with the
// waits they would then have (as from waitYaku) and whether they would be furiten. After the
// discard that tile counts among their discards and riichi furiten carries over; a discard of
// their own ends temporary furiten. { [tileId]: { waits: [{ kind, ron, tsumo }], furiten } }
// Works by trying each discard on the player's tiles and putting them back.
export function discardPreview(state, seat) {
  const player = state.players[seat];
  if (state.phase !== 'discard' || state.current !== seat) return {};
  const tiles = [...player.hand, ...(player.drawn ? [player.drawn] : [])];
  if (tiles.length % 3 !== 2) return {};
  const saved = { hand: player.hand, drawn: player.drawn, discards: player.discards, rinshan: player.rinshan };
  const byKind = new Map();
  const preview = {};
  try {
    for (const tile of tiles) {
      if (isWild(tile)) continue; // it can't be discarded
      const kind = tileIndex(tile);
      if (!byKind.has(kind)) {
        player.hand = tiles.filter((t) => t !== tile);
        player.drawn = null;
        player.rinshan = false;
        player.discards = [...saved.discards, tile];
        const waits = waitYaku(state, seat);
        const discarded = new Set(player.discards.map(tileIndex));
        const sinceRiichi = player.riichi ? discardedAfter(state, player.riichi.turn) : new Set();
        const furiten = waits.some((w) => discarded.has(w.kind) || sinceRiichi.has(w.kind));
        byKind.set(kind, waits.length ? { waits, furiten } : null);
      }
      if (byKind.get(kind)) preview[tile.id] = byKind.get(kind);
    }
  } finally {
    Object.assign(player, saved);
  }
  return preview;
}

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
    rebalance: state.rules.yakuRebalance,
    // Renhou (yaku rebalance): a non-dealer's ron before their first draw, before any call.
    renhou: !tsumo && seat !== state.dealer && state.players[seat].discards.length === 0 && !state.callMade,
    tenhou: firstDraw && seat === state.dealer,
    chiihou: firstDraw && seat !== state.dealer,
  };
  // A wild tile is always scored as whichever kind (never a red five) gives the most han
  // (yakuman above any han), then the higher payment. It counts as that tile for dora too, so
  // an extra dora can push a hand past what its player wanted; that is part of the game.
  const { hand, melds } = state.players[seat];
  const wild = hand.find(isWild);
  let best = null;
  if (wild) {
    for (let k = 0; k < 34; k++) {
      const as = { id: wild.id, suit: SUITS[Math.floor(k / 9)], rank: (k % 9) + 1, red: false };
      const replaced = hand.map((t) => (t === wild ? as : t));
      if (!isComplete(toCounts([...replaced, tile]))) continue;
      const score = scoreHand(replaced, tile, melds, ctx);
      if (score && (!best || moreHan(score, best))) best = score;
    }
  } else {
    best = scoreHand(hand, tile, melds, ctx);
  }
  // The game only lets complete hands win, so the fallback is just a safeguard.
  return best ?? {
    yaku: [], dora: { dora: 0, aka: 0, ura: 0 }, han: 0, fu: 0, basic: 0, limit: null,
    payment: payments(0, ctx), total: 0,
  };
}

// For the wild tile's value: more yakuman, else more han, else a higher payment.
function moreHan(a, b) {
  const order = (x) => [x.yakuman || 0, x.han, x.total];
  const [ka, kb] = [order(a), order(b)];
  const i = ka.findIndex((v, j) => v !== kb[j]);
  return i !== -1 && ka[i] > kb[i];
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
    isCompleteTiles([...player.hand, player.drawn]) && hasYaku(state, seat, player.drawn, true);
}

export function tsumo(state, seat) {
  if (!canTsumo(state, seat)) return false;
  // Winning on the replacement tile after an open or added kan reveals its indicator first.
  revealPendingKanDora(state);
  const tile = state.players[seat].drawn;
  const score = scoreWin(state, seat, tile, true);
  if (state.rules.contest) {
    // The winning tile stays with the winner, hidden like the rest of their hand.
    recordWin(state, { seat, type: 'tsumo', tile, from: null, score });
    continueAfterWin(state, seat);
    return true;
  }
  const deltas = pointDeltas(score, { winner: seat, dealer: state.dealer, from: null, tsumo: true });
  const sticks = collectSticks(state, seat, deltas);
  const honbaBonus = payHonba(state, seat, null, deltas);
  state.players[seat].callout = 'tsumo';
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
  if (winners.length > 0 && state.rules.contest) {
    contestRon(state, winners, tile, from, !!chankan);
  } else if (winners.length > 0) {
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
    for (const w of winners) state.players[w].callout = 'ron';
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
  clearRiichiCallouts(state);
  caller.callout = type === 'chi' ? 'chii' : type;
  const discarder = state.players[from];
  discarder.called[discarder.discards.length - 1] = true;

  clearClaims(state);
  interruptFirstGoAround(state);
  settleRiichi(state); // the riichi stands even though its tile was called
  if (state.phase === 'ended') return; // suucha riichi
  if (type === 'kan') {
    state.pendingKanDora++;
    awaitRinshan(state, seat);
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

// --- Baiman contest ---
// Everyone starts on 0, and a win scores 1 point if it is worth a baiman or sanbaiman (and 0
// otherwise), counted as soon as it is won. Nobody loses points: not the discarder, not the
// others on a tsumo, and riichi is free. A win doesn't end the hand: the winner sits out (their hand stays hidden; its han are
// public, and a riichi winner alone sees the ura dora) and the others play on, skipping them,
// until three players have won or the wall runs out. A ron interrupts like a call: it ends
// ippatsu, double riichi, chiihou, renhou and kyuushu, and the discarder's nagashi. A yakuman
// (kazoe or not) ends the hand at once, and the match with it (see match.js). There is no noten
// payment and no abortive draw but kyuushu; nagashi scores like a win (1 point only as a
// baiman, with the yaku rebalance).

export const CONTEST_LIMITS = ['Baiman', 'Sanbaiman'];

// The next seat after `seat` still playing (not yet won).
function nextActive(state, seat) {
  for (let i = 1; i <= 4; i++) {
    const next = (seat + i) % 4;
    if (!state.players[next].won) return next;
  }
  return seat;
}

export const isYakuman = (score) => score.yakuman > 0 || score.limit === 'Kazoe yakuman';

function recordWin(state, { seat, type, tile, from, score, chankan = false, robbed = false }) {
  const win = { seat, type, tile, from, score, points: CONTEST_LIMITS.includes(score.limit) ? 1 : 0, chankan, robbed };
  state.players[seat].won = win;
  state.players[seat].callout = type;
  state.wins.push(win);
  state.scores[seat] += win.points; // counted at once
}

// Everyone who called ron on the tile wins. A discard stays in the pond, marked as called; a
// robbed added kan doesn't happen, and its tile goes to the winners. A closed kan can only be
// robbed by kokushi, a yakuman, which ends the hand anyway; its tile stays in the kan.
function contestRon(state, winners, tile, from, chankan) {
  const scores = winners.map((w) => scoreWin(state, w, tile, false, { chankan }));
  const robbed = chankan && state.kanPending.type === 'kakan'; // the tile is in no hand or meld
  if (chankan) {
    state.kanPending = null;
  } else {
    const discarder = state.players[from];
    discarder.called[discarder.discards.length - 1] = true;
  }
  clearClaims(state);
  interruptFirstGoAround(state); // like a call
  settleRiichi(state);
  winners.forEach((w, i) => recordWin(state, { seat: w, type: 'ron', tile, from, score: scores[i], chankan, robbed: robbed && i === 0 }));
  continueAfterWin(state, from);
}

// After a win, play goes on from the next player still in, unless three have won or the
// wall is empty. `seat` is whose turn it was (the winner on a tsumo, the discarder on a ron).
function continueAfterWin(state, seat) {
  if (state.wins.some((w) => isYakuman(w.score))) return finishContest(state, 'yakuman');
  if (state.wins.length >= 3) return finishContest(state, 'three winners');
  if (state.wall.length === 0) return finishContest(state, 'wall');
  state.current = nextActive(state, seat);
  state.pauseTurn = seat;
  state.phase = 'draw';
}

// The hand ends: winners' hands, the points and (for a riichi winner) the ura dora are shown.
// result: { type: 'contest', reason: 'three winners' | 'yakuman' | 'wall', winners, scores, wins,
//           nagashi: [{ seat, limit, points }], deltas, yakuman (a yakuman ended it),
//           tenpai (players still in who are tenpai, for the dealer repeat), uraIndicators? }
// Nagashi (at the end of the wall, for players who haven't won) is a mangan, or a
// baiman with the yaku rebalance, scored like a win.
function finishContest(state, reason) {
  const winners = state.wins.map((w) => w.seat);
  const deltas = [0, 0, 0, 0];
  for (const w of state.wins) deltas[w.seat] += w.points;
  const tenpai = state.players.filter((p) => !p.won && isTenpai(p.hand)).map((p) => p.seat);
  const limit = state.rules.yakuRebalance ? 'Baiman' : 'Mangan';
  const nagashi = reason !== 'wall' ? [] : state.players
    .filter((p) => !p.won && p.discards.length > 0 && !p.called.some(Boolean) &&
      p.discards.every((t) => TERMINALS_AND_HONORS.includes(tileIndex(t))))
    .map((p) => ({ seat: p.seat, limit, points: CONTEST_LIMITS.includes(limit) ? 1 : 0 }));
  for (const n of nagashi) {
    deltas[n.seat] += n.points;
    state.scores[n.seat] += n.points;
  }
  // deltas sum up the hand for the result; every point in them is already in the scores.
  endHand(state, {
    type: 'contest', reason, winners, scores: state.wins.map((w) => w.score),
    wins: state.wins.map(({ seat, type, tile, from, points, chankan }) => ({ seat, type, tile, from, points, chankan })),
    nagashi, deltas, tenpai, yakuman: reason === 'yakuman', ...revealUra(state, winners),
  }, { paid: true });
}

// --- Baiman contest: the tile exchange ---
// Before the first draw each player picks exactly three tiles from their hand, never the wild
// tile. Once all four have picked, a random derangement sigma of [0, 1, 2, 3] (no player keeps
// their own) is drawn, and player n's three tiles go to player sigma[n]. Once made, the passes
// are public for the rest of the hand (state.passes).
// Then the dealer draws and play starts as usual. It is there to make rare hands (flushes in
// particular) reachable.

// All 9 permutations of [0, 1, 2, 3] with no fixed point.
export const DERANGEMENTS = (() => {
  const all = [];
  const build = (prefix, rest) => {
    if (!rest.length) return all.push(prefix);
    rest.forEach((x, i) => build([...prefix, x], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  build([], [0, 1, 2, 3]);
  return all.filter((p) => p.every((x, i) => x !== i));
})();

// Uniform over the 9 derangements; rng is any function returning [0, 1).
export function randomDerangement(rng = Math.random) {
  return DERANGEMENTS[Math.floor(rng() * DERANGEMENTS.length)];
}

// Seat picks three tiles (by id) to pass. A pick is final. Returns false if it isn't allowed:
// not the exchange, already picked, or not exactly three distinct non-wild tiles of their hand.
// The last pick makes the exchange (sigma can be given, for tests) and the dealer draws next.
export function chooseExchange(state, seat, ids, sigma = null) {
  if (state.phase !== 'exchange' || state.exchange.picks[seat] || !Array.isArray(ids)) return false;
  const hand = state.players[seat].hand;
  const tiles = ids.map((id) => hand.find((t) => t.id === id));
  if (tiles.length !== 3 || new Set(ids).size !== 3 || tiles.some((t) => !t || isWild(t))) return false;
  state.exchange.picks[seat] = [...ids];
  if (state.exchange.picks.every(Boolean)) makeExchange(state, sigma ?? randomDerangement());
  return true;
}

function makeExchange(state, sigma) {
  const passed = state.exchange.picks.map((ids, n) => {
    const hand = state.players[n].hand;
    return ids.map((id) => hand.splice(hand.findIndex((t) => t.id === id), 1)[0]);
  });
  passed.forEach((tiles, n) => state.players[sigma[n]].hand.push(...tiles));
  for (const p of state.players) sortHand(p.hand);
  state.passes = [...sigma];
  state.exchange = null;
  state.phase = 'draw'; // the dealer's first draw
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

// Once a kan stands, the kan player is due a replacement tile: the hand waits in the
// 'rinshan' phase (the server pauses briefly here, like before a normal draw) until draw().
function awaitRinshan(state, seat) {
  state.current = seat;
  state.phase = 'rinshan';
}

// The replacement tile comes from the dead wall, and the last tile of the live wall moves to
// the dead wall, so the live wall (and everyone's remaining draws) is one tile shorter. A
// tsumo on the replacement tile is rinshan kaihou.
function drawRinshan(state) {
  const tile = state.deadWall[state.rinshanUsed];
  state.deadWall[state.rinshanUsed] = null;
  state.rinshanUsed++;
  state.deadWall.push(state.wall.pop());
  const player = state.players[state.current];
  clearRiichiCallouts(state);
  player.drawn = tile;
  player.rinshan = true;
  state.phase = 'discard';
  return tile;
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
  // With a wild tile the readings can't be listed the same way, so the kan must simply leave
  // the waits exactly as they were.
  if (hand.some(isWild)) {
    const before = getWaits(hand);
    const after = getWaits(hand.filter((t) => isWild(t) || tileIndex(t) !== k));
    return before.length > 0 && before.join() === after.join();
  }
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
  player.callout = 'kan';
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
    if (p.seat === seat || p.won) continue;
    const tiles = [...p.hand, tile];
    const counts = toCounts(tiles);
    const wilds = tiles.filter(isWild).length;
    const ron = (kokushiOnly ? p.melds.length === 0 && kokushiWithWild(counts, wilds) : completeWithWild(counts, wilds)) && !isFuritenNow(state, p.seat) &&
      hasYaku(state, p.seat, tile, false, { chankan: true });
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
  awaitRinshan(state, seat);
}

// --- Riichi ---

// Tiles (by id) the current player could discard to declare riichi: the ones that leave
// the hand tenpai. Empty if riichi isn't allowed right now: it needs a closed hand (no open
// melds), no riichi yet, 1000 points for the stick, and at least 4 tiles left in the wall.
export function riichiDiscards(state, seat) {
  const player = state.players[seat];
  if (state.phase !== 'discard' || state.current !== seat || !player.drawn || player.riichi) return [];
  if (player.melds.some((m) => m.open)) return [];
  if ((!state.rules.contest && state.scores[seat] < 1000) || state.wall.length < 4) return []; // contest riichi is free
  const tiles = [...player.hand, player.drawn];
  return tiles.filter((t) => !isWild(t) && isTenpai(tiles.filter((x) => x !== t))).map((t) => t.id);
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
  player.callout = 'riichi';
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
  if (isWild(tile)) return WILD_KIND;
  return SUITS.indexOf(tile.suit) * 9 + tile.rank - 1;
}

export function kindLabel(index) {
  if (index === WILD_KIND) return '1A';
  const suit = SUITS[Math.floor(index / 9)];
  const rank = (index % 9) + 1;
  return suit === 'z' ? HONOR_NAMES[rank - 1] : `${rank}${suit}`;
}

export function toCounts(tiles) {
  const counts = new Array(34).fill(0);
  for (const t of tiles) if (!isWild(t)) counts[tileIndex(t)]++; // a wild tile fits no set (yet)
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
// With a wild tile, the waits are every kind that completes the hand for some value of it.
export function getWaits(tiles) {
  const counts = toCounts(tiles);
  const wilds = tiles.filter(isWild).length;
  const waits = [];
  for (let k = 0; k < 34; k++) {
    counts[k]++;
    if (completeWithWild(counts, wilds)) waits.push(k);
    counts[k]--;
  }
  return waits;
}

// --- Hand shapes with wild tiles ---
// A wild tile stands for any kind, as many copies as needed. Rather than trying all 34 values,
// each shape check lets wild tiles fill the gaps directly. With no wild tiles these are the
// usual checks.

// Tiles (wild tiles included) that make a complete hand.
export function isCompleteTiles(tiles) {
  return completeWithWild(toCounts(tiles), tiles.filter(isWild).length);
}

function completeWithWild(counts, wilds) {
  if (wilds === 0) return isComplete(counts);
  return standardWithWild(counts, wilds) || chiitoiWithWild(counts, wilds) || kokushiWithWild(counts, wilds);
}

// A pair (natural, one tile and a wild, or two wilds) and sets.
function standardWithWild(counts, wilds) {
  for (let k = 0; k < 34; k++) {
    for (const own of [2, 1]) {
      if (counts[k] < own || wilds < 2 - own) continue;
      counts[k] -= own;
      const ok = setsWithWild(counts, wilds - (2 - own));
      counts[k] += own;
      if (ok) return true;
    }
  }
  return wilds >= 2 && setsWithWild(counts, wilds - 2);
}

// The counts split into triplets and sequences, wild tiles filling in. The lowest remaining
// tile must be in some set: a triplet of it, or a run through it (a run starting below it
// takes its lower tiles from wild tiles, since nothing lower is left).
function setsWithWild(counts, wilds) {
  const i = counts.findIndex((c) => c > 0);
  if (i === -1) return wilds % 3 === 0;
  const own = Math.min(counts[i], 3);
  if (3 - own <= wilds) {
    counts[i] -= own;
    const ok = setsWithWild(counts, wilds - (3 - own));
    counts[i] += own;
    if (ok) return true;
  }
  if (i >= 27) return false; // honors make no runs
  for (let start = i - 2; start <= i; start++) {
    if (start < 0 || Math.floor(start / 9) !== Math.floor(i / 9) || start % 9 > 6) continue;
    const taken = [];
    let need = 0;
    for (let j = start; j < start + 3; j++) {
      if (j >= i && counts[j] > 0) {
        counts[j]--;
        taken.push(j);
      } else {
        need++;
      }
    }
    const ok = need <= wilds && setsWithWild(counts, wilds - need);
    for (const j of taken) counts[j]++;
    if (ok) return true;
  }
  return false;
}

// Seven distinct pairs, wild tiles pairing up the single tiles (or each other).
function chiitoiWithWild(counts, wilds) {
  if (counts.reduce((a, b) => a + b, 0) + wilds !== 14 || counts.some((c) => c > 2)) return false;
  const pairs = counts.filter((c) => c === 2).length;
  const singles = counts.filter((c) => c === 1).length;
  const spare = wilds - singles;
  return spare >= 0 && spare % 2 === 0 && pairs + singles + spare / 2 === 7;
}

// One of each terminal and honor plus one more of them, wild tiles filling in.
function kokushiWithWild(counts, wilds) {
  if (wilds === 0) return isKokushi(counts);
  if (counts.reduce((a, b) => a + b, 0) + wilds !== 14) return false;
  if (counts.some((c, k) => c > 0 && !TERMINALS_AND_HONORS.includes(k)) || counts.some((c) => c > 2)) return false;
  const pairs = counts.filter((c) => c === 2).length;
  const missing = TERMINALS_AND_HONORS.filter((k) => counts[k] === 0).length;
  return pairs <= 1 && wilds === missing + 1 - pairs;
}

// Baiman contest: a hand whose other tiles are already complete sets, or six distinct pairs,
// wins on (nearly) any tile: with four sets the wild tile pairs anything, and six distinct pairs
// make seven pairs with any of the 28 other kinds (the paired kinds win only if the hand also
// reads as runs, e.g. ryanpeikou, which then scores more). Either way its waits are shown as
// the wild tile alone; getWaits still lists the real ones, for winning and furiten.
export function waitsOnAnything(hand) {
  if (!hand.some(isWild)) return false;
  const rest = hand.filter((t) => !isWild(t));
  const counts = toCounts(rest);
  if (rest.length % 3 === 0 && canFormSets(counts)) return true;
  return rest.length === 12 && counts.filter((c) => c === 2).length === 6;
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
  const tiles = [
    ...state.wall,
    ...state.deadWall.filter(Boolean), // drawn replacement tiles leave empty slots
    ...state.players.flatMap((p) => [...p.hand, ...(p.drawn ? [p.drawn] : []), ...p.discards, ...meldTiles(p)]),
    ...(state.robbed ? [state.robbed] : []),
    ...state.wins.filter((w) => w.robbed).map((w) => w.tile), // Baiman contest: robbed kan tiles
  ];
  // 136 tiles, plus the Baiman contest's wild tiles (at most four), each exactly once.
  const wilds = tiles.filter(isWild).length;
  const unique = new Set(tiles.map((t) => t.id));
  return wilds <= 4 && tiles.length === 136 + wilds && unique.size === tiles.length;
}
