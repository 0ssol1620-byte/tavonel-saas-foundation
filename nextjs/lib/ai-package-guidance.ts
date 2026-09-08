export type AiPackageLifecycle = "candidate" | "review_required";

export function buildAiPackageGuidance(input: {
  collectionId: string;
  manifestDigest: string;
  lifecycle: AiPackageLifecycle;
  worldStateId?: string | null;
}) {
  const reviewWarning = input.lifecycle === "review_required"
    ? "This package requires human review. Do not treat it as approved organizational truth."
    : "This is a signed compiled candidate. Confirm active-world status in TAVONEL before treating it as the current organizational world.";

  const readme = `# TAVONEL Portable Knowledge Package

Collection: ${input.collectionId}
Manifest: ${input.manifestDigest}
Lifecycle: ${input.lifecycle}

## Start here

This folder is designed to be useful to both people and AI tools. ${reviewWarning}

If your AI or agent can read local files, give it access to this extracted folder and tell it:

> Read AGENTS.md in this folder first. Use manifest/ai-entrypoint.json to locate the compiled knowledge and evidence. Answer from the package, preserve uncertainty, and cite the source evidence you relied on.

A filesystem path by itself does not grant an AI access. The AI application must support local-folder access, uploads, a connector, MCP, or another tool that can read the files.

## Which files to use

- \`rag/chunks.jsonl\` — portable retrieval units for generic RAG/search systems.
- \`rag/documents.jsonl\` — document-level retrieval records.
- \`ontology/knowledge.jsonld\` — semantic knowledge graph for JSON-LD-capable tools.
- \`ontology/knowledge.ttl\` — Turtle/RDF representation for graph and ontology tools.
- \`graph/nodes.csv\` and \`graph/relationships.csv\` — simple graph import surfaces.

## Ontology quickstart

The ontology files are semantic projections of this Compiled World, not replacements for the source evidence. Use \`knowledge.jsonld\` when the target accepts JSON-LD or linked-data JSON. Use \`knowledge.ttl\` when the target is an RDF store, SPARQL system, or ontology/RDF tool. Use the CSV graph when the target expects a simple property-graph import.

TAVONEL RDF resources use stable \`urn:tavonel:<id>\` identifiers. Preserve those ids when joining ontology records back to graph, provenance, validation, or evidence. JSON-LD carries node evidence references; the Turtle projection carries node types, labels, and compiled relations. For source locators and authoritative grounding, keep the provenance and validation files beside the ontology.

This export is an RDF/JSON-LD projection of the compiled knowledge model; do not assume it is a hand-authored OWL/TBox schema. When a newer World becomes active, import the newer signed projection or use the live TAVONEL MCP/API instead of mutating this signed snapshot in place.

Detailed import guidance: https://tavonel.com/docs/ontology-output
- \`provenance/activities.jsonl\` — lineage/provenance records.
- \`validation/report.json\` — validation status; read this before using the package as authoritative context.
- \`manifest/export-manifest.json\` and \`signatures/export-manifest.ed25519.json\` — integrity verification.

## Best way to use it

For a live production AI, TAVONEL MCP/API is the preferred integration because it can preserve the current active revision, retrieval behavior, access controls, and evidence resolution. The ZIP is the portable/offline interoperability surface.

For a desktop coding/research agent with folder access, extracting the ZIP and telling the agent to read \`AGENTS.md\` first is the shortest safe workflow. For web chat products without folder access, upload the ZIP if supported or upload the relevant structured files above.

## Grounding rules

Do not invent facts that are absent from the package. Distinguish compiled claims from source evidence. When evidence is missing or conflicting, say so. Do not silently turn \`review_required\` output into accepted truth.
`;

  const agents = `# TAVONEL AI Instructions

You are working with a TAVONEL portable compiled-knowledge package.

1. Read \`manifest/ai-entrypoint.json\` and \`validation/report.json\` before using the knowledge files.
2. Treat \`review_required\` as non-authoritative and surface its review reasons.
3. Prefer compiled structured knowledge for navigation, but ground factual answers in the package's evidence/provenance records.
4. Preserve source identity, version, temporal qualifiers, and uncertainty. Never invent a missing locator, date, relationship, or claim.
5. Use \`rag/chunks.jsonl\` for generic retrieval, \`ontology/knowledge.jsonld\` or \`ontology/knowledge.ttl\` for semantic reasoning, and \`graph/*.csv\` for simple graph import. Preserve \`urn:tavonel:<id>\` identifiers and join ontology facts back to provenance/evidence before presenting them as grounded facts.
6. When citing an answer, name the evidence/source locator available in the package rather than citing this instruction file.
7. If this folder is only a portable snapshot and the task requires the latest organizational state, prefer the live TAVONEL MCP/API when available.
`;

  const entrypoint = {
    schemaVersion: "tavonel.ai_entrypoint.v1",
    collectionId: input.collectionId,
    manifestDigest: input.manifestDigest,
    lifecycle: input.lifecycle,
    worldStateId: input.worldStateId ?? null,
    authoritativeUse: input.lifecycle === "review_required" ? "blocked_pending_review" : "verify_active_world_status",
    preferredLiveIntegration: "tavonel_mcp_or_api",
    portableEntrypoints: {
      retrievalChunks: "rag/chunks.jsonl",
      retrievalDocuments: "rag/documents.jsonl",
      knowledgeJsonLd: "ontology/knowledge.jsonld",
      knowledgeTurtle: "ontology/knowledge.ttl",
      graphNodes: "graph/nodes.csv",
      graphRelationships: "graph/relationships.csv",
      provenance: "provenance/activities.jsonl",
      validation: "validation/report.json",
      humanGuide: "README.md",
      agentGuide: "AGENTS.md",
    },
    groundingRules: [
      "read_validation_before_authoritative_use",
      "preserve_source_and_version_identity",
      "preserve_temporal_qualifiers_and_uncertainty",
      "cite_package_evidence_when_available",
      "do_not_invent_missing_evidence",
    ],
  } as const;

  return { readme, agents, entrypoint };
}

