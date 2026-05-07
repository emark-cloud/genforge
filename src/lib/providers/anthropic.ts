import Anthropic from "@anthropic-ai/sdk";
import {
  type LLMProvider,
  type GenerateArgs,
  type GenerateResult,
  normalizeError,
} from "./types";

/** Anthropic has no native JSON-mode for arbitrary schemas, so we prompt-engineer
 *  the constraint into the system message and rely on the caller's fence-strip
 *  parser fallback (see GUIDELINES.md §4.14, mirrored in scripts/eval-prompt.ts). */
async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const systemWithJson =
    `${args.systemPrompt}\n\n` +
    `IMPORTANT: Return ONLY a single valid JSON object — no prose, no markdown fences. ` +
    `Your entire response must parse with JSON.parse.`;

  try {
    const response = await client.messages.create({
      model: args.model,
      max_tokens: 16384,
      temperature: 0.2,
      system: systemWithJson,
      messages: [{ role: "user", content: args.userPrompt }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return {
      text,
      usage: {
        inputTokens: response.usage?.input_tokens,
        outputTokens: response.usage?.output_tokens,
      },
    };
  } catch (e) {
    throw normalizeError("anthropic", e);
  }
}

export const anthropicProvider: LLMProvider = {
  name: "anthropic",
  generate,
};
