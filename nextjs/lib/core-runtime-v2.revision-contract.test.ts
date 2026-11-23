import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJsonWireField } from "./canonical-json-wire";
import type { CollectionOcrInput } from "./collection-compiler";
import {
  dispatchProductCoreV2,
  dispatchProductCoreV2Revision,
  projectProductCoreV2Candidate,
  readRevisionCompileSnapshot,
  revisionFullCompileOutcome,
  type ProductCoreV2CompileRequest,
  type ProductCoreV2CompileResponse,
} from "./core-runtime-v2";

/*
  WO-E-INC-1: the revision-compile wire contract, pinned to the Core release.

  `__fixtures__/core-v2-revision/exchanges.json` is every request the real Foundation builder sent
  and every byte Core answered, captured on loopback from a local staging of AKC 6b3a27bf -- the
  commit whose staged sourceDigest is the a37d19b6 live `/health` reported on 2026-11-18 -- by
  receipts/WO-E-INC-1/capture_revision_contract.py. Synthetic documents; not the deployed service.
  Replaying it drives the real dispatch, receipt checks and projection: only `fetch`, the request
  UUID and the clock are fixed, so a request this side builds differently fails on its first byte.
*/

const crypto = vi.hoisted(() => ({ uuids: [] as string[] }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  const randomUUID = (() => {
    const next = crypto.uuids.shift();
    if (!next) throw new Error("a request id the fixture does not hold");
    return next;
  }) as typeof real.randomUUID;
  return { ...real, default: { ...real, randomUUID }, randomUUID };
});

type Exchange = {
  case: string;
  request: { requestId: string; inputSha256: string; body: string };
  response: { status: number; body: string };
};
const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/core-v2-revision/exchanges.json", import.meta.url), "utf8")) as {
  core: { commit: string; sourceDigest: string; releaseManifestSha256: string; refusalCodes: string[] };
  workspaceId: string;
  latencyBudgetMs: number;
  documents: { v1: CollectionOcrInput[]; v2: CollectionOcrInput[] };
  exchanges: Exchange[];
};
const CORE_COMMIT = "6b3a27bf3d7d600f1cdd252b7414f2df6a0f1fed";
const CORE_SOURCE_DIGEST = "sha256:a37d19b60ef5494b96a7d757700b5cd79e23607bf5bff4235d7a91f28c76aad8";
const env = { url: "https://core.invalid", hmac: "h".repeat(32) };
const { workspaceId: ws, latencyBudgetMs: budget, documents: { v1, v2 } } = fixture;
const exchanges = (name: string) => fixture.exchanges.filter((exchange) => exchange.case === name);
const requestedAt = (exchange: Exchange) => new Date((JSON.parse(exchange.request.body) as ProductCoreV2CompileRequest).requestedAt);
const sha256 = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** Core answers with the captured responses, in order; every body this side sends is kept. */
function replay(responses: Array<{ status: number; body: string } | Error>, requestIds: string[]) {
  const sent: string[] = [];
  const queue = [...responses];
  crypto.uuids.splice(0, crypto.uuids.length, ...requestIds.map((id) => id.replace(/^core-/, "")));
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(String(init.body));
    const next = queue.shift();
    if (!next) throw new Error("a Core call the case did not expect");
    if (next instanceof Error) throw next;
    return new Response(next.body, { status: next.status, headers: { "content-type": "application/json" } });
  }));
  return sent;
}

/** The prior World, read back the way the product path reads it: projected, stored, re-read. */
async function priorWorld() {
  const [initial] = exchanges("initial");
  replay([initial.response], [initial.request.requestId]);
  const first = await dispatchProductCoreV2(env, ws, v1, requestedAt(initial), null, undefined, undefined, undefined, budget);
  if (!first.ok) throw new Error(first.code);
  const artifact = projectProductCoreV2Candidate(first.result, v1, true);
  const snapshot = artifact && readRevisionCompileSnapshot(artifact, {
    worldStateId: artifact.revisionCompile!.worldStateId, manifestDigest: artifact.manifestDigest, collectionId: artifact.collectionId,
  });
  if (!snapshot) throw new Error("the captured initial compile does not round-trip to a snapshot");
  return snapshot;
}

