import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { STAGE_NAMES, saveManifest, type Manifest } from "./manifest.js";

export type Brief = Manifest["brief"];

export function projectPaths(projectDir: string) {
  return {
    images: join(projectDir, "assets/images"),
    audio: join(projectDir, "assets/audio"),
    music: join(projectDir, "assets/music"),
    out: join(projectDir, "out"),
    runs: join(projectDir, "runs"),
  };
}

export function createProject(rootDir: string, slug: string, brief: Brief, now: string): string {
  // An empty slug would resolve to rootDir itself and write a manifest into the
  // projects root (e.g. a topic with no latin letters slugifies to "").
  if (!slug) throw new Error("Project slug is empty — the topic needs letters or numbers");
  const dir = join(rootDir, slug);
  const p = projectPaths(dir);
  for (const d of [p.images, p.audio, p.music, p.out, p.runs]) mkdirSync(d, { recursive: true });

  const stages = Object.fromEntries(
    STAGE_NAMES.map((n) => [n, { status: "pending" as const }]),
  ) as Manifest["stages"];

  saveManifest(dir, { version: 1, slug, createdAt: now, brief, stages, segments: [] });
  return dir;
}
