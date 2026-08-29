import { createHash, createHmac, randomUUID } from "node:crypto";
import type { CollectionCandidateArtifact, CollectionOcrInput } from "./collection-compiler";

export type CoreRuntimeEnv = { url: string; hmac: string };

export type CoreCompileReceipt = {
  schemaVersion: "tavonel.compile_receipt.v1";
  requestId: string;
  inputSha256: string;
  outputSha256: string;
  manifestDigest: string;
  collectionId: string;
  candidatePromotion: false;
};

export type CoreCompileResult = {
  runtime: "tavonel-foundation-core-deterministic-v1";
  artifact: CollectionCandidateArtifact;
  receipt: CoreCompileReceipt;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function readCoreRuntimeEnv(): CoreRuntimeEnv | null {
  const url = process.env.FOUNDATION_CORE_URL?.trim() ?? "";
  const hmac = process.env.FOUNDATION_CORE_HMAC ?? "";
  if (!/^https:\/\/[A-Za-z0-9.-]+(?:\/v1\/compile)?$/.test(url) || hmac.length < 32) return null;
  return { url: url.replace(/\/$/, "").replace(/\/v1\/compile$/, ""), hmac };
}

export async function dispatchCoreCompile(
  env: CoreRuntimeEnv,
  workspaceId: string,
  documents: CollectionOcrInput[],
  now = new Date(),
): Promise<{ ok: true; result: CoreCompileResult } | { ok: false; code: string }> {
  const requestId = `core-${randomUUID()}`;
  const envelope = {
    schemaVersion: "tavonel.compile_envelope.v1",
    requestId,
    tenantId: workspaceId,
    workspaceId,
    documents,
  };
  const body = JSON.stringify(envelope);
  const inputSha256 = `sha256:${sha256(body)}`;
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const signature = createHmac("sha256", env.hmac).update(`${timestamp}\n${requestId}\n${inputSha256}`, "utf8").digest("hex");
  let response: Response;
  try {
    response = await fetch(`${env.url}/v1/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tavonel-core-timestamp": timestamp,
        "x-tavonel-core-request-id": requestId,
        "x-tavonel-input-sha256": inputSha256,
        "x-tavonel-core-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, code: "CORE_UNAVAILABLE" };
  }
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json) return { ok: false, code: typeof json?.code === "string" ? json.code : `CORE_HTTP_${response.status}` };
  const artifact = json.artifact as CollectionCandidateArtifact | undefined;
  const receipt = json.receipt as CoreCompileReceipt | undefined;
  if (
    json.status !== "completed"
    || json.runtime !== "tavonel-foundation-core-deterministic-v1"
    || !artifact
    || artifact.schemaVersion !== "tavonel.collection_candidate.v1"
    || artifact.lifecycle !== "candidate"
    || artifact.validation.status !== "passed"
    || artifact.candidatePromotion !== false
    || !receipt
    || receipt.schemaVersion !== "tavonel.compile_receipt.v1"
    || receipt.requestId !== requestId
    || receipt.inputSha256 !== inputSha256
    || receipt.collectionId !== artifact.collectionId
    || receipt.manifestDigest !== artifact.manifestDigest
    || receipt.candidatePromotion !== false
    || receipt.outputSha256 !== `sha256:${sha256(JSON.stringify(artifact))}`
  ) {
    return { ok: false, code: "CORE_RECEIPT_INVALID" };
  }
  return { ok: true, result: { runtime: json.runtime, artifact, receipt } };
}
