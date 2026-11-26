import { cdrAuthorization } from "./identity";

/*
  Best-effort pre-warm of the two scale-to-zero services a document passes through.

  Both the CDR Cloud Run service (`minScale 0`) and the RunPod OCR endpoint (0 active workers) boot
  from nothing, and a first upload after an idle period pays for both boots in sequence. The first
  queued source of a workspace asks each of them to start now, in parallel with its own CDR call,
  so the GPU is booting while LibreOffice converts instead of after.

  This spends a few GPU seconds, so it is OFF unless TAVONEL_CDR_PREWARM is exactly "1" -- any other
  value, including "true", "yes" or " 1", leaves it off. A warm-up can never fail or delay a
  document: every error is swallowed and only counted, and the caller does not await it.
  At most one warm-up per workspace per 60 s, per isolate (ponytail: an isolate-local map, so
  two isolates may each warm once in a window; a shared limiter only if that ever shows in the bill).
  Nothing here logs a header, a token or a URL.
*/

export type PrewarmEnv = {
  TAVONEL_CDR_PREWARM?: string;
  TAVONEL_CDR_HEALTH_URL: string;
  FOUNDATION_CDR_IDENTITY_HMAC?: string;
  FOUNDATION_OCR_URL?: string;
  RUNPOD_API_KEY?: string;
};

export const PREWARM_WINDOW_MS = 60_000;
const PREWARM_TIMEOUT_MS = 10_000;
const MAX_TRACKED_WORKSPACES = 256;

const lastWarmedAt = new Map<string, number>();

/** Counted, never thrown: how often a warm-up was sent, answered, failed or held back. */
export const prewarmCounts = { fired: 0, answered: 0, failed: 0, throttled: 0 };

export function resetPrewarmState(): void {
  lastWarmedAt.clear();
  prewarmCounts.fired = prewarmCounts.answered = prewarmCounts.failed = prewarmCounts.throttled = 0;
}

type Target = "cdr" | "ocr";

function record(target: Target, outcome: "answered" | "failed", status: number | null): void {
  prewarmCounts[outcome] += 1;
  try { console.log(JSON.stringify({ log: "prewarm", target, outcome, status })); } catch { /* logging must not matter */ }
}

async function touch(
  target: Target, url: string, headers: Record<string, string>, okStatuses: (status: number) => boolean, fetcher: typeof fetch,
): Promise<void> {
  try {
    const response = await fetcher(url, { method: "GET", redirect: "manual", headers, signal: AbortSignal.timeout(PREWARM_TIMEOUT_MS) });
    await response.body?.cancel().catch(() => undefined);
    record(target, okStatuses(response.status) ? "answered" : "failed", response.status);
  } catch {
    record(target, "failed", null);
  }
}

/** The workspace segment of `quarantine/<workspace>/<document>/source`, or null for any other key. */
function workspaceOf(objectKey: string): string | null {
  const parts = objectKey.split("/");
  return parts.length >= 4 && parts[0] === "quarantine" && parts[1] ? parts[1] : null;
}

/**
 * Fire the warm-up and resolve when it is done. Never rejects; the caller hands the promise to
 * `waitUntil` and does not await it.
 */
export async function prewarmServices(
  env: PrewarmEnv, objectKey: string, fetcher: typeof fetch, now: number = Date.now(),
): Promise<void> {
  if (env.TAVONEL_CDR_PREWARM !== "1") return;
  try {
    const workspace = workspaceOf(objectKey);
    if (!workspace) return;
    const last = lastWarmedAt.get(workspace);
    if (last !== undefined && now - last >= 0 && now - last < PREWARM_WINDOW_MS) {
      prewarmCounts.throttled += 1;
      return;
    }
    if (lastWarmedAt.size >= MAX_TRACKED_WORKSPACES) {
      for (const [key, at] of lastWarmedAt) if (now - at >= PREWARM_WINDOW_MS) lastWarmedAt.delete(key);
      if (lastWarmedAt.size >= MAX_TRACKED_WORKSPACES) lastWarmedAt.clear();
    }
    lastWarmedAt.set(workspace, now);

    const jobs: Array<Promise<void>> = [];
    if (env.TAVONEL_CDR_HEALTH_URL) {
      prewarmCounts.fired += 1;
      jobs.push((async () => {
        try {
          // The same credential path the health route and the disarm call use.
          const authorization = await cdrAuthorization(env.TAVONEL_CDR_HEALTH_URL, env.FOUNDATION_CDR_IDENTITY_HMAC, fetcher);
          await touch("cdr", env.TAVONEL_CDR_HEALTH_URL, authorization ? { authorization } : {}, s => s >= 200 && s < 300, fetcher);
        } catch {
          record("cdr", "failed", null);
        }
      })());
    }
    const ocr = (env.FOUNDATION_OCR_URL || "").trim();
    if (ocr) {
      let ping: string | null = null;
      try { ping = `${new URL(ocr).origin}/ping`; } catch { /* a malformed URL is a failed warm-up, not an error */ }
      if (ping) {
        prewarmCounts.fired += 1;
        const key = (env.RUNPOD_API_KEY || "").trim();
        // /ping answers 204 while the reader loads and 200 once it is ready; both mean it was reached.
        jobs.push(touch("ocr", ping, key ? { Authorization: `Bearer ${key}` } : {}, s => s === 200 || s === 204, fetcher));
      } else {
        record("ocr", "failed", null);
      }
    }
    await Promise.allSettled(jobs);
  } catch {
    prewarmCounts.failed += 1;
  }
}
