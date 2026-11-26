import { createHash } from "node:crypto";
import { POST as postCompileJob } from "@/app/api/compile-jobs/route";
import { canonicalJson } from "./change-notify";
import type { Failure, ProposalExecutor } from "./change-proposals";
import { compileIdempotencyKey } from "./compile-job-store";
import { COMPILE_MAX_DOCUMENTS } from "./compile-limits";
import { assertFoundationIntakeCompileSet } from "./compute-reservation";
import { checkConnectorSourceAccessForViewer } from "./connector-source-access";
import { CORPUS_ID_PATTERN, judgeCorpusSet, needsCorpusCompile } from "./corpus-batching";
import { canAdmitCustomerSource } from "./customer-data-admission";
import { readCustomerSourceScope } from "./customer-source-scope";
import { groupImmutableDocuments, selectCurrentDocumentVersions } from "./immutable-keys";
import { listImmutableWorkspaceObjects } from "./r2-objects";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { checkTrialCompileCapacity } from "./self-service-trial";
import { readSupabaseAdminConfig, supabaseAdminRequest } from "./supabase-admin";
import { intakePricingFingerprint } from "./usage-pricing";

/*
  `compile_plan` (workorders/agent-native.md §4.2, §4.4; WO-AN-4). An agent proposes compiling a set of
  documents; a person confirms it in a signed-in session; the existing web compile then runs as that person.

  The stored input is the sorted document set and the server's quote of the page-meter re-charge the compile
  would book when it reaches `ready` (rule 4). The preview carries both, so the previewDigest a confirming
  client returns covers the set and the figures it was shown. The binding is the set's current source
  versions plus a fingerprint of the reservations the quote was computed from: a replaced source or a new
  refund between proposal and confirmation makes the decision `stale`.

  Not claimed: the source version is not pinned. The worker reads the current version when it runs, exactly as
  a web compile does; the guard atomic with the effect is the enqueue's own idempotency key.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_ID = /^cjob-[a-f0-9]{32}$/;
/** The compile route's own body bound (`app/api/compile-jobs/route.ts`), existing. */
export const COMPILE_PLAN_MAX_BODY_BYTES = 4_096;

export type CompileQuote = Readonly<{ rechargeCredits: number; balanceRechargeCredits: number; overageCredits: number }>;
export type CompilePlanInput = Readonly<{ documentIds: readonly string[]; quote: CompileQuote }>;

const failure = (code: string, status: number): Failure => ({ ok: false, code, status });
const NOT_FOUND = failure("PROPOSAL_TARGET_NOT_FOUND", 404);
const UNAVAILABLE = failure("PROPOSAL_PRECONDITION_UNAVAILABLE", 503);
/**
 * NOT_FOUND because a read that decides existence could not answer (WO-AN-8): the same code and status, plus a
 * flag that only the agent route's server log reads. Every route answers a Failure by its code alone.
 */
export const READ_FAILED: Failure = Object.assign(failure("PROPOSAL_TARGET_NOT_FOUND", 404), { decidingReadFailed: true as const });

