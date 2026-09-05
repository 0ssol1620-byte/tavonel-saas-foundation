# USKC P0 — Lane D report: Capability Manifest as single source of truth

Campaign `TAVONEL-USKC-P0-20260906-V1`. Contract `USKC_LANE_CONTRACT_2026-09-06.md` §5 "D",
§4.2, §7 R-4. Blueprint §0.3, §10, §33, §41, §42, §48 EPIC P0-D, §56.

## 1. Branch and pushed SHA

- Repo: `0ssol1620-byte/tavonel-saas-foundation`, worktree `D:\CodexProjects\uskc-lanes\site-d-capability-manifest`
- Branch: `agent/uskc-d-capability-manifest`, based on `4c18e86`
- Pushed SHA: `PUSHED_SHA_PLACEHOLDER`
- Production deploy 안 함. Git push로 Preview deployment는 자동 생성됨. Preview not verified through the Vercel MCP.

## 2. Files created and modified

### Created

| File | What it is |
|---|---|
| `shared/capabilityManifest.schema.json` | The frozen contract artifact, copied verbatim. sha256 `4795fe89bf72a60684f9fb28f54ebc39a57d7c867fcd7c33a177369eed1378a4`, verified byte-identical to `contract/capability-manifest.v1.schema.json`. |
| `shared/uskcEnums.ts` | The frozen `enums.v1.json` vocabulary transliterated to TS `const` arrays plus union types. All ten lists, not only the four D uses, so AB's copy and this one can be deduplicated at integration. |
| `shared/capabilityManifest.ts` | `CAPABILITY_MANIFEST` (12 entries) plus `deriveUploadWhitelist`, `deriveUploadAccept`, `offeredAtUpload`, `describeAcceptedFormats`, `deriveSourceFamilyChips`, `isAcceptedAtUpload`. |
| `server/foundation/capabilityManifest.test.ts` | 19 tests: frozen-artifact digest, enum transliteration, schema validation, honesty rules, the five derivations, and six failure paths. |
| `nextjs/app/api/v1/capabilities/route.ts` | `GET /api/v1/capabilities` — the manifest, `Cache-Control`, `ETag`, `contentSha256`. |
| `nextjs/lib/capability-manifest-route.test.ts` | 4 tests: the payload is the manifest unmodified, the digest is reproducible, the response is public and tenant-free, and it advertises no capability the deployment cannot support. |
| `nextjs/app/sources/page.tsx` | The §33 support matrix page. |
| `nextjs/components/source-capability-table.tsx` | The table and the six-tier legend, with the tier → status-token and tier → `claim-state` mappings. |
| `nextjs/e2e/sources.spec.ts` | 5 specs × 3 projects = 15 Playwright tests. |

### Modified — full-file ownership

- `shared/qualifiedDocumentInputs.ts` — the 11-entry literal became `deriveUploadWhitelist(CAPABILITY_MANIFEST)`.
  `validateQualifiedDocumentInput`'s body, its return union and `QualifiedDocumentMime`'s literal narrowing are unchanged;
  the mime union is now derived at the type level with `Extract<entries[number], { status: CapabilityStatusAcceptedAtUpload }>`.
- `nextjs/lib/qualified-input.ts` — the hand-duplicated copy is gone. The file re-exports the shared validator and adds
  the three derived UI strings (`uploadAcceptAttribute`, `acceptedFormatSentence`, `sourceFamilyChips`).
- `nextjs/lib/docs-content.ts` — the `files-and-formats` prose is derived, and a manifest-driven support table plus a
  qualification note were added to the section.
- `nextjs/lib/brand-copy.test.ts` — three `COPY_SURFACES` rows and six §42 phrases appended to `BARRED`.

### Modified — row-only edits (one line or one contiguous block each)

| File:line | Edit |
|---|---|
| `nextjs/app/workspace/page.tsx:24` | one import line |
| `nextjs/app/workspace/page.tsx:1684` | `accept=".pdf,…,.zip"` → `accept={uploadAcceptAttribute}` |
| `nextjs/components/pipeline-board.tsx:11` | one import line (plus its two-line reason comment) |
| `nextjs/components/pipeline-board.tsx:19` | the `UNQUALIFIED_MIME` sentence now interpolates `acceptedFormatSentence` |
| `nextjs/components/home-page-client.tsx:17` | one import line |
| `nextjs/components/home-page-client.tsx:218-232` | the format `<ul>`: `...sourceFamilyChips` replaces the four hand-written format rows; the connector rows stay literal; the block's comment updated |
| `nextjs/app/api/openapi/route.ts:5` | one import line |
| `nextjs/app/api/openapi/route.ts:39-52` | one new path, `GET /capabilities` |
| `nextjs/app/api/openapi/route.ts:59` | `declaredMimeType` gains `enum: Object.keys(qualifiedDocumentInputs)` |
| `nextjs/app/sitemap.ts:10` | one route added to `ROUTES` |
| `nextjs/lib/site-navigation.ts:36` | one row added to `RESOURCE_LINKS` |
| `nextjs/app/tavonel.css` | one appended block, `/sources` only, no token added and no existing rule changed |
| `.gitattributes:35-40` | **out of my ownership row — see §5.5.** One rule, `shared/*.schema.json text eol=lf` |

