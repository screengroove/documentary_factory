# Background Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a subtle classical instrumental track under the whole video, auto-picked by the brief's tone from a small bundled library, with a UI override.

**Architecture:** A new optional `manifest.music` block records the chosen track. A pure `pickTrack` maps the brief tone to a catalog entry; `runAssemble` auto-picks on first run and copies the chosen file from the in-repo library into the project's `assets/music/` (so the render's `--public-dir` resolves it). `buildInputProps` surfaces a `music` block; the render plays one root-level looping `<Audio>` at fixed low volume with fade in/out. The reviewer can override the track in the assemble gate.

**Tech Stack:** TypeScript, Zod, vitest, Remotion (`@remotion/media`), Next.js (App Router).

## Global Constraints

- **Library lives at** `packages/core/assets/music/` (already contains `mamoun-statement-1.mp3`, `schellekens-medieval.mp3`, `ATTRIBUTION.md`). Shipped to the image by the existing `COPY . .` (not in `.dockerignore`) — **no Dockerfile change needed**.
- **`@doc/core` is bundled into the Next server** (`transpilePackages`), so `import.meta.url` does NOT resolve the library at runtime in production. The library dir MUST be injectable: `runAssemble`/`setMusicTrack` take `opts.musicLibDir`; the web layer passes `join(process.cwd(), "..", "core", "assets", "music")` (cwd is `packages/web`, mirroring `PROJECTS_ROOT = join(process.cwd(), "..", "..", "projects")`). The core default (`musicLibraryDir()` via `import.meta.url`) is for tests, which run real ESM source under vitest.
- **`GateClient` is a client component** — it must NOT import `@doc/core` values (node deps). The server `page.tsx` passes a serializable track list as a prop.
- `DEFAULT_MUSIC_VOLUME = 0.15`. Fade-in = 30 frames, fade-out = 45 frames (at FPS 30).
- `manifest.music` is **optional** — existing manifests stay valid; no migration.
- Catalog ships with the **2 vetted tracks**: `mamoun-statement-1` (moods: contemplative, reflective) and `schellekens-medieval` (moods: tense, dramatic).
- TDD throughout. Match the existing terse, commented code style. Commit after each task. Run only the relevant test file during a task; run the full suite (`npm test`) and `npm run typecheck` in the final integration task.

---

## File Structure

- Create `packages/core/src/music/catalog.ts` — `Track` type, `CATALOG`, `musicLibraryDir()`, `trackSourcePath()`, `pickTrack()`.
- Create `packages/core/src/music/catalog.test.ts` — `pickTrack` tests.
- Modify `packages/core/src/manifest.ts` — add `MusicSchema` + `music?` on `ManifestSchema`.
- Modify `packages/core/src/project.ts` — add `music` to `projectPaths`, create it in `createProject`.
- Modify `packages/core/src/stages/assemble.ts` — `DEFAULT_MUSIC_VOLUME`, auto-pick+copy in `runAssemble`, `music` in `DocumentaryProps`/`buildInputProps`.
- Modify `packages/core/src/index.ts` — export the catalog module.
- Modify `packages/render/src/props.ts` — add `musicVolume()` helper.
- Create `packages/render/src/Music.tsx` — the root audio layer.
- Modify `packages/render/src/Documentary.tsx` — render `<Music>` when present.
- Modify `packages/web/src/lib/edits.ts` + `edits.test.ts` — `setMusicTrack`.
- Modify `packages/web/src/lib/runner.ts` — pass `musicLibDir` to `runAssemble`.
- Modify `packages/web/src/app/api/projects/[slug]/segments/route.ts` — `setMusicTrack` op.
- Modify `packages/web/src/app/p/[slug]/page.tsx` — pass `tracks` prop.
- Modify `packages/web/src/app/p/[slug]/GateClient.tsx` — soundtrack block in the assemble gate.

---

### Task 1: `manifest.music` schema

**Files:**
- Modify: `packages/core/src/manifest.ts`
- Test: `packages/core/src/manifest.schema.test.ts`

