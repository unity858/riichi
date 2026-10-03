// Renders the server-provided view and sends player intents. No game logic here.
// Three screens: the lobby (name, create or join a room), the waiting room, and the table.
// The room code lives in the address (?room=abc123), so a link can be shared.

import { tileLabel, tileIndex, isWild, calledTilePosition, waitYaku, furitenStatus, discardPreview } from './game.js';
import { replaySteps } from './replay.js';
import { t, getLang, setLang, has } from './i18n.js';

const $ = (id) => document.getElementById(id);

// --- Language (see i18n.js) ---
// Static text is marked in index.html (data-i18n, data-i18n-placeholder; data-i18n-html for text
// with markup). Text set with setText keeps its key too, so a language change redoes all of it;
// everything else is drawn again (see refreshLanguage).
function applyStatic() {
  document.documentElement.lang = getLang() === 'zh' ? 'zh-Hans' : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const text = t(el.dataset.i18n, el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : {});
    if (el.hasAttribute('data-i18n-html')) el.innerHTML = text;
    else el.textContent = text;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const input of document.querySelectorAll('.lang-picker input')) input.checked = input.value === getLang();
}
// Sets an element's text from the table (no key: empty), remembering the key and params.
function setText(el, key, params) {
  if (!key) {
    delete el.dataset.i18n;
    delete el.dataset.i18nParams;
    el.textContent = '';
    return;
  }
  el.dataset.i18n = key;
  if (params) el.dataset.i18nParams = JSON.stringify(params);
  else delete el.dataset.i18nParams;
  el.textContent = t(key, params);
}
// Game names shown in the current language. Number tiles, red fives and the wild tile stay as
// they are; honor tiles, rounds ("East 1", as recorded), yaku and limits are translated.
const tileText = (tile) => (tile.suit === 'z' ? t(`honor.${tile.rank}`) : tileLabel(tile));
const ROUND_WINDS = ['East', 'South', 'West', 'North'];
function roundLabel(label) {
  const m = /^(East|South|West|North) (\d+)$/.exec(label ?? '');
  return m ? t('round.label', { wind: t(`roundWind.${ROUND_WINDS.indexOf(m[1])}`), n: m[2] }) : label;
}
const yakuName = (name) => (has(`yaku.${name}`) ? t(`yaku.${name}`) : name);
function limitName(limit) {
  if (has(`limit.${limit}`)) return t(`limit.${limit}`);
  const m = /^(\d+)x yakuman$/.exec(limit ?? '');
  return m ? t('score.yakumanTimes', { n: m[1] }) : limit;
}
// "A and B (and C)", or "A, B, C": joined with the table's join.and or join.comma.
const joinWith = (key, items) => items.reduce((a, b) => t(key, { a, b }));
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
  const name = $('name').value.trim() || t('player.default');
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
  setText($('lobby-error'), null);
  if (page !== 'replays/match' && view?.replay) view = null; // a replay's table is only on its page
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
    // Server messages come as a code (error.<code> in the table) with their values.
    if (msg.code) setText($('lobby-error'), `error.${msg.code}`, msg.params);
    else $('lobby-error').textContent = msg.message;
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
  document.body.insertAdjacentHTML('afterbegin', `<p class="banner" data-i18n="page.disconnected">${t('page.disconnected')}</p>`);
});

