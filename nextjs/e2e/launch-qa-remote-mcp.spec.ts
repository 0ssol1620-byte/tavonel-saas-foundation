const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

/*
  G11 REMOTE-MCP (DECISION-REGISTER S6-09), contract stage.

  Off: the server under test is the one every deployment runs today, with
  TAVONEL_REMOTE_MCP_ENABLED unset, and every remote MCP path is a 404 -- including the consent
  page in a real browser. Pointed at a deployment with PLAYWRIGHT_BASE_URL, this is the
  production posture check.

  On: a second `next start` of the same build with the switch on and a throwaway sealing secret
  (fixture env: the fake Supabase origin, no service role, so no key can authenticate). It
  proves what can be proved without a database: discovery, the nine-tool list, the 401 that
  starts OAuth, registration, and the consent page's signed-out state at three phone widths.
*/

const OFF_PATHS: ReadonlyArray<readonly ["GET" | "POST", string]> = [
  ["POST", "/api/mcp"],
  ["GET", "/api/mcp"],
  ["POST", "/api/mcp/oauth/register"],
  ["POST", "/api/mcp/oauth/authorize"],
  ["POST", "/api/mcp/oauth/token"],
  ["GET", "/.well-known/oauth-protected-resource"],
  ["GET", "/.well-known/oauth-protected-resource/api/mcp"],
  ["GET", "/.well-known/oauth-authorization-server"],
];
const TOOL_NAMES = [
  "list_sources", "list_worlds", "get_world", "search_world", "ask_world",
  "get_object", "get_relation", "get_evidence", "download_package",
];
const LIST = { jsonrpc: "2.0", id: 1, method: "tools/list" };

test("remote MCP is a 404 everywhere while the switch is off", async ({ request, page }) => {
  for (const [method, path] of OFF_PATHS) {
    const response = method === "GET" ? await request.get(path) : await request.post(path, { data: LIST });
    expect(response.status(), `${method} ${path}`).toBe(404);
  }
  const consent = await page.goto("/oauth/authorize?response_type=code");
  expect(consent?.status()).toBe(404);
});

test.describe("remote MCP with the switch on (fixture env)", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!existsSync(resolve(".next/BUILD_ID")), "starts a second server from the local production build");

  let server: ChildProcess | null = null;
  let base = "";

  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    // A port the OS hands out, not a fixed one: other lanes on the same machine run servers too.
    const port = await new Promise<number>((settle) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => settle(free));
      });
    });
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: process.cwd(),
      stdio: "ignore",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "foundation-browser-e2e-anon-key",
        TAVONEL_REMOTE_MCP_ENABLED: "true",
        TAVONEL_REMOTE_MCP_SIGNING_SECRET: randomBytes(32).toString("base64url"),
      },
    });
    let ready = false;
    for (const deadline = Date.now() + 100_000; !ready && Date.now() < deadline;) {
      try {
        ready = (await fetch(`${base}/api/healthz`)).ok;
      } catch {
        // not listening yet
      }
      if (!ready) await new Promise((settle) => setTimeout(settle, 500));
    }
    if (!ready) throw new Error(`the switch-on server did not answer on ${base}`);
    /*
      `next start` preloads every route entry just after it reports ready, and on a slow disk (a
      Windows runner with on-access scanning) that blocks requests for tens of seconds. Spend it
      here, inside the hook's budget: ready means three consecutive quick answers.
    */
    await new Promise((settle) => setTimeout(settle, 5_000));
    for (let quick = 0; quick < 3;) {
      const started = Date.now();
      await fetch(`${base}/api/healthz`);
      quick = Date.now() - started < 1_500 ? quick + 1 : 0;
    }
  });

  test.afterAll(() => {
    server?.kill();
  });

  test("lists exactly the nine read-only tools without a token", async ({ request }) => {
    const response = await request.post(`${base}/api/mcp`, { data: LIST, headers: { accept: "application/json, text/event-stream" } });
    expect(response.status()).toBe(200);
    const { result } = await response.json() as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }> } };
    expect(result.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    for (const tool of result.tools) {
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.name).not.toMatch(/upload|compile|promote|activate|rollback|delete|write|create|update|sync|revoke/);
    }
  });

  test("answers a tool call with no token, or an unknown one, with the 401 that starts OAuth", async ({ request }) => {
    const call = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_worlds", arguments: {} } };
    const anonymous = await request.post(`${base}/api/mcp`, { data: call });
    expect(anonymous.status()).toBe(401);
    expect(anonymous.headers()["www-authenticate"]).toBe(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"`);
    const forged = await request.post(`${base}/api/mcp`, { data: call, headers: { authorization: `Bearer tvnl_live_deadbeef_${"a".repeat(48)}` } });
    expect(forged.status()).toBe(401);
    expect(forged.headers()["www-authenticate"]).toContain('error="invalid_token"');
    const resource = await (await request.get(`${base}/.well-known/oauth-protected-resource/api/mcp`)).json();
    expect(resource).toMatchObject({ resource: `${base}/api/mcp`, authorization_servers: [base] });
    const server = await (await request.get(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(server).toMatchObject({ issuer: base, authorization_endpoint: `${base}/oauth/authorize`, code_challenge_methods_supported: ["S256"] });
    const badCode = await request.post(`${base}/api/mcp/oauth/token`, {
      form: { grant_type: "authorization_code", code: "tvmcp_code_forged", client_id: "tvmcp_client_forged", code_verifier: "v".repeat(43) },
    });
    expect([badCode.status(), (await badCode.json()).error]).toEqual([401, "invalid_client"]);
  });

  test("shows a registered client's consent request and asks a signed-out person to sign in, at three phone widths", async ({ request, page }, testInfo) => {
    const registered = await request.post(`${base}/api/mcp/oauth/register`, {
      data: { client_name: "Fixture agent", redirect_uris: ["https://client.example/oauth/callback"] },
    });
    expect(registered.status()).toBe(201);
    const { client_id } = await registered.json() as { client_id: string };
    const query = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "https://client.example/oauth/callback",
      code_challenge: createHash("sha256").update("v".repeat(43)).digest("base64url"),
      code_challenge_method: "S256",
      state: "fixture-state",
    });
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const response = await page.goto(`${base}/oauth/authorize?${query}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect an AI client.");
      await expect(page.getByText("Fixture agent", { exact: true })).toBeVisible();
      await expect(page.getByText("https://client.example", { exact: true })).toBeVisible();
      // No session in this browser: allowing asks for a sign-in and grants nothing.
      await page.getByRole("button", { name: "Allow read-only access" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in to connect an AI client.");
      await expect(page.getByRole("link", { name: "Sign in in a new tab" })).toBeVisible();
      expect(page.url()).toContain("/oauth/authorize");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${width}`).toBeLessThanOrEqual(0);
      await testInfo.attach(`remote-mcp-consent-${width}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    }
  });
});
