/**
 * Headless verification for src/lib/keys.ts.
 *
 * Mocks `window.localStorage` in Node so we can exercise the SSR-safe storage
 * layer without spinning up a browser. The interactive UI parts of the modal
 * (focus trap, Esc, reveal toggle) get a manual eyeball test in the dev
 * server — those are inherently DOM-bound.
 *
 * Run:
 *   pnpm dlx tsx scripts/check-keys.ts
 */

type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  snapshot() {
    return Object.fromEntries(this.m.entries());
  }
}

const store = new MemoryStorage();
// Install before importing keys.ts so the module-level `typeof window` works.
(globalThis as { window?: { localStorage: StorageLike } }).window = {
  localStorage: store,
};

async function main() {
  const mod = await import("../src/lib/keys");

  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) {
      console.error(`FAIL: ${msg}`);
      console.error("store:", store.snapshot());
      process.exit(1);
    }
    console.log(`  ok — ${msg}`);
  }

  // ── [1] starts empty ─────────────────────────────────────────────────
  console.log("[1] starts empty");
  assert(mod.getKey("anthropic") === "", "no anthropic key");
  assert(mod.getKey("openai") === "", "no openai key");
  assert(mod.getKey("gemini") === "", "no gemini key");
  assert(mod.getCurrentProvider() === null, "no current provider");
  assert(mod.getActiveByok() === null, "no active byok");
  // model fallback to default
  assert(mod.getModel("anthropic") === "claude-opus-4-7", "anthropic default model");
  assert(mod.getModel("gemini") === "gemini-2.5-pro", "gemini default model");

  // ── [2] set one key — becomes current automatically ─────────────────
  console.log("\n[2] saving the first key makes that provider current");
  mod.setKey("anthropic", "sk-ant-test-1234567890");
  assert(mod.getKey("anthropic") === "sk-ant-test-1234567890", "anthropic key saved");
  assert(mod.getCurrentProvider() === "anthropic", "anthropic becomes current");
  const active1 = mod.getActiveByok();
  assert(active1?.provider === "anthropic", "active byok provider");
  assert(active1?.model === "claude-opus-4-7", "active byok default model");

  // ── [3] add second key — current does NOT change automatically ─────
  console.log("\n[3] adding a second key does not change current");
  mod.setKey("openai", "sk-test-abcdef");
  assert(mod.getKey("openai") === "sk-test-abcdef", "openai key saved");
  assert(mod.getCurrentProvider() === "anthropic", "current still anthropic");

  // ── [4] manually switch current ─────────────────────────────────────
  console.log("\n[4] setCurrentProvider switches active");
  mod.setCurrentProvider("openai");
  assert(mod.getCurrentProvider() === "openai", "current now openai");
  // Trying to switch to a provider without a key is a no-op
  mod.setCurrentProvider("gemini");
  assert(mod.getCurrentProvider() === "openai", "cannot switch to a provider without a key");

  // ── [5] models persist + reject unknown values ──────────────────────
  console.log("\n[5] model selection persists, unknowns rejected");
  mod.setModel("anthropic", "claude-sonnet-4-6");
  assert(mod.getModel("anthropic") === "claude-sonnet-4-6", "anthropic model saved");
  mod.setModel("anthropic", "nonsense-model-id");
  assert(mod.getModel("anthropic") === "claude-sonnet-4-6", "unknown model rejected");

  // ── [6] reload simulation — values survive ──────────────────────────
  console.log("\n[6] survives reload (re-import module against same store)");
  // Bust the module cache without clearing the storage, simulating a page reload.
  const reloaded = await import(`../src/lib/keys?t=${Date.now()}`);
  assert(reloaded.getKey("anthropic") === "sk-ant-test-1234567890", "anthropic key persisted");
  assert(reloaded.getKey("openai") === "sk-test-abcdef", "openai key persisted");
  assert(reloaded.getCurrentProvider() === "openai", "current persisted");
  assert(reloaded.getModel("anthropic") === "claude-sonnet-4-6", "anthropic model persisted");

  // ── [7] clear single key ────────────────────────────────────────────
  console.log("\n[7] clearKey removes the key + drops current if it was that one");
  mod.clearKey("openai"); // openai is current, so current should also clear
  assert(mod.getKey("openai") === "", "openai key cleared");
  assert(mod.getCurrentProvider() === null, "current cleared because openai was current");
  // anthropic key is untouched
  assert(mod.getKey("anthropic") === "sk-ant-test-1234567890", "anthropic key still there");

  // restore openai for the next test
  mod.setKey("openai", "sk-test-abcdef");
  // current was null, so saving promotes openai to current
  assert(mod.getCurrentProvider() === "openai", "saving a key when none is current promotes it");

  // clearing a non-current key leaves current alone
  mod.clearKey("anthropic");
  assert(mod.getKey("anthropic") === "", "anthropic cleared");
  assert(mod.getCurrentProvider() === "openai", "current still openai");

  // ── [8] clearAll wipes everything ───────────────────────────────────
  console.log("\n[8] clearAll wipes all three + models + current");
  mod.setKey("anthropic", "sk-ant-x");
  mod.setKey("gemini", "AIza-x");
  mod.setModel("gemini", "gemini-2.5-flash");
  mod.clearAll();
  assert(mod.getKey("anthropic") === "", "anthropic cleared");
  assert(mod.getKey("openai") === "", "openai cleared");
  assert(mod.getKey("gemini") === "", "gemini cleared");
  assert(mod.getCurrentProvider() === null, "current cleared");
  assert(mod.getModel("gemini") === "gemini-2.5-pro", "gemini model back to default");
  assert(Object.keys(store.snapshot()).length === 0, "storage fully empty");

  console.log("\n# all key-storage checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
