// Renders the server-provided view and sends player intents. No game logic here.
// Three screens: the lobby (name, create or join a room), the waiting room, and the table.
// The room code lives in the address (?room=abc123), so a link can be shared.

import { tileLabel, tileIndex, isWild, calledTilePosition, WINDS } from './game.js';

const $ = (id) => document.getElementById(id);
const screens = { lobby: $('lobby'), waiting: $('waiting'), table: $('table'), matches: $('matches'), replay: $('replay') };
const infoEl = $('info');
const nextHandBtn = $('next-hand');
const rematchBtn = $('rematch');
const leaveTableBtn = $('leave-table');
const riichiBtn = document.getElementById('riichi');
const tsumoBtn = document.getElementById('tsumo');
const kyuushuBtn = $('kyuushu');
const ronBtn = document.getElementById('ron');
const passBtn = document.getElementById('pass');
const exchangeBtn = $('exchange');
// Baiman contest tile exchange: the tiles (by id) you have selected to pass, before sending them.
let exchangePicks = new Set();
const callOptionsEl = document.getElementById('call-options');
const autoEl = $('auto-settings');
const autoBoxes = [...autoEl.querySelectorAll('input[data-auto]')];
const seatEls = {
  bottom: document.querySelector('.seat-bottom'),
  right: document.querySelector('.seat-right'),
  top: document.querySelector('.seat-top'),
  left: document.querySelector('.seat-left'),
};
// Relative position of each seat from your point of view (turn order goes to your right).
const POSITIONS = ['bottom', 'right', 'top', 'left'];

// --- Addresses ---
// The site root comes from the page's <base href>, written in relative by the server (see PAGES
// in server.js). It is fixed as an absolute address now, since a relative base would move with
// every history.pushState. Every address the page uses is relative to it.
const baseEl = document.querySelector('base');
baseEl.href = baseEl.href; // absolute from here on
const ROOT = new URL(baseEl.href);
const rootPath = ROOT.pathname;

// Game server to connect to, e.g. 'wss://riichi.example.com' when the page is hosted on
// GitHub Pages. Empty means the server that served this page (its WebSocket at the site root).
const SERVER_URL = '';
const socketUrl = () => {
  const url = new URL('.', ROOT);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
};

let view = null;
// True after pressing Riichi, while choosing the tile to declare with.
let choosingRiichi = false;
const ws = new WebSocket(SERVER_URL || socketUrl());

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
// The page for the current address, relative to the site root: '' (the main page), 'replays',
// 'replays/match' or 'game'; and its query.
const route = () => (location.pathname.startsWith(rootPath) ? location.pathname.slice(rootPath.length) : '');
const query = (key) => new URLSearchParams(location.search).get(key);

// Goes to an address relative to the site root, e.g. 'game?room=3fa9c1' or './' for the main
// page, adding it to the history (or replacing the current entry), and shows its page.
function navigate(address, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', new URL(address, ROOT));
  showRoute();
}
window.addEventListener('popstate', showRoute); // the browser's Back and Forward
// The room this tab is in (from the server's 'joined'), so arriving at its address doesn't join again.
let joinedCode = null;

// Shows the page for the current address. Leaving /game (say with Back) leaves the room; during
// a match the seat is kept, so Forward (or the link) takes it back.
function showRoute() {
  const page = route();
  $('lobby-error').textContent = '';
  if (page !== 'game' && joinedCode) send({ type: 'leave' });
  if (page === 'game') {
    const code = query('room');
    if (!code) return navigate('./', { replace: true });
    if (joinedCode === code) return view && render();
    // Opening an invite link (or reloading) joins that room straight away if we have a name;
    // otherwise the main page asks for one, with the code filled in.
    $('join-code').value = code;
    if (localStorage.getItem('riichiName')) send({ type: 'join', code, id: playerId, name: myName() });
    else showScreen('lobby');
  } else if (page === 'replays') {
    openMatches();
  } else if (page === 'replays/match') {
    showReplay();
  } else {
    showScreen('lobby');
  }
}

// The game page needs the server; the other pages show straight away (see the end of this file).
ws.addEventListener('open', () => route() === 'game' && showRoute());
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'joined') {
    joinedCode = msg.code;
    // A room you created or joined: its address, unless you are already on it.
    if (route() !== 'game' || query('room') !== msg.code) navigate(`game?room=${msg.code}`, { replace: route() === 'game' });
  } else if (msg.type === 'left') {
    joinedCode = null;
    view = null;
    clearTimeout(holdTimer);
    holdTimer = null;
    if (route() === 'game') navigate('./');
  } else if (msg.type === 'error') {
    if (!view && route() === 'game') navigate('./', { replace: true });
    $('lobby-error').textContent = msg.message;
  } else if (msg.type === 'state') {
    if (route() === 'game') showState(msg); // not after leaving with Back
  }
});

