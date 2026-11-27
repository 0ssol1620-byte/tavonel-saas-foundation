import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPipeline, refusalDetail, type LocalUpload, type PipelineDocument, type PipelineRow, type StageState } from "./pipeline";
import { censusFor, censusLine, censusOf, deriveFileStates, reconciles, tallyCensus, type Census } from "./file-states";

const doc = (o: Partial<PipelineDocument> = {}): PipelineDocument => ({
  documentId: "d1", versionKey: "v1", sanitizedKey: "s", sanitizedSize: 10, ocrJsonKey: null, ocrJsonSize: null,
  hasOcrJson: false, cdrReceiptKey: null, ocrReviewKey: null, processingState: "sanitized", ...o,
});
const up = (o: Partial<LocalUpload> = {}): LocalUpload => ({
  localId: "l1", filename: "a.pdf", bytes: 100, documentId: null, phase: "sending", loaded: 10, ...o,
});
const live = { compiledWorldActive: true };
const one = (rows: PipelineRow[], ctx: Parameters<typeof deriveFileStates>[1] = live) => deriveFileStates(rows, ctx)[0];

describe("deriveFileStates", () => {
  it("maps each observed shape to one state and bucket", () => {
    expect(one(buildPipeline([up({ phase: "issuing" })], null))).toMatchObject({ state: "downloading", bucket: "processing" });
    expect(one(buildPipeline([], [doc({ sanitizedKey: null })]))).toMatchObject({ state: "validated", bucket: "processing" });
    expect(one(buildPipeline([], [doc()]))).toMatchObject({ state: "extraction", bucket: "processing" });
    expect(one(buildPipeline([], [doc({ hasOcrJson: true })]))).toMatchObject({ state: "queued", bucket: "pending", nextAction: "compile" });
    const compiled = buildPipeline([], [doc({ hasOcrJson: true })], ["d1"]);
    expect(one(compiled)).toMatchObject({ state: "accepted", bucket: "accepted" });
    expect(one(compiled, { compiledWorldActive: false })).toMatchObject({ state: "verified", bucket: "verified_pending_publish" });
    expect(one(buildPipeline([], [doc({ processingState: "operator_review" })]))).toMatchObject({ state: "held", bucket: "held", nextAction: "review" });
  });

  it("holds an uncertain or failed upload with its reason verbatim", () => {
    expect(one(buildPipeline([up({ phase: "uncertain", reason: "check the attempt" })], null))).toMatchObject({ state: "held", reason: "check the attempt", nextAction: "reconnect" });
    expect(one(buildPipeline([up({ phase: "failed", reason: "network dropped" })], null))).toMatchObject({ state: "held", reason: "network dropped", nextAction: "re-upload" });
  });

  it("holds a refused file with the refusal sentence, never accepted", () => {
    const refused: PipelineDocument = {
      ...doc({ processingState: "refused", sanitizedKey: null }),
      refusal: { reasonCode: "ENCRYPTED_SOURCE", observedBytes: null, occurredAt: "t" },
    };
    const row = one(buildPipeline([], [refused], ["d1"]));
    expect(row.state).toBe("held");
    expect(row.reason).toBe(refusalDetail(refused.refusal!));
  });

  it("never yields accepted while the World is not active", () => {
    const rows = buildPipeline([], [doc({ hasOcrJson: true })], ["d1"]);
    expect(one(rows, { compiledWorldActive: false }).state).not.toBe("accepted");
  });

  it("excludes only blocked files resolved by removal", () => {
    const rows = buildPipeline([], [doc({ hasOcrJson: true })]);
    const blocked = [{ documentId: "d1", kind: "input" as const, reason: "x" }];
    expect(one(rows, { ...live, blocked, blockedResolution: "remove_blocked" })).toMatchObject({ state: "excluded", bucket: "excluded" });
    expect(one(rows, { ...live, blocked, blockedResolution: "continue" }).state).toBe("queued");
  });

  it("throws on an unknown stage state instead of defaulting to ready", () => {
    const [row] = buildPipeline([], [doc()]);
    const bad = { ...row, stages: row.stages.map((s, i) => (i === 2 ? { ...s, state: "weird" as StageState } : s)) };
    expect(() => deriveFileStates([bad], live)).toThrow(/Unknown stage state/);
  });

  it("throws on a row it cannot classify", () => {
    const [row] = buildPipeline([], [doc()]);
    const idle = { ...row, stages: row.stages.map((s) => ({ ...s, state: "waiting" as StageState })) };
    expect(() => deriveFileStates([idle], live)).toThrow(/refusing to guess/);
  });
});

