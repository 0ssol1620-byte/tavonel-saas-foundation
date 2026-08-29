import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { compileCollectionCandidate, type CollectionOcrInput } from "../../lib/collection-compiler.js";

type RuntimeRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type RuntimeResponse = {
  status(code: number): RuntimeResponse;
  setHeader(name: string, value: string): RuntimeResponse;
  json(value: unknown): void;
};

type CompileEnvelope = {
  schemaVersion: "tavonel.compile_envelope.v1";
  requestId: string;
  tenantId: string;
  workspaceId: string;
  documents: CollectionOcrInput[];
};

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{16,160}$/;

function header(request: RuntimeRequest, name: string) {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authenticate(request: RuntimeRequest, rawBody: string) {
  const secret = process.env.FOUNDATION_CORE_HMAC ?? "";
  if (secret.length < 32) return "CORE_HMAC_NOT_CONFIGURED";
  const timestamp = header(request, "x-tavonel-core-timestamp");
  const requestId = header(request, "x-tavonel-core-request-id");
  const inputDigest = header(request, "x-tavonel-input-sha256");
  const supplied = header(request, "x-tavonel-core-signature").toLowerCase();
  if (!REQUEST_ID.test(requestId) || !/^\d{10}$/.test(timestamp) || !/^sha256:[a-f0-9]{64}$/.test(inputDigest) || !/^[a-f0-9]{64}$/.test(supplied)) {
    return "CORE_AUTH_HEADERS_INVALID";
  }
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return "CORE_AUTH_EXPIRED";
  const calculatedDigest = `sha256:${sha256(rawBody)}`;
  if (calculatedDigest !== inputDigest) return "CORE_INPUT_DIGEST_MISMATCH";
  const expected = createHmac("sha256", secret).update(`${timestamp}\n${requestId}\n${inputDigest}`, "utf8").digest();
  const actual = Buffer.from(supplied, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return "CORE_SIGNATURE_INVALID";
  return null;
}

function validEnvelope(value: unknown): value is CompileEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<CompileEnvelope>;
  return envelope.schemaVersion === "tavonel.compile_envelope.v1"
    && typeof envelope.requestId === "string"
    && REQUEST_ID.test(envelope.requestId)
    && typeof envelope.tenantId === "string"
    && ID.test(envelope.tenantId)
    && typeof envelope.workspaceId === "string"
    && ID.test(envelope.workspaceId)
    && envelope.tenantId === envelope.workspaceId
    && Array.isArray(envelope.documents)
    && envelope.documents.length >= 2
    && envelope.documents.length <= 12;
}

export default async function handler(request: RuntimeRequest, response: RuntimeResponse) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET") {
    response.status(200).json({
      status: "ok",
      service: "tavonel-foundation-core",
      runtime: "tavonel-foundation-core-deterministic-v1",
      schemaVersion: "tavonel.compile_envelope.v1",
      hmacConfigured: (process.env.FOUNDATION_CORE_HMAC ?? "").length >= 32,
    });
    return;
  }
  if (request.method !== "POST") {
    response.status(405).json({ code: "METHOD_NOT_ALLOWED" });
    return;
  }
  const rawBody = JSON.stringify(request.body ?? null);
  if (Buffer.byteLength(rawBody, "utf8") > 1024 * 1024) {
    response.status(413).json({ code: "CORE_ENVELOPE_TOO_LARGE" });
    return;
  }
  const authError = authenticate(request, rawBody);
  if (authError) {
    response.status(authError === "CORE_HMAC_NOT_CONFIGURED" ? 503 : 401).json({ code: authError });
    return;
  }
  if (!validEnvelope(request.body) || request.body.requestId !== header(request, "x-tavonel-core-request-id")) {
    response.status(400).json({ code: "CORE_ENVELOPE_INVALID" });
    return;
  }
  try {
    const artifact = compileCollectionCandidate(request.body.documents);
    const outputDigest = `sha256:${sha256(JSON.stringify(artifact))}`;
    response.status(200).json({
      status: "completed",
      runtime: "tavonel-foundation-core-deterministic-v1",
      envelope: {
        schemaVersion: request.body.schemaVersion,
        requestId: request.body.requestId,
        tenantId: request.body.tenantId,
        workspaceId: request.body.workspaceId,
        inputSha256: header(request, "x-tavonel-input-sha256"),
      },
      artifact,
      receipt: {
        schemaVersion: "tavonel.compile_receipt.v1",
        requestId: request.body.requestId,
        inputSha256: header(request, "x-tavonel-input-sha256"),
        outputSha256: outputDigest,
        manifestDigest: artifact.manifestDigest,
        collectionId: artifact.collectionId,
        candidatePromotion: false,
      },
    });
  } catch (error) {
    response.status(422).json({ code: error instanceof Error ? error.message : "CORE_COMPILE_FAILED" });
  }
}
