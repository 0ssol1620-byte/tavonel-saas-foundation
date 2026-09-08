/**
 * The Compiled World Package validator.
 *
 * Masterplan 22.3 asks for a package contract that someone outside TAVONEL can check: schema
 * version, stable IDs, source version, hashes, evidence coordinate system, lifecycle,
 * signatures, compatibility. `scripts/verify-signed-export.mjs` already answers the envelope
 * half of that question -- is this archive intact, and did we sign it. This answers the other
 * half, which nothing did: is what is inside the archive a coherent Compiled World.
 *
 * The distinction matters because the two fail differently. A tampered archive fails loudly at
 * the signature. A package whose relations point at objects that are not there, or whose
 * evidence sits outside the page it claims, verifies perfectly and is still wrong -- and the
 * consumer that notices is a customer's retrieval pipeline, months later, on their material.
 *
 *   node scripts/compiled-world/validate.mjs --package <dir | package.zip | artifact.json>
 *   node scripts/compiled-world/validate.mjs --package ./world --require-signature
 *
 * Exit 0 when there are no errors, 1 otherwise. Warnings never change the exit code: they are
 * for defects that are real but whose fix would change the bytes of every artifact ever
 * compiled, which is a decision with a receipt attached, not something a validator gets to make.
 *
 * Deliberately not checked: whether the compiler *should* have produced these objects. A
 * validator that judged extraction quality would be grading the model, and this grades the
 * contract. Nothing here reads a network, and nothing here writes.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

export const CANONICAL_MODEL_SCHEMA = "akc.canonical-knowledge-model.v1";
export const SUPPORTED_BLUEPRINTS = new Set(["generic-mixed-corpus@1.0.0"]);

/* The graph projection's column names, spelled here and in lib/collection-compiler.ts. */
export const GRAPH_NODE_HEADER = "id,kind,label,document_id";
export const GRAPH_EDGE_HEADER = "id,subject_id,predicate,object_id,evidence_ids";

/** The roots a package may contain. `manifest` and `signatures` appear only once it is signed. */
const PACKAGE_ROOTS = new Set([
  "source", "canonical", "obsidian", "ontology", "graph", "rag", "provenance", "validation",
  "manifest", "signatures",
]);

const REQUIRED_FILES = [
  "source/collection-files.json",
  "canonical/model.json",
  "ontology/knowledge.ttl",
  "ontology/knowledge.jsonld",
  "graph/nodes.csv",
  "graph/relationships.csv",
  "rag/documents.jsonl",
  "rag/chunks.jsonl",
  "provenance/activities.jsonl",
  "validation/report.json",
];

/** Every object kind, and the prefix its stable id must carry. */
const ID_PREFIX = {
  Document: "document",
  Topic: "topic",
  Entity: "entity",
  Claim: "claim",
  Evidence: "evidence",
};

const STABLE_ID = /^[a-z-]+-[a-f0-9]{32}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const VERSION_KEY = /^[a-f0-9]{64}$/;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 4096;

/* ------------------------------------------------------------------ reading */

async function readDirectoryPackage(root) {
  const files = new Map();
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, path);
      else if (entry.isFile()) {
        if (files.size >= MAX_FILES) throw new Error(`package contains more than ${MAX_FILES} files`);
        files.set(path, await readFile(full, "utf8"));
      }
    }
  };
  await walk(root, "");
  return files;
}

/*
  The zip decoder is loaded only when a zip is actually opened.

  `lib/collection-compiler.ts` now imports `validateCompiledWorldPackage` on the emit path, so
  everything this module pulls in at load time is pulled into the compile path too. Reading an
  archive is a CLI concern; the checker itself is pure. Importing fflate here keeps the emitter
  free of an archive decoder it never runs.
*/
async function readZipPackage(bytes) {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("archive exceeds the 64 MiB validation limit");
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(bytes);
  const files = new Map();
  for (const [path, content] of Object.entries(entries)) {
    if (path.endsWith("/")) continue;
    if (files.size >= MAX_FILES) throw new Error(`package contains more than ${MAX_FILES} files`);
    files.set(path, Buffer.from(content).toString("utf8"));
  }
  return files;
}

