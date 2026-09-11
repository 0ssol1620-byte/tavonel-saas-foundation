import { describe, expect, it } from "vitest";
import { EQUIVALENCE_UNACCOUNTED_ARTIFACT_TOLERANCE, assertEquivalenceGate } from "./equivalence-gate";

/*
  TM02. The gate reads the Core's equivalence verdict, and fails closed on everything else.

  `receipt.equivalence` is a `Literal["passed", "failed", "not_run"]` on
  `ProductCoreReceipt` (contracts.py) and nothing in Next.js read it, so a selective rebuild
  that diverged from a full one would have promoted with a receipt that said so. The four
  branches are all here including the ones nobody expects to see, because "unreadable" is the
  one that decides whether this gate is a safety property or a formality.
*/
const receipt = (equivalence: unknown, counts: Partial<Record<"totalArtifacts" | "rebuiltArtifacts" | "workAvoidedArtifacts", unknown>> = {}) => ({
  requestId: "request-1",
  equivalence,
  totalArtifacts: 8,
  rebuiltArtifacts: 3,
  workAvoidedArtifacts: 5,
  ...counts,
});

describe("the full-rebuild equivalence gate", () => {
  it("passes a compared, undiverged selective rebuild", () => {
    const result = assertEquivalenceGate(receipt("passed"));

    expect(result.ok).toBe(true);
    expect(result.status).toBe("equivalent");
    expect(result.detail).toContain("8");
  });

  it("refuses a reported mismatch", () => {
    const result = assertEquivalenceGate(receipt("failed"));

    expect(result.ok).toBe(false);
    expect(result.status).toBe("mismatch");
  });

  /*
    not_run passes, and must never be reported as equivalence.

    It is what every compile on this deployment reports: the Core sets it when no previous
    active world was sent, which is every call while the revision-compile flag is off.
    Refusing it would refuse every promotion; dressing it up as `equivalent` would claim a
    comparison nobody made.
  */
  it("lets an uncompared full rebuild through while saying no comparison was made", () => {
    const result = assertEquivalenceGate(receipt("not_run", { rebuiltArtifacts: 8, workAvoidedArtifacts: 0 }));

    expect(result).toEqual({
      ok: true,
      status: "not_run",
      detail: expect.stringContaining("no selective-versus-full comparison was made"),
    });
  });

  it("refuses a verdict it cannot read rather than defaulting to allow", () => {
    for (const value of [undefined, null, "", "PASSED", "equivalent", 1, true]) {
      const result = assertEquivalenceGate(receipt(value));
      expect(result.ok, `equivalence ${String(value)} was allowed through`).toBe(false);
      expect(result.status).toBe("unknown");
    }
    expect(assertEquivalenceGate(null)).toEqual({ ok: false, status: "unknown", detail: expect.any(String) });
    expect(assertEquivalenceGate("passed")).toEqual({ ok: false, status: "unknown", detail: expect.any(String) });
  });

  it("refuses a receipt whose artifact counts do not add up, whatever its verdict claims", () => {
    // Seven of eight artifacts accounted for: one was compared by nobody.
    const short = assertEquivalenceGate(receipt("passed", { workAvoidedArtifacts: 4 }));
    expect(short.ok).toBe(false);
    expect(short.status).toBe("mismatch");
    expect(short.detail).toContain("7 of 8");

    for (const counts of [
      { totalArtifacts: "8" },
      { rebuiltArtifacts: -1 },
      { workAvoidedArtifacts: 1.5 },
      { totalArtifacts: undefined },
    ]) {
      const result = assertEquivalenceGate(receipt("passed", counts));
      expect(result.ok, `counts ${JSON.stringify(counts)} were allowed through`).toBe(false);
      expect(result.status).toBe("unknown");
    }
  });

  /*
    The threshold is published as the number it is, which is zero, and as uncalibrated.

    The Core reports a verdict rather than a divergence count, so there is no distribution to
    fit a tolerance to. Pinning the value here means raising it is an edit to this file, in a
    diff a reviewer sees, next to the sentence saying it has no corpus behind it.
  */
  it("carries a zero tolerance that no corpus has calibrated", () => {
    expect(EQUIVALENCE_UNACCOUNTED_ARTIFACT_TOLERANCE).toBe(0);
  });
});
