import { NextResponse } from "next/server";
import { DEVELOPER_SCOPES } from "../../../lib/developer-contracts";

export const dynamic = "force-static";

const errorResponse = {
  description: "Bounded error with a stable machine code",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "TAVONEL Knowledge Compiler API",
      version: "2026-08-30",
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
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["documentIds"], properties: { documentIds: { type: "array", minItems: 2, maxItems: 12, uniqueItems: true, items: { type: "string", pattern: "^[0-9a-f-]{36}$" } } } } } } },
          responses: { "200": { description: "Immutable candidate package receipt; candidatePromotion is always false" }, "400": errorResponse, "401": errorResponse, "403": errorResponse, "409": errorResponse },
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
          responses: { "200": { description: "Grounded answer with exact page and bbox citations, or an explicit abstention" }, "409": errorResponse },
        },
      },
      "/connections/{id}/sync": {
        post: {
          operationId: "applyConnectionBatch",
          "x-tavonel-scope": "connections:sync",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ConnectionBatch" } } } },
          responses: { "200": { description: "Cursor transition applied or idempotently replayed" }, "400": errorResponse, "409": errorResponse, "423": errorResponse },
        },
      },
    },
    components: {
      securitySchemes: { TavonelApiKey: { type: "http", scheme: "bearer", bearerFormat: "tvnl_live_<prefix>_<secret>", description: "Create in Workspace > Developers. The plaintext is shown once." } },
      parameters: { CollectionId: { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^collection-[a-f0-9]{32}$" } } },
      schemas: {
        Error: { type: "object", required: ["code"], properties: { code: { type: "string" } }, additionalProperties: true },
        ConnectionEvent: {
          type: "object",
          required: ["kind", "nativeId", "revision", "contentSha256", "sizeBytes", "mimeType"],
          properties: {
            kind: { enum: ["added", "changed", "deleted"] },
            nativeId: { type: "string", maxLength: 1024 },
            revision: { type: "string", maxLength: 512 },
            contentSha256: { type: ["string", "null"], pattern: "^[a-f0-9]{64}$" },
            sizeBytes: { type: ["integer", "null"], minimum: 0, maximum: 524288000 },
            mimeType: { type: ["string", "null"] },
            documentId: { type: ["string", "null"], format: "uuid", description: "Immutable intake document created by a direct upload, when this source type is qualified." },
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
    "x-tavonel-decision-gates": { promotion: "browser-session-only", rollback: "browser-session-only", mcp: "read-only" },
  }, { headers: { "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
