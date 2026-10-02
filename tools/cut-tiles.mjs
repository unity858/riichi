// Cuts the tile panels of riichi-mahjong-tiles-svg into one SVG file per tile.
//
//   node tools/cut-tiles.mjs [panel.svg out-dir]
//
// With no arguments, cuts both tilesets of the cloned repo into tiles/tileset1 and tiles/tileset2.
//
// Each panel is one big SVG with every tile as a top-level <g id="..."> (1man ... 9sou, ton,
// nan, xia, pei, haku, hatsu, chun, aka5man, ...). A tile's group is copied unchanged, with its
// transforms, into a file of its own along with the gradients it uses; only the viewBox is new,
// framing the tile where it sits in the panel. To find it, the group's paths are parsed, the
// transforms applied, and the exact extremes of every curve taken. All tiles of a set get the
// same frame size (the largest), centered on each tile, so they line up when shown together.
// Groups without a tile name (g1234) are skipped. No dependencies.

import fs from 'fs';
import path from 'path';

// --- A minimal XML reader: elements with attributes and their source span ---

function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [], start: 0, end: src.length };
  const stack = [root];
  const tagRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (let m; (m = tagRe.exec(src));) {
    const [all, closing, name, attrText, selfClosing] = m;
    if (!name) continue; // comment, declaration, CDATA
    if (closing) {
      const el = stack.pop();
      if (el.name !== name) throw new Error(`Mismatched </${name}> at ${m.index} (open: <${el.name}>)`);
      el.end = m.index + all.length;
      continue;
    }
    const attrs = {};
    for (const [, key, dq, sq] of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[key] = dq ?? sq;
    const el = { name, attrs, children: [], start: m.index, end: m.index + all.length, parent: stack.at(-1) };
    stack.at(-1).children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length !== 1) throw new Error(`Unclosed <${stack.at(-1).name}>`);
  return root;
}

const descendants = (el) => el.children.flatMap((c) => [c, ...descendants(c)]);

// --- Affine transforms [a, b, c, d, e, f]: (x, y) -> (a x + c y + e, b x + d y + f) ---

const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = ([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) => [
  a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
];
const apply = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];
const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

function parseTransform(text = '') {
  let m = IDENTITY;
  for (const [, fn, args] of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = (args.match(NUMBER) ?? []).map(Number);
    let t;
    if (fn === 'matrix') t = n;
    else if (fn === 'translate') t = [1, 0, 0, 1, n[0], n[1] ?? 0];
    else if (fn === 'scale') t = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
    else if (fn === 'rotate') {
      const r = (n[0] * Math.PI) / 180;
      const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
      t = multiply(multiply([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === 'skewX') t = [1, 0, Math.tan((n[0] * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') t = [1, Math.tan((n[0] * Math.PI) / 180), 0, 1, 0, 0];
    else throw new Error(`Unknown transform ${fn}`);
    m = multiply(m, t);
  }
  return m;
}

// The transform from an element's own coordinates to the panel's: every transform from the
// outermost group in.
function ctm(el) {
  const chain = [];
  for (let e = el; e && e.name !== '#root'; e = e.parent) chain.unshift(e);
  return chain.reduce((m, e) => multiply(m, parseTransform(e.attrs.transform)), IDENTITY);
}

// --- Path data -> cubic Bézier segments in absolute coordinates ---
// Lines and quadratics become cubics, which keeps one bounding-box routine. Arcs aren't used by
// these panels, so they are refused rather than approximated.

function pathToCubics(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const cubics = [];
  let i = 0;
  let cmd = null;
  let cur = [0, 0];
  let start = [0, 0];
  let lastCtrl = null; // the previous cubic's second control point, for S
  let lastQuad = null; // the previous quadratic's control point, for T
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /^[a-zA-Z]$/.test(t)) throw new Error(`Bad path data near token ${i}: ${d.slice(0, 80)}...`);
    return Number(t);
  };
  const pt = (rel) => {
    const x = num();
    const y = num();
    return rel ? [cur[0] + x, cur[1] + y] : [x, y];
  };
  const line = (to) => cubics.push([cur, cur, to, to]);
  const quad = (q, to) => cubics.push([cur, [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])],
    [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])], to]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (cmd === null) throw new Error('Path data must start with a command');
    const rel = cmd === cmd.toLowerCase();
    let ctrl = null;
    let q = null;
    switch (cmd.toUpperCase()) {
      case 'M': {
        cur = start = pt(rel);
        cmd = rel ? 'l' : 'L'; // further pairs are lines
        break;
      }
      case 'L': { const to = pt(rel); line(to); cur = to; break; }
      case 'H': { const x = num(); const to = [rel ? cur[0] + x : x, cur[1]]; line(to); cur = to; break; }
      case 'V': { const y = num(); const to = [cur[0], rel ? cur[1] + y : y]; line(to); cur = to; break; }
      case 'C': {
        const c1 = pt(rel); const c2 = pt(rel); const to = pt(rel);
        cubics.push([cur, c1, c2, to]); ctrl = c2; cur = to; break;
      }
      case 'S': {
        const c1 = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const c2 = pt(rel); const to = pt(rel);
        cubics.push([cur, c1, c2, to]); ctrl = c2; cur = to; break;
      }
      case 'Q': { q = pt(rel); const to = pt(rel); quad(q, to); cur = to; break; }
      case 'T': {
        q = lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
        const to = pt(rel); quad(q, to); cur = to; break;
      }
      case 'Z': { line(start); cur = start; break; }
      case 'A': throw new Error('Arcs in path data are not supported');
      default: throw new Error(`Unknown path command ${cmd}`);
    }
    lastCtrl = ctrl;
    lastQuad = q;
  }
  return cubics;
}

