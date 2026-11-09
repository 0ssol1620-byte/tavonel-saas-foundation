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
  CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE: "Source processing is not active for this workspace. Request source access before retrying.",
  INTAKE_RATE_LIMITED: "Too many source bytes arrived at once. Wait a minute and try again; what was accepted is safe.",
  INTAKE_DAILY_QUOTA_EXCEEDED: "This workspace has reached its 24-hour direct-upload bound. Connect a source system, or retry after the window resets.",
  BILLING_HOLD: "A billing hold is active on this workspace, so new processing cannot start.",
  INSUFFICIENT_CREDITS: "There is not enough remaining balance to start this run.",
  COMPILE_JOB_ALREADY_SETTLED: "This compile has already finished, so there is nothing left to change.",
  /*
    Size refusals are deterministic: the same files give the same output, so a retry pays for the
    compile again and fails the same way (REVIEW-PR192-R1 MAJOR-2). Neither line invites one.
  */
  JSON_TOO_LARGE: "This is larger than its size limit, so it was not stored. Trying the same thing again gives the same result.",
  CORE_OUTPUT_TOO_LARGE: "These files compile to more than one World can hold, so nothing was stored. Running the same set again gives the same result. Compile fewer or smaller files at a time.",
  SECURITY_BLOCKER_REQUIRES_EXPLICIT_REMOVAL: "A file stopped by a safety check cannot be passed over in one click. Remove it from this compile explicitly, or cancel.",
  JOB_SYNC_CONFLICT: "An import is already running for this connection. Check its progress before starting another.",
  PATCH_BEFORE_MISMATCH: "The value changed after you opened it, so the correction was not applied. Reload and look again.",
  RATE_LIMITED: "Too many requests at once. Wait a minute and try again.",
  /*
    Journey A1 (JOURNEY-MAP-2026-10-17 D-03, D-13). The checkout, portal and access refusals a
    customer can meet today. Each checkout refusal says that nothing was charged, because a
    refused purchase reads first as "did I just pay?", and each line points at the one next step
    that can change the answer -- never at a retry that cannot. `PILOT_ACCESS_REQUIRED` and
    `PADDLE_CUSTOMER_NOT_FOUND` used to fall through to the 403 and 409 status lines, which told
    the reader to sign in again and to reload: two retries that never succeed.
  */
  BILLING_LAUNCH_PENDING: "Plan purchase is not open, so nothing was charged. Access is arranged with us through the contact page.",
  BILLING_NOT_CONFIGURED: "Online payment is not configured, so nothing was charged. Access is arranged with us through the contact page.",
  BILLING_OFFER_CONTACT_REQUIRED: "This plan is arranged with us rather than bought online, so nothing was charged. Use the contact page to set it up.",
  PROCESSING_QUALIFICATION_NOT_BILLABLE: "This workspace's source access covers a processing check, not paid use, so nothing was charged. Request source access for paid use before retrying.",
  PILOT_ACCESS_REQUIRED: "This account is not admitted to a TAVONEL workspace. Access is arranged with us through the contact page.",
  PADDLE_CUSTOMER_NOT_FOUND: "No payment is linked to this account, so there is no billing to manage. A payment made a moment ago appears here once it is confirmed.",
  /* W1-A1: the processing cohort (uploads, the remote MCP). Excluded is a fact about this workspace; config-invalid is ours to fix. */
  REMOTE_MCP_COHORT_EXCLUDED: "This workspace is not in the current pilot group, so this is not open to it yet. Access is arranged with us through the contact page.",
  REMOTE_MCP_COHORT_CONFIG_INVALID: "This is paused while we correct a configuration on our side. Nothing in your workspace changed.",
  /*
    FUNNEL-SIGNED-IN #1 (2026-11-09). The plan and free-evaluation refusals fell through to "This
    request was refused. (Reference ...)" at the exact moment a person reaches a limit. Each one now
    says which limit it was. The notice adds a link to the plans for every code in UPGRADE_CODES.
  */
  SUBSCRIPTION_REQUIRED: "This needs a paid plan. Nothing was changed.",
  STUDIO_SUBSCRIPTION_REQUIRED: "Your current plan does not include this. Nothing was changed.",
  TRIAL_FILE_LIMIT_EXCEEDED: "Your free evaluation has used all of its files. Nothing was uploaded.",
  TRIAL_PAGE_LIMIT_EXCEEDED: "These files go past the pages left in your free evaluation. Nothing was uploaded.",
  TRIAL_FILE_TOO_LARGE: "This file is larger than the free evaluation accepts. Nothing was uploaded.",
  TRIAL_ARCHIVE_NOT_INCLUDED: "ZIP archives are not part of the free evaluation. Choose the files inside it instead.",
  TRIAL_FEATURE_NOT_INCLUDED: "This is not part of the free evaluation.",
  TRIAL_WORLD_LIMIT_REACHED: "Your free evaluation has already used its one World.",
  TRIAL_LIMIT_REACHED: "Your free evaluation has reached one of its limits.",
  TRIAL_NOT_ACTIVE: "Your free evaluation has ended.",
  TRIAL_AI_ACCESS_CHECK_FAILED: "We could not check your free evaluation limits, so nothing ran. Try again in a minute.",
};

