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

// The single LLM call now also mints the opening title card, so the fake returns
// title/subtitle/titleImagePrompt alongside the segments.
function fullOutput(over: Record<string, unknown> = {}) {
  return {
    title: "Guardians of the Coast",
    subtitle: "A tale of light and tide",
    titleImagePrompt: "a lone lighthouse on a storm-battered cliff at dusk",
    segments: [{ narration: "First beat." }, { narration: "Second beat." }],
    ...over,
  };
}

test("writes ordered segments with ids and sets awaiting_review", async () => {
  const dir = project();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse(fullOutput()) },
  });

  await runScript(dir, deps);

  const m = loadManifest(dir);
  expect(m.segments.map((s) => s.id)).toEqual(["seg-001", "seg-002"]);
  expect(m.segments.map((s) => s.order)).toEqual([0, 1]);
  expect(m.segments[0].narration).toBe("First beat.");
  expect(m.stages.script.status).toBe("awaiting_review");
});

test("mints a title card: text set and imagePrompt ends with the brief imageStyle", async () => {
  const dir = project();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse(fullOutput()) },
  });

  await runScript(dir, deps);

  const m = loadManifest(dir);
  expect(m.title?.text).toBe("Guardians of the Coast");
  // imagePrompt = `${titleImagePrompt}, ${imageStyle}` — must end with the style.
  expect(m.title?.imagePrompt.endsWith(", film")).toBe(true);
});

test("carries subtitle and applies the default 4s Ken Burns title card", async () => {
  const dir = project();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse(fullOutput()) },
  });

  await runScript(dir, deps);

  const m = loadManifest(dir);
  expect(m.title?.subtitle).toBe("A tale of light and tide");
  expect(m.title?.durationSec).toBe(4);
  expect(m.title?.kenBurns).toBeDefined();
});

test("falls back to the brief topic when the model returns an empty title", async () => {
  const dir = project();
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse(fullOutput({ title: "   " })) },
  });

  await runScript(dir, deps);

  const m = loadManifest(dir);
  expect(m.title?.text).toBe("Lighthouses"); // the brief topic
});

test("is idempotent once approved (does not call the LLM again)", async () => {
  const dir = project();
  await runScript(dir, makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse(fullOutput()) },
  }));
  // approve it
  const m = loadManifest(dir);
  m.stages.script.status = "approved";
  const { saveManifest } = await import("../manifest.js");
  saveManifest(dir, m);

  let called = false;
  await runScript(dir, makeFakeDeps({
    llm: { complete: async ({ schema }) => { called = true; return schema.parse(fullOutput()); } },
  }));
  expect(called).toBe(false);
});