/** For an agent, a deciding read that throws has failed (null); anyone else's throw goes on to `failClosed` (a 503). */
export const decidingRead = (agent: boolean) => async <T>(read: () => Promise<T>): Promise<T | null> => {
  try { return await read(); } catch (error) { if (agent) return null; throw error; }
};
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const credits = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const sha256 = (value: unknown) => `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;

/** The set as the compile route will receive it: what the 4,096-byte bound is measured on. */
const bodyOf = (documentIds: readonly string[]) => JSON.stringify({ documentIds });

/** Lowercase canonical UUIDs, unique, at least one, and a compile body inside the route's bound; sorted. */
function documentSet(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || !raw.every((id) => typeof id === "string" && UUID.test(id))) return null;
  const ids = [...raw as string[]].sort();
  if (new Set(ids).size !== ids.length || Buffer.byteLength(bodyOf(ids), "utf8") > COMPILE_PLAN_MAX_BODY_BYTES) return null;
  return ids;
}

/** The stored input: exactly {documentIds (sorted), quote}; anything else is not a compile plan. */
export function parseCompilePlanInput(raw: unknown): CompilePlanInput | null {
  if (!isObject(raw) || !sameKeys(raw, ["documentIds", "quote"])) return null;
  const ids = documentSet(raw.documentIds);
  if (!ids || ids.some((id, index) => id !== (raw.documentIds as string[])[index])) return null;
  const quote = raw.quote;
  if (!isObject(quote) || !sameKeys(quote, ["rechargeCredits", "balanceRechargeCredits", "overageCredits"])
    || !credits(quote.rechargeCredits) || !credits(quote.balanceRechargeCredits) || !credits(quote.overageCredits)) return null;
  return { documentIds: ids, quote: {
    rechargeCredits: quote.rechargeCredits, balanceRechargeCredits: quote.balanceRechargeCredits, overageCredits: quote.overageCredits,
  } };
}

export function compilePlanPreview(input: CompilePlanInput) {
  const n = input.documentIds.length;
  return { documentIds: [...input.documentIds], documentsTotal: n, corpus: needsCorpusCompile(n), parts: Math.ceil(n / COMPILE_MAX_DOCUMENTS), quote: { ...input.quote } };
}

// ---------------------------------------------------------------------------------------------------------
// The quote (§4.4): quote_foundation_compile_recharge, the recharge trigger's rows and arithmetic.
// ---------------------------------------------------------------------------------------------------------

type Reservation = Readonly<{ reservationId: string; documentId: string; billingSource: string; reversedCredits: number; settledCredits: number; reservedCredits: number }>;
export type RechargeQuote = Readonly<{
  reservations: readonly Reservation[]; totalRechargeCredits: number; balanceRechargeCredits: number; overageCredits: number; balanceCredits: number;
}>;

function asQuote(body: unknown): RechargeQuote | null {
  if (!isObject(body) || !Array.isArray(body.reservations)) return null;
  const { totalRechargeCredits, balanceRechargeCredits, overageCredits, balanceCredits } = body;
  if (!credits(totalRechargeCredits) || !credits(balanceRechargeCredits) || !credits(overageCredits) || !credits(balanceCredits)) return null;
  const reservations: Reservation[] = [];
  for (const row of body.reservations as unknown[]) {
    if (!isObject(row) || typeof row.reservationId !== "string" || typeof row.documentId !== "string" || typeof row.billingSource !== "string"
      || !credits(row.reversedCredits) || !credits(row.settledCredits) || !credits(row.reservedCredits)) return null;
    reservations.push({ reservationId: row.reservationId, documentId: row.documentId, billingSource: row.billingSource,
      reversedCredits: row.reversedCredits, settledCredits: row.settledCredits, reservedCredits: row.reservedCredits });
  }
  return { reservations, totalRechargeCredits, balanceRechargeCredits, overageCredits, balanceCredits };
}

/** The quote, or a 503: an unconfigured, unreachable or malformed answer fails closed and nothing is decided. */
export async function quoteCompileRecharge(workspaceKey: string, documentIds: readonly string[]): Promise<{ ok: true; quote: RechargeQuote } | Failure> {
  const config = readSupabaseAdminConfig();
  if (!config) return UNAVAILABLE;
  try {
    const response = await supabaseAdminRequest(config, "/rest/v1/rpc/quote_foundation_compile_recharge", {
      method: "POST", body: JSON.stringify({ p_workspace_key: workspaceKey, p_document_ids: [...documentIds] }),
    });
    if (!response.ok) return UNAVAILABLE;
    const quote = asQuote(await response.json().catch(() => null));
    return quote ? { ok: true, quote } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

/** The balance must cover the part of the re-charge it pays; the overage part is shown, never refused (§4.4). */
const overBalance = (quote: RechargeQuote) => quote.balanceRechargeCredits > quote.balanceCredits;

/*
  The reservations the quote stands on. Every figure of every row is in it, not only the reversed credits: a
  settlement that moves the balance/overage split changes the figures the person was shown, so it must also
  make the confirmation stale.
*/
async function quoteFingerprint(quote: RechargeQuote): Promise<string> {
  const reservations = quote.reservations
    .map((row) => [row.reservationId, row.reversedCredits, row.settledCredits, row.reservedCredits, row.billingSource] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256({ reservations, pricing: await intakePricingFingerprint() });
}

// ---------------------------------------------------------------------------------------------------------
// The binding: current source versions + quote fingerprint.
// ---------------------------------------------------------------------------------------------------------

type Versions = { ok: true; versions: ReadonlyMap<string, string | null> } | Failure;

/** The current version of each document; null for one that is absent or whose current version is ambiguous. */
async function currentVersions(workspaceKey: string, documentIds: readonly string[]): Promise<Versions> {
  const signer = readR2SignerEnv();
  if (!signer) return UNAVAILABLE;
  const listed = await listImmutableWorkspaceObjects(signer, workspaceKey);
  if (!listed.ok) return UNAVAILABLE;
  const selected = selectCurrentDocumentVersions(groupImmutableDocuments(workspaceKey, listed.objects));
  const ambiguous = new Set(selected.ambiguousDocumentIds);
  const current = new Map(selected.documents.map((document) => [document.documentId, document.versionKey]));
  return { ok: true, versions: new Map(documentIds.map((id) => [id, ambiguous.has(id) ? null : current.get(id) ?? null])) };
}

/*
  The quote preconditions found within the balance, held for the binding of the same decision. Keyed by the
  decision's parsed input object (one per decision, so two decisions never share an entry); a decision that
  stops after its preconditions leaves an entry the WeakMap drops with the input.
*/
const checkedQuotes = new WeakMap<CompilePlanInput, RechargeQuote>();

const bindingOf = async (documentIds: readonly string[], versions: ReadonlyMap<string, string | null>, quote: RechargeQuote) =>
  sha256({ documents: documentIds.map((id) => [id, versions.get(id) ?? null]), quote: await quoteFingerprint(quote) });

// ---------------------------------------------------------------------------------------------------------
// Execution: the existing web compile, in process, as the confirming person.
// ---------------------------------------------------------------------------------------------------------

async function runCompile(request: Request, input: CompilePlanInput) {
  const headers = new Headers({ "content-type": "application/json" });
  // The confirming person's credential only; the proposer never reaches the compile.
  const authorization = request.headers.get("authorization");
  if (authorization !== null) headers.set("authorization", authorization);
  const response = await postCompileJob(new Request(new URL("/api/compile-jobs", request.url), {
    method: "POST", headers, body: bodyOf(input.documentIds),
  }));
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (response.status !== 202) {
    return failure(typeof body?.code === "string" ? body.code : "PROPOSAL_EXECUTOR_FAILED", response.status >= 400 ? response.status : 502);
  }
  if (body?.code === "COMPILE_JOB_ACCEPTED" && typeof body.jobId === "string" && JOB_ID.test(body.jobId)) {
    return { ok: true as const, jobId: body.jobId };
  }
  if (body?.code === "COMPILE_CORPUS_ACCEPTED" && typeof body.corpusId === "string" && CORPUS_ID_PATTERN.test(body.corpusId)
    && (body.incompleteReason === null || typeof body.incompleteReason === "string")) {
    // An incomplete corpus is executed: what was enqueued runs, and the reason is in the receipt.
    return { ok: true as const, corpusId: body.corpusId, incompleteReason: body.incompleteReason };
  }
  return failure("PROPOSAL_EXECUTOR_RESPONSE_INVALID", 502);
}

/**
 * The members the decision path calls outside its own guard fail closed: a throw from any reader they reuse
 * (a signer, a listing, a parser) becomes a 503 refusal, never an unhandled error and never a decision.
 * `run` is guarded by the decision path itself (PROPOSAL_EXECUTOR_FAILED).
 */
export function failClosed<I>(executor: ProposalExecutor<I>): ProposalExecutor<I> {
  const closed = async <T>(work: () => Promise<T>): Promise<T | Failure> => {
    try { return await work(); } catch { return UNAVAILABLE; }
  };
  return {
    ...executor,
    prepare: (actor, raw, evidenceIds) => closed(() => executor.prepare(actor, raw, evidenceIds)),
    currentBinding: (actor, row, input) => closed(() => executor.currentBinding(actor, row, input)),
    preconditions: (actor, row, input) => closed(() => executor.preconditions(actor, row, input)),
  };
}

export const compilePlanExecutor: ProposalExecutor<CompilePlanInput> = failClosed({
  parse: parseCompilePlanInput,
  documentsOf: (input) => [...input.documentIds],
  previewOf: compilePlanPreview,
  bindingKind: "source_inventory",
  /*
    Raw: {documentIds}. The order is the web compile's (access first, so nothing past it discloses whether a
    document exists), then inventory, set size, intake lineage, customer-data admission, trial capacity,
    and the quote. Writes nothing: every call here is a read.

    Access and inventory decide whether the ids name documents this person can read. For an agent, a failure
    of either -- refused, unavailable or thrown -- is that same not-found (§17 (a)): an outage must not tell
    "absent" from "exists but unreadable". Everything after that decision (the quote included) fails as itself.
  */
  async prepare(actor, raw, evidenceIds) {
    if (!isObject(raw) || !sameKeys(raw, ["documentIds"])) return failure("PROPOSAL_REQUEST_INVALID", 400);
    const documentIds = documentSet(raw.documentIds);
    if (!documentIds) return failure("PROPOSAL_REQUEST_INVALID", 400);
    const agent = actor.kind === "agent";
    const deciding = decidingRead(agent);
    const access = await deciding(() => checkConnectorSourceAccessForViewer(actor.workspaceKey, [...documentIds], actor.userId));
    if (!access?.ok) return access?.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? NOT_FOUND : READ_FAILED;
    const inventory = await deciding(() => currentVersions(actor.workspaceKey, documentIds));
    if (!inventory || !inventory.ok) return agent ? READ_FAILED : inventory ?? UNAVAILABLE;
    if (documentIds.some((id) => inventory.versions.get(id) == null)) return NOT_FOUND;
    const verdict = judgeCorpusSet(documentIds.length);
    if (!verdict.ok) return failure(verdict.code, 400);
    const intake = await assertFoundationIntakeCompileSet({ workspaceKey: actor.workspaceKey, userId: actor.userId, documentIds: [...documentIds] });
    if (!intake.ok) return failure(intake.code, intake.status);
    let sourceScope: "direct_upload" | "connector" = "direct_upload";
    if (process.env.TAVONEL_CUSTOMER_DATA_GATE_VERSION === "v2") {
      const source = await readCustomerSourceScope(actor.workspaceKey, documentIds);
      if (!source.ok) return failure(source.code, 503);
      sourceScope = source.scope;
    }
    if (!await canAdmitCustomerSource(actor.workspaceKey, sourceScope)) return failure("CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403);
    if (actor.accessSource === "trial") {
      const capacity = await checkTrialCompileCapacity(actor.workspaceKey, actor.userId, compileIdempotencyKey(actor.workspaceKey, documentIds));
      if (!capacity.ok) return failure(capacity.code, 503);
      if (!capacity.allowed) return failure("TRIAL_WORLD_LIMIT_REACHED", 402);
    }
    const quoted = await quoteCompileRecharge(actor.workspaceKey, documentIds);
    if (!quoted.ok) return quoted;
    if (overBalance(quoted.quote)) return failure("PROPOSAL_QUOTE_OVER_BALANCE", 409);
    const { quote } = quoted;
    return {
      ok: true, collectionId: null, evidenceIds, bindingDigest: await bindingOf(documentIds, inventory.versions, quote),
      input: { documentIds, quote: {
        rechargeCredits: quote.totalRechargeCredits, balanceRechargeCredits: quote.balanceRechargeCredits, overageCredits: quote.overageCredits,
      } },
    };
  },
  /*
    An absent or ambiguous document binds as null, so a source removed since the proposal decides `stale`.
    A confirmation takes one quote (§17 (b)): the one preconditions refused over the balance on is the one bound
    here. A rejection runs no preconditions, quotes here, and is never refused for the balance.
  */
  async currentBinding(actor, _row, input) {
    const inventory = await currentVersions(actor.workspaceKey, input.documentIds);
    if (!inventory.ok) return inventory;
    const held = checkedQuotes.get(input);
    checkedQuotes.delete(input);
    const quoted = held ? { ok: true as const, quote: held } : await quoteCompileRecharge(actor.workspaceKey, input.documentIds);
    if (!quoted.ok) return quoted;
    return { ok: true, digest: await bindingOf(input.documentIds, inventory.versions, quoted.quote) };
  },
  /* Re-quote before the decision: over the balance now is a refusal and the row stays proposed. */
  async preconditions(actor, _row, input) {
    const quoted = await quoteCompileRecharge(actor.workspaceKey, input.documentIds);
    if (!quoted.ok) return quoted;
    if (overBalance(quoted.quote)) return failure("PROPOSAL_QUOTE_OVER_BALANCE", 409);
    checkedQuotes.set(input, quoted.quote);
    return null;
  },
  run: ({ request, input }) => runCompile(request, input),
  resultRef: (result) => typeof result.jobId === "string"
    ? { jobId: result.jobId }
    : { corpusId: result.corpusId, incompleteReason: result.incompleteReason },
});
