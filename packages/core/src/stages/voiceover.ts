import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Input, ALL_FORMATS, FilePathSource } from "mediabunny";
import { loadManifest, saveManifest } from "../manifest.js";
import { applyPronunciations, remapWords } from "../pronunciation.js";
import { projectPaths } from "../project.js";
import type { StageDeps } from "./deps.js";

// Kokoro voice. bm_george is a deep, measured British male — the closest fit to a
// distinguished nature-documentary narrator. Other British males: bm_lewis,
// bm_daniel, bm_fable. (This is voice character, not an impersonation of any person.)
export const DEFAULT_VOICE_ID = "bm_george";

// Measure the real audio length so the Sequence covers trailing silence, not just
// the last spoken word (remotion-best-practices: get-audio-duration). Injectable for tests.
export async function audioDurationSec(filePath: string): Promise<number> {
  const input = new Input({ formats: ALL_FORMATS, source: new FilePathSource(filePath) });
  return input.computeDuration();
}

export async function runVoiceover(
  projectDir: string,
  deps: StageDeps,
  opts: { voiceId?: string; getDuration?: (filePath: string) => Promise<number> } = {},
): Promise<void> {
  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  const getDuration = opts.getDuration ?? audioDurationSec;
  const m = loadManifest(projectDir);

  m.stages.voiceover.status = "running";
  saveManifest(projectDir, m);

  for (const seg of m.segments) {
    if (seg.audio) continue;
    const { spokenText, used } = applyPronunciations(seg.narration, m.pronunciations ?? []);
    const { audio, words } = await deps.tts.speak({ text: spokenText, voiceId });
    const captionWords = used.length ? remapWords(seg.narration, words, used) : words;
    const filePath = join(projectPaths(projectDir).audio, `${seg.id}.wav`);
    writeFileSync(filePath, audio);
    const durationSec = await getDuration(filePath);
    seg.audio = { path: `assets/audio/${seg.id}.wav`, durationSec, words: captionWords };
    saveManifest(projectDir, m); // persist per-segment
  }

  m.stages.voiceover.status = "awaiting_review";
  saveManifest(projectDir, m);
}
