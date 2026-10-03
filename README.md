Riichi mahjong game vibe coded with Claude

## Running

```
npm start
```

Open http://localhost:8080, pick a name, and create a room: you get a 6-character room code and an invite link (`/game?room=<code>`). Three more players join with the code or the link; the room's creator (the host) picks the settings and starts the match once all four seats are taken. Several rooms can play at once. Each browser tab is its own player, so you can test alone with 4 tabs; reloading a tab keeps its seat.

Pages:

| Address | Page |
| --- | --- |
| `/` | the main page: pick a name, create or join a room |
| `/game?room=<code>` | a room: its waiting room, then the table (this is the invite link) |
| `/replays` | recent recorded matches, with a search (finished ones link to their replay) |
| `/replays/match?room=<code>&start=<time>` | a finished match's replay; `&hand=<n>&step=<k>` opens a given moment |

Any other address redirects to the main page. Every link and file reference is relative to the site root (the server writes a relative `<base href>` into each page), so the game also works behind a proxy at a sub-path. The browser's Back and Forward buttons move between the pages; going Back out of a room leaves it (during a match the seat is kept for you).

Match settings (chosen by the host before the start):

| Setting | Options (default first for the toggles) |
| --- | --- |
| Format | Standard (default), or Baiman contest: each hand deals everyone a wild tile (1A) and starts with a three-tile exchange; everyone starts on 0, a baiman or sanbaiman win scores 1 point, nobody loses points, and a hand goes on after each win until three players have won or the wall runs out (winners' hands and ura dora stay hidden until then) |
| Length | East + South (hanchan, default), or East only (tonpuusen) |
| Bust | on: the match ends as soon as someone is below 0 |

Fixed rules: sudden death (if nobody has 30,000 after the last hand, play continues into the next wind until someone does; not in the Baiman contest) and agari-yame (in the last hand, a dealer who repeats while in first place ends the match) always apply; the dealer repeats after a win or when tenpai at an exhaustive draw; honba go up on a repeat and on every exhaustive draw, reset after a non-dealer win, and are worth 300 each to the winner; riichi sticks left at the end go to first place.

During a hand, each player's Auto checklist (on the table) can ron and tsumo for them whenever it is legal, skip every pon, chii and kan offer, and discard each draw (tsumogiri, never a tile that could be a tsumo). It can be changed at any time and switches off at the start of every hand.

## Tile images

Tiles are drawn with SVG pictures by default; each player can switch to text tiles (`5p`) with the "Algebraic tiles" checkbox on the table. The pictures in `tiles/tileset2/` come from [riichi-mahjong-tiles-svg](https://github.com/tempai-dev/riichi-mahjong-tiles-svg), whose author offers them under the MIT license or as public domain (CC-PDDC); see [`tiles/LICENSE.md`](tiles/LICENSE.md). The wild tile `tiles/tileset2/1a.svg` (Baiman contest) was made for this project. The others were cut from the source's single-sheet panels with `tools/cut-tiles.mjs`; to regenerate them, clone that repository into this directory and run `node tools/cut-tiles.mjs`.

## Languages

The main page, the room's waiting page and Recent matches have a language choice under their heading: English (the default) or 简体中文, remembered per browser. All text lives in `i18n.js`: an English table and a Chinese one, looked up by key. The Chinese entries start as placeholder numbers (10001, 10002, ... in table order), each followed by its `{placeholders}` (values filled in at runtime: numbers, names, tiles); translate by replacing each entry, keeping its placeholders. A missing Chinese entry shows the English. Server messages are sent as codes (`error.*` in the table), and the game's own names (yaku, limits, winds, honor tiles) are translated for display only: the server and recorded matches keep the English names.

## Debugging options

Environment variables, set before `npm start`; they can be combined:

| Variable | Effect |
| --- | --- |
| `NO_DELAYS=1` | removes every artificial pause: the three below, and the 1-second hold on a ron or tsumo before the result is shown |
| `DRAW_DELAY_MS` | pause after a discard nobody can call, before the next draw (default 2000) |
| `AUTO_DISCARD_MS` | pause before a draw is discarded automatically, in riichi or with auto tsumogiri (default 1000) |
| `KAN_DRAW_MS` | pause after a kan, before the replacement tile (default 500) |
| `DEBUG_SEED` | a fixed wall for every hand, from a seed file or a seed string (see below) |
| `PORT` | the server port (default 8080) |
| `DB_PATH` | where to record matches (default `matches.db` next to `server.js`; see below) |
| `NO_RECORD=1` | don't record matches |

```
NO_DELAYS=1 npm start                                 # no pauses at all
DRAW_DELAY_MS=0 npm start                             # no pause before draws only
NO_DELAYS=1 DEBUG_SEED=seeds/kan-manual.txt npm start # a fixed hand, no pauses
```

## Recorded matches

The server records every standard match (not Baiman contest ones) in an SQLite database, `matches.db`, using Node's built-in `node:sqlite` (no extra dependency). Each hand is stored as its wall's full order (the seed) plus every action in order: discards (marking riichi and tsumogiri), chii, pon and kan calls with the tiles they reveal, closed and added kans, ron, tsumo and kyuushu kyuuhai. Draws and passes follow from those, so with the seed they determine the hand completely. Actions are written as they happen, so even a hand cut off by a restart can be recovered up to its last action. Matches played with `DEBUG_SEED` are marked `debug`.

| Table | One row per | Columns |
| --- | --- | --- |
| `matches` | match | `room`, `started_at`, `ended_at`, `settings`, `players`, `debug`, `final` |
| `hands` | hand | `match_id`, `number`, `label`, `dealer`, `round_wind`, `honba`, `riichi_sticks`, `scores` (at the start), `rules`, `seed`, `started_at`, `ended_at`, `result` |
| `actions` | action | `hand_id`, `seq`, `type`, `seat`, `data` (the whole action as JSON) |

Times are ISO 8601 (UTC); JSON columns write tiles in seed notation (`5m`, `0p` for a red five, `7z`). `replay.js` rebuilds any hand from its row and actions, and `tools/replay.mjs` uses it:

```
node tools/replay.mjs list          # recorded matches
node tools/replay.mjs match 3       # the hands of match 3
node tools/replay.mjs hand 12       # hand 12 move by move, replayed and checked against its result
```

The replay page (`/replays/match?...`) does the same in the browser: every hand face up, seen from the room's first seat (East in East 1) until you press "Switch view" on another player. The navbar under the dora panel steps by round (hand) or by step (each draw, and each action: a discard, call, kan or win); scrolling over the table and the ← → keys move a step. The address keeps the hand and step, so you can link to a moment. Only finished matches have replays: one still being played would show everyone's hands.

Replays re-run the current rules, so after a rule change older records may no longer fit (the page then says the hand can't be replayed). The plan is to start a fresh database instead: stop the server and delete `matches.db` (and `matches.db-wal`, `matches.db-shm`).

Or query it directly, e.g. `sqlite3 matches.db "SELECT label, json_extract(result, '$.type') FROM hands WHERE match_id = 3"`.

## Testing with a fixed wall (seeds)

`DEBUG_SEED` replaces the random shuffle with a fixed wall order, so every hand in every room deals the same tiles:

```
DEBUG_SEED=seeds/riichi-ippatsu.txt npm start    # a seed file
DEBUG_SEED=1112345678999m123p npm start          # or the seed itself
```

A seed is tile notation read left to right as wall positions 0, 1, 2, ... (`0m`/`0p`/`0s` are red fives, `1z`-`7z` are E S W N Haku Hatsu Chun). Seed files may contain `#` comments and line breaks. A seed shorter than 136 tiles fixes only the first positions and shuffles the rest.

Positions (seats counted from the dealer):

| Positions | Used for |
| --- | --- |
| 0-47 | the deal, 4 tiles at a time: 0-3 dealer, 4-7 next seat, 8-11, 12-15, 16-19 dealer, ... |
| 48-51 | one more tile each, dealer first |
| 52 | the dealer's first draw |
| 53-121 | the remaining draws in turn order |
| 122-125 | dead wall: replacement tiles drawn after a kan, in order |
| 126, 127 | dead wall: the dora indicator, and the ura dora indicator under it |
| 128-135 | dead wall: the indicator and ura indicator each kan reveals (128/129 for the first kan, then 130/131, ...) |

Each kan also moves the last live-wall tile to the dead wall, so the live wall ends one tile earlier per kan.

In a Baiman contest everyone's 13th tile is the wild tile `1A` instead, which isn't part of the wall: positions 48-51 aren't dealt, so 48 is the dealer's first draw and 49-121 are the remaining draws.

The server logs every hand's full seed (`Seed: ...`), including random games, so any hand can be replayed. See `seeds/` for examples.

## Tests

```
for t in test-*.js; do node $t; done
```
