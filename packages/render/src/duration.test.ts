import { expect, test } from "vitest";
import { totalFrames } from "./props.js";

test("totalFrames sums segment frames", () => {
  const kb = { from: { x:0,y:0,w:1,h:1 }, to: { x:0,y:0,w:1,h:1 } };
  const props = {
    fps: 30, aspectRatio: "16:9" as const,
    segments: [
      { id: "a", durationInFrames: 60, words: [], stills: [{ imagePath: "x", durationInFrames: 60, kenBurns: kb }] },
      { id: "b", durationInFrames: 90, words: [], stills: [
        { imagePath: "y", durationInFrames: 60, kenBurns: kb },
        { imagePath: "z", durationInFrames: 30, kenBurns: kb },
      ] },
    ],
  };
  expect(totalFrames(props)).toBe(150);
});
