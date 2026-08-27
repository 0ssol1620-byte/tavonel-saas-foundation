# Provider Provisioning Status

## Supabase Seoul project preflight

On 2026-08-27, the authenticated organization’s new-project form confirmed that **Northeast Asia (Seoul) / `ap-northeast-2`** is available. The unsubmitted draft was configured with Data API enabled, automatic public-table exposure disabled, and automatic RLS enabled. The provider’s recommended standard Postgres option was retained.

No Supabase project was created during this preflight. A provider-generated database credential surfaced in the automated browser transcript before the final creation action, so the draft is being discarded rather than reusing that material. No credential was copied, persisted, transmitted to the application, or used to create a project.

## Next safe action

Create the dedicated Seoul project only through a secret-safe user-controlled password entry path, then obtain provider public configuration and server-only credentials through managed secret handling. Before migration application, confirm the target project identifier and apply the reviewed tenant migration to that project only.

## Paddle sandbox preflight

The current browser session reaches the Paddle sandbox login screen but has no authenticated vendor session. No Paddle vendor account, catalog, checkout link, notification destination, signing secret, or live billing configuration was created or modified. The foundation therefore continues to return `BILLING_NOT_CONFIGURED` for every checkout intent.

## Cloudflare R2 preflight

The current browser session reaches the Cloudflare sign-in screen and has no authenticated dashboard session. No R2 bucket, Worker, API token, access key, secret, or upload signer was created or modified. The existing production quarantine resources were not visited or changed. Browser-direct customer intake remains globally disabled in the foundation policy.
