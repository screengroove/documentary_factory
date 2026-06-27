# Multiple stills per segment — design

**Date:** 2026-06-27
**Branch:** `feat/multi-image-per-segment`
**Status:** Approved (design); pending implementation plan

## Problem

Today each segment maps to exactly one still image, which gets a single Ken Burns
move across the whole narration beat. We want a segment to show a **sequence of
stills** during its narration — a short slideshow within one audio clip.

## Core invariant

A segment still owns **one narration beat = one audio clip + one caption track**.
Stills are a purely *visual* subdivision underneath that. `Segment.tsx` keeps
rendering `<Audio>` and `<Captions words={seg.words}>` exactly once over the full
segment duration. We never split `audio.durationSec` or the word timings — only
the image track is subdivided. If we ever find ourselves fragmenting words across
stills, that is out of scope.

## Decisions (locked)

1. **Still count** — the shotlist LLM decides per segment, content-driven (1–4).
2. **Timing** — LLM-weighted: each still gets a relative duration weight; the
   segment duration is divided proportionally.
3. **Transitions** — crossfade between consecutive stills within a segment.
4. **Ken Burns** — per still (each still gets its own move; a single move cut
   mid-motion looks broken).
5. **Regen granularity** — per still in the images review gate.
6. **Backward compat** — auto-migrate the old single-image shape on load.

## Data model (`packages/core/src/manifest.ts`)

Replace the per-segment `shot` + `image` with a `stills` array. Each still bundles
its prompt, motion, weight, and (optionally) its generated image:

```ts
const StillSchema = z.object({
  imagePrompt: z.string(),
  kenBurns: z.object({ from: RectSchema, to: RectSchema }),
  weight: z.number().positive(),            // relative duration weight
  image: z.object({
    path: z.string(),
    seed: z.number().int(),
    provider: z.string(),
    approved: z.boolean(),
    needsRegen: z.boolean().optional(),     // set by rejectImage; triggers single-still regen
  }).optional(),
});

const SegmentSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  narration: z.string(),
  stills: z.array(StillSchema).optional(),  // replaces shot + image
  audio: z.object({ path, durationSec, words }).optional(),
});
```

- Single-image is simply `stills.length === 1`.
- `shot` and `image` fields are removed from `SegmentSchema`.
- `version` stays `1` (migration is shape-based, not version-gated).

### Auto-migration on load

`loadManifest` runs a shape migration on the parsed JSON **before**
`ManifestSchema.parse`. For any segment that has the old `shot`/`image` fields and
no `stills`:

```ts
seg.stills = [{
  imagePrompt: seg.shot.imagePrompt,
  kenBurns: seg.shot.kenBurns,
  weight: 1,
  image: seg.image,          // may be undefined if images stage not yet run
}];
delete seg.shot; delete seg.image;
```

Implemented as a small pure `migrate(raw: unknown): unknown` helper applied inside
`loadManifest`. Old projects keep working with no data loss.

## Stages

### shotlist (`stages/shotlist.ts`)

The LLM returns an array of stills per segment instead of one shot:

```ts
const ShotOutput = z.object({
  stills: z.array(z.object({
    imagePrompt: z.string(),
    kenBurns: z.object({ from: RectSchema, to: RectSchema }).optional(),
    weight: z.number().positive().optional(),
  })).min(1),
});
```

- System prompt: "Break this narration beat into a sequence of 1–4 documentary
  stills that visually progress through the beat. For each, give one vivid concrete
  image, a subtle Ken Burns move (two normalized crop rects x,y,w,h in 0..1), and a
  relative duration weight (1–3) for how long it should hold." Soft-cap the count in
  the prompt; no hard cap in code (beats are seconds long, so D >> N in practice).
- For each returned still: append `m.brief.imageStyle` to `imagePrompt`; default
  `kenBurns` to `DEFAULT_KEN_BURNS` when omitted; default `weight` to `1` when
  omitted.
- Persist per segment (set `seg.stills`), same `awaiting_review` flow as today.

### images (`stages/images.ts`)

Iterate each segment's stills:

- Skip stills with `image && !image.needsRegen`.
- Seed folds in the still index so each still differs:
  `seed = still.image?.seed ?? deterministicSeed(`${seg.id}:${i}`)`.
- Asset path / filename indexed by still: `assets/images/${seg.id}-${i}.png`.
- Generate, download, write, set `still.image = { path, seed, provider, approved: false }`.
- Save per-still (persist incrementally as today).

### voiceover (`stages/voiceover.ts`)

Unchanged — audio is per segment.

### assemble / `buildInputProps` (`stages/assemble.ts`)

