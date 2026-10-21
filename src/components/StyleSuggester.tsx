import { useCallback, useEffect, useState } from 'react';
import {
  SUGGESTION_MODEL_MB,
  suggestStyles,
  type SuggestOutcome,
  type SuggestProgress,
} from '../lib/suggest';
import { STYLE_PRESETS, type StylePreset } from '../lib/style';

interface StyleSuggesterProps {
  /** The quote the model reads. */
  text: string;
  /** Called with the preset the reader picked. */
  onApply: (preset: StylePreset) => void;
}

function presetFor(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((preset) => preset.id === id);
}

/**
 * The opt-in suggestion panel.
 *
 * Pressing the button is the only thing that downloads anything. Until then
 * the card works exactly as it did before, and the reader is told up front
 * what pressing it will cost: 25 MB, once, cached by the browser afterwards.
 */
export function StyleSuggester({ text, onApply }: StyleSuggesterProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SuggestProgress | null>(null);
  const [outcome, setOutcome] = useState<SuggestOutcome | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  // A suggestion about one quote says nothing about the next one.
  useEffect(() => {
    setOutcome(null);
    setAppliedId(null);
  }, [text]);

  const apply = useCallback(
    (presetId: string) => {
      const preset = presetFor(presetId);
      if (!preset) return;
      onApply(preset);
      setAppliedId(preset.id);
    },
    [onApply],
  );

  const run = useCallback(async () => {
    setBusy(true);
    setProgress({ phase: 'loading' });
    setOutcome(null);

    const result = await suggestStyles(text, setProgress);

    setOutcome(result);
    setBusy(false);

    const top = result.suggestions[0];
    if (top) apply(top.presetId);
  }, [apply, text]);

  const hasText = text.trim().length > 0;
  const suggestions = outcome?.suggestions ?? [];

  return (
    <div className="field">
      <span className="field-label">Suggest a style</span>

      <div className="suggest-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            void run();
          }}
          disabled={busy || !hasText}
          title={
            hasText
              ? `Runs a ${SUGGESTION_MODEL_MB} MB open-weight model in this browser`
              : 'Write something first'
          }
        >
          {busy ? 'Reading…' : 'Suggest a style'}
        </button>
        <p className="suggest-note">
          {busy
            ? progressText(progress)
            : `Runs a ${SUGGESTION_MODEL_MB} MB open-weight model in your browser. Nothing is uploaded.`}
        </p>
      </div>

      {busy && progress?.phase === 'downloading' && progress.percent !== undefined ? (
        <div
          className="suggest-progress"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${progress.percent}%` }} />
        </div>
      ) : null}

      {outcome && outcome.source === 'fallback' ? (
        <p className="suggest-warning">
          The model could not be loaded{outcome.problem ? ` (${outcome.problem})` : ''}. These are keyword
          matches, not the model's opinion.
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <ul className="suggest-list">
          {suggestions.map((suggestion) => {
            const preset = presetFor(suggestion.presetId);
            if (!preset) return null;
            const percent = Math.round(suggestion.score * 100);
            return (
              <li key={suggestion.presetId}>
                <button
                  type="button"
                  className={appliedId === preset.id ? 'suggest-row applied' : 'suggest-row'}
                  onClick={() => apply(preset.id)}
                  title={`Apply ${preset.name}`}
                >
                  <span className="suggest-name">{preset.name}</span>
                  <span className="suggest-bar">
                    <span style={{ width: `${percent}%` }} />
                  </span>
                  <span className="suggest-score">{percent}%</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function progressText(progress: SuggestProgress | null): string {
  if (!progress) return 'Working…';
  if (progress.phase === 'ready') return 'Reading the quote…';
  if (progress.phase === 'downloading') {
    const percent = progress.percent !== undefined ? ` ${progress.percent}%` : '';
    return `Downloading the model…${percent}`;
  }
  return 'Loading the model…';
}
