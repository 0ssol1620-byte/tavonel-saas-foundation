import type { ReviewableCollectionArtifact } from "./collection-download";

/** Read the package's own source manifest and cross-check its RAG document inventory. */
export function collectionSourceDocumentIds(artifact: ReviewableCollectionArtifact): string[] | null {
  try {
    const manifest = artifact.package.files.find(file => file.path === "source/collection-files.json");
    const documents = artifact.package.files.find(file => file.path === "rag/documents.jsonl");
    if (!manifest || !documents) return null;
    const sources: unknown = JSON.parse(manifest.content);
    const lines = documents.content.split("\n").filter(line => line.trim().length > 0);
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > 2000 || lines.length !== sources.length) return null;
    function ids(rows: unknown[]): string[] | null {
      const values: string[] = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || !("documentId" in row) || typeof row.documentId !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(row.documentId)) return null;
        values.push(row.documentId);
      }
      return new Set(values).size === values.length ? values.sort() : null;
    }
    const sourceIds = ids(sources);
    const documentIds = ids(lines.map(line => JSON.parse(line)));
    return sourceIds && documentIds && sourceIds.every((id, index) => id === documentIds[index]) ? sourceIds : null;
  } catch { return null; }
}
