import type { EmbedderAdapter, EmbedderInvokeOptions, EmbedderModelIdentity, EmbedderResult } from "./embedder-adapter";

// RunPod backend for EmbedderAdapter. Follows the same conventions as the existing OCR
// dispatch (quarantine-sidecar/foundation-cdr-worker/src/ocr.ts): Bearer auth via an
// API key never logged or embedded in a receipt, AbortSignal-based timeouts, a URL
// allowlist, and strict typed response validation against an exact schemaVersion --
// a malformed or unexpected response is a provider_error, never trusted output.
//
// identity() is a STATIC claim baked in at construction time (this adapter instance was
// configured to point at a worker pinned to `identity`), not a live query against the
// deployed worker -- embedDocumentsForProfile (embedder-adapter.ts) checks that claim
// against the RetrievalProfile before ever calling embedDocuments/embedQuery. Confirming
// the deployed worker actually matches `identity` is an operational check against the
// Flash service's /model-info route, done when the endpoint is deployed, not on every
// request.
export type RunPodConnectionConfig = {
  url: string;
  apiKey?: string;
  timeoutMs?: number;
};

const EMBEDDING_RESULT_SCHEMA = "tavonel.embedding_result.v1";
export const RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS = 30_000;

type EmbeddingResultPayload = {
  schemaVersion: typeof EMBEDDING_RESULT_SCHEMA;
  status: "ok";
  vectors: number[][];
  dimension: number;
};

// Mirrors ocr.ts's looksLikeFoundationOcrUrl / isForbiddenOcrUrl: https (or localhost for
// local dev against `flash dev`) and a host that is actually RunPod's, not an
// attacker-controlled URL that happened to end up in configuration. Verify this against
// the real `requestUrls` a `flash deploy` / create-endpoint call reports once the service
// is deployed -- this is the intended shape, not yet confirmed against a live endpoint.
export function looksLikeRunPodEmbeddingUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) return false;
  return local || host === "api.runpod.ai" || host.endsWith(".api.runpod.ai");
}

function qualifyEmbeddingResult(payload: unknown, expectedDimension: number): EmbeddingResultPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const result = payload as Partial<EmbeddingResultPayload>;
  if (
    result.schemaVersion !== EMBEDDING_RESULT_SCHEMA ||
    result.status !== "ok" ||
    typeof result.dimension !== "number" ||
    result.dimension !== expectedDimension ||
    !Array.isArray(result.vectors) ||
    result.vectors.length < 1 ||
    result.vectors.length > 10_000
  ) return null;
  for (const vector of result.vectors) {
    if (
      !Array.isArray(vector) ||
      vector.length !== expectedDimension ||
      !vector.every((component) => typeof component === "number" && Number.isFinite(component))
    ) return null;
  }
  return result as EmbeddingResultPayload;
}

async function callEmbeddingRoute(
  config: RunPodConnectionConfig,
  identity: EmbedderModelIdentity,
  route: "embed/documents" | "embed/query",
  texts: string[],
  options: EmbedderInvokeOptions | undefined,
  fetcher: typeof fetch,
): Promise<EmbedderResult> {
  const startedAt = Date.now();
  const receiptBase = {
    provider: identity.provider,
    model: identity.model,
    revision: identity.revision,
    dimension: identity.dimension,
    normalize: identity.normalize,
    runtimeImage: identity.runtimeImage,
    instruction: options?.instruction,
  };

  if (!looksLikeRunPodEmbeddingUrl(config.url)) {
    return {
      status: "error",
      reason: "RunPod embedding URL failed the allowlist check",
      receipt: { ...receiptBase, inputDigest: "", outputDigest: null, durationMs: 0, timedOut: false },
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const apiKey = (config.apiKey || "").trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const inputDigest = `sha256:${await sha256Hex(JSON.stringify(texts))}`;
  let response: Response;
  try {
    response = await fetcher(`${config.url.replace(/\/$/, "")}/${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ data: { texts, instruction: options?.instruction } }),
      signal: AbortSignal.timeout(options?.timeoutMs ?? config.timeoutMs ?? RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      status: "error",
      reason: timedOut ? "RunPod embedding request timed out" : "RunPod embedding request failed (network)",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut },
    };
  }
  if (!response.ok) {
    return {
      status: "error",
      reason: `RunPod embedding endpoint returned HTTP ${response.status}`,
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      status: "error",
      reason: "RunPod embedding response is not JSON",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }
  const qualified = qualifyEmbeddingResult(payload, identity.dimension);
  if (!qualified) {
    return {
      status: "error",
      reason: "RunPod embedding response failed schema validation",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }
  if (qualified.vectors.length !== texts.length) {
    return {
      status: "error",
      reason: `RunPod embedding endpoint returned ${qualified.vectors.length} vectors for ${texts.length} inputs`,
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }

  const outputDigest = `sha256:${await sha256Hex(JSON.stringify(qualified.vectors))}`;
  return {
    status: "ok",
    vectors: qualified.vectors,
    receipt: { ...receiptBase, inputDigest, outputDigest, durationMs: Date.now() - startedAt, timedOut: false },
  };
}

async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createRunPodEmbedderAdapter(
  identity: EmbedderModelIdentity,
  config: RunPodConnectionConfig,
  fetcher: typeof fetch = fetch,
): EmbedderAdapter {
  return {
    identity: () => identity,
    embedDocuments: (texts, options) => callEmbeddingRoute(config, identity, "embed/documents", texts, options, fetcher),
    embedQuery: (text, options) => callEmbeddingRoute(config, identity, "embed/query", [text], options, fetcher),
  };
}
