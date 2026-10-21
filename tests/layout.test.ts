import { describe, expect, it } from 'vitest';
import { fitText, hardBreak, wrapText, type Measure } from '../src/lib/layout';

/** A predictable stand-in for `ctx.measureText`: every character is 0.5em wide. */
const monospaceish: Measure = (text, fontSize) => text.length * fontSize * 0.5;

describe('wrapText', () => {
  it('wraps on word boundaries', () => {
    const lines = wrapText('the quick brown fox jumps', 200, 20, monospaceish);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(monospaceish(line, 20)).toBeLessThanOrEqual(200);
    }
  });

  it('keeps a line that already fits', () => {
    expect(wrapText('short', 1000, 20, monospaceish)).toEqual(['short']);
  });

  it('preserves hard line breaks', () => {
    const lines = wrapText('first line\nsecond line', 1000, 20, monospaceish);
    expect(lines).toEqual(['first line', 'second line']);
  });

  it('preserves blank lines the author typed', () => {
    const lines = wrapText('one\n\ntwo', 1000, 20, monospaceish);
    expect(lines).toEqual(['one', '', 'two']);
  });

  it('normalizes windows line endings', () => {
    expect(wrapText('a\r\nb', 1000, 20, monospaceish)).toEqual(['a', 'b']);
  });

  it('breaks a word that is wider than the line', () => {
    const url = 'https://example.com/a/very/long/path/that/never/ends';
    const lines = wrapText(url, 100, 20, monospaceish);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(monospaceish(line, 20)).toBeLessThanOrEqual(100);
    }
    expect(lines.join('')).toBe(url);
  });

  it('does not lose characters when it breaks a long word', () => {
    const word = 'x'.repeat(200);
    const lines = wrapText(word, 100, 20, monospaceish);
    expect(lines.join('')).toBe(word);
  });

  it('returns nothing for empty text', () => {
    expect(wrapText('', 100, 20, monospaceish)).toEqual([]);
  });
});

describe('hardBreak', () => {
  it('splits a word into chunks that fit', () => {
    const chunks = hardBreak('abcdefghij', 100, 20, monospaceish);
    expect(chunks).toEqual(['abcdefghij'.slice(0, 10)]);
  });

  it('keeps making progress on a single character wider than the line', () => {
    const chunks = hardBreak('abc', 1, 200, monospaceish);
    expect(chunks).toEqual(['a', 'b', 'c']);
  });
});

describe('fitText', () => {
  it('keeps the requested size when the text fits', () => {
    const result = fitText('a short quote', {
      maxWidth: 900,
      maxHeight: 800,
      minFontSize: 14,
      maxFontSize: 48,
      lineHeight: 1.5,
      measure: monospaceish,
    });
    expect(result.fontSize).toBe(48);
    expect(result.overflow).toBe(false);
  });

  it('shrinks the text until it fits', () => {
    const result = fitText('a much longer quote that will not fit at forty eight pixels at all', {
      maxWidth: 300,
      maxHeight: 200,
      minFontSize: 14,
      maxFontSize: 48,
      lineHeight: 1.5,
      measure: monospaceish,
    });
    expect(result.fontSize).toBeLessThan(48);
    expect(result.fontSize).toBeGreaterThanOrEqual(14);
    expect(result.heightPx).toBeLessThanOrEqual(200);
    expect(result.overflow).toBe(false);
  });

  it('picks the largest size that fits', () => {
    const options = {
      maxWidth: 400,
      maxHeight: 300,
      minFontSize: 14,
      maxFontSize: 60,
      lineHeight: 1.5,
      measure: monospaceish,
    };
    const result = fitText('one two three four five six seven eight nine ten', options);
    const oneSmaller = fitText('one two three four five six seven eight nine ten', {
      ...options,
      maxFontSize: result.fontSize - 1,
    });
    expect(oneSmaller.fontSize).toBeLessThan(result.fontSize);
  });

  it('reports overflow when even the smallest size does not fit', () => {
    const result = fitText('word '.repeat(200), {
      maxWidth: 100,
      maxHeight: 30,
      minFontSize: 14,
      maxFontSize: 48,
      lineHeight: 1.5,
      measure: monospaceish,
    });
    expect(result.overflow).toBe(true);
    expect(result.fontSize).toBe(14);
    expect(result.linesFitting).toBeLessThan(result.lines.length);
  });
});
