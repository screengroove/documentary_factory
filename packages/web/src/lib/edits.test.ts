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
  approveStage(dir, "script");
  expect(loadManifest(dir).stages.script.status).toBe("approved");
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
