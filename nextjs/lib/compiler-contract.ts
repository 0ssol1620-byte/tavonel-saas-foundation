/**
 * The Compiler Contract, as data with a state on every clause.
 *
 * The contract is eight promises about what a compile guarantees. Four of them describe things
 * this deployment does; four describe things it intends to do and does not yet. A page that
 * printed all eight in the same voice would be a page that lies by layout -- the reader has no
 * way to tell which half they are reading -- so the state is part of the record here rather
 * than a badge chosen in the markup.
 *
 * The vocabulary is not invented for this page. `demonstrated` and `qualified` are two of the
 * six states in `claim-state.ts`, and `direction` is the word the live capability grid in
 * `capabilities.ts` already uses for exactly this: built and shown, not offered as shipped.
 * Reusing them is what keeps one product from having three different ways to say "not proven".
 *
 * The rule that makes this fail closed is `qualified` requiring a receipt. Nothing here carries
 * one, so nothing here is qualified, and the only way to change that is to attach an artifact
 * -- not to edit an adjective. `compiler-contract.test.ts` enforces it.
 */

import { CLAIM_STATE } from "./claim-state";
import { readCapabilities } from "./capabilities";

/**
 * The exact word the capability grid uses, read from the grid rather than retyped.
 *
 * `readCapabilities(null, false)` is the grid before any deployment status arrives: the gated
 * rows report that they are still reading, and the two rows that are Direction regardless of
 * deployment state -- knowledge architecture and selective recompilation -- are already there
 * with their final wording. Taking the word from there means a rename in the grid shows up as a
 * failing test here instead of as two pages disagreeing in public.
 */
const DIRECTION_STATE =
  readCapabilities(null, false).find((capability) => capability.tone === "direction")?.state ?? "Direction";

export type ContractClauseState = "qualified" | "demonstrated" | "direction";

export type ContractStateVocabulary = {
  label: string;
  meaning: string;
};

export const CONTRACT_STATE: Record<ContractClauseState, ContractStateVocabulary> = {
  qualified: {
    label: CLAIM_STATE.qualified.label,
    meaning: CLAIM_STATE.qualified.meaning,
  },
  demonstrated: {
    label: CLAIM_STATE.demonstrated.label,
    meaning: CLAIM_STATE.demonstrated.meaning,
  },
  direction: {
    label: DIRECTION_STATE.toUpperCase(),
    meaning: "An intended property of the compiler contract. Not offered as a shipped capability in this deployment.",
  },
};

export type ContractClause = {
  /** Stable slug, used as the DOM id a deep link can address. */
  id: string;
  name: string;
  /** One line that says what the clause promises, before the paragraph explains it. */
  promise: string;
  body: string;
  state: ContractClauseState;
  /**
   * Where the reader can check the claim: a file, a route or a package path in this repository.
   * Present on every clause, because a clause whose state cannot be checked is an opinion.
   */
  evidence: string;
  /**
   * Required before a clause may be `qualified`: the artifact that qualified it. Absent
   * everywhere today, which is why nothing on this page is qualified.
   */
  receipt?: string;
};

