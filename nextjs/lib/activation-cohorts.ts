/*
  §15.3's four stages of reaching value, and §15.4's decision table, as readings over records the
  product already keeps.

  Two rules from the blueprint shape every function here.

  The unit is a deduplicated user/workspace cohort, not an event count. `lib/funnel-events.ts`
  counts events and deliberately carries no identifier, so it can say that eleven Worlds were
  activated and cannot say whether that was eleven customers or one customer eleven times. That
  is the right trade for a telemetry line and the wrong one for an activation number, so the
  cohort reading is a separate, pure calculation over server records -- the compile jobs, the
  promotions, the review decisions, the trial and grant rows -- supplied by the caller.

  Error, support, bot and internal test accounts are separated rather than averaged in. Three of
  the four exclusions come off a record the product already has: `accessSource: "owner"` is an
  operator grant (`lib/billing-product-access.ts` checks it before billing, so it is by
  definition not a customer), a public-sample origin is not a customer's own corpus, and an
  internal test workspace is named by the caller from `FOUNDATION_PILOT_USER_IDS` rather than
  guessed from a naming convention here.

  Nothing in this module is a public DTO. A cohort row names a workspace and a user, which is
  the point of a deduplicated cohort and also why it belongs on an internal operator surface
  only -- and why no function here returns a corpus key, a document id or a question.

  Not implemented and not faked: there is no store behind this. Every function takes the records
  as an argument. Wiring it to a query, and to whatever operator surface reads it, needs a
  decision about retention and access that is not an implementation detail (§15.1), so the
  calculation is the deliverable and the persistence is not.
*/

/** The four steps a cohort reading can be computed from, named so none collides with a
 *  `FunnelEvent` or `ServerFunnelEvent` name -- a step string that matched an event name would
 *  satisfy `funnel-events.test.ts`'s call-site check from this file and hide a deleted caller. */
export type ActivationStep =
  /** A candidate package exists for this corpus. §15.3 A1: not yet the core activation. */
  | "candidate_created"
  /** A question about an approved World was answered with its evidence attached. The ask route
   *  refuses a collection with no active World (409), so this step carries the approval. */
  | "grounded_answer"
  /** The same result read back by an API key: an MCP client, a script or an agent. */
  | "external_consumption"
  /** A source changed and the World was promoted again over the manifest it replaced. */
  | "source_revision";

export type ActivationOrigin = "customer_documents" | "public_sample" | "internal_test";

export type ActivationRecord = {
  workspaceKey: string;
  userId: string;
  /** From `SessionAccessSource`, or "unknown" when the record predates it. §15.1: an absent
   *  identifier stays unknown rather than being guessed into a bucket. */
  accessSource: "owner" | "paid" | "trial" | "unknown";
  origin: ActivationOrigin;
  /** Opaque to this module: only its distinctness is read, and it is never returned. */
  corpusKey: string;
  step: ActivationStep;
  /** ISO 8601. A record whose timestamp cannot be parsed is excluded, not dated to now. */
  at: string;
};

export type ExclusionReason =
  | "internal_grant"
  | "internal_test_account"
  | "public_sample"
  | "unparseable_timestamp";

export type CohortName = "A1" | "A2" | "A3" | "R1";

export type CohortMember = { workspaceKey: string; userId: string; firstAt: string };

export type CohortReading = {
  cohorts: Record<CohortName, CohortMember[]>;
  excluded: Record<ExclusionReason, number>;
};

export type CohortOptions = {
  /** Team and test accounts, from `readFoundationPilotUserIds()` at the call site. Passed in so
   *  this stays pure and so the list is the deployment's, not a pattern invented here. */
  internalUserIds?: readonly string[];
  internalWorkspaceKeys?: readonly string[];
};

