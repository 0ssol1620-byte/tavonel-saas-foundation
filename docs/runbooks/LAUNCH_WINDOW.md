# Launch window: switch order for the self-serve launch (D-12, D-13, D-19)

Register: `DECISION-REGISTER-2026-10-17.md` rows D-12, D-13, D-14, D-19 (founder delegation
2026-10-17: each resolved to the recommended default). This page is the founder's part. Nothing
here is done by merging code, and no value below is a secret; names only were read when it was
written (2026-10-19, `vercel env ls production` on `tavonel-saas-foundation`).

## What is already in the code (phase 4 LAUNCH)

- **D-14 / P2-29.** A checkout carried in from `/login` resumes only into a workspace released for
  production processing (`decideCheckoutResume`, `nextjs/lib/checkout-intent.ts`). Released is the
  stage, not file access: a released workspace whose trial ended or was refused has no file access
  and resumes, because buying is how it gets file access (review B1). Until release it is held in the
  tab with the sentence "Developer is held for you." and nothing is sent. Where nothing is sold online
  (production today) the request goes out as before, after one `/api/status/v2` read.
- **D-19.** While `activationPolicy.customerData.enabled` is true, processing runs only under
  `TAVONEL_CUSTOMER_DATA_GATE_VERSION=v2` and only for the one to three workspaces named in
  `TAVONEL_PROCESSING_WORKSPACE_COHORT` (`processingCohortRefusal`,
  `nextjs/lib/processing-workspace-grant.ts`). Any other configuration admits nobody. While the
  switch is off this rule adds nothing. On gate v1 the workspace no longer shows the processing
  terms panel, because v1 never reads an acceptance.
- **D-13.** The runtime reads launch approval from the deployment environment only
  (`readCommercialState`). `nextjs/vercel.json` still carries `TAVONEL_BILLING_LAUNCH_APPROVED`.
  The D-13 test (`nextjs/lib/commercial-state.test.ts`) models Vercel as applying the file's legacy
  `env` over project variables, so that today the file wins. That precedence is a model, not read
  from a deployment; the order in section 1 is safe under either precedence.

## 1. D-13: move launch approval into the production environment (founder hands)

Order matters. Deleting the `vercel.json` line before the production variable is right turns
launch approval off in production.

1. The production variable already exists by name (`TAVONEL_BILLING_LAUNCH_APPROVED`,
   Non-sensitive, Production). Open Vercel → `tavonel-saas-foundation` → Settings → Environment
   Variables and confirm its value is exactly `true` (lower case, no space, no newline). The
   runtime compares with `=== "true"`.
2. If it is missing or differs, set it as the launch-approval act itself:
   ```
   vercel env rm TAVONEL_BILLING_LAUNCH_APPROVED production
   vercel env add TAVONEL_BILLING_LAUNCH_APPROVED production    # type: true
   ```
3. Then the one-line PR: delete `"TAVONEL_BILLING_LAUNCH_APPROVED": "true",` from
   `nextjs/vercel.json`. The same commit updates the literal in `nextjs/lib/production-posture.test.ts`
   ("ships exactly main's three launch flags") to the two remaining flags, and keeps the D-13 test,
   which already asserts that with the line gone only an exact production value approves and unset
   closes. Merge under the 2026-10-15 delegation (required checks green, independent review with
   zero blockers, current production deployment ID recorded as rollback, head SHA and deployment
   ID reported).
4. After the deploy: `GET https://tavonel.com/api/status/v2` must report the same
   `availableActions.purchasePlan.enabled` as before the deploy.

Previews stop inheriting approval from the file. They could not charge before either: real charges
also require `VERCEL_ENV=production`.

## 2. D-19: the canary (launch window, with D-12)

1. Choose one to three workspaces with a production SELECT (founder-owned first). Read only.
2. Vercel production env: `TAVONEL_CUSTOMER_DATA_GATE_VERSION` = `v2` and
   `TAVONEL_PROCESSING_WORKSPACE_COHORT` = the chosen keys, comma-separated (`pilot-` + 1–16
   alphanumerics each, no wildcard, no trailing comma). Both names already exist in production;
   confirm their values rather than assume them.
3. Record the production release decision for the deployed SHA, then
   `pnpm release:gate-check --sha <deployed sha>` exits 0 (`docs/runbooks/RELEASE_ORDER.md`).
4. Widening past three workspaces, or removing the cohort, is a reviewed code change to
   `LAUNCH_CANARY_MAX_WORKSPACES`, not an environment edit.
5. Check the two values by eye. `release:gate-check` does not read the canary variables, and a
   cohort misconfiguration (`PROCESSING_COHORT_CONFIG_INVALID`) shows in the workspace as awaiting
   release, not as an outage.

## 3. D-12: the switch PR

The switch-on PR flips `activationPolicy.customerData.enabled` and the expectations that pin it,
and nothing else. It is opened as a draft and is not merged by agents. Preconditions (register
D-12): P2-12 to P2-17 and P2-29 merged, the T1 journey e2e (`nextjs/e2e/self-serve-journey.spec.ts`)
green, sections 1 and 2 done, and the other D-12 dependencies in the register (D-15 / FH-03,
D-16, D-17 / FH-04, S6-03 / FH-06). Decide the public sign-up CTA and the canary width together:
while the canary names one to three workspaces, every new account outside it waits at "awaiting
release" with its plan held. After its deploy: the GET checks in journey map §9.2-3,
`release:gate-check` exit 0, then FH-19.
