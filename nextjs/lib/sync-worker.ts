import { listOAuthSourcePage, type OAuthSourceItem, type OAuthSourceTarget } from "./connector-oauth-adapters";
import { readOAuthProviderRuntime, refreshOAuthAccessToken } from "./connector-oauth";
import { readOAuthSecret, readOAuthSecretBrokerConfig } from "./connector-oauth-secrets";
import { getOAuthConnectionSecretReference } from "./connector-oauth-store";
import { completeJobBatch, type ClaimedJob } from "./job-store";
import { readR2SignerEnv } from "./r2-synthetic-canary";
import { importSourceObject } from "./source-import";

// The worker that actually moves a connector sync forward.
//
// The shape of this function is dictated by one constraint: it runs inside a serverless
// invocation with a wall clock, so it must do a BOUNDED amount of work and then durably
// record where it got to. It is not a loop that finishes the job; it is one turn of a crank
// that many invocations turn.
//
// Two bounds, both deliberate:
//
//   * Items per batch. Each import is a download plus an upload, so a batch of 25 is sized
//     to finish comfortably inside a 60-second invocation with room for the provider being
//     slow. Exceeding the lease is not a correctness problem -- another worker reclaims and
//     re-reads the page, and deterministic document ids make that a no-op -- but it is
//     wasted work.
//
//   * Cursor commit. The cursor advances ONLY in the same call that records the batch's
//     progress, and only after every import in the batch has been durably admitted. A worker
//     that lists a page and dies before admitting leaves the cursor where it was, so the page
//     is re-read. The opposite order -- commit cursor, then import -- is the lost-update bug
//     that makes a sync report success while silently skipping files.

export const SYNC_BATCH_SIZE = 25;

export type SyncBatchResult = {
  state: string;
  scanned: number;
  imported: number;
  skipped: Array<{ nativeId: string; code: string }>;
  complete: boolean;
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
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "retry",
      errorCode: "OAUTH_TOKEN_REFRESH_FAILED",
    });
    return { ok: false, code: "OAUTH_TOKEN_REFRESH_FAILED" };
  }

  const target = targetFromPayload(job.payload);

  // Resume exactly where the last committed batch left off.
  let page: { items: OAuthSourceItem[]; cursor: string | null; complete: boolean };
  try {
    page = await listOAuthSourcePage({
      provider: binding.provider,
      accessToken,
      cursor: job.cursorToken,
      target,
    });
  } catch {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "retry",
      errorCode: "SOURCE_LIST_FAILED",
    });
    return { ok: false, code: "SOURCE_LIST_FAILED" };
  }

  const batch = page.items.slice(0, SYNC_BATCH_SIZE);
  const skipped: Array<{ nativeId: string; code: string }> = [];
  let imported = 0;

  for (const item of batch) {
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
    if (outcome.ok) imported += 1;
    else skipped.push({ nativeId: outcome.nativeId, code: outcome.code });
  }

  // Only now, with the batch durably admitted, does the cursor move. If the page held more
  // items than one batch, the cursor deliberately does NOT advance -- the next turn re-reads
  // the same page and the deterministic document ids make the already-imported prefix a
  // no-op. Correctness over efficiency: never skip, even at the cost of a re-read.
  const consumedWholePage = batch.length === page.items.length;
  const complete = page.complete && consumedWholePage;
  const nextCursor = consumedWholePage ? page.cursor : job.cursorToken;

  const reported = await completeJobBatch(
    job.workspaceKey,
    job.jobId,
    workerId,
    complete
      ? { outcome: "succeeded", itemsSeen: batch.length, itemsDone: imported, cursorToken: nextCursor }
      : { outcome: "progress", itemsSeen: batch.length, itemsDone: imported, cursorToken: nextCursor },
  );
  if (!reported.ok) return { ok: false, code: reported.code };

  return {
    ok: true,
    value: {
      state: reported.value.state,
      scanned: batch.length,
      imported,
      skipped: skipped.slice(0, 20),
      complete,
    },
  };
}
