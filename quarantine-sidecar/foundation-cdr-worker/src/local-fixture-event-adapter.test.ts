import assert from "node:assert/strict";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import { IDENTITY_BROKER, PRIVATE_CDR_ORIGIN } from "./identity";
import { handleQueue, type Env } from "./index";

/*
 * Fixture transport evidence, and nothing more.
 *
 * The app confirm route does not enqueue CDR, and local Seaweed storage emits no Cloudflare Queue
 * events. This file shows how an explicitly fixture-labelled post-confirm bridge could hand the same
 * `{ key }` queue body to the real exported `handleQueue`, and what the worker then does with it:
 * the real sanitizeObject, the real create-once R2 writes, the real HMAC-signed settlement.
 *
 * What it is not: it is not CDR sanitization (the CDR responder below returns fixed fixture bytes),
 * not Cloudflare event evidence (the bridge builds the message itself), not app intake confirmation
 * (the caller asserts the key was confirmed), and not OCR or Core qualification (OCR is unset).
 * The source exists only in the in-memory fixture R2, the provider is the existing synthetic
 * identity, the CDR host is a non-routable `.invalid` name, and every secret is a fixture string.
 * The bridge is test-only and wired into no route or worker.
 */

const FIXTURE_WORKSPACE = "ws_fixture_bridge";
const FIXTURE_DOCUMENT = "doc_fixture_0001";
const FIXTURE_SOURCE_KEY = `quarantine/${FIXTURE_WORKSPACE}/${FIXTURE_DOCUMENT}/source`;
const FIXTURE_CDR_URL = "https://tavonel-cdr-synthetic.fixture.invalid/v1/disarm";
const FIXTURE_CDR_HEALTH_URL = "https://tavonel-cdr-synthetic.fixture.invalid/health";
const FIXTURE_SETTLEMENT_URL = "http://127.0.0.1/api/internal/billing/settle";
/** The existing synthetic provider identity, not a qualified scanner. */
const FIXTURE_PROVIDER = "tavonel_pdf_raster";
const FIXTURE_BUCKET = "tavonel-saas-foundation-quarantine";
const FIXTURE_CDR_HMAC = "fixture-only-cdr-hmac-not-a-real-secret-000001";
const FIXTURE_SETTLEMENT_HMAC = "fixture-only-settlement-hmac-not-a-real-secret-01";
const FIXTURE_SOURCE_FILENAME = "fixture-source.pdf";
const FIXTURE_SOURCE_BYTES = new TextEncoder().encode("%PDF-1.4\n% fixture transport source, synthetic bytes\n%%EOF\n");
/** Fixture CDR output: fixed bytes, not the result of sanitizing anything. */
const FIXTURE_CDR_OUTPUT_BYTES = new TextEncoder().encode("%PDF-1.4\n% fixture CDR output, not a sanitization result\n%%EOF\n");
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

