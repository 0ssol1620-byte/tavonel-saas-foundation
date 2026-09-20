import { createHash, randomUUID } from "node:crypto";
import type { EmbedderAdapter, EmbedderResult } from "./embedder-adapter";
import type { RerankerAdapter, RerankerResult } from "./reranker-adapter";
import { runGovernedModelProviderCall } from "./model-provider-dispatch";

type GovernanceConfig = {
  tenantId: string;
  provider: string;
  model: string;
  maximumUnits: number;
  reservationSeconds?: number;
};

function digest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function actualUnits(durationMs: number) {
  return Math.max(1, Math.ceil(durationMs / 1_000));
}

function circuitOutcome(result: EmbedderResult | RerankerResult) {
  if (result.status === "ok") return { kind: "success" as const };
  if (/HTTP (401|403)\b/.test(result.reason)) {
    return { kind: "failure" as const, scope: "provider_account" as const,
      code: "PROVIDER_ACCOUNT_REJECTED" };
  }
  if (/HTTP 4\d\d\b/.test(result.reason) && !/HTTP (408|429)\b/.test(result.reason)) {
    return { kind: "failure" as const, scope: "semantic_document" as const,
      code: "PROVIDER_REQUEST_REJECTED" };
  }
  return {
    kind: "failure" as const,
    scope: "provider_operational" as const,
    code: result.receipt.timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_RESULT_UNAVAILABLE",
  };
}

function dispatchInput(config: GovernanceConfig, requestDigest: string) {
  const id = randomUUID();
  return {
    tenantId: config.tenantId,
    requestKey: `retrieval-${id}`,
    requestDigest,
    provider: config.provider,
    model: config.model,
    meter: "gpu_second",
    reservedUnits: config.maximumUnits,
    reservationSeconds: config.reservationSeconds,
    admissionId: `retrieval-${id}`,
  };
}

export function governEmbedderAdapter(adapter: EmbedderAdapter, config: GovernanceConfig): EmbedderAdapter {
  const invoke = async (texts: string[], query: boolean, options?: Parameters<EmbedderAdapter["embedQuery"]>[1]) => {
    const inputDigest = digest({ texts, instruction: options?.instruction ?? null, query });
    const startedAt = Date.now();
    const result = await runGovernedModelProviderCall(
      dispatchInput(config, inputDigest),
      async () => {
        const value = query
          ? await adapter.embedQuery(texts[0] ?? "", options)
          : await adapter.embedDocuments(texts, options);
        return {
          value,
          actualUnits: actualUnits(Date.now() - startedAt),
          reasonCode: value.status === "ok" ? "PROVIDER_RESULT_ACCEPTED" : "PROVIDER_RESULT_REJECTED",
          circuitOutcome: circuitOutcome(value),
        };
      },
      undefined,
      options?.attemptLifecycle,
    );
    if (result.ok) return result.value;
    const identity = adapter.identity();
    return {
      status: "error" as const,
      reason: result.code,
      receipt: {
        ...identity,
        instruction: options?.instruction,
        inputDigest,
        outputDigest: null,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      },
    };
  };
  return {
    identity: () => adapter.identity(),
    endpointId: adapter.endpointId ? () => adapter.endpointId!() : undefined,
    embedDocuments: (texts, options) => invoke(texts, false, options),
    embedQuery: (text, options) => invoke([text], true, options),
  };
}

export function governRerankerAdapter(adapter: RerankerAdapter, config: GovernanceConfig): RerankerAdapter {
  return {
    identity: () => adapter.identity(),
    async rerank(query, candidates, options) {
      const inputDigest = digest({ query, candidates, topK: options?.topK ?? null });
      const startedAt = Date.now();
      const result = await runGovernedModelProviderCall(
        dispatchInput(config, inputDigest),
        async () => {
          const value = await adapter.rerank(query, candidates, options);
          return {
            value,
            actualUnits: actualUnits(Date.now() - startedAt),
            reasonCode: value.status === "ok" ? "PROVIDER_RESULT_ACCEPTED" : "PROVIDER_RESULT_REJECTED",
            circuitOutcome: circuitOutcome(value),
          };
        },
        undefined,
        options?.attemptLifecycle,
      );
      if (result.ok) return result.value;
      const identity = adapter.identity();
      return {
        status: "error",
        reason: result.code,
        receipt: {
          ...identity,
          candidateCount: candidates.length,
          inputDigest,
          outputDigest: null,
          durationMs: Date.now() - startedAt,
          timedOut: false,
        },
      };
    },
  };
}
