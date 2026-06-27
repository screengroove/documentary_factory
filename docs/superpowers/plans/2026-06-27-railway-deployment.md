# Railway Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the entire documentary pipeline app as one Railway service with a persistent volume so the full create → render flow works end-to-end.

**Architecture:** A single Railway service runs the Next.js app (`packages/web`) in production. A Railway volume mounted at repo-root `projects/` provides persistence, so the existing filesystem code runs unchanged. The heavy render step shells out to `npx remotion render` inside the same container.

**Tech Stack:** Docker (Debian/Node 22), Next.js 15, Remotion 4 (bundled ffmpeg + headless Chromium), Railway (service + volume + MCP provisioning), npm workspaces.

## Global Constraints

- **No Supabase / no storage refactor.** Persistence is the Railway volume only.
- **No Next.js `output: "standalone"`** and no install pruning — the render subprocess needs `packages/render`, `remotion.config.ts`, `@doc/core` source, and the `remotion` CLI present at runtime.
- **Server must start with cwd = `packages/web`** (`PROJECTS_ROOT=../../projects` and `renderDir=../render` depend on it).
- **Volume mounts at repo-root `projects/`** (absolute path determined by the in-image WORKDIR).
- **Secrets via Railway service variables:** `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`. Never bake the root `.env` into the image.
- **Personal single-user tool.** Synchronous render is accepted; no job queue.
- Spec: `docs/superpowers/specs/2026-06-27-railway-deployment-design.md`.

---

## File Structure

- Create `Dockerfile` (repo root) — builds the full monorepo image, installs Chromium system deps, pre-pulls Chromium, starts Next.js from `packages/web`.
- Create `.dockerignore` (repo root) — keeps `projects/`, `.next`, `node_modules`, `.git`, `.vercel` out of the build context.
- Create `railway.json` (repo root) — pins the Dockerfile builder and the start command/restart policy so the service config is reproducible.
- No application source changes. The existing FS and render code is deployed as-is.

---

### Task 1: Containerize the app (Dockerfile + .dockerignore + railway.json)

**Files:**
- Create: `/Users/patrickiwanicki/Repos/documentary/Dockerfile`
- Create: `/Users/patrickiwanicki/Repos/documentary/.dockerignore`
- Create: `/Users/patrickiwanicki/Repos/documentary/railway.json`

**Interfaces:**
- Consumes: existing `package.json` workspaces, `packages/web` (`next start`), `packages/render` (remotion entry), root `.env` loading that no-ops when absent.
- Produces: a runnable image whose container serves the UI on `$PORT` and can shell out to `npx remotion render` from `packages/web`.

- [ ] **Step 1: Create `.dockerignore`**

```
node_modules
**/node_modules
.next
**/.next
projects
.git
.vercel
.DS_Store
*.tsbuildinfo
npm-debug.log
docs
```

- [ ] **Step 2: Create the `Dockerfile`**

```dockerfile
# Remotion needs a real (headless) Chromium at render time; Debian bookworm-slim
# + Remotion's documented system libs is the supported base. Node 22 LTS.
FROM node:22-bookworm-slim

# System libraries required by Remotion's headless Chromium. ffmpeg is bundled
# by Remotion v4, so it is intentionally not installed here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 \
    libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
    libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first for better layer caching, then the full monorepo.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/render/package.json packages/render/package.json
COPY packages/web/package.json packages/web/package.json

# Full workspace install (NOT pruned, NOT standalone) so the render subprocess
# can resolve packages/render, remotion.config.ts, @doc/core source, and the
# remotion CLI on PATH.
RUN npm install

# Copy the rest of the source.
COPY . .

# Build the Next.js app (cwd = packages/web).
RUN npm --workspace @doc/web run build

# Pre-pull the Remotion Chromium so the first render is not a runtime download.
RUN npx --prefix packages/render remotion browser ensure || \
    (cd packages/render && npx remotion browser ensure)

ENV NODE_ENV=production
EXPOSE 3000

# Start with cwd = packages/web so PROJECTS_ROOT (../../projects) and the render
# route's renderDir (../render) resolve correctly.
WORKDIR /app/packages/web
CMD ["npx", "next", "start", "-H", "0.0.0.0"]
```

- [ ] **Step 3: Create `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "npx next start -H 0.0.0.0",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- [ ] **Step 4: Verify the build locally if Docker is available**

Run:
```bash
command -v docker >/dev/null 2>&1 && docker build -t doc-railway:test . || echo "docker not available - will verify on Railway build instead"
```
Expected: either a successful image build (`naming to docker.io/library/doc-railway:test`), or the skip message. If the build fails on a missing apt package (bookworm renamed it, e.g. `libasound2` → `libasound2t64`), adjust the package name in the Dockerfile and rebuild until it succeeds.

- [ ] **Step 5: Smoke-test the container locally if Docker is available**

Run:
```bash
command -v docker >/dev/null 2>&1 && \
  docker run -d --rm -p 3000:3000 -e PORT=3000 --name doc-test doc-railway:test && \
  sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000 ; \
  docker rm -f doc-test 2>/dev/null || echo "skipped (no docker)"
```
Expected: `200` (homepage serves). Note: `npx next start` honors `-p`/`$PORT`; Railway injects `$PORT`, locally we map 3000. If the container exits, inspect with `docker logs doc-test`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore railway.json
git commit -m "feat(railway): containerize app with full-monorepo image and Chromium deps"
```

---

### Task 2: Provision Railway (project, service, volume, variables, domain)

**Files:** none (infrastructure via Railway MCP tools / CLI).

