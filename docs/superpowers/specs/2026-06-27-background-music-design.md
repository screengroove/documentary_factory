# Subtle background music — design

**Date:** 2026-06-27
**Branch:** `feat/multi-image-per-segment` (current working branch; carries the recent features)
**Status:** Approved (design); pending implementation plan

## Problem

The documentary videos play with narration + captions over Ken Burns stills, but
no musical bed. We want a subtle instrumental soundtrack — classical in feel —
under the whole video, matched to the topic's mood.

## Decisions (locked)

1. **Source** — a small bundled royalty-free classical **library** (not AI-generated, not user-upload).
2. **Selection** — **auto-pick by the brief's tone**, with a **UI override** in the review flow.
3. **Library files** — I suggest specific public-domain/CC0 recordings with sources; the user
   downloads and confirms each license. The pipeline is scaffolded with 1–2 vetted tracks to
   prove it end-to-end; the rest are added later.
4. **Mix** — **fixed low volume** (~0.15) with fade-in/out. No ducking under narration.
5. **No new stage** — selection folds into `assemble`; override is an edit in the assemble gate.

## Core mechanic: copy-into-project

The render serves assets from the **project directory** (the render route passes
`--public-dir=<project>`), so `staticFile()` only resolves files inside that one
project. A shared library outside the project is therefore not directly reachable.

Pattern (mirrors how per-segment images/audio already work): the library is the
**source**; selecting a track **copies the chosen file into the project** at
`assets/music/<file>`, which `staticFile("assets/music/<file>")` then resolves.
The manifest stores the in-project path.

## Library + catalog

- **Source library directory:** `packages/core/assets/music/` (in-repo), holding the
  track files plus `ATTRIBUTION.md` (per-track source URL + license).
- **Catalog module:** `packages/core/src/music/catalog.ts`:

```ts
export type Track = {
  id: string;          // stable catalog id, e.g. "chopin-op28-4"
  title: string;
  composer: string;
  file: string;        // filename within packages/core/assets/music/
  moods: string[];     // mood tags used by pickTrack, e.g. ["somber", "melancholic"]
  license: string;     // e.g. "Public Domain Mark 1.0", "CC0"
  sourceUrl: string;   // where it was obtained / verified
};

export const CATALOG: Track[] = [ /* entries below */ ];
```

### Initial catalog (researched; **bold** = file fetched + verified, in `packages/core/assets/music/`)

| id | Mood tags | Piece / Composer | Source URL | License | File |
|---|---|---|---|---|---|
| **`mamoun-statement-1`** | contemplative, reflective | Statement No.1 for solo piano — J. Mamoun | https://archive.org/details/Statement1 | **Public Domain Mark 1.0** (work + recording) | ✅ `mamoun-statement-1.mp3` (~18s) |
| **`schellekens-medieval`** | tense, dramatic | Medieval Theme — M. Schellekens | https://freemusicarchive.org/music/maarten-schellekens/public-domain-1/medieval-theme | **CC0** | ✅ `schellekens-medieval.mp3` (~2:37) |
| `chopin-op28-4` | somber, melancholic | Prelude in E minor, Op. 28 No. 4 — Chopin | https://orangefreesounds.com/prelude-in-e-minor/ | "Public Domain" (verify) | ⬜ pending |
| `schubert-d899-3` | hopeful, serene, uplifting | Impromptu in G‑flat, D. 899 No. 3 — Schubert | https://musopen.org/ (search "Schubert 4 Impromptus D.899") | per-recording PD/CC0/CC BY‑SA (verify) | ⬜ pending |
| `beethoven-op132-slow` | stately, neutral | String Quartet No. 15, Op. 132 (slow mvt) — Beethoven | https://musopen.org/music/2623-string-quartet-no-15-in-a-minor-op-132/ | per-recording (verify) | ⬜ pending |
| `schumann-poet-speaks` | wistful, nostalgic | Scenes from Childhood, Op. 15 — "The Poet Speaks" — Schumann | https://musopen.org/ (search "Schumann Scenes from Childhood") | per-recording (verify) | ⬜ pending |

The two vetted tracks are enough to exercise the full pipeline (one short → tests
looping, one long → tests trim/fade). `pickTrack` and the UI degrade gracefully
while the other four rows are file-less. Per-track source + license is recorded in
`packages/core/assets/music/ATTRIBUTION.md`.

**Licensing caveat (must surface to user):** for classical music the *composition*
is public domain but the *recording* frequently is not. The recordings above are
flagged CC0/PD by their hosts, but licenses and Content ID status change — the user
must download each file and confirm its commercial-use license before relying on it.
`ATTRIBUTION.md` records the chosen source + license per track.

**Scaffolding stance:** the catalog ships with the 1–2 tracks whose files have been
placed in `packages/core/assets/music/` and vetted; the remaining rows are added as
files arrive. `pickTrack` and the UI degrade gracefully with a partial catalog.