function send(msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

// --- Settings ---

// Labels are keys in i18n.js.
const SETTING_FIELDS = [
  { key: 'format', label: 'settings.format', radios: [['standard', 'settings.format.standard'], ['baiman', 'settings.format.baiman']] },
  { key: 'length', label: 'settings.length', radios: [['east', 'settings.length.east'], ['south', 'settings.length.south']] },
  // standardOnly: hidden for the Baiman contest, where they are always off (see match.js).
  { key: 'bust', label: 'settings.bust', standardOnly: true },
  { key: 'yakuRebalance', label: 'settings.yakuRebalance' },
  { key: 'noHints', label: 'settings.noHints' },
  // contestOnly: shown only for the Baiman contest.
  { key: 'contestRepeat', label: 'settings.contestRepeat', contestOnly: true,
    radios: [['baiman', 'settings.contestRepeat.baiman'], ['none', 'settings.contestRepeat.none']] },
];
const DEFAULT_SETTINGS = { format: 'standard', length: 'south', bust: true, yakuRebalance: false, noHints: false, contestRepeat: 'baiman' };

// The rule details shown under the settings, folded away until clicked.
const ruleDetailsHtml = () => {
  const p = (key) => `<p>${t(key)}</p>`;
  const row = (key) => `<tr><td>${t(key)}</td><td>${t(`${key}.standard`)}</td><td>${t(`${key}.rebalanced`)}</td></tr>`;
  return [p('rules.length'), p('rules.bust'), p('rules.extension'), p('rules.agariYame'), p('rules.rebalance'),
    `<table><tr><th>${t('rules.table.yaku')}</th><th>${t('rules.table.standard')}</th><th>${t('rules.table.rebalanced')}</th></tr>`,
    ...['nagashi', 'sankantsu', 'suukantsu', 'doukou', 'ryanpeikou', 'renhou', 'shoutate'].map((k) => row(`rules.table.${k}`)),
    '</table>', p('rules.noHints'), p('rules.alwaysOn'), p('rules.contestPointer')].join('');
};

// The Baiman contest's rules, folded away next to the format choice.
const contestRulesHtml = () => ['points', 'wild', 'exchange', 'winners', 'hidden', 'ron', 'chankan', 'nagashi', 'yakuman', 'match']
  .map((k) => `<p>${t(`contestRules.${k}`)}</p>`).join('');

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
      row.append(`${t(field.label)}: `);
      for (const [value, text] of field.radios) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `${container.id}-${field.key}`;
        input.checked = settings[field.key] === value;
        input.disabled = !editable;
        input.addEventListener('change', () => onChange({ ...settings, [field.key]: value }));
        label.append(input, ` ${t(text)}`);
        row.appendChild(label);
        if (field.key === 'format' && value === 'baiman') row.appendChild(contestRulesToggle(container));
      }
      container.appendChild(row);
      if (field.key === 'format' && detailsOpen[`${container.id}-contest`]) {
        const rules = document.createElement('div');
        rules.className = 'rule-details contest-rules';
        rules.innerHTML = contestRulesHtml();
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
    row.append(input, ` ${t(field.label)}`);
    input.disabled = !editable;
    input.addEventListener('change', () => onChange({ ...settings, [field.key]: input.checked }));
    container.appendChild(row);
  }
  // The settings are redrawn on every update, so remember whether the details were open.
  const details = document.createElement('details');
  details.className = 'rule-details';
  details.innerHTML = `<summary>${t('settings.ruleDetails')}</summary>${ruleDetailsHtml()}`;
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
  toggle.textContent = `${detailsOpen[key] ? '▾' : '▸'} ${t('settings.detailedRules')}`;
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
// A start time in this browser's time zone (as given, if it isn't a time: say a mistyped link).
const startTime = (iso) => (Number.isNaN(Date.parse(iso)) ? iso : new Date(iso).toLocaleString());
function renderMatches() {
  const q = $('matches-search').value.trim().toLowerCase();
  const found = recentMatches.filter((m) => !q || m.room.toLowerCase().includes(q) || startTime(m.startedAt).toLowerCase().includes(q));
  const body = $('matches-table').tBodies[0];
  body.innerHTML = '';
  for (const m of found.slice(0, MATCHES_SHOWN)) {
    // Each cell links to the match's replay: replays/match?room=<code>&start=<time>. A match still
    // being played has no replay yet (it would show everyone's hands).
    const row = body.insertRow();
    if (!m.finished) {
      row.insertCell().textContent = startTime(m.startedAt);
      row.insertCell().textContent = t('matches.inProgress', { room: m.room });
      continue;
    }
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
  if (!matchesRecording) setText($('matches-note'), 'matches.notRecording');
  else if (!recentMatches.length) setText($('matches-note'), 'matches.none');
  else if (!found.length) setText($('matches-note'), 'matches.notFound');
  else if (more > 0) setText($('matches-note'), 'matches.more', { n: more });
  else setText($('matches-note'), null);
}
let matchesRecording = true;
async function openMatches() {
  showScreen('matches');
  setText($('matches-note'), 'matches.loading');
  try {
    const data = await (await fetch(new URL('api/matches', ROOT))).json();
    recentMatches = data.matches;
    matchesRecording = data.recording;
    renderMatches();
  } catch {
    setText($('matches-note'), 'matches.loadFailed');
  }
}
$('open-matches').addEventListener('click', () => navigate('replays'));
$('matches-back').addEventListener('click', () => navigate('./'));

// --- A match's replay: replays/match?room=<code>&start=<time>[&hand=<n>&step=<k>] ---
// The match (from api/match) is replayed in the browser with replay.js and shown on the table,
// every hand face up, watched from one seat (the room's first seat, East in East 1, until
// "Switch view"). A hand's steps are its start (the dealer holding their first draw), then each
// draw and each action (a discard, call, kan or win) in turn, the last being the hand's end
// (see replaySteps). The navbar under the dora panel, scrolling over the table and the arrow
// keys step through it, and the address keeps the hand and step, to link to a moment.
let replayMatch = null; // { key: room + start, data, steps: each hand's steps once worked out }
let replayPos = { hand: 0, step: 0 };
let replayPov = 0;
// The replay's two settings, kept per browser: other players' hands face up (or only yours and
// those the game would reveal at the end), and the waits (lines and hover previews, as in play).
let replayShowHands = localStorage.getItem('riichiReplayHands') !== '0';
let replayShowWaits = localStorage.getItem('riichiReplayWaits') === '1';
for (const [id, key, get, set] of [
  ['replay-show-hands', 'riichiReplayHands', () => replayShowHands, (v) => (replayShowHands = v)],
  ['replay-show-waits', 'riichiReplayWaits', () => replayShowWaits, (v) => (replayShowWaits = v)],
]) {
  $(id).checked = get();
  $(id).addEventListener('change', () => {
    set($(id).checked);
    localStorage.setItem(key, $(id).checked ? '1' : '0');
    if (replayMatch && view?.replay) renderReplay();
  });
}

async function showReplay() {
  const room = query('room');
  const start = query('start');
  const key = `${room} ${start}`;
  if (replayMatch?.key !== key) {
    replayMatch = null;
    replayPov = 0;
    if (room && start) setText($('replay-which'), 'replay.which', { room, time: startTime(start) });
    else setText($('replay-which'), null);
    setText($('replay-status'), room && start ? 'replay.loading' : 'replay.noMatch');
    showScreen('replay');
    if (!room || !start) return;
    let data;
    try {
      const res = await fetch(new URL(`api/match?${new URLSearchParams({ room, start })}`, ROOT));
      data = await res.json();
      if (!res.ok) {
        if (data.code) setText($('replay-status'), `error.${data.code}`);
        else $('replay-status').textContent = data.error;
        return;
      }
    } catch {
      setText($('replay-status'), 'replay.loadFailed');
      return;
    }
    if (route() !== 'replays/match' || query('room') !== room || query('start') !== start) return; // moved on meanwhile
    replayMatch = { key, data, steps: [] };
  }
  const { hands } = replayMatch.data;
  const hand = clamp(Number(query('hand') ?? 1) - 1, 0, hands.length - 1);
  replayPos = { hand, step: clamp(Number(query('step') ?? 0), 0, lastStep(hand)) };
  renderReplay({ arrived: true });
}

// A hand's steps (worked out once), and the index of its last step (the hand's end). A hand
// that can't be replayed has just its start.
function handSteps(hand) {
  const h = replayMatch.data.hands[hand];
  try {
    replayMatch.steps[hand] ??= replaySteps(h, h.actions).steps;
  } catch {
    replayMatch.steps[hand] = [{ type: 'start' }];
  }
  return replayMatch.steps[hand];
}
const lastStep = (hand) => handSteps(hand).length - 1;
const clamp = (n, lo, hi) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : lo);

