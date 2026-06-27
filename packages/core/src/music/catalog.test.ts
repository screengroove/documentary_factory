import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { CATALOG, pickTrack, trackSourcePath, type Track } from "./catalog.js";

test("catalog ships only tracks whose files exist on disk", () => {
  expect(CATALOG.length).toBeGreaterThan(0);
  for (const t of CATALOG) expect(existsSync(trackSourcePath(t))).toBe(true);
});

test("pickTrack maps a tone keyword to a matching mood", () => {
  const catalog: Track[] = [
    { id: "calm", title: "", composer: "", file: "a.mp3", moods: ["contemplative"], license: "", sourceUrl: "" },
    { id: "edgy", title: "", composer: "", file: "b.mp3", moods: ["tense"], license: "", sourceUrl: "" },
  ];
  expect(pickTrack("wistful, archival", catalog).id).toBe("calm");
  expect(pickTrack("tense, urgent thriller", catalog).id).toBe("edgy");
});

test("pickTrack falls back to the first track when no keyword matches", () => {
  const catalog: Track[] = [
    { id: "calm", title: "", composer: "", file: "a.mp3", moods: ["contemplative"], license: "", sourceUrl: "" },
  ];
  expect(pickTrack("zzz nonsense", catalog).id).toBe("calm");
});

test("pickTrack throws on an empty catalog", () => {
  expect(() => pickTrack("anything", [])).toThrow();
});