/**
 * A candidate artifact carries its package inline, so the same checks run before anything is
 * ever written to disk. This is what the unit tests use, and what a server-side gate would.
 */
export function filesFromArtifact(artifact) {
  const files = new Map();
  for (const file of artifact?.package?.files ?? []) files.set(file.path, file.content);
  return files;
}

export async function readPackage(target) {
  const path = resolve(target);
  const info = await stat(path);
  if (info.isDirectory()) return { files: await readDirectoryPackage(path), source: basename(path) };
  const bytes = await readFile(path);
  if (path.endsWith(".zip")) return { files: await readZipPackage(bytes), source: basename(path) };
  const parsed = JSON.parse(bytes.toString("utf8"));
  if (!parsed?.package?.files) throw new Error("JSON input is not a candidate artifact with an inline package");
  return { files: filesFromArtifact(parsed), source: basename(path), artifact: parsed };
}

/* ---------------------------------------------------------------- validation */

function parseJson(files, path, errors) {
  const raw = files.get(path);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    errors.push({ code: "FILE_NOT_PARSEABLE", path, detail: `${path} is not valid JSON` });
    return null;
  }
}

function parseJsonl(files, path, errors) {
  const raw = files.get(path);
  if (raw === undefined) return [];
  const rows = [];
  raw.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    try {
      rows.push(JSON.parse(line));
    } catch {
      errors.push({ code: "FILE_NOT_PARSEABLE", path, detail: `${path} line ${index + 1} is not valid JSON` });
    }
  });
  return rows;
}

/** CSV rows, for files this compiler writes: every field quoted, a doubled quote escapes one. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Every check, over an already-read package.
 *
 * Returns errors and warnings rather than throwing, because a package with six problems is more
 * useful to hear about once than six times.
 */
