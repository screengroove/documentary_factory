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

test("accepts a fully-populated segment with multiple stills", () => {
  const full = {
    ...minimal,
    segments: [
      {
        id: "seg-001",
        order: 0,
        narration: "Long before satellites...",
        stills: [
          {
            imagePrompt: "a stone lighthouse at dusk, 1970s 35mm film",
            kenBurns: {
              from: { x: 0, y: 0, w: 1, h: 1 },
              to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
            },
            weight: 2,
            image: {
              path: "assets/images/seg-001-0.png",
              seed: 42,
              provider: "replicate:flux-1.1-pro",
              approved: true,
            },
          },
          {
            imagePrompt: "the beam sweeping across black water, 1970s 35mm film",
            kenBurns: {
              from: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
              to: { x: 0, y: 0, w: 1, h: 1 },
            },
            weight: 1,
          },
        ],
        audio: {
          path: "assets/audio/seg-001.wav",
          durationSec: 4.2,
          words: [{ word: "Long", start: 0, end: 0.3 }],
        },
      },
    ],
  };
  const parsed = ManifestSchema.parse(full);
  expect(parsed.segments[0].stills?.[0].image?.seed).toBe(42);
  expect(parsed.segments[0].stills?.[0].weight).toBe(2);
  expect(parsed.segments[0].stills?.[1].image).toBeUndefined();
});

test("accepts a manifest with an auto-generated title card", () => {
  const withTitle = {
    ...minimal,
    title: {
      text: "The Discovery of Rapamycin",
      subtitle: "A story from Easter Island",
      imagePrompt: "a windswept Easter Island coastline at dawn, 1970s 35mm film",
      durationSec: 4,
      kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } },
      image: { path: "assets/images/title.png", seed: 7, provider: "x", approved: true },
    },
  };
  const parsed = ManifestSchema.parse(withTitle);
  expect(parsed.title?.text).toBe("The Discovery of Rapamycin");
  expect(parsed.title?.image?.seed).toBe(7);
});

test("accepts a title with no subtitle and no image yet", () => {
  const withTitle = {
    ...minimal,
    title: {
      text: "Untitled",
      imagePrompt: "x",
      durationSec: 4,
      kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } },
    },
  };
  const parsed = ManifestSchema.parse(withTitle);
  expect(parsed.title?.subtitle).toBeUndefined();
  expect(parsed.title?.image).toBeUndefined();
});

test("accepts a manifest with a music block", () => {
  const withMusic = {
    ...minimal,
    music: { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.15 },
  };
  const parsed = ManifestSchema.parse(withMusic);
  expect(parsed.music?.trackId).toBe("mamoun-statement-1");
  expect(parsed.music?.volume).toBe(0.15);
});

test("rejects a music block missing its path", () => {
  const bad = { ...minimal, music: { trackId: "x", volume: 0.15 } };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});

test("rejects a non-positive still weight", () => {
  const bad = {
    ...minimal,
    segments: [
      {
        id: "seg-001",
        order: 0,
        narration: "n",
        stills: [
          {
            imagePrompt: "x",
            kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } },
            weight: 0,
          },
        ],
      },
    ],
  };
  expect(() => ManifestSchema.parse(bad)).toThrow();
});
