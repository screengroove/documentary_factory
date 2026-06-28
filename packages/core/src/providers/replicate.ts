import Replicate from "replicate";
import type { ImageClient } from "./types.js";

// replicate@1 may hand back a FileOutput (with .url()), an array of them, or a
// plain URL string depending on the model version — normalize to a URL string.
function firstUrl(output: unknown): string {
  const item = Array.isArray(output) ? output[0] : output;
  if (item && typeof item === "object" && "url" in item) {
    const u = (item as { url: unknown }).url;
    return typeof u === "function" ? String((u as () => unknown).call(item)) : String(u);
  }
  return String(item);
}

export function replicateImages(token: string, model = "black-forest-labs/flux-1.1-pro"): ImageClient {
  const client = new Replicate({ auth: token });
  return {
    async generate({ prompt, seed, width, height }) {
      const output = await client.run(model as `${string}/${string}`, {
        // safety_tolerance 6 is Flux's most permissive setting (default is a strict
        // 2, which false-positives "NSFW" on innocuous documentary prompts).
        input: { prompt, seed, width, height, output_format: "png", safety_tolerance: 6 },
      });
      // Flux returns a single image URL (or array of one).
      const url = firstUrl(output);
      return { url, provider: `replicate:${model}` };
    },
  };
}
