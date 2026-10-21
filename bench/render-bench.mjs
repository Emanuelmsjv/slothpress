/**
 * Layout benchmark.
 *
 * Measures the part of the renderer that actually costs something: wrapping
 * and auto-fitting the text. The canvas drawing is left out on purpose, since
 * it is the browser's job and its numbers would say more about the machine
 * than about the code.
 *
 *   npm run bench
 *
 * Node strips the types off the TypeScript modules directly, so this runs
 * without a build step.
 */

import { fitText, wrapText } from '../src/lib/layout.ts';
import { parseGradient, parseColor } from '../src/lib/gradient.ts';

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1350;
const PADDING = 96;
const LINE_HEIGHT = 1.5;
const MIN_FONT = 14;
const MAX_FONT = 48;

const NARROW = new Set([...'ijltfr.,;:!|\'"`']);
const WIDE = new Set([...'mwMW@']);
const UPPER = new Set([...'ABCDEFGHJKLNOPQRSTUVXYZ']);

function charWidth(ch) {
  if (ch === ' ') return 0.26;
  if (NARROW.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.86;
  if (UPPER.has(ch)) return 0.66;
  return 0.5;
}

/** A stand-in for ctx.measureText that behaves like a serif face. */
function measure(text, fontSize) {
  let width = 0;
  for (const ch of text) width += charWidth(ch) * fontSize;
  return width;
}

const CORPUS = [
  { name: 'short', text: 'Slow rivers cut the deepest canyon.' },
  { name: 'quote', text: 'The best way to predict the future is to invent it.' },
  {
    name: 'stanza',
    text: 'First there is the mountain.\nThen there is the path.\nThen there is the walk, and the walking.',
  },
  {
    name: 'paragraph',
    text:
      'Typography is the craft of endowing human language with a durable visual form. A card is a ' +
      'deterministic function of the text and the style, which means the layout can be checked by a ' +
      'machine instead of by taste.',
  },
  {
    name: 'url',
    text: 'https://example.com/a/really/long/path/that/keeps/going/and/going/for/quite/a/while/indeed',
  },
  {
    name: 'pathological',
    text: 'word '.repeat(400),
  },
];

const ITERATIONS = 2000;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function bench(label, fn, iterations) {
  for (let i = 0; i < 200; i++) fn(i);

  const samples = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const started = process.hrtime.bigint();
    fn(i);
    samples[i] = Number(process.hrtime.bigint() - started) / 1e6;
  }

  const sorted = Array.from(samples).sort((a, b) => a - b);
  const mean = samples.reduce((sum, value) => sum + value, 0) / iterations;

  return {
    label,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

const maxWidth = CARD_WIDTH - PADDING * 2;
const maxHeight = CARD_HEIGHT - PADDING * 2 - 82;

console.log('Slothpress layout benchmark');
console.log(`  card            ${CARD_WIDTH} x ${CARD_HEIGHT}`);
console.log(`  text box        ${maxWidth} x ${maxHeight}`);
console.log(`  font range      ${MIN_FONT} - ${MAX_FONT}px`);
console.log(`  iterations      ${ITERATIONS}`);
console.log('');

const failures = [];

for (const entry of CORPUS) {
  const result = bench(entry.name, () => {
    fitText(entry.text, {
      maxWidth,
      maxHeight,
      minFontSize: MIN_FONT,
      maxFontSize: MAX_FONT,
      lineHeight: LINE_HEIGHT,
      measure,
    });
  }, ITERATIONS);

  const fitted = fitText(entry.text, {
    maxWidth,
    maxHeight,
    minFontSize: MIN_FONT,
    maxFontSize: MAX_FONT,
    lineHeight: LINE_HEIGHT,
    measure,
  });

  console.log(
    `${entry.name.padEnd(14)} mean ${result.mean.toFixed(4)}ms  p50 ${result.p50.toFixed(4)}ms  ` +
      `p95 ${result.p95.toFixed(4)}ms  max ${result.max.toFixed(4)}ms  ` +
      `${fitted.fontSize}px / ${fitted.lines.length} lines${fitted.overflow ? '  OVERFLOW' : ''}`,
  );

  if (result.p95 > 20) {
    failures.push(`${entry.name}: p95 of ${result.p95.toFixed(2)}ms is over the 20ms budget`);
  }
}

const wrap = bench('wrap', (i) => {
  wrapText(CORPUS[3].text, maxWidth, 48, measure);
}, ITERATIONS);
console.log(
  `\nwrap only         mean ${wrap.mean.toFixed(4)}ms  p95 ${wrap.p95.toFixed(4)}ms`,
);

const gradient = bench('gradient', () => {
  parseGradient('linear-gradient(135deg, #1e1e2f, #11111d)');
  parseColor('#f2f2f7');
}, ITERATIONS);
console.log(`gradient parse    mean ${gradient.mean.toFixed(5)}ms  p95 ${gradient.p95.toFixed(5)}ms`);

if (failures.length > 0) {
  console.error('\nBenchmark budget exceeded:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nAll layouts fit inside the 20ms budget.');
