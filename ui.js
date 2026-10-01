// Renders the server-provided view and sends player intents. No game logic here.
// Three screens: the lobby (name, create or join a room), the waiting room, and the table.
// The room code lives in the address (?room=abc123), so a link can be shared.

import { tileLabel, calledTilePosition, WINDS } from './game.js';

const $ = (id) => document.getElementById(id);
const screens = { lobby: $('lobby'), waiting: $('waiting'), table: $('table') };
const infoEl = $('info');
const nextHandBtn = $('next-hand');
const rematchBtn = $('rematch');
const leaveTableBtn = $('leave-table');
const riichiBtn = document.getElementById('riichi');
const tsumoBtn = document.getElementById('tsumo');
const kyuushuBtn = $('kyuushu');
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
  { key: 'yakuRebalance', label: 'Yaku rebalance (house rules)' },
];
const DEFAULT_SETTINGS = { length: 'south', bust: true, extension: true, agariYame: true, yakuRebalance: false };

// The rule details shown under the settings, folded away until clicked.
const RULE_DETAILS = `
  <p><b>Length.</b> East only: East 1 to East 4. East + South: East 1 to South 4. The dealer
  repeats after winning or being tenpai at an exhaustive draw (or an abortive draw), so a
  round can have more hands than this.</p>
  <p><b>Bust.</b> The match ends as soon as anyone's score is below 0.</p>
  <p><b>Sudden death.</b> If nobody has 30,000 when the last hand ends, play continues into the
  next wind (South for an East-only match, West for East + South) and ends as soon as someone
  has 30,000 after a hand, or when that wind is over.</p>
  <p><b>Agari-yame.</b> In the last hand, if the dealer repeats while in first place (and, with
  sudden death on, with at least 30,000), the match ends instead of continuing.</p>
  <p><b>Yaku rebalance.</b> House values for a few yaku:</p>
  <table>
    <tr><th>Yaku</th><th>Standard</th><th>Rebalanced</th></tr>
    <tr><td>Nagashi mangan</td><td>mangan</td><td>baiman (still combines with nothing)</td></tr>
    <tr><td>Sankantsu (three kans)</td><td>2 han</td><td>yakuman</td></tr>
    <tr><td>Suukantsu (four kans)</td><td>yakuman</td><td>double yakuman</td></tr>
    <tr><td>Sanshoku doukou</td><td>2 han</td><td>3 han</td></tr>
    <tr><td>Ryanpeikou</td><td>3 han</td><td>6 han (iipeikou is still 1)</td></tr>
    <tr><td>Renhou: a ron before your first draw, with no calls before it (not the dealer)</td><td>(none)</td>
      <td>8 han (baiman), counting no other yaku or dora; if the hand is worth more without it, that score is used</td></tr>
    <tr><td>Shoutate: triplets of one number in two suits and a pair of it in the third</td><td>(none)</td><td>2 han</td></tr>
  </table>
  <p><b>Always on.</b> Honba go up on a dealer repeat and on every draw, reset after a
  non-dealer win, and add 300 each to a win. Riichi sticks left at the end go to first place.
  Open tanyao, double ron, and Mahjong Soul's double yakuman (13-sided kokushi, 9-sided
  chuuren, suuankou tanki, daisuushi) are on. A win needs at least one yaku.</p>`;

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
  // The settings are redrawn on every update, so remember whether the details were open.
  const details = document.createElement('details');
  details.className = 'rule-details';
  details.innerHTML = `<summary>Click for details</summary>${RULE_DETAILS}`;
  details.open = !!detailsOpen[container.id];
  details.addEventListener('toggle', () => (detailsOpen[container.id] = details.open));
  container.appendChild(details);
}
const detailsOpen = {};

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

// A tile object for a tile kind (0-33), for showing a kind with the normal tile element.
function tileOfKind(kind) {
  return { id: -1, suit: 'mpsz'[Math.floor(kind / 9)], rank: (kind % 9) + 1, red: false };
}

function seatWind(seat, dealer) {
  return WINDS[(seat - dealer + 4) % 4];
}

