import { expect, test } from "vitest";
import { contentTypeFor } from "./contentType.js";

test("maps audio and image extensions, defaulting to png", () => {
  expect(contentTypeFor("seg-001.wav")).toBe("audio/wav");
  expect(contentTypeFor("track.mp3")).toBe("audio/mpeg");
  expect(contentTypeFor("seg-001-0.jpg")).toBe("image/jpeg");
  expect(contentTypeFor("seg-001-0.jpeg")).toBe("image/jpeg");
  expect(contentTypeFor("seg-001-0.webp")).toBe("image/webp");
  expect(contentTypeFor("title.png")).toBe("image/png");
  expect(contentTypeFor("noext")).toBe("image/png");
});

test("is case-insensitive on the extension", () => {
  expect(contentTypeFor("PHOTO.JPG")).toBe("image/jpeg");
  expect(contentTypeFor("Clip.WAV")).toBe("audio/wav");
});
