/**
 * A small CSS gradient parser.
 *
 * The card stores its background as a CSS gradient string so that the value is
 * readable, copyable and portable. The renderer cannot hand that string
 * straight to `ctx.fillStyle`, because `ctx.createLinearGradient` wants
 * explicit endpoints and stops. This module bridges the two, and it does so
 * without a DOM, which is what makes it testable.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GradientStop {
  /** Position along the gradient line, 0 to 1. */
  offset: number;
  /** Normalized `rgba(r, g, b, a)` string, always safe for `addColorStop`. */
  color: string;
}

export interface ParsedGradient {
  kind: 'linear';
  /** CSS convention: 0deg points up, 90deg right, 180deg down. */
  angle: number;
  stops: GradientStop[];
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  transparent: '#00000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  purple: '#800080',
  maroon: '#800000',
  orange: '#ffa500',
  pink: '#ffc0cb',
  gold: '#ffd700',
  indigo: '#4b0082',
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function clampAlpha(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()` and a few names. */
export function parseColor(input: string): Rgba | null {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!raw) return null;

  const named = NAMED_COLORS[raw];
  const value = named ?? raw;

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const parts = hex.split('').map((c) => parseInt(c + c, 16));
      return {
        r: clampByte(parts[0] ?? 0),
        g: clampByte(parts[1] ?? 0),
        b: clampByte(parts[2] ?? 0),
        a: parts.length === 4 ? clampAlpha((parts[3] ?? 0) / 255) : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      const pairs = hex.match(/.{2}/g) ?? [];
      return {
        r: clampByte(parseInt(pairs[0] ?? '00', 16)),
        g: clampByte(parseInt(pairs[1] ?? '00', 16)),
        b: clampByte(parseInt(pairs[2] ?? '00', 16)),
        a: pairs.length === 4 ? clampAlpha(parseInt(pairs[3] ?? '00', 16) / 255) : 1,
      };
    }
    return null;
  }

  const fn = value.match(/^rgba?\(([^)]*)\)$/);
  if (fn) {
    const parts = (fn[1] ?? '')
      .split(/[,/\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (rawChannel: string): number =>
      rawChannel.endsWith('%')
        ? clampByte((parseFloat(rawChannel) / 100) * 255)
        : clampByte(parseFloat(rawChannel));
    const r = channel(parts[0] ?? '0');
    const g = channel(parts[1] ?? '0');
    const b = channel(parts[2] ?? '0');
    const alphaPart = parts[3];
    const a = alphaPart === undefined ? 1 : clampAlpha(alphaPart.endsWith('%') ? parseFloat(alphaPart) / 100 : parseFloat(alphaPart));
    return { r, g, b, a };
  }

  return null;
}

export function rgbaToCss(color: Rgba): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`;
}

export function rgbaToHex(color: Rgba): string {
  const part = (value: number): string => clampByte(value).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

/**
 * Splits on a separator, but only where it is not inside parentheses. Without
 * this, `rgba(0, 0, 0, 0.5)` would be torn apart.
 */
export function splitTopLevel(input: string, separator = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);

    if (ch === separator && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

const STOP_PATTERN = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)\s*(?:([\d.]+)%)?$/i;

interface StopInput {
  color: string | null;
  offset: number | null;
}

function parseStop(raw: string): StopInput {
  const match = raw.trim().match(STOP_PATTERN);
  if (!match) return { color: null, offset: null };
  const colorText = match[1] ?? '';
  const parsed = parseColor(colorText);
  if (!parsed) return { color: null, offset: null };
  const offsetText = match[2];
  return {
    color: rgbaToCss(parsed),
    offset: offsetText === undefined ? null : clamp01(parseFloat(offsetText) / 100),
  };
}

/**
 * Distributes stop offsets the way CSS does: stops without an explicit offset
 * are spread evenly between the explicit stops that bracket them.
 */
export function distributeOffsets(stops: { offset: number | null }[]): number[] {
  const count = stops.length;
  if (count === 0) return [];
  if (count === 1) return [stops[0]?.offset ?? 0];

  const explicitIndexes = stops
    .map((stop, index) => (stop.offset === null ? -1 : index))
    .filter((index) => index >= 0);

  if (explicitIndexes.length === 0) {
    return stops.map((_, index) => index / (count - 1));
  }

  const out = new Array<number>(count).fill(0);

  for (let i = 0; i < count; i++) {
    const explicit = stops[i]?.offset;
    if (explicit !== null && explicit !== undefined) {
      out[i] = explicit;
      continue;
    }

    // Walk out to the explicit anchors bracketing this stop. A stop with no
    // offset sits somewhere between them, spaced evenly with its neighbours
    // in the same gap.
    let prevAnchor = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (stops[k]?.offset !== null && stops[k]?.offset !== undefined) {
        prevAnchor = k;
        break;
      }
    }
    let nextAnchor = count;
    for (let k = i + 1; k < count; k++) {
      if (stops[k]?.offset !== null && stops[k]?.offset !== undefined) {
        nextAnchor = k;
        break;
      }
    }

    const prevOffset = prevAnchor === -1 ? 0 : (stops[prevAnchor]?.offset ?? 0);
    const nextOffset = nextAnchor === count ? 1 : (stops[nextAnchor]?.offset ?? 1);
    const gapSize = nextAnchor - prevAnchor - 1;
    const step = i - prevAnchor;

    out[i] = prevOffset + ((nextOffset - prevOffset) * step) / (gapSize + 1);
  }

  return out;
}

/**
 * Parses a `linear-gradient(...)` string.
 *
 * Returns `null` for anything it does not understand, so the caller can fall
 * back to a solid color instead of painting a broken card.
 */
export function parseGradient(value: string): ParsedGradient | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;

  const match = raw.match(/^linear-gradient\s*\(([\s\S]*)\)$/i);
  if (!match) return null;

  const parts = splitTopLevel(match[1] ?? '');
  if (parts.length === 0) return null;

  let angle = 180;
  let start = 0;
  const head = (parts[0] ?? '').toLowerCase();

  const angleMatch = head.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (angleMatch) {
    angle = parseFloat(angleMatch[1] ?? '180');
    start = 1;
  } else if (head === 'to right') {
    angle = 90;
    start = 1;
  } else if (head === 'to left') {
    angle = 270;
    start = 1;
  } else if (head === 'to top') {
    angle = 0;
    start = 1;
  } else if (head === 'to bottom') {
    angle = 180;
    start = 1;
  }

  const stopParts = parts.slice(start);
  if (stopParts.length < 2) return null;

  const parsedStops: StopInput[] = [];
  for (const part of stopParts) {
    const stop = parseStop(part);
    if (!stop.color) return null;
    parsedStops.push(stop);
  }

  const offsets = distributeOffsets(parsedStops);

  return {
    kind: 'linear',
    angle,
    stops: parsedStops.map((stop, index) => ({
      offset: clamp01(offsets[index] ?? 0),
      color: stop.color as string,
    })),
  };
}

/**
 * Endpoints of the gradient line through a box, using the CSS angle
 * convention: 0deg points up, 90deg right, 180deg down.
 */
export function gradientLine(
  width: number,
  height: number,
  angleDeg: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
  };
}
