# USKC P0 — Site integration report (lanes AB, D, F)

Campaign `TAVONEL-USKC-P0-20260906-V1`. Contract `USKC_LANE_CONTRACT_2026-09-06.md` §1, §2, §3, §4,
§7, §8. Founder decisions `docs/USKC_FOUNDER_DECISIONS_RESOLVED_2026-09-06.md` (added verbatim by
this branch, sha256 `a69be36abd578b6434d0375455be9167e5e31407ead0327b5e8ac134165eac61`).

Worktree `D:/CodexProjects/uskc-lanes/site-integration`, branch `agent/uskc-integration`, base site
`4c18e86` (`origin/main`).

**Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨.** No PR, no merge to `main`, no
alias change, no Supabase migration applied, no activation flag flipped, no new dependency.

Lane G's copy work (hero, evidence wording, connector list, `/trust`, `/status`) is **not** in this
branch. The only navigation change here is lane D's: `/sources` is in `PRIMARY_NAV`.

---

## 1. Merges

Three `--no-ff` merges, in contract order, each its own commit. **Zero conflicts.**

| Order | Branch | Merged SHA |
|---|---|---|
| 1 | `origin/agent/uskc-ab-source-domain` | `ab308a41732cdc48a59afef2b8a00122d10f23bc` |
| 2 | `origin/agent/uskc-d-capability-manifest` | `724f80af53cd6fdfece1c3f5ce9c87c175ccdbea` |
| 3 | `origin/agent/uskc-f-customer-data-gate` | `a5da004154f413e2796e39a45dd75b343cd26691` |

The two seams the contract predicted did not become conflicts:

- **`shared/uskcEnums.ts`** was carried by all three lanes and is byte-identical on all three
  (sha256 `6dceb23128bb902c554006fde8255c90b2f686a3688fe1617c440084c7ac1c9f` on AB, D and F), because
  §8.1 C-AB-3 had already made D and F take AB's bytes. Git resolved the three-way add with no
  intervention, and the merged tree has exactly one copy (`git ls-files | grep -i uskcenums` →
  `shared/uskcEnums.ts` and its test). No file was deleted and no import was rewritten here.
- **`nextjs/lib/brand-copy.test.ts`** `COPY_SURFACES` was touched by lane D only, so there was
  nothing to union. D added `app/sources/page.tsx`, `components/source-capability-table.tsx` and
  `../shared/capabilityManifest.ts`, plus the blueprint §42 phrases in `BARRED`.
- **`nextjs/app/workspace/page.tsx`** was edited by D (manifest-derived `accept` and format hint)
  and F (the `customerData` gate label and the integrity-panel heading) in different regions;
  `ort` auto-merged them and the merged file carries both.

### The enum copy proved against the frozen artifact

Not asserted — computed, over the merged tree's single copy:

```
node proveEnums.mjs shared/uskcEnums.ts D:/CodexProjects/uskc-lanes/contract/enums.v1.json
OK   sourceFamilies -> SourceFamily (17/17)
OK   capabilityStatuses -> CapabilityStatus (6/6)
OK   capabilityStatusesAcceptedAtUpload -> CapabilityStatusAcceptedAtUpload (4/4)
OK   representationKinds -> RepresentationKind (7/7)
OK   readerFeatures -> ReaderFeature (14/14)
OK   locatorKinds -> LocatorKind (13/13)
OK   readerRegistryStatuses -> ReaderRegistryStatus (3/3)
OK   failureClasses -> FailureClass (20/20)
OK   privacyPolicies -> PrivacyPolicy (2/2)
OK   customerDataPreconditions -> CustomerDataPrecondition (17/17)
ALL LISTS EQUAL contract/enums.v1.json          exit 0
```

The script parses each `export const … = [...] as const` out of the TypeScript and compares the
parsed array — values **and order** — to the JSON. It also fails on an exported list the map does
not cover, so a new vocabulary cannot be added without the check noticing. `contract/enums.v1.json`
itself hashes to `3c668dc9c22289b27a7d0dd8b072cf23fa0511fd8fe888875770171e664f11d1`, which is the
value in `contract/SHA256SUMS`.

---

## 2. Founder-resolution conformance on the merged tree

Checked against the merged tree, not against a lane's report. Four edits were needed; the rest was
already conformant and is recorded here as verified rather than re-implemented.

| Ruling | Verified in the merged tree | Edit needed |
|---|---|---|
| **B-2** tenant and workspace are two things | `supabase/migrations/0049` has `tenant_id` and `workspace_id` as two `not null` columns with their own checks; `shared/sourceDomain.ts` has two fields; `nextjs/lib/source-domain-store.ts:151-153` writes both. No code derives one from the other or refuses on their equality. §8.1 "AB tenant shim" ratifies that both carry the workspace id today because the wire carries one value. | none |
| **B-8** the CDR PDF is `normalized`, never `original` | `representationKindForImmutableKey` returns `"normalized"` for a sanitized-PDF key (`source-domain-store.ts:104`); nothing in the tree maps a sanitized key to `original`. The doc's chain diagram makes the quarantine object the `original` at the uploaded digest. | **yes** — the doc did not say what happens if retention deletes the original |
| **B-1** `sourceId = documents.id` is a shim; a filename never identifies a Source | `docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` §3 says both, word for word. | none |
| **B-6** gate events go to `enterprise_audit_events` | `supabase/migrations/0050` header records the choice, the action name and the reason, and says there is no third table; `foundation_developer_audit_events` keeps developer/API acts. | none |
| **B-10** no activation flag true; `approved_customer_data` refused without a gate decision | `nextjs/lib/activation-policy.ts` — `customerData: { enabled: false }`; the three `true` keys (`customerIntake`, `cdr`, `ocrGpu`) are byte-identical to base `4c18e86` and were true before this campaign. Proven by tests, not by reading: `server/foundation/customerDataGate.test.ts` **35 passed**, `nextjs/lib/customer-data-live-path.test.ts` **4 passed**. | none |
| **D** no `VERIFIED` entry, no roadmap row | `shared/capabilityManifest.ts` — eleven `BEST_EFFORT` entries and one `UNSUPPORTED`; `VERIFIED_NATIVE` / `VERIFIED_HYBRID` appear only in the comment that says they need a receipt. No roadmap row exists. | none |

