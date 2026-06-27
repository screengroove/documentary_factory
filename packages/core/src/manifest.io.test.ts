import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadManifest, saveManifest, type Manifest } from "./manifest.js";

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "doc-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const sample: Manifest = {
  version: 1, slug: "x", createdAt: "2026-06-26T00:00:00.000Z",
  brief: { topic: "t", targetMinutes: 6, tone: "calm", aspectRatio: "16:9", imageStyle: "film" },
  stages: {
    script: { status: "pending" }, shotlist: { status: "pending" },
    images: { status: "pending" }, voiceover: { status: "pending" }, assemble: { status: "pending" },
  },
  segments: [],
};

test("save then load round-trips", () => {
  const d = tmp();
  saveManifest(d, sample);
  expect(loadManifest(d)).toEqual(sample);
});

test("load throws on malformed manifest", () => {
  const d = tmp();
  writeFileSync(join(d, "manifest.json"), JSON.stringify({ version: 1 }));
  expect(() => loadManifest(d)).toThrow();
});

// Legacy manifests (pre multi-still) carried a single shot + image per segment.
// loadManifest must transparently fold them into a one-element stills array.
const legacyBase = {
  version: 1, slug: "x", createdAt: "2026-06-26T00:00:00.000Z",
  brief: { topic: "t", targetMinutes: 6, tone: "calm", aspectRatio: "16:9", imageStyle: "film" },
  stages: {
    script: { status: "approved" }, shotlist: { status: "approved" },
    images: { status: "approved" }, voiceover: { status: "pending" }, assemble: { status: "pending" },
  },
};

test("migrates a legacy shot+image segment to a one-element stills array", () => {
  const d = tmp();
  const legacy = {
    ...legacyBase,
    segments: [{
      id: "seg-001", order: 0, narration: "n",
      shot: { imagePrompt: "a tower", kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } } },
      image: { path: "assets/images/seg-001.png", seed: 7, provider: "x", approved: true },
    }],
  };
  writeFileSync(join(d, "manifest.json"), JSON.stringify(legacy));

  const m = loadManifest(d);
  const seg = m.segments[0];
  expect(seg.stills).toHaveLength(1);
  expect(seg.stills?.[0].imagePrompt).toBe("a tower");
  expect(seg.stills?.[0].weight).toBe(1);
  expect(seg.stills?.[0].kenBurns.to.w).toBe(0.8);
  expect(seg.stills?.[0].image?.seed).toBe(7);
  // Old top-level fields are gone after migration.
  expect((seg as Record<string, unknown>).shot).toBeUndefined();
  expect((seg as Record<string, unknown>).image).toBeUndefined();
});

test("migrates a legacy segment that has a shot but no image yet", () => {
  const d = tmp();
  const legacy = {
    ...legacyBase,
    segments: [{
      id: "seg-001", order: 0, narration: "n",
      shot: { imagePrompt: "a tower", kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } } },
    }],
  };
  writeFileSync(join(d, "manifest.json"), JSON.stringify(legacy));

  const seg = loadManifest(d).segments[0];
  expect(seg.stills).toHaveLength(1);
  expect(seg.stills?.[0].image).toBeUndefined();
});

test("leaves a segment with no shot or stills untouched (script-only)", () => {
  const d = tmp();
  const legacy = { ...legacyBase, segments: [{ id: "seg-001", order: 0, narration: "n" }] };
  writeFileSync(join(d, "manifest.json"), JSON.stringify(legacy));

  const seg = loadManifest(d).segments[0];
  expect(seg.stills).toBeUndefined();
});
