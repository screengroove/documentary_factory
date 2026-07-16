import type { Manifest, StageName } from "@doc/core";

// Local copy of STAGE_NAMES: a value import from @doc/core would pull the whole
// barrel (node:fs, provider SDKs) into the client bundle and break the build.
export const ORDER: StageName[] = ["script", "shotlist", "images", "voiceover", "assemble"];

export type AutoStep = { kind: "run" | "approve" | "render" | "wait"; stage?: StageName };

export function nextAutoStep(m: Manifest, videoReady: boolean): AutoStep {
  if (ORDER.some((stage) => m.stages[stage].status === "error")) return { kind: "wait" };

  for (const stage of ORDER) {
    const status = m.stages[stage].status;
    if (status === "approved") continue;
    if (status === "pending") return { kind: "run", stage };
    if (status === "awaiting_review") return { kind: "approve", stage };
    return { kind: "wait", stage };
  }

  return videoReady ? { kind: "wait" } : { kind: "render" };
}
