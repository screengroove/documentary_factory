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
