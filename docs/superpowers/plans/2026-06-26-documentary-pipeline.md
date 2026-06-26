# Documentary Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, checkpointed pipeline that turns a topic into a 5–10 minute narrated-stills (Ken Burns) documentary via deterministic LLM/API stages, a JSON manifest source-of-truth, four human review gates, and a local Next.js UI.

**Architecture:** An npm-workspaces monorepo with three units. `packages/core` is pure TypeScript: a zod-validated manifest, injectable provider clients, and idempotent per-segment stage functions. `packages/render` is a Remotion project that consumes the manifest as input props. `packages/web` is a thin Next.js app that calls `core` and renders the review gates. The manifest (`projects/<slug>/manifest.json`) is the only thing crossing unit boundaries.

**Tech Stack:** TypeScript, Node ≥ 20, npm workspaces, zod, Vitest, Next.js 15 (App Router), Remotion 4, `@anthropic-ai/sdk`, `replicate` (Flux for images, Kokoro + WhisperX for narration/timestamps).

## Global Constraints

- Node.js ≥ 20.12, npm ≥ 10. Use npm workspaces (no pnpm/yarn). (20.12 is required for `process.loadEnvFile`; see Task 14.)
- TypeScript strict mode on. ESM modules (`"type": "module"`) in `core`.
- `packages/core` MUST NOT import React, Next.js, or any HTTP framework. Pure functions over `(projectDir, deps)`.
- Providers are INJECTED into stages via a `StageDeps` object so tests use fakes. No stage constructs a real provider client itself.
- Stages are idempotent and segment-scoped: they only ADD their own slice to segments, never mutate upstream fields, persist each segment as it completes, and SKIP segments already populated-and-approved.
- One image per segment for v1 (`segment.shot` is singular, not an array).
- The manifest is validated against the zod schema on every read; malformed manifests throw.
- Visual style is narrated stills + Ken Burns only. No generated video, no background music, no research step in v1.
- Secrets come from a git-ignored root `.env`: `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`. (`REPLICATE_API_TOKEN` powers both images (Flux) and narration (Kokoro + WhisperX) — see Task 7.)
- Commit after every task. Conventional-commit messages.

---

## File Structure

```
documentary-pipeline/
├── package.json                       # workspaces root
├── tsconfig.base.json
├── vitest.config.ts
├── .env                               # git-ignored
├── .gitignore
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── manifest.ts            # zod schema, types, load/save, canRun
│   │       ├── project.ts             # createProject, paths
│   │       ├── providers/
│   │       │   ├── types.ts           # LlmClient, ImageClient, TtsClient interfaces
│   │       │   ├── anthropic.ts       # real LlmClient
│   │       │   ├── replicate.ts       # real ImageClient
│   │       │   └── elevenlabs.ts      # real TtsClient
│   │       ├── stages/
│   │       │   ├── deps.ts            # StageDeps type + realDeps() factory
│   │       │   ├── script.ts
│   │       │   ├── shotlist.ts
│   │       │   ├── images.ts
│   │       │   ├── voiceover.ts
│   │       │   └── assemble.ts
│   │       └── index.ts               # public exports
│   ├── render/
│   │   ├── package.json
│   │   ├── remotion.config.ts
│   │   └── src/
│   │       ├── Root.tsx               # registers Composition w/ calculateMetadata
│   │       ├── Documentary.tsx        # maps segments → <Sequence>
│   │       └── Segment.tsx            # Ken Burns image + audio + caption
│   └── web/
│       ├── package.json
│       ├── next.config.ts
│       └── src/app/...                # project list, gate pages, route handlers
└── projects/<slug>/                   # manifest.json + assets/{images,audio}/ + out/ + runs/
```

Tests live next to source as `*.test.ts` under each package's `src/`.

---

## Phase 0 — Scaffolding

