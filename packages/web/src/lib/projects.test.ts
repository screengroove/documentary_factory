import { expect, test } from "vitest";
import { slugify } from "./projects.js";

test("slugify lowercases and dashes", () => {
  expect(slugify("The History of Lighthouses!")).toBe("the-history-of-lighthouses");
});

test("slugify caps long topics below the 255-byte filename limit", () => {
  const slug = slugify("word ".repeat(120)); // ~600-char topic pasted as a full pitch
  expect(slug.length).toBeLessThanOrEqual(80);
  expect(slug.endsWith("-")).toBe(false);
});

test("slugify returns empty for topics with no latin letters or digits", () => {
  expect(slugify("ドキュメンタリー 🎬")).toBe("");
});
