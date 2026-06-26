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
