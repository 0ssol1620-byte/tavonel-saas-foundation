import { createHash } from "node:crypto";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_MISSING`);
  return value;
};

const endpoint = (name) => {
  const value = new URL(required(name));
  if (value.protocol !== "https:" || !value.hostname.endsWith(".api.runpod.ai")) {
    throw new Error(`${name}_INVALID`);
  }
  return value.origin;
};

const apiKey = required("TAVONEL_RUNPOD_API_KEY");
const embedderUrl = endpoint("TAVONEL_RETRIEVAL_EMBEDDER_URL");
const rerankerUrl = endpoint("TAVONEL_RETRIEVAL_RERANKER_URL");
const timeoutMs = Number(process.env.TAVONEL_RUNPOD_SMOKE_TIMEOUT_MS ?? 180_000);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
  throw new Error("TAVONEL_RUNPOD_SMOKE_TIMEOUT_MS_INVALID");
}

const request = async (url, body) => {
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`RUNPOD_HTTP_${response.status}`);
  return { payload, durationMs: Date.now() - startedAt };
};

const embedded = await request(`${embedderUrl}/embed`, {
  inputs: ["TAVONEL retrieval contract probe"],
  normalize: true,
});
if (
  !Array.isArray(embedded.payload) || embedded.payload.length !== 1 ||
  !Array.isArray(embedded.payload[0]) || embedded.payload[0].length !== 1024 ||
  !embedded.payload[0].every((value) => Number.isFinite(value))
) throw new Error("RUNPOD_EMBEDDER_CONTRACT_INVALID");

const reranked = await request(`${rerankerUrl}/rerank`, {
  query: "knowledge compiler",
  texts: ["knowledge compiler", "weather report"],
  raw_scores: false,
});
if (
  !Array.isArray(reranked.payload) || reranked.payload.length !== 2 ||
  !reranked.payload.every((row) =>
    row && Number.isSafeInteger(row.index) && row.index >= 0 && row.index < 2 &&
    Number.isFinite(row.score)
  ) || new Set(reranked.payload.map((row) => row.index)).size !== 2
) throw new Error("RUNPOD_RERANKER_CONTRACT_INVALID");

const normalized = {
  schemaVersion: "tavonel.runpod-retrieval-smoke.v1",
  checkedAt: new Date().toISOString(),
  embedder: {
    endpointId: new URL(embedderUrl).hostname.split(".")[0],
    vectorCount: embedded.payload.length,
    dimension: embedded.payload[0].length,
    finite: true,
    durationMs: embedded.durationMs,
  },
  reranker: {
    endpointId: new URL(rerankerUrl).hostname.split(".")[0],
    candidateCount: reranked.payload.length,
    rankedIndexes: reranked.payload.map((row) => row.index),
    finiteScores: true,
    durationMs: reranked.durationMs,
  },
};
const receiptSha256 = createHash("sha256")
  .update(JSON.stringify(normalized), "utf8")
  .digest("hex");
console.log(JSON.stringify({ ...normalized, receiptSha256: `sha256:${receiptSha256}` }, null, 2));