The pinned home-page strings (`evidence back to the page.`, `Object`, `Relation`, `Document page`, `Exact bbox`,
the hero and the lede) are byte-identical; `brand-copy.test.ts` passes with 116 tests.

## 3. Gates

Every command was run from the worktree. Logs are in `D:\CodexProjects\uskc-lanes\gate-d-*.log`.

| # | Command | Exit | Tail |
|---|---|---|---|
| 0a | `pnpm check` (repo root) | **0** | `> tsc --noEmit` (no diagnostics) |
| 0b | `pnpm test` (repo root) | **0** | `Test Files 23 passed (23) / Tests 81 passed (81)` — includes `server/foundation/capabilityManifest.test.ts (19 tests)` |
| 1 | `pnpm check` (nextjs) | **0** | `> tsc --noEmit && eslint app components lib` (no diagnostics) |
| 2 | `pnpm test` (nextjs) | **0** (see below) | `Test Files 164 passed (164) / Tests 1593 passed (1593)` |
| 3 | `pnpm build` (nextjs) | **0** | `✓ Generating static pages (71/71)`; `/sources` static at 1.27 kB / 108 kB First Load JS; `/api/v1/capabilities` static at 363 B |
| 4 | `PLAYWRIGHT_PORT=3142 pnpm exec playwright test --project=1440 --project=390 --project=reduced-motion e2e/sources.spec.ts` | **0** | `15 passed (2.5m)` |
| 5 | `git status` | clean except the intended changes | listed in §2 |
| 6 | `git push -u origin agent/uskc-d-capability-manifest` | **0** | SHA in §1 |

Two gate runs are reported honestly rather than merged:

- **Gate 2, first run: exit 1.** `lib/explore-sample.test.ts > re-extracts fp-200-maintenance-manual-revC.pdf to the
  same regions` — `Error: Test timed out in 15000ms`, with 1592 of 1593 tests passing. It was run while a 9-minute
  `pnpm install` was saturating the machine. Run in isolation the same test passes in **506 ms**
  (`Test Files 1 passed (1) / Tests 29 passed (29)`), and the full suite passed inside gate 3's `prebuild`
  (`164 passed / 1593 passed`). It is a load-sensitive pdfjs test on this machine, not a regression from this lane,
  and I did not modify it.
- **Gate 4, first run: exit 1.** `Error: Timed out waiting 120000ms from config.webServer` — the Playwright web server
  runs `pnpm build && pnpm start`, and `prebuild` (check + 1593 tests) alone exceeds the default 120 s. Re-run with
  `PLAYWRIGHT_WEB_SERVER_TIMEOUT=900000`, which `playwright.config.ts` already supports. No file was changed between
  the two runs.

One code change was made in response to a gate: `deriveSourceFamilyChips` used `[...map.values()]`, which fails the
**root** `tsc` (`TS2802`, the root tsconfig sets no `target`). It is `Array.from(...)` now, with the reason in a comment.

## 4. What the blueprint asked that I did not do, and why

- **§10 "pricing/billing" and "status page" as manifest consumers.** Not wired. `lib/page-count.ts` decides billable
  units by MIME and `lib/capabilities.ts` is the deployment status grid — a different vocabulary that the contract's
  §3 ownership row explicitly puts out of this lane. Both are one-import changes once the founder decides whether the
  status grid and the manifest are one surface (seam map O-1).
- **§33's example table columns** ("Native structure", "Change tracking"). Not rendered: nothing in the pipeline
  produces either per format today, so the columns would be a row of "no" or, worse, a plausible guess. The contract's
  six columns are what the manifest can answer.
- **§48 P0-D "backend resolver".** The resolver in P0 is `deriveUploadWhitelist` plus the existing
  `validateQualifiedDocumentInput`. A reader-router resolver belongs to Lane C's registry; per contract §7 R-4 the site
  and the core are not wired, so building a second resolver here would be the sixth list in a different costume.
