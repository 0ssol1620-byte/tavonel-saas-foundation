import { listOAuthSourcePage, OAUTH_SOURCE_PAGE_SIZE, type OAuthSourcePage, type OAuthSourceTarget } from "./connector-oauth-adapters";
import { canAdmitCustomerSource } from "./customer-data-admission";
import { readOAuthProviderRuntime, refreshOAuthAccessToken } from "./connector-oauth";
import { readOAuthSecret, readOAuthSecretBrokerConfig } from "./connector-oauth-secrets";
import { getOAuthConnectionSecretReference, markOAuthConnectionReauthorizationRequired } from "./connector-oauth-store";
import { completeJobBatch, type ClaimedJob } from "./job-store";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { importSourceObject } from "./source-import";
import { requestConnectorSourceDeletion, suspendConnectorSource } from "./connector-source-access";
import { loadConnectorSyncPage } from "./connector-sync-page";
import { listGoogleDriveLifecyclePage } from "./google-drive-lifecycle";
import { reconcileDropboxSourcePage } from "./dropbox-source-reconciliation";
import { dropboxReconciliationEnabled } from "./dropbox-reconciliation-switch";

// The worker that actually moves a connector sync forward.
//
// The shape of this function is dictated by one constraint: it runs inside a serverless
// invocation with a wall clock, so it must do a BOUNDED amount of work and then durably
// record where it got to. It is not a loop that finishes the job; it is one turn of a crank
// that many invocations turn.
//
// Two bounds, both deliberate:
//
//   * Items per batch. One provider page can inspect 25 entries, while at most five admitted
//     sources move bytes in a turn. Unsupported entries are cheap to skip and must not make a
//     sparse Drive take hours to scan.
//
//   * Cursor commit. The cursor advances ONLY in the same call that records the batch's
//     progress, and only after every import in the batch has been durably admitted. A worker
//     that lists a page and dies before admitting leaves the cursor where it was, so the page
//     is re-read. The opposite order -- commit cursor, then import -- is the lost-update bug
//     that makes a sync report success while silently skipping files.

export const SYNC_BATCH_SIZE = OAUTH_SOURCE_PAGE_SIZE;
export const SYNC_IMPORT_LIMIT = 5;
const SYNC_CURSOR_PREFIX = "tavonel-sync-v1:";
const MAX_SYNC_CURSOR_CHARS = 4096;

/*
  Re-inventory after a dead continuation (WO-E-CON-1: Graph 410 resync, Dropbox 409 reset).

  The adapter answers OAUTH_SOURCE_RESYNC_REQUIRED only when the provider says the cursor it was
  sent can no longer be served. The worker then lists again from the reader's own first request
  -- never the dead checkpoint, never a provider-supplied Location -- as a numbered round whose
  pages live under their own durable keys (a round's first page would otherwise share the key of
  the job's original first page and replay it).

  A re-inventory never purges. A source the fresh listing does not name keeps its binding and
  stays readable: only a removal the provider reports on a page (a deleted facet, a
  DeletedMetadata resolved by reconciliation) suspends anything, exactly as on a normal page.

  Bounded, start values, uncalibrated: REINVENTORY_PAGE_LIMIT provider pages per round and
  REINVENTORY_ROUND_LIMIT rounds per job (a second reset during a round starts the next round).
  Past either bound the job stops as failed with SOURCE_REINVENTORY_BOUND_EXCEEDED -- a named,
  visible state for an operator (docs/runbooks/INTAKE_APPROVAL_MIGRATIONS.md), never a retry of
  the dead checkpoint. An outage (5xx, 429, timeout) is not a resync: SOURCE_LIST_FAILED, retried
  with the checkpoint held.

  The round travels in the job cursor as tavonel-resync-v1:<round>:<pages>:<offset>:<provider
  cursor>. Only the page that ends the listing commits a bare provider cursor, so a succeeded job
  never leaves a round token as the connection checkpoint.
*/
const RESYNC_CURSOR_PREFIX = "tavonel-resync-v1:";
export const REINVENTORY_PAGE_LIMIT = 400;
export const REINVENTORY_ROUND_LIMIT = 2;

