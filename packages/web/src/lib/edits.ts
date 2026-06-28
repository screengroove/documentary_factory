import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, saveManifest, type StageName, type Still, type PronunciationEntry, applyPronunciations, CATALOG, trackSourcePath, DEFAULT_MUSIC_VOLUME } from "@doc/core";

export function approveStage(dir: string, stage: StageName): void {
  const m = loadManifest(dir);
  // A stage only reaches "awaiting_review" after its Run completed for every
  // segment. Refusing any other status stops a reviewer from approving past an
  // error/incomplete run, which previously left projects unrenderable.
  if (m.stages[stage].status !== "awaiting_review")
    throw new Error(
      `Cannot approve ${stage}: status is "${m.stages[stage].status}", expected "awaiting_review". Run the stage first.`,
    );
  if (stage === "images") {
    for (const s of m.segments) for (const still of s.stills ?? [])
      if (still.image) { still.image.approved = true; delete still.image.needsRegen; }
    if (m.title?.image) { m.title.image.approved = true; delete m.title.image.needsRegen; }
  }
  m.stages[stage].status = "approved";
  m.stages[stage].completedAt = new Date().toISOString();
  saveManifest(dir, m);
}

function seg(dir: string, id: string) {
  const m = loadManifest(dir);
  const s = m.segments.find((x) => x.id === id);
  if (!s) throw new Error(`No segment ${id}`);
  return { m, s };
}

export function editNarration(dir: string, id: string, text: string): void {
  const { m, s } = seg(dir, id);
  if (m.stages.script.status === "approved") throw new Error("Script already approved");
  s.narration = text;
  saveManifest(dir, m);
}

// Resolve the still at `stillIndex`, throwing a clear error if the segment has
// no stills or the index is out of range.
function still(s: { id: string; stills?: Still[] }, stillIndex: number): Still {
  if (!s.stills || s.stills.length === 0) throw new Error(`Segment ${s.id} has no stills`);
  const st = s.stills[stillIndex];
  if (!st) throw new Error(`Segment ${s.id} has no still at index ${stillIndex}`);
  return st;
}

export function editPrompt(dir: string, id: string, stillIndex: number, prompt: string): void {
  const { m, s } = seg(dir, id);
  if (m.stages.shotlist.status === "approved") throw new Error("Shotlist already approved");
  still(s, stillIndex).imagePrompt = prompt;
  saveManifest(dir, m);
}

export function rejectImage(dir: string, id: string, stillIndex: number, opts: { seed?: number; prompt?: string } = {}): void {
  const { m, s } = seg(dir, id);
  const st = still(s, stillIndex);
  if (!st.image) throw new Error(`Segment ${id} still ${stillIndex} has no image`);
  st.image.needsRegen = true;
  st.image.approved = false;
  // Bump the seed so the regen produces a DIFFERENT image (deterministicSeed
  // would otherwise reproduce the same one); caller may override.
  st.image.seed = opts.seed ?? st.image.seed + 1;
  if (opts.prompt !== undefined) st.imagePrompt = opts.prompt;
  saveManifest(dir, m);
}

// Replace a still's image with a user-uploaded file. Writes into the same
// assets/images slot generated images use (preserving the upload's extension),
// removes the previous file, and records the image with provider "upload" and
// no needsRegen — so runImages skips it and the existing review/render path
// treats it like any other image. Only meaningful at the active images gate.
export function uploadStillImage(dir: string, id: string, stillIndex: number, file: { bytes: Buffer; ext: string }): void {
  const { m, s } = seg(dir, id);
  const st = still(s, stillIndex);
  if (st.image) { try { rmSync(join(dir, st.image.path)); } catch { /* old file may be absent */ } }
  const rel = `assets/images/${id}-${stillIndex}.${file.ext}`;
  mkdirSync(join(dir, "assets/images"), { recursive: true });
  writeFileSync(join(dir, rel), file.bytes);
  st.image = { path: rel, seed: st.image?.seed ?? 0, provider: "upload", approved: false };
  saveManifest(dir, m);
}

export function editTitle(dir: string, fields: { text?: string; subtitle?: string }): void {
  const m = loadManifest(dir);
  if (!m.title) throw new Error("No title card");
  if (m.stages.script.status === "approved") throw new Error("Script already approved");
  if (fields.text !== undefined) m.title.text = fields.text;
  if (fields.subtitle !== undefined) m.title.subtitle = fields.subtitle || undefined;
  saveManifest(dir, m);
}

export function rejectTitleImage(dir: string, opts: { seed?: number; prompt?: string } = {}): void {
  const m = loadManifest(dir);
  if (!m.title?.image) throw new Error("No title image");
  m.title.image.needsRegen = true;
  m.title.image.approved = false;
  m.title.image.seed = opts.seed ?? m.title.image.seed + 1;
  if (opts.prompt !== undefined) m.title.imagePrompt = opts.prompt;
  saveManifest(dir, m);
}

export function rejectAudio(dir: string, id: string): void {
  const { m, s } = seg(dir, id);
  delete s.audio;
  saveManifest(dir, m);
}

export function setMusicTrack(dir: string, trackId: string, opts: { musicLibDir?: string } = {}): void {
  const m = loadManifest(dir);
  const track = CATALOG.find((t) => t.id === trackId);
  if (!track) throw new Error(`Unknown music track: ${trackId}`);
  const destDir = join(dir, "assets/music");
  mkdirSync(destDir, { recursive: true }); // older projects may predate the dir
  copyFileSync(trackSourcePath(track, opts.musicLibDir), join(destDir, track.file));
  m.music = {
    trackId: track.id,
    path: `assets/music/${track.file}`,
    volume: m.music?.volume ?? DEFAULT_MUSIC_VOLUME,
    enabled: m.music?.enabled ?? true, // picking a track keeps/turns the soundtrack on
  };
  saveManifest(dir, m);
}

// Flip the "Add Music Track" toggle. The chosen track + volume are preserved
// while disabled, so turning it back on restores the same soundtrack.
export function setMusicEnabled(dir: string, enabled: boolean): void {
  const m = loadManifest(dir);
  if (!m.music) return; // nothing pre-staged yet; assemble auto-stages a track
  m.music = { ...m.music, enabled };
  saveManifest(dir, m);
}

// Save the pronunciation dictionary. Non-destructive (never touches audio) and
// allowed at any gate state — late pronunciation fixes are the point. Blank rows
// are dropped. The audio only changes when the user runs the apply re-record.
export function setPronunciations(dir: string, entries: PronunciationEntry[]): void {
  const m = loadManifest(dir);
  m.pronunciations = entries.filter((e) => e.term.trim() && e.respelling.trim());
  saveManifest(dir, m);
}

// Stage a re-record: clear audio for every segment whose narration contains any
// current dictionary term, reset the (now-stale) assemble render to pending, and
// return the affected segment ids. The apply route then runs voiceover, which
// regenerates exactly the cleared segments with the current dictionary.
export function prepareReRecord(dir: string): string[] {
  const m = loadManifest(dir);
  const entries = m.pronunciations ?? [];
  const affected: string[] = [];
  for (const s of m.segments) {
    if (!s.audio) continue;
    if (applyPronunciations(s.narration, entries).used.length > 0) {
      delete s.audio;
      affected.push(s.id);
    }
  }
  if (affected.length) m.stages.assemble.status = "pending";
  saveManifest(dir, m);
  return affected;
}