// arrived: the replay came to this step by stepping, a link or Back/Forward (not a Round button
// or a redraw), so a hand's result alerts its scoring.
function renderReplay({ arrived = false } = {}) {
  const m = replayMatch.data;
  const h = m.hands[replayPos.hand];
  const { step } = replayPos;
  let s;
  try {
    s = replaySteps(h, h.actions, step).state;
  } catch (err) {
    view = null;
    setText($('replay-status'), 'replay.cantReplay', { error: err.message });
    showScreen('replay');
    return;
  }
  const last = replayPos.hand === m.hands.length - 1 && step === lastStep(replayPos.hand);
  view = {
    replay: {
      note: describeStep(handSteps(replayPos.hand)[step], h, m.players),
      scoreAlert: arrived && step === lastStep(replayPos.hand) ? `replay ${++scoreAlerts}` : null,
    },
    you: replayPov,
    auto: null,
    room: { code: m.room, started: true, hostSeat: 0, settings: m.settings, seats: m.players.map((name, i) => ({ name: name ?? t('player.numbered', { n: i + 1 }), connected: true })) },
    match: { label: h.label, honba: h.honba, over: last, final: m.final },
    game: replayGameView(s),
  };
  // The address follows, without a history entry per turn.
  const address = `replays/match?${new URLSearchParams({ room: m.room, start: m.startedAt, hand: replayPos.hand + 1, step })}`;
  history.replaceState(null, '', new URL(address, ROOT));
  const round = h.honba ? t('info.honba', { label: roundLabel(h.label), n: h.honba }) : roundLabel(h.label);
  $('round-label').textContent = t('replay.round', { label: round });
  $('step-label').textContent = t('replay.step', { step, last: lastStep(replayPos.hand) });
  $('round-prev').disabled = replayPos.hand === 0 && step === 0;
  $('round-next').disabled = replayPos.hand === m.hands.length - 1;
  $('step-prev').disabled = replayPos.hand === 0 && step === 0;
  $('step-next').disabled = last;
  render();
}

// The replayed state as the table expects it: like the server's view, with nothing to do (no
// buttons or clicks). Hands are shown face up as the two settings say: yours (the seat watched
// from) always, the others with "Show other hands", and at the end those the game reveals. With
// "Show waits", each face-up hand gets its waits and furiten (replayWaits, replayFuriten), and
// whoever is about to discard the waits each discard would leave (replayPreview), worked out
// with the game's own functions.
function replayGameView(s) {
  const revealed = s.result?.winners ?? s.result?.revealed ?? [];
  const shown = (seat) => replayShowHands || seat === replayPov || revealed.includes(seat);
  const waitsOf = (p) => {
    if (!replayShowWaits || !shown(p.seat) || s.phase === 'ended') return {};
    const extra = {};
    if (!p.drawn && p.hand.length % 3 === 1) {
      const f = furitenStatus(s, p.seat);
      Object.assign(extra, { replayWaits: waitYaku(s, p.seat), replayFuriten: f.discard || f.temporary || f.riichi });
    }
    if (s.phase === 'discard' && s.current === p.seat) {
      extra.replayPreview = Object.fromEntries(Object.entries(discardPreview(s, p.seat)).map(([id, v]) => [id, { ...v, seat: p.seat }]));
    }
    return extra;
  };
  let turn = s.current;
  if (s.phase === 'claim') turn = s.lastDiscard.from;
  else if (s.phase === 'draw') turn = s.discardLog.at(-1)?.from ?? s.current;
  return {
    contest: false, exchange: null, passes: null, contestWins: [], uraIndicators: null,
    dealer: s.dealer, current: s.current, turn, phase: s.phase, roundWind: s.roundWind, scores: s.scores,
    riichiSticks: s.riichiSticks, honba: s.honba, wallCount: s.wall.length, doraIndicators: s.doraIndicators,
    lastDiscard: null, result: s.result, noHints: true, autoDiscarding: false, furiten: null, waits: [], discardPreview: {},
    canTsumo: false, canRon: false, canKyuushu: false, ponOptions: [], chiiOptions: [], openKanOptions: [], kanOptions: [], riichiDiscards: [],
    players: s.players.map((p) => ({
      seat: p.seat, discards: p.discards, tsumogiri: p.tsumogiri, called: p.called, melds: p.melds,
      handCount: p.hand.length, hasDrawn: !!p.drawn, hand: shown(p.seat) ? p.hand : null, drawn: shown(p.seat) ? p.drawn : null,
      riichi: p.riichi, callout: p.callout, won: null, ...waitsOf(p),
    })),
  };
}

