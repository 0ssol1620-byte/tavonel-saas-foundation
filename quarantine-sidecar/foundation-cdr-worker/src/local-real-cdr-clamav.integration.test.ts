import assert from "node:assert/strict";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { handleQueue, type Env } from "./index";

/*
 * Real CDR + real ClamAV behind the real queue handler. Opt-in, test-only.
 *
 * One bounded service boundary and nothing more: the exported `handleQueue`, the real
 * `sanitizeObject` with its retry/ack handling, the repository CDR image (`cdr-cloudrun`, PDFium
 * rasterizer) built from this checkout by `.github/workflows/malware-scan-qualification.yml` in
 * the same run (not a published or digest-pinned image; its local image ID is recorded), and the
 * clamd service container that workflow pins by digest. No CDR response, scanner verdict, OCR
 * result or Core result in this file is canned; the only test-owned responder is the loopback
 * settlement ledger.
 *
 * What it is not: the queue message is built here (not Cloudflare Queues), the source sits in an
 * in-memory test bucket (not R2 and not SeaweedFS source bytes), OCR is unset, settlement is a
 * loopback test responder (not the app ledger), and nothing passed through browser intake or Core.
 * It is no statement about production readiness.
 *
 * Network scope, adapter-level only: the worker under test gets a fetcher that admits two exact
 * loopback URLs and never follows a redirect, and global fetch is disabled for the suite. That
 * constrains this test's worker process, nothing else. The CDR container runs with
 * `--network host`, sharing the runner's network namespace; no container egress firewall is
 * applied or asserted here.
 *
 * Contract limitation, asserted rather than assumed: the worker does not persist the ClamAV verdict.
 * `tavonel.cdr_receipt.v2` carries no engine, signature version or verdict, and the reject receipt
 * carries the failure class but not the signature name. The verdict exists only in the CDR's
 * `x-tavonel-malware-scan` header / 422 body, which this test records in its evidence log.
 *
 * Skips unless FOUNDATION_REAL_CDR_CLAMAV_QUALIFICATION=1 AND the process is on a GitHub-hosted
 * Linux runner; setting the variable anywhere else still skips. Only in that one opted-in
 * environment does bad configuration (a missing or non-loopback CDR URL, a short CDR HMAC, or a
 * missing CDR image ID) fail rather than skip. The one exception is the loopback redirect-policy
 * test at the end of the file, which needs no CDR or clamd and runs ungated.
 */

const GATE = "FOUNDATION_REAL_CDR_CLAMAV_QUALIFICATION";

function skipReason(): string | false {
  if (process.env[GATE] !== "1") {
    return `opt-in only: ${GATE}=1 is set solely by .github/workflows/malware-scan-qualification.yml`;
  }
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
    return "runs only on the GitHub-hosted Linux job that starts the CDR image and the pinned clamd";
  }
  return false;
}

const SKIP = skipReason();
/** Captured before the suite disables global fetch; used only for the two admitted loopback URLs. */
const originalFetch = globalThis.fetch;
/**
 * The fetcher's URL gate sees only the first URL, so this transport never follows a redirect. The
 * worker's explicit `redirect: "manual"` on the CDR call is kept (the 3xx reaches the worker
 * unfollowed); every other mode, including the settlement call's unset one that native fetch
 * would treat as "follow", becomes "error".
 */
const loopbackFetch = (url: string, init?: RequestInit): Promise<Response> =>
  originalFetch(url, { ...init, redirect: init?.redirect === "manual" ? "manual" : "error" });

const SETTLEMENT_PATH = "/api/internal/billing/settle";
/** A label, not a deployed provider identity. It only enters the receipt binding. */
const QUALIFICATION_PROVIDER = "ci_loopback_pdfium_clamav_qualification";
const QUALIFICATION_BUCKET = "tavonel-saas-foundation-quarantine";
const SETTLEMENT_HMAC = "ci-only-settlement-hmac-loopback-responder-0001";
const WORKSPACE = "ws_ci_real_cdr";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RECORDED_CDR_HEADERS = [
  "content-type",
  "content-length",
  "cache-control",
  "retry-after",
  "x-tavonel-cdr-status",
  "x-tavonel-input-sha256",
  "x-tavonel-cdr-output-mime",
  "x-tavonel-cdr-output-sha256",
  "x-tavonel-malware-scan",
] as const;
/** Every field `sanitize.ts` writes into `tavonel.cdr_receipt.v2`. None of them is a scan verdict. */
const CDR_RECEIPT_FIELDS = [
  "candidatePromotion", "immutableKey", "inputSha256", "occurredAt", "outputSha256",
  "provider", "requestId", "schemaVersion", "sourceKey", "status", "targetSha256",
];
const REJECT_RECEIPT_FIELDS = [
  "declaredBytes", "observedBytes", "occurredAt", "provider", "reasonCode", "schemaVersion", "sourceKey",
];

