# Full-journey proof run (G1)

What a real end-to-end run needs, in the order it is needed, and which parts no agent may do.
The harness is `nextjs/scripts/journey/` (`README.md` there describes the 18-step model).

This document does not authorise the run. It lists what the run costs and what it touches so the
decision can be made once, with the facts in front of it.

## What is already true, before anything is run

- **Promotion has no API. It is a browser session.** `app/api/collections/[id]/promote/route.ts`
  authorizes with `getRequestUser` and there is no `/api/v1` promote route at all. A person signs
  in, reviews the candidate and clicks promote. No key, CLI, MCP client or worker can do it.
- **Promotion also needs the Team plan.** The promote route requires plan `studio`
  (`lib/billing-catalog.ts`: Team, `saleChannel: "contact"`). Evaluation trial and Developer
  ($29 self-serve) get `402 STUDIO_SUBSCRIPTION_REQUIRED`. There is no self-serve path to an
  approved World today.
- **The 2026-09-06 run reached step 7 and stopped.** 4 of 6 formats produced a candidate
  collection; none reached a World, because nobody promoted one. `xlsx` never once compiled to
  `ready` (both attempts settled at `review_required`). 10 of 30 receipts landed in
  `operator_review`, with the reason code flapping between `unspecified` and
  `OCR_TIMEOUT_OR_NETWORK` on retries of the same kind of input.

## Decisions that are not an agent's

Already on the founder queue (`D:\CodexProjects\audit-lanes\CA_FOUNDER_QUEUE_2026-09-11.md`).
Do not re-ask them; answer them.

| id | question |
|---|---|
| **FD-59** | Approve the G1 run itself: the spend, the elapsed time, and who performs the browser promote. |
| **FD-15** | Whether running a public-domain fixture PDF through the real pipeline in an internal probe workspace counts as "customer data processing" under `activationPolicy.customerData` (`lib/activation-policy.ts:44`). O02 fixture verification is blocked until this is answered. |
| FD-02 / FD-14 | Whether Developer ($29) keeps its promote/rollback gate, and whether shared-workspace membership (ADR-0001) gets built. Both change who can perform step 8. |

`docs/CUSTOMER_DATA_GATE_2026-09-06.md` records `activationPolicy.customerData.enabled = false`
with several of its 17 preconditions still MISSING. Turning it on is a separate decision from
FD-15 and from FD-59.

## What the run needs

1. **An account on a plan that can promote** — Team (`studio`). Without it step 8 returns
   `402 STUDIO_SUBSCRIPTION_REQUIRED` and steps 9-13 are unreachable.
2. **A `tvnl_live_` API key minted at `/api/developer/keys`, with every scope the chain uses.**
   Read out of the routes rather than guessed:

   | step | route | scope | plan |
   |---|---|---|---|
   | 2 | `POST /api/v1/uploads/capability`, `POST /api/uploads/confirm` | `documents:intake` | observer |
   | 3-5 | `GET /api/v1/documents` | `documents:read` | observer |
   | 6 | `POST /api/compile-jobs` | `collections:compile` | observer |
   | 6 | `GET /api/compile-jobs/{jobId}` | `collections:read` | observer |
   | 7 | `GET /api/v1/collections/{id}` | `collections:read` | observer |
   | 8 | `POST /api/collections/{id}/promote` | **none — browser session** | studio |
   | 9 | `GET /api/v1/collections/{id}/world` | `worlds:read` | observer |
   | 10 | `POST /api/v1/collections/{id}/ask` | `ask:read` | observer |
   | 12 | `POST /api/v1/collections/{id}/search` | `ask:read` | observer |
   | 13 | `GET /api/v1/collections/{id}/download` | `collections:download` | observer |

   A key short one scope fails mid-chain rather than at the start: on 2026-09-06 the first key of
   the day returned `403 API_SCOPE_REQUIRED` at `/api/compile-jobs` after the upload had already
   succeeded, and four receipts record it.
3. **Authorisation to spend on compile.** `/api/v1/collections/compile` refuses a free evaluation
   outright (`402 TRIAL_DURABLE_COMPILE_REQUIRED`); the durable `/api/compile-jobs` path the
   harness uses may still draw paid compute. Nobody but the founder may approve that (FD-59).
4. **A corpus whose rights are cleared.** For J1 the target is 1-3 documents, ≤ 50 standard pages
   in total, within the per-file limits. Choosing it is a rights decision, not a technical one
   (growth `keyword-claims-data` lane owns the rights manifest; WG-013 is on the founder queue).
5. **Sample documents for a smoke run.** This copy of the harness ships none. Either set
   `E2E_FIXTURE_DIR` to `D:\CodexProjects\uskc-lanes\e2e\fixtures` or regenerate them with that
   directory's `make_fixtures.py`. Use `E2E_SALT` on a retry: re-uploading identical bytes is the
   same source version to the worker, so a version already carrying an OCR review record stays in
   review.
6. **Two people, if separation of duties is being honoured.** `docs/runbooks/P0_HUMAN_PROMOTION_ROLLBACK.md`
   requires the requester and approver to be different authenticated operators.

## The run

```
cd nextjs

# 0. Read the plan. No credential, no call, no file written.
node scripts/journey/prove.mjs --plan

# 1. Prove the surface refuses without a key. Writes receipts/unauthenticated_probe.json.
node scripts/journey/prove.mjs --probe

# 2. The real run. One format first; the whole set only after one works.
E2E_FIXTURE_DIR=<sample dir> E2E_FORMATS=pdf TAVONEL_API_KEY=tvnl_live_... \
  node scripts/journey/prove.mjs
```

The run stops at step 7 and prints the promote deep link plus the exact `--resume` command. Then,
by hand:

```
# 3. Open the printed /workspace?collection=...&job=... , sign in, review the candidate, promote.
# 4. Continue from the receipt the run wrote. Steps 9-13, including the package download.
node scripts/journey/prove.mjs --resume "receipts/pdf_<stamp>.json"
```

A resume writes a **new** receipt beside the original. The original is never overwritten — that is
what step 17 (`previous_result_preserved`) records, and the only way it ever reports `PASS`.

```
# 5. Read any receipt back against the 18-step model.
node scripts/journey/acceptance-checker.mjs "receipts/pdf_resume_<stamp>.json"
```

Exit 0 from the checker means the receipt is an honest record, **not** that the journey passed.
The table says that, row by row.

## Reading the result

- `PROVEN_E2E` requires the answer's evidence to contain the uploaded document's own token. A
  grounded answer citing something else is `TOKEN_NOT_IN_EVIDENCE`, and it proves retrieval ran,
  not that this document was read.
- A safe refusal is a safety result and not a completed job. `operator_review` passes step 5 and
  leaves step 4 `HELD`; an abstention passes step 10's execution and holds its semantic result.
- Step 18 will read `PARTIAL` on every receipt until something measures cost. The receipt says
  `costAccounting.measured: false` with the reason. Do not fill in a number by hand.
- Steps 14-16 will read `NOT_RUN`. They are not implemented, and no result may be labelled
  `NOT_APPLICABLE` to make the table look finished.

## What to keep

The receipt files, the downloaded package and its sha256, and the checker's table. Those are the
G1 completion evidence the blueprint's Gate 1 asks for. A public claim drawn from them still needs
its own claim record and a founder's publication approval — a receipt is evidence, not permission.
