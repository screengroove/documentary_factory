import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, loadManifest, saveManifest, type Still, type Title } from "@doc/core";
import { approveStage, editNarration, editPrompt, rejectImage, rejectAudio, editTitle, rejectTitleImage, setMusicTrack, setMusicEnabled, setPronunciations, prepareReRecord, uploadStillImage } from "./edits.js";

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

// Build a Zod-valid title; pass `image` overrides (or null for no image yet).
function title(image?: Title["image"] | null): Title {
  return {
    text: "My Title",
    subtitle: "A subtitle",
    imagePrompt: "tp",
    durationSec: 3,
    kenBurns: { from: RECT, to: RECT },
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

test("approveStage('images') approves the title image too", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.stages.images.status = "awaiting_review";
  m.title = title({ path: "title.png", seed: 1, provider: "x", approved: false, needsRegen: true });
  m.segments = [];
  saveManifest(dir, m);
  approveStage(dir, "images");
  const got = loadManifest(dir).title!.image!;
  expect(got.approved).toBe(true);
  expect(got.needsRegen).toBeUndefined();
});

test("editTitle updates text and subtitle before script approval", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.title = title();
  saveManifest(dir, m);
  editTitle(dir, { text: "New Title", subtitle: "New Sub" });
  const t = loadManifest(dir).title!;
  expect(t.text).toBe("New Title");
  expect(t.subtitle).toBe("New Sub");
});

test("editTitle clears subtitle when given an empty string", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.title = title();
  saveManifest(dir, m);
  editTitle(dir, { subtitle: "" });
  expect(loadManifest(dir).title!.subtitle).toBeUndefined();
});

test("editTitle throws once the script stage is approved", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.title = title();
  m.stages.script.status = "approved";
  saveManifest(dir, m);
  expect(() => editTitle(dir, { text: "x" })).toThrow(/approved/);
});

test("rejectTitleImage flips approved to false, sets needsRegen, bumps seed", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.title = title({ path: "title.png", seed: 5, provider: "x", approved: true });
  saveManifest(dir, m);
  rejectTitleImage(dir);
  const got = loadManifest(dir).title!.image!;
  expect(got.approved).toBe(false);
  expect(got.needsRegen).toBe(true);
  expect(got.seed).toBe(6);
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

test("setMusicTrack copies the chosen track into the project and records it", () => {
  const dir = proj();
  setMusicTrack(dir, "schellekens-medieval");
  const m = loadManifest(dir);
  expect(m.music?.trackId).toBe("schellekens-medieval");
  expect(m.music?.path).toBe("assets/music/schellekens-medieval.mp3");
  expect(m.music?.volume).toBe(0.1);
  expect(existsSync(join(dir, "assets/music/schellekens-medieval.mp3"))).toBe(true);
});

test("setMusicTrack preserves an existing volume", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.music = { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.3 };
  saveManifest(dir, m);
  setMusicTrack(dir, "schellekens-medieval");
  expect(loadManifest(dir).music?.volume).toBe(0.3);
});

test("setMusicTrack throws on an unknown track id", () => {
  const dir = proj();
  expect(() => setMusicTrack(dir, "nope")).toThrow(/unknown/i);
});

test("setMusicEnabled toggles the soundtrack while preserving the track", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.music = { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.2, enabled: false };
  saveManifest(dir, m);

  setMusicEnabled(dir, true);
  m = loadManifest(dir);
  expect(m.music?.enabled).toBe(true);
  expect(m.music?.trackId).toBe("mamoun-statement-1"); // track + volume remembered
  expect(m.music?.volume).toBe(0.2);

  setMusicEnabled(dir, false);
  expect(loadManifest(dir).music?.enabled).toBe(false);
  expect(loadManifest(dir).music?.trackId).toBe("mamoun-statement-1");
});

test("setMusicEnabled is a no-op when no track is staged", () => {
  const dir = proj();
  setMusicEnabled(dir, true);
  expect(loadManifest(dir).music).toBeUndefined();
});

test("uploadStillImage writes the file, removes the old one, records an upload image", () => {
  const dir = proj();
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "n",
    stills: [still("p0", { path: "assets/images/seg-001-0.png", seed: 5, provider: "replicate:x", approved: true })] }];
  saveManifest(dir, m);
  mkdirSync(join(dir, "assets/images"), { recursive: true });
  writeFileSync(join(dir, "assets/images/seg-001-0.png"), Buffer.from([0])); // the old generated file

  uploadStillImage(dir, "seg-001", 0, { bytes: Buffer.from([1, 2, 3]), ext: "jpg" });

  const got = loadManifest(dir).segments[0].stills![0].image!;
  expect(got.path).toBe("assets/images/seg-001-0.jpg");
  expect(got.provider).toBe("upload");
  expect(got.approved).toBe(false);
  expect(got.needsRegen).toBeUndefined();
  expect(existsSync(join(dir, "assets/images/seg-001-0.jpg"))).toBe(true);
  expect(existsSync(join(dir, "assets/images/seg-001-0.png"))).toBe(false); // old removed
});

test("setPronunciations saves entries, drops blanks, is allowed after approval, leaves audio", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.stages.voiceover.status = "approved";
  m.segments = [{ id: "seg-001", order: 0, narration: "arsenic", audio: { path: "a", durationSec: 1, words: [] } }];
  saveManifest(dir, m);
  setPronunciations(dir, [{ term: "arsenic", respelling: "AR-suh-nik" }, { term: "", respelling: "x" }]);
  m = loadManifest(dir);
  expect(m.pronunciations).toEqual([{ term: "arsenic", respelling: "AR-suh-nik" }]); // blank dropped
  expect(m.segments[0].audio).toBeDefined();                                          // non-destructive
});

test("prepareReRecord clears audio for term-containing segments only and resets assemble", () => {
  const dir = proj();
  let m = loadManifest(dir);
  m.stages.assemble.status = "approved";
  m.pronunciations = [{ term: "arsenic", respelling: "AR-suh-nik" }];
  m.segments = [
    { id: "seg-001", order: 0, narration: "about arsenic", audio: { path: "a", durationSec: 1, words: [] } },
    { id: "seg-002", order: 1, narration: "no match here", audio: { path: "b", durationSec: 1, words: [] } },
  ];
  saveManifest(dir, m);
  const affected = prepareReRecord(dir);
  m = loadManifest(dir);
  expect(affected).toEqual(["seg-001"]);
  expect(m.segments[0].audio).toBeUndefined();
  expect(m.segments[1].audio).toBeDefined();
  expect(m.stages.assemble.status).toBe("pending");
});
