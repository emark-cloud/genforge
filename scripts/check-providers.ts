/**
 * Provider-adapter smoke test.
 *
 * Calls each adapter with a trivial JSON-mode prompt and verifies the
 * shape of the response. Skips any provider whose key is not set in
 * the environment so this works with just SERVER_LLM_KEY (Gemini) for
 * day-one verification.
 *
 * Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/check-providers.ts
 *
 * Env keys checked:
 *   SERVER_LLM_KEY         -> Gemini (re-uses the server-tier key)
 *   ANTHROPIC_API_KEY      -> Anthropic
 *   OPENAI_API_KEY         -> OpenAI
 */

import { getProvider, LLMError, type ProviderName } from "../src/lib/providers";

type Case = {
  provider: ProviderName;
  apiKeyEnv: string;
  model: string;
};

const cases: Case[] = [
  { provider: "gemini", apiKeyEnv: "SERVER_LLM_KEY", model: "gemini-2.5-flash" },
  { provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", model: "claude-haiku-4-5" },
  { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "gpt-5-mini" },
];

const SYSTEM_PROMPT = `You are a test fixture. Respond with a single JSON object exactly matching {"ok": true, "echo": <number>}, nothing else.`;
const USER_PROMPT = `Return ok=true and echo=42.`;

function tryParse(s: string): unknown | null {
  let raw = s.trim().replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}") + 1;
  if (a >= 0 && b > a) raw = raw.slice(a, b);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function run(c: Case): Promise<{ status: "pass" | "fail" | "skip"; note: string; ms: number }> {
  const apiKey = process.env[c.apiKeyEnv];
  if (!apiKey) return { status: "skip", note: `${c.apiKeyEnv} not set`, ms: 0 };
  const t0 = Date.now();
  try {
    const provider = getProvider(c.provider);
    const result = await provider.generate({
      apiKey,
      model: c.model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
      responseFormat: "json",
    });
    const parsed = tryParse(result.text);
    if (!parsed || typeof parsed !== "object") {
      return {
        status: "fail",
        note: `non-JSON response; raw[0..120]=${JSON.stringify(result.text.slice(0, 120))}`,
        ms: Date.now() - t0,
      };
    }
    const o = parsed as Record<string, unknown>;
    if (o.ok !== true) {
      return { status: "fail", note: `expected ok:true, got ${JSON.stringify(o.ok)}`, ms: Date.now() - t0 };
    }
    if (typeof o.echo !== "number") {
      return { status: "fail", note: `expected echo:number, got ${typeof o.echo}`, ms: Date.now() - t0 };
    }
    const usageNote = result.usage
      ? `tokens in=${result.usage.inputTokens ?? "?"} out=${result.usage.outputTokens ?? "?"}`
      : "no usage info";
    return { status: "pass", note: usageNote, ms: Date.now() - t0 };
  } catch (e) {
    if (e instanceof LLMError) {
      return {
        status: "fail",
        note: `LLMError(provider=${e.provider}, status=${e.status}): ${e.message.slice(0, 160)}`,
        ms: Date.now() - t0,
      };
    }
    return { status: "fail", note: `unexpected: ${(e as Error).message}`, ms: Date.now() - t0 };
  }
}

async function main() {
  console.log("# Provider adapter smoke\n");
  let passed = 0;
  let attempted = 0;
  for (const c of cases) {
    process.stdout.write(`${c.provider.padEnd(9)} (${c.model.padEnd(20)}) `);
    const r = await run(c);
    if (r.status === "skip") {
      console.log(`SKIP   — ${r.note}`);
      continue;
    }
    attempted++;
    if (r.status === "pass") passed++;
    console.log(`${r.status.toUpperCase()}   (${r.ms}ms) — ${r.note}`);
  }
  console.log(`\n# ${passed}/${attempted} passed (skipped ${cases.length - attempted})`);
  process.exit(attempted > 0 && passed === attempted ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
