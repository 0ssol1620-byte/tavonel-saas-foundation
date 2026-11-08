/**
 * W1-A1 QA for the Connect AI panel and the OAuth consent page, against a local `next start`
 * of the fixture build with the remote MCP on (shadow-common.mjs).
 *
 *   node scripts/remote-mcp/connect-ai-qa.mjs --out <dir>      (run from nextjs/, after `next build`)
 *
 * Widths 360/390/412/430 in chromium and webkit (webkit with reduced motion and explicit
 * timeouts), 1024 and 1440 in chromium. Per page: horizontal overflow (find-overflow.mjs's
 * measure), axe-core violations, a screenshot. Keyboard only: the panel's assistant choice by
 * arrow keys, and the consent page from first Tab to the client's redirect with a code.
 *
 * axe-core is not a repository dependency: it is fetched once from cdnjs at a pinned version, its
 * sha256 recorded, and injected into a context that bypasses CSP for that purpose only.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "@playwright/test";
import { USERS, http, pkce, startShadow } from "./shadow-common.mjs";

const out = process.argv[process.argv.indexOf("--out") + 1];
if (!process.argv.includes("--out") || !out) throw new Error("usage: node scripts/remote-mcp/connect-ai-qa.mjs --out <dir>");
const root = resolve(import.meta.dirname, "../..");
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const shots = join(out, `connect-ai-qa-${commit.slice(0, 12)}`);
mkdirSync(shots, { recursive: true });

const AXE_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js";
const axeSource = await (await fetch(AXE_URL)).text();
const axeSha256 = `sha256:${createHash("sha256").update(axeSource).digest("hex")}`;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const user = { id: USERS.a.id, aud: "authenticated", role: "authenticated", email: "qa@shadow.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const jwt = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.qa-signature`;

async function workspaceFixture(page) {
  await page.addInitScript(({ jwt: token, user: who }) => localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fixture-not-valid", user: who })), { jwt, user });
  await page.route("https://test.supabase.co/**", (route) => route.fulfill({ json: user }));
  await page.route("**/api/access/bootstrap", (route) => route.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null, customerDataEnabled: true } } }));
  await page.route("**/api/compile-jobs", (route) => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/billing/status", (route) => route.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: [] } }));
}

