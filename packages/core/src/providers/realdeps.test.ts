import { expect, test } from "vitest";
import { realDeps } from "../stages/deps.js";
import { charsToWords } from "../providers/elevenlabs.js";

test("realDeps throws a clear error when a key is missing", () => {
  expect(() => realDeps({ ANTHROPIC_API_KEY: "a" }))
    .toThrow(/REPLICATE_API_TOKEN/);
});

test("charsToWords groups characters into words", () => {
  const words = charsToWords({
    characters: ["H", "i", " ", "y", "o", "u"],
    character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  });
  expect(words.map((w) => w.word)).toEqual(["Hi", "you"]);
  expect(words[0].start).toBe(0);
});
