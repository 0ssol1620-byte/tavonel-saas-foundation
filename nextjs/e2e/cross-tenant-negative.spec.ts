/**
 * S07 (fixture-only) — the attack-shaped half of tenant isolation that a browser can reach.
 *
 * What already exists, and what it proves. `lib/tenant-isolation-negative.test.ts` probes the
 * Ask, export, evidence-lens and MCP handlers with another workspace's collection id through the
 * path, the query and a header, and asserts the store is always called with the caller's own
 * workspace -- contract tests, with no Postgres and no R2. `supabase/tests/tenant_rls_matrix.sql`
 * proves the store's own scoping under `supabase db test`. Read together they cover the hop.
 *
 * What neither covers, and this file adds: the deployed HTTP surface. Every tenant-scoped route,
 * asked for a *foreign* collection id over the wire, must refuse — and must refuse **the same
 * way it refuses an id that does not exist**. A different status or a different body for the two
 * is an existence oracle: it tells an attacker which ids are real in someone else's workspace
 * without ever returning their data.
 *
 * What this file cannot do, and does not pretend to. It runs against a server with no database
 * and no object store, so every request here is refused at the credential boundary. It therefore
 * proves that no tenant-scoped route is reachable without a live credential and that the
 * refusals carry nothing, and it proves nothing about two real tenants' rows. The live
 * attack pass — two consented accounts, a real signed R2 URL replayed after revocation, a real
 * key scoped to A used against B — is explicitly out of scope for this campaign and stays open
 * in the lane report.
 */

import { test, expect } from "@playwright/test";

/** Workspace B's collection, and an id that belongs to nobody. Same shape, so the router treats
 *  them identically and only authorization can tell them apart. */
const FOREIGN_COLLECTION = `collection-${"b".repeat(32)}`;
const UNKNOWN_COLLECTION = `collection-${"f".repeat(32)}`;
const FORGED_KEY = `tvnl_live_deadbeef_${"a".repeat(48)}`;

const readPaths = (collectionId: string) => [
  `/api/collections/${collectionId}`,
  `/api/collections/${collectionId}/download`,
  `/api/collections/${collectionId}/world`,
  // The v1 surface the MCP bridge in public/developer/tavonel-mcp.mjs calls.
  `/api/v1/collections/${collectionId}`,
  `/api/v1/collections/${collectionId}/download`,
  `/api/v1/collections/${collectionId}/world`,
  `/api/v1/world/${collectionId}`,
  `/api/v1/world/${collectionId}/evidence`,
  /*
    The retrieval lane's surfaces, requested at integration (stage 2 C18). Added to THIS list
    rather than given a spec of their own so they inherit every assertion the file already
    makes: anonymous is 401, a forged key is 401 and never 200, a foreign id and an id
    belonging to nobody are indistinguishable, no refusal leaks a URL or a digest, and every
    refusal is uncacheable.

    The paginated reads are listed WITH their parameters because authorization is checked
    before limit and cursor are parsed. That order is the assertion: supplying them must not
    reorder the two and turn a validation 400 into a probe of whether a workspace exists.
  */
  "/api/v1/collections",
  "/api/v1/collections?limit=2&cursor=collection-" + "a".repeat(32),
  `/api/v1/world/${collectionId}/objects?limit=2`,
  `/api/v1/world/${collectionId}/relations?limit=2&cursor=relation-1`,
  "/api/v1/documents",
  "/api/v1/connections",
  "/api/v1/reviews",
];

const writePaths = (collectionId: string) => [
  { path: `/api/collections/${collectionId}/ask`, data: { question: "what changed" } },
  { path: `/api/collections/${collectionId}/search`, data: { query: "revenue" } },
  { path: `/api/collections/${collectionId}/promote`, data: {} },
  { path: `/api/v1/collections/${collectionId}/ask`, data: { question: "what changed" } },
  { path: `/api/v1/collections/${collectionId}/search`, data: { query: "revenue" } },
  { path: `/api/v1/world/${collectionId}/ask`, data: { question: "what changed" } },
  // Builds a retrieval index. The owner-or-admin gate behind it needs a real member
  // credential and is covered in lib/retrieval-compile-wiring.test.ts; what belongs here is
  // that an uncredentialed caller never reaches that gate at all.
  { path: `/api/v1/collections/${collectionId}/retrieval-index`, data: {} },
];

