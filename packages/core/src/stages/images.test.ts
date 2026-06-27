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
