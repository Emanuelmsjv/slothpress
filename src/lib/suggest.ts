/**
 * Style suggestions, from an open-weight model that runs in the browser.
 *
 * The card itself never needs a model: the renderer is deterministic and the
 * presets are a static list. What the model adds is a guess. Paste a quote,
 * press the button, and a 25 MB MobileBERT checkpoint reads the mood of the
 * words and picks the preset that fits.
 *
 * Three rules this file keeps:
 *
 *  1. Nothing is downloaded until the button is pressed. The library and the
 *     weights are behind a dynamic import, so neither the bundle nor the
 *     network is touched until you ask for a suggestion.
 *  2. The model is optional. If it cannot be fetched or run, the reader still
 *     gets an answer, labelled honestly as a keyword guess rather than a
 *     model's opinion.
 *  3. The model's scores are shown, not just its conclusion. A suggestion you
 *     cannot check is a suggestion you cannot trust.
 */

import type { ProgressInfo } from '@huggingface/transformers';
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { STYLE_PRESETS, type StylePreset } from './style';

/**
 * A MobileBERT checkpoint fine-tuned for natural language inference, converted
 * to ONNX for transformers.js. 25.7 MB quantized.
 *
 * The architecture is `google/mobilebert-uncased` (Apache-2.0); the NLI
 * fine-tune is `typeform/mobilebert-uncased-mnli`, whose model card does not
 * declare a separate licence, so it inherits Apache-2.0. Say so out loud
 * rather than implying a licence the card does not carry.
 */
export const SUGGESTION_MODEL_ID = 'Xenova/mobilebert-uncased-mnli';

/** Download size of the quantized weights, in megabytes. */
export const SUGGESTION_MODEL_MB = 25.7;

/**
 * The NLI hypothesis template. transformers.js turns each candidate label into
 * a hypothesis by replacing `{}` with the label; the quote becomes the
 * premise. "This quote is {}." reads as a statement the quote could entail.
 */
export const SUGGESTION_HYPOTHESIS_TEMPLATE = 'This quote is {}.';

export interface StyleHypothesis {
  /** The preset this hypothesis argues for. */
  presetId: string;
  /** The label handed to the model. */
  hypothesis: string;
}

/**
 * One hypothesis per preset. The wording is the model's only view of what a
 * preset means, so each one describes the mood rather than the colour: the
 * model has never seen the swatches, and pretending otherwise would make the
 * feature a lie.
 *
 * The order matters. It is the order used to break ties, and `midnight` is
 * first because it is the default the card opens with.
 */
export const STYLE_HYPOTHESES: StyleHypothesis[] = [
  {
    presetId: 'midnight',
    hypothesis: 'calm, quiet and reflective, like a thought at midnight',
  },
  { presetId: 'dusk', hypothesis: 'wistful and a little sad, like a memory at sunset' },
  { presetId: 'ember', hypothesis: 'bold, fiery and full of energy' },
  { presetId: 'moss', hypothesis: 'natural, grounded and peaceful' },
  { presetId: 'paper', hypothesis: 'quiet, plain and understated, like a printed page' },
  { presetId: 'ink', hypothesis: 'stark, technical and to the point' },
  { presetId: 'tide', hypothesis: 'deep, vast and contemplative, like the sea' },
  { presetId: 'candy', hypothesis: 'playful, cheerful and lighthearted' },
];

export interface StyleSuggestion {
  presetId: string;
  /** Normalized probability between 0 and 1. The list sums to 1. */
  score: number;
}

export interface SuggestProgress {
  phase: 'loading' | 'downloading' | 'ready';
  /** The file being fetched, when there is one. */
  file?: string;
  loaded?: number;
  total?: number;
  /** Download completion as a whole percentage, when it can be computed. */
  percent?: number;
}

export interface SuggestOutcome {
  /** `model` when the checkpoint ran, `fallback` when the keyword guess ran. */
  source: 'model' | 'fallback';
  suggestions: StyleSuggestion[];
  /** Why the model could not be used, when it could not. */
  problem?: string;
}

/**
 * Pairs the presets with their hypotheses. A preset without a hand-written
 * hypothesis still gets one, built from its name, so adding a preset to the
 * list can never silently drop it out of the suggestions.
 */
export function hypothesesFor(presets: StylePreset[] = STYLE_PRESETS): StyleHypothesis[] {
  const known = new Map(STYLE_HYPOTHESES.map((entry) => [entry.presetId, entry.hypothesis]));
  return presets.map((preset) => ({
    presetId: preset.id,
    hypothesis: known.get(preset.id) ?? preset.name.toLowerCase(),
  }));
}

/**
 * Turns the pipeline's output into a ranked list of presets.
 *
 * The pipeline hands back labels sorted by likelihood with a score for each,
 * already normalized to sum to one across the labels it was given. Labels are
 * matched back to presets by their hypothesis text, because that is the only
 * handle both sides share.
 *
 * Every hypothesis comes back, even the ones the model gave no score for, so
 * the list is always a complete ranking of the presets.
 */
export function rankModelOutput(
  output: { labels: string[]; scores: number[] },
  hypotheses: StyleHypothesis[],
): StyleSuggestion[] {
  const presetByHypothesis = new Map(hypotheses.map((entry) => [entry.hypothesis, entry.presetId]));
  const scores = new Map<string, number>();
  let total = 0;

  output.labels.forEach((label, index) => {
    const presetId = presetByHypothesis.get(label);
    if (!presetId) return;
    const score = output.scores[index];
    if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return;
    scores.set(presetId, score);
    total += score;
  });

  const divisor = total > 0 ? total : 1;
  return hypotheses
    .map((entry) => ({ presetId: entry.presetId, score: (scores.get(entry.presetId) ?? 0) / divisor }))
    .sort((a, b) => b.score - a.score);
}

