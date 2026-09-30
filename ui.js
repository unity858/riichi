// Renders the server-provided view and sends player intents. No game logic here.

import { tileLabel, kindLabel, getWaits, WINDS } from './game.js';

const infoEl = document.getElementById('info');
const newHandBtn = document.getElementById('new-hand');
const riichiBtn = document.getElementById('riichi');
const tsumoBtn = document.getElementById('tsumo');
const ronBtn = document.getElementById('ron');
const passBtn = document.getElementById('pass');
const seatEls = {
  bottom: document.querySelector('.seat-bottom'),
  right: document.querySelector('.seat-right'),
  top: document.querySelector('.seat-top'),
  left: document.querySelector('.seat-left'),
};
// Relative position of each seat from your point of view (turn order goes to your right).
const POSITIONS = ['bottom', 'right', 'top', 'left'];

// Game server to connect to, e.g. 'wss://riichi.example.com' when the page is hosted on
// GitHub Pages. Empty means the server that served this page.
const SERVER_URL = '';

let view = null;
// True after pressing Riichi, while choosing the tile to declare with.
let choosingRiichi = false;
const ws = new WebSocket(SERVER_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);

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

// clickable discards the tile, or declares riichi with it while choosing a riichi tile.
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
    el.addEventListener('click', () => {
      if (choosingRiichi) {
        choosingRiichi = false;
        send({ type: 'riichi', tileId: tile.id });
      } else {
        send({ type: 'discard', tileId: tile.id });
      }
    });
  }
  return el;
}

// Whether your own tile can be clicked right now.
function canClickTile(tile, player, game, you) {
  if (player.seat !== you || game.current !== you || game.phase !== 'discard') return false;
  if (choosingRiichi) return game.riichiDiscards.includes(tile.id);
  // After riichi, only a winning draw can be clicked (to decline the tsumo); other draws
  // are discarded automatically.
  if (player.riichi) return tile.id === player.drawn?.id && game.canTsumo;
  return true;
}

function seatWind(seat, dealer) {
  return WINDS[(seat - dealer + 4) % 4];
}

function playerName(seat, game) {
  return `${seatWind(seat, game.dealer)} (Player ${seat + 1})`;
}

