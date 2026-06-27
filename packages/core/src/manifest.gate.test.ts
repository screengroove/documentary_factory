import { expect, test } from "vitest";
import { canRun, type Manifest } from "./manifest.js";

function m(over: Partial<Manifest["stages"]>): Manifest {
  return {
    version: 1, slug: "x", createdAt: "2026-06-26T00:00:00.000Z",
    brief: { topic: "t", targetMinutes: 6, tone: "c", aspectRatio: "16:9", imageStyle: "f" },
    stages: {
      script: { status: "pending" }, shotlist: { status: "pending" },
      images: { status: "pending" }, voiceover: { status: "pending" }, assemble: { status: "pending" },
      ...over,
    },
    segments: [],
  };
}

test("script can always run", () => {
  expect(canRun(m({}), "script")).toBe(true);
});

test("shotlist blocked until script approved", () => {
  expect(canRun(m({}), "shotlist")).toBe(false);
  expect(canRun(m({ script: { status: "approved" } }), "shotlist")).toBe(true);
});

test("images blocked until script AND shotlist approved", () => {
  expect(canRun(m({ script: { status: "approved" } }), "images")).toBe(false);
  expect(
    canRun(m({ script: { status: "approved" }, shotlist: { status: "approved" } }), "images"),
  ).toBe(true);
});
