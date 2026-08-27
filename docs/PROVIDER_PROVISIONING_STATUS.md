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

The browser dashboard session was unauthenticated. Separately, an account-authorized Cloudflare binding was used to create the dedicated empty foundation bucket described below. No Worker, API token, access key, secret, CORS rule, public endpoint, object, or browser upload signer has been created. The existing production quarantine resources were not visited or changed. Browser-direct customer intake remains globally disabled in the foundation policy.

## Dedicated R2 quarantine bucket

On 2026-08-27, the account-authorized Cloudflare binding created the separate empty bucket `tavonel-saas-foundation-quarantine`. Its provider metadata reports Standard storage, `APAC` location, and default jurisdiction. This is an APAC best-effort placement, not a Korea-residency guarantee. No Worker binding, public endpoint, API token, access key, secret, CORS rule, object, or signing capability was created. The bucket is not connected to this application and cannot accept browser uploads while the global intake policy remains disabled.

Cloudflare’s documented browser-direct R2 mechanism is a server-side presigned `PUT` URL. It keeps R2 credentials out of the browser but requires a dedicated signing identity on the server or Worker.[1] No such identity or credential has been created for this foundation, so an R2 URL must not be issued. The future signer must bind a request to a validated workspace/document key, expected MIME type and content length, and a short expiry; it must not allow arbitrary keys or byte streaming through the application.

## References

[1]: https://developers.cloudflare.com/r2/objects/upload-objects/ "Cloudflare R2 — Upload Objects and presigned URLs"
