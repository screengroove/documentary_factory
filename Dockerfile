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
RUN cd packages/render && npx remotion browser ensure

ENV NODE_ENV=production
EXPOSE 3000

# Start with cwd = packages/web so PROJECTS_ROOT (../../projects) and the render
# route's renderDir (../render) resolve correctly.
WORKDIR /app/packages/web
CMD ["npx", "next", "start", "-H", "0.0.0.0"]