For each segment compute the total frame budget and distribute across stills by
weight, with the **last still absorbing the rounding remainder** so per-still
frames sum to exactly the segment total:

```ts
const D = Math.max(1, Math.round(s.audio.durationSec * FPS));
const totalWeight = stills.reduce((n, st) => n + st.weight, 0);
let acc = 0;
const frames = stills.map((st, i) => {
  if (i === stills.length - 1) return D - acc;          // remainder → exact sum
  const f = Math.max(1, Math.round(D * st.weight / totalWeight));
  acc += f;
  return f;
});
```

Guarantees: each still ≥ 1 frame; `sum(frames) === D` exactly. (Assumes
`D >= stills.length`, which holds because narration beats are seconds long and N is
soft-capped small. A defensive clamp keeps the last still ≥ 1.)

## Render (`packages/render`)

### `DocumentaryProps` (defined in `stages/assemble.ts`)

```ts
segments: Array<{
  id: string;
  durationInFrames: number;               // segment total (sum of stills)
  words: Word[];
  stills: Array<{
    imagePath: string;
    durationInFrames: number;
    kenBurns: { from: Rect; to: Rect };
  }>;
}>;
```

### `Documentary.tsx`

Unchanged in structure: one outer `Sequence` per segment using the segment total
`durationInFrames`, one `<Audio>` per segment. Segment-to-segment transitions stay
hard cuts.

### `Segment.tsx`

Render layered stills over a black `AbsoluteFill`:

- Walk stills accumulating a local start frame per still; each still's window is
  `[start_i, start_i + d_i)`.
- **Ken Burns** per still: `t = clamp((frame - start_i) / d_i, 0, 1)`, same crop-rect
  → transform math as today, scoped to the still's own window.
- **Crossfade**: the incoming still fades in `opacity 0→1` over
  `X = min(CROSSFADE_FRAMES, d_i)` at its window start, painted *on top* of the
  previous still. The previous still stays full opacity underneath and is covered
  once the incoming reaches opacity 1 — this is the crossfade (no explicit fade-out,
  which would otherwise reveal the black background). The **first still** in a
  segment starts at opacity 1 (no fade-in) so the segment boundary stays a hard cut.
- `CROSSFADE_FRAMES ≈ 15` (~0.5s at 30fps), a render-side constant, clamped per
  boundary.
- `<Audio>` and `<Captions words={seg.words}>` render once over the full segment.

## Web UI / edits

### `packages/web/src/lib/edits.ts`

- `approveStage('images')` — walk every still in every segment: set
  `image.approved = true`, delete `image.needsRegen`.
- `editPrompt(dir, id, stillIndex, prompt)` — edit `stills[stillIndex].imagePrompt`.
- `rejectImage(dir, id, stillIndex, opts)` — set that still's
  `image.needsRegen = true`, `approved = false`, bump `image.seed`
  (`opts.seed ?? image.seed + 1`); optional prompt override on that still.

### `packages/web/src/app/api/projects/[slug]/segments/route.ts`

`rejectImage` and `editPrompt` ops carry `stillIndex`.

### `packages/web/src/app/p/[slug]/GateClient.tsx`

- **shotlist gate** — render each segment's stills as N editable prompt inputs;
  `editPrompt` posts `stillIndex`.
- **images gate** — render each segment's stills as a row; each still shows
  `/api/assets/${slug}/images/${id}-${i}.png` with its own ⟳ Regenerate posting
  `stillIndex`. (The assets route already serves by filename, so the indexed
  filename works without route changes — to be confirmed during implementation.)

## Tests

- **manifest schema** — new `stills` shape validates; `migrate` upgrades old
  `shot`/`image` shape (with and without a generated image) to a 1-element stills
  array.
- **shotlist** — produces a stills array; defaults applied for missing
  `kenBurns`/`weight`; `imageStyle` appended.
- **images** — per-still generation; seed folds in index; skips approved stills;
  regenerates only `needsRegen` stills; indexed filenames written.
- **buildInputProps** — per-still frames sum exactly to `D`; weighting respected;
  a single-still segment reproduces today's behavior.
- **render duration** — total frames across the timeline unchanged vs. summing
  segment audio durations.
- **edits** — per-still reject/approve/editPrompt operate on the right still.

## Constants

- `FPS = 30` (existing).
- `CROSSFADE_FRAMES = 15` (~0.5s), render-side, clamped to still duration.
- Still count: soft-capped 1–4 via the shotlist prompt; no hard code cap.

## Out of scope (deferred unless requested)

- Word-timed / content-aligned still boundaries (stills track uniform/weighted time,
  not phrase boundaries).
- Configurable crossfade duration (fixed constant for now).
- A hard code cap on still count beyond the prompt's soft limit.