/** The two synthetic faults the capture sent, rebuilt the same way. */
const variants = {
  zeroHashes: (snapshot: NonNullable<Awaited<ReturnType<typeof priorWorld>>>) => ({
    ...snapshot, artifactHashes: Object.fromEntries(Object.keys(snapshot.artifactHashes).map((key) => [key, `sha256:${"0".repeat(64)}`])),
  }),
  extraField: (snapshot: NonNullable<Awaited<ReturnType<typeof priorWorld>>>) => ({
    ...snapshot, units: snapshot.units.map((unit, index) => index === 0 ? { ...unit, unexpectedField: "x" } : unit),
  }),
};

/** Runs the revision with the clock where the capture had it: the revision at its time, the full compile at its own. */
async function revise(previous: Awaited<ReturnType<typeof priorWorld>>, pair: Exchange[]) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(requestedAt(pair.at(-1)!));
  return dispatchProductCoreV2Revision(env, ws, v2, previous, requestedAt(pair[0]), undefined, undefined, undefined, budget);
}

/** A captured response edited, with its output digest recomputed so only the edit is under test. */
type EditableResponse = {
  status: string;
  candidate: { lifecycle: string; reviewReasons: string[] };
  receipt: { equivalence: string; outputSha256: string };
};
function edited(body: string, edit: (response: EditableResponse) => void) {
  const response = JSON.parse(body) as EditableResponse;
  edit(response);
  const text = JSON.stringify(response);
  response.receipt.outputSha256 = sha256(canonicalJsonWireField(text, "candidate")!);
  return JSON.stringify(response);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the fixture is pinned to the Core release", () => {
  it("names the commit and digest, and every Core answer in it carries that digest", () => {
    expect(fixture.core.commit).toBe(CORE_COMMIT);
    expect(fixture.core.sourceDigest).toBe(CORE_SOURCE_DIGEST);
    const worlds = fixture.exchanges.filter((exchange) => exchange.response.status === 200);
    expect(worlds.length).toBe(6);
    for (const exchange of worlds) expect(JSON.parse(exchange.response.body).receipt.coreReleaseDigest).toBe(CORE_SOURCE_DIGEST);
  });

  it("holds every request body under the digest that was signed", () => {
    for (const exchange of fixture.exchanges) expect(sha256(exchange.request.body)).toBe(exchange.request.inputSha256);
  });
});

describe("a revision Core proves equal", () => {
  it("is the exact request the builder makes, and comes back equivalent in one call", async () => {
    const previous = await priorWorld();
    const [exchange] = exchanges("revision_equivalent");
    const sent = replay([exchange.response], [exchange.request.requestId]);
    const result = await revise(previous, [exchange]);

    expect(sent).toEqual([exchange.request.body]);
    const request = JSON.parse(sent[0]) as ProductCoreV2CompileRequest;
    expect(request.route.operationClass).toBe("incremental_recompile");
    expect(request.previousActiveWorld).toEqual(previous);
    expect(result).toMatchObject({ ok: true, revisionCompile: { attempted: true, outcome: "equivalent" } });
    if (!result.ok) throw new Error(result.code);
    expect(result.result.receipt).toMatchObject({ equivalence: "passed", totalArtifacts: 10, rebuiltArtifacts: 7, workAvoidedArtifacts: 3 });
    expect(result.result.candidate.parentWorldStateId).toBe(previous.worldStateId);
    expect(projectProductCoreV2Candidate(result.result, v2, true)).not.toBeNull();
  });
});

