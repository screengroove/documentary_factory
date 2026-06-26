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
