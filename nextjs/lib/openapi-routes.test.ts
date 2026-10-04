import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as openApiRoute } from "@/app/api/openapi/route";
import { intakePricingFingerprint, quoteIntakeManifest } from "./usage-pricing";

/*
  G3-001, as a check the build runs instead of a person.

  The defect: `servers` was `https://tavonel.com/api/v1` and the seven `/compile-jobs*`
  operations live at `/api/compile-jobs`, so every one of them -- start, list, poll, stream,
  blockers, cancel, corpus -- resolved to a 404 for anyone generating a client, importing the
  file into Postman, or building a try-it console. That is the entire path from "I uploaded a
  file" to "I have a World", and the documentation pages had it right the whole time, so only
  the machine-readable contract was wrong.

  A one-line fix stays fixed only if something re-checks it. This resolves every path and method
  in the published document against the App Router's own file layout: `{param}` becomes
  `[param]`, the operation's effective server (its path-level override, else the document's)
  supplies the prefix, and `app/<prefix><path>/route.ts` must exist and must export that method.

  It is a file-existence check rather than an HTTP probe on purpose. A network check needs a
  running server and a live deployment, which is exactly the thing that is not available in the
  pull request where the regression would be introduced.
*/

type ExampleMedia = { examples?: Record<string, { value?: unknown }> };
type Operation = {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  responses?: Record<string, { content?: Record<string, ExampleMedia> }>;
  requestBody?: { content?: Record<string, ExampleMedia> };
};
type PathItem = Record<string, unknown> & { servers?: Array<{ url: string }> };
type Document = {
  servers: Array<{ url: string }>;
  tags: Array<{ name: string }>;
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, unknown> };
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const EXPECTED_OPERATION_IDS = [
  "getCapabilityManifest", "getExportTrustRecord", "quoteApprovedUploadSet", "getUploadApproval",
  "createUploadApproval", "cancelApprovedUploadSet", "createDirectUploadCapability", "confirmApprovedUpload",
  "releaseFailedApprovedUpload", "listDocuments", "compileCollection", "startCompileJob", "listCompileJobs",
  "getCompileCorpus", "getCompileJob", "streamCompileJobEvents", "resolveCompileJobBlockers", "cancelCompileJob",
  "listActiveWorlds", "getCollection", "recompileRetrievalIndex", "downloadCollection", "getActiveWorld",
  "askActiveWorld", "streamRunEvents", "recordEvidenceReview", "searchActiveWorld", "getWorldReadModel",
  "getWorldLens", "getManifestStatus", "listConnections", "createConnection", "revokeConnection",
  "applyConnectionBatch", "listOAuthConnectors", "startOAuthConnectorAuthorization", "revokeOAuthConnector",
  "rotateDeveloperApiKey", "listDeveloperAuditEvents",
].sort();
const APPROVED_UPLOAD_OPERATIONS = [
  ["quoteApprovedUploadSet", "post", "/uploads/quote"],
  ["getUploadApproval", "get", "/uploads/approval"],
  ["createUploadApproval", "post", "/uploads/approval"],
  ["cancelApprovedUploadSet", "post", "/uploads/approval/cancel"],
  ["confirmApprovedUpload", "post", "/uploads/confirm"],
  ["releaseFailedApprovedUpload", "post", "/uploads/release"],
] as const;

async function document(): Promise<Document> {
  const response = await openApiRoute(new Request("https://tavonel.com/api/openapi"));
  return await response.json() as Document;
}

function operations(spec: Document) {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    METHODS
      .filter((method) => item[method])
      .map((method) => ({
        path,
        method,
        server: item.servers?.[0]?.url ?? spec.servers[0]!.url,
        operation: item[method] as Operation,
      })),
  );
}

/** `https://tavonel.com/api/v1` + `/world/{id}/{lens}` -> `app/api/v1/world/[id]/[lens]/route.ts` */
function routeFile(server: string, path: string) {
  const prefix = new URL(server).pathname.replace(/\/$/, "");
  const segments = `${prefix}${path}`.replace(/\{([^}]+)\}/g, "[$1]");
  return `app${segments}/route.ts`;
}