### Task 1: Monorepo scaffold + core package skeleton

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Test: `packages/core/src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable `@doc/core` workspace; `npm test` runs Vitest across workspaces.

- [ ] **Step 1: Create the git repo and root files**

```bash
mkdir documentary-pipeline && cd documentary-pipeline && git init
```

Create `package.json`:

```json
{
  "name": "documentary-pipeline",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p packages/core && tsc --noEmit -p packages/render && tsc --noEmit -p packages/web"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/src/**/*.test.ts"], environment: "node" },
});
```

Create `.gitignore`:

```
node_modules/
dist/
.env
projects/*/assets/
projects/*/out/
projects/*/runs/
.next/
```

Create `.env.example`:

```
ANTHROPIC_API_KEY=
REPLICATE_API_TOKEN=
```

- [ ] **Step 2: Create the core package skeleton**

`packages/core/package.json`:

```json
{
  "name": "@doc/core",
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.23.0" }
}
```

`packages/core/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/src/index.ts`:

```ts
export const CORE_VERSION = 1;
```

- [ ] **Step 3: Write the failing smoke test**

`packages/core/src/smoke.test.ts`:

```ts
import { expect, test } from "vitest";
import { CORE_VERSION } from "./index.js";

test("core package is wired up", () => {
  expect(CORE_VERSION).toBe(1);
});
```

- [ ] **Step 4: Install and run**

Run: `npm install && npm test`
Expected: 1 passing test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold monorepo and core package"
```

---

## Phase 1 — Manifest (the contract)

### Task 2: Manifest schema and types

**Files:**
- Create: `packages/core/src/manifest.ts`
- Test: `packages/core/src/manifest.schema.test.ts`

**Interfaces:**
- Produces:
  - `ManifestSchema` (zod), `type Manifest = z.infer<typeof ManifestSchema>`
  - `type StageName = "script" | "shotlist" | "images" | "voiceover" | "assemble"`
  - `type Segment` = element of `Manifest["segments"]`
  - `type Rect = { x: number; y: number; w: number; h: number }` (normalized 0–1 crop)

- [ ] **Step 1: Write the failing test**

`packages/core/src/manifest.schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { ManifestSchema } from "./manifest.js";

const minimal = {
  version: 1,
  slug: "test-doc",
  createdAt: "2026-06-26T00:00:00.000Z",
  brief: {
    topic: "The history of lighthouses",
    targetMinutes: 6,
    tone: "wistful, archival",
    aspectRatio: "16:9",
    imageStyle: "1970s 35mm film, muted",
  },
  stages: {
    script: { status: "pending" },
    shotlist: { status: "pending" },
    images: { status: "pending" },
    voiceover: { status: "pending" },
    assemble: { status: "pending" },
  },
  segments: [],
};

test("accepts a minimal valid manifest", () => {
  const parsed = ManifestSchema.parse(minimal);
  expect(parsed.slug).toBe("test-doc");
});

test("rejects an unknown aspectRatio", () => {
  const bad = { ...minimal, brief: { ...minimal.brief, aspectRatio: "4:3" } };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});

test("rejects an unknown stage status", () => {
  const bad = {
    ...minimal,
    stages: { ...minimal.stages, script: { status: "wat" } },
  };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});

test("accepts a fully-populated segment", () => {
  const full = {
    ...minimal,
    segments: [
      {
        id: "seg-001",
        order: 0,
        narration: "Long before satellites...",
        shot: {
          imagePrompt: "a stone lighthouse at dusk, 1970s 35mm film",
          kenBurns: {
            from: { x: 0, y: 0, w: 1, h: 1 },
            to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
          },
        },
        image: {
          path: "assets/images/seg-001.png",
          seed: 42,
          provider: "replicate:flux-1.1-pro",
          approved: true,
        },
        audio: {
          path: "assets/audio/seg-001.wav",
          durationSec: 4.2,
          words: [{ word: "Long", start: 0, end: 0.3 }],
        },
      },
    ],
  };
  expect(ManifestSchema.parse(full).segments[0].image?.seed).toBe(42);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manifest.schema`
Expected: FAIL — cannot find module `./manifest.js`.

- [ ] **Step 3: Write the schema**

`packages/core/src/manifest.ts`:

```ts
import { z } from "zod";

export const RectSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

export const STAGE_NAMES = ["script", "shotlist", "images", "voiceover", "assemble"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

const StageStateSchema = z.object({
  status: z.enum(["pending", "running", "awaiting_review", "approved", "error"]),
  error: z.string().optional(),
  completedAt: z.string().optional(),
});

const WordSchema = z.object({ word: z.string(), start: z.number(), end: z.number() });

const SegmentSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  narration: z.string(),
  shot: z.object({
    imagePrompt: z.string(),
    kenBurns: z.object({ from: RectSchema, to: RectSchema }),
  }).optional(),
  image: z.object({
    path: z.string(),
    seed: z.number().int(),
    provider: z.string(),
    approved: z.boolean(),
    needsRegen: z.boolean().optional(), // set by rejectImage; triggers single-segment regen
  }).optional(),
  audio: z.object({
    path: z.string(),
    durationSec: z.number(),
    words: z.array(WordSchema),
  }).optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  slug: z.string(),
  createdAt: z.string(),
  brief: z.object({
    topic: z.string(),
    targetMinutes: z.number(),
    tone: z.string(),
    audience: z.string().optional(),
    aspectRatio: z.enum(["16:9", "9:16"]),
    imageStyle: z.string(),
  }),
  stages: z.object(
    Object.fromEntries(STAGE_NAMES.map((n) => [n, StageStateSchema])) as Record<
      StageName,
      typeof StageStateSchema
    >,
  ),
  segments: z.array(SegmentSchema),
  timeline: z.object({
    fps: z.number(),
    totalDurationSec: z.number(),
  }).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- manifest.schema`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): manifest zod schema and types"
```

---

### Task 3: Manifest load/save with validation

**Files:**
- Modify: `packages/core/src/manifest.ts` (add `loadManifest`, `saveManifest`)
- Test: `packages/core/src/manifest.io.test.ts`

**Interfaces:**
- Consumes: `ManifestSchema`, `Manifest` (Task 2).
- Produces:
  - `loadManifest(projectDir: string): Manifest` — reads `<projectDir>/manifest.json`, validates, throws on malformed.
  - `saveManifest(projectDir: string, m: Manifest): void` — validates then writes pretty JSON.

- [ ] **Step 1: Write the failing test**

`packages/core/src/manifest.io.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, saveManifest, type Manifest } from "./manifest.js";

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "doc-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const sample: Manifest = {
  version: 1, slug: "x", createdAt: "2026-06-26T00:00:00.000Z",
  brief: { topic: "t", targetMinutes: 6, tone: "calm", aspectRatio: "16:9", imageStyle: "film" },
  stages: {
    script: { status: "pending" }, shotlist: { status: "pending" },
    images: { status: "pending" }, voiceover: { status: "pending" }, assemble: { status: "pending" },
  },
  segments: [],
};

test("save then load round-trips", () => {
  const d = tmp();
  saveManifest(d, sample);
  expect(loadManifest(d)).toEqual(sample);
});

test("load throws on malformed manifest", () => {
  const d = tmp();
  writeFileSync(join(d, "manifest.json"), JSON.stringify({ version: 1 }));
  expect(() => loadManifest(d)).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manifest.io`
Expected: FAIL — `loadManifest` not exported.

- [ ] **Step 3: Implement load/save**

Append to `packages/core/src/manifest.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function loadManifest(projectDir: string): Manifest {
  const raw = readFileSync(join(projectDir, "manifest.json"), "utf8");
  return ManifestSchema.parse(JSON.parse(raw));
}

export function saveManifest(projectDir: string, m: Manifest): void {
  const valid = ManifestSchema.parse(m);
  writeFileSync(join(projectDir, "manifest.json"), JSON.stringify(valid, null, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- manifest.io`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): validated manifest load/save"
```

---

### Task 4: Gate ordering (`canRun`)

**Files:**
- Modify: `packages/core/src/manifest.ts` (add `canRun`)
- Test: `packages/core/src/manifest.gate.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `StageName`, `STAGE_NAMES`.
- Produces: `canRun(m: Manifest, stage: StageName): boolean` — true iff every earlier stage has `status === "approved"` (script has no predecessor, so it can always run).

- [ ] **Step 1: Write the failing test**

`packages/core/src/manifest.gate.test.ts`:

```ts
import { expect, test } from "vitest";
import { canRun, type Manifest } from "./manifest.js";

function m(over: Partial<Manifest["stages"]>): Manifest {
  return {
    version: 1, slug: "x", createdAt: "2026-06-26T00:00:00.000Z",
    brief: { topic: "t", targetMinutes: 6, tone: "c", aspectRatio: "16:9", imageStyle: "f" },
    stages: {
      script: { status: "pending" }, shotlist: { status: "pending" },
      images: { status: "pending" }, voiceover: { status: "pending" }, assemble: { status: "pending" },
      ...over,
    },
    segments: [],
  };
}

test("script can always run", () => {
  expect(canRun(m({}), "script")).toBe(true);
});

test("shotlist blocked until script approved", () => {
  expect(canRun(m({}), "shotlist")).toBe(false);
  expect(canRun(m({ script: { status: "approved" } }), "shotlist")).toBe(true);
});

test("images blocked until script AND shotlist approved", () => {
  expect(canRun(m({ script: { status: "approved" } }), "images")).toBe(false);
  expect(
    canRun(m({ script: { status: "approved" }, shotlist: { status: "approved" } }), "images"),
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- manifest.gate`
Expected: FAIL — `canRun` not exported.

- [ ] **Step 3: Implement**

Append to `packages/core/src/manifest.ts`:

```ts
export function canRun(m: Manifest, stage: StageName): boolean {
  const idx = STAGE_NAMES.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    if (m.stages[STAGE_NAMES[i]].status !== "approved") return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- manifest.gate`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): canRun gate ordering"
```

---

### Task 5: Project creation

**Files:**
- Create: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts` (re-export)
- Test: `packages/core/src/project.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `saveManifest`, `STAGE_NAMES`.
- Produces:
  - `type Brief = Manifest["brief"]`
  - `createProject(rootDir: string, slug: string, brief: Brief, now: string): string` — creates `<rootDir>/<slug>/` with `assets/images`, `assets/audio`, `out`, `runs` subdirs and an initial manifest (all stages `pending`, empty segments); returns the project dir. `now` is an ISO string injected by the caller (no `Date.now()` inside, for testability).
  - `projectPaths(projectDir)` → `{ images, audio, out, runs }` absolute paths.

- [ ] **Step 1: Write the failing test**

`packages/core/src/project.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "./project.js";
import { loadManifest } from "./manifest.js";

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "root-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("creates project dir, subdirs, and initial manifest", () => {
  const root = tmp();
  const dir = createProject(root, "lighthouses", {
    topic: "Lighthouses", targetMinutes: 6, tone: "wistful",
    aspectRatio: "16:9", imageStyle: "35mm film",
  }, "2026-06-26T00:00:00.000Z");

  expect(existsSync(join(dir, "assets/images"))).toBe(true);
  expect(existsSync(join(dir, "assets/audio"))).toBe(true);
  const man = loadManifest(dir);
  expect(man.slug).toBe("lighthouses");
  expect(man.stages.script.status).toBe("pending");
  expect(man.segments).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- project`
Expected: FAIL — cannot find `./project.js`.

- [ ] **Step 3: Implement**

`packages/core/src/project.ts`:

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { STAGE_NAMES, saveManifest, type Manifest } from "./manifest.js";

export type Brief = Manifest["brief"];

export function projectPaths(projectDir: string) {
  return {
    images: join(projectDir, "assets/images"),
    audio: join(projectDir, "assets/audio"),
    out: join(projectDir, "out"),
    runs: join(projectDir, "runs"),
  };
}

export function createProject(rootDir: string, slug: string, brief: Brief, now: string): string {
  const dir = join(rootDir, slug);
  const p = projectPaths(dir);
  for (const d of [p.images, p.audio, p.out, p.runs]) mkdirSync(d, { recursive: true });

  const stages = Object.fromEntries(
    STAGE_NAMES.map((n) => [n, { status: "pending" as const }]),
  ) as Manifest["stages"];

  saveManifest(dir, { version: 1, slug, createdAt: now, brief, stages, segments: [] });
  return dir;
}
```

Update `packages/core/src/index.ts`:

```ts
export const CORE_VERSION = 1;
export * from "./manifest.js";
export * from "./project.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- project`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): createProject and project paths"
```

---

## Phase 2 — Provider interfaces (injectable)

### Task 6: Provider interfaces + StageDeps

**Files:**
- Create: `packages/core/src/providers/types.ts`
- Create: `packages/core/src/stages/deps.ts`
- Test: `packages/core/src/providers/types.test.ts`

**Interfaces:**
- Produces:
  - `interface LlmClient { complete<T>(args: { system: string; user: string; schema: ZodSchema<T> }): Promise<T> }`
  - `interface ImageClient { generate(args: { prompt: string; seed: number; width: number; height: number }): Promise<{ url: string; provider: string }> }`
  - `interface TtsClient { speak(args: { text: string; voiceId: string }): Promise<{ audio: Buffer; words: Word[] }> }` where `Word = { word: string; start: number; end: number }`
  - `type StageDeps = { llm: LlmClient; images: ImageClient; tts: TtsClient }`
  - `makeFakeDeps(overrides?: Partial<StageDeps>): StageDeps` — test helper returning no-op fakes; exported from `deps.ts` for reuse in stage tests.

- [ ] **Step 1: Write the failing test**

`packages/core/src/providers/types.test.ts`:

```ts
import { expect, test } from "vitest";
import { z } from "zod";
import { makeFakeDeps } from "../stages/deps.js";

test("fake llm returns schema-typed object the caller supplies", async () => {
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({ value: 7 }) },
  });
  const out = await deps.llm.complete({
    system: "s", user: "u", schema: z.object({ value: z.number() }),
  });
  expect(out.value).toBe(7);
});

test("fake deps provide all three clients", () => {
  const deps = makeFakeDeps();
  expect(typeof deps.llm.complete).toBe("function");
  expect(typeof deps.images.generate).toBe("function");
  expect(typeof deps.tts.speak).toBe("function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- providers/types`
Expected: FAIL — cannot find `../stages/deps.js`.

- [ ] **Step 3: Implement interfaces and fakes**

`packages/core/src/providers/types.ts`:

```ts
import type { ZodSchema } from "zod";

export type Word = { word: string; start: number; end: number };

export interface LlmClient {
  complete<T>(args: { system: string; user: string; schema: ZodSchema<T> }): Promise<T>;
}

export interface ImageClient {
  generate(args: { prompt: string; seed: number; width: number; height: number }): Promise<{
    url: string;
    provider: string;
  }>;
}

export interface TtsClient {
  speak(args: { text: string; voiceId: string }): Promise<{ audio: Buffer; words: Word[] }>;
}
```

`packages/core/src/stages/deps.ts`:

```ts
import type { ImageClient, LlmClient, TtsClient } from "../providers/types.js";

export type StageDeps = { llm: LlmClient; images: ImageClient; tts: TtsClient };

export function makeFakeDeps(overrides: Partial<StageDeps> = {}): StageDeps {
  return {
    llm: { complete: async ({ schema }) => schema.parse({}) },
    images: { generate: async () => ({ url: "http://fake/img.png", provider: "fake" }) },
    tts: { speak: async () => ({ audio: Buffer.from(""), words: [] }) },
    ...overrides,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- providers/types`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): provider interfaces and fake StageDeps"
```

---

### Task 7: Real provider clients (Anthropic LLM, Replicate Flux/Kokoro/WhisperX)

**Files:**
- Create: `packages/core/src/providers/anthropic.ts`, `replicate.ts`, `replicate-tts.ts`, `elevenlabs.ts`
- Modify: `packages/core/package.json` (add deps), `packages/core/src/stages/deps.ts` (add `realDeps()`)
- Test: `packages/core/src/providers/realdeps.test.ts`

> Narration runs entirely on Replicate: **Kokoro-82M** for synthesis + **WhisperX** for word-level timestamps (`replicate-tts.ts`), both via the same `REPLICATE_API_TOKEN` as images. `elevenlabs.ts` is still created as a documented, **unwired** alternative `TtsClient` (and its pure `charsToWords` helper stays unit-tested) — switching back is a one-line change in `realDeps`.

**Interfaces:**
- Consumes: `LlmClient`, `ImageClient`, `TtsClient`, `StageDeps`.
- Produces:
  - `anthropicLlm(apiKey: string, model?: string): LlmClient`
  - `replicateImages(token: string, model?: string): ImageClient`
  - `replicateTts(token: string, opts?: { ttsModel?: string; alignModel?: string }): TtsClient` — Kokoro synth → WhisperX alignment; the wired narration provider.
  - `elevenLabsTts(apiKey: string): TtsClient` — unwired alternative, kept for `charsToWords` coverage and easy switch-back.
  - `realDeps(env: NodeJS.ProcessEnv): StageDeps` — builds llm + images + tts from env vars (only `ANTHROPIC_API_KEY` and `REPLICATE_API_TOKEN` are required); throws a clear error if a required key is missing.

These wrap network SDKs, so they are NOT unit-tested against live APIs. The only test asserts `realDeps` throws when keys are absent (fail-loud behavior). Integration with live services is validated manually via the web UI.

- [ ] **Step 1: Add dependencies**

In `packages/core/package.json` add to `dependencies`:

```json
"@anthropic-ai/sdk": "^0.32.0",
"replicate": "^1.0.0"
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

`packages/core/src/providers/realdeps.test.ts`:

```ts
import { expect, test } from "vitest";
import { realDeps } from "../stages/deps.js";

test("realDeps throws a clear error when a key is missing", () => {
  expect(() => realDeps({ ANTHROPIC_API_KEY: "a" }))
    .toThrow(/REPLICATE_API_TOKEN/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- realdeps`
Expected: FAIL — `realDeps` not exported.

- [ ] **Step 4: Implement the clients**

`packages/core/src/providers/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmClient } from "./types.js";

export function anthropicLlm(apiKey: string, model = "claude-opus-4-8"): LlmClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete({ system, user, schema }) {
      // Force structured output via a single tool the model must call.
      const jsonSchema = zodToJsonSchema(schema, "Result");
      const res = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        tools: [{
          name: "emit_result",
          description: "Return the structured result.",
          input_schema: (jsonSchema.definitions?.Result ?? jsonSchema) as any,
        }],
        tool_choice: { type: "tool", name: "emit_result" },
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") throw new Error("LLM returned no tool_use");
      return schema.parse(block.input);
    },
  };
}
```

Add `"zod-to-json-schema": "^3.23.0"` to `packages/core/package.json` dependencies and `npm install`.

`packages/core/src/providers/replicate.ts`:

```ts
import Replicate from "replicate";
import type { ImageClient } from "./types.js";

export function replicateImages(token: string, model = "black-forest-labs/flux-1.1-pro"): ImageClient {
  const client = new Replicate({ auth: token });
  return {
    async generate({ prompt, seed, width, height }) {
      const output = await client.run(model as `${string}/${string}`, {
        input: { prompt, seed, width, height, output_format: "png" },
      });
      // Flux returns a single image URL (or array of one).
      const url = Array.isArray(output) ? String(output[0]) : String(output);
      return { url, provider: `replicate:${model}` };
    },
  };
}
```

`packages/core/src/providers/elevenlabs.ts`:

```ts
import type { TtsClient, Word } from "./types.js";

// ElevenLabs "with-timestamps" endpoint returns base64 audio + per-character
// alignment. We collapse characters into words here.
export function elevenLabsTts(apiKey: string): TtsClient {
  return {
    async speak({ text, voiceId }) {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        audio_base64: string;
        alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
      };
      const audio = Buffer.from(data.audio_base64, "base64");
      const words = charsToWords(data.alignment);
      return { audio, words };
    },
  };
}

export function charsToWords(a: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}): Word[] {
  const words: Word[] = [];
  let cur = "", start = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (ch === " ") {
      if (cur) words.push({ word: cur, start, end: a.character_end_times_seconds[i - 1] ?? start });
      cur = "";
    } else {
      if (!cur) start = a.character_start_times_seconds[i];
      cur += ch;
    }
  }
  if (cur) words.push({ word: cur, start, end: a.character_end_times_seconds.at(-1) ?? start });
  return words;
}
```

`packages/core/src/providers/replicate-tts.ts` (the wired narration provider — Kokoro synth + WhisperX timestamps, both on Replicate; no new npm deps beyond the `replicate` client added above):

```ts
import Replicate from "replicate";
import type { TtsClient, Word } from "./types.js";

// Kokoro-82M (synthesis) + WhisperX (word-level timestamps), both on Replicate.
// Kokoro returns a single WAV-file URL; WhisperX returns segments[].words[] with
// per-word start/end. Two calls per segment, but it all rides the same
// REPLICATE_API_TOKEN already used for images. WhisperX re-transcribes the audio
// to align — accurate enough for narration captions.

const KOKORO = "jaaari/kokoro-82m";
const WHISPERX = "victor-upmeet/whisperx";

type WhisperXOutput = {
  segments: Array<{ words?: Array<{ word: string; start?: number; end?: number }> }>;
};

// replicate@1 may hand back a FileOutput (with .url()), an array of them, or a
// plain URL string depending on the model version — normalize to a URL string.
function firstUrl(output: unknown): string {
  const item = Array.isArray(output) ? output[0] : output;
  if (item && typeof item === "object" && "url" in item) {
    const u = (item as { url: unknown }).url;
    return typeof u === "function" ? String((u as () => unknown).call(item)) : String(u);
  }
  return String(item);
}

export function replicateTts(
  token: string,
  opts: { ttsModel?: string; alignModel?: string } = {},
): TtsClient {
  const client = new Replicate({ auth: token });
  const ttsModel = (opts.ttsModel ?? KOKORO) as `${string}/${string}`;
  const alignModel = (opts.alignModel ?? WHISPERX) as `${string}/${string}`;

  return {
    async speak({ text, voiceId }) {
      // 1) Synthesize. voiceId is a Kokoro voice name, e.g. "af_sarah", "am_michael".
      const ttsOut = await client.run(ttsModel, {
        input: { text, voice: voiceId, speed: 1 },
      });
      const audioUrl = firstUrl(ttsOut);

      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Kokoro audio download failed: ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());

      // 2) Align. Pass the Kokoro URL straight to WhisperX for word timestamps.
      const alignOut = (await client.run(alignModel, {
        input: { audio_file: audioUrl, language: "en", align_output: true },
      })) as WhisperXOutput;

      const words: Word[] = (alignOut.segments ?? [])
        .flatMap((s) => s.words ?? [])
        .filter((w): w is { word: string; start: number; end: number } =>
          typeof w.start === "number" && typeof w.end === "number")
        .map((w) => ({ word: w.word, start: w.start, end: w.end }));

      return { audio, words };
    },
  };
}
```

Verify the current input/output field names on the two Replicate model pages before pinning (Kokoro: `text`/`voice`/`speed`; WhisperX: `audio_file`/`language`/`align_output` → `segments[].words[]`). The `firstUrl` helper and defensive filtering exist because `replicate@1` returns `FileOutput` objects, not bare strings — apply the same `firstUrl` fix to `replicate.ts`'s image client (it currently uses `String(output)`).

Append to `packages/core/src/stages/deps.ts`:

```ts
import { anthropicLlm } from "../providers/anthropic.js";
import { replicateImages } from "../providers/replicate.js";
import { replicateTts } from "../providers/replicate-tts.js";

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

export function realDeps(env: NodeJS.ProcessEnv): StageDeps {
  const replicateToken = required(env, "REPLICATE_API_TOKEN");
  return {
    llm: anthropicLlm(required(env, "ANTHROPIC_API_KEY")),
    images: replicateImages(replicateToken),
    tts: replicateTts(replicateToken), // same token powers images + narration
  };
}
```

- [ ] **Step 5: Add a unit test for the pure `charsToWords` helper**

Append to `packages/core/src/providers/realdeps.test.ts`:

```ts
import { charsToWords } from "../providers/elevenlabs.js";

test("charsToWords groups characters into words", () => {
  const words = charsToWords({
    characters: ["H", "i", " ", "y", "o", "u"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  });
  expect(words.map((w) => w.word)).toEqual(["Hi", "you"]);
  expect(words[0].start).toBe(0);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- realdeps`
Expected: 2 passing (throws-on-missing-key + charsToWords).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(core): real Anthropic + Replicate (Flux/Kokoro/WhisperX) clients + realDeps"
```

---

## Phase 3 — Stages

### Task 8: `runScript` stage

**Files:**
- Create: `packages/core/src/stages/script.ts`
- Test: `packages/core/src/stages/script.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `StageDeps`, `LlmClient`.
- Produces: `runScript(projectDir: string, deps: StageDeps): Promise<void>` — calls the LLM once to produce ordered narration segments, assigns ids `seg-001…`, writes `segments`, sets `stages.script.status = "awaiting_review"`. Idempotent: if `segments` already non-empty AND `stages.script.status` is `approved`, it returns without calling the LLM.

- [ ] **Step 1: Write the failing test**

`packages/core/src/stages/script.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest } from "../manifest.js";
import { runScript } from "./script.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  return createProject(root, "doc", {
    topic: "Lighthouses", targetMinutes: 6, tone: "wistful", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("writes ordered segments with ids and sets awaiting_review", async () => {
  const dir = project();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) =>
      schema.parse({ segments: [{ narration: "First beat." }, { narration: "Second beat." }] }) },
  });

  await runScript(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments.map((s) => s.id)).toEqual(["seg-001", "seg-002"]);
  expect(m.segments.map((s) => s.order)).toEqual([0, 1]);
  expect(m.segments[0].narration).toBe("First beat.");
  expect(m.stages.script.status).toBe("awaiting_review");
});

test("is idempotent once approved (does not call the LLM again)", async () => {
  const dir = project();
  await runScript(dir, makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({ segments: [{ narration: "A" }] }) },
  }));
  // approve it
  const m = loadManifest(dir);
  m.stages.script.status = "approved";
  const { saveManifest } = await import("../manifest.js");
  saveManifest(dir, m);

  let called = false;
  await runScript(dir, makeFakeDeps({
    llm: { complete: async ({ schema }) => { called = true; return schema.parse({ segments: [] }); } },
  }));
  expect(called).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stages/script`
Expected: FAIL — cannot find `./script.js`.

- [ ] **Step 3: Implement**

`packages/core/src/stages/script.ts`:

```ts
import { z } from "zod";
import { loadManifest, saveManifest } from "../manifest.js";
import type { StageDeps } from "./deps.js";

const ScriptOutput = z.object({
  segments: z.array(z.object({ narration: z.string() })).min(1),
});

export async function runScript(projectDir: string, deps: StageDeps): Promise<void> {
  const m = loadManifest(projectDir);
  if (m.segments.length > 0 && m.stages.script.status === "approved") return;

  m.stages.script.status = "running";
  saveManifest(projectDir, m);

  const targetWords = Math.round(m.brief.targetMinutes * 150);
  const out = await deps.llm.complete({
    system:
      "You are a documentary scriptwriter. Write narration as a sequence of short beats " +
      "(2-4 sentences each), suitable for one still image per beat.",
    user:
      `Topic: ${m.brief.topic}\nTone: ${m.brief.tone}\nAudience: ${m.brief.audience ?? "general"}\n` +
      `Aim for roughly ${targetWords} total words across the beats.`,
    schema: ScriptOutput,
  });

  m.segments = out.segments.map((s, i) => ({
    id: `seg-${String(i + 1).padStart(3, "0")}`,
    order: i,
    narration: s.narration,
  }));
  m.stages.script.status = "awaiting_review";
  m.stages.script.completedAt = new Date(0).toISOString(); // overwritten by web layer w/ real time
  saveManifest(projectDir, m);
}
```

Note: `completedAt` is set by the web layer with the real timestamp; in `core` we avoid wall-clock reads. Replace the line above with `delete m.stages.script.completedAt;` if you prefer the web layer to own it entirely — either is fine, keep it consistent across stages.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stages/script`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): runScript stage"
```

---

### Task 9: `runShotlist` stage

**Files:**
- Create: `packages/core/src/stages/shotlist.ts`
- Test: `packages/core/src/stages/shotlist.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `StageDeps`.
- Produces: `runShotlist(projectDir, deps): Promise<void>` — for each segment lacking a `shot`, calls the LLM to produce an `imagePrompt` (appending `brief.imageStyle`) and a `kenBurns` move; sets `stages.shotlist.status = "awaiting_review"`. Skips segments that already have a `shot` (idempotent).

- [ ] **Step 1: Write the failing test**

`packages/core/src/stages/shotlist.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runShotlist } from "./shotlist.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function projectWithSegments() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "35mm film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  m.segments = [
    { id: "seg-001", order: 0, narration: "A stone tower." },
    { id: "seg-002", order: 1, narration: "Waves crash." },
  ];
  m.stages.script.status = "approved";
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("adds a shot with style-suffixed prompt to each segment", async () => {
  const dir = projectWithSegments();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({
      imagePrompt: "a stone tower at dusk", kenBurns: {
        from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      },
    }) },
  });

  await runShotlist(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments[0].shot?.imagePrompt).toContain("35mm film");
  expect(m.segments[1].shot?.kenBurns.to.w).toBe(0.8);
  expect(m.stages.shotlist.status).toBe("awaiting_review");
});

test("skips segments that already have a shot", async () => {
  const dir = projectWithSegments();
  let calls = 0;
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => { calls++; return schema.parse({
      imagePrompt: "x", kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } },
    }); } },
  });
  await runShotlist(dir, deps);          // 2 calls
  await runShotlist(dir, deps);          // 0 more — both already have shots
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stages/shotlist`
Expected: FAIL — cannot find `./shotlist.js`.

- [ ] **Step 3: Implement**

`packages/core/src/stages/shotlist.ts`:

```ts
import { z } from "zod";
import { loadManifest, saveManifest, RectSchema } from "../manifest.js";
import type { StageDeps } from "./deps.js";

const ShotOutput = z.object({
  imagePrompt: z.string(),
  kenBurns: z.object({ from: RectSchema, to: RectSchema }),
});

export async function runShotlist(projectDir: string, deps: StageDeps): Promise<void> {
  const m = loadManifest(projectDir);
  m.stages.shotlist.status = "running";
  saveManifest(projectDir, m);

  for (const seg of m.segments) {
    if (seg.shot) continue;
    const out = await deps.llm.complete({
      system:
        "You turn a narration beat into a single documentary still. Describe one vivid, " +
        "concrete image. Also choose a subtle Ken Burns move as two normalized crop rects " +
        "(x,y,w,h in 0..1); 'to' should be a gentle zoom or pan from 'from'.",
      user: `Narration: ${seg.narration}`,
      schema: ShotOutput,
    });
    seg.shot = {
      imagePrompt: `${out.imagePrompt}, ${m.brief.imageStyle}`,
      kenBurns: out.kenBurns,
    };
    saveManifest(projectDir, m); // persist per-segment
  }

  m.stages.shotlist.status = "awaiting_review";
  saveManifest(projectDir, m);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stages/shotlist`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): runShotlist stage"
```

---

### Task 10: `runImages` stage (idempotent, per-segment persist, download)

**Files:**
- Create: `packages/core/src/stages/images.ts`
- Test: `packages/core/src/stages/images.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `projectPaths`, `StageDeps`, `ImageClient`.
- Produces: `runImages(projectDir, deps, opts?: { fetchFn?: typeof fetch }): Promise<void>` — for each segment whose `image` is missing OR flagged `image.needsRegen === true`, derives width/height from `brief.aspectRatio`, picks a seed (`segment.image?.seed ?? deterministicSeed(seg.id)`), calls `deps.images.generate`, downloads the URL to `assets/images/<id>.png`, and sets `segment.image = { path, seed, provider, approved: false }` (which clears `needsRegen`). Persists after each segment. Sets `stages.images.status = "awaiting_review"`. SKIPS any segment that already has an `image` and is not flagged `needsRegen` (i.e. both approved images AND freshly-generated ones awaiting review) — so a plain re-run never re-spends on images that already exist. Only `rejectImage` (Task 16) flags a segment for regeneration. `fetchFn` is injectable for tests.
  - Helper `dimsFor(aspectRatio): { width: number; height: number }` → 16:9 = 1280×720, 9:16 = 720×1280.
  - Helper `deterministicSeed(id: string): number` → stable hash of the id (so re-runs reproduce unless caller changes it).

- [ ] **Step 1: Write the failing test**

`packages/core/src/stages/images.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runImages } from "./images.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function projectWithShots() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } };
  m.segments = [
    { id: "seg-001", order: 0, narration: "A", shot: { imagePrompt: "p1", kenBurns: kb } },
    { id: "seg-002", order: 1, narration: "B", shot: { imagePrompt: "p2", kenBurns: kb } },
  ];
  m.stages.script.status = "approved";
  m.stages.shotlist.status = "approved";
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const fakeFetch = (async () =>
  new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;

test("generates and downloads an image per segment", async () => {
  const dir = projectWithShots();
  const deps = makeFakeDeps({
    images: { generate: async () => ({ url: "http://fake/i.png", provider: "fake" }) },
  });

  await runImages(dir, deps, { fetchFn: fakeFetch });

  const m = loadManifest(dir);
  expect(m.segments[0].image?.path).toBe("assets/images/seg-001.png");
  expect(m.segments[0].image?.approved).toBe(false);
  expect(existsSync(join(dir, "assets/images/seg-001.png"))).toBe(true);
  expect(m.stages.images.status).toBe("awaiting_review");
});

test("skips segments whose image is already approved", async () => {
  const dir = projectWithShots();
  // Pre-approve seg-001
  let m = loadManifest(dir);
  m.segments[0].image = { path: "assets/images/seg-001.png", seed: 1, provider: "x", approved: true };
  saveManifest(dir, m);

  let calls = 0;
  const deps = makeFakeDeps({
    images: { generate: async () => { calls++; return { url: "http://fake/i.png", provider: "fake" }; } },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });
  expect(calls).toBe(1); // only seg-002 regenerated
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stages/images`
Expected: FAIL — cannot find `./images.js`.

- [ ] **Step 3: Implement**

`packages/core/src/stages/images.ts`:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, saveManifest, type Manifest } from "../manifest.js";
import { projectPaths } from "../project.js";
import type { StageDeps } from "./deps.js";

export function dimsFor(aspectRatio: Manifest["brief"]["aspectRatio"]) {
  return aspectRatio === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}

export function deterministicSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 1_000_000;
}

export async function runImages(
  projectDir: string,
  deps: StageDeps,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const m = loadManifest(projectDir);
  const { width, height } = dimsFor(m.brief.aspectRatio);

  m.stages.images.status = "running";
  saveManifest(projectDir, m);

  for (const seg of m.segments) {
    // Skip approved images AND freshly-generated ones awaiting review; only
    // (re)generate when the image is missing or explicitly flagged by rejectImage.
    if (seg.image && !seg.image.needsRegen) continue;
    if (!seg.shot) throw new Error(`Segment ${seg.id} has no shot; run shotlist first`);

    const seed = seg.image?.seed ?? deterministicSeed(seg.id);
    const { url, provider } = await deps.images.generate({
      prompt: seg.shot.imagePrompt, seed, width, height,
    });

    const res = await fetchFn(url);
    if (!res.ok) throw new Error(`Image download failed for ${seg.id}: ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const rel = `assets/images/${seg.id}.png`;
    writeFileSync(join(projectPaths(projectDir).images, `${seg.id}.png`), bytes);

    seg.image = { path: rel, seed, provider, approved: false };
    saveManifest(projectDir, m); // persist per-segment
  }

  m.stages.images.status = "awaiting_review";
  saveManifest(projectDir, m);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stages/images`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): runImages stage with per-segment persist and download"
```

---

### Task 11: `runVoiceover` stage

**Files:**
- Create: `packages/core/src/stages/voiceover.ts`
- Test: `packages/core/src/stages/voiceover.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `projectPaths`, `StageDeps`, `TtsClient`.
- Produces: `runVoiceover(projectDir, deps, opts?: { voiceId?: string; getDuration?: (filePath: string) => Promise<number> }): Promise<void>` — for each segment lacking `audio`, calls `deps.tts.speak`, writes `assets/audio/<id>.wav` (Kokoro emits WAV), measures the **real** audio length with Mediabunny (so the Sequence covers trailing silence, not just the last spoken word — per the remotion-best-practices `get-audio-duration` rule), and stores `words` (used for captions in render). Persists per-segment. Sets `stages.voiceover.status = "awaiting_review"`. Skips segments that already have `audio`. Default `voiceId` constant `DEFAULT_VOICE_ID` (a Kokoro voice name). `getDuration` is injectable for tests; the default `audioDurationSec` uses Mediabunny.

- [ ] **Step 1: Write the failing test**

`packages/core/src/stages/voiceover.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runVoiceover } from "./voiceover.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function projectWithSegments() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "Hello there." }];
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("writes audio file, duration, and words", async () => {
  const dir = projectWithSegments();
  const deps = makeFakeDeps({
    tts: { speak: async () => ({
      audio: Buffer.from([1, 2, 3]),
      words: [{ word: "Hello", start: 0, end: 0.5 }, { word: "there", start: 0.5, end: 1.0 }],
    }) },
  });

  // Inject a fake duration so the test stays pure (no real audio to parse).
  await runVoiceover(dir, deps, { getDuration: async () => 1.0 });

  const m = loadManifest(dir);
  expect(existsSync(join(dir, "assets/audio/seg-001.wav"))).toBe(true);
  expect(m.segments[0].audio?.durationSec).toBe(1.0);
  expect(m.segments[0].audio?.words.length).toBe(2);
  expect(m.stages.voiceover.status).toBe("awaiting_review");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stages/voiceover`
Expected: FAIL — cannot find `./voiceover.js`.

- [ ] **Step 3: Implement**

`packages/core/src/stages/voiceover.ts`:

First add `"mediabunny": "^1.0.0"` to `packages/core/package.json` dependencies and `npm install`. Then:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Input, ALL_FORMATS, FileSource } from "mediabunny";
import { loadManifest, saveManifest } from "../manifest.js";
import { projectPaths } from "../project.js";
import type { StageDeps } from "./deps.js";

export const DEFAULT_VOICE_ID = "af_sarah"; // Kokoro voice; "bf_emma" / "am_michael" also suit narration

// Measure the real audio length so the Sequence covers trailing silence, not just
// the last spoken word (remotion-best-practices: get-audio-duration). Injectable for tests.
export async function audioDurationSec(filePath: string): Promise<number> {
  const input = new Input({ formats: ALL_FORMATS, source: new FileSource(filePath) });
  return input.computeDuration();
}

export async function runVoiceover(
  projectDir: string,
  deps: StageDeps,
  opts: { voiceId?: string; getDuration?: (filePath: string) => Promise<number> } = {},
): Promise<void> {
  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  const getDuration = opts.getDuration ?? audioDurationSec;
  const m = loadManifest(projectDir);

  m.stages.voiceover.status = "running";
  saveManifest(projectDir, m);

  for (const seg of m.segments) {
    if (seg.audio) continue;
    const { audio, words } = await deps.tts.speak({ text: seg.narration, voiceId });
    const filePath = join(projectPaths(projectDir).audio, `${seg.id}.wav`);
    writeFileSync(filePath, audio);
    const durationSec = await getDuration(filePath);
    seg.audio = { path: `assets/audio/${seg.id}.wav`, durationSec, words };
    saveManifest(projectDir, m); // persist per-segment
  }

  m.stages.voiceover.status = "awaiting_review";
  saveManifest(projectDir, m);
}
```

> `FileSource` is the Node-side Mediabunny source; confirm the exact constructor (path vs. blob/buffer) against the installed Mediabunny version when wiring this up.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stages/voiceover`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): runVoiceover stage"
```

---

### Task 12: `runAssemble` stage (derive timeline)

**Files:**
- Create: `packages/core/src/stages/assemble.ts`
- Modify: `packages/core/src/index.ts` (re-export all stages + deps)
- Test: `packages/core/src/stages/assemble.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `Manifest`.
- Produces:
  - `runAssemble(projectDir, _deps?): Promise<void>` — computes `timeline = { fps: 30, totalDurationSec }` where `totalDurationSec` is the sum of all `segment.audio.durationSec` (throws if any segment lacks audio). Sets `stages.assemble.status = "awaiting_review"`.
  - `buildInputProps(m: Manifest): DocumentaryProps` — pure function the render package consumes; defined here so both core and render share the shape. `type DocumentaryProps = { fps: number; aspectRatio: "16:9" | "9:16"; segments: Array<{ id: string; imagePath: string; durationInFrames: number; kenBurns: { from: Rect; to: Rect }; words: Word[] }> }`.

- [ ] **Step 1: Write the failing test**

`packages/core/src/stages/assemble.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runAssemble, buildInputProps } from "./assemble.js";

const dirs: string[] = [];
function projectReady() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } };
  m.segments = [
    { id: "seg-001", order: 0, narration: "A", shot: { imagePrompt: "p", kenBurns: kb },
      image: { path: "assets/images/seg-001.png", seed: 1, provider: "x", approved: true },
      audio: { path: "assets/audio/seg-001.wav", durationSec: 2, words: [] } },
    { id: "seg-002", order: 1, narration: "B", shot: { imagePrompt: "p", kenBurns: kb },
      image: { path: "assets/images/seg-002.png", seed: 2, provider: "x", approved: true },
      audio: { path: "assets/audio/seg-002.wav", durationSec: 3, words: [] } },
  ];
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("computes total duration from audio", async () => {
  const dir = projectReady();
  await runAssemble(dir);
  const m = loadManifest(dir);
  expect(m.timeline?.totalDurationSec).toBe(5);
  expect(m.timeline?.fps).toBe(30);
  expect(m.stages.assemble.status).toBe("awaiting_review");
});

test("buildInputProps converts seconds to frames at 30fps", () => {
  const dir = projectReady();
  const props = buildInputProps(loadManifest(dir));
  expect(props.segments[0].durationInFrames).toBe(60); // 2s * 30
  expect(props.segments[1].durationInFrames).toBe(90); // 3s * 30
  expect(props.aspectRatio).toBe("16:9");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stages/assemble`
Expected: FAIL — cannot find `./assemble.js`.

- [ ] **Step 3: Implement**

`packages/core/src/stages/assemble.ts`:

```ts
import { loadManifest, saveManifest, type Manifest, type Rect } from "../manifest.js";
import type { Word } from "../providers/types.js";

const FPS = 30;

export type DocumentaryProps = {
  fps: number;
  aspectRatio: "16:9" | "9:16";
  segments: Array<{
    id: string;
    imagePath: string;
    durationInFrames: number;
    kenBurns: { from: Rect; to: Rect };
    words: Word[];
  }>;
};

export function buildInputProps(m: Manifest): DocumentaryProps {
  return {
    fps: FPS,
    aspectRatio: m.brief.aspectRatio,
    segments: m.segments.map((s) => {
      if (!s.image || !s.audio || !s.shot)
        throw new Error(`Segment ${s.id} not ready for assembly`);
      return {
        id: s.id,
        imagePath: s.image.path,
        durationInFrames: Math.max(1, Math.round(s.audio.durationSec * FPS)),
        kenBurns: s.shot.kenBurns,
        words: s.audio.words,
      };
    }),
  };
}

export async function runAssemble(projectDir: string, _deps?: unknown): Promise<void> {
  const m = loadManifest(projectDir);
  for (const s of m.segments) {
    if (!s.audio) throw new Error(`Segment ${s.id} has no audio; run voiceover first`);
  }
  const totalDurationSec = m.segments.reduce((sum, s) => sum + (s.audio?.durationSec ?? 0), 0);
  m.timeline = { fps: FPS, totalDurationSec };
  m.stages.assemble.status = "awaiting_review";
  saveManifest(projectDir, m);
}
```

Update `packages/core/src/index.ts`:

```ts
export const CORE_VERSION = 1;
export * from "./manifest.js";
export * from "./project.js";
export * from "./providers/types.js";
export * from "./stages/deps.js";
export * from "./stages/script.js";
export * from "./stages/shotlist.js";
export * from "./stages/images.js";
export * from "./stages/voiceover.js";
export * from "./stages/assemble.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stages/assemble`
Expected: 2 passing. Then run the whole suite: `npm test` — all green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(core): runAssemble + buildInputProps; export public API"
```

---

## Phase 4 — Render (Remotion)

### Task 13: Remotion composition with Ken Burns, audio, captions

**Files:**
- Create: `packages/render/package.json`, `tsconfig.json`, `remotion.config.ts`, `src/Root.tsx`, `src/Documentary.tsx`, `src/Segment.tsx`, `src/Captions.tsx`, `src/props.ts`
- Test: `packages/render/src/duration.test.ts`

**Interfaces:**
- Consumes: `DocumentaryProps`, `buildInputProps` (from `@doc/core`).
- Produces: a Remotion `Composition` id `"Documentary"` whose `calculateMetadata` sets `durationInFrames` = sum of segment frames, width/height from aspect ratio; per-segment Ken Burns stills (eased), narration audio via `@remotion/media`, and a word-highlighted caption overlay (`Captions.tsx`) driven by the stored `words`; a pure `totalFrames(props)` helper (unit-tested).

This package is validated by a unit test on the duration math plus a manual `npx remotion studio` smoke check and a one-frame `npx remotion still` render (no pixel assertions, per the testing strategy).

- [ ] **Step 1: Create the package**

`packages/render/package.json`:

```json
{
  "name": "@doc/render",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "studio": "remotion studio src/Root.tsx",
    "render": "remotion render src/Root.tsx Documentary out.mp4"
  },
  "dependencies": {
    "@doc/core": "*",
    "@remotion/cli": "^4.0.0",
    "@remotion/media": "^4.0.0",
    "@remotion/captions": "^4.0.0",
    "remotion": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

`packages/render/tsconfig.json` (TSX components need `jsx` + React types so `npm run typecheck` covers this package):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2022"]
  },
  "include": ["src"]
}
```

`packages/render/remotion.config.ts`:

```ts
import { Config } from "@remotion/cli/config";
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

`packages/render/src/duration.test.ts`:

```ts
import { expect, test } from "vitest";
import { totalFrames } from "./props.js";

test("totalFrames sums segment frames", () => {
  const props = {
    fps: 30, aspectRatio: "16:9" as const,
    segments: [
      { id: "a", imagePath: "x", durationInFrames: 60, kenBurns: { from: { x:0,y:0,w:1,h:1 }, to: { x:0,y:0,w:1,h:1 } }, words: [] },
      { id: "b", imagePath: "y", durationInFrames: 90, kenBurns: { from: { x:0,y:0,w:1,h:1 }, to: { x:0,y:0,w:1,h:1 } }, words: [] },
    ],
  };
  expect(totalFrames(props)).toBe(150);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- duration`
Expected: FAIL — cannot find `./props.js`.

- [ ] **Step 4: Implement props helper and components**

`packages/render/src/props.ts`:

```ts
import type { DocumentaryProps } from "@doc/core";
export type { DocumentaryProps };

export function totalFrames(props: DocumentaryProps): number {
  return props.segments.reduce((n, s) => n + s.durationInFrames, 0);
}

export function dimensions(aspectRatio: DocumentaryProps["aspectRatio"]) {
  return aspectRatio === "16:9" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}
```

`packages/render/src/Segment.tsx`:

```tsx
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media"; // remotion-best-practices: media components come from @remotion/media
import type { DocumentaryProps } from "./props.js";
import { Captions } from "./Captions.js";

type Seg = DocumentaryProps["segments"][number];

export function Segment({ seg, audioSrc }: { seg: Seg; audioSrc: string }) {
  const frame = useCurrentFrame();
  // Eased progress so the Ken Burns move feels cinematic rather than linear/mechanical.
  const t = interpolate(frame, [0, seg.durationInFrames], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });
  const { from, to } = seg.kenBurns;
  // Interpolate the crop rect, then express it as a CSS transform (scale + translate).
  const w = from.w + (to.w - from.w) * t;
  const scale = 1 / w;
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  const translateXPct = -x * 100;
  const translateYPct = -y * 100;

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <Img
        src={seg.imagePath.startsWith("http") ? seg.imagePath : staticFile(seg.imagePath)}
        style={{
          width: "100%", height: "100%", objectFit: "cover",
          transform: `scale(${scale}) translate(${translateXPct}%, ${translateYPct}%)`,
          transformOrigin: "top left",
        }}
      />
      <Audio src={audioSrc} />
      <Captions words={seg.words} />
    </AbsoluteFill>
  );
}
```

`packages/render/src/Captions.tsx` (word-timed caption overlay — built from the `words` already captured by the voiceover stage, per the remotion-best-practices `display-captions` rule). Word timings are segment-local (WhisperX ran per-segment audio), so the page math matches the Segment's local frame:

```tsx
import { useMemo } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { createTikTokStyleCaptions, type Caption, type TikTokPage } from "@remotion/captions";
import type { DocumentaryProps } from "./props.js";

type Word = DocumentaryProps["segments"][number]["words"][number];

const SWITCH_MS = 1200;            // how often the caption page advances
const HIGHLIGHT = "#ffd166";

export function Captions({ words }: { words: Word[] }) {
  const { fps } = useVideoConfig();
  const pages = useMemo(() => {
    const captions: Caption[] = words.map((w) => ({
      // captions are whitespace-sensitive — keep a leading space before each word
      text: w.word.startsWith(" ") ? w.word : ` ${w.word}`,
      startMs: w.start * 1000,
      endMs: w.end * 1000,
      timestampMs: ((w.start + w.end) / 2) * 1000,
      confidence: null,
    }));
    return createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: SWITCH_MS }).pages;
  }, [words]);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", padding: 48 }}>
      {pages.map((page, i) => {
        const next = pages[i + 1] ?? null;
        const startFrame = (page.startMs / 1000) * fps;
        const endFrame = Math.min(
          next ? (next.startMs / 1000) * fps : Infinity,
          startFrame + (SWITCH_MS / 1000) * fps,
        );
        const durationInFrames = endFrame - startFrame;
        if (durationInFrames <= 0) return null;
        return (
          <Sequence key={i} from={startFrame} durationInFrames={durationInFrames} layout="none">
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

function CaptionPage({ page }: { page: TikTokPage }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;
  return (
    <div
      style={{
        fontFamily: "system-ui", fontSize: 48, fontWeight: 700, textAlign: "center",
        color: "white", textShadow: "0 2px 8px rgba(0,0,0,0.8)", whiteSpace: "pre",
      }}
    >
      {page.tokens.map((token) => {
        const active = token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
        return (
          <span key={token.fromMs} style={{ color: active ? HIGHLIGHT : "white" }}>
            {token.text}
          </span>
        );
      })}
    </div>
  );
}
```

`packages/render/src/Documentary.tsx`:

```tsx
import { Sequence, staticFile } from "remotion";
import type { DocumentaryProps } from "./props.js";
import { Segment } from "./Segment.js";

export function Documentary({ props }: { props: DocumentaryProps }) {
  let start = 0;
  return (
    <>
      {props.segments.map((seg) => {
        const from = start;
        start += seg.durationInFrames;
        const audioSrc = staticFile(`assets/audio/${seg.id}.wav`);
        return (
          <Sequence key={seg.id} from={from} durationInFrames={seg.durationInFrames}>
            <Segment seg={seg} audioSrc={audioSrc} />
          </Sequence>
        );
      })}
    </>
  );
}
```

`packages/render/src/Root.tsx`:

```tsx
import { Composition } from "remotion";
import { Documentary } from "./Documentary.js";
import { dimensions, totalFrames, type DocumentaryProps } from "./props.js";

const EMPTY: DocumentaryProps = { fps: 30, aspectRatio: "16:9", segments: [] };

export const RemotionRoot = () => (
  <Composition
    id="Documentary"
    component={Documentary as any}
    durationInFrames={1}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{ props: EMPTY }}
    calculateMetadata={({ props }) => {
      const p = (props as { props: DocumentaryProps }).props;
      const dim = dimensions(p.aspectRatio);
      return { durationInFrames: Math.max(1, totalFrames(p)), fps: p.fps, ...dim };
    }}
  />
);
```

Create `packages/render/src/index.ts`:

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root.js";
registerRoot(RemotionRoot);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- duration`
Expected: 1 passing.

- [ ] **Step 6: Manual smoke check (no assertion, just confirm it mounts)**

Render a project's props to a JSON file and open the studio. Document this command in `packages/render/README.md`:

```bash
# From a project that has reached the assemble gate, the web layer writes
# projects/<slug>/out/inputProps.json via buildInputProps. Then:
cd packages/render && npx remotion studio src/Root.tsx
# In the studio, set the "Documentary" input props to the contents of inputProps.json
# (using publicDir pointed at projects/<slug>). Confirm it plays without errors.

# Cheap non-interactive sanity check (catches asset-path / layout breakage without a full render):
npx remotion still src/Root.tsx Documentary <project>/out/frame.png \
  --frame=30 --props=<project>/out/inputProps.json --public-dir=<project>
```

Expected: studio opens with the Documentary composition listed; the still renders a frame showing the image, Ken Burns crop, and a caption line. (Full render is wired by the web layer in Task 16.)

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(render): Remotion documentary composition with eased Ken Burns, @remotion/media audio, word-highlighted captions"
```

---

## Phase 5 — Web UI (Next.js review gates)

> The web package is the thin orchestration + review layer. It is validated by the human gates themselves plus a small unit test on the run-orchestration helper. UI components are kept minimal and functional (no design polish required for v1).

### Task 14: Next.js scaffold + project list/create

**Files:**
- Create: `packages/web/package.json`, `next.config.ts`, `tsconfig.json`
- Create: `packages/web/src/lib/projects.ts` (filesystem helpers), `packages/web/src/app/page.tsx`, `packages/web/src/app/api/projects/route.ts`
- Test: `packages/web/src/lib/projects.test.ts`

**Interfaces:**
- Consumes: `createProject`, `loadManifest`, `type Brief` from `@doc/core`.
- Produces:
  - `PROJECTS_ROOT` constant = repo-root `projects/` dir.
  - `listProjects(): Array<{ slug: string; status: Record<StageName, string> }>` — scans `projects/`, loads each manifest, returns slug + per-stage status.
  - `slugify(topic: string): string`.
  - A home page listing projects + a create form; `POST /api/projects` creates one via `createProject(PROJECTS_ROOT, slug, brief, new Date().toISOString())`.

- [ ] **Step 1: Create the package**

`packages/web/package.json`:

```json
{
  "name": "@doc/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },
  "dependencies": {
    "@doc/core": "*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": { "@types/react": "^19.0.0" }
}
```

`packages/web/next.config.ts`:

```ts
import type { NextConfig } from "next";
import { join } from "node:path";

// Next.js only auto-loads .env from packages/web, but our secrets live in the
// repo-root .env (see Global Constraints). Load it explicitly so realDeps()
// sees ANTHROPIC_API_KEY / REPLICATE_API_TOKEN at runtime.
// process.loadEnvFile requires Node >= 20.12; it throws if the file is absent,
// which is fine in CI where the vars are already in the environment.
try {
  process.loadEnvFile(join(process.cwd(), "..", "..", ".env"));
} catch {
  // No root .env present — rely on whatever is already in process.env.
}

const config: NextConfig = { typescript: { ignoreBuildErrors: false } };
export default config;
```

> The `npx remotion render` child process spawned by `renderProject` (Task 16) does **not** need API keys — it renders purely from `out/inputProps.json` and local assets — so no env plumbing is required there.

`packages/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "preserve", "lib": ["DOM", "ES2022"], "composite": false },
  "include": ["src", "next-env.d.ts"]
}
```

Run: `npm install`

- [ ] **Step 2: Write the failing test**

`packages/web/src/lib/projects.test.ts`:

```ts
import { expect, test } from "vitest";
import { slugify } from "./projects.js";

test("slugify lowercases and dashes", () => {
  expect(slugify("The History of Lighthouses!")).toBe("the-history-of-lighthouses");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- projects`
Expected: FAIL — cannot find `./projects.js`.

- [ ] **Step 4: Implement lib + pages**

`packages/web/src/lib/projects.ts`:

```ts
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, STAGE_NAMES, type StageName } from "@doc/core";

export const PROJECTS_ROOT = join(process.cwd(), "..", "..", "projects");

export function slugify(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function listProjects(): Array<{ slug: string; status: Record<StageName, string> }> {
  if (!existsSync(PROJECTS_ROOT)) return [];
  return readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const m = loadManifest(join(PROJECTS_ROOT, d.name));
      const status = Object.fromEntries(
        STAGE_NAMES.map((n) => [n, m.stages[n].status]),
      ) as Record<StageName, string>;
      return { slug: d.name, status };
    });
}
```

`packages/web/src/app/api/projects/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createProject, type Brief } from "@doc/core";
import { PROJECTS_ROOT, slugify } from "@/lib/projects";

export async function POST(req: Request) {
  const brief = (await req.json()) as Brief;
  const slug = slugify(brief.topic);
  createProject(PROJECTS_ROOT, slug, brief, new Date().toISOString());
  return NextResponse.json({ slug });
}
```

`packages/web/src/app/page.tsx`:

```tsx
import Link from "next/link";
import { listProjects } from "@/lib/projects";

export default function Home() {
  const projects = listProjects();
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Documentaries</h1>
      <ul>
        {projects.map((p) => (
          <li key={p.slug}>
            <Link href={`/p/${p.slug}`}>{p.slug}</Link> — script: {p.status.script}
          </li>
        ))}
      </ul>
      <CreateForm />
    </main>
  );
}
```

`packages/web/src/app/CreateForm.tsx` (client component that POSTs a JSON brief):

```tsx
"use client";
import { useState } from "react";

export function CreateForm() {
  const [topic, setTopic] = useState("");
  const submit = async () => {
    const brief = {
      topic, targetMinutes: 6, tone: "wistful, archival",
      aspectRatio: "16:9", imageStyle: "1970s 35mm film, muted",
    };
    const { slug } = await (await fetch("/api/projects", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(brief),
    })).json();
    window.location.href = `/p/${slug}`;
  };
  return (
    <div style={{ marginTop: 16 }}>
      <input placeholder="Documentary topic" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <button onClick={submit} disabled={!topic}>Create</button>
    </div>
  );
}
```

Add `import { CreateForm } from "./CreateForm";` to the top of `page.tsx` (the `page.tsx` block above already renders `<CreateForm />`).

Add the `@/*` path alias in `tsconfig.json` `compilerOptions.paths`: `{ "@/*": ["./src/*"] }`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- projects`
Expected: 1 passing.

- [ ] **Step 6: Manual check**

Run: `cd packages/web && npm run dev`, open `http://localhost:3000`.
Expected: "Documentaries" page renders (empty list is fine).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): Next.js scaffold, project list and create API"
```

---

### Task 15: Stage-run orchestration + status API

**Files:**
- Create: `packages/web/src/lib/runner.ts`, `packages/web/src/app/api/projects/[slug]/run/route.ts`, `packages/web/src/app/api/projects/[slug]/manifest/route.ts`
- Test: `packages/web/src/lib/runner.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `canRun`, `realDeps`, and the five `run*` stage functions from `@doc/core`.
- Produces:
  - `STAGE_RUNNERS: Record<StageName, (dir: string, deps: StageDeps) => Promise<void>>` — maps stage name → function.
  - `runStage(slug: string, stage: StageName): Promise<void>` — checks `canRun`; if not, throws; otherwise loads `realDeps(process.env)` and invokes the runner. On throw, sets `stages[stage].status = "error"` + message and re-throws.
  - `POST /api/projects/[slug]/run` body `{ stage }` triggers `runStage` (awaited for v1 — acceptable for local single-user; the seam to make it a background job is documented).
  - `GET /api/projects/[slug]/manifest` returns the manifest JSON (for gate pages to poll).

- [ ] **Step 1: Write the failing test**

`packages/web/src/lib/runner.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, loadManifest, saveManifest } from "@doc/core";
import { runStageWith } from "./runner.js";
import { makeFakeDeps } from "@doc/core";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("runStageWith records error status when a stage throws", async () => {
  const root = mkdtempSync(join(tmpdir(), "root-")); dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "f",
  }, "2026-06-26T00:00:00.000Z");

  const failing = makeFakeDeps({
    llm: { complete: async () => { throw new Error("boom"); } },
  });

  await expect(runStageWith(dir, "script", failing)).rejects.toThrow("boom");
  expect(loadManifest(dir).stages.script.status).toBe("error");
  expect(loadManifest(dir).stages.script.error).toContain("boom");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- runner`
Expected: FAIL — cannot find `./runner.js`.

- [ ] **Step 3: Implement**

`packages/web/src/lib/runner.ts`:

```ts
import {
  canRun, loadManifest, saveManifest, realDeps,
  runScript, runShotlist, runImages, runVoiceover, runAssemble,
  type StageDeps, type StageName,
} from "@doc/core";
import { join } from "node:path";
import { PROJECTS_ROOT } from "./projects.js";

export const STAGE_RUNNERS: Record<StageName, (dir: string, deps: StageDeps) => Promise<void>> = {
  script: runScript,
  shotlist: runShotlist,
  images: (dir, deps) => runImages(dir, deps),
  voiceover: (dir, deps) => runVoiceover(dir, deps),
  assemble: (dir) => runAssemble(dir),
};

export async function runStageWith(dir: string, stage: StageName, deps: StageDeps): Promise<void> {
  const m = loadManifest(dir);
  if (!canRun(m, stage)) throw new Error(`Cannot run ${stage}: earlier gate not approved`);
  try {
    await STAGE_RUNNERS[stage](dir, deps);
  } catch (err) {
    const cur = loadManifest(dir);
    cur.stages[stage].status = "error";
    cur.stages[stage].error = err instanceof Error ? err.message : String(err);
    saveManifest(dir, cur);
    throw err;
  }
}

export async function runStage(slug: string, stage: StageName): Promise<void> {
  await runStageWith(join(PROJECTS_ROOT, slug), stage, realDeps(process.env));
}
```

`packages/web/src/app/api/projects/[slug]/run/route.ts`:

```ts
import { NextResponse } from "next/server";
import { runStage } from "@/lib/runner";
import type { StageName } from "@doc/core";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { stage } = (await req.json()) as { stage: StageName };
  try {
    await runStage(slug, stage);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

`packages/web/src/app/api/projects/[slug]/manifest/route.ts`:

```ts
import { NextResponse } from "next/server";
import { loadManifest } from "@doc/core";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return NextResponse.json(loadManifest(join(PROJECTS_ROOT, slug)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- runner`
Expected: 1 passing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): stage runner with error capture + run/manifest APIs"
```

---

### Task 16: Review-gate pages + approval/edit/regenerate APIs

**Files:**
- Create: `packages/web/src/app/p/[slug]/page.tsx` (gate dashboard)
- Create: `packages/web/src/app/api/projects/[slug]/approve/route.ts`
- Create: `packages/web/src/app/api/projects/[slug]/segments/route.ts` (edit narration/prompt, reject image/audio)
- Create: `packages/web/src/app/api/projects/[slug]/render/route.ts`
- Create: `packages/web/src/app/api/assets/[slug]/[...path]/route.ts` (serve project images/audio)
- Test: `packages/web/src/lib/edits.test.ts`

**Interfaces:**
- Consumes: `loadManifest`, `saveManifest`, `buildInputProps`, `STAGE_NAMES`, `type StageName`, `type Segment`.
- Produces (pure helpers in a new `packages/web/src/lib/edits.ts`, unit-tested; route handlers are thin wrappers):
  - `approveStage(dir, stage): void` — sets `stages[stage].status = "approved"`. For `images`/`voiceover`, also marks per-segment approval where relevant (images: set every `image.approved = true`).
  - `editNarration(dir, segId, text): void` — updates `segment.narration` (only allowed while script not yet approved; throws otherwise).
  - `editPrompt(dir, segId, prompt): void` — updates `segment.shot.imagePrompt` (while shotlist not approved).
  - `rejectImage(dir, segId, opts?: { seed?: number; prompt?: string }): void` — flags `image.needsRegen = true`, sets `image.approved = false`, and bumps the seed (so the regen actually differs; a caller-supplied `seed`/`prompt` overrides) so the next `runImages` regenerates ONLY that segment. (Plain `approved = false` is not enough — every freshly-generated image is unapproved until the stage is approved, so the regen trigger must be the explicit `needsRegen` flag.)
  - `rejectAudio(dir, segId): void` — clears `segment.audio` so next `runVoiceover` regenerates it.
  - `renderProject(dir): Promise<string>` — writes `out/inputProps.json` via `buildInputProps`, shells out to `npx remotion render` against `@doc/render`, returns the output mp4 path.

- [ ] **Step 1: Write the failing test (pure edit helpers)**

`packages/web/src/lib/edits.test.ts`:

```ts
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, loadManifest, saveManifest } from "@doc/core";
import { approveStage, editNarration, rejectImage, rejectAudio } from "./edits.js";

const dirs: string[] = [];
function proj() {
  const root = mkdtempSync(join(tmpdir(), "root-")); dirs.push(root);
  return createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "f",
  }, "2026-06-26T00:00:00.000Z");
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("approveStage marks the stage approved", () => {
  const dir = proj();
  approveStage(dir, "script");
  expect(loadManifest(dir).stages.script.status).toBe("approved");
});

test("editNarration updates text before script approval", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "old" }];
  saveManifest(dir, m);
  editNarration(dir, "seg-001", "new");
  expect(loadManifest(dir).segments[0].narration).toBe("new");
});

test("rejectImage flips approved to false and can set a new seed", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n",
    image: { path: "p", seed: 1, provider: "x", approved: true } }];
  saveManifest(dir, m);
  rejectImage(dir, "seg-001", { seed: 99 });
  const got = loadManifest(dir).segments[0].image!;
  expect(got.approved).toBe(false);
  expect(got.seed).toBe(99);
});

test("rejectAudio clears audio so it will regenerate", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n",
    audio: { path: "a", durationSec: 1, words: [] } }];
  saveManifest(dir, m);
  rejectAudio(dir, "seg-001");
  expect(loadManifest(dir).segments[0].audio).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- edits`
Expected: FAIL — cannot find `./edits.js`.

- [ ] **Step 3: Implement the edit helpers**

`packages/web/src/lib/edits.ts`:

```ts
import { loadManifest, saveManifest, type StageName } from "@doc/core";

export function approveStage(dir: string, stage: StageName): void {
  const m = loadManifest(dir);
  if (stage === "images")
    for (const s of m.segments) if (s.image) { s.image.approved = true; delete s.image.needsRegen; }
  m.stages[stage].status = "approved";
  m.stages[stage].completedAt = new Date().toISOString();
  saveManifest(dir, m);
}

function seg(dir: string, id: string) {
  const m = loadManifest(dir);
  const s = m.segments.find((x) => x.id === id);
  if (!s) throw new Error(`No segment ${id}`);
  return { m, s };
}

export function editNarration(dir: string, id: string, text: string): void {
  const { m, s } = seg(dir, id);
  if (m.stages.script.status === "approved") throw new Error("Script already approved");
  s.narration = text;
  saveManifest(dir, m);
}

export function editPrompt(dir: string, id: string, prompt: string): void {
  const { m, s } = seg(dir, id);
  if (m.stages.shotlist.status === "approved") throw new Error("Shotlist already approved");
  if (!s.shot) throw new Error(`Segment ${id} has no shot`);
  s.shot.imagePrompt = prompt;
  saveManifest(dir, m);
}

export function rejectImage(dir: string, id: string, opts: { seed?: number; prompt?: string } = {}): void {
  const { m, s } = seg(dir, id);
  if (!s.image) throw new Error(`Segment ${id} has no image`);
  s.image.needsRegen = true;
  s.image.approved = false;
  // Bump the seed so the regen produces a DIFFERENT image (deterministicSeed
  // would otherwise reproduce the same one); caller may override.
  s.image.seed = opts.seed ?? s.image.seed + 1;
  if (opts.prompt !== undefined && s.shot) s.shot.imagePrompt = opts.prompt;
  saveManifest(dir, m);
}

export function rejectAudio(dir: string, id: string): void {
  const { m, s } = seg(dir, id);
  delete s.audio;
  saveManifest(dir, m);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- edits`
Expected: 4 passing.

- [ ] **Step 5: Implement the route handlers + gate page + asset server + render**

`packages/web/src/app/api/projects/[slug]/approve/route.ts`:

```ts
import { NextResponse } from "next/server";
import { join } from "node:path";
import { approveStage } from "@/lib/edits";
import { PROJECTS_ROOT } from "@/lib/projects";
import type { StageName } from "@doc/core";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { stage } = (await req.json()) as { stage: StageName };
  approveStage(join(PROJECTS_ROOT, slug), stage);
  return NextResponse.json({ ok: true });
}
```

`packages/web/src/app/api/projects/[slug]/segments/route.ts`:

```ts
import { NextResponse } from "next/server";
import { join } from "node:path";
import { editNarration, editPrompt, rejectImage, rejectAudio } from "@/lib/edits";
import { PROJECTS_ROOT } from "@/lib/projects";

type Action =
  | { op: "editNarration"; id: string; text: string }
  | { op: "editPrompt"; id: string; prompt: string }
  | { op: "rejectImage"; id: string; seed?: number; prompt?: string }
  | { op: "rejectAudio"; id: string };

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(PROJECTS_ROOT, slug);
  const a = (await req.json()) as Action;
  if (a.op === "editNarration") editNarration(dir, a.id, a.text);
  else if (a.op === "editPrompt") editPrompt(dir, a.id, a.prompt);
  else if (a.op === "rejectImage") rejectImage(dir, a.id, { seed: a.seed, prompt: a.prompt });
  else if (a.op === "rejectAudio") rejectAudio(dir, a.id);
  return NextResponse.json({ ok: true });
}
```

`packages/web/src/app/api/assets/[slug]/[...path]/route.ts` (serves project images/audio to the browser):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug, path } = await params;
  const file = join(PROJECTS_ROOT, slug, "assets", ...path);
  const body = readFileSync(file);
  const type = file.endsWith(".wav") ? "audio/wav"
    : file.endsWith(".mp3") ? "audio/mpeg"
    : "image/png";
  return new Response(body, { headers: { "content-type": type } });
}
```

`packages/web/src/app/api/projects/[slug]/render/route.ts`:

```ts
import { NextResponse } from "next/server";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadManifest, buildInputProps } from "@doc/core";
import { PROJECTS_ROOT } from "@/lib/projects";

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = join(PROJECTS_ROOT, slug);
  const props = buildInputProps(loadManifest(dir));
  const propsPath = join(dir, "out", "inputProps.json");
  writeFileSync(propsPath, JSON.stringify({ props }));
  const outPath = join(dir, "out", `${slug}.mp4`);
  // publicDir points at the project dir so staticFile() resolves assets/*.
  execFileSync("npx", [
    "remotion", "render",
    join(process.cwd(), "..", "render", "src", "Root.tsx"),
    "Documentary", outPath,
    "--props", propsPath,
    "--public-dir", dir,
  ], { stdio: "inherit" });
  return NextResponse.json({ ok: true, out: `out/${slug}.mp4` });
}
```

`packages/web/src/app/p/[slug]/page.tsx` (the gate dashboard — minimal functional UI; a client component polls the manifest and renders the current stage's gate):

```tsx
import { loadManifest } from "@doc/core";
import { join } from "node:path";
import { PROJECTS_ROOT } from "@/lib/projects";
import { GateClient } from "./GateClient";

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manifest = loadManifest(join(PROJECTS_ROOT, slug));
  return <GateClient slug={slug} initial={manifest} />;
}
```

`packages/web/src/app/p/[slug]/GateClient.tsx` (client component — buttons call the APIs above; shows script editor at Gate 1, prompt editor at Gate 2, image gallery with regenerate at Gate 3, audio players at Gate 4, render button at Final). Keep it functional:

```tsx
"use client";
import { useState } from "react";
import type { Manifest, StageName } from "@doc/core";

const ORDER: StageName[] = ["script", "shotlist", "images", "voiceover", "assemble"];

export function GateClient({ slug, initial }: { slug: string; initial: Manifest }) {
  const [m, setM] = useState(initial);
  const refresh = async () =>
    setM(await (await fetch(`/api/projects/${slug}/manifest`)).json());

  const post = async (path: string, body: unknown) => {
    await fetch(`/api/projects/${slug}/${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
  };

  // Current stage = first non-approved stage.
  const current = ORDER.find((s) => m.stages[s].status !== "approved") ?? "assemble";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1>{slug}</h1>
      <p>Current stage: <b>{current}</b> — status: {m.stages[current].status}</p>
      {m.stages[current].error && <p style={{ color: "crimson" }}>Error: {m.stages[current].error}</p>}

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button onClick={() => post("run", { stage: current })}>Run “{current}”</button>
        <button onClick={() => post("approve", { stage: current })}>Approve “{current}”</button>
        {current === "assemble" && m.stages.voiceover.status === "approved" && (
          <button onClick={() => post("render", {})}>Render video</button>
        )}
      </div>

      {/* Gate 1: script editor */}
      {current === "script" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <textarea defaultValue={s.narration} style={{ width: "100%" }}
            onBlur={(e) => post("segments", { op: "editNarration", id: s.id, text: e.target.value })} />
        </div>
      ))}

      {/* Gate 2: prompt editor */}
      {current === "shotlist" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <input defaultValue={s.shot?.imagePrompt ?? ""} style={{ width: "100%" }}
            onBlur={(e) => post("segments", { op: "editPrompt", id: s.id, prompt: e.target.value })} />
        </div>
      ))}

      {/* Gate 3: image gallery */}
      {current === "images" && m.segments.map((s) => (
        <figure key={s.id} style={{ display: "inline-block", margin: 8 }}>
          {s.image && <img src={`/api/assets/${slug}/images/${s.id}.png`} width={240} alt={s.id} />}
          <figcaption>
            <button onClick={() => post("segments", { op: "rejectImage", id: s.id, seed: s.image?.seed ? s.image.seed + 1 : 1 })}>
              Regenerate
            </button>
          </figcaption>
        </figure>
      ))}

      {/* Gate 4: audio review */}
      {current === "voiceover" && m.segments.map((s) => (
        <div key={s.id} style={{ marginBottom: 8 }}>
          <span>{s.narration.slice(0, 40)}… </span>
          {s.audio && <audio controls src={`/api/assets/${slug}/audio/${s.id}.wav`} />}
          <button onClick={() => post("segments", { op: "rejectAudio", id: s.id })}>Re-record</button>
        </div>
      ))}
    </main>
  );
}
```

Note: after a "Regenerate"/"Re-record" rejection, the reviewer clicks **Run** again — `runImages` only touches segments flagged `needsRegen` (or missing an image), and `runVoiceover` only touches segments whose `audio` was cleared. Untouched segments keep their existing assets and incur no new API spend.

- [ ] **Step 6: Manual end-to-end smoke (the real acceptance test)**

With `.env` populated, run `cd packages/web && npm run dev`, create a project, then for each stage: **Run → review → (regenerate as needed) → Approve**, finishing with **Render video**. Confirm `projects/<slug>/out/<slug>.mp4` plays with synced narration and Ken Burns motion.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): review-gate dashboard, edit/approve/render APIs, asset server"
```

