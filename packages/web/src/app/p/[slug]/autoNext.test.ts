import { expect, test } from "vitest";
import { ManifestSchema, STAGE_NAMES, type Manifest, type StageName } from "@doc/core";
import { nextAutoStep } from "./autoNext.js";

function manifest(statuses: Partial<Record<StageName, Manifest["stages"][StageName]["status"]>> = {}): Manifest {
  return ManifestSchema.parse({
    version: 1,
    slug: "auto-doc",
    createdAt: "2026-07-16T00:00:00.000Z",
    brief: {
      topic: "Auto documentary",
      targetMinutes: 6,
      tone: "wistful, archival",
      aspectRatio: "16:9",
      imageStyle: "1970s 35mm film, muted",
      autoMode: true,
    },
    stages: Object.fromEntries(STAGE_NAMES.map((stage) => [stage, { status: statuses[stage] ?? "approved" }])),
    segments: [],
  });
}

test("runs the first pending stage", () => {
  expect(nextAutoStep(manifest({ script: "pending", shotlist: "pending" }), false))
    .toEqual({ kind: "run", stage: "script" });
});

test("approves the first stage awaiting review", () => {
  expect(nextAutoStep(manifest({ shotlist: "awaiting_review", images: "pending" }), false))
    .toEqual({ kind: "approve", stage: "shotlist" });
});

test("waits when any stage has errored", () => {
  expect(nextAutoStep(manifest({ script: "pending", images: "error" }), false)).toEqual({ kind: "wait" });
});

test("waits while the active stage is running", () => {
  expect(nextAutoStep(manifest({ voiceover: "running", assemble: "pending" }), false))
    .toEqual({ kind: "wait", stage: "voiceover" });
});

test("renders after every stage is approved and no video exists", () => {
  expect(nextAutoStep(manifest(), false)).toEqual({ kind: "render" });
});

test("waits after every stage is approved when the video exists", () => {
  expect(nextAutoStep(manifest(), true)).toEqual({ kind: "wait" });
});
