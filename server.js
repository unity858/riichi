// HTTP static file server + WebSocket game server. The server owns every room's game state;
// clients only send intents and render the view they're given.
//
// Rooms: a player creates a room (getting a random 6-hex-digit code) or joins one by code,
// under a name of their choosing. Each room has four seats, settings chosen by its host, and
// its own match. Players are recognised by an id their tab keeps, so reloading a tab gets the
// same seat back. Before the match starts, a player who leaves frees their seat; once it has
// started, the seat is kept for them and anyone else joining watches as a spectator.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  newHand, draw, discard, tsumo, claim, canTsumo, canRon, ponOptions, chiiOptions, riichiDiscards, declareRiichi,
  canKyuushu, declareKyuushu, kanOptions, declareKan, openKanOptions, waitYaku, discardPreview,
  autoDiscardDue, furitenStatus, createWall, checkIntegrity,
} from './game.js';
import { newMatch, recordHand, handSettings, handLabel, normalizeSettings } from './match.js';
import { wallFromSeed, seedFromWall } from './seed.js';

// How long a riichi player's unusable draw is shown before it is discarded for them.
const AUTO_DISCARD_MS = 1000;
// Pause after a discard nobody can call, before the next draw. A discard somebody can call
// makes everyone wait while they decide, so without this pause the wait itself would show
// that someone had an option. DRAW_DELAY_MS overrides it (e.g. 0 for automated tests).
const DRAW_DELAY_MS = Number(process.env.DRAW_DELAY_MS ?? 2000);
// Pause after a kan, before the replacement draw. The pause when an added kan could be robbed
// (chankan) then looks like any other kan's.
const KAN_DRAW_MS = 500;
// A room with nobody connected is deleted after this long.
const EMPTY_ROOM_MS = 10 * 60 * 1000;

// Debugging: DEBUG_SEED fixes the wall order of every hand (see seed.js), given either as
// the seed itself or as a path to a file containing it. Checked at startup.
const SEED = (() => {
  const value = process.env.DEBUG_SEED;
  if (!value) return null;
  const text = fs.existsSync(value) ? fs.readFileSync(value, 'utf8') : value;
  try {
    wallFromSeed(text);
  } catch (err) {
    console.error(`DEBUG_SEED is invalid: ${err.message}`);
    process.exit(1);
  }
  console.log(`DEBUG_SEED set: every hand uses the fixed wall order${fs.existsSync(value) ? ` from ${value}` : ''}`);
  return text;
})();

const PORT = process.env.PORT || 8080;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = new Set(['/index.html', '/style.css', '/ui.js', '/game.js', '/scoring.js']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  // Strip the query first: room links (and reloads) are /?room=<code>.
  const pathname = req.url.split('?')[0];
  const url = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC.has(url)) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(path.join(ROOT, url), (err, data) => {
    if (err) return res.writeHead(500).end('Error');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(url)] });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

// --- Rooms ---
// room: { code, settings, hostId, seats: [{ id, name, ws } | null] x4, spectators: Set<ws>,
//         match, state, emptyTimer }
const rooms = new Map();

function newCode() {
  let code;
  do code = crypto.randomBytes(3).toString('hex'); while (rooms.has(code));
  return code;
}

function cleanName(name) {
  const trimmed = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return trimmed || 'Player';
}

const connected = (room) => room.seats.filter((p) => p?.ws).length + room.spectators.size;
const seatOf = (room, ws) => room.seats.findIndex((p) => p?.ws === ws);

function hostSeat(room) {
  return room.seats.findIndex((p) => p?.id === room.hostId);
}