function sha256Header(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Same object layout and xref arithmetic as `cdr-cloudrun/tests/cdr_fixtures.py`. ASCII only. */
function syntheticPdf(objects: string[]): Uint8Array {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  assert.ok(/^[\x00-\x7f]*$/u.test(pdf), "synthetic PDF is ASCII, so string offsets are byte offsets");
  return new TextEncoder().encode(pdf);
}

const CLEAN_TEXT = "(TAVONEL harmless synthetic worker-to-CDR qualification fixture)";

function cleanPdf(): Uint8Array {
  const content = `BT /F1 12 Tf 72 720 Td ${CLEAN_TEXT} Tj ET`;
  return syntheticPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]);
}

/**
 * The industry EICAR test pattern, inert by definition. Assembled at run time so this source file
 * never holds the contiguous 68 bytes a workstation scanner would quarantine.
 */
function eicarPattern(): string {
  const pattern = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-", "TEST-FILE!$H+H*"].join("");
  assert.equal(pattern.length, 68);
  return pattern;
}

/**
 * EICAR as an uncompressed embedded-file stream, the shape `test_malware_clamd.py` already proves
 * this pinned clamd detects. Trailing EICAR bytes are not detected, so that shape is not used.
 */
function eicarPdf(): Uint8Array {
  const eicar = eicarPattern();
  return syntheticPdf([
    "<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(eicar.txt) 6 0 R] >> >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
    "<< /Length 8 >>\nstream\n0 0 m S\nendstream",
    `<< /Type /EmbeddedFile /Length ${eicar.length} >>\nstream\n${eicar}\nendstream`,
    "<< /Type /Filespec /F (eicar.txt) /EF << /F 5 0 R >> >>",
  ]);
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function signatureMatches(secret: string, timestamp: string, requestId: string, digest: string, provided: string): boolean {
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${requestId}.${digest}`).digest("base64url"));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** The opted-in configuration. Anything but the exact loopback CDR endpoint is a failure. */
function loopbackCdrConfig(): { cdrUrl: string; cdrHmac: string; cdrImageId: string } {
  const raw = process.env.FOUNDATION_REAL_CDR_URL ?? "";
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/v1/disarm"
    || url.search || url.hash || url.username || url.password || url.href !== raw) {
    throw new Error(`FOUNDATION_REAL_CDR_URL must be exactly http://127.0.0.1:<port>/v1/disarm, got ${JSON.stringify(raw)}`);
  }
  const cdrHmac = process.env.FOUNDATION_REAL_CDR_HMAC ?? "";
  if (cdrHmac.trim().length < 32) throw new Error("FOUNDATION_REAL_CDR_HMAC must be the 32+ byte CI-only key the CDR container was started with");
  // The local ID of the image this run built from the checkout. Recorded, not a published pin.
  const cdrImageId = process.env.FOUNDATION_REAL_CDR_IMAGE_ID ?? "";
  if (!DIGEST_PATTERN.test(cdrImageId)) {
    throw new Error(`FOUNDATION_REAL_CDR_IMAGE_ID must be the sha256 image ID docker resolved for the CDR image, got ${JSON.stringify(cdrImageId)}`);
  }
  return { cdrUrl: url.href, cdrHmac, cdrImageId };
}

/** Listens on an ephemeral 127.0.0.1 port and returns it. */
async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

type StoredObject = { bytes: Uint8Array; contentType?: string; customMetadata: Record<string, string> };
type BucketWrite = { key: string; result: "created" | "overwritten" | "precondition_failed" };

function copyBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

/** In-memory test bucket with R2's create-once put. Not R2, not SeaweedFS. */
class QualificationBucket implements R2Bucket {
  private readonly objects = new Map<string, StoredObject>();
  readonly writes: BucketWrite[] = [];

