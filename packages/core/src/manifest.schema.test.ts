import { expect, test } from "vitest";
import { ManifestSchema } from "./manifest.js";

const minimal = {
  version: 1,
  slug: "test-doc",
  createdAt: "2026-06-26T00:00:00.000Z",
  brief: {
    topic: "The history of lighthouses",
    targetMinutes: 6,
    tone: "wistful, archival",
    aspectRatio: "16:9",
    imageStyle: "1970s 35mm film, muted",
  },
  stages: {
    script: { status: "pending" },
    shotlist: { status: "pending" },
    images: { status: "pending" },
    voiceover: { status: "pending" },
    assemble: { status: "pending" },
  },
  segments: [],
};

test("accepts a minimal valid manifest", () => {
  const parsed = ManifestSchema.parse(minimal);
  expect(parsed.slug).toBe("test-doc");
});

test("rejects an unknown aspectRatio", () => {
  const bad = { ...minimal, brief: { ...minimal.brief, aspectRatio: "4:3" } };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});

test("rejects an unknown stage status", () => {
  const bad = {
    ...minimal,
    stages: { ...minimal.stages, script: { status: "wat" } },
  };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});

test("accepts a fully-populated segment", () => {
  const full = {
    ...minimal,
    segments: [
      {
        id: "seg-001",
        order: 0,
        narration: "Long before satellites...",
        shot: {
          imagePrompt: "a stone lighthouse at dusk, 1970s 35mm film",
          kenBurns: {
            from: { x: 0, y: 0, w: 1, h: 1 },
            to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
          },
        },
        image: {
          path: "assets/images/seg-001.png",
          seed: 42,
          provider: "replicate:flux-1.1-pro",
          approved: true,
        },
        audio: {
          path: "assets/audio/seg-001.wav",
          durationSec: 4.2,
          words: [{ word: "Long", start: 0, end: 0.3 }],
        },
      },
    ],
  };
  expect(ManifestSchema.parse(full).segments[0].image?.seed).toBe(42);
});