/*
  The same two answers, in the workspace UI as well as inside the ZIP.

  §16.2 asks for the journey and §16.3 for an honest description of what the package is. Both
  are declared here, beside the generator that writes the files, so the screen cannot advertise
  a file the export does not produce. `ai-package-guidance.test.ts` asserts every path below
  appears in `collection-download.ts`, which is what actually assembles the archive.
*/

/** §16.2 — how a compiled World reaches an AI, in the order it happens. */
export const AI_USE_JOURNEY = [
  "Compile and activate a World",
  "Create API/MCP access",
  "Query the active World",
  "Receive evidence-bound context",
  "Follow citations back to source",
] as const;

/** §16.3 — every file the signed export writes, and nothing else. */
export const AI_PACKAGE_CONTENTS = [
  { path: "README.md", purpose: "How a person, or an agent with folder access, should start." },
  { path: "AGENTS.md", purpose: "Grounding rules an AI reads first." },
  { path: "manifest/ai-entrypoint.json", purpose: "Machine entrypoint: lifecycle, and where each artifact is." },
  { path: "manifest/candidate-world.json", purpose: "The immutable candidate this package was cut from." },
  { path: "manifest/export-manifest.json", purpose: "Path, size and sha256 of every file in the archive." },
  { path: "signatures/export-manifest.ed25519.json", purpose: "Signature over that manifest." },
  { path: "rag/chunks.jsonl", purpose: "Retrieval units for a RAG or search system." },
  { path: "rag/documents.jsonl", purpose: "Document-level retrieval records." },
  { path: "ontology/knowledge.jsonld", purpose: "JSON-LD semantic projection of the compiled World." },
  { path: "ontology/knowledge.ttl", purpose: "Turtle/RDF projection for graph and SPARQL tools." },
  { path: "graph/nodes.csv", purpose: "Property-graph nodes." },
  { path: "graph/relationships.csv", purpose: "Property-graph relations." },
  { path: "provenance/activities.jsonl", purpose: "Lineage records for how each claim was produced." },
  { path: "validation/report.json", purpose: "Validation status. Read before treating the package as authoritative." },
] as const;

/** §16.3 — what the package is, said without overclaiming what a model will do with it. */
export const AI_PACKAGE_SUMMARY =
  "A compiled world that helps AI understand your organization accurately and currently. Extracting it does not make a model understand your organization on its own: the AI has to be able to read the files, and it answers well only when it follows the evidence they carry.";
