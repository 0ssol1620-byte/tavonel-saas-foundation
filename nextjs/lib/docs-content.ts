import { ACTIVATION_RATE_LIMIT } from "./activation-rate-limit";
import { activationPolicy } from "./activation-policy";
import { API_VERSION } from "./api-version";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { MAX_FILES, MAX_SYNC_ARCHIVE_BYTES, MAX_WORKER_ARCHIVE_BYTES } from "./archive-expand";
import { DEVELOPER_SCOPES } from "./developer-contracts";
import { SCOPE_RATE_LIMITS } from "./developer-auth";
import { API_ERROR_GROUPS } from "./api-error-codes";
import { PACKAGE_CONTENTS } from "./package-contents";
import {
  DEVELOPER_FILES,
  DEVELOPER_FILE_COUNT_WORD,
  MCP_TOOLS,
  MCP_TOOL_COUNT_WORD,
} from "./mcp-tools";
import {
  PROCESSING_CEILING,
  PROCESSING_CEILING_LIMITATIONS,
  PROCESSING_CEILING_MIB,
  PROCESSING_CEILING_SENTENCE,
} from "../../shared/intakeCeiling";
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../shared/capabilityManifest";
import {
  BILLING_OFFERS,
  REFUND_MAX_CONSUMED_FRACTION,
  REFUND_WINDOW_DAYS,
  refundablePageAllowance,
} from "./billing-catalog";
import { PROCESSING_UNIT_USD, STANDARD_UNITS_PER_PAGE, formatUsd } from "./usage-pricing";

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
  /*
    A subheading inside a section, and the reason the type has one (BA-185/201).

    Every one of the twenty-two sections had exactly zero h2s inside its body -- including an
    1,100-word quickstart with six code blocks -- so there was nothing to render, nothing to
    anchor a link to, and nothing for "On this page" to list. The jump list compensated by
    indexing the only labelled blocks there were, which are code captions, so a reader looking
    for a concept got "Steps 1 to 4 — Python".

    The text is the anchor: `app/docs/[section]/page.tsx` slugifies it through the same
    `tocEntries` the cookbook route uses, so the heading's id and the link that names it are one
    derivation. Which is also why a heading may not be the last block in a section -- a heading
    with nothing under it is a jump link to a blank space. `docs-content.test.ts` asserts it.
  */
  | { kind: "heading"; text: string }
  | { kind: "prose"; text: string }
  | { kind: "steps"; items: string[] }
  /*
    `language` is metadata, not a renderer switch: `app/docs/[section]/page.tsx` prints the body
    verbatim under its label and highlights nothing. It is here so a block cannot claim to be
    one language while carrying another, and so the quickstart's bash/python/typescript parity
    is a property a test can assert rather than a habit.
  */
  | { kind: "code"; label: string; language: DocsLanguage; body: string }
  /*
    One step of the quickstart in three languages, as tabs rather than as three figures (BA-189).

    /docs/quickstart was 5,176px tall and about 4,000px of that was six code blocks: steps 1-4 in
    bash, Python and TypeScript, then steps 6-7 in the same three. A reader who writes TypeScript
    scrolled past roughly 250 lines of two other languages to reach either half. Nobody was served
    by all three being open at once.

    The endpoint blocks on this same page already did this -- `DocsSnippet`, three tabs, all three
    bodies rendered server-side so a reader with no JavaScript still gets the first. This is that
    component, given a block kind so the section data can use it too.
  */
  | { kind: "snippets"; label: string; items: ReadonlyArray<{ label: string; language: DocsLanguage; body: string }> }
  /*
    BQ-102. Two optional properties, both earned by the error catalogue.

    `rowAnchors` gives each row an id derived from its first cell, so a support reply or an issue
    can link to one code rather than to a page holding 229 of them. `filterLabel` puts a filter
    box above the table and names what it filters -- a bare input on a reference page says
    nothing about what typing in it will do.

    Both are opt-in: a four-row table gains nothing from either, and a table whose first column
    is a sentence would mint an id out of a sentence.
  */
  | { kind: "table"; head: string[]; rows: string[][]; rowAnchors?: true; filterLabel?: string }
  | { kind: "endpoint"; operationId: string }
  /*
    The one diagram in the documentation (G3-011).

    A block kind rather than a generic image slot: there is exactly one picture here, it is drawn
    from data in `components/docs/world-lifecycle.tsx`, and a slot that took a URL would invite
    a second picture nobody derives from anything. `caption` is what the search index sees,
    because an SVG's text nodes are not in the flattened section text.
  */
  | { kind: "diagram"; name: "world-lifecycle"; caption: string }
  | { kind: "note"; text: string };

export type DocsLanguage = "bash" | "powershell" | "python" | "typescript" | "json" | "text";

export type DocsSection = {
  slug: string;
  title: string;
  group: (typeof DOCS_GROUPS)[number];
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
  // G3-012. This said "lexical retrieval" while /docs/search documented the same scope's
  // endpoint as hybrid lexical + dense + structure, RRF-fused and reranked. The description was
  // left behind when the pipeline changed, so the two pages disagreed about one scope.
  "ask:read": "Grounded answers and hybrid retrieval over the active World.",
  "connections:read": "Read connection state and cursors.",
  "connections:write": "Create and revoke connections.",
  "connections:sync": "Advance a connection cursor and collect what changed.",
};

