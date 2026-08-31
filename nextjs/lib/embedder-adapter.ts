import { createHash } from "node:crypto";
import { checkEmbeddingCompatibility, type RetrievalProfile } from "./retrieval-profile";

// EmbedderAdapter is the replaceable seam between the Retrieval Runtime and whatever
// actually produces vectors (RunPod today; Hugging Face, a local/VPC runtime, or another
// provider later — see embedder-adapter-runpod.ts for the first backend). Nothing outside
// this file and its backends should know the embedding model's name.
export type EmbedderModelIdentity = {
  provider: string;
  model: string;
  revision: string;
  dimension: number;
  normalize: boolean;
  runtimeImage?: string;
};

export type EmbedderReceipt = {
  provider: string;
  model: string;
  revision: string;
  dimension: number;
  normalize: boolean;
  runtimeImage?: string;
  instruction?: string;
  inputDigest: string;
  outputDigest: string | null;
  durationMs: number;
  timedOut: boolean;
};

export type EmbedderResult =
  | { status: "ok"; vectors: number[][]; receipt: EmbedderReceipt }
  | { status: "error"; reason: string; receipt: EmbedderReceipt };

export type EmbedderInvokeOptions = {
  instruction?: string;
  timeoutMs?: number;
};

export type EmbedderAdapter = {
  identity(): EmbedderModelIdentity;
  embedDocuments(texts: string[], options?: EmbedderInvokeOptions): Promise<EmbedderResult>;
  embedQuery(text: string, options?: EmbedderInvokeOptions): Promise<EmbedderResult>;
};

export function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export type ProfileEmbeddingFailure =
  | { kind: "profile_mismatch"; reason: string }
  | { kind: "provider_error"; reason: string }
  | { kind: "runtime_dimension_mismatch"; reason: string };

export type ProfileEmbeddingResult =
  | { status: "ok"; vectors: number[][]; receipt: EmbedderReceipt }
  | { status: "error"; failure: ProfileEmbeddingFailure; receipt: EmbedderReceipt | null };

// The compatibility-guard enforcement point (Wave 1 defined checkEmbeddingCompatibility;
// this is where it actually gates a write). Two checks, not one: the adapter's *declared*
// identity must match the profile before any call is made (cheap, catches
// misconfiguration instantly), and the *returned* vectors' dimension must match too
// (defense in depth against a provider that lies about or silently changes its own
// identity) — a package pinned to one embedding space must never silently accept vectors
// from another one. Both failures are INCOMPATIBLE_RETRIEVAL_PROFILE, fail-closed, before
// anything is written to pgvector.
export async function embedDocumentsForProfile(
  adapter: EmbedderAdapter,
  profile: RetrievalProfile,
  texts: string[],
): Promise<ProfileEmbeddingResult> {
  const declared = adapter.identity();
  const declaredCheck = checkEmbeddingCompatibility(profile, declared);
  if (!declaredCheck.compatible) {
    return { status: "error", failure: { kind: "profile_mismatch", reason: declaredCheck.reason }, receipt: null };
  }

  const result = await adapter.embedDocuments(texts, {
    instruction: profile.embedding.documentInstruction,
  });
  if (result.status === "error") {
    return { status: "error", failure: { kind: "provider_error", reason: result.reason }, receipt: result.receipt };
  }
  const badVector = result.vectors.find((vector) => vector.length !== profile.embedding.dimension);
  if (badVector) {
    return {
      status: "error",
      failure: {
        kind: "runtime_dimension_mismatch",
        reason: `profile expects ${profile.embedding.dimension}D, provider returned a ${badVector.length}D vector`,
      },
      receipt: result.receipt,
    };
  }
  return { status: "ok", vectors: result.vectors, receipt: result.receipt };
}
