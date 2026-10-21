/**
 * Text layout: wrapping, hard-breaking and auto-fit.
 *
 * Everything in here is pure. The renderer hands in a `measure` function and
 * gets back lines and a font size, which means the whole layout can be tested
 * without a canvas and without a browser.
 */

/** Width of a string at a given font size, in logical pixels. */
export type Measure = (text: string, fontSize: number) => number;

export interface FitOptions {
  /** Widest a single line may be. */
  maxWidth: number;
  /** Tallest the whole text block may be. */
  maxHeight: number;
  minFontSize: number;
  maxFontSize: number;
  /** Multiplier of the font size used for the baseline-to-baseline distance. */
  lineHeight: number;
  measure: Measure;
}

export interface FitResult {
  lines: string[];
  fontSize: number;
  lineHeightPx: number;
  heightPx: number;
  /** True when the text still does not fit at `minFontSize`. */
  overflow: boolean;
  /** How many lines are visible inside the available height. */
  linesFitting: number;
}

/**
 * Splits a single word that is wider than the line into pieces that fit.
 *
 * Without this, one 40-character URL would silently run off the edge of the
 * card. Breaking the word is the honest option: the text is still all there.
 */
export function hardBreak(word: string, maxWidth: number, fontSize: number, measure: Measure): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const ch of word) {
    const candidate = current + ch;
    if (current && measure(candidate, fontSize) > maxWidth) {
      chunks.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  fontSize: number,
  measure: Measure,
): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      out.push(current);
      current = '';
    }

    if (measure(word, fontSize) <= maxWidth) {
      current = word;
      continue;
    }

    const chunks = hardBreak(word, maxWidth, fontSize, measure);
    for (let i = 0; i < chunks.length - 1; i++) out.push(chunks[i] as string);
    current = chunks[chunks.length - 1] ?? '';
  }

  if (current) out.push(current);
  return out;
}

/**
 * Wraps text into lines that fit `maxWidth`.
 *
 * Blank lines in the source are preserved as blank lines. A poet who hits
 * return twice means it, and a quote card that quietly eats the break is
 * wrong.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, measure: Measure): string[] {
  const source = typeof text === 'string' ? text : '';
  const paragraphs = source.replace(/\r\n/g, '\n').split('\n');
  const lines: string[] = [];

  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.trim();
    if (!paragraph) {
      lines.push('');
      continue;
    }
    lines.push(...wrapParagraph(paragraph, maxWidth, fontSize, measure));
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Picks the largest font size at or below `maxFontSize` where the text still
 * fits inside `maxHeight`, and wraps it at that size.
 *
 * Height is monotonically non-increasing as the font shrinks, so the search is
 * a binary search over the size range rather than a scan.
 */
export function fitText(text: string, options: FitOptions): FitResult {
  const { maxWidth, maxHeight, minFontSize, maxFontSize, lineHeight, measure } = options;

  const linesAt = (size: number): string[] => wrapText(text, maxWidth, size, measure);
  const heightAt = (lines: string[], size: number): number => lines.length * size * lineHeight;

  const atMax = linesAt(maxFontSize);
  if (heightAt(atMax, maxFontSize) <= maxHeight) {
    const heightPx = heightAt(atMax, maxFontSize);
    return {
      lines: atMax,
      fontSize: maxFontSize,
      lineHeightPx: maxFontSize * lineHeight,
      heightPx,
      overflow: false,
      linesFitting: atMax.length,
    };
  }

  let low = minFontSize;
  let high = maxFontSize;
  let best: { lines: string[]; size: number } | null = null;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const lines = linesAt(mid);
    if (heightAt(lines, mid) <= maxHeight) {
      best = { lines, size: mid };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best) {
    const heightPx = heightAt(best.lines, best.size);
    return {
      lines: best.lines,
      fontSize: best.size,
      lineHeightPx: best.size * lineHeight,
      heightPx,
      overflow: false,
      linesFitting: best.lines.length,
    };
  }

  const lines = linesAt(minFontSize);
  const heightPx = heightAt(lines, minFontSize);
  const linesFitting = maxHeight > 0 ? Math.max(0, Math.floor(maxHeight / (minFontSize * lineHeight))) : 0;
  return {
    lines,
    fontSize: minFontSize,
    lineHeightPx: minFontSize * lineHeight,
    heightPx,
    overflow: true,
    linesFitting,
  };
}
