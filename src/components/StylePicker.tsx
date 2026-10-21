import { useMemo } from 'react';
import { parseGradient, rgbaToHex } from '../lib/gradient';
import {
  FONT_CHOICES,
  GRADIENT_PRESETS,
  STYLE_PRESETS,
  type StyleMetadata,
  type TextAlign,
} from '../lib/style';
import { StyleSuggester } from './StyleSuggester';

interface StylePickerProps {
  style: StyleMetadata;
  onChange: (style: StyleMetadata) => void;
  /** The quote, so the model has something to read. */
  text: string;
}

const ALIGNMENTS: { id: TextAlign; label: string; hint: string }[] = [
  { id: 'left', label: 'Left', hint: 'Align text to the left edge' },
  { id: 'center', label: 'Center', hint: 'Align text to the middle' },
  { id: 'right', label: 'Right', hint: 'Align text to the right edge' },
];

export function StylePicker({ style, onChange, text }: StylePickerProps) {
  const update = (patch: Partial<StyleMetadata>) => onChange({ ...style, ...patch });

  const gradient = useMemo(() => parseGradient(style.bg_value), [style.bg_value]);
  const startColor = gradient?.stops[0] ? rgbaToHex(parseRgba(gradient.stops[0].color)) : '#1e1e2f';
  const endColor = gradient?.stops[gradient.stops.length - 1]
    ? rgbaToHex(parseRgba(gradient.stops[gradient.stops.length - 1]!.color))
    : '#11111d';
  const angle = gradient?.angle ?? 135;

  const setGradient = (nextAngle: number, from: string, to: string) => {
    update({
      bg_type: 'gradient',
      bg_value: `linear-gradient(${Math.round(nextAngle)}deg, ${from}, ${to})`,
    });
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Style</h2>
      </header>

      <div className="field">
        <span className="field-label">Presets</span>
        <div className="preset-grid">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset"
              title={preset.name}
              onClick={() => update(preset.style)}
            >
              <span
                className="preset-swatch"
                style={
                  preset.style.bg_type === 'solid'
                    ? { background: preset.style.bg_value }
                    : { background: preset.style.bg_value }
                }
              />
              <span className="preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <StyleSuggester
        text={text}
        onApply={(preset) => update(preset.style)}
      />

      <div className="field row">
        <label className="field grow">
          <span className="field-label">Typeface</span>
          <select
            className="select"
            value={style.font_family}
            onChange={(event) => update({ font_family: event.target.value })}
          >
            {FONT_CHOICES.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>

        <div className="field grow">
          <span className="field-label">Alignment</span>
          <div className="segmented" role="group" aria-label="Text alignment">
            {ALIGNMENTS.map((alignment) => (
              <button
                key={alignment.id}
                type="button"
                className={style.text_align === alignment.id ? 'segment active' : 'segment'}
                title={alignment.hint}
                aria-pressed={style.text_align === alignment.id}
                onClick={() => update({ text_align: alignment.id })}
              >
                {alignment.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <label className="field">
        <span className="field-label">
          Largest size <span className="field-value">{style.font_size}px</span>
        </span>
        <input
          className="range"
          type="range"
          min={20}
          max={120}
          step={1}
          value={style.font_size}
          onChange={(event) => update({ font_size: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span className="field-label">
          Line height <span className="field-value">{style.line_height.toFixed(2)}</span>
        </span>
        <input
          className="range"
          type="range"
          min={1}
          max={2.4}
          step={0.05}
          value={style.line_height}
          onChange={(event) => update({ line_height: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span className="field-label">
          Margin <span className="field-value">{style.padding}px</span>
        </span>
        <input
          className="range"
          type="range"
          min={24}
          max={200}
          step={4}
          value={style.padding}
          onChange={(event) => update({ padding: Number(event.target.value) })}
        />
      </label>

      <div className="field">
        <span className="field-label">Background</span>
        <div className="segmented" role="group" aria-label="Background type">
          <button
            type="button"
            className={style.bg_type === 'gradient' ? 'segment active' : 'segment'}
            aria-pressed={style.bg_type === 'gradient'}
            onClick={() => update({ bg_type: 'gradient' })}
          >
            Gradient
          </button>
          <button
            type="button"
            className={style.bg_type === 'solid' ? 'segment active' : 'segment'}
            aria-pressed={style.bg_type === 'solid'}
            onClick={() => update({ bg_type: 'solid', bg_value: endColor })}
          >
            Solid
          </button>
        </div>
      </div>

      {style.bg_type === 'gradient' ? (
        <>
          <div className="field">
            <span className="field-label">Gradients</span>
            <div className="swatch-row">
              {GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="swatch"
                  title={preset.name}
                  style={{ background: preset.value }}
                  onClick={() => update({ bg_value: preset.value })}
                />
              ))}
            </div>
          </div>

          <div className="field row">
            <label className="field grow">
              <span className="field-label">From</span>
              <input
                className="color"
                type="color"
                value={startColor}
                onChange={(event) => setGradient(angle, event.target.value, endColor)}
              />
            </label>
            <label className="field grow">
              <span className="field-label">To</span>
              <input
                className="color"
                type="color"
                value={endColor}
                onChange={(event) => setGradient(angle, startColor, event.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">
              Angle <span className="field-value">{Math.round(angle)}deg</span>
            </span>
            <input
              className="range"
              type="range"
              min={0}
              max={360}
              step={5}
              value={Math.round(angle)}
              onChange={(event) => setGradient(Number(event.target.value), startColor, endColor)}
            />
          </label>
        </>
      ) : (
        <label className="field">
          <span className="field-label">Colour</span>
          <input
            className="color"
            type="color"
            value={endColor}
            onChange={(event) => update({ bg_value: event.target.value })}
          />
        </label>
      )}

      <label className="field">
        <span className="field-label">Text colour</span>
        <input
          className="color"
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(style.text_color) ? style.text_color : '#f2f2f7'}
          onChange={(event) => update({ text_color: event.target.value })}
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={style.show_attribution}
          onChange={(event) => update({ show_attribution: event.target.checked })}
        />
        <span>Show the attribution line</span>
      </label>
    </section>
  );
}

/** Turns a normalized `rgba(...)` string back into a colour object. */
function parseRgba(value: string): { r: number; g: number; b: number; a: number } {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  const parts = (match[1] ?? '').split(',').map((part) => Number(part.trim()));
  return {
    r: parts[0] ?? 0,
    g: parts[1] ?? 0,
    b: parts[2] ?? 0,
    a: parts[3] ?? 1,
  };
}