### Cross-lane seams (contract §8.1) — verified here, not redone

| Seam | State in the merged tree |
|---|---|
| D and F's `shared/uskcEnums.ts` byte-identical to AB's | sha256 equal on all three branches; one file survives the merge |
| `nextjs/e2e/mobile-landing.spec.ts` expects eight primary links | `toHaveCount(8)` with the eight labels including "Sources" and a comment citing RESOLVED A-3 |
| workspace integrity panel labels the `customerData` gate and does not say "Four gates" over five rows | heading is "Processing gates"; `GATE_LABELS` is typed `Record<ActivationCapability, string>` with a `customerData` row, so a future policy key fails `tsc` instead of rendering as camelCase |
| `nextjs/app/security/page.tsx` `CAPABILITY_LABELS` has the row | `customerData: "Compiling customer data"` |
| `nextjs/lib/capabilities.test.ts` passes truthfully | row count pinned at 10 and the grid has 10 rows; green inside the 1,619-test `nextjs` run |
| `/sources` in `PRIMARY_NAV` (RESOLVED A-3) | seventh row of `PRIMARY_NAV`, before Resources — where lane D put it; not moved |
| `enterprise_audit_events.organization_id` NOT NULL kept | not loosened; `docs/CUSTOMER_DATA_GATE_2026-09-06.md:165-166` and §6 item 1 say a workspace with no organization row cannot record a gate event and therefore cannot be approved |
| `/sources` tier chips print the frozen tokens with a legend | kept as lane D built it |
| D's `.gitattributes` `eol=lf` for `shared/*.schema.json` | kept |

---

## 3. Resolution fixes applied here

Five edits, all in documents and lane reports. No product code was changed at integration.

1. **`docs/UNIVERSAL_SOURCE_DOMAIN_2026-09-06.md` §4 — the B-8 retention consequence.** The doc said
   the pre-CDR bytes are the original and that no code deletes the quarantine object; it did not say
   what happens if a retention rule does. Added: the version row and its `original` representation
   stay as digest, tombstone and provenance, and **reprocessing capability for that Source is
   reduced** — no re-read at higher fidelity, no re-derivation with a better reader, no independent
   re-verification of a derived representation against its source. Already-compiled claims keep
   their evidence chain. Migration `0049` grants no `delete`, so the record outlives the bytes.
2. **Same doc §3 — ADR-008 item 1, recorded not changed.** `shared/productCoreCompileEnvelope.ts:87`
   checks `immutable/${tenantId}/${workspaceId}/` and agrees with the live
   `immutable/${workspaceId}/${workspaceId}/` layout (`nextjs/lib/immutable-keys.ts:9`) only because
   `nextjs/lib/core-runtime-v2.ts:156-157` sets `tenantId = workspaceId`. The envelope has the
   two-segment shape and a tenant parameter; the deployment has no second value to put in it, so the
   shape proves nothing about tenant isolation today. That is now written as the **first item of
   ADR-008 (v2 object-key layout)**, with what still has to be decided. Nothing was loosened.
3. **Same doc — the line reference moved.** `productCoreCompileEnvelope.ts:85` → `:87` in the merged
   tree, because lane F's row-only edit added lines above the check.
4. **`docs/uskc/USKC_LANE_REPORT_AB.md` §6 rewritten.** All six "open questions for the founder" had
   already been closed — 1 by RESOLVED B-2 and §8.1's tenant-shim ruling, 2 by RESOLVED B-1, 3 by
   §8.1 (`UNCONFIRMED`) plus RESOLVED B-8, 4 by §8.1 (P1-A), 5 by §8.1 (the ledger stays in
   `public`), 6 by §8.1 C-AB-1. Each is now a statement citing its ruling. The section is retitled
   "Decided, not asked".
5. **The Drive line number, four places.** Verified first:
   `grep -n trashed nextjs/lib/connector-oauth-adapters.ts` → `80:  url.searchParams.set("q",
   "trashed = false");`. Corrected `USKC_LANE_REPORT_F.md` §7 and §8 item 5 and
   `docs/CUSTOMER_DATA_GATE_2026-09-06.md` gap-matrix row 9 and §6 item 5 from `:79` to `:80`, and
   deleted the §7 sentence claiming the seam map was wrong — the seam map was right.

