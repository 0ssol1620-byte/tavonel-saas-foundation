/*
  One place where a machine code becomes a sentence (BQ-088).

  The workspace printed raw codes at people: `AUTH_REQUIRED`, `INTAKE_DISABLED`, and a dozen
  `(${json.code ?? response.status})` parentheticals hung off the end of an otherwise readable
  line. A code is what a support thread needs and not what a customer reads, so the sentence
  leads and the code follows in one fixed shape -- rather than each call site inventing its own.

  Deliberately not exhaustive, and deliberately not silent about it: an unmapped code still
  reaches the screen as a reference, because pretending an unknown failure is a known one is
  worse than a reference number. Add a row when a code turns out to be one customers meet.
*/

const FAILURE_COPY: Record<string, string> = {
  AUTH_REQUIRED: "Your session has expired. Sign in again.",
  SESSION_EXPIRED: "Your session has expired. Sign in again.",
  FORBIDDEN: "This workspace does not have access to that.",
  TENANT_MISMATCH: "That record belongs to another workspace.",
  NOT_FOUND: "That record is no longer in this workspace.",
  INTAKE_DISABLED: "Source intake is paused right now. Work already compiled stays available.",
  INTAKE_RATE_LIMITED: "Too many source bytes arrived at once. Wait a minute and try again; what was accepted is safe.",
  INTAKE_DAILY_QUOTA_EXCEEDED: "This workspace has reached its 24-hour direct-upload bound. Connect a source system, or retry after the window resets.",
  BILLING_HOLD: "A billing hold is active on this workspace, so new processing cannot start.",
  INSUFFICIENT_CREDITS: "There is not enough remaining balance to start this run.",
  COMPILE_JOB_ALREADY_SETTLED: "This compile has already finished, so there is nothing left to change.",
  SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL: "A file stopped by a safety check cannot be passed over in one click. Remove it from this compile explicitly, or cancel.",
  JOB_SYNC_CONFLICT: "An import is already running for this connection. Check its progress before starting another.",
  PATCH_BEFORE_MISMATCH: "The value changed after you opened it, so the correction was not applied. Reload and look again.",
  RATE_LIMITED: "Too many requests at once. Wait a minute and try again.",
};

/** What to say when the code is not one we have written a sentence for. */
function byStatus(status: number): string {
  if (status === 401 || status === 403) return "Your session no longer has access to this. Sign in again.";
  if (status === 404) return "That record is no longer in this workspace.";
  if (status === 409) return "Something else changed this first. Reload and look again.";
  if (status === 429) return "Too many requests at once. Wait a minute and try again.";
  if (status >= 500) return "Our servers could not complete this. Nothing was changed.";
  return "This request was refused.";
}

/**
 * The customer-facing sentence for a failed workspace request.
 *
 * `code` is whatever the route returned, or null when it returned none. The reference is
 * appended only when the code is one we have no sentence for -- so a reader sees plain English
 * for everything we understand, and English plus a reference for everything we do not.
 */
export function failureSentence(code: string | null | undefined, status: number): string {
  if (code && FAILURE_COPY[code]) return FAILURE_COPY[code];
  const sentence = byStatus(status);
  return code ? `${sentence} (Reference ${code}.)` : sentence;
}