/** Why a record is not part of any cohort, or `null` when it counts. */
export function exclusionReason(
  record: ActivationRecord,
  options: CohortOptions = {},
): ExclusionReason | null {
  if (!Number.isFinite(Date.parse(record.at))) return "unparseable_timestamp";
  if (record.origin === "internal_test") return "internal_test_account";
  if (options.internalUserIds?.includes(record.userId)) return "internal_test_account";
  if (options.internalWorkspaceKeys?.includes(record.workspaceKey)) return "internal_test_account";
  if (record.accessSource === "owner") return "internal_grant";
  if (record.origin === "public_sample") return "public_sample";
  return null;
}

/*
  The cohort key. `JSON.stringify` of the pair rather than a joined string, matching the identity
  key the ask route already builds: a separator character has to be one the two values cannot
  contain, and this module takes the workspace key and the user id as opaque strings, so there is
  no such character to pick.
*/
const identity = (record: ActivationRecord) => JSON.stringify([record.workspaceKey, record.userId]);

/*
  A1/A2/A3 are the first time a cohort reached a step. R1 is the only one that needs more than
  one record: §15.3 defines repeat value as a second corpus *or* a real source revision, so a
  single corpus compiled twice is not R1 and a revision of the first corpus is.

  What this deliberately does not do is infer a stage from a later one. A cohort that shows a
  grounded answer and no candidate is reported in A2 and not in A1, because the candidate
  happened outside the window rather than not at all -- and a function that back-filled it would
  make the window's own boundary invisible.
*/
export function activationCohorts(
  records: readonly ActivationRecord[],
  options: CohortOptions = {},
): CohortReading {
  const excluded: Record<ExclusionReason, number> = {
    internal_grant: 0,
    internal_test_account: 0,
    public_sample: 0,
    unparseable_timestamp: 0,
  };
  const first = new Map<string, Map<CohortName, string>>();
  /** Per cohort identity: each corpus that produced a candidate, and when it first did. */
  const corpora = new Map<string, Map<string, string>>();
  const revised = new Map<string, string>();

  const note = (key: string, cohort: CohortName, at: string) => {
    const seen = first.get(key) ?? new Map<CohortName, string>();
    const previous = seen.get(cohort);
    if (previous === undefined || Date.parse(at) < Date.parse(previous)) seen.set(cohort, at);
    first.set(key, seen);
  };

  for (const record of records) {
    const reason = exclusionReason(record, options);
    if (reason) {
      excluded[reason] += 1;
      continue;
    }
    const key = identity(record);
    if (record.step === "candidate_created") {
      note(key, "A1", record.at);
      const seen = corpora.get(key) ?? new Map<string, string>();
      const previous = seen.get(record.corpusKey);
      if (previous === undefined || Date.parse(record.at) < Date.parse(previous)) {
        seen.set(record.corpusKey, record.at);
      }
      corpora.set(key, seen);
    }
    if (record.step === "grounded_answer") note(key, "A2", record.at);
    if (record.step === "external_consumption") note(key, "A3", record.at);
    if (record.step === "source_revision") {
      const previous = revised.get(key);
      if (previous === undefined || Date.parse(record.at) < Date.parse(previous)) {
        revised.set(key, record.at);
      }
    }
  }

  // R1 from the second corpus: the moment the cohort had two of them is the second corpus's own
  // first candidate, which is the second of the per-corpus first dates in order. A revision
  // reaches R1 on its own date, and `note` keeps whichever of the two came first.
  for (const [key, byCorpus] of corpora) {
    if (byCorpus.size < 2) continue;
    const dates = [...byCorpus.values()].sort((left, right) => Date.parse(left) - Date.parse(right));
    note(key, "R1", dates[1]);
  }
  for (const [key, at] of revised) note(key, "R1", at);

  const cohorts: Record<CohortName, CohortMember[]> = { A1: [], A2: [], A3: [], R1: [] };
  for (const [key, seen] of first) {
    const [workspaceKey, userId] = JSON.parse(key) as [string, string];
    for (const [cohort, firstAt] of seen) cohorts[cohort].push({ workspaceKey, userId, firstAt });
  }
  for (const cohort of Object.keys(cohorts) as CohortName[]) {
    cohorts[cohort].sort((left, right) => Date.parse(left.firstAt) - Date.parse(right.firstAt));
  }
  return { cohorts, excluded };
}

