import { GoogleGenAI } from "@google/genai";
import {
  type LLMProvider,
  type GenerateArgs,
  type GenerateResult,
  normalizeError,
} from "./types";

/** JSON-mode is native on Gemini via `responseMimeType: "application/json"`. */
async function generate(args: GenerateArgs): Promise<GenerateResult> {
  const ai = new GoogleGenAI({ apiKey: args.apiKey });
  try {
    const response = await ai.models.generateContent({
      model: args.model,
      contents: args.userPrompt,
      config: {
        systemInstruction: args.systemPrompt,
        responseMimeType: "application/json",
        temperature: 0.2,
        // Default 8k truncates longer contracts mid-JSON. 32k gives room for
        // the full code + usage notes block on the Generate flow.
        maxOutputTokens: 32768,
      },
    });
    return {
      text: response.text ?? "",
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (e) {
    throw normalizeError("gemini", e);
  }
}

export const geminiProvider: LLMProvider = {
  name: "gemini",
  generate,
};
