// A match: the hands from East 1 to the end, carrying round wind, dealer, honba, riichi
// sticks and scores from hand to hand, and deciding when the match is over. No DOM, no sockets.

import { STARTING_SCORE } from './game.js';

export const WIND_NAMES = ['East', 'South', 'West', 'North'];

// Room settings for a new match. Every rule here is an option; defaults follow Mahjong Soul.
export const DEFAULT_SETTINGS = {
  format: 'standard', // 'standard', or 'baiman': the Baiman contest (see game.js)
  length: 'south', // 'east': East 1-4 only (tonpuusen); 'south': East 1 to South 4 (hanchan)
  bust: true, // the match ends as soon as someone is below 0 points
  extension: true, // if nobody has TARGET_SCORE after the last hand, play on into the next wind (sudden death)
  agariYame: true, // in the last hand, a dealer who repeats while in first place ends the match
  yakuRebalance: false, // house yaku values: see scoring.js (and nagashi in game.js)
  noHints: false, // no waits, discard previews, furiten, tsumogiri shading or ippatsu shown (see server.js)
  // Baiman contest only: 'baiman', the dealer repeats only after winning a baiman or sanbaiman
  // (a win worth a point); 'none', the deal always passes.
  contestRepeat: 'baiman',
};
export const TARGET_SCORE = 30000;
const LENGTHS = { east: 1, south: 2 }; // number of round winds in the regular match
const FORMATS = ['standard', 'baiman'];
const CONTEST_REPEATS = ['baiman', 'none'];
// The Baiman contest starts everyone on 0 and nobody loses points, so going bust and playing
// on to reach TARGET_SCORE don't apply; those settings are always off for it.
const CONTEST_OFF = ['bust', 'extension'];

// Accepts settings from a client, keeping only known keys with valid values.
export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS };
  if (input && typeof input === 'object') {
    if (input.length in LENGTHS) s.length = input.length;
    if (FORMATS.includes(input.format)) s.format = input.format;
    if (CONTEST_REPEATS.includes(input.contestRepeat)) s.contestRepeat = input.contestRepeat;
    for (const key of ['bust', 'extension', 'agariYame', 'yakuRebalance', 'noHints']) if (typeof input[key] === 'boolean') s[key] = input[key];
  }
  if (s.format === 'baiman') for (const key of CONTEST_OFF) s[key] = false;
  return s;
}

export function newMatch(settings = DEFAULT_SETTINGS) {
  const normalized = normalizeSettings(settings);
  const start = normalized.format === 'baiman' ? 0 : STARTING_SCORE;
  return {
    settings: normalized,
    roundWind: 0, // index into WIND_NAMES
    hand: 0, // 0-3: East 1 is roundWind 0, hand 0
    dealer: 0,
    startDealer: 0, // breaks ties in the final ranking
    honba: 0,
    riichiSticks: 0,
    scores: [0, 1, 2, 3].map(() => start),
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
  const rules = { yakuRebalance: match.settings.yakuRebalance, contest: match.settings.format === 'baiman' };
  return { dealer, roundWind, scores, riichiSticks, honba, rules };
}

// Seats from first to last place. Equal scores rank by turn order from the starting dealer.
export function ranking(match) {
  const order = (seat) => (seat - match.startDealer + 4) % 4;
  return [0, 1, 2, 3].sort((a, b) => match.scores[b] - match.scores[a] || order(a) - order(b));
}

// Records a finished hand (state from game.js, with state.result set) and moves the match on:
//   - The dealer repeats after winning (even as one of several ron winners), being tenpai
//     at an exhaustive draw, or an abortive draw; otherwise the deal passes to the next seat,
//     and after four deals the round wind advances.
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
  const { settings } = match;
  let dealerRepeats;
  match.history.push({ label: handLabel(match), honba: match.honba, type: result.type, winners: result.winners ?? [], deltas: result.deltas });
  if (settings.format === 'baiman') {
    // Baiman contest: the contestRepeat setting alone decides (draws and kyuushu never repeat),
    // and honba count the dealer's repeats in a row.
    dealerRepeats = settings.contestRepeat === 'baiman' && (result.wins ?? []).some((w) => w.seat === match.dealer && w.points > 0);
    match.honba = dealerRepeats ? match.honba + 1 : 0;
  } else {
    // An abortive draw counts as a draw where the dealer repeats.
    const aborted = result.type === 'abortiveDraw';
    const draw = result.type === 'exhaustiveDraw' || aborted;
    dealerRepeats = aborted || (draw ? result.tenpai.includes(match.dealer) : result.winners.includes(match.dealer));
    match.honba = dealerRepeats || draw ? match.honba + 1 : 0;
  }

  const regularWinds = LENGTHS[settings.length];
  const lastRegular = match.roundWind === regularWinds - 1 && match.hand === 3;
  const inExtension = match.roundWind >= regularWinds;
  const someoneReached = match.scores.some((s) => s >= TARGET_SCORE);
  const dealerTop = ranking(match)[0] === match.dealer;

  if (settings.bust && match.scores.some((s) => s < 0)) return finish(match, 'bust');
  if (result.type === 'contest' && result.yakuman) return finish(match, 'yakuman'); // Baiman contest

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