/*
  Clause 5 keeps the capability grid's sentence.

  "Not offered as a shipped capability" is the phrase the live grid uses for selective
  recompilation, and the test asserts the substring appears in both files. The grid's own
  wording says "Demonstrated above on fixture data", where "above" points at the landing
  demonstration it sits underneath; there is no demonstration above this clause, so the
  reference is written out rather than copied into a place where it dangles.
*/
export const CONTRACT_CLAUSES: readonly ContractClause[] = [
  {
    id: "evidence-preserving",
    name: "Evidence-preserving",
    promise: "Every promoted fact resolves to a region of a page of a source revision.",
    body:
      "Every relation is typed and carries the evidence that justifies it, and a claim reaches that evidence through a supported_by relation to one exact document version — identified by the sha256 of the bytes that were read, not by a filename. The coordinates live on the region: each retrieval unit names a bounding box on a numbered page of that version and lists the claims and entities found inside it, so a changed region can be read back to what stands on it. Where an anchor is missing the compiler abstains rather than inventing one — a document version whose regions fail validation stops the compile with OCR_BINDING_INVALID, and a document read without regions emits no retrieval unit rather than a guessed page or box. Resolving every evidence reference in a finished package, and reporting EVIDENCE_DANGLING where one does not, is an offline check anyone holding the package can run — not a gate on the emit path.",
    state: "demonstrated",
    evidence: "lib/collection-compiler.ts (rag/chunks.jsonl carries pageNumber1, bbox1000 and sourceVersionId), and scripts/compiled-world/validate.mjs — pnpm verify:package — exercised against the compiled /explore sample in lib/compiled-world-validator.test.ts",
  },
  {
    id: "stable-semantic-identity",
    name: "Stable semantic identity",
    promise: "The same thing named four ways is one object, or it is left unresolved.",
    body:
      "FP-200, Feedwater Pump 200, Pump FP200 and P-200 are one piece of equipment in the plant and four strings in the corpus. An object here carries a stable key derived from content, so recompiling the same source lands on the same object rather than a new one. Merging two different strings into one object is the part this deployment does not do automatically: where the evidence does not settle identity, the compiler is required to leave it unresolved for a person rather than guess, and automatic resolution across sources is a direction.",
    state: "direction",
    evidence: "lib/world-read-model.ts (stableKey), lib/entity-extraction-quality.test.ts",
  },
  {
    id: "typed-dependencies",
    name: "Typed dependencies",
    promise: "The edges between knowledge units are typed and carry their own evidence.",
    body:
      "Three relation types leave the compiler, and every one of them is typed and carries the evidence ids that justify it: a document discusses_topic, a document mentions_entity, and a claim is supported_by the evidence for one exact document version. They are written as graph/relationships.csv under the header id, subject_id, predicate, object_id, evidence_ids, so a relation naming no evidence is not a row this emitter can produce. Two of the three are heuristics rather than read semantics: the topic edge comes from a small set of keyword rules and the entity edge from a capitalised-token scan, both run across the whole document text, which makes those two document-level co-occurrence — said here rather than left for a reader to assume that a typed edge means a read one. A retrieval unit names the claims and entities found inside its own region, and the gate in front of retrieval rejects a unit with nothing bound to it; the unit carries no relation id. Justifying a relation by the claim it rests on, and projecting a relation into the retrieval unit an answer is built from, are the two rungs this deployment does not build.",
    state: "demonstrated",
    evidence: "lib/collection-compiler.ts (three edge types, each carrying evidenceIds, emitted to graph/relationships.csv), lib/world-gate.ts (NO_EVIDENCE_BOUND)",
  },
  {
    id: "temporal-integrity",
    name: "Temporal integrity",
    promise: "A fact that has been replaced cannot be served as current.",
    body:
      "A compile produces a candidate version. A person activates it, and the version it replaced stays intact and readable rather than being overwritten. The gate in front of retrieval rejects any unit belonging to a superseded world version, so a superseded fact cannot reach an answer even if it is the closest match. Reading the world as it stood on a past date, and classifying which authority governed a fact at that date, are directions: the gate checks the active version, not a point in time.",
    state: "demonstrated",
    evidence: "lib/world-gate.ts (SUPERSEDED_WORLD_VERSION), WorldHistoryEntry in lib/world-read-model.ts",
  },
  {
    id: "selective-recompilation",
    name: "Selective recompilation",
    promise: "Two changed pages rebuild what depends on them, not the corpus.",
    body:
      "Two pages change in a corpus of five thousand documents. The units that depend on those pages are rebuilt and everything else is carried over untouched, which is the economic argument for compiling knowledge rather than re-indexing it. Demonstrated on fixture data. Not offered as a shipped capability in this deployment: a compile here rebuilds the collection it is given.",
    state: "direction",
    evidence: "lib/capabilities.ts, which labels this row Direction on the live capability grid",
  },
  {
    id: "full-rebuild-equivalence",
    name: "Full-rebuild equivalence",
    promise: "A selective result must match a full rebuild, or it does not publish.",
    body:
      "An incremental update that is merely fast is dangerous, because nothing announces the moment it starts diverging from what a full rebuild would have produced. The contract is that the two are compared and that a mismatch refuses to publish rather than shipping a world that looks finished. This deployment publishes no equivalence receipt, so the comparison is stated here as the rule the compiler is written to, not as a result.",
    state: "direction",
    evidence: "no equivalence receipt is published on this branch",
  },
  {
    id: "multi-model-verification",
    name: "Multi-model verification",
    promise: "A reader's own confidence is not evidence that it read the page correctly.",
    body:
      "A single OCR or vision model grading itself is the failure this clause exists to prevent: it is most confident exactly where a degraded scan has misled it. The contract asks for an independent second read, explicit disagreement detection between the two, escalation to a stronger reader where they disagree, and one canonical result at the end. Reading is single-pass in this deployment; low-confidence regions are carried forward and arrive in review rather than being re-read by a second model.",
    state: "direction",
    evidence: "lib/pipeline.ts — one read stage per document version, whose held state routes a document to a person rather than to a second reader",
  },
  {
    id: "portable-world",
    name: "Portable World",
    promise: "A compiled World leaves as a signed package you can verify without us.",
    body:
      "The canonical model leaves as JSON, the ontology as Turtle and JSON-LD, the graph as CSV, the retrieval corpus and the provenance events as JSON Lines, and the sources as Markdown for reading. The archive carries a signed file inventory and the public verification key, and it is checked offline with pnpm verify:export against a fingerprint obtained from somewhere other than the archive. Knowledge that can only be read inside the tool that made it is not an asset.",
    state: "demonstrated",
    evidence: "lib/collection-download.ts, lib/export-signing.ts, scripts/verify-signed-export.mjs, GET /api/export/trust",
  },
];

