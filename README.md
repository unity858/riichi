Riichi mahjong game vibe coded with Claude

## Running

```
npm start
```

Open http://localhost:8080, pick a name, and create a room: you get a 6-character room code and an invite link (`?room=<code>`). Three more players join with the code or the link; the room's creator (the host) picks the settings and starts the match once all four seats are taken. Several rooms can play at once. Each browser tab is its own player, so you can test alone with 4 tabs; reloading a tab keeps its seat.

Match settings (chosen by the host before the start):

| Setting | Options (default first for the toggles) |
| --- | --- |
| Length | East + South (hanchan, default), or East only (tonpuusen) |
| Bust | on: the match ends as soon as someone is below 0 |
| Sudden death | on: if nobody has 30,000 after the last hand, play on into the next wind until someone does |
| Agari-yame | on: in the last hand, a dealer who repeats while in first place ends the match |

Fixed rules: the dealer repeats after a win or when tenpai at an exhaustive draw; honba go up on a repeat and on every exhaustive draw, reset after a non-dealer win, and are worth 300 each to the winner; riichi sticks left at the end go to first place.

`DRAW_DELAY_MS=0 npm start` skips the 2-second pause after uncallable discards, for quicker testing.

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
| 122-135 | dead wall: 126 is the dora indicator, 127 the ura dora indicator |

The server logs every hand's full seed (`Seed: ...`), including random games, so any hand can be replayed. See `seeds/` for examples.

## Tests

```
for t in test-*.js; do node $t; done
```
