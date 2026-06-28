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

// A generated image asset, shared by stills and the title card. `needsRegen` is
// set by a reject action and triggers a single regeneration of just this image.
const ImageSchema = z.object({
  path: z.string(),
  seed: z.number().int(),
  provider: z.string(),
  approved: z.boolean(),
  needsRegen: z.boolean().optional(),
});

// One still in a segment's visual sequence: its prompt, motion, relative duration
// weight, and (once generated) its image. A segment with a single still behaves
// exactly like the old one-image-per-segment model.
const StillSchema = z.object({
  imagePrompt: z.string(),
  kenBurns: z.object({ from: RectSchema, to: RectSchema }),
  weight: z.number().positive(), // relative share of the segment's duration
  image: ImageSchema.optional(),
});
export type Still = z.infer<typeof StillSchema>;

// The auto-generated opening title card: a text-free background image (its own
// prompt + Ken Burns) over which the render draws the title/subtitle as crisp
// typography. Plays for `durationSec` before the first segment.
const TitleSchema = z.object({
  text: z.string(),
  subtitle: z.string().optional(),
  imagePrompt: z.string(),
  durationSec: z.number().positive(),
  kenBurns: z.object({ from: RectSchema, to: RectSchema }),
  image: ImageSchema.optional(),
});
export type Title = z.infer<typeof TitleSchema>;

// The background-music selection: which catalog track, where its file was copied
// into the project, its mix volume (0..1), and whether it's applied (the "Add
// Music Track" toggle — a track stays remembered while disabled). Optional +
// defaulting omitted/undefined to disabled keeps soundtrack opt-in.
const MusicSchema = z.object({
  trackId: z.string(),
  path: z.string(),
  volume: z.number(),
  enabled: z.boolean().optional(),
});
export type Music = z.infer<typeof MusicSchema>;

const PronunciationEntrySchema = z.object({
  term: z.string(),       // word/phrase as it appears in narration
  respelling: z.string(), // plain-English phonetic respelling for TTS
});
export type PronunciationEntry = z.infer<typeof PronunciationEntrySchema>;

const SegmentSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  narration: z.string(),
  stills: z.array(StillSchema).optional(),
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
  title: TitleSchema.optional(),
  music: MusicSchema.optional(),
  pronunciations: z.array(PronunciationEntrySchema).optional(),
  segments: z.array(SegmentSchema),
  timeline: z.object({
    fps: z.number(),
    totalDurationSec: z.number(),
  }).optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// Pre multi-still manifests carried a single `shot` + `image` per segment. Fold
// each into a one-element `stills` array so legacy projects load unchanged. Pure
// and shape-based (not version-gated); a no-op once segments already use stills.
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const m = raw as { segments?: unknown };
  if (!Array.isArray(m.segments)) return raw;
  for (const seg of m.segments as Array<Record<string, unknown>>) {
    if (seg.stills !== undefined || seg.shot === undefined) continue;
    const shot = seg.shot as { imagePrompt: unknown; kenBurns: unknown };
    seg.stills = [{ imagePrompt: shot.imagePrompt, kenBurns: shot.kenBurns, weight: 1, image: seg.image }];
    delete seg.shot;
    delete seg.image;
  }
  return raw;
}

export function loadManifest(projectDir: string): Manifest {
  const raw = readFileSync(join(projectDir, "manifest.json"), "utf8");
  return ManifestSchema.parse(migrate(JSON.parse(raw)));
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
