import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, loadManifest, saveManifest } from "@doc/core";
import { approveStage, editNarration, rejectImage, rejectAudio } from "./edits.js";

const dirs: string[] = [];
function proj() {
  const root = mkdtempSync(join(tmpdir(), "root-")); dirs.push(root);
  return createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "f",
  }, "2026-06-26T00:00:00.000Z");
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("approveStage marks the stage approved", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.stages.script.status = "awaiting_review";
  saveManifest(dir, m);
  approveStage(dir, "script");
  expect(loadManifest(dir).stages.script.status).toBe("approved");
});

test("approveStage refuses to approve a stage that is not awaiting_review", () => {
  const dir = proj();
  // Freshly created: script is "pending" — must not be approvable.
  expect(() => approveStage(dir, "script")).toThrow(/awaiting_review/);

  // An errored stage must not be approvable either (the bug that corrupted a project).
  const m = loadManifest(dir);
  m.stages.shotlist.status = "error";
  saveManifest(dir, m);
  expect(() => approveStage(dir, "shotlist")).toThrow(/awaiting_review/);
});

test("editNarration updates text before script approval", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "old" }];
  saveManifest(dir, m);
  editNarration(dir, "seg-001", "new");
  expect(loadManifest(dir).segments[0].narration).toBe("new");
});

test("rejectImage flips approved to false and can set a new seed", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n",
    image: { path: "p", seed: 1, provider: "x", approved: true } }];
  saveManifest(dir, m);
  rejectImage(dir, "seg-001", { seed: 99 });
  const got = loadManifest(dir).segments[0].image!;
  expect(got.approved).toBe(false);
  expect(got.seed).toBe(99);
});

test("rejectAudio clears audio so it will regenerate", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n",
    audio: { path: "a", durationSec: 1, words: [] } }];
  saveManifest(dir, m);
  rejectAudio(dir, "seg-001");
  expect(loadManifest(dir).segments[0].audio).toBeUndefined();
});
