import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, loadManifest } from "@doc/core";
import { runStageWith } from "./runner.js";
import { makeFakeDeps } from "@doc/core";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("runStageWith records error status when a stage throws", async () => {
  const root = mkdtempSync(join(tmpdir(), "root-")); dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "f",
  }, "2026-06-26T00:00:00.000Z");

  const failing = makeFakeDeps({
    llm: { complete: async () => { throw new Error("boom"); } },
  });

  await expect(runStageWith(dir, "script", failing)).rejects.toThrow("boom");
  expect(loadManifest(dir).stages.script.status).toBe("error");
  expect(loadManifest(dir).stages.script.error).toContain("boom");
});
