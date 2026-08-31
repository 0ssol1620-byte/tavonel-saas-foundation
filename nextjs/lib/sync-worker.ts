import { listOAuthSourcePage, OAUTH_SOURCE_PAGE_SIZE, type OAuthSourceItem, type OAuthSourceTarget } from "./connector-oauth-adapters";
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
//   * Items per batch. Each import is a download plus an upload. Five items matches the
//     production intake admission window, so one cron turn never consumes the sixth request
//     and silently skips it as rate-limited.
//
//   * Cursor commit. The cursor advances ONLY in the same call that records the batch's
//     progress, and only after every import in the batch has been durably admitted. A worker
//     that lists a page and dies before admitting leaves the cursor where it was, so the page
//     is re-read. The opposite order -- commit cursor, then import -- is the lost-update bug
//     that makes a sync report success while silently skipping files.

export const SYNC_BATCH_SIZE = OAUTH_SOURCE_PAGE_SIZE;
const SYNC_CURSOR_PREFIX = "tavonel-sync-v1:";
const MAX_SYNC_CURSOR_CHARS = 4096;

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

type SyncCursor = { providerCursor: string | null; pageOffset: number };
const PERMANENT_SOURCE_SKIPS = new Set([
  "SOURCE_NOT_QUALIFIED",
  "SOURCE_TOO_LARGE",
  "SOURCE_NATIVE_TYPE_UNSUPPORTED",
  "SOURCE_SIZE_UNQUALIFIED",
]);

function decodeSyncCursor(cursorToken: string | null): SyncCursor | null {
  if (!cursorToken) return { providerCursor: null, pageOffset: 0 };
  if (!cursorToken.startsWith(SYNC_CURSOR_PREFIX)) {
    return { providerCursor: cursorToken, pageOffset: 0 };
  }

  const separator = cursorToken.indexOf(":", SYNC_CURSOR_PREFIX.length);
  if (separator < 0) return null;
  const rawOffset = cursorToken.slice(SYNC_CURSOR_PREFIX.length, separator);
  const pageOffset = Number(rawOffset);
  if (!Number.isSafeInteger(pageOffset) || pageOffset <= 0) return null;

  const providerCursor = cursorToken.slice(separator + 1) || null;
  return { providerCursor, pageOffset };
}

function encodeSyncCursor(providerCursor: string | null, pageOffset: number): string | null {
  if (pageOffset === 0) return providerCursor;
  const encoded = `${SYNC_CURSOR_PREFIX}${pageOffset}:${providerCursor ?? ""}`;
  return encoded.length <= MAX_SYNC_CURSOR_CHARS ? encoded : null;
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

  // Resume exactly where the last committed batch left off. Legacy jobs store only the
  // provider cursor; newer jobs can also checkpoint an offset inside a large provider page.
  const resume = decodeSyncCursor(job.cursorToken);
  if (!resume) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "JOB_CURSOR_INVALID",
    });
    return { ok: false, code: "JOB_CURSOR_INVALID" };
  }

  let page: { items: OAuthSourceItem[]; cursor: string | null; complete: boolean };
  try {
    page = await listOAuthSourcePage({
      provider: binding.provider,
      accessToken,
      cursor: resume.providerCursor,
      target,
    });
  } catch {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "retry",
      errorCode: "SOURCE_LIST_FAILED",
    });
    return { ok: false, code: "SOURCE_LIST_FAILED" };
  }

  if (resume.pageOffset >= page.items.length && resume.pageOffset > 0) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "SOURCE_CURSOR_STALE",
    });
    return { ok: false, code: "SOURCE_CURSOR_STALE" };
  }

  const batch = page.items.slice(resume.pageOffset, resume.pageOffset + SYNC_BATCH_SIZE);
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
    if (outcome.ok) {
      imported += 1;
      continue;
    }
    skipped.push({ nativeId: outcome.nativeId, code: outcome.code });
    if (!PERMANENT_SOURCE_SKIPS.has(outcome.code)) {
      const reported = await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
        outcome: "retry",
        errorCode: outcome.code,
      });
      return { ok: false, code: reported.ok ? outcome.code : reported.code };
    }
  }

  // Only now, with the batch durably admitted, does the checkpoint move. A large page keeps
  // the provider cursor fixed and advances its in-page offset; the provider cursor advances
  // only after the final item in that page has been admitted.
  const nextPageOffset = resume.pageOffset + batch.length;
  const consumedWholePage = nextPageOffset === page.items.length;
  const complete = page.complete && consumedWholePage;
  const nextCursor = consumedWholePage
    ? page.cursor
    : encodeSyncCursor(resume.providerCursor, nextPageOffset);
  if (!consumedWholePage && !nextCursor) {
    await completeJobBatch(job.workspaceKey, job.jobId, workerId, {
      outcome: "failed",
      errorCode: "SOURCE_CURSOR_TOO_LARGE",
    });
    return { ok: false, code: "SOURCE_CURSOR_TOO_LARGE" };
  }

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
