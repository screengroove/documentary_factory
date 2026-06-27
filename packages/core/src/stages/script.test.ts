import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest } from "../manifest.js";
import { runScript } from "./script.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  return createProject(root, "doc", {
    topic: "Lighthouses", targetMinutes: 6, tone: "wistful", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("writes ordered segments with ids and sets awaiting_review", async () => {
  const dir = project();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) =>
      schema.parse({ segments: [{ narration: "First beat." }, { narration: "Second beat." }] }) },
  });

  await runScript(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments.map((s) => s.id)).toEqual(["seg-001", "seg-002"]);
  expect(m.segments.map((s) => s.order)).toEqual([0, 1]);
  expect(m.segments[0].narration).toBe("First beat.");
  expect(m.stages.script.status).toBe("awaiting_review");
});

test("is idempotent once approved (does not call the LLM again)", async () => {
  const dir = project();
  await runScript(dir, makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({ segments: [{ narration: "A" }] }) },
  }));
  // approve it
  const m = loadManifest(dir);
  m.stages.script.status = "approved";
  const { saveManifest } = await import("../manifest.js");
  saveManifest(dir, m);

  let called = false;
  await runScript(dir, makeFakeDeps({
    llm: { complete: async ({ schema }) => { called = true; return schema.parse({ segments: [] }); } },
  }));
  expect(called).toBe(false);
});
