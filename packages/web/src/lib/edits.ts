import { loadManifest, saveManifest, type StageName, type Still } from "@doc/core";

export function approveStage(dir: string, stage: StageName): void {
  const m = loadManifest(dir);
  // A stage only reaches "awaiting_review" after its Run completed for every
  // segment. Refusing any other status stops a reviewer from approving past an
  // error/incomplete run, which previously left projects unrenderable.
  if (m.stages[stage].status !== "awaiting_review")
    throw new Error(
      `Cannot approve ${stage}: status is "${m.stages[stage].status}", expected "awaiting_review". Run the stage first.`,
    );
  if (stage === "images")
    for (const s of m.segments) for (const still of s.stills ?? [])
      if (still.image) { still.image.approved = true; delete still.image.needsRegen; }
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

export function rejectAudio(dir: string, id: string): void {
  const { m, s } = seg(dir, id);
  delete s.audio;
  saveManifest(dir, m);
}
