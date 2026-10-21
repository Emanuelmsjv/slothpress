import { describe, expect, it } from 'vitest';
import {
  distributeOffsets,
  gradientLine,
  parseColor,
  parseGradient,
  rgbaToCss,
  splitTopLevel,
} from '../src/lib/gradient';

describe('parseColor', () => {
  it('reads short and long hex', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#1e1e2f')).toEqual({ r: 30, g: 30, b: 47, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(128 / 255, 5);
  });

  it('reads rgb and rgba', () => {
    expect(parseColor('rgb(12, 34, 56)')).toEqual({ r: 12, g: 34, b: 56, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('reads named colors', () => {
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('transparent')?.a).toBe(0);
  });

  it('rejects garbage instead of guessing', () => {
    expect(parseColor('not-a-color')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('')).toBeNull();
  });

  it('round-trips through rgba()', () => {
    expect(rgbaToCss({ r: 1, g: 2, b: 3, a: 0.5 })).toBe('rgba(1, 2, 3, 0.5)');
  });
});

describe('splitTopLevel', () => {
  it('does not split inside parentheses', () => {
    expect(splitTopLevel('rgba(0, 0, 0, 0.5), #fff')).toEqual(['rgba(0, 0, 0, 0.5)', '#fff']);
  });
});

describe('parseGradient', () => {
  it('reads the angle and every stop', () => {
    const gradient = parseGradient('linear-gradient(135deg, #1e1e2f, #11111d)');
    expect(gradient).not.toBeNull();
    expect(gradient?.angle).toBe(135);
    expect(gradient?.stops).toEqual([
      { offset: 0, color: 'rgba(30, 30, 47, 1)' },
      { offset: 1, color: 'rgba(17, 17, 29, 1)' },
    ]);
  });

  it('defaults to top-to-bottom', () => {
    expect(parseGradient('linear-gradient(#000, #fff)')?.angle).toBe(180);
  });

  it('understands the to-direction keywords', () => {
    expect(parseGradient('linear-gradient(to right, #000, #fff)')?.angle).toBe(90);
    expect(parseGradient('linear-gradient(to top, #000, #fff)')?.angle).toBe(0);
    expect(parseGradient('linear-gradient(to left, #000, #fff)')?.angle).toBe(270);
  });

  it('keeps explicit stop offsets', () => {
    const gradient = parseGradient('linear-gradient(90deg, #000 0%, #fff 100%)');
    expect(gradient?.stops.map((s) => s.offset)).toEqual([0, 1]);
  });

  it('handles three stops by spreading the middle one', () => {
    const gradient = parseGradient('linear-gradient(90deg, #000, #888, #fff)');
    expect(gradient?.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
  });

  it('handles rgba stops without being fooled by the commas', () => {
    const gradient = parseGradient('linear-gradient(90deg, rgba(0,0,0,0.2), rgba(255,255,255,0.8))');
    expect(gradient?.stops).toHaveLength(2);
    expect(gradient?.stops[0]?.color).toBe('rgba(0, 0, 0, 0.2)');
  });

  it('returns null for anything it cannot render', () => {
    expect(parseGradient('nonsense')).toBeNull();
    expect(parseGradient('linear-gradient(#000)')).toBeNull();
    expect(parseGradient('radial-gradient(#000, #fff)')).toBeNull();
    expect(parseGradient('')).toBeNull();
  });
});

describe('distributeOffsets', () => {
  it('spreads stops evenly when none declare one', () => {
    expect(distributeOffsets([{ offset: null }, { offset: null }, { offset: null }])).toEqual([0, 0.5, 1]);
  });

  it('interpolates inside a gap between explicit anchors', () => {
    const offsets = distributeOffsets([
      { offset: 0 },
      { offset: null },
      { offset: null },
      { offset: 1 },
    ]);
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeCloseTo(1 / 3, 6);
    expect(offsets[2]).toBeCloseTo(2 / 3, 6);
    expect(offsets[3]).toBe(1);
  });

  it('places stops before the first anchor', () => {
    const offsets = distributeOffsets([{ offset: null }, { offset: null }, { offset: 0.5 }]);
    expect(offsets[0]).toBeCloseTo(1 / 6, 6);
    expect(offsets[1]).toBeCloseTo(1 / 3, 6);
    expect(offsets[2]).toBe(0.5);
  });
});

describe('gradientLine', () => {
  it('points down at 180 degrees', () => {
    const line = gradientLine(1080, 1350, 180);
    expect(line.x0).toBeCloseTo(540, 6);
    expect(line.x1).toBeCloseTo(540, 6);
    expect(line.y0).toBeCloseTo(0, 6);
    expect(line.y1).toBeCloseTo(1350, 6);
  });

  it('points up at 0 degrees', () => {
    const line = gradientLine(1080, 1350, 0);
    expect(line.y0).toBeCloseTo(1350, 6);
    expect(line.y1).toBeCloseTo(0, 6);
  });

  it('points right at 90 degrees', () => {
    const line = gradientLine(1080, 1350, 90);
    expect(line.x0).toBeCloseTo(0, 6);
    expect(line.x1).toBeCloseTo(1080, 6);
    expect(line.y0).toBeCloseTo(line.y1, 6);
  });

  it('uses the CSS gradient line length, so it reaches past the corner on a box that is not square', () => {
    const line = gradientLine(1080, 1350, 135);
    const expectedLength =
      Math.abs(1080 * Math.sin(Math.PI / 4)) + Math.abs(1350 * Math.cos(Math.PI / 4));
    expect(Math.hypot(line.x1 - line.x0, line.y1 - line.y0)).toBeCloseTo(expectedLength, 4);
    expect(line.x0).toBeLessThan(0);
    expect(line.y1).toBeLessThan(1350);
  });
});
