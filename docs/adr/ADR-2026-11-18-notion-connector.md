# ADR-2026-11-18 — Notion as a source (decision record only)

- **Status:** proposed, 2026-11-18. **Decision recommended: hold.** Nothing is built until a paying customer asks
  for Notion. MP:2877 lists Notion among "future source-specific adapters", and it is absent from the build order
  at MP:33598. This record changes no code, route, copy or price, and it names no provider on a public page.
- **Work order:** WO-E-CON-6. Companion record: `ADR-2026-11-18-confluence-connector.md`. Its §3 (what a fourth
  provider touches in the Foundation) applies here unchanged, and is cited rather than repeated.
- **Base read:** `codex/v34-e-adr` at `aa462a6b`. **Provider pages:** `N1`–`N9` below. They were read on
  2026-11-18 through WebFetch (≈13:31–13:36Z, a model-written extraction) and fetched once as bytes
  (13:38:15–13:38:18Z) into `v34-lanes/receipts/WO-E-CON-6/snapshots/`. Every sentence quoted here was found again
  in those bytes by `receipts/WO-E-CON-6/verify_cited.py`. Nothing was called with a token.

## 1. Pages read, and the licences they are

| Id | URL | Retrieved (UTC) | HTTP | sha256 of bytes |
|---|---|---|---|---|
| N1 | https://developers.notion.com/docs/authorization | 2026-11-18T13:38:15Z | 200 | `483749a45d374e58a4df5ff56ecfb99a4c30f9fc6e0fbc6d46375c6cff6c268a` |
| N2 | https://developers.notion.com/reference/capabilities | 2026-11-18T13:38:16Z | 200 | `9a9fcbf34a5fc0a2d0beb695fe5a5837004c0ae52a508f92042e6efbc1fac025` |
| N3 | https://developers.notion.com/reference/webhooks | 2026-11-18T13:38:16Z | 200 | `0f1eeeb08a9628e036d5b6a1274065f62b8fafed2ce0ec855496e7af658a4c1f` |
| N4 | https://developers.notion.com/reference/webhooks-events-delivery | 2026-11-18T13:38:16Z | 200 | `48f3e1998a1630f01c6d2312ca7745605402fa05b7f233b094fe0f2930a36e6d` |
| N5 | https://developers.notion.com/reference/request-limits | 2026-11-18T13:38:17Z | 200 | `2563fbf3d3419232ae605eb1b12dfa1e0e82cf478d81917271c974bd8be31f03` |
| N6 | https://developers.notion.com/reference/status-codes | 2026-11-18T13:38:17Z | 200 | `ade9f44d7655c0b7107928f6a87dbc67a18901abfda46e3125e4191be02c030e` |
| N7 | https://developers.notion.com/guides/connections-and-tokens/public-integrations/marketplace-listing | 2026-11-18T13:38:17Z | 200 | `b3bb7f3beffb4082a01d303cdc82c80084ae585cb16b8348d13aeacb5578e0a3` |
| N8 | https://developers.notion.com/guides/connections-and-tokens/public-integrations/overview | 2026-11-18T13:38:17Z | 200 | `c1a3ff1bcc6f949945a1f8a75156db3ef61c633e18dcca4644cf0b70ddebd23f` |
| N9 | https://notion.notion.site/Developer-Terms-ba4131408d0844e08330da2cbb225c20 | 2026-11-18T13:38:18Z | 200 | `adf38823857b1d2245d50f9b519004b97201cb33c25046d77c0ef09c9b462c86` (**JavaScript shell, no terms text**) |

- **Hosted-API terms — NOT READ.**
  - The Notion Developer Terms page (N9) returned a 23,505-byte JavaScript shell. Neither the extraction nor the
    bytes contain the terms text: no "license" and no "compete" in the body.
  - `https://www.notion.com/notion/Developer-Terms-…` redirects (307) to `app.notion.com`, which was not fetched.
  - The Integration Gallery / Marketplace terms were not read.
  - **No clause of Notion's API terms is known to this record.** Before any build, someone reads them in a
    rendered browser and saves a dated snapshot.
- **Code licence:** none needed for a `fetch`-based client. No Notion SDK licence was read. Any SDK needs an intake
  row first. The register has no Notion row today.
- **Data terms:** the content is the customer's. Notion's terms on what an integration may store or must delete
  were not read (see above).
- **Model weights:** not applicable.

## 2. Provider facts (as the pages state them)

**OAuth model (N1, N8).**

- A public connection "users can install in any Notion workspace" (N8).
- Authorize at `https://api.notion.com/v1/oauth/authorize`; exchange at `https://api.notion.com/v1/oauth/token`
  (N1).
- N1 describes a `refresh_token`. Token lifetime and whether the refresh token rotates are **not stated** on the
  pages read. Companion §3 notes that the Foundation does not persist a rotated refresh token. If Notion rotates,
  that gap applies here too.
- Installation scope ("Any workspace" or selected workspaces) "can't be changed afterward" (N7). It has to be
  chosen correctly at registration: Any workspace, if this is ever built.

**Read scope = capabilities plus the page picker (N1, N2).**

