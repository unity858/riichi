// HTTP static file server + WebSocket game server. The server owns the game state;
// clients only send intents and render the view they're given.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { newHand, draw, discard, checkIntegrity } from './game.js';

const PORT = process.env.PORT || 8080;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC = new Set(['/index.html', '/style.css', '/ui.js', '/game.js']);
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
function viewFor(seat) {
  const base = { type: 'state', you: seat, connected: seats.map(Boolean) };
  if (!state) return { ...base, game: null };
  return {
    ...base,
    game: {
      dealer: state.dealer,
      current: state.current,
      phase: state.phase,
      roundWind: state.roundWind,
      wallCount: state.wall.length,
      doraIndicators: state.doraIndicators,
      players: state.players.map((p) => ({
        seat: p.seat,
        discards: p.discards,
        handCount: p.hand.length,
        hasDrawn: !!p.drawn,
        hand: p.seat === seat ? p.hand : null,
        drawn: p.seat === seat ? p.drawn : null,
      })),
    },
  };
}

function broadcast() {
  wss.clients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(viewFor(ws.seat ?? null)));
  });
}

function startHand() {
  state = newHand({ dealer: state ? state.dealer : 0 });
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
      if (discard(state, msg.tileId)) draw(state);
      broadcast();
    } else if (msg.type === 'newHand' && connectedCount() === 4) {
      startHand();
      broadcast();
    }
  });

  ws.on('close', () => {
    if (ws.seat !== null) seats[ws.seat] = null;
    console.log(`Seat ${ws.seat} left (${connectedCount()}/4)`);
    broadcast();
  });
});

server.listen(PORT, () => console.log(`Mahjong server on http://localhost:${PORT}`));
