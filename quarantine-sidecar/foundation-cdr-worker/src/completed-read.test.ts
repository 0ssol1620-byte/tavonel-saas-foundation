import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dispatchOcrAfterSanitize, OcrEvidenceRetryableError, type OcrDispatchEnv } from "./ocr";
import { dispatchComputeSettlement } from "./settlement";
import { sha256DigestHeader } from "./hmac";
import { parseCompletedReadFacts, parseReaderBinding, readerBindingSha256 } from "../../../shared/completedReadReceipt";

const encoder = new TextEncoder();
const ws = "pilot-readproof";
const doc = "12345678-1234-4123-8123-123456789abc";
const pdf = encoder.encode("synthetic sanitized PDF only");
const endpoint = "https://foundation-ocr.example/v1/ocr";
const binding = { schemaVersion: "tavonel.qualified_reader_binding.v1" as const, endpoint,
  readerRevision: `sha256:${"a".repeat(64)}`, qualificationSha256: `sha256:${"b".repeat(64)}` };

function providerResponse(value: unknown, url = endpoint, redirected = false, revision?: string) {
  const response = Response.json(value, { headers: revision === undefined ? {} : { "x-tavonel-reader-revision": revision } });
  Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });
  return response;
}

function payload(inputSha256: string, sourceImmutableKey: string) {
  return { schemaVersion: "tavonel.ocr_result.v2", status: "ok", text: "synthetic", pageCount: 1,
    inputSha256, sourceImmutableKey, regions: [{ regionId: "p1", pageIndex0: 0, pageNumber1: 1,
      order: 0, blockType: "paragraph", text: "synthetic", bbox1000: [0, 0, 100, 100], confidence: 1, authority: "unknown" }] };
}

async function fixture(enabled = true) {
  const sanitizedSha256 = await sha256DigestHeader(pdf);
  const key = `immutable/${ws}/${ws}/${doc}/${sanitizedSha256.slice(7)}/sanitized.pdf`;
  const ocrKey = key.replace("sanitized.pdf", "ocr.json");
  const objects = new Map([[key, pdf]]);
  let calls = 0;
  const env: OcrDispatchEnv = { FOUNDATION_OCR_URL: endpoint, FOUNDATION_R2_BUCKET: "foundation-quarantine",
    FOUNDATION_COMPLETED_READ_ENABLED: enabled ? "true" : undefined,
    FOUNDATION_COMPLETED_READ_BINDING: JSON.stringify(binding), FOUNDATION_QUARANTINE: {
      get: async key => { const bytes = objects.get(key); return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } : null; },
      put: async (key, value) => { objects.set(key, new Uint8Array(value)); return {}; },
    } };
  const fetcher = (async (_url, init) => { calls++; if (enabled) assert.equal(init?.redirect, "error");
    return providerResponse(payload(sanitizedSha256, key)); }) as typeof fetch;
  const run = () => dispatchOcrAfterSanitize(env, key, fetcher);
  const proof = async () => {
    const result = await run();
    return parseCompletedReadFacts({ schemaVersion: "tavonel.completed_read.v1", workspaceKey: ws, documentId: doc,
      originalKey: `quarantine/${ws}/${doc}/source`, originalSha256: `sha256:${"c".repeat(64)}`,
      sanitizedKey: key, sanitizedSha256, ocrKey, ocrSha256: result.outputSha256,
      observedPageCount: result.observedPageCount, readerRevision: result.readerRevision, readerBindingSha256: result.readerBindingSha256 })!;
  };
  return { env, objects, key, ocrKey, sanitizedSha256, run, proof, calls: () => calls };
}

