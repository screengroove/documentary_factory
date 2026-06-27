import { z } from "zod";
import { loadManifest, saveManifest, RectSchema } from "../manifest.js";
import type { StageDeps } from "./deps.js";

// A gentle centered zoom-in, used when the model omits the Ken Burns move so a
// single missing field never hard-fails the whole stage mid-batch.
const DEFAULT_KEN_BURNS = {
  from: { x: 0, y: 0, w: 1, h: 1 },
  to: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
};

const ShotOutput = z.object({
  stills: z.array(z.object({
    imagePrompt: z.string(),
    kenBurns: z.object({ from: RectSchema, to: RectSchema }).optional(),
    weight: z.number().positive().optional(),
  })).min(1),
});

export async function runShotlist(projectDir: string, deps: StageDeps): Promise<void> {
  const m = loadManifest(projectDir);
  m.stages.shotlist.status = "running";
  saveManifest(projectDir, m);

  for (const seg of m.segments) {
    if (seg.stills) continue;
    const out = await deps.llm.complete({
      system:
        "You turn a narration beat into a SEQUENCE of 1-4 documentary stills that visually " +
        "progress through the beat. For each still: describe one vivid, concrete image; choose " +
        "a subtle Ken Burns move as two normalized crop rects (x,y,w,h in 0..1) where 'to' is a " +
        "gentle zoom or pan from 'from'; and give a relative duration weight (1-3) for how long " +
        "the still should hold.",
      user: `Narration: ${seg.narration}`,
      schema: ShotOutput,
    });
    seg.stills = out.stills.map((still) => ({
      imagePrompt: `${still.imagePrompt}, ${m.brief.imageStyle}`,
      kenBurns: still.kenBurns ?? DEFAULT_KEN_BURNS,
      weight: still.weight ?? 1,
    }));
    saveManifest(projectDir, m); // persist per-segment
  }

  m.stages.shotlist.status = "awaiting_review";
  saveManifest(projectDir, m);
}