/** Deduplicated cohort sizes. The number an activation dashboard shows. */
export function cohortCounts(reading: CohortReading): Record<CohortName, number> {
  return {
    A1: reading.cohorts.A1.length,
    A2: reading.cohorts.A2.length,
    A3: reading.cohorts.A3.length,
    R1: reading.cohorts.R1.length,
  };
}

/*
  §15.4's decision table, with a third column the blueprint leaves implicit: whether this
  deployment can compute the row at all.

  Three of the seven are computable from what now exists -- the server events in
  `lib/funnel-events.ts` and the cohorts above. The other four are not, for two different
  reasons: two rows are `not_joinable` (their halves live in the consent-gated browser domain
  and share no identifier with a server record) and two are `needs_founder_access` (no Search
  Console property, no per-workspace cost record). Saying so is the point of the column. A table
  whose first row reads "impressions are there but clicks are not" against no Search Console
  access is a row that will be answered from somebody's impression of the traffic.

  `computableDecisionRows()` is that subset of three, and `activation-cohorts.test.ts` pins it
  by id -- so this paragraph cannot drift away from the data again without a test failing.

  `availability` is about the measurement, not about the advice. Every `priorityAction` stands on
  its own; what is missing is the observation that would tell an operator the row applies.
*/
export type DecisionAvailability =
  /** Computable from server events and cohorts in this repository. */
  | "computable"
  /** The two sides live in different data domains and share no identifier. §15.1 keeps the
   *  public-site measurement consent-gated and aggregate, so the join does not exist: report
   *  both sides separately rather than dividing one by the other. */
  | "not_joinable"
  /** Needs an account or a cost record nobody in this repository has. Founder decision. */
  | "needs_founder_access";

export type DecisionRow = {
  id: string;
  observation: string;
  priorityAction: string;
  /** The measurements the row compares, named so a reader can check the claim. */
  inputs: readonly string[];
  availability: DecisionAvailability;
  availabilityNote: string;
};

export const DECISION_TABLE: readonly DecisionRow[] = [
  {
    id: "impressions_without_clicks",
    observation: "Relevant search impressions exist, but few of them are clicked.",
    priorityAction: "Check the title, the intent match and the result form. Confirm the content actually fits the query before making the wording louder.",
    inputs: ["search_console.impressions", "search_console.clicks"],
    availability: "needs_founder_access",
    availabilityNote: "No Search Console property is connected to this deployment and no code here reads one.",
  },
  {
    id: "visits_without_sample_opens",
    observation: "Pages are visited, but the sample is rarely opened.",
    priorityAction: "Make the first screen state the outcome, the work it is for and the prerequisites.",
    inputs: ["marketing_analytics.page_view", "funnel.explore_entered"],
    availability: "not_joinable",
    availabilityNote: "Both sides are consent-gated browser measurements in the external analytics tool; this repository can read neither back.",
  },
  {
    id: "samples_without_own_documents",
    observation: "The sample is viewed, but the reader never uses their own documents.",
    priorityAction: "Investigate file-support, security, signup and price uncertainty. Do not answer it with more content.",
    inputs: ["funnel.explore_entered", "cohort.A1"],
    availability: "not_joinable",
    availabilityNote: "The sample side is a consented browser event and A1 is a server record; no identifier links them, so each is reported on its own.",
  },
  {
    id: "starts_without_candidate_or_approval",
    observation: "Compiles start, but they do not reach a candidate or an approval.",
    priorityAction: "Fix the product failure, the permission or the review UX first.",
    inputs: ["funnel.compile_started", "funnel.candidate_ready", "funnel.world_activated"],
    availability: "computable",
    availabilityNote: "All three are server events on the compile, worker and promote routes.",
  },
  {
    id: "first_success_without_payment",
    observation: "First success happens, but few of them pay.",
    priorityAction: "Check whether the repeat need is real, and whether the plan's value, limits and cost explanation are fair and legible.",
    inputs: ["cohort.A2", "funnel.subscription_started"],
    availability: "computable",
    availabilityNote: "A2 is a server cohort and the subscription is a provider receipt. Activation needs the Team plan today, which is sold through a conversation, so this row's denominator is small by construction.",
  },
  {
    id: "payment_without_next_month_use",
    observation: "Subscriptions start, but the next month's use is low.",
    priorityAction: "Investigate the next corpus, the update path and external consumption.",
    inputs: ["funnel.subscription_started", "cohort.R1"],
    availability: "computable",
    availabilityNote: "Both sides are server records; R1 is the second corpus or the applied revision.",
  },
  {
    id: "growth_without_contribution",
    observation: "Traffic and revenue rise while contribution profit gets worse.",
    priorityAction: "Adjust the free processing scope, the retry budget, the support load and the product's scope.",
    inputs: ["billing.revenue", "cost.per_workspace_processing"],
    availability: "needs_founder_access",
    availabilityNote: "Per-workspace processing, retry and support cost is not recorded in this repository; `lib/usage-pricing.ts` holds prices, not costs.",
  },
] as const;

