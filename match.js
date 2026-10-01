// A match: the hands from East 1 to the end, carrying round wind, dealer, honba, riichi
// sticks and scores from hand to hand, and deciding when the match is over. No DOM, no sockets.

import { STARTING_SCORE } from './game.js';

export const WIND_NAMES = ['East', 'South', 'West', 'North'];

// Room settings for a new match. Every rule here is an option; defaults follow Mahjong Soul.
export const DEFAULT_SETTINGS = {
  length: 'south', // 'east': East 1-4 only (tonpuusen); 'south': East 1 to South 4 (hanchan)
  bust: true, // the match ends as soon as someone is below 0 points
  extension: true, // if nobody has TARGET_SCORE after the last hand, play on into the next wind (sudden death)
  agariYame: true, // in the last hand, a dealer who repeats while in first place ends the match
};
export const TARGET_SCORE = 30000;
const LENGTHS = { east: 1, south: 2 }; // number of round winds in the regular match

// Accepts settings from a client, keeping only known keys with valid values.
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  if (input && typeof input === 'object') {
    if (input.length in LENGTHS) s.length = input.length;
    for (const key of ['bust', 'extension', 'agariYame']) if (typeof input[key] === 'boolean') s[key] = input[key];
  }
  return s;
}

export function newMatch(settings = DEFAULT_SETTINGS) {
  return {
    settings: normalizeSettings(settings),
    roundWind: 0, // index into WIND_NAMES
    hand: 0, // 0-3: East 1 is roundWind 0, hand 0
    dealer: 0,
    startDealer: 0, // breaks ties in the final ranking
    honba: 0,
    riichiSticks: 0,
    scores: [0, 1, 2, 3].map(() => STARTING_SCORE),
    over: false,
    final: null, // set when the match ends, see finish()
    history: [], // one entry per finished hand
  };
}

// "East 1", "South 3", ...
export function handLabel(match) {
  return `${WIND_NAMES[match.roundWind]} ${match.hand + 1}`;
}

// What newHand needs for the next hand.
export function handSettings(match) {
  const { dealer, roundWind, scores, riichiSticks, honba } = match;
  return { dealer, roundWind, scores, riichiSticks, honba };
}

// Seats from first to last place. Equal scores rank by turn order from the starting dealer.
export function ranking(match) {
  const order = (seat) => (seat - match.startDealer + 4) % 4;
  return [0, 1, 2, 3].sort((a, b) => match.scores[b] - match.scores[a] || order(a) - order(b));
}

// Records a finished hand (state from game.js, with state.result set) and moves the match on:
//   - The dealer repeats after winning (even as one of several ron winners) or being tenpai
//     at an exhaustive draw; otherwise the deal passes to the next seat, and after four
//     deals the round wind advances.
//   - Honba go up by one on a dealer repeat and on every exhaustive draw (even when the
//     dealer was noten and the deal passes), and reset to 0 when a non-dealer wins.
//   - The match ends when someone is below 0 (bust), or at the end of the last hand: after
//     the last regular hand, unless nobody has TARGET_SCORE and extension is on, in which
//     case it goes on into the next wind until someone has TARGET_SCORE (or that wind ends).
//     A dealer repeat in the last hand continues the match, unless agari-yame applies.
export function recordHand(match, state) {
  const result = state.result;
  match.scores = [...state.scores];
  match.riichiSticks = state.riichiSticks;
  const draw = result.type === 'exhaustiveDraw';
  const dealerRepeats = draw ? result.tenpai.includes(match.dealer) : result.winners.includes(match.dealer);
  match.history.push({ label: handLabel(match), honba: match.honba, type: result.type, winners: result.winners ?? [], deltas: result.deltas });
  match.honba = dealerRepeats || draw ? match.honba + 1 : 0;

  const { settings } = match;
  const regularWinds = LENGTHS[settings.length];
  const lastRegular = match.roundWind === regularWinds - 1 && match.hand === 3;
  const inExtension = match.roundWind >= regularWinds;
  const someoneReached = match.scores.some((s) => s >= TARGET_SCORE);
  const dealerTop = ranking(match)[0] === match.dealer;

  if (settings.bust && match.scores.some((s) => s < 0)) return finish(match, 'bust');

  if (dealerRepeats) {
    // A repeat keeps the dealer, except in the last hand when agari-yame ends the match: the
    // dealer must be in first place (and, with extension on, have TARGET_SCORE).
    const last = lastRegular || inExtension;
    const reached = !settings.extension || match.scores[match.dealer] >= TARGET_SCORE;
    if (last && settings.agariYame && dealerTop && reached) return finish(match, 'agari-yame');
    if (inExtension && someoneReached && dealerTop) return finish(match, 'target reached');
    return match;
  }

  if (lastRegular && (!settings.extension || someoneReached)) return finish(match, 'last hand');
  if (inExtension && someoneReached) return finish(match, 'target reached');
  match.dealer = (match.dealer + 1) % 4;
  match.hand++;
  if (match.hand === 4) {
    match.hand = 0;
    match.roundWind++;
    // Extension lasts one wind at most.
    if (match.roundWind > regularWinds) return finish(match, 'extension over');
  }
  return match;
}

// Ends the match: riichi sticks still on the table go to first place.
function finish(match, reason) {
  const order = ranking(match);
  if (match.riichiSticks > 0) {
    match.scores[order[0]] += match.riichiSticks * 1000;
    match.riichiSticks = 0;
  }
  match.over = true;
  match.final = {
    reason,
    ranking: ranking(match).map((seat, i) => ({ seat, place: i + 1, score: match.scores[seat] })),
  };
  return match;
}
