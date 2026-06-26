import { z } from "zod";
import { loadManifest, saveManifest, RectSchema } from "../manifest.js";
import type { StageDeps } from "./deps.js";

const ShotOutput = z.object({
  imagePrompt: z.string(),
  kenBurns: z.object({ from: RectSchema, to: RectSchema }),
});

export async function runShotlist(projectDir: string, deps: StageDeps): Promise<void> {
  const m = loadManifest(projectDir);
  m.stages.shotlist.status = "running";
  saveManifest(projectDir, m);

  for (const seg of m.segments) {
    if (seg.shot) continue;
    const out = await deps.llm.complete({
      system:
        "You turn a narration beat into a single documentary still. Describe one vivid, " +
        "concrete image. Also choose a subtle Ken Burns move as two normalized crop rects " +
        "(x,y,w,h in 0..1); 'to' should be a gentle zoom or pan from 'from'.",
      user: `Narration: ${seg.narration}`,
      schema: ShotOutput,
    });
    seg.shot = {
      imagePrompt: `${out.imagePrompt}, ${m.brief.imageStyle}`,
      kenBurns: out.kenBurns,
    };
    saveManifest(projectDir, m); // persist per-segment
  }

  m.stages.shotlist.status = "awaiting_review";
  saveManifest(projectDir, m);
}
