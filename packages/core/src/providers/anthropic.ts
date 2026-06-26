import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmClient } from "./types.js";

export function anthropicLlm(apiKey: string, model = "claude-opus-4-8"): LlmClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete({ system, user, schema }) {
      // Force structured output via a single tool the model must call.
      const jsonSchema = zodToJsonSchema(schema, "Result");
      const res = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        tools: [{
          name: "emit_result",
          description: "Return the structured result.",
          input_schema: (jsonSchema.definitions?.Result ?? jsonSchema) as any,
        }],
        tool_choice: { type: "tool", name: "emit_result" },
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "tool_use");
      if (!block || block.type !== "tool_use") throw new Error("LLM returned no tool_use");
      return schema.parse(block.input);
    },
  };
}
