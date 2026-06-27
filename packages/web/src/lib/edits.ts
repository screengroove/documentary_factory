import { loadManifest, saveManifest, type StageName } from "@doc/core";

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
    for (const s of m.segments) if (s.image) { s.image.approved = true; delete s.image.needsRegen; }
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

export function editPrompt(dir: string, id: string, prompt: string): void {
  const { m, s } = seg(dir, id);
  if (m.stages.shotlist.status === "approved") throw new Error("Shotlist already approved");
  if (!s.shot) throw new Error(`Segment ${id} has no shot`);
  s.shot.imagePrompt = prompt;
  saveManifest(dir, m);
}

export function rejectImage(dir: string, id: string, opts: { seed?: number; prompt?: string } = {}): void {
  const { m, s } = seg(dir, id);
  if (!s.image) throw new Error(`Segment ${id} has no image`);
  s.image.needsRegen = true;
  s.image.approved = false;
  // Bump the seed so the regen produces a DIFFERENT image (deterministicSeed
  // would otherwise reproduce the same one); caller may override.
  s.image.seed = opts.seed ?? s.image.seed + 1;
  if (opts.prompt !== undefined && s.shot) s.shot.imagePrompt = opts.prompt;
  saveManifest(dir, m);
}

export function rejectAudio(dir: string, id: string): void {
  const { m, s } = seg(dir, id);
  delete s.audio;
  saveManifest(dir, m);
}