export type SyncBatchResult = {
  state: string;
  scanned: number;
  imported: number;
  skipped: Array<{ nativeId: string; code: string }>;
  complete: boolean;
  /** Present only on the turn that started a re-inventory round. */
  reinventoryRound?: number;
};

export type SyncBatchFailure = { code: string; detail?: string };

function targetFromPayload(payload: Record<string, unknown>): OAuthSourceTarget {
  const raw = (payload.target ?? {}) as Record<string, unknown>;
  const target: OAuthSourceTarget = {};
  for (const key of ["rootPath", "driveId", "siteId"] as const) {
    if (typeof raw[key] === "string") target[key] = raw[key];
  }
  return target;
}

type Reinventory = { round: number; pages: number };
type SyncCursor = { providerCursor: string | null; pageOffset: number; resync: Reinventory | null };
const PERMANENT_SOURCE_SKIPS = new Set([
  "SOURCE_NOT_QUALIFIED",
  "SOURCE_TOO_LARGE",
  "SOURCE_NATIVE_TYPE_UNSUPPORTED",
  "SOURCE_SIZE_UNQUALIFIED",
  /*
    The provider affirmatively named a different current revision, or no longer has the file. The
    page is a stored snapshot, so retrying it would refuse the same stale entry forever; the change
    feed delivers the newer revision or the deletion after this page's cursor. Nothing is bound.
  */
  "SOURCE_REVISION_SUPERSEDED",
]);
/*
  Refusals that wait for capacity rather than spend the job's retry budget: the daily intake quota
  rolls with the day, and a workspace at its plan's storage allowance (WO-CAT-8) has room again once
  sources are deleted. Retrying either at once fails the same way until attempts run out.
*/
const CAPACITY_DEFERRALS = new Set(["INTAKE_DAILY_QUOTA_EXCEEDED", "STORAGE_ALLOWANCE_EXHAUSTED"]);
const CAPACITY_RETRY_SECONDS = 60 * 60;

function decodeSyncCursor(cursorToken: string | null): SyncCursor | null {
  if (!cursorToken) return { providerCursor: null, pageOffset: 0, resync: null };
  if (cursorToken.startsWith(RESYNC_CURSOR_PREFIX)) {
    // A token this worker wrote; anything out of range is refused, never clamped.
    const fields = cursorToken.slice(RESYNC_CURSOR_PREFIX.length).split(":");
    if (fields.length < 4) return null;
    const [round = NaN, pages = NaN, pageOffset = NaN] = fields.slice(0, 3)
      .map(field => /^(0|[1-9][0-9]{0,5})$/.test(field) ? Number(field) : NaN);
    if (!(round >= 1 && round <= REINVENTORY_ROUND_LIMIT) || !(pages >= 0 && pages <= REINVENTORY_PAGE_LIMIT)
      || !(pageOffset >= 0)) return null;
    return { providerCursor: fields.slice(3).join(":") || null, pageOffset, resync: { round, pages } };
  }
  if (!cursorToken.startsWith(SYNC_CURSOR_PREFIX)) {
    return { providerCursor: cursorToken, pageOffset: 0, resync: null };
  }

  const separator = cursorToken.indexOf(":", SYNC_CURSOR_PREFIX.length);
  if (separator < 0) return null;
  const rawOffset = cursorToken.slice(SYNC_CURSOR_PREFIX.length, separator);
  const pageOffset = Number(rawOffset);
  if (!Number.isSafeInteger(pageOffset) || pageOffset <= 0) return null;

  const providerCursor = cursorToken.slice(separator + 1) || null;
  return { providerCursor, pageOffset, resync: null };
}

function encodeSyncCursor(providerCursor: string | null, pageOffset: number): string | null {
  if (pageOffset === 0) return providerCursor;
  const encoded = `${SYNC_CURSOR_PREFIX}${pageOffset}:${providerCursor ?? ""}`;
  return encoded.length <= MAX_SYNC_CURSOR_CHARS ? encoded : null;
}