/** Refusals a plan can lift. Their sentence is shown with a link to /pricing. */
const UPGRADE_CODES: readonly string[] = [
  "SUBSCRIPTION_REQUIRED", "STUDIO_SUBSCRIPTION_REQUIRED", "TRIAL_FILE_LIMIT_EXCEEDED",
  "TRIAL_PAGE_LIMIT_EXCEEDED", "TRIAL_FILE_TOO_LARGE", "TRIAL_ARCHIVE_NOT_INCLUDED",
  "TRIAL_FEATURE_NOT_INCLUDED", "TRIAL_WORLD_LIMIT_REACHED", "TRIAL_LIMIT_REACHED", "TRIAL_NOT_ACTIVE",
];

/**
 * Whether a notice carries a refusal a plan can lift. Read off the sentence rather than the code
 * because the workspace composes its notices as text ("Activation failed. <sentence> ..."), and the
 * sentences are this module's own constants, so the match cannot drift from the copy.
 */
export function offersUpgrade(notice: string): boolean {
  return UPGRADE_CODES.some((code) => notice.includes(FAILURE_COPY[code]!));
}

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

/** Codes that mean "this file set is too large to compile": deterministic, so never offered as a retry. */
export const SIZE_LIMIT_FAILURE_CODES: readonly string[] = ["JSON_TOO_LARGE", "CORE_OUTPUT_TOO_LARGE"];

export function isSizeLimitFailure(code: string | null | undefined): boolean {
  return Boolean(code && SIZE_LIMIT_FAILURE_CODES.includes(code));
}

export type SizeLimitFailureCopy = {
  sentence: string; measured: string; largest: string; counts: string;
  /** The read stopped at the bound, so only "more than the bound" was measured, never an exact size. */
  exceeded: (bound: string) => string;
};

const SIZE_LIMIT_COPY: Record<"en" | "ko", SizeLimitFailureCopy> = {
  en: {
    sentence: "This set of files compiles to more than one World can hold, so nothing was stored. Running the same set again gives the same result. Compile fewer or smaller files at a time.",
    measured: "Measured size",
    largest: "Largest parts of the output",
    counts: "What the output held",
    exceeded: (bound) => `exceeded the ${bound} byte limit`,
  },
  ko: {
    sentence: "이 파일 묶음은 World 하나에 담을 수 있는 크기를 넘어, 아무것도 저장하지 않았습니다. 같은 묶음을 다시 실행해도 결과는 같습니다. 파일 수를 줄이거나 더 작은 파일로 나누어 컴파일하세요.",
    measured: "측정한 크기",
    largest: "출력에서 가장 큰 부분",
    counts: "출력에 담긴 항목",
    exceeded: (bound) => `${bound} 바이트 상한 초과`,
  },
};