export function validateCompiledWorldPackage(files, options = {}) {
  const errors = [];
  const warnings = [];
  const notices = [];

  for (const path of files.keys()) {
    const root = path.split("/")[0];
    if (path.includes("..") || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
      errors.push({ code: "PATH_UNSAFE", path, detail: path });
    } else if (!PACKAGE_ROOTS.has(root)) {
      errors.push({ code: "PACKAGE_ROOT_UNKNOWN", path, detail: `${path}: "${root}" is not a package root` });
    }
  }
  for (const path of REQUIRED_FILES) {
    if (!files.has(path)) errors.push({ code: "PACKAGE_FILE_MISSING", path, detail: path });
  }

  const model = parseJson(files, "canonical/model.json", errors);
  if (!model) {
    return { ok: errors.length === 0, errors, warnings, notices, counts: null };
  }

  /* Schema and compatibility: the two questions a consumer asks before reading anything else. */
  if (model.schemaVersion !== CANONICAL_MODEL_SCHEMA) {
    errors.push({ code: "SCHEMA_UNSUPPORTED", detail: `expected ${CANONICAL_MODEL_SCHEMA}, found ${String(model.schemaVersion)}` });
  }
  const blueprint = `${model.blueprint?.id}@${model.blueprint?.version}`;
  if (!SUPPORTED_BLUEPRINTS.has(blueprint)) {
    errors.push({ code: "BLUEPRINT_UNSUPPORTED", detail: blueprint });
  }
  if (typeof model.collectionId !== "string" || !STABLE_ID.test(model.collectionId)) {
    errors.push({ code: "COLLECTION_ID_NOT_STABLE", detail: String(model.collectionId) });
  }

  const nodes = Array.isArray(model.nodes) ? model.nodes : [];
  const edges = Array.isArray(model.edges) ? model.edges : [];
  const binding = Array.isArray(model.inputBinding) ? model.inputBinding : [];
  if (nodes.length === 0) errors.push({ code: "MODEL_EMPTY", detail: "the package describes no objects" });

  /* Source version binding. A package that cannot name the exact bytes it read is not evidence. */
  const boundDocuments = new Set();
  for (const entry of binding) {
    boundDocuments.add(entry?.documentId);
    if (typeof entry?.versionKey !== "string" || !VERSION_KEY.test(entry.versionKey)) {
      errors.push({ code: "SOURCE_VERSION_INVALID", detail: `${entry?.documentId}: versionKey is not a 64-hex content key` });
    }
    if (typeof entry?.inputSha256 !== "string" || !SHA256.test(entry.inputSha256)) {
      errors.push({ code: "SOURCE_DIGEST_INVALID", detail: `${entry?.documentId}: inputSha256 is not sha256:<64 hex>` });
    }
  }

  const byId = new Map();
  const evidenceIds = new Set();
  for (const node of nodes) {
    if (byId.has(node?.id)) errors.push({ code: "ID_DUPLICATE", detail: String(node?.id) });
    byId.set(node?.id, node);
    const prefix = ID_PREFIX[node?.kind];
    if (!prefix) {
      errors.push({ code: "OBJECT_KIND_UNKNOWN", detail: `${String(node?.id)}: ${String(node?.kind)}` });
    } else if (typeof node.id !== "string" || !node.id.startsWith(`${prefix}-`) || !STABLE_ID.test(node.id)) {
      /*
        A stable id is the promise that recompiling the same source lands on the same object.
        An id that does not carry its kind's prefix is not that promise kept.
      */
      errors.push({ code: "ID_NOT_STABLE", detail: `${node?.kind} ${String(node?.id)}` });
    }
    if (node?.kind === "Evidence") evidenceIds.add(node.id);
    if (typeof node?.label !== "string" || node.label.length === 0) {
      errors.push({ code: "OBJECT_LABEL_MISSING", detail: String(node?.id) });
    }
    if (node?.documentId !== undefined && !boundDocuments.has(node.documentId)) {
      errors.push({ code: "SOURCE_UNBOUND", detail: `${node.id} cites ${node.documentId}, which is not in the input binding` });
    }
  }
  for (const node of nodes) {
    for (const reference of node?.evidenceIds ?? []) {
      if (!evidenceIds.has(reference)) {
        errors.push({ code: "EVIDENCE_DANGLING", detail: `${node.id} -> ${reference}` });
      }
    }
  }
  for (const edge of edges) {
    if (typeof edge?.id !== "string" || !edge.id.startsWith("relation-") || !STABLE_ID.test(edge.id)) {
      errors.push({ code: "ID_NOT_STABLE", detail: `relation ${String(edge?.id)}` });
    }
    if (!byId.has(edge?.from)) errors.push({ code: "RELATION_DANGLING", detail: `${edge?.id}: subject ${edge?.from}` });
    if (!byId.has(edge?.to)) errors.push({ code: "RELATION_DANGLING", detail: `${edge?.id}: object ${edge?.to}` });
    if (!model.blueprint?.ontologyRelations?.includes(edge?.type)) {
      errors.push({ code: "PREDICATE_UNDECLARED", detail: `${edge?.id}: ${edge?.type}` });
    }
  }

  /* The evidence coordinate system, stated once here so a consumer never has to guess it. */
  const chunks = parseJsonl(files, "rag/chunks.jsonl", errors);
  for (const chunk of chunks) {
    const box = chunk?.bbox1000;
    const label = String(chunk?.chunkId);
    if (!Array.isArray(box) || box.length !== 4 || !box.every((value) => Number.isInteger(value))) {
      errors.push({ code: "COORDINATE_MALFORMED", detail: `${label}: bbox1000 is not four integers` });
    } else {
      const [x0, y0, x1, y1] = box;
      if (box.some((value) => value < 0 || value > 1000)) {
        errors.push({ code: "COORDINATE_OUT_OF_RANGE", detail: `${label}: [${box.join(", ")}] leaves the 0-1000 page frame` });
      } else if (x0 >= x1 || y0 >= y1) {
        errors.push({ code: "COORDINATE_DEGENERATE", detail: `${label}: [${box.join(", ")}] encloses no area` });
      }
    }
    if (!Number.isInteger(chunk?.pageNumber1) || chunk.pageNumber1 < 1) {
      errors.push({ code: "PAGE_OUT_OF_RANGE", detail: `${label}: page ${chunk?.pageNumber1} (pages are 1-based)` });
    }
    if (!evidenceIds.has(chunk?.evidenceId)) {
      errors.push({ code: "EVIDENCE_DANGLING", detail: `${label} -> ${chunk?.evidenceId}` });
    }
    if (!boundDocuments.has(chunk?.sourceId)) {
      errors.push({ code: "SOURCE_UNBOUND", detail: `${label} cites ${chunk?.sourceId}` });
    }
    for (const claimId of chunk?.claimIds ?? []) {
      if (!byId.has(claimId)) errors.push({ code: "CLAIM_DANGLING", detail: `${label} -> ${claimId}` });
    }
    for (const entityId of chunk?.entityIds ?? []) {
      if (!byId.has(entityId)) errors.push({ code: "ENTITY_DANGLING", detail: `${label} -> ${entityId}` });
    }
  }

  /*
    The four graph representations have to be the same graph.

    This is the check that pays for the file. Each export is written by its own line of code, so
    a change to one of them silently produces a package where the Turtle and the CSV disagree --
    and whichever one the customer loaded is the one they believe.
  */
  const nodeCsv = files.has("graph/nodes.csv") ? parseCsv(files.get("graph/nodes.csv")) : [];
  const edgeCsv = files.has("graph/relationships.csv") ? parseCsv(files.get("graph/relationships.csv")) : [];
  if (nodeCsv.length > 0 && nodeCsv.length - 1 !== nodes.length) {
    errors.push({ code: "GRAPH_DISAGREEMENT", detail: `graph/nodes.csv has ${nodeCsv.length - 1} rows for ${nodes.length} objects` });
  }
  if (edgeCsv.length > 0 && edgeCsv.length - 1 !== edges.length) {
    errors.push({ code: "GRAPH_DISAGREEMENT", detail: `graph/relationships.csv has ${edgeCsv.length - 1} rows for ${edges.length} relations` });
  }
  const csvIds = new Set(nodeCsv.slice(1).map((row) => row[0]));
  for (const node of nodes) {
    if (nodeCsv.length > 0 && !csvIds.has(node.id)) {
      errors.push({ code: "GRAPH_DISAGREEMENT", detail: `${node.id} is in canonical/model.json and not in graph/nodes.csv` });
    }
  }
  const jsonld = parseJson(files, "ontology/knowledge.jsonld", errors);
  if (jsonld && (jsonld["@graph"] ?? []).length !== nodes.length) {
    errors.push({
      code: "GRAPH_DISAGREEMENT",
      detail: `ontology/knowledge.jsonld describes ${(jsonld["@graph"] ?? []).length} objects for ${nodes.length}`,
    });
  }
  const turtle = files.get("ontology/knowledge.ttl") ?? "";
  const turtleStatements = turtle.split("\n").filter((line) => line.startsWith("<urn:tavonel:")).length;
  if (turtle.length > 0 && turtleStatements !== nodes.length + edges.length) {
    errors.push({
      code: "GRAPH_DISAGREEMENT",
      detail: `ontology/knowledge.ttl states ${turtleStatements} facts for ${nodes.length + edges.length}`,
    });
  }

  /* The package's own report has to describe the package it is in. */
  const report = parseJson(files, "validation/report.json", errors);
  const counted = {
    documents: binding.length,
    topics: nodes.filter((node) => node.kind === "Topic").length,
    entities: nodes.filter((node) => node.kind === "Entity").length,
    claims: nodes.filter((node) => node.kind === "Claim").length,
    evidence: evidenceIds.size,
    relations: edges.length,
  };
  if (report?.counts) {
    for (const [key, value] of Object.entries(counted)) {
      if (report.counts[key] !== value) {
        errors.push({
          code: "COUNTS_DISAGREE",
          detail: `validation/report.json says ${key}=${report.counts[key]}, the package holds ${value}`,
        });
      }
    }
  }

  /* Lifecycle and signature: reported, and fatal only when the caller says they must be. */
  const signed = files.has("manifest/export-manifest.json") && files.has("signatures/export-manifest.ed25519.json");
  if (signed) {
    notices.push({ code: "SIGNATURE_PRESENT", detail: "run scripts/verify-signed-export.mjs to check it" });
  } else if (options.requireSignature) {
    errors.push({ code: "SIGNATURE_ABSENT", detail: "no manifest/export-manifest.json and signatures/export-manifest.ed25519.json" });
  } else {
    notices.push({ code: "SIGNATURE_ABSENT", detail: "package is unsigned; the signed archive is produced by an external signer" });
  }
  if (options.lifecycle && !["candidate", "review_required"].includes(options.lifecycle)) {
    errors.push({ code: "LIFECYCLE_UNKNOWN", detail: String(options.lifecycle) });
  }

  /*
    The node CSV's columns must say what is under them.

    This was a warning for one revision, because correcting the header changes the bytes of the
    CSV, therefore its sha256, therefore the manifestDigest of every artifact. That is a real
    cost and it is not a reason to ship a header that lies: `id,label,name,document_id` over
    columns holding id, kind, label and document id means a consumer reading the column called
    `label` gets the object's type instead, and a consumer reading `name` gets its label. No
    artifact had been published, so the digests were re-derived and this became an error.
  */
  const header = nodeCsv[0]?.join(",");
  if (header !== GRAPH_NODE_HEADER) {
    errors.push({
      code: "GRAPH_CSV_HEADER_WRONG",
      detail: `graph/nodes.csv header reads ${header ?? "(missing)"} over ${GRAPH_NODE_HEADER}`,
    });
  }
  const edgeHeader = edgeCsv[0]?.join(",");
  if (edgeHeader !== GRAPH_EDGE_HEADER) {
    errors.push({
      code: "GRAPH_CSV_HEADER_WRONG",
      detail: `graph/relationships.csv header reads ${edgeHeader ?? "(missing)"} over ${GRAPH_EDGE_HEADER}`,
    });
  }

  return { ok: errors.length === 0, errors, warnings, notices, counts: counted };
}

