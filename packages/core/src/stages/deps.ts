import type { ImageClient, LlmClient, TtsClient } from "../providers/types.js";

export type StageDeps = { llm: LlmClient; images: ImageClient; tts: TtsClient };

export function makeFakeDeps(overrides: Partial<StageDeps> = {}): StageDeps {
  return {
    llm: { complete: async ({ schema }) => schema.parse({}) },
    images: { generate: async () => ({ url: "http://fake/img.png", provider: "fake" }) },
    tts: { speak: async () => ({ audio: Buffer.from(""), words: [] }) },
    ...overrides,
  };
}
