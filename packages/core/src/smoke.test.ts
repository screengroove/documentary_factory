import { expect, test } from "vitest";
import { CORE_VERSION } from "./index.js";

test("core package is wired up", () => {
  expect(CORE_VERSION).toBe(1);
});
