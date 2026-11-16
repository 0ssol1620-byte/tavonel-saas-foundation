import { describe, expect, it } from "vitest";
import { buildPipeline, type LocalUpload, type PipelineDocument, type PipelineRow, type StageState } from "./pipeline";
import { censusOf, deriveFileStates, reconciles, type Census } from "./file-states";

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
    expect(row.reason).toContain("encrypted");
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
  const mixed = () => buildPipeline(
    [up({ localId: "u1" }), up({ localId: "u2", phase: "failed", reason: "r" })],
    [doc({ documentId: "a" }), doc({ documentId: "b", hasOcrJson: true }), doc({ documentId: "c", hasOcrJson: true }),
     doc({ documentId: "e", processingState: "operator_review" }), doc({ documentId: "f", sanitizedKey: null })],
    ["c"],
  );

  it("reconciles on a mixed fixture and leaves removed unobserved", () => {
    const census = censusOf(deriveFileStates(mixed(), live));
    expect(census).toMatchObject({ discovered: 7, accepted: 1, pending: 1, held: 2, processing: 3, removed: null });
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
    }
  });
});
