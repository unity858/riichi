// Renders the server-provided view and sends player intents. No game logic here.
// Three screens: the lobby (name, create or join a room), the waiting room, and the table.
// The room code lives in the address (?room=abc123), so a link can be shared.

import { tileLabel, kindLabel, getWaits, calledTilePosition, WINDS } from './game.js';

const $ = (id) => document.getElementById(id);
const screens = { lobby: $('lobby'), waiting: $('waiting'), table: $('table') };
const infoEl = $('info');
const nextHandBtn = $('next-hand');
const rematchBtn = $('rematch');
const leaveTableBtn = $('leave-table');
const riichiBtn = document.getElementById('riichi');
const tsumoBtn = document.getElementById('tsumo');
const ronBtn = document.getElementById('ron');
const passBtn = document.getElementById('pass');
const callOptionsEl = document.getElementById('call-options');
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

// Each tab is its own player, so its id lives in sessionStorage: reloading keeps your seat,
// and several tabs in one browser can sit at the same table. Your name is remembered.
const playerId = sessionStorage.getItem('riichiId') ?? crypto.randomUUID();
sessionStorage.setItem('riichiId', playerId);
$('name').value = localStorage.getItem('riichiName') ?? '';
const myName = () => {
  const name = $('name').value.trim() || 'Player';
  localStorage.setItem('riichiName', name);
  return name;
};
const roomInUrl = () => new URLSearchParams(location.search).get('room');
const setUrlRoom = (code) => {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
  history.replaceState(null, '', url);
};

ws.addEventListener('open', () => {
  // Opening an invite link (or reloading) rejoins that room straight away if we have a name.
  const code = roomInUrl();
  if (code) $('join-code').value = code;
  if (code && localStorage.getItem('riichiName')) send({ type: 'join', code, id: playerId, name: myName() });
  else showScreen('lobby');
});
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'joined') setUrlRoom(msg.code);
  else if (msg.type === 'left') {
    view = null;
    setUrlRoom(null);
    showScreen('lobby');
  } else if (msg.type === 'error') {
    $('lobby-error').textContent = msg.message;
    if (!view) showScreen('lobby');
  } else if (msg.type === 'state') {
    view = msg;
    render();
  }
});
ws.addEventListener('close', () => {
  document.body.insertAdjacentHTML('afterbegin', '<p class="banner">Disconnected from the server. Reload the page to reconnect.</p>');
});

function send(msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

// --- Settings ---

const SETTING_FIELDS = [
  { key: 'length', label: 'Length', options: [['east', 'East only (tonpuusen)'], ['south', 'East + South (hanchan)']] },
  { key: 'bust', label: 'End the match when someone goes below 0' },
  { key: 'extension', label: 'Sudden death: if nobody has 30,000 at the end, play on into the next wind' },
  { key: 'agariYame', label: 'Agari-yame: a last-hand dealer in first place may end the match' },
];
const DEFAULT_SETTINGS = { length: 'south', bust: true, extension: true, agariYame: true };

// Fills container with the settings; editable ones call onChange with the new settings.
function renderSettings(container, settings, editable, onChange) {
  container.innerHTML = '';
  for (const field of SETTING_FIELDS) {
    const row = document.createElement('label');
    row.className = 'setting';
    let input;
    if (field.options) {
      input = document.createElement('select');
      for (const [value, text] of field.options) input.add(new Option(text, value, false, settings[field.key] === value));
      row.append(`${field.label} `, input);
    } else {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = settings[field.key];
      row.append(input, ` ${field.label}`);
    }
    input.disabled = !editable;
    input.addEventListener('change', () => {
      onChange({ ...settings, [field.key]: field.options ? input.value : input.checked });
    });
    container.appendChild(row);
  }
}

let createSettings = { ...DEFAULT_SETTINGS };
const drawCreateSettings = () => renderSettings($('create-settings'), createSettings, true, (s) => {
  createSettings = s;
  drawCreateSettings();
});
drawCreateSettings();

$('create').addEventListener('click', () => send({ type: 'create', id: playerId, name: myName(), settings: createSettings }));
$('join').addEventListener('click', () => {
  const code = $('join-code').value.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(code)) {
    $('lobby-error').textContent = 'A room code is 6 characters, 0-9 and a-f.';
    return;
  }
  send({ type: 'join', code, id: playerId, name: myName() });
});
$('copy-link').addEventListener('click', async () => {
  await navigator.clipboard?.writeText(location.href);
  $('copied').hidden = false;
  setTimeout(() => ($('copied').hidden = true), 1500);
});
$('start').addEventListener('click', () => send({ type: 'start' }));
for (const id of ['leave-waiting', 'leave-table']) $(id).addEventListener('click', () => send({ type: 'leave' }));