  placeSource(key: string, bytes: Uint8Array, filename: string): void {
    this.objects.set(key, {
      bytes: bytes.slice(),
      contentType: "application/pdf",
      customMetadata: { filename, declaredBytes: String(bytes.byteLength), qualification: "real-cdr-clamav-loopback" },
    });
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  snapshot(key: string): StoredObject | null {
    const entry = this.objects.get(key);
    return entry ? { bytes: entry.bytes.slice(), contentType: entry.contentType, customMetadata: { ...entry.customMetadata } } : null;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.objects.get(key);
    if (!entry) return null;
    const bytes = entry.bytes.slice();
    return {
      size: bytes.byteLength,
      httpMetadata: entry.contentType === undefined ? {} : { contentType: entry.contentType },
      customMetadata: { ...entry.customMetadata },
      arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
    };
  }

  async list(options: { prefix?: string } = {}): Promise<{ objects: Array<{ key: string }> }> {
    const prefix = options.prefix ?? "";
    return { objects: this.keys().filter((key) => key.startsWith(prefix)).map((key) => ({ key })) };
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string, options: R2PutOptions = {}): Promise<unknown> {
    const condition = options.onlyIf?.etagDoesNotMatch;
    if (condition !== undefined && condition !== "*") throw new Error("qualification bucket only models onlyIf.etagDoesNotMatch \"*\"");
    const existed = this.objects.has(key);
    if (existed && condition === "*") {
      this.writes.push({ key, result: "precondition_failed" });
      return null;
    }
    const bytes = copyBytes(value);
    this.objects.set(key, { bytes, contentType: options.httpMetadata?.contentType, customMetadata: { ...(options.customMetadata ?? {}) } });
    this.writes.push({ key, result: existed ? "overwritten" : "created" });
    return { key, size: bytes.byteLength };
  }
}

class QualificationQueueMessage implements Message<{ key: string }> {
  acks = 0;
  readonly retries: Array<{ delaySeconds?: number }> = [];

  constructor(readonly body: { readonly key: string }, readonly attempts: number) {}

  ack(): void {
    this.acks += 1;
  }

