# Slothpress architecture

The whole app is one idea, stated once:

> A card is a deterministic function of the text and the style.

```
card = render(content, author, style)
```

Everything below is a consequence of taking that seriously.

## Layers

```
┌──────────────────────────────────────────────┐
│ components/     Editor, StylePicker,          │
│                 StyleSuggester,               │
│                 CardPreview, ExportBar        │
├──────────────────────────────────────────────┤
│ App             state, autosave, layout       │
├──────────────────────────────────────────────┤
│ lib/            style, gradient, layout,       │
│                 render, export, storage,       │
│                 suggest                       │
└──────────────────────────────────────────────┘
```

`lib/` never imports from `components/`, and `lib/layout.ts` never touches the
DOM. The only place a canvas appears is `lib/render.ts`, and the only place
the browser's storage appears is `lib/storage.ts`.

That split is what makes the engine testable. `layout.ts` takes a `measure`
callback:

```ts
export type Measure = (text: string, fontSize: number) => number;
```

The renderer passes in a function that calls `ctx.measureText`. The tests pass
in a function that pretends every character is half an em wide. Same code, no
browser, no canvas, no headless runner.

## The card

The card is 1080 x 1350 logical pixels, a 4:5 shape that survives being
cropped by every feed that exists.

```
┌────────────────────────────────┐
│  margin                        │
│   ┌──────────────────────────┐ │
│   │                          │ │
│   │      text block          │ │
│   │      (auto-fitted)       │ │
│   │                          │ │
│   │        — author          │ │
│   └──────────────────────────┘ │
└────────────────────────────────┘
```

The backing store is a separate concern. `renderCard(canvas, data, scale)`
sets `canvas.width = 1080 * scale` and scales the context, but every number in
the layout stays logical. The preview uses scale 1, the export uses scale 2
for a 2160 x 2700 image, and the layout is identical in both.

The original design multiplied the canvas size by `devicePixelRatio`. On a 3x
phone that is a 2160 x 2700 backing store for a preview about 400 CSS pixels
wide. It works, but it is 23 MB of canvas to draw something the user sees at
a third of the size. The scale is now chosen by the caller, for a reason.

### Fitting

`font_size` in the style is the **largest** size the text may use, not the
size it always uses. The renderer:

1. Wraps the text at that size and measures the block.
2. If the block fits, it is done.
3. If not, binary-searches for the largest size that does fit.

Height is monotonically non-increasing as the font shrinks, so a binary search
over the size range is valid and takes about six wraps instead of fifty-eight.
`bench/render-bench.mjs` puts the worst case in the corpus: 400 words fit in
5.4ms at p95.

If the text still does not fit at the minimum size, the card says so instead
of quietly truncating it. `overflow` comes back from the renderer, and the UI
shows a warning. A card that quietly drops half your poem is worse than a
card that admits it cannot hold the poem.

### Hard breaks

A word wider than the line is split, not allowed to bleed off the edge. The
characters are all still there, just on the next line. This matters for URLs,
which is what actually gets pasted into a quote card.

### Blank lines

A newline in the source is a newline on the card. A stanza is a stanza. The
text is wrapped paragraph by paragraph, and empty paragraphs stay empty.

## The style contract

```ts
interface StyleMetadata {
  font_family: string;
  font_size: number;
  text_align: 'left' | 'center' | 'right';
  bg_type: 'gradient' | 'solid';
  bg_value: string;
  text_color: string;
  padding: number;
  line_height: number;
  show_attribution: boolean;
}
```

Snake_case, because this object goes into Postgres as JSONB and comes back out
on a different device. It is a wire format, and it should still mean the same
thing in a year.

`normalizeStyle` is the only thing that reads untrusted style data. It clamps
numbers into a usable range, replaces values it does not recognise, and
never throws. A card with an ugly default is better than an editor that
refuses to open.

`resolveFontStack` maps a family name to a CSS stack. An unknown family is
treated as a literal name, with anything that could break out of the canvas
font shorthand removed:

```ts
resolveFontStack('evil; ctx.fillText("pwned", 0, 0); //')
// -> '"evil ctxfillTextpwned 0 0", system-ui, ...'
```

## Gradients

`bg_value` is a CSS gradient string, because that is readable, copyable and
portable. `ctx.fillStyle` will not accept one, so `lib/gradient.ts` parses it:
the angle, the stops, the offsets.

The angle follows the CSS convention, where 0deg points up and 180deg points
down, and the gradient line through a non-square box uses the CSS length
formula:

```
length = |width * sin(a)| + |height * cos(a)|
```

Stops without an explicit offset are spread evenly between the ones that have
one, the way CSS does it. A gradient that cannot be parsed falls back to a
solid colour rather than a half-painted card.

The original renderer hard-coded its stops and ignored the string entirely,
which is why every card came out the same colour no matter what you picked.

## Export

`canvas.toBlob` silently falls back to PNG when the requested type is not
supported. A "JPEG export" that quietly hands back a PNG is a bug you find
after it has been posted somewhere. So `export.ts` reads `blob.type` and
throws a specific error when it does not match what was asked for.

The share path uses `navigator.share` with a `File`, and checks
`navigator.canShare` first, because the API exists in more browsers than it
works in.

## Offline

`public/sw.js` caches the shell. Navigations are network-first, so a
deployed update is picked up on the next load and a missing network falls back
to the cached shell. Hashed build assets are cache-first, because their
filename changes when their contents do.

Offline is not a nice-to-have here. The claim "no upload, no server" is only
true if the thing keeps working when the network is gone.

## The optional model

`lib/suggest.ts` is the one part of the app that is allowed to be wrong.

The renderer never sees a model. The model never sees the rendered card. They
meet in exactly one place: `suggest.ts` returns a ranked list of style
presets, and `StyleSuggester` applies one of them.