// Extremes of one coordinate of a cubic: its ends, and where the derivative is zero.
function cubicRange(p0, p1, p2, p3) {
  let lo = Math.min(p0, p3);
  let hi = Math.max(p0, p3);
  // B'(t)/3 = a t^2 + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) roots.push((-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a));
  }
  for (const t of roots) {
    if (t <= 0 || t >= 1) continue;
    const u = 1 - t;
    const v = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return [lo, hi];
}

// The bounding box of a group's paths in panel coordinates, widened by half of any stroke.
// An affine transform maps a cubic to the cubic of the mapped control points, so transforming
// the points first keeps the extremes exact.
function bbox(group) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const el of descendants(group)) {
    if (el.name !== 'path' || !el.attrs.d) continue;
    const m = ctm(el);
    const style = `${el.attrs.style ?? ''};stroke:${el.attrs.stroke ?? ''};stroke-width:${el.attrs['stroke-width'] ?? ''}`;
    const stroked = /stroke:(?!none|;|$)/.test(style);
    const width = stroked ? Number(style.match(/stroke-width:\s*([\d.]+)/)?.[1] ?? 1) : 0;
    const pad = (width / 2) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])); // scaled to the panel
    for (const seg of pathToCubics(el.attrs.d)) {
      const p = seg.map((q) => apply(m, q));
      const [x0, x1] = cubicRange(p[0][0], p[1][0], p[2][0], p[3][0]);
      const [y0, y1] = cubicRange(p[0][1], p[1][1], p[2][1], p[3][1]);
      box[0] = Math.min(box[0], x0 - pad);
      box[1] = Math.min(box[1], y0 - pad);
      box[2] = Math.max(box[2], x1 + pad);
      box[3] = Math.max(box[3], y1 + pad);
    }
  }
  return box;
}

// --- Cutting ---

const round = (n) => Number(n.toFixed(3));

export function cutPanel(panelFile, outDir) {
  const src = fs.readFileSync(panelFile, 'utf8');
  const doc = parseXml(src);
  const svg = doc.children.find((e) => e.name === 'svg');
  if (!svg) throw new Error(`${panelFile}: no <svg> element`);
  const defs = new Map(); // id -> element, for gradients and anything else a tile refers to
  for (const el of descendants(svg)) if (el.attrs.id && el.parent?.name === 'defs') defs.set(el.attrs.id, el);

  const tiles = svg.children.filter((e) => e.name === 'g' && e.attrs.id && !/^g\d+$/.test(e.attrs.id));
  const skipped = svg.children.filter((e) => e.name === 'g' && !tiles.includes(e)).map((e) => e.attrs.id ?? '(no id)');
  const boxes = tiles.map(bbox);
  const width = Math.max(...boxes.map((b) => b[2] - b[0]));
  const height = Math.max(...boxes.map((b) => b[3] - b[1]));

  fs.mkdirSync(outDir, { recursive: true });
  tiles.forEach((tile, i) => {
    const [x0, y0, x1, y1] = boxes[i];
    const x = (x0 + x1) / 2 - width / 2;
    const y = (y0 + y1) / 2 - height / 2;
    const body = src.slice(tile.start, tile.end);
    // The defs it uses: url(#id) and href="#id" references, followed through the defs themselves.
    const used = new Set();
    const queue = [body];
    while (queue.length) {
      for (const [, id] of queue.pop().matchAll(/(?:url\(#|href="#)([^)"]+)/g)) {
        if (used.has(id) || !defs.has(id)) continue;
        used.add(id);
        const def = defs.get(id);
        queue.push(src.slice(def.start, def.end));
      }
    }
    const defsText = [...used].map((id) => { const d = defs.get(id); return `    ${src.slice(d.start, d.end)}`; }).join('\n');
    const out = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Cut from ${path.basename(path.dirname(panelFile))}/${path.basename(panelFile)} of riichi-mahjong-tiles-svg (MIT OR CC-PDDC) by tools/cut-tiles.mjs -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${round(x)} ${round(y)} ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}">
${used.size ? `  <defs>\n${defsText}\n  </defs>\n` : ''}  ${body}
</svg>
`;
    fs.writeFileSync(path.join(outDir, `${tile.attrs.id}.svg`), out);
  });
  return { tiles: tiles.map((t) => t.attrs.id), skipped, width: round(width), height: round(height), boxes };
}

// --- Command line ---

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const repo = path.join(here, '..', 'riichi-mahjong-tiles-svg', 'vector');
  const jobs = process.argv.length >= 4
    ? [[process.argv[2], process.argv[3]]]
    : ['tileset1', 'tileset2'].map((set) => [path.join(repo, set, 'panel.color.svg'), path.join(here, '..', 'tiles', set)]);
  for (const [panel, out] of jobs) {
    const r = cutPanel(panel, out);
    console.log(`${panel} -> ${out}: ${r.tiles.length} tiles, each ${r.width} x ${r.height}`);
    if (r.skipped.length) console.log(`  skipped groups without a tile name: ${r.skipped.join(', ')}`);
  }
}
