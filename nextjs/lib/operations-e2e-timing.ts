import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";

/*
  W1-A3: the end-to-end timing receipt -- upload confirm -> candidate ready -> activate -> first
  remote MCP answer -- recorded once per World as an internal operations receipt
  (`foundation_operations_receipts`, kind `e2e_timing`). Internal means internal: it is not in
  `enterprise_audit_events`, which a customer admin exports, and no client role can read it.

  Every timestamp is read back from the record that already owns it: `confirmed_at` on the
  intake admissions of the compile job's documents (the last one confirmed), the first
  ready/review_required event of the newest compile job that produced the World, and
  `updated_at` of the active World. The answer time is the request's own clock. A timestamp the
  store cannot give is null, and its interval is null -- never estimated.

  "First" is the database's word, not this process's: the receipt is keyed by (kind, workspace,
  World) and the writer keeps the first one, so a second instance recording the same World writes
  nothing. The in-process set only saves the reads after the first time.
*/

export const E2E_TIMING_SCHEMA = "tavonel.e2e_timing.v1";
const MAX_DOCUMENTS_READ = 100;

export type EndToEndTiming = {
  schemaVersion: typeof E2E_TIMING_SCHEMA;
  collectionId: string;
  documents: number;
  uploadConfirmedAt: string | null;
  readyAt: string | null;
  activatedAt: string | null;
  firstMcpAnswerAt: string;
  seconds: { uploadToReady: number | null; readyToActivate: number | null; activateToFirstAnswer: number | null; total: number | null };
};

const interval = (from: string | null, to: string | null) => {
  if (!from || !to) return null;
  const value = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : null;
};

/** Pure: order the four instants into a receipt. An out-of-order pair is a null interval. */
export function buildEndToEndTiming(input: Omit<EndToEndTiming, "schemaVersion" | "seconds">): EndToEndTiming {
  return {
    schemaVersion: E2E_TIMING_SCHEMA,
    ...input,
    seconds: {
      uploadToReady: interval(input.uploadConfirmedAt, input.readyAt),
      readyToActivate: interval(input.readyAt, input.activatedAt),
      activateToFirstAnswer: interval(input.activatedAt, input.firstMcpAnswerAt),
      total: interval(input.uploadConfirmedAt, input.firstMcpAnswerAt),
    },
  };
}

const iso = (value: unknown) => (typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);

async function rows(path: string): Promise<Record<string, unknown>[] | null> {
  const config = readSupabaseAdminConfig();
  if (!config) return null;
  try {
    const response = await supabaseAdminRequest(config, path, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as unknown;
    return Array.isArray(body) ? body as Record<string, unknown>[] : null;
  } catch {
    return null;
  }
}

const receipted = new Set<string>();

export function resetEndToEndTimingMemo() {
  receipted.clear();
}

const WORKSPACE = /^pilot-[A-Za-z0-9]{1,32}$/;
const COLLECTION = /^collection-[a-f0-9]{32}$/;

export type TimingOutcome = "recorded" | "already_recorded" | "not_recorded";

/** Record the receipt the first time a World answers through remote MCP. Never throws. */
export async function recordFirstMcpAnswerTiming(workspaceKey: string, collectionId: string, answeredAt = Date.now()): Promise<TimingOutcome> {
  if (!WORKSPACE.test(workspaceKey) || !COLLECTION.test(collectionId)) return "not_recorded";
  const memo = `${workspaceKey}:${collectionId}`;
  if (receipted.has(memo)) return "already_recorded";
  receipted.add(memo);
  try {
    const world = await rows(`/rest/v1/foundation_active_worlds?${new URLSearchParams({
      select: "updated_at", workspace_key: `eq.${workspaceKey}`, collection_id: `eq.${collectionId}`, limit: "1" })}`);
    if (!world || world.length === 0) {
      // Not an active World (or the store is down): nothing to time yet. Try again next answer.
      receipted.delete(memo);
      return "not_recorded";
    }
    const jobs = await rows(`/rest/v1/foundation_compile_jobs?${new URLSearchParams({
      select: "job_id,document_ids", workspace_key: `eq.${workspaceKey}`, collection_id: `eq.${collectionId}`,
      order: "created_at.desc", limit: "1" })}`);
    const job = jobs?.[0];
    const documentIds = Array.isArray(job?.document_ids) ? (job.document_ids as unknown[]).filter((id): id is string => typeof id === "string") : [];
    let readyAt: string | null = null;
    let uploadConfirmedAt: string | null = null;
    if (typeof job?.job_id === "string") {
      const events = await rows(`/rest/v1/foundation_compile_job_events?${new URLSearchParams({
        select: "occurred_at", job_id: `eq.${job.job_id}`, state: "in.(review_required,ready)", order: "event_sequence.asc", limit: "1" })}`);
      readyAt = iso(events?.[0]?.occurred_at);
      // ponytail: a job over 100 documents records no upload instant rather than a URL that may not fit.
      if (documentIds.length > 0 && documentIds.length <= MAX_DOCUMENTS_READ) {
        const admissions = await rows(`/rest/v1/foundation_intake_admissions?${new URLSearchParams({
          select: "confirmed_at", workspace_key: `eq.${workspaceKey}`, document_id: `in.(${documentIds.join(",")})` })}`);
        const confirmed = (admissions ?? []).map((row) => iso(row.confirmed_at));
        // Only when every document's confirmation was read: the last one is when the upload finished.
        if (admissions && confirmed.length === documentIds.length && confirmed.every((value) => value !== null)) {
          uploadConfirmedAt = (confirmed as string[]).sort().at(-1)!;
        }
      }
    }
    const receipt = buildEndToEndTiming({
      collectionId,
      documents: documentIds.length,
      uploadConfirmedAt,
      readyAt,
      activatedAt: iso(world[0]?.updated_at),
      firstMcpAnswerAt: new Date(answeredAt).toISOString(),
    });
    const config = readSupabaseAdminConfig();
    const response = config && await supabaseAdminRequest(config, "/rest/v1/rpc/record_foundation_operations_receipt", {
      method: "POST",
      body: JSON.stringify({ p_kind: "e2e_timing", p_workspace_key: workspaceKey, p_target_id: collectionId, p_details: receipt }),
      signal: AbortSignal.timeout(5_000),
    });
    const written = response && response.ok ? await response.json().catch(() => null) as unknown : null;
    if (written !== true && written !== false) {
      receipted.delete(memo);
      return "not_recorded";
    }
    if (!written) return "already_recorded";
    console.info(JSON.stringify({ event: "operations_e2e_timing", collectionId, seconds: receipt.seconds }));
    return "recorded";
  } catch {
    receipted.delete(memo);
    return "not_recorded";
  }
}