- Notion has no OAuth scope strings. The integration declares capabilities (read content, comments, user
  information with or without email; N2).
- The user then picks pages: "The page picker only displays pages or databases to which a user has full access",
  and "giving access to a parent page will provide access to all available child pages" (N1). N2 says the same:
  "can read and write to both that resource and its children".
- The design requests **read content only**: no update, no insert, no comments, user information without email.

**Change feed (N3, N4).**

- Webhooks exist and are signed (`X-Notion-Signature`). N3 calls validation optional ("payload validation is
  optional"). TAVONEL would verify every request and refuse unsigned ones.
- Events listed include `page.created`, `page.deleted` (moved to trash), `page.moved`, `page.undeleted`,
  `page.content_updated` and `page.properties_updated` (N4).
- Delivery: "We aim for at-most-once event delivery". Retries go "up to 8 times", and the last comes
  "approximately 24 hours" after the trigger. "Events may arrive in a different order than they occurred". Content
  events are aggregated over about a minute. "Many events don't include the full content that changed" (N4).
- **No event signals a sharing or permission change.** None is listed in N4.
- Consequence: at-most-once is weaker than the platform's at-least-once rule. So webhooks can only be a **hint
  that triggers a fetch**. The record of truth is a periodic **inventory poll** of what the connection can see,
  and an unshare is visible only there.
- The search/list endpoint the poll would use was **not read**.

**ACL model.** There are two layers again:

1. *What the integration can see.* This is the page-picker grant. When a page is no longer shared, N6's 404
   `object_not_found` applies: "This error can also indicate that the resource has not been shared with owner of
   the bearer token". A fresh retrieve at critical read therefore fails closed on unshare. The Foundation already
   refuses export for any non-Drive binding (`nextjs/lib/connector-critical-read.ts:49-50`), and a Notion fresh
   check would be new code there.
2. *Which Notion workspace members can read a page.* Nothing read here exposes a per-page member ACL. TAVONEL
   cannot mirror Notion's own permissions. Visibility inside TAVONEL would be the connecting user's, or what the
   TAVONEL workspace owner shares. It can never be "same as Notion".

**Distribution and review (N7, N8).**

- "Public connections work independently of Marketplace listings" (N7). A public connection can be installed
  through its OAuth flow without a listing.
- A Marketplace listing is reviewed, "within 5-10 business days" (N7). A listing is not proposed.
- Whether a workspace admin can block or must approve a public connection is **not stated** on the pages read.

**Rate limits (N5).** Outside Business and Enterprise, the limit is "180 requests per minute" per connection.
Over the limit, the API returns 429 `rate_limited` with `Retry-After`. Block-children payload limits apply.
Inventory of a large page tree is therefore bounded by request count per connection. No ceiling is stated here.

**Content form.** A Notion page is a block tree, not a file. Nothing read here offers a file export through the
API. **Not established.** A connector would have to render blocks to HTML or Markdown itself. That needs the
text-input path (WO-E-FMT-1, `TEXT_INPUTS_LIVE = false` at `shared/capabilityManifest.ts:395`) and, for Markdown,
WO-E-FMT-3. The renderer is a conversion TAVONEL would own, so its evidence spans must point at block ids. Inventing
a bbox for a block is forbidden. Files attached to pages could use the existing upload path.

## 3. Options

| | Option | Fails how | Rollback |
|---|---|---|---|
| **H** | **Hold** (recommended): no code; "not yet available" under WO-E-CON-0's gate | A prospect who needs Notion goes elsewhere | — |
| P | Public connection, any-workspace scope, read-content capability only; signed webhooks as hints; inventory poll as truth; block renderer to HTML; fresh retrieve at critical read; connecting-user visibility | At-most-once webhooks drop changes until the next poll; no permission event, so unshare waits for the poll (critical read still refuses at once); an unread terms clause could forbid storing derived content | Provider absent from `QUALIFIED_CONNECTORS`; env names removed; migration additive |

## 4. Build estimate if a paying customer asks (option P)

**L**, 20–28 lane-hours (start value, uncalibrated). It is larger than Confluence because of the block renderer
and its evidence mapping. It adds **one migration**: the same provider check and checkpoint changes as companion
§3, with a `notion-poll-v1` reader. It starts after:

- the Notion Developer Terms are read and snapshotted;
- WO-E-CON-3;
- WO-E-FMT-1 (and FMT-3 if Markdown is chosen).

Contents:

1. The provider contract and the allow-list. The origin is `https://api.notion.com`.
2. The webhook endpoint with signature verification and a bounded body.
3. The poll reader and its cursor.
4. Reconciliation that turns "no longer visible" into suspension, not a purge.
5. The block-tree renderer with block-id spans.
6. The critical-read fresh retrieve.
7. Rotation handling if Notion rotates.
8. Drills with a receipt.

Provider clock: none for an unlisted public connection (N7).

## 5. Not established (read before building)

- **The Developer Terms (N9 unread).**
- Token lifetime and rotation.
- The search/list endpoint and its cursor.
- Admin controls over public connections.
- Whether the API exports a page as a file.
- The Marketplace and Integration Gallery terms.