/** A refusal may carry a code. It may not carry a URL, an object key, a digest or a credential. */
function assertNoLeak(body: string, where: string) {
  for (const forbidden of ["http://", "https://", "immutable/", "quarantine/", "sha256:", "tvnl_", "X-Amz-"]) {
    expect(body.includes(forbidden), `${where} refusal leaked "${forbidden}": ${body.slice(0, 200)}`).toBe(false);
  }
}


test("no tenant-scoped read is reachable without a credential, whoever the id belongs to", async ({ request }) => {
  for (const path of readPaths(FOREIGN_COLLECTION)) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
    expect(await response.json(), path).toEqual({ code: "AUTH_REQUIRED" });
    expect(response.headers()["cache-control"], path).toContain("no-store");
    assertNoLeak(await response.text(), path);
  }
});

test("every refusal is uncacheable", async ({ request }) => {
  /*
    Fixed at integration (stage 2 C9): /api/v1/reviews sends no-store on all eighteen of its
    early returns, through one `refuse` helper so a nineteenth cannot omit it. The exemption
    this file carried for the route is gone from the test above as well.
  */
  const response = await request.get("/api/v1/reviews");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");
});

test("a credential that is not this tenant's is refused on every read, and never with a 200", async ({ request }) => {
  for (const path of readPaths(FOREIGN_COLLECTION)) {
    const response = await request.get(path, { headers: { Authorization: `Bearer ${FORGED_KEY}` } });
    expect(response.status(), path).toBe(401);
    /*
      Two codes, because two auth paths. Routes that accept a `tvnl_` API key report
      API_KEY_INVALID; `/api/v1/reviews` accepts only a workspace session and so never gets as
      far as validating a key, reporting AUTH_REQUIRED. Both are refusals that name nothing
      about the target; what is asserted is that neither is a 200 and neither carries data.
    */
    expect(["API_KEY_INVALID", "AUTH_REQUIRED"], path).toContain((await response.json()).code);
    assertNoLeak(await response.text(), path);
  }
});

test("a foreign id and an unknown id are refused identically, so nothing answers 'this exists'", async ({ request }) => {
  const foreign = readPaths(FOREIGN_COLLECTION);
  const unknown = readPaths(UNKNOWN_COLLECTION);
  for (let index = 0; index < foreign.length; index += 1) {
    const credentials: Record<string, string>[] = [{}, { Authorization: `Bearer ${FORGED_KEY}` }];
    for (const headers of credentials) {
      const [a, b] = await Promise.all([
        request.get(foreign[index], { headers }),
        request.get(unknown[index], { headers }),
      ]);
      expect(a.status(), foreign[index]).toBe(b.status());
      expect(await a.text(), `${foreign[index]} vs ${unknown[index]}`).toBe(await b.text());
    }
  }
});

test("no tenant-scoped write accepts a foreign collection id", async ({ request }) => {
  for (const { path, data } of writePaths(FOREIGN_COLLECTION)) {
    const response = await request.post(path, { data });
    expect(response.status(), path).not.toBe(200);
    expect([401, 403, 404, 405], `${path} answered ${response.status()}`).toContain(response.status());
    assertNoLeak(await response.text(), path);
  }
});

test("a download refusal hands back no URL to replay, and replaying the request changes nothing", async ({ request }) => {
  const path = `/api/v1/collections/${FOREIGN_COLLECTION}/download`;
  const first = await request.get(path, { headers: { Authorization: `Bearer ${FORGED_KEY}` } });
  const second = await request.get(path, { headers: { Authorization: `Bearer ${FORGED_KEY}` } });

  expect(first.status()).toBe(401);
  expect(second.status()).toBe(first.status());
  expect(await second.text()).toBe(await first.text());
  // Nothing to replay: no redirect, no presigned URL in the body.
  expect(first.headers()["location"]).toBeUndefined();
  assertNoLeak(await first.text(), path);
});

test("the one route that is public by design carries no tenant data", async ({ request }) => {
  // /api/v1/capabilities is the manifest, and it answers 200 without a credential on purpose.
  // What it must never do is carry a workspace, a document or a collection id.
  const response = await request.get("/api/v1/capabilities");
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body.includes("collection-"), "the capability manifest names a collection").toBe(false);
  expect(body.includes("immutable/"), "the capability manifest names an object key").toBe(false);
  expect(/\bws-[0-9a-f]{8}/.test(body), "the capability manifest names a workspace").toBe(false);
});
