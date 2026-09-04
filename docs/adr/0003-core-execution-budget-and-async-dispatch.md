# ADR-0003 — One execution budget, and the compile that still does not fit in it

- **Status:** Partly adopted. The budget is implemented; the asynchronous dispatch it exposes as
  necessary is **not**, and is a decision for the founder.
- **Date:** 2026-09-04
- **Branch this was written on:** `agent/industry-leadership-v3`

## The question

How long is a compile allowed to take, and who is allowed to say so?

## What was there

Three numbers, in three files, that could not all be true.

| Where | Value | What it claimed |
| --- | --- | --- |
| `lib/core-runtime-v2.ts` `buildProductCoreV2Request` | `maxLatencyMs: 90_000` | Core may take 90s |
| `lib/core-runtime-v2.ts` `dispatchProductCoreV2` | `AbortSignal.timeout(60_000)` | the caller waits 60s |
| `app/api/internal/jobs/run/route.ts` | `maxDuration = 60` | the process exists for 60s |

Core was promised ninety seconds by a caller that abandons it at sixty, inside a function the
platform kills at sixty.

Two consequences, and the second is the worse one:

- **Every Core response between 60s and 90s was unreachable.** Core was authorised to spend that
  time and no answer arriving in it could ever be collected. Work was paid for and discarded.
- **The failure was not reliably a failure.** The client timeout and the platform kill land at
  the same instant. When the kill wins there is no catch block, no job event, no receipt — the
  invocation simply stops, and the lease stays held until it expires. A compile that failed this
  way is indistinguishable from one still running.

Separately, and found while writing the tests for the above: `idempotencyKey` was
`sha256(workspaceId + binding + requestId)`, and `requestId` defaults to a fresh UUID per call.
The key identified the *attempt*, not the work. A retry after a timeout was, to Core, a compile
it had never seen — a second World and a second charge for the answer the caller had merely
failed to collect. A test asserted this as intended behaviour.

## Decision

**One derived budget, in `lib/execution-budget.ts`.** Nothing else states a duration.

    WORKER_MAX_DURATION_SECONDS      60      the platform wall clock for one worker turn
    WORKER_SETTLEMENT_RESERVE_MS      8_000  kept back to record an outcome
    CORE_CLIENT_TIMEOUT_MS           52_000  derived
    CORE_MAX_LATENCY_MS              52_000  equal to it, by construction

`CORE_MAX_LATENCY_MS === CORE_CLIENT_TIMEOUT_MS` is the substance. Promising a worker more time
than the caller will wait is what produced work nobody collected.

The reserve is what makes a timeout an *event*. The client gives up with eight seconds of
invocation left, which is time to classify the failure, write the job event and release the
lease. `executionBudgetViolations()` states the invariant as code, and a test asserts it is
empty, so the three numbers cannot drift apart again.

**The idempotency key is now the document binding**, `sha256(workspaceId + binding)`. `requestId`
still identifies the attempt and is still what the receipt binds to. A retry reaches the same
compile.

**A timeout is its own failure code.** `CORE_V2_TIMEOUT` is retryable — Core may well be working
— and `CORE_V2_UNAVAILABLE` keeps its meaning of a Core that could not be reached at all.
Collapsing both into one code left the caller unable to tell "do not retry into this" from "this
attempt gave up".

## What this does not fix

**A compile that genuinely needs more than 52 seconds still cannot complete.** Lowering the
promise makes the system truthful about what it will wait for; it does not make it capable of
more. A bounded worker turn cannot contain an unbounded synchronous call, and the 90s figure was
presumably written because somebody expected compiles to need it.

There are two ways out and both are decisions, not constants:

1. **Raise the wall clock.** `maxDuration` above 60s depends on the Vercel plan. This is a cost
   and plan decision, and it only moves the ceiling — it does not remove it.
2. **Dispatch asynchronously.** Submit the compile, return, and poll across worker turns. This is
   what the rest of the queue already does: `/api/internal/jobs/run` is explicitly one bounded
   turn per invocation, with progress from being called repeatedly. The synchronous Core call is
   the one place that design is violated, and it is the reason a wall clock can fail a compile at
   all. It needs a submit/poll contract with Core, which is a change to the Core interface.

Option 2 is the one consistent with the architecture already written down. It was not built here
because it changes a contract with a component this branch does not own.

**Until one of them happens, the honest statement is:** compiles are supported up to
`CORE_MAX_LATENCY_MS`, and the durable queue is durable for everything except the Core call
inside it.

## Evidence

- `lib/execution-budget.test.ts` — the invariant, the classification of 59s / 61s / 89s, the
  single-source assertions over both files, retry-reaches-the-same-compile, and timeout being
  distinguishable from unavailable.
- `lib/core-runtime-v2.test.ts` — the idempotency assertion, now the reverse of what it was.
