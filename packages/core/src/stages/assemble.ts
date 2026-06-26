import { loadManifest, saveManifest, type Manifest, type Rect } from "../manifest.js";
import type { Word } from "../providers/types.js";

const FPS = 30;

export type DocumentaryProps = {
  fps: number;
  aspectRatio: "16:9" | "9:16";
  segments: Array<{
    id: string;
    imagePath: string;
    durationInFrames: number;
    kenBurns: { from: Rect; to: Rect };
    words: Word[];
  }>;
};

export function buildInputProps(m: Manifest): DocumentaryProps {
  return {
    fps: FPS,
    aspectRatio: m.brief.aspectRatio,
    segments: m.segments.map((s) => {
      if (!s.image || !s.audio || !s.shot)
        throw new Error(`Segment ${s.id} not ready for assembly`);
      return {
        id: s.id,
        imagePath: s.image.path,
        durationInFrames: Math.max(1, Math.round(s.audio.durationSec * FPS)),
        kenBurns: s.shot.kenBurns,
        words: s.audio.words,
      };
    }),
  };
}

export async function runAssemble(projectDir: string, _deps?: unknown): Promise<void> {
  const m = loadManifest(projectDir);
  for (const s of m.segments) {
    if (!s.audio) throw new Error(`Segment ${s.id} has no audio; run voiceover first`);
  }
  const totalDurationSec = m.segments.reduce((sum, s) => sum + (s.audio?.durationSec ?? 0), 0);
  m.timeline = { fps: FPS, totalDurationSec };
  m.stages.assemble.status = "awaiting_review";
  saveManifest(projectDir, m);
}
