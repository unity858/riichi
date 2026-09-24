// Renders the server-provided view and sends discard intents. No game logic here.

import { tileLabel, WINDS } from './game.js';

const infoEl = document.getElementById('info');
const newHandBtn = document.getElementById('new-hand');
const seatEls = {
  bottom: document.querySelector('.seat-bottom'),
  right: document.querySelector('.seat-right'),
  top: document.querySelector('.seat-top'),
  left: document.querySelector('.seat-left'),
};
// Relative position of each seat from your point of view (turn order goes to your right).
const POSITIONS = ['bottom', 'right', 'top', 'left'];

let view = null;
const ws = new WebSocket(`ws://${location.host}`);

ws.addEventListener('message', (e) => {
  view = JSON.parse(e.data);
  render();
});
ws.addEventListener('close', () => {
  infoEl.innerHTML = '<div class="status">Disconnected from server. Reload the page to reconnect.</div>';
});

function send(msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function tileEl(tile, { clickable = false, extraClass = '' } = {}) {
  const el = document.createElement('div');
  if (!tile) {
    el.className = 'tile back';
    return el;
  }
  el.className = `tile ${tile.suit}${tile.red ? ' red' : ''} ${extraClass}`.trim();
  el.textContent = tileLabel(tile);
  if (clickable) {
    el.classList.add('clickable');
    el.addEventListener('click', () => send({ type: 'discard', tileId: tile.id }));
  }
  return el;
}

function seatWind(seat, dealer) {
  return WINDS[(seat - dealer + 4) % 4];
}

function renderSeat(el, player, game, you) {
  el.innerHTML = '';
  el.classList.toggle('active', game.current === player.seat && game.phase !== 'ended');

  const name = document.createElement('div');
  name.className = 'seat-name';
  const who = player.seat === you ? 'You' : `Player ${player.seat + 1}`;
  const offline = view.connected[player.seat] ? '' : ' (offline)';
  name.innerHTML = `${seatWind(player.seat, game.dealer)} · ${who}${offline}` +
    (player.seat === game.dealer ? '<span class="dealer">[Dealer]</span>' : '');
  el.appendChild(name);

  const hand = document.createElement('div');
  hand.className = 'hand';
  const myTurn = player.seat === you && game.current === you && game.phase === 'discard';
  if (player.hand) {
    player.hand.forEach((t) => hand.appendChild(tileEl(t, { clickable: myTurn })));
    if (player.drawn) {
      hand.appendChild(tileEl(player.drawn, { clickable: myTurn, extraClass: 'drawn last-drawn' }));
    }
  } else {
    for (let i = 0; i < player.handCount; i++) hand.appendChild(tileEl(null));
    if (player.hasDrawn) {
      const back = tileEl(null);
      back.classList.add('drawn');
      hand.appendChild(back);
    }
  }
  el.appendChild(hand);

  const pond = document.createElement('div');
  pond.className = 'pond';
  player.discards.forEach((t) => pond.appendChild(tileEl(t)));
  el.appendChild(pond);
}

function render() {
  const { you, game, connected } = view;
  const seated = connected.filter(Boolean).length;

  if (!game) {
    Object.values(seatEls).forEach((el) => (el.innerHTML = ''));
    const role = you === null ? 'Spectating' : `You are Player ${you + 1}`;
    infoEl.innerHTML = `<div class="status">Waiting for players (${seated}/4)</div><div>${role}</div>`;
    newHandBtn.disabled = true;
    return;
  }

  // Spectators view from seat 0.
  const pov = you ?? 0;
  game.players.forEach((p) => {
    renderSeat(seatEls[POSITIONS[(p.seat - pov + 4) % 4]], p, game, you);
  });

  let status;
  if (game.phase === 'ended') status = 'Exhaustive draw';
  else if (game.current === you) status = 'Your turn: discard a tile';
  else status = `Waiting for ${seatWind(game.current, game.dealer)} (Player ${game.current + 1})`;

  infoEl.innerHTML = `
    <div class="status">${status}</div>
    <div>Round: ${WINDS[game.roundWind]} · Dealer: Player ${game.dealer + 1}</div>
    <div>Wall: ${game.wallCount} tiles left</div>
    <div>Dora indicator: ${game.doraIndicators.map(tileLabel).join(' ')}</div>
    ${you === null ? '<div>Spectating</div>' : ''}
    ${seated < 4 ? `<div>Players connected: ${seated}/4</div>` : ''}
  `;
  newHandBtn.disabled = you === null || seated < 4;
}

newHandBtn.addEventListener('click', () => send({ type: 'newHand' }));

// Space discards the drawn tile (tsumogiri) on your turn.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !view?.game) return;
  const { game, you } = view;
  const me = game.players[you];
  if (game.current === you && game.phase === 'discard' && me?.drawn) {
    e.preventDefault();
    send({ type: 'discard', tileId: me.drawn.id });
  }
});