// Per-seat game view: your own hand is visible, others show only a tile count. When a hand
// ends, the winners' hands are shown to everyone; after a draw, the result lists them
// (tenpai players and nagashi mangan winners after an exhaustive draw).
function gameView(state, seat) {
  if (!state) return null;
  const revealed = state.result?.winners ?? state.result?.revealed ?? [];
  const visible = (p) => p.seat === seat || revealed.includes(p.seat);
  const me = seat !== null && seat >= 0 ? seat : null;
  // While players decide on a discard (or a kan that could be robbed), only they see it: to
  // everyone else this looks exactly like the pause before the next draw, so nothing shows
  // that someone could call.
  const deciding = state.phase === 'claim' && me !== null &&
    (canRon(state, me) || ponOptions(state, me).length > 0 || chiiOptions(state, me).length > 0 || openKanOptions(state, me).length > 0);
  const hidden = state.phase === 'claim' && !deciding;
  // Hidden decisions look like the pause they replace: before a draw, or (for a kan that could
  // be robbed) before the replacement draw.
  const shownPhase = hidden ? (state.lastDiscard.chankan ? 'rinshan' : 'draw') : state.phase;
  // Whose turn to show: the player discarding, and after a discard still that player until
  // the tile is called or skipped and the next player draws. It is the same whether or not
  // someone could call the tile (or rob a kan, where the kan player keeps it).
  let turn = state.current;
  if (state.phase === 'claim') turn = state.lastDiscard.from;
  else if (state.phase === 'draw') turn = state.discardLog.at(-1)?.from ?? state.current;
  return {
    dealer: state.dealer,
    current: state.current,
    turn,
    phase: shownPhase,
    roundWind: state.roundWind,
    scores: state.scores,
    riichiSticks: state.riichiSticks,
    honba: state.honba,
    wallCount: state.wall.length,
    doraIndicators: state.doraIndicators,
    lastDiscard: hidden ? null : state.lastDiscard, // the outlined tile, only for those who can call it
    result: state.result,
    canTsumo: me !== null && canTsumo(state, me),
    canRon: me !== null && canRon(state, me),
    canKyuushu: me !== null && canKyuushu(state, me),
    ponOptions: me !== null ? ponOptions(state, me) : [], // pairs of your own tile ids
    chiiOptions: me !== null ? chiiOptions(state, me) : [],
    openKanOptions: me !== null ? openKanOptions(state, me) : [], // the three tile ids, on a discard
    kanOptions: me !== null ? kanOptions(state, me) : [], // closed or added kans on your own turn
    riichiDiscards: me !== null ? riichiDiscards(state, me) : [],
    autoDiscarding: me !== null && state.current === me && autoDiscardDue(state),
    furiten: me !== null ? furitenStatus(state, me) : null, // your own only: it reveals your waits
    waits: me !== null ? waitYaku(state, me) : [], // your own only, likewise: [{ kind, ron, tsumo }]
    discardPreview: me !== null ? discardPreview(state, me) : {}, // on your turn: waits after each discard
    players: state.players.map((p) => ({
      seat: p.seat,
      discards: p.discards,
      tsumogiri: p.tsumogiri,
      called: p.called,
      melds: p.melds, // open melds are public
      handCount: p.hand.length,
      hasDrawn: !!p.drawn,
      hand: visible(p) ? p.hand : null,
      drawn: visible(p) ? p.drawn : null,
      riichi: p.riichi, // { turn, discardIndex, double, ippatsu } is public knowledge
      callout: p.callout, // set only once a call has happened, so it reveals nothing early
    })),
  };
}

function viewFor(room, ws) {
  const seat = seatOf(room, ws);
  const you = seat >= 0 ? seat : null;
  const m = room.match;
  return {
    type: 'state',
    you,
    room: {
      code: room.code,
      settings: room.settings,
      hostSeat: hostSeat(room),
      seats: room.seats.map((p) => (p ? { name: p.name, connected: !!p.ws } : null)),
      spectators: room.spectators.size,
      started: !!m,
    },
    match: m && {
      label: handLabel(m),
      roundWind: m.roundWind,
      hand: m.hand,
      honba: m.honba,
      over: m.over,
      final: m.final,
      history: m.history,
    },
    game: gameView(room.state, you),
  };
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  for (const p of room.seats) if (p?.ws) send(p.ws, viewFor(room, p.ws));
  for (const ws of room.spectators) send(ws, viewFor(room, ws));
}