The three lane reports moved to `docs/uskc/` with `git mv` so the repository root stays clean, and
`USKC_FOUNDER_DECISIONS_RESOLVED_2026-09-06.md` was added verbatim at
`docs/USKC_FOUNDER_DECISIONS_RESOLVED_2026-09-06.md` (both copies hash to
`a69be36abd578b6434d0375455be9167e5e31407ead0327b5e8ac134165eac61`).

---

## 4. Gates

Every command was run from this worktree. Exit codes are the real ones.

| # | Command (cwd) | Exit | Output tail |
|---|---|---|---|
| 1 | `pnpm check` (worktree root) | **0** | `> tsc --noEmit` — no diagnostics |
| 2 | `pnpm test` (worktree root) | **0** | `Test Files 29 passed (29)` · `Tests 208 passed (208)` · 3.46s |
| 3 | `pnpm check` (`nextjs/`) | **0** | `> tsc --noEmit && eslint app components lib` — no diagnostics |
| 4 | `pnpm test` (`nextjs/`) | **0** | `Test Files 166 passed (166)` · `Tests 1619 passed (1619)` · 20.28s |
| 5 | `pnpm build` (`nextjs/`) | **0** | `✓ Generating static pages (71/71)` · `First Load JS shared by all 103 kB`. **71 static pages** (69 at base; `/sources` and the `/api/v1/capabilities` route are the two new entries) |
| 6 | `PLAYWRIGHT_EXTERNAL_SERVER=1 PLAYWRIGHT_PORT=3151 pnpm exec playwright test --project=1440 --project=390 --project=reduced-motion` (`nextjs/`) | **1** | `22 failed` · `57 skipped` · `185 passed (5.3m)`. Every failure is pre-existing or environment-dependent — §5 |
| 7 | `pnpm exec vitest run lib/pgtap-fixtures.test.ts` (`nextjs/`) | **0** | `Tests 56 passed (56)`. The nearest thing to a migration-ordering test in this repo — see below |
| 8 | `pnpm exec vitest run server/foundation/customerDataGate.test.ts` (root) | **0** | `Tests 35 passed (35)` — the B-10 proof |
| 9 | `pnpm exec vitest run lib/customer-data-live-path.test.ts` (`nextjs/`) | **0** | `Tests 4 passed (4)` — the B-10 live-path proof |

`playwright.config.ts` defines projects `1920 1440 1280 1024 768 390 360`, `reduced-motion` and
`launch-chromium|firefox|webkit`, so the requested trio exists and was run as named.

**Migration ordering.** This repository has **no** dedicated migration-ordering or single-head test
(that test lives in the core repo, `tests/unit/test_migration_graph.py`). Reported as such rather
than invented. What does exist and is green: `nextjs/lib/pgtap-fixtures.test.ts` enumerates
`supabase/migrations` and pairs it with the pgTAP fixtures (56 tests), and each migration has a
pinning test — `server/foundation/sourceDomainMigration.test.ts` (0049) and
`server/foundation/customerDataGateMigration.test.ts` (0050), both inside the green root run.
Independently checked here: the migration prefixes are unique
(`ls supabase/migrations | sed 's/_.*//' | sort | uniq -d` prints nothing) and the sequence ends
`…0048`, `0049_universal_source_domain.sql`, `0050_customer_data_gate_acl.sql` — the numbers the
contract allocated.

### A false run, recorded because it happened

The first Playwright attempt reported 47 failures and the second 87. Neither was a product result.
The config's own `webServer` runs `pnpm build && pnpm start` **with**
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` set; `NEXT_PUBLIC_*` is inlined at
build time, so a build made without them ships a bundle that redirects every workspace route to
`/login` (`navigated to "http://127.0.0.1:3151/login"` in the failure log). The second attempt hit a
stale server still holding port 3151. The run in the table above is a rebuild with those variables
set and a verified-fresh server on 3151, stopped afterwards (port 3151 has no listener).

---

## 5. Pre-existing failures — not fixed, and why each is not this branch's

Twenty-two failures, seven distinct cases across three projects. None is fixed here.

`git worktree` and `git stash` at `4c18e86` were not available to this session, and a targeted
`git checkout 4c18e86 -- <paths>` was refused by the permission layer, so these are proven the way
the task allows: **by byte-identity of every file the failing assertion renders**.
`git diff --stat 4c18e86 HEAD -- nextjs/components/compile-stage-player.tsx
nextjs/components/opening-film-4.tsx nextjs/app/product nextjs/components/public-page-shell.tsx
nextjs/app/page.tsx nextjs/lib/film-script.ts nextjs/e2e/ux-polish.spec.ts
nextjs/e2e/world-lifecycle.spec.ts nextjs/e2e/visual-continuity.spec.ts
nextjs/e2e/pipeline-board.spec.ts` prints **nothing**: the components, the pages and the four spec
files are identical to the base commit.

| Failure | Projects | Why it is not this branch's |
|---|---|---|
| `e2e/pipeline-board.spec.ts:65` "processing detail appears only when the user asks for it" | 1440, 390, reduced-motion | Contract §8.2 records it as pre-existing on `4c18e86`, proved by lane F against `origin/main`'s workspace page. Reconfirmed by this rerun. |
| `e2e/pipeline-board.spec.ts:80` "ready sources are searchable without lengthening the whole page" | 1440, 390, reduced-motion | Same §8.2 record; reconfirmed here. |
| `e2e/ux-polish.spec.ts:35` "compilation film is autoplay-first" | 1440, 390, reduced-motion | The spec expects `video[data-active='1']` inside `.compile-film-sequence`. `components/compile-stage-player.tsx` (unchanged) renders a `<video>` only when `!live && !still`; at 1440 with a fine pointer `live` is true and it renders `.compile-film-live` instead, and under reduced motion `still` is true and it renders `.compile-film-still`. The assertion cannot pass on this build's own component, which this branch did not touch. |
| `e2e/ux-polish.spec.ts:70` "product page shows the product path…" | 1440, 390, reduced-motion | `getByRole("link", { name: "Start free" })` is a strict-mode violation — two links, one in the banner and one in `#main`. `/product` and `components/public-page-shell.tsx` are byte-identical to base; the only nav change here adds a "Sources" link, not a second "Start free". |
| `e2e/world-lifecycle.spec.ts:216`, `:281`, `:312` | 1440, 390, reduced-motion | Each fails on `expect(browserErrors).toEqual([])` with `401 (Unauthorized)` — the Playwright environment's Supabase credentials are the config's placeholders (`https://test.supabase.co`), so any browser call to them 401s. The lanes added no fetch: D's workspace edits are a derived `accept` string and a derived chip list, F's are a label map and a heading. |
| `e2e/visual-continuity.spec.ts:123` "the WORLD stage … reaches its locked beat" | 390 | Waits for `.compile-film-live canvas.film-canvas`. `compile-stage-player.tsx`'s `NARROW_FRAME` rule deliberately refuses the live canvas below 900px — the founder's own "no live canvas below ~900 px". At the 390 project that element cannot exist. Unchanged component, unchanged spec. |

