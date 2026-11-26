# ADR-2026-11-18 — Confluence Cloud as a source (decision record only)

- **Status:** proposed, 2026-11-18. **Decision recommended: hold.** Nothing is built until a paying customer asks
  for Confluence (MP:2877 "ERP/CRM/DB/Notion/Confluence | future source-specific adapters"; MP:33598 orders
  "Google Drive read-only 1종 + 로컬 folder 1종, 그 후 SharePoint/Confluence/GitHub"). This record changes no code,
  route, copy or price, and it names no provider on a public page.
- **Work order:** WO-E-CON-6 (`v34-lanes/workorders/all-features/E-unsized-features.md` §1). Companion record:
  `ADR-2026-11-18-notion-connector.md`.
- **Base read:** `codex/v34-e-adr` at `aa462a6b` (Foundation tree = `codex/v34-fnd-int` e9364899 plus the two
  earlier ADRs of this lane). `file:line` is at that commit; `MP:n` is a line of
  `TAVONEL_CANONICAL_MASTERPLAN_V5_6_V34_2026-11-16.md`.
- **Provider pages:** `A1`–`A8` below. Each was read on 2026-11-18 through WebFetch (≈13:30–13:37Z, a
  model-written extraction) and then fetched once as bytes (13:38:07–13:38:14Z) into
  `v34-lanes/receipts/WO-E-CON-6/snapshots/`. Every sentence quoted here was found again in those bytes by
  `receipts/WO-E-CON-6/verify_cited.py` (61 phrases across both records, 0 missing;
`verify_cited.out.txt`; a planted absent phrase fails it, `verify_negative_control.out.txt`). A quote is a fact about the
  page on that date, not about the API's behaviour; nothing here was called with a token.

## 1. Pages read, and the licences they are

Code licence, hosted-API terms and data terms are separate licences. Clearing one clears none of the others.

| Id | URL | Retrieved (UTC) | HTTP | sha256 of bytes |
|---|---|---|---|---|
| A1 | https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/ | 2026-11-18T13:38:07Z | 200 | `697004167ce135aa50cf6de973302742a364a7a0e5f24359f867c7887a12c744` |
| A2 | https://developer.atlassian.com/cloud/confluence/scopes-for-oauth-2-3LO-and-forge-apps/ | 2026-11-18T13:38:08Z | 200 | `f4ed08e23f83eb25ffa603804394b9d1d48c3e6d424e2d504f12b89e79029107` |
| A3 | https://developer.atlassian.com/cloud/confluence/webhooks/ | 2026-11-18T13:38:09Z | **404** | `125044f220f7154478062b925b6a55e1006983149e85d13471a961308cd0f02d` (error page) |
| A4 | https://developer.atlassian.com/cloud/confluence/user-privacy-developer-guide/ | 2026-11-18T13:38:11Z | 200 | `37d060497e3cb721a06ed1d80c2cc2876da483123aa6378faa480c3fda60ca14` |
| A5 | https://developer.atlassian.com/platform/marketplace/atlassian-developer-terms/ | 2026-11-18T13:38:12Z | 200 | `729dfa9139efd073cf31a9d7d52f7df24da31b0732ce2d08eb952243e2e5a95e` |
| A6 | https://developer.atlassian.com/cloud/confluence/rate-limiting/ | 2026-11-18T13:38:12Z | 200 | `4c521df73562f4323c125cc856b380054a84f00b597b2c1c5e1fc64c71550fcf` |
| A7 | https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-permissions/ | 2026-11-18T13:38:14Z | 200 | `efbe70c36ab07e1ea2c66a2788bf023c2ec5a63ba71702f315ce0dc9825cdf4b` |
| A8 | https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-search/ | 2026-11-18T13:38:14Z | 200 | `963287b6273f9747c788ab4e0c5feb2acfad4e988f6db2c3d3c1b56ae611a1cf` |

- **Hosted-API terms — read:** Atlassian Developer Terms (A5), "Effective starting: December 1, 2025".
- **Hosted-API terms — not read:** the Atlassian Marketplace partner agreement and the Marketplace security
  requirements (only relevant if TAVONEL lists on the Marketplace, which this record does not propose); the
  Atlassian Cloud terms that bind the *customer*.
- **Code licence:** none needed for the design below, which calls the REST API with `fetch` and the existing
  `safeFetch` guard. No Atlassian SDK licence was read. Any SDK, Forge CLI or Connect library proposed later needs
  a `TECHNOLOGY_INTAKE_REGISTER.yaml` row first. The register has no Atlassian, Confluence or Notion row today
  (`grep -i "notion\|confluence\|atlassian"` → 0 lines).
