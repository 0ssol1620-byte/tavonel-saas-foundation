/*
  WO-REL-2: the canary step for the page meter (migration 20261117120000).

  TAVONEL_PAGE_METER_COHORT decides which workspaces the settle route sends to
  `settle_foundation_compute_v4` (pages x 4, capped at the approval). Every other workspace stays
  on `settle_foundation_compute_v3` with the worker's per-document `actualCredits`, which is what
  production `main` charges today for the same body. Server only; the value is never echoed.

    unset or ""                      nobody is metered
    "*" (exactly, alone)             every workspace is metered
    "pilot-a,pilot-b" (1..MAX keys)  those workspaces are metered
    anything else                    INVALID: nobody is metered, `page_meter_cohort_refused` is
                                     logged on every settlement, and /api/status reports not configured

  A malformed value never widens to "*": it can only leave a workspace on today's charge.
*/

type Env = Readonly<Record<string, string | undefined>>;

/** Workspaces a list may name. Start value, uncalibrated: a canary, not a rollout ("*" is the rollout). */
export const PAGE_METER_COHORT_MAX = 50;

/** The workspace key shape `settle_foundation_compute_v4` itself accepts. */
const COHORT_WORKSPACE = /^pilot-[A-Za-z0-9]{1,16}$/;

export type PageMeterCohort =
  | { state: "unset" }
  | { state: "all" }
  | { state: "list"; workspaces: ReadonlySet<string> }
  | { state: "invalid" };

export function readPageMeterCohort(env: Env = process.env): PageMeterCohort {
  const raw = env.TAVONEL_PAGE_METER_COHORT;
  if (raw === undefined || raw === "") return { state: "unset" };
  if (raw === "*") return { state: "all" };
  const ids = raw.split(",").map((id) => id.trim());
  if (ids.length > PAGE_METER_COHORT_MAX || !ids.every((id) => COHORT_WORKSPACE.test(id))) return { state: "invalid" };
  return { state: "list", workspaces: new Set(ids) };
}

/** True when this workspace's reads settle by their pages. The one place the decision is made. */
export function pageMeterSettles(workspaceKey: string, env: Env = process.env): boolean {
  const cohort = readPageMeterCohort(env);
  if (cohort.state === "invalid") {
    console.error("page_meter_cohort_refused", { name: "TAVONEL_PAGE_METER_COHORT", code: "PAGE_METER_COHORT_CONFIG_INVALID" });
    return false;
  }
  return cohort.state === "all" || (cohort.state === "list" && cohort.workspaces.has(workspaceKey));
}

/** The only thing a status response says about the cohort: a valid, non-empty value is set. */
export function pageMeterCohortConfigured(env: Env = process.env): boolean {
  const state = readPageMeterCohort(env).state;
  return state === "all" || state === "list";
}