describe("completed read persisted OCR boundary", () => {
  it("rejects redirected, foreign, absent and conflicting provider provenance before persistence", async () => {
    for (const mode of ["redirect", "foreign", "absent", "malformedUrl", "redirectStatus", "header", "body", "null", "binding", "stream"]) {
      const f = await fixture();
      const p = payload(f.sanitizedSha256, f.key);
      const bad = `sha256:${"f".repeat(64)}`;
      let response = providerResponse(mode === "body" ? { ...p, readerRevision: bad }
        : mode === "null" ? { ...p, readerRevision: null }
        : mode === "binding" ? { ...p, readerBindingSha256: bad } : p,
        mode === "foreign" ? endpoint + "/other" : mode === "absent" ? "" : mode === "malformedUrl" ? "%" : endpoint,
        mode === "redirect", mode === "header" ? bad : undefined);
      if (mode === "stream") {
        response = new Response(JSON.stringify({ ...p, readerRevision: bad }) + "\n",
          { headers: { "content-type": "application/x-ndjson" } });
        Object.defineProperty(response, "url", { value: endpoint });
      }
      if (mode === "redirectStatus") {
        response = new Response(JSON.stringify(p), { status: 302 });
        Object.defineProperty(response, "url", { value: endpoint });
      }
      await assert.rejects(() => dispatchOcrAfterSanitize(f.env, f.key, async (_url, init) => {
        assert.equal(init?.redirect, "error"); return response;
      }), OcrEvidenceRetryableError);
      assert.equal(f.objects.has(f.ocrKey), false);
    }
  });
  it("accepts matching optional provider revision without replacing the qualified binding", async () => {
    const f = await fixture();
    const result = await dispatchOcrAfterSanitize(f.env, f.key, async () =>
      providerResponse({ ...payload(f.sanitizedSha256, f.key), readerRevision: binding.readerRevision },
        endpoint, false, binding.readerRevision));
    assert.equal(result.readerRevision, binding.readerRevision);
  });
  it("digests durable bytes on fresh read and crash replay without another provider call", async () => {
    const f = await fixture();
    const first = await f.proof();
    const persisted = f.objects.get(f.ocrKey)!;
    assert.equal(first.ocrSha256, await sha256DigestHeader(persisted));
    assert.equal(first.readerRevision, binding.readerRevision);
    assert.equal(first.readerBindingSha256, await readerBindingSha256(binding));
    // Simulates death after OCR persistence and before settlement.
    assert.deepEqual(await f.proof(), first);
    assert.equal(f.calls(), 1);
  });
  it("validates legacy objects but never invents their revision", async () => {
    const f = await fixture(false);
    f.objects.set(f.ocrKey, encoder.encode(JSON.stringify(payload(f.sanitizedSha256, f.key))));
    const old = await f.run();
    assert.equal(old.status, "exists");
    assert.equal(old.readerRevision, undefined);
    assert.equal(f.calls(), 0);
    f.env.FOUNDATION_COMPLETED_READ_ENABLED = "true";
    await assert.rejects(f.run, OcrEvidenceRetryableError);
    assert.equal(f.calls(), 0);
  });
  it("rejects malformed, wrong-source and wrong-input existing winners", async () => {
    for (const mutate of [() => "{}", (p: ReturnType<typeof payload>) => JSON.stringify({ ...p, sourceImmutableKey: "foreign" }),
      (p: ReturnType<typeof payload>) => JSON.stringify({ ...p, inputSha256: `sha256:${"d".repeat(64)}` })]) {
      const f = await fixture();
      f.objects.set(f.ocrKey, encoder.encode(mutate(payload(f.sanitizedSha256, f.key))));
      assert.equal((await f.run()).reasonCode, "OCR_PERSISTED_RESULT_INVALID");
      assert.equal(f.calls(), 0);
    }
  });
  it("validates thrown-conflict and null-return winners rather than the response candidate", async () => {
    for (const thrown of [false, true]) {
      const f = await fixture();
      f.env.FOUNDATION_QUARANTINE.put = async (key) => {
        f.objects.set(key, encoder.encode(JSON.stringify({ ...payload(f.sanitizedSha256, f.key), inputSha256: `sha256:${"d".repeat(64)}` })));
        if (thrown) throw new Error("precondition conflict");
        return null;
      };
      assert.equal((await f.run()).reasonCode, "OCR_PERSISTED_RESULT_INVALID");
    }
  });
  it("digests the valid conflict winner's actual serialization", async () => {
    const f = await fixture();
    const winner = encoder.encode(JSON.stringify({ ...payload(f.sanitizedSha256, f.key),
      readerRevision: binding.readerRevision, readerBindingSha256: await readerBindingSha256(binding) }, null, 2));
    f.env.FOUNDATION_QUARANTINE.put = async key => { f.objects.set(key, winner); throw new Error("already exists"); };
    const result = await f.run();
    assert.equal(result.status, "exists");
    assert.equal(result.outputSha256, await sha256DigestHeader(winner));
  });
  it("keeps unknown binding, changed revision and storage failures retryable", async () => {
    const f = await fixture();
    f.env.FOUNDATION_COMPLETED_READ_BINDING = undefined;
    await assert.rejects(f.run, OcrEvidenceRetryableError);
    assert.equal(f.calls(), 0);
    f.env.FOUNDATION_COMPLETED_READ_BINDING = JSON.stringify(binding);
    await f.run();
    f.env.FOUNDATION_COMPLETED_READ_BINDING = JSON.stringify({ ...binding, readerRevision: `sha256:${"d".repeat(64)}` });
    await assert.rejects(f.run, OcrEvidenceRetryableError);
    f.env.FOUNDATION_QUARANTINE.get = async () => { throw new OcrEvidenceRetryableError("offline failure"); };
    await assert.rejects(f.run, OcrEvidenceRetryableError);
  });
  it("rejects false qualifications and foreign workspace/document/digest keys", async () => {
    assert.equal(parseReaderBinding(JSON.stringify(binding), `${endpoint}/other`), null);
    assert.equal(parseReaderBinding(JSON.stringify({ ...binding, readerRevision: "legacy" }), endpoint), null);
    const f = await fixture(); const proof = await f.proof();
    for (const changed of [{ workspaceKey: "pilot-foreign" }, { documentId: "22345678-1234-4123-8123-123456789abc" },
      { sanitizedSha256: `sha256:${"d".repeat(64)}` }, { readerRevision: "unknown" }, { observedPageCount: 0 },
      { workspaceKey: [ws] }, { documentId: [doc] }]) {
      assert.equal(parseCompletedReadFacts({ ...proof, ...changed }), null);
    }
  });
  it("retries missing/conflicting settlement proof acknowledgements using the same persisted proof", async () => {
    const f = await fixture(); const proof = await f.proof();
    const env = { FOUNDATION_COMPLETED_READ_ENABLED: "true", FOUNDATION_BILLING_SETTLEMENT_URL:
      "http://localhost/api/internal/billing/settle", FOUNDATION_BILLING_SETTLEMENT_HMAC: "synthetic-secret-".repeat(4) };
    const settle = (fetcher: typeof fetch) => dispatchComputeSettlement(env, proof.originalKey, "settled", 2,
      "OCR_COMPLETED", fetcher, undefined, undefined, { sourceSha256: proof.originalSha256, completedRead: proof });
    const receipt = { status: "processed", reservationId: "02345678-1234-4123-8123-123456789abc", state: "settled",
      settledCredits: 2, billingSource: "paid", completedRead: proof };
    for (const body of [{}, { result: { ...receipt, completedRead: { ...proof, readerRevision: `sha256:${"d".repeat(64)}` } } }]) {
      await assert.rejects(() => settle(async () => Response.json(body)), /receipt/);
    }
    await assert.rejects(() => settle(async () => new Response("retry", { status: 503 })), /503/);
    await settle(async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)).completedRead, proof);
      return Response.json({ result: { ...receipt, status: "duplicate", completedRead: Object.fromEntries(Object.entries(proof).reverse()) } });
    });
    assert.deepEqual(await f.proof(), proof);
    assert.equal(f.calls(), 1);
  });
});
