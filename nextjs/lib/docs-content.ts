import { API_VERSION } from "./api-version";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { MAX_FILES, MAX_SYNC_ARCHIVE_BYTES, MAX_WORKER_ARCHIVE_BYTES } from "./archive-expand";
import { DEVELOPER_SCOPES } from "./developer-contracts";

/*
  The documentation, as data.

  What was here before was a four-step brochure: upload, confirm, compile, inspect, and a link
  to the API reference. That is a page about documentation rather than documentation, and the
  masterplan's 13.6 says so plainly -- a developer arriving with a key had nowhere to read what
  the compile floor is, what an error code means, or what a run event looks like.

  Two rules shape this file.

  Every number is imported. The compile limits, the archive ceilings, the scopes and the API
  version are the values the product enforces, not transcriptions of them, so a limit cannot be
  raised in one place and stay documented at the old figure in another. That is the failure this
  repository has already had twice -- the OpenAPI document published a compile floor of two
  after the product moved to one, and the workspace printed an archive ceiling its own browser
  would refuse.

  Every endpoint block names an operationId rather than restating a request shape. The page
  renders it from the OpenAPI document the API actually serves, so request and response
  documentation is generated from the contract instead of written beside it.

  What is deliberately absent: no endpoint that does not exist, no SDK that has not been
  published, and no "coming soon". A section whose subject is not built yet says what is
  available today and stops.
*/

export type DocsBlock =
  | { kind: "prose"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "code"; label: string; language: "bash" | "json" | "text"; body: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "endpoint"; operationId: string }
  | { kind: "note"; text: string };

export type DocsSection = {
  slug: string;
  title: string;
  group: "Start" | "Concepts" | "API" | "Operations";
  summary: string;
  blocks: DocsBlock[];
};

const KEY_HEADER = "Authorization: Bearer $TAVONEL_API_KEY";

