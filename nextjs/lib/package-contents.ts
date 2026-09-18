import { REQUIRED_PACKAGE_PATHS } from "./collection-download";

/*
  One inventory of the signed package, for every page that describes it.

  G3-007 found three: /developers listed 14 paths, /docs/exports listed 9 and /docs/use-with-ai
  listed 11. `canonical/model.json` was in one and absent from two; `AGENTS.md`, `README.md`,
  `manifest/` and `signatures/` were in one of three. A reader comparing two pages could not tell
  which was the archive, and a reader checking a real archive against either would find it
  disagreed. The audit's own note is the give-away: only one page listed `canonical/model.json`,
  and the exporter does not write it -- so the most-detailed list was the one with an invented
  file in it.

  The list is the exporter's. `REQUIRED_PACKAGE_PATHS` is what `buildSignedCollectionArchive`
  refuses to emit without, and PACKAGE_EXTRAS is the six the same function adds on the way out.
  `packageFile()` throws on a path with no purpose, so a file added to the exporter arrives here
  as a build failure rather than as a blank cell on three pages.
*/

/** Written by the exporter on the way out, alongside the required set. */
const PACKAGE_EXTRAS = [
  "README.md",
  "AGENTS.md",
  "manifest/ai-entrypoint.json",
  "manifest/candidate-world.json",
  "manifest/export-manifest.json",
  "signatures/export-manifest.ed25519.json",
] as const;

const PURPOSE: Record<string, string> = {
  "ontology/knowledge.jsonld": "JSON-LD semantic projection, for linked-data consumers.",
  "ontology/knowledge.ttl": "The same projection in Turtle, for RDF and SPARQL.",
  "graph/nodes.csv": "Graph nodes, for a plain graph import.",
  "graph/relationships.csv": "Graph edges, with the relation each one carries.",
  "rag/documents.jsonl": "Document-level retrieval records.",
  "rag/chunks.jsonl": "Retrieval chunks, each bound to the source location it came from.",
  "provenance/activities.jsonl": "Lineage for every compiled artifact in the package.",
  "validation/report.json": "The validation status, and any reason the result still requires review.",
  "README.md": "Where a person starts, and which consumption path to take.",
  "AGENTS.md": "What a filesystem-capable agent reads first.",
  "manifest/ai-entrypoint.json": "The machine-readable map of the entrypoints and the grounding rules.",
  "manifest/candidate-world.json": "The compiled World this archive was written from — objects and relations, canonically ordered.",
  "manifest/export-manifest.json": "A digest for every file above. The signature is made over these bytes.",
  "signatures/export-manifest.ed25519.json": "The detached Ed25519 signature over that manifest.",
};

export const PACKAGE_PATHS: readonly string[] = [...REQUIRED_PACKAGE_PATHS, ...PACKAGE_EXTRAS]
  .slice()
  .sort((left, right) => left.localeCompare(right));

export function packagePurpose(path: string): string {
  const purpose = PURPOSE[path];
  if (!purpose) throw new Error(`the export writes ${path} and nothing says what it is for`);
  return purpose;
}

/** `[path, purpose]` rows, which is the shape both the docs tables and /developers want. */
export const PACKAGE_CONTENTS: ReadonlyArray<readonly [string, string]> =
  PACKAGE_PATHS.map((path) => [path, packagePurpose(path)] as const);