Everything lane D and lane F actually added is green in the same run, including
`e2e/sources.spec.ts` and `e2e/mobile-landing.spec.ts` (the eight-link mobile menu) at all three
projects.

---

## 6. What this branch did not do

- **No Lane G copy work.** Hero, evidence wording, the connector list, `/trust` and `/status`
  (RESOLVED A-1, A-2, A-4, A-6) belong to the next agent on this same branch. The only navigation
  change here is `/sources` in `PRIMARY_NAV`.
- **No PR, no merge to `main`, no production deploy, no alias change, no `supabase db push`.**
- **No new dependency**, in either `package.json`.
- **No product-code edit at integration.** Every resolution fix is a document or a lane report; the
  merged lane code is what the lanes wrote.
- **No Playwright fix.** The twenty-two failures above are recorded, not patched.
- **No Vercel verification.** A Preview deployment is created automatically by the push; this
  session did not consult the Vercel MCP, so the Preview is unverified.

## 7. For the founder — real-world acts only

1. **Open and merge the PR** for `agent/uskc-integration` (agents do not). Lane G's copy work is due
   on this branch first.
2. **Apply migrations `0049` and `0050`** to Supabase. Neither is applied by this campaign; both are
   additive, create no default row and enable nothing.
3. **Customer data stays off.** `approved_customer_data` needs a gate decision, and seven of the
   seventeen preconditions are MISSING (`docs/CUSTOMER_DATA_GATE_2026-09-06.md`). Enabling it is a
   founder act with a recorded receipt, per RESOLVED B-10, and beta-tenant allowlisted first.

---

# Lane G — public positioning (RESOLVED A-1 … A-6)

Appended by Lane G on the same branch, on top of `5d05617`. Four surface commits plus one
follow-up the phone gates forced. No PR, no merge, no production deploy, no alias change, no
migration applied, no new dependency.

**Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨.**

## G.1 What each resolution asked for, and what landed

### A-2 — the hero, re-derived (`78f69a8`)

The headline is now **"Your AI needs more than searchable files. It needs a current, traceable
world."** The lede says TAVONEL compiles the customer's own sources into that world and defines
both adjectives rather than leaving them as adjectives: *current* is recompiled when those sources
change, *traceable* is every compiled fact staying traceable to its exact source location.

`brand-copy.test.ts` locked the old hero **and** the old lede, which ended "evidence back to the
page." That is why the lock moved rather than being deleted: a lock is a claim that a string does
not drift without a decision, and this is that decision. The commit says so and cites RESOLVED A-2.
The new lock also asserts the retired wording cannot come back by hand.

Barred phrases added: `every file supported`, `lossless for every format`, `fully autonomous truth`.
`100% accurate` and `never hallucinates` were already on the list. Nothing was removed from it.

Two supporting surfaces followed the headline so they do not keep quoting the retired one:
`app/layout.tsx` metadata and `app/opengraph-image.tsx`. "code" came off both descriptions in the
same edit — no reader in this deployment reads a repository, and the upload route refuses one.

### A-1 — "exact source location" (`703cda4`)

Base wording, on the landing page, `/evidence`, `/enterprise`,
`/product/document-understanding`, `/knowledge-compiler` and `/resources`:

> Every compiled fact stays traceable to its exact source location.

The locator **model** is published once, on `/evidence`, as eight forms the evidence contract is
built to hold — PDF page + region · spreadsheet sheet + cell/range · slide + shape · message +
attachment/MIME part · JSON/XML pointer · commit + file + symbol span · CAD/BIM object GUID · media
timestamp/frame — followed immediately by the sentence that keeps it honest: this is a model, not a
support list; exactly one of them is read here today, PDF page and region through the
sanitize-to-PDF path; and `/sources` is the truth about which representations this deployment
reads. Nothing on the page may be read as a locator that has been qualified. The landing page
carries the base sentence, the path `Object → Relation → Evidence → Source version → Exact
location`, and a button to `/sources`.

