# Pronunciation Dictionary — UI Panel, Suggest & Preview (design)

**Date:** 2026-06-28
**Status:** Design approved, pending spec review
**Relates to:** `docs/superpowers/plans/2026-06-28-speech-pronunciation-correction.md`
(the backend: `pronunciations` manifest field, `applyPronunciations` / `remapWords`,
voiceover wiring, `setPronunciations` edit + segments API op). This spec covers the
**web UI and two new compute endpoints** layered on that backend.

## Context

The pronunciation-correction plan adds a project-wide `{ term, respelling }` dictionary
applied at voiceover time. This design specifies how users manage that dictionary in
the web app (Gate 4, voiceover), plus two assists requested during brainstorming:

1. An **LLM "suggest phonetic spelling"** button — Claude proposes a respelling for a term.
2. A **▶ preview** button — synthesize a respelling with Kokoro so the user can hear it
   before committing (which would otherwise require a full segment re-record).
3. An **Apply & re-record** button — the deliberate action that pushes the current
   dictionary into the audio by re-recording affected segments. Dictionary edits are
   **non-destructive** until this is clicked.

Decisions locked with the user:
- **Gate 4 is split into two tabs:** *Audio Segments* (existing list) and *Pronunciation* (new).
- Tab styling uses the **system blue accent** for the active tab; the **Pronunciation tab
  shows a count** (e.g. "Pronunciation (3)").
- Dictionary layout: **inline rows, compact** — `term → respelling` on one line.
- Suggest uses **term only** (stateless), returns **a single respelling that fills the field**.
- **▶ preview is in scope.**
- **Apply scope:** re-records **every segment whose narration contains any current term**
  (no last-applied snapshot — simple, deterministic blast radius shown as a count).
- **Apply gate behavior:** re-records, then sends the **voiceover gate back to
  awaiting_review** and resets the **assemble gate to pending**, so the user re-approves
  and re-renders. New audio passes back through review before it ships.
- Dictionary editing (`setPronunciations`) is **allowed after the voiceover gate is
  approved** (unlike `editNarration`, which is blocked post-approval) — late pronunciation
  fixes are the whole point. The edit itself is non-destructive; only **Apply** mutates audio.

## Architecture

Two new server routes (browser → API → core client). API keys are server-only, so both
must run server-side.