**Interfaces:**
- Consumes: Railway MCP connection (logged in as patrick@joltlabs.ai), the `Dockerfile`/`railway.json` from Task 1, secrets from root `.env`.
- Produces: a Railway project + service with a volume mounted at `/app/projects`, the two env vars set, and a public domain — ready to deploy.

- [ ] **Step 1: Confirm Railway auth**

Use the Railway MCP `whoami` tool (or `railway whoami`).
Expected: identifies Patrick Iwanicki / patrick@joltlabs.ai. If it fails, run `railway login` and retry.

- [ ] **Step 2: Create the project**

Use Railway MCP `create_project` (name e.g. `documentary-factory`).
Expected: returns a project id. Record it.

- [ ] **Step 3: Create the service**

Use Railway MCP `create_service` in that project. Source = this GitHub repo (`screengroove/documentary_factory`) on branch `feat/railway-deployment`, OR (if GitHub wiring is friction) prepare for a CLI `railway up` deploy from the local dir in Task 3. Either way the builder is the Dockerfile (per `railway.json`).
Expected: returns a service id. Record it.

- [ ] **Step 4: Create and mount the volume**

Use Railway MCP `create_volume` on the service with mount path `/app/projects` and size ~10 GB.
Expected: volume created and attached. The mount path MUST be `/app/projects` so it equals repo-root `projects/` given the image WORKDIR `/app`.

- [ ] **Step 5: Set service variables**

Read the two secrets from the root `.env` and set them on the service via Railway MCP `set_variables`: `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`.
Expected: `list_variables` shows both present (values masked).

- [ ] **Step 6: Generate a public domain**

Use Railway MCP `generate_domain` for the service (the app listens on the container port; ensure the target port matches what `next start` binds, i.e. Railway's injected `$PORT`).
Expected: returns a `*.up.railway.app` URL. Record it.

- [ ] **Step 7: Verify service config**

Use Railway MCP `get_service_config` / `list_variables` / `list_domains`.
Expected: Dockerfile builder, volume mounted at `/app/projects`, both env vars present, one domain. No commit (infra only).

---

### Task 3: Deploy and verify end-to-end

**Files:** none (deploy + manual verification).

**Interfaces:**
- Consumes: the provisioned service (Task 2) and committed image config (Task 1).
- Produces: a live deployment that serves the UI and completes a full render to a playable MP4 on the volume.

- [ ] **Step 1: Push the branch (if deploying from GitHub)**

```bash
git push -u origin feat/railway-deployment
```
Expected: branch pushed. If push returns HTTP 403, the active git account lacks write to `screengroove` — run `gh auth status` and ensure the `screengroove` account is active (see decision log §8), then retry. If deploying via `railway up` instead, skip this step.

- [ ] **Step 2: Trigger the deploy**

Use Railway MCP `deploy` (GitHub-connected) or run `railway up` from the repo root (local upload). 
Expected: a build starts.

- [ ] **Step 3: Watch the build/deploy logs**

Use Railway MCP `get_logs` (and `list_deployments` for status).
Expected: image builds (apt deps install, `npm install`, `next build`, `remotion browser ensure` all succeed), container starts, no crash loop. If a system lib is missing at render time, add it to the Dockerfile (Task 1 Step 2) and redeploy.

- [ ] **Step 4: Verify the homepage is live**

Run (substitute the generated domain):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<service-domain>
```
Expected: `200`.

- [ ] **Step 5: End-to-end render check (the real verification)**

In a browser at the service domain:
1. Create a project (enter a topic, submit) — must NOT 500 (the volume makes the FS write succeed).
2. Run `script` → `shotlist` → `images` → `voiceover`, approving gates as needed.
3. Trigger render.
4. Confirm the resulting MP4 is produced and plays (download/preview).

Expected: an MP4 is rendered and plays. This is the success criterion from the spec §10 — it exercises the volume, the render-subprocess packaging, and Chromium together. If render fails, read `get_logs` for the Remotion stderr tail (the route forwards it) and fix the Dockerfile or config accordingly, then redeploy.

- [ ] **Step 6: Record outcome in the decision log**

Update `docs/decisions/2026-06-27-vercel-deployment-and-hosting.md` §5 to mark Railway as the chosen render host with the live domain, then commit:
```bash
git add docs/decisions/2026-06-27-vercel-deployment-and-hosting.md
git commit -m "docs(railway): record Railway as render host, deployment live"
```

---

## Self-Review

**Spec coverage:**
- Spec §2 (what runs where) → Task 1 (single image runs web + render).
- Spec §3 (render packaging) → Task 1 Steps 2 (no standalone/prune, full install).
- Spec §4 (Dockerfile, Chromium deps, pre-pull, .dockerignore, WORKDIR) → Task 1 Steps 1–2.
- Spec §5 (cwd = packages/web) → Task 1 Step 2 (final WORKDIR) + railway.json startCommand.
- Spec §6 (volume at projects/) → Task 2 Step 4 (mount `/app/projects`).
- Spec §7 (env vars) → Task 2 Step 5.
- Spec §8 (provisioning steps) → Task 2.
- Spec §10 (end-to-end verification) → Task 3 Step 5.
- Spec §9 (sync render accepted) → Global Constraints; no task needed.

**Placeholder scan:** No TBD/TODO; the one empirical unknown (exact bookworm apt package names) is handled by a concrete default list plus a build-verify-and-adjust loop (Task 1 Step 4), not a placeholder.

**Type/path consistency:** Volume mount `/app/projects` matches WORKDIR `/app` so it equals repo-root `projects/`. Start cwd `/app/packages/web` matches the render route's `../render` and `PROJECTS_ROOT` `../../projects`. `railway.json` startCommand and the Dockerfile CMD both run `next start` from `packages/web`.
