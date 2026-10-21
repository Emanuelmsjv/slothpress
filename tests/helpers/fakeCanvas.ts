/**
 * A canvas stand-in that records what the renderer did.
 *
 * This lets the renderer be tested without a browser: no DOM, no headless
 * runner, no screenshots to eyeball. Every assertion is about a number or a
 * coordinate the renderer chose, which is exactly the class of bug that a
 * visual check misses.
 */

export interface RecordedText {
  text: string;
  x: number;
  y: number;
  font: string;
  align: string;
  fillStyle: string;
  globalAlpha: number;
}

export interface RecordedFill {
  style: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FakeGradient {
  readonly stops: { offset: number; color: string }[] = [];

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

export class FakeContext {
  font = '10px sans-serif';
  fillStyle = '#000000';
  globalAlpha = 1;
  textAlign = 'left';
  textBaseline = 'alphabetic';

  readonly texts: RecordedText[] = [];
  readonly fills: RecordedFill[] = [];
  readonly gradients: FakeGradient[] = [];
  readonly transforms: number[][] = [];
  readonly clears: { x: number; y: number; width: number; height: number }[] = [];

  /** Width of one character as a fraction of the font size. */
  charWidth = 0.5;

  measureText(text: string): { width: number } {
    const size = Number.parseFloat(this.font) || 10;
    return { width: text.length * size * this.charWidth };
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({
      text,
      x,
      y,
      font: this.font,
      align: this.textAlign,
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
    });
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.fills.push({ style: this.fillStyle, x, y, width, height });
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.clears.push({ x, y, width, height });
  }

  createLinearGradient(): FakeGradient {
    const gradient = new FakeGradient();
    this.gradients.push(gradient);
    return gradient;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transforms.push([a, b, c, d, e, f]);
  }

  /** The font size the renderer last asked for, parsed back out of the shorthand. */
  get lastFontSize(): number {
    return Number.parseFloat(this.font) || 0;
  }
}

export interface FakeCanvasPair {
  canvas: HTMLCanvasElement;
  ctx: FakeContext;
}

export function createFakeCanvas(): FakeCanvasPair {
  const ctx = new FakeContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
  } as unknown as HTMLCanvasElement;

  return { canvas, ctx };
}
