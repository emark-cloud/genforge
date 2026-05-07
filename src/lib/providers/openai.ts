import OpenAI from "openai";
import {
  type LLMProvider,
  type GenerateArgs,
  type GenerateResult,
  normalizeError,
} from "./types";

/** OpenAI's `response_format: { type: "json_object" }` enforces valid JSON
 *  output for chat-completions models that support it (4o-class and gpt-5
 *  family). For models without it the system prompt's JSON instruction
 *  carries the day; we still parse defensively in the caller. */
async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const client = new OpenAI({ apiKey: args.apiKey });
  try {
    const response = await client.chat.completions.create({
      model: args.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
    });
    const text = response.choices[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
      },
    };
  } catch (e) {
    throw normalizeError("openai", e);
  }
}

export const openaiProvider: LLMProvider = {
  name: "openai",
  generate,
};