/*
  One line per scope, keyed by the scope the product actually issues.

  Not a second list. `DEVELOPER_SCOPES` is the source of the rows, so a scope added there
  appears here with a placeholder rather than silently going undocumented, and a scope removed
  there disappears from the page instead of documenting something no key can hold.
*/
const SCOPE_COPY: Record<string, string> = {
  "documents:read": "List documents and read their processing state.",
  "documents:intake": "Request upload capabilities and register document versions.",
  "collections:read": "Read compile jobs, corpora and compiled packages.",
  "collections:compile": "Start compiles, answer blockers, cancel a run.",
  "collections:download": "Download the signed knowledge package.",
  "worlds:read": "Read the active World, its objects, relations and evidence.",
  "ask:read": "Grounded answers and lexical retrieval over the active World.",
  "connections:read": "Read connection state and cursors.",
  "connections:write": "Create and revoke connections.",
  "connections:sync": "Advance a connection cursor and collect what changed.",
};

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    group: "Start",
    summary: "From an API key to a compiled World with evidence, in four requests.",
    blocks: [
      { kind: "prose", text: "Every request is tenant-scoped by the key it carries. There is no account switch and no impersonation header: a key belongs to one workspace and reaches nothing else." },
      {
        kind: "steps",
        items: [
          "Ask for an upload capability. The response is a short-lived direct URL; document bytes never pass through the application server.",
          "PUT the file to that URL.",
          "Start a compile with the document ids you want in the World.",
          "Follow the job, then read the World and its evidence.",
        ],
      },
      {
        kind: "code",
        label: "Request an upload capability",
        language: "bash",
        body: `curl -sS https://tavonel.com/api/v1/uploads/capability \\\n  -H "${KEY_HEADER}" \\\n  -H "content-type: application/json" \\\n  -d '{"originalFilename":"manual.pdf","declaredMimeType":"application/pdf","requestedBytes":184320}'`,
      },
      {
        kind: "code",
        label: "Start a compile",
        language: "bash",
        body: `curl -sS https://tavonel.com/api/compile-jobs \\\n  -H "${KEY_HEADER}" \\\n  -H "content-type: application/json" \\\n  -d '{"documentIds":["<document-id>"]}'`,
      },
      { kind: "note", text: "The compile answers 202 with a job id, not a World. It runs on our servers whether or not your process is still connected." },
    ],
  },
  {
    slug: "concepts",
    title: "Concepts",
    group: "Concepts",
    summary: "Sources, Compiled Worlds, candidate and active versions, and evidence.",
    blocks: [
      { kind: "prose", text: "A **source** is an immutable document version. Uploading the same file twice produces one source with one digest; editing the file produces a second version, and the first is never rewritten." },
      { kind: "prose", text: "A **Compiled World** is what a set of sources compiles into: semantic objects, relations between them, and the evidence each one rests on. It is addressed by a collection id and a manifest digest, and the digest is computed over the whole artifact, so two Worlds with the same digest are the same World." },
      { kind: "prose", text: "A **candidate** version is a compile result nobody has accepted yet. An **active** version is the one answers are served from. Promotion is an explicit human action in a signed-in session — no API key can promote, and no compile promotes itself." },
      { kind: "prose", text: "**Evidence** is a page and a region on that page, bound to a source version by digest. An object with no evidence is not published, and an answer that cannot cite one abstains rather than guessing." },
      {
        kind: "table",
        head: ["Term", "Identified by", "Changes when"],
        rows: [
          ["Source version", "sha256 of the sanitized bytes", "the file changes"],
          ["Compiled World", "collection id + manifest digest", "any input or the compiler changes"],
          ["Object", "stable key derived from its content", "its label or bindings change"],
          ["Evidence", "source version + page + region", "the region moves or the source is replaced"],
        ],
      },
    ],
  },
  {
    slug: "authentication",
    title: "Authentication",
    group: "API",
    summary: "Bearer keys, the scopes they carry, and what no key can do.",
    blocks: [
      { kind: "prose", text: "Send the key as a bearer token. Keys are workspace-scoped and carry an explicit scope set; a request outside its scopes is refused with 403 rather than silently returning less." },
      { kind: "code", label: "Every request", language: "bash", body: `curl -sS https://tavonel.com/api/v1/documents -H "${KEY_HEADER}"` },
      {
        kind: "table",
        head: ["Scope", "Grants"],
        rows: DEVELOPER_SCOPES.map((scope) => [scope, SCOPE_COPY[scope] ?? "See the endpoint reference."]),
      },
      { kind: "note", text: "Promotion, rollback and destructive workspace actions are human-session-only. There is no scope that grants them, which is why you will not find one in this table." },
    ],
  },
  {
    slug: "files-and-formats",
    title: "Files and formats",
    group: "Operations",
    summary: "What can be uploaded, what is expanded in the browser, and the ceilings on both.",
    blocks: [
      { kind: "prose", text: "PDF, common office documents and images are accepted. A ZIP archive is expanded before upload so its contents arrive as individual sources, which is why the archive ceilings below are browser limits rather than server ones." },
      {
        kind: "table",
        head: ["Limit", "Value", "Why it is that number"],
        rows: [
          ["Files in one archive", String(MAX_FILES), "The largest expansion a browser tab performs without becoming unresponsive."],
          ["Archive size, no worker", `${MAX_SYNC_ARCHIVE_BYTES / 1_048_576} MB`, "Expansion on the main thread; larger would block the tab."],
          ["Archive size, with a worker", `${MAX_WORKER_ARCHIVE_BYTES / 1_048_576} MB`, "Expansion off-thread, where the ceiling is memory rather than responsiveness."],
        ],
      },
      { kind: "note", text: "Encrypted archives, nested archives and paths that escape the archive root are refused at expansion time, not after upload. A spreadsheet's billable unit is not decided, so page counts for spreadsheets are reported as unknown rather than estimated." },
    ],
  },
  {
    slug: "upload",
    title: "Upload",
    group: "API",
    summary: "Direct-to-storage upload, and why bytes never reach the application server.",
    blocks: [
      { kind: "prose", text: "Uploads are direct. The capability endpoint returns a short-lived URL to object storage; you PUT the bytes there. The application server sees the request for permission and the receipt afterwards, and never the document." },
      { kind: "endpoint", operationId: "createDirectUploadCapability" },
      { kind: "endpoint", operationId: "listDocuments" },
    ],
  },
  {
    slug: "collections-and-compile",
    title: "Collections and compile",
    group: "API",
    summary: `A compile carries up to ${COMPILE_MAX_DOCUMENTS} documents; a run carries up to ${CORPUS_MAX_DOCUMENTS}.`,
    blocks: [
      { kind: "prose", text: `A compile takes between ${COMPILE_MIN_DOCUMENTS} and ${COMPILE_MAX_DOCUMENTS} documents. That is one Core request and one artifact, and it is not the limit on how much you can compile: a selection larger than that is partitioned server-side into parts of that size and answered as a corpus, up to ${CORPUS_MAX_DOCUMENTS} documents in one run.` },
      { kind: "prose", text: "Each part of a corpus is an ordinary compile job with its own id, state and event stream. The parts are not merged into one World: deciding that an entity in one part and an entity in another are the same thing is identity resolution with its own evidence requirements, and joining the ontologies without it would manufacture duplicates." },
      { kind: "endpoint", operationId: "startCompileJob" },
      { kind: "endpoint", operationId: "getCompileCorpus" },
      { kind: "endpoint", operationId: "compileCollection" },
      { kind: "note", text: "Submitting the same document set again returns the job that already exists. A retried request, a double-clicked button and an at-least-once redelivery converge on one compile." },
    ],
  },
  {
    slug: "run-events",
    title: "Run events",
    group: "API",
    summary: "The persisted transition log, and how to resume it after a disconnect.",
    blocks: [
      { kind: "prose", text: "A compile publishes its transitions to an append-only ledger. The event stream replays that ledger from `Last-Event-ID` and then follows it, so a client that reconnects sees everything it missed rather than the current state alone." },
      { kind: "endpoint", operationId: "streamCompileJobEvents" },
      { kind: "endpoint", operationId: "getCompileJob" },
      {
        kind: "code",
        label: "Resume after a disconnect",
        language: "bash",
        body: `curl -N https://tavonel.com/api/compile-jobs/<jobId>/events \\\n  -H "${KEY_HEADER}" \\\n  -H "Last-Event-ID: 42"`,
      },
      { kind: "note", text: "The server closes the stream on its own clock. Reconnecting is the normal case, not an error path — every frame carries the sequence to resume from." },
    ],
  },
  {
    slug: "review",
    title: "Review",
    group: "Operations",
    summary: "Partial failures, the four decisions, and the one that cannot be taken casually.",
    blocks: [
      { kind: "prose", text: "A compile that cannot read every source stops and waits. Nothing is skipped automatically: a World quietly missing documents you believe are in it is worse than a compile that asks." },
      {
        kind: "table",
        head: ["Decision", "Effect"],
        rows: [
          ["continue", "Compile the readable sources. Refused while any blocker is a security blocker."],
          ["remove_blocked", "Drop the blocked sources from the set, recorded against the person who chose it."],
          ["retry_eligible", "Retry the ordinary blockers, keeping the security ones blocked."],
          ["cancel", "Settle the job without compiling."],
        ],
      },
      { kind: "endpoint", operationId: "resolveCompileJobBlockers" },
      { kind: "endpoint", operationId: "cancelCompileJob" },
      { kind: "note", text: "A file stopped by a safety check leaves the set only through an explicit removal. `continue` will not step over it, because a pipeline that learns to skip security stops has stopped being one." },
    ],
  },
  {
    slug: "world-api",
    title: "World API",
    group: "API",
    summary: "Reading a compiled World, its objects, relations and evidence.",
    blocks: [
      { kind: "prose", text: "A World is read by collection id. Objects carry their stable keys, the relations they participate in and the evidence they rest on; evidence carries the source version, the page and the region." },
      { kind: "endpoint", operationId: "getCollection" },
      { kind: "note", text: "Route features, scores, thresholds and the cost matrix are not in any public response. They are internal, and a public DTO that filtered them would be one refactor away from leaking them." },
    ],
  },
  {
    slug: "search",
    title: "Search",
    group: "API",
    summary: "Lexical retrieval over the active World.",
    blocks: [
      { kind: "prose", text: "Search runs against the active version. A workspace with no promoted World returns nothing rather than falling back to a candidate — an answer from a version nobody accepted is not a smaller answer, it is a different one." },
      { kind: "endpoint", operationId: "searchActiveWorld" },
    ],
  },
  {
    slug: "ask",
    title: "Ask",
    group: "API",
    summary: "Grounded answers, their citations, and when the system abstains.",
    blocks: [
      { kind: "prose", text: "Ask retrieves regions from the active World and answers from them. Every answer carries the regions it used, with the source version, page and bounding box of each, and the relevance the retriever scored." },
      { kind: "prose", text: "When no region supports the question well enough, the response is an abstention with a reason. That is a result, not a failure: an answer with no evidence behind it is the failure." },
      { kind: "endpoint", operationId: "askActiveWorld" },
    ],
  },
  {
    slug: "connections",
    title: "Connections",
    group: "Operations",
    summary: "Connected sources, their cursors, and what a revoke does immediately.",
    blocks: [
      { kind: "prose", text: "A connection carries a durable cursor, so a re-sync collects what changed rather than everything. Access removal takes effect on the next request rather than waiting for a background reindex." },
      { kind: "note", text: "Connector availability differs by provider and by workspace. The Integrations page states which are live; this page does not restate it, because two pages saying different things about the same connector is how that goes wrong." },
    ],
  },
  {
    slug: "exports",
    title: "Exports",
    group: "Operations",
    summary: "The signed package: what is in it, and what the signature covers.",
    blocks: [
      { kind: "prose", text: "A compiled World exports as a package containing the canonical model, the ontology in Turtle and JSON-LD, the graph as CSV, the retrieval chunks, the evidence and a validation report. Every file carries its own sha256 and the manifest digest covers the set." },
      {
        kind: "table",
        head: ["Path", "What it is"],
        rows: [
          ["canonical/model.json", "Objects and relations, canonically ordered."],
          ["ontology/knowledge.ttl", "The same graph as Turtle."],
          ["ontology/knowledge.jsonld", "The same graph as JSON-LD."],
          ["graph/nodes.csv, graph/edges.csv", "Tabular form for spreadsheet and BI tools."],
          ["rag/chunks.jsonl", "Retrieval chunks, each bound to a page and region."],
          ["validation/report.json", "The validation status and any review reasons."],
        ],
      },
      { kind: "note", text: "The package is signed by an external signer. A package whose signature status says `external_signer_required` has not been signed yet, and says so rather than presenting itself as verified." },
    ],
  },
  {
    slug: "mcp",
    title: "MCP",
    group: "API",
    summary: "What exists today for agent access, and what does not.",
    blocks: [
      { kind: "prose", text: "There is no published MCP server yet. The Ask and Search endpoints are the agent surface today: they take a question, return grounded regions and their citations, and abstain when the World does not support an answer." },
      { kind: "note", text: "This section exists rather than being hidden because a developer looking for MCP should find an answer instead of a missing page. When a server is published it will be documented here with its exact tool schema." },
    ],
  },
  {
    slug: "cli",
    title: "CLI",
    group: "API",
    summary: "The published developer distribution, and what it does.",
    blocks: [
      { kind: "prose", text: "A signed developer distribution is published on the Developers page, pinned by sha256 in its channel manifest. It covers the upload and compile path from a terminal." },
      { kind: "note", text: "It is a distribution rather than a package-manager release: the manifest names the exact bytes, and the verification script checks them before anything runs." },
    ],
  },
  {
    slug: "billing-and-limits",
    title: "Billing and limits",
    group: "Operations",
    summary: "What is counted, what is not decided, and the ceilings that apply.",
    blocks: [
      { kind: "prose", text: "Processing is quoted in pages before a compile starts, with the maximum charge shown alongside the estimate. A quote derived from file size is labelled an estimate; a page count read from the document itself is labelled verified." },
      { kind: "prose", text: "Spreadsheets have no decided billable unit. Rather than quote one from file size and let that number become the charge, they are reported as undecided in the preflight panel." },
      {
        kind: "table",
        head: ["Limit", "Value"],
        rows: [
          ["Documents per compile", `${COMPILE_MIN_DOCUMENTS}–${COMPILE_MAX_DOCUMENTS}`],
          ["Documents per run", String(CORPUS_MAX_DOCUMENTS)],
          ["Files per archive", String(MAX_FILES)],
        ],
      },
    ],
  },
  {
    slug: "errors",
    title: "Errors",
    group: "API",
    summary: "The codes a client has to branch on, and what each one means.",
    blocks: [
      { kind: "prose", text: "Failures return a machine code alongside the HTTP status. Branch on the code: the status says what kind of problem it is, and the code says which one." },
      {
        kind: "table",
        head: ["Code", "Status", "Meaning"],
        rows: [
          ["DOCUMENT_IDS_REQUIRED", "400", "The request carried no document id array."],
          ["DOCUMENT_SET_UNQUALIFIED", "400", "A document id was not a document id."],
          ["DOCUMENT_SET_EMPTY", "400", "Nothing was selected to compile."],
          ["CORPUS_TOO_LARGE", "400", `More than ${CORPUS_MAX_DOCUMENTS} documents in one run.`],
          ["DOCUMENT_SET_TOO_LARGE", "400", `More than ${COMPILE_MAX_DOCUMENTS} documents sent to the single-compile route.`],
          ["OCR_NOT_READY", "409", "The sources have not finished being read. Retry rather than fail."],
          ["SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL", "409", "`continue` was sent while a source was held by a safety check."],
          ["COMPILE_JOB_ALREADY_SETTLED", "409", "The job had already finished. Nothing was discarded."],
          ["COMPILE_JOB_NOT_FOUND", "404", "No such job in this workspace."],
          ["CORE_NOT_CONFIGURED", "503", "The compile runtime is unavailable. The request was not charged."],
        ],
      },
      { kind: "note", text: "A 503 means the work did not start. A 409 means the request was understood and the state refused it — those are different retries." },
    ],
  },
  {
    slug: "security",
    title: "Security",
    group: "Operations",
    summary: "Where bytes live, what the parsing models can reach, and what fails closed.",
    blocks: [
      { kind: "prose", text: "Uploaded bytes go to quarantine storage and are disarmed before anything reads them. Parsing models get no tools, no broad credentials and no outbound network: every document is treated as hostile input." },
      { kind: "prose", text: "Integrity violations fail closed. A World with an unresolved link is not emitted, a package whose file digests do not match is not served, and a compile whose inputs cannot be validated does not produce a partial result." },
      { kind: "note", text: "The Security page states the controls in full and the Subprocessors page names every service permitted to touch each class of data. This section does not restate them." },
    ],
  },
  {
    slug: "changelog",
    title: "Changelog",
    group: "Operations",
    summary: "What changed in the product and the public interfaces.",
    blocks: [
      { kind: "prose", text: "Product changes are listed on the Changelog page. The API contract carries its own version, shown at the top of every page here, and the machine-readable document is the authority for what a version contains." },
    ],
  },
];