// Deletes the room once nobody has been connected for EMPTY_ROOM_MS.
function checkEmpty(room) {
  clearTimeout(room.emptyTimer);
  if (connected(room) > 0) return;
  room.emptyTimer = setTimeout(() => {
    if (connected(room) === 0) rooms.delete(room.code);
  }, EMPTY_ROOM_MS);
}

// --- Hands ---

// A riichi player's draw that can't be used is shown for AUTO_DISCARD_MS, then discarded
// for them. The timer checks it is still the same hand and the same drawn tile.
function scheduleAutoDiscard(room) {
  const hand = room.state;
  if (!hand || !autoDiscardDue(hand)) return;
  const tileId = hand.players[hand.current].drawn.id;
  setTimeout(() => {
    if (room.state !== hand || !autoDiscardDue(hand) || hand.players[hand.current].drawn?.id !== tileId) return;
    if (discard(hand, tileId)) drawAfterPause(room);
    update(room);
  }, AUTO_DISCARD_MS);
}

// After a discard nobody could call (the hand is waiting to draw), the next player draws
// once DRAW_DELAY_MS has passed. The timer checks it is still the same hand, still waiting.
function drawAfterPause(room) {
  const hand = room.state;
  if (!hand || hand.phase !== 'draw') return;
  setTimeout(() => {
    if (room.state !== hand || hand.phase !== 'draw') return;
    draw(hand);
    update(room);
  }, DRAW_DELAY_MS);
}

// After a kan stands, the replacement tile is drawn once KAN_DRAW_MS has passed. The timer
// checks it is still the same hand, still waiting for it.
function scheduleRinshan(room) {
  const hand = room.state;
  if (!hand || hand.phase !== 'rinshan') return;
  setTimeout(() => {
    if (room.state !== hand || hand.phase !== 'rinshan') return;
    draw(hand);
    update(room);
  }, KAN_DRAW_MS);
}

// Sends everyone the new state, records a hand that just ended in the match, and starts the
// auto-discard and replacement-draw timers if they apply.
function update(room) {
  if (room.state?.phase === 'ended' && !room.state.recorded) {
    room.state.recorded = true;
    recordHand(room.match, room.state);
  }
  broadcast(room);
  scheduleAutoDiscard(room);
  scheduleRinshan(room);
}

// Every hand's full seed is logged, so any hand can be replayed with DEBUG_SEED.
function startHand(room) {
  const wall = SEED ? wallFromSeed(SEED) : createWall();
  room.state = newHand({ ...handSettings(room.match), wall });
  console.log(`[${room.code}] ${handLabel(room.match)}, ${room.match.honba} honba. Integrity: ${checkIntegrity(room.state)}. Seed: ${seedFromWall(wall)}`);
}

function startMatch(room) {
  room.match = newMatch(room.settings);
  startHand(room);
}

// --- Messages ---

function joinRoom(ws, room, id, name) {
  leaveRoom(ws);
  ws.room = room;
  const mine = room.seats.findIndex((p) => p?.id === id);
  if (mine >= 0) {
    // Same player (e.g. a reloaded tab): take the seat back.
    const old = room.seats[mine].ws;
    if (old && old !== ws) {
      old.room = null;
      send(old, { type: 'error', message: 'This seat was opened in another tab.' });
      old.close();
    }
    room.seats[mine].ws = ws;
    room.seats[mine].name = name;
  } else if (!room.match && room.seats.includes(null)) {
    room.seats[room.seats.indexOf(null)] = { id, name, ws };
    if (!room.hostId) room.hostId = id;
  } else {
    room.spectators.add(ws);
  }
  checkEmpty(room);
  send(ws, { type: 'joined', code: room.code });
  broadcast(room);
}

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  room.spectators.delete(ws);
  const seat = seatOf(room, ws);
  if (seat >= 0) {
    if (room.match) {
      room.seats[seat].ws = null; // kept for them until they come back
    } else {
      // Before the match, leaving frees the seat; the host role passes to the next player.
      const { id } = room.seats[seat];
      room.seats[seat] = null;
      if (room.hostId === id) room.hostId = room.seats.find(Boolean)?.id ?? null;
    }
  }
  checkEmpty(room);
  broadcast(room);
}

