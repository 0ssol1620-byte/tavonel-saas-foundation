import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { reserveFoundationCompute, settleFoundationCompute } from "../lib/compute-reservation";
import { reserveFoundationIntake } from "../lib/intake-admission";
import { getWorkspaceOcrJson, listImmutableWorkspaceObjects } from "../lib/r2-objects";
import { presignFoundationQuarantinePut } from "../lib/r2-presign";
import { readR2SignerEnv } from "../lib/r2-synthetic-canary";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "../lib/supabase-admin";

const workspaceKey = (process.env.TAVONEL_QUALIFICATION_WORKSPACE || "").trim();
const sourcePath = resolve(process.argv[2] || "");
const mimeType = "application/pdf";

if (!/^pilot-[A-Za-z0-9]{1,32}$/.test(workspaceKey)) {
  throw new Error("TAVONEL_QUALIFICATION_WORKSPACE_INVALID");
}
if (!process.argv[2]) throw new Error("Usage: tsx scripts/qualify-production-gpu-pipeline.ts <public-pdf>");

const signer = readR2SignerEnv();
const supabase = readSupabaseAdminConfig();
if (!signer || !supabase) throw new Error("PRODUCTION_CONFIGURATION_MISSING");

const bytes = await readFile(sourcePath);
if (bytes.length < 5 || bytes.length > 5 * 1024 * 1024 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
  throw new Error("PUBLIC_FIXTURE_NOT_QUALIFIED");
}
const sourceSha256 = createHash("sha256").update(bytes).digest("hex");

const accountResponse = await supabaseAdminRequest(
  supabase,
  `/rest/v1/foundation_billing_accounts?workspace_key=eq.${encodeURIComponent(workspaceKey)}` +
    "&select=user_id,credit_balance,access_plan,subscription_status,billing_hold&limit=1",
);
if (!accountResponse.ok) throw new Error(`BILLING_ACCOUNT_READ_${accountResponse.status}`);
const accounts = await accountResponse.json() as Array<{
  user_id: string;
  credit_balance: number;
  access_plan: string;
  subscription_status: string;
  billing_hold: boolean;
}>;
const account = accounts[0];
if (!account || account.access_plan !== "studio_access" || !["active", "trialing"].includes(account.subscription_status)
  || account.billing_hold || account.credit_balance < 2) {
  throw new Error("BILLING_ACCOUNT_NOT_QUALIFIED");
}

const documentId = randomUUID();
const objectKey = `quarantine/${workspaceKey}/${documentId}/source`;
const admission = await reserveFoundationIntake({
  workspaceKey,
  documentId,
  userId: account.user_id,
  objectKey,
  requestedBytes: bytes.length,
  declaredMimeType: mimeType,
});
if (!admission.ok) throw new Error(admission.code);

const compute = await reserveFoundationCompute({ workspaceKey, documentId, userId: account.user_id, estimatedPages: 1 });
if (!compute.ok) throw new Error(compute.code);

const signed = presignFoundationQuarantinePut(signer, {
  key: objectKey,
  contentType: mimeType,
  contentLength: bytes.length,
  expiresInSeconds: 300,
});
if (!signed.ok) {
  await settleFoundationCompute({
    workspaceKey,
    documentId,
    outcome: "released",
    actualCredits: 0,
    reasonCode: "QUALIFICATION_SIGNING_FAILED",
  });
  throw new Error(signed.code);
}

const upload = await fetch(signed.uploadUrl, {
  method: "PUT",
  headers: { "content-type": mimeType },
  body: bytes,
  signal: AbortSignal.timeout(30_000),
});
if (!upload.ok) {
  await settleFoundationCompute({
    workspaceKey,
    documentId,
    outcome: "released",
    actualCredits: 0,
    reasonCode: "QUALIFICATION_UPLOAD_FAILED",
  });
  throw new Error(`R2_UPLOAD_${upload.status}`);
}

let immutableKeys: string[] = [];
let ocrKey = "";
for (let attempt = 0; attempt < 60; attempt += 1) {
  const inventory = await listImmutableWorkspaceObjects(signer, workspaceKey);
  if (inventory.ok) {
    immutableKeys = inventory.objects.map(item => item.key).filter(key => key.includes(`/${documentId}/`));
    ocrKey = immutableKeys.find(key => key.endsWith("/ocr.json")) || "";
    if (ocrKey) break;
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 3_000));
}
if (!ocrKey) throw new Error("OCR_JSON_TIMEOUT_OPERATOR_REVIEW_REQUIRED");

const ocr = await getWorkspaceOcrJson(signer, workspaceKey, ocrKey);
if (!ocr.ok) throw new Error(ocr.code);
const payload = ocr.json as Record<string, unknown>;
const pages = Array.isArray(payload.pages) ? payload.pages : [];
const pageCount = Number(payload.pageCount);
const text = typeof payload.text === "string" ? payload.text : "";
if (payload.status !== "ok" || !Number.isInteger(pageCount) || pageCount < 1 || text.length < 1) {
  throw new Error("OCR_JSON_CONTRACT_INVALID");
}

process.stdout.write(`${JSON.stringify({
  status: "qualified",
  observedAtUtc: new Date().toISOString(),
  scope: "production-provider-internal-public-fixture",
  workspaceKey,
  documentId,
  source: {
    filename: basename(sourcePath),
    bytes: bytes.length,
    sha256: sourceSha256,
  },
  admission: {
    idempotentReplay: admission.result.idempotentReplay,
    expiresAt: admission.result.expiresAt,
  },
  compute: {
    reservationId: compute.result.reservationId,
    reservedCredits: compute.result.reservedCredits,
  },
  r2: {
    quarantineKey: objectKey,
    uploadStatus: upload.status,
    immutableKeys,
  },
  ocr: {
    key: ocrKey,
    status: payload.status,
    pageCount,
    textCharacters: text.length,
    pagesObserved: pages.length,
    inputSha256: payload.inputSha256,
    sourceImmutableKey: payload.sourceImmutableKey,
  },
}, null, 2)}\n`);
