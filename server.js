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
  newHand, draw, discard, tsumo, claim, chooseExchange, canTsumo, canRon, ponOptions, chiiOptions, riichiDiscards, declareRiichi,
  canKyuushu, declareKyuushu, kanOptions, declareKan, openKanOptions, waitYaku, discardPreview,
  autoDiscardDue, furitenStatus, createWall, checkIntegrity,
} from './game.js';
import { newMatch, recordHand, handSettings, handLabel, normalizeSettings } from './match.js';
import { wallFromSeed, seedFromWall } from './seed.js';
import { openRecorder } from './db.js';

// Debugging: NO_DELAYS=1 removes every artificial pause: the three below (each can also be set
// on its own) and, in the browser, the hold on a win before its result (see viewFor).
const NO_DELAYS = !!process.env.NO_DELAYS && process.env.NO_DELAYS !== '0';
const delay = (name, ms) => (NO_DELAYS ? 0 : Number(process.env[name] ?? ms));
// How long a draw the server discards for a player (see autoDiscardTile) is shown first.
const AUTO_DISCARD_MS = delay('AUTO_DISCARD_MS', 1000);
// Pause after a discard nobody can call, before the next draw. A discard somebody can call
// makes everyone wait while they decide, so without this pause the wait itself would show
// that someone had an option. DRAW_DELAY_MS overrides it (e.g. 0 for automated tests).
const DRAW_DELAY_MS = delay('DRAW_DELAY_MS', 2000);
// Pause after a kan, before the replacement draw. The pause when an added kan could be robbed
// (chankan) then looks like any other kan's.
const KAN_DRAW_MS = delay('KAN_DRAW_MS', 500);
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
// Standard matches are recorded in an SQLite file (see db.js): DB_PATH sets where (default
// matches.db next to this file), and NO_RECORD=1 turns recording off.
const RECORD = !process.env.NO_RECORD || process.env.NO_RECORD === '0';
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'matches.db');
const recorder = RECORD ? openRecorder(DB_PATH) : null;
// index.html is served for the pages below; replay.js and seed.js run replays in the browser.
const STATIC = new Set(['/style.css', '/ui.js', '/game.js', '/scoring.js', '/replay.js', '/seed.js']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
// Tile images, cut from riichi-mahjong-tiles-svg by tools/cut-tiles.mjs. Only plain names match,
// so nothing outside tiles/ can be reached.
const TILE_IMAGE = /^\/tiles\/tileset2\/[a-z0-9]+\.svg$/;

// Page addresses. Each serves index.html, and the page shows the matching screen (see route() in
// ui.js). Every link and file reference is relative to the site root, through a relative
// <base href> that the server writes in for the page's depth: "./" for /game, "../" for
// /replays/match. So nothing assumes the site sits at the top of its domain.
//   /                                  the main page
//   /replays                           recent matches, with a search
//   /replays/match?room=<code>&start=<time>   one match's replay
//   /game?room=<code>                  a room: its waiting room, then its table
// Any other address is redirected to the main page (an old /?room=<code> link to its room).
const PAGES = new Set(['/', '/replays', '/replays/match', '/game']);
const toRoot = (pathname) => '../'.repeat(pathname.split('/').length - 2) || './';

function redirect(res, location) {
  res.writeHead(302, { Location: location }).end();
}

const server = http.createServer((req, res) => {
  const [pathname, query = ''] = req.url.split('?');
  const room = new URLSearchParams(query).get('room');
  if (pathname === '/' && room) return redirect(res, `game?room=${encodeURIComponent(room)}`);
  if (PAGES.has(pathname)) {
    fs.readFile(path.join(ROOT, 'index.html'), 'utf8', (err, html) => {
      if (err) return res.writeHead(500).end('Error');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(html.replace('<base href="./">', `<base href="${toRoot(pathname)}">`));
    });
    return;
  }
  // One finished match, for its replay page (see getMatch in db.js).
  if (pathname === '/api/match') {
    const params = new URLSearchParams(query);
    const match = recorder?.getMatch(params.get('room') ?? '', params.get('start') ?? '');
    res.writeHead(match ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(match ?? { error: 'There is no finished recorded match with that room and start time.' }));
    return;
  }
  // The recorded matches, for the Recent matches page: [{ id, room, startedAt, finished }], newest first.
  if (pathname === '/api/matches') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ recording: !!recorder, matches: recorder?.listMatches() ?? [] }));
    return;
  }
  const image = TILE_IMAGE.test(pathname);
  if (!STATIC.has(pathname) && !image) return redirect(res, toRoot(pathname));
  fs.readFile(path.join(ROOT, pathname), (err, data) => {
    if (err) return res.writeHead(image && err.code === 'ENOENT' ? 404 : 500).end(image ? 'Not found' : 'Error');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(pathname)], ...(image ? { 'Cache-Control': 'max-age=86400' } : {}) });
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
// (tenpai players and nagashi winners after an exhaustive draw).
function gameView(room, seat) {
  const state = room.state;
  if (!state) return null;
  const revealed = state.result?.winners ?? state.result?.revealed ?? [];
  const visible = (p) => p.seat === seat || revealed.includes(p.seat);
  const me = seat !== null && seat >= 0 ? seat : null;
  // With the "no hints" setting, nothing that only helps is sent: your waits, discard previews
  // and furiten, which discards were tsumogiri, and ippatsu. Legal actions still are (the
  // Riichi, Tsumo, Ron and call buttons), since the game needs them.
  const hints = !room.match?.settings.noHints;
  // With "skip calls" on, you are never offered a pon, chii or kan (autoPlay passes for you).
  const skip = me !== null && autoOf(room, me).skipCalls;
  const calls = (options) => (me === null || skip ? [] : options(state, me));
  const pon = calls(ponOptions);
  const chii = calls(chiiOptions);
  const openKan = calls(openKanOptions);
  // While players decide on a discard (or a kan that could be robbed), only they see it: to
  // everyone else this looks exactly like the pause before the next draw, so nothing shows
  // that someone could call.
  const deciding = state.phase === 'claim' && me !== null &&
    (canRon(state, me) || pon.length > 0 || chii.length > 0 || openKan.length > 0);
  const hidden = state.phase === 'claim' && !deciding;
  // Hidden decisions look like the pause they replace: before a draw, or (for a kan that could
  // be robbed) before the replacement draw.
  const shownPhase = hidden ? (state.lastDiscard.chankan ? 'rinshan' : 'draw') : state.phase;
  // Whose turn to show: the player discarding, and after a discard still that player until
  // the tile is called or skipped and the next player draws. It is the same whether or not
  // someone could call the tile (or rob a kan, where the kan player keeps it).
  let turn = state.current;
  if (state.phase === 'exchange') turn = null; // everyone picks at once
  else if (state.phase === 'claim') turn = state.lastDiscard.from;
  // In a Baiman contest's pause after a win it is the winner on a tsumo, the discarder on a ron.
  else if (state.phase === 'draw') turn = state.pauseTurn ?? state.discardLog.at(-1)?.from ?? state.current;
  return {
    contest: state.rules.contest, // the Baiman contest format
    passes: state.passes, // after the tile exchange, who passed to whom: player n to passes[n]
    // The tile exchange: your own pick, and who has picked (not what).
    exchange: state.exchange && {
      mine: me !== null ? state.exchange.picks[me] : null,
      picked: state.exchange.picks.map(Boolean),
    },
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
    // Baiman contest, during the hand: each win's han are public (a yakuman shows as such)...
    contestWins: state.wins.map((w) => ({ seat: w.seat, han: w.score.han, yakuman: w.score.yakuman, limit: w.score.limit })),
    // ...but the ura dora only go to a player who has won in riichi. Everyone sees them in the
    // result when the hand ends (if a riichi hand won).
    uraIndicators: me !== null && state.players[me].won && state.players[me].riichi ? state.uraIndicators : null,
    lastDiscard: hidden ? null : state.lastDiscard, // the outlined tile, only for those who can call it
    result: state.result,
    canTsumo: me !== null && canTsumo(state, me),
    canRon: me !== null && canRon(state, me),
    canKyuushu: me !== null && canKyuushu(state, me),
    ponOptions: pon, // pairs of your own tile ids
    chiiOptions: chii,
    openKanOptions: openKan, // the three tile ids, on a discard
    kanOptions: calls(kanOptions), // closed or added kans on your own turn
    riichiDiscards: me !== null ? riichiDiscards(state, me) : [],
    autoDiscarding: me !== null && state.current === me && autoDiscardTile(room) !== null,
    noHints: !hints,
    furiten: me !== null && hints ? furitenStatus(state, me) : null, // your own only: it reveals your waits
    waits: me !== null && hints ? waitYaku(state, me) : [], // your own only, likewise: [{ kind, ron, tsumo }]
    discardPreview: me !== null && hints ? discardPreview(state, me) : {}, // on your turn: waits after each discard
    players: state.players.map((p) => ({
      seat: p.seat,
      discards: p.discards,
      tsumogiri: hints ? p.tsumogiri : p.tsumogiri.map(() => false),
      called: p.called,
      melds: p.melds, // open melds are public
      handCount: p.hand.length,
      hasDrawn: !!p.drawn,
      hand: visible(p) ? p.hand : null,
      drawn: visible(p) ? p.drawn : null,
      // { turn, discardIndex, double, ippatsu } is public knowledge; ippatsu is a hint.
      riichi: p.riichi && !hints ? { ...p.riichi, ippatsu: false } : p.riichi,
      callout: p.callout, // set only once a call has happened, so it reveals nothing early
      // Baiman contest: that they won, and how, is public; the hand and its score stay hidden.
      won: p.won ? { type: p.won.type } : null,
    })),
  };
}

