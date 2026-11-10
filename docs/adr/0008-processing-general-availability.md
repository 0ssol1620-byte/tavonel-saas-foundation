# ADR-0008 — Customer-file processing opens to every workspace (lifts the D-19 canary)

- **Status:** adopted, delegated decision, 2026-11-09. Recorded next to D-19
  (`DECISION-REGISTER-2026-10-17.md`, `docs/runbooks/LAUNCH_WINDOW.md` §2).
- **Founder request (2026-11-09):** real operation starts now, and the limit on how many customers
  can process files goes. The orchestrating session took the decision under the founder's
  2026-11-09 delegation (CLAUDE.md, "Delegated again 2026-11-09, wider").
- **Code:** `processingRolloutRefusal` in `nextjs/lib/processing-workspace-grant.ts`, read by the
  grant issuer (`issueProcessingWorkspaceGrant`) and by every processing authorization
  (`readCustomerSourceAuthorization`, `nextjs/lib/customer-data-admission.ts`).

## Context

D-19 (register 2026-10-17) ran processing under gate v2 inside a canary of one to three named
workspaces: `TAVONEL_PROCESSING_WORKSPACE_COHORT`, capped by `LAUNCH_CANARY_MAX_WORKSPACES = 3`.
With the launch switch on (`activationPolicy.customerData.enabled`), an unset, wider or
wildcard cohort is `PROCESSING_COHORT_CONFIG_INVALID` and admits nobody. Production lists the
founder's two workspaces, so a new paying customer accepts the processing terms and then cannot
upload or compile. The workspace shows "awaiting release" with no path forward.

## Options

| | option | verdict |
|---|---|---|
| A | Raise `LAUNCH_CANARY_MAX_WORKSPACES` (say to 20 or 1000) and keep listing keys | Rejected. Every new customer would need an env edit and a billable redeploy, and the list is still a ceiling. |
| B | Treat an unset cohort as "everyone" while the launch switch is on | Rejected. An env that is missing by mistake would silently admit everyone, the failure D-19 was written to stop. |
| C | Accept a wildcard (`*`) in the cohort list | Rejected. It overloads a list of names with a mode. Feature flags that read the cohort (library organize `on`) would open to everyone too. |
| D | **A separate rollout mode: `TAVONEL_PROCESSING_ROLLOUT=general`, exact value, gate v2 only** | **Adopted.** |

## Decision

`TAVONEL_PROCESSING_ROLLOUT` is read in place of the bare cohort check:

| value | effect |
|---|---|
| unset | D-19 exactly as before: gate v2, one to three named workspaces, anything else `PROCESSING_COHORT_CONFIG_INVALID`. This is the rollback. |
| `general` (exact, lower case, no space) with `TAVONEL_CUSTOMER_DATA_GATE_VERSION=v2` | every workspace passes the rollout check |
| `general` under any other gate version, or any other value (empty, padded, `General`, `all`, `*`, `on`, `true`) | `PROCESSING_COHORT_CONFIG_INVALID`: admits nobody and writes no grant |

Admitting everyone takes one deliberate, exact word. A missing env never means "everyone".

**It lifts the workspace count and nothing else.** Every other gate stays in the path:

- the owner's processing-terms acceptance and the v2 workspace grant (`issueProcessingWorkspaceGrant`,
  `issue_customer_data_workspace_grant()`), and any explicit workspace refusal
- the production release decision for the exact deployed SHA or its gate surface
  (`customer_data_release_decisions`, ADR 0006). Every deploy still needs one
- ACL and tenant isolation on every route (`canAdmitCustomerSource` is per workspace and per scope)
- trial file and page caps and the trial AI-usage ledger (migration `20261104090000_trial_ai_usage`)
- malware scan and CDR (`activationPolicy.cdr`)
- the launch switch (`activationPolicy.customerData.enabled`)

**Cohort-scoped features stay cohort-scoped.** `processingCohortRefusal` is unchanged and remains
the named-cohort check. Library organize `on` (`TAVONEL_LIBRARY_ORGANIZE_MODE`, W2-B2, PR #196)
reads it directly, not the rollout, so `general` does not open an unbenchmarked feature. The
remote MCP canary has its own variable (`TAVONEL_REMOTE_MCP_COHORT`) and is untouched. Keep
`TAVONEL_PROCESSING_WORKSPACE_COHORT` set under `general`. It is what rollback falls back to, and
what cohort-scoped features read.

## Production steps

Every step is in `docs/runbooks/RELEASE_ORDER.md` ("추가 2026-11-09 — 처리 GA"), in this order:

1. Spend first. Merge and deploy #221, the fail-closed daily OCR spend stop. Then set
   `TAVONEL_RUNPOD_DAILY_COST_CAP_USD`. #220 adds capacity and is recommended before GA.
2. Set `TAVONEL_PROCESSING_ROLLOUT=general` in Production with `printf %s general | vercel env add …`,
   never `echo`. A trailing newline makes the value invalid, and that closes processing for every
   workspace, the cohort included. Confirm gate v2, and confirm the cohort is still set.
3. Record the release row before the merge, against the PR head. Follow RELEASE_ORDER "추가
   2026-11-09 — 병합 전 출시 행": `release:gate-check --sha <head> --merge-into <main>` exits 0, then
   `gh pr merge --merge --match-head-commit <head>`. The deploy is then open when it reaches READY.
4. After READY, `pnpm release:gate-check --sha <merge SHA>` reads `released`.
5. Run a read-only check that a fresh workspace outside the cohort receives a grant after consent.
   This is a hard check before GA is announced.
6. Rollback.
   - First choice: Vercel Instant Rollback to the previous deployment. It reverts the behaviour
     and the public copy together. The older code never reads this variable.
   - Env-only rollback: unset `TAVONEL_PROCESSING_ROLLOUT` and redeploy. The cohort is still set,
     so the canary is back exactly. Workspaces outside it read `PROCESSING_COHORT_EXCLUDED` on
     their next read, grant or not.

## Consequences

- New workspaces process files once their owner accepts the terms, given a current release row.
- Public copy that said processing opened "in stages" / "stage by stage" now names what opens a
  workspace: its owner accepting the processing terms (`activationPolicy.customerData.reason`,
  `customerIntake.reason`, `/integrations`, `/login`, the guide, `KO_CHROME.customerDataGate`,
  `/ko/pricing`). It still says the workspace shows whether it is open. After an env-only
  rollback this build's copy is no longer fully true: a non-cohort owner reads that processing
  opens once the terms are accepted, accepts, and stays closed. Only the hedge sentence, that the
  workspace shows whether it is open, still holds. That is why Instant Rollback, which reverts the
  copy too, is the first rollback, and an env-only rollback is a short-term measure.
- Load is no longer bounded by the canary width. The PR that adopts this ADR lists the
  concurrency and spend gaps ("Ops readiness"). Close them under their own reviews.
- Nothing here is calibrated or benchmarked. It changes who may pass a gate, not what the
  compiler does.