/**
 * The keyword guess used when the model cannot run. It is not the model and
 * does not pretend to be: the outcome says `fallback` and the panel says so.
 *
 * Each word counts for the preset it belongs to. Words that belong to two
 * presets count for both.
 */
const FALLBACK_KEYWORDS: { presetId: string; words: string[] }[] = [
  {
    presetId: 'ember',
    words: ['fire', 'burn', 'burning', 'flame', 'fight', 'shout', 'rage', 'angry', 'passion', 'fury'],
  },
  {
    presetId: 'candy',
    words: ['happy', 'joy', 'laugh', 'smile', 'play', 'fun', 'delight', 'sweet', 'silly', 'love'],
  },
  {
    presetId: 'dusk',
    words: ['sad', 'lonely', 'grief', 'cry', 'goodbye', 'miss', 'farewell', 'loss', 'memory', 'alone'],
  },
  {
    presetId: 'midnight',
    words: ['night', 'dark', 'sleep', 'quiet', 'still', 'think', 'wonder', 'dream', 'silence', 'moon'],
  },
  {
    presetId: 'tide',
    words: ['sea', 'ocean', 'water', 'deep', 'wave', 'shore', 'river', 'tide', 'vast', 'horizon'],
  },
  {
    presetId: 'moss',
    words: ['grow', 'green', 'forest', 'tree', 'bloom', 'garden', 'root', 'spring', 'nature', 'seed'],
  },
  {
    presetId: 'ink',
    words: ['code', 'function', 'null', 'error', 'bug', 'build', 'ship', 'stack', 'compile', 'commit'],
  },
  {
    presetId: 'paper',
    words: ['book', 'letter', 'page', 'paper', 'write', 'prose', 'novel', 'poem', 'script', 'printed'],
  },
];

/**
 * Counts the keywords in the text and ranks the presets by how many they hit.
 * A text with no keyword hits gets a flat list, which resolves to `midnight`.
 */
export function fallbackSuggestions(text: string): StyleSuggestion[] {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  const counts = new Map<string, number>();

  for (const word of words) {
    for (const entry of FALLBACK_KEYWORDS) {
      if (entry.words.includes(word)) {
        counts.set(entry.presetId, (counts.get(entry.presetId) ?? 0) + 1);
      }
    }
  }

  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const divisor = total > 0 ? total : 1;

  return STYLE_HYPOTHESES.map((entry) => ({
    presetId: entry.presetId,
    score: (counts.get(entry.presetId) ?? 0) / divisor,
  })).sort((a, b) => b.score - a.score);
}

type ModelApi = typeof import('@huggingface/transformers');

/**
 * The pipeline is cached for the life of the page. The second press of the
 * button reuses the loaded session instead of fetching 25 MB again, and the
 * browser's own cache keeps the weights across reloads.
 */
let modelPromise: Promise<ModelApi> | null = null;

function loadModel(onProgress?: (progress: SuggestProgress) => void): Promise<ModelApi> {
  if (!modelPromise) {
    modelPromise = import('@huggingface/transformers')
      .then((mod) => {
        // The weights live on huggingface.co. Nothing is ever uploaded.
        mod.env.allowLocalModels = false;
        mod.env.useBrowserCache = true;

        // ONNX Runtime would otherwise pull its WebAssembly runtime from a
        // CDN. Serving it from the app's own origin keeps the only third
        // party in the loop the model itself.
        const wasm = mod.env.backends.onnx.wasm;
        if (wasm) {
          wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
        }

        onProgress?.({ phase: 'loading' });
        return mod;
      })
      .catch((error: unknown) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}

/**
 * Reads the text and ranks the presets.
 *
 * Never throws: if the model is unavailable the result comes back as a
 * fallback ranking with the reason attached, because a card that cannot be
 * styled is worse than a card styled by keyword.
 */
export async function suggestStyles(
  text: string,
  onProgress?: (progress: SuggestProgress) => void,
): Promise<SuggestOutcome> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { source: 'fallback', suggestions: [], problem: 'There is no text to read yet.' };
  }

  const hypotheses = hypothesesFor();

  try {
    const { pipeline } = await loadModel(onProgress);
    const classifier = await pipeline('zero-shot-classification', SUGGESTION_MODEL_ID, {
      progress_callback: (info: ProgressInfo) => {
        const loaded = 'loaded' in info ? info.loaded : undefined;
        const total = 'total' in info ? info.total : undefined;
        onProgress?.({
          phase: info.status === 'progress' ? 'downloading' : info.status === 'ready' ? 'ready' : 'loading',
          file: 'file' in info ? info.file : undefined,
          loaded,
          total,
          percent: loaded !== undefined && total ? Math.round((loaded / total) * 100) : undefined,
        });
      },
    });

    const output = await classifier(
      trimmed,
      hypotheses.map((entry) => entry.hypothesis),
      { hypothesis_template: SUGGESTION_HYPOTHESIS_TEMPLATE },
    );

    const result = Array.isArray(output) ? output[0] : output;
    if (!result) {
      return {
        source: 'fallback',
        suggestions: fallbackSuggestions(trimmed),
        problem: 'The model returned nothing.',
      };
    }

    onProgress?.({ phase: 'ready' });
    return { source: 'model', suggestions: rankModelOutput(result, hypotheses) };
  } catch (error) {
    return {
      source: 'fallback',
      suggestions: fallbackSuggestions(trimmed),
      problem: error instanceof Error ? error.message : String(error),
    };
  }
}
