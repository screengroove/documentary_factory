import type { ImageClient, LlmClient, TtsClient } from "../providers/types.js";
import { anthropicLlm } from "../providers/anthropic.js";
import { replicateImages } from "../providers/replicate.js";
import { replicateTts } from "../providers/replicate-tts.js";

export type StageDeps = { llm: LlmClient; images: ImageClient; tts: TtsClient };

export function makeFakeDeps(overrides: Partial<StageDeps> = {}): StageDeps {
  return {
    llm: { complete: async ({ schema }) => schema.parse({}) },
    images: { generate: async () => ({ url: "http://fake/img.png", provider: "fake" }) },
    tts: { speak: async () => ({ audio: Buffer.from(""), words: [] }) },
    ...overrides,
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing required env var ${key}`);
  return v;
}

export function realDeps(env: NodeJS.ProcessEnv): StageDeps {
  const replicateToken = required(env, "REPLICATE_API_TOKEN");
  return {
    llm: anthropicLlm(required(env, "ANTHROPIC_API_KEY")),
    images: replicateImages(replicateToken),
    tts: replicateTts(replicateToken), // same token powers images + narration
  };
}
