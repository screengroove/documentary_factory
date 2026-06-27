# Design — Railway deployment (entire app, single Railway service)

**Date:** 2026-06-27
**Status:** Approved — proceeding to implementation plan.
**Owner:** Patrick
**Supersedes (render-host portion of):** `docs/decisions/2026-06-27-vercel-deployment-and-hosting.md`

---

## 1. Decision summary

Deploy the **entire** documentary pipeline app as **one Railway service** with a **persistent volume**.

- **No Supabase.** Storage is the Railway volume; the existing filesystem code runs unchanged.
- **Personal tool**, mainly Patrick. Not optimizing for multi-user/public scale.
- **Vercel abandoned**, left as-is (not actively torn down).

This was chosen over "render-only worker" and "UI-on-Vercel + backend-on-Railway" because the pipeline is filesystem-centric: a persistent volume turns that from a liability into a feature and requires **zero storage refactor**.

## 2. What runs where

One Railway service runs `packages/web` (Next.js 15) in production (`next start`). It:

- Serves the UI.
- Runs the light stages (`script`, `shotlist`, `images`, `voiceover`) inside its API routes — these are network calls (Anthropic, Replicate) plus local FS writes to the volume.
- Runs the heavy `render` step by shelling out to `npx remotion render` (the existing `render/route.ts` behavior, unchanged).

```
Railway service: Next.js (UI + all API routes + all stages + Remotion render)
        │  fs read/write
        ▼
Railway volume  →  <repo>/projects/<slug>/...   (manifests + images + audio + MP4)
        │  network only
        ▼
Anthropic API · Replicate API
```

## 3. Precise scope of "runs unchanged"

**Important distinction:**

- **Storage code runs unchanged.** `packages/core/src/{project,manifest}.ts`, `packages/core/src/stages/*`, and `packages/web/src/lib/projects.ts` do plain `fs` against `PROJECTS_ROOT = <cwd>/../../projects`. A volume mounted at that path makes them work as-is.
- **The render step is NOT a storage operation and needs explicit packaging.** `packages/web/src/app/api/projects/[slug]/render/route.ts` does:
  ```
  execFileSync("npx", ["remotion", "render", "src/index.ts", "Documentary", outPath,
                        "--props", propsPath, "--public-dir", dir],
               { cwd: join(process.cwd(), "..", "render") })
  ```
  Next.js's build tracer cannot follow a string passed to a child process, so it does not know the render package exists. The container must therefore ship, at runtime: `packages/render/src/index.ts`, `packages/render/remotion.config.ts`, the `remotion` CLI on `PATH`, and `@doc/core` source. This is the highest-risk part of the deploy and is addressed by §4.

## 4. Container (Dockerfile)

A Dockerfile, **not** Nixpacks — Remotion's bundled headless Chromium needs system shared libraries that Nixpacks will not reliably provide.

Requirements baked into the image:

- **Base:** Node 22 on Debian slim.
- **System deps for Chromium:** libnss3, libatk/atk-bridge, libgbm, libdrm, libxkbcommon, libasound2, fonts, etc. The exact list is taken from the vendored `remotion-best-practices` skill at implementation time — not assembled from memory. (Remotion ships its own ffmpeg, so ffmpeg itself need not be installed.)
- **Full monorepo install.** Copy all three packages and run a single root `npm install` (npm workspaces). Do **NOT** use Next.js `output: "standalone"` and do **NOT** prune — standalone tracing would strip `packages/render` and `remotion`. (Confirmed: current `next.config.ts` does not set `standalone`; keep it that way.)
- **Pre-pull Chromium at build time** (`npx remotion browser ensure`, run from `packages/render`) so the first render is not a runtime network download that can fail.
- **Deterministic paths.** Pin `WORKDIR` to the repo root in-image so `projects/`, `packages/web`, and `packages/render` resolve predictably.
- **`.dockerignore`:** exclude `projects/`, `.next`, `node_modules`, `.git`, `.vercel`, `.DS_Store`, and other build artifacts to keep the build context small (the `projects/` dir is ~255 MB locally).

## 5. Runtime / start command

- The server must start with **cwd = `packages/web`**, because both `PROJECTS_ROOT = ../../projects` and the render route's `renderDir = ../render` are resolved relative to it.
- Start via `npm --workspace @doc/web run start` (i.e. `next start`) with that working directory, or an equivalent that yields the same cwd.
- `npx remotion` must resolve from `packages/web`'s cwd — it does, because a non-pruned root workspace install hoists the `remotion` CLI to root `node_modules/.bin`.

## 6. Storage / volume

- One Railway volume mounted at the absolute path equal to repo-root `projects/` (given the pinned WORKDIR).
- This is the **only** persistence layer — manifests, images, audio, and final MP4s all live here.
- Initial size ~10 GB (local `projects/` was ~255 MB; headroom for several documentaries).

## 7. Environment variables

- Set `ANTHROPIC_API_KEY` and `REPLICATE_API_TOKEN` as Railway **service variables** (the root `.env` is gitignored and absent from the image).
- `next.config.ts`'s `process.loadEnvFile(...)` already no-ops gracefully when the root `.env` is absent, so the app reads these from the process environment.

## 8. Provisioning steps (via Railway MCP)

1. Create project.
2. Create service (built from this GitHub repo / Dockerfile).
3. Create volume, mount at repo-root `projects/`.
4. Set service variables (`ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`).
5. Generate a public domain.
6. Deploy.

Repo/branch wiring and the first deploy trigger are part of implementation.

## 9. Known limitation (accepted, not fixed now)

The render route is **synchronous** (`execFileSync`): a multi-minute render blocks the Node event loop, including the renderer's own status polling. **Acceptable for single-user personal use.** Switching to async `spawn` is a small change available later; a job queue is YAGNI and out of scope.

## 10. Success criteria / verification

A green Railway build proves nothing about rendering. Success = a full end-to-end run **in the deployed container**:

1. Create a project from the UI.
2. Run `script` → `shotlist` → `images` → `voiceover`.
3. Render.
4. The resulting MP4 downloads and plays.

This single flow is what exercises the volume, the render-subprocess packaging, and Chromium together — it is the only verification that discriminates a working deploy from a build that merely compiled.

## 11. Out of scope

- Storage refactor / Supabase integration.
- Splitting render into a separate worker service.
- Job queue / async render orchestration.
- Multi-user, auth, public-app concerns.
- Tearing down the existing Vercel project.

## 12. Key references

- FS-coupled code: `packages/core/src/{project,manifest}.ts`, `packages/core/src/stages/*`, `packages/web/src/lib/projects.ts`, `packages/web/src/lib/runner.ts`.
- Render invocation: `packages/web/src/app/api/projects/[slug]/render/route.ts`.
- Render package: `packages/render/` (`src/index.ts`, `remotion.config.ts`).
- Prior decision log: `docs/decisions/2026-06-27-vercel-deployment-and-hosting.md`.
- Remotion system-deps reference: vendored `remotion-best-practices` skill.
