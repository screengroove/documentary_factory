import { afterEach, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../project.js";
import { loadManifest, saveManifest } from "../manifest.js";
import { runImages, deterministicSeed } from "./images.js";
import { makeFakeDeps } from "./deps.js";

const dirs: string[] = [];
function projectWithShots() {
  const root = mkdtempSync(join(tmpdir(), "root-"));
  dirs.push(root);
  const dir = createProject(root, "doc", {
    topic: "L", targetMinutes: 6, tone: "w", aspectRatio: "16:9", imageStyle: "film",
  }, "2026-06-26T00:00:00.000Z");
  const m = loadManifest(dir);
  const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } };
  m.segments = [
    { id: "seg-001", order: 0, narration: "A", stills: [{ imagePrompt: "p1", kenBurns: kb, weight: 1 }] },
    { id: "seg-002", order: 1, narration: "B", stills: [{ imagePrompt: "p2", kenBurns: kb, weight: 1 }] },
  ];
  m.stages.script.status = "approved";
  m.stages.shotlist.status = "approved";
  saveManifest(dir, m);
  return dir;
}
// Same project, plus the optional opening title card (its own prompt + motion).
function projectWithTitle() {
  const dir = projectWithShots();
  const m = loadManifest(dir);
  const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } };
  m.title = { text: "T", imagePrompt: "tp", durationSec: 4, kenBurns: kb };
  saveManifest(dir, m);
  return dir;
}
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const fakeFetch = (async () =>
  new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;

test("generates and downloads an image per still", async () => {
  const dir = projectWithShots();
  const deps = makeFakeDeps({
    images: { generate: async () => ({ url: "http://fake/i.png", provider: "fake" }) },
  });

  await runImages(dir, deps, { fetchFn: fakeFetch });

  const m = loadManifest(dir);
  expect(m.segments[0].stills?.[0].image?.path).toBe("assets/images/seg-001-0.png");
  expect(m.segments[0].stills?.[0].image?.approved).toBe(false);
  expect(existsSync(join(dir, "assets/images/seg-001-0.png"))).toBe(true);
  expect(m.stages.images.status).toBe("awaiting_review");
});

test("folds the still index into the seed so stills differ", async () => {
  const dir = projectWithShots();
  // Give seg-001 two stills with no images; each should get its own seed.
  let m = loadManifest(dir);
  const kb = { from: { x: 0, y: 0, w: 1, h: 1 }, to: { x: 0, y: 0, w: 1, h: 1 } };
  m.segments[0].stills = [
    { imagePrompt: "p1", kenBurns: kb, weight: 1 },
    { imagePrompt: "p2", kenBurns: kb, weight: 1 },
  ];
  saveManifest(dir, m);

  const deps = makeFakeDeps({
    images: { generate: async () => ({ url: "http://fake/i.png", provider: "fake" }) },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });

  m = loadManifest(dir);
  const s0 = m.segments[0].stills?.[0].image?.seed;
  const s1 = m.segments[0].stills?.[1].image?.seed;
  expect(s0).toBe(deterministicSeed("seg-001:0"));
  expect(s1).toBe(deterministicSeed("seg-001:1"));
  expect(s0).not.toBe(s1);
});

test("skips stills already approved", async () => {
  const dir = projectWithShots();
  // Pre-approve seg-001's only still.
  let m = loadManifest(dir);
  m.segments[0].stills![0].image = {
    path: "assets/images/seg-001-0.png", seed: 1, provider: "x", approved: true,
  };
  saveManifest(dir, m);

  let calls = 0;
  const deps = makeFakeDeps({
    images: { generate: async () => { calls++; return { url: "http://fake/i.png", provider: "fake" }; } },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });
  expect(calls).toBe(1); // only seg-002's still regenerated
});

test("regenerates only stills flagged needsRegen", async () => {
  const dir = projectWithShots();
  let m = loadManifest(dir);
  // seg-001 done & not flagged; seg-002 done but flagged for regen.
  m.segments[0].stills![0].image = {
    path: "assets/images/seg-001-0.png", seed: 1, provider: "x", approved: true,
  };
  m.segments[1].stills![0].image = {
    path: "assets/images/seg-002-0.png", seed: 2, provider: "x", approved: false, needsRegen: true,
  };
  saveManifest(dir, m);

  let calls = 0;
  const deps = makeFakeDeps({
    images: { generate: async () => { calls++; return { url: "http://fake/i.png", provider: "fake" }; } },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });
  expect(calls).toBe(1); // only the needsRegen still

  m = loadManifest(dir);
  // Regenerated still keeps its original seed and is reset to unapproved.
  expect(m.segments[1].stills?.[0].image?.seed).toBe(2);
  expect(m.segments[1].stills?.[0].image?.approved).toBe(false);
});

test("generates and downloads the title card background image", async () => {
  const dir = projectWithTitle();
  const deps = makeFakeDeps({
    images: { generate: async () => ({ url: "http://fake/i.png", provider: "fake" }) },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });

  const m = loadManifest(dir);
  expect(m.title?.image?.path).toBe("assets/images/title.png");
  expect(m.title?.image?.approved).toBe(false);
  expect(m.title?.image?.seed).toBe(deterministicSeed("title"));
  expect(existsSync(join(dir, "assets/images/title.png"))).toBe(true);
});

test("skips an already-approved title image", async () => {
  const dir = projectWithTitle();
  let m = loadManifest(dir);
  m.title!.image = {
    path: "assets/images/title.png", seed: 9, provider: "x", approved: true,
  };
  saveManifest(dir, m);

  let titleCalls = 0;
  const deps = makeFakeDeps({
    images: { generate: async ({ prompt }) => {
      if (prompt === "tp") titleCalls++;
      return { url: "http://fake/i.png", provider: "fake" };
    } },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });
  expect(titleCalls).toBe(0); // approved title left untouched
});

test("regenerates a title image flagged needsRegen", async () => {
  const dir = projectWithTitle();
  let m = loadManifest(dir);
  m.title!.image = {
    path: "assets/images/title.png", seed: 9, provider: "x", approved: true, needsRegen: true,
  };
  saveManifest(dir, m);

  let titleCalls = 0;
  const deps = makeFakeDeps({
    images: { generate: async ({ prompt }) => {
      if (prompt === "tp") titleCalls++;
      return { url: "http://fake/i.png", provider: "fake" };
    } },
  });
  await runImages(dir, deps, { fetchFn: fakeFetch });
  expect(titleCalls).toBe(1); // flagged title regenerated

  m = loadManifest(dir);
  expect(m.title?.image?.seed).toBe(9); // keeps its original seed
  expect(m.title?.image?.approved).toBe(false);
});
