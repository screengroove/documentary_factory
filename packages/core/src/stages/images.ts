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
    if (!seg.stills) throw new Error(`Segment ${seg.id} has no stills; run shotlist first`);

    // One image per still. The still index folds into both the seed and the
    // filename so different stills in a segment get different images.
    for (let i = 0; i < seg.stills.length; i++) {
      const still = seg.stills[i];
      // Skip approved images AND freshly-generated ones awaiting review; only
      // (re)generate when the image is missing or explicitly flagged by rejectImage.
      if (still.image && !still.image.needsRegen) continue;

      const seed = still.image?.seed ?? deterministicSeed(`${seg.id}:${i}`);
      const { url, provider } = await deps.images.generate({
        prompt: still.imagePrompt, seed, width, height,
      });

      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`Image download failed for ${seg.id}-${i}: ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const rel = `assets/images/${seg.id}-${i}.png`;
      writeFileSync(join(projectPaths(projectDir).images, `${seg.id}-${i}.png`), bytes);

      still.image = { path: rel, seed, provider, approved: false };
      saveManifest(projectDir, m); // persist per-still
    }
  }

  m.stages.images.status = "awaiting_review";
  saveManifest(projectDir, m);
}
