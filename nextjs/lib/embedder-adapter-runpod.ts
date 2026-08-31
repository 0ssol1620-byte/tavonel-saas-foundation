import type { EmbedderAdapter, EmbedderInvokeOptions, EmbedderModelIdentity, EmbedderResult } from "./embedder-adapter";

// RunPod backend for EmbedderAdapter, calling an official Hugging Face Text Embeddings
// Inference (TEI) container deployed as a RunPod Load Balancer Serverless endpoint --
// ghcr.io/huggingface/text-embeddings-inference, not a custom worker image (see
// retrieval-runtime-config.ts for why: the official image needs no Dockerfile, no
// registry credential, and no custom handler). The request/response shapes below are
// TEI's own wire contract (POST /embed: {"inputs": [...]} -> bare number[][]), confirmed
// against TEI's published OpenAPI schema -- not invented, since a wrong guess here would
// silently corrupt every embedding this adapter produces.
//
// Auth follows the same conventions as the existing OCR dispatch
// (quarantine-sidecar/foundation-cdr-worker/src/ocr.ts): Bearer auth via an API key never
// logged or embedded in a receipt, AbortSignal-based timeouts, a URL allowlist, and strict
// typed response validation -- a malformed or unexpected response is a provider_error,
// never trusted output.
//
// identity() is a STATIC claim baked in at construction time (this adapter instance was
// configured to point at a worker pinned to `identity`), not a live query against the
// deployed worker -- embedDocumentsForProfile (embedder-adapter.ts) checks that claim
// against the RetrievalProfile before ever calling embedDocuments/embedQuery. Confirming
// the deployed worker actually matches `identity` is an operational check (MODEL_ID/
// REVISION env vars passed at create-endpoint time), not something re-verified per request.
export type RunPodConnectionConfig = {
  url: string;
  apiKey?: string;
  timeoutMs?: number;
};

export const RUNPOD_EMBEDDER_REQUEST_TIMEOUT_MS = 30_000;

// Mirrors ocr.ts's looksLikeFoundationOcrUrl / isForbiddenOcrUrl: https (or localhost for
// local dev against a TEI container run with `docker run`) and a host that is actually
// RunPod's, not an attacker-controlled URL that happened to end up in configuration.
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

// TEI's POST /embed response is a bare array of vectors, in input order, with no wrapper
// object, no schemaVersion, and no declared dimension field -- the shape itself is the
// only signal, so every element's length is checked against what the profile expects.
function qualifyEmbeddingResponse(payload: unknown, expectedDimension: number, expectedCount: number): number[][] | null {
  if (!Array.isArray(payload) || payload.length !== expectedCount) return null;
  for (const vector of payload) {
    if (
      !Array.isArray(vector) ||
      vector.length !== expectedDimension ||
      !vector.every((component) => typeof component === "number" && Number.isFinite(component))
    ) return null;
  }
  return payload as number[][];
}

async function sha256Hex(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function callEmbeddingRoute(
  config: RunPodConnectionConfig,
  identity: EmbedderModelIdentity,
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

  // Computed before the allowlist check (auditor-sol Wave 2 finding #5) so an allowlist
  // rejection still carries a real digest of what was attempted -- otherwise every
  // rejected request produced an identical, empty inputDigest, making the receipt useless
  // for telling two different rejected calls apart or reproducing either one.
  const inputDigest = `sha256:${await sha256Hex(JSON.stringify(texts))}`;

  if (!looksLikeRunPodEmbeddingUrl(config.url)) {
    return {
      status: "error",
      reason: "RunPod embedding URL failed the allowlist check",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: 0, timedOut: false },
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  const apiKey = (config.apiKey || "").trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // TEI has no request-level "instruction" field (only a "prompt_name" referencing a
  // preset baked into the model's config, which BGE-M3 does not define) -- an instruction
  // the caller asked for must actually take effect, not silently vanish, so it is
  // prepended to each input text, matching the standard way instruction-tuned embedding
  // models are served through instruction-agnostic backends like TEI.
  const inputs = options?.instruction ? texts.map((text) => `${options.instruction} ${text}`) : texts;

  let response: Response;
  try {
    response = await fetcher(`${config.url.replace(/\/$/, "")}/embed`, {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs, normalize: identity.normalize }),
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
  const vectors = qualifyEmbeddingResponse(payload, identity.dimension, texts.length);
  if (!vectors) {
    return {
      status: "error",
      reason: "RunPod embedding response failed schema validation",
      receipt: { ...receiptBase, inputDigest, outputDigest: null, durationMs: Date.now() - startedAt, timedOut: false },
    };
  }

  const outputDigest = `sha256:${await sha256Hex(JSON.stringify(vectors))}`;
  return {
    status: "ok",
    vectors,
    receipt: { ...receiptBase, inputDigest, outputDigest, durationMs: Date.now() - startedAt, timedOut: false },
  };
}

export function createRunPodEmbedderAdapter(
  identity: EmbedderModelIdentity,
  config: RunPodConnectionConfig,
  fetcher: typeof fetch = fetch,
): EmbedderAdapter {
  return {
    identity: () => identity,
    embedDocuments: (texts, options) => callEmbeddingRoute(config, identity, texts, options, fetcher),
    embedQuery: (text, options) => callEmbeddingRoute(config, identity, [text], options, fetcher),
  };
}
