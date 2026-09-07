import { lemmatize } from './src/lib/lemmatize.ts';

const cases: [string, string][] = [
  ['books', 'book'],
  ['running', 'run'],
  ['went', 'go'],
  ['better', 'good'],
  ['children', 'child'],
  ['played', 'play'],
  ['happily', 'happy'],
  ['bigger', 'big'],
  ['boxes', 'box'],
  ['babies', 'baby'],
  ['studies', 'study'],
  ['quickly', 'quick'],
  ['taken', 'take'],
  ['mice', 'mouse'],
  ['worst', 'bad'],
  ['book', 'book'],
  ['feet', 'foot'],
  ['was', 'be'],
  ['copied', 'copy'],
  ['stopping', 'stop'],
];

let pass = 0;
let fail = 0;
for (const [input, expect] of cases) {
  const cands = lemmatize(input, 'en');
  const ok = cands.includes(expect);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${input.padEnd(10)} -> [${cands.join(', ')}]  (expect ${expect})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
