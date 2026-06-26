import Replicate from "replicate";
import type { TtsClient, Word } from "./types.js";

// Kokoro-82M (synthesis) + WhisperX (word-level timestamps), both on Replicate.
// Kokoro returns a single WAV-file URL; WhisperX returns segments[].words[] with
// per-word start/end. Two calls per segment, but it all rides the same
// REPLICATE_API_TOKEN already used for images. WhisperX re-transcribes the audio
// to align — accurate enough for narration captions.

const KOKORO = "jaaari/kokoro-82m";
const WHISPERX = "victor-upmeet/whisperx";

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

export function replicateTts(
  token: string,
  opts: { ttsModel?: string; alignModel?: string } = {},
): TtsClient {
  const client = new Replicate({ auth: token });
  const ttsModel = (opts.ttsModel ?? KOKORO) as `${string}/${string}`;
  const alignModel = (opts.alignModel ?? WHISPERX) as `${string}/${string}`;

  return {
    async speak({ text, voiceId }) {
      // 1) Synthesize. voiceId is a Kokoro voice name, e.g. "af_sarah", "am_michael".
      const ttsOut = await client.run(ttsModel, {
        input: { text, voice: voiceId, speed: 1 },
      });
      const audioUrl = firstUrl(ttsOut);

      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Kokoro audio download failed: ${res.status}`);
      const audio = Buffer.from(await res.arrayBuffer());

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
