/**
 * Prompt smoke-test for the GenForge system prompt.
 *
 * Runs 5 broken contracts through the Debug flow and 5 natural-language
 * descriptions through the Generate flow against Gemini Flash. Validates
 * that each response is well-formed JSON in the expected shape and that
 * generated contracts include the pinned header. Prints a pass/fail table
 * and exits non-zero if anything is wrong.
 *
 * Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/eval-prompt.ts
 *
 * No prompt content or contract content is logged in production paths —
 * but this is a dev script, so it prints summaries to help debugging.
 */

import { GoogleGenAI } from "@google/genai";
import {
  buildDebugUserPrompt,
  buildGenerateUserPrompt,
  buildSystemPrompt,
} from "../src/lib/system-prompt";
import { GENLAYER_DEPENDS_HASH } from "../src/lib/genlayer-version";

// ── test cases ─────────────────────────────────────────────────────────────

type DebugCase = {
  label: string;
  contract: string;
  errorContext?: string;
  /** A fragment we'd like to see called out in the explanation. */
  expectInExplanation: RegExp;
};

type GenerateCase = {
  label: string;
  description: string;
  /** A fragment we'd like to see in the generated code. */
  expectInCode: RegExp;
};

const HEADER_OK = /^# v0\.1\.0\s*\n#\s*\{[^}]*"Depends":\s*"py-genlayer:[^"]+"/;

