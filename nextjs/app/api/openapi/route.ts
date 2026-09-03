import { NextResponse } from "next/server";
import { API_VERSION } from "@/lib/api-version";
import { DEVELOPER_SCOPES } from "../../../lib/developer-contracts";
import { resolveOpenApiOrigin } from "../../../lib/openapi-origin";

// The published server URL must be the origin the caller actually reached, and this route
// used to be force-static: Next.js evaluated the handler once at build time, so
// `new URL(request.url).origin` froze to whatever the builder saw -- http://localhost:3000 --
// and every production consumer of /api/openapi was handed a spec pointing at the developer's
// own machine. An SDK generated from it would target localhost.
//
// force-dynamic makes the origin the request's own, so the spec is correct behind the apex,
// a preview deployment, or a custom domain alike, with no origin baked into the build. The
// document is small and cheap to serve, and the Cache-Control header below still lets it be
// cached at the edge per-origin. The origin rule itself lives in lib/openapi-origin.ts -- a
// route module may not export anything but handlers and config.
export const dynamic = "force-dynamic";

const errorResponse = {
  description: "Bounded error with a stable machine code",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

export function GET(request: Request) {
  if (request.headers.get("accept")?.includes("text/html")) {
    return NextResponse.redirect(new URL("/api", request.url), 302);
  }
  const origin = resolveOpenApiOrigin(request.url);
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "TAVONEL Knowledge Compiler API",
      version: API_VERSION,
      description: "Tenant-scoped access to immutable documents, candidate knowledge packages, active worlds, grounded retrieval and durable connector cursors. Promotion and rollback remain human-session-only.",
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ TavonelApiKey: [] }],
    paths: {
      "/uploads/capability": {
        post: {
          operationId: "createDirectUploadCapability",
          "x-tavonel-scope": "documents:intake",
          description: "Returns a short-lived browser/agent-direct R2 PUT URL. Document bytes never pass through the application server.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["originalFilename", "declaredMimeType", "requestedBytes"], properties: { originalFilename: { type: "string", maxLength: 512 }, declaredMimeType: { type: "string" }, requestedBytes: { type: "integer", minimum: 1, maximum: 524288000 } }, additionalProperties: false } } } },
          responses: { "200": { description: "Qualified direct upload capability and immutable document ID" }, "400": errorResponse, "401": errorResponse, "402": errorResponse, "429": errorResponse },
        },
      },
      "/documents": {
        get: { operationId: "listDocuments", "x-tavonel-scope": "documents:read", responses: { "200": { description: "Immutable document inventory" }, "401": errorResponse, "403": errorResponse } },
      },
      "/collections/compile": {
        post: {
          operationId: "compileCollection",
          "x-tavonel-scope": "collections:compile",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["documentIds"], properties: { documentIds: { type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: { type: "string", pattern: "^[0-9a-f-]{36}$" } } } } } } },
          responses: { "200": { description: "Immutable candidate package receipt; candidatePromotion is always false" }, "400": errorResponse, "401": errorResponse, "403": errorResponse, "409": errorResponse },
        },
      },
      /*
        Durable compile orchestration.

        These sit at /api/compile-jobs rather than under /api/v1, so each carries its own
        server. That is not tidy and it is accurate: the versioned developer surface and the
        workspace's own orchestration are different contracts with different stability
        promises, and pretending otherwise in the spec would mislead anyone generating a client.
      */
      "/compile-jobs": {
        servers: [{ url: `${origin}/api` }],
        post: {
          operationId: "startCompileJob",
          "x-tavonel-scope": "collections:compile",
          description: "Records the intent to compile and returns immediately. The job advances on the server whether or not the caller stays connected, which is the difference between this and /v1/collections/compile. Submitting the same document set again returns the job that already exists rather than starting a second compile. A selection larger than one compile can carry is partitioned server-side into parts and answered with COMPILE_CORPUS_ACCEPTED and a corpusId instead of a jobId; each part is an ordinary compile job with its own id, state and event stream.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["documentIds"], properties: { documentIds: { type: "array", minItems: 1, maxItems: 128, uniqueItems: true, items: { type: "string", pattern: "^[0-9a-f-]{36}$" } } }, additionalProperties: false } } } },
          responses: { "202": { description: "Accepted. Either { code: COMPILE_JOB_ACCEPTED, jobId } or, for a partitioned selection, { code: COMPILE_CORPUS_ACCEPTED, corpusId, batchCount, parts }; Location names whichever resource was created." }, "400": errorResponse, "401": errorResponse, "403": errorResponse, "503": errorResponse },
        },
        get: {
          operationId: "listCompileJobs",
          "x-tavonel-scope": "collections:read",
          description: "The workspace's recent compiles, so a client that lost its job id can pick a run back up.",
          responses: { "200": { description: "Recent compile jobs, newest first" }, "401": errorResponse, "503": errorResponse },
        },
      },
      "/compile-jobs/corpus/{corpusId}": {
        servers: [{ url: `${origin}/api` }],
        get: {
          operationId: "getCompileCorpus",
          "x-tavonel-scope": "collections:read",
          parameters: [{ name: "corpusId", in: "path", required: true, schema: { type: "string", pattern: "^corpus-[a-f0-9]{32}$" } }],
          description: "A partitioned run, summarised from its parts. There is no stored roll-up: the state is computed from the part rows every time, so it cannot disagree with them. `partial` means some parts compiled and at least one did not -- the Worlds that exist are usable, and reporting that as ready would hide missing sources.",
          responses: { "200": { description: "Corpus state, part list and aggregate progress" }, "400": errorResponse, "404": errorResponse, "503": errorResponse },
        },
      },
      "/compile-jobs/{jobId}": {
        servers: [{ url: `${origin}/api` }],
        get: {
          operationId: "getCompileJob",
          "x-tavonel-scope": "collections:read",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "The durable current state. A poller against this sees exactly what a stream subscriber sees, because both read the same row.",
          responses: { "200": { description: "Compile job state, progress and any blocked documents" }, "400": errorResponse, "404": errorResponse, "503": errorResponse },
        },
      },
      "/compile-jobs/{jobId}/events": {
        servers: [{ url: `${origin}/api` }],
        get: {
          operationId: "streamCompileJobEvents",
          "x-tavonel-scope": "collections:read",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "Replays the persisted transition log after Last-Event-ID, then follows it. The server closes the stream at its own wall clock, so reconnecting is the normal case rather than an error path; every frame carries the durable sequence to resume from.",
          responses: { "200": { description: "text/event-stream of persisted compile transitions" }, "400": errorResponse, "404": errorResponse },
        },
      },
      "/compile-jobs/{jobId}/blockers": {
        servers: [{ url: `${origin}/api` }],
        post: {
          operationId: "resolveCompileJobBlockers",
          "x-tavonel-scope": "collections:compile",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "Answers a partial failure. A job with blocked documents stops and waits; nothing skips them by itself. `continue` is refused while any blocker is a security blocker -- those leave the set through `remove_blocked`, which records who removed them.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["resolution"], properties: { resolution: { type: "string", enum: ["continue", "remove_blocked", "retry_eligible"] } }, additionalProperties: false } } } },
          responses: { "200": { description: "The recorded resolution and the job it applies to" }, "400": errorResponse, "404": errorResponse, "409": errorResponse },
        },
      },
      "/compile-jobs/{jobId}/cancel": {
        servers: [{ url: `${origin}/api` }],
        post: {
          operationId: "cancelCompileJob",
          "x-tavonel-scope": "collections:compile",
          parameters: [{ $ref: "#/components/parameters/CompileJobId" }],
          description: "Marks the job cancelled. A job that had already settled is left alone -- a cancel arriving a second after a compile finished does not destroy the result.",
          responses: { "200": { description: "The cancelled job" }, "404": errorResponse, "409": errorResponse },
        },
      },
      "/collections/{id}": {
        get: { operationId: "getCollection", "x-tavonel-scope": "collections:read", parameters: [{ $ref: "#/components/parameters/CollectionId" }], responses: { "200": { description: "Reviewable candidate artifact" }, "404": errorResponse } },
      },
      "/collections/{id}/download": {
        get: { operationId: "downloadCollection", "x-tavonel-scope": "collections:download", parameters: [{ $ref: "#/components/parameters/CollectionId" }], responses: { "200": { description: "Signed, hash-verifiable ZIP", content: { "application/zip": { schema: { type: "string", contentEncoding: "binary" } } } }, "404": errorResponse } },
      },
      "/collections/{id}/world": {
        get: { operationId: "getActiveWorld", "x-tavonel-scope": "worlds:read", parameters: [{ $ref: "#/components/parameters/CollectionId" }], responses: { "200": { description: "Human-promoted active world and retained versions" }, "404": errorResponse } },
      },
      "/collections/{id}/ask": {
        post: {
          operationId: "askActiveWorld",
          "x-tavonel-scope": "ask:read",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["question"], properties: { question: { type: "string", minLength: 3, maxLength: 500 } } } } } },
          responses: { "200": { description: "Grounded answer with exact page and bbox citations, or an explicit abstention. `retrievalPath` names which runtime answered: `compiled-retrieval-v1` (lexical + dense + structure, RRF-fused, reranked and World Gate filtered) or `excerpt-concatenation-fallback` when no compiled retrieval index exists for the active world yet" }, "409": errorResponse },
        },
      },
      "/runs/{runId}/events": {
        get: {
          operationId: "streamRunEvents",
          "x-tavonel-scope": "documents:read",
          description: "Replays append-only observed run events after Last-Event-ID, then streams new events and a bounded heartbeat.",
          parameters: [
            { name: "runId", in: "path", required: true, schema: { type: "string" } },
            { name: "after", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
          ],
          responses: { "200": { description: "Persisted run-event stream", content: { "text/event-stream": { schema: { type: "string" } } } }, "404": errorResponse },
        },
      },
      "/reviews": {
        post: {
          operationId: "recordEvidenceReview",
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Records an append-only Accept, Edit, or Reject decision after revalidating the evidence against the persisted World.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["collectionId", "manifestDigest", "evidenceId", "action", "reason"], properties: { collectionId: { type: "string", pattern: "^collection-[a-f0-9]{32}$" }, manifestDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, evidenceId: { type: "string" }, action: { enum: ["accept", "edit", "reject"] }, reason: { type: "string", minLength: 8, maxLength: 1000 } }, additionalProperties: false } } } },
          responses: { "201": { description: "Evidence-bound human decision receipt" }, "400": errorResponse, "404": errorResponse, "409": errorResponse },
        },
      },
      // Kept separate from /ask deliberately: search returns evidence-rich candidates for a
      // caller to reason over, ask returns a grounded answer. A consumer that only needs the
      // facts should not have to pay for generation or parse prose to recover them.
      "/collections/{id}/search": {
        post: {
          operationId: "searchActiveWorld",
          "x-tavonel-scope": "ask:read",
          description: "Retrieval-only search over the active world's compiled retrieval index. Returns the ContextPacket (the same runtime contract /ask, MCP and the CLI share) plus per-source retrieval telemetry, without generating an answer.",
          parameters: [{ $ref: "#/components/parameters/CollectionId" }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 3, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 25, default: 10 } } } } } },
          responses: { "200": { description: "ContextPacket of evidence-bound retrieval units with lexical/dense/structure ranks, reranker score and World Gate decisions" }, "400": errorResponse, "409": errorResponse, "503": errorResponse },
        },
      },
      "/connections": {
        get: {
          operationId: "listConnections",
          "x-tavonel-scope": "connections:read",
          responses: { "200": { description: "Tenant-scoped durable source connections and committed cursor state" }, "401": errorResponse, "403": errorResponse },
        },
        post: {
          operationId: "createConnection",
          "x-tavonel-scope": "connections:write",
          description: "Registers a local-agent file-server, S3, R2 or MinIO source. Credentials stay in the customer environment.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ConnectionInput" } } } },
          responses: { "201": { description: "Durable connection record" }, "400": errorResponse, "401": errorResponse, "403": errorResponse },
        },
      },
      "/connections/{id}": {
        delete: {
          operationId: "revokeConnection",
          "x-tavonel-scope": "connections:write",
          parameters: [{ $ref: "#/components/parameters/ConnectionId" }],
          responses: { "204": { description: "Connection revoked; immutable outputs retained" }, "400": errorResponse, "404": errorResponse },
        },
      },
      "/connections/{id}/sync": {
        post: {
          operationId: "applyConnectionBatch",
          "x-tavonel-scope": "connections:sync",
          parameters: [{ $ref: "#/components/parameters/ConnectionId" }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ConnectionBatch" } } } },
          responses: { "200": { description: "Cursor transition applied or idempotently replayed" }, "400": errorResponse, "409": errorResponse, "423": errorResponse },
        },
      },
      "/oauth-connectors": {
        get: {
          operationId: "listOAuthConnectors",
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Lists configured provider readiness and tenant OAuth connections. Provider credentials are never returned.",
          responses: { "200": { description: "OAuth provider readiness and connections" }, "401": errorResponse, "503": errorResponse },
        },
      },
      "/oauth-connectors/authorize": {
        post: {
          operationId: "startOAuthConnectorAuthorization",
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Creates a single-use PKCE authorization. Fails closed unless the provider client and managed secret broker are configured.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/OAuthConnectorAuthorizationInput" } } } },
          responses: { "200": { description: "Short-lived provider authorization URL" }, "400": errorResponse, "401": errorResponse, "503": errorResponse },
        },
      },
      "/oauth-connectors/connections/{id}": {
        delete: {
          operationId: "revokeOAuthConnector",
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          parameters: [{ $ref: "#/components/parameters/OAuthConnectionId" }],
          responses: { "204": { description: "Refresh secret deleted and connection revoked" }, "401": errorResponse, "404": errorResponse, "503": errorResponse },
        },
      },
      "/developer/keys/{id}/rotate": {
        post: {
          operationId: "rotateDeveloperApiKey",
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Atomically creates a replacement key, revokes the source key and writes an audit event. Plaintext is returned once.",
          parameters: [{ $ref: "#/components/parameters/DeveloperKeyId" }],
          responses: { "201": { description: "One-time replacement credential" }, "400": errorResponse, "401": errorResponse, "404": errorResponse },
        },
      },
      "/developer/audit": {
        get: {
          operationId: "listDeveloperAuditEvents",
          "x-tavonel-auth": "browser-session",
          security: [{ TavonelUserSession: [] }],
          description: "Reads the tenant-scoped developer and connector audit trail.",
          responses: { "200": { description: "Bounded audit event list" }, "401": errorResponse, "503": errorResponse },
        },
      },
    },
    components: {
      securitySchemes: {
        TavonelApiKey: { type: "http", scheme: "bearer", bearerFormat: "tvnl_live_<prefix>_<secret>", description: "Create in Workspace > Developers. The plaintext is shown once." },
        TavonelUserSession: { type: "http", scheme: "bearer", bearerFormat: "Supabase access JWT", description: "Interactive user session. Developer API keys cannot call management or OAuth routes." },
      },
      parameters: {
        CollectionId: { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^collection-[a-f0-9]{32}$" } },
        CompileJobId: { name: "jobId", in: "path", required: true, schema: { type: "string", pattern: "^cjob-[a-f0-9]{32}$" } },
        ConnectionId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        OAuthConnectionId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        DeveloperKeyId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      },
      schemas: {
        Error: { type: "object", required: ["code"], properties: { code: { type: "string" } }, additionalProperties: true },
        ConnectionInput: {
          type: "object",
          required: ["provider", "mode", "displayName", "configuration"],
          properties: {
            provider: { enum: ["file_server", "s3", "r2", "minio"] },
            mode: { const: "local_agent" },
            displayName: { type: "string", minLength: 1, maxLength: 100 },
            configuration: {
              type: "object",
              description: "Non-secret source selectors such as bucket, prefix, region or rootLabel.",
              additionalProperties: true,
            },
            secretReference: { type: "null", description: "Local agents use workload credentials; secrets are never sent to TAVONEL." },
          },
          additionalProperties: false,
        },
        OAuthConnectorAuthorizationInput: {
          type: "object",
          required: ["provider", "displayName"],
          properties: {
            provider: { enum: ["google_drive", "dropbox", "microsoft_graph"] },
            displayName: { type: "string", minLength: 1, maxLength: 100 },
          },
          additionalProperties: false,
        },
        ConnectionEvent: {
          type: "object",
          required: ["kind", "nativeId", "revision", "contentSha256", "sizeBytes", "mimeType", "documentId", "sourceIdempotencyKey"],
          properties: {
            kind: { enum: ["added", "changed", "deleted"] },
            nativeId: { type: "string", maxLength: 1024 },
            revision: { type: "string", maxLength: 512 },
            contentSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
            sizeBytes: { type: ["integer", "null"], minimum: 0, maximum: 524288000 },
            mimeType: { type: ["string", "null"] },
            documentId: { type: ["string", "null"], format: "uuid", description: "Immutable intake document created by a direct upload, when this source type is qualified." },
            sourceIdempotencyKey: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$", description: "Tenant-bound source-event key; required with documentId and revalidated by the server." },
          },
          additionalProperties: false,
        },
        ConnectionBatch: {
          type: "object",
          required: ["batchId", "previousCursorSha256", "nextCursorSha256", "manifestSha256", "events"],
          properties: {
            batchId: { type: "string", format: "uuid" },
            previousCursorSha256: { type: ["string", "null"], pattern: "^sha256:[a-f0-9]{64}$" },
            nextCursorSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
            manifestSha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
            events: { type: "array", maxItems: 5000, items: { $ref: "#/components/schemas/ConnectionEvent" } },
          },
          additionalProperties: false,
        },
      },
    },
    "x-tavonel-scopes": DEVELOPER_SCOPES,
    "x-tavonel-api-version": 1,
    "x-tavonel-version-policy": { pathMajor: "/api/v1", responseHeader: "X-TAVONEL-API-Version", clientMediaType: "application/vnd.tavonel.v1+json" },
    "x-tavonel-browser-session-paths": ["/oauth-connectors", "/oauth-connectors/authorize", "/oauth-connectors/connections/{id}", "/developer/keys/{id}/rotate", "/developer/audit"],
    "x-tavonel-decision-gates": { promotion: "browser-session-only", rollback: "browser-session-only", mcp: "read-only" },
  }, { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" } });
}
