import { expect, test } from "vitest";
import { contentTypeFor, assetHeaders } from "./contentType.js";

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

test("assetHeaders sets no-store so regenerated/replaced assets aren't served stale", () => {
  const h = assetHeaders("assets/images/seg-001-0.png");
  expect(h["content-type"]).toBe("image/png");
  expect(h["cache-control"]).toBe("no-store");
});
