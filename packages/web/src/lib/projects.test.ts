import { expect, test } from "vitest";
import { slugify } from "./projects.js";

test("slugify lowercases and dashes", () => {
  expect(slugify("The History of Lighthouses!")).toBe("the-history-of-lighthouses");
});