export const DOCS_SECTIONS: DocsSection[] = [
  {
    slug: "quickstart",
    title: "Quickstart",
    group: "Getting started",
    summary: "From an API key to a verified evidence-bound answer, with the one step no key can take.",
    blocks: [
      { kind: "note", text: `**Before you start.** ${activationPolicy.customerData.reason} So steps 1 to 5 below are the contract you will call once intake is arranged with us, not a request this deployment will accept from you today. Steps 6 and 7 read a World that already exists, and the completed public Compiled World is readable in full right now — including from the unauthenticated reads the API reference at /api will run for you.` },
      { kind: "prose", text: "Every request is tenant-scoped by the key it carries. There is no account switch and no impersonation header: a key belongs to one workspace and reaches nothing else." },
      { kind: "heading", text: "The seven steps" },
      {
        kind: "steps",
        items: [
          "Ask for an upload capability. The response is a short-lived direct URL; document bytes never pass through the application server.",
          "PUT the file to that URL with the same content type you declared.",
          "Start a compile with the document ids you want in the World. It answers 202 with a job id, not a World.",
          "Poll GET /api/compile-jobs/{jobId} until state is ready, review_required, failed or cancelled. A settled job carries the collectionId the candidate was written to.",
          "A person activates the World. This step is not in the script and not in the API: activation is a browser-session action by a human in the workspace, and the published contract has no activation and no rollback path for any key to call.",
          "Ask the active World a question, and read which retrieval runtime answered it.",
          "Download the signed package and verify it offline with the published verifiers.",
        ],
      },
      // FD-02 (`docs/policy/DECISION_LOG_2026-09-11.md`): the activation plan gate stated below is
      // a delegated decision, 2026-09-11, read off `planReachesLevel` rather than typed here.
      { kind: "heading", text: "Why step 5 stops a script" },
      {
        kind: "note",
        text: "Step 5 is the one that stops a script, and it stops for two separate reasons. Activation is human-only by design — a candidate is not organizational truth until a person says so, and no API key of any plan has an activation or rollback path to call. Separately, the activation surface is plan-gated: it runs on the **Developer** plan held by the workspace **owner**, or on the **Team** plan under its usual workspace roles, so steps 1-4 and 6-7 are what a Developer key is scoped for, and step 5 is open to you as well when you own the workspace. Any other caller is refused with `STUDIO_SUBSCRIPTION_REQUIRED`, and an evaluation trial with `SUBSCRIPTION_REQUIRED`; branch on those two codes. Team is arranged with us rather than bought at a checkout. That is the plan gate, and it is not the only one: the deployment-wide intake gate at the top of this page stops steps 1 to 4 on every plan until intake is arranged, so a Developer key passing the plan check still will not compile your files here today.",
      },
      { kind: "heading", text: "Compile a document set" },
      {
        kind: "snippets",
        label: "Steps 1 to 4",
        items: [
          { label: "cURL", language: "bash", body: [
          `# Requires curl and jq. TAVONEL_API_KEY holds a key scoped documents:intake + collections:compile + collections:read.`,
          `capability=$(curl -fsS https://tavonel.com/api/v1/uploads/capability \\`,
          `  -H "${KEY_HEADER}" -H "content-type: application/json" \\`,
          `  -d '{"originalFilename":"manual.pdf","declaredMimeType":"application/pdf","requestedBytes":184320}')`,
          `document_id=$(printf '%s' "$capability" | jq -r .documentId)`,
          ``,
          `# 2. The bytes go straight to storage. Content-Type must match declaredMimeType.`,
          `curl -fsS -X PUT "$(printf '%s' "$capability" | jq -r .uploadUrl)" \\`,
          `  -H "content-type: application/pdf" --data-binary @manual.pdf`,
          ``,
          `# 3. 202 Accepted, with a job id. The compile continues if this shell exits.`,
          `job_id=$(curl -fsS https://tavonel.com/api/compile-jobs \\`,
          `  -H "${KEY_HEADER}" -H "content-type: application/json" \\`,
          `  -d "{\\"documentIds\\":[\\"$document_id\\"]}" | jq -r .jobId)`,
          ``,
          `# 4. Poll until it settles. Nothing here is a World yet.`,
          `while :; do`,
          `  job=$(curl -fsS "https://tavonel.com/api/compile-jobs/$job_id" -H "${KEY_HEADER}")`,
          `  state=$(printf '%s' "$job" | jq -r .job.state)`,
          `  echo "state=$state"`,
          `  case "$state" in ready|review_required|failed|cancelled) break ;; esac`,
          `  sleep 5`,
          `done`,
          `collection_id=$(printf '%s' "$job" | jq -r .job.collectionId)`,
          `echo "candidate: $collection_id — a person activates it in the workspace before step 6"`,
          ].join("\n") },
          { label: "Python", language: "python", body: [
          `import json, os, time, urllib.request`,
          ``,
          `BASE = "https://tavonel.com"`,
          `KEY = os.environ["TAVONEL_API_KEY"]`,
          ``,
          `def call(method, path, body=None, headers=None):`,
          `    data = json.dumps(body).encode() if body is not None else None`,
          `    request = urllib.request.Request(BASE + path, data=data, method=method)`,
          `    request.add_header("authorization", f"Bearer {KEY}")`,
          `    if data is not None:`,
          `        request.add_header("content-type", "application/json")`,
          `    for name, value in (headers or {}).items():`,
          `        request.add_header(name, value)`,
          `    with urllib.request.urlopen(request) as response:`,
          `        return json.loads(response.read() or b"{}")`,
          ``,
          `capability = call("POST", "/api/v1/uploads/capability", {`,
          `    "originalFilename": "manual.pdf",`,
          `    "declaredMimeType": "application/pdf",`,
          `    "requestedBytes": os.path.getsize("manual.pdf"),`,
          `})`,
          ``,
          `# The PUT is unauthenticated: the capability URL is the credential, and it is short-lived.`,
          `with open("manual.pdf", "rb") as handle:`,
          `    put = urllib.request.Request(capability["uploadUrl"], data=handle.read(), method="PUT")`,
          `    put.add_header("content-type", "application/pdf")`,
          `    urllib.request.urlopen(put).read()`,
          ``,
          `accepted = call("POST", "/api/compile-jobs", {"documentIds": [capability["documentId"]]})`,
          ``,
          `while True:`,
          `    job = call("GET", f"/api/compile-jobs/{accepted['jobId']}")["job"]`,
          `    print("state=", job["state"])`,
          `    if job["state"] in {"ready", "review_required", "failed", "cancelled"}:`,
          `        break`,
          `    time.sleep(5)`,
          ``,
          `print("candidate:", job["collectionId"], "— a person activates it before step 6")`,
          ].join("\n") },
          { label: "TypeScript", language: "typescript", body: [
          `import { readFile, stat } from "node:fs/promises";`,
          ``,
          `const BASE = "https://tavonel.com";`,
          `const KEY = process.env.TAVONEL_API_KEY!;`,
          ``,
          `async function call<T>(method: string, path: string, body?: unknown): Promise<T> {`,
          `  const response = await fetch(BASE + path, {`,
          `    method,`,
          `    headers: { authorization: \`Bearer \${KEY}\`, ...(body ? { "content-type": "application/json" } : {}) },`,
          `    body: body ? JSON.stringify(body) : undefined,`,
          `  });`,
          `  if (!response.ok) throw new Error(\`\${method} \${path} -> \${response.status} \${await response.text()}\`);`,
          `  return response.json() as Promise<T>;`,
          `}`,
          ``,
          `const capability = await call<{ documentId: string; uploadUrl: string }>(`,
          `  "POST", "/api/v1/uploads/capability",`,
          `  { originalFilename: "manual.pdf", declaredMimeType: "application/pdf", requestedBytes: (await stat("manual.pdf")).size },`,
          `);`,
          ``,
          `await fetch(capability.uploadUrl, {`,
          `  method: "PUT",`,
          `  headers: { "content-type": "application/pdf" },`,
          `  body: await readFile("manual.pdf"),`,
          `});`,
          ``,
          `const accepted = await call<{ jobId: string }>("POST", "/api/compile-jobs", { documentIds: [capability.documentId] });`,
          ``,
          `const settled = new Set(["ready", "review_required", "failed", "cancelled"]);`,
          `let job: { state: string; collectionId: string | null };`,
          `do {`,
          `  ({ job } = await call<{ job: typeof job }>("GET", \`/api/compile-jobs/\${accepted.jobId}\`));`,
          `  console.log("state=", job.state);`,
          `  if (!settled.has(job.state)) await new Promise((done) => setTimeout(done, 5_000));`,
          `} while (!settled.has(job.state));`,
          ``,
          `console.log("candidate:", job.collectionId, "— a person activates it before step 6");`,
          ].join("\n") },
        ],
      },
      { kind: "heading", text: "Ask a question and download the package" },
      {
        kind: "snippets",
        label: "Steps 6 and 7, after a person has activated the World",
        items: [
          { label: "cURL", language: "bash", body: [
          `# 6. Ask the active World. \`retrievalPath\` names which runtime answered:`,
          `#    compiled-retrieval-v1, or excerpt-concatenation-fallback when the active World`,
          `#    has no compiled retrieval run. /search has no fallback and answers 409 in that case.`,
          `#    The fallback path returns citations; the compiled path returns a contextPacket.`,
          `curl -fsS "https://tavonel.com/api/v1/collections/$collection_id/ask" \\`,
          `  -H "${KEY_HEADER}" -H "content-type: application/json" \\`,
          `  -d '{"question":"What is the documented retention period?"}' \\`,
          `  | jq '{code, retrievalPath, retrievalNotice, citations, contextPacket}'`,
          ``,
          `# 7. Export, then verify without us. The fingerprint comes from the trust endpoint,`,
          `#    not from the archive -- an archive cannot vouch for its own key.`,
          `curl -fsS "https://tavonel.com/api/v1/collections/$collection_id/download" \\`,
          `  -H "${KEY_HEADER}" -o world.zip`,
          `fingerprint=$(curl -fsS https://tavonel.com/api/export/trust | jq -r .publicKeySpkiSha256)`,
          `node tavonel-verify-export.mjs --archive world.zip --trusted-fingerprint "$fingerprint"`,
          `node tavonel-verify-package.mjs --package world.zip --require-signature`,
          ].join("\n") },
          { label: "Python", language: "python", body: [
          `answer = call("POST", f"/api/v1/collections/{job['collectionId']}/ask",`,
          `              {"question": "What is the documented retention period?"})`,
          `print(answer["code"], answer["retrievalPath"])`,
          `for citation in answer.get("citations", []):`,
          `    print(citation["sourceVersionId"], citation["pageNumber1"], citation["bbox1000"])`,
          ``,
          `# The download is bytes, not JSON, so it does not go through call().`,
          `download = urllib.request.Request(f"{BASE}/api/v1/collections/{job['collectionId']}/download")`,
          `download.add_header("authorization", f"Bearer {KEY}")`,
          `with urllib.request.urlopen(download) as response, open("world.zip", "wb") as out:`,
          `    out.write(response.read())`,
          ``,
          `# Verification is the two published Node verifiers; there is no Python port of them.`,
          `# See the CLI page for the download-and-pin commands.`,
          ].join("\n") },
          { label: "TypeScript", language: "typescript", body: [
          `import { writeFile } from "node:fs/promises";`,
          ``,
          `const answer = await call<{ code: string; retrievalPath: string; retrievalNotice?: string }>(`,
          `  "POST", \`/api/v1/collections/\${job.collectionId}/ask\`,`,
          `  { question: "What is the documented retention period?" },`,
          `);`,
          `console.log(answer.code, answer.retrievalPath, answer.retrievalNotice ?? "");`,
          ``,
          `const archive = await fetch(\`\${BASE}/api/v1/collections/\${job.collectionId}/download\`, {`,
          `  headers: { authorization: \`Bearer \${KEY}\` },`,
          `});`,
          `await writeFile("world.zip", Buffer.from(await archive.arrayBuffer()));`,
          ``,
          `// Then run the two published verifiers; see the CLI page.`,
          ].join("\n") },
        ],
      },
      { kind: "heading", text: "What /ask answers from" },
      { kind: "note", text: "`/ask` answers only from the World a person has approved. A `review_required` candidate stays readable and exportable until then, and it is never treated as authoritative: there is no parameter that points `/ask` at a candidate." },
    ],
  },
  {
    slug: "use-with-ai",
    title: "Use your results with AI",
    group: "External AI",
    summary: "Choose live MCP/API access or the signed portable package, and keep answers grounded in the same evidence.",
    blocks: [
      { kind: "heading", text: "Live access or a portable package" },
      {
        kind: "prose",
        text: "There are two supported ways to use TAVONEL output. **Live access** through Ask, the API or the read-only MCP server reads the active World and is the preferred path for a production assistant that needs the current revision. The **signed knowledge package** is a portable snapshot for offline work, handoff, archive and systems that consume files rather than an API.",
      },
      { kind: "heading", text: "Which surface for which use" },
      {
        kind: "table",
        head: ["Use case", "Recommended surface", "Why"],
        rows: [
          ["AI/agent that should stay current", "MCP or API", "Reads the active World, access policy and evidence without copying a stale snapshot."],
          ["TAVONEL workspace Q&A", "Ask", "Uses the same active World and returns source-grounded citations."],
          ["Local coding/research agent with folder access", "Signed ZIP", "Extract once, grant the agent folder access, and let AGENTS.md describe the package contract."],
          ["Web chat with file upload but no local filesystem", "Signed ZIP or selected package files", "The chat must receive the bytes; a local path by itself does not grant access."],
          ["Graph/RDF/RAG import", "Signed ZIP", "Use the projection that matches the target system while retaining validation and provenance beside it."],
        ],
      },
      { kind: "heading", text: "Setting either path up" },
      {
        kind: "steps",
        items: [
          "Before using a result as organizational truth, confirm that the World you intend to use is active. A review_required candidate is not automatically authoritative.",
          "For a live agent, create a least-privilege API key and use the read-only MCP bridge or the REST API from the Developers surface.",
          "For a portable workflow, download the signed knowledge package and extract it without changing its internal paths.",
          "Give a filesystem-capable agent access to the extracted folder and tell it to read AGENTS.md first. The machine-readable manifest/ai-entrypoint.json points to retrieval, ontology, graph, provenance and validation files.",
          "Require the consuming AI to preserve uncertainty and cite the package evidence/source locator it actually used. README.md and AGENTS.md are instructions, not evidence sources.",
        ],
      },
      { kind: "heading", text: "Telling an agent what to read first" },
      {
        kind: "code",
        label: "Minimal prompt for a local agent",
        language: "text",
        body: "Read AGENTS.md in this folder first. Use manifest/ai-entrypoint.json to locate the compiled knowledge and evidence. Answer from this package, preserve uncertainty, and cite the source evidence you relied on. If the task requires the latest organizational state, tell me to use the live TAVONEL MCP/API instead of assuming this snapshot is current.",
      },
      { kind: "heading", text: "What each package file is for" },
      {
        kind: "table",
        head: ["Package path", "Use it for"],
        rows: [
          ["README.md", "Human-facing start guide and integration choices."],
          ["AGENTS.md", "Instructions for a filesystem-capable AI/agent."],
          ["manifest/ai-entrypoint.json", "Machine-readable map of the portable entrypoints and grounding rules."],
          ["rag/chunks.jsonl", "Generic retrieval/RAG ingestion."],
          ["rag/documents.jsonl", "Document-level retrieval records."],
          ["ontology/knowledge.jsonld", "JSON-LD semantic/ontology consumers."],
          ["ontology/knowledge.ttl", "RDF/Turtle graph consumers."],
          ["graph/nodes.csv + graph/relationships.csv", "Simple graph imports."],
          ["provenance/activities.jsonl", "Lineage and provenance inspection."],
          ["validation/report.json", "Whether the result passed validation or still requires review."],
          ["manifest/export-manifest.json + signatures/", "Integrity verification for every signed package entry."],
        ],
      },
      {
        kind: "note",
        text: "A filesystem path is not a connector. If an AI application cannot read local files, upload the package or use MCP/API instead of pasting a path it cannot access.",
      },
    ],
  },
  {
    slug: "ontology-output",
    title: "Use the ontology output",
    group: "External AI",
    summary: "Import the Compiled World ontology into RDF, linked-data and graph systems without losing validation, evidence or stable identity.",
    blocks: [
      { kind: "heading", text: "The two projections in every package" },
      { kind: "prose", text: "Every portable package includes **ontology/knowledge.jsonld** and **ontology/knowledge.ttl**. They are semantic projections of the Compiled World. The current export is RDF/JSON-LD with TAVONEL node kinds and compiled relation predicates; it should not be described as a hand-authored OWL/TBox schema. Keep provenance and validation beside the ontology, because the ontology is for semantic navigation and integration rather than a replacement for source evidence." },
      /*
        Audit K01/K05: the predicate set, named as what the engine emits rather than as an
        ontology's vocabulary.
        - The live engine (Core V2) projects three relations into the candidate: `supported_by`
          from a claim to one exact document version, `mentions` from a claim to an entity, and
          `contradicts` between two claims. The first two were always computed; R3-K09 is why
          the last two now reach the package at all -- the projection used to discard every
          RELATION and VALIDATION_RECORD object the Core produced. Its knowledge model has no
          Topic kind, so the candidate reports `topics: 0` and no `discusses_topic` edge is
          produced on this path.
        - `discusses_topic` and `mentions_entity` come from the TypeScript fallback engine, which
          is what builds the public Explore sample. Both are document-level text heuristics: a
          keyword rule set and a capitalised-token scan. They are not the live engine's
          `mentions`, whose subject is a claim rather than a document.
        A reader planning a SPARQL query needs the emitted set, not the intended one. This table
        is written by hand today; it is regenerated from the emitter's own predicate constant once
        that constant exists (`CORE_RELATION_PREDICATES` covers the live engine's half).
      */
      { kind: "heading", text: "The predicates each engine emits" },
      {
        kind: "table",
        head: ["Predicate", "Emitted by", "How it is derived"],
        rows: [
          ["supported_by", "Live engine and fallback engine", "A claim to the evidence for one exact document version, carrying the evidence id"],
          ["mentions", "Live engine only", "A claim to an entity, from a case-folded match over capitalised phrases, acronyms and Korean organisation names in that claim's own sentence"],
          ["contradicts", "Live engine only", "Two claims that disagree on a number or on whether something is the case, inside one topic and one time reference. A candidate for review, not a resolution, and blind to jurisdiction, units and exception clauses"],
          ["mentions_entity", "Fallback engine only", "Document-level co-occurrence from a capitalised-token scan, not read semantics"],
          ["discusses_topic", "Fallback engine only", "Document-level co-occurrence from a small keyword rule set; the live engine has no Topic kind"],
        ],
      },
      { kind: "note", text: "Relations the ontology vocabulary could express and no engine emits — `supports`, `supersedes`, `depends_on` — are not in a package. Query for a predicate that is not in the table above and the result is empty rather than wrong. `contradicts` is in a package now and was not before, so a query written against an older export finds nothing rather than nothing being there; and a `contradicts` row is a flagged pair awaiting a person, never a decided conflict." },
      { kind: "heading", text: "Loading it into a target system" },
      {
        kind: "table",
        head: ["Target", "Use", "Important companion"],
        rows: [
          ["JSON-LD / linked-data application", "ontology/knowledge.jsonld", "provenance/activities.jsonl + validation/report.json"],
          ["RDF store / SPARQL / RDF tooling", "ontology/knowledge.ttl", "canonical/model.json + provenance/ + validation/"],
          ["Neo4j or another property-graph import", "graph/nodes.csv + graph/relationships.csv", "Keep the same stable ids and evidence ids"],
          ["Production AI or agent", "Prefer live MCP/API", "The active World stays current and preserves access/evidence resolution"],
        ],
      },
      {
        kind: "steps",
        items: [
          "Read validation/report.json first. A review_required candidate is not approved organizational truth.",
          "Choose JSON-LD for linked-data JSON consumers, Turtle for RDF/SPARQL consumers, or the CSV graph for property-graph import.",
          "Preserve every urn:tavonel:<id> identifier. Those ids are the join key across ontology, canonical model, graph and evidence-bearing records.",
          "Do semantic traversal in the ontology, but resolve factual claims back to provenance/evidence before presenting them as grounded answers.",
          "Treat a signed ZIP as a snapshot. When the active World changes, import the newer signed projection or use MCP/API instead of editing the old snapshot in place.",
        ],
      },
      { kind: "heading", text: "Inspecting it with SPARQL" },
      {
        kind: "code",
        label: "Portable SPARQL inspection",
        language: "text",
        body: "SELECT ?resource ?type ?label\nWHERE {\n  ?resource a ?type .\n  OPTIONAL { ?resource <http://www.w3.org/2000/01/rdf-schema#label> ?label }\n}\nLIMIT 50",
      },
      { kind: "note", text: "The Turtle projection serializes node types, rdfs:label values and compiled relations. The JSON-LD projection also carries node evidence references through the PROV mapping in its context. For exact source locators, keep the provenance/evidence material from the same signed package." },
    ],
  },
  {
    slug: "concepts",
    title: "Concepts",
    group: "Getting started",
    summary: "Sources, Compiled Worlds, candidate and active versions, and evidence.",
    blocks: [
      { kind: "heading", text: "Sources" },
      { kind: "prose", text: "A **source** is an immutable document version. Uploading the same file twice produces two documents with two source records that share one content digest; nothing merges them, each citation names one of the documents carrying those bytes, and editing the file produces a second version without rewriting the first." },
      { kind: "heading", text: "Compiled Worlds" },
      { kind: "prose", text: "A **Compiled World** is what a set of sources compiles into: semantic objects, relations between them, and the evidence each one rests on. It is addressed by a collection id and a manifest digest, and the digest is computed over the whole artifact, so two Worlds with the same digest are the same World." },
      { kind: "heading", text: "Candidate and active versions" },
      { kind: "prose", text: "A **candidate** version is a compile result nobody has accepted yet. An **active** version is the one answers are served from. Activation is an explicit human action in a signed-in session — no API key can activate a candidate, and no compile activates itself." },
      { kind: "heading", text: "Evidence" },
      { kind: "prose", text: "**Evidence** is a page and a region on that page, bound to a source version by digest. An object with no evidence is not published, and an answer that cannot cite one abstains rather than guessing." },
      { kind: "heading", text: "Objects, and what an Object is not" },
      { kind: "prose", text: "An **Object** is one thing the compiler found in your sources — a policy, an obligation, a party, a figure — with a stable key derived from its content rather than from where it appeared, and with the evidence it rests on underneath it. The key is what a later compile of the same content resolves to, which is why an object id is worth storing. What the key does not do is reach across separate compiles: two parts of one run compile to two Worlds, and deciding that an entity in one and an entity in the other are the same thing is identity resolution with its own evidence requirements. Nothing here does that on your behalf, and joining them without it would manufacture duplicates." },
      { kind: "heading", text: "Activation, and the World Gate" },
      { kind: "prose", text: "**Activation** is the act of making a candidate version the active one. It happens in a signed-in browser session, by a person holding the workspace owner or admin role, and there is no scope that grants it — you will not find one in the scope table, because none exists. The **World Gate** is the filter every retrieved region passes before it can reach an answer: it admits a region only if the region belongs to your tenant, belongs to the active World version, and is bound to evidence. A region that fails any of the three is reported in retrieval.gateRejections with its reason rather than quietly dropped." },
      { kind: "heading", text: "Manifest digest, lens, ContextPacket" },
      { kind: "prose", text: "A **manifest digest** is the sha256 over the whole compiled artifact, written sha256: followed by 64 hex characters. It is the version identifier: two Worlds with the same digest are the same World, and a digest is what you pass to read a specific version or to ask whether the copy you hold is still current. A **lens** is one slice of the World read model — objects, relations, evidence, history, files or review — readable on its own so a consumer that needs one does not fetch the whole graph. A **ContextPacket** is what retrieval returns: the evidence-bound regions it selected, each with its source version, page and region, plus the ranks and the reranker score that put it there. It is the same runtime contract Ask, Search, the MCP server and the CLI all share, which is why an answer and a search result cite the same way." },
      { kind: "heading", text: "Ontology output" },
      { kind: "prose", text: "The **Ontology output** is the RDF and JSON-LD projection of a compiled World, shipped in the signed package as ontology/knowledge.ttl and ontology/knowledge.jsonld. It is a projection of the objects and relations that were compiled, not a hand-authored schema: a predicate is in it because an engine emitted it, and predicates the vocabulary could express and no engine emits are published as absent, so a query for one returns empty rather than wrong." },
      { kind: "heading", text: "The life of a Compiled World" },
      {
        kind: "diagram",
        name: "world-lifecycle",
        caption: "Source, candidate, active, evidence. The two transitions that are not automatic are the two that matter: a compile turns sources into a candidate, and a person turns a candidate into the active version. Nothing is served from a candidate, and no key can activate one.",
      },
      { kind: "heading", text: "What each identifier changes with" },
      {
        kind: "table",
        head: ["Term", "Identified by", "Changes when"],
        rows: [
          ["Source version", "the document plus the sha256 of its sanitized bytes", "the file changes"],
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
    group: "Getting started",
    summary: "Bearer keys, the scopes they carry, and what no key can do.",
    blocks: [
      { kind: "heading", text: "Getting a key" },
      { kind: "prose", text: "Keys are created in the workspace, under **Developers**. The plaintext is shown once, at creation, and is not recoverable afterwards — store it before you close the dialog. Creating, rotating and revoking a key each write an audit row, readable through the audit endpoint below. A request with no key, or with a key this deployment did not issue, is refused with 401 and the code **AUTH_REQUIRED**: that is the first error most integrations see, and it means the credential rather than the request." },
      { kind: "heading", text: "Sending the key" },
      { kind: "prose", text: "Send the key as a bearer token. Keys are workspace-scoped and carry an explicit scope set; a request outside its scopes is refused with 403 and API_SCOPE_REQUIRED rather than silently returning less." },
      { kind: "code", label: "Every request", language: "bash", body: `curl -sS https://tavonel.com/api/v1/documents -H "${KEY_HEADER}"` },
      { kind: "heading", text: "The scopes a key can hold" },
      {
        kind: "table",
        head: ["Scope", "Grants"],
        rows: DEVELOPER_SCOPES.map((scope) => [scope, SCOPE_COPY[scope] ?? "See the endpoint reference."]),
      },
      { kind: "heading", text: "How often you may call" },
      { kind: "prose", text: "Every scoped request consumes one unit of a per-minute allowance held per key and per scope. The window is a clock minute rather than a rolling one, so an allowance that is spent is free again at the top of the next minute. The per-scope numbers are on the Billing and limits page, printed from the same values the authorizer enforces." },
      { kind: "note", text: "Over the allowance the answer is 429 with **API_RATE_LIMITED**. No Retry-After header is sent on that code today and no X-RateLimit-* headers are published — waiting for the next clock minute is sufficient by construction, and documenting a header we do not send would be worse than documenting the window. The separate hourly allowance on World activation, rollback and retrieval-index rebuild answers ACTIVATION_RATE_LIMITED and does carry Retry-After." },
      { kind: "heading", text: "Rotating a key, and reading the audit trail" },
      { kind: "prose", text: "Rotation is atomic: a replacement key is created, the source key is revoked and an audit event is written, or none of the three happened. There is no window in which the old key is dead and no replacement exists. Both operations take a signed-in browser session — a developer API key cannot call them, which is the same boundary activation sits behind." },
      { kind: "endpoint", operationId: "rotateDeveloperApiKey" },
      { kind: "endpoint", operationId: "listDeveloperAuditEvents" },
      { kind: "heading", text: "What no key can do" },
      { kind: "note", text: "Activation, rollback and destructive workspace actions are human-session-only. There is no scope that grants them, which is why you will not find one in this table." },
    ],
  },
  {
    slug: "files-and-formats",
    title: "Files and formats",
    group: "Input and compile",
    summary: "What can be uploaded, what is expanded in the browser, and the ceilings on both.",
    blocks: [
      { kind: "heading", text: "What is accepted" },
      { kind: "prose", text: `${describeAcceptedFormats(CAPABILITY_MANIFEST)} are accepted, and nothing else is. A ZIP archive is expanded before upload so its contents arrive as individual sources, which is why the archive ceilings below are browser limits rather than server ones.` },
      /*
        The support table is the manifest, not a description of it.

        `shared/capabilityManifest.ts` is what the upload route validates against and what
        /sources publishes; printing it here keeps the documentation from being the one copy
        that fell behind. The tier and the preserved list are deliberately unglamorous -- every
        source is sanitized to PDF and read by OCR today, so every row says the same three
        things, and a reader planning an integration needs to know that before they send us a
        spreadsheet expecting cells.
      */
      { kind: "heading", text: "What each format preserves" },
      {
        kind: "table",
        head: ["Format", "Support tier", "What is preserved"],
        rows: CAPABILITY_MANIFEST.entries.map((entry) => [
          entry.extensions.map((extension) => `.${extension}`).join(" "),
          entry.status,
          entry.preserved.length > 0 ? entry.preserved.join(", ") : "nothing — not compiled",
        ]),
      },
      { kind: "note", text: "Every format above is read through the same sanitize-to-PDF and OCR path, and the table states exactly what each one preserves. A format moves above its tier only with a published qualification result and the date it was produced. The Sources page prints the same manifest with every limitation attached." },
      /*
        G3-002, the P0 on this page.

        "The ceilings, and why they are those numbers" listed three browser-side archive limits
        and neither of the two the deployment actually refuses on. A developer read a section
        promising the ceilings and learned neither of the ones that would stop them -- and the
        quickstart's example requests 180 KB, comfortably under the cap, so substituting a real
        manual.pdf was the first thing that failed. Both rows come from shared/intakeCeiling.ts,
        the module the capability route, the CDR worker, the rasterizer and migration 0051's
        CHECK constraint all read.
      */
      { kind: "heading", text: "What is not extracted" },
      { kind: "note", text: "**Tables and formulas are not extracted.** Every format in the table above is read through the same sanitize-to-PDF and OCR path, so a price table arrives as the paragraphs it was printed as and the grid that arranged them is not recovered. A spreadsheet's cells and formulas survive nothing on this deployment. The capability manifest carries no_table_or_formula_extraction on every entry; this is that token in a sentence, on the page a developer reads to decide whether their documents will work." },
      { kind: "heading", text: "The ceilings, and why they are those numbers" },
      {
        kind: "table",
        head: ["Limit", "Value", "Why it is that number"],
        rows: [
          ["**Bytes per source**", `${PROCESSING_CEILING_MIB} MB`, "No processor in the chain reads more, so nothing above it can ever be compiled. Refused at the capability call with 413 and SOURCE_EXCEEDS_PROCESSING_CEILING, before any byte is stored."],
          ["**Pages per source**", String(PROCESSING_CEILING.maxSourcePages), "The most the rasterizer renders. It cannot be checked at intake, because intake deliberately never decodes the document, so it is disclosed here and refused after the bytes are read rather than at the door."],
          ["Files in one archive", String(MAX_FILES), "The largest expansion a browser tab performs without becoming unresponsive."],
          ["Archive size, no worker", `${MAX_SYNC_ARCHIVE_BYTES / 1_048_576} MB`, "Expansion on the main thread; larger would block the tab."],
          ["Archive size, with a worker", `${MAX_WORKER_ARCHIVE_BYTES / 1_048_576} MB`, "Expansion off-thread, where the ceiling is memory rather than responsiveness. The manifest's at_most_128_files_and_500_mb_expanded is the expanded total, not the size of the archive you select."],
        ],
      },
      { kind: "note", text: `${PROCESSING_CEILING_SENTENCE} Both numbers are in the capability manifest as ${PROCESSING_CEILING_LIMITATIONS.join(" and ")}, so a client can read them before it uploads instead of learning them from a refusal.` },
      { kind: "heading", text: "Reading the manifest yourself" },
      { kind: "prose", text: "The support table above is this endpoint, rendered. It needs no key, and it is the same list the upload route validates against — a format absent from it is refused at upload rather than accepted and dropped." },
      { kind: "endpoint", operationId: "getCapabilityManifest" },
      /*
        R9 finding #4. This note used to say a spreadsheet's billable unit "is not decided, so
        page counts for spreadsheets are reported as unknown rather than estimated", while
        `billing-and-limits` in this same file said they were in the estimate as a byte-derived
        upper bound. Both were describing the code of their own moment and they contradicted each
        other. The unit is now decided -- the pages of the sanitized PDF -- and the byte bound is
        gone from `estimateBillablePages` entirely, so the two sections say one thing.
      */
      { kind: "heading", text: "Archives that are refused" },
      { kind: "note", text: "Encrypted archives, nested archives and paths that escape the archive root are refused at expansion time, not after upload. A spreadsheet is billed on the pages of the sanitized PDF it is converted to, counted after that conversion — so before a compile there is no page number for one, and preflight shows its absence rather than a figure derived from the file size." },
    ],
  },
  {
    slug: "upload",
    title: "Upload",
    group: "Input and compile",
    summary: "Direct-to-storage upload, and why bytes never reach the application server.",
    blocks: [
      { kind: "note", text: `**Before you start.** ${activationPolicy.customerData.reason} Everything on this page is the contract the capability endpoint serves once intake is arranged; it is not a request this deployment will accept from you today.` },
      { kind: "heading", text: "Why bytes never reach our server" },
      { kind: "prose", text: "Uploads are direct. The capability endpoint returns a short-lived URL to object storage; you PUT the bytes there. The application server sees the request for permission and the receipt afterwards, and never the document." },
      { kind: "heading", text: "Requesting a capability and listing documents" },
      { kind: "note", text: `requestedBytes is the field the per-source byte ceiling acts on. Above ${PROCESSING_CEILING_MIB} MB the answer is **413 SOURCE_EXCEEDS_PROCESSING_CEILING**, carrying maxBytes, maxPages and a sentence you can show a person — before any byte is stored, because admitting the file would only move the refusal somewhere you cannot see it. A free evaluation has its own lower bound and answers TRIAL_FILE_TOO_LARGE with its own maxBytes.` },
      { kind: "endpoint", operationId: "createDirectUploadCapability" },
      { kind: "endpoint", operationId: "listDocuments" },
      /*
        G3-013. Step 2 of the quickstart is the PUT, and this page documented the two calls on
        either side of it: no example, no header list, no TTL, no expiry behaviour. The actual
        upload was the one step with nothing written about it.
      */
      { kind: "heading", text: "The PUT itself" },
      { kind: "prose", text: "The capability response carries url, method, headers and expiresAt. Send exactly the headers it lists and no others: the URL is signed over that header set, so an extra header, a different content-type or a content-length that does not match the bytes makes the signature invalid and object storage refuses the PUT. Do not send your API key to this URL — the capability is the credential, and the storage host has no use for a TAVONEL key." },
      {
        kind: "snippets",
        label: "Upload the bytes",
        items: [
          {
            label: "cURL", language: "bash",
            body: [
              "# URL, TYPE and SIZE are capability.url, capability.headers and requestedBytes.",
              "curl -sS -X PUT \"$URL\" \\",
              "  -H \"content-type: $TYPE\" \\",
              "  -H \"content-length: $SIZE\" \\",
              "  --data-binary @manual.pdf",
              "# 200 with an empty body. A 403 naming an expired request means the capability",
              "# window closed: ask for a new one rather than retrying this URL.",
            ].join("\n"),
          },
          {
            label: "Python", language: "python",
            body: [
              "import pathlib, urllib.request",
              "",
              "body = pathlib.Path(\"manual.pdf\").read_bytes()",
              "put = urllib.request.Request(capability[\"url\"], data=body, method=\"PUT\")",
              "for name, value in capability[\"headers\"].items():",
              "    put.add_header(name, value)",
              "# The PUT is unauthenticated: the capability URL is the credential, and it is short-lived.",
              "with urllib.request.urlopen(put, timeout=120) as response:",
              "    assert response.status == 200, response.status",
            ].join("\n"),
          },
          {
            label: "TypeScript", language: "typescript",
            body: [
              "const bytes = await readFile(\"manual.pdf\");",
              "const put = await fetch(capability.url, {",
              "  method: capability.method,",
              "  headers: capability.headers,",
              "  body: bytes,",
              "});",
              "// No Authorization header here. The signed URL is the credential.",
              "if (!put.ok) throw new Error(`upload failed: ${put.status}`);",
            ].join("\n"),
          },
        ],
      },
      { kind: "heading", text: "How long the URL lives, and what happens when it does not" },
      { kind: "note", text: "expiresAt in the capability response is the authority, and it is an absolute instant rather than a duration — read it, do not assume a number. The window is deliberately short: a signed URL is a credential that travels, and a long-lived one is a long-lived credential. After it passes, object storage refuses the PUT with its own expiry error and nothing was written; request a fresh capability for the same file. A document id issued for a capability that was never used carries no bytes, is never compiled, and needs no cleaning up." },
      { kind: "heading", text: "The codes these endpoints return" },
      { kind: "note", text: "**402** on the capability call is a plan or balance refusal — STUDIO_SUBSCRIPTION_REQUIRED, GPU_CREDITS_REQUIRED, or one of the TRIAL_ codes on a free evaluation. **429** is INTAKE_RATE_LIMITED (honour Retry-After: 60), INTAKE_DAILY_QUOTA_EXCEEDED (Retry-After: 3600), or API_RATE_LIMITED for the per-minute scope allowance. Every code named here is in the Errors catalogue with what to do about it." },
    ],
  },
  {
    slug: "collections-and-compile",
    title: "Collections and compile",
    group: "Input and compile",
    summary: `A compile carries up to ${COMPILE_MAX_DOCUMENTS} documents; a run carries up to ${CORPUS_MAX_DOCUMENTS}.`,
    blocks: [
      { kind: "prose", text: `A compile takes between ${COMPILE_MIN_DOCUMENTS} and ${COMPILE_MAX_DOCUMENTS} documents. That is one Core request and one artifact, and it is not the limit on how much you can compile: a selection larger than that is partitioned server-side into parts of that size and answered as a corpus, up to ${CORPUS_MAX_DOCUMENTS} documents in one run.` },
      { kind: "heading", text: "Corpora and their parts" },
      { kind: "prose", text: "Each part of a corpus is an ordinary compile job with its own id, state and event stream. The parts are not merged into one World: deciding that an entity in one part and an entity in another are the same thing is identity resolution with its own evidence requirements, and joining the ontologies without it would manufacture duplicates." },
      { kind: "heading", text: "Starting a compile and reading a corpus" },
      { kind: "endpoint", operationId: "startCompileJob" },
      { kind: "endpoint", operationId: "getCompileCorpus" },
      { kind: "endpoint", operationId: "compileCollection" },
      { kind: "heading", text: "Picking a run back up" },
      { kind: "prose", text: "A client that lost its job id does not have to start again: the workspace's recent compiles are listable, newest first." },
      { kind: "endpoint", operationId: "listCompileJobs" },
      { kind: "heading", text: "Submitting the same set twice" },
      { kind: "note", text: "Submitting the same document set again returns the job that already exists. A retried request, a double-clicked button and an at-least-once redelivery converge on one compile. Idempotency here is derived from the document set rather than from an Idempotency-Key header: there is no such header on this API, and a client expecting the Stripe convention should send the same set rather than a key." },
    ],
  },
  {
    slug: "run-events",
    title: "Run events",
    group: "Input and compile",
    summary: "The persisted transition log, and how to resume it after a disconnect.",
    blocks: [
      { kind: "heading", text: "The transition ledger" },
      { kind: "prose", text: "A compile publishes its transitions to an append-only ledger. The event stream replays that ledger from `Last-Event-ID` and then follows it, so a client that reconnects sees everything it missed rather than the current state alone." },
      { kind: "endpoint", operationId: "streamCompileJobEvents" },
      { kind: "endpoint", operationId: "getCompileJob" },
      { kind: "heading", text: "Resuming after a disconnect" },
      {
        kind: "code",
        label: "Resume after a disconnect",
        language: "bash",
        body: `curl -N https://tavonel.com/api/compile-jobs/<jobId>/events \\\n  -H "${KEY_HEADER}" \\\n  -H "Last-Event-ID: 42"`,
      },
      { kind: "heading", text: "Reconnecting is the normal case" },
      { kind: "note", text: "The server closes the stream on its own clock. Reconnecting is the normal case, not an error path — every frame carries the sequence to resume from." },
      /*
        G3-031. Two event streams exist and one was documented. This is the other: observed runs
        -- a connector sync, an intake -- rather than a compile's own transitions.
      */
      { kind: "heading", text: "The other stream: observed runs" },
      { kind: "prose", text: "A compile has its own transitions, above. A connector sync or an intake is an observed run, with its own append-only event ledger and its own stream. Both resume the same way, from Last-Event-ID; this one also accepts an after query parameter for clients that cannot set the header, and sends a bounded heartbeat so an intermediary does not close an idle connection." },
      { kind: "endpoint", operationId: "streamRunEvents" },
    ],
  },
  {
    slug: "review",
    title: "Review",
    group: "Input and compile",
    summary: "Partial failures, the four decisions, and the one that cannot be taken casually.",
    blocks: [
      { kind: "heading", text: "When a compile stops and waits" },
      { kind: "prose", text: "A compile that cannot read every source stops and waits. Nothing is skipped automatically: a World quietly missing documents you believe are in it is worse than a compile that asks." },
      { kind: "heading", text: "The four decisions" },
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
      { kind: "heading", text: "Answering blockers, or cancelling" },
      { kind: "endpoint", operationId: "resolveCompileJobBlockers" },
      { kind: "endpoint", operationId: "cancelCompileJob" },
      { kind: "heading", text: "Recording a decision over evidence" },
      { kind: "prose", text: "Blockers are one half of review. The other is the append-only record of what a person decided about a piece of evidence: Accept, Edit or Reject, each with a reason of at least eight characters, because a decision with no reason is a decision nobody can audit." },
      { kind: "prose", text: "The request carries the manifest digest you read the evidence at, and the server revalidates the evidence against the persisted World before it writes. If the World moved in between, the answer is 409 REVIEW_WORLD_CHANGED and nothing is recorded — a decision written against a version it does not describe is worse than no decision. Re-read at the current digest and decide again. This route takes a signed-in browser session; no API key records a review." },
      { kind: "endpoint", operationId: "recordEvidenceReview" },
      { kind: "heading", text: "What continue will not do" },
      { kind: "note", text: "A file stopped by a safety check leaves the set only through an explicit removal. `continue` will not step over it, because a pipeline that learns to skip security stops has stopped being one." },
    ],
  },
  {
    slug: "world-api",
    title: "World API",
    group: "World and questions",
    summary: "Reading a compiled World, its objects, relations and evidence.",
    blocks: [
      { kind: "heading", text: "Reading a World by collection id" },
      { kind: "prose", text: "A World is read by collection id. Objects carry their stable keys, the relations they participate in and the evidence they rest on; evidence carries the source version, the page and the region." },
      /*
        R9 finding #3. This block named `getCollection`, which is a different artifact: `GET
        /collections/{id}`, scope `collections:read`, "reviewable candidate artifact" -- the raw
        compile package, not a World read model. So the page's only endpoint sent an integrator to
        a route that does not return what the sentence above it describes.

        The scope table on this same page already said which one was meant: `worlds:read` reads
        "the active World, its objects, relations and evidence". Both World operations are named
        now, because the per-lens read is how anyone consuming one lens at a time uses this page.
      */
      { kind: "heading", text: "Finding a World to read" },
      { kind: "prose", text: "An agent holding only an API key needs a way to find out which collection ids exist without a person pasting one in. Only active Worlds are listed: a candidate nobody activated is not what the workspace answers from, and a list mixing the two would present unaccepted output as organizational truth." },
      { kind: "endpoint", operationId: "listActiveWorlds" },
      { kind: "endpoint", operationId: "getActiveWorld" },
      { kind: "heading", text: "The six lenses" },
      {
        kind: "table",
        head: ["Lens", "What it holds", "Pages"],
        rows: [
          ["objects", "Every Object, with its stable key and label.", "limit and cursor"],
          ["relations", "Every relation, with the objects it joins.", "limit and cursor"],
          ["evidence", "Every region, with its source version, page and bbox in the 0-1000 frame.", "limit and cursor"],
          ["history", "The version history of this collection.", "no — answers WORLD_LENS_NOT_PAGEABLE"],
          ["files", "The sources this World was compiled from.", "no — answers WORLD_LENS_NOT_PAGEABLE"],
          ["review", "Recorded human decisions over evidence.", "no — answers WORLD_LENS_NOT_PAGEABLE"],
        ],
      },
      { kind: "heading", text: "The whole read model, or one lens" },
      { kind: "endpoint", operationId: "getWorldReadModel" },
      { kind: "endpoint", operationId: "getWorldLens" },
      { kind: "heading", text: "The candidate behind a version" },
      { kind: "prose", text: "The reviewable candidate artifact is a different read from the World read model: it is the raw compile package, before anyone activated it, and it is what a review surface works against. A World read is what answers come from." },
      { kind: "endpoint", operationId: "getCollection" },
      { kind: "heading", text: "Is the copy I hold still current?" },
      { kind: "prose", text: "A signed package you downloaded verifies offline and cannot be recalled remotely, and a rollback restores a prior revision without undoing anyone's use of an older answer. Neither of those changes here. What this does is let a holder check, live, whether the digest they hold is still the one the workspace answers from — active: false means a different version is active now, not that the copy was withdrawn, and knownToWorkspace: false is a different answer again: no record of ever activating that digest." },
      { kind: "endpoint", operationId: "getManifestStatus" },
      { kind: "heading", text: "What is never in a response" },
      { kind: "note", text: "Route features, scores, thresholds and the cost matrix are not in any public response. They are internal, and a public DTO that filtered them would be one refactor away from leaking them." },
    ],
  },
  {
    slug: "search",
    title: "Search",
    group: "World and questions",
    summary: "Hybrid retrieval — lexical, dense and structure, RRF-fused and reranked — over the active World.",
    blocks: [
      { kind: "heading", text: "What Search runs against" },
      { kind: "prose", text: "Search runs against the active version. A workspace with no activated World returns nothing rather than falling back to a candidate — an answer from a version nobody accepted is not a smaller answer, it is a different one." },
      { kind: "heading", text: "The pipeline, source by source" },
      { kind: "prose", text: "Three retrieval sources run concurrently over the World's compiled index: lexical full-text, dense vectors, and structure (claim and entity overlap with what the query already matched). Their ranks are fused with reciprocal rank fusion — ranks only, so native scores from different scoring spaces never mix — then reranked, then filtered by the World Gate, which admits a region only if it belongs to your tenant, to the active world version, and is bound to evidence." },
      { kind: "heading", text: "The fields that say what ran" },
      {
        kind: "table",
        head: ["Field", "What it tells you"],
        rows: [
          ["retrievalPath", "Always `compiled-retrieval-v1`. Search has no excerpt fallback — see the table on the Ask page for what the other value means and where it can appear."],
          ["degradations", "A named list of what did not run. Empty means every source ran."],
          ["retrieval.lexicalCandidates / denseCandidates / structureCandidates", "How many candidates each source returned before fusion."],
          ["retrieval.rerankerApplied", "False means the fused order was returned as-is."],
          ["retrieval.gateRejections", "Regions the World Gate refused, with the reason."],
          ["freshness", "The four timestamps and the awaiting-activation flag described on the Ask page."],
        ],
      },
      { kind: "prose", text: "A degradation is reported, never hidden. `dense retrieval skipped: no embedder configured` means the answer came from lexical and structure alone; a reranker outage returns the fused order and says so. Reading `degradations` is how you tell a full-pipeline result from a partial one — the two otherwise look identical." },
      { kind: "heading", text: "When there is no compiled index" },
      { kind: "note", text: "Search requires a compiled retrieval index for the active World. Without one the response is 409 with the code RETRIEVAL_RUN_NOT_FOUND (or RETRIEVAL_PROFILE_NOT_FOUND), carrying `retrievalIndex` and `retrievalNotice` to say which state the index is in. It is not a 200 with fewer results: Search has no fallback, and a weaker answer presented as the real one is worse than a refusal you can act on. POST /v1/collections/{id}/retrieval-index rebuilds the index. It takes the collections:compile scope, the owner or admin role, and the same plan bar activating a World takes: **Team**, or **Developer** held by the workspace owner. The two bars are identical on purpose — this endpoint is the recovery path for an activation whose index did not compile, so a plan that may activate and may not rebuild would leave its own Worlds answering from the fallback with nothing to call." },
      { kind: "endpoint", operationId: "searchActiveWorld" },
      { kind: "heading", text: "Rebuilding the index" },
      { kind: "prose", text: "Rebuilding is a no-op that returns alreadyCompiled: true when a completed run for that World version already exists, so it is safe to call before a search rather than only after one fails. The manifest comes from the active pointer, which is why this cannot index a candidate nobody activated. A rebuild that does not reach a queryable index answers 503 with RETRIEVAL_INDEX_NOT_COMPILED and the failure class in retrievalIndex.errorClass — never a 200 over a half-built index, because half an index is not a smaller index." },
      { kind: "endpoint", operationId: "recompileRetrievalIndex" },
    ],
  },
  {
    slug: "ask",
    title: "Ask",
    group: "World and questions",
    summary: "Grounded answers, their citations, which retrieval runtime answered, and when the system abstains.",
    blocks: [
      { kind: "heading", text: "How an answer is built" },
      { kind: "prose", text: "Ask retrieves regions from the active World and answers from them. Every answer carries the regions it used, with the source version, page and bounding box of each. The answer text is those regions' excerpts, concatenated in the order the retriever ranked them — `answerMode` is `evidence_excerpts`, and no language model writes any part of it. That is a deliberate boundary, not a gap waiting to be filled quietly: the day a model does generate an answer, `answerMode` will say a different word, and you will be able to tell from the response rather than from a changelog." },
      { kind: "heading", text: "Abstention, and why it is a result" },
      { kind: "prose", text: "When no region matched the question, the response is an abstention with a reason. That is a result, not a failure: an answer with no evidence behind it is the failure. A region can also be retrieved and still not be citable — if it carries no evidence binding it is dropped, and an answer left with no citations abstains rather than claiming something no region supports." },
      { kind: "heading", text: "Which runtime answered" },
      { kind: "prose", text: "Two retrieval runtimes can answer, and the response always says which one did. `retrievalPath` is the field; both values are real and neither is a placeholder." },
      {
        kind: "table",
        head: ["retrievalPath", "What answered, and when you see it"],
        rows: [
          ["compiled-retrieval-v1", "The compiled hybrid pipeline: lexical, dense and structure retrieval, RRF-fused, reranked, World Gate filtered. Also returns `contextPacket` and `retrieval` diagnostics. This is the path when the active World has a completed retrieval compile run."],
          ["excerpt-concatenation-fallback", "Excerpt concatenation over the active artifact, scored lexically with graph and temporal signals. Answers are still evidence-bound and citations are built directly from evidence, so this path cannot invent one — but it runs neither dense nor structure retrieval and it is not reranked. You see it whenever the active World has no queryable compiled index."],
        ],
      },
      { kind: "prose", text: "The fallback is not a rare edge. A World activated before its index was compiled, a compile that failed on an unreachable embedder, and a run still in flight all land here, and the response distinguishes them: `retrievalIndex.status` is `missing`, `compiled` or `failed`, `retrievalIndex.errorClass` names the failure class, and `retrievalNotice` says the same thing in a sentence. An index that exists but has not finished is reported as `missing` — an incomplete index is not queryable, and half an index is not a smaller index." },
      { kind: "prose", text: "Both paths return `answer`, `reason`, `citations`, `receipt`, `activeWorld`, `freshness`, `answerMode` and `retrievalPath`. What differs is the per-citation scoring, and it is not normalized across the two: the fallback reports `relevance` with its lexical, graph, temporal and authority breakdown, while the compiled path reports each source's rank and the reranker score. Presenting one as the other would mean inventing a number neither path measured." },
      { kind: "prose", text: "The two paths differ in retrieval quality, so read `retrievalPath` before comparing answers across Worlds: a difference between two answers can be a difference between two runtimes rather than between two corpora." },
      { kind: "heading", text: "The freshness clocks" },
      {
        kind: "table",
        head: ["freshness", "Which clock it is"],
        rows: [
          ["observedAt", "When the source bytes were first observed. Null where the source ledger has no row for this World's documents."],
          ["processedAt", "When the compile job reached a terminal state."],
          ["reviewedAt", "When a person answered a compile blocker. This is the only review instant recorded — it is not a general 'someone reviewed this World' timestamp, and it stays null when a compile had no blockers."],
          ["activatedAt", "When a person made this version the active World."],
          ["activeManifestDigest", "The version this answer came from."],
          ["candidateAwaitingActivation / candidateManifestDigest", "True, with the digest, when a newer compiled version exists that nobody has activated. You are reading the previous active World until a person activates it."],
        ],
      },
      { kind: "note", text: "A null in the freshness block means that value is not recorded, or could not be read. It is never a substitute drawn from one of the other clocks. `candidateAwaitingActivation` is also conservative: it is computed from versions the workspace has activated at least once, the manifest digest the latest compile recorded, and the candidate this request already loaded, so it can read false for a compile that ran before that digest was recorded." },
      { kind: "endpoint", operationId: "askActiveWorld" },
    ],
  },
  {
    slug: "connections",
    title: "Connections",
    group: "Operations and errors",
    summary: "Connected sources, their cursors, the sync batch contract, and what a revoke does immediately.",
    /*
      G3-015. This page was two paragraphs and a note, and seven API operations have it as their
      only plausible home: list, create, revoke, sync, and the three OAuth connector routes. It
      documented none of them, and the three richest schemas in the contract --
      ConnectionInput, ConnectionEvent and ConnectionBatch -- were unexplained, with a cursor
      described as "durable" and given no format, no example and no advance semantics.
    */
    blocks: [
      { kind: "heading", text: "What a connection is" },
      { kind: "prose", text: "A connection is a durable record of a source you run: a file server, an S3, R2 or MinIO bucket. The mode is always local_agent, and that word carries the whole security posture — **the agent runs in your environment and pushes outward; TAVONEL reaches into nothing.** secretReference must be null, because a local agent uses its own workload credentials and we never hold them. configuration carries only non-secret selectors: a bucket, a prefix, a region, a root label." },
      { kind: "endpoint", operationId: "listConnections" },
      { kind: "endpoint", operationId: "createConnection" },
      { kind: "heading", text: "The cursor, and what it is made of" },
      { kind: "prose", text: "Each connection carries one committed cursor, published as cursorSha256 and written sha256: followed by 64 hex characters. It is opaque: it is a digest over the collector's own position, not a timestamp, a page number or an offset you can construct. A connection that has never synced carries null." },
      { kind: "prose", text: "The only way to move it is to send a batch whose previousCursorSha256 equals the committed value. That is an optimistic lock, and it is what stops two collectors from both advancing one connection: the second one's batch does not match, the whole batch is refused with 409 CONNECTION_BATCH_CONFLICT, and nothing is applied. Re-read the cursor and rebuild from it — never retry the same batch against a moved cursor." },
      { kind: "heading", text: "The sync batch contract" },
      {
        kind: "table",
        head: ["Field", "What it carries"],
        rows: [
          ["batchId", "A UUID you choose. Replaying the identical batchId is idempotent — delivery is at-least-once and this is the consumer that makes it exactly-once. The response says which happened: status is applied or replayed."],
          ["previousCursorSha256", "The cursor as you last read it, or null for a connection that has never synced. The optimistic lock."],
          ["nextCursorSha256", "Where the collector stands after this batch. Committed only if every event in the batch is accepted."],
          ["manifestSha256", "A digest over the event set, so a truncated or reordered batch is refused rather than half-applied."],
          ["events", "Up to 5,000 ConnectionEvent objects."],
        ],
      },
      { kind: "prose", text: "A **ConnectionEvent** is one observed change at the source. kind is added, changed or deleted. nativeId is the source's own identifier, stable across revisions — an object key, a path, a file id. revision is the source's own version marker: an ETag, an mtime, a version id. Every field is required and several are explicitly nullable, which is the point: a collector that cannot compute a digest sends contentSha256: null rather than omitting the field, so \"not known\" and \"not sent\" are different states the server can tell apart." },
      { kind: "prose", text: "documentId and sourceIdempotencyKey travel together. Where the source type is qualified, the agent first requests an upload capability with x-tavonel-source-idempotency-key set to a sha256 over the source event, which makes the document id deterministic — a retried collection converges on one document instead of two. The sync batch then names that same pair, and the server revalidates it rather than trusting it." },
      { kind: "endpoint", operationId: "applyConnectionBatch" },
      { kind: "heading", text: "Revoking, and what survives it" },
      { kind: "prose", text: "A revoke takes effect on the next request rather than waiting for a background reindex. Immutable outputs already compiled are retained: a revoke stops future reads, it does not rewrite history, and a World compiled from that source keeps citing the source version it actually read. A revoke that the store could not record answers 503 rather than 204 — it is reported only when it is written." },
      { kind: "endpoint", operationId: "revokeConnection" },
      { kind: "heading", text: "OAuth connectors" },
      { kind: "prose", text: "Where a provider is configured on this deployment, a connection can be created through OAuth instead of a local agent. The authorization is single-use and PKCE, and it fails closed: unless both the provider client and the managed secret broker are configured, no authorization is started, because an authorization that cannot store a refresh secret is an authorization that ends in a broken connection. A revoke deletes the stored refresh secret and is reported as done only when the secret is actually gone." },
      { kind: "endpoint", operationId: "listOAuthConnectors" },
      { kind: "endpoint", operationId: "startOAuthConnectorAuthorization" },
      { kind: "endpoint", operationId: "revokeOAuthConnector" },
      { kind: "heading", text: "Availability by provider" },
      { kind: "note", text: "Connector availability differs by provider and by workspace, and listOAuthConnectors reports configured: false for a provider whose client this deployment does not hold rather than hiding it. The Integrations page states which are live; this page does not restate it, because two pages saying different things about the same connector is how that goes wrong." },
    ],
  },
  {
    slug: "exports",
    title: "Exports",
    group: "World and questions",
    summary: "The signed package: what is in it, and what the signature covers.",
    blocks: [
      { kind: "heading", text: "What a package contains" },
      { kind: "prose", text: "A compiled World exports as a package containing the canonical model, the ontology in Turtle and JSON-LD, the graph as CSV, the retrieval chunks, the evidence and a validation report. Every file carries its own sha256 and the manifest digest covers the set." },
      /*
        G3-007. This table listed 9 paths, /developers listed 14 and /docs/use-with-ai 11, and
        the only page that named canonical/model.json was this one -- for a file the exporter
        does not write. All three render PACKAGE_CONTENTS now, which is the exporter's own
        REQUIRED_PACKAGE_PATHS plus the six the same function adds on the way out.
      */
      { kind: "table", head: ["Path", "What it is"], rows: PACKAGE_CONTENTS.map(([path, purpose]) => [path, purpose]) },
      { kind: "heading", text: "Signature states a caller can observe" },
      {
        kind: "table",
        head: ["Artifact", "Signature state", "What happens"],
        rows: [
          ["Customer download", "Signed, or refused", "`GET /v1/collections/{id}/download` signs the manifest with Ed25519 or refuses with `EXPORT_SIGNER_NOT_CONFIGURED` (503). There is no third outcome: you never receive an archive still in the candidate state."],
          ["Public sample World", "Deliberately unsigned", "The sample on the Reproducibility page is a fixture, labelled unsigned, and is not an activated customer World. Do not use it to test the signature path."],
        ],
      },
      { kind: "heading", text: "Downloading it, and fetching the key to check it with" },
      { kind: "prose", text: "The download signs the manifest at request time or refuses; there is no candidate archive to receive by accident. The trust record is the other half and is deliberately a separate, unauthenticated call." },
      { kind: "endpoint", operationId: "downloadCollection" },
      { kind: "endpoint", operationId: "getExportTrustRecord" },
      { kind: "heading", text: "Verifying against a fingerprint you fetch separately" },
      { kind: "note", text: "The signing key lives with an external signer, so a deployment without one cannot hand out an archive at all. GET /api/export/trust publishes the public key and its sha256 fingerprint, and returns EXPORT_SIGNER_NOT_CONFIGURED by the same rule. Verify against the fingerprint from that endpoint, never against the one inside the archive you are checking." },
    ],
  },
  {
    slug: "mcp",
    title: "MCP",
    group: "External AI",
    summary: `The ${MCP_TOOL_COUNT_WORD} read-only tools an agent gets, and the two the server deliberately does not offer.`,
    blocks: [
      { kind: "heading", text: "The server, and how to pin it" },
      { kind: "prose", text: "A read-only MCP server is published on the Developers page as tavonel-mcp.mjs, pinned by sha256 in the channel manifest. It speaks JSON-RPC over stdio with no dependency and no build step, so it can be read before it is pointed at anything. Set TAVONEL_API_KEY and register it; TAVONEL_BASE_URL defaults to https://tavonel.com. Run `node tavonel-mcp.mjs --doctor` first: it checks the key, the channel pin and one real read, so a failure names which of the three is wrong instead of surfacing as a silent agent." },
      /*
        G3-005. There is no npm package. Saying so here, in the place a reader goes looking for
        one, is cheaper than letting them find out from "npm ERR! 404". The rationale for the
        file distribution is good and publishing would not weaken it -- so the honest line is
        that publishing is pending, not that it was rejected.
      */
      { kind: "heading", text: "Installing it" },
      { kind: "note", text: "**There is no npm or PyPI package yet.** npx @tavonel/mcp does not resolve, and neither does pip install tavonel: npm and PyPI publishing is pending and needs registry credentials nobody has issued. Install it the way this page describes — download tavonel-mcp.mjs, check it against the digest in /developer/channel.json, and point your client at the absolute path. That path is the audited one and stays supported after a package exists." },
      { kind: "heading", text: "Registering it with a client" },
      { kind: "prose", text: "The config below is the same object every stdio MCP client accepts, under its own path. Claude Desktop reads %APPDATA%\\\\Claude\\\\claude_desktop_config.json on Windows and ~/Library/Application Support/Claude/claude_desktop_config.json on macOS, and reads it at launch — restart after editing. Claude Code reads .mcp.json at the root of the project you open. The Integration recipes page carries the same block with the platform notes." },
      {
        kind: "code",
        label: "claude_desktop_config.json / .mcp.json",
        language: "json",
        body: [
          "{",
          "  \"mcpServers\": {",
          "    \"tavonel\": {",
          "      \"command\": \"node\",",
          "      \"args\": [\"C:/absolute/path/tavonel-mcp.mjs\"],",
          "      \"env\": {",
          "        \"TAVONEL_API_KEY\": \"tvnl_live_...\",",
          "        \"TAVONEL_BASE_URL\": \"https://tavonel.com\"",
          "      }",
          "    }",
          "  }",
          "}",
        ].join("\n"),
      },
      { kind: "note", text: "The key lives in the client's env block or its secret facility, never in args — arguments show up in process listings. Give it a key scoped to reads and nothing else." },
      { kind: "heading", text: "The tools it exposes" },
      // G3-006: this table was right and the count beside it was not, on three other surfaces.
      // Both come from lib/mcp-tools.ts now, pinned against the shipped server by a test.
      { kind: "table", head: ["Tool", "What it returns"], rows: MCP_TOOLS.map(([name, returns]) => [name, returns]) },
      { kind: "heading", text: "The tools it deliberately does not offer" },
      { kind: "note", text: "There is no write tool and there is no activation tool. Activation is the moment a candidate becomes the World an organisation answers from, and it stays with a person in a browser; the server refuses to start if a tool that writes is ever added to it." },
      { kind: "note", text: "list_worlds lists only active Worlds, over `GET /v1/collections`. Candidates are excluded: a discovery list mixing accepted and unaccepted output would present both as organizational truth." },
      { kind: "note", text: "download_package returns a descriptor rather than the archive: the URL, the size, the signed manifest digest and the signing key id. The bytes are fetched over HTTP with the same key and checked with the verifier on the CLI page." },
    ],
  },
  {
    slug: "cli",
    title: "CLI",
    group: "External AI",
    summary: `The ${DEVELOPER_FILE_COUNT_WORD} published files, how to pin them, and how to verify an export with nothing but a download.`,
    blocks: [
      { kind: "heading", text: "What the distribution is" },
      /*
        G3-016. The body said "Six files", this summary and the /docs index card said "five",
        and channel.json had six. Both numbers and the list itself come from lib/mcp-tools.ts
        now, which lib/developer-distribution.test.ts pins against channel.json with digests.
      */
      { kind: "prose", text: `The developer distribution is published on the Developers page and pinned by sha256 in /developer/channel.json. ${DEVELOPER_FILES.length} files, each one listed below with what it is for.` },
      { kind: "table", head: ["File", "What it is for"], rows: DEVELOPER_FILES.map((entry) => [entry.file, entry.purpose]) },
      /*
        G3-005. "There is no npm package" was true and was framed as a decision, which reads as
        a refusal. It is a decision about the audited path and a pending step about the
        convenience one, and a reader deciding whether to wait deserves both halves.
      */
      { kind: "note", text: "**npm and PyPI publishing is pending; install from the digest-pinned files today.** No package exists on either registry — npx @tavonel/mcp and pip install tavonel do not resolve, and publishing needs registry credentials that have not been issued. What is here is a distribution rather than a package-manager release: the manifest names the exact bytes and you check them before anything runs. Each file imports nothing — Node 20+ for the .mjs files, Python 3.12+ for the .py ones — so there is no install step, no lockfile and no transitive dependency to audit. Reading a file before you run it is the intended workflow, not a fallback, and it stays the audited path after a package exists." },
      { kind: "heading", text: "Fetching and verifying it" },
      {
        kind: "code",
        label: "Fetch and verify against the channel manifest — bash",
        language: "bash",
        body: [
          `# Downloads every published asset and refuses any file whose bytes do not match the`,
          `# digest the channel manifest names. Requires curl, jq and sha256sum.`,
          `curl -fsS https://tavonel.com/developer/channel.json -o channel.json`,
          `jq -r '.assets | to_entries[] | "\\(.value.sha256 | sub("^sha256:";"")) *\\(.value.url | split("/") | last)"' \\`,
          `  channel.json > channel.sha256`,
          `jq -r '.assets[].url' channel.json | xargs -n1 curl -fsS -O`,
          `sha256sum --check channel.sha256`,
          `# tavonel-cli.mjs: OK  ... one OK line per asset. Any FAILED line means do not run that file.`,
          `jq -r '"pinned version: \\(.version)  apiVersion: \\(.apiVersion)  node>=\\(.minimumNode)"' channel.json`,
        ].join("\n"),
      },
      {
        kind: "code",
        label: "Fetch and verify against the channel manifest — PowerShell",
        language: "powershell",
        body: [
          `$channel = Invoke-RestMethod https://tavonel.com/developer/channel.json`,
          `foreach ($asset in $channel.assets.PSObject.Properties.Value) {`,
          `  $name = Split-Path $asset.url -Leaf`,
          `  Invoke-WebRequest $asset.url -OutFile $name`,
          `  $actual = "sha256:" + (Get-FileHash $name -Algorithm SHA256).Hash.ToLower()`,
          `  if ($actual -ne $asset.sha256) { Remove-Item $name; throw "$name does not match $($asset.sha256)" }`,
          `  "$name OK"`,
          `}`,
          `"pinned version: $($channel.version)"`,
        ].join("\n"),
      },
      { kind: "heading", text: "Pin, update, uninstall" },
      { kind: "prose", text: "`--version` prints the immutable distribution version compiled into the file you hold, so pinning is keeping the file and its digest. `node tavonel-cli.mjs update-check` compares that version with the published channel and prints the difference; it never downloads and never overwrites anything, so updating is deliberately the same act as installing — fetch, check the digest, replace the file. Uninstalling is deleting the file: nothing is written to a registry, a PATH, a profile or a system directory, and the only state the CLI keeps is the connector cursor file you name yourself." },
      { kind: "heading", text: "The two verifiers" },
      { kind: "prose", text: "Two verifiers answer different questions, and both are downloads rather than commands in the CLI. `tavonel-verify-export.mjs` checks the archive: that the Ed25519 signature was made by the key whose fingerprint you supply, that every file matches the digest we signed, and that nothing was added. `tavonel-verify-package.mjs` checks what is inside it: that relations resolve to objects that exist, that every region sits inside its page in the 0-1000 coordinate frame, that the Turtle, the JSON-LD and the CSV describe the same graph, and that the package's own report counts what the package holds." },
      {
        kind: "code",
        label: "Verify a downloaded export",
        language: "bash",
        body: [
          `# The trusted fingerprint comes from the trust endpoint, not from the archive.`,
          `# An archive that vouches for its own key has proven nothing.`,
          `fingerprint=$(curl -fsS https://tavonel.com/api/export/trust | jq -r .publicKeySpkiSha256)`,
          ``,
          `node tavonel-verify-export.mjs --archive world.zip --trusted-fingerprint "$fingerprint"`,
          `# {"ok":true,"archive":"world.zip","collectionId":"collection-...","keyId":"...","filesVerified":23}`,
          ``,
          `node tavonel-verify-package.mjs --package world.zip --require-signature`,
          `# world.zip: 23 files, 5 documents, ... / PACKAGE VALID`,
          ``,
          `# --package also takes an extracted directory or a candidate artifact JSON.`,
          `# --json prints the whole report instead of a summary. Without --require-signature an`,
          `# unsigned package is a note rather than an error, which is what a candidate is.`,
        ].join("\n"),
      },
      { kind: "note", text: "A tampered archive fails at the signature. A package whose relations point at objects that are not there verifies perfectly and is still wrong, which is why the second check exists. Both exit non-zero on any error, and the package validator exits 2 when its arguments are wrong rather than exiting 0 having checked nothing." },
      { kind: "heading", text: "Checking an export outside our tools" },
      { kind: "prose", text: "Cross-format parity inside the package is what `tavonel-verify-package.mjs` proves. Whether the ids and the provenance survive being loaded by a tool that has never heard of TAVONEL is a different question, and `tavonel-verify-roundtrip.py`, the third published verifier, answers it against a package you already hold: it loads `graph/nodes.csv` and `graph/relationships.csv` into an in-memory SQLite database and queries the ids back through SQL, parses `ontology/knowledge.jsonld` as plain JSON, and counts triples and subjects in `ontology/knowledge.ttl`. Python 3.12 and the standard library, nothing else." },
      {
        kind: "code",
        label: "Load the export into SQLite and query the ids back",
        language: "bash",
        body: [
          `python tavonel-verify-roundtrip.py --package world.zip`,
          `# sqlite: 12310 nodes, 7794 relationships loaded and queried back`,
          `# jsonld:  12310 subjects`,
          `# turtle:  20104 triples, 12310 subjects  (minimal parser -- rdflib not installed)`,
          `# ROUND TRIP OK`,
          ``,
          `# --json prints the counts as a receipt you can keep beside the package digest.`,
        ].join("\n"),
      },
      { kind: "note", text: "The Turtle check has a stated ceiling. Where `rdflib` is importable the script parses the Turtle with it and says so; where it is not, it falls back to a minimal parser that handles the shapes this compiler emits and prints which strict check it could not run. A skipped check is never reported as a pass, and the counts above are an illustrative shape rather than any particular package's numbers — run it on yours." },
    ],
  },
  {
    slug: "integration-recipes",
    title: "Integration recipes",
    group: "External AI",
    summary: "Three paths pinned to a specific tool, each with a smoke script that runs them.",
    blocks: [
      { kind: "heading", text: "Why three pinned recipes" },
      /*
        G3-017. The premise was right and the proof was unreachable: the smoke harness and
        Recipe 2's script lived in a private repository, so the sentence that made this page
        credible -- "a recipe that has drifted from the product fails a check rather than a
        customer's afternoon" -- was something the reader had to take on trust. Both scripts are
        published under /developer/ now, pinned by sha256 in channel.json like every other file.
      */
      { kind: "prose", text: "A general integration guide ages badly and cannot be checked. These three are pinned to a named tool, and both scripts this page runs are published and digest-pinned, so you can run the same checks we do rather than take the claim on trust. Three is the number on purpose: two or three verified recipes are worth more than a dozen plausible ones." },
      {
        kind: "table",
        head: ["Recipe", "What it needs", "What it proves"],
        rows: [
          ["Claude Desktop / Claude Code over MCP", "Node 20+, tavonel-mcp.mjs, a key scoped worlds:read + ask:read", `A real MCP handshake and ${MCP_TOOL_COUNT_WORD} read-only tools, with no write, activate or rollback tool present.`],
          ["Python over the public sample World", "Python 3.12+, no key at all", "The shape of a TAVONEL answer — object, evidence, source version, page, region — and that its bytes match the published digest."],
          ["curl before you have a key", "curl and jq, no key", "What this deployment can read, what its contract publishes, and who signs its exports."],
        ],
      },
      { kind: "heading", text: "Recipe 1 — Claude Desktop and Claude Code" },
      { kind: "prose", text: "Download and pin `tavonel-mcp.mjs` as the CLI page describes, then register it with an absolute path. Claude Desktop reads `%APPDATA%\\Claude\\claude_desktop_config.json` on Windows and `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS; restart the app after editing, because the config is read at launch. Claude Code reads `.mcp.json` at the root of the project you open, which is the scope to use when a repository and a World belong together. Other MCP clients accept the same object under their own path — check the client's own documentation rather than assuming these two." },
      {
        kind: "code",
        label: "claude_desktop_config.json / .mcp.json",
        language: "json",
        body: [
          `{`,
          `  "mcpServers": {`,
          `    "tavonel": {`,
          `      "command": "node",`,
          `      "args": ["C:/absolute/path/tavonel-mcp.mjs"],`,
          `      "env": {`,
          `        "TAVONEL_API_KEY": "tvnl_live_...",`,
          `        "TAVONEL_BASE_URL": "https://tavonel.com"`,
          `      }`,
          `    }`,
          `  }`,
          `}`,
        ].join("\n"),
      },
      { kind: "note", text: "The key lives in the client's `env` block or its secret facility, never in `args` — arguments show up in process listings. The server refuses to start if a tool that writes is ever added to it, so an agent holding this config cannot activate a candidate, revoke a connection or spend anything. Give it a key scoped to reads and nothing else." },
      { kind: "heading", text: "Recipe 2 — Python over the public sample World" },
      { kind: "prose", text: "`GET /reproducibility/sample-world` needs no key and returns a deterministic sample: three objects, two evidence records, one source version, page and region. Its response carries a `Content-Digest: sha-256=:…:` header over the exact bytes, so the same verification habit the signed package asks for works here first. The published script tavonel-public-sample.py is the recipe: it recomputes that digest, resolves every object's evidence, checks each region against the 0-1000 page frame, and asserts the object marked research_frontier cites no evidence at all. Python 3.12 and the standard library, nothing else — download it, check it against the digest in /developer/channel.json, and read it before you run it." },
      {
        kind: "code",
        label: "Read the sample and follow one claim to its evidence",
        language: "bash",
        body: [
          `curl -fsSO https://tavonel.com/developer/tavonel-public-sample.py`,
          `python tavonel-public-sample.py --base-url https://tavonel.com`,
          `# sample: 3 objects, 2 evidence records, ... bytes`,
          `# digest: sha-256=:...:`,
          `#   ev-01 -> src_v_01 page 4 bbox [118, 214, 886, 374]`,
          `#   ev-02 -> src_v_01 page 4 bbox [118, 214, 886, 374]`,
          `# PUBLIC SAMPLE OK`,
        ].join("\n"),
      },
      { kind: "note", text: "The sample is a product fixture and says so in its own `disclosure` field: it is unsigned, it is not an activated customer World, and it is not a quality measurement. Use it to build against the shape, not to judge extraction." },
      { kind: "heading", text: "Recipe 3 — curl, before you have a key" },
      { kind: "prose", text: "Three unauthenticated reads answer the three questions an evaluator asks first. `/api/v1/capabilities` is the same list the upload route validates against, so a format absent from it is refused at upload rather than accepted and dropped. `/api/openapi` is the contract itself — and carries no activation or rollback path, because neither exists for a key. `/api/export/trust` publishes the export signing key, or refuses with `EXPORT_SIGNER_NOT_CONFIGURED` on a deployment that has none." },
      {
        kind: "code",
        label: "What this deployment can read, publish and sign",
        language: "bash",
        body: [
          `# Every readable format, with its tier and its stated limitations. No key.`,
          `curl -fsS https://tavonel.com/api/v1/capabilities | jq '{schemaVersion, entries: (.entries | length), contentSha256}'`,
          ``,
          `# The pin a caller keeps: drop contentSha256 -- it is the last key -- and re-serialize.`,
          `curl -fsS https://tavonel.com/api/v1/capabilities \\`,
          `  | jq -S 'del(.contentSha256)' --indent 0 | tr -d '\\n' | sha256sum`,
          ``,
          `# The contract, and the two paths it deliberately does not have.`,
          `curl -fsS https://tavonel.com/api/openapi | jq '[.paths | keys[] | select(test("promote|rollback"))]'`,
          `# []`,
          ``,
          `# Who signs an export here, or the refusal that says nobody does.`,
          `curl -fsS https://tavonel.com/api/export/trust | jq '{keyId, publicKeySpkiSha256}'`,
        ].join("\n"),
      },
      { kind: "note", text: "The digest line above is a shape, not a one-liner to trust blindly: `jq -S` reorders keys and the published digest is taken over the manifest's own key order, so the value it prints will not match unless your jq preserves that order. The procedure that does reproduce it is the one on the capabilities route — delete `contentSha256`, re-serialize with the key order unchanged — and the published smoke script performs exactly that and fails when it disagrees." },
      { kind: "heading", text: "Running all three" },
      { kind: "prose", text: "Download tavonel-recipe-smoke.mjs, check it against its digest, and run all three with node tavonel-recipe-smoke.mjs, or one at a time with mcp, public-sample or curl. It takes --base-url (or TAVONEL_RECIPE_BASE_URL) and defaults to https://tavonel.com. Every request it makes is an unauthenticated GET: no key, no upload, no compile, nothing that spends. It also re-checks every asset in channel.json against its published digest, which is the check the CLI page teaches by hand." },
      {
        kind: "code",
        label: "Fetch, pin and run the three recipes",
        language: "bash",
        body: [
          "curl -fsSO https://tavonel.com/developer/tavonel-recipe-smoke.mjs",
          "# Check it before you run it, the same way you check everything else in the channel.",
          "curl -fsS https://tavonel.com/developer/channel.json \\",
          "  | jq -r '.assets.recipeSmoke.sha256'",
          "sha256sum tavonel-recipe-smoke.mjs",
          "",
          "node tavonel-recipe-smoke.mjs --base-url https://tavonel.com",
          "# ok  capabilities — 12 formats, defaultStatus UNSUPPORTED",
          "# ok  contract — 33 operations, no promote or rollback path",
          "# RECIPES OK",
        ].join("\n"),
      },
    ],
  },
  {
    slug: "billing-and-limits",
    title: "Billing and limits",
    group: "Operations and errors",
    summary: "What is counted, how a page is quoted, and the ceilings that apply.",
    blocks: [
      { kind: "heading", text: "How a page is quoted" },
      { kind: "prose", text: "Processing is quoted in pages before a compile starts, with the maximum charge shown alongside the estimate. A page count read from the document itself is labelled verified; a count the document only declares — the number Word saved — is labelled declared. A file whose format states no count at all is quoted at nothing: it is named in the preflight with the reason and left out of the total, because a page count derived from file size is an invented number." },
      /*
        Audit P01, second pass. The unit is now decided, so this states it instead of stating
        that nobody had chosen one.

        `countSpreadsheetPages()` returns `{ pages: null, reason:
        "SPREADSHEET_COUNTED_AFTER_CONVERSION" }` for xlsx, ods and csv alike, and
        `estimateBillablePages` returns null for the same file rather than falling through to
        `ceil(bytes / 65,536)`. The byte bound is gone from the module, not relabelled: a
        spreadsheet is billed on the pages of the sanitized PDF it is converted to, counted after
        the conversion, and before that there is no number to show.
      */
      { kind: "heading", text: "Spreadsheets" },
      { kind: "prose", text: "A spreadsheet is billed on the page count of the sanitized PDF it is converted to, counted after that conversion. Before it, there is no page count: preflight names xlsx, ods and csv files and shows no number for them rather than quoting one from file size. What is charged is settled against the pages the read actually produced, and never above the maximum shown before the run." },
      /*
        Stage-B integration, 2026-09-11. The entitlements lane held FD-03's page-expiry term back
        here because nothing on that branch reduced a `credit_balance`. LEDGER-EXPIRY's
        `20260911130000_included_page_expiry_at_renewal.sql` is now merged, so the term is stated
        -- in the ledger lane's wording, which names the moment the code keeps (the next grant)
        rather than a period-end boundary the schema records nowhere. Same words as /pricing, and
        `lib/product-claims-sync.test.ts` P06 pins both surfaces so they cannot drift apart.

        P07 / FD-04's refund numbers stay: `REFUND_WINDOW_DAYS`,
        `REFUND_MAX_CONSUMED_FRACTION` and the catalog's own `includedPages`, with the rate from
        the two constants the reservation code charges against. Nothing here is typed as a figure.
        No route enforces the refund rule because a person issues refunds through Paddle, and
        `liveChargesEnabled` is false.

        FD-03 and FD-04 are a delegated decision, 2026-09-11 (orchestrator, under the founder's
        delegation) -- see `docs/policy/DECISION_LOG_2026-09-11.md`, which bars
        attributing them to the founder -- and the lane report makes the founder's direct
        ratification a merge condition.
      */
      { kind: "heading", text: "Included pages, and what expires" },
      { kind: "prose", text: `Included pages belong to the billing month they are granted in: when the next month's pages are granted, whatever is left of the previous month expires. Unused pages do not roll over and are not refunded if you cancel. A balance can only be spent while a plan is active. Pages past the included allowance are billed at the published rate of ${formatUsd(STANDARD_UNITS_PER_PAGE * PROCESSING_UNIT_USD)} per standard page.` },
      { kind: "heading", text: "Refunds" },
      { kind: "prose", text: `Refunds: ask within ${REFUND_WINDOW_DAYS} days of payment and the payment is refunded in full, provided fewer than ${Math.round(REFUND_MAX_CONSUMED_FRACTION * 100)}% of the plan's included pages have been consumed — ${refundablePageAllowance(BILLING_OFFERS.observer_access)} pages on ${BILLING_OFFERS.observer_access.label}, ${refundablePageAllowance(BILLING_OFFERS.studio_access)} on ${BILLING_OFFERS.studio_access.label}. Past that, the payment is not refunded. Unused pages are not refunded on cancellation. Subject to the terms as updated.` },
      { kind: "heading", text: "The ceilings" },
      {
        kind: "table",
        head: ["Limit", "Value"],
        rows: [
          // G3-002: the two the deployment actually refuses on, first, because they are the two
          // that stop a first integration. shared/intakeCeiling.ts is the module that enforces them.
          ["**Bytes per source**", `${PROCESSING_CEILING_MIB} MB`],
          ["**Pages per source**", String(PROCESSING_CEILING.maxSourcePages)],
          ["Documents per compile", `${COMPILE_MIN_DOCUMENTS}–${COMPILE_MAX_DOCUMENTS}`],
          ["Documents per run", String(CORPUS_MAX_DOCUMENTS)],
          ["Files per archive", String(MAX_FILES)],
          ["World activations, rollbacks or index rebuilds", `${ACTIVATION_RATE_LIMIT} of each per hour, per workspace`],
          ["Refund window", `${REFUND_WINDOW_DAYS} days from payment`],
          ["Refundable if consumed under", `${Math.round(REFUND_MAX_CONSUMED_FRACTION * 100)}% of included pages`],
        ],
      },
      { kind: "note", text: `${PROCESSING_CEILING_SENTENCE} A source above either is refused rather than accepted and dropped: the byte ceiling at the capability call with 413 SOURCE_EXCEEDS_PROCESSING_CEILING, the page ceiling after the document is decoded, because intake never decodes it.` },
      /*
        G3-018. "No API rate limits documented anywhere, zero X-RateLimit-* in the spec, and a
        429 on /uploads/capability whose triggering limit is documented nowhere." The limits were
        real -- consume_foundation_api_rate_limit has enforced them per key, per scope, per clock
        minute since migration 0012 -- and unpublished. The numbers below are SCOPE_RATE_LIMITS
        from lib/developer-auth.ts, which is the table the authorizer passes to that function.

        What is deliberately NOT here: an X-RateLimit-Limit/Remaining/Reset triplet and a
        Retry-After on API_RATE_LIMITED. The API does not send them. Documenting headers we do
        not emit would be a worse defect than the one this fixes.
      */
      { kind: "heading", text: "How often you may call the API" },
      { kind: "prose", text: "Every scoped request consumes one unit of a per-minute allowance held per key and per scope, so a key reading documents and asking questions does not spend one budget on both. The window is a clock minute rather than a rolling one: an allowance that is spent is free again at the top of the next minute." },
      {
        kind: "table",
        head: ["Scope", "Requests per minute, per key"],
        rows: DEVELOPER_SCOPES.map((scope) => [scope, String(SCOPE_RATE_LIMITS[scope])]),
      },
      { kind: "note", text: "Over the allowance the answer is **429 API_RATE_LIMITED**. There is no Retry-After header on that code and no X-RateLimit- headers anywhere in the API today — waiting for the next clock minute is sufficient by construction, and publishing a header we do not send would be worse than publishing the window. If the allowance itself cannot be read the request is refused with 503 API_RATE_LIMIT_UNAVAILABLE rather than run unbounded; that is fail-closed behaviour, not a limit you hit. The hourly activation allowance in the table above is separate, answers ACTIVATION_RATE_LIMITED, and does carry Retry-After." },
    ],
  },
  {
    slug: "errors",
    title: "Errors",
    group: "Operations and errors",
    summary: "Every code the API can return, what it means, and what to do about it.",
    /*
      G3-019 and G3-020.

      Twelve codes were catalogued here against at least twenty-one the API returns, and
      AUTH_REQUIRED -- what a missing or wrong key gets, which is the first error most
      integrations ever see -- was in neither this page nor the OpenAPI document. There was also
      no remediation column, so a reader who found their code learned what it meant and not what
      to do, which is where a catalogue stops being useful.

      Both are structural now. The rows below are lib/api-error-codes.ts, which the OpenAPI
      document also builds its Error enum and every per-operation error description from, and
      lib/api-error-codes.test.ts scans the handler files that serve the published surface and
      fails on a code the catalogue has never heard of. The page cannot fall behind the API
      without the build saying so.
    */
    blocks: [
      { kind: "heading", text: "Branch on the code, not the status" },
      { kind: "prose", text: "Failures return a machine code alongside the HTTP status. Branch on the code: the status says what kind of problem it is, and the code says which one. The Status column below is filled where one route owns a code; where it is blank the same code is returned with different statuses by different operations, and the authoritative status per operation is in the OpenAPI document under the response it sits in." },
      { kind: "note", text: "A 503 means the work did not start. A 409 means the request was understood and the state refused it — those are different retries. A 429 means the work is allowed and the window is full: honour Retry-After where it is sent, and otherwise wait for the next clock minute rather than retrying immediately." },
      ...API_ERROR_GROUPS.flatMap((group) => [
        { kind: "heading" as const, text: group.title },
        { kind: "prose" as const, text: group.summary },
        {
          kind: "table" as const,
          head: ["Code", "Status", "Meaning", "What to do"],
          /*
            BQ-102. The code is a token a reader types into a `switch`, and it rendered as plain
            prose in the same face and colour as the sentence beside it. The backticks are the
            mark `withMarks` already turns into `<code>` everywhere else on this page, so the
            column reads as what it is without a second rendering path.
          */
          rows: group.codes.map((entry) => [
            `\`${entry.code}\``,
            entry.status ? String(entry.status) : "varies",
            entry.meaning,
            entry.whatToDo,
          ]),
          rowAnchors: true as const,
          filterLabel: "Filter error codes",
        },
      ]),
      { kind: "heading", text: "Two numbers a client branches on" },
      { kind: "note", text: `Two numbers this page used to state in prose, for anyone who arrived looking for them: a run carries at most ${CORPUS_MAX_DOCUMENTS} documents and one compile at most ${COMPILE_MAX_DOCUMENTS}, and the hourly allowance on World activations, rollbacks and retrieval-index rebuilds is ${ACTIVATION_RATE_LIMIT} of each. Both are imported from the modules that enforce them, so the page cannot quote a limit the code does not hold.` },
    ],
  },
  {
    slug: "security",
    title: "Security",
    group: "Operations and errors",
    summary: "Where bytes live, what the parsing models can reach, and what fails closed.",
    blocks: [
      { kind: "heading", text: "Where bytes live, and what reads them" },
      { kind: "prose", text: "Uploaded bytes go to quarantine storage and are disarmed before anything reads them. Parsing models get no tools, no broad credentials and no outbound network: every document is treated as hostile input." },
      { kind: "heading", text: "What fails closed" },
      { kind: "prose", text: "Integrity violations fail closed. A World with an unresolved link is not emitted, a package whose file digests do not match is not served, and a compile whose inputs cannot be validated does not produce a partial result." },
      { kind: "note", text: "The Security page states the controls in full and the Subprocessors page names every service permitted to touch each class of data. This section does not restate them." },
    ],
  },
  {
    slug: "changelog",
    title: "Versioning and changes",
    group: "Operations and errors",
    summary: "How long a version is supported, how a breaking change is announced, and where to read what changed.",
    /*
      G3-021. "deprecat", "sunset" and "version policy" returned zero matches across all 25
      pages, on a product with a versioned API whose contract already carried an
      x-tavonel-version-policy extension. A reader could see the version and could not find out
      how long it lasts, what counts as breaking, or how much notice they would get. This page
      was two sentences pointing at /changelog.

      The three commitments below are also in the contract, under x-tavonel-version-policy, so a
      machine and a person read one policy rather than two.
    */
    blocks: [
      { kind: "heading", text: "How the API is versioned" },
      { kind: "prose", text: `The major version is in the path: /api/v1. Every response carries X-TAVONEL-API-Version, and a client that wants to pin can send Accept: application/vnd.tavonel.v1+json. The dated version beside it — ${API_VERSION} in the footer of every page here — names the contract build, not a second axis to negotiate: it moves when the document changes and it never changes what /api/v1 accepts.` },
      { kind: "heading", text: "What can change without notice" },
      { kind: "prose", text: "**Additive changes ship in any release.** New fields on a response, new optional parameters, new endpoints, and new members of a response enum. Ignore fields you do not recognise, and do not switch on an exhaustive match over a response enum — that is the one client habit an additive change breaks." },
      { kind: "heading", text: "What counts as breaking, and what you are owed" },
      {
        kind: "table",
        head: ["Commitment", "What it is"],
        rows: [
          ["What is breaking", "Removing or renaming a published field, parameter, error code or endpoint; narrowing what a field accepts; changing the meaning of a value. Anything in that list takes a new path major."],
          ["How you hear", "The current major is announced as deprecated in the API changelog below and in the Atom feed, before the new major becomes the default. Nothing is removed in place."],
          ["Support window", "A deprecated path major keeps answering for at least 180 days from the announcement."],
          ["Migration", "A breaking entry carries the migration beside it, not in a separate document. An entry that names a breaking change and no migration is a bug in this page."],
        ],
      },
      { kind: "note", text: "**No version has been deprecated.** v1 is the only major, it is current, and no sunset date exists for it. This section states the policy that will apply when one does — it is not a notice that one has started." },
      { kind: "heading", text: "The API changelog" },
      { kind: "prose", text: "Changes are published on the Changelog page, filterable by surface: choose **API** for the contract and **Developer tools** for the CLI, the MCP server and the published files. Both feed the same Atom feed at /changelog/feed.xml, which is the one to subscribe to if you maintain an integration. The machine-readable contract at /api/openapi remains the authority for what a version contains — the changelog says what moved, the contract says what is there." },
      { kind: "note", text: "The contract publishes this same policy under x-tavonel-version-policy, and the whole error catalogue under x-tavonel-error-catalogue, so a generated client can carry both without scraping this page." },
    ],
  },
];


/*
  Five groups, named after what a reader is trying to do rather than after the interface that
  answers them.

  The four they replace -- Start, Concepts, API, Operations -- split by implementation surface,
  which put `files-and-formats` under Operations and `upload` under API even though they are the
  same question asked twice, and left Concepts holding one section. The order below is the order
  a reader meets them: get a key, put documents in, ask the World, hand the result to something
  else, run it. Every slug and URL is unchanged -- this is a `group` field edit and nothing else,
  because a regroup that moved a page would break every link published against it.
*/
export const DOCS_GROUPS = ["Getting started", "Input and compile", "World and questions", "External AI", "Operations and errors"] as const;

export const DOCS_VERSION = API_VERSION;

/**
 * The date the documentation was last reviewed against the product.
 *
 * Deliberately not `new Date()`. A page that prints today's date every time it renders claims
 * it was checked today, which is exactly the assurance a reader is looking for and exactly the
 * one nobody gave. This moves when a person moves it.
 */
export const DOCS_REVIEWED = "2026-09-11";

/**
 * A date a reader reads as a date (BA-220).
 *
 * `2026-09-11` sat next to `API 2026-09-02.1` in the same 10px monospace line, so the two read
 * as the same kind of number and the documentation looked eight days behind a version it has
 * nothing to do with. Spelling the month out separates them, and it is one function rather than
 * a format per surface.
 */
export function formatReviewDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const name = months[Number(month) - 1];
  if (!year || !name || !day) throw new Error(`not an ISO date: ${iso}`);
  return `${Number(day)} ${name} ${year}`;
}

export function findDocsSection(slug: string) {
  return DOCS_SECTIONS.find((section) => section.slug === slug) ?? null;
}

/**
 * The search index, in chunks, one per heading (BQ-105).
 *
 * Three things were wrong with the flat lower-cased string this used to build, and all three
 * were the same mistake: one field was doing the matching *and* the displaying.
 *
 * It was `.toLowerCase()`, so every excerpt the search box printed came out in lower case. It
 * carried the raw marks -- `**bold**` and the backticks the error catalogue writes around every
 * code -- so an excerpt showed the punctuation an author meant as formatting. And it carried
 * snippet bodies, so a query could produce an excerpt of a curl invocation.
 *
 * Now `chunks` is what a reader sees: original case, marks stripped, no snippet bodies, split at
 * each heading and carrying that heading's anchor -- so a result links to the passage rather
 * than to the top of a twenty-screen page. `code` is matched and never shown, which keeps the
 * recall the flat index had: a query for a token that appears only inside a request body still
 * finds its section, and falls back to the section summary for the excerpt.
 *
 * Both are built here so the client bundle carries one copy, and the payload is about what it
 * was: the prose is stored once in its real case rather than once lower-cased.
 */
export type DocsSearchChunk = { anchor: string | null; display: string };

export function docsSearchIndex() {
  return DOCS_SECTIONS.map((section) => ({
    slug: section.slug,
    title: section.title,
    group: section.group,
    summary: section.summary,
    chunks: searchChunks(section),
    code: section.blocks.flatMap(blockCode).join(" ").toLowerCase(),
  }));
}

/** `**bold**` and `` `code` `` are formatting, not characters a reader searched for. */
const unmarked = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");

/** The id `app/docs/[section]/page.tsx` gives a heading, derived the same way it derives it. */
const headingAnchor = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";

function searchChunks(section: DocsSection): DocsSearchChunk[] {
  const chunks: DocsSearchChunk[] = [{ anchor: null, display: `${section.title}. ${section.summary}` }];
  for (const block of section.blocks) {
    if (block.kind === "heading") {
      chunks.push({ anchor: headingAnchor(block.text), display: block.text });
      continue;
    }
    const parts = blockText(block);
    if (parts.length === 0) continue;
    const last = chunks[chunks.length - 1]!;
    last.display = `${last.display} ${unmarked(parts.join(" "))}`;
  }
  /*
    A heading with nothing under it carries only its own words, and a duplicate heading would
    produce a duplicate anchor. Both are the page's problem rather than the index's -- the page
    de-duplicates ids through `tocEntries` -- so nothing is dropped here: a link to the first of
    two identical headings is where a browser sends the reader either way.
  */
  return chunks;
}

/** Everything a reader may search for and should never be shown an excerpt of. */
function blockCode(block: DocsBlock): string[] {
  if (block.kind === "code") return [block.body];
  if (block.kind === "snippets") return block.items.map((item) => item.body);
  return [];
}

function blockText(block: DocsBlock): string[] {
  switch (block.kind) {
    case "heading":
      // Handled by `searchChunks`, which starts a new chunk at each one.
      return [block.text];
    case "prose":
    case "note":
      return [block.text];
    case "steps":
      return block.items;
    // The body is in `blockCode`: matched, never excerpted.
    case "code":
      return [block.label];
    case "snippets":
      return [block.label];
    case "table":
      return [...block.head, ...block.rows.flat()];
    case "endpoint":
      return [block.operationId];
    case "diagram":
      return [block.caption];
  }
}
