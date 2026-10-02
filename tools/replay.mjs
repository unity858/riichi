// Reads the match database (see db.js) and replays recorded hands.
//
//   node tools/replay.mjs list             recorded matches
//   node tools/replay.mjs match <id>       the hands of a match
//   node tools/replay.mjs hand <id>        a hand move by move, then replayed from its seed and
//                                          checked against the recorded result
//
// --db <file> reads another database (default: matches.db next to server.js, or DB_PATH).

import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { replayHand } from '../replay.js';
import { checkIntegrity } from '../game.js';

const args = process.argv.slice(2);
const dbAt = args.indexOf('--db');
const file = dbAt >= 0 ? args.splice(dbAt, 2)[1]
  : process.env.DB_PATH || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'matches.db');
const [command, id] = args;
const db = new DatabaseSync(file, { readOnly: true });
const WINDS = ['E', 'S', 'W', 'N'];

if (command === 'list') {
  for (const m of db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM hands h WHERE h.match_id = m.id) AS hands FROM matches m ORDER BY m.id`).all()) {
    const final = m.final ? JSON.parse(m.final) : null;
    const scores = final ? final.ranking.map((r) => `${JSON.parse(m.players)[r.seat]} ${r.score}`).join(', ') : 'unfinished';
    console.log(`match ${m.id}  room ${m.room}  ${m.started_at}  ${m.hands} hands  ${scores}${m.debug ? '  (DEBUG_SEED)' : ''}`);
  }
} else if (command === 'match') {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(Number(id));
  if (!m) fail(`no match ${id}`);
  console.log(`match ${m.id}, room ${m.room}, players ${JSON.parse(m.players).join(', ')}, started ${m.started_at}`);
  for (const h of db.prepare('SELECT * FROM hands WHERE match_id = ? ORDER BY number').all(m.id)) {
    const r = h.result ? JSON.parse(h.result) : null;
    console.log(`  hand ${h.id}: ${h.label}, ${h.honba} honba: ${r ? `${r.type}${r.winners ? ` by ${r.winners.map((s) => seatName(h, s)).join(', ')}` : ''}, ${r.deltas.join(' / ')}` : 'unfinished'}`);
  }
} else if (command === 'hand') {
  const h = db.prepare('SELECT * FROM hands WHERE id = ?').get(Number(id));
  if (!h) fail(`no hand ${id}`);
  const actions = db.prepare('SELECT data FROM actions WHERE hand_id = ? ORDER BY seq').all(h.id).map((a) => JSON.parse(a.data));
  console.log(`hand ${h.id}: ${h.label}, ${h.honba} honba, dealer seat ${h.dealer}\nseed: ${h.seed}`);
  for (const a of actions) console.log(`  ${describe(h, a)}`);
  const start = {
    seed: h.seed, dealer: h.dealer, roundWind: h.round_wind, honba: h.honba, riichiSticks: h.riichi_sticks,
    scores: JSON.parse(h.scores), rules: JSON.parse(h.rules),
  };
  const s = replayHand(start, actions);
  const recorded = h.result ? JSON.parse(h.result) : null;
  if (!recorded) {
    console.log(`unfinished: replayed ${actions.length} actions (phase ${s.phase}, integrity ${checkIntegrity(s)})`);
  } else {
    const same = s.result && s.result.type === recorded.type && s.result.deltas.join() === recorded.deltas.join();
    console.log(`replayed: ${s.result?.type}, ${s.result?.deltas.join(' / ')}: ${same ? 'matches the recorded result' : 'DIFFERS from the recorded result'}`);
    if (!same) process.exitCode = 1;
  }
} else {
  fail('usage: node tools/replay.mjs [--db file] list | match <id> | hand <id>');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// Seat winds are relative to the hand's dealer.
function seatName(h, seat) {
  return WINDS[(seat - h.dealer + 4) % 4];
}

function describe(h, a) {
  const who = seatName(h, a.seat ?? a.seats?.[0]);
  switch (a.type) {
    case 'discard': return `${who} discards ${a.tile}${a.tsumogiri ? ' (tsumogiri)' : ''}${a.riichi ? ', riichi' : ''}`;
    case 'chii': case 'pon': case 'kan':
      return `${who} ${a.type === 'kan' ? 'kans' : `${a.type}s`} ${a.tile} from ${seatName(h, a.from)}, showing ${a.tiles.join(' ')}`;
    case 'ankan': return `${who} declares a closed kan of ${a.tiles.join(' ')}`;
    case 'kakan': return `${who} adds ${a.tile} to a pon`;
    case 'ron': return `${a.seats.map((s) => seatName(h, s)).join(' and ')} ron on ${a.tile} from ${seatName(h, a.from)}${a.chankan ? ' (robbing a kan)' : ''}`;
    case 'tsumo': return `${who} tsumo on ${a.tile}`;
    case 'kyuushu': return `${who} declares kyuushu kyuuhai`;
    default: return JSON.stringify(a);
  }
}

