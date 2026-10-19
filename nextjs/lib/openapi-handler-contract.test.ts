import { existsSync, readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approvedSourceIdempotencyKey } from "./intake-approval";
import { FOUNDATION_INTAKE_MAX_BYTES } from "./r2-presign";
import { intakePricingFingerprint } from "./usage-pricing";

/*
  G1 (SERVICE-DEFINITION 2026-10-17 section 1 "API", section 2.2 A14, section 5 G1): the published
  contract and the deployed handlers, compared by running both.

  What the audit found on live: the /uploads/capability 200 required `documentId, url, method,
  expiresAt` while the route has only ever written `uploadUrl, expiresInSeconds, objectKey, ...`,
  and with the approval switch off /uploads/confirm was missing from the document although an upload
  is not admitted until it answers. The suites beside this one pinned field lists written into the
  test by hand, so the spec and the test could agree with each other and both disagree with the route.

  Here nothing is written down twice. For each rollout configuration the generated document is read
  from GET /api/openapi, every operation in it must resolve to a route file exporting that method, and
  the capability, confirm and developer-key handlers are called with mocked infrastructure. The keys
  of each 200/201 body must equal the `required` list the document publishes for it -- at the top level
  and in every nested object the route builds -- and each refusal exercised must be listed under the
  status it was answered with. A renamed field, a dropped operation or an unlisted refusal fails here.
*/

const m = vi.hoisted(() => ({
  authorize: vi.fn(), session: vi.fn(), gate: vi.fn(), admission: vi.fn(), compute: vi.fn(),
  readApproval: vi.fn(), approvedReservation: vi.fn(), signer: vi.fn(), head: vi.fn(), headSignature: vi.fn(),
  presign: vi.fn(), triage: vi.fn(), sessionProduct: vi.fn(), adminConfig: vi.fn(), adminRequest: vi.fn(),
}));

vi.mock("@/lib/developer-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./developer-auth")>()),
  authorizeFoundationRequest: m.authorize,
  requireFoundationSession: m.session,
}));
vi.mock("@/lib/customer-data-admission", () => ({ canAdmitCustomerSource: m.gate }));
vi.mock("@/lib/intake-admission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./intake-admission")>()),
  reserveFoundationIntake: m.admission,
}));
vi.mock("@/lib/compute-reservation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./compute-reservation")>()),
  reserveFoundationCompute: m.compute,
  readFoundationIntakeApproval: m.readApproval,
  reserveFoundationIntakeApprovedFile: m.approvedReservation,
}));
vi.mock("@/lib/r2-synthetic-canary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-synthetic-canary")>()),
  readR2SignerEnv: m.signer,
  headFoundationQuarantineObject: m.head,
  headFoundationQuarantineSignature: m.headSignature,
}));
vi.mock("@/lib/r2-presign", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./r2-presign")>()),
  presignFoundationQuarantinePut: m.presign,
}));
vi.mock("@/lib/intake-triage-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./intake-triage-server")>()),
  readReadyUploadTriage: m.triage,
}));
vi.mock("@/lib/self-service-trial", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./self-service-trial")>()),
  authorizeFoundationSessionProduct: m.sessionProduct,
}));
// The developer store runs for real against this, so the key and audit rows are its own builders'.
vi.mock("@/lib/supabase-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./supabase-admin")>()),
  readSupabaseAdminConfig: m.adminConfig,
  supabaseAdminRequest: m.adminRequest,
}));

type Json = Record<string, unknown>;
type Schema = Json & { $ref?: string; required?: string[]; properties?: Record<string, Schema>; oneOf?: Schema[]; items?: Schema; type?: unknown };
type Operation = Json & { operationId: string; responses: Record<string, Json & { "x-tavonel-error-codes"?: string[] }> };
type Spec = { servers: Array<{ url: string }>; paths: Record<string, Json & { servers?: Array<{ url: string }> }>; components: Json };

