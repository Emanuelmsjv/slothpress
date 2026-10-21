/**
 * The renderer: card geometry, background and text painting.
 *
 * The card is always 1080 x 1350 logical pixels. The canvas backing store is
 * scaled independently, so the preview can be a quarter of that and the
 * export can be twice it, without either changing a single number in here.
 */

import { normalizeStyle, resolveFontStack, type StyleMetadata } from './style';
import { gradientLine, parseColor, parseGradient, rgbaToCss } from './gradient';
import { fitText, type Measure } from './layout';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
export const EXPORT_SCALE = 2;
export const ATTRIBUTION_SIZE = 26;
export const ATTRIBUTION_GAP = 30;
export const MIN_RENDER_FONT_SIZE = 14;

export interface CardData {
  content: string;
  author: string;
  style: StyleMetadata;
}

export interface RenderResult {
  fontSize: number;
  lines: string[];
  overflow: boolean;
  linesFitting: number;
  renderMs: number;
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  style: StyleMetadata,
  width: number,
  height: number,
): void {
  if (style.bg_type === 'solid') {
    const color = parseColor(style.bg_value);
    ctx.fillStyle = color ? rgbaToCss(color) : '#11111d';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const gradient = parseGradient(style.bg_value);
  if (!gradient) {
    ctx.fillStyle = '#11111d';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const { x0, y0, x1, y1 } = gradientLine(width, height, gradient.angle);
  const paint = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const stop of gradient.stops) {
    paint.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
  }
  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Draws a card onto a canvas.
 *
 * `scale` only affects the backing store size. Everything is laid out in
 * logical pixels, so a scale of 2 produces a 2160 x 2700 image with exactly
 * the same layout as the preview.
 */
export function renderCard(
  canvas: HTMLCanvasElement,
  data: CardData,
  scale = 1,
): RenderResult {
  const startedAt = performance.now();
  const style = normalizeStyle(data.style);

  canvas.width = Math.round(CARD_WIDTH * scale);
  canvas.height = Math.round(CARD_HEIGHT * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser did not give us a 2D canvas context.');

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  paintBackground(ctx, style, CARD_WIDTH, CARD_HEIGHT);

  const padding = style.padding;
  const fontStack = resolveFontStack(style.font_family);
  const contentWidth = CARD_WIDTH - padding * 2;

  const author = (data.author ?? '').trim();
  const showAttribution = style.show_attribution && author.length > 0;
  const attributionBand = showAttribution ? ATTRIBUTION_SIZE * 2 + ATTRIBUTION_GAP : 0;
  const contentTop = padding;
  const contentBottom = CARD_HEIGHT - padding - attributionBand;
  const maxHeight = Math.max(40, contentBottom - contentTop);

  const measure: Measure = (text, fontSize) => {
    ctx.font = `${fontSize}px ${fontStack}`;
    return ctx.measureText(text).width;
  };

  const fit = fitText(data.content ?? '', {
    maxWidth: contentWidth,
    maxHeight,
    minFontSize: MIN_RENDER_FONT_SIZE,
    maxFontSize: style.font_size,
    lineHeight: style.line_height,
    measure,
  });

  const lineHeight = fit.lineHeightPx;
  const blockHeight = fit.lines.length * lineHeight;
  const blockTop = contentTop + (maxHeight - blockHeight) / 2;

  ctx.font = `${fit.fontSize}px ${fontStack}`;
  ctx.fillStyle = style.text_color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = style.text_align;

  const x =
    style.text_align === 'left' ? padding : style.text_align === 'right' ? CARD_WIDTH - padding : CARD_WIDTH / 2;

  fit.lines.forEach((line, index) => {
    if (!line) return;
    const y = blockTop + index * lineHeight + lineHeight / 2;
    ctx.fillText(line, x, y);
  });

  if (showAttribution) {
    ctx.font = `${ATTRIBUTION_SIZE}px ${fontStack}`;
    ctx.fillStyle = style.text_color;
    ctx.globalAlpha = 0.62;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`— ${author}`, CARD_WIDTH / 2, CARD_HEIGHT - padding - ATTRIBUTION_SIZE / 2);
    ctx.globalAlpha = 1;
  }

  return {
    fontSize: fit.fontSize,
    lines: fit.lines,
    overflow: fit.overflow,
    linesFitting: fit.linesFitting,
    renderMs: performance.now() - startedAt,
  };
}

/** Renders a card at export resolution onto a detached canvas. */
export function renderExportCanvas(data: CardData, scale = EXPORT_SCALE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  renderCard(canvas, data, scale);
  return canvas;
}