- **Data terms:** the content is the customer's. A5 §9.2 puts the consent on the app vendor: "You must obtain all
  necessary rights, permissions, and consents from end users" and "You may not sell any End User Data". The
  customer's own Atlassian agreement was not read.
- **Model weights:** not applicable.

## 2. Provider facts (as the pages state them)

**OAuth model (A1).** OAuth 2.0 (3LO), authorization code grant. Requests go through `api.atlassian.com` with a
per-site `cloudid` from the accessible-resources call, not the customer's `*.atlassian.net` host. Refresh needs the
`offline_access` scope, and "Rotating refresh tokens issue a new, limited life refresh token each time they are
used." The app acts as the consenting user: "the permissions held by the user an app is acting for always
constrain the app, regardless of the app's scopes."

**Read scopes (A2).** Atlassian recommends classic scopes ("the recommendation is to use classic scopes"). The
minimum read set for this design is `read:confluence-content.all`, `read:confluence-space.summary`,
`readonly:content.attachment:confluence`, `search:confluence` (A8), `read:confluence-content.permission` (A7),
plus `offline_access`. No write scope is requested.

**Change feed.** The official Confluence Cloud webhook page returns 404 (A3). No page read here documents a
webhook that an OAuth 2.0 (3LO) app can register for Confluence. **Not established.** Community posts say there is
no supported path, but they are not provider documentation and are not relied on. The design therefore **polls**:
CQL search on `/wiki/rest/api/search` (A8), ordered by last modification, with next/prev links for paging. A8 also
says "only entities that the user has permission to view will be returned". So a page that leaves the user's view
drops out of the inventory instead of announcing itself. Deletion and unshare are only seen by **inventory
reconciliation**, not by an event. Forge "product events" exist, but Forge is an Atlassian-hosted app model with
different distribution and runtime terms. It is out of scope here and was not read.

**ACL model.** There are two layers, and only one can be checked:

1. *The connecting user's view.* The token can read only what that user can read (A1, A8). A fresh read that
   comes back denied or missing means that user lost access.
2. *Other TAVONEL viewers.* A7 offers `POST /wiki/rest/api/content/{id}/permission/check` ("Check if a user or a
   group can perform an operation to the specified content"). The subject is an Atlassian account id or group id.
   TAVONEL holds no mapping from a workspace member to an Atlassian account id. Space permissions and inherited
   page restrictions were **not read**, so a full per-page ACL snapshot (the Drive model,
   `nextjs/lib/google-drive-acl-capture.ts:55`) cannot be designed from what is on file.

**Distribution and review (A1).** A new 3LO app is private ("it's private by default"). To let other customers
install it, "you must enable sharing". After that, "Users trying to install an unapproved OAuth 2.0 integration
are warned that the app has not yet been reviewed by Atlassian", and "Enabling sharing doesn't make your app
available on the Atlassian Marketplace". No review is required before sharing. The approval process that removes
the warning was not read.

**Personal data (A4).** "All apps storing personal data must report user personal data, using the Personal data
reporting API." The default reporting cycle is 7 days, and a `Cycle-Period` header can override it. TAVONEL
stores the connecting user's provider account id and label (`OAuthProviderIdentity`,
`nextjs/lib/connector-oauth.ts:25-28`; persisted as `provider_account_id` at
`app/api/v1/oauth-connectors/callback/[provider]/route.ts:77` and `nextjs/lib/connector-oauth-store.ts:221`), so
the obligation applies from the first connection. The page states no
penalty for not reporting.

**Terms that touch the design (A5).** Two clauses matter:

- §6 bars calls "not driven by a request from an end user or the Marketplace App itself". A background poll is
  driven by the app. Whether a scheduled poll counts as "driven by … the Marketplace App" for a non-Marketplace
  3LO app is a reading for counsel or the lead, not for an implementer.
- §6 also bars using the platform to "build a competitive product".
- §16.2: Atlassian may terminate on 30 days' notice, or suspend access.

**Rate limits (A6).** Atlassian uses a "points-based model", with enforcement from March 2, 2026. Tier 1, the
default, is one 65,000-point hourly quota for the app **across all tenants**. When it is exhausted, "all requests
are blocked until reset". Per-tenant quotas come only after Atlassian review. So one customer's first inventory can
starve every other customer's sync for the rest of the UTC hour. Object costs beyond the base point were not
tabulated here, so **no customer-count or page-count ceiling is stated**.

## 3. What the Foundation already has, and what a fourth provider would touch

- **Provider list in code:**
  - `OAUTH_CONNECTOR_PROVIDERS` (`nextjs/lib/connector-oauth.ts:1-5`)
  - `PROVIDER_ENV` (`:32-36`)
  - `PROVIDER_CONTRACTS` (`:48-66`)
  - the per-provider origin allow-list (`nextjs/lib/connector-oauth-adapters.ts:51-57`). Confluence would be the
    single origin `https://api.atlassian.com`, under the path prefix `/ex/confluence/{cloudid}/wiki/`.
