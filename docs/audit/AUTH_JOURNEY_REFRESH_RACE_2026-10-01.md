# Real-Auth journey refresh race (2026-10-01)

## Observation

The manual DB/Auth run `36868958092` on `a54ceb7` ended as follows:

- The `db-rehearsal` job passed.
- The `Real local Auth journey` job failed before the source-revision stage and produced no ledger.
- The log shows:
  - callback repeats and token-refresh 200s;
  - one access-bootstrap `ERR_FAILED`, then 200;
  - `/workspace/world` `page.goto` `ERR_ABORTED`;
  - `AuthRefreshDiscardedError`, then a return to `/login`.
- Earlier intermittent failures hit the same first-inspect locus (`11e50ee`, `86c56f1`).

## Likely cause: harness sequencing (pending the rerun)

The app is not shown to be fault-free; the rerun is the test.

- After the callback, the journey refreshed the browser's session from Node using its own copy of the refresh token, then overwrote `localStorage`. Meanwhile `/workspace` and its single supabase client (`lib/supabase-browser.ts`) were still live.
- This CI stack sets `jwt_expiry = 60`, which is below auth-js 2.112.4 `EXPIRY_MARGIN_MS` (90 s). The live client therefore refreshes on every page load and every 30 s tick, so the journey's copy can be stale.
- Overlapping refreshes produce `AuthRefreshDiscardedError` from the auth-js commit guard. Reuse beyond GoTrue's reuse interval revokes the token family.
- Not reproduced locally: there is no GoTrue stack on this host.

## Change (harness only)

Expiry, redirects and every assertion are unchanged, including the source-binding R1/R2 service assertions.

In `nextjs/scripts/journey/real-auth-ci-journey.mjs`, before the out-of-band rotation, the journey now:

1. waits for network idle;
2. moves the page to the static same-origin `/llms.txt`, where no app client runs;
3. asserts that the browser holds the fixture user's session;
4. rotates that refresh token, asserting a 200 and a rotated token;
5. stores the rotated session before any app page loads again.

## Regression

`nextjs/scripts/journey/real-auth-ci-contract.test.mjs`, "no external refresh rotates a session an active app page holds", requires that:

- exactly two Node-side refresh calls exist;
- the rotation runs only after the static detach, and no app navigation happens until the rotated token is stored;
- the logout revocation probe uses a separate fresh session that the browser never stored, after a global logout.

## Local results (Windows, Node 22.14.0)

- Contract and child-shutdown tests: 9 pass, 0 fail, 2 platform skips.
- `node --check` on the journey: pass.
- ESLint on both files: pass.
- The hosted real-Auth rerun is the qualifying evidence and is not claimed here.
