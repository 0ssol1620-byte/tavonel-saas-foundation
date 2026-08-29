import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCoreCompile } from "./core-runtime";
import { compileCollectionCandidate, type CollectionOcrInput } from "./collection-compiler";

afterEach(() => vi.unstubAllGlobals());

function inputs(): CollectionOcrInput[] {
  return ["a", "b"].map((letter, index) => {
    const versionKey = letter.repeat(64);
    const documentId = `doc-${index + 1}`;
    const sanitizedKey = `immutable/pilot/pilot/${documentId}/${versionKey}/sanitized.pdf`;
    return { documentId, versionKey, sanitizedKey, ocrJsonKey: sanitizedKey.replace("sanitized.pdf", "ocr.json"), pageCount: 1, text: `Document ${index + 1} security policy evidence is complete.`, inputSha256: `sha256:${versionKey}`, sourceImmutableKey: sanitizedKey };
  });
}

describe("Foundation Core runtime dispatch", () => {
  it("accepts only a completed, digest-bound candidate receipt", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const envelope = JSON.parse(String(init?.body));
      const artifact = compileCollectionCandidate(envelope.documents);
      const outputSha256 = `sha256:${await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(artifact))).then((value) => [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join(""))}`;
      return Response.json({ status: "completed", runtime: "tavonel-foundation-core-deterministic-v1", artifact, receipt: { schemaVersion: "tavonel.compile_receipt.v1", requestId: envelope.requestId, inputSha256: headers.get("x-tavonel-input-sha256"), outputSha256, manifestDigest: artifact.manifestDigest, collectionId: artifact.collectionId, candidatePromotion: false } });
    }));
    const result = await dispatchCoreCompile({ url: "https://core.example", hmac: "x".repeat(32) }, "pilot", inputs());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.receipt.candidatePromotion).toBe(false);
  });

  it("fails closed on a forged output digest", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "completed", runtime: "tavonel-foundation-core-deterministic-v1", artifact: compileCollectionCandidate(inputs()), receipt: { schemaVersion: "tavonel.compile_receipt.v1", requestId: "wrong", outputSha256: `sha256:${"0".repeat(64)}` } })));
    await expect(dispatchCoreCompile({ url: "https://core.example", hmac: "x".repeat(32) }, "pilot", inputs())).resolves.toEqual({ ok: false, code: "CORE_RECEIPT_INVALID" });
  });
});
