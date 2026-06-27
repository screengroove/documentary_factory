import { z } from "zod";
import { loadManifest, saveManifest } from "../manifest.js";
import type { StageDeps } from "./deps.js";

// A gentle centered zoom-in for the title card (mirrors shotlist's default), so
// the opening card always has motion without asking the model for crop rects.
const DEFAULT_KEN_BURNS = {
  from: { x: 0, y: 0, w: 1, h: 1 },
  to: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
};

const ScriptOutput = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  titleImagePrompt: z.string(),
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
      "(2-4 sentences each), suitable for one still image per beat. Also mint an opening " +
      "title card: a short, punchy documentary title; an optional one-line subtitle/tagline; " +
      "and a titleImagePrompt describing a vivid, TEXT-FREE establishing background image for " +
      "the card (no lettering in the image — the title is drawn as real text later).",
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
  // Opening title card; fall back to the brief topic when the model returns an
  // empty title. The image is text-free; render draws the title text on top.
  m.title = {
    text: out.title?.trim() || m.brief.topic,
    subtitle: out.subtitle?.trim() || undefined,
    imagePrompt: `${out.titleImagePrompt}, ${m.brief.imageStyle}`,
    durationSec: 4,
    kenBurns: DEFAULT_KEN_BURNS,
  };
  m.stages.script.status = "awaiting_review";
  // completedAt is set by the web layer (approveStage) with the real timestamp;
  // core avoids wall-clock reads for testability and consistency across stages.
  saveManifest(projectDir, m);
}