---

## Final verification

- [ ] Run the full unit suite: `npm test` — all packages green.
- [ ] Run `npm run typecheck` at the root — no type errors.
- [ ] Render a one-frame still (`npx remotion still … --frame=30`) for a project at the assemble gate — confirms the image, Ken Burns crop, and caption overlay compose without asset-path errors.
- [ ] Manual end-to-end per Task 16 Step 6 produces a playable MP4 (narration synced, captions highlighting the spoken word, Ken Burns motion).
- [ ] Confirm resumability: delete one segment's image file + set `image.needsRegen=true` (the explicit regen flag) in the manifest, click Run on the images stage, verify only that segment regenerates.

```bash
git add -A && git commit -m "chore: documentary pipeline v1 complete"
```

---

## Spec coverage map

| Spec requirement | Task(s) |
|---|---|
| Monorepo `core`/`render`/`web` + `projects/<slug>/` | 1, 5, 13, 14 |
| Manifest schema, validation-on-read, fail-loud | 2, 3 |
| Gate ordering (`canRun`) | 4 |
| Brief intake / project creation | 5, 14 |
| Injectable providers (LLM/Image/TTS), real clients, fail-loud env | 6, 7 |
| Script stage + Gate 1 | 8, 16 |
| Shotlist stage + Gate 2 | 9, 16 |
| Images stage (idempotent, per-segment persist, seeds) + Gate 3 | 10, 16 |
| Voiceover stage (word timestamps) + Gate 4 | 11, 16 |
| Assemble (derived timeline) + buildInputProps | 12 |
| Ken Burns (eased) + audio + word-highlighted captions + render | 13, 16 |
| Per-segment idempotency / resumability | 8–11, 16, Final verification |
| Error status capture | 15 |
| Web UI gates, approve/edit/regenerate/render | 14, 15, 16 |
| Testing strategy (mocked providers, schema round-trip, resumability, gate logic, render smoke) | 2–16 |

## Notes for the executor

- **Out of scope (do not build):** multiple images per segment, generated video, background music, research step, Trigger.dev, Remotion Lambda, auth/multi-user. These are documented future paths in the spec.
- **The web layer awaits stage runs synchronously** for v1 (local single-user). Image/voiceover batches of 30–60 segments may take minutes; that's acceptable. The documented seam to convert `runStage` into a background job (Trigger.dev) is the single point of change — stage logic does not move.
- **Voice selection** uses a hardcoded `DEFAULT_VOICE_ID`; promoting it to a `brief` field is a trivial follow-up if desired.
- **Cost:** the text gates (script, shotlist) precede all image/audio spend by design — reject bad runs there.
```