const CONFIGS = [
  { name: "production: approval and triage lineages off", approval: false, triage: false },
  { name: "approval lineage on", approval: true, triage: false },
  { name: "approval and triage lineages on", approval: true, triage: true },
] as const;
type Config = (typeof CONFIGS)[number];

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
const WORKSPACE = "pilot-0123456789abcdef";
const USER = "11111111-2222-4333-8444-555555555555";
const DOCUMENT = "33333333-3333-4333-8333-333333333333";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const SHA = `sha256:${"b".repeat(64)}`;
const ATTEMPT = "att_0123456789abcdef0123456789abcdef";
const SCOPE = `sha256:${"d".repeat(64)}`;
const FILE = "fk_0123456789abcdef0123456789abcdef01234567";
const VERSION = "etag-sealed-1";
const OBJECT_KEY = `quarantine/${WORKSPACE}/${DOCUMENT}/source`;
const BYTES = 184_320;

const loaded = new Map<string, ReturnType<typeof loadFresh>>();

/** Each rollout configuration as its own module graph, built once: the switches are module constants. */
function load(config: Config) {
  if (!loaded.has(config.name)) loaded.set(config.name, loadFresh(config));
  return loaded.get(config.name)!;
}

async function loadFresh(config: Config) {
  vi.resetModules();
  vi.doMock("@/lib/intake-approval-rollout", () => ({ INTAKE_APPROVAL_ROLLOUT_ENABLED: config.approval }));
  vi.doMock("@/lib/intake-triage-rollout", () => ({ INTAKE_TRIAGE_ROLLOUT_ENABLED: config.triage }));
  const [openApi, capability, confirm, keys, rotate, audit] = await Promise.all([
    import("@/app/api/openapi/route"),
    import("@/app/api/v1/uploads/capability/route"),
    import("@/app/api/v1/uploads/confirm/route"),
    import("@/app/api/developer/keys/route"),
    import("@/app/api/v1/developer/keys/[id]/rotate/route"),
    import("@/app/api/v1/developer/audit/route"),
  ]);
  const response = await openApi.GET(new Request("https://tavonel.com/api/openapi"));
  expect(response.status).toBe(200);
  return {
    spec: await response.json() as Spec,
    capability: capability.POST, confirm: confirm.POST, createKey: keys.POST, rotateKey: rotate.POST, auditEvents: audit.GET,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  return new Request(`https://tavonel.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)), authorization: "Bearer test", ...headers },
    body: payload,
  });
}

function operation(spec: Spec, path: string, method: string) {
  const found = spec.paths[path]?.[method] as Operation | undefined;
  expect(found, `${method.toUpperCase()} ${path} is not in the published contract`).toBeTruthy();
  return found!;
}

function resolve(spec: Spec, node: Schema): Schema {
  let current = node;
  while (current.$ref) {
    current = current.$ref.replace(/^#\//, "").split("/").reduce<unknown>((at, step) => (at as Json)[step], spec) as Schema;
  }
  return current;
}

/** The published schema for this body: a oneOf branch is chosen by the `code` the handler wrote. */
function publishedSchema(spec: Spec, op: Operation, status: number, body: Json) {
  const media = (op.responses[String(status)]?.content as Record<string, { schema: Schema }> | undefined)?.["application/json"];
  expect(media, `${op.operationId} publishes no ${status} schema`).toBeTruthy();
  const schema = resolve(spec, media!.schema);
  if (!schema.oneOf) return schema;
  const branch = schema.oneOf.map((entry) => resolve(spec, entry)).find((entry) => (entry.properties?.code as Json | undefined)?.const === body.code);
  expect(branch, `${op.operationId} publishes no ${status} shape for code ${String(body.code)}`).toBeTruthy();
  return branch!;
}

/**
 * Every disagreement between a body and its schema, at every depth: a required key the body lacks,
 * or a key the body writes that the schema does not publish. An object described as best-effort
 * (a database row the route passes through) is checked for its required keys only.
 */
function drift(spec: Spec, node: Schema, value: unknown, at: string): string[] {
  const schema = resolve(spec, node);
  if (Array.isArray(value)) return schema.items ? value.flatMap((item, index) => drift(spec, schema.items!, item, `${at}[${index}]`)) : [];
  if (!value || typeof value !== "object" || !schema.properties) return [];
  const body = value as Json;
  const keys = Object.keys(body);
  const problems = (schema.required ?? []).filter((key) => !keys.includes(key)).map((key) => `${at}.${key} is required and absent`);
  if (schema["x-tavonel-status"] !== "best-effort") {
    problems.push(...keys.filter((key) => !(key in schema.properties!)).map((key) => `${at}.${key} is written and unpublished`));
  }
  for (const [key, child] of Object.entries(schema.properties)) {
    if (key in body) problems.push(...drift(spec, child, body[key], `${at}.${key}`));
  }
  return problems;
}

/** The body's top-level keys equal the published `required` list, and nothing nested drifts either. */
function expectContract(spec: Spec, op: Operation, status: number, body: Json) {
  const schema = publishedSchema(spec, op, status, body);
  expect(Object.keys(body).sort(), `${op.operationId} ${status}: handler keys vs published required`).toEqual([...(schema.required ?? [])].sort());
  expect(drift(spec, schema, body, op.operationId)).toEqual([]);
}

/** A refusal the handler answered is listed under the status it answered with. */
async function expectListedRefusal(op: Operation, response: Response, code: string, status: number) {
  const body = await response.json() as Json;
  expect({ status: response.status, code: body.code }).toEqual({ status, code });
  expect(op.responses[String(status)]?.["x-tavonel-error-codes"], `${op.operationId} does not list ${code} under ${status}`).toContain(code);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The PostgREST calls the confirm route and the developer store make, answered as the database would. */
function database(path: string): Response {
  if (path === "/rest/v1/rpc/confirm_foundation_intake_admission") {
    return json({ status: "confirmed", documentId: DOCUMENT, confirmedAt: "2026-10-17T00:01:00.000Z", requestedBytes: BYTES, declaredMimeType: "application/pdf", sourceSha256: SHA });
  }
  if (path === "/rest/v1/rpc/confirm_foundation_intake_approved_upload") {
    return json({
      admission: { status: "confirmed", documentId: DOCUMENT, confirmedAt: "2026-10-17T00:01:00.000Z", requestedBytes: BYTES },
      approvedFile: { fileKey: FILE, documentId: DOCUMENT, fileState: "confirmed", contentSha256: SHA, byteLength: BYTES, mimeType: "application/pdf" },
    });
  }
  if (path === "/rest/v1/rpc/create_foundation_api_key_authorized") {
    return json({ key_id: "00000000-0000-4000-8000-000000000002", name: "ci-ingest", key_prefix: "abcdefghijkl", scopes: ["documents:read"], created_at: "2026-10-17T00:00:00.000Z", expires_at: null, last_used_at: null, revoked_at: null });
  }
  if (path === "/rest/v1/rpc/rotate_foundation_api_key") {
    return json({ keyId: "00000000-0000-4000-8000-000000000003", keyPrefix: "mnopqrstuvwx", name: "ci-ingest", scopes: ["documents:read"], createdAt: "2026-10-17T00:00:00.000Z", expiresAt: null });
  }
  if (path.startsWith("/rest/v1/foundation_developer_audit_events?")) {
    return json([{ event_id: "00000000-0000-4000-8000-000000000004", action: "api_key_rotated", target_id: "00000000-0000-4000-8000-000000000002", actor_user_id: USER, actor_key_id: null, details: { reason: "test" }, created_at: "2026-10-17T00:00:00.000Z" }]);
  }
  throw new Error(`unexpected database call ${path}`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue({ ok: true, principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: USER, scopes: [], accessSource: "subscription" } });
  m.session.mockResolvedValue({ ok: true, principal: { workspaceKey: WORKSPACE, userId: USER, accessSource: "subscription", authorizationRevision: 1 } });
  m.gate.mockResolvedValue(true);
  m.signer.mockReturnValue({ accountId: "account", bucket: "bucket", accessKeyId: "key", secretAccessKey: "secret" });
  m.admission.mockResolvedValue({ ok: true, result: { expiresAt: "2026-10-17T00:05:00.000Z" } });
  m.compute.mockResolvedValue({
    ok: true,
    result: { reservationId: "00000000-0000-4000-8000-000000000009", documentId: DOCUMENT, state: "reserved", expiresAt: "2026-10-17T00:05:00.000Z", reservedCredits: 12, maximumCredits: 24, billingSource: "paid", idempotentReplay: false, quote: { pages: 3 } },
  });
  m.approvedReservation.mockResolvedValue({
    ok: true,
    result: { reservationId: "00000000-0000-4000-8000-000000000009", approvedReservedCredits: 12, approvedMaximumCredits: 24, billingSource: "paid", reservationExpiresAt: "2026-10-17T00:05:00.000Z", approvedMaxPages: 3, pageBasis: "declared" },
  });
  m.presign.mockReturnValue({ ok: true, uploadUrl: "https://r2.test/quarantine/put?X-Amz-Signature=redacted" });
  m.head.mockResolvedValue({ ok: true, exists: true, key: OBJECT_KEY, sizeBytes: BYTES, contentType: "application/pdf", etag: VERSION });
  m.headSignature.mockResolvedValue({ ok: true, exists: true, bytes: PDF });
  m.sessionProduct.mockResolvedValue({ ok: true, access: { source: "paid", accessPlan: "observer_access", billingExempt: false, expiresAt: null } });
  m.adminConfig.mockReturnValue({ url: "https://project.supabase.co", serviceRoleKey: "sb_secret_x" });
  m.adminRequest.mockImplementation(async (_config: unknown, path: string) => database(path));
  const triageLineage = { triageReceiptId: "receipt-1", triageVersion: "tavonel-intake-triage-v1", triageInventoryDigest: SCOPE, configurationRevision: "rev-1" };
  m.readApproval.mockResolvedValue({
    ok: true,
    result: {
      scopeDigest: SCOPE, pricingFingerprint: await intakePricingFingerprint(),
      files: [{ fileKey: FILE, documentId: DOCUMENT, contentSha256: SHA, byteLength: BYTES, mimeType: "application/pdf" }],
      ...triageLineage,
    },
  });
  m.triage.mockResolvedValue({
    ok: true,
    result: {
      receipt: { inventoryDigest: SCOPE, configurationRevision: "rev-1", fileBindings: [{ fileKey: FILE, documentId: DOCUMENT, objectKey: OBJECT_KEY, objectVersion: VERSION }] },
      entries: [{ fileKey: FILE, contentSha256: SHA, byteLength: BYTES, mimeType: "application/pdf" }],
    },
  });
});

/** The approval lineage reads triage fields only while triage is on; off, a row carrying them is refused. */
function withoutTriageLineage() {
  m.readApproval.mockImplementation(async () => ({
    ok: true,
    result: { scopeDigest: SCOPE, pricingFingerprint: await intakePricingFingerprint(), files: [{ fileKey: FILE, documentId: DOCUMENT, contentSha256: SHA, byteLength: BYTES, mimeType: "application/pdf" }] },
  }));
}

async function capabilityRequest(config: Config, overrides: Json = {}) {
  const base = { originalFilename: "manual.pdf", declaredMimeType: "application/pdf", requestedBytes: BYTES };
  if (!config.approval) return post("/api/v1/uploads/capability", { ...base, ...overrides });
  return post(
    "/api/v1/uploads/capability",
    { ...base, attemptKey: ATTEMPT, scopeDigest: SCOPE, pricingFingerprint: await intakePricingFingerprint(), fileKey: FILE, contentSha256: SHA, ...overrides },
    { "x-tavonel-source-idempotency-key": await approvedSourceIdempotencyKey(ATTEMPT, FILE) },
  );
}

function confirmRequest(config: Config, overrides: Json = {}) {
  const base = config.approval
    ? { documentId: DOCUMENT, sourceSha256: SHA, attemptKey: ATTEMPT, scopeDigest: SCOPE, fileKey: FILE }
    : { documentId: DOCUMENT, sourceSha256: SHA };
  return post("/api/v1/uploads/confirm", { ...base, ...overrides });
}

describe.each(CONFIGS)("the published contract against the handlers ($name)", (config) => {
  // Building a configuration's module graph is the slow part; it is not any one test's time budget.
  beforeAll(() => load(config), 60_000);
  beforeEach(() => {
    if (config.approval && !config.triage) withoutTriageLineage();
  });

  it("resolves every operation to a route file that exports its method", async () => {
    const { spec } = await load(config);
    const broken: string[] = [];
    for (const [path, item] of Object.entries(spec.paths)) {
      const server = item.servers?.[0]?.url ?? spec.servers[0]!.url;
      for (const method of METHODS.filter((name) => item[name])) {
        const file = `app${new URL(server).pathname.replace(/\/$/, "")}${path.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;
        const verb = method.toUpperCase();
        const exported = existsSync(file) && new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${verb}\\b|export\\s*\\{[^}]*\\b${verb}\\b`).test(readFileSync(file, "utf8"));
        if (!exported) broken.push(`${verb} ${server}${path} -> ${file}`);
      }
    }
    expect(broken, "the contract describes a URL this application does not serve").toEqual([]);
  });

  it("publishes /uploads/confirm, which an upload cannot be admitted without", async () => {
    const { spec } = await load(config);
    const confirm = operation(spec, "/uploads/confirm", "post");
    expect(confirm.operationId).toBe(config.approval ? "confirmApprovedUpload" : "confirmDirectUpload");
    const request = (confirm.requestBody as { content: { "application/json": { schema: Schema } } }).content["application/json"].schema;
    expect(request.required).toEqual(config.approval ? ["documentId", "sourceSha256", "attemptKey", "scopeDigest", "fileKey"] : ["documentId"]);
  });

  it("answers the capability 200 with exactly the keys the contract requires", async () => {
    const { spec, capability } = await load(config);
    const response = await capability(await capabilityRequest(config));
    const body = await response.json() as Json;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.code).toBe(config.triage ? "TRIAGE_OBJECT_READY" : "QUALIFIED");
    // The published source agent reads `uploadUrl` (public/developer/tavonel-source-agent.py).
    expect("uploadUrl" in body && !("url" in body)).toBe(true);
    expectContract(spec, operation(spec, "/uploads/capability", "post"), 200, body);
  });

  it("lists the capability refusals the handler answers, under the status it answers them with", async () => {
    const { spec, capability } = await load(config);
    const op = operation(spec, "/uploads/capability", "post");

    await expectListedRefusal(op, await capability(await capabilityRequest(config, { requestedBytes: FOUNDATION_INTAKE_MAX_BYTES + 1 })), "SOURCE_EXCEEDS_PROCESSING_CEILING", 413);

    m.gate.mockResolvedValueOnce(false);
    await expectListedRefusal(op, await capability(await capabilityRequest(config)), "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403);

    m.authorize.mockResolvedValueOnce({ ok: true, principal: { kind: "api-key", workspaceKey: WORKSPACE, userId: USER, scopes: [], accessSource: "trial" } });
    await expectListedRefusal(op, await capability(await capabilityRequest(config, { originalFilename: "bundle.zip", declaredMimeType: "application/zip" })), "TRIAL_ARCHIVE_NOT_INCLUDED", 402);

    if (config.approval) m.approvedReservation.mockResolvedValueOnce({ ok: false, code: "GPU_CREDITS_REQUIRED", status: 402 });
    else m.compute.mockResolvedValueOnce({ ok: false, code: "GPU_CREDITS_REQUIRED" });
    await expectListedRefusal(op, await capability(await capabilityRequest(config)), "GPU_CREDITS_REQUIRED", 402);

    const metadata = await capability(new Request("https://tavonel.test/api/v1/uploads/capability", { method: "POST", headers: { "content-type": "application/pdf" }, body: "%PDF" }));
    await expectListedRefusal(op, metadata, "METADATA_ONLY_ENDPOINT", 415);
  });

  it("answers the confirmation 200 with exactly the keys the contract requires", async () => {
    const { spec, confirm } = await load(config);
    const response = await confirm(confirmRequest(config));
    const body = await response.json() as Json;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.code).toBe("UPLOAD_CONFIRMED");
    expectContract(spec, operation(spec, "/uploads/confirm", "post"), 200, body);
  });

  it("lists the confirmation refusals the handler answers, under the status it answers them with", async () => {
    const { spec, confirm } = await load(config);
    const op = operation(spec, "/uploads/confirm", "post");

    await expectListedRefusal(op, await confirm(confirmRequest(config, { documentId: "not/a/document" })), "UPLOAD_CONFIRM_BODY_INVALID", 400);

    m.head.mockResolvedValueOnce({ ok: true, exists: false });
    await expectListedRefusal(op, await confirm(confirmRequest(config)), "QUARANTINE_OBJECT_NOT_FOUND", 409);

    m.gate.mockResolvedValueOnce(false);
    await expectListedRefusal(op, await confirm(confirmRequest(config)), "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403);

    if (config.approval) await expectListedRefusal(op, await confirm(confirmRequest(config, { attemptKey: undefined })), "INTAKE_APPROVAL_REQUIRED", 428);
  });
});

describe("the developer-key operations against their handlers", () => {
  beforeAll(() => load(CONFIGS[0]), 60_000);

  it("publishes key creation, rotation and the audit trail with the bodies the routes write", async () => {
    const { spec, createKey, rotateKey, auditEvents } = await load(CONFIGS[0]);
    const input = { name: "ci-ingest", scopes: ["documents:read"], expiresInDays: null };

    const created = await createKey(post("/api/developer/keys", input));
    expect(created.status).toBe(201);
    expectContract(spec, operation(spec, "/developer/keys", "post"), 201, await created.json() as Json);
    expect(spec.paths["/developer/keys"]!.servers).toEqual([{ url: "https://tavonel.com/api" }]);

    const rotated = await rotateKey(post("/api/v1/developer/keys/00000000-0000-4000-8000-000000000002/rotate", input), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000002" }),
    });
    expect(rotated.status).toBe(201);
    expectContract(spec, operation(spec, "/developer/keys/{id}/rotate", "post"), 201, await rotated.json() as Json);

    const audit = await auditEvents(new Request("https://tavonel.test/api/v1/developer/audit?limit=100", { headers: { authorization: "Bearer session" } }));
    expect(audit.status).toBe(200);
    expectContract(spec, operation(spec, "/developer/audit", "get"), 200, await audit.json() as Json);
  });

  it("lists the key-creation refusals the handler answers", async () => {
    const { spec, createKey } = await load(CONFIGS[0]);
    const op = operation(spec, "/developer/keys", "post");
    await expectListedRefusal(op, await createKey(post("/api/developer/keys", { name: "", scopes: [] })), "API_KEY_INPUT_INVALID", 400);
    m.session.mockResolvedValueOnce({ ok: true, principal: { workspaceKey: WORKSPACE, userId: USER, accessSource: "trial", authorizationRevision: 1 } });
    await expectListedRefusal(op, await createKey(post("/api/developer/keys", { name: "ci", scopes: ["documents:read"] })), "TRIAL_FEATURE_NOT_INCLUDED", 402);
  });
});

describe("the comparison itself", () => {
  beforeAll(() => load(CONFIGS[0]), 60_000);

  it("fails on the capability shape the audit found live (A14)", async () => {
    const { spec, capability } = await load(CONFIGS[0]);
    const body = await (await capability(await capabilityRequest(CONFIGS[0]))).json() as Json;
    // main's published 200 before G1, verbatim in substance.
    const before: Schema = { type: "object", required: ["documentId", "url", "method", "expiresAt"], properties: { documentId: {}, url: {}, method: {}, headers: {}, expiresAt: {}, objectKey: {} } };
    const problems = drift(spec, before, body, "capability");
    expect(problems).toEqual(expect.arrayContaining(["capability.url is required and absent", "capability.uploadUrl is written and unpublished"]));
  });
});
