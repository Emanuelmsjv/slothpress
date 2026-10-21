import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, normalizeStyle, resolveFontStack } from '../src/lib/style';

describe('normalizeStyle', () => {
  it('returns the defaults for junk input', () => {
    expect(normalizeStyle(undefined)).toEqual(DEFAULT_STYLE);
    expect(normalizeStyle('nope')).toEqual(DEFAULT_STYLE);
    expect(normalizeStyle(null)).toEqual(DEFAULT_STYLE);
  });

  it('keeps values it understands', () => {
    const style = normalizeStyle({
      font_family: 'mono',
      font_size: 64,
      text_align: 'right',
      bg_type: 'solid',
      bg_value: '#101010',
      text_color: '#ffffff',
    });
    expect(style.font_family).toBe('mono');
    expect(style.font_size).toBe(64);
    expect(style.text_align).toBe('right');
    expect(style.bg_type).toBe('solid');
  });

  it('replaces values it does not understand', () => {
    const style = normalizeStyle({ text_align: 'justify', bg_type: 'image', font_size: 'huge' });
    expect(style.text_align).toBe(DEFAULT_STYLE.text_align);
    expect(style.bg_type).toBe(DEFAULT_STYLE.bg_type);
    expect(style.font_size).toBe(DEFAULT_STYLE.font_size);
  });

  it('clamps numbers into a usable range', () => {
    expect(normalizeStyle({ font_size: 5000 }).font_size).toBe(200);
    expect(normalizeStyle({ font_size: -12 }).font_size).toBe(14);
    expect(normalizeStyle({ padding: 0 }).padding).toBe(24);
    expect(normalizeStyle({ line_height: 99 }).line_height).toBe(3);
  });

  it('accepts numeric strings', () => {
    expect(normalizeStyle({ font_size: '36' }).font_size).toBe(36);
  });
});

describe('resolveFontStack', () => {
  it('resolves the known stacks', () => {
    expect(resolveFontStack('serif')).toContain('Georgia');
    expect(resolveFontStack('SERIF')).toContain('Georgia');
    expect(resolveFontStack('mono')).toContain('monospace');
  });

  it('treats an unknown family as a literal name', () => {
    expect(resolveFontStack('Iowan Old Style')).toContain('"Iowan Old Style"');
  });

  it('cannot be used to break out of the canvas font shorthand', () => {
    const stack = resolveFontStack('evil; ctx.fillText("pwned", 0, 0); //');
    expect(stack).not.toContain(';');
    expect(stack).not.toContain('(');
  });

  it('falls back for empty input', () => {
    expect(resolveFontStack('')).toBeTruthy();
    expect(resolveFontStack('   ')).toBeTruthy();
  });
});
