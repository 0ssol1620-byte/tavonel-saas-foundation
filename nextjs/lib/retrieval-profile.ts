import { canonicalize, sha256 } from "./collection-compiler";

export const RETRIEVAL_VIEW_KINDS = [
  "section",
  "claim",
  "entity",
  "table",
  "event",
  "graph_neighborhood",
  "summary",
] as const;
export type RetrievalViewKind = (typeof RETRIEVAL_VIEW_KINDS)[number];

export type RetrievalEmbeddingConfig = {
  provider: string;
  model: string;
  revision: string;
  dimension: number;
  normalize: boolean;
  queryInstruction?: string;
  documentInstruction?: string;
};

export type RetrievalLexicalConfig = { backend: "postgres_fts" };
export type RetrievalFusionConfig = { algorithm: "rrf"; k: number };
export type RetrievalRerankerConfig = { provider: string; model: string; revision: string } | null;
export type RetrievalIndexConfig = { backend: "pgvector"; metric: "cosine" | "l2" | "inner_product" };

// A RetrievalProfile is a reusable recipe, not a canonical fact — it names which
// replaceable adapters (embedding/lexical/fusion/reranker/index) a retrieval compile run
// used, so the same Compiled World can be recompiled under a different profile without
// touching canonical truth. See supabase/migrations/0020_retrieval_foundation.sql.
export type RetrievalProfile = {
  id: string;
  workspaceKey: string;
  views: RetrievalViewKind[];
  embedding: RetrievalEmbeddingConfig;
  lexical: RetrievalLexicalConfig;
  fusion: RetrievalFusionConfig;
  reranker: RetrievalRerankerConfig;
  indexBackend: RetrievalIndexConfig["backend"];
  indexMetric: RetrievalIndexConfig["metric"];
  profileDigest: string;
};

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORKSPACE_KEY_PATTERN = /^pilot-[A-Za-z0-9]{1,16}$/;

function digestInputFor(profile: Omit<RetrievalProfile, "profileDigest">): unknown {
  const { id, workspaceKey, views, embedding, lexical, fusion, reranker, indexBackend, indexMetric } = profile;
  return { id, workspaceKey, views: [...views].sort(), embedding, lexical, fusion, reranker, indexBackend, indexMetric };
}

export function computeRetrievalProfileDigest(profile: Omit<RetrievalProfile, "profileDigest">): string {
  return `sha256:${sha256(canonicalize(digestInputFor(profile)))}`;
}

export const BGE_M3_BASELINE_PROFILE_ID = "bge-m3-v1";

// Production baseline/control per the Retrieval v1 decision: BGE-M3 dense + Postgres FTS
// lexical + RRF fusion + bge-reranker-v2-m3. Never hard-code these values at call sites —
// go through this profile (or a stored, tenant-selected one) so a challenger profile
// (Qwen3, a Korean-specific control, a customer's own embedding model) is a data change,
// not a code change.
export function buildBgeM3BaselineProfile(workspaceKey: string, revision = "unpinned"): RetrievalProfile {
  const withoutDigest: Omit<RetrievalProfile, "profileDigest"> = {
    id: BGE_M3_BASELINE_PROFILE_ID,
    workspaceKey,
    views: ["section", "claim", "entity", "table"],
    embedding: {
      provider: "huggingface",
      model: "BAAI/bge-m3",
      revision,
      dimension: 1024,
      normalize: true,
    },
    lexical: { backend: "postgres_fts" },
    fusion: { algorithm: "rrf", k: 60 },
    reranker: { provider: "huggingface", model: "BAAI/bge-reranker-v2-m3", revision },
    indexBackend: "pgvector",
    indexMetric: "cosine",
  };
  return { ...withoutDigest, profileDigest: computeRetrievalProfileDigest(withoutDigest) };
}

function validEmbeddingConfig(value: unknown): value is RetrievalEmbeddingConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config.provider === "string" && config.provider.length > 0 &&
    typeof config.model === "string" && config.model.length > 0 &&
    typeof config.revision === "string" && config.revision.length > 0 &&
    typeof config.dimension === "number" && Number.isInteger(config.dimension) &&
    config.dimension >= 1 && config.dimension <= 8192 &&
    typeof config.normalize === "boolean" &&
    (config.queryInstruction === undefined || typeof config.queryInstruction === "string") &&
    (config.documentInstruction === undefined || typeof config.documentInstruction === "string")
  );
}

