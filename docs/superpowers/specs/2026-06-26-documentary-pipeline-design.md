# Agentic Documentary Pipeline — Design

**Date:** 2026-06-26
**Status:** Approved design, ready for implementation planning
**Author:** Patrick Wanicki (with Claude)

## For the executor (start here)

This is a **design spec**, not an implementation plan. It will be handed to another person and their Claude Code to build.

**First action for the executing agent:** invoke the `superpowers:writing-plans` skill with this document as input to produce a step-by-step implementation plan, then execute that plan (TDD per the testing section). Do **not** start writing code directly from this spec — turn it into a plan first.

**This is a greenfield project.** Create a new directory/repo named `documentary-pipeline` (it does **not** live inside the grad-montage repo this spec was authored in — that repo is unrelated and only hosts the doc). Everything needed to build it is in this document; no other conversation context is required.

### Prerequisites

- **Node.js** ≥ 20, **npm** ≥ 10 (npm workspaces).
- **TypeScript**, **zod** (manifest schema/validation), **Vitest** (tests).
- **Next.js** 15 (App Router) for `packages/web`.
- **Remotion** 4.x for `packages/render`.
- Provider SDKs: `@anthropic-ai/sdk`, `replicate`, and ElevenLabs (SDK or REST).

### Required accounts & environment variables

A `.env` at the repo root (loaded by `core`), git-ignored:

```bash
ANTHROPIC_API_KEY=...      # script + shotlist drafting (Claude)
REPLICATE_API_TOKEN=...    # image generation (Flux)
ELEVENLABS_API_KEY=...     # voiceover TTS + word timestamps
# Optional, behind providers/llm.ts if OpenAI is used instead of/alongside Claude:
# OPENAI_API_KEY=...
```

The project owner (Patrick) already has Anthropic/OpenAI, Replicate, and ElevenLabs accounts. The executor should obtain the three keys above before running stages 1–4; stages 0 and 5 need no external keys.

## Summary

A fresh, standalone pipeline that turns a **topic** into a finished **narrated-stills (Ken Burns) documentary**, roughly 5–10 minutes long. The pipeline is a deterministic chain of focused LLM/API stages with **four human review gates**, driven from a **local web UI**. A single per-project **JSON manifest** is the source of truth that every part reads and writes.

This is "agentic" as a *structured pipeline of LLM steps* — predictable, debuggable, cheap — not autonomous tool-using agents.

### Key decisions

| Decision | Choice |
|---|---|
| Relationship to existing repo | **Fresh standalone project** (not built on the grad-montage Remotion code) |
| Visual style | **Narrated stills, Ken Burns** (pans/zooms over AI stills) |
| Autonomy | **Checkpointed** — review gate after each major stage |
| Interface | **Local web UI** (Next.js) |
| Agent model | **Structured pipeline + focused LLM steps** (deterministic backbone) |
| Architecture | **Approach A** — manifest-driven stage pipeline + Next.js UI + Remotion render |
| Target length | **Medium, 5–10 min** (~750–1500 words, ~30–60 images) |
| Images per segment (v1) | **One** (segment may grow a `shots[]` array later — deferred, YAGNI) |
| Services | **Anthropic Claude** (script/shotlist), **Replicate/Flux** (images), **ElevenLabs** (TTS + timestamps), **Remotion** (assembly/render) |

## Architecture & project structure

A small npm-workspaces monorepo with three independently testable units. The **manifest is the only thing that crosses unit boundaries** — stages, UI, and renderer never talk to each other directly; they all read/write that one document.

```
documentary-pipeline/
├── packages/
│   ├── core/          # the pipeline: stage functions + manifest schema + provider clients
│   │   ├── manifest.ts        # zod schema + load/save (source of truth)
│   │   ├── stages/
│   │   │   ├── script.ts      # brief → segments[].narration
│   │   │   ├── shotlist.ts    # narration → shot.imagePrompt + kenBurns
│   │   │   ├── images.ts      # imagePrompt → Replicate (Flux) image files
│   │   │   ├── voiceover.ts   # narration → ElevenLabs audio + word timestamps
│   │   │   └── assemble.ts    # segments → timeline (render input props; no rendering)
│   │   └── providers/         # thin clients: llm.ts, replicate.ts, elevenlabs.ts
│   ├── render/        # Remotion project — Composition takes manifest as inputProps
│   └── web/           # Next.js app — review-gate UI, triggers stage runs
└── projects/<slug>/   # one documentary: manifest.json + assets/{images,audio}/ + out/ + runs/
```

