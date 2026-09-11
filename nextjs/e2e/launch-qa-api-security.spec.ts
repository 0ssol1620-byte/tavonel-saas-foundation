const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const collectionId = `collection-${"a".repeat(32)}`;

test("rejects anonymous access to tenant-scoped APIs", async ({ request }) => {
  const probes = [
    request.get("/api/documents"),
    request.get("/api/connections"),
    request.get(`/api/collections/${collectionId}`),
    request.get(`/api/collections/${collectionId}/download`),
    request.post("/api/collections/compile", { data: { documentIds: [crypto.randomUUID(), crypto.randomUUID()] } }),
  ];

  for (const response of await Promise.all(probes)) {
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test("rejects forged API credentials without leaking authorization detail", async ({ request }) => {
  const response = await request.get("/api/documents", {
    headers: { Authorization: `Bearer tvnl_live_deadbeef_${"a".repeat(48)}` },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ code: "API_KEY_INVALID" });
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("fails closed on oversized metadata and unsupported methods", async ({ request }) => {
  const oversized = await request.post("/api/collections/compile", {
    headers: { "Content-Type": "application/json" },
    data: `{"padding":"${"x".repeat(4_097)}"}`,
  });
  expect(oversized.status()).toBe(415);
  expect(await oversized.json()).toEqual({ code: "METADATA_ONLY_ENDPOINT" });
  expect(oversized.headers()["cache-control"]).toContain("no-store");

  const method = await request.post("/api/documents", { data: {} });
  expect(method.status()).toBe(405);
  expect(method.headers()["x-content-type-options"]).toBe("nosniff");
});

test("keeps public contracts non-cacheable where state can change", async ({ request }) => {
  for (const route of ["/api/healthz", "/api/readyz", "/api/export/trust"]) {
    const response = await request.get(route);
    expect([200, 503]).toContain(response.status());
    expect(response.headers()["cache-control"], route).toContain("no-store");
    expect(response.headers()["x-content-type-options"], route).toBe("nosniff");
  }
});

/*
  The MCP bridge, asked to check itself with no credential (stage 2 C18, retrieval lane).

  --doctor is the first thing a customer runs and the only thing they run before anything
  works, so the failure that matters is it reporting healthy when it cannot possibly reach us.
  The exit code is what is asserted, not stdout: the file documents that a setup script, a CI
  job or a support runbook branches on the status rather than grepping the text, and a doctor
  that prints problems and exits 0 is worse than one that says nothing.

  No key, no fixture, no server -- it runs the published file itself, which is also why the
  environment is cleared: a stray key in the developer's own shell would make it pass for the
  wrong reason, and a real base URL would make it a network test.
*/
test("the published MCP bridge refuses to report healthy without a key", async () => {
  const script = fileURLToPath(new URL("../public/developer/tavonel-mcp.mjs", import.meta.url));
  const child = spawnSync(process.execPath, [script, "--doctor"], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, TAVONEL_API_KEY: "", TAVONEL_BASE_URL: "http://127.0.0.1:9" },
  });
  expect(child.error, "the bridge did not run at all").toBeUndefined();
  expect(child.status, `--doctor exited 0 without a key: ${child.stdout}`).not.toBe(0);
});
