# Provider Provisioning Status

## Supabase Seoul foundation

On 2026-08-27, a dedicated project named `tavonel-saas-foundation` was created in the `Phillip's projects` organization through the authenticated provider integration. Its immutable project reference is `tfcorhjkqcuisqhsjemz`; its selected region is **Northeast Asia (Seoul) / `ap-northeast-2`**; and its verified state is `ACTIVE_HEALTHY`. The project was empty before the reviewed migrations were applied.

The foundation target has received `0001_tavonel_tenant_foundation`, `0002_credit_ledger_and_gpu_reservations`, `0003_harden_rls_function_exposure`, and `0004_harden_credit_ledger_rls`. It contains 13 public metadata/permission tables, all RLS-enabled and observed empty after migration. A rollback-only synthetic A/B tenant probe returned `rls_matrix_passed: true` with zero persisted fixture rows. The final Security Advisor scan returned `lints: []`; the detailed nonsecret evidence is in `docs/SUPABASE_QUALIFICATION.md`.

An earlier browser-only draft is permanently discarded because a provider-generated database credential surfaced in its transcript before the draft was canceled. That credential must never be retrieved, repeated, reused, transmitted, committed, or configured. The later dedicated project was created without reproducing that value.

## Next safe action

Email and Google OAuth are still unconfigured. Before either provider is enabled, obtain contextual approval of the exact foundation HTTPS origin, redirect URI, newly dedicated Google OAuth client/consent configuration, and secure client-secret handling. Public Supabase configuration may be configured only after that approval; server-only credentials must remain in managed secret storage and outside browser code and source control.

## Paddle sandbox preflight

The current browser session reaches the Paddle sandbox login screen but has no authenticated vendor session. No Paddle vendor account, catalog, checkout link, notification destination, signing secret, or live billing configuration was created or modified. The foundation therefore continues to return `BILLING_NOT_CONFIGURED` for every checkout intent.

## Cloudflare R2 preflight

The browser dashboard session was unauthenticated. Separately, an account-authorized Cloudflare binding was used to create the dedicated empty foundation bucket described below. No Worker, API token, access key, secret, CORS rule, public endpoint, or browser upload signer has been created. The existing production quarantine resources were not visited or changed. Browser-direct customer intake remains globally disabled in the foundation policy.

## Dedicated R2 quarantine bucket

On 2026-08-27, the account-authorized Cloudflare binding created the separate empty bucket `tavonel-saas-foundation-quarantine`. Its provider metadata reports Standard storage, `APAC` location, and default jurisdiction. This is an APAC best-effort placement, not a Korea-residency guarantee. No Worker binding, public endpoint, API token, access key, secret, CORS rule, object, or signing capability was created. The bucket is not connected to this application and cannot accept browser uploads while the global intake policy remains disabled.

Cloudflare’s documented browser-direct R2 mechanism is a server-side presigned `PUT` URL. It keeps R2 credentials out of the browser but requires a dedicated signing identity on the server or Worker.[1] No such identity or credential has been created for this foundation, so an R2 URL must not be issued. The future signer must bind a request to a validated workspace/document key, expected MIME type and content length, and a short expiry; it must not allow arbitrary keys or byte streaming through the application.

On 2026-08-27, the exact Foundation bucket completed one authorized, harmless 69-byte ASCII marker `PUT` → same-key `GET` → immediate `DELETE` transaction. All three responses were HTTP 200 and the object was removed. This only proves the dedicated bucket control plane; it does not qualify a customer upload path, CORS, a signer, MIME/size enforcement, tenant authorization, CDR, or customer-data handling. The nonsecret record is `docs/SYNTHETIC_R2_QUALIFICATION_2026-08-27.md`.

## Foundation CDR and GPU qualification status

The isolated Google Cloud project `tavonel-saas-foundation` now has its own attachment to the existing active billing account, after Google approved one additional paid-services-project quota and the user explicitly approved this Foundation-only association. With further explicit approvals, Cloud Run Admin API (`run.googleapis.com`), Secret Manager API, and Cloud Build API were enabled only in this Foundation project.

The reviewed one-shot HMAC bootstrap then succeeded in a Foundation-only Cloud Build. Its nonsecret log marker confirmed creation, and Secret Manager lists `tavonel-cdr-hmac` with one version, user-managed location `asia-northeast3`, and the intended `system=tavonel`, `component=cdr`, `scope=synthetic` labels. The secret payload was never opened or printed. The same build created no artifacts. The Cloud Run overview remains empty and presents create/deploy actions, not an existing service. There is still no Foundation Cloud Run service, Artifact Registry artifact, CDR request, or GPU resource. The existing production CDR service is neither used nor changed. The Foundation-local CDR copy has passed its ten harmless fixture tests locally; no deploy or synthetic invocation may occur until the separate final CDR deployment approval is satisfied.

RunPod remains disconnected for this task. A provider-independent source contract now prevents even a future endpoint-create call unless immutable release evidence and fresh read-only capacity evidence are present, the request is synthetic-only, `QUALIFICATION_ONLY` behavior disables SSH, HTTP health is on port `8001`, minimum workers and persistent volume are both zero, container disk is at least 80 GiB, cumulative committed plus estimated spend is at most $5 USD, and no previous paid-write result exists. The contract does not invoke RunPod, issue a credential, or override the global disabled GPU-dispatch gate. Its four regression cases are in `server/foundation/runpodSyntheticQualification.test.ts`.

## Cloudmersive inquiry — relevance only

Cloudmersive replied to a prior Advanced CDR sales inquiry. The vendor states that requests are stateless/in-memory, customer payloads are not stored or used for training, and employees do not access customer data; it offered a DPA and Managed Instance options for review. This is relevant as a **possible future third-party CDR alternative**, but it is not part of the Foundation's active architecture and is not a qualification result. The reply did not establish the requested APAC processing/failover/logging/backup locations, retention/deletion terms, authentication controls, supported-format limits, pricing/POC/cancellation terms, or an executed DPA. No account, API key, contract, managed instance, customer-data request, or reply was created or sent.

## References

[1]: https://developers.cloudflare.com/r2/objects/upload-objects/ "Cloudflare R2 — Upload Objects and presigned URLs"
