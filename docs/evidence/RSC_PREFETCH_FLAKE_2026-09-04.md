# The Firefox RSC prefetch flake, found

**Measured:** 2026-09-04 · **Tree:** `agent/industry-leadership-v3` @ `79a280d`
**Target:** Vercel Preview `dpl_FHw4d8yhVFRKcAyEUyEbWvLtKC8p`
(`tavonel-saas-foundation-g13fn5dvy-phillips-projects-a8cf32fc.vercel.app`, deployment
protection off, so Playwright reaches it without a bypass token)
**Tool:** `nextjs/scripts/rsc-prefetch-probe.mjs`, Firefox 1440×900

## What was claimed before, and why it was wrong

The previous revision of the traceability file said this test flaked only under the local
eleven-project matrix, and read that as contention between projects sharing one `pnpm start`.

That was wrong. Run against a Preview, alone, with nothing else on the machine, the spec failed
on its **first** attempt. Contention was a plausible story fitted to where it had been seen,
not a cause anyone had looked for.

## What it actually is

Two unrelated console errors were failing one assertion.

### 1. `Failed to fetch RSC payload … Falling back to browser navigation`

A navigation that happens while an RSC prefetch is in flight. Firefox cancels the request —
the network log shows `NS_BINDING_ABORTED` — and Next logs the fallback.

The controlled sweep, varying only how long each page is left alone before the loop navigates
on, four runs each, request interception on throughout:

| Settle | Prefetches issued | Prefetch non-200 | Runs with an RSC error |
| --- | --- | --- | --- |
| 0 ms | 0 | 0 | 0 of 4 |
| 200 ms | 19–24 | 0 | **3 of 4** |
| 400 ms | 24 | 0 | 0 of 4 |
| 700 ms | 11–24 | 0 | 0 of 4 |
| 1500 ms | 24 | 0 | 0 of 4 |

Two things this settles:

- **No prefetch ever returned a non-200.** Across every configuration, zero. The server is not
  failing these requests; the browser is cancelling them.
- **At 0 ms no prefetch is even issued** — the loop navigates before the router starts — and
  the errors disappear for the opposite reason to 400 ms. The failure lives in a window,
  which is why it looked like contention: anything that moved the timing moved the result.

The spec's loop navigated on as soon as `main` was visible, roughly 200 ms, landing in that
window. It was causing the condition it was failing on.

**Request interception was ruled out first.** The spec stubs Supabase and Paddle with
`page.route`, and installing any route handler turns on interception for the whole context.
Five runs with interception on and a 1500 ms settle produced 24 prefetches, all 200, zero
errors. Not the cause.

### 2. `Content-Security-Policy: … blocked a script … at https://vercel.live/…/feedback.js`

Vercel injects its feedback widget into Preview deployments. The site's `script-src` does not
list `vercel.live`, so the browser refuses it. This is the CSP working: an unexpected
third-party script appeared in the page and was not executed. It is Preview-only, and the
policy is **not** widened to admit a preview tool.

## What changed

The spec waits for the network to settle before navigating on, which removes the cause. The
Preview toolbar's CSP error is annotated and excluded, in the same shape as the existing
WebKit-TLS and dev-CSP exclusions, with the reason next to it.

Filtering the RSC message instead would have hidden it and left the assertion unable to tell a
cancelled prefetch from a broken one.

## Verification

`playwright test --project=launch-firefox e2e/launch-qa-cross-browser.spec.ts --retries=0
--repeat-each=20` against the Preview above:

    40 passed (1.6m)

Twenty repeats of both tests in the file, **retries disabled**, so a pass is a pass and not a
retry. No flaky result.

## What a real visitor sees

A reader who clicks a link within about two hundred milliseconds of the page painting cancels
the prefetch for it and gets an ordinary browser navigation to the page they asked for. The
console line is the router saying so. The page loads.

That is a log line, not a defect, and it was never the same thing as "the site is broken in
Firefox" — but nor was it the test-environment artefact the previous revision called it, and
the difference is why this was measured instead of retried.
