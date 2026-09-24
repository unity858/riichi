// Run with: node test-tenpai.js
import { getWaits, isTenpai, kindLabel, newHand, checkIntegrity } from './game.js';

// Parse short notation like "123m456p11z" into tile objects (0 = red five).
function parse(str) {
  const tiles = [];
  let id = 0;
  for (const [, digits, suit] of str.matchAll(/(\d+)([mpsz])/g)) {
    for (const d of digits) {
      tiles.push({ id: id++, suit, rank: d === '0' ? 5 : Number(d), red: d === '0' });
    }
  }
  return tiles;
}

const cases = [
  ['1112345678999m', '1m 2m 3m 4m 5m 6m 7m 8m 9m'], // nine gates
  ['123m456p789s1122z', 'E S'], // shanpon
  ['1199m1199p1199s1z', 'E'], // chiitoitsu single wait
  ['1133m5577p99s112z', 'S'], // chiitoitsu single wait on an honor
  ['1111m2233p4455s6z', ''], // four of a kind is not two pairs
  ['19m19p19s1234567z', '1m 9m 1p 9p 1s 9s E S W N Wh G R'], // 13-sided kokushi
  ['19m19p19s1234566z', 'R'], // kokushi single wait
  ['1111m123p456p789p', '1m'], // empty tenpai: only wait is the 5th 1m, counted as ready
  ['1111m', '1m'], // empty tenpai after 3 calls
  ['13579m2468p135s7z', ''], // noten
  ['1234m', '1m 4m'], // closed part after 3 calls
  ['0m406p', '5m'], // red fives count as fives
];

const sorted = (s) => s.split(' ').filter(Boolean).sort().join(' ');
let failures = 0;
for (const [hand, expected] of cases) {
  const got = getWaits(parse(hand)).map(kindLabel).join(' ');
  const ok = sorted(got) === sorted(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${hand.padEnd(20)} [${got}]${ok ? '' : ` expected [${expected}]`}`);
}

// Helpers must not change the dealt state.
const state = newHand();
const before = JSON.stringify(state);
state.players.forEach((p) => isTenpai(p.hand));
const untouched = JSON.stringify(state) === before && checkIntegrity(state);
if (!untouched) failures++;
console.log(`${untouched ? 'ok  ' : 'FAIL'} helpers do not mutate state`);

process.exitCode = failures ? 1 : 0;
