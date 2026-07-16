# Auto Mode — skip all approval gates (prompt → rendered MP4)

## Context

Today a documentary requires 5 manual "Run" clicks + 4 "Approve" clicks + 1 "Render" click, all driven from the gate page (`GateClient.tsx`), one HTTP call at a time. The user wants an opt-in **Auto mode**: a toggle near the prompt on the create form (with instructional text) that makes the whole pipeline — script → shotlist → images → voiceover → assemble → final MP4 render — run back-to-back with no human gates.

Decisions made with the user:
- **Orchestration: client-side driver** on the gate page. It chains the *existing* run/approve/render API calls, so we reuse all routes, get progress UI via the existing 2.5s polling, and get resume-on-reload for free (the driver re-derives the next step from the manifest). No new server orchestrator.
- **Music: unchanged (silent).** Auto-mode renders ship without music, same as an untouched manual project. Do NOT touch `assemble.ts`.
- **Cancel: one-way "Switch to manual" button** on an auto-mode banner, persisted to the manifest so a reload stays manual. No re-enable UI.

Branch already exists: `feat/auto-mode-skip-gates` (off main @ 58cda60).

## Key existing mechanisms (reuse, do not modify)

- `packages/core/src/manifest.ts` — `STAGE_NAMES` (L10), `StageStateSchema` statuses `pending|running|awaiting_review|approved|error` (L13-17), brief schema (L90-97), `canRun` (L142-148, requires all earlier stages approved).
- Stage runners self-set `running` → `awaiting_review`; only `approveStage` (`packages/web/src/lib/edits.ts:5-22`) sets `approved`, and it throws unless status is exactly `awaiting_review`.
- Routes: `POST /api/projects/[slug]/run` `{stage}`, `.../approve` `{stage}`, `.../render` (synchronous remotion render → `out/<slug>.mp4`), `GET .../manifest` (polling), `HEAD .../video` (mp4 existence probe).
- `GateClient.tsx`: `activeStage` (L10-12), `approve()` (L140), `renderVideo()` (L145), `longPost` (L119-138, polls manifest every 2.5s while a request is in flight), `checkVideo` (L65-69), render button gating (L160-163).
- House UI idioms: native checkbox in `<label className="mono">` (GateClient.tsx:467-475); faint helper text `fontSize:12, color:var(--text-faint)` (PronunciationPanel.tsx:59); `.ds-card`, `.btn btn--secondary btn--sm`, status CSS vars.

## Implementation steps

### 1. Schema flag — `packages/core/src/manifest.ts`
Add `autoMode: z.boolean().optional()` to the `brief` object (~L96). Optional ⇒ old manifests parse unchanged; **no `migrate()` change**.

### 2. Persisted cancel op — `packages/web/src/lib/edits.ts` + `packages/web/src/app/api/projects/[slug]/segments/route.ts`
- `edits.ts`: add `setAutoMode(dir, enabled)` — load manifest, set `m.brief.autoMode = enabled`, save. Mirror `setMusicEnabled`.
- `segments/route.ts`: add `setAutoMode` to the op dispatch chain (~L23-31).

### 3. Create form toggle — `packages/web/src/app/CreateForm.tsx`
- `const [autoMode, setAutoMode] = useState(false)`; include `autoMode` in the posted brief.
- Make the ds-card a column: existing input+button row on top; below it the house checkbox idiom labeled **Auto mode** plus helper text (faint, 12px):
  > Skips all review gates — script, shotlist, images, voiceover and assembly run back-to-back, then the final MP4 renders automatically. Keep the project page open; you can switch back to manual at any time.

### 4. Pure next-step helper — new `packages/web/src/app/p/[slug]/autoNext.ts`
```ts
export type AutoStep = { kind: "run" | "approve" | "render" | "wait"; stage?: StageName };
export function nextAutoStep(m: Manifest, videoReady: boolean): AutoStep
```
Logic: any stage `error` → `wait`; first non-approved stage: `pending` → `run`, `awaiting_review` → `approve`, `running` → `wait`; all approved → `videoReady ? wait : render`. Unit-testable without React.

### 5. Driver in `packages/web/src/app/p/[slug]/GateClient.tsx`
- `const auto = !!m.brief.autoMode;`
- Refs: `autoActing` (StrictMode double-fire guard), `renderTried` (at most one auto-render per page load). New state `videoChecked` set when `checkVideo` resolves — driver must not auto-render before the HEAD probe answers (prevents re-render on revisit of a finished project).
- `useEffect` deps `[auto, m, busy, actionError, videoReady, videoChecked]`: bail if `!auto || busy || actionError || autoActing.current`; compute `nextAutoStep`; dispatch to existing `longPost("run", {stage})` / `approve()` / (`videoChecked && !videoReady && !renderTried.current` → `renderVideo()`).
- **Running-state poller**: if `auto && !busy` and active stage is `"running"` (e.g. after a reload mid-run), `setInterval(refresh, 2500)` with cleanup, so the driver picks up `awaiting_review` and continues. (Server keeps executing a run after client disconnect.)
- **Auto banner** (shown when `auto`, near the messages block ~L251): ds-card with running-status tint; text "**Auto mode** — stages run and approve automatically through the final render."; on error swap to "Paused on an error — fix it below and auto mode will continue." (details stay in the existing error card); right-aligned `Switch to manual` button → `post("segments", { op: "setAutoMode", enabled: false })`, disabled while `busy`. Manual buttons remain visible/usable throughout.

### 6. Do NOT change
`runner.ts`, `approveStage` guard, `canRun`, run/approve/render/projects routes, `migrate()`, `assemble.ts` (music stays opt-in), home-page copy ("four human review gates" at `page.tsx:15-17` — the checkbox helper text carries the explanation).

## Tests (vitest, colocated like existing 99)

- `packages/core/src/manifest.schema.test.ts`: brief with `autoMode: true` parses; brief without it still parses (backcompat).
- `packages/web/src/lib/edits.test.ts`: `setAutoMode` persists the flag both ways.
- New `packages/web/src/app/p/[slug]/autoNext.test.ts`: pending→run; awaiting_review→approve; error anywhere→wait; running→wait; all approved + !videoReady→render; all approved + videoReady→wait.

## Verification

1. `npm run typecheck` and `npx vitest run` — all existing + new tests pass.
2. Manual e2e (needs `ANTHROPIC_API_KEY` + `REPLICATE_API_TOKEN` in env): `npm run dev`, create a short-topic doc with Auto mode checked → banner appears, stages march through run→approve automatically, render fires, video card appears — zero clicks after Create.
3. Reload mid-run → poller resumes, pipeline completes.
4. Force an images error (unset REPLICATE_API_TOKEN) → auto pauses on the error card; restore env, click Run manually → auto resumes to render.
5. "Switch to manual" mid-flight → nothing further auto-fires; reload → still manual.
6. Manual (unchecked) project → identical to today: no banner, no auto actions.

## Edge cases covered

- Old manifests (`autoMode` undefined) → manual; no migration.
- Double render / render-on-revisit → `renderTried` ref + `videoChecked` gate.
- React StrictMode double effects → `autoActing` ref.
- Stale approve (`approveStage` throws) → surfaces as `actionError`, driver halts safely.
- Server dies mid-run leaving `"running"` → same recovery as manual today (user re-runs the stage; driver continues).