describe("censusOf", () => {
  const refusedDoc: PipelineDocument = {
    ...doc({ documentId: "g", processingState: "refused", sanitizedKey: null }),
    refusal: { reasonCode: "ENCRYPTED_SOURCE", observedBytes: null, occurredAt: "t" },
  };
  const mixed = () => buildPipeline(
    [up({ localId: "u1" }), up({ localId: "u2", phase: "failed", reason: "r" }), up({ localId: "u3", phase: "uncertain", reason: "u" })],
    [doc({ documentId: "a" }), doc({ documentId: "b", hasOcrJson: true }), doc({ documentId: "c", hasOcrJson: true }),
     doc({ documentId: "e", processingState: "operator_review" }), doc({ documentId: "f", sanitizedKey: null }),
     refusedDoc, doc({ documentId: "i", hasOcrJson: true })],
    ["c"],
  );
  const blocked = [{ documentId: "i", kind: "input" as const, reason: "x" }];

  it("reconciles a 10-file mixed fixture, every bucket exact, removed unobserved", () => {
    const rows = deriveFileStates(mixed(), { ...live, blocked, blockedResolution: "remove_blocked" });
    const census = censusOf(rows);
    expect(census).toEqual({
      discovered: 10, pending: 1, processing: 3, verified_pending_publish: 0, accepted: 1, held: 4, excluded: 1, removed: null,
    });
    expect(reconciles(census)).toBe(true);
  });

  it("with the World inactive the compiled file is verified_pending_publish and accepted is 0", () => {
    const census = censusOf(deriveFileStates(mixed(), { compiledWorldActive: false, blocked, blockedResolution: "remove_blocked" }));
    expect(census).toEqual({
      discovered: 10, pending: 1, processing: 3, verified_pending_publish: 1, accepted: 0, held: 4, excluded: 1, removed: null,
    });
    expect(reconciles(census)).toBe(true);
  });

  it("detects a census that does not add up", () => {
    const census: Census = { ...censusOf(deriveFileStates(mixed(), live)), accepted: 99 };
    expect(reconciles(census)).toBe(false);
  });

  it("puts every row in exactly one bucket across 500 seeded rows", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const docs: PipelineDocument[] = [];
    const compiled: string[] = [];
    for (let i = 0; i < 500; i++) {
      const id = `d${i}`;
      const p = rnd();
      docs.push(
        p < 0.2 ? doc({ documentId: id, sanitizedKey: null })
        : p < 0.4 ? doc({ documentId: id })
        : p < 0.6 ? doc({ documentId: id, processingState: "operator_review" })
        : doc({ documentId: id, hasOcrJson: true }),
      );
      if (p >= 0.8) compiled.push(id);
    }
    for (const active of [true, false]) {
      const rows = deriveFileStates(buildPipeline([], docs, compiled), { compiledWorldActive: active });
      const census = censusOf(rows);
      expect(rows).toHaveLength(500);
      expect(census.discovered).toBe(500);
      expect(reconciles(census)).toBe(true);
      if (!active) expect(census.accepted).toBe(0);
      expect(rows.filter((r) => r.state === "accepted")).toHaveLength(census.accepted);
    }
  });
});

/*
  B4 (independent review). Home said "137 ready" (documents with a read result) while Knowledge said "136 ready
  to compile" and "1 compiled" (the census): one source in a compile split them. Both screens now read the
  census through `tallyCensus`, so one fixture gives one set of numbers.
*/
describe("Home and Knowledge read one tally", () => {
  const ids = Array.from({ length: 141 }, (_, i) => `doc-${i}`);
  // 137 read, 4 held at reading; the first read one is already in a compile that is not active.
  const documents = ids.map((documentId, i) => doc({ documentId, versionKey: `v${i}`, hasOcrJson: i < 137, processingState: i < 137 ? "ocr_ready" : "operator_review" }));
  const rows = buildPipeline([], documents, ["doc-0"]);
  const ctx = { compiledWorldActive: false };

  it("counts the compiled source as ready on both screens", () => {
    const census = censusFor(rows, ctx)!;
    const oldHomeReady = documents.filter((item) => item.hasOcrJson).length;
    // The old census alone said 136 ready to compile; the old Home said 137.
    expect(census.pending).toBe(136);
    expect(oldHomeReady).toBe(137);
    const tally = tallyCensus(census);
    expect(tally).toEqual({ discovered: 141, ready: 137, compiled: 1, processing: 0, needReview: 4, excluded: 0 });
    // Home's number and the Knowledge line's number are the same field.
    expect(tally.ready).toBe(oldHomeReady);
    expect(censusLine(census)).toBe("141 sources · 137 ready (1 compiled) · 4 need review");
  });

  it("prints no sum that does not add up", () => {
    expect(censusFor(rows, ctx)).not.toBeNull();
    expect(tallyCensus({ ...censusOf(deriveFileStates(rows, ctx)) }).discovered).toBe(rows.length);
  });

  it("the page and the board both read it, and neither counts read results on its own any more", () => {
    const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
    const board = readFileSync(new URL("../components/pipeline-board.tsx", import.meta.url), "utf8");
    expect(page).toContain("sourceTally ? sourceTally.ready");
    expect(page).toContain("censusFor(pipelineRows");
    expect(board).toContain("censusLine(fileStates.census)");
  });
});
