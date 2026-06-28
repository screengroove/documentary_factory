import { expect, test } from "vitest";
import { applyPronunciations, remapWords, suggestRespelling } from "./pronunciation.js";

test("replaces whole words, case-insensitively, preserving punctuation", () => {
  const r = applyPronunciations("Arsenic, and more arsenic.", [{ term: "arsenic", respelling: "AR-suh-nik" }]);
  expect(r.spokenText).toBe("AR-suh-nik, and more AR-suh-nik.");
  expect(r.used).toEqual([{ term: "arsenic", respelling: "AR-suh-nik" }]);
});

test("does not match inside another word", () => {
  const r = applyPronunciations("Alice met Al.", [{ term: "Al", respelling: "AL" }]);
  expect(r.spokenText).toBe("Alice met AL.");
});

test("longest term wins over a contained term", () => {
  const r = applyPronunciations("World Health Organization", [
    { term: "Health", respelling: "HELLTH" },
    { term: "World Health Organization", respelling: "W-H-O" },
  ]);
  expect(r.spokenText).toBe("W-H-O");
});

test("no match leaves text unchanged and used empty", () => {
  const r = applyPronunciations("nothing here", [{ term: "xyz", respelling: "ZZZ" }]);
  expect(r.spokenText).toBe("nothing here");
  expect(r.used).toEqual([]);
});

test("blank entries are ignored", () => {
  const r = applyPronunciations("hi", [{ term: "  ", respelling: "x" }, { term: "hi", respelling: "" }]);
  expect(r.spokenText).toBe("hi");
  expect(r.used).toEqual([]);
});

const W = (word: string, start: number, end: number) => ({ word, start, end });

test("collapses a corrected term's spoken tokens back to the original spelling", () => {
  const words = [W("Hello", 0, 0.5), W("ee", 0.5, 0.7), W("vah", 0.7, 0.9), W("nee", 0.9, 1.1), W("tskee", 1.1, 1.4), W("world", 1.4, 1.9)];
  const out = remapWords("Hello Iwanicki world", words, [{ term: "Iwanicki", respelling: "ee-vah-nee-tskee" }]);
  expect(out).toEqual([W("Hello", 0, 0.5), W("Iwanicki", 0.5, 1.4), W("world", 1.4, 1.9)]);
});

test("no used entries returns words unchanged", () => {
  const words = [W("a", 0, 1)];
  expect(remapWords("a", words, [])).toBe(words);
});

test("falls back to original words on drift", () => {
  const words = [W("ee", 0, 0.5)]; // missing the trailing anchor entirely
  const out = remapWords("Hello Iwanicki world", words, [{ term: "Iwanicki", respelling: "ee" }]);
  expect(out).toBe(words);
});

test("suggestRespelling asks the LLM and returns the trimmed respelling", async () => {
  let sawSystem = "", sawUser = "";
  const llm = { complete: async ({ system, user, schema }: any) => { sawSystem = system; sawUser = user; return schema.parse({ respelling: " ee-vah-NEE-tskee " }); } };
  const out = await suggestRespelling(llm as any, "Iwanicki");
  expect(out).toBe("ee-vah-NEE-tskee");
  expect(sawUser).toBe("Iwanicki");
  expect(sawSystem.toLowerCase()).toContain("respelling");
});
