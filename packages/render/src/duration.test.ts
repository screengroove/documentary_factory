import { expect, test } from "vitest";
import { totalFrames } from "./props.js";

test("totalFrames sums segment frames", () => {
  const props = {
    fps: 30, aspectRatio: "16:9" as const,
    segments: [
      { id: "a", imagePath: "x", durationInFrames: 60, kenBurns: { from: { x:0,y:0,w:1,h:1 }, to: { x:0,y:0,w:1,h:1 } }, words: [] },
      { id: "b", imagePath: "y", durationInFrames: 90, kenBurns: { from: { x:0,y:0,w:1,h:1 }, to: { x:0,y:0,w:1,h:1 } }, words: [] },
    ],
  };
  expect(totalFrames(props)).toBe(150);
});
