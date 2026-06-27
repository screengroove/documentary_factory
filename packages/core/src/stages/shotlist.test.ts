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

test("adds a still sequence with style-suffixed prompt and default weight to each segment", async () => {
  const dir = projectWithSegments();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({ stills: [{
      imagePrompt: "a stone tower at dusk", kenBurns: {
        from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      },
    }] }) },
  });

  await runShotlist(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments[0].stills?.[0].imagePrompt).toContain("35mm film");
  expect(m.segments[0].stills?.[0].weight).toBe(1); // model omitted weight → default 1
  expect(m.segments[1].stills?.[0].kenBurns.to.w).toBe(0.8);
  expect(m.stages.shotlist.status).toBe("awaiting_review");
});

test("uses a default Ken Burns move and weight when the model omits them", async () => {
  const dir = projectWithSegments();
  const deps = makeFakeDeps({
    // Model returns a prompt but no kenBurns/weight — must not crash the stage.
    llm: { complete: async ({ schema }) => schema.parse({ stills: [{ imagePrompt: "a tower at dusk" }] }) },
  });

  await runShotlist(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments[0].stills?.[0].kenBurns).toBeDefined();
  expect(m.segments[0].stills?.[0].kenBurns.to.w).toBe(0.9); // default gentle zoom
  expect(m.segments[0].stills?.[0].weight).toBe(1); // default weight
  expect(m.stages.shotlist.status).toBe("awaiting_review");
});

test("stores multiple weighted stills with their weights and length", async () => {
  const dir = projectWithSegments();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({ stills: [
      { imagePrompt: "wide establishing shot", weight: 3 },
      { imagePrompt: "close-up detail", weight: 1 },
    ] }) },
  });

  await runShotlist(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments[0].stills?.length).toBe(2);
  expect(m.segments[0].stills?.[0].weight).toBe(3);
  expect(m.segments[0].stills?.[1].weight).toBe(1);
});

test("skips segments that already have stills", async () => {
  const dir = projectWithSegments();
  let calls = 0;
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => { calls++; return schema.parse({ stills: [{
      imagePrompt: "x", kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } },
    }] }); } },
  });
  await runShotlist(dir, deps);          // 2 calls
  await runShotlist(dir, deps);          // 0 more — both already have stills
  expect(calls).toBe(2);
});
