import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsumerVerificationPanel from "@/components/consumer-verification-panel";
import {
  askEndpoint,
  checkVerificationRequest,
  createVerificationController,
  describeVerificationState,
  parseAskSuccess,
  readVerificationResponse,
  refusalSentence,
  VERIFICATION_DEADLINE_MS,
  type VerificationResponse,
  type VerificationState,
} from "./consumer-verification";

/*
  Local, mocked evidence only. The fixtures restate the shapes lib/grounded-ask.ts builds and the
  Ask route wraps; the fetch is an injected fake. Nothing here exercises live authentication, a
  real World snapshot, the semantic truth of an answer, or the MCP bridge or CLI.
*/

const COLLECTION = `collection-${"a".repeat(32)}`;
const OTHER_COLLECTION = `collection-${"d".repeat(32)}`;
const MANIFEST = `sha256:${"b".repeat(64)}`;
const OTHER_MANIFEST = `sha256:${"e".repeat(64)}`;
const OUTPUT = `sha256:${"c".repeat(64)}`;
const KEY = "tvnl_live_k3y_secret-material-0001";
const QUESTION = "What are the payment terms?";
const INPUT = { apiKey: KEY, collectionId: COLLECTION, question: QUESTION };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

const activeWorld = () => ({ worldStateId: "world-7", manifestDigest: MANIFEST, revision: 7 });

function compiledGrounded(): Body {
  return {
    code: "GROUNDED_ANSWER",
    retrievalPath: "compiled-retrieval-v1",
    answerMode: "evidence_excerpts",
    activeWorld: activeWorld(),
    freshness: { state: "current" },
    status: "grounded",
    answer: "Payment is due net 30 days.\n\nLate fees accrue monthly.",
    reason: null,
    citations: [
      {
        evidenceId: "ev-1", evidenceIds: ["ev-1", "ev-2"], unitId: "unit-1", sourceVersionId: "sv-1",
        pageNumber1: 2, bbox1000: [10, 20, 500, 400], authority: "contract", claimIds: [], entityIds: [],
        excerpt: "Payment is due net 30 days.", retrieval: { lexicalRank: 1 },
      },
      {
        evidenceId: "ev-3", evidenceIds: ["ev-3"], unitId: "unit-2", sourceVersionId: "sv-2",
        pageNumber1: null, bbox1000: null, authority: "contract", claimIds: [], entityIds: [],
        excerpt: "Late fees accrue monthly.", retrieval: { denseRank: 2 },
      },
    ],
    receipt: { collectionId: COLLECTION, manifestDigest: MANIFEST, retrieval: "production", candidatePromotion: false, outputSha256: OUTPUT },
    contextPacket: { items: [{ text: "internal packet text" }] },
    retrieval: { compileRunId: "run-1", gateRejections: 0 },
    injected: "<script>alert(1)</script>",
  };
}

function fallbackGrounded(): Body {
  return {
    code: "GROUNDED_ANSWER",
    retrievalPath: "excerpt-concatenation-fallback",
    retrievalNotice: "No compiled retrieval index exists yet.",
    retrievalIndex: { status: "missing" },
    answerMode: "evidence_excerpts",
    activeWorld: activeWorld(),
    freshness: { state: "current" },
    status: "grounded",
    answer: "Payment is due net 30 days.",
    reason: null,
    citations: [{
      evidenceId: "ev-9", sourceId: "src-1", sourceVersionId: "sv-1", pageNumber1: 1, bbox1000: [0, 0, 1000, 1000],
      authority: "contract", relevance: 0.9, claimIds: [], entityIds: [], authorityTier: "controlled",
      relevanceBreakdown: { lexical: 1, graph: 0, temporal: 0, authority: 0.7 }, excerpt: "Payment is due net 30 days.",
    }],
    receipt: { collectionId: COLLECTION, manifestDigest: MANIFEST, retrieval: "adaptive-multilingual-region-v2", candidatePromotion: false, outputSha256: OUTPUT },
  };
}