**Interfaces:**
- Produces: `MusicSchema`; `Manifest["music"]?: { trackId: string; path: string; volume: number }`.

- [ ] **Step 1: Write the failing test** — append to `manifest.schema.test.ts` before the final `rejects` test:

```ts
test("accepts a manifest with a music block", () => {
  const withMusic = {
    ...minimal,
    music: { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.15 },
  };
  const parsed = ManifestSchema.parse(withMusic);
  expect(parsed.music?.trackId).toBe("mamoun-statement-1");
  expect(parsed.music?.volume).toBe(0.15);
});

test("rejects a music block missing its path", () => {
  const bad = { ...minimal, music: { trackId: "x", volume: 0.15 } };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/manifest.schema.test.ts`
Expected: FAIL — `parsed.music` is undefined (Zod strips the unknown key).

- [ ] **Step 3: Add the schema.** In `manifest.ts`, after the `TitleSchema`/`Title` block, add:

```ts
// The background-music selection: which catalog track, where its file was copied
// into the project, and its mix volume (0..1).
const MusicSchema = z.object({
  trackId: z.string(),
  path: z.string(),
  volume: z.number(),
});
export type Music = z.infer<typeof MusicSchema>;
```

Then add `music` to `ManifestSchema` (next to `title`):

```ts
  title: TitleSchema.optional(),
  music: MusicSchema.optional(),
  segments: z.array(SegmentSchema),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/manifest.schema.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/manifest.ts packages/core/src/manifest.schema.test.ts
git commit -m "feat(core): add optional manifest.music schema"
```

---

### Task 2: Music catalog + `pickTrack`

**Files:**
- Create: `packages/core/src/music/catalog.ts`
- Create: `packages/core/src/music/catalog.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `type Track = { id: string; title: string; composer: string; file: string; moods: string[]; license: string; sourceUrl: string }`
  - `const CATALOG: Track[]`
  - `function musicLibraryDir(): string`
  - `function trackSourcePath(track: Track, libDir?: string): string`
  - `function pickTrack(tone: string, catalog?: Track[]): Track`

- [ ] **Step 1: Write the failing test** — `packages/core/src/music/catalog.test.ts`:

```ts
import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { CATALOG, pickTrack, trackSourcePath, type Track } from "./catalog.js";

test("catalog ships only tracks whose files exist on disk", () => {
  expect(CATALOG.length).toBeGreaterThan(0);
  for (const t of CATALOG) expect(existsSync(trackSourcePath(t))).toBe(true);
});

test("pickTrack maps a tone keyword to a matching mood", () => {
  const catalog: Track[] = [
    { id: "calm", title: "", composer: "", file: "a.mp3", moods: ["contemplative"], license: "", sourceUrl: "" },
    { id: "edgy", title: "", composer: "", file: "b.mp3", moods: ["tense"], license: "", sourceUrl: "" },
  ];
  expect(pickTrack("wistful, archival", catalog).id).toBe("calm");
  expect(pickTrack("tense, urgent thriller", catalog).id).toBe("edgy");
});

test("pickTrack falls back to the first track when no keyword matches", () => {
  const catalog: Track[] = [
    { id: "calm", title: "", composer: "", file: "a.mp3", moods: ["contemplative"], license: "", sourceUrl: "" },
  ];
  expect(pickTrack("zzz nonsense", catalog).id).toBe("calm");
});

