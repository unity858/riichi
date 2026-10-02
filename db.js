// Records standard matches in an SQLite database (Node's built-in node:sqlite), so every hand
// can be recovered or replayed: replay.js rebuilds a hand from its seed and its actions.
//
//   matches  one row per match: room code, start and end times, settings, players, final result
//   hands    one row per hand: the wall's full order (seed: live and dead wall), the starting
//            dealer, round wind, honba, riichi sticks and scores, and the result once it ends
//   actions  every action of a hand in order (state.log: discards, calls with the tiles they
//            reveal, kans, ron, tsumo, kyuushu kyuuhai); draws and passes follow from the rest
//
// Actions are written as they happen, so even a hand cut off by a server restart can be
// recovered up to its last action. Times are ISO 8601 in UTC; JSON columns hold tiles in seed
// notation (5m, 0p for a red five, 7z). Baiman contest matches aren't recorded.

import { DatabaseSync } from 'node:sqlite';
import { tileCode } from './game.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS matches (
  id         INTEGER PRIMARY KEY,
  room       TEXT NOT NULL,     -- the room code, e.g. 3fa9c1
  started_at TEXT NOT NULL,
  ended_at   TEXT,              -- set when the match is over
  settings   TEXT NOT NULL,     -- JSON: the room's settings
  players    TEXT NOT NULL,     -- JSON: names by seat (seat 0 deals first)
  debug      INTEGER NOT NULL,  -- 1 if the server ran with DEBUG_SEED (fixed walls)
  final      TEXT               -- JSON: { reason, ranking: [{ seat, place, score }] }
);
CREATE TABLE IF NOT EXISTS hands (
  id            INTEGER PRIMARY KEY,
  match_id      INTEGER NOT NULL REFERENCES matches(id),
  number        INTEGER NOT NULL,  -- 1, 2, ... within the match
  label         TEXT NOT NULL,     -- e.g. 'East 1'
  dealer        INTEGER NOT NULL,
  round_wind    INTEGER NOT NULL,  -- 0 East, 1 South, ...
  honba         INTEGER NOT NULL,
  riichi_sticks INTEGER NOT NULL,
  scores        TEXT NOT NULL,     -- JSON: scores at the start of the hand, by seat
  rules         TEXT NOT NULL,     -- JSON: { yakuRebalance, contest }
  seed          TEXT NOT NULL,     -- all 136 tiles in wall order (see seed.js)
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  result        TEXT               -- JSON: the hand's result (see endHand in game.js)
);
CREATE TABLE IF NOT EXISTS actions (
  hand_id INTEGER NOT NULL REFERENCES hands(id),
  seq     INTEGER NOT NULL,   -- 0, 1, ... in play order
  type    TEXT NOT NULL,      -- discard, chii, pon, kan, ankan, kakan, ron, tsumo, kyuushu
  seat    INTEGER,            -- who acted (for ron: the first winner; all are in data)
  data    TEXT NOT NULL,      -- JSON: the whole action, as in state.log
  PRIMARY KEY (hand_id, seq)
);
CREATE INDEX IF NOT EXISTS hands_by_match ON hands (match_id, number);
`;

// Tiles as seed notation in stored JSON (results hold tile objects).
const json = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && 'suit' in v && 'rank' in v ? tileCode(v) : v));
const now = () => new Date().toISOString();

export function openRecorder(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;'); // readers can query while the server writes
  db.exec(SCHEMA);
  const q = {
    match: db.prepare('INSERT INTO matches (room, started_at, settings, players, debug) VALUES (?, ?, ?, ?, ?)'),
    matchEnd: db.prepare('UPDATE matches SET ended_at = ?, final = ? WHERE id = ?'),
    hand: db.prepare(`INSERT INTO hands (match_id, number, label, dealer, round_wind, honba, riichi_sticks, scores, rules, seed, started_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    handEnd: db.prepare('UPDATE hands SET ended_at = ?, result = ? WHERE id = ?'),
    action: db.prepare('INSERT INTO actions (hand_id, seq, type, seat, data) VALUES (?, ?, ?, ?, ?)'),
  };
  // A recording problem must never stop the game: it is logged and play goes on.
  const safely = (what, fn) => {
    try {
      return fn();
    } catch (err) {
      console.error(`Recording ${what} failed: ${err.message}`);
      return null;
    }
  };

  return {
    db,
    // A new match in room (a standard one; others are skipped). Sets room.record.
    startMatch(room, { debug = false } = {}) {
      room.record = null;
      if (room.match.settings.format !== 'standard') return;
      safely('a match', () => {
        const players = room.seats.map((p) => p?.name ?? null);
        const { lastInsertRowid } = q.match.run(room.code, now(), JSON.stringify(room.match.settings), JSON.stringify(players), debug ? 1 : 0);
        room.record = { matchId: Number(lastInsertRowid), hands: 0, handId: null, logged: 0, handDone: false, matchDone: false };
      });
    },
    // A new hand of the recorded match, dealt from `seed`.
    startHand(room, seed, label) {
      const r = room.record;
      if (!r) return;
      safely('a hand', () => {
        const s = room.state;
        r.hands++;
        const { lastInsertRowid } = q.hand.run(r.matchId, r.hands, label, s.dealer, s.roundWind, s.honba, s.riichiSticks,
          JSON.stringify(s.scores), JSON.stringify(s.rules), seed, now());
        Object.assign(r, { handId: Number(lastInsertRowid), logged: 0, handDone: false });
      });
    },
    // Writes whatever has happened since the last call: new actions, the hand's result, the
    // match's end. Called after every change to the room's game.
    sync(room) {
      const r = room.record;
      const s = room.state;
      if (!r || !r.handId || !s) return;
      safely('actions', () => {
        for (; r.logged < s.log.length; r.logged++) {
          const a = s.log[r.logged];
          q.action.run(r.handId, r.logged, a.type, a.seat ?? a.seats?.[0] ?? null, JSON.stringify(a));
        }
        if (s.phase === 'ended' && !r.handDone) {
          r.handDone = true;
          q.handEnd.run(now(), json(s.result), r.handId);
        }
        if (room.match?.over && !r.matchDone) {
          r.matchDone = true;
          q.matchEnd.run(now(), JSON.stringify(room.match.final), r.matchId);
        }
      });
    },
    // Recorded matches, newest first: { id, room, startedAt }. Matches played with DEBUG_SEED
    // (test games) are left out.
    listMatches() {
      return db.prepare('SELECT id, room, started_at AS startedAt FROM matches WHERE debug = 0 ORDER BY id DESC').all()
        .map((m) => ({ id: m.id, room: m.room, startedAt: m.startedAt }));
    },
    close() {
      db.close();
    },
  };
}
