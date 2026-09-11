import type { ReviewableCollectionArtifact } from "./collection-download";

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const VERSION_KEY = /^[a-f0-9]{64}$/;
/*
  One identifier, deliberately wide enough for both engines' schemes.

  `akc_cir.identity` writes `src_<sha256>` and `dv_<sha256>`; the TypeScript fallback compiler
  writes `<prefix>-<hex>`. Both pass this, which is exactly the problem the translation below
  exists to solve: a shape check cannot tell the two namespaces apart, so the ids have to be
  *resolved* rather than pattern-matched and forwarded.
*/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const COLLECTION_SOURCE_MANIFEST = "source/collection-files.json";

/**
 * One compiled source, named in both namespaces that exist for it.
 *
 * `documentId` and `versionKey` are the ids the package's own rows cite -- the manifest,
 * `rag/chunks.jsonl`, the graph CSVs. `productDocumentId` and `productVersionKey` are the same
 * source as the product knows it: the id `/api/documents/<id>/source` opens, and the id
 * `connector_document_bindings` is keyed on. For a package the TypeScript compiler wrote the two
 * pairs are the same strings. For one the Core wrote they are not, and nothing may invent the
 * translation -- so it is a join on the immutable content digest both sides already record.
 */
export type CollectionSourceBinding = {
  documentId: string;
  versionKey: string;
  inputSha256: string;
  productDocumentId: string;
  productVersionKey: string;
};

/**
 * Whether this source manifest was written by the Python Core rather than the TS compiler.
 *
 * The two write different records at the same path: the Core writes `documentId` (its `src_`
 * source id), `documentVersionId` and `sourceSha256`; the fallback writes `documentId` (the
 * product's), `versionKey`, `inputSha256` and `sourceImmutableKey`. Asked as "does any row look
 * like the Core's" rather than "did the join succeed", because those are different questions and
 * only the first one may be answered by looking at shape: a Core manifest whose join fails has
 * to refuse, not fall back to reading its ids as if they were the product's.
 */
function isCoreSourceManifest(rows: readonly unknown[]) {
  return rows.some((row) => row !== null && typeof row === "object" &&
    ("documentVersionId" in row || "sourceSha256" in row));
}

/** The manifest rows, or null when there is no readable manifest at the reserved path. */
function sourceManifestRows(artifact: unknown): unknown[] | null {
  if (!artifact || typeof artifact !== "object") return null;
  const files = ((artifact as Record<string, unknown>).package as { files?: unknown } | undefined)?.files;
  if (!Array.isArray(files)) return null;
  const manifest = files.find((file) =>
    Boolean(file) && typeof file === "object" &&
    (file as { path?: unknown }).path === COLLECTION_SOURCE_MANIFEST) as { content?: unknown } | undefined;
  if (!manifest || typeof manifest.content !== "string") return null;
  let rows: unknown;
  try {
    rows = JSON.parse(manifest.content);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2_000) return null;
  return rows;
}

/**
 * Whether this package names its sources in the Core's identity scheme.
 *
 * Exported because `coreCollectionSourceBinding` answers `null` to two different questions --
 * "not a Core package" and "a Core package whose join failed" -- and a caller that cannot tell
 * those apart reads the Core's ids as the product's on exactly the packages where that is wrong.
 * Reading the *shape* off the manifest is safe; reading the ids off it is not, which is the
 * distinction the note on `isCoreSourceManifest` draws.
 */
export function isCoreCollectionPackage(artifact: unknown): boolean {
  const rows = sourceManifestRows(artifact);
  return rows !== null && isCoreSourceManifest(rows);
}

/**
 * Read a Core V2 package's source manifest, joined to the product's documents by content digest.
 *
 * `null` when this is not a Core manifest, and when any row fails to resolve to exactly one
 * product document. Never a partial binding: a source that cannot be named in the product's
 * namespace is a source whose permissions cannot be checked and whose pages cannot be opened,
 * and both of those refuse rather than proceed on an id the rest of the product cannot resolve.
 */