/** The rows an operator can actually act on today. */
export function computableDecisionRows(): readonly DecisionRow[] {
  return DECISION_TABLE.filter((row) => row.availability === "computable");
}

/*
  §15.4's last paragraph, made a function rather than a footnote.

  Two readings this module refuses to produce. Both were asked for as prohibitions, and a
  prohibition that lives only in prose is one somebody satisfies with a spreadsheet: so there is
  no function here that returns a winning variant, and no function that maps a search query to a
  payer. `experimentReading` is the whole of what an A/B comparison gets, and its most useful
  answer is that the sample is not there yet.
*/
export const UNJOINABLE_READINGS = [
  {
    id: "search_query_to_payer",
    refusal: "A Search Console query is not connected to an identified payer. The two are separate domains with no shared identifier, and assuming the link would attribute revenue to a query on nothing.",
  },
  {
    id: "small_sample_winner",
    refusal: "A winner is not declared from a sample below the pre-registered size, and this module declares none at any size: the comparison is reported and the decision is a person's.",
  },
] as const;

export type ExperimentPlan = {
  /** Pre-registered before the experiment ran, per §15.4. There is no default: a sample size
   *  chosen after seeing the numbers is the thing the rule bars. */
  preRegisteredSampleSizePerArm: number;
  analysisWindowDays: number;
  registeredAt: string;
};

export type ExperimentArm = { arm: string; exposures: number; conversions: number };

export type ExperimentReading = {
  verdict: "no_registered_plan" | "insufficient_sample" | "reportable_without_winner";
  reason: string;
  /** Per arm, with its rate as a ratio -- never ranked, and never labelled better or worse. */
  arms: ReadonlyArray<{ arm: string; exposures: number; conversions: number; rate: number | null }>;
};

export function experimentReading(
  plan: ExperimentPlan | null,
  arms: readonly ExperimentArm[],
): ExperimentReading {
  const rows = arms.map((arm) => ({
    ...arm,
    // No exposures is not a zero rate. It is an unmeasured one.
    rate: arm.exposures > 0 ? arm.conversions / arm.exposures : null,
  }));
  if (!plan || !Number.isFinite(plan.preRegisteredSampleSizePerArm) || plan.preRegisteredSampleSizePerArm <= 0) {
    return {
      verdict: "no_registered_plan",
      reason: "No pre-registered sample size and analysis window. Observe the real usage first; an experiment read without a plan registered in advance has no threshold to have reached.",
      arms: rows,
    };
  }
  const short = rows.filter((row) => row.exposures < plan.preRegisteredSampleSizePerArm);
  if (short.length > 0) {
    return {
      verdict: "insufficient_sample",
      reason: `${short.length} of ${rows.length} arms are below the pre-registered ${plan.preRegisteredSampleSizePerArm} exposures. No comparison is read from this.`,
      arms: rows,
    };
  }
  return {
    verdict: "reportable_without_winner",
    reason: "Every arm reached its pre-registered sample. The rates are reportable; which variant ships is a person's decision, and this reading does not name one.",
    arms: rows,
  };
}
