import type { ZodSchema } from "zod";

export type Word = { word: string; start: number; end: number };

export interface LlmClient {
  complete<T>(args: { system: string; user: string; schema: ZodSchema<T> }): Promise<T>;
}

export interface ImageClient {
  generate(args: { prompt: string; seed: number; width: number; height: number }): Promise<{
    url: string;
    provider: string;
  }>;
}

export interface TtsClient {
  speak(args: { text: string; voiceId: string }): Promise<{ audio: Buffer; words: Word[] }>;
}
