// Map a file path to its HTTP content-type for asset serving. Covers the audio
// and image formats the pipeline produces (generated PNGs) and accepts as
// user uploads (jpg/jpeg/webp). Defaults to image/png.
export function contentTypeFor(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".wav")) return "audio/wav";
  if (p.endsWith(".mp3")) return "audio/mpeg";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  return "image/png";
}

// Headers for serving project assets. These files are MUTABLE — regenerate and
// re-record rewrite the same path in place — so we must send no-store, otherwise
// the browser shows a stale cached image/audio after the file changes.
export function assetHeaders(path: string): Record<string, string> {
  return { "content-type": contentTypeFor(path), "cache-control": "no-store" };
}