function viewFor(room, ws) {
  const seat = seatOf(room, ws);
  const you = seat >= 0 ? seat : null;
  const m = room.match;
  const ended = room.state?.phase === 'ended' && m?.history.length > 0; // the hand is over, not yet the next one
  return {
    type: 'state',
    noDelays: NO_DELAYS,
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
      // After a hand ends, the match has already moved on (recordHand); until the next hand
      // starts, its label and honba are still the hand just played.
      label: ended ? m.history.at(-1).label : handLabel(m),
      roundWind: m.roundWind,
      hand: m.hand,
      honba: ended ? m.history.at(-1).honba : m.honba,
      over: m.over,
      final: m.final,
      history: m.history,
    },
    auto: you !== null ? autoOf(room, you) : null,
    game: gameView(room, you),
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

// --- Auto play ---
// Each seated player can switch these on or off at any time, even mid hand. They all switch
// off at the start of each hand (see startHand).
//   win:       ron or tsumo whenever it is legal;
//   skipCalls: never pon, chii or kan (the offers are passed and their buttons hidden);
//   tsumogiri: discard every draw after AUTO_DISCARD_MS, unless it could be a tsumo.
const AUTO_KEYS = ['win', 'skipCalls', 'tsumogiri'];
const autoOf = (room, seat) => room.seats[seat]?.auto ?? {};

function normalizeAuto(input) {
  const auto = {};
  for (const key of AUTO_KEYS) auto[key] = !!(input && typeof input === 'object' && input[key] === true);
  return auto;
}


// The drawn tile the server will discard for the current player, or null: a riichi player's
// draw they can't use (one allowing a kan too, if they skip calls), or any draw with auto
// tsumogiri. A draw that could be a tsumo is never thrown away automatically.
function autoDiscardTile(room) {
  const state = room.state;
  if (!state || state.phase !== 'discard') return null;
  const seat = state.current;
  const player = state.players[seat];
  const auto = autoOf(room, seat);
  if (!player.drawn || canTsumo(state, seat)) return null;
  const riichiLocked = player.riichi && player.riichi.discardIndex !== player.discards.length;
  if (autoDiscardDue(state) || (riichiLocked && auto.skipCalls) || auto.tsumogiri) return player.drawn.id;
  return null;
}

// Makes the decisions auto settings make for players: a win when one is legal, and a pass on
// a discard (or kan) offering only calls. Returns true if anything happened. It runs just after
// each new state is sent, so a ronned tile reaches the pond first. A pass that ends the claim
// is followed by the usual pause before the draw, as if nobody could have called.
function autoPlay(room) {
  const state = room.state;
  if (!state) return false;
  if (state.phase === 'discard' && autoOf(room, state.current).win && canTsumo(state, state.current)) {
    tsumo(state, state.current);
    drawAfterPause(room); // a Baiman contest goes on after a tsumo
    return true;
  }
  if (state.phase !== 'claim') return false;
  let acted = false;
  for (const seat of Object.keys(state.claims).map(Number)) {
    if (state.phase !== 'claim' || state.claims[seat] !== null) continue;
    const auto = autoOf(room, seat);
    const ron = canRon(state, seat);
    const action = ron ? (auto.win ? 'ron' : null) : auto.skipCalls ? 'pass' : null;
    if (action && claim(state, seat, action)) acted = true;
  }
  if (acted) drawAfterPause(room);
  return acted;
}

function scheduleAutoPlay(room) {
  const hand = room.state;
  if (!hand || hand.phase === 'ended') return;
  setTimeout(() => {
    if (room.state === hand && autoPlay(room)) update(room);
  }, 0);
}

// --- Hands ---

// A draw the server discards for the player (see autoDiscardTile) is shown for AUTO_DISCARD_MS
// first. The timer checks it is still the same hand and the same drawn tile.
function scheduleAutoDiscard(room) {
  const hand = room.state;
  const tileId = autoDiscardTile(room);
  if (tileId === null) return;
  setTimeout(() => {
    if (room.state !== hand || autoDiscardTile(room) !== tileId) return;
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
  recorder?.sync(room); // new actions, then the result and the match's end once there
  broadcast(room);
  scheduleAutoPlay(room);
  scheduleAutoDiscard(room);
  scheduleRinshan(room);
}

// Every hand's full seed is logged, so any hand can be replayed with DEBUG_SEED.
function startHand(room) {
  for (const p of room.seats) if (p) p.auto = normalizeAuto({});
  const wall = SEED ? wallFromSeed(SEED) : createWall();
  room.state = newHand({ ...handSettings(room.match), wall });
  const seed = seedFromWall(wall);
  recorder?.startHand(room, seed, handLabel(room.match));
  console.log(`[${room.code}] ${handLabel(room.match)}, ${room.match.honba} honba. Integrity: ${checkIntegrity(room.state)}. Seed: ${seed}`);
}

function startMatch(room) {
  room.match = newMatch(room.settings);
  recorder?.startMatch(room, { debug: !!SEED });
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
    // Back to the waiting room, where the host can change settings and start again. Seats of
    // players who are gone are freed, as if they had left before the match.
    room.match = null;
    room.state = null;
    room.seats = room.seats.map((p) => (p?.ws ? p : null));
    broadcast(room);
  } else if (msg.type === 'auto') {
    room.seats[seat].auto = normalizeAuto(msg.settings);
    update(room);
  } else if (!state || state.phase === 'ended') {
    // No game actions between hands.
  } else if (msg.type === 'exchange') {
    // A Baiman contest hand's tile exchange; once all four have picked, the dealer draws.
    if (chooseExchange(state, seat, msg.tiles)) {
      if (state.phase === 'draw') draw(state);
      update(room);
    }
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
    if (tsumo(state, seat)) {
      drawAfterPause(room); // a Baiman contest goes on after a tsumo
      update(room);
    }
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

server.listen(PORT, () => {
  console.log(`Mahjong server on http://localhost:${PORT}${NO_DELAYS ? ' (NO_DELAYS: no pauses)' : ''}`);
  console.log(recorder ? `Recording standard matches in ${DB_PATH}` : 'Not recording matches (NO_RECORD)');
});