describe("a revision Core holds runs one full compile and says why", () => {
  // Outcome 1 of 3 through the real dispatch: the full compile succeeded.
  it.each([
    ["held_equivalence_failed", "zeroHashes", "FULL_REBUILD_EQUIVALENCE_FAILED",
      "Compiled in full. Revision held: the compiler did not prove the revision equal to a full rebuild."],
    ["held_request_invalid", "extraField", "CORE_REQUEST_INVALID",
      "Compiled in full. Revision held: the compiler refused the revision request as invalid."],
    ["held_idempotency_conflict", "zeroHashes", "CORE_IDEMPOTENCY_CONFLICT",
      "Compiled in full. Revision held: the compiler holds a different request under this revision's key."],
  ] as const)("%s", async (name, variant, reason, line) => {
    const previous = variants[variant](await priorWorld());
    const pair = exchanges(name);
    expect(pair).toHaveLength(2);
    const sent = replay(pair.map((exchange) => exchange.response), pair.map((exchange) => exchange.request.requestId));
    const result = await revise(previous, pair);

    expect(sent).toEqual(pair.map((exchange) => exchange.request.body));
    const [revision, full] = sent.map((body) => JSON.parse(body) as ProductCoreV2CompileRequest);
    expect(revision.route.operationClass).toBe("incremental_recompile");
    expect(full.route.operationClass).toBe("initial_compile");
    expect(full.previousActiveWorld).toBeUndefined();
    expect(full.idempotencyKey).not.toBe(revision.idempotencyKey);
    expect(result.revisionCompile).toEqual({ attempted: true, outcome: "held", reason, fullCompile: "succeeded", line });
    expect(result).toMatchObject({ ok: true, result: { status: "completed", receipt: { equivalence: "not_run" } } });
    if (!result.ok) throw new Error(result.code);
    expect(projectProductCoreV2Candidate(result.result, v2, true)).not.toBeNull();
  });

  // Outcome 2 of 3 through the real dispatch: the full compile was sent and failed.
  it("a refusal of the full compile too says the full compile failed, never a third call", async () => {
    const previous = variants.extraField(await priorWorld());
    const [refusal] = exchanges("held_request_invalid");
    const sent = replay([refusal.response, refusal.response], [refusal.request.requestId, "core-00000000-0000-4000-8000-000000000000"]);
    const result = await revise(previous, [refusal]);

    expect(sent).toHaveLength(2);
    expect(result).toEqual({ ok: false, code: "CORE_REQUEST_INVALID", revisionCompile: {
      attempted: true, outcome: "held", reason: "CORE_REQUEST_INVALID", fullCompile: "failed",
      line: "Full compile failed. Revision held: the compiler refused the revision request as invalid." } });
  });

  // Outcome 3 of 3 through the real dispatch: the full compile was never sent.
  it("a hold that leaves no time for the full compile says it was not sent, and sends nothing more", async () => {
    const previous = await priorWorld();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T13:00:00.000Z"));
    crypto.uuids.splice(0, crypto.uuids.length, "00000000-0000-4000-8000-000000000005", "00000000-0000-4000-8000-000000000006");
    const fetch = vi.fn(async () => {
      vi.setSystemTime(new Date("2026-11-18T13:00:01.500Z"));
      return new Response(JSON.stringify({ code: "CORE_REQUEST_INVALID" }), { status: 422 });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await dispatchProductCoreV2Revision(env, ws, v2, previous, new Date(), undefined, undefined, undefined, 2_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, code: "CORE_V2_TIME_BUDGET_INVALID", revisionCompile: {
      attempted: true, outcome: "held", reason: "CORE_REQUEST_INVALID", fullCompile: "not_attempted",
      line: "Full compile not sent. Revision held: the compiler refused the revision request as invalid." } });
  });

  it("a revision over the request bound is held before it is sent: not attempted, and the full compile still goes", async () => {
    const previous = await priorWorld();
    const oversized = { ...previous, units: previous.units.map((unit, index) => index === 0 ? { ...unit, text: "x".repeat(4_600_000) } : unit) };
    const [, full] = exchanges("held_equivalence_failed");
    const sent = replay([full.response], ["core-00000000-0000-4000-8000-000000000001", full.request.requestId]);
    const result = await revise(oversized, [full]);

    expect(sent).toEqual([full.request.body]);
    expect(result).toMatchObject({ ok: true, revisionCompile: {
      attempted: false, outcome: "held", reason: "COMPILE_INPUT_TOO_LARGE", fullCompile: "succeeded" } });
  });

  /*
    The class, not one input: the line says "Compiled in full" exactly when the dispatch it is
    returned with is a World Core compiled, for every way the full compile can end -- each refusal
    code, a rejection, a transport failure, an unreadable body, a receipt that does not hold.
  */
  describe("the line names the full compile's actual outcome, for every way it can end", () => {
    const [revisionAnswer, fullAnswer] = exchanges("held_request_invalid");
    const status = (to: "review_required" | "rejected") => ({ status: 200, body: edited(fullAnswer.response.body, (response) => {
      response.status = to;
      response.candidate.lifecycle = to;
    }) });
    const cases: Array<[string, { status: number; body: string } | Error, "succeeded" | "failed"]> = [
      ["completed", fullAnswer.response, "succeeded"],
      ["review_required", status("review_required"), "succeeded"],
      ["rejected", status("rejected"), "failed"],
      ...fixture.core.refusalCodes.map((code) => [code, { status: 422, body: JSON.stringify({ code }) }, "failed"] as [string, { status: number; body: string }, "failed"]),
      ["an unknown code", { status: 422, body: JSON.stringify({ code: "CORE_NOT_IN_THIS_RELEASE" }) }, "failed"],
      ["HTTP 500, empty", { status: 500, body: "" }, "failed"],
      ["HTTP 200, not JSON", { status: 200, body: "{" }, "failed"],
      ["a receipt that does not hold", { status: 200, body: fullAnswer.response.body.replace(/"outputSha256":"sha256:[0-9a-f]{64}"/, `"outputSha256":"sha256:${"1".repeat(64)}"`) }, "failed"],
      ["a refused connection", new TypeError("fetch failed"), "failed"],
      ["a timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" }), "failed"],
    ];

    it.each(cases)("%s", async (_name, answer, fullCompile) => {
      const previous = variants.extraField(await priorWorld());
      const sent = replay([revisionAnswer.response, answer], [revisionAnswer.request.requestId, fullAnswer.request.requestId]);
      const result = await revise(previous, [revisionAnswer, fullAnswer]);

      expect(sent).toHaveLength(2);
      expect(result.revisionCompile).toMatchObject({ attempted: true, outcome: "held", reason: "CORE_REQUEST_INVALID", fullCompile });
      const world = result.ok && (result.result.status === "completed" || result.result.status === "review_required");
      expect(world).toBe(fullCompile === "succeeded");
      const line = result.revisionCompile?.outcome === "held" ? result.revisionCompile.line : "";
      expect(line.startsWith("Compiled in full.")).toBe(world);
    });
  });
});

