import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest, type Still } from "../manifest.js";
import { runAssemble, buildInputProps } from "./assemble.js";
import { CATALOG } from "../music/catalog.js";

const dirs: string[] = [];
const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } };

function still(i: number, weight: number): Still {
  return {
    imagePrompt: "p", kenBurns: kb, weight,
    image: { path: `assets/images/seg-${i}.png`, seed: i, provider: "x", approved: true },
  };
}

// Build a ready-to-assemble project from a list of [durationSec, weights[]] specs.
function projectWith(specs: Array<{ durationSec: number; weights: number[] }>) {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  m.segments = specs.map((spec, idx) => ({
    id: `seg-00${idx + 1}`, order: idx, narration: "n",
    stills: spec.weights.map((w, j) => still(idx * 10 + j, w)),
    audio: { path: `assets/audio/seg-00${idx + 1}.wav`, durationSec: spec.durationSec, words: [] },
  }));
  saveManifest(dir, m);
  return dir;
}

afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("computes total duration from audio", async () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }, { durationSec: 3, weights: [1] }]);
  await runAssemble(dir);
  const m = loadManifest(dir);
  expect(m.timeline?.totalDurationSec).toBe(5);
  expect(m.timeline?.fps).toBe(30);
  expect(m.stages.assemble.status).toBe("awaiting_review");
});

test("a single-still segment keeps the whole duration on its one still", () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }, { durationSec: 3, weights: [1] }]);
  const props = buildInputProps(loadManifest(dir));
  expect(props.aspectRatio).toBe("16:9");
  expect(props.segments[0].durationInFrames).toBe(60); // 2s * 30
  expect(props.segments[0].stills).toHaveLength(1);
  expect(props.segments[0].stills[0].durationInFrames).toBe(60);
  expect(props.segments[1].durationInFrames).toBe(90); // 3s * 30
  expect(props.segments[1].stills[0].durationInFrames).toBe(90);
});

test("splits a segment's frames across stills by weight", () => {
  const dir = projectWith([{ durationSec: 3, weights: [2, 1] }]); // D = 90
  const props = buildInputProps(loadManifest(dir));
  const seg = props.segments[0];
  expect(seg.durationInFrames).toBe(90);
  expect(seg.stills.map((s) => s.durationInFrames)).toEqual([60, 30]);
});

test("the last still absorbs the rounding remainder so frames sum exactly", () => {
  const dir = projectWith([{ durationSec: 10 / 3, weights: [1, 1, 1] }]); // D = 100
  const props = buildInputProps(loadManifest(dir));
  const seg = props.segments[0];
  expect(seg.durationInFrames).toBe(100);
  const frames = seg.stills.map((s) => s.durationInFrames);
  expect(frames).toEqual([33, 33, 34]);
  expect(frames.reduce((a, b) => a + b, 0)).toBe(seg.durationInFrames);
});

test("never emits a zero-frame still even when stills outnumber frames", () => {
  // Degenerate (unreachable with real seconds-long audio, but a 0-frame window
  // would crash the render's interpolate). Every still must keep >= 1 frame.
  const dir = projectWith([{ durationSec: 2 / 30, weights: [1, 1, 1] }]); // D = 2
  const props = buildInputProps(loadManifest(dir));
  const frames = props.segments[0].stills.map((s) => s.durationInFrames);
  expect(Math.min(...frames)).toBeGreaterThanOrEqual(1);
});

test("emits an intro from the title card when it has an image", () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  const m = loadManifest(dir);
  m.title = {
    text: "The Discovery", subtitle: "A tagline",
    imagePrompt: "p", durationSec: 4,
    kenBurns: { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } },
    image: { path: "assets/images/title.png", seed: 1, provider: "x", approved: true },
  };
  saveManifest(dir, m);

  const props = buildInputProps(loadManifest(dir));
  expect(props.intro?.text).toBe("The Discovery");
  expect(props.intro?.subtitle).toBe("A tagline");
  expect(props.intro?.imagePath).toBe("assets/images/title.png");
  expect(props.intro?.durationInFrames).toBe(120); // 4s * 30
  expect(props.intro?.kenBurns.to.w).toBe(0.9);
});

test("omits the intro when there is no title or the title has no image", () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  expect(buildInputProps(loadManifest(dir)).intro).toBeUndefined();
});

test("each still carries its own image path and ken burns", () => {
  const dir = projectWith([{ durationSec: 2, weights: [1, 1] }]);
  const props = buildInputProps(loadManifest(dir));
  const seg = props.segments[0];
  expect(seg.stills[0].imagePath).toBe("assets/images/seg-0.png");
  expect(seg.stills[1].imagePath).toBe("assets/images/seg-1.png");
  expect(seg.stills[0].kenBurns.to.w).toBe(0.8);
});

test("runAssemble auto-picks a soundtrack and copies it into the project", async () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  // brief.tone defaults to "w" in projectWith — set a real tone for a deterministic pick
  const pre = loadManifest(dir); pre.brief.tone = "tense, urgent"; saveManifest(dir, pre);

  await runAssemble(dir);

  const m = loadManifest(dir);
  expect(m.music?.trackId).toBe("schellekens-medieval");
  expect(m.music?.path).toBe("assets/music/schellekens-medieval.mp3");
  expect(m.music?.volume).toBe(0.15);
  expect(existsSync(join(dir, "assets/music/schellekens-medieval.mp3"))).toBe(true);
});

test("runAssemble respects an already-chosen track", async () => {
  const dir = projectWith([{ durationSec: 2, weights: [1] }]);
  const pre = loadManifest(dir);
  pre.music = { trackId: "mamoun-statement-1", path: "assets/music/mamoun-statement-1.mp3", volume: 0.2 };
  saveManifest(dir, pre);

  await runAssemble(dir);

  expect(loadManifest(dir).music?.trackId).toBe("mamoun-statement-1");
  expect(loadManifest(dir).music?.volume).toBe(0.2);
});