  retry(options?: { delaySeconds?: number }): void {
    this.retries.push({ ...(options ?? {}) });
  }
}

type SettlementCall = { status: number; requestId: string; effect: "applied" | "already_applied" | "none" };

/** Owned loopback settlement ledger: verifies the worker's HMAC, idempotent per document+outcome. */
async function startSettlementResponder() {
  const plan: number[] = [];
  const calls: SettlementCall[] = [];
  const violations: string[] = [];
  const effects = new Map<string, { body: string; facts: Record<string, unknown> }>();
  const seenRequestIds = new Set<string>();

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const reply = (status: number, body: Record<string, unknown>) => {
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
    };
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const body = Buffer.concat(chunks).toString("utf8");
    const header = (name: string) => {
      const value = request.headers[name];
      return typeof value === "string" ? value : "";
    };
    const call: SettlementCall = { status: 0, requestId: header("x-tavonel-billing-request-id"), effect: "none" };
    calls.push(call);
    const refuse = (reason: string) => {
      violations.push(reason);
      call.status = 400;
      reply(400, { code: "QUALIFICATION_REQUEST_REJECTED" });
    };
    if (request.method !== "POST" || request.url !== SETTLEMENT_PATH) return refuse("settlement is POST to the exact path");
    if (header("content-type") !== "application/json") return refuse("settlement body is JSON");
    const digest = sha256Header(Buffer.from(body, "utf8"));
    if (header("x-tavonel-input-sha256") !== digest) return refuse("settlement digest covers the exact body");
    const timestamp = header("x-tavonel-billing-timestamp");
    const parsedAt = Date.parse(timestamp);
    if (!Number.isFinite(parsedAt) || new Date(parsedAt).toISOString() !== timestamp || Math.abs(Date.now() - parsedAt) > 5 * 60_000) {
      return refuse("settlement timestamp is a fresh ISO instant");
    }
    if (!REQUEST_ID_PATTERN.test(call.requestId) || seenRequestIds.has(call.requestId)) return refuse("settlement request id is fresh");
    if (!signatureMatches(SETTLEMENT_HMAC, timestamp, call.requestId, digest, header("x-tavonel-billing-signature"))) {
      return refuse("settlement HMAC verifies");
    }
    seenRequestIds.add(call.requestId);
    const planned = plan.shift();
    if (planned !== undefined) {
      call.status = planned;
      return reply(planned, { code: "QUALIFICATION_SETTLEMENT_UNAVAILABLE" });
    }
    const facts = JSON.parse(body) as Record<string, unknown>;
    const effectKey = `${String(facts.workspaceKey)}/${String(facts.documentId)}/${String(facts.outcome)}`;
    const existing = effects.get(effectKey);
    if (existing && existing.body !== body) {
      call.status = 409;
      return reply(409, { code: "QUALIFICATION_SETTLEMENT_CONFLICT" });
    }
    call.status = 200;
    if (existing) {
      call.effect = "already_applied";
      return reply(200, { status: "already_applied" });
    }
    effects.set(effectKey, { body, facts });
    call.effect = "applied";
    return reply(200, { status: "applied" });
  };

  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      violations.push("settlement responder failed");
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}${SETTLEMENT_PATH}`,
    plan, calls, violations, effects,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

type CdrCall = {
  requestId: string | null;
  inputSha256: string | null;
  source: { name: string; type: string; size: number } | null;
  status: number;
  headers: Record<string, string>;
  body: string | null;
  error: string | null;
};

async function createHarness(documentId: string) {
  const { cdrUrl, cdrHmac, cdrImageId } = loopbackCdrConfig();
  const settlement = await startSettlementResponder();
  const bucket = new QualificationBucket();
  const sourceKey = `quarantine/${WORKSPACE}/${documentId}/source`;
  const cdrCalls: CdrCall[] = [];
  const pendingBodies: Array<Promise<void>> = [];
  const escapes: string[] = [];
  const deliveries: Array<{ attempts: number; result: "ack" | "retry" }> = [];

  /** The real CDR, observed but not altered: the worker receives the response object it returned. */
  const observeCdr = async (url: string, init: RequestInit | undefined): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const body = init?.body;
    const form = body instanceof FormData ? body.get("source") : null;
    const call: CdrCall = {
      requestId: headers.get("x-tavonel-cdr-request-id"),
      inputSha256: headers.get("x-tavonel-input-sha256"),
      source: form instanceof File ? { name: form.name, type: form.type, size: form.size } : null,
      status: 0,
      headers: {},
      body: null,
      error: null,
    };
    cdrCalls.push(call);
    let response: Response;
    try {
      response = await loopbackFetch(url, init);
    } catch (error) {
      call.error = error instanceof Error ? error.message : "CDR request failed";
      throw error;
    }
    call.status = response.status;
    for (const name of RECORDED_CDR_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) call.headers[name] = value;
    }
    if (response.status !== 200) {
      pendingBodies.push(response.clone().text().then((text) => { call.body = text.slice(0, 4096); }));
    }
    return response;
  };

  /** The only fetcher the worker receives. Two exact loopback URLs; anything else is an escape. */
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url === cdrUrl) return observeCdr(url, init);
    if (url === settlement.url) return loopbackFetch(url, init);
    escapes.push(url);
    throw new Error(`real-CDR qualification refused an outbound request to ${url}`);
  }) as typeof fetch;

  const env: Env = {
    FOUNDATION_QUARANTINE: bucket,
    TAVONEL_CDR_URL: cdrUrl,
    // Never fetched by handleQueue; the fetcher would refuse it.
    TAVONEL_CDR_HEALTH_URL: cdrUrl.replace(/\/v1\/disarm$/u, "/health"),
    TAVONEL_CDR_PROVIDER: QUALIFICATION_PROVIDER,
    FOUNDATION_R2_BUCKET: QUALIFICATION_BUCKET,
    TAVONEL_CDR_HMAC: cdrHmac,
    FOUNDATION_OCR_URL: "",
    FOUNDATION_BILLING_SETTLEMENT_URL: settlement.url,
    FOUNDATION_BILLING_SETTLEMENT_HMAC: SETTLEMENT_HMAC,
  };

  /** One-message batch to the real handleQueue; every delivery ends in exactly one ack or retry. */
  const deliver = async (attempts: number): Promise<"ack" | "retry"> => {
    const message = new QualificationQueueMessage({ key: sourceKey }, attempts);
    await handleQueue({ messages: [message] }, env, fetcher);
    await Promise.all(pendingBodies.splice(0));
    assert.equal(message.acks + message.retries.length, 1, "the message was decided exactly once");
    const result = message.acks === 1 ? "ack" : "retry";
    if (result === "retry") assert.deepEqual(message.retries, [{}], "a plain retry, not the OCR cold-start delay");
    deliveries.push({ attempts, result });
    return result;
  };

  const assertLoopbackOnly = () => {
    assert.deepEqual(escapes, [], "no outbound request left the two admitted loopback URLs");
    assert.deepEqual(settlement.violations, [], "the settlement responder saw no malformed request");
  };

  const evidence = (label: string, extra: Record<string, unknown> = {}) => {
    console.log(`REAL_CDR_CLAMAV_EVIDENCE ${JSON.stringify({
      case: label,
      scope: "handleQueue -> sanitizeObject -> repository CDR image on 127.0.0.1 -> pinned clamd service container",
      notClaimed: [
        "browser intake",
        "SeaweedFS source bytes",
        "Cloudflare Queues: the queue event is built by this test",
        "R2: source and outputs are in an in-memory test bucket",
        "app billing ledger: settlement is a loopback responder owned by this test",
        "OCR",
        "Core",
        "a published or digest-pinned CDR image",
        "container egress isolation",
        "production readiness",
      ],
      limitation: "the worker persists no ClamAV verdict; it is visible only in the CDR response recorded below",
      networkScope: "adapter-level: the worker's injected fetcher admits two exact loopback URLs and follows no redirect, and global "
        + "fetch is disabled; the CDR container shares the runner host network and no container egress firewall is enforced",
      cdrImage: {
        reference: process.env.GITHUB_SHA ? `tavonel-cdr:${process.env.GITHUB_SHA}` : "unrecorded",
        localImageId: cdrImageId,
        provenance: "built from this checkout by this workflow run; not a published or digest-pinned image",
      },
      clamavImage: process.env.CLAMAV_IMAGE_RESOLVED ?? "unrecorded",
      workflowRun: process.env.GITHUB_RUN_ID ?? "unrecorded",
      deliveries,
      cdrCalls,
      settlementCalls: settlement.calls,
      bucketWrites: bucket.writes,
      ...extra,
    }, null, 2)}`);
  };

  return { env, bucket, sourceKey, fetcher, settlement, cdrCalls, escapes, deliver, assertLoopbackOnly, evidence, cdrUrl };
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

describe("real handleQueue -> real CDR service -> pinned ClamAV (loopback qualification)", { skip: SKIP }, () => {
  const globalFetchEscapes: string[] = [];
  let realFetch: typeof fetch | undefined;

  before(() => {
    // Fail, do not skip, once opted in with a wrong target. Throwing here leaves fetch untouched.
    loopbackCdrConfig();
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      globalFetchEscapes.push(requestUrl(input));
      throw new Error("real-CDR qualification: global fetch is disabled");
    }) as typeof fetch;
  });

  after(() => {
    // Restore only what before() replaced; never assign undefined.
    if (realFetch !== undefined) globalThis.fetch = realFetch;
    assert.deepEqual(globalFetchEscapes, [], "nothing reached global fetch");
  });

  it("clean PDF: retries until the source exists and until settlement accepts, then acks once on real CDR output", async () => {
    const h = await createHarness("doc_real_cdr_clean_0001");
    try {
      const source = cleanPdf();
      const sourceSha256 = sha256Header(source);

      // Attempt 1: the source is not readable yet. Retry, no CDR call, nothing written.
      assert.equal(await h.deliver(1), "retry");
      assert.equal(h.cdrCalls.length, 0);
      assert.deepEqual(h.bucket.writes, []);
      assert.equal(h.settlement.calls.length, 0);

      // Attempt 2: real CDR and clamd answer; the ledger is unavailable, so the message retries.
      h.bucket.placeSource(h.sourceKey, source, "qualification-clean.pdf");
      h.settlement.plan.push(503);
      assert.equal(await h.deliver(2), "retry");
      assert.equal(h.cdrCalls.length, 1);
      const cdr = h.cdrCalls[0];
      assert.equal(cdr.error, null);
      assert.equal(cdr.status, 200, JSON.stringify(cdr));
      assert.ok(cdr.requestId && REQUEST_ID_PATTERN.test(cdr.requestId));
      assert.equal(cdr.inputSha256, sourceSha256);
      assert.deepEqual(cdr.source, { name: "qualification-clean.pdf", type: "application/pdf", size: source.byteLength });
      assert.equal(cdr.headers["x-tavonel-cdr-status"], "clean");
      assert.equal(cdr.headers["x-tavonel-input-sha256"], sourceSha256);
      assert.equal(cdr.headers["x-tavonel-cdr-output-mime"], "application/pdf");
      assert.match(cdr.headers["content-type"] ?? "", /^application\/pdf/u);
      assert.equal(cdr.headers["cache-control"], "no-store");
      const outputSha256 = cdr.headers["x-tavonel-cdr-output-sha256"] ?? "";
      assert.match(outputSha256, DIGEST_PATTERN);

      // The scan binding the real service returned: clean, from ClamAV, over exactly these bytes.
      const scan = JSON.parse(cdr.headers["x-tavonel-malware-scan"] ?? "null") as Record<string, unknown>;
      assert.equal(scan.verdict, "clean");
      assert.equal(scan.engine, "clamav");
      assert.match(String(scan.signatureVersion), /^ClamAV /u);
      assert.equal(scan.scannedSha256, sourceSha256);
      assert.ok(Number.isInteger(scan.durationMs) && (scan.durationMs as number) >= 0);

      // What the worker persisted is the real rasterized output, bound to that call.
      const immutableKey = `immutable/${WORKSPACE}/${WORKSPACE}/doc_real_cdr_clean_0001/${outputSha256.slice("sha256:".length)}/sanitized.pdf`;
      const receiptKey = immutableKey.replace(/sanitized\.pdf$/u, "cdr-receipt.json");
      const expectedWrites = [{ key: immutableKey, result: "created" }, { key: receiptKey, result: "created" }];
      assert.deepEqual(h.bucket.writes, expectedWrites);
      const pdf = h.bucket.snapshot(immutableKey);
      assert.ok(pdf);
      assert.equal(sha256Header(pdf.bytes), outputSha256);
      assert.equal(String(pdf.bytes.byteLength), cdr.headers["content-length"]);
      assert.equal(pdf.contentType, "application/pdf");
      assert.deepEqual(pdf.customMetadata, { stage: "immutable-approved" });
      const pdfText = Buffer.from(pdf.bytes).toString("latin1");
      assert.ok(pdfText.startsWith("%PDF-"), "output is a PDF");
      assert.notEqual(outputSha256, sourceSha256, "output is not the source echoed back");
      assert.ok(!pdfText.includes(CLEAN_TEXT), "the source text object did not survive rasterization");

      const receiptBytes = h.bucket.snapshot(receiptKey)?.bytes;
      assert.ok(receiptBytes);
      const receipt = parseJson(receiptBytes);
      assert.deepEqual(Object.keys(receipt).sort(), CDR_RECEIPT_FIELDS,
        "the CDR receipt has no malware-scan field: the ClamAV verdict is not persisted by the worker");
      assert.equal(receipt.schemaVersion, "tavonel.cdr_receipt.v2");
      assert.equal(receipt.status, "clean");
      assert.equal(receipt.sourceKey, h.sourceKey);
      assert.equal(receipt.immutableKey, immutableKey);
      assert.equal(receipt.inputSha256, sourceSha256);
      assert.equal(receipt.outputSha256, outputSha256);
      assert.equal(receipt.provider, QUALIFICATION_PROVIDER);
      assert.equal(receipt.targetSha256, sha256Header(JSON.stringify([QUALIFICATION_BUCKET, QUALIFICATION_PROVIDER, h.cdrUrl])));
      assert.equal(receipt.requestId, cdr.requestId);
      assert.equal(receipt.candidatePromotion, false);
      assert.deepEqual(h.settlement.calls.map((call) => [call.status, call.effect]), [[503, "none"]]);
      assert.equal(h.settlement.effects.size, 0);

      // Attempt 3: reuse the persisted evidence, no second CDR call, settle once.
      assert.equal(await h.deliver(3), "ack");
      assert.equal(h.cdrCalls.length, 1, "redelivery did not call the CDR again");
      assert.deepEqual(h.bucket.writes, expectedWrites, "redelivery wrote nothing");
      assert.deepEqual(h.settlement.calls.map((call) => [call.status, call.effect]), [[503, "none"], [200, "applied"]]);

      // Attempt 4: a duplicate of the acked event is idempotent end to end.
      assert.equal(await h.deliver(4), "ack");
      assert.equal(h.cdrCalls.length, 1);
      assert.deepEqual(h.bucket.writes, expectedWrites);
      assert.ok(Buffer.from(h.bucket.snapshot(receiptKey)!.bytes).equals(Buffer.from(receiptBytes)));
      assert.deepEqual(h.settlement.calls.map((call) => [call.status, call.effect]),
        [[503, "none"], [200, "applied"], [200, "already_applied"]]);
      assert.deepEqual([...h.settlement.effects.entries()].map(([key, effect]) => [key, effect.facts]), [[
        `${WORKSPACE}/doc_real_cdr_clean_0001/released`,
        // OCR is unset, so the worker releases the reservation; nothing here is an OCR result.
        { workspaceKey: WORKSPACE, documentId: "doc_real_cdr_clean_0001", outcome: "released", actualCredits: 0,
          reasonCode: "GPU_NOT_DISPATCHED", sourceSha256 },
      ]]);
      assert.deepEqual(h.bucket.keys(), [receiptKey, immutableKey, h.sourceKey].sort());
      h.assertLoopbackOnly();
      h.evidence("clean", { sourceSha256, outputSha256, persistedReceipt: receipt });
    } finally {
      await h.settlement.close();
    }
  });

  it("EICAR PDF: the real scanner refuses it, the worker records a create-once refusal and settles it idempotently", async () => {
    const documentId = "doc_real_cdr_eicar_0001";
    const h = await createHarness(documentId);
    try {
      const source = eicarPdf();
      const sourceSha256 = sha256Header(source);
      h.bucket.placeSource(h.sourceKey, source, "qualification-eicar.pdf");
      const rejectKey = `quarantine/${WORKSPACE}/${documentId}/cdr-reject.json`;

      assert.equal(await h.deliver(1), "ack");
      assert.equal(h.cdrCalls.length, 1);
      const first = h.cdrCalls[0];
      assert.equal(first.status, 422, JSON.stringify(first));
      assert.equal(first.inputSha256, sourceSha256);
      assert.equal(first.headers["cache-control"], "no-store");
      for (const absent of ["x-tavonel-cdr-status", "x-tavonel-cdr-output-sha256", "x-tavonel-malware-scan"]) {
        assert.equal(first.headers[absent], undefined, `${absent} is absent on a refusal`);
      }
      const detail = (JSON.parse(first.body ?? "null") as { detail?: Record<string, unknown> }).detail ?? {};
      assert.equal(detail.code, "MALWARE_DETECTED");
      assert.match(String(detail.signature).toLowerCase(), /eicar/u);
      assert.equal(detail.scannedSha256, sourceSha256);

      // No immutable output exists for a refused source; the refusal is the only write.
      assert.deepEqual(h.bucket.writes, [{ key: rejectKey, result: "created" }]);
      assert.ok(h.bucket.keys().every((key) => !key.startsWith("immutable/")));
      const rejectBytes = h.bucket.snapshot(rejectKey)?.bytes;
      assert.ok(rejectBytes);
      const reject = parseJson(rejectBytes);
      assert.deepEqual(Object.keys(reject).sort(), REJECT_RECEIPT_FIELDS,
        "the reject receipt records the class, not the scanner signature or engine");
      assert.equal(reject.schemaVersion, "tavonel.cdr_reject_receipt.v1");
      assert.equal(reject.sourceKey, h.sourceKey);
      assert.equal(reject.reasonCode, "MALWARE_QUARANTINED");
      assert.equal(reject.observedBytes, source.byteLength);
      assert.equal(reject.declaredBytes, source.byteLength);
      assert.equal(reject.provider, QUALIFICATION_PROVIDER);
      // "synthetic CDR" in terminalReason is the worker's unchanged legacy prefix for any CDR
      // refusal. The 422 asserted above came from the real CDR service and the pinned clamd.
      const expectedFacts = {
        workspaceKey: WORKSPACE, documentId, outcome: "released", actualCredits: 0, reasonCode: "CDR_PERMANENT_REJECT",
        terminalReason: "synthetic CDR rejected the source (422): MALWARE_DETECTED", failureClass: "MALWARE_QUARANTINED",
      };
      assert.deepEqual([...h.settlement.effects.values()].map((effect) => effect.facts), [expectedFacts]);

      // Redelivery: a refused source has no reusable output, so the real scanner is asked again
      // and refuses again; the receipt is not rewritten and the settlement is already applied.
      assert.equal(await h.deliver(2), "ack");
      assert.equal(h.cdrCalls.length, 2);
      assert.equal(h.cdrCalls[1].status, 422);
      assert.notEqual(h.cdrCalls[1].requestId, first.requestId);
      assert.deepEqual(h.bucket.writes, [{ key: rejectKey, result: "created" }, { key: rejectKey, result: "precondition_failed" }]);
      assert.ok(Buffer.from(h.bucket.snapshot(rejectKey)!.bytes).equals(Buffer.from(rejectBytes)));
      assert.deepEqual(h.settlement.calls.map((call) => [call.status, call.effect]), [[200, "applied"], [200, "already_applied"]]);
      assert.deepEqual([...h.settlement.effects.values()].map((effect) => effect.facts), [expectedFacts]);
      h.assertLoopbackOnly();
      h.evidence("eicar", {
        sourceSha256,
        persistedRejectReceipt: reject,
        refusal: {
          returnedBy: "the real CDR service (repository image) after the pinned clamd scan; no synthetic CDR answered",
          httpStatus: first.status,
          code: detail.code,
          signature: detail.signature,
          scannedSha256: detail.scannedSha256,
          terminalReasonWording: "the 'synthetic CDR rejected the source' prefix is the worker's unchanged legacy message, "
            + "not a description of the service that refused",
        },
      });
    } finally {
      await h.settlement.close();
    }
  });

  it("the injected fetcher admits only the loopback CDR endpoint and the owned settlement responder", async () => {
    const h = await createHarness("doc_real_cdr_probe_0001");
    try {
      const cdr = new URL(h.cdrUrl);
      const probes = [
        `${cdr.origin}/health`,
        `${h.cdrUrl}/`,
        `${h.cdrUrl}?replay=1`,
        `http://localhost:${cdr.port}/v1/disarm`,
        `${h.settlement.url}?replay=1`,
        "http://127.0.0.1/api/internal/billing/settle",
        "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle",
        "https://tavonel-saas-foundation.vercel.app/api/internal/cdr/identity",
        "https://api.runpod.ai/v2/qualification/runsync",
      ];
      for (const probe of probes) {
        await assert.rejects(h.fetcher(probe, { method: "POST" }), /refused an outbound request/u);
      }
      assert.deepEqual(h.escapes, probes);
      assert.deepEqual(h.cdrCalls, []);
      assert.deepEqual(h.settlement.calls, []);
    } finally {
      await h.settlement.close();
    }
  });
});

