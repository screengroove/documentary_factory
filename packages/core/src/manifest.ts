import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RectSchema = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});
export type Rect = z.infer<typeof RectSchema>;

export const STAGE_NAMES = ["script", "shotlist", "images", "voiceover", "assemble"] as const;
export type StageName = (typeof STAGE_NAMES)[number];

const StageStateSchema = z.object({
  status: z.enum(["pending", "running", "awaiting_review", "approved", "error"]),
  error: z.string().optional(),
  completedAt: z.string().optional(),
});

const WordSchema = z.object({ word: z.string(), start: z.number(), end: z.number() });

const SegmentSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  narration: z.string(),
  shot: z.object({
    imagePrompt: z.string(),
    kenBurns: z.object({ from: RectSchema, to: RectSchema }),
  }).optional(),
  image: z.object({
    path: z.string(),
    seed: z.number().int(),
    provider: z.string(),
    approved: z.boolean(),
    needsRegen: z.boolean().optional(), // set by rejectImage; triggers single-segment regen
  }).optional(),
  audio: z.object({
    path: z.string(),
    durationSec: z.number(),
    words: z.array(WordSchema),
  }).optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  slug: z.string(),
  createdAt: z.string(),
  brief: z.object({
    topic: z.string(),
    targetMinutes: z.number(),
    tone: z.string(),
    audience: z.string().optional(),
    aspectRatio: z.enum(["16:9", "9:16"]),
    imageStyle: z.string(),
  }),
  stages: z.object(
    Object.fromEntries(STAGE_NAMES.map((n) => [n, StageStateSchema])) as Record<
      StageName,
      typeof StageStateSchema
    >,
  ),
  segments: z.array(SegmentSchema),
  timeline: z.object({
    fps: z.number(),
    totalDurationSec: z.number(),
  }).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export function loadManifest(projectDir: string): Manifest {
  const raw = readFileSync(join(projectDir, "manifest.json"), "utf8");
  return ManifestSchema.parse(JSON.parse(raw));
}

export function saveManifest(projectDir: string, m: Manifest): void {
  const valid = ManifestSchema.parse(m);
  writeFileSync(join(projectDir, "manifest.json"), JSON.stringify(valid, null, 2));
}

export function canRun(m: Manifest, stage: StageName): boolean {
  const idx = STAGE_NAMES.indexOf(stage);
  for (let i = 0; i < idx; i++) {
    if (m.stages[STAGE_NAMES[i]].status !== "approved") return false;
  }
  return true;
}
