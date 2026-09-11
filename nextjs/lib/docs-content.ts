import { API_VERSION } from "./api-version";
import { COMPILE_MAX_DOCUMENTS, COMPILE_MIN_DOCUMENTS, CORPUS_MAX_DOCUMENTS } from "./compile-limits";
import { MAX_FILES, MAX_SYNC_ARCHIVE_BYTES, MAX_WORKER_ARCHIVE_BYTES } from "./archive-expand";
import { DEVELOPER_SCOPES } from "./developer-contracts";
import { CAPABILITY_MANIFEST, describeAcceptedFormats } from "../../shared/capabilityManifest";

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
  /*
    `language` is metadata, not a renderer switch: `app/docs/[section]/page.tsx` prints the body
    verbatim under its label and highlights nothing. It is here so a block cannot claim to be
    one language while carrying another, and so the quickstart's bash/python/typescript parity
    is a property a test can assert rather than a habit.
  */
  | { kind: "code"; label: string; language: "bash" | "powershell" | "python" | "typescript" | "json" | "text"; body: string }
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
    summary: "From an API key to a verified evidence-bound answer, with the one step no key can take.",
    blocks: [
      { kind: "prose", text: "Every request is tenant-scoped by the key it carries. There is no account switch and no impersonation header: a key belongs to one workspace and reaches nothing else." },
      {
        kind: "steps",
        items: [
          "Ask for an upload capability. The response is a short-lived direct URL; document bytes never pass through the application server.",
          "PUT the file to that URL with the same content type you declared.",
          "Start a compile with the document ids you want in the World. It answers 202 with a job id, not a World.",
          "Poll GET /api/compile-jobs/{jobId} until state is ready, review_required, failed or cancelled. A settled job carries the collectionId the candidate was written to.",
          "A PERSON ACTIVATES THE WORLD. This step is not in the script and not in the API: promotion is a browser-session action by a human in the workspace, and the published contract has no promote and no rollback path for any key to call.",
          "Ask the active World a question, and read which retrieval runtime answered it.",
          "Download the signed package and verify it offline with the published verifiers.",
        ],
      },
      {
        kind: "note",
        text: "Step 5 is the one that stops a script, and it stops for two separate reasons. Promotion is human-only by design — a candidate is not organizational truth until a person says so. Separately, the activation surface requires the workspace to hold the **Team** plan (`studio_access`): a Developer-plan workspace compiles, reviews and exports, and `authorizeFoundationProduct(..., \"studio\")` refuses its promote with `STUDIO_SUBSCRIPTION_REQUIRED`. Team is sold through a conversation today rather than self-serve checkout, so getting past step 5 on a new workspace means talking to us first.",
      },
      {
        kind: "code",
        label: "Steps 1 to 4 — bash",
        language: "bash",
        body: [
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
        ].join("\n"),
      },
      {
        kind: "code",
        label: "Steps 1 to 4 — Python",
        language: "python",
        body: [
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
        ].join("\n"),
      },
      {
        kind: "code",
        label: "Steps 1 to 4 — TypeScript",
        language: "typescript",
        body: [
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
        ].join("\n"),
      },
      {
        kind: "code",
        label: "Steps 6 and 7 — bash, after a person has activated the World",
        language: "bash",
        body: [
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
        ].join("\n"),
      },
      {
        kind: "code",
        label: "Steps 6 and 7 — Python",
        language: "python",
        body: [
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
        ].join("\n"),
      },
      {
        kind: "code",
        label: "Steps 6 and 7 — TypeScript",
        language: "typescript",
        body: [
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
        ].join("\n"),
      },
      { kind: "note", text: "What this quickstart does not do is answer from a World nobody approved. A `review_required` candidate is readable and exportable and is not authoritative, and `/ask` reads the active World only — there is no parameter that points it at a candidate." },
    ],
  },
  {
    slug: "use-with-ai",
    title: "Use your results with AI",
    group: "Start",
    summary: "Choose live MCP/API access or the signed portable package, and keep answers grounded in the same evidence.",
    blocks: [
      {
        kind: "prose",
        text: "There are two supported ways to use TAVONEL output. **Live access** through Ask, the API or the read-only MCP server reads the active World and is the preferred path for a production assistant that needs the current revision. The **signed knowledge package** is a portable snapshot for offline work, handoff, archive and systems that consume files rather than an API.",
      },
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
      {
        kind: "code",
        label: "Minimal prompt for a local agent",
        language: "text",
        body: "Read AGENTS.md in this folder first. Use manifest/ai-entrypoint.json to locate the compiled knowledge and evidence. Answer from this package, preserve uncertainty, and cite the source evidence you relied on. If the task requires the latest organizational state, tell me to use the live TAVONEL MCP/API instead of assuming this snapshot is current.",
      },
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
    group: "Start",
    summary: "Import the Compiled World ontology into RDF, linked-data and graph systems without losing validation, evidence or stable identity.",
    blocks: [
      { kind: "prose", text: "Every portable package includes **ontology/knowledge.jsonld** and **ontology/knowledge.ttl**. They are semantic projections of the Compiled World. The current export is RDF/JSON-LD with TAVONEL node kinds and compiled relation predicates; it should not be described as a hand-authored OWL/TBox schema. Keep provenance and validation beside the ontology, because the ontology is for semantic navigation and integration rather than a replacement for source evidence." },
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
      {
        kind: "table",
        head: ["Format", "Support tier", "What is preserved"],
        rows: CAPABILITY_MANIFEST.entries.map((entry) => [
          entry.extensions.map((extension) => `.${extension}`).join(" "),
          entry.status,
          entry.preserved.length > 0 ? entry.preserved.join(", ") : "nothing — not compiled",
        ]),
      },
      { kind: "note", text: "A verified tier requires a qualification receipt and the date it was produced. No format carries one on this deployment, so no format claims more than best effort. /sources prints the same manifest with every limitation attached." },
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
          ["graph/nodes.csv, graph/relationships.csv", "Tabular form for spreadsheet and BI tools."],
          ["rag/chunks.jsonl", "Retrieval chunks, each bound to a page and region."],
          ["validation/report.json", "The validation status and any review reasons."],
        ],
      },
      {
        kind: "table",
        head: ["Artifact", "Signature state", "What happens"],
        rows: [
          ["Candidate, inside the compiler", "`external_signer_required`", "Every compiled candidate carries this until it is signed. It is an internal state, not something you receive: it says the bytes exist and no signature has been made over them yet."],
          ["Customer download", "Signed, or refused", "`GET /v1/collections/{id}/download` signs the manifest with Ed25519 or refuses with `EXPORT_SIGNER_NOT_CONFIGURED` (503). There is no third outcome: you never receive an archive still in the candidate state."],
          ["Public sample World", "Deliberately unsigned", "The sample on the Reproducibility page is a fixture, labelled unsigned, and is not a promoted customer World. Do not use it to test the signature path."],
        ],
      },
      { kind: "note", text: "The signing key lives with an external signer, so a deployment without one cannot hand out an archive at all. `GET /api/export/trust` publishes the public key and its sha256 fingerprint, and returns `EXPORT_SIGNER_NOT_CONFIGURED` by the same rule. Verify against the fingerprint from that endpoint, never against the one inside the archive you are checking." },
    ],
  },
  {
    slug: "mcp",
    title: "MCP",
    group: "API",
    summary: "The read-only tools an agent gets, and the two the server deliberately does not offer.",
    blocks: [
      { kind: "prose", text: "A read-only MCP server is published on the Developers page as tavonel-mcp.mjs, pinned by sha256 in the channel manifest. It speaks JSON-RPC over stdio with no dependency and no build step, so it can be read before it is pointed at anything. Set TAVONEL_API_KEY and register it; TAVONEL_BASE_URL defaults to https://tavonel.com." },
      {
        kind: "table",
        head: ["Tool", "What it returns"],
        rows: [
          ["list_sources", "The workspace's documents, with processing state and version key."],
          ["get_world", "One Compiled World: status, contract, objects, relations, evidence, history."],
          ["search_world", "Retrieved regions with provenance and ranks. No generated prose."],
          ["ask_world", "A grounded answer with citations, or an abstention."],
          ["get_object", "The objects lens, or one object by stable id."],
          ["get_relation", "The relations lens, or one relation by stable id."],
          ["get_evidence", "Every region with its source version, page and bbox in the 0-1000 page frame."],
          ["download_package", "Where the signed package is, how large, and what its manifest hashes to."],
        ],
      },
      { kind: "note", text: "There is no write tool and there is no promotion tool. Promotion is the moment a candidate becomes the World an organisation answers from, and it stays with a person in a browser; the server refuses to start if a tool that writes is ever added to it." },
      { kind: "note", text: "There is no list_worlds tool. The published API has no endpoint that lists a workspace's collections, and a tool that answered by guessing at ids would be wrong silently. It is absent rather than approximated, and get_world takes the collection id you already hold." },
      { kind: "note", text: "download_package returns a descriptor rather than the archive: the URL, the size, the signed manifest digest and the signing key id. The bytes are fetched over HTTP with the same key and checked with the verifier on the CLI page." },
    ],
  },
  {
    slug: "cli",
    title: "CLI",
    group: "API",
    summary: "The five published files, how to pin them, and how to verify an export with nothing but a download.",
    blocks: [
      { kind: "prose", text: "The developer distribution is published on the Developers page and pinned by sha256 in `/developer/channel.json`. Six files: `tavonel-cli.mjs` covers the upload and compile path from a terminal, `tavonel-mcp.mjs` is the read-only MCP bridge, `tavonel-source-agent.py` walks a folder or bucket, and `tavonel-verify-export.mjs`, `tavonel-verify-package.mjs` and `tavonel-verify-roundtrip.py` check an export offline." },
      { kind: "note", text: "It is a distribution rather than a package-manager release: there is no npm, pip or Homebrew package. The manifest names the exact bytes, and you check them before anything runs. Each file imports nothing — Node 20+ for the four `.mjs` files, Python 3.12+ for the agent — so there is no install step, no lockfile and no transitive dependency to audit. Reading a file before you run it is the intended workflow, not a fallback." },
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
      { kind: "prose", text: "**Pin, update, uninstall.** `--version` prints the immutable distribution version compiled into the file you hold, so pinning is keeping the file and its digest. `node tavonel-cli.mjs update-check` compares that version with the published channel and prints the difference; it never downloads and never overwrites anything, so updating is deliberately the same act as installing — fetch, check the digest, replace the file. Uninstalling is deleting the file: nothing is written to a registry, a PATH, a profile or a system directory, and the only state the CLI keeps is the connector cursor file you name yourself." },
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
      { kind: "prose", text: "**Checking the export in something that is not ours.** Cross-format parity inside the package is what `tavonel-verify-package.mjs` proves. Whether the ids and the provenance survive being loaded by a tool that has never heard of TAVONEL is a different question, and `tavonel-verify-roundtrip.py`, the third published verifier, answers it against a package you already hold: it loads `graph/nodes.csv` and `graph/relationships.csv` into an in-memory SQLite database and queries the ids back through SQL, parses `ontology/knowledge.jsonld` as plain JSON, and counts triples and subjects in `ontology/knowledge.ttl`. Python 3.12 and the standard library, nothing else." },
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
    group: "API",
    summary: "Three paths pinned to a specific tool, each with a smoke script that runs them.",
    blocks: [
      { kind: "prose", text: "A general integration guide ages badly and cannot be checked. These three are pinned to a named tool, and each one is executed by `scripts/developer-recipes/smoke.mjs` in this repository, so a recipe that has drifted from the product fails a check rather than a customer's afternoon. Three is the number on purpose: two or three verified recipes are worth more than a dozen plausible ones." },
      {
        kind: "table",
        head: ["Recipe", "What it needs", "What it proves"],
        rows: [
          ["Claude Desktop / Claude Code over MCP", "Node 20+, `tavonel-mcp.mjs`, a key scoped `worlds:read` + `ask:read`", "A real MCP handshake and eight read-only tools, with no write, promote or rollback tool present."],
          ["Python over the public sample World", "Python 3.12+, no key at all", "The shape of a TAVONEL answer — object, evidence, source version, page, region — and that its bytes match the published digest."],
          ["curl before you have a key", "curl and jq, no key", "What this deployment can read, what its contract publishes, and who signs its exports."],
        ],
      },
      { kind: "prose", text: "**Recipe 1 — Claude Desktop and Claude Code.** Download and pin `tavonel-mcp.mjs` as the CLI page describes, then register it with an absolute path. Claude Desktop reads `%APPDATA%\\Claude\\claude_desktop_config.json` on Windows and `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS; restart the app after editing, because the config is read at launch. Claude Code reads `.mcp.json` at the root of the project you open, which is the scope to use when a repository and a World belong together. Other MCP clients accept the same object under their own path — check the client's own documentation rather than assuming these two." },
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
      { kind: "note", text: "The key lives in the client's `env` block or its secret facility, never in `args` — arguments show up in process listings. The server refuses to start if a tool that writes is ever added to it, so an agent holding this config cannot promote a candidate, revoke a connection or spend anything. Give it a key scoped to reads and nothing else." },
      { kind: "prose", text: "**Recipe 2 — Python over the public sample World.** `GET /reproducibility/sample-world` needs no key and returns a deterministic sample: three objects, two evidence records, one source version, page and region. Its response carries a `Content-Digest: sha-256=:…:` header over the exact bytes, so the same verification habit the signed package asks for works here first. `scripts/developer-recipes/public-sample.py` is the recipe: it recomputes that digest, resolves every object's evidence, checks each region against the 0-1000 page frame, and asserts the object marked `research_frontier` cites no evidence at all." },
      {
        kind: "code",
        label: "Read the sample and follow one claim to its evidence",
        language: "bash",
        body: [
          `python public-sample.py --base-url https://tavonel.com`,
          `# sample: 3 objects, 2 evidence records, ... bytes`,
          `# digest: sha-256=:...:`,
          `#   ev-01 -> src_v_01 page 4 bbox [118, 214, 886, 374]`,
          `#   ev-02 -> src_v_01 page 4 bbox [118, 214, 886, 374]`,
          `# PUBLIC SAMPLE OK`,
        ].join("\n"),
      },
      { kind: "note", text: "The sample is a product fixture and says so in its own `disclosure` field: it is unsigned, it is not a promoted customer World, and it is not a quality measurement. Use it to build against the shape, not to judge extraction." },
      { kind: "prose", text: "**Recipe 3 — curl, before you have a key.** Three unauthenticated reads answer the three questions an evaluator asks first. `/api/v1/capabilities` is the same list the upload route validates against, so a format absent from it is refused at upload rather than accepted and dropped. `/api/openapi` is the contract itself — and carries no promote or rollback path, because neither exists for a key. `/api/export/trust` publishes the export signing key, or refuses with `EXPORT_SIGNER_NOT_CONFIGURED` on a deployment that has none." },
      {
        kind: "code",
        label: "What this deployment can read, publish and sign",
        language: "bash",
        body: [
          `# Every readable format, with its tier and qualification receipt. No key.`,
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
      { kind: "note", text: "The digest line above is a shape, not a one-liner to trust blindly: `jq -S` reorders keys and the published digest is taken over the manifest's own key order, so the value it prints will not match unless your jq preserves that order. The procedure that does reproduce it is the one on the capabilities route — delete `contentSha256`, re-serialize with the key order unchanged — and `scripts/developer-recipes/smoke.mjs` performs exactly that and fails when it disagrees." },
      { kind: "prose", text: "Run all three with `node scripts/developer-recipes/smoke.mjs`, or one at a time with `mcp`, `public-sample` or `curl`. It targets `http://127.0.0.1:3207` by default and takes `TAVONEL_RECIPE_BASE_URL` for a real deployment. Every request it makes is an unauthenticated GET: no key, no upload, no compile, nothing that spends." },
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