describe("the published OpenAPI document", () => {
  it("resolves every path and method to a route handler that exists", async () => {
    const spec = await document();
    const broken = operations(spec)
      .map((entry) => ({ ...entry, file: routeFile(entry.server, entry.path) }))
      .filter((entry) => {
        if (!existsSync(entry.file)) return true;
        const source = readFileSync(entry.file, "utf8");
        // `export function GET`, `export async function GET`, `export const GET`, `export { GET }`.
        return !new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${entry.method.toUpperCase()}\\b|export\\s*\\{[^}]*\\b${entry.method.toUpperCase()}\\b`).test(source);
      })
      .map((entry) => `${entry.method.toUpperCase()} ${entry.server}${entry.path} -> ${entry.file}`);
    expect(broken, "the contract describes a URL this application does not serve").toEqual([]);
  });

  it("still puts the compile routes under /api rather than /api/v1", async () => {
    // The specific regression, named, so a future `servers` edit cannot quietly undo it.
    const spec = await document();
    const compile = operations(spec).filter((entry) => entry.path.startsWith("/compile-jobs"));
    expect(compile.length).toBe(7);
    for (const entry of compile) expect(entry.server, entry.path).toMatch(/\/api$/);
  });

  it("publishes the exact 39-operation surface, including all six approved-upload operations", async () => {
    const spec = await document();
    const actual = operations(spec);
    expect(actual).toHaveLength(39);
    expect(actual.map(({ operation }) => operation.operationId).sort()).toEqual(EXPECTED_OPERATION_IDS);
    for (const [operationId, method, path] of APPROVED_UPLOAD_OPERATIONS) {
      const entry = actual.find((candidate) => candidate.operation.operationId === operationId);
      expect(entry, `${operationId} is missing`).toBeTruthy();
      expect(entry?.method).toBe(method);
      expect(entry?.path).toBe(path);
      expect(entry?.operation.summary?.trim().length ?? 0, `${operationId} needs a summary`).toBeGreaterThan(8);
      expect(entry?.operation.description?.trim().length ?? 0, `${operationId} needs endpoint documentation`).toBeGreaterThan(30);
    }
    expect(actual.find((entry) => entry.operation.operationId === "getUploadApproval")?.operation.description)
      .toMatch(/reload|uncertain|recover/i);
  });

  it("keeps the quickstart endpoint table aligned with those six operation IDs", async () => {
    const { DOCS_SECTIONS } = await import("./docs-content");
    const quickstart = DOCS_SECTIONS.find((section) => section.slug === "quickstart");
    const table = quickstart?.blocks.find((block) => block.kind === "table" && block.head[0] === "Operation");
    expect(table?.kind).toBe("table");
    if (table?.kind !== "table") return;
    expect(table.rows.map((row) => row[0])).toEqual(APPROVED_UPLOAD_OPERATIONS.map(([id]) => id));
  });

  it("derives unknown-page quote and approval examples from live pricing helpers", async () => {
    const quoted = quoteIntakeManifest([
      { bytes: 184320, mimeType: "application/pdf", claimedPages: null, claimedBasis: null },
    ]);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    const totals = quoted.quote;
    const file = totals.files[0]!;
    const pricingFingerprint = await intakePricingFingerprint();
    const actual = operations(await document());
    const operation = (id: string) => actual.find((entry) => entry.operation.operationId === id)!.operation;
    const asRecord = (value: unknown): Record<string, unknown> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Expected an OpenAPI example object.");
      }
      return value as Record<string, unknown>;
    };
    const firstRecord = (value: unknown) => {
      if (!Array.isArray(value) || !value[0] || typeof value[0] !== "object" || Array.isArray(value[0])) {
        throw new Error("Expected an OpenAPI example array with an object member.");
      }
      return value[0] as Record<string, unknown>;
    };
    const responseExample = (id: string) => {
      const media = operation(id).responses?.["200"]?.content?.["application/json"];
      return asRecord(media?.examples?.default?.value);
    };
    const quoteExample = responseExample("quoteApprovedUploadSet");
    expect(quoteExample["pricingFingerprint"]).toBe(pricingFingerprint);
    const quotedTotals = asRecord(quoteExample["quote"]);
    expect(quotedTotals).toEqual({
      maximumPages: totals.maximumPages,
      reservedCredits: totals.reservedCredits,
      maximumCredits: totals.maximumCredits,
      estimatedUsd: totals.estimatedUsd,
      maximumUsd: totals.maximumUsd,
    });
    expect(firstRecord(quoteExample["files"])).toMatchObject({
      pageBasis: file.pageBasis,
      approvedMaxPages: file.approvedMaxPages,
      reservedCredits: file.reservedCredits,
      maximumCredits: file.maximumCredits,
    });

    const approvalRequest = asRecord(operation("createUploadApproval").requestBody?.content?.["application/json"]?.examples?.default?.value);
    expect(approvalRequest["pricingFingerprint"]).toBe(pricingFingerprint);
    expect(approvalRequest["aggregateMaximumCredits"]).toBe(totals.maximumCredits);

    const approvalExample = responseExample("createUploadApproval");
    const approval = asRecord(approvalExample["approval"]);
    expect(approval["pricingFingerprint"]).toBe(pricingFingerprint);
    expect(approval["aggregateMaximumCredits"]).toBe(totals.maximumCredits);
    expect(firstRecord(approval["files"])["approvedMaximumCredits"]).toBe(file.maximumCredits);
    expect(approvalExample["quote"]).toEqual(quoteExample["quote"]);

    const recoveredApproval = responseExample("getUploadApproval");
    const recovered = asRecord(recoveredApproval["approval"]);
    expect(recovered["pricingFingerprint"]).toBe(pricingFingerprint);
    expect(recovered["aggregateMaximumCredits"]).toBe(totals.maximumCredits);
    const capability = responseExample("createDirectUploadCapability");
    expect(asRecord(capability["computeReservation"])).toMatchObject({
      maximumCredits: file.maximumCredits,
      reservedCredits: file.reservedCredits,
    });
  });
  it("keeps unintended C0 controls out of OpenAPI source and output strings", async () => {
    const forbidden = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
    const codePoints = (text: string) => [...text.matchAll(forbidden)]
      .map((match) => `U+${match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    const collectStrings = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.flatMap(collectStrings);
      if (value && typeof value === "object") {
        return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
      }
      return [];
    };

    const source = readFileSync(resolve(import.meta.dirname, "../app/api/openapi/route.ts"), "utf8");
    expect(codePoints(source)).toEqual([]);
    const emittedStrings = collectStrings(await document());
    expect(emittedStrings.flatMap(codePoints)).toEqual([]);
  });
  it("keeps unintended C0 controls out of developer documentation source", () => {
    const source = readFileSync(resolve(import.meta.dirname, "docs-content.ts"), "utf8");
    const controls = [...source.matchAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)]
      .map((match) => `U+${match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    expect(controls).toEqual([]);
  });
});