function renderWaiting() {
  const { room, you } = view;
  $('room-code').textContent = room.code;
  const list = $('seat-list');
  list.innerHTML = '';
  room.seats.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = p ? `${p.name}${i === you ? ' (you)' : ''}${i === room.hostSeat ? ' · host' : ''}${p.connected ? '' : ' · offline'}` : 'Empty seat';
    li.className = p ? '' : 'empty';
    list.appendChild(li);
  });
  $('spectator-count').textContent = room.spectators ? `${room.spectators} watching` : '';
  const isHost = you !== null && you === room.hostSeat;
  renderSettings($('room-settings'), room.settings, isHost, (s) => send({ type: 'settings', settings: s }));
  const full = room.seats.every(Boolean);
  $('start').hidden = !isHost;
  $('start').disabled = !full;
  $('waiting-hint').textContent = you === null ? 'The room is full: you are watching.'
    : isHost ? (full ? 'Everyone is here.' : 'Share the invite link; the match can start once all four seats are taken.')
      : 'Waiting for the host to start the match.';
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

const nameOf = (seat) => view.room.seats[seat]?.name ?? `Player ${seat + 1}`;

function playerName(seat, game) {
  return `${seatWind(seat, game.dealer)} (${nameOf(seat)})`;
}

function renderSeat(el, player, game, you) {
  el.innerHTML = '';
  el.classList.toggle('active', game.current === player.seat && game.phase === 'discard');
  const result = game.result;
  const won = result?.winners?.includes(player.seat);
  el.classList.toggle('winner', !!won);

  const name = document.createElement('div');
  name.className = 'seat-name';
  const who = player.seat === you ? `${nameOf(player.seat)} (you)` : nameOf(player.seat);
  const offline = view.room.seats[player.seat]?.connected ? '' : ' (offline)';
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
  // Open melds are public, to the right of the hand. The called tile lies sideways.
  if (player.melds.length) {
    const melds = document.createElement('div');
    melds.className = 'melds';
    for (const meld of player.melds) {
      const group = document.createElement('div');
      group.className = 'meld';
      // The called tile goes on the side it came from.
      const [called, ...own] = meld.tiles;
      own.splice(calledTilePosition(meld, player.seat), 0, called);
      own.forEach((t) => group.appendChild(tileEl(t, { extraClass: t.id === meld.calledId ? 'called' : '' })));
      melds.appendChild(group);
    }
    hand.appendChild(melds);
  }
  el.appendChild(hand);

  // Between your turns, show your own waits (not mid-turn, e.g. right after a chii).
  const myDiscard = game.current === you && game.phase === 'discard';
  if (player.seat === you && player.hand && !player.drawn && !won && !myDiscard) {
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
  // The riichi declaration tile lies sideways; tsumogiri discards are a shade darker, and
  // discards another player called are darker still.
  player.discards.forEach((t, i) => {
    const classes = [];
    if (target && t.id === target.id) classes.push('claim-tile');
    if (player.riichi?.discardIndex === i) classes.push('riichi-tile');
    if (player.called[i]) classes.push('called-away');
    else if (player.tsumogiri[i]) classes.push('tsumogiri');
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
    const p = s.payment;
    const pay = p.ron !== undefined ? p.ron.toLocaleString()
      : p.all !== undefined ? `${p.all.toLocaleString()} all`
        : `${p.nonDealer.toLocaleString()}/${p.dealer.toLocaleString()}`;
    // Yakuman replace han and fu; each is listed with its value (a double counts twice).
    if (s.yakuman) {
      const parts = s.yaku.map((y) => `${y.name}${y.yakuman > 1 ? ` (${y.yakuman}x)` : ''}`);
      return `<div class="breakdown"><b>${who}:</b> ${parts.join(' · ')}<br>${s.limit}: ${pay}</div>`;
    }
    const parts = s.yaku.map((y) => `${y.name} ${y.han}`);
    if (s.dora.dora) parts.push(`Dora ${s.dora.dora}`);
    if (s.dora.aka) parts.push(`Red five ${s.dora.aka}`);
    if (s.dora.ura) parts.push(`Ura dora ${s.dora.ura}`);
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
  // The pause after a discard nobody can call looks the same as others deciding on a call.
  if (game.phase === 'draw') return 'Waiting for other players';
  if (game.phase === 'claim') {
    const tile = tileLabel(game.lastDiscard.tile);
    const can = [game.canRon && 'ron', game.ponOptions.length && 'pon', game.chiiOptions.length && 'chii'].filter(Boolean);
    if (can.length) return `You can ${can.join(' or ')} on ${tile}`;
    return 'Waiting for other players';
  }
  if (game.current === you && choosingRiichi) return 'Riichi: choose a tile to discard';
  if (game.current === you && game.autoDiscarding) return 'Riichi: discarding…';
  if (game.current === you && game.players[you].riichi) return 'Riichi: tsumo, or click the drawn tile to pass';
  if (game.current === you) return game.canTsumo ? 'Your turn: tsumo or discard' : 'Your turn: discard a tile';
  return `Waiting for ${playerName(game.current, game)}`;
}

// The end-of-match standings.
function finalHtml(match, you) {
  const rows = match.final.ranking.map((r) => `<tr><td>${r.place}</td><td>${nameOf(r.seat)}${r.seat === you ? ' (you)' : ''}</td>` +
    `<td>${r.score.toLocaleString()}</td></tr>`).join('');
  const reasons = {
    'last hand': 'The last hand is over.', 'target reached': 'Someone reached 30,000 in sudden death.',
    'extension over': 'Sudden death ran out.', bust: 'Someone went below 0.', 'agari-yame': 'The dealer ended it in first place.',
  };
  return `<div class="final"><div class="status">Match over</div><div>${reasons[match.final.reason] ?? ''}</div>` +
    `<table><tr><th>Place</th><th>Player</th><th>Score</th></tr>${rows}</table></div>`;
}

function render() {
  const { you, game, room, match } = view;
  if (!room.started) {
    showScreen('waiting');
    renderWaiting();
    return;
  }
  showScreen('table');
  if (!game?.riichiDiscards?.length) choosingRiichi = false;

  // Spectators view from seat 0.
  const pov = you ?? 0;
  game.players.forEach((p) => {
    renderSeat(seatEls[POSITIONS[(p.seat - pov + 4) % 4]], p, game, you);
  });

  const offline = room.seats.filter((p) => !p.connected).length;
  infoEl.innerHTML = `
    ${match.over ? finalHtml(match, you) : ''}
    <div class="status">${statusText(game, you)}</div>
    ${breakdownHtml(game, you)}
    <div class="hand-label">${match.label}${game.honba ? ` · ${game.honba} honba` : ''}</div>
    <div>Wall: ${game.wallCount} tiles left</div>
    <div>Dora indicator: ${game.doraIndicators.map(tileLabel).join(' ')}</div>
    ${game.result?.uraIndicators ? `<div>Ura dora indicator: ${game.result.uraIndicators.map(tileLabel).join(' ')}</div>` : ''}
    ${game.riichiSticks ? `<div>Riichi sticks: ${game.riichiSticks} (${(game.riichiSticks * 1000).toLocaleString()})</div>` : ''}
    ${game.result?.honbaBonus ? `<div>Honba: +${game.result.honbaBonus.toLocaleString()}</div>` : ''}
    ${you === null ? '<div>Watching</div>' : ''}
    ${offline ? `<div>${offline} player${offline > 1 ? 's' : ''} offline</div>` : ''}
    <div class="room-code">Room ${room.code}</div>
  `;
  const ended = game.phase === 'ended';
  nextHandBtn.hidden = !ended || match.over || you === null;
  rematchBtn.hidden = !match.over || you !== room.hostSeat;
  leaveTableBtn.hidden = !match.over && you !== null;
  riichiBtn.hidden = !game.riichiDiscards.length;
  riichiBtn.classList.toggle('selected', choosingRiichi);
  tsumoBtn.hidden = !game.canTsumo;
  ronBtn.hidden = !game.canRon;
  passBtn.hidden = !game.canRon && !game.ponOptions.length && !game.chiiOptions.length;

  // One Pon or Chii button per distinct pair of tiles you could reveal.
  callOptionsEl.innerHTML = '';
  const mine = game.players[you]?.hand ?? [];
  for (const [type, label] of [['pon', 'Pon'], ['chii', 'Chii']]) {
    for (const pair of game[`${type}Options`]) {
      const labels = pair.map((id) => tileLabel(mine.find((t) => t.id === id)));
      const btn = document.createElement('button');
      btn.textContent = `${label} ${labels.join(' ')}`;
      btn.addEventListener('click', () => send({ type, tiles: pair }));
      callOptionsEl.appendChild(btn);
    }
  }
}

riichiBtn.addEventListener('click', () => {
  choosingRiichi = !choosingRiichi;
  render();
});

nextHandBtn.addEventListener('click', () => send({ type: 'nextHand' }));
rematchBtn.addEventListener('click', () => send({ type: 'rematch' }));
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
