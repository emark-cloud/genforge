#!/usr/bin/env node
// Headless audit of the GenForge frontend.
// Visits / and /workspace, captures screenshots at three viewport widths,
// collects console + page errors, and runs structural checks via the
// Playwright locator API.
//
// Run: node scripts/audit-frontend.mjs [baseUrl]
// Requires: dev server running, `npx playwright install chromium` done once.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = resolve(process.cwd(), "audit");

const VIEWPORTS = [
  { name: "wide", width: 1440, height: 900 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "narrow", width: 1023, height: 720 }, // just under the mobile guard
];

const ROUTES = [
  { path: "/", label: "landing" },
  { path: "/workspace", label: "workspace" },
];

const findings = [];
function record(severity, route, msg) {
  findings.push({ severity, route, msg });
}

async function audit(browser, route, viewport) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "no-preference",
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      record("warn", route.label, `[${viewport.name}] console.${m.type()}: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => {
    record("error", route.label, `[${viewport.name}] pageerror: ${e.message}`);
  });
  page.on("requestfailed", (r) => {
    record(
      "warn",
      route.label,
      `[${viewport.name}] requestfailed: ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "unknown"}`,
    );
  });

  const url = BASE + route.path;
  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
  if (!resp || !resp.ok()) {
    record("error", route.label, `HTTP ${resp ? resp.status() : "no response"} at ${url}`);
  }

  await page.waitForTimeout(400); // let reveal cascade settle

  const tag = `${route.label}-${viewport.name}`;
  await page.screenshot({ path: resolve(OUT, `${tag}.png`), fullPage: true });

  if (route.path === "/") await checkLanding(page, viewport, route.label);
  else await checkWorkspace(page, viewport, route.label);

  await checkA11y(page, viewport, route.label);

  await ctx.close();
}

async function checkLanding(page, viewport, label) {
  const wordmark = page.locator("header").getByText(/GenForge/i).first();
  if ((await wordmark.count()) === 0) record("error", label, "wordmark missing from header");

  const h1 = page.locator("h1");
  const h1n = await h1.count();
  if (h1n !== 1) record("error", label, `expected 1 <h1>, found ${h1n}`);
  if (h1n > 0) {
    const box = await h1.first().boundingBox();
    if (box && box.height < 80) {
      record(
        "warn",
        label,
        `[${viewport.name}] hero <h1> only ${Math.round(box.height)}px tall — landing hero should feel oversized`,
      );
    }
  }

  // 'Open workspace' CTAs — there should be one violet (hero) and one ghost
  // (header). The violet one is identified by the `bg-accent` class.
  const ctas = page.getByRole("link", { name: /Open workspace/i });
  const ctaCount = await ctas.count();
  if (ctaCount < 1) {
    record("error", label, "no 'Open workspace' link found");
  } else {
    let violetCount = 0;
    for (let i = 0; i < ctaCount; i++) {
      const cls = (await ctas.nth(i).getAttribute("class")) ?? "";
      const href = await ctas.nth(i).getAttribute("href");
      if (cls.includes("bg-accent")) violetCount++;
      if (href !== "/workspace") {
        record("error", label, `'Open workspace' link href is '${href}', expected '/workspace'`);
      }
    }
    if (violetCount !== 1) {
      record(
        "warn",
        label,
        `expected exactly 1 violet 'Open workspace' CTA (DESIGN 'one accent per surface' rule); found ${violetCount} with bg-accent`,
      );
    }
  }

  const src = page.getByRole("link", { name: /View source|github/i });
  if ((await src.count()) === 0) {
    record("warn", label, "no GitHub/source link found on landing");
  }

  const debugCard = page.locator("article").filter({ hasText: /Debug/ }).first();
  const genCard = page.locator("article").filter({ hasText: /Generate/ }).first();
  if ((await debugCard.count()) === 0) record("error", label, "Debug feature card missing");
  if ((await genCard.count()) === 0) record("error", label, "Generate feature card missing");

  const footer = page.locator("footer");
  if ((await footer.count()) === 0) record("warn", label, "no <footer>");
}

async function checkWorkspace(page, viewport, label) {
  if (viewport.width < 1024) {
    const notice = page.getByText(/best on a wider screen/i);
    if ((await notice.count()) === 0) {
      record(
        "error",
        label,
        `[${viewport.name}] expected mobile notice below 1024px, not found`,
      );
    }
    return;
  }

  const wordmark = page.locator("header").getByText(/GenForge/i);
  if ((await wordmark.count()) === 0) record("error", label, "wordmark missing from workspace topbar");

  const debugTab = page.getByRole("tab", { name: /Debug/i });
  const genTab = page.getByRole("tab", { name: /Generate/i });
  if ((await debugTab.count()) === 0) record("error", label, "Debug tab missing");
  if ((await genTab.count()) === 0) record("error", label, "Generate tab missing");

  const fix = page.getByRole("button", { name: /^Fix$/ });
  if ((await fix.count()) === 0) record("error", label, "Fix CTA missing on Debug tab");

  const monaco = page.locator(".monaco-editor");
  if ((await monaco.count()) === 0) {
    record("warn", label, "Monaco editor root not detected — may still be hydrating");
  }

  // Switch to Generate and back.
  if ((await genTab.count()) > 0) {
    await genTab.first().click();
    await page.waitForTimeout(200);
    const genBtn = page.getByRole("button", { name: /^Generate$/ });
    if ((await genBtn.count()) === 0) {
      record("error", label, "Generate CTA not shown after switching tabs");
    }
    if ((await debugTab.count()) > 0) await debugTab.first().click();
  }
}

async function checkA11y(page, viewport, label) {
  // Links with no accessible name.
  const links = await page.locator("a").all();
  for (const a of links) {
    const text = (await a.textContent())?.trim() ?? "";
    const aria = (await a.getAttribute("aria-label")) ?? "";
    const href = (await a.getAttribute("href")) ?? "";
    if (!text && !aria) {
      record("warn", label, `[${viewport.name}] anchor with no accessible name (href=${href})`);
    }
  }

  // Buttons with no accessible name.
  const buttons = await page.locator("button").all();
  for (const b of buttons) {
    const text = (await b.textContent())?.trim() ?? "";
    const aria = (await b.getAttribute("aria-label")) ?? "";
    const title = (await b.getAttribute("title")) ?? "";
    if (!text && !aria && !title) {
      record("warn", label, `[${viewport.name}] button with no accessible name`);
    }
  }

  // Focus ring sanity — Tab once, confirm the focused element matches
  // :focus-visible (the rule that paints the violet halo).
  await page.keyboard.press("Tab");
  const focusVisible = page.locator(":focus-visible");
  const count = await focusVisible.count();
  if (count === 0) {
    record(
      "warn",
      label,
      `[${viewport.name}] no element matches :focus-visible after first Tab — focus ring may not paint`,
    );
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const route of ROUTES) {
      for (const vp of VIEWPORTS) {
        await audit(browser, route, vp);
      }
    }

    const errors = findings.filter((f) => f.severity === "error");
    const warns = findings.filter((f) => f.severity === "warn");
    let md = `# GenForge frontend audit\n\n`;
    md += `Base URL: \`${BASE}\`\n\n`;
    md += `**Result:** ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warns.length} warning${warns.length === 1 ? "" : "s"}\n\n`;
    if (errors.length) {
      md += `## Errors\n\n`;
      for (const f of errors) md += `- **${f.route}** — ${f.msg}\n`;
      md += `\n`;
    }
    if (warns.length) {
      md += `## Warnings\n\n`;
      for (const f of warns) md += `- **${f.route}** — ${f.msg}\n`;
      md += `\n`;
    }
    md += `## Screenshots\n\n`;
    for (const route of ROUTES) {
      for (const vp of VIEWPORTS) {
        md += `- \`${route.label}-${vp.name}\` → \`audit/${route.label}-${vp.name}.png\`\n`;
      }
    }

    await writeFile(resolve(OUT, "report.md"), md, "utf8");
    process.stdout.write(md);
    process.exitCode = errors.length > 0 ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
