import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, loadManifest, saveManifest, type Still } from "@doc/core";
import { approveStage, editNarration, editPrompt, rejectImage, rejectAudio } from "./edits.js";

const dirs: string[] = [];
function proj() {
  const root = mkdtempSync(join(tmpdir(), "root-")); dirs.push(root);
  return createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "f",
  }, "2026-06-26T00:00:00.000Z");
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// Build a Zod-valid still; pass `image` overrides (or null for a still with no image).
const RECT = { x: 0, y: 0, w: 1, h: 1 };
function still(prompt: string, image?: Still["image"] | null): Still {
  return {
    imagePrompt: prompt,
    kenBurns: { from: RECT, to: RECT },
    weight: 1,
    ...(image === null || image === undefined ? {} : { image }),
  };
}

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

test("approveStage('images') approves every still's image across all segments", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.stages.images.status = "awaiting_review";
  m.segments = [
    { id: "seg-001", order: 0, narration: "a", stills: [
      still("p1", { path: "p1", seed: 1, provider: "x", approved: false, needsRegen: true }),
      still("p2", { path: "p2", seed: 2, provider: "x", approved: false }),
    ] },
    { id: "seg-002", order: 1, narration: "b", stills: [
      still("p3"),                                                    // no image — must be skipped
      still("p4", { path: "p4", seed: 4, provider: "x", approved: false, needsRegen: true }),
    ] },
  ];
  saveManifest(dir, m);
  approveStage(dir, "images");
  const segs = loadManifest(dir).segments;
  // Every still that HAS an image is approved with needsRegen cleared.
  for (const s of segs) for (const st of s.stills ?? []) {
    if (st.image) { expect(st.image.approved).toBe(true); expect(st.image.needsRegen).toBeUndefined(); }
  }
  // The image-less still is untouched (still has no image).
  expect(segs[1].stills![0].image).toBeUndefined();
  expect(loadManifest(dir).stages.images.status).toBe("approved");
});

test("editNarration updates text before script approval", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "old" }];
  saveManifest(dir, m);
  editNarration(dir, "seg-001", "new");
  expect(loadManifest(dir).segments[0].narration).toBe("new");
});

test("editPrompt edits the imagePrompt of the still at the given index", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n", stills: [still("first"), still("second")] }];
  saveManifest(dir, m);
  editPrompt(dir, "seg-001", 1, "edited");
  const stills = loadManifest(dir).segments[0].stills!;
  expect(stills[1].imagePrompt).toBe("edited");
  expect(stills[0].imagePrompt).toBe("first"); // other stills untouched
});

test("editPrompt throws on an out-of-range still index", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n", stills: [still("only")] }];
  saveManifest(dir, m);
  expect(() => editPrompt(dir, "seg-001", 5, "x")).toThrow();
});

test("rejectImage flips approved to false and can set a new seed", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n", stills: [
    still("p0", { path: "a", seed: 0, provider: "x", approved: true }),
    still("p1", { path: "p", seed: 1, provider: "x", approved: true }),
  ] }];
  saveManifest(dir, m);
  rejectImage(dir, "seg-001", 1, { seed: 99 });
  const got = loadManifest(dir).segments[0].stills![1].image!;
  expect(got.approved).toBe(false);
  expect(got.needsRegen).toBe(true);
  expect(got.seed).toBe(99);
  // The other still is untouched.
  expect(loadManifest(dir).segments[0].stills![0].image!.approved).toBe(true);
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