export const DOCS_GROUPS = ["Start", "Concepts", "API", "Operations"] as const;

export const DOCS_VERSION = API_VERSION;

/**
 * The date the documentation was last reviewed against the product.
 *
 * Deliberately not `new Date()`. A page that prints today's date every time it renders claims
 * it was checked today, which is exactly the assurance a reader is looking for and exactly the
 * one nobody gave. This moves when a person moves it.
 */
export const DOCS_REVIEWED = "2026-09-03";

export function findDocsSection(slug: string) {
  return DOCS_SECTIONS.find((section) => section.slug === slug) ?? null;
}

/** Flattened text, for the search box. Built here so the client bundle carries one copy. */
export function docsSearchIndex() {
  return DOCS_SECTIONS.map((section) => ({
    slug: section.slug,
    title: section.title,
    group: section.group,
    summary: section.summary,
    text: [section.title, section.summary, ...section.blocks.flatMap(blockText)].join(" ").toLowerCase(),
  }));
}

function blockText(block: DocsBlock): string[] {
  switch (block.kind) {
    case "prose":
    case "note":
      return [block.text];
    case "steps":
      return block.items;
    case "code":
      return [block.label, block.body];
    case "table":
      return [...block.head, ...block.rows.flat()];
    case "endpoint":
      return [block.operationId];
  }
}