describe("a full-compile outcome the code cannot classify is shown as not known, never as success", () => {
  const completed = JSON.parse(exchanges("initial")[0].response.body) as ProductCoreV2CompileResponse;
  it.each([
    ["a status outside the contract, sent", { ok: true, result: { ...completed, status: "partial" } }, true],
    ["a World that was never sent", { ok: true, result: completed }, false],
  ] as const)("%s", (_name, dispatch, attempted) => {
    expect(revisionFullCompileOutcome(dispatch as never, attempted)).toBe("unknown");
  });
  it("the three outcomes it can classify", () => {
    expect(revisionFullCompileOutcome({ ok: true, result: completed }, true)).toBe("succeeded");
    expect(revisionFullCompileOutcome({ ok: true, result: { ...completed, status: "rejected" } }, true)).toBe("failed");
    expect(revisionFullCompileOutcome({ ok: false, code: "CORE_V2_UNAVAILABLE" }, true)).toBe("failed");
    expect(revisionFullCompileOutcome({ ok: false, code: "CORE_V2_TIME_BUDGET_INVALID" }, false)).toBe("not_attempted");
  });
});

describe("every code the release can answer is placed", () => {
  const HELD = ["CORE_COMPILE_REJECTED", "CORE_IDEMPOTENCY_CONFLICT", "CORE_REQUEST_INVALID"];
  const NOT_HELD = [
    "CORE_AUTH_NOT_CONFIGURED", "CORE_CUSTOMER_DATA_DISABLED", "CORE_INPUT_DIGEST_INVALID", "CORE_OUTPUT_TOO_LARGE",
    "CORE_REQUEST_ID_INVALID", "CORE_REQUEST_ID_MISMATCH", "CORE_REQUEST_TOO_LARGE", "CORE_SIGNATURE_INVALID",
    "CORE_TIMESTAMP_EXPIRED", "CORE_TIMESTAMP_INVALID",
  ];

  it("the two lists are exactly the release's refusal codes", () => {
    expect([...HELD, ...NOT_HELD].sort()).toEqual(fixture.core.refusalCodes);
  });

  it.each(HELD)("%s is a hold: one full compile follows", async (code) => {
    const previous = await priorWorld();
    const sent = replay([{ status: 422, body: JSON.stringify({ code }) }, { status: 422, body: JSON.stringify({ code }) }],
      ["core-00000000-0000-4000-8000-000000000002", "core-00000000-0000-4000-8000-000000000003"]);
    const result = await dispatchProductCoreV2Revision(env, ws, v2, previous, new Date(), undefined, undefined, undefined, budget);
    expect(sent).toHaveLength(2);
    expect(result.revisionCompile).toMatchObject({ outcome: "held", reason: code });
  });

  // An operational or integrity failure is the same failure for a full compile, and a code never seen is not a hold.
  it.each([
    ...NOT_HELD.map((code) => [code, { status: 422, body: JSON.stringify({ code }) }, code] as const),
    ["a code this release does not have", { status: 422, body: JSON.stringify({ code: "CORE_NOT_IN_THIS_RELEASE" }) }, "CORE_NOT_IN_THIS_RELEASE"] as const,
    ["a body with no code", { status: 500, body: "" }, "CORE_V2_HTTP_500"] as const,
    ["a refused connection", new TypeError("fetch failed"), "CORE_V2_UNAVAILABLE"] as const,
  ])("%s is returned as it came, with no full compile", async (_name, response, code) => {
    const previous = await priorWorld();
    const sent = replay([response], ["core-00000000-0000-4000-8000-000000000004"]);
    const result = await dispatchProductCoreV2Revision(env, ws, v2, previous, new Date(), undefined, undefined, undefined, budget);
    expect(sent).toHaveLength(1);
    expect(result).toEqual({ ok: false, code });
  });
});

