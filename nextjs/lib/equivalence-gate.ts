/**
 * The full-rebuild equivalence gate: read the Core's own equivalence verdict, or refuse.
 *
 * Audit TM02. `akc_cir.recompilation.verify_equivalence` compares what a selective rebuild
 * produced against what a full rebuild would have produced, and `product-core/compiler.py`
 * turns its report into one field on the receipt -- `equivalence`, a
 * `Literal["passed", "failed", "not_run"]` (contracts.py `ProductCoreReceipt`). Nothing in
 * Next.js read it. This is the function that does.
 *
 * Two things this file is deliberately not:
 *
 * It is not a second equivalence checker. The comparison happens in the protected core, over
 * artifact hashes it computed on both paths; re-deriving a verdict here from numbers on a
 * receipt would be a second opinion with less evidence behind it.
 *
 * It is not wired into promotion by this module. `assertEquivalenceGate` is a pure read that
 * the promote route calls; the route is another lane's file and the wiring happens at
 * integration. A gate that nothing calls is not a gate, and that is stated in the lane report
 * rather than implied by this file existing.
 */

/**
 * How many of a compile's artifacts may be neither rebuilt nor carried over: none.
 *
 * IMPLEMENTED_NOT_PROVEN, and uncalibrated. The Core reports equivalence as a verdict rather
 * than as a divergence count, so there is no measured distribution to set a tolerance from and
 * no corpus this number was fitted on. Zero is not a tuned threshold -- it is the only value
 * that is defensible without one: an artifact the receipt cannot account for is an artifact
 * nobody compared, and "some unknown number of uncompared artifacts is fine" is a claim this
 * product has no evidence for. If the Core ever reports a divergence count, this is the one
 * place a calibrated tolerance replaces it, and it must arrive with the corpus it was measured
 * on named beside it, the way `CalibrationTable` refuses to be marked calibrated without one.
 */
export const EQUIVALENCE_UNACCOUNTED_ARTIFACT_TOLERANCE = 0;

export type EquivalenceGateStatus = "not_run" | "equivalent" | "mismatch" | "unknown";

export type EquivalenceGateResult = {
  ok: boolean;
  status: EquivalenceGateStatus;
  /** One sentence, safe to log and to show an operator. Never a threshold or a score. */
  detail: string;
};

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param receipt `coreExecution.receipt` as it was stored, or the live `result.receipt`.
 */
export function assertEquivalenceGate(receipt: unknown): EquivalenceGateResult {
  const record = receipt && typeof receipt === "object" ? receipt as Record<string, unknown> : null;
  if (!record) {
    return { ok: false, status: "unknown", detail: "no compile receipt was supplied to the equivalence gate" };
  }
  const { equivalence, totalArtifacts, rebuiltArtifacts, workAvoidedArtifacts } = record;
  /*
    A receipt whose counts do not add up is unreadable, whatever its verdict says.

    `dispatchProductCoreV2` already refuses such a receipt at the wire, so reaching here means
    the stored artifact was written by an older or a different path. The verdict is not trusted
    over the arithmetic that is supposed to support it: an artifact that is neither in the
    rebuilt set nor in the carried-over set was compared by nobody.
  */
  if (!integer(totalArtifacts) || !integer(rebuiltArtifacts) || !integer(workAvoidedArtifacts)) {
    return { ok: false, status: "unknown", detail: "the compile receipt does not carry readable artifact counts" };
  }
  const unaccounted = (totalArtifacts as number) - (rebuiltArtifacts as number) - (workAvoidedArtifacts as number);
  if (Math.abs(unaccounted) > EQUIVALENCE_UNACCOUNTED_ARTIFACT_TOLERANCE) {
    return {
      ok: false,
      status: "mismatch",
      detail: `the compile receipt accounts for ${(rebuiltArtifacts as number) + (workAvoidedArtifacts as number)} of ${totalArtifacts as number} artifacts`,
    };
  }
  if (equivalence === "passed") {
    return {
      ok: true,
      status: "equivalent",
      detail: `the Core compared ${totalArtifacts as number} artifacts against a full rebuild and reported no divergence`,
    };
  }
  if (equivalence === "failed") {
    return {
      ok: false,
      status: "mismatch",
      detail: "the Core reported that this selective rebuild diverges from a full rebuild",
    };
  }
  /*
    `not_run` passes, and says so rather than reading as equivalence.

    Every compile on this deployment reports `not_run` today: the Core sets it when no previous
    active world was sent, which is every call until TM01's flag is on. Refusing it would refuse
    every promotion, so the gate lets it through with the truth attached -- no comparison was
    made -- and the caller is what decides whether an uncompared compile may be promoted. What
    must never happen is `not_run` being reported as `equivalent`.
  */
  if (equivalence === "not_run") {
    return {
      ok: true,
      status: "not_run",
      detail: "this compile rebuilt the whole collection, so no selective-versus-full comparison was made",
    };
  }
  return {
    ok: false,
    status: "unknown",
    detail: "the compile receipt carries no equivalence verdict this gate can read",
  };
}