/** What a compiled package contains today, by the path the format is written to. */
export const PACKAGE_FORMATS: ReadonlyArray<readonly [string, string]> = [
  ["JSON", "canonical/model.json"],
  ["Turtle", "ontology/knowledge.ttl"],
  ["JSON-LD", "ontology/knowledge.jsonld"],
  ["CSV", "graph/nodes.csv, graph/relationships.csv"],
  ["JSON Lines", "rag/chunks.jsonl, provenance/activities.jsonl"],
  ["Markdown", "obsidian/Sources/*.md"],
];

export type InteropStandard = {
  name: string;
  state: Extract<ContractClauseState, "demonstrated" | "direction">;
  note: string;
};

/*
  The interchange standards, split by whether a compile emits one today.

  The temptation on a page like this is a row of nine logos, which tells a reader that all nine
  are supported. Six of the nine names below are the internal model leaving through a standard
  serialisation; three are vocabularies this product references but does not emit, and PROV-O is
  the one most likely to be misread -- the prefix is declared and one term is used, which is not
  a provenance graph.
*/
export const INTEROP_STANDARDS: readonly InteropStandard[] = [
  {
    name: "RDF",
    state: "demonstrated",
    note: "The compiled model is emitted as RDF triples: objects typed under a tavonel namespace, relations as predicates between them.",
  },
  {
    name: "Turtle",
    state: "demonstrated",
    note: "The RDF serialisation in every package, at ontology/knowledge.ttl, with rdfs and prov prefixes declared.",
  },
  {
    name: "JSON-LD",
    state: "demonstrated",
    note: "At ontology/knowledge.jsonld, with a context mapping label to rdfs:label and evidence to prov:wasDerivedFrom.",
  },
  {
    name: "OWL 2",
    state: "direction",
    note: "No OWL axioms are emitted. Classes and properties are described, not constrained by an ontology a reasoner could act on.",
  },
  {
    name: "SHACL",
    state: "direction",
    note: "Package validation is a rule set in this repository with named error codes, not a published shapes graph.",
  },
  {
    name: "PROV-O",
    state: "direction",
    note: "The vocabulary is referenced — the prov prefix in the Turtle, prov:wasDerivedFrom in the JSON-LD context — but a PROV-O activity graph is not emitted. Provenance events ship as JSON Lines.",
  },
  {
    name: "OpenLineage",
    state: "direction",
    note: "Compile runs are recorded as receipts in this product's own shape. No OpenLineage event is emitted to a lineage backend.",
  },
  {
    name: "OpenAPI",
    state: "demonstrated",
    note: "The public API describes itself at /api/openapi and /openapi.json, generated from the same contract the routes are tested against.",
  },
  {
    name: "MCP",
    state: "demonstrated",
    note: "A read-only stdio server is published at /developer/tavonel-mcp.mjs. It exposes eight tools and refuses to start if a write tool is added.",
  },
];

export function clause(id: string): ContractClause {
  const found = CONTRACT_CLAUSES.find((entry) => entry.id === id);
  if (!found) throw new Error(`no compiler-contract clause "${id}"`);
  return found;
}

/**
 * A clause counts as claimed-as-working only when it is qualified, which requires a receipt.
 *
 * Deliberately not "demonstrated or better": demonstrated means built and shown on a declared
 * sample, and this product's whole argument is that those are different words.
 */
export function isClaimedCapability(entry: ContractClause): boolean {
  return entry.state === "qualified" && typeof entry.receipt === "string" && entry.receipt.length > 0;
}
