import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runVoiceover } from "./voiceover.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function projectWithSegments() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  m.segments = [{ id: "seg-001", order: 0, narration: "Hello there." }];
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("writes audio file, duration, and words", async () => {
  const dir = projectWithSegments();
  const deps = makeFakeDeps({
    tts: { speak: async () => ({
      audio: Buffer.from([1, 2, 3]),
      words: [{ word: "Hello", start: 0, end: 0.5 }, { word: "there", start: 0.5, end: 1.0 }],
    }) },
  });

  // Inject a fake duration so the test stays pure (no real audio to parse).
  await runVoiceover(dir, deps, { getDuration: async () => 1.0 });

  const m = loadManifest(dir);
  expect(existsSync(join(dir, "assets/audio/seg-001.wav"))).toBe(true);
  expect(m.segments[0].audio?.durationSec).toBe(1.0);
  expect(m.segments[0].audio?.words.length).toBe(2);
  expect(m.stages.voiceover.status).toBe("awaiting_review");
});

test("applies the pronunciation dictionary and remaps caption words", async () => {
  const dir = projectWithSegments(); // narration: "Hello there."
  let passedText = "";
  const deps = makeFakeDeps({
    tts: { speak: async ({ text }) => { passedText = text; return {
      audio: Buffer.from([1]),
      words: [{ word: "Hello", start: 0, end: 0.5 }, { word: "thair", start: 0.5, end: 1.0 }],
    }; } },
  });
  let m = loadManifest(dir);
  m.pronunciations = [{ term: "there", respelling: "thair" }];
  saveManifest(dir, m);

  await runVoiceover(dir, deps, { getDuration: async () => 1.0 });

  expect(passedText).toBe("Hello thair.");            // respelled text reaches TTS
  m = loadManifest(dir);
  expect(m.segments[0].audio?.words.map((w) => w.word)).toEqual(["Hello", "there"]); // caption restored
});
