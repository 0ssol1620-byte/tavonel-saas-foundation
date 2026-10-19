import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkContentDigest, runKeylessRead } from "./keyless-read";
import { GET as sampleWorld } from "../app/reproducibility/sample-world/route";

/*
  The digest check the keyless try-it runs in the browser (EN-4), against a mocked fetch.

  Three outcomes and no fourth: the header matches the bytes, it does not, or there is no header.
  A request that never produced a response is not a digest outcome at all -- it is the error the
  try-it already had -- and is pinned here so it cannot be mistaken for "absent".
*/

const digestOf = (bytes: Uint8Array | string) => `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`;

function fetchReturning(body: BodyInit, headers: Record<string, string> = {}, status = 200) {
  return vi.fn(async () => new Response(body, { status, headers }));
}

describe("checkContentDigest", () => {
  const body = new TextEncoder().encode('{"ok":true}\n');

  it("matches when the header is the SHA-256 of the exact bytes", async () => {
    expect(await checkContentDigest(body.buffer, ` ${digestOf(body)} `)).toEqual({ state: "match", value: digestOf(body) });
  });

  it("is a mismatch, carrying both values, when it is not", async () => {
    const served = digestOf("other bytes");
    expect(await checkContentDigest(body.buffer, served)).toEqual({ state: "mismatch", served, computed: digestOf(body) });
  });

  it("treats a header naming only an algorithm it cannot check as a mismatch, never a pass", async () => {
    const check = await checkContentDigest(body.buffer, "sha-512=:AAAA:");
    expect(check.state).toBe("mismatch");
  });

  it.each([null, "", "   "])("is absent when the header is %j", async (header) => {
    expect(await checkContentDigest(body.buffer, header)).toEqual({ state: "absent" });
  });
});

describe("runKeylessRead", () => {
  it("matches the real /reproducibility/sample-world response", async () => {
    const read = await runKeylessRead("/reproducibility/sample-world", vi.fn(async () => sampleWorld()));
    expect("error" in read).toBe(false);
    if ("error" in read) return;
    expect(read.status).toBe(200);
    expect(read.digest.state).toBe("match");
    expect(read.body).toContain('"disclosure": "deterministic_product_sample_not_customer_proof"');
  });

  it("reports a mismatch when the served header describes other bytes", async () => {
    const fetchImpl = fetchReturning('{"objects":[]}', { "content-digest": digestOf('{"objects":[1]}') });
    const read = await runKeylessRead("/reproducibility/sample-world", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/reproducibility/sample-world", { headers: { accept: "application/json" } });
    expect("error" in read ? null : read.digest.state).toBe("mismatch");
  });

  it("reports absent when the response sends no header, as /api/status does", async () => {
    const read = await runKeylessRead("/api/status", fetchReturning('{"customerData":{"enabled":false}}'));
    expect("error" in read ? null : read.digest).toEqual({ state: "absent" });
  });

  it("hashes the bytes received, not a decoded and re-encoded string", async () => {
    // 0xff is not UTF-8: decoding turns it into U+FFFD, which re-encodes as three other bytes.
    const bytes = new Uint8Array([0x7b, 0x7d, 0xff, 0x0a]);
    const read = await runKeylessRead("/x", fetchReturning(bytes, { "content-digest": digestOf(bytes) }));
    expect("error" in read ? null : read.digest.state).toBe("match");
    expect("error" in read ? null : read.bytes).toBe(4);
  });

  it("shows a body that is not JSON verbatim, and states a truncation", async () => {
    const read = await runKeylessRead("/x", fetchReturning(`plain ${"x".repeat(5_000)}`));
    if ("error" in read) throw new Error(read.error);
    expect(read.body.startsWith("plain x")).toBe(true);
    expect(read.body).toMatch(/truncated at 4,000 characters\. Fetch the URL for the whole body\.$/);
  });

  it("is an error, not a digest outcome, when the request never completes", async () => {
    const read = await runKeylessRead("/api/status", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(read).toEqual({ error: "Failed to fetch" });
  });
});