/* ----------------------------------------------------------------------- CLI */

function parseArguments(values) {
  const options = { requireSignature: false, target: null, json: false };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (name === "--package") { index += 1; options.target = values[index]; continue; }
    if (name === "--require-signature") { options.requireSignature = true; continue; }
    if (name === "--json") { options.json = true; continue; }
    return null;
  }
  return options.target ? options : null;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) {
    process.stderr.write(
      "usage: node scripts/compiled-world/validate.mjs --package <dir | package.zip | artifact.json> [--require-signature] [--json]\n",
    );
    process.exitCode = 2;
    return;
  }
  let read;
  try {
    read = await readPackage(options.target);
  } catch (error) {
    process.stderr.write(
      `TAVONEL package validation failed: ${error instanceof Error ? error.message : "unreadable package"}\n`,
    );
    process.exitCode = 1;
    return;
  }
  const result = validateCompiledWorldPackage(read.files, {
    requireSignature: options.requireSignature,
    lifecycle: read.artifact?.lifecycle,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ package: read.source, files: read.files.size, ...result }, null, 2)}\n`);
  } else {
    const counts = result.counts ?? {};
    process.stdout.write(
      `${read.source}: ${read.files.size} files, ${Object.entries(counts).map(([key, value]) => `${value} ${key}`).join(", ")}\n`,
    );
    for (const notice of result.notices) process.stdout.write(`  note    ${notice.code}: ${notice.detail}\n`);
    for (const warning of result.warnings) process.stdout.write(`  warning ${warning.code}: ${warning.detail}\n`);
    for (const error of result.errors) process.stderr.write(`  ERROR   ${error.code}: ${error.detail}\n`);
    process.stdout.write(result.ok ? "PACKAGE VALID\n" : `PACKAGE INVALID: ${result.errors.length} error(s)\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

/*
  Awaited inside the branch, not at the top level.

  This was `await main()`, which makes the whole module async for anyone who imports it. That was
  harmless while the only importer was a test; `lib/collection-compiler.ts` now calls
  `validateCompiledWorldPackage` on the emit path, so this module is reached from a Next.js
  server bundle and a top-level await there is a bundler setting away from a build failure. The
  CLI behaviour is unchanged: exit code 0 or 1, set by main.
*/
if (process.argv[1] && resolve(process.argv[1]).split(sep).join("/").endsWith("scripts/compiled-world/validate.mjs")) {
  main().catch((error) => {
    process.stderr.write(`TAVONEL package validation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
