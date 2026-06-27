import type { TtsClient, Word } from "./types.js";

// ElevenLabs "with-timestamps" endpoint returns base64 audio + per-character
// alignment. We collapse characters into words here.
export function elevenLabsTts(apiKey: string): TtsClient {
  return {
    async speak({ text, voiceId }) {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "content-type": "application/json" },
          body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
        },
      );
      if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as {
        audio_base64: string;
        alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
      };
      const audio = Buffer.from(data.audio_base64, "base64");
      const words = charsToWords(data.alignment);
      return { audio, words };
    },
  };
}

export function charsToWords(a: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}): Word[] {
  const words: Word[] = [];
  let cur = "", start = 0;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (ch === " ") {
      if (cur) words.push({ word: cur, start, end: a.character_end_times_seconds[i - 1] ?? start });
      cur = "";
    } else {
      if (!cur) start = a.character_start_times_seconds[i];
      cur += ch;
    }
  }
  if (cur) words.push({ word: cur, start, end: a.character_end_times_seconds.at(-1) ?? start });
  return words;
}