### `POST /api/pronounce/suggest`
- Body: `{ term: string }`. Response: `{ respelling: string }`.
- Server constructs the Anthropic LLM client directly —
  `anthropicLlm(process.env.ANTHROPIC_API_KEY)` — and calls
  `complete({ system, user, schema: z.object({ respelling: z.string() }) })`.
  (Direct construction, not `realDeps`, so the route doesn't require `REPLICATE_API_TOKEN`.)
- **System prompt** enforces the respelling convention: plain-English phonetic respelling,
  hyphens separate syllables, CAPS mark the stressed syllable, **no IPA**, output only the
  respelling. Example shown in-prompt: `Iwanicki → ee-vah-NEE-tskee`.
- Stateless: no slug, no manifest load.

### `POST /api/pronounce/preview`
- Body: `{ text: string }` (the respelling to hear). Response: `audio/wav` (binary).
- Refactor `packages/core/src/providers/replicate-tts.ts`: extract the Kokoro-only step
  of `speak()` into an exported `synthesize(token, { text, voiceId }): Promise<Buffer>`.
  `speak()` keeps its current behavior by calling `synthesize()` then WhisperX align.
- The preview route calls `synthesize()` only — **it skips WhisperX alignment**, which
  preview doesn't need. ≈2× faster and half the Replicate cost vs. reusing `speak()`.
- Uses `DEFAULT_VOICE_ID` (`bm_george`) so the preview matches production narration.
- Browser plays the returned blob via an object URL.

### `POST /api/projects/[slug]/pronounce/apply`
- No body. Response: refreshed manifest.
- Server-side, in order:
  1. Clear `seg.audio` for every segment whose narration contains any current dictionary
     term (whole-word, case-insensitive) — reuses the matching logic from `applyPronunciations`.
  2. Reset `m.stages.assemble` to `pending` (the existing render is now stale).
  3. `runStage(slug, "voiceover")` — `runVoiceover` regenerates exactly the cleared segments
     (its `if (seg.audio) continue` skip) applying the current dictionary, and sets the
     voiceover gate to `awaiting_review`.
  4. Return the refreshed manifest.
- Synchronous, mirroring the existing `/run` route (a handful of Replicate calls).

Rejected alternatives: reusing `speak()` for preview (wastes a WhisperX call per click);
folding suggest/preview into the `segments` route (it is a JSON mutation endpoint returning
`{ok:true}` — binary audio and compute-and-return don't belong there).

## UI

### Tabbed Gate 4 (`packages/web/src/app/p/[slug]/GateClient.tsx`)
- When `viewing === "voiceover"`, render a two-tab strip above the content:
  **Audio Segments** | **Pronunciation (N)**, where N = `m.pronunciations?.length ?? 0`.
- Local React state `voiceoverTab: "segments" | "pronunciation"`, default `"segments"`.
- Active tab = blue accent (e.g. `.btn--primary`-like / accent tint + accent border);
  inactive = ghost/muted. Tabs work in read-only mode (view-only).
- *Audio Segments* tab = the current voiceover segment list, unchanged.

### Pronunciation tab — dictionary panel
A `.ds-card` titled **Pronunciation Dictionary**, compact density. Contents:
- **Review notice** (shown when editable): a yellow `.badge--review` line — "Changes take
  effect when you Apply & re-record. That sends the voiceover gate back to review and the
  video will need re-rendering."
- **Inline rows**, one per entry, left → right:
  `[term input] · [✨ suggest] · [respelling input] · [▶ preview] · [🗑 delete]`
  - `term` / `respelling` are `.input.mono`; respelling text uses `--color-cyan`.
  - The **✨ suggest** button sits **between the two inputs** (where the arrow was).
  - `🗑 delete` is danger-tinted; `▶ preview` is an icon button.
- **Add correction** button at the bottom appends an empty row.
- **Apply & re-record** primary button in the panel footer, labelled with the blast radius
  — e.g. "Apply & re-record (4 segments)" where the count = segments containing any current
  term. On click → spinner ("Re-recording…") → `POST .../pronounce/apply` → refresh (the
  voiceover gate is now awaiting_review). Disabled when no entry matches any segment.
- **Empty state** (no entries): centered icon + "No pronunciation corrections yet" +
  short description + a primary "Add first correction" button (button hidden in read-only).
- The **Pronunciation tab is always editable** (it is project-level config and the tool for
  late fixes), even when the Audio Segments tab is read-only because a later gate is active.

### Per-control behavior
- **✨ Suggest:** disabled when `term` is empty or `!editable`. On click → spinner →
  `POST /api/pronounce/suggest {term}` → fills that row's respelling input (replacing any
  current value) in **local state only**. Errors surface via the existing `actionError`.
- **▶ Preview:** disabled when `respelling` is empty. On click → spinner →
  `POST /api/pronounce/preview {text: respelling}` → play returned audio. Errors → `actionError`.

## Persistence & re-record interaction
- Local state mirrors `m.pronunciations`. **Editing a field (onBlur), adding a row, or
  deleting a row posts the whole list:** `post("segments", { op: "setPronunciations", entries })`.
- `setPronunciations(dir, entries)` simply **saves `m.pronunciations` — it is
  non-destructive** (does not touch any `seg.audio`) and is allowed regardless of gate
  approval. Empty-term rows are dropped on save.
- The ✨ suggest button only updates local state; it persists on the next blur, exactly like
  typing. Nothing it does affects audio until Apply.
- **Apply & re-record** is the only action that mutates audio: it clears audio for all
  term-containing segments, re-records them with the current dictionary, kicks the voiceover
  gate to `awaiting_review`, and resets the assemble gate to `pending` (see the apply route).
  This replaces the earlier plan's "clear audio on every dictionary edit" behavior.

## Testing
- **Suggest route:** unit test with a fake `LlmClient` — asserts the system prompt carries
  the convention and the route returns `{respelling}` from `complete()`.
- **`synthesize()`:** unit test with a fake Replicate client — returns audio **without**
  invoking the align model; assert `speak()` still returns words (align path intact).
- **Apply:** unit test the audio-clearing helper — given a manifest + dictionary, only
  segments whose narration contains a term get `audio` cleared; assemble reset to pending.
  (The voiceover run itself is covered by existing voiceover tests / fake deps.)
- **Panel:** reuses the existing `post` flow; the fetch helpers are thin. Manual end-to-end:
  add a term, ✨ suggest, ▶ preview, Apply, confirm only term-containing segments re-record
  and the voiceover gate returns to review.

## Files
- `packages/web/src/app/api/pronounce/suggest/route.ts` — **new**
- `packages/web/src/app/api/pronounce/preview/route.ts` — **new**
- `packages/web/src/app/api/projects/[slug]/pronounce/apply/route.ts` — **new**
- `packages/core/src/providers/replicate-tts.ts` — extract + export `synthesize()`
- `packages/web/src/lib/edits.ts` — `setPronunciations` (non-destructive save) +
  `clearAudioForPronouncedSegments` helper used by the apply route
- `packages/web/src/app/p/[slug]/GateClient.tsx` — tabbed Gate 4 + dictionary panel + Apply
- (backend pieces — manifest field, `applyPronunciations`/`remapWords`, voiceover wiring,
  `setPronunciations` segments op — per the plan doc; note the plan's "clear on edit"
  behavior is **superseded** by the Apply model above)