function fallbackAbstained(): Body {
  return { ...fallbackGrounded(), code: "ANSWER_ABSTAINED", status: "abstained", answer: "", reason: "NO_REGION_BOUND_EVIDENCE_MATCH", citations: [] };
}

function compiledOverflow(): Body {
  return { ...compiledGrounded(), code: "ANSWER_ABSTAINED", status: "abstained", answer: "", reason: "EVIDENCE_EXCEEDS_ANSWER_LIMIT" };
}

function reply(status: number, body: unknown): VerificationResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, text: async () => text };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(implementation: (url: string, init: RequestInit) => Promise<VerificationResponse>) {
  const states: VerificationState[] = [];
  const fetchMock = vi.fn(implementation);
  const controller = createVerificationController({ fetch: fetchMock, onState: (state) => { states.push(state); } });
  return { states, fetchMock, controller, signal: (call = 0) => fetchMock.mock.calls[call]![1].signal! };
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("consumer verification", () => {
  it("consumer verification: refuses input outside the route's grammar before any request is made", async () => {
    const cases: Array<[Partial<typeof INPUT>, string]> = [
      [{ collectionId: `collection-${"A".repeat(32)}` }, "COLLECTION_ID_INVALID"],
      [{ collectionId: ` ${COLLECTION}` }, "COLLECTION_ID_INVALID"],
      [{ collectionId: `${COLLECTION}/../status` }, "COLLECTION_ID_INVALID"],
      [{ apiKey: "" }, "API_KEY_MISSING"],
      [{ apiKey: "   " }, "API_KEY_MISSING"],
      [{ apiKey: `${KEY}\n` }, "API_KEY_INVALID"],
      [{ apiKey: "tvnl_live_a\u0000b" }, "API_KEY_INVALID"],
      [{ apiKey: "eyJhbGciOiJIUzI1NiJ9.session.jwt" }, "API_KEY_NOT_SCOPED_KEY"],
      [{ question: "  a \n " }, "QUESTION_LENGTH"],
      [{ question: "x".repeat(501) }, "QUESTION_LENGTH"],
      [{ question: "\u0001".repeat(500) }, "QUESTION_TOO_LARGE"],
    ];
    for (const [change, code] of cases) {
      const { states, fetchMock, controller } = harness(async () => reply(200, compiledGrounded()));
      await controller.submit({ ...INPUT, ...change });
      expect(fetchMock, code).not.toHaveBeenCalled();
      expect(states, code).toEqual([{ kind: "refused", refusal: { code, serverCode: null, status: null } }]);
      expect(JSON.stringify(states)).not.toContain(KEY);
    }
    expect(checkVerificationRequest({ ...INPUT, question: "x".repeat(500) }).ok).toBe(true);
  });

  it("consumer verification: sends exactly one same-origin, credential-free POST to the existing Ask route", async () => {
    const { states, fetchMock, controller, signal } = harness(async () => reply(200, compiledGrounded()));
    await controller.submit(INPUT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v1/collections/${COLLECTION}/ask`);
    expect(askEndpoint(COLLECTION)).toBe(url);
    expect(url).not.toContain("status");
    expect(init).toMatchObject({
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error", mode: "same-origin", referrerPolicy: "no-referrer",
    });
    expect(init.headers).toEqual({ authorization: `Bearer ${KEY}`, "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ question: QUESTION });
    expect(signal().aborted).toBe(true);
    expect(states.map((state) => state.kind)).toEqual(["pending", "evidence"]);
    expect(controller.busy).toBe(false);
  });

  it("consumer verification: keeps only whitelisted fields of a compiled grounded answer", () => {
    const parsed = parseAskSuccess(compiledGrounded(), COLLECTION);
    expect(parsed).toEqual({
      ok: true,
      receipt: {
        outcome: "evidence",
        code: "GROUNDED_ANSWER",
        retrievalPath: "compiled-retrieval-v1",
        answerMode: "evidence_excerpts",
        answer: "Payment is due net 30 days.\n\nLate fees accrue monthly.",
        abstentionReason: null,
        citations: [
          { evidenceId: "ev-1", sourceId: null, sourceVersionId: "sv-1", unitId: "unit-1", pageNumber1: 2, bbox1000: [10, 20, 500, 400], excerpt: "Payment is due net 30 days." },
          { evidenceId: "ev-3", sourceId: null, sourceVersionId: "sv-2", unitId: "unit-2", pageNumber1: null, bbox1000: null, excerpt: "Late fees accrue monthly." },
        ],
        activeWorld: { worldStateId: "world-7", manifestDigest: MANIFEST, revision: 7 },
        receipt: { collectionId: COLLECTION, manifestDigest: MANIFEST, outputSha256: OUTPUT },
      },
    });
    const serialized = JSON.stringify(parsed);
    for (const dropped of ["internal packet text", "<script>", "run-1", "production", "lexicalRank", "freshness", KEY, QUESTION]) {
      expect(serialized, dropped).not.toContain(dropped);
    }
  });

  it("consumer verification: reads an excerpt-fallback grounded answer with its source, page and region", () => {
    const parsed = parseAskSuccess(fallbackGrounded(), COLLECTION);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.receipt.retrievalPath).toBe("excerpt-concatenation-fallback");
    expect(parsed.receipt.citations).toEqual([
      { evidenceId: "ev-9", sourceId: "src-1", sourceVersionId: "sv-1", unitId: null, pageNumber1: 1, bbox1000: [0, 0, 1000, 1000], excerpt: "Payment is due net 30 days." },
    ]);
    expect(JSON.stringify(parsed)).not.toContain("No compiled retrieval index exists yet.");
  });

  it("consumer verification: an HTTP 200 abstention is an answer without supporting evidence, not a success", async () => {
    const plain = await readVerificationResponse(reply(200, fallbackAbstained()), COLLECTION);
    expect(plain.kind).toBe("abstained");
    if (plain.kind !== "abstained") return;
    expect(plain.receipt).toMatchObject({ answer: "", citations: [], abstentionReason: "NO_REGION_BOUND_EVIDENCE_MATCH", code: "ANSWER_ABSTAINED" });
    expect(describeVerificationState(plain)).toContain("without supporting evidence");
    expect(describeVerificationState(plain)).not.toMatch(/connected|success/i);

    const overflow = await readVerificationResponse(reply(200, compiledOverflow()), COLLECTION);
    expect(overflow.kind).toBe("abstained");
    if (overflow.kind !== "abstained") return;
    expect(overflow.receipt.citations).toHaveLength(2);
    expect(overflow.receipt.abstentionReason).toBe("EVIDENCE_EXCEEDS_ANSWER_LIMIT");

    const other = await readVerificationResponse(reply(200, { ...compiledGrounded(), code: "ANSWER_ABSTAINED", status: "abstained", answer: "", reason: "PACKET_EMPTY_FOR_SCOPE", citations: [] }), COLLECTION);
    expect(other.kind === "abstained" && other.receipt.abstentionReason).toBe("OTHER");
    expect(JSON.stringify(other)).not.toContain("PACKET_EMPTY_FOR_SCOPE");
  });

  it("consumer verification: fails closed on every malformed binding, enum, identifier, region and envelope", () => {
    const cases: Array<{ name: string; body: () => Body; mutate: (body: Body) => void; code: string }> = [
      { name: "unknown code", body: compiledGrounded, mutate: (b) => { b.code = "OK"; }, code: "MALFORMED_SUCCESS" },
      { name: "code contradicts status", body: compiledGrounded, mutate: (b) => { b.status = "abstained"; }, code: "MALFORMED_SUCCESS" },
      { name: "grounded with no citations", body: compiledGrounded, mutate: (b) => { b.citations = []; }, code: "MALFORMED_SUCCESS" },
      { name: "grounded with blank answer", body: compiledGrounded, mutate: (b) => { b.answer = "  \n\n "; }, code: "MALFORMED_SUCCESS" },
      { name: "grounded with a reason", body: compiledGrounded, mutate: (b) => { b.reason = "SOMETHING"; }, code: "MALFORMED_SUCCESS" },
      { name: "generated answer mode", body: compiledGrounded, mutate: (b) => { b.answerMode = "generated"; }, code: "MALFORMED_SUCCESS" },
      { name: "unknown retrieval path", body: compiledGrounded, mutate: (b) => { b.retrievalPath = "compiled-retrieval-v2"; }, code: "MALFORMED_SUCCESS" },
      { name: "citations not an array", body: compiledGrounded, mutate: (b) => { b.citations = { 0: b.citations[0] }; }, code: "MALFORMED_SUCCESS" },
      { name: "receipt for another collection", body: compiledGrounded, mutate: (b) => { b.receipt.collectionId = OTHER_COLLECTION; }, code: "COLLECTION_MISMATCH" },
      { name: "receipt digest is not the active World's", body: compiledGrounded, mutate: (b) => { b.receipt.manifestDigest = OTHER_MANIFEST; }, code: "MANIFEST_MISMATCH" },
      { name: "missing active World", body: compiledGrounded, mutate: (b) => { delete b.activeWorld; }, code: "MALFORMED_SUCCESS" },
      { name: "bad worldStateId", body: compiledGrounded, mutate: (b) => { b.activeWorld.worldStateId = "-world"; }, code: "MALFORMED_SUCCESS" },
      { name: "bad active digest", body: compiledGrounded, mutate: (b) => { b.activeWorld.manifestDigest = "sha256:XYZ"; }, code: "MALFORMED_SUCCESS" },
      { name: "fractional revision", body: compiledGrounded, mutate: (b) => { b.activeWorld.revision = 1.5; }, code: "MALFORMED_SUCCESS" },
      { name: "short output digest", body: compiledGrounded, mutate: (b) => { b.receipt.outputSha256 = "sha256:abc"; }, code: "MALFORMED_SUCCESS" },
      { name: "candidate promotion", body: compiledGrounded, mutate: (b) => { b.receipt.candidatePromotion = true; }, code: "MALFORMED_SUCCESS" },
      { name: "cited id is not the unit's first evidence id", body: compiledGrounded, mutate: (b) => { b.citations[0].evidenceIds = ["ev-2"]; }, code: "MALFORMED_SUCCESS" },
      { name: "empty evidence id", body: compiledGrounded, mutate: (b) => { b.citations[0].evidenceId = ""; b.citations[0].evidenceIds = [""]; }, code: "MALFORMED_SUCCESS" },
      { name: "inverted region", body: compiledGrounded, mutate: (b) => { b.citations[0].bbox1000 = [500, 20, 10, 400]; }, code: "MALFORMED_SUCCESS" },
      { name: "region past 1000", body: compiledGrounded, mutate: (b) => { b.citations[0].bbox1000 = [0, 0, 1001, 10]; }, code: "MALFORMED_SUCCESS" },
      { name: "fractional region", body: compiledGrounded, mutate: (b) => { b.citations[0].bbox1000 = [0.5, 0, 10, 10]; }, code: "MALFORMED_SUCCESS" },
      { name: "page zero", body: compiledGrounded, mutate: (b) => { b.citations[0].pageNumber1 = 0; }, code: "MALFORMED_SUCCESS" },
      { name: "blank excerpt", body: compiledGrounded, mutate: (b) => { b.citations[0].excerpt = "   "; }, code: "MALFORMED_SUCCESS" },
      { name: "excerpt past preview length", body: compiledGrounded, mutate: (b) => { b.citations[0].excerpt = "x".repeat(421); }, code: "MALFORMED_SUCCESS" },
      { name: "answer past compiled envelope", body: compiledGrounded, mutate: (b) => { b.answer = "x".repeat(4219); }, code: "MALFORMED_SUCCESS" },
      { name: "fallback citation without source", body: fallbackGrounded, mutate: (b) => { delete b.citations[0].sourceId; }, code: "MALFORMED_SUCCESS" },
      { name: "fallback citation without page", body: fallbackGrounded, mutate: (b) => { b.citations[0].pageNumber1 = null; }, code: "MALFORMED_SUCCESS" },
      { name: "fallback receipt names another retrieval", body: fallbackGrounded, mutate: (b) => { b.receipt.retrieval = "production"; }, code: "MALFORMED_SUCCESS" },
      { name: "answer past fallback envelope", body: fallbackGrounded, mutate: (b) => { b.answer = "x".repeat(1265); }, code: "MALFORMED_SUCCESS" },
      { name: "abstention carrying prose", body: fallbackAbstained, mutate: (b) => { b.answer = "Payment is due net 30 days."; }, code: "MALFORMED_SUCCESS" },
      { name: "abstention without a reason", body: fallbackAbstained, mutate: (b) => { b.reason = null; }, code: "MALFORMED_SUCCESS" },
      { name: "abstention keeping citations without overflow", body: compiledOverflow, mutate: (b) => { b.reason = "NO_REGION_BOUND_EVIDENCE_MATCH"; }, code: "MALFORMED_SUCCESS" },
    ];
    for (const { name, body, mutate, code } of cases) {
      const value = body();
      mutate(value);
      expect(parseAskSuccess(value, COLLECTION), name).toEqual({ ok: false, code });
    }
    for (const value of [null, [], "GROUNDED_ANSWER", 1]) {
      expect(parseAskSuccess(value, COLLECTION)).toEqual({ ok: false, code: "MALFORMED_SUCCESS" });
    }
    // The same valid body, asked for another collection, is never evidence.
    expect(parseAskSuccess(compiledGrounded(), OTHER_COLLECTION)).toEqual({ ok: false, code: "COLLECTION_MISMATCH" });
  });

  it("consumer verification: error statuses become stable local refusals that never reflect the body or key", async () => {
    const cases: Array<[number, unknown, { code: string; serverCode: string | null; status: number | null }]> = [
      [401, { code: "AUTH_REQUIRED" }, { code: "AUTHENTICATION_REFUSED", serverCode: "AUTH_REQUIRED", status: 401 }],
      [403, { code: "API_SCOPE_REQUIRED" }, { code: "ACCESS_REFUSED", serverCode: "API_SCOPE_REQUIRED", status: 403 }],
      [409, { code: "ACTIVE_WORLD_NOT_FOUND" }, { code: "CONFLICT", serverCode: "ACTIVE_WORLD_NOT_FOUND", status: 409 }],
      [409, { code: "ACTIVE_WORLD_CHANGED_RETRY" }, { code: "CONFLICT", serverCode: "ACTIVE_WORLD_CHANGED_RETRY", status: 409 }],
      [429, { code: "API_RATE_LIMITED" }, { code: "RATE_LIMITED", serverCode: "API_RATE_LIMITED", status: 429 }],
      [503, { code: "RETRIEVAL_RUNTIME_UNAVAILABLE" }, { code: "SERVICE_UNAVAILABLE", serverCode: "RETRIEVAL_RUNTIME_UNAVAILABLE", status: 503 }],
      [403, { code: KEY, detail: QUESTION }, { code: "ACCESS_REFUSED", serverCode: null, status: 403 }],
      [401, { code: "__proto__" }, { code: "AUTHENTICATION_REFUSED", serverCode: null, status: 401 }],
      [500, `<html>stack ${KEY}</html>`, { code: "SERVICE_UNAVAILABLE", serverCode: null, status: 500 }],
      [302, {}, { code: "UNEXPECTED_STATUS", serverCode: null, status: 302 }],
    ];
    for (const [status, body, refusal] of cases) {
      const { states, controller } = harness(async () => reply(status, body));
      const outcome = await controller.submit(INPUT);
      expect(outcome, String(status)).toEqual({ kind: "refused", refusal });
      expect(JSON.stringify(states)).not.toContain(KEY);
      expect(JSON.stringify(states)).not.toContain(QUESTION);
      expect(describeVerificationState(outcome!)).not.toContain(KEY);
    }
  });

  it("consumer verification: an unknown 402 or 403 never claims key authentication succeeded", async () => {
    // An edge or proxy can refuse before the key is ever looked at, so the status alone proves nothing about the key.
    const bodies: unknown[] = [
      { code: "EDGE_FORBIDDEN", error: `key ${KEY} accepted`, apiKey: KEY },
      { error: "The key was accepted.", detail: QUESTION },
      `<html><body>403 Forbidden: key ${KEY} accepted</body></html>`,
      "",
    ];
    for (const status of [402, 403]) {
      for (const body of bodies) {
        const state = await readVerificationResponse(reply(status, body), COLLECTION);
        expect(state, `${status}`).toEqual({ kind: "refused", refusal: { code: "ACCESS_REFUSED", serverCode: null, status } });
        if (state.kind !== "refused") continue;
        const sentence = refusalSentence(state.refusal);
        expect(sentence).toBe(describeVerificationState(state));
        expect(sentence).toMatch(/refused/i);
        expect(sentence).not.toMatch(/\baccepted\b|was authenticated|authentication (succeeded|passed)|key is valid/i);
        for (const reflected of [KEY, QUESTION, "EDGE_FORBIDDEN", "Forbidden", "<html"]) {
          expect(sentence, reflected).not.toContain(reflected);
          expect(JSON.stringify(state), reflected).not.toContain(reflected);
        }
      }
    }
    // A code the route really returns keeps its own explanation.
    const scoped = await readVerificationResponse(reply(403, { code: "API_SCOPE_REQUIRED", error: KEY }), COLLECTION);
    expect(scoped).toEqual({ kind: "refused", refusal: { code: "ACCESS_REFUSED", serverCode: "API_SCOPE_REQUIRED", status: 403 } });
    if (scoped.kind === "refused") expect(refusalSentence(scoped.refusal)).toBe("The key does not hold the ask:read scope.");
  });

  it("consumer verification: blank opaque citation identities cannot be called evidence", () => {
    const blanks = [" ", "   ", " 　"];
    const cases: Array<{ name: string; body: () => Body; mutate: (body: Body, blank: string) => void }> = [
      // evidenceIds[0] moves with evidenceId, so only the blankness can refuse the body, not the first-id binding.
      { name: "compiled evidenceId", body: compiledGrounded, mutate: (b, blank) => { b.citations[0].evidenceId = blank; b.citations[0].evidenceIds = [blank, "ev-2"]; } },
      { name: "compiled later evidenceIds entry", body: compiledGrounded, mutate: (b, blank) => { b.citations[0].evidenceIds = ["ev-1", blank]; } },
      { name: "compiled sourceVersionId", body: compiledGrounded, mutate: (b, blank) => { b.citations[1].sourceVersionId = blank; } },
      { name: "compiled unitId", body: compiledGrounded, mutate: (b, blank) => { b.citations[1].unitId = blank; } },
      { name: "fallback evidenceId", body: fallbackGrounded, mutate: (b, blank) => { b.citations[0].evidenceId = blank; } },
      { name: "fallback sourceVersionId", body: fallbackGrounded, mutate: (b, blank) => { b.citations[0].sourceVersionId = blank; } },
      { name: "fallback sourceId", body: fallbackGrounded, mutate: (b, blank) => { b.citations[0].sourceId = blank; } },
    ];
    for (const { name, body, mutate } of cases) {
      for (const blank of blanks) {
        const value = body();
        mutate(value, blank);
        expect(parseAskSuccess(value, COLLECTION), `${name} ${JSON.stringify(blank)}`).toEqual({ ok: false, code: "MALFORMED_SUCCESS" });
      }
    }

    // Non-blank opaque ids are kept byte for byte: no trim, no normalization, no grammar.
    const compiled = compiledGrounded();
    Object.assign(compiled.citations[0], { evidenceId: " ev 1 ", evidenceIds: [" ev 1 ", "ev-2"], unitId: "unit 1 ", sourceVersionId: " sv 1" });
    const compiledParsed = parseAskSuccess(compiled, COLLECTION);
    expect(compiledParsed.ok).toBe(true);
    if (compiledParsed.ok) {
      expect(compiledParsed.receipt.citations[0]).toMatchObject({ evidenceId: " ev 1 ", unitId: "unit 1 ", sourceVersionId: " sv 1" });
    }
    const fallback = fallbackGrounded();
    Object.assign(fallback.citations[0], { evidenceId: "ev 9", sourceId: " src 1", sourceVersionId: "sv 1 " });
    const fallbackParsed = parseAskSuccess(fallback, COLLECTION);
    expect(fallbackParsed.ok).toBe(true);
    if (fallbackParsed.ok) {
      expect(fallbackParsed.receipt.citations[0]).toMatchObject({ evidenceId: "ev 9", sourceId: " src 1", sourceVersionId: "sv 1 " });
    }
  });

  it("consumer verification: network failure, unreadable body, non-JSON 200 and an alien 200 are refused", async () => {
    const cases: Array<[() => Promise<VerificationResponse>, string, number | null]> = [
      [async () => { throw new TypeError("Failed to fetch"); }, "NETWORK_FAILURE", null],
      [async () => ({ status: 200, text: async () => { throw new Error("stream broke"); } }), "NETWORK_FAILURE", null],
      [async () => reply(200, "<!doctype html>"), "RESPONSE_NOT_JSON", 200],
      [async () => reply(200, { code: "GROUNDED_ANSWER" }), "MALFORMED_SUCCESS", 200],
    ];
    for (const [implementation, code, status] of cases) {
      const { states, controller } = harness(implementation);
      await controller.submit(INPUT);
      expect(states.at(-1), code).toEqual({ kind: "refused", refusal: { code, serverCode: null, status } });
    }
  });

  it("consumer verification: the 20-second deadline aborts, clears its timer and publishes once even if fetch ignores abort", async () => {
    vi.useFakeTimers();
    const { states, controller, signal, fetchMock } = harness(() => new Promise<VerificationResponse>(() => {}));
    void controller.submit(INPUT);
    expect(states).toEqual([{ kind: "pending" }]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(VERIFICATION_DEADLINE_MS - 1);
    expect(states).toEqual([{ kind: "pending" }]);
    vi.advanceTimersByTime(1);
    expect(states.at(-1)).toEqual({ kind: "refused", refusal: { code: "DEADLINE_EXCEEDED", serverCode: null, status: null } });
    expect(signal().aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.busy).toBe(false);

    // A fetch that does honour the abort rejects afterwards; that rejection publishes nothing.
    const honouring = deferred<VerificationResponse>();
    fetchMock.mockImplementationOnce(() => honouring.promise);
    const second = controller.submit(INPUT);
    vi.advanceTimersByTime(VERIFICATION_DEADLINE_MS);
    honouring.reject(new DOMException("aborted", "AbortError"));
    expect(await second).toBeNull();
    await flush();
    expect(states.map((state) => state.kind)).toEqual(["pending", "refused", "pending", "refused"]);
  });

  it("consumer verification: an out-of-order old response can never publish over a newer input", async () => {
    const first = deferred<VerificationResponse>();
    const second = deferred<VerificationResponse>();
    const { states, controller, fetchMock, signal } = harness(() => first.promise);
    fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);

    const old = controller.submit(INPUT);
    controller.invalidate(); // the customer edited the question
    expect(signal(0).aborted).toBe(true);
    const fresh = controller.submit({ ...INPUT, question: "When are late fees charged?" });
    second.resolve(reply(200, fallbackAbstained()));
    expect(await fresh).toMatchObject({ kind: "abstained" });
    first.resolve(reply(200, compiledGrounded())); // the fake fetch ignored its abort
    expect(await old).toBeNull();
    await flush();
    expect(states.map((state) => state.kind)).toEqual(["pending", "idle", "pending", "abstained"]);

    // An edit with no new request: the old answer still never appears.
    const late = deferred<VerificationResponse>();
    const alone = harness(() => late.promise);
    const pending = alone.controller.submit(INPUT);
    alone.controller.invalidate();
    late.resolve(reply(200, compiledGrounded()));
    expect(await pending).toBeNull();
    expect(alone.states.map((state) => state.kind)).toEqual(["pending", "idle"]);
  });

  it("consumer verification: an explicit cancel aborts, clears the deadline and ignores the late answer", async () => {
    vi.useFakeTimers();
    const late = deferred<VerificationResponse>();
    const { states, controller, signal } = harness(() => late.promise);
    const running = controller.submit(INPUT);
    expect(vi.getTimerCount()).toBe(1);
    controller.cancel();
    expect(signal().aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(states.at(-1)).toEqual({ kind: "refused", refusal: { code: "CANCELLED", serverCode: null, status: null } });
    late.resolve(reply(200, compiledGrounded()));
    expect(await running).toBeNull();
    controller.cancel(); // nothing in flight: no second refusal
    expect(states.map((state) => state.kind)).toEqual(["pending", "refused"]);
  });

  it("consumer verification: dispose abandons the request and publishes nothing afterwards", async () => {
    vi.useFakeTimers();
    const late = deferred<VerificationResponse>();
    const { states, controller, signal, fetchMock } = harness(() => late.promise);
    const running = controller.submit(INPUT);
    controller.dispose();
    expect(signal().aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    late.resolve(reply(200, compiledGrounded()));
    expect(await running).toBeNull();
    controller.invalidate();
    controller.cancel();
    expect(await controller.submit(INPUT)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(states).toEqual([{ kind: "pending" }]);
  });

  it("consumer verification: a second submit while one request is pending sends nothing", async () => {
    const late = deferred<VerificationResponse>();
    const { states, controller, fetchMock } = harness(() => late.promise);
    const running = controller.submit(INPUT);
    expect(controller.busy).toBe(true);
    expect(await controller.submit(INPUT)).toBeNull();
    expect(await controller.submit({ ...INPUT, question: "Another question?" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    late.resolve(reply(200, compiledGrounded()));
    expect(await running).toMatchObject({ kind: "evidence" });
    expect(controller.busy).toBe(false);
    expect(states.map((state) => state.kind)).toEqual(["pending", "evidence"]);
  });

  it("consumer verification: the panel renders an empty password field, one explicit submit and no parity claim", () => {
    const html = renderToStaticMarkup(createElement(ConsumerVerificationPanel));
    expect(html).toContain('type="password"');
    expect(html).toContain('id="consumer-verify-key"');
    expect(html).toContain('for="consumer-verify-key"');
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).toContain('role="status"');
    expect(html).toContain('type="submit"');
    expect(html).toContain("Send one Ask request");
    expect(html).toContain("/api/v1/collections/{id}/ask");
    expect(html).toContain("does not test the MCP bridge or the");
    expect(html).not.toContain("tvnl_live_");
    expect(html).not.toContain("/api/v1/status");
    expect(html).not.toContain("/api/status");
    expect(html).not.toMatch(/connected|all three/i);
  });
});
