// HTTP static file server + WebSocket game server. The server owns the game state;
// clients only send intents and render the view they're given.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  newHand, draw, discard, tsumo, claim, canTsumo, canRon, riichiDiscards, declareRiichi, autoDiscardDue,
  furitenStatus, checkIntegrity,
} from './game.js';

// How long a riichi player's unusable draw is shown before it is discarded for them.
const AUTO_DISCARD_MS = 1000;

const PORT = process.env.PORT || 8080;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = new Set(['/index.html', '/style.css', '/ui.js', '/game.js', '/scoring.js']);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
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

const seats = [null, null, null, null]; // seat index -> socket
let state = null;

function connectedCount() {
  return seats.filter(Boolean).length;
}

// Per-seat view: your own hand is visible, others show only a tile count.
// When a hand ends, the winners' hands (or the tenpai hands, after a draw) are shown to everyone.
function viewFor(seat) {
  const base = { type: 'state', you: seat, connected: seats.map(Boolean) };
  if (!state) return { ...base, game: null };
  const revealed = state.result?.winners ?? state.result?.tenpai ?? [];
  const visible = (p) => p.seat === seat || revealed.includes(p.seat);
  return {
    ...base,
    game: {
      dealer: state.dealer,
      current: state.current,
      phase: state.phase,
      roundWind: state.roundWind,
      scores: state.scores,
      riichiSticks: state.riichiSticks,
      wallCount: state.wall.length,
      doraIndicators: state.doraIndicators,
      lastDiscard: state.lastDiscard,
      result: state.result,
      canTsumo: seat !== null && canTsumo(state, seat),
      canRon: seat !== null && canRon(state, seat),
      riichiDiscards: seat !== null ? riichiDiscards(state, seat) : [],
      autoDiscarding: seat !== null && state.current === seat && autoDiscardDue(state),
      furiten: seat !== null ? furitenStatus(state, seat) : null, // your own only: it reveals your waits
      players: state.players.map((p) => ({
        seat: p.seat,
        discards: p.discards,
        handCount: p.hand.length,
        hasDrawn: !!p.drawn,
        hand: visible(p) ? p.hand : null,
        drawn: visible(p) ? p.drawn : null,
        riichi: p.riichi, // { turn, discardIndex, double, ippatsu } is public knowledge
      })),
    },
  };
}

function broadcast() {
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(viewFor(ws.seat ?? null)));
  });
}

// A riichi player's draw that can't be used is shown for AUTO_DISCARD_MS, then discarded
// for them. The timer checks it is still the same hand and the same drawn tile.
function scheduleAutoDiscard() {
  if (!state || !autoDiscardDue(state)) return;
  const hand = state;
  const tileId = hand.players[hand.current].drawn.id;
  setTimeout(() => {
    if (state !== hand || !autoDiscardDue(hand) || hand.players[hand.current].drawn?.id !== tileId) return;
    if (discard(hand, tileId)) draw(hand);
    update();
  }, AUTO_DISCARD_MS);
}

// Sends everyone the new state, then starts the auto-discard timer if it applies.
function update() {
  broadcast();
  scheduleAutoDiscard();
}

// Scores and riichi sticks carry over from the previous hand; the first hand starts
// everyone at 25000.
function startHand() {
  state = newHand(state ? { dealer: state.dealer, scores: state.scores, riichiSticks: state.riichiSticks } : {});
  console.log('New hand dealt. Integrity:', checkIntegrity(state));
}

wss.on('connection', (ws) => {
  const seat = seats.indexOf(null);
  if (seat === -1) {
    ws.seat = null; // spectator
  } else {
    seats[seat] = ws;
    ws.seat = seat;
  }
  console.log(`Client joined as ${ws.seat === null ? 'spectator' : `seat ${ws.seat}`} (${connectedCount()}/4)`);

  // First hand starts once all four seats have been filled.
  if (!state && connectedCount() === 4) startHand();
  broadcast();

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (ws.seat === null) return;

    if (msg.type === 'discard' && state && state.current === ws.seat) {
      // A riichi player's unusable draw is discarded by the timer, not by hand.
      // No draw while other players are deciding whether to ron the discard.
      if (!autoDiscardDue(state) && discard(state, msg.tileId)) draw(state);
      update();
    } else if (msg.type === 'riichi' && state) {
      if (declareRiichi(state, ws.seat, msg.tileId)) {
        draw(state);
        update();
      }
    } else if (msg.type === 'tsumo' && state) {
      if (tsumo(state, ws.seat)) update();
    } else if ((msg.type === 'ron' || msg.type === 'pass') && state) {
      if (claim(state, ws.seat, msg.type)) {
        draw(state); // only draws if everyone passed and play continues
        update();
      }
    } else if (msg.type === 'newHand' && connectedCount() === 4) {
      startHand();
      update();
    }
  });

  ws.on('close', () => {
    if (ws.seat !== null) seats[ws.seat] = null;
    console.log(`Seat ${ws.seat} left (${connectedCount()}/4)`);
    broadcast();
  });
});

server.listen(PORT, () => console.log(`Mahjong server on http://localhost:${PORT}`));