**Kept, deliberately:** `components/pdf-evidence-viewer.tsx` (the `Evidence bounding box …`
aria-label) and `components/world-studio-ultimate.tsx` (the `PAGE` / `BBOX` inspector rows). Both
read back the actual PDF locator of the actual region being drawn on screen. That is product UI
printing a real value, not a claim about what evidence is in general; generalizing those labels
would make them less accurate, not more.

### A-3 — `/sources` in primary navigation

Verified, not changed. `lib/site-navigation.ts` already carries `{ href: "/sources", label:
"Sources" }` in `PRIMARY_NAV` — the integrator's one navigation change. The page states in its own
first paragraph that it prints `shared/capabilityManifest.ts`, the same list the upload route
validates against, and that formats not listed are refused at upload. It is written as deployment
capability truth and shows no roadmap format. No edit was needed.

### A-4 — connectors (`49c2ec9`)

The homepage flat list — `Folders · Google Drive · Dropbox · OneDrive / SharePoint · S3 / R2 /
MinIO · SMB / NFS / SFTP` as one row of equal chips — is gone. Four rows replace it, each with the
word that says where it stands:

| Row | Status word | Why that word |
|---|---|---|
| Upload and folders | AVAILABLE TODAY | The upload path that exists; every file checked against the manifest before storage. |
| ZIP archive | AVAILABLE TODAY | Written as what it is: expanded in the browser, each file inside compiled individually, **the archive itself never compiled**. |
| Google Drive · Dropbox · OneDrive / SharePoint | BETA | `lib/connector-oauth-adapters.ts` implements list and download for exactly these three. Never "qualified": RESOLVED B-7 makes Drive deletion semantics a blocker. |
| Object storage and mounted shares | ON REQUEST | Not a connector. See below. |

The format chips stay separate and stay derived from the Capability Manifest.

**S3-compatible / MinIO / SMB / NFS / SFTP are not shown as connectors anywhere.** A grep over
`nextjs/lib/connector-*` and `lib/source-import.ts` finds no adapter for any of them; the only
providers in the codebase are `google_drive`, `dropbox`, `microsoft_graph`. What does exist is
`nextjs/public/developer/tavonel-source-agent.py` — real code that scans a mounted directory
(`--root`) or an S3-compatible bucket (`--s3-bucket`, boto3) and posts to
`/api/v1/uploads/capability` and `/api/v1/connections/{id}/sync`, both of which exist as routes in
this repository. The customer runs it inside their own network and it pushes outward; TAVONEL
connects to nothing. So:

- `/integrations` keeps those rows and renames the level from **Enterprise** to
  **Enterprise-assisted**, with a lede saying outright that nothing under it is a self-serve
  connector and nothing under it is qualified. Four rows collapse to two (mounted file server;
  S3-compatible object storage) because R2 and MinIO are the same S3 path.
- `/developers` **keeps** the Source agent tile — the linked agent is real and named above — and
  stops calling it an "SMB, NFS, SFTP and S3-compatible connector agent", which put four connectors
  on a page that has none.
- The workspace source picker takes the same word, so there is one vocabulary.

**One claim was false, not merely vague.** The Google Drive row said trashed files "are surfaced as
source removal on sync". The adapter lists with `q=trashed = false` and emits no deleted entry,
unlike Dropbox and Microsoft Graph which both do. A trashed file simply stops appearing —
indistinguishable from one deleted outright, moved, renamed, or no longer visible to the account.
The row now says that, and names it as a reason no connector here is qualified (RESOLVED B-7).

### A-6 — `/trust` and `/status` (`b212a58`)

`/trust` is a `permanentRedirect` to `/security`, and the evidence mention the copy audit found is
not in a page at all: it is in `lib/activation-policy.ts`, whose `reason` strings `/security`
renders and `/api/status` serves verbatim. Two cited an internal receipt — intake "approved after
synthetic R2 qualification", GPU OCR "release-qualified from the recorded 2026-08-29 full-sequence
evidence".

Both records exist in this repository (`docs/FOUNDATION_R2_SYNTHETIC_CANARY_2026-08-29.md`,
`docs/evidence/ocr/FOUNDATION_GPU_OCR_FULL_SEQUENCE_2026-08-29.md` and its `.json`) and **neither is
servable as it stands**: between them they carry a Vercel deployment id, a RunPod endpoint id, an
account balance, a committer's email address and the internal FOLYNTA name. A-6 gives two options —
link it, or remove the mention rather than leave it unlinked — and only the second was available
without a founder decision about a redacted public evidence page. So the citations are gone and the
controls they were attached to are still stated. `activation-policy.test.ts` had pinned the
citation in place, so its rule is inverted rather than deleted: no reason may carry a date, and
none may assert a qualification the reader cannot reach.

