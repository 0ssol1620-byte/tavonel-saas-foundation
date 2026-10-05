import { parseCompletedReadFacts, type CompletedReadFacts } from "../../shared/completedReadReceipt";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { readCustomerSourceScope } from "./customer-source-scope";

type SettlementReceipt = {
  status: "processed" | "duplicate";
  reservationId: string;
  state: "settled";
  settledCredits: 2;
  billingSource: "owner" | "trial" | "paid";
  completedRead: CompletedReadFacts;
};

function matches(value: unknown, expected: CompletedReadFacts): value is SettlementReceipt {
  if (!value || typeof value !== "object") return false;
  const row = value as SettlementReceipt;
  const facts = parseCompletedReadFacts(row.completedRead);
  return !!facts && (row.status === "processed" || row.status === "duplicate")
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.reservationId)
    && row.state === "settled" && row.settledCredits === 2
    && ["owner", "trial", "paid"].includes(row.billingSource)
    && Object.keys(expected).every(key => facts[key as keyof CompletedReadFacts] === expected[key as keyof CompletedReadFacts]);
}

/** No fallback to the legacy settlement RPC: proof failure must roll back the debit. */
export async function settleCompletedRead(value: unknown) {
  const facts = parseCompletedReadFacts(value);
  if (process.env.FOUNDATION_COMPLETED_READ_ENABLED !== "true") return { ok: false as const, code: "COMPLETED_READ_DISABLED" };
  if (!facts) return { ok: false as const, code: "COMPLETED_READ_INVALID" };
  const config = readSupabaseAdminConfig();
  if (!config) return { ok: false as const, code: "COMPUTE_LEDGER_NOT_CONFIGURED" };
  try {
    const scope = await readCustomerSourceScope(facts.workspaceKey, [facts.documentId]);
    if (!scope.ok || scope.scope !== "direct_upload") return { ok: false as const, code: "COMPLETED_READ_DIRECT_UPLOAD_REQUIRED" };
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/settle_foundation_completed_read_v1", {
      method: "POST", body: JSON.stringify({ p_facts: facts }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok || !matches(result, facts)) return { ok: false as const, code: "COMPLETED_READ_SETTLEMENT_FAILED" };
    return { ok: true as const, result };
  } catch { return { ok: false as const, code: "COMPLETED_READ_SETTLEMENT_FAILED" }; }
}

/** Internal only. The caller must run the existing source-serving authorization for this exact
 * request and principal; evidence grants no access. SQL independently rechecks availability.
 * No public reader, intake acceptance or zero-charge promise is introduced here. */
export async function readCompletedReadProof(
  expected: CompletedReadFacts,
  authorizeCurrentSource: (workspaceKey: string, documentId: string) => Promise<boolean>,
) {
  const facts = parseCompletedReadFacts(expected);
  if (process.env.FOUNDATION_COMPLETED_READ_ENABLED !== "true" || !facts) return null;
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    if (!await authorizeCurrentSource(facts.workspaceKey, facts.documentId)) return null;
    const scope = await readCustomerSourceScope(facts.workspaceKey, [facts.documentId]);
    if (!scope.ok || scope.scope !== "direct_upload") return null;
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/read_foundation_completed_read_v1", {
      method: "POST", body: JSON.stringify({ p_facts: facts }),
    });
    const result: unknown = await response.json().catch(() => null);
    return response.ok && matches(result, facts) ? result : null;
  } catch { return null; }
}
