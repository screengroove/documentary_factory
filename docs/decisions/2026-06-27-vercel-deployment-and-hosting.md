# Decision Log — Vercel deployment & hosting architecture

**Date:** 2026-06-27
**Status:** UI deployed and live; "create documentary" flow NON-FUNCTIONAL on Vercel. Hosting architecture decision OPEN.
**Owner:** Patrick

---

## 1. Goal

Deploy the documentary pipeline web app (`packages/web`, Next.js 15 monorepo) to Vercel and have it work end-to-end.

## 2. What was done (all completed this session)

Vercel project: **`ironiks/documentary_factory`** (team `ironiks`, project id `prj_JD0MDLWSocfO0xlAHv786Ar00WoA`).
Stable alias: **https://documentaryfactory.vercel.app**

Fixes applied, in order:
1. **Linked** repo to `ironiks/documentary_factory` (`.vercel/project.json`).
2. **Env vars → Production** (encrypted): `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN` (values read from root `.env`).
3. **Root Directory** `.` → `packages/web` and **Framework** `Other` → `nextjs` — set via Vercel REST API (`PATCH /v9/projects/{id}`), because these are project-level settings not expressible in `vercel.json`. (Original 404 was because Vercel built the repo root, which has no Next.js app.)
4. **Build deps**: added `typescript` + `@types/node` to `packages/web` **devDependencies** (was only `@types/react`). Vercel scopes install to the `packages/web` workspace subtree, so root-only devDeps (`typescript`, `@types/node`) weren't installed → `next.config.ts` (a TS config) + `ignoreBuildErrors:false` type-check both failed with "Cannot find module 'typescript'". Regenerated `package-lock.json`. Verified `npm run build` passes locally.
5. **`.vercelignore`** created with `/projects/` — the runtime-generated documentaries dir (~255 MB, gitignored, 0 files tracked) was being bundled into the serverless function and blew the 250 MB unzipped limit.

Result: build succeeds, **homepage live (HTTP 200, `<title>Documentary Pipeline</title>`)**.

## 3. The blocker (confirmed from live logs)

`POST /api/projects` → `createProject()` → `mkdirSync`/`writeFileSync` to local `projects/`. On Vercel the function FS (`/var/task`) is **read-only** → `ENOENT: ... mkdir '/var/task/projects/.../assets/images'` → 500 → UI hangs on "Creating…".

Note: a separate `toLowerCase` error seen in logs was from a manual probe sending `{title}` instead of `{topic}`; the real `CreateForm.tsx` sends `topic` correctly. **Only one real bug from the UI: the FS write.**

This is not isolated to create — the **whole pipeline is filesystem-centric**:

| Stage | Network work | Local-FS write | Serverless-viable? |
|---|---|---|---|
| `script` | Anthropic LLM | `saveManifest` | ❌ FS write |
| `images` | Replicate | `writeFileSync` images | ❌ FS write |
| `voiceover` | Replicate TTS | `writeFileSync` audio | ❌ FS write |
| `assemble`/render | **Remotion** | writes `out/` | ❌ FS **+** needs Chromium+ffmpeg, runs minutes |

Two hard walls on Vercel serverless: (1) no persistent writable FS (even `/tmp` is ephemeral/not shared); (2) Remotion render needs headless Chromium + ffmpeg and exceeds function time/mem limits.

Good news: providers are all **network APIs** (Anthropic, Replicate) — no local Python/binaries spawned. Blocker is **storage + the render step**, not the AI calls.

## 4. Decision: storage

**Use Supabase for storage** (user preference). Maps cleanly:
- Postgres → manifests (replaces `saveManifest`/`loadManifest` FS reads/writes).
- Supabase Storage (S3-compatible) → image/audio/video assets (replaces `writeFileSync` + the `/api/assets/[slug]/[...path]` FS reader).

Caveat surfaced to user: **Supabase ≠ Railway in role.** Supabase solves *storage*. It does NOT run the heavy Remotion render — Supabase Edge Functions are Deno, short-lived (~few hundred sec), 256 MB, no Chromium/ffmpeg. So a render host is still needed.

With storage on Supabase, the light stages (`script`/`images`/`voiceover`) *could* run as Vercel functions if their FS writes are swapped for Supabase Storage and they fit the timeout (Replicate polling is slow → may need background/fluid compute).

## 5. Decision: render host — STILL OPEN

Options presented:
- **Remotion Lambda (AWS)** — serverless render, pay-per-render, no always-on server; one-time AWS IAM/S3 setup. Best "stay fully cloud" fit.
- **Render locally for now** — cheapest/fastest; render on Patrick's machine, upload MP4 to Supabase. No AWS. Good 80/20 if it's mainly Patrick using it.
- **Container worker (Fly/Render)** — a single render worker; no AWS lock-in.

### Railway vs Fly (per user request)

Render workload = heavy (Chromium+ffmpeg, RAM-hungry, minutes/job, **bursty/occasional**).

**Railway** — Pros: simplest DX (GitHub/Dockerfile auto-build, monorepo-friendly, dashboard-driven, easy volumes/env/logs), great for an always-on worker. Cons: usage-based RAM/CPU billing (heavy spiky renders run it up; idle worker still bills), no native scale-to-zero/per-job VM, fewer regions, per-plan RAM ceilings (verify ≥2–4 GB).

**Fly.io** — Pros: **Fly Machines = on-demand burst** (start a VM per render, stop when done → pay only for render seconds — best fit for bursty rendering), big machines (dedicated CPU, lots of RAM), multi-region, full Docker control. Cons: more ops (flyctl/fly.toml/networking/volume quirks, learning curve), you build the orchestration (spawn→render→upload→stop), more hands-on debugging.

**Recommendation given:** renders are bursty → **Fly Machines** is the better architectural/cost fit; **Railway** if "working today, minimal ops" matters more. And if it's mainly Patrick → **render locally + store to Supabase** sidesteps both (zero extra infra).

## 6. Open questions for next session

1. **Render host decision** — Remotion Lambda vs local vs Fly vs Railway. (Leaning: local-for-now or Fly Machines; depends on usage = personal vs public app — unconfirmed.)
2. Is the deployed app meant to be **public/multi-user** or **Patrick's personal hosted tool**? This drives 1 heavily.
3. Scope of the **storage refactor**: abstract FS access in `@doc/core` (`project.ts`, `manifest.ts`, `stages/*`) and `packages/web/src/lib/projects.ts` behind a storage interface, then implement a Supabase backend. The light stages also need a run model on Vercel (timeouts) if not run on the render host too.

## 7. Key references

- Project: `ironiks/documentary_factory` · alias https://documentaryfactory.vercel.app
- Settings changed via `PATCH https://api.vercel.com/v9/projects/{id}?teamId=team_RoEPMlJOESctbhDu2KT0ofQn` (token from `~/Library/Application Support/com.vercel.cli/auth.json`).
- FS-coupled code: `packages/core/src/project.ts`, `packages/core/src/manifest.ts`, `packages/core/src/stages/{images,voiceover}.ts`, `packages/web/src/lib/projects.ts`, `packages/web/src/lib/runner.ts`, `packages/web/src/app/api/projects/**`.
- Implementation plan: `docs/superpowers/plans/2026-06-26-documentary-pipeline.md`.
