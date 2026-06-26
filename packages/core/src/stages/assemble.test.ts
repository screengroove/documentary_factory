import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runAssemble, buildInputProps } from "./assemble.js";

const dirs: string[] = [];
function projectReady() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } };
  m.segments = [
    { id: "seg-001", order: 0, narration: "A", shot: { imagePrompt: "p", kenBurns: kb },
      image: { path: "assets/images/seg-001.png", seed: 1, provider: "x", approved: true },
      audio: { path: "assets/audio/seg-001.wav", durationSec: 2, words: [] } },
    { id: "seg-002", order: 1, narration: "B", shot: { imagePrompt: "p", kenBurns: kb },
      image: { path: "assets/images/seg-002.png", seed: 2, provider: "x", approved: true },
      audio: { path: "assets/audio/seg-002.wav", durationSec: 3, words: [] } },
  ];
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("computes total duration from audio", async () => {
  const dir = projectReady();
  await runAssemble(dir);
  const m = loadManifest(dir);
  expect(m.timeline?.totalDurationSec).toBe(5);
  expect(m.timeline?.fps).toBe(30);
  expect(m.stages.assemble.status).toBe("awaiting_review");
});

test("buildInputProps converts seconds to frames at 30fps", () => {
  const dir = projectReady();
  const props = buildInputProps(loadManifest(dir));
  expect(props.segments[0].durationInFrames).toBe(60); // 2s * 30
  expect(props.segments[1].durationInFrames).toBe(90); // 3s * 30
  expect(props.aspectRatio).toBe("16:9");
});