- **§30.2 "exact source location" replacing "back to the page".** Proposed only (§6). `brand-copy.test.ts` pins
  `evidence back to the page.` and the hero and lede are locked; changing public copy is not an agent's call.
- **No roadmap rows, no "coming soon".** The manifest lists what the deployment does today. HWPX, DWG and the other
  §14 families are absent rather than listed as planned.

## 5. Conflicts with other lanes or with the contract (proposals, not edits)

1. **`shared/uskcEnums.ts` byte-identity with AB is unverifiable from here.** The contract says D and F carry
   byte-identical copies of AB's file, but AB's version does not exist in my worktree and the three lanes ran in
   parallel. Mine is a mechanical transliteration of `contract/enums.v1.json` with all ten lists in the JSON's order.
   **Proposal for integration:** keep AB's file, delete D's and F's, and confirm the value lists match — D's
   `server/foundation/capabilityManifest.test.ts` already asserts every list against the frozen values, so a mismatch
   fails a test rather than merging silently.
2. **`nextjs/lib/qualified-input.ts` now re-exports from `shared/`.** This is the only runtime (non-test) import from
   `nextjs/` into `shared/` in the repository; `next.config.mjs` sets `outputFileTracingRoot: packageRoot`. The build
   is green and both new surfaces are statically generated, but AB and F should know the boundary is now crossed by
   product code, not only by one test.
3. **`nextjs/app/api/openapi/route.ts` and `nextjs/lib/brand-copy.test.ts`** are shared files; per seam map X-8 D owns
   the brand-copy edits. The openapi edit is three rows.
4. **`.zip` is represented as `UNSUPPORTED`, and that is the frozen enums forcing my hand.** See §6, question 2.
5. **I edited `.gitattributes`, which is not in my ownership row.** One rule:
   `shared/*.schema.json text eol=lf`. The repository's blanket `* text=auto` means a Windows checkout of
   `shared/capabilityManifest.schema.json` would carry CRLF, its sha256 would not be the frozen
   `4795fe89…`, and the verbatim-copy test would fail on Windows and pass on Linux. `.gitattributes` already
   documents exactly this failure (it happened once with `channel.json`) and states the rule: "Any file whose content
   is hashed, signed, or served verbatim belongs here." Doing it in the test instead — normalizing line endings before
   hashing — would have hidden the fact that the working-tree file is genuinely not the frozen artifact, and Lane E's
   Python copy of a sibling schema has the same exposure in the core repo. The file belongs to no lane; if the
   orchestrator would rather this were a separate commit, it is the last hunk and reverts cleanly.

## 6. Open questions for the founder

1. **Public wording for the six tiers.** The page currently prints the frozen tokens (`BEST_EFFORT`, `UNSUPPORTED`, …)
   as chips with a legend, because inventing marketing labels for a support tier is a copy decision. Proposed English,
   if labels are wanted: `VERIFIED_NATIVE` → "Verified · native", `VERIFIED_HYBRID` → "Verified · native + visual",
   `BEST_EFFORT` → "Supported · not qualified", `METADATA_ONLY` → "Container only", `REVIEW_REQUIRED` → "Needs review",
   `UNSUPPORTED` → "Not accepted". The tokens should stay visible somewhere either way — they are the API's values.
2. **A container tier is missing from the frozen enums.** ZIP is offered by the file picker, expanded in the browser and
   never compiled. `METADATA_ONLY` is the blueprint's own definition of that ("container level only") but it is one of
   the four `CapabilityStatusAcceptedAtUpload` values, so using it would silently add `application/zip` to the server
   whitelist — a behaviour change disguised as vocabulary. It is `UNSUPPORTED` with six explicit limitations instead.
   **Proposal:** add `CONTAINER` to `CapabilityStatus` in enums v2, outside `CapabilityStatusAcceptedAtUpload`.
   A lane may not add an enum value.
3. **Replacing "back to the page" with "exact source location" (§30.2).** Proposed replacement for the locked lede:
   "…and compiles a versioned knowledge layer with evidence bound to an exact source location." The landing scene-4
   labels `Object / Relation / Document page / Exact bbox` would become `Object / Relation / Source unit / Exact
   locator`. Both are pinned by `brand-copy.test.ts`; not changed.
4. **Indexing `/sources`.** It is in the sitemap and, unlike `/benchmarks`, is **not** in `app/robots.ts`'s disallow
   list — that file belongs to no lane and I did not edit it, so the default `allow: "/"` applies and crawlers may
   index the page. If it should be withheld until the wording is approved, one token goes into `robots.ts`.
