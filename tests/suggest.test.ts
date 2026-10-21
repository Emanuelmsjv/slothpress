import { describe, expect, it } from 'vitest';
import {
  STYLE_HYPOTHESES,
  fallbackSuggestions,
  hypothesesFor,
  rankModelOutput,
} from '../src/lib/suggest';
import { STYLE_PRESETS } from '../src/lib/style';

describe('hypothesesFor', () => {
  it('pairs every preset with a hypothesis', () => {
    const hypotheses = hypothesesFor();
    expect(hypotheses).toHaveLength(STYLE_PRESETS.length);
    expect(hypotheses.map((entry) => entry.presetId)).toEqual(STYLE_PRESETS.map((preset) => preset.id));
  });

  it('gives a preset without a written hypothesis one derived from its name', () => {
    const hypotheses = hypothesesFor([
      { id: 'ember', name: 'Ember', style: {} },
      { id: 'newcomer', name: 'Newcomer', style: {} },
    ]);
    expect(hypotheses[0]?.hypothesis).toBe(
      STYLE_HYPOTHESES.find((entry) => entry.presetId === 'ember')?.hypothesis,
    );
    expect(hypotheses[1]?.hypothesis).toBe('newcomer');
  });

  it('uses one distinct hypothesis per preset', () => {
    const hypotheses = hypothesesFor();
    const texts = hypotheses.map((entry) => entry.hypothesis);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe('rankModelOutput', () => {
  const hypotheses = hypothesesFor();

  it('maps the labels back to presets and ranks them by score', () => {
    const output = {
      labels: [hypotheses[2]?.hypothesis ?? '', hypotheses[0]?.hypothesis ?? ''],
      scores: [0.7, 0.3],
    };
    const ranked = rankModelOutput(output, hypotheses);

    expect(ranked[0]?.presetId).toBe(STYLE_PRESETS[2]?.id);
    expect(ranked[0]?.score).toBeCloseTo(0.7, 5);
    expect(ranked[1]?.presetId).toBe(STYLE_PRESETS[0]?.id);
    expect(ranked[1]?.score).toBeCloseTo(0.3, 5);
  });

  it('keeps every preset in the ranking', () => {
    const output = { labels: [hypotheses[0]?.hypothesis ?? ''], scores: [1] };
    const ranked = rankModelOutput(output, hypotheses);

    expect(ranked).toHaveLength(hypotheses.length);
    expect(ranked.filter((entry) => entry.score > 0)).toHaveLength(1);
  });

  it('normalizes the scores so they sum to one', () => {
    const output = {
      labels: hypotheses.slice(0, 3).map((entry) => entry.hypothesis),
      scores: [2, 3, 5],
    };
    const ranked = rankModelOutput(output, hypotheses);

    const sum = ranked.reduce((total, entry) => total + entry.score, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('ignores labels that are not one of the hypotheses', () => {
    const output = {
      labels: ['something the model invented', hypotheses[0]?.hypothesis ?? ''],
      scores: [0.9, 0.5],
    };
    const ranked = rankModelOutput(output, hypotheses);

    expect(ranked[0]?.presetId).toBe(STYLE_PRESETS[0]?.id);
    expect(ranked[0]?.score).toBeCloseTo(1, 6);
  });

  it('does not divide by zero when the model scores nothing', () => {
    const output = { labels: [], scores: [] };
    const ranked = rankModelOutput(output, hypotheses);

    expect(ranked).toHaveLength(hypotheses.length);
    expect(ranked.every((entry) => entry.score === 0)).toBe(true);
  });

  it('drops negative and non-finite scores', () => {
    const output = {
      labels: [hypotheses[0]?.hypothesis ?? '', hypotheses[1]?.hypothesis ?? ''],
      scores: [-1, Number.NaN],
    };
    const ranked = rankModelOutput(output, hypotheses);

    expect(ranked.every((entry) => entry.score === 0)).toBe(true);
  });
});

describe('fallbackSuggestions', () => {
  it('puts the keyword match on top', () => {
    const ranked = fallbackSuggestions('the ocean was vast and deep');
    expect(ranked[0]?.presetId).toBe('tide');
    expect(ranked[0]?.score).toBeCloseTo(1, 6);
  });

  it('counts every hit and normalizes them', () => {
    // 'deep' is a tide word, 'dark' and 'night' are midnight words.
    const ranked = fallbackSuggestions('the deep dark night');
    const tide = ranked.find((entry) => entry.presetId === 'tide');
    const midnight = ranked.find((entry) => entry.presetId === 'midnight');

    expect(tide?.score).toBeCloseTo(1 / 3, 6);
    expect(midnight?.score).toBeCloseTo(2 / 3, 6);
    expect(ranked[0]?.presetId).toBe('midnight');
  });

  it('falls back to the default preset when nothing matches', () => {
    const ranked = fallbackSuggestions('zxqv wobble frimble');
    expect(ranked).toHaveLength(STYLE_HYPOTHESES.length);
    expect(ranked.every((entry) => entry.score === 0)).toBe(true);
    expect(ranked[0]?.presetId).toBe('midnight');
  });

  it('ignores case', () => {
    expect(fallbackSuggestions('THE OCEAN')[0]?.presetId).toBe('tide');
    expect(fallbackSuggestions('the ocean')[0]?.presetId).toBe('tide');
  });
});
