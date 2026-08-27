# Foundation CDR Synthetic Preflight — 2026-08-27

## Result

The existing Google Cloud Run service `tavonel-pdf-cdr` in `asia-northeast3` was inspected without deploying, editing, or invoking a sanitization request. Its service detail page exposed the public service URL, automatic scaling with minimum zero and maximum one instance, and recent build history. A read-only `/health` request returned the following nonsecret response:

> `{"status":"unavailable","reason":"CDR configuration is not qualified"}`

This means the Foundation cannot legitimately mark CDR as qualified yet. No document, customer byte, payment, R2 signer, Cloud Run deployment, or GPU action was performed during this check.

| Check | Observation | Decision |
|---|---|---|
| Service existence | `tavonel-pdf-cdr` exists in `asia-northeast3` | Read-only presence confirmed |
| Health endpoint | `/health` returned `status: unavailable` | CDR remains fail-closed |
| Sanitization request | Not sent | Correct; unqualified service must not process even synthetic payloads |
| Next safe step | Confirm exact bootstrap evidence and service configuration path | Required before any `/v1/sanitize` call |

## Boundary

This preflight is deliberately not a CDR qualification. The next safe action is to inspect the recorded bootstrap contract and obtain nonsecret evidence that configuration has been qualified. Until then, the application should continue to report CDR as unavailable and prevent customer intake.

## Separate Foundation Cloud project

After the original service was confirmed unqualified, a separate Google Cloud project named `TAVONEL SaaS Foundation` was created with immutable project ID `tavonel-saas-foundation` and no organization parent. Its Cloud Run services page is empty. This establishes a distinct target for later synthetic CDR qualification; it does not copy, modify, or route traffic to `tavonel-knowledge-compiler` or `tavonel-pdf-cdr`.

Cloud Run Admin API has not been enabled in the new project, no service has been deployed, and no billing configuration, source connection, secret, customer byte, or sanitization request has been created. These remain explicit prerequisites before a future Foundation CDR endpoint can exist.

## Local fixture qualification

The PDF-raster CDR implementation was copied into the Foundation repository from the user-owned activation repository at immutable commit `e017cb65b8dd0a666740aa53a671a4ae10171dda`. The source repository was not modified. Only the Foundation copy's one-shot bootstrap project identifier was changed to `tavonel-saas-foundation`; the copy contains no HMAC, API key, account credential, or production value.

After installing only the pinned fixture-test requirements, the Foundation copy passed all ten Python tests in 12.720 seconds. The suite used harmless in-process fixtures and verified unavailable-without-HMAC, invalid signature rejection, source digest mismatch rejection, duplicate authenticated-request rejection, ZIP/legacy-office/macro rejection, rasterized image-only PDF creation, digest-bound response headers, and Office conversion. No Docker daemon, Cloud Run instance, R2 object, customer file, billing configuration, CDR secret, or sanitization endpoint was used.

| Evidence | Result |
|---|---|
| Source provenance | Pinned activation commit `e017cb65…` copied read-only into Foundation |
| Local suite | 10 tests passed; harmless fixtures only |
| Runtime HMAC | Not generated or configured; correct fail-closed condition retained |
| Cloud Run API/service | Not enabled or created in Foundation project |
| Production service | Not edited, redeployed, or invoked for sanitization |