// A step in words, e.g. "S (Bob) draws 5m" or "S (Bob) pons 5m from E (Alice)". Names come from
// the match record (escaped: they go into HTML). The end step shows the result instead.
function describeStep(step, h, players) {
  const who = (seat) => t('name.player', { wind: seatWind(seat, h.dealer), name: escapeHtml(players[seat] ?? t('player.numbered', { n: seat + 1 })) });
  const tile = (code) => tileText({ suit: code.slice(-1), rank: code[0] === '0' ? 5 : Number(code[0]), red: code[0] === '0' });
  if (step.type === 'start') return t('step.start', { label: roundLabel(h.label), who: who(h.dealer) });
  if (step.type === 'draw') return t('step.draw', { who: who(step.seat), tile: tile(step.tile) });
  if (step.type === 'end') return '';
  const a = step.action;
  switch (a.type) {
    case 'discard': {
      const key = `step.${a.riichi ? 'riichi' : 'discard'}${a.tsumogiri ? 'Tsumogiri' : ''}`;
      return t(key, { who: who(a.seat), tile: tile(a.tile) });
    }
    case 'chii': case 'pon': case 'kan':
      return t(`step.${a.type}`, { who: who(a.seat), tile: tile(a.tile), from: who(a.from) });
    case 'ankan': return t('step.ankan', { who: who(a.seat), tile: tile(a.tiles[0]) });
    case 'kakan': return t('step.kakan', { who: who(a.seat), tile: tile(a.tile) });
    case 'ron': return t('step.ron', { who: joinWith('join.and', a.seats.map(who)), tile: tile(a.tile), from: who(a.from) });
    case 'tsumo': return t('step.tsumo', { who: who(a.seat), tile: tile(a.tile) });
    case 'kyuushu': return t('step.kyuushu', { who: who(a.seat) });
    default: return '';
  }
}

// Moving: by step, carrying on into the next or previous hand at either end; by round, to the
// start of the next or previous hand (or of this one).
function stepReplay(by, dir) {
  if (!replayMatch || !view?.replay) return;
  const { hands } = replayMatch.data;
  let { hand, step } = replayPos;
  if (by === 'step' && dir > 0) {
    if (step < lastStep(hand)) step++;
    else if (hand < hands.length - 1) [hand, step] = [hand + 1, 0];
  } else if (by === 'step') {
    if (step > 0) step--;
    else if (hand > 0) [hand, step] = [hand - 1, lastStep(hand - 1)];
  } else if (dir > 0) {
    if (hand < hands.length - 1) [hand, step] = [hand + 1, 0];
  } else if (step > 0) {
    step = 0;
  } else if (hand > 0) {
    [hand, step] = [hand - 1, 0];
  }
  if (hand === replayPos.hand && step === replayPos.step) return;
  replayPos = { hand, step };
  renderReplay({ arrived: by === 'step' });
}
$('round-prev').addEventListener('click', () => stepReplay('round', -1));
$('round-next').addEventListener('click', () => stepReplay('round', 1));
$('step-prev').addEventListener('click', () => stepReplay('step', -1));
$('step-next').addEventListener('click', () => stepReplay('step', 1));
// Scrolling over the table moves a step (a notch of a mouse wheel, or a stretch of a trackpad).
let wheelSum = 0;
$('table').addEventListener('wheel', (e) => {
  if (!view?.replay) return;
  e.preventDefault();
  wheelSum += e.deltaY;
  if (Math.abs(wheelSum) < 50) return;
  stepReplay('step', Math.sign(wheelSum));
  wheelSum = 0;
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if (!view?.replay || e.target.closest?.('input')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    stepReplay('step', e.key === 'ArrowRight' ? 1 : -1);
  }
});
$('replay-back').addEventListener('click', () => navigate('replays'));
$('matches-search').addEventListener('input', renderMatches);

$('create').addEventListener('click', () => send({ type: 'create', id: playerId, name: myName(), settings: createSettings }));
$('join').addEventListener('click', () => {
  const code = $('join-code').value.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(code)) {
    setText($('lobby-error'), 'lobby.badCode');
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
$('leave-waiting').addEventListener('click', () => send({ type: 'leave' }));
// The finished match's replay link opens in place (leaving the room), unless opened in a new tab.
$('replay-link').firstElementChild.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute('href'));
});
$('leave-table').addEventListener('click', () => (view?.replay ? navigate('replays') : send({ type: 'leave' })));

function renderWaiting() {
  const { room, you } = view;
  $('waiting-heading').textContent = t('waiting.heading', { code: room.code });
  const list = $('seat-list');
  list.innerHTML = '';
  room.seats.forEach((p, i) => {
    const li = document.createElement('li');
    let text = p ? (i === you ? t('waiting.you', { name: p.name }) : p.name) : t('waiting.empty');
    if (p && i === room.hostSeat) text = t('waiting.host', { seat: text });
    if (p && !p.connected) text = t('waiting.offline', { seat: text });
    li.textContent = text;
    li.className = p ? '' : 'empty';
    list.appendChild(li);
  });
  $('spectator-count').textContent = room.spectators ? t('waiting.watching', { n: room.spectators }) : '';
  const isHost = you !== null && you === room.hostSeat;
  renderSettings($('room-settings'), room.settings, isHost, (s) => send({ type: 'settings', settings: s }));
  const full = room.seats.every(Boolean);
  $('start').hidden = !isHost;
  $('start').disabled = !full;
  $('waiting-hint').textContent = t(you === null ? 'waiting.full' : isHost ? (full ? 'waiting.everyone' : 'waiting.share') : 'waiting.waitHost');
}

