import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadManifest, STAGE_NAMES, type StageName } from "@doc/core";

export const PROJECTS_ROOT = join(process.cwd(), "..", "..", "projects");

export function slugify(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function listProjects(): Array<{ slug: string; status: Record<StageName, string> }> {
  if (!existsSync(PROJECTS_ROOT)) return [];
  return readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    // A project dir always has a manifest.json. Skip non-project dirs such as
    // the volume's lost+found (ext4) or any stray directory.
    .filter((d) => existsSync(join(PROJECTS_ROOT, d.name, "manifest.json")))
    .map((d) => {
      const m = loadManifest(join(PROJECTS_ROOT, d.name));
      const status = Object.fromEntries(
        STAGE_NAMES.map((n) => [n, m.stages[n].status]),
      ) as Record<StageName, string>;
      return { slug: d.name, status };
    });
}
