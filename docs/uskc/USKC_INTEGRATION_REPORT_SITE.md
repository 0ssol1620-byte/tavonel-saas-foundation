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