// When a hand is won by ron or tsumo (or a Baiman contest hand ends on its third win), the table stays as it was for CALLOUT_HOLD_MS with the
// winners' callouts showing, and nothing can be clicked; then the result is shown. States that
// arrive meanwhile are kept, and the latest one is shown when the pause ends. The server's
// NO_DELAYS flag turns this off.
const CALLOUT_HOLD_MS = 1000;
let holdTimer = null;
let latestState = null;
function showState(msg) {
  latestState = msg;
  if (holdTimer) return;
  const playing = view?.game && view.game.phase !== 'ended';
  const result = msg.game?.result;
  const byWin = ['ron', 'tsumo'].includes(result?.type) || (result?.type === 'contest' && result.reason === 'three winners');
  if (playing && !msg.noDelays && byWin) {
    view = heldView(view, msg);
    render();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      view = latestState;
      render();
    }, CALLOUT_HOLD_MS);
    return;
  }
  view = msg;
  render();
}

// The previous table with the new callouts and no actions available.
function heldView(before, after) {
  const game = before.game;
  return {
    ...before,
    game: {
      ...game,
      phase: 'held',
      players: game.players.map((p, i) => ({ ...p, callout: after.game.players[i].callout })),
      canTsumo: false, canRon: false, canKyuushu: false, autoDiscarding: false,
      ponOptions: [], chiiOptions: [], openKanOptions: [], kanOptions: [], riichiDiscards: [], discardPreview: {},
    },
  };
}
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
  { key: 'format', label: 'Format', radios: [['standard', 'Standard'], ['baiman', 'Baiman contest']] },
  { key: 'length', label: 'Length', radios: [['east', 'East only (tonpuusen)'], ['south', 'East + South (hanchan)']] },
  // standardOnly: hidden for the Baiman contest, where they are always off (see match.js).
  { key: 'bust', label: 'End the match when someone goes below 0', standardOnly: true },
  { key: 'extension', label: 'Sudden death: if nobody has 30,000 at the end, play on into the next wind', standardOnly: true },
  { key: 'agariYame', label: 'Agari-yame: a last-hand dealer in first place may end the match' },
  { key: 'yakuRebalance', label: 'Yaku rebalance (house rules)' },
  { key: 'noHints', label: 'No hints: no waits, tile highlighting or ippatsu shown' },
  // contestOnly: shown only for the Baiman contest.
  { key: 'contestRepeat', label: 'Dealer repeats (honba)', contestOnly: true,
    radios: [['baiman', 'Only when the dealer wins a baiman or sanbaiman'], ['none', 'Never']] },
];
const DEFAULT_SETTINGS = { format: 'standard', length: 'south', bust: true, extension: true, agariYame: true, yakuRebalance: false, noHints: false, contestRepeat: 'baiman' };

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
    <tr><td>Nagashi</td><td>mangan</td><td>baiman (still combines with nothing)</td></tr>
    <tr><td>Sankantsu (three kans)</td><td>2 han</td><td>yakuman</td></tr>
    <tr><td>Suukantsu (four kans)</td><td>yakuman</td><td>double yakuman</td></tr>
    <tr><td>Sanshoku doukou</td><td>2 han</td><td>3 han</td></tr>
    <tr><td>Ryanpeikou</td><td>3 han</td><td>6 han (iipeikou is still 1)</td></tr>
    <tr><td>Renhou: a ron before your first draw, with no calls before it (not the dealer)</td><td>(none)</td>
      <td>8 han (baiman), counting no other yaku or dora; if the hand is worth more without it, that score is used</td></tr>
    <tr><td>Shoutate: triplets of one number in two suits and a pair of it in the third</td><td>(none)</td><td>2 han</td></tr>
  </table>
  <p><b>No hints.</b> Hides everything that only helps: your waits and the tiles left (under your
  hand and on hovering a discard), furiten, the outline on other copies of a hovered tile, the
  outline on your drawn tile and on a discard you can call, the shading of tsumogiri discards,
  the dimming of tiles you can't riichi with, and ippatsu. Discards that were called stay dark
  gray, "Riichi" and "Double riichi" still show, and the Riichi, Tsumo, Ron and call buttons
  still appear when those are possible.</p>
  <p><b>Always on.</b> Honba go up on a dealer repeat and on every draw, reset after a
  non-dealer win, and add 300 each to a win. Riichi sticks left at the end go to first place.
  Open tanyao, double ron, and Mahjong Soul's double yakuman (13-sided kokushi, 9-sided
  chuuren, suuankou tanki, daisuushi) are on. A win needs at least one yaku.</p>
  <p><b>Baiman contest.</b> See its "Detailed rules" next to the format.</p>`;

// The Baiman contest's rules, folded away next to the format choice.
const CONTEST_RULES = `
  <p><b>Points.</b> Everyone starts on 0. A win worth a baiman (8-10 han) or sanbaiman (11-12
  han) scores 1 point, counted as soon as it is won; any other win scores 0. Fu don't matter
  and aren't shown. Nobody ever loses points: not for dealing in, not when someone else wins
  by tsumo, and riichi is free (no 1,000-point stick, so you can riichi on 0). There are no
  noten payments and honba add nothing.</p>
  <p><b>The wild tile.</b> Every hand deals each player one wild tile (1A) as their 13th tile,
  on top of the usual 136. It can never be discarded, and it is only used for winning: a hand
  wins (by ron or tsumo) if the wild tile can stand for some tile that completes it. It can be
  any of the 34 kinds, but never a red five, even a kind whose four copies are all elsewhere.
  The win is always scored as whichever kind gives the most han, and that kind counts for dora
  (so an extra dora can push a hand past sanbaiman). Your waits are every tile that wins for
  some value of the wild tile. A hand whose other tiles are already complete sets wins on any
  tile, and six different pairs win on any of the 28 other kinds (seven pairs must be distinct);
  either way the waits are shown as the wild tile alone. Since such a hand waits on nearly
  everything, it is almost always furiten and has to win by tsumo. Riichi, pon, chii and kan use
  your other tiles as usual.</p>
  <p><b>The tile exchange.</b> Each hand starts, before the dealer's first draw, with every player
  choosing exactly three tiles to pass (never the wild tile): click them, then "Pass 3 tiles".
  Once all four have chosen, each player's three tiles go to a randomly chosen other player
  (a random derangement: nobody gets their own back). Who passed to whom is then shown under
  the round, e.g. "Tile passes: E -> S, S -> W, W -> N, N -> E", for the rest of the hand.
  Then play starts as usual. It makes rare hands, flushes in particular, easier to build.</p>
  <p><b>Up to three winners.</b> A win doesn't end the hand. The winner sits out the rest of it:
  play skips them, and they can't win again, call, or be dealt into. Several players can ron
  the same tile, which stays in the discarder's pond. The hand ends when three players have
  won, when the wall runs out, on a yakuman, or on kyuushu kyuuhai or suufon renda (the only
  abortive draws). Any ron or tsumo before the fourth wind rules out suufon renda.</p>
  <p><b>What stays hidden.</b> A winner's hand stays hidden until the hand ends, with their
  Ron or Tsumo shown above their name. Their han are shown to everyone under "Baiman contest"
  straight away. The ura dora count for riichi winners as usual, but during the hand only a
  player who has won in riichi can see them. Everything is shown when the hand ends.</p>
  <p><b>A ron interrupts like a call.</b> It ends every riichi player's ippatsu and the
  uninterrupted first go-around (so no double riichi, chiihou, renhou or kyuushu kyuuhai after
  it), and the discarder loses nagashi. A tsumo by another player doesn't.</p>
  <p><b>Robbing a kan.</b> As usual, any winning hand can rob an added kan (chankan), and only
  kokushi can rob a closed kan. After a robbed added kan the kan player plays on, as if they had
  discarded the tile; kokushi is a yakuman, so it ends the hand and the match.</p>
  <p><b>Nagashi.</b> At the end of the wall, a player who hasn't won and whose discards
  are all terminals and honors, none of them called or ronned, scores it like a win: a mangan
  (0 points), or a baiman (1 point) with the yaku rebalance.</p>
  <p><b>Yakuman.</b> Any yakuman, including a kazoe yakuman (13+ han), ends the hand and the
  match at once. It scores 0 points; the match is ranked by points as usual.</p>
  <p><b>The match.</b> Dealer repeats follow the "Dealer repeats (honba)" setting: either the
  dealer repeats only after winning a baiman or sanbaiman (a win worth a point), or the deal
  always passes. Draws and abortive draws never repeat the dealer. Honba count the dealer's
  repeats in a row and are worth nothing. Going bust and sudden death don't apply; length and
  agari-yame do.</p>`;

// Fills container with the settings; editable ones call onChange with the new settings.
function renderSettings(container, settings, editable, onChange) {
  container.innerHTML = '';
  for (const field of SETTING_FIELDS) {
    if (field.standardOnly && settings.format === 'baiman') continue;
    if (field.contestOnly && settings.format !== 'baiman') continue;
    if (field.radios) {
      // Exactly one choice, as radio buttons.
      const row = document.createElement('div');
      row.className = 'setting setting-radios';
      row.append(`${field.label}: `);
      for (const [value, text] of field.radios) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `${container.id}-${field.key}`;
        input.checked = settings[field.key] === value;
        input.disabled = !editable;
        input.addEventListener('change', () => onChange({ ...settings, [field.key]: value }));
        label.append(input, ` ${text}`);
        row.appendChild(label);
        if (field.key === 'format' && value === 'baiman') row.appendChild(contestRulesToggle(container));
      }
      container.appendChild(row);
      if (field.key === 'format' && detailsOpen[`${container.id}-contest`]) {
        const rules = document.createElement('div');
        rules.className = 'rule-details contest-rules';
        rules.innerHTML = CONTEST_RULES;
        container.appendChild(rules);
      }
      continue;
    }
    // Everything else is an on/off checkbox.
    const row = document.createElement('label');
    row.className = 'setting';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings[field.key];
    row.append(input, ` ${field.label}`);
    input.disabled = !editable;
    input.addEventListener('change', () => onChange({ ...settings, [field.key]: input.checked }));
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

// "Detailed rules" right after the Baiman contest option: opens its rules under the format row.
// It works whatever the format, and for players who can't change the settings.
function contestRulesToggle(container) {
  const key = `${container.id}-contest`;
  const toggle = document.createElement('span');
  toggle.className = 'rules-toggle';
  toggle.setAttribute('role', 'button');
  toggle.tabIndex = 0;
  toggle.textContent = `${detailsOpen[key] ? '▾' : '▸'} Detailed rules`;
  const flip = () => {
    detailsOpen[key] = !detailsOpen[key];
    if (container.id === 'create-settings') drawCreateSettings();
    else render();
  };
  toggle.addEventListener('click', flip);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flip();
    }
  });
  return toggle;
}

let createSettings = { ...DEFAULT_SETTINGS };
const drawCreateSettings = () => renderSettings($('create-settings'), createSettings, true, (s) => {
  createSettings = s;
  drawCreateSettings();
});
drawCreateSettings();

// --- Recent matches ---
// The 10 most recent recorded matches matching the search, which looks for the text (any case)
// in the room code or in the start time as shown, in this browser's own time zone.
const MATCHES_SHOWN = 10;
let recentMatches = [];
const startTime = (iso) => new Date(iso).toLocaleString();
function renderMatches() {
  const q = $('matches-search').value.trim().toLowerCase();
  const found = recentMatches.filter((m) => !q || m.room.toLowerCase().includes(q) || startTime(m.startedAt).toLowerCase().includes(q));
  const body = $('matches-table').tBodies[0];
  body.innerHTML = '';
  for (const m of found.slice(0, MATCHES_SHOWN)) {
    // Each cell links to the match's replay: replays/match?room=<code>&start=<time>.
    const row = body.insertRow();
    const address = `replays/match?${new URLSearchParams({ room: m.room, start: m.startedAt })}`;
    for (const text of [startTime(m.startedAt), m.room]) {
      const link = document.createElement('a');
      link.href = address; // relative to the site root (the page's <base>)
      link.textContent = text;
      link.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab etc.
        e.preventDefault();
        navigate(address);
      });
      row.insertCell().appendChild(link);
    }
  }
  const more = found.length - MATCHES_SHOWN;
  $('matches-note').textContent = !recentMatches.length ? 'No matches recorded yet.'
    : !found.length ? 'No matches found.' : more > 0 ? `${more} more not shown: search to narrow them down.` : '';
}
async function openMatches() {
  showScreen('matches');
  $('matches-note').textContent = 'Loading…';
  try {
    const data = await (await fetch(new URL('api/matches', ROOT))).json();
    recentMatches = data.matches;
    renderMatches();
    if (!data.recording) $('matches-note').textContent = 'This server is not recording matches.';
  } catch {
    $('matches-note').textContent = 'Could not load the matches.';
  }
}
$('open-matches').addEventListener('click', () => navigate('replays'));
$('matches-back').addEventListener('click', () => navigate('./'));

// --- A match's replay (replays/match?room=<code>&start=<time>): not built yet ---
function showReplay() {
  const room = query('room');
  const start = query('start');
  $('replay-which').textContent = room && start ? `Room ${room}, started ${startTime(start)}` : 'No match given.';
  showScreen('replay');
}
$('replay-back').addEventListener('click', () => navigate('replays'));
$('matches-search').addEventListener('input', renderMatches);

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

// Fills a waits display: each wait as a tile, noting if winning on it has no yaku or only by
// tsumo (atozuke), then a single "(furiten)" for the whole hand. Used by your waits line and
// by the discard preview.
// How many copies of each tile kind (0-33) you can't see: 4, less those in your hand, the
// ponds, the melds and the dora indicators. A called tile is both in a pond and in a meld, so
// tiles are counted once by id.
function unseenCounts(game, you) {
  const seen = new Map();
  const add = (t) => t && seen.set(t.id, t);
  game.doraIndicators.forEach(add);
  for (const p of game.players) {
    p.discards.forEach(add);
    for (const m of p.melds) m.tiles.forEach(add);
    if (p.seat === you) {
      (p.hand ?? []).forEach(add);
      add(p.drawn);
    }
  }
  const counts = Array(34).fill(4);
  for (const t of seen.values()) if (!isWild(t)) counts[tileIndex(t)]--; // the wild tile isn't one of the 136
  return counts;
}

// Each wait is its tile, then how many copies are left unseen, then any note about yaku.
function fillWaits(container, waits, furiten) {
  const unseen = unseenCounts(view.game, view.you);
  container.append('Tenpai:');
  for (const w of waits) {
    const item = document.createElement('span');
    item.className = 'wait';
    item.appendChild(tileEl(tileOfKind(w.kind)));
    // A hand that wins on any tile shows the wild tile alone, with no count.
    if (!w.any) {
      const left = document.createElement('span');
      left.className = 'wait-left';
      left.textContent = `×${unseen[w.kind]}`;
      left.title = `${unseen[w.kind]} not visible to you`;
      item.appendChild(left);
    }
    if (!w.ron) item.append(w.tsumo ? '(tsumo only)' : '(no yaku)');
    container.appendChild(item);
  }
  if (furiten) {
    const tag = document.createElement('span');
    tag.className = 'furiten-tag';
    tag.textContent = '(furiten)';
    container.appendChild(tag);
  }
}

// Hovering a tile you could discard into tenpai shows the waits you would have, in a small box
// just above the tile (it may cover other things).
const previewBox = document.createElement('div');
previewBox.className = 'waits wait-preview';
previewBox.hidden = true;
document.body.appendChild(previewBox);
function showPreview(tileElement, preview) {
  previewBox.innerHTML = '';
  fillWaits(previewBox, preview.waits, preview.furiten);
  previewBox.hidden = false;
  const rect = tileElement.getBoundingClientRect();
  const top = rect.top + window.scrollY - previewBox.offsetHeight - 6;
  previewBox.style.left = `${Math.max(4, rect.left + window.scrollX + rect.width / 2 - previewBox.offsetWidth / 2)}px`;
  previewBox.style.top = `${Math.max(4, top)}px`;
}
const hidePreview = () => (previewBox.hidden = true);

// Outlines every other visible tile of the same kind as the hovered one: in hands, melds,
// ponds, the dora panel and the waits line. Face-down tiles have no kind and never match.
function highlightKind(el) {
  if (view?.game?.noHints) return;
  for (const other of document.querySelectorAll(`.tile[data-kind="${el.dataset.kind}"]`)) {
    if (other !== el) other.classList.add('same-kind');
  }
}
function clearHighlight() {
  for (const other of document.querySelectorAll('.tile.same-kind')) other.classList.remove('same-kind');
}

// clickable discards the tile, or declares riichi with it while choosing a riichi tile.
// preview (waits after discarding it, from the server) shows on hover.
// Tiles are drawn as images (tiles/tileset2, see tools/cut-tiles.mjs) laid over the plain tile
// box, or as text like "5p" when "Algebraic tiles" is ticked. The choice is kept per browser.
let algebraic = localStorage.getItem('riichiAlgebraic') === '1';
const HONOR_IMAGES = ['ton', 'nan', 'xia', 'pei', 'haku', 'hatsu', 'chun'];
const SUIT_IMAGES = { m: 'man', p: 'pin', s: 'sou' };
function tileImage(tile) {
  if (isWild(tile)) return 'tiles/tileset2/1a.svg'; // the Baiman contest's wild tile, 1A
  const name = tile.suit === 'z' ? HONOR_IMAGES[tile.rank - 1] : `${tile.red ? 'aka' : ''}${tile.rank}${SUIT_IMAGES[tile.suit]}`;
  return `tiles/tileset2/${name}.svg`;
}

function tileEl(tile, { clickable = false, extraClass = '', preview = null } = {}) {
  const el = document.createElement('div');
  if (!tile) {
    el.className = 'tile back';
    return el;
  }
  el.className = `tile ${tile.suit}${tile.red ? ' red' : ''} ${extraClass}`.trim();
  el.textContent = tileLabel(tile);
  if (!algebraic) {
    el.classList.add('pictured');
    const img = document.createElement('img');
    img.className = 'face';
    img.src = tileImage(tile);
    img.alt = tileLabel(tile);
    img.draggable = false;
    el.appendChild(img);
  }
  // Hovering a face-up tile outlines every other visible copy of it (see highlightKind).
  el.dataset.kind = `${tile.rank}${tile.suit}`; // a red five is a five here
  el.addEventListener('mouseenter', () => highlightKind(el));
  el.addEventListener('mouseleave', clearHighlight);
  if (preview) {
    el.addEventListener('mouseenter', () => showPreview(el, preview));
    el.addEventListener('mouseleave', hidePreview);
  }
  if (clickable) {
    el.classList.add('clickable');
    el.addEventListener('click', () => {
      if (view?.game?.phase === 'exchange') {
        // Select or deselect a tile to pass (at most three).
        if (exchangePicks.has(tile.id)) exchangePicks.delete(tile.id);
        else if (exchangePicks.size < 3) exchangePicks.add(tile.id);
        render();
      } else if (choosingRiichi) {
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
  if (player.seat !== you || isWild(tile)) return false; // the wild tile is never discarded or passed
  if (game.phase === 'exchange') return !game.exchange.mine; // until you have passed your three
  if (game.current !== you || game.phase !== 'discard') return false;
  if (choosingRiichi) return game.riichiDiscards.includes(tile.id);
  // After riichi, only a winning draw can be clicked (to decline the tsumo); other draws
  // are discarded automatically.
  if (player.riichi) return tile.id === player.drawn?.id && game.canTsumo;
  return true;
}

// A tile object for a tile kind (0-33), for showing a kind with the normal tile element.
function tileOfKind(kind) {
  if (kind === 34) return { id: -1, suit: 'A', rank: 1, red: false }; // the wild tile: "wins on anything"
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

const CALLOUT_LABELS = { chii: 'Chii', pon: 'Pon', kan: 'Kan', riichi: 'Riichi', ron: 'Ron', tsumo: 'Tsumo' };

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
  // The hand's score change, after a standard hand only: Baiman contest points already count
  // in the score as each win happens.
  const delta = result?.type === 'contest' ? 0 : result?.deltas?.[player.seat];
  if (delta) name.innerHTML += ` <span class="delta ${delta > 0 ? 'gain' : 'loss'}">(${delta > 0 ? '+' : ''}${delta.toLocaleString()})</span>`;
  if (result?.type === 'exhaustiveDraw') {
    name.innerHTML += ` · ${result.tenpai.includes(player.seat) ? 'Tenpai' : 'Noten'}`;
    if (result.nagashi.includes(player.seat)) name.innerHTML += ' · <span class="riichi-tag">Nagashi</span>';
  }
  if (game.phase === 'exchange' && game.exchange.picked[player.seat]) name.innerHTML += ' · tiles chosen';
  if (result?.type === 'contest' && result.nagashi.some((n) => n.seat === player.seat)) {
    name.innerHTML += ' · <span class="riichi-tag">Nagashi</span>';
  }
  if (player.riichi) {
    name.innerHTML += ` <span class="riichi-tag">${player.riichi.double ? 'Double riichi' : 'Riichi'}` +
      `${player.riichi.ippatsu && !result ? ' · Ippatsu' : ''}</span>`;
  }
  if (player.callout) {
    const box = document.createElement('div');
    box.className = `callout callout-${player.callout}`;
    box.textContent = CALLOUT_LABELS[player.callout];
    name.appendChild(box);
  }
  el.appendChild(name);

  const hand = document.createElement('div');
  hand.className = 'hand';
  const clickable = (t) => canClickTile(t, player, game, you);
  // Your tiles you could discard into tenpai show the waits that would leave on hover.
  const preview = (t) => (player.seat === you && clickable(t) ? game.discardPreview?.[t.id] ?? null : null);
  const hints = !game.noHints;
  // Tiles you can't riichi with are dimmed while you choose; so are the tiles you are passing.
  const passing = (t) => game.phase === 'exchange' && player.seat === you && (exchangePicks.has(t.id) || game.exchange.mine?.includes(t.id));
  const dim = (t) => (passing(t) || (hints && choosingRiichi && player.seat === you && !clickable(t)) ? ' dimmed' : '');
  if (player.hand) {
    player.hand.forEach((t) => hand.appendChild(tileEl(t, { clickable: clickable(t), extraClass: dim(t).trim(), preview: preview(t) })));
    // A Baiman contest winner's tsumo tile stays with them until the hand ends.
    const ronTile = result?.type === 'ron' ? result.tile
      : result?.type === 'contest' ? result.wins.find((w) => w.seat === player.seat && w.type === 'ron')?.tile : null;
    if (player.drawn) {
      const extra = (won || player.won ? 'drawn win-tile' : hints ? 'drawn last-drawn' : 'drawn') + dim(player.drawn);
      hand.appendChild(tileEl(player.drawn, { clickable: clickable(player.drawn), extraClass: extra, preview: preview(player.drawn) }));
    } else if (won && ronTile) {
      hand.appendChild(tileEl(ronTile, { extraClass: 'drawn win-tile' }));
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
  if (hints && player.seat === you && player.hand && !player.drawn && !won && !player.won && !myDiscard) {
    // Each wait is shown as a tile, noting if winning on it has no yaku or only by tsumo
    // (atozuke: a hand may have a yaku on only some of its waits). Furiten belongs to the
    // whole hand, so a single "(furiten)" comes after all the waits.
    const line = document.createElement('div');
    line.className = 'waits';
    const f = game.furiten;
    if (!game.waits.length) line.textContent = 'Not tenpai';
    else fillWaits(line, game.waits, !!(f && (f.discard || f.temporary || f.riichi)));
    el.appendChild(line);
  }

  const pond = document.createElement('div');
  pond.className = 'pond';
  // The discard you can call is outlined (only players who can call it are sent it), and so is
  // the tile a hand was won on by ron.
  // With no hints, only the ron tile is outlined, once the hand is over.
  const target = (game.noHints ? null : game.lastDiscard?.tile) ?? (result?.type === 'ron' ? result.tile : null);
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
// A score's yaku and dora, e.g. "Riichi 1 · Tanyao 1 · Dora 2"; yakuman with their multiple.
function yakuParts(s) {
  if (s.yakuman) return s.yaku.map((y) => `${y.name}${y.yakuman > 1 ? ` (${y.yakuman}x)` : ''}`);
  const parts = s.yaku.map((y) => `${y.name} ${y.han}`);
  if (s.dora.dora) parts.push(`Dora ${s.dora.dora}`);
  if (s.dora.aka) parts.push(`Red five ${s.dora.aka}`);
  if (s.dora.ura) parts.push(`Ura dora ${s.dora.ura}`);
  return parts;
}

// Baiman contest: each win in order, with its han and limit but no fu (points don't need it).
function contestBreakdownHtml(game, you) {
  const { result } = game;
  return result.wins.map((w, i) => {
    const s = result.scores[i];
    const who = w.seat === you ? 'You' : playerName(w.seat, game);
    const how = w.type === 'tsumo' ? 'tsumo' : `ron from ${w.from === you ? 'you' : playerName(w.from, game)}${w.chankan ? ', robbing a kan' : ''}`;
    const value = s.yakuman ? s.limit : `${s.han} han${s.limit ? ` · ${s.limit}` : ''}`;
    return `<div class="breakdown"><b>${who}</b> (${how}): ${yakuParts(s).join(' · ')}<br>` +
      `${value}: ${w.points} point${w.points === 1 ? '' : 's'}</div>`;
  }).join('') + result.nagashi.map((n) => {
    const who = n.seat === you ? 'You' : playerName(n.seat, game);
    return `<div class="breakdown"><b>${who}</b>: Nagashi (${n.limit}): ${n.points} point${n.points === 1 ? '' : 's'}</div>`;
  }).join('');
}

function breakdownHtml(game, you) {
  const { result } = game;
  if (result?.type === 'contest') return contestBreakdownHtml(game, you); // wins, and nagashi at the wall
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

// Baiman contest, after the tile exchange: who passed to whom, by seat wind in turn order,
// e.g. "Tile passes: E -> S, S -> W, W -> N, N -> E". It stays for the rest of the hand.
function passesHtml(game) {
  if (!game.contest || !game.passes) return '';
  const parts = [0, 1, 2, 3].map((w) => {
    const seat = (game.dealer + w) % 4;
    return `${seatWind(seat, game.dealer)} -&gt; ${seatWind(game.passes[seat], game.dealer)}`;
  });
  return `<div class="passes"><i>Tile passes: ${parts.join(', ')}</i></div>`;
}

// Baiman contest: each win so far this hand with its value, under the format in the info panel.
function contestWinsHtml(game, you) {
  return (game.contestWins ?? []).map((w) => {
    const who = w.seat === you ? 'You' : playerName(w.seat, game);
    const value = w.yakuman ? (w.yakuman > 1 ? `${w.yakuman}x yakuman` : 'Yakuman')
      : `${w.han} han${w.limit === 'Kazoe yakuman' ? ' (kazoe yakuman)' : ''}`;
    return `<div class="contest-win">${who}: ${value}</div>`;
  }).join('');
}

function statusText(game, you) {
  const { result } = game;
  if (result?.type === 'abortiveDraw') {
    if (result.reason === 'suucha riichi') return 'Abortive draw: all four players declared riichi';
    if (result.reason === 'suukaikan') return 'Abortive draw: four kans by more than one player';
    if (result.reason === 'suufon renda') return 'Abortive draw: all four players discarded the same wind';
    const [seat] = result.revealed;
    return `Abortive draw: ${seat === you ? 'you' : playerName(seat, game)} declared nine terminals and honors`;
  }
  if (result?.type === 'exhaustiveDraw' && result.nagashi.length > 0) {
    const names = result.nagashi.map((s) => (s === you ? 'You' : playerName(s, game)));
    return `Exhaustive draw: nagashi for ${names.join(' and ')}`;
  }
  if (result?.type === 'exhaustiveDraw') {
    const { tenpai } = result;
    if (tenpai.length === 0) return 'Exhaustive draw: nobody is tenpai';
    if (tenpai.length === 4) return 'Exhaustive draw: everyone is tenpai';
    const names = tenpai.map((s) => (s === you ? 'You' : playerName(s, game)));
    return `Exhaustive draw: ${names.join(', ')} ${tenpai.length === 1 && tenpai[0] !== you ? 'is' : 'are'} tenpai`;
  }
  if (result?.type === 'contest') {
    const names = (seats) => seats.map((s) => (s === you ? 'You' : playerName(s, game))).join(', ');
    const nagashi = result.nagashi.length ? `; nagashi for ${names(result.nagashi.map((n) => n.seat))}` : '';
    if (result.reason === 'yakuman') return `A yakuman ends the match: ${names(result.winners)} won`;
    if (!result.winners.length) return `Wall exhausted: nobody won${nagashi}`;
    return `${result.reason === 'three winners' ? 'Three players won' : 'Wall exhausted'}: ${names(result.winners)}${nagashi}`;
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
  if (game.phase === 'exchange') {
    const waiting = game.exchange.picked.filter((p) => !p).length;
    if (you === null || game.exchange.mine) return `Tile exchange: waiting for ${waiting} more player${waiting === 1 ? '' : 's'} to choose`;
    return 'Tile exchange: choose 3 tiles to pass (not the wild tile); they go to a random other player';
  }
  if (game.contest && game.players[you]?.won) return 'You have won: waiting for the hand to end';
  if (game.phase === 'draw' || game.phase === 'held') return ''; // held: the pause before a win's result
  if (game.phase === 'rinshan') return game.current === you ? 'Kan: drawing a replacement tile…' : '';
  if (game.phase === 'claim') {
    const tile = tileLabel(game.lastDiscard.tile);
    if (game.lastDiscard.chankan) return game.canRon ? `You can rob the kan: ron on ${tile}` : '';
    const can = [game.canRon && 'ron', game.ponOptions.length && 'pon', game.openKanOptions.length && 'kan', game.chiiOptions.length && 'chii'].filter(Boolean);
    return can.length ? `You can ${can.join(' or ')} on ${tile}` : '';
  }
  if (game.current === you && choosingRiichi) return 'Riichi: choose a tile to discard';
  if (game.current === you && game.autoDiscarding) return game.players[you].riichi ? 'Riichi: discarding…' : 'Auto: discarding…';
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
    yakuman: 'A yakuman ended the match.',
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
  // Baiman contest: a player who has won in riichi sees the ura dora during the hand too.
  fill($('ura-row'), game.result?.uraIndicators ?? game.uraIndicators ?? []);
}

function render() {
  if (!view || route() !== 'game') return; // the table only shows on the game page
  hidePreview(); // the tiles are redrawn, so any hover box or highlight is stale
  clearHighlight();
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
    ${passesHtml(game)}
    <div>Wall: ${game.wallCount} tiles left</div>
    ${game.contest ? `<div>Baiman contest</div>${contestWinsHtml(game, you)}` : `<div>Riichi sticks: ${game.riichiSticks} (${(game.riichiSticks * 1000).toLocaleString()})</div>`}
    ${game.result?.honbaBonus ? `<div>Honba: +${game.result.honbaBonus.toLocaleString()}</div>` : ''}
    ${you === null ? '<div>Watching</div>' : ''}
    ${offline ? `<div>${offline} player${offline > 1 ? 's' : ''} offline</div>` : ''}
    <div class="room-code">Room ${room.code}</div>
  `;
  autoEl.hidden = you === null;
  for (const box of autoBoxes) box.checked = !!view.auto?.[box.dataset.auto];
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
  if (game.phase !== 'exchange' || game.exchange.mine) exchangePicks = new Set();
  exchangeBtn.hidden = !(game.phase === 'exchange' && you !== null && !game.exchange.mine);
  exchangeBtn.disabled = exchangePicks.size !== 3;
  exchangeBtn.textContent = `Pass 3 tiles (${exchangePicks.size}/3)`;

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

const algebraicBox = $('algebraic');
algebraicBox.checked = algebraic;
algebraicBox.addEventListener('change', () => {
  algebraic = algebraicBox.checked;
  localStorage.setItem('riichiAlgebraic', algebraic ? '1' : '0');
  render();
});

// Any change sends the whole checklist; the server keeps it for your seat.
for (const box of autoBoxes) {
  box.addEventListener('change', () => {
    send({ type: 'auto', settings: Object.fromEntries(autoBoxes.map((b) => [b.dataset.auto, b.checked])) });
  });
}

exchangeBtn.addEventListener('click', () => {
  if (exchangePicks.size === 3) send({ type: 'exchange', tiles: [...exchangePicks] });
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

// The page for the address this tab opened at (the game page waits for the server, above).
if (route() !== 'game') showRoute();
