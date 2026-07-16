import { readdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadManifest, STAGE_NAMES, type StageName } from "@doc/core";

export const PROJECTS_ROOT = join(process.cwd(), "..", "..", "projects");

// The slug doubles as the project directory name; Linux caps a path component
// at 255 bytes, so long pasted pitches must be truncated (ENAMETOOLONG otherwise).
export function slugify(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "");
}

// Recursively delete a project directory. Validates that `slug` resolves to a
// real project (inside PROJECTS_ROOT, containing a manifest.json) before any
// removal, guarding against path traversal and accidental deletes of stray dirs.
export function deleteProject(slug: string): void {
  const root = resolve(PROJECTS_ROOT);
  const dir = resolve(root, slug);
  if (dir === root || !dir.startsWith(root + "/")) {
    throw new Error("Invalid project slug");
  }
  if (!existsSync(join(dir, "manifest.json"))) {
    throw new Error("Project not found");
  }
  rmSync(dir, { recursive: true, force: true });
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
