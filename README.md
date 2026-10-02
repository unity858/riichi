Riichi mahjong game vibe coded with Claude

## Running

```
npm start
```

Open http://localhost:8080, pick a name, and create a room: you get a 6-character room code and an invite link (`?room=<code>`). Three more players join with the code or the link; the room's creator (the host) picks the settings and starts the match once all four seats are taken. Several rooms can play at once. Each browser tab is its own player, so you can test alone with 4 tabs; reloading a tab keeps its seat.

Match settings (chosen by the host before the start):

| Setting | Options (default first for the toggles) |
| --- | --- |
| Format | Standard (default), or Baiman contest: each hand deals everyone a wild tile (1A) and starts with a three-tile exchange; everyone starts on 0, a baiman or sanbaiman win scores 1 point, nobody loses points, and a hand goes on after each win until three players have won or the wall runs out (winners' hands and ura dora stay hidden until then) |
| Length | East + South (hanchan, default), or East only (tonpuusen) |
| Bust | on: the match ends as soon as someone is below 0 |
| Sudden death | on: if nobody has 30,000 after the last hand, play on into the next wind until someone does |
| Agari-yame | on: in the last hand, a dealer who repeats while in first place ends the match |

Fixed rules: the dealer repeats after a win or when tenpai at an exhaustive draw; honba go up on a repeat and on every exhaustive draw, reset after a non-dealer win, and are worth 300 each to the winner; riichi sticks left at the end go to first place.

During a hand, each player's Auto checklist (on the table) can ron and tsumo for them whenever it is legal, skip every pon, chii and kan offer, and discard each draw (tsumogiri, never a tile that could be a tsumo). It can be changed at any time and switches off at the start of every hand.

## Tile images

Tiles are drawn with SVG pictures by default; each player can switch to text tiles (`5p`) with the "Algebraic tiles" checkbox on the table. The pictures in `tiles/tileset2/` come from [riichi-mahjong-tiles-svg](https://github.com/tempai-dev/riichi-mahjong-tiles-svg), whose author offers them under the MIT license or as public domain (CC-PDDC); see [`tiles/LICENSE.md`](tiles/LICENSE.md). The wild tile `tiles/tileset2/1a.svg` (Baiman contest) was made for this project. The others were cut from the source's single-sheet panels with `tools/cut-tiles.mjs`; to regenerate them, clone that repository into this directory and run `node tools/cut-tiles.mjs`.

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

```
NO_DELAYS=1 npm start                                 # no pauses at all
DRAW_DELAY_MS=0 npm start                             # no pause before draws only
NO_DELAYS=1 DEBUG_SEED=seeds/kan-manual.txt npm start # a fixed hand, no pauses
```

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
