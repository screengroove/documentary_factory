import {
  canRun, loadManifest, saveManifest, realDeps,
  runScript, runShotlist, runImages, runVoiceover, runAssemble,
  type StageDeps, type StageName,
} from "@doc/core";
import { join } from "node:path";
import { PROJECTS_ROOT } from "./projects.js";

export const STAGE_RUNNERS: Record<StageName, (dir: string, deps: StageDeps) => Promise<void>> = {
  script: runScript,
  shotlist: runShotlist,
  images: (dir, deps) => runImages(dir, deps),
  voiceover: (dir, deps) => runVoiceover(dir, deps),
  assemble: (dir) => runAssemble(dir),
};

export async function runStageWith(dir: string, stage: StageName, deps: StageDeps): Promise<void> {
  const m = loadManifest(dir);
  if (!canRun(m, stage)) throw new Error(`Cannot run ${stage}: earlier gate not approved`);
  try {
    await STAGE_RUNNERS[stage](dir, deps);
  } catch (err) {
    const cur = loadManifest(dir);
    cur.stages[stage].status = "error";
    cur.stages[stage].error = err instanceof Error ? err.message : String(err);
    saveManifest(dir, cur);
    throw err;
  }
}

export async function runStage(slug: string, stage: StageName): Promise<void> {
  await runStageWith(join(PROJECTS_ROOT, slug), stage, realDeps(process.env));
}
