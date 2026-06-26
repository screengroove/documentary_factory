import { z } from "zod";
import { loadManifest, saveManifest } from "../manifest.js";
import type { StageDeps } from "./deps.js";

const ScriptOutput = z.object({
  segments: z.array(z.object({ narration: z.string() })).min(1),
});

export async function runScript(projectDir: string, deps: StageDeps): Promise<void> {
  const m = loadManifest(projectDir);
  if (m.segments.length > 0 && m.stages.script.status === "approved") return;

  m.stages.script.status = "running";
  saveManifest(projectDir, m);

  const targetWords = Math.round(m.brief.targetMinutes * 150);
  const out = await deps.llm.complete({
    system:
      "You are a documentary scriptwriter. Write narration as a sequence of short beats " +
      "(2-4 sentences each), suitable for one still image per beat.",
    user:
      `Topic: ${m.brief.topic}\nTone: ${m.brief.tone}\nAudience: ${m.brief.audience ?? "general"}\n` +
      `Aim for roughly ${targetWords} total words across the beats.`,
    schema: ScriptOutput,
  });

  m.segments = out.segments.map((s, i) => ({
    id: `seg-${String(i + 1).padStart(3, "0")}`,
    order: i,
    narration: s.narration,
  }));
  m.stages.script.status = "awaiting_review";
  // completedAt is set by the web layer (approveStage) with the real timestamp;
  // core avoids wall-clock reads for testability and consistency across stages.
  saveManifest(projectDir, m);
}