function sha256Header(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const FIXTURE_SOURCE_SHA256 = sha256Header(FIXTURE_SOURCE_BYTES);
const FIXTURE_OUTPUT_SHA256 = sha256Header(FIXTURE_CDR_OUTPUT_BYTES);
const FIXTURE_IMMUTABLE_KEY = `immutable/${FIXTURE_WORKSPACE}/${FIXTURE_WORKSPACE}/${FIXTURE_DOCUMENT}/${
  FIXTURE_OUTPUT_SHA256.slice("sha256:".length)}/sanitized.pdf`;
const FIXTURE_CDR_RECEIPT_KEY = FIXTURE_IMMUTABLE_KEY.replace(/sanitized\.pdf$/u, "cdr-receipt.json");
const FIXTURE_SETTLEMENT_EFFECT_KEY = `${FIXTURE_WORKSPACE}/${FIXTURE_DOCUMENT}/released`;
/** OCR is unset, so the worker releases the reservation; nothing here is an OCR charge. */
const EXPECTED_FIXTURE_SETTLEMENT = {
  workspaceKey: FIXTURE_WORKSPACE,
  documentId: FIXTURE_DOCUMENT,
  outcome: "released",
  actualCredits: 0,
  reasonCode: "GPU_NOT_DISPATCHED",
  sourceSha256: FIXTURE_SOURCE_SHA256,
};

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function fixtureSignatureMatches(
  secret: string,
  timestamp: string,
  requestId: string,
  digest: string,
  provided: string | null,
): boolean {
  if (!provided) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${requestId}.${digest}`).digest("base64url"));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isFreshIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && new Date(parsed).toISOString() === value
    && Math.abs(Date.now() - parsed) <= MAX_CLOCK_SKEW_MS;
}

type FixtureR2Entry = { bytes: Uint8Array; contentType?: string; customMetadata: Record<string, string> };
type FixtureR2Write = { key: string; result: "created" | "overwritten" | "precondition_failed" };

function copyBytes(value: ArrayBuffer | ArrayBufferView | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value).slice();
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

/**
 * In-memory fixture R2. Preserves bytes, contentType and customMetadata exactly, hands out copies,
 * and models R2's create-once put: with `onlyIf.etagDoesNotMatch === "*"` an existing key is left
 * untouched and the put resolves to null. One instance persists across every redelivery in a test.
 */
class FixtureR2Bucket implements R2Bucket {
  private readonly objects = new Map<string, FixtureR2Entry>();
  readonly writes: FixtureR2Write[] = [];
  readonly reads: string[] = [];

  /** Stands in for an upload the caller has already confirmed. Not a worker write. */
  placeConfirmedFixtureSource(key: string): void {
    this.objects.set(key, {
      bytes: FIXTURE_SOURCE_BYTES.slice(),
      contentType: "application/pdf",
      customMetadata: {
        filename: FIXTURE_SOURCE_FILENAME,
        declaredBytes: String(FIXTURE_SOURCE_BYTES.byteLength),
        fixture: "local-fixture-transport",
      },
    });
  }

  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  snapshot(key: string): FixtureR2Entry | null {
    const entry = this.objects.get(key);
    return entry ? { bytes: entry.bytes.slice(), contentType: entry.contentType, customMetadata: { ...entry.customMetadata } } : null;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    this.reads.push(key);
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
    if (condition !== undefined && condition !== "*") {
      throw new Error("fixture R2 only models onlyIf.etagDoesNotMatch \"*\"");
    }
    const existed = this.objects.has(key);
    if (existed && condition === "*") {
      this.writes.push({ key, result: "precondition_failed" });
      return null;
    }
    const bytes = copyBytes(value);
    this.objects.set(key, {
      bytes,
      contentType: options.httpMetadata?.contentType,
      customMetadata: { ...(options.customMetadata ?? {}) },
    });
    this.writes.push({ key, result: existed ? "overwritten" : "created" });
    return { key, size: bytes.byteLength, etag: createHash("md5").update(bytes).digest("hex") };
  }
}

class FixtureQueueMessage implements Message<{ key: string }> {
  ackCount = 0;
  readonly retries: Array<{ delaySeconds?: number }> = [];

  constructor(readonly body: { readonly key: string }, readonly attempts: number) {}

  ack(): void {
    this.ackCount += 1;
  }

  retry(options?: { delaySeconds?: number }): void {
    this.retries.push({ ...(options ?? {}) });
  }
}

type FixtureDelivery = { attempts: number; result: "ack" | "retry"; retryDelaySeconds: number | null };

const FIXTURE_CONFIRMED_SOURCE_KEY = /^quarantine\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/source$/u;

/**
 * TEST-ONLY local post-confirm bridge. Fixture transport, not a Cloudflare Queue.
 *
 * Takes a source key its caller says it has already confirmed, refuses anything that is not
 * `quarantine/{workspace}/{document}/source` before dispatch, and delivers `{ key }` to the real
 * `handleQueue` as a one-message batch. Redelivering the same key increments `attempts`, the way the
 * queue counts them from 1. Every delivery must end in exactly one ack or one retry.
 */
class LocalFixturePostConfirmQueueBridge {
  private readonly attemptsByKey = new Map<string, number>();
  readonly deliveries: FixtureDelivery[] = [];
  dispatched = 0;

  constructor(private readonly env: Env, private readonly fetcher: typeof fetch) {}

  async deliverConfirmedSource(confirmedSourceKey: string): Promise<FixtureDelivery> {
    if (typeof confirmedSourceKey !== "string" || !FIXTURE_CONFIRMED_SOURCE_KEY.test(confirmedSourceKey)) {
      throw new Error(`fixture bridge refuses a key outside quarantine/{workspace}/{document}/source: ${JSON.stringify(confirmedSourceKey)}`);
    }
    const attempts = (this.attemptsByKey.get(confirmedSourceKey) ?? 0) + 1;
    this.attemptsByKey.set(confirmedSourceKey, attempts);
    const message = new FixtureQueueMessage({ key: confirmedSourceKey }, attempts);
    const batch: MessageBatch<unknown> = { messages: [message] };
    this.dispatched += 1;
    await handleQueue(batch, this.env, this.fetcher);
    const decisions = message.ackCount + message.retries.length;
    if (decisions !== 1) throw new Error(`fixture queue message was decided ${decisions} times, expected exactly once`);
    const delivery: FixtureDelivery = message.ackCount === 1
      ? { attempts, result: "ack", retryDelaySeconds: null }
      : { attempts, result: "retry", retryDelaySeconds: message.retries[0].delaySeconds ?? null };
    this.deliveries.push(delivery);
    return delivery;
  }
}

type OutboundCall = {
  target: "cdr" | "settlement";
  status: number;
  requestId: string | null;
  effect?: "applied" | "already_applied" | "none";
};

function fixtureEnv(r2: FixtureR2Bucket, overrides: Partial<Env> = {}): Env {
  return {
    FOUNDATION_QUARANTINE: r2,
    TAVONEL_CDR_URL: FIXTURE_CDR_URL,
    TAVONEL_CDR_HEALTH_URL: FIXTURE_CDR_HEALTH_URL,
    TAVONEL_CDR_PROVIDER: FIXTURE_PROVIDER,
    FOUNDATION_R2_BUCKET: FIXTURE_BUCKET,
    TAVONEL_CDR_HMAC: FIXTURE_CDR_HMAC,
    FOUNDATION_OCR_URL: "",
    FOUNDATION_BILLING_SETTLEMENT_URL: FIXTURE_SETTLEMENT_URL,
    FOUNDATION_BILLING_SETTLEMENT_HMAC: FIXTURE_SETTLEMENT_HMAC,
    ...overrides,
  };
}

function createFixtureHarness(envOverrides: Partial<Env> = {}) {
  const r2 = new FixtureR2Bucket();
  const outbound: OutboundCall[] = [];
  const escapes: string[] = [];
  const violations: string[] = [];
  /** Statuses served before the default 200, one per call. */
  const cdrPlan: number[] = [];
  const settlementPlan: number[] = [];
  const cdrRequestIds: string[] = [];
  const settlementRequestIds: string[] = [];
  const settlementEffects = new Map<string, { body: string; facts: Record<string, unknown> }>();

  const expectFixture = (condition: unknown, message: string) => {
    if (!condition) {
      violations.push(message);
      throw new Error(`fixture responder rejected the request: ${message}`);
    }
  };

  /** Fixture CDR responder. Validates the worker's request independently; returns fixture CDR output. */
  const fixtureCdrResponder = async (init: RequestInit | undefined): Promise<Response> => {
    const call: OutboundCall = { target: "cdr", status: 0, requestId: null };
    outbound.push(call);
    const headers = new Headers(init?.headers);
    expectFixture(init?.method === "POST", "CDR method is POST");
    expectFixture(init?.redirect === "manual", "CDR request does not follow redirects");
    expectFixture(!headers.has("authorization"), "synthetic lane sends no identity token");
    expectFixture(init?.body instanceof FormData, "CDR body is multipart form data");
    const source = (init?.body as FormData).get("source");
    expectFixture(source instanceof File, "CDR form carries a source file");
    const file = source as File;
    expectFixture(file.name === FIXTURE_SOURCE_FILENAME, "CDR source filename is the fixture filename");
    expectFixture(file.type === "application/pdf", "CDR source MIME is application/pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());
    expectFixture(Buffer.from(bytes).equals(Buffer.from(FIXTURE_SOURCE_BYTES)), "CDR source bytes are the fixture source bytes");
    const digest = sha256Header(bytes);
    expectFixture(headers.get("x-tavonel-input-sha256") === digest, "CDR input digest matches the uploaded bytes");
    const timestamp = headers.get("x-tavonel-cdr-timestamp") ?? "";
    expectFixture(isFreshIsoTimestamp(timestamp), "CDR timestamp is a fresh ISO instant");
    const requestId = headers.get("x-tavonel-cdr-request-id") ?? "";
    expectFixture(REQUEST_ID_PATTERN.test(requestId), "CDR request id is well formed");
    expectFixture(!cdrRequestIds.includes(requestId), "CDR request id is not replayed");
    expectFixture(
      fixtureSignatureMatches(FIXTURE_CDR_HMAC, timestamp, requestId, digest, headers.get("x-tavonel-cdr-signature")),
      "CDR HMAC verifies over timestamp.requestId.digest",
    );
    call.requestId = requestId;
    cdrRequestIds.push(requestId);
    const planned = cdrPlan.shift();
    if (planned !== undefined) {
      call.status = planned;
      return Response.json({ detail: "fixture CDR unavailable" }, { status: planned });
    }
    call.status = 200;
    return new Response(FIXTURE_CDR_OUTPUT_BYTES.slice(), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "x-tavonel-cdr-status": "clean",
        "x-tavonel-input-sha256": digest,
        "x-tavonel-cdr-output-sha256": FIXTURE_OUTPUT_SHA256,
      },
    });
  };

  /** Local settlement responder. Idempotent per workspace+document+outcome, like the app's ledger. */
  const fixtureSettlementResponder = async (init: RequestInit | undefined): Promise<Response> => {
    const call: OutboundCall = { target: "settlement", status: 0, requestId: null, effect: "none" };
    outbound.push(call);
    const headers = new Headers(init?.headers);
    expectFixture(init?.method === "POST", "settlement method is POST");
    expectFixture(headers.get("content-type") === "application/json", "settlement body is JSON");
    expectFixture(typeof init?.body === "string", "settlement body is the exact signed string");
    const body = init?.body as string;
    const digest = sha256Header(Buffer.from(body, "utf8"));
    expectFixture(headers.get("x-tavonel-input-sha256") === digest, "settlement digest covers the exact body bytes");
    const timestamp = headers.get("x-tavonel-billing-timestamp") ?? "";
    expectFixture(isFreshIsoTimestamp(timestamp), "settlement timestamp is a fresh ISO instant");
    const requestId = headers.get("x-tavonel-billing-request-id") ?? "";
    expectFixture(REQUEST_ID_PATTERN.test(requestId), "settlement request id is well formed");
    expectFixture(!settlementRequestIds.includes(requestId), "settlement request id is not replayed");
    expectFixture(
      fixtureSignatureMatches(FIXTURE_SETTLEMENT_HMAC, timestamp, requestId, digest, headers.get("x-tavonel-billing-signature")),
      "settlement HMAC verifies over timestamp.requestId.digest",
    );
    call.requestId = requestId;
    settlementRequestIds.push(requestId);
    const planned = settlementPlan.shift();
    if (planned !== undefined) {
      // Unavailable before any effect: nothing is recorded for this request.
      call.status = planned;
      return Response.json({ code: "FIXTURE_SETTLEMENT_UNAVAILABLE" }, { status: planned });
    }
    const facts = JSON.parse(body) as Record<string, unknown>;
    expectFixture(typeof facts.workspaceKey === "string" && typeof facts.documentId === "string", "settlement names a document");
    expectFixture(["settled", "operator_review", "released"].includes(facts.outcome as string), "settlement outcome is known");
    const effectKey = `${facts.workspaceKey}/${facts.documentId}/${facts.outcome}`;
    const existing = settlementEffects.get(effectKey);
    if (existing && existing.body !== body) {
      call.status = 409;
      return Response.json({ code: "FIXTURE_SETTLEMENT_CONFLICT" }, { status: 409 });
    }
    call.status = 200;
    if (existing) {
      call.effect = "already_applied";
      return Response.json({ status: "already_applied" });
    }
    settlementEffects.set(effectKey, { body, facts });
    call.effect = "applied";
    return Response.json({ status: "applied" });
  };

  /** The only fetcher the worker receives. Two exact URLs; anything else is an escape. */
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url === FIXTURE_CDR_URL) return fixtureCdrResponder(init);
    if (url === FIXTURE_SETTLEMENT_URL) return fixtureSettlementResponder(init);
    escapes.push(url);
    throw new Error(`fixture transport refused an outbound request to ${url}`);
  }) as typeof fetch;

  const env = fixtureEnv(r2, envOverrides);
  const bridge = new LocalFixturePostConfirmQueueBridge(env, fetcher);
  return {
    r2, env, fetcher, bridge, outbound, escapes, violations, cdrPlan, settlementPlan, cdrRequestIds, settlementEffects,
    summary: () => outbound.map((call) => `${call.target}:${call.status}${call.effect ? `:${call.effect}` : ""}`),
  };
}

type FixtureHarness = ReturnType<typeof createFixtureHarness>;

function assertFixtureTransportOnly(h: FixtureHarness): void {
  assert.deepEqual(h.violations, [], "fixture responders saw no malformed request");
  assert.deepEqual(h.escapes, [], "no outbound request left the two fixture URLs");
}

/** Checks what the worker actually persisted, and returns the receipt bytes for later comparison. */
function assertPersistedFixtureCdrEvidence(h: FixtureHarness, cdrRequestId: string): Uint8Array {
  const pdf = h.r2.snapshot(FIXTURE_IMMUTABLE_KEY);
  assert.ok(pdf, "fixture CDR output was persisted");
  assert.ok(Buffer.from(pdf.bytes).equals(Buffer.from(FIXTURE_CDR_OUTPUT_BYTES)));
  assert.equal(pdf.contentType, "application/pdf");
  assert.deepEqual(pdf.customMetadata, { stage: "immutable-approved" });

  const receipt = h.r2.snapshot(FIXTURE_CDR_RECEIPT_KEY);
  assert.ok(receipt, "fixture CDR receipt was persisted");
  assert.equal(receipt.contentType, "application/json");
  assert.deepEqual(receipt.customMetadata, { stage: "processing-receipt" });
  const parsed = JSON.parse(new TextDecoder().decode(receipt.bytes)) as Record<string, unknown>;
  assert.equal(parsed.schemaVersion, "tavonel.cdr_receipt.v2");
  assert.equal(parsed.status, "clean");
  assert.equal(parsed.sourceKey, FIXTURE_SOURCE_KEY);
  assert.equal(parsed.immutableKey, FIXTURE_IMMUTABLE_KEY);
  assert.equal(parsed.inputSha256, FIXTURE_SOURCE_SHA256);
  assert.equal(parsed.outputSha256, FIXTURE_OUTPUT_SHA256);
  assert.equal(parsed.provider, FIXTURE_PROVIDER, "receipt names the synthetic fixture provider");
  assert.equal(parsed.requestId, cdrRequestId, "receipt is bound to the fixture CDR call that produced it");
  assert.equal(parsed.candidatePromotion, false);
  return receipt.bytes;
}

function assertSettledOnce(h: FixtureHarness): void {
  assert.deepEqual(
    [...h.settlementEffects.entries()].map(([key, effect]) => [key, effect.facts]),
    [[FIXTURE_SETTLEMENT_EFFECT_KEY, EXPECTED_FIXTURE_SETTLEMENT]],
  );
}

describe("local fixture event adapter -> real handleQueue (fixture transport only)", () => {
  const globalFetchEscapes: string[] = [];
  let realFetch: typeof fetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    globalFetchEscapes.length = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      globalFetchEscapes.push(requestUrl(input));
      throw new Error("fixture transport: global fetch is disabled");
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    assert.deepEqual(globalFetchEscapes, [], "nothing reached global fetch");
  });

  it("fixture transport: an event before the source exists retries without ack, then the same event succeeds once the fixture source is placed", async () => {
    const h = createFixtureHarness();

    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 1, result: "retry", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), []);
    assert.deepEqual(h.r2.keys(), []);
    assert.deepEqual(h.r2.writes, []);
    assert.equal(h.settlementEffects.size, 0);

    h.r2.placeConfirmedFixtureSource(FIXTURE_SOURCE_KEY);
    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 2, result: "ack", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), ["cdr:200", "settlement:200:applied"]);
    assert.deepEqual(h.r2.keys(), [FIXTURE_CDR_RECEIPT_KEY, FIXTURE_IMMUTABLE_KEY, FIXTURE_SOURCE_KEY]);
    assert.deepEqual(h.r2.writes, [
      { key: FIXTURE_IMMUTABLE_KEY, result: "created" },
      { key: FIXTURE_CDR_RECEIPT_KEY, result: "created" },
    ]);
    assertPersistedFixtureCdrEvidence(h, h.cdrRequestIds[0]);
    assertSettledOnce(h);
    assertFixtureTransportOnly(h);
  });

  it("fixture transport: a CDR 503 retries with nothing persisted or settled; redelivery persists and settles once; a duplicate event reuses it", async () => {
    const h = createFixtureHarness();
    h.r2.placeConfirmedFixtureSource(FIXTURE_SOURCE_KEY);
    h.cdrPlan.push(503);

    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 1, result: "retry", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), ["cdr:503"]);
    assert.deepEqual(h.r2.keys(), [FIXTURE_SOURCE_KEY], "no immutable PDF and no CDR receipt after a 503");
    assert.deepEqual(h.r2.writes, []);
    assert.equal(h.settlementEffects.size, 0);

    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 2, result: "ack", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), ["cdr:503", "cdr:200", "settlement:200:applied"]);
    const receiptBytes = assertPersistedFixtureCdrEvidence(h, h.cdrRequestIds[1]);
    assertSettledOnce(h);

    // A later duplicate of the already-acked event.
    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 3, result: "ack", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), ["cdr:503", "cdr:200", "settlement:200:applied", "settlement:200:already_applied"]);
    assert.equal(h.outbound.filter((call) => call.target === "cdr").length, 2, "no third CDR call");
    assert.deepEqual(h.r2.writes, [
      { key: FIXTURE_IMMUTABLE_KEY, result: "created" },
      { key: FIXTURE_CDR_RECEIPT_KEY, result: "created" },
    ], "the duplicate wrote nothing");
    assert.ok(Buffer.from(assertPersistedFixtureCdrEvidence(h, h.cdrRequestIds[1])).equals(Buffer.from(receiptBytes)));
    assertSettledOnce(h);
    assertFixtureTransportOnly(h);
  });

  it("fixture transport: a settlement 503 after persisted CDR evidence retries; redelivery reuses that evidence and settles exactly once", async () => {
    const h = createFixtureHarness();
    h.r2.placeConfirmedFixtureSource(FIXTURE_SOURCE_KEY);
    h.settlementPlan.push(503);

    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 1, result: "retry", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), ["cdr:200", "settlement:503:none"]);
    const receiptBytes = assertPersistedFixtureCdrEvidence(h, h.cdrRequestIds[0]);
    assert.equal(h.settlementEffects.size, 0, "a 503 records no settlement effect");

    assert.deepEqual(await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY),
      { attempts: 2, result: "ack", retryDelaySeconds: null });
    assert.deepEqual(h.summary(), ["cdr:200", "settlement:503:none", "settlement:200:applied"]);
    assert.deepEqual(h.cdrRequestIds.length, 1, "redelivery did not call CDR again");
    assert.deepEqual(h.r2.writes, [
      { key: FIXTURE_IMMUTABLE_KEY, result: "created" },
      { key: FIXTURE_CDR_RECEIPT_KEY, result: "created" },
    ], "redelivery reused the persisted evidence without writing");
    const reusedBytes = assertPersistedFixtureCdrEvidence(h, h.cdrRequestIds[0]);
    assert.ok(Buffer.from(reusedBytes).equals(Buffer.from(receiptBytes)), "the receipt is the one written on the first delivery");
    assertSettledOnce(h);
    assertFixtureTransportOnly(h);
  });

  it("fixture transport: the injected fetcher admits only the two exact fixture URLs and records every other attempt", async () => {
    const h = createFixtureHarness();
    const probes = [
      IDENTITY_BROKER,
      `${PRIVATE_CDR_ORIGIN}/v1/disarm`,
      "https://api.runpod.ai/v2/fixture-endpoint/runsync",
      "https://tavonel-saas-foundation.vercel.app/api/internal/billing/settle",
      "http://localhost/api/internal/billing/settle",
      `${FIXTURE_SETTLEMENT_URL}?replay=1`,
      FIXTURE_CDR_HEALTH_URL,
      `${FIXTURE_CDR_URL}/`,
    ];
    for (const probe of probes) {
      await assert.rejects(h.fetcher(probe, { method: "POST" }), /fixture transport refused/);
    }
    assert.deepEqual(h.escapes, probes);
    assert.deepEqual(h.outbound, [], "no probe reached a fixture responder");
  });

  it("fixture transport: a worker attempt to reach a non-allowlisted host is caught as an escape and the message is not acked", async () => {
    // Tripwire check only: a fixture OCR URL makes the worker try a host the fetcher does not allow.
    const ocrProbe = "https://foundation-ocr.fixture.invalid/v1/ocr";
    const h = createFixtureHarness({ FOUNDATION_OCR_URL: ocrProbe });
    h.r2.placeConfirmedFixtureSource(FIXTURE_SOURCE_KEY);

    const delivery = await h.bridge.deliverConfirmedSource(FIXTURE_SOURCE_KEY);
    assert.equal(delivery.result, "retry");
    assert.deepEqual(h.escapes, [ocrProbe], "the escape attempt was recorded, never delivered");
    assert.deepEqual(h.summary(), ["cdr:200"]);
    assert.equal(h.settlementEffects.size, 0);
    assert.deepEqual(h.violations, []);
  });

  it("fixture transport: the bridge refuses any key outside quarantine/{workspace}/{document}/source before dispatch", async () => {
    const h = createFixtureHarness();
    h.r2.placeConfirmedFixtureSource(FIXTURE_SOURCE_KEY);
    const refused = [
      "",
      ` ${FIXTURE_SOURCE_KEY}`,
      `${FIXTURE_SOURCE_KEY}/extra`,
      `quarantine/${FIXTURE_WORKSPACE}/source`,
      `quarantine/../${FIXTURE_DOCUMENT}/source`,
      `quarantine/${FIXTURE_WORKSPACE}/${FIXTURE_DOCUMENT}/cdr-reject.json`,
      FIXTURE_IMMUTABLE_KEY,
      `immutable/${FIXTURE_WORKSPACE}/${FIXTURE_DOCUMENT}/source`,
    ];
    for (const key of refused) {
      await assert.rejects(h.bridge.deliverConfirmedSource(key), /fixture bridge refuses/);
    }
    assert.equal(h.bridge.dispatched, 0, "handleQueue was never invoked");
    assert.deepEqual(h.bridge.deliveries, []);
    assert.deepEqual(h.r2.reads, []);
    assert.deepEqual(h.r2.writes, []);
    assert.deepEqual(h.outbound, []);
    assertFixtureTransportOnly(h);
  });

  it("fixture transport: fixture R2 preserves bytes and metadata and models create-once puts", async () => {
    const r2 = new FixtureR2Bucket();
    const key = `quarantine/${FIXTURE_WORKSPACE}/${FIXTURE_DOCUMENT}/fixture-probe.json`;
    const first = new TextEncoder().encode("{\"fixture\":1}\n");
    const options = { httpMetadata: { contentType: "application/json" }, customMetadata: { stage: "fixture" }, onlyIf: { etagDoesNotMatch: "*" } };

    assert.notEqual(await r2.put(key, first, options), null);
    assert.equal(await r2.put(key, new TextEncoder().encode("{\"fixture\":2}\n"), options), null, "create-once refuses the second put");
    assert.deepEqual(r2.writes, [{ key, result: "created" }, { key, result: "precondition_failed" }]);

    const object = await r2.get(key);
    assert.ok(object);
    assert.equal(object.size, first.byteLength);
    assert.deepEqual(object.httpMetadata, { contentType: "application/json" });
    assert.deepEqual(object.customMetadata, { stage: "fixture" });
    const read = new Uint8Array(await object.arrayBuffer());
    assert.ok(Buffer.from(read).equals(Buffer.from(first)));
    read[0] = 0;
    assert.ok(Buffer.from(new Uint8Array(await (await r2.get(key))!.arrayBuffer())).equals(Buffer.from(first)), "reads are copies");
    assert.deepEqual((await r2.list({ prefix: `quarantine/${FIXTURE_WORKSPACE}/` })).objects, [{ key }]);
    await assert.rejects(r2.put(key, first, { onlyIf: { etagDoesNotMatch: "\"some-etag\"" } }), /only models/);
  });

  it("fixture transport: the environment is a labelled fixture and carries no real target or secret", () => {
    const env = fixtureEnv(new FixtureR2Bucket());
    const cdrHost = new URL(env.TAVONEL_CDR_URL).hostname;
    assert.ok(cdrHost.endsWith(".invalid") && cdrHost.includes("tavonel-cdr-synthetic"), "CDR host is non-routable and synthetic");
    assert.equal(env.TAVONEL_CDR_PROVIDER, FIXTURE_PROVIDER);
    assert.equal(env.FOUNDATION_R2_BUCKET, FIXTURE_BUCKET);
    assert.equal(env.FOUNDATION_BILLING_SETTLEMENT_URL, "http://127.0.0.1/api/internal/billing/settle");
    assert.equal(env.FOUNDATION_OCR_URL, "");
    for (const unset of ["FOUNDATION_CDR_IDENTITY_HMAC", "TAVONEL_OCR_HMAC", "RUNPOD_API_KEY", "FOUNDATION_MANUAL_TRIGGER_TOKEN"] as const) {
      assert.equal(env[unset], undefined, `${unset} is not set`);
    }
    for (const secret of [env.TAVONEL_CDR_HMAC, env.FOUNDATION_BILLING_SETTLEMENT_HMAC]) {
      assert.ok(secret?.startsWith("fixture-only-") && secret.length >= 32, "HMACs are fixture-only strings of at least 32 bytes");
    }
    assert.match(new TextDecoder().decode(FIXTURE_CDR_OUTPUT_BYTES), /fixture CDR output, not a sanitization result/);
  });
});