- **Provider list in the database (one migration):**
  - `check (provider in ('google_drive','dropbox','microsoft_graph'))` in `supabase/migrations/0013_connector_oauth.sql:18,38`
  - the same check in `20260909193323_connector_document_bindings.sql:9`
  - the same check in `20260920132000_legal_hold_deletion_sweeper.sql:11`
  - the sweeper input check at `:312`
  - the reader and cursor rules in `20260909210203_connector_sync_checkpoints.sql:58-67,113-115`. These need a
    `confluence-cql-v1` reader and a bounded cursor shape.
- **Critical read fails closed for any provider but Drive.** `nextjs/lib/connector-critical-read.ts:49-50`
  refuses export delivery for any bound non-Drive source. The comment there reads: "any other bound provider
  cannot be checked, so it fails closed". That refusal is correct and stays the default. A Confluence fresh check
  (re-read the page as the connecting user at delivery) would be new code there.
- **Rotating refresh tokens are not persisted.** `refreshOAuthAccessToken` returns the new refresh token
  (`nextjs/lib/connector-oauth.ts:203`). The sync worker keeps only the access token
  (`nextjs/lib/sync-worker.ts:183-184`), and so do the critical read (`connector-critical-read.ts:93`) and
  `google-drive-acl-refresh.ts:153`. `putOAuthSecret` is called only at authorize and callback. Under A1's
  rotation, the stored token would be the spent one after the first refresh. Whether Atlassian accepts a spent
  token for a grace interval is **not established**. A Confluence connector therefore needs a compare-and-swap
  write-back of the rotated token, serialised per connection, because the sync worker and the critical read can
  refresh concurrently. This is the item most likely to break a connection silently. It belongs in the first test
  list.
- **Content form.** A Confluence page is not a file. Its body would have to enter as HTML. The text-input path is
  withheld (`shared/capabilityManifest.ts:395` `TEXT_INPUTS_LIVE = false`; WO-E-FMT-1/FMT-2). Attachments are
  files and can use the existing upload path. Which body representation to request was not read.
- **Trial accounts get 402** on every connector route (`app/api/v1/oauth-connectors/authorize/route.ts:14`).
  The connector reaches paying or operator-granted workspaces only.

## 4. Options

| | Option | Fails how | Rollback |
|---|---|---|---|
| **H** | **Hold** (recommended): no code. `/connect` names Confluence only as "not yet available", under WO-E-CON-0's `QUALIFIED_CONNECTORS` gate | A prospect who needs Confluence goes elsewhere | — |
| P | 3LO app with sharing enabled, CQL poll plus inventory reconciliation, connecting-user visibility only (other members see a Confluence source only if the workspace owner shares it inside TAVONEL), fresh re-read at critical read | The shared 65,000-point Tier 1 quota throttles every tenant at once; a missed rotation write-back kills the grant; deletion is seen only at the next full inventory | Provider absent from `QUALIFIED_CONNECTORS`; env names removed; the migration keeps the wider check (additive, harmless) |
| F | Forge app with product events | Different runtime, hosting and terms, none of them read; a second app model to operate | not designed |

## 5. Build estimate if a paying customer asks (option P)

**L**, 16–24 lane-hours (start value, uncalibrated; implementer + review + one fix round, integration excluded),
plus **one migration** (§3 list). It starts after:

- WO-E-CON-3, so the connector pattern is proven on two providers in production;
- WO-E-FMT-1, so HTML input is live;
- an intake row if any library is proposed.

Contents:

1. The provider contract and the origin allow-list.
2. Accessible-resources → `cloudid` binding.
3. Rotation write-back with CAS, with tests for a concurrent refresh and a spent token.
4. The CQL poll reader and its cursor.
5. Inventory reconciliation that turns "absent from the user's view" into suspension, never into a purge.
6. The page body as HTML. Attachments go through the existing path.
7. The critical-read fresh check.
8. The personal-data reporting job on A4's cycle.
9. The migration.
10. WO-E-CON-3-style drills with a receipt.

Provider clock: none before sharing (A1). The unreviewed-app warning stays until an approval step that was not
read.

## 6. Not established (read before building)

- Whether a 3LO app can register Confluence webhooks (A3 is 404).
- Refresh-token lifetime and spent-token grace.
- Space permissions and restriction inheritance.
- Per-object point costs.
- Which body representation to request.
- The approval step that removes the "not yet been reviewed" warning.
- The A5 §6 reading for scheduled polling.
- The customer-side Atlassian terms.
