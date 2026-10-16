import { CORPUS_MAX_DOCUMENTS } from "./compile-limits";

/** Private qualification path; neither flag nor a schema maximum is release evidence. */
export function globalCollectionCompileEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.TAVONEL_GLOBAL_COLLECTION_COMPILE === "1"
    && env.TAVONEL_CORE_V2_REVISION_COMPILE === "1"
    && /^sha256:[a-f0-9]{64}$/.test(env.TAVONEL_GLOBAL_COLLECTION_CORE_RELEASE_SHA256 ?? "");
}

export const GLOBAL_COLLECTION_MAX_BYTES = 4 * 1024 * 1024;
export const GLOBAL_COLLECTION_MAX_REGIONS = 10_000;
export const GLOBAL_COLLECTION_KEY_PREFIX = "global-corpus/";

export function judgeGlobalCollectionInput(documents: readonly { documentId: string; regions?: readonly unknown[] }[]) {
  return documents.length > 0 && documents.length <= CORPUS_MAX_DOCUMENTS
    && new Set(documents.map((document) => document.documentId)).size === documents.length
    && documents.reduce((sum, document) => sum + (document.regions?.length ?? 0), 0) <= GLOBAL_COLLECTION_MAX_REGIONS
    && Buffer.byteLength(JSON.stringify(documents), "utf8") <= GLOBAL_COLLECTION_MAX_BYTES;
}