**Boundaries / contracts:**

- `core` knows nothing about React or HTTP — pure TypeScript functions operating on a manifest + a project directory. Testable with mocked providers.
- `web` is a thin layer: route handlers / server actions call `core` stage functions, read the manifest, render gates. No business logic.
- `render` (Remotion) consumes the finished manifest as `inputProps`. The same JSON you approved drives the pixels.
- Each documentary lives in `projects/<slug>/` — `manifest.json` plus `assets/images/`, `assets/audio/`, `out/`, `runs/`. Self-contained, inspectable, gitignorable.
- **No database** — the filesystem is the store for v1.

## Manifest schema

The shared contract. Conceptually: project state + per-gate approval state. The **segment is the spine** — each stage *adds* its own slice to existing segments and never mutates upstream fields. Stable `segment.id` is the join key across stages.

```ts
// One documentary project. Lives at projects/<slug>/manifest.json
type Manifest = {
  version: 1
  slug: string
  createdAt: string

  // ── Stage 0: the brief (user input) ──
  brief: {
    topic: string
    targetMinutes: number          // ~5–10
    tone: string                    // e.g. "somber, archival"
    audience?: string
    aspectRatio: "16:9" | "9:16"    // drives image dims + Remotion comp
    imageStyle: string              // global style suffix, e.g. "1970s 35mm film, muted"
  }

  // ── Per-stage status: gate state lives here ──
  stages: Record<StageName, {
    status: "pending" | "running" | "awaiting_review" | "approved" | "error"
    error?: string
    completedAt?: string
  }>
  // StageName = "script" | "shotlist" | "images" | "voiceover" | "assemble"

  // ── Stage 1: script ──
  segments: Array<{
    id: string                      // stable id, e.g. "seg-003" — keys everything downstream
    narration: string               // the spoken text for this beat
    order: number

    // ── Stage 2: shotlist (one shot per segment for v1) ──
    shot?: {
      imagePrompt: string           // full prompt sent to Flux (incl. brief.imageStyle)
      kenBurns: { from: Rect; to: Rect }   // start/end crop rects → pan+zoom
    }

    // ── Stage 3: image ──
    image?: {
      path: string                  // assets/images/seg-003.png (relative to project dir)
      seed: number                  // for reproducible regeneration
      provider: string              // e.g. "replicate:flux-1.1-pro"
      approved: boolean             // per-image approval (regenerate rejects individually)
    }

    // ── Stage 4: voiceover ──
    audio?: {
      path: string                  // assets/audio/seg-003.mp3
      durationSec: number           // measured → drives timeline length
      words: Array<{ word: string; start: number; end: number }>  // captions + sync
    }
  }>

  // ── Stage 5: assemble (derived; what Remotion consumes) ──
  timeline?: {
    fps: number
    totalDurationSec: number
    // Each segment becomes a Remotion <Sequence>: image + kenBurns + audio + captions.
    // Derived from segment audio durations — regenerated, never hand-edited.
  }
}
```

**Rationale:**

- **Segments are the spine.** Script writes `narration`; shotlist attaches `shot`; images attach `image`; voiceover attaches `audio`. Stages only add; never mutate upstream. This makes stages idempotent and gates meaningful (approving the script freezes `narration`).
- **Stable `segment.id`** is the join key — regenerating one image touches only that segment.
- **`seed` per image** supports both exact reproduction and "regenerate differently."
- **Word-level `words[]`** drives captions *and* how long each still stays on screen — picture follows voice, so they're in sync by construction.
- **`timeline` is derived** from segment audio durations, never authored — always consistent with what was approved.

## Stages, gates & data flow