export function coreCollectionSourceBinding(artifact: unknown): CollectionSourceBinding[] | null {
  const rows = sourceManifestRows(artifact);
  if (rows === null) return null;
  const value = artifact as Record<string, unknown>;
  if (!isCoreSourceManifest(rows)) return null;
  if (!Array.isArray(value.sourceDocuments) || value.sourceDocuments.length === 0) return null;

  const productByDigest = new Map<string, { documentId: string; versionKey: string }>();
  for (const raw of value.sourceDocuments) {
    if (!raw || typeof raw !== "object") return null;
    const document = raw as Record<string, unknown>;
    if (
      typeof document.documentId !== "string" || !IDENTIFIER.test(document.documentId) ||
      typeof document.versionKey !== "string" || !VERSION_KEY.test(document.versionKey) ||
      typeof document.inputSha256 !== "string" || !SHA256.test(document.inputSha256) ||
      document.inputSha256 !== `sha256:${document.versionKey}` ||
      // Two documents under one digest would make the join ambiguous, so it is not attempted.
      productByDigest.has(document.inputSha256)
    ) return null;
    productByDigest.set(document.inputSha256, { documentId: document.documentId, versionKey: document.versionKey });
  }

  const binding: CollectionSourceBinding[] = [];
  const sourceIds = new Set<string>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    const digest = typeof row.sourceSha256 === "string" ? row.sourceSha256 : "";
    const product = productByDigest.get(digest);
    if (
      typeof row.documentId !== "string" || !IDENTIFIER.test(row.documentId) || sourceIds.has(row.documentId) ||
      typeof row.documentVersionId !== "string" || !IDENTIFIER.test(row.documentVersionId) ||
      !SHA256.test(digest) || !product
    ) return null;
    sourceIds.add(row.documentId);
    binding.push({
      documentId: row.documentId,
      versionKey: row.documentVersionId,
      inputSha256: digest,
      productDocumentId: product.documentId,
      productVersionKey: product.versionKey,
    });
  }
  return binding;
}

/**
 * Read the package's own source manifest, cross-check its RAG document inventory, and answer in
 * the namespace the permission check needs.
 *
 * The translation is a permission property, not a cosmetic one. Every caller feeds this list to
 * `checkConnectorSourceAccess`, whose RPC matches `connector_document_bindings.document_id` --
 * the *product's* document id. A Core V2 package's manifest names its sources in the Core's
 * identity scheme (`src_<sha256>`), which passes every shape check here and matches no binding
 * row, so forwarding those ids made "nothing is blocked" indistinguishable from "nothing was
 * checked": a suspended connector source would not have stopped a read of the World compiled
 * from it. Translating is what makes the check mean something, and a Core manifest that cannot
 * be translated answers `null` rather than falling through to the product-namespace reading.
 */
export function collectionSourceDocumentIds(artifact: ReviewableCollectionArtifact): string[] | null {
  try {
    const manifest = artifact.package.files.find(file => file.path === COLLECTION_SOURCE_MANIFEST);
    const documents = artifact.package.files.find(file => file.path === "rag/documents.jsonl");
    if (!manifest || !documents) return null;
    const sources: unknown = JSON.parse(manifest.content);
    const lines = documents.content.split("\n").filter(line => line.trim().length > 0);
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > 2000 || lines.length !== sources.length) return null;
    function ids(rows: unknown[]): string[] | null {
      const values: string[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || !("documentId" in row) || typeof row.documentId !== "string" ||
            !IDENTIFIER.test(row.documentId)) return null;
        values.push(row.documentId);
      }
      return new Set(values).size === values.length ? values.sort() : null;
    }
    const sourceIds = ids(sources);
    const documentIds = ids(lines.map(line => JSON.parse(line)));
    if (!sourceIds || !documentIds || !sourceIds.every((id, index) => id === documentIds[index])) return null;
    if (!isCoreSourceManifest(sources)) return sourceIds;

    const binding = coreCollectionSourceBinding(artifact);
    if (!binding) return null;
    const productById = new Map(binding.map(item => [item.documentId, item.productDocumentId]));
    const translated = sourceIds.map(id => productById.get(id));
    if (translated.some(id => id === undefined)) return null;
    const product = (translated as string[]).sort();
    return new Set(product).size === product.length ? product : null;
  } catch { return null; }
}
