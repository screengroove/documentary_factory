import { expect, test } from "vitest";
import { totalFrames, musicVolume } from "./props.js";

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

test("totalFrames includes the intro card", () => {
  const kb = { from: { x:0,y:0,w:1,h:1 }, to: { x:0,y:0,w:1,h:1 } };
  const props = {
    fps: 30, aspectRatio: "16:9" as const,
    intro: { imagePath: "t", durationInFrames: 120, kenBurns: kb, text: "T" },
    segments: [
      { id: "a", durationInFrames: 60, words: [], stills: [{ imagePath: "x", durationInFrames: 60, kenBurns: kb }] },
    ],
  };
  expect(totalFrames(props)).toBe(180);
});

test("musicVolume fades in, holds, and fades out", () => {
  const total = 300, base = 0.15;
  expect(musicVolume(0, total, base)).toBe(0);                 // start silent
  expect(musicVolume(30, total, base)).toBeCloseTo(base);      // full after fade-in
  expect(musicVolume(150, total, base)).toBeCloseTo(base);     // holds mid
  expect(musicVolume(300, total, base)).toBe(0);              // silent at end
  expect(musicVolume(285, total, base)).toBeCloseTo(base / 3, 5); // 15 of 45 frames left
});