describe("what a revision response must say", () => {
  it("a review_required revision without a passed equivalence is an invalid receipt, not a World", async () => {
    const previous = await priorWorld();
    const [exchange] = exchanges("revision_equivalent");
    const answer = (equivalence: string) => edited(exchange.response.body, (response) => {
      response.status = "review_required";
      response.candidate.lifecycle = "review_required";
      response.candidate.reviewReasons = ["SEMANTIC_CLAIMS_EMPTY"];
      response.receipt.equivalence = equivalence;
    });

    replay([{ status: 200, body: answer("not_run") }], [exchange.request.requestId]);
    expect(await revise(previous, [exchange])).toEqual({ ok: false, code: "CORE_V2_RECEIPT_INVALID" });
    replay([{ status: 200, body: answer("passed") }], [exchange.request.requestId]);
    expect(await revise(previous, [exchange])).toMatchObject({ ok: true, revisionCompile: { outcome: "equivalent" } });
  });

  it("a rejection that does not name the failed equivalence is returned rejected, not held", async () => {
    const previous = variants.zeroHashes(await priorWorld());
    const [exchange] = exchanges("held_equivalence_failed");
    const body = edited(exchange.response.body, (response) => { response.candidate.reviewReasons = []; });
    const sent = replay([{ status: 200, body }], [exchange.request.requestId]);
    const result = await revise(previous, [exchange]);

    expect(sent).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, result: { status: "rejected" } });
    expect(result.revisionCompile).toBeUndefined();
  });
});