Linear chain. Each stage reads the manifest, does its slice, sets `stages[name].status`, writes back. The UI presents a gate when a stage reaches `awaiting_review`.

| # | Stage | Input → Output | Gate after? |
|---|-------|----------------|-------------|
| 0 | **Brief** | UI form → `brief` | — (input) |
| 1 | **Script** | `brief` → `segments[].narration` (LLM, structured output) | ✅ **Gate 1** — edit/reorder/add/delete segments, rewrite narration |
| 2 | **Shotlist** | each `narration` → `shot.imagePrompt` + `kenBurns` (LLM) | ✅ **Gate 2** — edit prompts before spending image $ |
| 3 | **Images** | each `imagePrompt` → Replicate Flux → `image.path` | ✅ **Gate 3** — gallery; approve / regenerate (new seed or edited prompt) per image |
| 4 | **Voiceover** | each `narration` → ElevenLabs → `audio.path` + `words[]` | ✅ **Gate 4** — listen per segment; regenerate individually |
| 5 | **Assemble** | segments → `timeline`; then Remotion preview/render | ✅ **Final** — preview, then trigger render to MP4 |

**Flow principles:**

- **Gates = status + the rule "can't start stage N+1 until stage N is `approved`."** `core` exposes `canRun(stage)`; the UI enforces it.
- **Editing at a gate writes straight to the manifest** — the manifest *is* the editing surface.
- **Stages are idempotent and segment-scoped.** Re-running Images regenerates only segments whose `image` is missing/unapproved; approved ones are skipped. Same for voiceover. A partial failure mid-batch just resumes.
- **Gate-2/3 split rationale:** Shotlist gate is text-only and cheap; Images gate is where the money is. Reviewing prompts *before* generating 30–60 images is the biggest cost-saver after the script gate.
- **Async handling (v1, simple):** Image/TTS batches run as an in-process background job; each segment updates the manifest as it completes; UI polls/streams progress. No queue engine — this is the seam where Trigger.dev would later drop in without touching stage logic.
- **Images and Voiceover are independent** (both only read approved `narration`) and could run in parallel; v1 keeps them sequential with their own gates for review simplicity. The data model doesn't force the order.

## Concrete interfaces (contracts for the executor)

These are the contracts each unit must satisfy. Signatures are guidance for the plan, not frozen API — but the shapes (manifest in, manifest out; providers injectable) are load-bearing for testability and resumability.

```ts
// packages/core/manifest.ts
export function loadManifest(projectDir: string): Manifest      // validates with zod on read
export function saveManifest(projectDir: string, m: Manifest): void
export function canRun(m: Manifest, stage: StageName): boolean  // enforces gate ordering

// Providers are INJECTED into stages so tests can mock them.
// packages/core/providers/*.ts
export interface LlmClient {
  // structured output — returns typed objects, no parsing
  complete<T>(args: { system: string; user: string; schema: ZodSchema<T> }): Promise<T>
}
export interface ImageClient {
  generate(args: { prompt: string; seed: number; width: number; height: number })
    : Promise<{ url: string; provider: string }>
}
export interface TtsClient {
  speak(args: { text: string; voiceId: string })
    : Promise<{ audio: Buffer; words: Array<{ word: string; start: number; end: number }> }>
}

// packages/core/stages/*.ts — every stage has this shape:
//   read manifest → do only its slice → write manifest (per-segment, idempotent)
export type StageDeps = { llm: LlmClient; images: ImageClient; tts: TtsClient }
export type Stage = (projectDir: string, deps: StageDeps) => Promise<void>

export const runScript: Stage      // brief → segments[].narration
export const runShotlist: Stage    // narration → shot.imagePrompt + kenBurns
export const runImages: Stage      // imagePrompt → image.{path,seed,provider}; skips approved
export const runVoiceover: Stage   // narration → audio.{path,durationSec,words}; skips approved
export const runAssemble: Stage    // segments → timeline (derived)
```

**Contract notes:**
- Stages take `(projectDir, deps)` and return `void` — all state lives in the manifest on disk. This is what makes them resumable and unit-testable with fake `deps`.
- `runImages`/`runVoiceover` MUST skip segments already populated-and-approved, and MUST persist each segment as it completes (not in a final batch).
- The web layer calls these stage functions; it never re-implements stage logic.

