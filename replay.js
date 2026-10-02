// Replays a recorded hand: the wall's order (its seed) plus the actions in state.log rebuild the
// whole hand, move for move. Draws and passes aren't recorded; they follow from the rest:
// whenever play waits for a draw it is made, and a discard nobody is recorded as calling is
// passed by everyone. Standard games only (a Baiman contest's tile exchange isn't recorded).
// No DOM, no sockets.

import {
  newHand, draw, discard, claim, tsumo, declareRiichi, declareKan, declareKyuushu,
  tileCode, tileIndex, isWild, ponOptions, chiiOptions, openKanOptions,
} from './game.js';
import { wallFromSeed } from './seed.js';

// start: { seed, dealer, roundWind, scores, riichiSticks, honba, rules }, as recorded for the
// hand; actions: its state.log. Returns the replayed state (ended, if the hand finished).
// Throws if an action can't be replayed, which would mean the record is wrong.
export function replayHand(start, actions, { finish = true } = {}) {
  const { seed, dealer, roundWind, scores, riichiSticks, honba, rules } = start;
  const s = newHand({ dealer, roundWind, scores, riichiSticks, honba, rules, wall: wallFromSeed(seed) });
  actions.forEach((action, i) => {
    settle(s, action);
    if (!apply(s, action)) throw new Error(`action ${i} (${JSON.stringify(action)}) can't be replayed in phase ${s.phase}`);
  });
  if (finish && s.phase === 'claim') passAll(s); // the hand's last discard, which nobody called
  return s;
}

// The hand step by step, for the replay page. The steps, in order:
//   { type: 'start', seat }        the hand dealt, the dealer holding their first draw
//   { type: 'draw', seat, tile }   a draw (or a kan's replacement tile), after any passes
//   { type: <action>, seat, action } each recorded action (see state.log)
//   { type: 'end' }                only if the hand isn't over after its last action: its last
//                                  discard, still open to calls, passes and the hand ends
// Returns { state, steps }: with upTo, the state just after step upTo (steps listed up to it),
// otherwise the whole hand. A discard nobody calls stays open until the next step (the draw),
// so the step after a discard shows it while others could still call it.
export function replaySteps(start, actions, upTo = Infinity) {
  const { seed, dealer, roundWind, scores, riichiSticks, honba, rules } = start;
  const s = newHand({ dealer, roundWind, scores, riichiSticks, honba, rules, wall: wallFromSeed(seed) });
  const steps = [{ type: 'start', seat: s.current }];
  const done = () => ({ state: s, steps });
  const more = () => steps.length <= upTo;
  for (const [i, action] of actions.entries()) {
    for (;;) {
      const open = s.phase === 'claim' && !CALLS.includes(action.type);
      if (!open && s.phase !== 'draw' && s.phase !== 'rinshan') break;
      if (!more()) return done();
      if (open) passAll(s);
      if (s.phase === 'draw' || s.phase === 'rinshan') {
        draw(s);
        steps.push({ type: 'draw', seat: s.current, tile: tileCode(s.players[s.current].drawn) });
      }
    }
    if (!more()) return done();
    if (!apply(s, action)) throw new Error(`action ${i} (${JSON.stringify(action)}) can't be replayed in phase ${s.phase}`);
    steps.push({ type: action.type, seat: action.seat ?? action.seats?.[0], action });
  }
  if (s.phase === 'claim' && more()) {
    passAll(s);
    if (s.phase === 'ended') steps.push({ type: 'end' });
  }
  return done();
}

const CALLS = ['chii', 'pon', 'kan', 'ron'];

// Makes the draws and passes that come before the action.
function settle(s, action) {
  for (;;) {
    if (s.phase === 'draw' || s.phase === 'rinshan') draw(s);
    else if (s.phase === 'claim' && !CALLS.includes(action.type)) passAll(s);
    else return;
  }
}

function passAll(s) {
  for (const seat of Object.keys(s.claims).map(Number)) {
    if (s.claims[seat] === null) claim(s, seat, 'pass');
  }
}

function apply(s, a) {
  const player = s.players[a.seat ?? 0];
  switch (a.type) {
    case 'discard': {
      // The tile just drawn, or a tile of that kind (and look) from the hand.
      const tile = a.tsumogiri ? player.drawn : player.hand.find((t) => !isWild(t) && tileCode(t) === a.tile);
      if (!tile || tileCode(tile) !== a.tile || s.current !== a.seat) return false;
      return a.riichi ? declareRiichi(s, a.seat, tile.id) : !!discard(s, tile.id);
    }
    case 'chii':
    case 'pon':
    case 'kan': {
      const options = { chii: chiiOptions, pon: ponOptions, kan: openKanOptions }[a.type](s, a.seat);
      const want = [...a.tiles].sort().join();
      const option = options.find((ids) => ids.map((id) => tileCode(player.hand.find((t) => t.id === id))).sort().join() === want);
      if (!option || !claim(s, a.seat, a.type, option)) return false;
      passAll(s);
      return true;
    }
    case 'ron': {
      if (!a.seats.every((seat) => claim(s, seat, 'ron'))) return false;
      passAll(s);
      return true;
    }
    case 'tsumo':
      return tsumo(s, a.seat);
    case 'ankan':
    case 'kakan':
      return declareKan(s, a.seat, tileIndex(codeTile(a.type === 'ankan' ? a.tiles[0] : a.tile)));
    case 'kyuushu':
      return declareKyuushu(s, a.seat);
    default:
      return false;
  }
}

// A tile kind from seed notation, for tileIndex.
const codeTile = (code) => ({ suit: code.slice(-1), rank: code[0] === '0' ? 5 : Number(code[0]) });
