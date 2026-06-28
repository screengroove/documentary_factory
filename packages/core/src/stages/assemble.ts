import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, saveManifest, type Manifest, type Rect } from "../manifest.js";
import type { Word } from "../providers/types.js";
import { projectPaths } from "../project.js";
import { CATALOG, pickTrack, trackSourcePath } from "../music/catalog.js";

const FPS = 30;
export const DEFAULT_MUSIC_VOLUME = 0.1;

export type DocumentaryProps = {
  fps: number;
  aspectRatio: "16:9" | "9:16";
  intro?: {
    imagePath: string;
    durationInFrames: number;
    kenBurns: { from: Rect; to: Rect };
    text: string;
    subtitle?: string;
  };
  music?: { path: string; volume: number };
  segments: Array<{
    id: string;
    durationInFrames: number; // segment total = sum of its stills
    words: Word[];
    stills: Array<{
      imagePath: string;
      durationInFrames: number;
      kenBurns: { from: Rect; to: Rect };
    }>;
  }>;
};

// Distribute a segment's total frame budget across its stills proportional to
// weight. The last still absorbs the rounding remainder so the per-still frames
// sum to exactly `total` and the visual track never drifts off the audio.
function distributeFrames(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w, i) => {
    // The last still absorbs the remainder for an exact sum; clamp to >= 1 so a
    // pathological still-heavy segment never yields a zero-length render window.
    if (i === weights.length - 1) return Math.max(1, total - acc);
    const f = Math.max(1, Math.round((total * w) / sum));
    acc += f;
    return f;
  });
}

export function buildInputProps(m: Manifest): DocumentaryProps {
  const t = m.title;
  // The intro plays only once its background image exists; the title text is
  // drawn by the render, so a title without an image yields no intro.
  const intro = t?.image
    ? {
        imagePath: t.image.path,
        durationInFrames: Math.max(1, Math.round(t.durationSec * FPS)),
        kenBurns: t.kenBurns,
        text: t.text,
        ...(t.subtitle ? { subtitle: t.subtitle } : {}),
      }
    : undefined;
  // Only emit (and therefore render) music when the toggle is enabled.
  const music = m.music?.enabled ? { path: m.music.path, volume: m.music.volume } : undefined;
  return {
    fps: FPS,
    aspectRatio: m.brief.aspectRatio,
    ...(intro ? { intro } : {}),
    ...(music ? { music } : {}),
    segments: m.segments.map((s) => {
      if (!s.stills?.length || !s.audio)
        throw new Error(`Segment ${s.id} not ready for assembly`);
      const total = Math.max(1, Math.round(s.audio.durationSec * FPS));
      const frames = distributeFrames(s.stills.map((st) => st.weight), total);
      return {
        id: s.id,
        durationInFrames: total,
        words: s.audio.words,
        stills: s.stills.map((st, i) => {
          if (!st.image) throw new Error(`Segment ${s.id} still ${i} has no image`);
          return { imagePath: st.image.path, durationInFrames: frames[i], kenBurns: st.kenBurns };
        }),
      };
    }),
  };
}

export async function runAssemble(
  projectDir: string,
  opts: { musicLibDir?: string } = {},
): Promise<void> {
  const m = loadManifest(projectDir);
  for (const s of m.segments) {
    if (!s.audio) throw new Error(`Segment ${s.id} has no audio; run voiceover first`);
  }

  // Pre-stage a tone-matched soundtrack on first assemble, but leave it disabled:
  // music is opt-in via the assemble gate's "Add Music Track" toggle. Respect an
  // existing/overridden choice.
  if (!m.music && CATALOG.length > 0) {
    const track = pickTrack(m.brief.tone);
    mkdirSync(projectPaths(projectDir).music, { recursive: true }); // older projects may predate the dir
    copyFileSync(trackSourcePath(track, opts.musicLibDir), join(projectPaths(projectDir).music, track.file));
    m.music = { trackId: track.id, path: `assets/music/${track.file}`, volume: DEFAULT_MUSIC_VOLUME, enabled: false };
  }

  const totalDurationSec = m.segments.reduce((sum, s) => sum + (s.audio?.durationSec ?? 0), 0);
  m.timeline = { fps: FPS, totalDurationSec };
  m.stages.assemble.status = "awaiting_review";
  saveManifest(projectDir, m);
}