test("pickTrack throws on an empty catalog", () => {
  expect(() => pickTrack("anything", [])).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/music/catalog.test.ts`
Expected: FAIL — cannot resolve `./catalog.js`.

- [ ] **Step 3: Implement the catalog** — `packages/core/src/music/catalog.ts`:

```ts
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Track = {
  id: string;
  title: string;
  composer: string;
  file: string;          // filename within the music library dir
  moods: string[];       // mood tags matched by pickTrack
  license: string;
  sourceUrl: string;
};

// Only tracks whose files are actually present + license-vetted (see
// packages/core/assets/music/ATTRIBUTION.md). Add rows as files arrive.
export const CATALOG: Track[] = [
  {
    id: "mamoun-statement-1",
    title: "Statement No.1 for solo piano",
    composer: "John Mamoun",
    file: "mamoun-statement-1.mp3",
    moods: ["contemplative", "reflective"],
    license: "Public Domain Mark 1.0",
    sourceUrl: "https://archive.org/details/Statement1",
  },
  {
    id: "schellekens-medieval",
    title: "Medieval Theme",
    composer: "Maarten Schellekens",
    file: "schellekens-medieval.mp3",
    moods: ["tense", "dramatic"],
    license: "CC0",
    sourceUrl: "https://freemusicarchive.org/music/maarten-schellekens/public-domain-1/medieval-theme",
  },
];

// Absolute path to the in-repo library. Resolves correctly under vitest (real
// ESM source). In the bundled Next server this is wrong — callers there MUST
// pass an explicit libDir (see plan Global Constraints).
export function musicLibraryDir(): string {
  return fileURLToPath(new URL("../../assets/music/", import.meta.url));
}

export function trackSourcePath(track: Track, libDir: string = musicLibraryDir()): string {
  return join(libDir, track.file);
}

// Lowercase the freeform tone and match its words against mood keywords; return
// the first catalog track sharing a matched mood, else the first track.
const TONE_KEYWORDS: Array<[RegExp, string]> = [
  [/wistful|archival|nostalg|reflect|contempl|calm|gentle|quiet/, "contemplative"],
  [/somber|grief|tragic|dark|melanchol|\bsad\b|mourn/, "somber"],
  [/hope|uplift|inspir|triumph|serene|warm|joy/, "hopeful"],
  [/tense|urgent|dramatic|suspense|ominous|foreboding|thriller/, "tense"],
  [/formal|institution|historic|stately|grand|noble/, "stately"],
];

export function pickTrack(tone: string, catalog: Track[] = CATALOG): Track {
  if (catalog.length === 0) throw new Error("Music catalog is empty");
  const t = tone.toLowerCase();
  const moods = TONE_KEYWORDS.filter(([re]) => re.test(t)).map(([, mood]) => mood);
  for (const mood of moods) {
    const hit = catalog.find((tr) => tr.moods.includes(mood));
    if (hit) return hit;
  }
  return catalog[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/music/catalog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the package barrel.** In `packages/core/src/index.ts`, add after the other stage/module exports:

```ts
export * from "./music/catalog.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/music/ packages/core/src/index.ts
git commit -m "feat(core): music catalog + tone-based pickTrack"
```

---

### Task 3: Project `music` asset dir

**Files:**
- Modify: `packages/core/src/project.ts`
- Test: `packages/core/src/project.test.ts`

**Interfaces:**
- Produces: `projectPaths(dir).music` (absolute path to `<dir>/assets/music`), created by `createProject`.

- [ ] **Step 1: Write the failing test** — add to `project.test.ts`:

```ts
test("createProject creates the music asset dir", () => {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  const dir = createProject(root, "doc", {
    topic: "t", targetMinutes: 6, tone: "calm", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  expect(existsSync(join(dir, "assets/music"))).toBe(true);
  rmSync(root, { recursive: true, force: true });
});
```

(Ensure `existsSync` is imported from `node:fs` in the test file; add it to the import if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/project.test.ts`
Expected: FAIL — `assets/music` does not exist.

- [ ] **Step 3: Implement.** In `project.ts`, add `music` to `projectPaths`:

```ts
  return {
    images: join(projectDir, "assets/images"),
    audio: join(projectDir, "assets/audio"),
    music: join(projectDir, "assets/music"),
    out: join(projectDir, "out"),
    runs: join(projectDir, "runs"),
  };
```

And include it in the `createProject` mkdir loop:

```ts
  for (const d of [p.images, p.audio, p.music, p.out, p.runs]) mkdirSync(d, { recursive: true });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project.ts packages/core/src/project.test.ts
git commit -m "feat(core): create assets/music dir per project"
```

---

### Task 4: Auto-pick + copy the soundtrack in `runAssemble`

**Files:**
- Modify: `packages/core/src/stages/assemble.ts`
- Test: `packages/core/src/stages/assemble.test.ts`

**Interfaces:**
- Consumes: `pickTrack`, `trackSourcePath`, `CATALOG` (Task 2); `projectPaths().music` (Task 3); `Manifest["music"]` (Task 1).
- Produces: `runAssemble(projectDir, opts?: { musicLibDir?: string })`; `const DEFAULT_MUSIC_VOLUME = 0.15`.

- [ ] **Step 1: Write the failing test** — add to `assemble.test.ts` (the file already imports `loadManifest`, `saveManifest`; add `existsSync` from `node:fs` and the catalog import):

```ts
// at top, alongside existing imports
import { existsSync } from "node:fs";
import { CATALOG } from "../music/catalog.js";

test("runAssemble auto-picks a soundtrack and copies it into the project", async () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  // brief.tone defaults to "w" in projectWith — set a real tone for a deterministic pick
  const pre = loadManifest(dir); pre.brief.tone = "tense, urgent"; saveManifest(dir, pre);

  await runAssemble(dir);

  const m = loadManifest(dir);
  expect(m.music?.trackId).toBe("schellekens-medieval");
  expect(m.music?.path).toBe("assets/music/schellekens-medieval.mp3");
  expect(m.music?.volume).toBe(0.15);
  expect(existsSync(join(dir, "assets/music/schellekens-medieval.mp3"))).toBe(true);
});

test("runAssemble respects an already-chosen track", async () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  const pre = loadManifest(dir);
  pre.music = { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.2 };
  saveManifest(dir, pre);

  await runAssemble(dir);

  expect(loadManifest(dir).music?.trackId).toBe("mamoun-statement-1");
  expect(loadManifest(dir).music?.volume).toBe(0.2);
});
```

(The `projectWith` helper creates real `assets/` dirs via `createProject`, so the copy target exists.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/stages/assemble.test.ts`
Expected: FAIL — `m.music` is undefined.

- [ ] **Step 3: Implement.** In `assemble.ts`:

Add imports at the top:

```ts
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { projectPaths } from "../project.js";
import { CATALOG, pickTrack, trackSourcePath } from "../music/catalog.js";
```

Add the constant near `const FPS = 30;`:

```ts
export const DEFAULT_MUSIC_VOLUME = 0.15;
```

Change the `runAssemble` signature and add the auto-pick block before computing `totalDurationSec`:

```ts
export async function runAssemble(
  projectDir: string,
  opts: { musicLibDir?: string } = {},
): Promise<void> {
  const m = loadManifest(projectDir);
  for (const s of m.segments) {
    if (!s.audio) throw new Error(`Segment ${s.id} has no audio; run voiceover first`);
  }

  // Auto-pick a soundtrack on first assemble; respect an existing/overridden choice.
  if (!m.music && CATALOG.length > 0) {
    const track = pickTrack(m.brief.tone);
    copyFileSync(trackSourcePath(track, opts.musicLibDir), join(projectPaths(projectDir).music, track.file));
    m.music = { trackId: track.id, path: `assets/music/${track.file}`, volume: DEFAULT_MUSIC_VOLUME };
  }

  const totalDurationSec = m.segments.reduce((sum, s) => sum + (s.audio?.durationSec ?? 0), 0);
  m.timeline = { fps: FPS, totalDurationSec };
  m.stages.assemble.status = "awaiting_review";
  saveManifest(projectDir, m);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/stages/assemble.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stages/assemble.ts packages/core/src/stages/assemble.test.ts
git commit -m "feat(core): auto-pick + copy soundtrack on assemble"
```

---

### Task 5: Surface `music` in `buildInputProps` / `DocumentaryProps`

**Files:**
- Modify: `packages/core/src/stages/assemble.ts`
- Test: `packages/core/src/stages/assemble.test.ts`

**Interfaces:**
- Produces: `DocumentaryProps.music?: { path: string; volume: number }`, emitted by `buildInputProps` when `m.music` is set.

- [ ] **Step 1: Write the failing test** — add to `assemble.test.ts`:

```ts
test("buildInputProps surfaces the music block when present", () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  const m = loadManifest(dir);
  m.music = { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.15 };
  saveManifest(dir, m);

  const props = buildInputProps(loadManifest(dir));
  expect(props.music?.path).toBe("assets/music/mamoun-statement-1.mp3");
  expect(props.music?.volume).toBe(0.15);
});

test("buildInputProps omits music when none is chosen", () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  expect(buildInputProps(loadManifest(dir)).music).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/stages/assemble.test.ts`
Expected: FAIL — `props.music` is undefined in the first new test.

- [ ] **Step 3: Implement.** In `assemble.ts`, add to the `DocumentaryProps` type (next to `intro?`):

```ts
  music?: { path: string; volume: number };
```

In `buildInputProps`, after the `intro` computation and before `return`:

```ts
  const music = m.music ? { path: m.music.path, volume: m.music.volume } : undefined;
```

And spread it into the returned object (next to the `intro` spread):

```ts
  return {
    fps: FPS,
    aspectRatio: m.brief.aspectRatio,
    ...(intro ? { intro } : {}),
    ...(music ? { music } : {}),
    segments: m.segments.map((s) => {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/stages/assemble.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stages/assemble.ts packages/core/src/stages/assemble.test.ts
git commit -m "feat(core): expose music in buildInputProps"
```

---

### Task 6: Render the music layer

**Files:**
- Modify: `packages/render/src/props.ts`
- Test: `packages/render/src/duration.test.ts`
- Create: `packages/render/src/Music.tsx`
- Modify: `packages/render/src/Documentary.tsx`

**Interfaces:**
- Consumes: `DocumentaryProps.music` (Task 5).
- Produces: `musicVolume(frame, totalFrames, base, fadeIn?, fadeOut?): number`; `<Music music={...} />`.

- [ ] **Step 1: Write the failing test** — add to `duration.test.ts`:

```ts
import { musicVolume } from "./props.js"; // add musicVolume to the existing import

test("musicVolume fades in, holds, and fades out", () => {
  const total = 300, base = 0.15;
  expect(musicVolume(0, total, base)).toBe(0);                 // start silent
  expect(musicVolume(30, total, base)).toBeCloseTo(base);      // full after fade-in
  expect(musicVolume(150, total, base)).toBeCloseTo(base);     // holds mid
  expect(musicVolume(300, total, base)).toBe(0);              // silent at end
  expect(musicVolume(285, total, base)).toBeCloseTo(base / 3, 5); // 15 of 45 frames left
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/render/src/duration.test.ts`
Expected: FAIL — `musicVolume` is not exported.

- [ ] **Step 3: Implement the helper.** In `props.ts`, append:

```ts
// Constant `base` volume, ramped up over the first `fadeIn` frames and down over
// the last `fadeOut` frames of the composition.
export function musicVolume(
  frame: number,
  totalFrames: number,
  base: number,
  fadeIn = 30,
  fadeOut = 45,
): number {
  const up = Math.min(1, frame / Math.max(1, fadeIn));
  const down = Math.min(1, (totalFrames - frame) / Math.max(1, fadeOut));
  return base * Math.max(0, Math.min(up, down));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/render/src/duration.test.ts`
Expected: PASS.

- [ ] **Step 5: Create `Music.tsx`:**

```tsx
import { Audio } from "@remotion/media"; // remotion-best-practices: media components come from @remotion/media
import { staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { musicVolume, type DocumentaryProps } from "./props.js";

type MusicProps = NonNullable<DocumentaryProps["music"]>;
const src = (p: string) => (p.startsWith("http") ? p : staticFile(p));

// One looping low-volume bed under the whole composition, fading in/out. Volume
// is computed per-frame (not a callback) so it works regardless of Audio's
// volume-callback support.
export function Music({ music }: { music: MusicProps }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return <Audio src={src(music.path)} loop volume={musicVolume(frame, durationInFrames, music.volume)} />;
}
```

- [ ] **Step 6: Wire it into `Documentary.tsx`.** Add the import:

```tsx
import { Music } from "./Music.js";
```

Render it at the root (e.g. immediately inside the opening `<>`, before the intro):

```tsx
  return (
    <>
      {props.music && <Music music={props.music} />}
      {intro && (
```

- [ ] **Step 7: Typecheck the render package**

Run: `npx tsc --noEmit -p packages/render`
Expected: exit 0.

If `@remotion/media`'s `Audio` rejects the `loop` prop at typecheck, fall back to importing `Audio` from `remotion` in `Music.tsx` (core `Audio` supports `loop` + numeric `volume`); re-run the typecheck.

- [ ] **Step 8: Commit**

```bash
git add packages/render/src/props.ts packages/render/src/duration.test.ts packages/render/src/Music.tsx packages/render/src/Documentary.tsx
git commit -m "feat(render): looping low-volume music bed with fades"
```

---

### Task 7: `setMusicTrack` edit + override plumbing

**Files:**
- Modify: `packages/web/src/lib/edits.ts`
- Test: `packages/web/src/lib/edits.test.ts`
- Modify: `packages/web/src/lib/runner.ts`
- Modify: `packages/web/src/app/api/projects/[slug]/segments/route.ts`

**Interfaces:**
- Consumes: `CATALOG`, `trackSourcePath`, `DEFAULT_MUSIC_VOLUME` (core); `projectPaths().music`.
- Produces: `setMusicTrack(dir, trackId, opts?: { musicLibDir?: string })`.

- [ ] **Step 1: Write the failing test** — add to `edits.test.ts`:

```ts
import { existsSync } from "node:fs"; // add if not present
import { setMusicTrack } from "./edits.js"; // add to the existing import

test("setMusicTrack copies the chosen track into the project and records it", () => {
  const dir = proj();
  setMusicTrack(dir, "schellekens-medieval");
  const m = loadManifest(dir);
  expect(m.music?.trackId).toBe("schellekens-medieval");
  expect(m.music?.path).toBe("assets/music/schellekens-medieval.mp3");
  expect(m.music?.volume).toBe(0.15);
  expect(existsSync(join(dir, "assets/music/schellekens-medieval.mp3"))).toBe(true);
});

test("setMusicTrack preserves an existing volume", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.music = { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.3 };
  saveManifest(dir, m);
  setMusicTrack(dir, "schellekens-medieval");
  expect(loadManifest(dir).music?.volume).toBe(0.3);
});

test("setMusicTrack throws on an unknown track id", () => {
  const dir = proj();
  expect(() => setMusicTrack(dir, "nope")).toThrow(/unknown/i);
});
```

(`proj()` uses `createProject`, so `assets/music` already exists.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/lib/edits.test.ts`
Expected: FAIL — `setMusicTrack` is not exported.

- [ ] **Step 3: Implement `setMusicTrack`.** In `edits.ts`, add imports:

```ts
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CATALOG, trackSourcePath, DEFAULT_MUSIC_VOLUME } from "@doc/core";
```

(Adjust the existing `@doc/core` import line to include these named exports.)

Add the function:

```ts
export function setMusicTrack(dir: string, trackId: string, opts: { musicLibDir?: string } = {}): void {
  const m = loadManifest(dir);
  const track = CATALOG.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown music track: ${trackId}`);
  const destDir = join(dir, "assets/music");
  mkdirSync(destDir, { recursive: true }); // older projects may predate the dir
  copyFileSync(trackSourcePath(track, opts.musicLibDir), join(destDir, track.file));
  m.music = {
    trackId: track.id,
    path: `assets/music/${track.file}`,
    volume: m.music?.volume ?? DEFAULT_MUSIC_VOLUME,
  };
  saveManifest(dir, m);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/lib/edits.test.ts`
Expected: PASS.

- [ ] **Step 5: Pass `musicLibDir` from the runner (production correctness).** In `runner.ts`, change the assemble runner:

```ts
  assemble: (dir) => runAssemble(dir, { musicLibDir: join(process.cwd(), "..", "core", "assets", "music") }),
```

(`join` is already imported in `runner.ts`.)

- [ ] **Step 6: Wire the route op.** In `segments/route.ts`:

Add the import + a module constant:

```ts
import { editNarration, editPrompt, rejectImage, rejectAudio, editTitle, rejectTitleImage, setMusicTrack } from "@/lib/edits";
const MUSIC_LIB_DIR = join(process.cwd(), "..", "core", "assets", "music");
```

Add to the `Action` union:

```ts
  | { op: "setMusicTrack"; trackId: string }
```

Add to the dispatch chain:

```ts
  else if (a.op === "setMusicTrack") setMusicTrack(dir, a.trackId, { musicLibDir: MUSIC_LIB_DIR });
```

- [ ] **Step 7: Typecheck web**

Run: `npx tsc --noEmit -p packages/web`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/lib/edits.ts packages/web/src/lib/edits.test.ts packages/web/src/lib/runner.ts packages/web/src/app/api/projects/[slug]/segments/route.ts
git commit -m "feat(web): setMusicTrack override + production musicLibDir"
```

---

### Task 8: Soundtrack UI in the assemble gate

**Files:**
- Modify: `packages/web/src/app/p/[slug]/page.tsx`
- Modify: `packages/web/src/app/p/[slug]/GateClient.tsx`

**Interfaces:**
- Consumes: `CATALOG` (server side); `setMusicTrack` via the `setMusicTrack` POST op; `m.music`.
- Produces: a `tracks: Array<{ id: string; title: string; composer: string }>` prop on `GateClient`.

No unit test (server/client UI); verified by typecheck + the integration render.

- [ ] **Step 1: Pass the catalog from the server page.** In `page.tsx`, import the catalog and pass a serializable subset. Add:

```tsx
import { CATALOG } from "@doc/core";
```

Find where `<GateClient ... />` is rendered and add the prop:

```tsx
      <GateClient
        slug={slug}
        initial={manifest}
        tracks={CATALOG.map((t) => ({ id: t.id, title: t.title, composer: t.composer }))}
      />
```

(Match the existing prop names — the page already passes `slug` and `initial`; add `tracks` alongside them.)

- [ ] **Step 2: Accept the prop in `GateClient`.** Update the component signature:

```tsx
export function GateClient({ slug, initial, tracks }: {
  slug: string; initial: Manifest; tracks: Array<{ id: string; title: string; composer: string }>;
}) {
```

- [ ] **Step 3: Render the soundtrack block in the assemble gate.** Find the `viewing === "assemble"` gate block in `GateClient.tsx` and add, at its top, a soundtrack card:

```tsx
{m.music && (
  <div className="ds-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
    <span className="mono" style={{ fontSize: 11, color: "var(--color-cyan)" }}>Soundtrack</span>
    <audio controls src={`/api/assets/${slug}/music/${m.music.path.split("/").pop()}`} style={{ width: "100%", height: 34 }} />
    {editable && (
      <select
        className="input"
        value={m.music.trackId}
        disabled={!!busy}
        onChange={(e) => post("segments", { op: "setMusicTrack", trackId: e.target.value })}
      >
        {tracks.map((t) => (
          <option key={t.id} value={t.id}>{t.title} — {t.composer}</option>
        ))}
      </select>
    )}
  </div>
)}
```

(`editable`, `busy`, and `post` already exist in `GateClient`. The assets route serves `/api/assets/<slug>/music/<file>` with no change. If the assemble gate currently renders a bare fragment, wrap its children so this card sits above the existing content.)

- [ ] **Step 4: Typecheck web**

Run: `npx tsc --noEmit -p packages/web`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/p/[slug]/page.tsx packages/web/src/app/p/[slug]/GateClient.tsx
git commit -m "feat(web): soundtrack picker + preview in assemble gate"
```

---

### Task 9: Integration — full verify + render check

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: exit 0 (core + render + web).

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all green; the new music tests included.

- [ ] **Step 3: Render-verify the music layer on real assets.** Build a short props file that includes a `music` block pointing at a real track, copy that track into a scratch project's `assets/music`, render ~2s, and confirm the MP4 has an audio stream.

```bash
P="$PWD/projects/the-discovery-of-the-breakthrough-drug-rapamycin-on-the-the-significance-of-easter-island"
mkdir -p "$P/assets/music" "$P/out"
cp packages/core/assets/music/schellekens-medieval.mp3 "$P/assets/music/"
cat > "$P/out/musicProps.json" <<'JSON'
{ "props": {
  "fps": 30, "aspectRatio": "16:9",
  "music": { "path": "assets/music/schellekens-medieval.mp3", "volume": 0.15 },
  "segments": [ { "id": "seg-001", "durationInFrames": 60, "words": [],
    "stills": [ { "imagePath": "assets/images/seg-001.png", "durationInFrames": 60,
      "kenBurns": { "from": {"x":0,"y":0,"w":1,"h":1}, "to": {"x":0.1,"y":0.1,"w":0.8,"h":0.8} } } ] } ]
} }
JSON
cd packages/render
npx remotion render src/index.ts Documentary "$P/out/music-check.mp4" --frames=0-59 --props="$P/out/musicProps.json" --public-dir="$P"
```

Expected: render exits 0 and writes `music-check.mp4`.

- [ ] **Step 4: Confirm the output has an audio stream.** From the repo root:

```bash
node -e "import('mediabunny').then(async ({Input,ALL_FORMATS,FilePathSource})=>{const i=new Input({formats:ALL_FORMATS,source:new FilePathSource(process.argv[1])});const t=await i.getTracks();console.log('tracks:',t.map(x=>x.type));}).catch(e=>console.log('err',e.message))" \
  "projects/the-discovery-of-the-breakthrough-drug-rapamycin-on-the-the-significance-of-easter-island/out/music-check.mp4"
```

Expected: the track list includes `"audio"`. (Distinguishing the music in the mix is a manual ear-check — optionally play the MP4.)

- [ ] **Step 5: Clean up scratch artifacts**

```bash
P="projects/the-discovery-of-the-breakthrough-drug-rapamycin-on-the-the-significance-of-easter-island"
rm -f "$P/out/musicProps.json" "$P/out/music-check.mp4" "$P/assets/music/schellekens-medieval.mp3"
```

- [ ] **Step 6: Final confirmation**

Confirm `git status` shows only intended changes are committed and the working tree is clean. The feature is complete.

---

## Self-Review

**Spec coverage:**
- §2 copy-into-project + library resolution → Tasks 2 (resolver), 4 (assemble copy), 7 (override copy + injected libDir). ✓
- §3 catalog (2 vetted tracks) → Task 2. ✓
- §4 `manifest.music` → Task 1. ✓
- §5 `pickTrack` + assemble auto-pick + `setMusicTrack` override → Tasks 2, 4, 7. ✓
- §6 render (loop, fixed volume, fades; `buildInputProps.music`) → Tasks 5, 6. ✓
- §7 UI (assemble gate picker + preview; `setMusicTrack` op; `CATALOG` exposure) → Tasks 7, 8. ✓
- §Deployment (Dockerfile) → covered by existing `COPY . .`; no task needed (noted in Global Constraints). ✓
- §Testing (pickTrack, assemble, buildInputProps, edits, render MP4 audio) → Tasks 2, 4, 5, 7, 9. ✓
- Constants (`DEFAULT_MUSIC_VOLUME`, fades) → Tasks 4, 6. ✓

**Placeholder scan:** none — every code step shows complete code.

**Type consistency:** `Track`, `CATALOG`, `pickTrack`, `trackSourcePath`, `musicLibraryDir` (Task 2) are used with matching signatures in Tasks 4, 7. `manifest.music` shape `{ trackId, path, volume }` (Task 1) is consistent across Tasks 4, 5, 7, 8. `runAssemble(dir, { musicLibDir })` (Task 4) matches the runner call (Task 7). `DocumentaryProps.music` (Task 5) matches `Music`/`musicVolume` usage (Task 6). `setMusicTrack(dir, trackId, { musicLibDir })` (Task 7) matches the route dispatch (Task 7) and UI op (Task 8). ✓
