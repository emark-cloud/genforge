#!/usr/bin/env node
// Verifies that the invariants baked into src/lib/system-prompt.ts still
// hold against the local py-genlayer SDK cache. If the SDK ever rewrites
// Address.__eq__, removes inmem_allocate, etc., the system prompt's rules
// would silently drift; this script makes that loud.
//
// Run: pnpm check:sdk-rules
//
// SDK location: `gltest-direct` extracts py-genlayer + its std-lib into
// `~/.cache/gltest-direct/extracted/<gltest-version>/`. The pinned Depends
// hash lives in src/lib/genlayer-version.ts and identifies the py-genlayer
// release (a sibling `runner.json` directory); the std-lib (the actual
// Python code) lives under `py-lib-genlayer-std/<sdk-hash>/genlayer/`.
// We resolve the std-lib dir by globbing — there should be exactly one.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const ROOT = process.env.GLTEST_CACHE ?? join(homedir(), ".cache/gltest-direct/extracted");

const errors = [];
function fail(msg) { errors.push(msg); }

async function readPinnedHash() {
  const src = await readFile(new URL("../src/lib/genlayer-version.ts", import.meta.url), "utf8");
  const m = src.match(/GENLAYER_DEPENDS_HASH\s*=\s*"([a-z0-9]+)"/);
  if (!m) throw new Error("could not parse GENLAYER_DEPENDS_HASH from src/lib/genlayer-version.ts");
  return m[1];
}

async function pickVersionDir() {
  const entries = await readdir(ROOT).catch((e) => {
    throw new Error(`SDK cache root not found at ${ROOT} (set GLTEST_CACHE to override): ${e.message}`);
  });
  const versioned = entries.filter((e) => /^v\d+\.\d+\.\d+/.test(e)).sort().reverse();
  if (versioned.length === 0) throw new Error(`no versioned subdirs under ${ROOT}`);
  return join(ROOT, versioned[0]);
}

async function assertFile(path, asserts) {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text == null) { fail(`missing file: ${path}`); return; }
  for (const { needle, hint } of asserts) {
    const found = needle instanceof RegExp ? needle.test(text) : text.includes(needle);
    if (!found) fail(`${path} — ${hint}`);
  }
}

// Curated source files watched by the reference generator (kept in sync
// with the modules read by scripts/gen_sdk_reference.py — if you change
// one, change the other).
const REF_SOURCES = [
  "_internal/msg.py",
  "gl/vm.py",
  "gl/eq_principle.py",
  "gl/nondet/__init__.py",
  "gl/nondet/web.py",
  "py/types.py",
  "py/storage/__init__.py",
  "py/storage/tree_map.py",
  "py/storage/vec.py",
];

async function checkSdkReference(stdDir, expectedHash) {
  const refPath = new URL("../src/lib/sdk-reference.ts", import.meta.url);
  const src = await readFile(refPath, "utf8").catch(() => null);
  if (src == null) {
    fail(`src/lib/sdk-reference.ts missing — run \`pnpm gen:sdk-reference\``);
    return;
  }
  const m = src.match(/SDK_REFERENCE_HASH\s*=\s*"([a-z0-9]+)"/);
  if (!m) {
    fail(`src/lib/sdk-reference.ts has no SDK_REFERENCE_HASH constant — regenerate`);
    return;
  }
  if (m[1] !== expectedHash) {
    fail(
      `src/lib/sdk-reference.ts pin (${m[1].slice(0, 8)}…) != GENLAYER_DEPENDS_HASH (${expectedHash.slice(0, 8)}…) — run \`pnpm gen:sdk-reference\``,
    );
    return;
  }
  const refStat = await stat(refPath).catch(() => null);
  if (!refStat) return;
  // Freshness: if any curated source has been touched since the reference
  // was generated, the reference is stale.
  let latest = 0;
  for (const rel of REF_SOURCES) {
    const s = await stat(join(stdDir, rel)).catch(() => null);
    if (s && s.mtimeMs > latest) latest = s.mtimeMs;
  }
  if (latest > refStat.mtimeMs) {
    fail(`src/lib/sdk-reference.ts is older than the SDK source — run \`pnpm gen:sdk-reference\``);
  }
}

async function main() {
  const hash = await readPinnedHash();
  const versionDir = await pickVersionDir();

  // 1. Pinned py-genlayer release dir must exist.
  const pinDir = join(versionDir, "py-genlayer", hash);
  const pinStat = await stat(pinDir).catch(() => null);
  if (!pinStat) fail(`pinned py-genlayer hash dir missing: ${pinDir}`);

  // 2. Std-lib dir (single child of py-lib-genlayer-std/).
  const stdParent = join(versionDir, "py-lib-genlayer-std");
  const stdChildren = await readdir(stdParent).catch(() => []);
  if (stdChildren.length !== 1) {
    fail(`expected exactly one py-lib-genlayer-std/<hash> dir, found ${stdChildren.length} at ${stdParent}`);
  }
  const stdDir = stdChildren[0] ? join(stdParent, stdChildren[0], "genlayer") : null;
  if (!stdDir) return;

  // 3. types.py invariants — Address class, __eq__ on bytes, as_hex property.
  await assertFile(join(stdDir, "py/types.py"), [
    { needle: "class Address:", hint: "Address class missing (rule #6, #8, #13 depend on it)" },
    { needle: /def __eq__\(self, r\):[\s\S]{0,200}self\._as_bytes == r\._as_bytes/, hint: "Address.__eq__ no longer compares raw bytes (would invalidate COMMON_BUGS rule #3 wording)" },
    { needle: /def as_hex\(self\)/, hint: "Address.as_hex property missing (fallback path for rule #3 + #6)" },
  ]);

  // 4. storage invariants — @allow_storage + inmem_allocate.
  await assertFile(join(stdDir, "py/storage/__init__.py"), [
    { needle: "'allow_storage'", hint: "@allow_storage no longer exported (rule #2)" },
    { needle: "'inmem_allocate'", hint: "inmem_allocate no longer exported (rule #11)" },
  ]);

  // 5. eq_principle invariants.
  await assertFile(join(stdDir, "gl/eq_principle.py"), [
    { needle: /prompt_non_comparative/, hint: "eq_principle.prompt_non_comparative missing (rule #10, canonical example)" },
  ]);

  // 6. sdk-reference.ts: must exist, must pin the same hash as the SDK, and
  //    must be no older than every curated source file. Drift = run gen.
  await checkSdkReference(stdDir, hash);

  // 7. Output.
  if (errors.length > 0) {
    console.error(`check-genlayer-rules: ${errors.length} drift(s) detected`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`\nSDK version dir:  ${versionDir}`);
    console.error(`Pinned hash:      ${hash}`);
    console.error(`\nIf these are intentional SDK changes, update src/lib/system-prompt.ts (and this script's anchors) accordingly.`);
    process.exit(1);
  }
  console.log(`check-genlayer-rules: ok (${versionDir.split("/").pop()}, pin ${hash.slice(0, 8)}…)`);
}

main().catch((e) => {
  console.error(`check-genlayer-rules: ${e.message}`);
  process.exit(2);
});
