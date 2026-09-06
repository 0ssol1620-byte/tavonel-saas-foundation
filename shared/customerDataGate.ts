import { createHash } from "node:crypto";
import { customerDataPreconditions, type CustomerDataPrecondition } from "./uskcEnums";

/**
 * The customer-data gate.
 *
 * `CompileJobEnvelope.route.privacyPolicy` has spelled `approved_customer_data` since the type was
 * written, and `validateCompileJobEnvelope` has refused it with a single `!==` comparison. That
 * comparison is the whole of the Foundation's customer-data boundary today. Deleting it satisfies
 * the compiler, passes review as a one-line diff, and opens real customer bytes to a pipeline whose
 * security preconditions nobody has enumerated. This module exists so that the boundary is an
 * enumerated list with evidence per row instead of one comparison, and so that removing it requires
 * removing something that visibly refuses.
 *
 * Nothing here enables anything. A decision object is produced by a caller that supplies evidence;
 * no code in this repository supplies satisfied evidence for all seventeen rows, and
 * `activationPolicy.customerData.enabled` is `false`. A green gate is necessary, never sufficient:
 * the founder records the approval receipt, and the founder is not an agent.
 */

export const CUSTOMER_DATA_GATE_SCHEMA = "tavonel.customer_data_gate.v1" as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export type PreconditionEvidence = {
  precondition: CustomerDataPrecondition;
  /** Never defaulted. An absent check is `false`, not an optimistic true. */
  satisfied: boolean;
  /** A path, a receipt digest or a test id -- something a reader can open. Blank is not evidence. */
  evidence: string;
  checkedAt: string;
};

export type CustomerDataGateDecision =
  | {
      allowed: true;
      schemaVersion: typeof CUSTOMER_DATA_GATE_SCHEMA;
      tenantId: string;
      workspaceId: string;
      receiptSha256: string;
      evaluatedAt: string;
    }
  | {
      allowed: false;
      schemaVersion: typeof CUSTOMER_DATA_GATE_SCHEMA;
      tenantId: string;
      workspaceId: string;
      missing: CustomerDataPrecondition[];
      evaluatedAt: string;
    };

/**
 * An instant, not merely something `Date.parse` tolerates. `Date.parse` accepts "2026", "0" and
 * "Sat Sep 6 2026"; a gate stamped with any of those is not auditable to a moment, so the shape is
 * pinned to an ISO-8601 instant with an explicit offset and the value must also be a real date.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isInstant(value: string): boolean {
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    return false;
  }
  // "and the value must also be a real date" was not true of the shape plus `Date.parse` alone:
  // `Date.parse("2026-02-30T00:00:00Z")` is finite because the ISO parser range-checks the day
  // against 31 rather than against the month, and then rolls it forward -- a gate stamped on a day
  // that does not exist was admitted and silently re-read as 2026-03-02. So the day must spell
  // itself back. Hours, minutes and seconds need no such check: `Date.parse` returns NaN for
  // "T99:99:99Z", which the finiteness test above already refuses.
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const rendered = new Date(Date.UTC(year, month - 1, day));
  return (
    rendered.getUTCFullYear() === year && rendered.getUTCMonth() === month - 1 && rendered.getUTCDate() === day
  );
}

/**
 * Canonical form of the subject and its evidence: the seventeen rows in frozen order, each object
 * written with its keys in sorted order, so the digest is a function of what was approved and not
 * of the order the caller happened to build the array in.
 *
 * The subject is inside the digest, not beside it. Contract §4.3 first defined the digest over the
 * evidence list alone, which made a stored receipt digest portable: two tenants whose evidence
 * happens to read the same -- and the evidence rows are paths, receipt digests and test ids, which
 * are not tenant-specific -- produced the identical digest, so a digest copied from an approved
 * tenant verified for an unapproved one. §8.1 amends §4.3 to bind `tenantId` and `workspaceId` into
 * it. A receipt is now a statement about one workspace of one tenant and re-derives to a different
 * value anywhere else.
 */
export function customerDataEvidenceReceiptSha256(
  subject: { tenantId: string; workspaceId: string },
  evidence: readonly PreconditionEvidence[],
): string {
  const byPrecondition = new Map(evidence.map((entry) => [entry.precondition, entry]));
  const canonical = JSON.stringify({
    evidence: [...customerDataPreconditions]
      .filter((precondition) => byPrecondition.has(precondition))
      .map((precondition) => {
        const entry = byPrecondition.get(precondition) as PreconditionEvidence;
        return {
          checkedAt: entry.checkedAt,
          evidence: entry.evidence,
          precondition: entry.precondition,
          satisfied: entry.satisfied,
        };
      }),
    schemaVersion: CUSTOMER_DATA_GATE_SCHEMA,
    tenantId: subject.tenantId,
    workspaceId: subject.workspaceId,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function evaluateCustomerDataGate(input: {
  tenantId: string;
  workspaceId: string;
  evidence: readonly PreconditionEvidence[];
  now: string;
}): CustomerDataGateDecision {
  const evaluatedAt = isInstant(input.now) ? input.now : new Date(0).toISOString();
  const refuse = (missing: CustomerDataPrecondition[]): CustomerDataGateDecision => ({
    allowed: false,
    schemaVersion: CUSTOMER_DATA_GATE_SCHEMA,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    missing,
    evaluatedAt,
  });

  // An unidentified subject cannot be approved, and an evaluation stamped with a time nobody can
  // read is not auditable. Both refuse everything rather than approve something unattributable.
  if (!input.tenantId.trim() || !input.workspaceId.trim() || !isInstant(input.now)) {
    return refuse([...customerDataPreconditions]);
  }

  const missing = customerDataPreconditions.filter((precondition) => {
    const entries = input.evidence.filter((entry) => entry.precondition === precondition);
    // Two rows for one precondition is a disagreement, not a stronger claim.
    if (entries.length !== 1) return true;
    const [entry] = entries;
    return entry.satisfied !== true || entry.evidence.trim() === "" || !isInstant(entry.checkedAt);
  });
  if (missing.length > 0) return refuse(missing);

  return {
    allowed: true,
    schemaVersion: CUSTOMER_DATA_GATE_SCHEMA,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    receiptSha256: customerDataEvidenceReceiptSha256(input, input.evidence),
    evaluatedAt,
  };
}

/**
 * The single question the compile envelope asks. A decision for another tenant, another workspace,
 * another schema version, or no decision at all, is not an approval for this envelope.
 */
export function gateAdmitsCustomerData(
  gate: CustomerDataGateDecision | undefined,
  tenantId: string,
  workspaceId: string,
): boolean {
  return (
    gate !== undefined &&
    gate.allowed === true &&
    gate.schemaVersion === CUSTOMER_DATA_GATE_SCHEMA &&
    SHA256.test(gate.receiptSha256) &&
    gate.tenantId === tenantId &&
    gate.workspaceId === workspaceId
  );
}