`/status` renders a value on every row today — no branch of `readPublicOperations` can produce an
empty state, every one assigns a literal — but one word carried two meanings. `restricted` covered
both a processing gate that policy holds shut and a billing integration that is fully configured
and deliberately not charging, and reads like a degraded service when neither is. They become
`closed` and `disabled`, from the founder's vocabulary, chosen from what the function actually
knows. The source cannot yield "nothing", so `NOT CONFIGURED` was not needed as a fallback; the new
`lib/operations.test.ts` closes the vocabulary and asserts every component carries a state and a
detail, which is what keeps a future branch from adding a blank row.

One long-standing gap came with it: `.status-list h3` had no CSS rule, so `/status` rendered its row
names unstyled while `/security`, which uses `h2` in the same grid, did not.

### G.2 The follow-up the phone gates forced (`d862260`)

`e2e/mobile-landing.spec.ts:296` measures every control on the landing page against a 44px touch
floor, and the three inline links this lane had just written came in at 14px, 14px and 33px. Scene
4's pointer to `/sources` became a ghost button beside Explore; scene 2's two links were removed
outright — the connector rows already carry their status words, and `/integrations` is one tap away
in the nav and the footer.

That exposed an older, wider defect. The global reset is `a { color: inherit; text-decoration:
none }` and `.fine` restored neither, so **every** link in fine print on this site rendered as plain
muted mono, distinguishable from the sentence around it by nothing at all — WCAG 1.4.1, and simply
invisible. Survivable while fine print was only prose; not survivable once an evidence claim
depends on a reader reaching the capability manifest from it. `.fine a` now takes the underline
`.policy-copy a` already used.

## G.3 Gates

Run from `D:\CodexProjects\uskc-lanes\site-integration`, logs beside it in
`D:\CodexProjects\uskc-lanes\lane-g-*.log`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `pnpm check` (root) | 0 | `tsc --noEmit`, clean |
| 2 | `pnpm test` (root) | 0 | 29 files, **208 passed** |
| 3 | `nextjs/ pnpm check` | 0 | `tsc --noEmit && eslint app components lib`, clean |
| 4 | `nextjs/ pnpm test` | 0 | 167 files, **1,640 passed** (~~baseline 166 / 1,637; the extra file and three tests are `lib/operations.test.ts` and the inverted activation-policy rule~~ — **wrong, corrected in G.7**: the baseline is 166 / **1,619**, the figure §4 records for `5d05617`, and the delta is **+21**) |
| 5 | `nextjs/ pnpm build` | 0 | 140 route rows, 42 statically prerendered |
| 6 | Playwright `--project=1440 --project=390 --project=reduced-motion` | 1 | **22 failed · 57 skipped · 185 passed** — the same 22 names as the integration baseline in `pw-integration3.log` (§5 above). `comm` over both sorted lists: nothing new, nothing fixed. |
| 7 | Phone screenshots + overflow, 360/390/430 × chromium+webkit, `/` and `/sources` | 0 | **ALL WIDTHS CLEAN** — `document.documentElement.scrollWidth <= innerWidth` at every one of the twelve views |

Gate 6 exits 1 on the pre-existing 22. Nothing was patched to make it green.