/**
 * The compile panel's copy for a size refusal, in the browser's language (English or Korean, the
 * same rule as `workspace-ask-copy`). The sentence carries no numbers; the measured ones are shown
 * beside it as detail.
 */
export function sizeLimitFailureCopy(languages: readonly string[] = []): SizeLimitFailureCopy {
  return SIZE_LIMIT_COPY[languages[0]?.toLowerCase().startsWith("ko") ? "ko" : "en"];
}

/*
  D0 2026-11-09 R2: a 12-page scan settled review_required and the review queue printed
  `CONTRADICTION_GROUP_TOO_LARGE:contradiction_group_<sha256>:claims=216:pairs=23220` at the customer.
  Core writes these two codes in one shape (akc_product_core/semantics.py,
  `ContradictionGroupOverflow.review_reason`): the group is over its own pair bound, or the compile's
  shared pair budget was spent on other topics first. The only numbers said are the two the string
  carries. Any other code, or a string not in exactly that shape, gets no sentence and is shown raw.
*/
const CONTRADICTION_REASON = /^(CONTRADICTION_GROUP_TOO_LARGE|CONTRADICTION_PAIR_BUDGET_EXCEEDED):[^:\s]+:claims=(\d+):pairs=(\d+)$/;

type ReviewLanguage = "en" | "ko";

const REVIEW_REASON_COPY: Record<ReviewLanguage, {
  reference: string;
  CONTRADICTION_GROUP_TOO_LARGE: (claims: string, pairs: string) => string;
  CONTRADICTION_PAIR_BUDGET_EXCEEDED: (claims: string, pairs: string) => string;
}> = {
  en: {
    reference: "Reference",
    CONTRADICTION_GROUP_TOO_LARGE: (claims, pairs) =>
      `${claims} statements on one topic may conflict with each other. Comparing them takes ${pairs} checks, which is more than this compile checks automatically, so a person needs to review them. Open the review to decide.`,
    CONTRADICTION_PAIR_BUDGET_EXCEEDED: (claims, pairs) =>
      `${claims} statements on one topic may conflict with each other. This compile had already used its automatic checks on other topics, so these ${pairs} checks were left for a person. Open the review to decide.`,
  },
  ko: {
    reference: "참조",
    CONTRADICTION_GROUP_TOO_LARGE: (claims, pairs) =>
      `한 주제에 서로 어긋날 수 있는 진술이 ${claims}개 있습니다. 비교에 ${pairs}번의 확인이 필요해 이번 컴파일이 자동으로 확인하는 한도를 넘었으므로 사람이 검토해야 합니다. 검토 화면을 열어 결정하세요.`,
    CONTRADICTION_PAIR_BUDGET_EXCEEDED: (claims, pairs) =>
      `한 주제에 서로 어긋날 수 있는 진술이 ${claims}개 있습니다. 이번 컴파일은 다른 주제에서 자동 확인 한도를 이미 써서 이 ${pairs}번의 확인을 사람이 검토하도록 남겼습니다. 검토 화면을 열어 결정하세요.`,
  },
};

/**
 * The plain sentence for a recorded review reason, or null when the reason is not one we have
 * written a sentence for (the caller then shows the raw string, as before). `reference` labels the
 * raw string, which the caller always keeps on screen beside the sentence.
 */
export function reviewReasonCopy(value: string, languages: readonly string[] = []): { sentence: string; reference: string } | null {
  const match = CONTRADICTION_REASON.exec(value);
  if (!match) return null;
  const language: ReviewLanguage = languages[0]?.toLowerCase().startsWith("ko") ? "ko" : "en";
  const copy = REVIEW_REASON_COPY[language];
  const format = (digits: string) => Number(digits).toLocaleString(language === "ko" ? "ko-KR" : "en-US");
  const code = match[1] as "CONTRADICTION_GROUP_TOO_LARGE" | "CONTRADICTION_PAIR_BUDGET_EXCEEDED";
  return { sentence: copy[code](format(match[2]), format(match[3])), reference: copy.reference };
}