function renderSeat(el, player, game, you) {
  el.innerHTML = '';
  el.classList.toggle('active', game.current === player.seat && game.phase === 'discard');
  const result = game.result;
  const won = result?.winners?.includes(player.seat);
  el.classList.toggle('winner', !!won);

  const name = document.createElement('div');
  name.className = 'seat-name';
  const who = player.seat === you ? 'You' : `Player ${player.seat + 1}`;
  const offline = view.connected[player.seat] ? '' : ' (offline)';
  // The dealer's seat wind (always E) is shown in red.
  const wind = seatWind(player.seat, game.dealer);
  name.innerHTML = (player.seat === game.dealer ? `<span class="dealer">${wind}</span>` : wind) +
    ` · ${who}${offline} · <span class="score">${game.scores[player.seat].toLocaleString()}</span>`;
  const delta = result?.deltas?.[player.seat];
  if (delta) name.innerHTML += ` <span class="delta ${delta > 0 ? 'gain' : 'loss'}">(${delta > 0 ? '+' : ''}${delta.toLocaleString()})</span>`;
  if (result?.type === 'exhaustiveDraw') {
    name.innerHTML += ` · ${result.tenpai.includes(player.seat) ? 'Tenpai' : 'Noten'}`;
  }
  if (player.riichi) {
    name.innerHTML += ` <span class="riichi-tag">${player.riichi.double ? 'Double riichi' : 'Riichi'}` +
      `${player.riichi.ippatsu && !result ? ' · Ippatsu' : ''}</span>`;
  }
  el.appendChild(name);

  const hand = document.createElement('div');
  hand.className = 'hand';
  const clickable = (t) => canClickTile(t, player, game, you);
  const dim = (t) => (choosingRiichi && player.seat === you && !clickable(t) ? ' dimmed' : '');
  if (player.hand) {
    player.hand.forEach((t) => hand.appendChild(tileEl(t, { clickable: clickable(t), extraClass: dim(t).trim() })));
    if (player.drawn) {
      const extra = (won ? 'drawn win-tile' : 'drawn last-drawn') + dim(player.drawn);
      hand.appendChild(tileEl(player.drawn, { clickable: clickable(player.drawn), extraClass: extra }));
    } else if (won && result.type === 'ron') {
      hand.appendChild(tileEl(result.tile, { extraClass: 'drawn win-tile' }));
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

  // Between your turns, show your own waits.
  if (player.seat === you && player.hand && !player.drawn && !won) {
    const waits = getWaits(player.hand);
    const line = document.createElement('div');
    line.className = 'waits';
    const f = game.furiten;
    const kinds = f ? ['discard', 'temporary', 'riichi'].filter((k) => f[k]) : [];
    const furiten = kinds.length ? ` (furiten, ${kinds.join(' + ')}: tsumo only)` : '';
    line.textContent = waits.length ? `Tenpai: waits ${waits.map(kindLabel).join(' ')}${furiten}` : 'Not tenpai';
    el.appendChild(line);
  }

  const pond = document.createElement('div');
  pond.className = 'pond';
  // The discard that can be (or was) called ron on is highlighted.
  const target = game.lastDiscard?.tile ?? (result?.type === 'ron' ? result.tile : null);
  // The riichi declaration tile lies sideways; tsumogiri discards are a shade darker.
  player.discards.forEach((t, i) => {
    const classes = [];
    if (target && t.id === target.id) classes.push('claim-tile');
    if (player.riichi?.discardIndex === i) classes.push('riichi-tile');
    if (player.tsumogiri[i]) classes.push('tsumogiri');
    pond.appendChild(tileEl(t, { extraClass: classes.join(' ') }));
  });
  el.appendChild(pond);
}

// One line per winner: the yaku and dora with their han, then han/fu and the payment.
function breakdownHtml(game, you) {
  const { result } = game;
  if (!result?.scores) return '';
  return result.winners.map((seat, i) => {
    const s = result.scores[i];
    const who = seat === you ? 'You' : playerName(seat, game);
    if (s.han === 0) return `<div class="breakdown"><b>${who}:</b> no yaku, 0 points</div>`;
    const parts = s.yaku.map((y) => `${y.name} ${y.han}`);
    if (s.dora.dora) parts.push(`Dora ${s.dora.dora}`);
    if (s.dora.aka) parts.push(`Red five ${s.dora.aka}`);
    if (s.dora.ura) parts.push(`Ura dora ${s.dora.ura}`);
    const p = s.payment;
    const pay = p.ron !== undefined ? p.ron.toLocaleString()
      : p.all !== undefined ? `${p.all.toLocaleString()} all`
        : `${p.nonDealer.toLocaleString()}/${p.dealer.toLocaleString()}`;
    const value = s.limit ?? `${s.han} han ${s.fu} fu`;
    return `<div class="breakdown"><b>${who}:</b> ${parts.join(' · ')}<br>` +
      `${s.limit ? `${s.han} han ${s.fu} fu · ` : ''}${value}: ${pay}</div>`;
  }).join('');
}

function statusText(game, you) {
  const { result } = game;
  if (result?.type === 'exhaustiveDraw' && result.nagashi.length > 0) {
    const names = result.nagashi.map((s) => (s === you ? 'You' : playerName(s, game)));
    return `Exhaustive draw: nagashi mangan for ${names.join(' and ')}`;
  }
  if (result?.type === 'exhaustiveDraw') {
    const { tenpai } = result;
    if (tenpai.length === 0) return 'Exhaustive draw: nobody is tenpai';
    if (tenpai.length === 4) return 'Exhaustive draw: everyone is tenpai';
    const names = tenpai.map((s) => (s === you ? 'You' : playerName(s, game)));
    return `Exhaustive draw: ${names.join(', ')} ${tenpai.length === 1 && tenpai[0] !== you ? 'is' : 'are'} tenpai`;
  }
  if (result?.type === 'tsumo') {
    const [winner] = result.winners;
    return `${winner === you ? 'You win' : `${playerName(winner, game)} wins`} by tsumo on ${tileLabel(result.tile)}`;
  }
  if (result?.type === 'ron') {
    const names = result.winners.map((s) => (s === you ? 'You' : playerName(s, game)));
    const verb = result.winners.length === 1 && result.winners[0] !== you ? 'wins' : 'win';
    const from = result.from === you ? 'you' : playerName(result.from, game);
    return `${names.join(' and ')} ${verb} by ron on ${tileLabel(result.tile)} from ${from}`;
  }
  if (game.phase === 'claim') {
    if (game.canRon) return `You can ron on ${tileLabel(game.lastDiscard.tile)}`;
    return 'Waiting for other players';
  }
  if (game.current === you && choosingRiichi) return 'Riichi: choose a tile to discard';
  if (game.current === you && game.autoDiscarding) return 'Riichi: discarding…';
  if (game.current === you && game.players[you].riichi) return 'Riichi: tsumo, or click the drawn tile to pass';
  if (game.current === you) return game.canTsumo ? 'Your turn: tsumo or discard' : 'Your turn: discard a tile';
  return `Waiting for ${playerName(game.current, game)}`;
}

function render() {
  const { you, game, connected } = view;
  const seated = connected.filter(Boolean).length;
  if (!game?.riichiDiscards?.length) choosingRiichi = false;

  if (!game) {
    Object.values(seatEls).forEach((el) => (el.innerHTML = ''));
    const role = you === null ? 'Spectating' : `You are Player ${you + 1}`;
    infoEl.innerHTML = `<div class="status">Waiting for players (${seated}/4)</div><div>${role}</div>`;
    newHandBtn.disabled = true;
    riichiBtn.hidden = tsumoBtn.hidden = ronBtn.hidden = passBtn.hidden = true;
    return;
  }

  // Spectators view from seat 0.
  const pov = you ?? 0;
  game.players.forEach((p) => {
    renderSeat(seatEls[POSITIONS[(p.seat - pov + 4) % 4]], p, game, you);
  });

  infoEl.innerHTML = `
    <div class="status">${statusText(game, you)}</div>
    ${breakdownHtml(game, you)}
    <div>Round: ${WINDS[game.roundWind]}</div>
    <div>Wall: ${game.wallCount} tiles left</div>
    <div>Dora indicator: ${game.doraIndicators.map(tileLabel).join(' ')}</div>
    ${game.result?.uraIndicators ? `<div>Ura dora indicator: ${game.result.uraIndicators.map(tileLabel).join(' ')}</div>` : ''}
    ${game.riichiSticks ? `<div>Riichi sticks: ${game.riichiSticks} (${(game.riichiSticks * 1000).toLocaleString()})</div>` : ''}
    ${you === null ? '<div>Spectating</div>' : ''}
    ${seated < 4 ? `<div>Players connected: ${seated}/4</div>` : ''}
  `;
  newHandBtn.disabled = you === null || seated < 4;
  riichiBtn.hidden = !game.riichiDiscards.length;
  riichiBtn.classList.toggle('selected', choosingRiichi);
  tsumoBtn.hidden = !game.canTsumo;
  ronBtn.hidden = passBtn.hidden = !game.canRon;
}

riichiBtn.addEventListener('click', () => {
  choosingRiichi = !choosingRiichi;
  render();
});

newHandBtn.addEventListener('click', () => send({ type: 'newHand' }));
tsumoBtn.addEventListener('click', () => send({ type: 'tsumo' }));
ronBtn.addEventListener('click', () => send({ type: 'ron' }));
passBtn.addEventListener('click', () => send({ type: 'pass' }));

// Space discards the drawn tile (tsumogiri) on your turn. In riichi it only declines a tsumo.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !view?.game || choosingRiichi) return;
  const { game, you } = view;
  const me = game.players[you];
  if (me?.riichi && !game.canTsumo) return;
  if (game.current === you && game.phase === 'discard' && me?.drawn) {
    e.preventDefault();
    send({ type: 'discard', tileId: me.drawn.id });
  }
});
