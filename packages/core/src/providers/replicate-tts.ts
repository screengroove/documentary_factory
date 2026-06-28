import Replicate from "replicate";
import type { TtsClient, Word } from "./types.js";

// Kokoro-82M (synthesis) + WhisperX (word-level timestamps), both on Replicate.
// Kokoro returns a single WAV-file URL; WhisperX returns segments[].words[] with
// per-word start/end. Two calls per segment, but it all rides the same
// REPLICATE_API_TOKEN already used for images. WhisperX re-transcribes the audio
// to align — accurate enough for narration captions.

// Kokoro and WhisperX are community models, so they must be called with an
// explicit version hash via the versioned-prediction endpoint. The bare
// "owner/name" form hits POST /v1/models/{owner}/{name}/predictions, which only
// exists for Replicate's official serverless models (e.g. Flux) and 404s here.
// Update these hashes from each model's "Versions" tab if a newer one is needed.
const KOKORO = "jaaari/kokoro-82m:f559560eb822dc509045f3921a1921234918b91739db4bf3daab2169b71c7a13";
const WHISPERX = "victor-upmeet/whisperx:655845d6190ef70573c669245f245892cd039df4b880a1e3a65852c09252f5cc";

type WhisperXOutput = {
  segments: Array<{ words?: Array<{ word: string; start?: number; end?: number }> }>;
};

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

// Kokoro synthesis only: run the model, download the WAV. Shared by speak()
// (which then aligns) and the preview endpoint (which does not).
async function kokoro(
  client: Replicate, model: `${string}/${string}`, text: string, voiceId: string,
): Promise<{ audioUrl: string; audio: Buffer }> {
  const ttsOut = await client.run(model, { input: { text, voice: voiceId, speed: 1 } });
  const audioUrl = firstUrl(ttsOut);
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Kokoro audio download failed: ${res.status}`);
  return { audioUrl, audio: Buffer.from(await res.arrayBuffer()) };
}

// Standalone Kokoro synth for previews — no WhisperX alignment (≈2× faster).
export async function synthesize(
  token: string, args: { text: string; voiceId: string }, opts: { ttsModel?: string } = {},
): Promise<Buffer> {
  const client = new Replicate({ auth: token });
  const ttsModel = (opts.ttsModel ?? KOKORO) as `${string}/${string}`;
  const { audio } = await kokoro(client, ttsModel, args.text, args.voiceId);
  return audio;
}

export function replicateTts(
  token: string,
  opts: { ttsModel?: string; alignModel?: string } = {},
): TtsClient {
  const client = new Replicate({ auth: token });
  const ttsModel = (opts.ttsModel ?? KOKORO) as `${string}/${string}`;
  const alignModel = (opts.alignModel ?? WHISPERX) as `${string}/${string}`;

  return {
    async speak({ text, voiceId }) {
      // 1) Synthesize (Kokoro). voiceId is a Kokoro voice name, e.g. "af_sarah".
      const { audioUrl, audio } = await kokoro(client, ttsModel, text, voiceId);

      // 2) Align. Pass the Kokoro URL straight to WhisperX for word timestamps.
      const alignOut = (await client.run(alignModel, {
        input: { audio_file: audioUrl, language: "en", align_output: true },
      })) as WhisperXOutput;

      const words: Word[] = (alignOut.segments ?? [])
        .flatMap((s) => s.words ?? [])
        .filter((w): w is { word: string; start: number; end: number } =>
          typeof w.start === "number" && typeof w.end === "number")
        .map((w) => ({ word: w.word, start: w.start, end: w.end }));

      return { audio, words };
    },
  };
}
