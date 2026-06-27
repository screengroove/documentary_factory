import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "./project.js";
import { loadManifest } from "./manifest.js";

const dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "root-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("creates project dir, subdirs, and initial manifest", () => {
  const root = tmp();
  const dir = createProject(root, "lighthouses", {
    topic: "Lighthouses", targetMinutes: 6, tone: "wistful",
    aspectRatio: "16:9", imageStyle: "35mm film",
  }, "2026-06-26T00:00:00.000Z");

  expect(existsSync(join(dir, "assets/images"))).toBe(true);
  expect(existsSync(join(dir, "assets/audio"))).toBe(true);
  const man = loadManifest(dir);
  expect(man.slug).toBe("lighthouses");
  expect(man.stages.script.status).toBe("pending");
  expect(man.segments).toEqual([]);
});