## Service mapping & external dependencies

| Concern | Service | Specifics |
|---|---|---|
| **Script + shotlist drafting** | **Anthropic Claude** (via SDK) | Structured output (tool/JSON schema) → typed `segments`/`shots`, no parsing. OpenAI is a drop-in alt behind `providers/llm.ts`. |
| **Image generation** | **Replicate → Flux** (`flux-1.1-pro` finals, `flux-dev` for cheap iterations) | Prompt + seed + aspect-ratio dims; download returned URL into `assets/images/`. |
| **Voiceover + timestamps** | **ElevenLabs** | Per-segment TTS via the `with-timestamps` endpoint — word timestamps feed captions and image durations. Voice id in `brief` (later). |
| **Assembly & render** | **Remotion** | Composition consumes manifest as `inputProps`; Ken Burns via `interpolate` over `kenBurns.from→to`, audio per `<Sequence>`, captions from `words[]`. Local render v1; Remotion Lambda is the cloud path later. |
| **Orchestration / UI** | **Next.js** (`packages/web`) | Route handlers / server actions call `core`; React gates. Filesystem store, no DB. |

**Cost control is structural**, not bolted on: text gates (script, shotlist) are nearly free and come *before* the expensive image/audio stages, so bad runs die cheaply. A rough 8-min run ≈ ~40 images + ~40 short TTS calls + 2 LLM calls — all review-gated.

## Error handling & resumability

- **Per-segment, idempotent stages.** Results are written to the manifest *as each segment completes*. If image #27/40 fails, segments 1–26 are saved; re-running picks up at 27. Approved results are never regenerated.
- **Stage status captures failure.** A thrown error sets `stages[name].status = "error"` + `error`; the UI surfaces it with a "retry failed segments" action. No silent half-commit.
- **Provider calls: bounded retries with backoff** (transient 429/5xx) in provider clients, then surface to the manifest. No infinite loops.
- **Validation on load.** Every stage validates the manifest against the zod schema on read; malformed manifests fail loudly.
- **Reproducibility.** Seeds stored per image; LLM prompts/responses logged to `projects/<slug>/runs/` so regenerations are explainable.
- **Render is the only non-incremental step** but it's pure — same approved manifest always yields the same video, touches no external APIs, can't corrupt state.

Throughline: **a failure anywhere leaves a valid, partially-filled manifest you can resume from.** No run is ever unrecoverable.

## Testing strategy

Test structure and wiring, not non-deterministic creative output.

- **`core` stages — unit tests with mocked providers.** Assert each stage reads the right fields, writes only its own slice, leaves upstream fields untouched, and is idempotent (twice = once). Bulk of the value.
- **Manifest schema — round-trip tests.** Sample manifests at each stage validate; malformed ones reject. Catches contract drift.
- **Resumability — failure-injection tests.** Mock provider throws on segment N; assert segments < N persisted and re-run completes the remainder.
- **`canRun(stage)` gate logic — pure unit tests.**
- **Render — smoke test.** Tiny 2-segment fixture manifest mounts the Remotion composition and computes the right total duration. No pixel comparison.
- **Creative quality** is validated by the human gates, not unit tests.

TDD where deterministic (stage logic, schema, gates, resumability); human review for creative output.

## Out of scope (v1)

- Multiple images per segment (`shots[]`) — deferred; one image per segment for now.
- Generated video clips / mixed media — Ken Burns stills only.
- Durable workflow engine (Trigger.dev / Inngest) — designed-for but not built; in-process runner for v1.
- Cloud render (Remotion Lambda) — local render only.
- Multi-user / hosting / auth — local single-user.
- Background music / sound design — narration track only for v1.

## Future graduation paths

- **Durability:** swap the in-process job runner for Trigger.dev at the async-batch seam without touching stage logic.
- **Cloud render:** Remotion Lambda.
- **Multi-image segments:** `shot` → `shots[]`.
- **Richer media:** generated video clips, stock footage, maps, on-screen text.