// Names are chosen by players, so they are escaped before going into any HTML.
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nameOf = (seat) => escapeHtml(view.room.seats[seat]?.name ?? `Player ${seat + 1}`);

function playerName(seat, game) {
  return `${seatWind(seat, game.dealer)} (${nameOf(seat)})`;
}

function renderSeat(el, player, game, you) {
  el.innerHTML = '';
  // The player whose turn it is gets a bold name line and a highlighted seat. After a discard
  // it stays on the discarder until the tile is called or skipped (see game.turn from the
  // server), which looks the same whether or not anyone could call it.
  el.classList.toggle('active', game.turn === player.seat && game.phase !== 'ended');
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
    if (result.nagashi.includes(player.seat)) name.innerHTML += ' · <span class="riichi-tag">Nagashi mangan</span>';
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
      if (meld.kanType === 'ankan') {
        // A closed kan shows its two end tiles face down.
        meld.tiles.forEach((t, i) => group.appendChild(i === 0 || i === 3 ? tileEl(null) : tileEl(t)));
      } else {
        // The called tile goes on the side it came from; an added kan's tile lies beside it.
        const [called, ...rest] = meld.tiles;
        const own = rest.filter((t) => t.id !== meld.addedId);
        const shown = [...own];
        shown.splice(calledTilePosition(meld, player.seat), 0, called);
        const added = rest.find((t) => t.id === meld.addedId);
        if (added) shown.splice(shown.indexOf(called) + 1, 0, added);
        shown.forEach((t) => group.appendChild(tileEl(t, { extraClass: t.id === meld.calledId || t.id === meld.addedId ? 'called' : '' })));
      }
      melds.appendChild(group);
    }
    hand.appendChild(melds);
  }
  el.appendChild(hand);

  // Between your turns, show your own waits (not mid-turn, e.g. right after a chii).
  const myDiscard = game.current === you && game.phase === 'discard';
  if (player.seat === you && player.hand && !player.drawn && !won && !myDiscard) {
    // Each wait is shown as a tile, noting if winning on it has no yaku or only by tsumo
    // (atozuke: a hand may have a yaku on only some of its waits). Furiten belongs to the
    // whole hand, so a single "(furiten)" comes after all the waits.
    const waits = game.waits;
    const line = document.createElement('div');
    line.className = 'waits';
    if (!waits.length) {
      line.textContent = 'Not tenpai';
    } else {
      line.append('Tenpai:');
      for (const w of waits) {
        const item = document.createElement('span');
        item.className = 'wait';
        item.appendChild(tileEl(tileOfKind(w.kind)));
        if (!w.ron) item.append(w.tsumo ? '(tsumo only)' : '(no yaku)');
        line.appendChild(item);
      }
      const f = game.furiten;
      if (f && (f.discard || f.temporary || f.riichi)) {
        const tag = document.createElement('span');
        tag.className = 'furiten-tag';
        tag.textContent = '(furiten)';
        line.appendChild(tag);
      }
    }
    el.appendChild(line);
  }

  const pond = document.createElement('div');
  pond.className = 'pond';
  // The discard you can call is outlined (only players who can call it are sent it), and so is
  // the tile a hand was won on by ron.
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
  if (result?.type === 'abortiveDraw') {
    if (result.reason === 'suucha riichi') return 'Abortive draw: all four players declared riichi';
    if (result.reason === 'suukaikan') return 'Abortive draw: four kans by more than one player';
    const [seat] = result.revealed;
    return `Abortive draw: ${seat === you ? 'you' : playerName(seat, game)} declared nine terminals and honors`;
  }
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
    return `${names.join(' and ')} ${verb} by ron${result.chankan ? ' (robbing a kan)' : ''} on ${tileLabel(result.tile)} from ${from}`;
  }
  // Whose turn it is shows as a bold name line, not here. The pause before a draw (which is
  // also how others deciding on a call look) has no status text.
  if (game.phase === 'draw') return '';
  if (game.phase === 'rinshan') return game.current === you ? 'Kan: drawing a replacement tile…' : '';
  if (game.phase === 'claim') {
    const tile = tileLabel(game.lastDiscard.tile);
    if (game.lastDiscard.chankan) return game.canRon ? `You can rob the kan: ron on ${tile}` : '';
    const can = [game.canRon && 'ron', game.ponOptions.length && 'pon', game.openKanOptions.length && 'kan', game.chiiOptions.length && 'chii'].filter(Boolean);
    return can.length ? `You can ${can.join(' or ')} on ${tile}` : '';
  }
  if (game.current === you && choosingRiichi) return 'Riichi: choose a tile to discard';
  if (game.current === you && game.autoDiscarding) return 'Riichi: discarding…';
  if (game.current === you && game.players[you].riichi) {
    const options = [game.canTsumo && 'tsumo', game.kanOptions.length && 'kan'].filter(Boolean).join(' or ');
    return `Riichi: ${options}, or click the drawn tile to pass`;
  }
  if (game.current === you) return game.canTsumo ? 'Your turn: tsumo or discard' : 'Your turn: discard a tile';
  return '';
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