const overflow = (page) => page.evaluate(() => {
  const win = window.innerWidth;
  const wide = [...document.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().width > win + 1)
    .slice(0, 10).map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`);
  return { innerWidth: win, scrollWidth: document.documentElement.scrollWidth, wide };
});
async function axe(page, include) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (selector) => {
    const result = await window.axe.run(selector ? { include: [selector] } : document, { resultTypes: ["violations"] });
    return result.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }));
  }, include);
}

const shadow = await startShadow();
const { base } = shadow;
const runs = [];
try {
  const matrix = [
    ...[360, 390, 412, 430].flatMap((width) => [["chromium", width], ["webkit", width]]),
    ["chromium", 1024], ["chromium", 1440],
  ];
  const engines = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  for (const [engine, width] of matrix) {
    const context = await engines[engine].newContext({
      viewport: { width, height: width < 900 ? 900 : 900 }, bypassCSP: true,
      reducedMotion: engine === "webkit" ? "reduce" : "no-preference",
    });
    context.setDefaultTimeout(engine === "webkit" ? 45_000 : 30_000);
    const page = await context.newPage();
    const run = { engine, width };
    try {
      /* ------------------------------------------------------------ panel */
      await workspaceFixture(page);
      // The first visit of a cold `next start` can outlast one timeout; one retry, counted.
      await page.goto(`${base}/workspace/ask`, { waitUntil: "domcontentloaded" }).catch(async () => {
        run.gotoRetried = true;
        await page.goto(`${base}/workspace/ask`, { waitUntil: "domcontentloaded" });
      });
      const panel = page.getByTestId("connect-ai-panel");
      await panel.waitFor({ state: "visible" });
      await panel.getByText(`${base}/api/mcp`).waitFor();
      run.panelAvailable = await panel.getByLabel("MCP URL").isVisible();
      run.panelOverflow = await overflow(page);
      run.panelAxe = await axe(page, "[data-testid=connect-ai-panel]");
      // Keyboard: focus the Claude radio, arrow to ChatGPT, the steps follow.
      await panel.getByRole("radio", { name: "Add to Claude" }).focus();
      await page.keyboard.press("ArrowRight");
      run.panelKeyboard = {
        chatgptChecked: await panel.getByRole("radio", { name: "Add to ChatGPT" }).isChecked(),
        stepsFollow: await panel.getByRole("list", { name: "Add to ChatGPT steps" }).isVisible(),
      };
      await panel.screenshot({ path: join(shots, `panel-${engine}-${width}.png`) });

      /* ---------------------------------------------------------- consent */
      // Port 1 is on the browsers' restricted-port list (WebKit refuses it before routing); 65534 is not.
      const callback = `http://127.0.0.1:${new URL(base).port === "65534" ? 65533 : 65534}/qa-callback`;
      const registered = await http(base, "POST", "/api/mcp/oauth/register", { json: { client_name: "QA client", redirect_uris: [callback] } });
      const { challenge } = pkce();
      const query = new URLSearchParams({ response_type: "code", client_id: registered.json.client_id, redirect_uri: callback, code_challenge: challenge, code_challenge_method: "S256", state: `qa-${engine}-${width}`, resource: `${base}/api/mcp` });
      let landed = null;
      await page.route(`${callback}**`, (route) => { landed = route.request().url(); return route.fulfill({ status: 200, contentType: "text/html", body: "<title>callback</title>" }); });
      await page.goto(`${base}/oauth/authorize?${query}`, { waitUntil: "domcontentloaded" });
      const allow = page.getByRole("button", { name: "Allow read-only access" });
      await allow.waitFor();
      run.consentOverflow = await overflow(page);
      run.consentAxe = await axe(page, null);
      await page.screenshot({ path: join(shots, `consent-${engine}-${width}.png`), fullPage: true });
      /*
        Keyboard only: Tab from the top of the page until Allow has focus, then Enter. WebKit follows
        Safari, where Tab reaches form fields only and Option+Tab (Alt+Tab here) reaches buttons and
        links; if Tab never lands on Allow, the run retries with Alt+Tab and records which key it took.
      */
      const tabTo = async (key) => {
        await page.locator("body").focus();
        for (let count = 1; count <= 40; count += 1) {
          await page.keyboard.press(key);
          if (await allow.evaluate((element) => element === document.activeElement)) return count;
        }
        return null;
      };
      let key = "Tab";
      let tabs = await tabTo(key);
      if (tabs === null) { key = "Alt+Tab"; tabs = await tabTo(key); }
      if (tabs === null) throw new Error("keyboard focus never reached Allow");
      await page.keyboard.press("Enter");
      await page.waitForURL(`${callback}**`);
      const back = landed ? new URL(landed) : null;
      run.consentKeyboard = { key, pressesToAllow: tabs, redirected: Boolean(back), code: Boolean(back?.searchParams.get("code")?.startsWith("tvmcp_code_")), state: back?.searchParams.get("state") === `qa-${engine}-${width}`, iss: back?.searchParams.get("iss") === base };
      run.pass = run.panelAvailable && run.panelOverflow.scrollWidth <= run.panelOverflow.innerWidth && run.panelAxe.length === 0
        && run.panelKeyboard.chatgptChecked && run.panelKeyboard.stepsFollow
        && run.consentOverflow.scrollWidth <= run.consentOverflow.innerWidth && run.consentAxe.length === 0
        && run.consentKeyboard.code && run.consentKeyboard.state && run.consentKeyboard.iss;
    } catch (error) {
      run.error = String(error instanceof Error ? error.message : error).slice(0, 400);
      run.pass = false;
      await page.screenshot({ path: join(shots, `error-${engine}-${width}.png`), fullPage: true }).catch(() => {});
    }
    runs.push(run);
    await context.close();
  }
  await engines.chromium.close();
  await engines.webkit.close();
} finally {
  await shadow.stop();
}
const receipt = {
  schemaVersion: "tavonel.connect_ai_qa.v1", generatedAt: new Date().toISOString(), commit,
  buildId: readFileSync(join(root, ".next/BUILD_ID"), "utf8").trim(),
  harnessSha256: `sha256:${createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex")}`,
  axe: { url: AXE_URL, sha256: axeSha256 },
  screenshots: shots, runs,
  passed: runs.filter((run) => run.pass).length, total: runs.length,
};
const path = join(out, `CONNECT-AI-QA-${commit.slice(0, 12)}.json`);
writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ path, passed: receipt.passed, total: receipt.total, failures: runs.filter((run) => !run.pass).map((run) => ({ engine: run.engine, width: run.width, error: run.error, panelAxe: run.panelAxe, consentAxe: run.consentAxe, overflow: [run.panelOverflow, run.consentOverflow] })) }, null, 2));
