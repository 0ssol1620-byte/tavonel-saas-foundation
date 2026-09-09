import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { handleCdrIdentity } from "./cdr-identity-handler";
import { CDR_IDENTITY_PATH } from "./cdr-identity-request";
import { CDR_IDENTITY_AUDIENCE } from "./cdr-workload-identity";
const secret = "fixture-only-identity-secret-32-chars";
function fixture() {
  const timestamp = new Date().toISOString();
  const id = "11111111-1111-4111-8111-111111111111";
  const headers = { "x-tavonel-identity-request-id": id, "x-tavonel-identity-timestamp": timestamp,
    "x-tavonel-identity-signature": createHmac("sha256", secret).update(
      `tavonel.cdr.identity.v1\nPOST\n${CDR_IDENTITY_PATH}\n${CDR_IDENTITY_AUDIENCE}\n${timestamp}\n${id}`).digest("base64url") };
  const deps = { env: { FOUNDATION_CDR_IDENTITY_ENABLED: "1", VERCEL_ENV: "production", FOUNDATION_CDR_IDENTITY_HMAC: secret },
    claim: vi.fn(async () => true), subject: vi.fn(async () => "runtime.subject"), mint: vi.fn(async () => "id.token.fixture") };
  return { headers, deps, request: new Request(`https://tavonel.com${CDR_IDENTITY_PATH}`, { method: "POST", headers }) };
}
it("claims before accessing runtime identity and minting, never caches the result", async () => {
  const { request, deps } = fixture();
  const response = await handleCdrIdentity(request, deps);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ token: "id.token.fixture", audience: CDR_IDENTITY_AUDIENCE });
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(deps.claim.mock.invocationCallOrder[0]).toBeLessThan(deps.subject.mock.invocationCallOrder[0]);
  expect(deps.subject.mock.invocationCallOrder[0]).toBeLessThan(deps.mint.mock.invocationCallOrder[0]);
});
it("rejects unsigned requests before touching DB or runtime identity", async () => {
  const { deps } = fixture();
  const response = await handleCdrIdentity(new Request("https://tavonel.com", { method: "POST" }), deps);
  expect(response.status).toBe(401); expect(deps.claim).not.toHaveBeenCalled(); expect(deps.subject).not.toHaveBeenCalled();
});
it("rejects any request body before claiming", async () => {
  const { headers, deps } = fixture();
  const response = await handleCdrIdentity(new Request("https://tavonel.com", { method: "POST", headers, body: "file" }), deps);
  expect(response.status).toBe(400); expect(deps.claim).not.toHaveBeenCalled();
});
it("accepts runtime empty streams without trusting body object presence", async () => {
  const { headers, deps } = fixture();
  const request = new Request("https://tavonel.com", { method: "POST", headers, body: "" });
  expect(request.body).not.toBeNull();
  expect((await handleCdrIdentity(request, deps)).status).toBe(200);
  expect(deps.claim).toHaveBeenCalledOnce();
});
function streamRequest(body: ReadableStream<Uint8Array>, headers: HeadersInit) {
  return new Request("https://tavonel.com", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}
it.each([false, true])("accepts a closed empty stream (empty chunk %s)", async chunk => {
  const { headers, deps } = fixture();
  const request = streamRequest(new ReadableStream({ start(c) { if (chunk) c.enqueue(new Uint8Array()); c.close(); } }), headers);
  expect((await handleCdrIdentity(request, deps)).status).toBe(200);
});
it("refuses previously consumed content even when its stream is now empty", async () => {
  const { headers, deps } = fixture();
  const request = new Request("https://tavonel.com", { method: "POST", headers, body: "file" });
  await request.text();
  expect((await handleCdrIdentity(request, deps)).status).toBe(400);
  expect(deps.claim).not.toHaveBeenCalled();
});
it("rejects bytes even when Content-Length claims zero", async () => {
  const { headers, deps } = fixture();
  const request = streamRequest(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); c.close(); } }),
    { ...headers, "content-length": "0" });
  expect((await handleCdrIdentity(request, deps)).status).toBe(400);
  expect(deps.claim).not.toHaveBeenCalled(); expect(deps.subject).not.toHaveBeenCalled(); expect(deps.mint).not.toHaveBeenCalled();
});
it("bounds stalled input even when cancellation never settles", async () => {
  vi.useFakeTimers();
  try {
    const { headers, deps } = fixture();
    const request = streamRequest(new ReadableStream({ cancel: () => new Promise(() => undefined) }), headers);
    const pending = handleCdrIdentity(request, deps);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await pending).status).toBe(400);
    expect(deps.claim).not.toHaveBeenCalled(); expect(deps.subject).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
it("refuses endless empty chunks without starving the deadline", async () => {
  const { headers, deps } = fixture();
  const request = streamRequest(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array()); } }), headers);
  expect((await handleCdrIdentity(request, deps)).status).toBe(400);
  expect(deps.claim).not.toHaveBeenCalled();
});
it.each(["errored", "locked"])("refuses %s streams before claiming", async mode => {
  const { headers, deps } = fixture();
  const body = new ReadableStream<Uint8Array>({ start(c) { if (mode === "errored") c.error(new Error("fixture")); } });
  const request = streamRequest(body, headers);
  const lock = mode === "locked" ? request.body!.getReader() : undefined;
  try { expect((await handleCdrIdentity(request, deps)).status).toBe(400); expect(deps.claim).not.toHaveBeenCalled(); }
  finally { lock?.releaseLock(); }
});
it.each(["preview", "development"])("refuses %s runtime", async environment => {
  const { request, deps } = fixture(); deps.env.VERCEL_ENV = environment;
  expect((await handleCdrIdentity(request, deps)).status).toBe(503); expect(deps.claim).not.toHaveBeenCalled();
});
it("stops on replay or issuance limit", async () => {
  const { request, deps } = fixture(); deps.claim.mockResolvedValue(false);
  expect((await handleCdrIdentity(request, deps)).status).toBe(429); expect(deps.subject).not.toHaveBeenCalled();
});
it.each(["claim", "subject", "mint"] as const)("redacts failure in %s", async step => {
  const { request, deps } = fixture(); deps[step].mockRejectedValue(new Error("secret-should-not-leak"));
  const response = await handleCdrIdentity(request, deps);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret-should-not-leak");
  if (step !== "mint") expect(deps.mint).not.toHaveBeenCalled();
});
