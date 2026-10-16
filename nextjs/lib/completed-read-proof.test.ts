import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { settleCompletedRead, readCompletedReadProof } from "./completed-read-proof";

const ws = "pilot-proof"; const doc = "12345678-1234-4123-8123-123456789abc";
const digest = `sha256:${"a".repeat(64)}`;
const prefix = `immutable/${ws}/${ws}/${doc}/${digest.slice(7)}`;
const facts = { schemaVersion: "tavonel.completed_read.v1" as const, workspaceKey: ws, documentId: doc,
  originalKey: `quarantine/${ws}/${doc}/source`, originalSha256: `sha256:${"b".repeat(64)}`,
  sanitizedKey: `${prefix}/sanitized.pdf`, sanitizedSha256: digest, ocrKey: `${prefix}/ocr.json`,
  ocrSha256: `sha256:${"c".repeat(64)}`, observedPageCount: 3, readerRevision: `sha256:${"d".repeat(64)}`,
  readerBindingSha256: `sha256:${"e".repeat(64)}` };
const receipt = { status: "processed", reservationId: doc, state: "settled", settledCredits: 2,
  billingSource: "paid", completedRead: facts };

describe("completed read server boundary", () => {
  it("defaults off, fails closed without a legacy fallback, and preserves source authorization", async () => {
    const before = { ...process.env }; const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    let mode: "ok" | "failure" | "revoked" | "zero" | "connector" | "unadmitted" = "ok";
    const rpcUrls = () => urls.filter(url => url.includes("/rpc/"));
    const mockFetch = async (url: string | URL | Request) => {
      const address = String(url); urls.push(address);
      if (address.includes("connector_document_bindings")) {
        const rows = mode === "connector" ? [{ workspace_key: ws, document_id: doc }] : [];
        return Response.json(rows, { headers: { "content-range": `0-${rows.length - 1}/${rows.length}` } });
      }
      if (address.includes("foundation_intake_admissions")) {
        const rows = mode === "unadmitted" ? [] : [{ workspace_key: ws, document_id: doc }];
        return Response.json(rows, { headers: { "content-range": `0-${rows.length - 1}/${rows.length}` } });
      }
      if (mode === "failure") return new Response("failure", { status: 503 });
      if (mode === "revoked") return new Response("COMPLETED_READ_SOURCE_UNAVAILABLE", { status: 400 });
      return Response.json({ ...receipt, status: address.includes("read_foundation") ? "duplicate" : "processed",
        settledCredits: mode === "zero" ? 0 : 2 });
    };
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://synthetic.invalid";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-offline-key-".repeat(3);
      delete process.env.FOUNDATION_COMPLETED_READ_ENABLED;
      globalThis.fetch = mockFetch;
      assert.deepEqual(await settleCompletedRead(facts), { ok: false, code: "COMPLETED_READ_DISABLED" });
      assert.equal(urls.length, 0);
      process.env.FOUNDATION_COMPLETED_READ_ENABLED = "true";
      assert.equal((await settleCompletedRead(facts)).ok, true);
      assert.match(rpcUrls()[0], /settle_foundation_completed_read_v1$/);
      const beforeDeniedRead = urls.length;
      assert.equal(await readCompletedReadProof(facts, async () => false), null);
      assert.equal(urls.length, beforeDeniedRead);
      mode = "failure";
      assert.equal((await settleCompletedRead(facts)).ok, false);
      assert.equal(urls.some(url => url.endsWith("settle_foundation_compute_v3")), false);
      assert.equal(await readCompletedReadProof(facts, async () => true), null);
      mode = "ok";
      const result = await readCompletedReadProof(facts, async (workspace, document) => workspace === ws && document === doc);
      assert.deepEqual(result?.completedRead, facts);
      // The database reports revoked/tombstoned sources as unavailable; evidence cannot bypass it.
      mode = "revoked";
      assert.equal(await readCompletedReadProof(facts, async () => true), null);
      mode = "zero";
      assert.equal((await settleCompletedRead(facts)).ok, false);
      for (const scopeMode of ["connector", "unadmitted"] as const) {
        mode = scopeMode;
        const beforeRpc = rpcUrls().length;
        assert.deepEqual(await settleCompletedRead(facts), { ok: false, code: "COMPLETED_READ_DIRECT_UPLOAD_REQUIRED" });
        assert.equal(await readCompletedReadProof(facts, async () => true), null);
        assert.equal(rpcUrls().length, beforeRpc);
      }
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
    }
  });
});
