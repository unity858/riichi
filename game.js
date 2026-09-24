// Core game state and turn logic. No DOM access here.

export const SUITS = ['m', 'p', 's', 'z'];
export const HONOR_NAMES = ['E', 'S', 'W', 'N', 'Wh', 'G', 'R'];
export const WINDS = ['E', 'S', 'W', 'N'];

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

export function newHand({ dealer = 0, roundWind = 0 } = {}) {
  const wall = createWall();
  const deadWall = wall.splice(wall.length - 14, 14);
  const doraIndicators = [deadWall[4]];

  const players = [0, 1, 2, 3].map((seat) => ({
    seat,
    hand: [],
    drawn: null,
    discards: [],
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
    players,
    dealer,
    current: dealer,
    phase: 'draw',
    roundWind,
    turnCount: 0,
  };

  // Dealer takes their 14th tile, so play starts in their discard phase.
  draw(state);
  return state;
}

export function draw(state) {
  if (state.phase !== 'draw') return null;
  if (state.wall.length === 0) {
    state.phase = 'ended';
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

  state.turnCount++;
  state.current = (state.current + 1) % 4;
  state.phase = state.wall.length === 0 ? 'ended' : 'draw';
  return tile;
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
