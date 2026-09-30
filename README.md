Riichi mahjong game vibe coded with Claude

## Running

```
npm start
```

Open http://localhost:8080 in 4 browser tabs, one per seat. The first hand is dealt when the 4th tab connects.

## Testing with a fixed wall (seeds)

`DEBUG_SEED` replaces the random shuffle with a fixed wall order, so every hand deals the same tiles:

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
