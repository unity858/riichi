# Tile images: license

The SVG files in `tiles/` were cut, one file per tile, from the tile panels of
**riichi-mahjong-tiles-svg** by max ulidtko:

- Source: https://github.com/tempai-dev/riichi-mahjong-tiles-svg
- Commit: 18960b1513486c53829bbef5b6ff32ba99aa27ae (2022-05-03)
- Panel used: `vector/tileset2/panel.color.svg`
- Cut with `tools/cut-tiles.mjs` in this repository: each tile's drawing is copied
  unchanged, with a new viewBox framing it.

## License

The original repository states that its tiles may be used under **either the MIT license
or CC-PDDC (public domain), at the user's choice**. Its README says:

> I don't own and don't claim any rights on the original source raster material.
>
> The SVGs are derivative work of the rasters (and significant effort has been applied).
>
> You may choose the MIT license or CC-PDDC (Public Domain) when using this repo.
>
>     SPDX-License-Identifier: (MIT OR CC-PDDC)

Its `package.json` likewise declares `"license": "(MIT OR CC-PDDC)"`.

This project uses the tile images under the **MIT license**:

```
MIT License

Copyright (c) max ulidtko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The original raster artwork the SVGs were traced from is of unknown origin; as quoted above,
the original author was unable to credit it.
