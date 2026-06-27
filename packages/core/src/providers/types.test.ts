import { expect, test } from "vitest";
import { z } from "zod";
import { makeFakeDeps } from "../stages/deps.js";

test("fake llm returns schema-typed object the caller supplies", async () => {
  const deps = makeFakeDeps({
    llm: { complete: async ({ schema }) => schema.parse({ value: 7 }) },
  });
  const out = await deps.llm.complete({
    system: "s", user: "u", schema: z.object({ value: z.number() }),
  });
  expect(out.value).toBe(7);
});

test("fake deps provide all three clients", () => {
  const deps = makeFakeDeps();
  expect(typeof deps.llm.complete).toBe("function");
  expect(typeof deps.images.generate).toBe("function");
  expect(typeof deps.tts.speak).toBe("function");
});