/*
 * Ungated: a pure transport-policy check that needs no CDR image, clamd or opt-in, so it runs on
 * any host. Both servers are owned by this test and bound to 127.0.0.1; nothing leaves loopback.
 */
describe("loopback qualification transport (ungated)", () => {
  it("the loopback transport never follows a redirect past the fetcher's exact-URL gate", async () => {
    // The trap counts any request that arrives; the redirector only ever answers 307 to the trap.
    const trapHits: string[] = [];
    const trap = createServer((request, response) => {
      trapHits.push(request.url ?? "");
      response.writeHead(200);
      response.end();
    });
    const redirector = createServer((request, response) => {
      request.resume();
      response.writeHead(307, { location: `http://127.0.0.1:${(trap.address() as AddressInfo).port}/escaped`, "cache-control": "no-store" });
      response.end();
    });
    try {
      await listenOnLoopback(trap);
      const redirectUrl = `http://127.0.0.1:${await listenOnLoopback(redirector)}${SETTLEMENT_PATH}`;
      // Unset mode, as on the settlement call, and an explicit "follow" both become "error".
      await assert.rejects(loopbackFetch(redirectUrl, { method: "POST", body: "{}" }), TypeError);
      await assert.rejects(loopbackFetch(redirectUrl, { method: "POST", body: "{}", redirect: "follow" }), TypeError);
      // The worker's explicit "manual" on the CDR call is kept: the 3xx comes back unfollowed.
      const manual = await loopbackFetch(redirectUrl, { method: "POST", body: "{}", redirect: "manual" });
      assert.equal(manual.status, 307);
      await manual.body?.cancel();
      assert.deepEqual(trapHits, [], "no redirect target was reached");
    } finally {
      await closeServer(redirector);
      await closeServer(trap);
    }
  });
});
