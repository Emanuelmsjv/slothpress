import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_GAP,
  ATTRIBUTION_SIZE,
  CARD_HEIGHT,
  CARD_WIDTH,
  EXPORT_SCALE,
  renderCard,
} from '../src/lib/render';
import { DEFAULT_STYLE, type StyleMetadata } from '../src/lib/style';
import { createFakeCanvas } from './helpers/fakeCanvas';

const QUOTE = 'The lazy river keeps its own time, and it does not hurry, and it does not wait.';

function style(overrides: Partial<StyleMetadata> = {}): StyleMetadata {
  return { ...DEFAULT_STYLE, ...overrides };
}

function render(overrides: Partial<StyleMetadata> = {}, content = QUOTE, author = 'Anonymous') {
  const { canvas, ctx } = createFakeCanvas();
  const result = renderCard(canvas, { content, author, style: style(overrides) });
  return { canvas, ctx, result };
}

describe('renderCard geometry', () => {
  it('sizes the canvas to the card, not to the device pixel ratio', () => {
    const { canvas } = render();
    expect(canvas.width).toBe(CARD_WIDTH);
    expect(canvas.height).toBe(CARD_HEIGHT);
  });

  it('doubles the backing store for an export without changing the layout', () => {
    const { canvas, ctx } = createFakeCanvas();
    renderCard(canvas, { content: QUOTE, author: 'Anonymous', style: style() }, EXPORT_SCALE);

    expect(canvas.width).toBe(CARD_WIDTH * 2);
    expect(canvas.height).toBe(CARD_HEIGHT * 2);
    expect(ctx.transforms.at(-1)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('lays everything out in logical pixels', () => {
    const { ctx } = render({ text_align: 'left' });
    const body = ctx.texts.find((t) => t.text.includes('lazy'));
    expect(body?.x).toBe(DEFAULT_STYLE.padding);
  });
});

describe('renderCard background', () => {
  it('actually uses the stops in the gradient', () => {
    const { ctx } = render({ bg_type: 'gradient', bg_value: 'linear-gradient(135deg, #1e1e2f, #11111d)' });
    expect(ctx.gradients).toHaveLength(1);
    expect(ctx.gradients[0]?.stops).toEqual([
      { offset: 0, color: 'rgba(30, 30, 47, 1)' },
      { offset: 1, color: 'rgba(17, 17, 29, 1)' },
    ]);
  });

  it('fills a solid background without a gradient', () => {
    const { ctx } = render({ bg_type: 'solid', bg_value: '#101010' });
    expect(ctx.gradients).toHaveLength(0);
    expect(ctx.fills.at(-1)?.style).toBe('rgba(16, 16, 16, 1)');
  });

  it('falls back to a solid color when the gradient cannot be read', () => {
    const { ctx } = render({ bg_type: 'gradient', bg_value: 'not-a-gradient' });
    expect(ctx.gradients).toHaveLength(0);
    expect(ctx.fills).toHaveLength(1);
  });
});

describe('renderCard alignment', () => {
  it('draws left aligned text against the left padding', () => {
    const { ctx } = render({ text_align: 'left' });
    expect(ctx.texts[0]?.x).toBe(DEFAULT_STYLE.padding);
    expect(ctx.texts[0]?.align).toBe('left');
  });

  it('draws centered text on the centre line', () => {
    const { ctx } = render({ text_align: 'center' });
    expect(ctx.texts[0]?.x).toBe(CARD_WIDTH / 2);
    expect(ctx.texts[0]?.align).toBe('center');
  });

  it('draws right aligned text against the right padding', () => {
    const { ctx } = render({ text_align: 'right' });
    expect(ctx.texts[0]?.x).toBe(CARD_WIDTH - DEFAULT_STYLE.padding);
    expect(ctx.texts[0]?.align).toBe('right');
  });
});

describe('renderCard text fitting', () => {
  it('keeps the requested size for a short quote', () => {
    const { result } = render({ font_size: 48 }, 'Short and sweet');
    expect(result.fontSize).toBe(48);
  });

  it('shrinks the text when the quote is long', () => {
    const { result } = render({ font_size: 48 }, QUOTE.repeat(10));
    expect(result.fontSize).toBeLessThan(48);
    expect(result.overflow).toBe(false);
  });

  it('breaks a word that is wider than the card', () => {
    const { ctx, result } = render({ font_size: 48 }, 'x'.repeat(300));
    expect(result.lines.length).toBeGreaterThan(1);
    expect(ctx.texts.length).toBeGreaterThan(1);
    const body = ctx.texts.filter((t) => !t.text.startsWith('—'));
    expect(body.map((t) => t.text).join('')).toBe('x'.repeat(300));
  });

  it('never runs the text into the attribution band', () => {
    const padding = DEFAULT_STYLE.padding;
    const contentBottom = CARD_HEIGHT - padding - (ATTRIBUTION_SIZE * 2 + ATTRIBUTION_GAP);
    const { ctx } = render({ font_size: 48 }, QUOTE.repeat(3));

    const bodyTexts = ctx.texts.filter((t) => !t.text.startsWith('—'));
    expect(bodyTexts.length).toBeGreaterThan(0);

    for (const text of bodyTexts) {
      const size = Number.parseFloat(text.font);
      const halfLine = (size * DEFAULT_STYLE.line_height) / 2;
      expect(text.y + halfLine).toBeLessThanOrEqual(contentBottom + 0.5);
    }

    const attribution = ctx.texts.find((t) => t.text.startsWith('—'));
    expect(attribution).toBeDefined();
    expect(attribution?.y).toBeGreaterThan(contentBottom);
  });

  it('reports overflow when the text cannot fit even at the smallest size', () => {
    const { result } = render({ font_size: 48 }, 'word '.repeat(2000));
    expect(result.overflow).toBe(true);
    expect(result.linesFitting).toBeLessThan(result.lines.length);
  });
});

describe('renderCard attribution', () => {
  it('draws the author under the text', () => {
    const { ctx } = render({}, QUOTE, 'Mary Oliver');
    const attribution = ctx.texts.at(-1);
    expect(attribution?.text).toBe('— Mary Oliver');
    expect(attribution?.globalAlpha).toBeLessThan(1);
  });

  it('leaves the attribution out when there is no author', () => {
    const { ctx } = render({}, QUOTE, '   ');
    expect(ctx.texts.some((t) => t.text.startsWith('—'))).toBe(false);
  });

  it('leaves the attribution out when it is switched off', () => {
    const { ctx } = render({ show_attribution: false }, QUOTE, 'Mary Oliver');
    expect(ctx.texts.some((t) => t.text.startsWith('—'))).toBe(false);
  });
});