const debugCases: DebugCase[] = [
  {
    label: "float in storage",
    contract: `# v0.1.0
# { "Depends": "py-genlayer:${GENLAYER_DEPENDS_HASH}" }
from genlayer import *

class Wallet(gl.Contract):
    balances: TreeMap[Address, float]

    def __init__(self):
        pass

    @gl.public.write
    def credit(self, who: str, amount: float) -> None:
        self.balances[Address(who)] = amount
`,
    expectInExplanation: /float|u256/i,
  },
  {
    label: "missing @allow_storage on dataclass",
    contract: `# v0.1.0
# { "Depends": "py-genlayer:${GENLAYER_DEPENDS_HASH}" }
from genlayer import *
from dataclasses import dataclass

@dataclass
class Item:
    name: str
    qty: u256

class Inventory(gl.Contract):
    items: TreeMap[str, Item]

    def __init__(self):
        pass

    @gl.public.write
    def add(self, key: str, name: str, qty: u256) -> None:
        self.items[key] = Item(name=name, qty=qty)
`,
    expectInExplanation: /allow_storage/i,
  },
  {
    label: "address == comparison without .as_hex.lower()",
    contract: `# v0.1.0
# { "Depends": "py-genlayer:${GENLAYER_DEPENDS_HASH}" }
from genlayer import *

class Pair(gl.Contract):
    party_a: Address
    party_b: Address

    def __init__(self, a: str, b: str):
        self.party_a = Address(a)
        self.party_b = Address(b)

    @gl.public.write
    def claim(self) -> None:
        if gl.message.sender_address == self.party_a:
            return
        if gl.message.sender_address == self.party_b:
            return
        raise gl.vm.UserError("Not a party")
`,
    expectInExplanation: /as_hex|case|compare|lower/i,
  },
  {
    label: "storage access inside nondet block",
    contract: `# v0.1.0
# { "Depends": "py-genlayer:${GENLAYER_DEPENDS_HASH}" }
from genlayer import *

class Reviewer(gl.Contract):
    text: str

    def __init__(self):
        self.text = ""

    @gl.public.write
    def submit(self, text: str) -> None:
        self.text = text

    @gl.public.write
    def grade(self) -> str:
        def evaluate() -> str:
            return gl.nondet.exec_prompt(f"Score 0-10: {self.text}").strip()
        return gl.eq_principle.prompt_non_comparative(
            evaluate, task="Score", criteria="Single integer 0-10"
        )
`,
    expectInExplanation: /storage|nondet|copy|local/i,
  },
  {
    label: "JSON parsed without fence stripping",
    contract: `# v0.1.0
# { "Depends": "py-genlayer:${GENLAYER_DEPENDS_HASH}" }
from genlayer import *
import json

class Classifier(gl.Contract):
    def __init__(self):
        pass

    @gl.public.write
    def classify(self, text: str) -> str:
        text_copy = text
        def evaluate() -> str:
            return gl.nondet.exec_prompt(
                f"Classify and return JSON {{label, confidence}}: {text_copy}"
            )
        result = gl.eq_principle.prompt_non_comparative(
            evaluate, task="Classify", criteria="Valid JSON"
        )
        parsed = json.loads(result)
        return parsed["label"]
`,
    expectInExplanation: /fence|markdown|\\\`\\\`\\\`|json|strip|parse/i,
  },
];

const generateCases: GenerateCase[] = [
  {
    label: "sealed-bid auction",
    description:
      "A sealed-bid auction where bids are revealed by the LLM after a deadline and the highest bid wins. Anyone can bid; bids are kept private until the deadline. After the deadline a public method finalizes the winner.",
    expectInCode: /TreeMap|DynArray/,
  },
  {
    label: "yes/no DAO vote",
    description:
      "A simple DAO vote contract: the owner opens a yes/no question with a deadline, members cast YES or NO once each, and after the deadline anyone can finalize and read the result.",
    expectInCode: /sender_address|TreeMap/,
  },
  {
    label: "two-party escrow with LLM arbiter",
    description:
      "A two-party escrow: buyer deposits funds, seller delivers off-chain, either party can dispute. On dispute, an LLM arbiter reads each side's evidence and decides who wins.",
    expectInCode: /eq_principle|run_nondet_unsafe/,
  },
  {
    label: "content moderator",
    description:
      "A content moderation contract: users post short text snippets, anyone can request moderation, and the LLM classifies each snippet as ALLOW or DENY based on policy.",
    expectInCode: /eq_principle|nondet/,
  },
  {
    label: "web data PASS/FAIL",
    description:
      "A contract that takes a URL, fetches the page, and returns PASS or FAIL based on whether the page contains a stated keyword.",
    expectInCode: /gl\.nondet\.web/,
  },
];

// ── runner ─────────────────────────────────────────────────────────────────

const apiKey = process.env.SERVER_LLM_KEY;
const model = process.env.SERVER_LLM_MODEL ?? "gemini-2.5-flash";

if (!apiKey) {
  console.error(
    "SERVER_LLM_KEY missing. Run with: pnpm dlx tsx --env-file=.env.local scripts/eval-prompt.ts"
  );
  process.exit(2);
}

const ai = new GoogleGenAI({ apiKey });

type Result = {
  flow: "debug" | "generate";
  label: string;
  ok: boolean;
  notes: string[];
  latencyMs: number;
};

function tryParseJson(text: string): unknown | null {
  let raw = text.trim();
  // Strip markdown fences if present (matches Hard rule 11).
  raw = raw.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}") + 1;
  if (start >= 0 && end > start) {
    raw = raw.slice(start, end);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  // Gemini Flash returns 503 UNAVAILABLE intermittently under load. Retry with
  // exponential backoff on transient 5xx; surface other errors immediately.
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0.2,
          // Default cap is ~8k; longer contracts get truncated mid-JSON. Bump
          // to give Generate flow room for full contracts + usage notes.
          maxOutputTokens: 32768,
        },
      });
      return response.text ?? "";
    } catch (e) {
      lastErr = e;
      const msg = (e as Error).message ?? "";
      const transient = /503|UNAVAILABLE|429|RESOURCE_EXHAUSTED|deadline|timeout/i.test(msg);
      if (!transient || attempt === maxAttempts - 1) throw e;
      const delay = 1500 * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function runDebug(c: DebugCase): Promise<Result> {
  const notes: string[] = [];
  const t0 = Date.now();
  let ok = true;
  try {
    const text = await callGemini(
      buildSystemPrompt("debug"),
      buildDebugUserPrompt({ contract: c.contract, errorContext: c.errorContext })
    );
    const parsed = tryParseJson(text);
    if (!parsed || typeof parsed !== "object") {
      ok = false;
      notes.push(`not valid JSON; raw[0..200]=${JSON.stringify(text.slice(0, 200))}`);
    } else {
      const o = parsed as Record<string, unknown>;
      if (typeof o.fixed_code !== "string" || o.fixed_code.length < 50) {
        ok = false;
        notes.push("fixed_code missing or too short");
      } else if (!HEADER_OK.test(String(o.fixed_code))) {
        ok = false;
        notes.push("fixed_code missing two-line header");
      }
      if (typeof o.explanation !== "string" || o.explanation.length < 10) {
        ok = false;
        notes.push("explanation missing");
      } else if (!c.expectInExplanation.test(o.explanation)) {
        notes.push(
          `explanation does not mention expected fragment ${c.expectInExplanation}`
        );
      }
      if (!Array.isArray(o.changes)) {
        ok = false;
        notes.push("changes not an array");
      }
    }
  } catch (e) {
    ok = false;
    notes.push(`error: ${(e as Error).message}`);
  }
  return { flow: "debug", label: c.label, ok, notes, latencyMs: Date.now() - t0 };
}

async function runGenerate(c: GenerateCase): Promise<Result> {
  const notes: string[] = [];
  const t0 = Date.now();
  let ok = true;
  try {
    const text = await callGemini(
      buildSystemPrompt("generate"),
      buildGenerateUserPrompt({ description: c.description })
    );
    const parsed = tryParseJson(text);
    if (!parsed || typeof parsed !== "object") {
      ok = false;
      notes.push(`not valid JSON; raw[0..200]=${JSON.stringify(text.slice(0, 200))}`);
    } else {
      const o = parsed as Record<string, unknown>;
      if (typeof o.code !== "string" || o.code.length < 80) {
        ok = false;
        notes.push("code missing or too short");
      } else {
        const code = String(o.code);
        if (!HEADER_OK.test(code)) {
          ok = false;
          notes.push("code missing two-line header");
        }
        if (!code.includes(GENLAYER_DEPENDS_HASH)) {
          ok = false;
          notes.push("code uses wrong Depends hash");
        }
        if (/:\s*float\b/.test(code) || /->\s*float\b/.test(code)) {
          ok = false;
          notes.push("generated code contains a float type — forbidden");
        }
        if (!c.expectInCode.test(code)) {
          notes.push(`code does not match expected fragment ${c.expectInCode}`);
        }
      }
      if (typeof o.usage_notes !== "string" || o.usage_notes.length < 10) {
        ok = false;
        notes.push("usage_notes missing");
      }
      if (!Array.isArray(o.constructor_args)) {
        ok = false;
        notes.push("constructor_args not an array");
      }
    }
  } catch (e) {
    ok = false;
    notes.push(`error: ${(e as Error).message}`);
  }
  return { flow: "generate", label: c.label, ok, notes, latencyMs: Date.now() - t0 };
}

async function main() {
  console.log(`# GenForge prompt eval — model=${model}\n`);
  const results: Result[] = [];

  for (const c of debugCases) {
    process.stdout.write(`debug   · ${c.label.padEnd(48)} `);
    const r = await runDebug(c);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  (${r.latencyMs}ms)`);
    for (const n of r.notes) console.log(`           - ${n}`);
  }

  for (const c of generateCases) {
    process.stdout.write(`generate· ${c.label.padEnd(48)} `);
    const r = await runGenerate(c);
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  (${r.latencyMs}ms)`);
    for (const n of r.notes) console.log(`           - ${n}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  const totalMs = results.reduce((s, r) => s + r.latencyMs, 0);
  console.log(`\n# ${passed}/${total} passed in ${(totalMs / 1000).toFixed(1)}s`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