The model is `Xenova/mobilebert-uncased-mnli`, a MobileBERT checkpoint
fine-tuned for natural language inference, run through
`transformers.js`'s `zero-shot-classification` pipeline. NLI gives you a
scorer for free: for each candidate label you phrase a hypothesis, and the
model tells you how well the quote entails it.

```
quote      → premise
"This quote is deep, vast and contemplative, like the sea."  → hypothesis
```

Each of the eight presets gets one hypothesis, written by hand, describing the
mood of that preset. The entailment score for each hypothesis becomes the
score for that preset, and the scores are normalised to sum to one.

That is the whole technique. It is also why the model is bad at it: a
25-million-parameter model with a strong prior over its label set will rank
certain moods above their evidence. On *"The sea was vast and deep that
night."* it put Ink ("stark, technical and to the point") first and Tide
third. The scores are shown in the UI for exactly this reason, and the top
pick is one click from being replaced.

### Three things that had to be true

**Nothing downloads until it is asked for.** `@huggingface/transformers` is
behind a dynamic `import()`, so it is a separate chunk that the browser only
fetches when the button is pressed. The app's own bundle stays at 80 KB
gzipped.

**The runtime comes from this origin.** transformers.js defaults to pulling
the ONNX Runtime Web build from jsDelivr, which would make the app depend on
a third party at runtime for no reason. The `.wasm` and its `.mjs` loader are
imported as URLs and handed to `env.backends.onnx.wasm.wasmPaths`, so they are
served from the same place as the rest of the app:

```ts
import ortMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';

env.backends.onnx.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
```

**There is a fallback that admits what it is.** If the model cannot load — no
network, blocked WebAssembly, a browser without SIMD — `suggest.ts` falls back
to counting keywords, and the UI says the result came from keywords rather
than from the model. A silent fallback would be a lie about what happened.

### What it costs

Measured against a logging server in headless Edge, not estimated:

| | |
| --- | --- |
| App shell, first load | 80 KB gzipped |
| transformers.js chunk | 160 KB gzipped |
| ONNX Runtime Web | 6.5 MB gzipped |
| Model weights | 25.7 MB |
| Tokenizer | 190 KB |
| Ready in | 13.6 s |

The first press on the button therefore costs about **32 MB**. After that the
browser caches both the runtime and the weights, and the feature works with
the network off. The quote is never uploaded; it is read by the model in the
browser and goes nowhere else.

## The server half

The app does not need a server. Sharing a card between devices does, and
`db/schema.sql` is what would back that.

```
auth.users ──trigger──> profiles
                          │
                          ├──< cards ──< card_comments
                          │      │
                          │      └──< card_interactions
                          │
                          └── triggers keep like_count and comment_count honest
```

### Why the counters are triggers

`like_count` on a card is a number the client could get wrong in about four
different ways. If a trigger maintains it from the rows it counts, it cannot
drift: insert a like, the counter goes up by one, in the same transaction. If
the like is deleted, it goes back down.

### Why RLS is spelled out

Every table has row level security, and every policy is written out rather
than assumed:

- Read policies use `USING`. Write policies use `USING` **and** `WITH CHECK`.
  A policy with only `USING` lets a row be updated into a state the policy
  would have refused to create.
- `(select auth.uid())` instead of `auth.uid()`. The bare form is re-evaluated
  for every row, which turns a feed query into a per-row function call.
- No policy references its own table. That is the 42P17 seam: a policy on
  `cards` that looks up `cards` makes Postgres decide the policy depends on
  itself, and the query fails at runtime. Cross-table lookups go through
  `security definer` functions in a `private` schema that is not exposed over
  the API.
- Every `security definer` function pins `search_path` to empty. A function
  that builds a query as text is otherwise hijackable by anyone who can create
  objects in the search path.

`db/rls-audit.sql` checks all of that and names what is wrong. It changes
nothing.

`db/rls-scenarios.sql` checks what the policies actually do: it puts a public
card, a private card and somebody else's card in the database, then tries to
read and write them as `anon` and as a signed-in stranger, and expects every
attempt to fail.

### Keyset pagination

The feed index is `(created_at desc, id desc)`, not `(created_at desc)`. With
`created_at` alone, two cards created in the same transaction can be skipped
or returned twice at a page boundary. The id is the tiebreaker, and
`list_public_cards` takes both as a cursor.

## Decisions

**No model in the render path.** A quote card does not need one. With one, you
have a latency budget, an API key, a bill and a way for the same input to
produce a different output. The whole value of this project is that the
output is a function of the input.

The model is allowed to choose which style to hand to the renderer. That is a
different job from drawing the card, and keeping them apart is what lets the
app offer the model without giving up the property that made it worth
building. If the model is wrong, the card is still deterministic; you just
pick a different preset.

**No accounts.** The first version has no way to be logged out of. Sharing is
a Postgres row and an RLS policy away; it does not need an identity system to
be designed well.

**Gradients and solids only.** Photo backgrounds would mean decoding and
scaling an image in the browser before every export. The two options cover
most quote cards and render in a fraction of the time.

**Fonts are system stacks.** A webfont would be nicer and would also change
the layout on a device that has not seen it yet, which would make the card
depend on a network. A card that renders differently on your friend's phone is
a worse bug than a slightly less elegant typeface.

## What is next

- A "trim to fit" action that tells you exactly how many characters it had to
  drop, instead of only warning that it overflows.
- More presets, and a way to save your own.
- Sharing cards between devices, which is the whole reason the schema exists.
- A deterministic golden-image test: render a fixed card at a fixed size and
  compare it to a checked-in PNG, so a change in the layout engine cannot
  land unnoticed.