// Fills a waits display: each wait as a tile, noting if winning on it has no yaku or only by
// tsumo (atozuke), then a single "(furiten)" for the whole hand. Used by your waits line and
// by the discard preview.
// How many copies of each tile kind (0-33) you can't see: 4, less those in your hand, the
// ponds, the melds and the dora indicators. A called tile is both in a pond and in a meld, so
// tiles are counted once by id. In a replay, every hand shown face up counts too (with "Show
// other hands", copies in the others' hands are visible; a hidden hand comes with no tiles).
function unseenCounts(game, you) {
  const seen = new Map();
  const add = (t) => t && seen.set(t.id, t);
  game.doraIndicators.forEach(add);
  for (const p of game.players) {
    p.discards.forEach(add);
    for (const m of p.melds) m.tiles.forEach(add);
    if (p.seat === you || view?.replay) {
      (p.hand ?? []).forEach(add);
      add(p.drawn);
    }
  }
  const counts = Array(34).fill(4);
  for (const t of seen.values()) if (!isWild(t)) counts[tileIndex(t)]--; // the wild tile isn't one of the 136
  return counts;
}

// Each wait is its tile, then how many copies are left unseen (by you; in a replay, by whoever
// watches, from the hands shown face up), then any note about yaku.
function fillWaits(container, waits, furiten, seat = view.you) {
  const unseen = unseenCounts(view.game, seat);
  container.append(t('waits.tenpai'));
  for (const w of waits) {
    const item = document.createElement('span');
    item.className = 'wait';
    item.appendChild(tileEl(tileOfKind(w.kind)));
    // A hand that wins on any tile shows the wild tile alone, with no count.
    if (!w.any) {
      const left = document.createElement('span');
      left.className = 'wait-left';
      left.textContent = `×${unseen[w.kind]}`;
      left.title = t('waits.unseen', { n: unseen[w.kind] });
      item.appendChild(left);
    }
    if (!w.ron) item.append(t(w.tsumo ? 'waits.tsumoOnly' : 'waits.noYaku'));
    container.appendChild(item);
  }
  if (furiten) {
    const tag = document.createElement('span');
    tag.className = 'furiten-tag';
    tag.textContent = t('waits.furiten');
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
  // While choosing a riichi tile, riichi itself is the yaku: every wait wins by ron as well as
  // tsumo, so no "(tsumo only)" or "(no yaku)". Furiten still shows as it is.
  const waits = choosingRiichi ? preview.waits.map((w) => ({ ...w, ron: true, tsumo: true })) : preview.waits;
  fillWaits(previewBox, waits, preview.furiten, preview.seat ?? view.you);
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
  el.textContent = tileText(tile);
  if (!algebraic) {
    el.classList.add('pictured');
    const img = document.createElement('img');
    img.className = 'face';
    img.src = tileImage(tile);
    img.alt = tileText(tile);
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
  if (view?.replay) return false; // replays are only watched
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
  return t(`wind.${(seat - dealer + 4) % 4}`);
}

// Names are chosen by players, so they are escaped before going into any HTML.
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nameOf = (seat) => escapeHtml(view.room.seats[seat]?.name ?? t('player.numbered', { n: seat + 1 }));

function playerName(seat, game) {
  return t('name.player', { wind: seatWind(seat, game.dealer), name: nameOf(seat) });
}
// "You", or "E (Alice)"; youKey for "you" in the middle of a sentence.
const whoIs = (seat, you, game, youKey = 'name.you') => (seat === you ? t(youKey) : playerName(seat, game));

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
  let who = player.seat === you && !view.replay ? t('seat.you', { name: nameOf(player.seat) }) : nameOf(player.seat);
  if (!view.room.seats[player.seat]?.connected) who = t('seat.offline', { name: who });
  // The dealer's seat wind (always E) is shown in red.
  const wind = seatWind(player.seat, game.dealer);
  name.innerHTML = (player.seat === game.dealer ? `<span class="dealer">${wind}</span>` : wind) +
    ` · ${who} · <span class="score">${game.scores[player.seat].toLocaleString()}</span>`;
  // The hand's score change, after a standard hand only: Baiman contest points already count
  // in the score as each win happens.
  const delta = result?.type === 'contest' ? 0 : result?.deltas?.[player.seat];
  if (delta) name.innerHTML += ` <span class="delta ${delta > 0 ? 'gain' : 'loss'}">(${delta > 0 ? '+' : ''}${delta.toLocaleString()})</span>`;
  if (result?.type === 'exhaustiveDraw') {
    name.innerHTML += ` · ${t(result.tenpai.includes(player.seat) ? 'seat.tenpai' : 'seat.noten')}`;
    if (result.nagashi.includes(player.seat)) name.innerHTML += ` · <span class="riichi-tag">${t('seat.nagashi')}</span>`;
  }
  if (game.phase === 'exchange' && game.exchange.picked[player.seat]) name.innerHTML += ` · ${t('seat.tilesChosen')}`;
  if (result?.type === 'contest' && result.nagashi.some((n) => n.seat === player.seat)) {
    name.innerHTML += ` · <span class="riichi-tag">${t('seat.nagashi')}</span>`;
  }
  if (player.riichi) {
    name.innerHTML += ` <span class="riichi-tag">${t(player.riichi.double ? 'seat.doubleRiichi' : 'seat.riichi')}` +
      `${player.riichi.ippatsu && !result ? ` · ${t('seat.ippatsu')}` : ''}</span>`;
  }
  if (player.callout) {
    const box = document.createElement('div');
    box.className = `callout callout-${player.callout}`;
    box.textContent = t(`callout.${player.callout}`);
    name.appendChild(box);
  }
  if (view.replay && player.seat !== you) {
    // Replays: watch from this player's seat instead (after the score; the line's text is done).
    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch-view';
    switchBtn.textContent = t('replay.switchView');
    switchBtn.addEventListener('click', () => {
      replayPov = player.seat;
      renderReplay();
    });
    name.appendChild(switchBtn);
  }
  el.appendChild(name);

  const hand = document.createElement('div');
  hand.className = 'hand';
  const clickable = (t) => canClickTile(t, player, game, you);
  // Your tiles you could discard into tenpai show the waits that would leave on hover; in a
  // replay with "Show waits", so do those of whoever is about to discard (without lifting).
  const preview = (t) => (view.replay ? player.replayPreview?.[t.id] ?? null
    : player.seat === you && clickable(t) ? game.discardPreview?.[t.id] ?? null : null);
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
  // In a replay with "Show waits", every hand shown face up has its waits line (see replayGameView).
  const waitsLine = view.replay ? !!player.replayWaits
    : hints && player.seat === you && player.hand && !player.drawn && !won && !player.won && !myDiscard;
  if (waitsLine) {
    // Each wait is shown as a tile, noting if winning on it has no yaku or only by tsumo
    // (atozuke: a hand may have a yaku on only some of its waits). Furiten belongs to the
    // whole hand, so a single "(furiten)" comes after all the waits.
    const line = document.createElement('div');
    line.className = 'waits';
    const f = game.furiten;
    const waits = view.replay ? player.replayWaits : game.waits;
    const furiten = view.replay ? player.replayFuriten : !!(f && (f.discard || f.temporary || f.riichi));
    if (!waits.length) line.textContent = t('waits.notTenpai');
    else fillWaits(line, waits, furiten, player.seat);
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
  if (s.yakuman) return s.yaku.map((y) => (y.yakuman > 1 ? t('score.yakumanMultiple', { name: yakuName(y.name), n: y.yakuman }) : yakuName(y.name)));
  const parts = s.yaku.map((y) => `${yakuName(y.name)} ${y.han}`);
  if (s.dora.dora) parts.push(t('score.dora', { n: s.dora.dora }));
  if (s.dora.aka) parts.push(t('score.aka', { n: s.dora.aka }));
  if (s.dora.ura) parts.push(t('score.ura', { n: s.dora.ura }));
  return parts;
}
// A payment: "8,000" (ron), "4,000 all" (dealer tsumo), "2,000/4,000" (others' tsumo).
function paymentText(p) {
  if (p.ron !== undefined) return p.ron.toLocaleString();
  if (p.all !== undefined) return t('score.all', { points: p.all.toLocaleString() });
  return `${p.nonDealer.toLocaleString()}/${p.dealer.toLocaleString()}`;
}
const pointsText = (n) => t(n === 1 ? 'score.pointOne' : 'score.pointMany', { n });

// Baiman contest: each win in order, with its han and limit but no fu (points don't need it).
function contestBreakdownHtml(game, you) {
  const { result } = game;
  return result.wins.map((w, i) => {
    const s = result.scores[i];
    const who = whoIs(w.seat, you, game);
    const from = whoIs(w.from, you, game, 'name.youObject');
    const how = w.type === 'tsumo' ? t('score.byTsumo') : t(w.chankan ? 'score.byRonChankan' : 'score.byRon', { from });
    const value = s.yakuman ? limitName(s.limit) : `${t('score.han', { han: s.han })}${s.limit ? ` · ${limitName(s.limit)}` : ''}`;
    return `<div class="breakdown"><b>${who}</b> (${how}): ${yakuParts(s).join(' · ')}<br>` +
      `${value}: ${pointsText(w.points)}</div>`;
  }).join('') + result.nagashi.map((n) => {
    const who = whoIs(n.seat, you, game);
    return `<div class="breakdown"><b>${who}</b>: ${t('score.nagashi', { limit: limitName(n.limit) })}: ${pointsText(n.points)}</div>`;
  }).join('');
}

// The hand's scoring (each winner's yaku, han and fu, and payment) pops up in an alert, once on
// arriving at the result: in play when the hand ends (after the pause on a win); in a replay on
// stepping to a hand's last step or opening a link there, but not via the Round buttons (see
// renderReplay). Drawing the same moment again (Switch view, a setting) doesn't repeat it.
let lastScoreAlert = null;
let scoreAlerts = 0; // replays: each arrival at a hand's end
function alertScores(game, you) {
  const key = view.replay ? view.replay.scoreAlert : game.result && `${view.room.code} ${view.match.history?.length}`;
  if (!key || key === lastScoreAlert) return;
  lastScoreAlert = key;
  const box = document.createElement('div');
  box.innerHTML = breakdownHtml(game, you);
  const text = [...box.querySelectorAll('.breakdown')].map((line) => {
    for (const br of line.querySelectorAll('br')) br.replaceWith('\n');
    return line.textContent.trim();
  }).join('\n\n');
  if (text) setTimeout(() => alert(text), 50); // after the table shows the result
}

function breakdownHtml(game, you) {
  const { result } = game;
  if (result?.type === 'contest') return contestBreakdownHtml(game, you); // wins, and nagashi at the wall
  if (result?.nagashiPay) {
    // An exhaustive draw with nagashi: each one's limit and payment, paid as a tsumo.
    return result.nagashiPay.map(({ seat, limit, payment }) => {
      const who = whoIs(seat, you, game);
      return `<div class="breakdown"><b>${who}:</b> ${t('score.nagashi', { limit: limitName(limit) })}: ${paymentText(payment)}</div>`;
    }).join('');
  }
  if (!result?.scores) return '';
  return result.winners.map((seat, i) => {
    const s = result.scores[i];
    const who = whoIs(seat, you, game);
    if (s.han === 0) return `<div class="breakdown"><b>${who}:</b> ${t('score.noYaku')}</div>`;
    const pay = paymentText(s.payment);
    // Yakuman replace han and fu; each is listed with its value (a double counts twice).
    if (s.yakuman) return `<div class="breakdown"><b>${who}:</b> ${yakuParts(s).join(' · ')}<br>${limitName(s.limit)}: ${pay}</div>`;
    const hanFu = t('score.hanFu', { han: s.han, fu: s.fu });
    const value = s.limit ? limitName(s.limit) : hanFu;
    return `<div class="breakdown"><b>${who}:</b> ${yakuParts(s).join(' · ')}<br>` +
      `${s.limit ? `${hanFu} · ` : ''}${value}: ${pay}</div>`;
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
  return `<div class="passes"><i>${t('info.passes', { list: parts.join(', ') })}</i></div>`;
}

// Baiman contest: each win so far this hand with its value, under the format in the info panel.
function contestWinsHtml(game, you) {
  return (game.contestWins ?? []).map((w) => {
    const who = whoIs(w.seat, you, game);
    const value = w.yakuman ? (w.yakuman > 1 ? t('score.yakumanTimes', { n: w.yakuman }) : limitName('Yakuman'))
      : t(w.limit === 'Kazoe yakuman' ? 'score.kazoe' : 'score.han', { han: w.han });
    return `<div class="contest-win">${who}: ${value}</div>`;
  }).join('');
}

function statusText(game, you) {
  const { result } = game;
  const names = (seats, key = 'join.comma') => joinWith(key, seats.map((s) => whoIs(s, you, game)));
  if (result?.type === 'abortiveDraw') {
    if (result.reason === 'suucha riichi') return t('status.suucha');
    if (result.reason === 'suukaikan') return t('status.suukaikan');
    if (result.reason === 'suufon renda') return t('status.suufon');
    const [seat] = result.revealed;
    return t('status.kyuushu', { who: whoIs(seat, you, game, 'name.youObject') });
  }
  if (result?.type === 'exhaustiveDraw' && result.nagashi.length > 0) return t('status.nagashi', { names: names(result.nagashi, 'join.and') });
  if (result?.type === 'exhaustiveDraw') {
    const { tenpai } = result;
    if (tenpai.length === 0) return t('status.nobodyTenpai');
    if (tenpai.length === 4) return t('status.everyoneTenpai');
    return t(tenpai.length === 1 && tenpai[0] !== you ? 'status.oneTenpai' : 'status.someTenpai', { names: names(tenpai) });
  }
  if (result?.type === 'contest') {
    const nagashi = result.nagashi.length ? names(result.nagashi.map((n) => n.seat)) : null;
    if (result.reason === 'yakuman') return t('status.contestYakuman', { names: names(result.winners) });
    if (!result.winners.length) return nagashi ? t('status.contestNobodyNagashi', { nagashi }) : t('status.contestNobody');
    const key = result.reason === 'three winners' ? 'status.contestThree' : 'status.contestWall';
    return t(nagashi ? `${key}Nagashi` : key, { names: names(result.winners), nagashi });
  }
  if (result?.type === 'tsumo') {
    const [winner] = result.winners;
    return winner === you ? t('status.youTsumo', { tile: tileText(result.tile) }) : t('status.tsumo', { who: playerName(winner, game), tile: tileText(result.tile) });
  }
  if (result?.type === 'ron') {
    const one = result.winners.length === 1 && result.winners[0] !== you;
    const key = `status.${one ? 'ronOne' : 'ronMany'}${result.chankan ? 'Chankan' : ''}`;
    return t(key, { names: names(result.winners, 'join.and'), tile: tileText(result.tile), from: whoIs(result.from, you, game, 'name.youObject') });
  }
  // Whose turn it is shows as a bold name line, not here. The pause before a draw (which is
  // also how others deciding on a call look) has no status text.
  if (game.phase === 'exchange') {
    const waiting = game.exchange.picked.filter((p) => !p).length;
    if (you === null || game.exchange.mine) return t(waiting === 1 ? 'status.exchangeWaitingOne' : 'status.exchangeWaitingMany', { n: waiting });
    return t('status.exchangeChoose');
  }
  if (game.contest && game.players[you]?.won) return t('status.contestWon');
  if (game.phase === 'draw' || game.phase === 'held') return ''; // held: the pause before a win's result
  if (game.phase === 'rinshan') return game.current === you ? t('status.rinshan') : '';
  if (game.phase === 'claim') {
    const tile = tileText(game.lastDiscard.tile);
    if (game.lastDiscard.chankan) return game.canRon ? t('status.robKan', { tile }) : '';
    const can = [game.canRon && 'ron', game.ponOptions.length && 'pon', game.openKanOptions.length && 'kan', game.chiiOptions.length && 'chii']
      .filter(Boolean).map((c) => t(`status.call.${c}`));
    return can.length ? t('status.canCall', { calls: joinWith('status.callOr', can), tile }) : '';
  }
  if (game.current === you && choosingRiichi) return t('status.chooseRiichi');
  if (game.current === you && game.autoDiscarding) return t(game.players[you].riichi ? 'status.riichiDiscarding' : 'status.autoDiscarding');
  if (game.current === you && game.players[you].riichi) {
    const kan = game.kanOptions.length > 0;
    if (!game.canTsumo && !kan) return '';
    return t(game.canTsumo && kan ? 'status.riichiTsumoKan' : game.canTsumo ? 'status.riichiTsumo' : 'status.riichiKan');
  }
  if (game.current === you) return t(game.canTsumo ? 'status.yourTurnTsumo' : 'status.yourTurn');
  return '';
}

// The end-of-match standings.
const FINAL_REASONS = {
  'last hand': 'final.lastHand', 'target reached': 'final.targetReached', 'extension over': 'final.extensionOver',
  bust: 'final.bust', 'agari-yame': 'final.agariYame', yakuman: 'final.yakuman',
};
function finalHtml(match, you) {
  const rows = match.final.ranking.map((r) => `<tr><td>${r.place}</td><td>${r.seat === you ? t('final.you', { name: nameOf(r.seat) }) : nameOf(r.seat)}</td>` +
    `<td>${r.score.toLocaleString()}</td></tr>`).join('');
  const reason = FINAL_REASONS[match.final.reason];
  return `<div class="final"><div class="status">${t('final.over')}</div><div>${reason ? t(reason) : ''}</div>` +
    `<table><tr><th>${t('final.place')}</th><th>${t('final.player')}</th><th>${t('final.score')}</th></tr>${rows}</table></div>`;
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
  if (!view || route() !== (view.replay ? 'replays/match' : 'game')) return; // the table's two pages
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
    ${(() => { const status = view.replay && !game.result ? view.replay.note : statusText(game, you); return status ? `<div class="status">${status}</div>` : ''; })()}
    <div class="hand-label">${game.honba ? t('info.honba', { label: roundLabel(match.label), n: game.honba }) : roundLabel(match.label)}</div>
    ${passesHtml(game)}
    <div>${t('info.wall', { n: game.wallCount })}</div>
    ${game.contest ? `<div>${t('info.contest')}</div>${contestWinsHtml(game, you)}`
    : `<div>${t('info.sticks', { n: game.riichiSticks, points: (game.riichiSticks * 1000).toLocaleString() })}</div>`}
    ${game.result?.honbaBonus ? `<div>${t('info.honbaBonus', { points: game.result.honbaBonus.toLocaleString() })}</div>` : ''}
    ${you === null ? `<div>${t('info.watching')}</div>` : ''}
    ${offline ? `<div>${t(offline > 1 ? 'info.offlineMany' : 'info.offlineOne', { n: offline })}</div>` : ''}
    <div class="room-code">${t('info.room', { code: room.code })}</div>
  `;
  alertScores(game, you);
  autoEl.hidden = you === null || !!view.replay;
  $('replay-nav').hidden = !view.replay;
  $('replay-options').hidden = !view.replay;
  $('table-hint').hidden = !!view.replay;
  leaveTableBtn.textContent = t(view.replay ? 'table.back' : 'table.leave');
  for (const box of autoBoxes) box.checked = !!view.auto?.[box.dataset.auto];
  const ended = game.phase === 'ended';
  nextHandBtn.hidden = !ended || match.over || you === null || !!view.replay;
  rematchBtn.hidden = !match.over || you !== room.hostSeat || !!view.replay;
  leaveTableBtn.hidden = !match.over && you !== null && !view.replay;
  // Once a recorded match is over: its replay, linked relative to the site root.
  $('replay-link').hidden = !match.replay || !!view.replay;
  if (match.replay) $('replay-link').firstElementChild.href = `replays/match?${new URLSearchParams(match.replay)}`;
  riichiBtn.hidden = !game.riichiDiscards.length;
  riichiBtn.classList.toggle('selected', choosingRiichi);
  tsumoBtn.hidden = !game.canTsumo;
  kyuushuBtn.hidden = !game.canKyuushu;
  ronBtn.hidden = !game.canRon;
  passBtn.hidden = !game.canRon && !game.ponOptions.length && !game.openKanOptions.length && !game.chiiOptions.length;
  if (game.phase !== 'exchange' || game.exchange.mine) exchangePicks = new Set();
  exchangeBtn.hidden = !(game.phase === 'exchange' && you !== null && !game.exchange.mine);
  exchangeBtn.disabled = exchangePicks.size !== 3;
  exchangeBtn.textContent = t('table.exchange', { n: exchangePicks.size });

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
  for (const [type, label, key] of [['pon', 'table.pon', 'ponOptions'], ['kan', 'table.openKan', 'openKanOptions'], ['chii', 'table.chii', 'chiiOptions']]) {
    for (const pair of game[key]) {
      const labels = pair.map((id) => tileText(mine.find((tile) => tile.id === id)));
      button(t(label, { tiles: labels.join(' ') }), { type, tiles: pair });
    }
  }
  // Closed or added kans on your own turn.
  const allMine = [...mine, ...(game.players[you]?.drawn ? [game.players[you].drawn] : [])];
  for (const option of game.kanOptions) {
    const tile = allMine.find((x) => x.id === option.tiles[0]);
    button(t(option.type === 'kakan' ? 'table.addedKan' : 'table.closedKan', { tile: tileText(tile) }), { type: 'kan', kind: option.kind });
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
  if (e.code !== 'Space' || !view?.game || view.replay || choosingRiichi) return;
  const { game, you } = view;
  const me = game.players[you];
  if (me?.riichi && !game.canTsumo) return;
  if (game.current === you && game.phase === 'discard' && me?.drawn) {
    e.preventDefault();
    send({ type: 'discard', tileId: me.drawn.id });
  }
});

// The language pickers (main page, waiting room, Recent matches): a change redoes the static text
// and draws the current page again.
function refreshLanguage() {
  applyStatic();
  drawCreateSettings();
  if (route() === 'replays') renderMatches();
  else if (route() === 'replays/match' && replayMatch && view?.replay) renderReplay();
  else if (view && !view.replay) render();
}
for (const input of document.querySelectorAll('.lang-picker input')) {
  input.addEventListener('change', () => {
    setLang(input.value);
    refreshLanguage();
  });
}
applyStatic();

// The page for the address this tab opened at (the game page waits for the server, above).
if (route() !== 'game') showRoute();