Screenshots (outside the repo): `D:\CodexProjects\uskc-lanes\lane-g-screens\` — twelve full-page
shots plus eight scrolled shots of the two scenes this lane rewrote, at 360 and 430 in both engines.

### A harness trap worth recording

The first phone run reported six overflowing views and an unstyled page in WebKit. It was not a
defect. `next.config.mjs` omits `upgrade-insecure-requests` only when `PLAYWRIGHT_LOCAL_HTTP=1`, and
`headers()` is compiled into the route manifest **at build time** — so a build made without that
variable, served over plain HTTP, makes WebKit upgrade its own same-origin CSS request to a port
with no TLS listener and render the site with no stylesheet at all. Chromium exempts localhost and
looked fine. The same build-time rule applies to `NEXT_PUBLIC_SUPABASE_URL`: a build without it
inlines nothing, the browser Supabase client is absent, and 26 authenticated-surface specs fail
against `/login`. Both are properties of the build, not of the branch. Any future run must build
with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `PLAYWRIGHT_LOCAL_HTTP=1` set,
exactly as `playwright.config.ts`'s own `webServer` does, before serving it externally.

## G.4 Copy surfaces added to the lock

`COPY_SURFACES` in `brand-copy.test.ts` gains nine rows, every one of them a surface this lane
edited that had no guard: `app/evidence`, `app/knowledge-compiler`, `app/resources`,
`app/integrations`, `app/security`, `app/status`, `app/opengraph-image`, plus
`lib/activation-policy.ts` and `lib/operations.ts` — the two library files whose strings are public
copy that no page contains.

## G.5 Not done, and why

- **The 22 pre-existing Playwright failures stay.** They are §5's list, they belong to lane D's and
  the integrator's surfaces or to fixtures this lane did not touch, and the contract says record
  rather than patch.
- **The two release receipts are not published.** Removing the citation was the available half of
  A-6. Publishing a redacted `/evidence` artifact for the 2026-08-29 GPU OCR run and the R2 canary
  is a founder decision about what may be disclosed, not a copy decision.
- **`/docs/files-and-formats` still under-describes the manifest** (copy audit item 5, an
  under-claim). It is a docs surface driven by `lib/docs-content.ts` and outside A-1…A-6.
- **`lib/compiler-contract.ts` and `lib/docs-content.ts` keep "bounding box"** where they describe
  the compile contract and the Ask response as they actually work today on the PDF path. Neither is
  a marketing generalization; both were left for the release that integrates EvidenceLocator v2,
  which is when the underlying record changes.
- **The Preview deployment is not verified.** The push creates one automatically; this session did
  not consult the Vercel MCP.

## G.6 For the founder — real-world acts only

1. **Open and merge the PR** for `agent/uskc-integration`. Lane G does not.
2. **Decide whether a redacted public evidence artifact should exist** for the 2026-08-29 GPU OCR
   full-sequence run and the R2 synthetic canary. Until then `/security` states its controls and
   cites no receipt, which is the honest position but not the strongest one.

---

## G.7 Repair — adversarial review of `7c8b1e1`

Two independent lenses (integration correctness; founder resolutions and honesty) returned
`GO_WITH_CONDITIONS` with three confirmed **major** findings and no blocker. All three are fixed
below. Each fix carries the failure-path test that would have caught it, and each of those tests
was checked against the pre-repair string before the fix went in — a guard written after the fact
that cannot fail on the thing it is meant to catch is decoration.

**Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨.**

### R-1 (major) — the homepage used status words from outside RESOLVED A-4's vocabulary

`components/home-page-client.tsx:266,271,281`. Four connector rows carried `AVAILABLE TODAY`,
`AVAILABLE TODAY`, `BETA`, `ON REQUEST`. A-4 names four words — `qualified` · `beta` ·
`enterprise-assisted` · `unsupported` — and three of those four chips were not among them. Two
consequences the lane reported as fixed and had not fixed:

- The S3 / SMB agent route reads **Enterprise-assisted** on `/integrations` and `/workspace`, so
  §G.1's claim that the vocabulary was made consistent "everywhere" was contradicted by the one
  surface A-4 is actually about.
- **`ZIP archive — AVAILABLE TODAY` printed the opposite word to the manifest.**
  `shared/capabilityManifest.ts` marks `application/zip` `UNSUPPORTED`, `/sources` renders that as
  "Refused. Nothing about the source is compiled.", and
  `validateQualifiedDocumentInput({ declaredMimeType: "application/zip" })` answers
  `{ valid: false, code: "UNQUALIFIED_MIME" }`. The row's prose was accurate; its status word said
  the reverse of the capability truth surface.

The cause was two axes in one list. Upload and ZIP are not connectors, so forcing a connector
support word onto them produced a word from outside the vocabulary. **The direct-upload route moves
into the sentence above the list** — where the ZIP truth is now stated in full, including the
manifest's own word for it — **and the list holds only what A-4 governs**: Google Drive · Dropbox ·
OneDrive/SharePoint at `BETA`, object storage and mounted shares at `ENTERPRISE-ASSISTED`.

*Failure-path test:* `brand-copy.test.ts` — "labels every connector on the landing page with one of
RESOLVED A-4's four words" reads the `<span className="st">` literals out of the source and rejects
any word outside the four. Against the pre-repair chips it rejects `AVAILABLE TODAY` (twice) and
`ON REQUEST`.

### R-2 (major) — A-6 was reported as met; half of one citation survived, reworded

`lib/activation-policy.ts:24`. The lane reported that "the two receipt citations were REMOVED
rather than linked". Only the intake one was. The GPU OCR one became *"The record that qualified it
is an internal release record and is not published here."* — which is the shape A-6 removes, one
step worse than the original: it tells the reader a qualifying record exists and then withholds it,
so it can be neither checked nor argued with. The string is not a comment; `app/security/page.tsx`
renders `{value.reason}` verbatim and `/api/status` serves it.

The lane's own inverted guard was written narrowly enough to pass it: it banned
`/\d{4}-\d{2}-\d{2}/` and `/release-qualified|full-sequence/i` — the two strings that had just been
deleted — and nothing else. The sentence is now **gone**, not reworded. The reason states the two
controls that are actually enforced and nothing else.

*Failure-path test:* `activation-policy.test.ts` gains two general rules — no reason may say a
supporting record exists and is withheld (`not published`, `internal release record`, `held
internally`, `on file`, …), and any reason that mentions a qualification must carry something the
reader can open. Both fail on the pre-repair string; neither is satisfiable by renaming the receipt.

### R-3 (major) — A-1 was applied to six pages and skipped `/solutions` and `/api`, undisclosed

`app/solutions/[slug]/page.tsx:14,27,53` and `app/api/page.tsx:15` still published the retired
PDF-shaped abstraction as the general one — "Citations back to page regions", "Page and bbox
provenance", "Page-level citation inspection", "page-and-bbox-bound citations" — and `/solutions/…`
is a `PRIMARY_NAV` destination (`lib/site-navigation.ts:22`). §G.5 named only
`lib/compiler-contract.ts` and `lib/docs-content.ts` as deliberate holdouts, so this was an
omission, not a disclosed deferral. Neither file was in `COPY_SURFACES`, so nothing would have
caught a future drift there either.

The four claim-shaped lines take the base wording. Both files join `COPY_SURFACES`. The
document-intelligence lede and flow steps keep "pages and regions": they describe what the
sanitize-to-PDF reading path literally does today, and generalizing them would make them less true,
not more.

*Failure-path test:* `brand-copy.test.ts` — "publishes no retired PDF-locator wording in %s" over
the eight A-1 surfaces. Block comments are stripped first, deliberately: a file may quote the
wording it retired in order to explain why, and `app/evidence/page.tsx` does exactly that. Against
the pre-repair sources it fires three times on `/solutions` and once on `/api`.

### Corrections to the previous report and to the submitted summary

| Claim | Correction |
|---|---|
| Gate 4: "baseline 166 / 1,637 … +1 file and +3 tests" | Wrong. §4 records **1,619** for `5d05617`; the delta was **+21** — 3 new `it()` blocks plus 18 from the two `it.each(COPY_SURFACES)` blocks once `COPY_SURFACES` grew from 52 to 61 rows. The gate-6 table row is annotated in place. |
| Submitted summary: the 22 Playwright failures span "change-inbox, pipeline-board, ultimate-mobile-a11y, ux-polish, visual-continuity, world-lifecycle" | Wrong in the summary only; §5's committed table is right. The 22 span **four** specs: `pipeline-board`, `ux-polish`, `world-lifecycle`, `visual-continuity`. No `change-inbox` or `ultimate-mobile-a11y` test is among them. |
| §G.4: the nine new `COPY_SURFACES` rows are "every one of them a surface this lane edited" | `app/security/page.tsx` and `app/status/page.tsx` are not in `git diff 5d05617..7c8b1e1`. They were added because they render `activation-policy.ts` and `operations.ts`, which the lane *did* edit — the right reason, stated wrongly. |
| §G.1 A-4: the Enterprise-assisted vocabulary makes the labels "consistent everywhere" | Still not literally everywhere after R-1. `components/connections-panel.tsx:273-277`, the authenticated create-a-connection form, lists Mounted SMB / NFS / SFTP share, Amazon S3, Cloudflare R2 and MinIO with no availability word. Left as is: it is the configuration form for the agent route and says so in its own help text ("The local agent reads that mount"), it is behind sign-in rather than public positioning, and A-4 governs how connectors are *shown*, not the `<option>` values of the form that configures one. Recorded here rather than smoothed over. |
| `resolution_fixes` A-1: base wording "applied on … `app/knowledge-compiler/page.tsx`" | That page took "the exact location inside it", not the base sentence verbatim. Same decision, imprecisely reported. |

### Left standing, deliberately

- **`app/api/openapi/route.ts:164`** still says "exact page and bbox citations". It documents the
  literal `pageNumber1` / `bbox1000` fields the Ask response carries today — a field list, not a
  claim about what evidence is. Same category as the evidence viewer and the workspace inspector.
- **The `ZIP` format chip on the landing page.** `deriveSourceFamilyChips` derives it from
  `offeredAtUpload`, which includes ZIP because the picker offers `.zip` and hiding it would break
  a working path — Lane D's decision, argued at `shared/capabilityManifest.ts:242-255`. The chip
  now sits directly above the sentence that says what actually happens to an archive and that the
  manifest lists it `UNSUPPORTED`, which is where a reader needs it.

### Gates, rerun in full

Logs in `D:\CodexProjects\uskc-lanes\repair-*.log`.

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `pnpm check` (root) | 0 | `tsc --noEmit`, clean |
| 2 | `pnpm test` (root) | 0 | 29 files, **208 passed** |
| 3 | `nextjs/ pnpm check` | 0 | `tsc --noEmit && eslint app components lib`, clean |
| 4 | `nextjs/ pnpm test` | 0 | 167 files, **1,653 passed** (+13 on `7c8b1e1`'s 1,640: 1 A-4 chip test, 8 A-1 surface rows, and 4 from `COPY_SURFACES` growing by two rows across the two `it.each` blocks) |
| 5 | `nextjs/ pnpm build` | 0 | 140 route rows, 42 statically prerendered; prebuild reran check + test, both 0 |
| 6 | Playwright `--project=1440 --project=390 --project=reduced-motion` | 1 | **23 failed · 57 skipped · 184 passed** — the 22 baseline names plus one, analysed below |
| 7 | Phone screenshots + overflow, 360/390/430 × chromium+webkit, `/` and `/` scrolled to scene 2 | 0 | `scrollWidth - innerWidth` = **0** in chromium and **−10** in webkit at every width; ten shots re-taken in `lane-g-screens\` |

**The 23rd failure is not a regression, and is not an assertion failure.**
`[reduced-motion] e2e/ux-polish.spec.ts:7 public flagship surfaces never overflow the viewport`
fails with `Tearing down "context" exceeded the test timeout of 30000ms` — the teardown, not the
body. Three pieces of evidence:

1. With `--timeout=90000` the same test **passes** (37.0s): no overflow, no empty structural panel.
2. The six `page.goto` calls it makes take **0.7s in total** under `reducedMotion: "reduce"`
   (measured directly against the same server); the time is machine, not page.
3. It fails **identically on the pre-repair tree**: `git stash` of every repair edit,
   `pnpm exec next build` with the same env, `pnpm start` on 3153, then the same single-test
   command — `✘ 30.8s`, `✘ 44.3s (retry #1)`, same teardown message. The tree at `7c8b1e1` fails it
   too on this machine right now, so the repair did not cause it.

The same machine load also timed out two `lib/supabase-browser.test.ts` cases at 5s during a
pre-repair prebuild while the full `nextjs/ pnpm test` gate above was green — the same signature.
Nothing was patched to make gate 6 green, and no timeout was raised in the repository.
