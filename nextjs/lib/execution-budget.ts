/**
 * One place that decides how long anything is allowed to take.
 *
 * Three numbers used to disagree, in three files:
 *
 *   lib/core-runtime-v2.ts   route.maxLatencyMs = 90_000   what Core is told it may take
 *   lib/core-runtime-v2.ts   AbortSignal.timeout(60_000)   how long this process waits
 *   app/api/internal/jobs/run/route.ts  maxDuration = 60   how long the process exists
 *
 * They cannot all be true. Core was promised ninety seconds by a caller that abandons it at
 * sixty, inside a function that is killed at sixty. A Core response arriving at any time past
 * sixty seconds was unreachable, and one arriving *at* sixty raced the platform killing the
 * invocation -- so the failure was not even reliably an error: the function could disappear
 * before anything recorded why, leaving the lease held until it expired.
 *
 * The budget is now derived, not asserted three times:
 *
 *   WORKER_MAX_DURATION_SECONDS      the platform's wall clock for one worker turn
 *   - WORKER_SETTLEMENT_RESERVE_MS   time kept back to record an outcome and commit a receipt
 *   = CORE_CLIENT_TIMEOUT_MS         how long this process waits for Core
 *   = CORE_MAX_LATENCY_MS            what Core is told it may take
 *
 * The last equality is the point. Promising a worker more time than the caller will wait is
 * how the previous version produced work nobody collected.
 *
 * WHAT THIS DOES NOT FIX. A compile that genuinely needs longer than CORE_MAX_LATENCY_MS still
 * cannot complete, because a bounded worker turn cannot contain an unbounded synchronous call.
 * Making that work needs asynchronous dispatch -- submit, return, poll across turns -- which is
 * an architectural change and a decision about the Core contract, not a constant. Lowering the
 * promise to what the worker can honour is what makes the current behaviour truthful; it is not
 * a claim that 90s compiles are supported. See docs/adr/0003.
 */

/**
 * The platform wall clock for one worker invocation, in seconds.
 *
 * Exported so `app/api/internal/jobs/run/route.ts` declares `maxDuration` from this rather than
 * repeating the number. Raising it is a platform decision -- the ceiling depends on the Vercel
 * plan -- and every number below moves with it.
 */
export const WORKER_MAX_DURATION_SECONDS = 60;

export const WORKER_MAX_DURATION_MS = WORKER_MAX_DURATION_SECONDS * 1_000;

/**
 * Time reserved at the end of a turn for the work that must happen after the call returns:
 * classify the failure, write the job event, release or extend the lease, commit the receipt.
 *
 * Without it a timeout and a function kill land at the same instant and are indistinguishable,
 * which is the state this replaced.
 */
export const WORKER_SETTLEMENT_RESERVE_MS = 8_000;

/** How long this process waits for Core before giving up on its own terms. */
export const CORE_CLIENT_TIMEOUT_MS = WORKER_MAX_DURATION_MS - WORKER_SETTLEMENT_RESERVE_MS;

/** What Core is told it may take. Never more than the caller will wait. */
export const CORE_MAX_LATENCY_MS = CORE_CLIENT_TIMEOUT_MS;

/**
 * What happens to a Core response that arrives after `elapsedMs`.
 *
 * `worker-killed` is the outcome the reserve exists to make unreachable in normal operation: if
 * it is ever observed, the reserve is too small or something before the call consumed the turn.
 */
export function coreLatencyOutcome(elapsedMs: number): "within-budget" | "client-timeout" | "worker-killed" {
  if (elapsedMs <= CORE_MAX_LATENCY_MS) return "within-budget";
  if (elapsedMs < WORKER_MAX_DURATION_MS) return "client-timeout";
  return "worker-killed";
}

/**
 * The invariant, as a function so it can be asserted in a test rather than trusted in a comment.
 *
 * Returns the reasons it does not hold; empty means it does.
 */
export function executionBudgetViolations(): string[] {
  const violations: string[] = [];
  if (!(CORE_MAX_LATENCY_MS <= CORE_CLIENT_TIMEOUT_MS)) {
    violations.push("Core is promised more time than the caller will wait for it");
  }
  if (!(CORE_CLIENT_TIMEOUT_MS < WORKER_MAX_DURATION_MS)) {
    violations.push("the caller waits at least as long as the worker exists, so a timeout cannot be recorded");
  }
  if (WORKER_MAX_DURATION_MS - CORE_CLIENT_TIMEOUT_MS < WORKER_SETTLEMENT_RESERVE_MS) {
    violations.push("less than the settlement reserve is left after the client gives up");
  }
  if (WORKER_SETTLEMENT_RESERVE_MS <= 0) {
    violations.push("no time is reserved to record an outcome");
  }
  return violations;
}