## Data model — `manifest.music` (optional)

```ts
music?: z.object({
  trackId: z.string(),
  path: z.string(),        // in-project, e.g. "assets/music/chopin-op28-4.mp3"
  volume: z.number(),      // 0..1, subtle default ~0.15
}).optional()
```

Optional ⇒ existing manifests stay valid; no migration. The migrate() helper is
unaffected (it only touches segments).

## Selection — `pickTrack` + assemble + override

### `pickTrack(tone: string, catalog: Track[]): Track`

Pure, deterministic, testable. Lowercase the freeform tone string and match its
words against a small keyword→mood table; return the first catalog track whose
`moods` intersect the matched moods. Deterministic fallback when nothing matches
(e.g. the first `contemplative`/`stately` track, else `catalog[0]`). No LLM.

Keyword→mood seed (extend as needed):
- wistful, archival, nostalgic, reflective → wistful / contemplative
- somber, grief, tragic, dark → somber
- hopeful, uplifting, inspiring, triumphant → hopeful
- tense, urgent, dramatic, suspense → tense
- formal, institutional, historical → stately

### Assemble stage (`runAssemble`)

When `m.music` is unset and the catalog is non-empty: `const t = pickTrack(m.brief.tone, CATALOG)`,
copy `packages/core/assets/music/<t.file>` → `<project>/assets/music/<t.file>`, and set
`m.music = { trackId: t.id, path: `assets/music/<t.file>`, volume: DEFAULT_MUSIC_VOLUME }`.
Idempotent: if `m.music` is already set, leave it (respect a prior choice/override).
Adds a `projectPaths(...).music` dir (`assets/music`) created in `createProject`.

### Override — edit op `setMusicTrack(dir, trackId)`

Look up the track in the catalog (throw on unknown id), copy its file into the
project, set `m.music = { trackId, path, volume: existing ?? DEFAULT_MUSIC_VOLUME }`.
Surfaced in the assemble gate. Not a stage re-run.

## Render

- **`DocumentaryProps`** gains `music?: { path: string; volume: number }`, emitted by
  `buildInputProps` when `m.music` exists. `totalFrames` is unchanged (music adds no duration).
- **`Documentary.tsx`** renders one root-level music layer alongside the segment Sequences:
  `<Audio src={staticFile(music.path)} loop volume={fadeFn} />` (Audio from `@remotion/media`).
  - `loop` covers tracks shorter than the video; a longer track is trimmed to the
    composition length naturally.
  - **`fadeFn(frame)`**: returns `music.volume`, ramped from 0 over the first ~1s
    (30 frames) and down to 0 over the last ~1.5s (45 frames) of `totalFrames`. The
    fade needs the composition length; compute it inside a small `Music` component
    using `useVideoConfig().durationInFrames`.
- Per-segment narration `<Audio>` is unchanged; Remotion mixes the layers.

## Web / UI

- **Edit op** `setMusicTrack` wired through `packages/web/src/app/api/projects/[slug]/segments/route.ts`
  (`{ op: "setMusicTrack"; trackId: string }`) into `packages/web/src/lib/edits.ts`.
- **Catalog exposure:** the gate needs the track list. Export `CATALOG` from `@doc/core`
  and render the dropdown from it (ids + titles); the selected `m.music.trackId` is the value.
- **Assemble gate (`GateClient.tsx`):** a "Soundtrack" block showing the selected track's
  title/composer, an `<audio controls src="/api/assets/<slug>/music/<file>">` preview, and a
  `<select>` of catalog tracks that posts `setMusicTrack` (editable-gated like other controls).
- The assets route already serves arbitrary paths, so `assets/music/<file>` works with no route change.

## Deployment

- The Dockerfile must copy `packages/core/assets/music/` into the runtime image so
  `runAssemble`/`setMusicTrack` can read the source files in production (Railway).

## Testing

- **catalog/pickTrack:** tone keywords map to the right mood/track; deterministic
  fallback when no keyword matches; partial catalog doesn't crash.
- **assemble:** sets `m.music` and copies the file when unset; leaves an existing
  `m.music` untouched; total-duration behavior unchanged.
- **buildInputProps:** emits the `music` block when `m.music` exists; omits it otherwise.
- **edits:** `setMusicTrack` swaps `trackId`/`path` and copies the file; throws on unknown id.
- **Render verify:** a short MP4 render (a few seconds) on a real project, then confirm
  with ffprobe/mediabunny that the output has an audio stream — a still frame cannot
  capture audio. Eyeball/ear-check the mix level informally.

## Constants

- `DEFAULT_MUSIC_VOLUME = 0.15`
- Fade-in ≈ 30 frames; fade-out ≈ 45 frames (at 30 fps).

## Out of scope (deferred unless requested)

- Ducking music under narration (sidechain).
- A per-project volume slider in the UI (fixed level for v1).
- Multiple / section-specific tracks within one video.
- AI-generated music.