// Five slots per row: the first indicator plus one for each possible kan. Revealed dora
// indicators are face up; ura dora stay face down unless a riichi hand won this hand.
const INDICATOR_SLOTS = 5;
function renderDora(game) {
  const fill = (row, tiles) => {
    row.innerHTML = '';
    for (let i = 0; i < INDICATOR_SLOTS; i++) row.appendChild(tileEl(tiles[i] ?? null));
  };
  fill($('dora-row'), game.doraIndicators);
  fill($('ura-row'), game.result?.uraIndicators ?? []);
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

  renderDora(game);
  const offline = room.seats.filter((p) => !p.connected).length;
  infoEl.innerHTML = `
    ${match.over ? finalHtml(match, you) : ''}
    ${(() => { const status = statusText(game, you); return status ? `<div class="status">${status}</div>` : ''; })()}
    ${breakdownHtml(game, you)}
    <div class="hand-label">${match.label}${game.honba ? ` · ${game.honba} honba` : ''}</div>
    <div>Wall: ${game.wallCount} tiles left</div>
    <div>Riichi sticks: ${game.riichiSticks} (${(game.riichiSticks * 1000).toLocaleString()})</div>
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
  kyuushuBtn.hidden = !game.canKyuushu;
  ronBtn.hidden = !game.canRon;
  passBtn.hidden = !game.canRon && !game.ponOptions.length && !game.openKanOptions.length && !game.chiiOptions.length;

  // One Pon or Chii button per distinct pair of tiles you could reveal.
  callOptionsEl.innerHTML = '';
  const mine = game.players[you]?.hand ?? [];
  // Each call button is styled by its kind (see .call-pon, .call-chii, .call-kan in style.css).
  const button = (text, msg) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.className = `call-${msg.type}`;
    btn.addEventListener('click', () => send(msg));
    callOptionsEl.appendChild(btn);
  };
  for (const [type, label, key] of [['pon', 'Pon', 'ponOptions'], ['kan', 'Kan', 'openKanOptions'], ['chii', 'Chii', 'chiiOptions']]) {
    for (const pair of game[key]) {
      const labels = pair.map((id) => tileLabel(mine.find((t) => t.id === id)));
      button(`${label} ${labels.join(' ')}`, { type, tiles: pair });
    }
  }
  // Closed or added kans on your own turn.
  const allMine = [...mine, ...(game.players[you]?.drawn ? [game.players[you].drawn] : [])];
  for (const option of game.kanOptions) {
    const tile = allMine.find((t) => t.id === option.tiles[0]);
    button(`Kan ${tileLabel(tile)}${option.type === 'kakan' ? ' (added)' : ''}`, { type: 'kan', kind: option.kind });
  }
}

riichiBtn.addEventListener('click', () => {
  choosingRiichi = !choosingRiichi;
  render();
});

nextHandBtn.addEventListener('click', () => send({ type: 'nextHand' }));
rematchBtn.addEventListener('click', () => send({ type: 'rematch' }));
tsumoBtn.addEventListener('click', () => send({ type: 'tsumo' }));
kyuushuBtn.addEventListener('click', () => send({ type: 'kyuushu' }));
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