function validRerankerConfig(value: unknown): value is RetrievalRerankerConfig {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  return (
    typeof config.provider === "string" && config.provider.length > 0 &&
    typeof config.model === "string" && config.model.length > 0 &&
    typeof config.revision === "string" && config.revision.length > 0
  );
}

// Fail-closed parser matching the DB check constraints in
// 0020_retrieval_foundation.sql exactly, so an invalid profile is rejected before it
// ever reaches a write.
export function parseRetrievalProfile(value: unknown): RetrievalProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !ID_PATTERN.test(candidate.id)) return null;
  if (typeof candidate.workspaceKey !== "string" || !WORKSPACE_KEY_PATTERN.test(candidate.workspaceKey)) return null;
  if (
    !Array.isArray(candidate.views) ||
    candidate.views.length < 1 ||
    candidate.views.length > RETRIEVAL_VIEW_KINDS.length ||
    !candidate.views.every((view) => (RETRIEVAL_VIEW_KINDS as readonly string[]).includes(view as string)) ||
    new Set(candidate.views).size !== candidate.views.length
  ) return null;
  if (!validEmbeddingConfig(candidate.embedding)) return null;
  if (
    !candidate.lexical || typeof candidate.lexical !== "object" ||
    (candidate.lexical as Record<string, unknown>).backend !== "postgres_fts"
  ) return null;
  const fusion = candidate.fusion as Record<string, unknown> | undefined;
  if (
    !fusion || typeof fusion !== "object" || fusion.algorithm !== "rrf" ||
    typeof fusion.k !== "number" || !Number.isInteger(fusion.k) || fusion.k < 1 || fusion.k > 1000
  ) return null;
  if (candidate.reranker !== undefined && !validRerankerConfig(candidate.reranker)) return null;
  if (candidate.indexBackend !== "pgvector") return null;
  if (!["cosine", "l2", "inner_product"].includes(candidate.indexMetric as string)) return null;
  if (typeof candidate.profileDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(candidate.profileDigest)) return null;

  const withoutDigest: Omit<RetrievalProfile, "profileDigest"> = {
    id: candidate.id,
    workspaceKey: candidate.workspaceKey,
    views: candidate.views as RetrievalViewKind[],
    embedding: candidate.embedding as RetrievalEmbeddingConfig,
    lexical: { backend: "postgres_fts" },
    fusion: fusion as RetrievalFusionConfig,
    reranker: (candidate.reranker ?? null) as RetrievalRerankerConfig,
    indexBackend: "pgvector",
    indexMetric: candidate.indexMetric as RetrievalIndexConfig["metric"],
  };
  if (computeRetrievalProfileDigest(withoutDigest) !== candidate.profileDigest) return null;
  return { ...withoutDigest, profileDigest: candidate.profileDigest };
}

export type EmbeddingRuntimeInfo = {
  provider: string;
  model: string;
  revision: string;
  dimension: number;
  normalize: boolean;
};

export type EmbeddingCompatibility =
  | { compatible: true }
  | { compatible: false; reason: string };

// The portability guard: a package pinned to one embedding space (model/revision/
// dimension/normalization) must never be silently queried with a different one — mixed
// spaces produce meaningless similarity scores with no error to show for it. Every
// mismatch here should surface to the caller as INCOMPATIBLE_RETRIEVAL_PROFILE, not a
// degraded-but-successful answer.
export function checkEmbeddingCompatibility(
  profile: RetrievalProfile,
  runtime: EmbeddingRuntimeInfo,
): EmbeddingCompatibility {
  const expected = profile.embedding;
  if (expected.provider !== runtime.provider || expected.model !== runtime.model) {
    return { compatible: false, reason: `profile expects ${expected.provider}/${expected.model}, runtime is ${runtime.provider}/${runtime.model}` };
  }
  if (expected.revision !== runtime.revision) {
    return { compatible: false, reason: `profile pins revision ${expected.revision}, runtime reports ${runtime.revision}` };
  }
  if (expected.dimension !== runtime.dimension) {
    return { compatible: false, reason: `profile expects ${expected.dimension}D, runtime produces ${runtime.dimension}D` };
  }
  if (expected.normalize !== runtime.normalize) {
    return { compatible: false, reason: `profile expects normalize=${expected.normalize}, runtime normalize=${runtime.normalize}` };
  }
  return { compatible: true };
}
