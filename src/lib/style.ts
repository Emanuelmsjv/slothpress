/**
 * Style metadata: the small, stable contract that a card's look is stored as.
 *
 * The shape is snake_case on purpose. These values are written to Postgres as
 * JSONB, read back on another device, and should still mean the same thing in
 * a year. The renderer is the only thing that has to understand them.
 */

export type TextAlign = 'left' | 'center' | 'right';
export type BgType = 'gradient' | 'solid';

export interface StyleMetadata {
  /** Key of {@link FONT_STACKS}, or a literal font family name. */
  font_family: string;
  /** Upper bound on the rendered size. The renderer shrinks from here to fit. */
  font_size: number;
  text_align: TextAlign;
  bg_type: BgType;
  /** A CSS gradient string when `bg_type` is `gradient`, a CSS color when it is `solid`. */
  bg_value: string;
  text_color: string;
  /** Space between the text block and the card edge, in logical pixels. */
  padding: number;
  /** Multiplier applied to the font size to get the baseline-to-baseline distance. */
  line_height: number;
  /** Whether the `— author` line is drawn under the text. */
  show_attribution: boolean;
}

export const DEFAULT_STYLE: StyleMetadata = {
  font_family: 'serif',
  font_size: 48,
  text_align: 'center',
  bg_type: 'gradient',
  bg_value: 'linear-gradient(135deg, #1e1e2f, #11111d)',
  text_color: '#f2f2f7',
  padding: 96,
  line_height: 1.5,
  show_attribution: true,
};

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 200;

/**
 * Font stacks that always resolve to something on the machine running the
 * browser. A webfont would be nicer, but a card that renders in a different
 * shape on your friend's phone is a worse bug than a slightly less elegant
 * typeface.
 */
export const FONT_STACKS: Record<string, string> = {
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', Times, serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, 'SF Mono', 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
  humanist: "'Optima', 'Candara', 'Gill Sans', 'Gill Sans MT', 'Trebuchet MS', sans-serif",
  slab: "'Rockwell', 'Courier Bold', 'Roboto Slab', Georgia, serif",
  condensed: "'Oswald', 'Arial Narrow', 'Helvetica Neue Condensed', Impact, sans-serif",
};

export const FONT_CHOICES: { id: string; label: string }[] = [
  { id: 'serif', label: 'Serif' },
  { id: 'sans', label: 'Sans' },
  { id: 'mono', label: 'Mono' },
  { id: 'humanist', label: 'Humanist' },
  { id: 'slab', label: 'Slab' },
  { id: 'condensed', label: 'Condensed' },
];

export const FALLBACK_FONT = FONT_STACKS['sans'] ?? 'sans-serif';

/**
 * Turns a `font_family` value into a CSS font stack safe to paste into the
 * `ctx.font` shorthand. Unknown families are treated as a literal family name
 * with anything that could break out of the shorthand removed.
 */
export function resolveFontStack(family: string): string {
  const raw = typeof family === 'string' ? family : '';
  const known = FONT_STACKS[raw.trim().toLowerCase()];
  if (known) return known;

  const safe = raw.replace(/[^A-Za-z0-9 _-]/g, '').trim();
  if (!safe) return FALLBACK_FONT;
  return `"${safe}", ${FALLBACK_FONT}`;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Coerces anything (a Postgres JSONB blob, a partial patch, a hand-typed
 * object) into a complete, valid {@link StyleMetadata}. Unknown values fall
 * back to the defaults instead of throwing, because a card with an ugly
 * default is better than an editor that refuses to open.
 */
export function normalizeStyle(raw: unknown): StyleMetadata {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const fallback = DEFAULT_STYLE;

  const fontFamily = input['font_family'];
  const bgValue = input['bg_value'];
  const textColor = input['text_color'];

  return {
    font_family:
      typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily.trim() : fallback.font_family,
    font_size: Math.round(clampNumber(input['font_size'], fallback.font_size, MIN_FONT_SIZE, MAX_FONT_SIZE)),
    text_align: clampEnum(input['text_align'], ['left', 'center', 'right'], fallback.text_align),
    bg_type: clampEnum(input['bg_type'], ['gradient', 'solid'], fallback.bg_type),
    bg_value: typeof bgValue === 'string' && bgValue.trim() ? bgValue.trim() : fallback.bg_value,
    text_color: typeof textColor === 'string' && textColor.trim() ? textColor.trim() : fallback.text_color,
    padding: Math.round(clampNumber(input['padding'], fallback.padding, 24, 240)),
    line_height: clampNumber(input['line_height'], fallback.line_height, 1, 3),
    show_attribution:
      typeof input['show_attribution'] === 'boolean' ? input['show_attribution'] : fallback.show_attribution,
  };
}

export interface StylePreset {
  id: string;
  name: string;
  style: Partial<StyleMetadata>;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    style: {
      font_family: 'serif',
      text_color: '#f2f2f7',
      bg_type: 'gradient',
      bg_value: 'linear-gradient(135deg, #1e1e2f, #11111d)',
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    style: {
      font_family: 'serif',
      text_color: '#ffeede',
      bg_type: 'gradient',
      bg_value: 'linear-gradient(160deg, #42275a, #734b6d)',
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    style: {
      font_family: 'humanist',
      text_color: '#fff6e8',
      bg_type: 'gradient',
      bg_value: 'linear-gradient(135deg, #ff9a44, #fc6076)',
    },
  },
  {
    id: 'moss',
    name: 'Moss',
    style: {
      font_family: 'sans',
      text_color: '#f0f7f2',
      bg_type: 'gradient',
      bg_value: 'linear-gradient(160deg, #134e5e, #71b280)',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    style: {
      font_family: 'serif',
      text_color: '#1d1c1a',
      bg_type: 'solid',
      bg_value: '#f6f1e7',
    },
  },
  {
    id: 'ink',
    name: 'Ink',
    style: {
      font_family: 'mono',
      text_color: '#e8e8e8',
      bg_type: 'solid',
      bg_value: '#121212',
    },
  },
  {
    id: 'tide',
    name: 'Tide',
    style: {
      font_family: 'sans',
      text_color: '#eef6ff',
      bg_type: 'gradient',
      bg_value: 'linear-gradient(200deg, #0f2027, #2c5364)',
    },
  },
  {
    id: 'candy',
    name: 'Candy',
    style: {
      font_family: 'condensed',
      text_color: '#23123a',
      bg_type: 'gradient',
      bg_value: 'linear-gradient(120deg, #f6d365, #fda085)',
    },
  },
];

export const GRADIENT_PRESETS: { id: string; name: string; value: string }[] = [
  { id: 'diagonal', name: 'Diagonal', value: 'linear-gradient(135deg, #1e1e2f, #11111d)' },
  { id: 'top-down', name: 'Top down', value: 'linear-gradient(180deg, #2b5876, #4e4376)' },
  { id: 'sunset', name: 'Sunset', value: 'linear-gradient(160deg, #42275a, #734b6d)' },
  { id: 'ember', name: 'Ember', value: 'linear-gradient(135deg, #ff9a44, #fc6076)' },
  { id: 'moss', name: 'Moss', value: 'linear-gradient(160deg, #134e5e, #71b280)' },
  { id: 'tide', name: 'Tide', value: 'linear-gradient(200deg, #0f2027, #2c5364)' },
  { id: 'peach', name: 'Peach', value: 'linear-gradient(120deg, #f6d365, #fda085)' },
  { id: 'ink-fade', name: 'Ink fade', value: 'linear-gradient(90deg, #232526, #414345)' },
];