5. **Navigation placement.** `/sources` is one row in `RESOURCE_LINKS`, so it appears on `/resources`. §41 calls it a
   trust surface; the footer's "Trust" group or the primary nav would give it more weight. One row either way.
6. **Every row says the same three preserved fields.** That is what the pipeline emits, and it is the strongest
   argument in the blueprint for Lane C: the moment a native XLSX reader lands, the spreadsheet rows say `cell`,
   `formula`, `sheet` and the tier can move. Publishing the weak version now is deliberate; confirm that is wanted
   before the Preview is shared.

## 7. Contradictions with the blueprint, the contract or the seam map (path:line)

1. **Seam map, LANE D "Creates": `shared/capabilityManifest.test.ts` and `nextjs/app/api/capabilities/route.ts`.**
   Both superseded by the contract, correctly: the repo-root `vitest.config.ts:16` collects `server/**/*.test.ts`
   only, so a test beside a `shared/*` module would never run; and `/api/v1/...` is the repo's versioned convention.
   Followed the contract (§7 R-4).
2. **Seam map, LANE D "Modifies": `home-page-client.tsx` list at "L196-210".** The list is at
   `nextjs/components/home-page-client.tsx:217-223` at `4c18e86`, not 196-210.
3. **Seam map, LANE D "Modifies": `brand-copy.test.ts` `COPY_SURFACES` at "L27-61".** The array is
   `nextjs/lib/brand-copy.test.ts:27-97` at `4c18e86` — 48 entries, not the ~34 that range implies.
4. **Seam map, C-7 "already mutually inconsistent, since `accept` includes `.zip`".** Confirmed on disk:
   `nextjs/app/workspace/page.tsx:1683` listed `.zip`; `shared/qualifiedDocumentInputs.ts:1-13` and
   `nextjs/lib/qualified-input.ts:1-13` did not. Also confirmed: the two MIME maps were byte-identical in their data
   and **not** in their code — the shared copy returned a named `QualifiedInputDecision` union and wrote its control
   characters as `\u0000-\u001f\u007f`, while the nextjs copy inlined `as const` returns and embedded the same
   characters raw (which is why `grep` reported that file as binary). Two copies with the same behaviour written two
   different ways is worse than the seam map's "hand-duplicated copy" implies.
5. **Seam map, LANE D "Risks": "§42's barred phrases … only 2 of 7 overlap".** Verified: of `supports every file`,
   `100% accurate`, `no hallucinations`, `perfect parsing`, `best ocr`, `never stale`, `always current`, only
   `100% accurate` and (as `never hallucinates`) the second were in `BARRED`. Six phrases added, including
   `industry-leading` as a bare substring — it appears nowhere in `nextjs/app`, `nextjs/components`, `nextjs/lib` or
   `shared/` today, so the unqualified form can be barred outright.
   **`all files` was NOT added**, and this is a contract deviation worth naming: contract §1 lists it, but it is a
   common English substring (an archive that expands "all files in the archive") and barring it would fail on innocent
   prose. `supports every file` covers the claim the rule is aimed at.
6. **Seam map, LANE D "Must not touch": `nextjs/lib/claim-state.ts` "currently with zero production consumers".**
   Confirmed at `4c18e86`, and this lane is its first: `nextjs/components/source-capability-table.tsx` imports
   `CLAIM_STATE` and prints the claim label beside each tier. The file itself is unmodified, per contract §7 R-4.
7. **Blueprint §33's example table.** Its rows assert `PDF | Verified | Yes | Selective | page/region | Yes` and
   `XLSX | Verified | cell/formula | charts | cell/range | Yes`. No format on this deployment can support any of those
   cells: there is no native reader, no qualification receipt, and no visual reconciliation. The blueprint's example is
   a target state, not a description, and reading it as copy would have published six false rows.
8. **Blueprint §10's example `evidenceLocatorKinds`** uses `xlsx_cell`, `xlsx_range`, `xlsx_chart`. The frozen
   `contract/enums.v1.json` `LocatorKind` has only `xlsx`. The schema's enum wins; the granularity §10 shows belongs
   inside Lane E's `xlsx` locator variant, not in the kind discriminator.

## Appendix — what the manifest says today, and why

| MIME | Family | Tier | readerPlan | preserved | evidenceLocatorKinds |
|---|---|---|---|---|---|
| `application/pdf` | document | BEST_EFFORT | `cdr_sanitizer_v1`, `foundation_ocr_gpu_v1` | page, paragraph_text, bbox1000 | pdf |
| docx, odt | document | BEST_EFFORT | same | same | pdf |
| xlsx, ods | spreadsheet | BEST_EFFORT | same | same | pdf |
| pptx, odp | presentation | BEST_EFFORT | same | same | pdf |
| jpeg, png, tiff, gif | image | BEST_EFFORT | same | same | pdf |
| `application/zip` | archive | UNSUPPORTED | — | — | — |