function encodeResyncCursor(resync: Reinventory, providerCursor: string | null, pageOffset: number): string | null {
  const encoded = `${RESYNC_CURSOR_PREFIX}${resync.round}:${resync.pages}:${pageOffset}:${providerCursor ?? ""}`;
  return encoded.length <= MAX_SYNC_CURSOR_CHARS ? encoded : null;
}

/** The cursor a page is stored and reconciled under: a round's pages never share a key with the job's own. */
function pageKeyCursor(resume: SyncCursor): string | null {
  return resume.resync ? `${RESYNC_CURSOR_PREFIX}${resume.resync.round}:${resume.providerCursor ?? ""}` : resume.providerCursor;
}

// Mirrors reconcile_dropbox_source_page: a DeletedMetadata removes its path and every descendant.
function removedLaterOnPage(page: OAuthSourcePage, index: number): boolean {
  const path = page.items[index]?.providerPath;
  if (!path) return false;
  return page.items.slice(index + 1).some(later => later.kind === "deleted" && later.providerPath !== undefined
    && (path === later.providerPath || path.startsWith(`${later.providerPath}/`)));
}

// Runs one batch for a claimed source_import job and reports the outcome through the queue.
//
// Every exit path goes through completeJobBatch, so a job never silently stops holding a
// lease: it either keeps it with progress, releases it as succeeded, or releases it for
// retry with a code. The one thing this must never do is return without reporting.
export async function runSourceImportBatch(
  job: ClaimedJob,
  workerId: string,
  deps: { fetcher?: typeof fetch } = {},
): Promise<{ ok: true; value: SyncBatchResult } | { ok: false; code: string }> {
  const fetcher = deps.fetcher ?? fetch;

  if (!job.oauthConnectionId) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "JOB_CONNECTION_MISSING",
    });
    return { ok: false, code: "JOB_CONNECTION_MISSING" };
  }

  // A queued job can be claimed after its workspace approval was revoked. Settle it before
  // refreshing credentials, listing source metadata, or moving any provider bytes.
  if (!await canAdmitCustomerSource(job.workspaceKey, "connector")) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE",
    });
    return { ok: false, code: "CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE" };
  }

  const binding = await getOAuthConnectionSecretReference(job.workspaceKey, job.oauthConnectionId);
  if (!binding.ok) {
    // A revoked or deleted connection is permanent: retrying cannot make it reappear, and a
    // job that retries forever against a deleted source is noise in every dashboard.
    const permanent = binding.code === "OAUTH_CONNECTION_NOT_FOUND";
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: permanent ? "failed" : "retry",
      errorCode: binding.code,
    });
    return { ok: false, code: binding.code };
  }

  // The provider comes from the stored connection, never from the job. A reader bound to one
  // provider must not run on another provider's credential, and Google is readable only through
  // the change-feed reader: its legacy files listing hides trashed files instead of reporting a
  // tombstone. Refused before any credential is read, so a mismatched job never holds a token.
  const lifecycleReader = job.payload.sourceReaderVersion === "google-lifecycle-v2";
  if ((binding.provider === "google_drive") !== lifecycleReader) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "SOURCE_READER_PROVIDER_MISMATCH",
    });
    return { ok: false, code: "SOURCE_READER_PROVIDER_MISMATCH" };
  }

  const runtime = readOAuthProviderRuntime(binding.provider);
  const broker = readOAuthSecretBrokerConfig();
  const signer = readR2SignerEnv();
  if (!runtime || !broker || !signer) {
    // Missing configuration is an operator problem, not a source problem: retry so the job
    // resumes once the deployment is configured, rather than dying.
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "retry",
      errorCode: "OAUTH_SYNC_NOT_CONFIGURED",
    });
    return { ok: false, code: "OAUTH_SYNC_NOT_CONFIGURED" };
  }

  let accessToken: string;
  try {
    const [refreshToken, clientSecret] = await Promise.all([
      readOAuthSecret(broker, binding.refreshTokenReference),
      readOAuthSecret(broker, runtime.clientSecretReference),
    ]);
    const tokenSet = await refreshOAuthAccessToken({ runtime, refreshToken, clientSecret });
    accessToken = tokenSet.accessToken;
  } catch {
    // Could be a transient broker failure or a revoked grant. Retry with backoff; the
    // attempt ceiling turns a genuinely revoked grant into a dead job rather than a loop.
    const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "retry",
      errorCode: "OAUTH_TOKEN_REFRESH_FAILED",
    });
    // This catch cannot tell a withdrawn grant from a broker blip, so only the terminal
    // attempt speaks for the connection: sending an owner to a re-authorization screen
    // because the secret broker was briefly unreachable would be a worse lie than silence.
    // The queue owns the ceiling, so this reads its answer instead of re-deriving it.
    // ponytail: the terminal attempt is a heuristic for "the grant is gone" -- a broker that
    // is down for the whole backoff window flips a valid connection. Upgrade path is reading
    // `error=invalid_grant` out of the token response in connector-oauth.ts and classifying
    // it apart from every transport failure; then this can flag on the first refusal.
    if (reported.ok && reported.value.state === "dead") {
      const marked = await markOAuthConnectionReauthorizationRequired({
        workspaceKey: job.workspaceKey,
        userId: String(job.payload.userId ?? ""),
        oauthConnectionId: job.oauthConnectionId,
        errorCode: "OAUTH_TOKEN_REFRESH_FAILED",
      });
      // The job is already durably dead; a failed flag leaves the connection reading
      // "active" with a dead job beside it, which is visible but wrong. Say so out loud.
      if (!marked.ok) console.error("OAuth reauthorization flag failed", { jobId: job.jobId, code: marked.code });
    }
    return { ok: false, code: "OAUTH_TOKEN_REFRESH_FAILED" };
  }

  const target = targetFromPayload(job.payload);

  // Offsets refer to the durably observed provider page, never a new mutable listing.
  const resume = decodeSyncCursor(job.cursorToken);
  if (!resume) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "JOB_CURSOR_INVALID",
    });
    return { ok: false, code: "JOB_CURSOR_INVALID" };
  }
  if (resume.resync && resume.resync.pages >= REINVENTORY_PAGE_LIMIT) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed", errorCode: "SOURCE_REINVENTORY_BOUND_EXCEEDED",
      errorDetail: `round ${resume.resync.round}: ${REINVENTORY_PAGE_LIMIT} pages`,
    });
    return { ok: false, code: "SOURCE_REINVENTORY_BOUND_EXCEEDED" };
  }

  let page: OAuthSourcePage;
  try {
    page = await loadConnectorSyncPage(job, workerId, pageKeyCursor(resume), resume.pageOffset, () => {
      if (lifecycleReader) {
        if (target.rootPath || target.siteId) throw new Error("OAUTH_SOURCE_TARGET_UNSUPPORTED");
        return listGoogleDriveLifecyclePage({ accessToken, cursor: resume.providerCursor,
          driveId: target.driveId, fetcher });
      }
      return listOAuthSourcePage({ provider: binding.provider, accessToken, cursor: resume.providerCursor, target });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "OAUTH_SOURCE_RESYNC_REQUIRED") {
      const round = (resume.resync?.round ?? 0) + 1;
      if (round > REINVENTORY_ROUND_LIMIT) {
        await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
          outcome: "failed", errorCode: "SOURCE_REINVENTORY_BOUND_EXCEEDED", errorDetail: `${REINVENTORY_ROUND_LIMIT} rounds`,
        });
        return { ok: false, code: "SOURCE_REINVENTORY_BOUND_EXCEEDED" };
      }
      // Nothing is listed, imported, suspended or deleted on this turn: the round starts on the next.
      const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
        outcome: "progress", itemsSeen: 0, itemsDone: 0, cursorToken: encodeResyncCursor({ round, pages: 0 }, null, 0),
      });
      if (!reported.ok) return { ok: false, code: reported.code };
      return { ok: true, value: { state: reported.value.state, scanned: 0, imported: 0, skipped: [], complete: false, reinventoryRound: round } };
    }
    const code = error instanceof Error && ["CONNECTOR_PAGE_STORE_UNAVAILABLE", "CONNECTOR_PAGE_INVALID", "CONNECTOR_PAGE_LEGACY_REVIEW_REQUIRED", "OAUTH_SOURCE_PAGE_INVALID", "OAUTH_SOURCE_CURSOR_INVALID", "OAUTH_SOURCE_CURSOR_STALLED", "OAUTH_SOURCE_TARGET_UNSUPPORTED"].includes(error.message)
      ? error.message : "SOURCE_LIST_FAILED";
    const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: ["CONNECTOR_PAGE_INVALID", "CONNECTOR_PAGE_LEGACY_REVIEW_REQUIRED", "OAUTH_SOURCE_TARGET_UNSUPPORTED"].includes(code) ? "failed" : "retry",
      errorCode: code,
    });
    return { ok: false, code: reported.ok ? code : reported.code };
  }

  if (resume.pageOffset >= page.items.length && resume.pageOffset > 0) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "SOURCE_CURSOR_STALE",
    });
    return { ok: false, code: "SOURCE_CURSOR_STALE" };
  }

  // A removal may also mean lost access. Until source identity and revocation are
  // durably connected, consuming it as an unsupported file would lose the event.
  // Inspect the remaining page before admitting bytes or advancing any checkpoint.
  //
  // Dropbox names a removal by path alone. Its whole stored page goes through reconciliation on
  // every turn (a replay returns the page's receipt): removals resolve to the id observed at that
  // path and wait for the listing boundary, so a move split across pages keeps its source. Every
  // other provider removes by stable id, immediately.
  //
  // Reconciliation needs migration 20261007100000, so it ships behind its own switch
  // (lib/dropbox-reconciliation-switch.ts), apart from the upload-approval lineage. Off, Dropbox
  // takes main dbe22b1e's path in the else branch: the adapter keeps main's DeletedMetadata mapping
  // (nativeId = path_lower), the removal is suspended by that id at once, and
  // reconcile_dropbox_source_page is never called.
  const reconcileDropbox = binding.provider === "dropbox" && dropboxReconciliationEnabled();
  let removals: Array<{ nativeId: string; reason: "provider_deleted" | "provider_inaccessible" }> = [];
  if (reconcileDropbox) {
    const reconciled = await reconcileDropboxSourcePage(job, workerId, pageKeyCursor(resume));
    if (!reconciled.ok) {
      // An unresolved or legacy path is not retryable into meaning; neither outcome moves the cursor.
      const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
        // A non-canonical stream (DROPBOX_SOURCE_STREAM_INVALID) is refused the same way. A store
        // outage and a database without the migration are operational: retried, checkpoint held.
        outcome: ["DROPBOX_SOURCE_RECONCILIATION_UNAVAILABLE", "DROPBOX_SOURCE_RECONCILIATION_MIGRATION_MISSING"]
          .includes(reconciled.code) ? "retry" : "failed",
        errorCode: reconciled.code,
      });
      return { ok: false, code: reported.ok ? reconciled.code : reported.code };
    }
    removals = reconciled.suspend.map(nativeId => ({ nativeId, reason: "provider_deleted" as const }));
  } else {
    for (const item of page.items.slice(resume.pageOffset)) {
      if (item.kind !== "deleted") continue;
      if (item.nativeId === null) {
        // Only Dropbox has a reconciler for path-only removals; never acknowledge one silently.
        await completeJobBatch(job.workspaceKey, job.jobId, workerId, { outcome: "failed", errorCode: "CONNECTOR_PAGE_INVALID" });
        return { ok: false, code: "CONNECTOR_PAGE_INVALID" };
      }
      removals.push({ nativeId: item.nativeId,
        reason: "removalReason" in item && item.removalReason === "removed_or_inaccessible" ? "provider_inaccessible" : "provider_deleted" });
    }
  }
  for (const removal of removals) {
    const suspended = await suspendConnectorSource({ workspaceKey: job.workspaceKey,
      connectionId: job.oauthConnectionId, provider: binding.provider, nativeId: removal.nativeId });
    if (!suspended.ok) {
      const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
        outcome: "retry", errorCode: suspended.code,
      });
      return { ok: false, code: reported.ok ? suspended.code : reported.code };
    }
    const deleted = await requestConnectorSourceDeletion({
      workspaceKey: job.workspaceKey,
      connectionId: job.oauthConnectionId,
      provider: binding.provider,
      nativeId: removal.nativeId,
      reason: removal.reason,
    });
    if (!deleted.ok) {
      const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
        outcome: "retry", errorCode: deleted.code,
      });
      return { ok: false, code: reported.ok ? deleted.code : reported.code };
    }
  }
  const batch = page.items.slice(resume.pageOffset, resume.pageOffset + SYNC_BATCH_SIZE);
  const skipped: Array<{ nativeId: string; code: string }> = [];
  let imported = 0;
  let processed = 0;

  for (const [index, item] of batch.entries()) {
    if (item.kind === "deleted") {
      // Suspension and the legal-hold-gated tombstone were committed in the pre-pass above.
      // Counting the event advances the durable page offset without ever treating it as bytes.
      processed += 1;
      continue;
    }
    // list_folder is ordered: a removal of this path (or an ancestor) later on the same page
    // ends this entry, and reconciliation already staged it. Importing it would bind a source
    // the boundary has already judged.
    if (reconcileDropbox && removedLaterOnPage(page, resume.pageOffset + index)) {
      processed += 1;
      continue;
    }
    const outcome = await importSourceObject(
      {
        workspaceKey: job.workspaceKey,
        userId: job.payload.userId as string,
        connectionId: job.oauthConnectionId,
        provider: binding.provider,
        accessToken,
        target,
        signer,
        fetcher,
      },
      item,
    );
    processed += 1;
    if (outcome.ok) {
      imported += 1;
      if (imported >= SYNC_IMPORT_LIMIT) break;
      continue;
    }
    skipped.push({ nativeId: outcome.nativeId, code: outcome.code });
    if (!PERMANENT_SOURCE_SKIPS.has(outcome.code)) {
      const batchOutcome = CAPACITY_DEFERRALS.has(outcome.code)
        ? { outcome: "deferred" as const, errorCode: outcome.code, retryAfterSeconds: CAPACITY_RETRY_SECONDS }
        : { outcome: "retry" as const, errorCode: outcome.code };
      const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, batchOutcome);
      return { ok: false, code: reported.ok ? outcome.code : reported.code };
    }
  }

  // Only now, with the batch durably admitted, does the checkpoint move. A large page keeps
  // the provider cursor fixed and advances its in-page offset; the provider cursor advances
  // only after the final item in that page has been admitted.
  const nextPageOffset = resume.pageOffset + processed;
  const consumedWholePage = nextPageOffset === page.items.length;
  const complete = page.complete && consumedWholePage;
  // Inside a round every commit carries the round, and a page boundary counts against its bound;
  // the page that ends the listing commits the bare provider cursor and the round is over.
  const resync = resume.resync;
  const nextCursor = complete || !resync
    ? (consumedWholePage ? page.cursor : encodeSyncCursor(resume.providerCursor, nextPageOffset))
    : consumedWholePage
      ? (page.cursor ? encodeResyncCursor({ round: resync.round, pages: resync.pages + 1 }, page.cursor, 0) : null)
      : encodeResyncCursor(resync, resume.providerCursor, nextPageOffset);
  if (!nextCursor && (!consumedWholePage || resync)) {
    const code = consumedWholePage && !page.cursor ? "CONNECTOR_PAGE_INVALID" : "SOURCE_CURSOR_TOO_LARGE";
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: code,
    });
    return { ok: false, code };
  }

  const reported = await completeJobBatch(
    job.workspaceKey,
    job.jobId,
    workerId,
    complete
      ? { outcome: "succeeded", itemsSeen: processed, itemsDone: imported, cursorToken: nextCursor }
      : { outcome: "progress", itemsSeen: processed, itemsDone: imported, cursorToken: nextCursor },
  );
  if (!reported.ok) return { ok: false, code: reported.code };

  return {
    ok: true,
    value: {
      state: reported.value.state,
      scanned: processed,
      imported,
      skipped: skipped.slice(0, 20),
      complete,
    },
  };
}
