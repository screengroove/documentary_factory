import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LlmClient } from "./types.js";

export function anthropicLlm(apiKey: string, model = "claude-opus-4-8"): LlmClient {
  const client = new Anthropic({ apiKey });
  return {
    async complete({ system, user, schema }) {
      // Force structured output via a single tool the model must call.
      const jsonSchema = z.toJSONSchema(schema as z.ZodType);
      const res = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        tools: [{
          name: "emit_result",
          description: "Return the structured result.",
          input_schema: jsonSchema as any,
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
