import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { getWorkspaceCollectionCandidate, getWorkspaceSanitizedPdf, listImmutableWorkspaceObjects, putWorkspaceCollectionCandidate } from "../../lib/r2-objects";
import { FOUNDATION_R2_BUCKET } from "../../lib/r2-synthetic-canary";

const endpoint = process.env.TAVONEL_LOCAL_S3_ENDPOINT;
const host = "00000000000000000000000000000000.r2.cloudflarestorage.com";
const env = { accountId: host.split(".")[0], bucket: FOUNDATION_R2_BUCKET,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "" };
const workspace = "pilot-a111111111114111";
const prefix = `immutable/${workspace}/${workspace}/`;
const key = `${prefix}collections/collection-${"a".repeat(32)}/${"a".repeat(64)}/candidate-world.json`;
const originalFetch = globalThis.fetch;
const hash = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
const hmac = (key: string | Buffer, body: string) => createHmac("sha256", key).update(body).digest();

// An independent signer seeds/deletes fixtures; production reads/writes use their own actual signer.
async function fixture(method: string, objectKey: string, body = "") {
  const uri = `/${env.bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const headers: Record<string, string> = { host, "x-amz-content-sha256": hash(body), "x-amz-date": date };
  const names = Object.keys(headers).sort();
  const canonical = [method, uri, "", names.map(name => `${name}:${headers[name]}\n`).join(""), names.join(";"), hash(body)].join("\n");
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.secretAccessKey}`, date.slice(0, 8)), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return originalFetch(`${endpoint}${uri}`, { method, headers, ...(method === "PUT" ? { body } : {}), signal: AbortSignal.timeout(5000) });
}

describe.skipIf(!endpoint)("actual disposable S3 through production R2 signatures (transport routed locally)", () => {
  beforeAll(() => {
    if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error("Only a loopback disposable S3 endpoint is accepted");
    if (!env.accessKeyId || !env.secretAccessKey) throw new Error("Missing ephemeral fixture keys");
    // Transport substitution only: unchanged method, body, signed host and headers reach real S3.
    // No Response, status, object contents or signature verdict are synthesized.
    globalThis.fetch = async (input, init) => {
      if (typeof input !== "string" || new URL(input).hostname !== host) throw new Error("Unexpected network destination in local S3 qualification");
      const url = new URL(input);
      return originalFetch(`${endpoint}${url.pathname}${url.search}`, init);
    };
  });
  afterAll(() => { globalThis.fetch = originalFetch; });

  it("denies unsigned access and wrong signatures at the actual service", async () => {
    const anonymous = await originalFetch(`${endpoint}/${env.bucket}`, { signal: AbortSignal.timeout(5000) });
    expect(anonymous.status).toBe(403); await anonymous.text();
    expect(await putWorkspaceCollectionCandidate({ ...env, secretAccessKey: "invalid-local-key" }, workspace, key, { synthetic: true }))
      .toEqual({ ok: false, code: "PUT_FAILED" });
  });

  it("writes and reads immutable candidate bytes; conflicting replay cannot replace them", async () => {
    const candidate = { synthetic: true, revision: "A", sources: ["synthetic-policy"] };
    expect(await putWorkspaceCollectionCandidate(env, workspace, key, candidate)).toMatchObject({ ok: true, status: "written" });
    expect(await getWorkspaceCollectionCandidate(env, workspace, key)).toEqual({ ok: true, json: candidate });
    const results = await Promise.all([candidate, { synthetic: true, revision: "corrupt-replay" }].map(value => putWorkspaceCollectionCandidate(env, workspace, key, value)));
    expect(results.map(result => result.ok && result.status)).toEqual(["exists", "exists"]);
    expect(await getWorkspaceCollectionCandidate(env, workspace, key)).toEqual({ ok: true, json: candidate });
    const listed = await listImmutableWorkspaceObjects(env, workspace);
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.objects.some(item => item.key === key)).toBe(true);
  });

  it("keeps foreign workspace admission outside the storage credential boundary", async () => {
    expect(await putWorkspaceCollectionCandidate(env, "pilot-b222222222224222", key, {})).toEqual({ ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" });
    expect(await getWorkspaceCollectionCandidate(env, "pilot-b222222222224222", key)).toEqual({ ok: false, code: "COLLECTION_JSON_PREFIX_REQUIRED" });
  });

  it("allows exactly one concurrent first writer and retains independent revision objects", async () => {
    const revisionKey = key.replace(`/${"a".repeat(64)}/`, `/${"b".repeat(64)}/`);
    const choices = [{ synthetic: true, revision: "B-1" }, { synthetic: true, revision: "B-2" }];
    const attempts = await Promise.all(choices.map(value => putWorkspaceCollectionCandidate(env, workspace, revisionKey, value)));
    expect(attempts.map(result => result.ok && result.status).sort()).toEqual(["exists", "written"]);
    const winner = attempts.findIndex(result => result.ok && result.status === "written");
    expect(await getWorkspaceCollectionCandidate(env, workspace, revisionKey)).toEqual({ ok: true, json: choices[winner] });
    expect(await getWorkspaceCollectionCandidate(env, workspace, key)).toMatchObject({ ok: true, json: { revision: "A" } });
    expect(await getWorkspaceCollectionCandidate({ ...env, secretAccessKey: "invalid-local-key" }, workspace, revisionKey))
      .toEqual({ ok: false, code: "GET_FORBIDDEN" });
  });

  it("fails closed when a retained candidate disappears and permits explicit synthetic restoration", async () => {
    const deleted = await fixture("DELETE", key); expect(deleted.status).toBe(204); await deleted.text();
    expect(await getWorkspaceCollectionCandidate(env, workspace, key)).toEqual({ ok: false, code: "NOT_FOUND" });
    const restored = { synthetic: true, revision: "A", sources: ["synthetic-policy"] };
    expect(await putWorkspaceCollectionCandidate(env, workspace, key, restored)).toMatchObject({ ok: true, status: "written" });
    expect(await getWorkspaceCollectionCandidate(env, workspace, key)).toEqual({ ok: true, json: restored });
  });

  it("verifies sanitized source content digest against actual object bytes", async () => {
    const pdf = "%PDF-1.7\nSynthetic local fixture only\n%%EOF\n";
    const pdfKey = `${prefix}documents/synthetic-document/${hash(pdf)}/sanitized.pdf`;
    const seeded = await fixture("PUT", pdfKey, pdf); expect(seeded.ok).toBe(true); await seeded.text();
    const result = await getWorkspaceSanitizedPdf(env, workspace, pdfKey);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.bytes).toString()).toBe(pdf);
    const corrupted = await fixture("PUT", pdfKey, "corrupted synthetic object"); expect(corrupted.ok).toBe(true); await corrupted.text();
    expect(await getWorkspaceSanitizedPdf(env, workspace, pdfKey)).toEqual({ ok: false, code: "SOURCE_DIGEST_MISMATCH" });
  });
});