Sources for every field, so a reviewer can check rather than trust:

- **Tier.** No qualification receipt exists anywhere in the repository, so contract §1's honesty rule caps every entry
  at `BEST_EFFORT`. The test asserts the count of verified entries is zero, not merely that the rule exists.
- **`readerPlan`.** `cdr_sanitizer_v1` = the CDR worker whose contract is `shared/documentProcessing.ts`
  (`bindSanitizationProof` refuses any `outputMimeType` but `application/pdf`, which is why every plan starts there and
  why every non-PDF row carries `converted_to_pdf_before_reading`). `foundation_ocr_gpu_v1` = the GPU reader whose
  receipt binds `immutableReleaseDigest`. Named per contract §7 R-4.
- **`preserved`.** `nextjs/lib/core-runtime-v2.ts:178-197` sends `pageNumber1`, `blockType: "paragraph"` + `text`, and
  `bbox1000` per region, and nothing else. No cell, formula, sheet, shape, comment or track-change reaches the core.
- **`visual`.** Empty everywhere: nothing on this deployment compares a native read against a render.
- **`page_count_not_defined_for_spreadsheets`.** `nextjs/lib/page-count.ts:37` — "A spreadsheet has no pages, and
  nobody has decided what it is billed in."
- **The archive limitations.** `nextjs/lib/archive-expand.ts` — `MAX_FILES = 128`, `MAX_EXPANDED_BYTES = 500 MB`,
  `ARCHIVE_ENCRYPTED`, `NESTED_ARCHIVE_NOT_ALLOWED`, `ARCHIVE_PATH_TRAVERSAL`, `DECOMPRESSION_BOMB_BLOCKED` — and
  `nextjs/app/api/uploads/capability/route.ts:51` (`TRIAL_ARCHIVE_NOT_INCLUDED`).

### The five hard-coded lists, and where each went

| # | Was | Now |
|---|---|---|
| 1 | `shared/qualifiedDocumentInputs.ts:1-13` — 11-entry MIME map | `deriveUploadWhitelist(CAPABILITY_MANIFEST)`; a test asserts it deep-equals the 4c18e86 literal |
| 2 | `nextjs/lib/qualified-input.ts:1-35` — a byte-duplicate map **and** a second copy of the validator | re-export of `shared/qualifiedDocumentInputs` |
| 3 | `nextjs/app/workspace/page.tsx:1683` — the `accept` attribute | `uploadAcceptAttribute` (`nextjs/app/workspace/page.tsx:1684`) |
| 4 | `nextjs/components/pipeline-board.tsx:16` — the UNQUALIFIED_MIME sentence | `acceptedFormatSentence` (`:19`) |
| 5 | `nextjs/components/home-page-client.tsx:219-221` — four marketing format rows | `sourceFamilyChips` (`:227`) |
| 6 | `nextjs/lib/docs-content.ts:146` — "PDF, common office documents and images" | `describeAcceptedFormats(...)` (`:147`) plus a manifest-driven table |
| 7 | `nextjs/app/api/openapi/route.ts:44` — `declaredMimeType: { type: "string" }`, no enum at all | `enum: Object.keys(qualifiedDocumentInputs)` (`:59`) |

**Lists I could not remove, with the reason:**

- **The connector rows on the landing page** (`Folders`, `Google Drive`, `Dropbox`, `OneDrive / SharePoint`,
  `S3 / R2 / MinIO`, `SMB / NFS / SFTP`, `home-page-client.tsx:228-229`). They are not source formats and §10's
  manifest is scoped to `sourceFamily`/`mime`. A connector manifest is P2 work.
- **`nextjs/app/integrations/page.tsx`'s `SUPPORT_LEVELS`** — a third support vocabulary, for connectors. Out of this
  lane's ownership row and out of §10's scope.
- **`nextjs/lib/page-count.ts:114`'s MIME→label map** — billing units, not capabilities. It happens to list the same
  MIME types; unifying it is a one-import change once question 6 above is answered.
- **`nextjs/lib/source-import.ts:28` and `connector-oauth-adapters.ts:179`** — Google Workspace export-format mappings
  (`application/vnd.google-apps.spreadsheet` → xlsx). They translate *into* the manifest's vocabulary rather than
  restating it, and they belong to connector code F and P2 own.