function handle(ws, msg) {
  const id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : null;
  if (msg.type === 'create') {
    if (!id) return;
    const room = {
      code: newCode(), settings: normalizeSettings(msg.settings), hostId: id,
      seats: [null, null, null, null], spectators: new Set(), match: null, state: null, emptyTimer: null,
    };
    rooms.set(room.code, room);
    console.log(`[${room.code}] created`);
    joinRoom(ws, room, id, cleanName(msg.name));
    return;
  }
  if (msg.type === 'join') {
    const code = String(msg.code ?? '').toLowerCase();
    const room = rooms.get(code);
    if (!id || !room) {
      send(ws, { type: 'error', message: `There is no room ${code || '(blank)'}.` });
      return;
    }
    joinRoom(ws, room, id, cleanName(msg.name));
    return;
  }

  const room = ws.room;
  if (!room) return;
  if (msg.type === 'leave') {
    leaveRoom(ws);
    send(ws, { type: 'left' });
    return;
  }
  const seat = seatOf(room, ws);
  if (seat < 0) return; // spectators can't act
  const isHost = room.seats[seat].id === room.hostId;
  const state = room.state;

  if (msg.type === 'settings' && isHost && !room.match) {
    room.settings = normalizeSettings(msg.settings);
    broadcast(room);
  } else if (msg.type === 'start' && isHost && !room.match && room.seats.every(Boolean)) {
    startMatch(room);
    update(room);
  } else if (msg.type === 'nextHand' && state?.phase === 'ended' && !room.match.over) {
    startHand(room);
    update(room);
  } else if (msg.type === 'rematch' && isHost && room.match?.over) {
    startMatch(room);
    update(room);
  } else if (!state || state.phase === 'ended') {
    // No game actions between hands.
  } else if (msg.type === 'discard' && state.current === seat) {
    // A riichi player's unusable draw is discarded by the timer, not by hand. If someone
    // can call the discard, nothing is drawn until they decide; otherwise after a pause.
    if (!autoDiscardDue(state) && discard(state, msg.tileId)) drawAfterPause(room);
    update(room);
  } else if (msg.type === 'riichi') {
    if (declareRiichi(state, seat, msg.tileId)) {
      drawAfterPause(room);
      update(room);
    }
  } else if (msg.type === 'kan' && state.phase !== 'claim') {
    // A closed or added kan on your own turn. Others may get to rob it before the replacement draw.
    if (declareKan(state, seat, msg.kind)) update(room);
  } else if (msg.type === 'kyuushu') {
    if (declareKyuushu(state, seat)) update(room);
  } else if (msg.type === 'tsumo') {
    if (tsumo(state, seat)) update(room);
  } else if (['ron', 'kan', 'pon', 'chii', 'pass'].includes(msg.type)) {
    if (claim(state, seat, msg.type, Array.isArray(msg.tiles) ? msg.tiles : null)) {
      // If everyone passed, the next player draws now: the decisions already took time.
      // Nothing is drawn after a pon or chii; after a kan the replacement comes after a pause.
      if (state.phase === 'draw') draw(state);
      update(room);
    }
  }
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg && typeof msg === 'object') handle(ws, msg);
  });
  ws.on('close', () => leaveRoom(ws));
});

server.listen(PORT, () => console.log(`Mahjong server on http://localhost:${PORT}`));
