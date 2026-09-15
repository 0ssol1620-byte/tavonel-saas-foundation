# Topic Clusters — mapped to routes and repo evidence (blueprint §11–§12)

Eight AEO topic clusters from §11, each mapped to the existing route that owns it, plus the
Tier A–D content list from §12 with, per item, what today's repo can truthfully cite and what it
cannot claim yet. Source: site pages read for this lane, `shared/capabilityManifest.ts`,
`lib/benchmark-registry.ts`, `lib/evidence-record.ts`, `docs/gtm/CLAIMS_REGISTRY.yaml`.

**Moved and re-aligned 2026-09-11.** Written 2026-09-08 in
`D:\CodexProjects\uskc-lanes\gtm\TOPIC_CLUSTERS.md` against site main `3157ee5`; moved here by
the website-growth `keyword-claims-data` lane and checked against HEAD `38d957d`. Four things
moved under it, and each is marked **[2026-09-11]** where it appears:

1. Ask's abstention is an eligibility test, not a relevance one. Four public sentences implying
   it declines *because* the sources do not support an answer were replaced on 2026-09-11;
   retrieval declines only when nothing matched at all, and deciding that what matched does not
   answer the question is the reader's work (`CLM-047`). The words "abstains" and "abstention"
   stay usable and are live copy today (`/docs` /concepts and /ask, `/api`, and "Explicit
   abstention" on `/solutions/<slug>`); what a cluster may not write is a sentence asserting the
   World judges whether the sources support the answer.
2. The live engine's relation set is published: `supported_by`, `mentions`, `contradicts`, the
   last as a review candidate with a stated scope (`CLM-046`).
3. Nothing dedupes. Two identical uploads are two documents sharing one digest (`CLM-048`).
4. TXT, CSV and HTML are declared in the input manifest and withheld from the site behind
   `TEXT_INPUTS_LIVE = false` — so no cluster may start answering "does it read CSV" yet
   (`CLM-045`).

**Two cautions this file did not carry and now must.** First, the six cookbook packages the
website-growth campaign is writing (`/cookbooks/<slug>`) are `publication: "draft"`, `noindex`
and absent from `app/sitemap.ts` ROUTES until a real run fills their run-dependent sections — a
cluster may name one as a *future* owner and nothing may link to one as a representative case.
Second, every one of those packages ends at an approved World, and promoting a candidate
requires plan `studio` (Team, `saleChannel: "contact"`), so no cluster's content may describe a
self-serve path to a first success (`CLM-016`, FD-02/FD-14).

## Cluster → route ownership

| # | Cluster (§11 keywords) | Owning route today | Gap |
|---|---|---|---|
| 1 | Knowledge Compiler (what is a KC / KC vs RAG / KC for agents / compiled world for AI) | `/knowledge-compiler` (category guide, RAG/graph/search comparison, glossary, FAQ) | Owns the definition well; no dedicated "compiled world for AI" long-form beyond the glossary row. **[2026-09-11]** The row that says where the category stops now reads "declines only when nothing matched" — content in this cluster may use the word "abstention" for that real behaviour, but must not restore the wording that made declining a judgement about whether the sources support the answer |
| 2 | Document intelligence (best parser for RAG / parsing benchmark / OCR comparison / complex PDF / table extraction) | `/benchmarks` (protocol only, no scored table yet) | No published number to cite for any of these queries — `lib/benchmark-registry.records.json` still holds `records: []` at `38d957d`, and the page says so in its own copy |
| 3 | Source grounding (grounded RAG / exact citation / evidence provenance / evidence locator) | `/evidence` | Strong owner — mechanism, locator model, and self-verification steps are all published |
| 4 | Temporal / change (keep RAG current / incremental updates / temporal knowledge graph / source-version-aware RAG) | `/product/continuous-knowledge` (in `app/sitemap.ts` ROUTES and in `PUBLIC_MARKETING_PATHS`; linked from `/` hero proof strip as "Version-aware") | `/research/notes` flags selective recompilation as `unproven` (fixture-only demo) — do not claim production-measured recompile precision |
| 5 | Enterprise knowledge (enterprise AI context / prepare company data for agents / company ontology for agents) | `/enterprise` | No dedicated content item yet beyond the product page |
| 6 | Office / visual semantics (PPTX RAG / DOCX RAG / spreadsheet RAG / OCR inside PPT images / charts for RAG) | `/sources` (capability manifest is the honest answer today) | The honest answer is still "no native reader for any Office format" — every Office format is BEST_EFFORT via sanitize-to-PDF+OCR, preserving only page/paragraph/bbox. **[2026-09-11]** TXT/CSV/HTML are declared and withheld (`TEXT_INPUTS_LIVE = false`); a CSV would be rendered as a spreadsheet page and read back as text, so this cluster gains nothing from them until the gate flips |
| 7 | Agent / MCP (MCP enterprise knowledge / source-grounded MCP server / agent context infra / AI world state) | `/developers` (8-tool read-only MCP server, no write tool) | Strong owner — concrete, code-backed. **[2026-09-11]** The relations tool now answers with the live engine's three predicates; `contradicts` is a candidate sent to review, never a resolved conflict |
| 8 | SEC (SEC filings RAG / 10-K knowledge graph / 10-Q change tracking / financial filing extraction / temporal SEC analysis) | `/explore` (five Apple filings, a build-time fixture, read-only) | No dedicated SEC content page; the flagship demo exists but isn't written up as an article. **[2026-09-11]** The fixture records where each filing's bytes were acquired from and whether the page a locator points at is the original PDF or a reference render — any SEC write-up has to carry that distinction, and the redistribution rights for those bytes are `unverified` (`docs/gtm/SOURCE_RIGHTS_MANIFEST.yaml`) |

## Tier A — category-defining (8)

| Item | Can truthfully cite today | Cannot claim yet |
|---|---|---|
| 1. What Is a Knowledge Compiler? | `/knowledge-compiler`'s own compile contract, glossary, FAQ | — (page exists, cite it directly) |
| 2. Knowledge Compiler vs RAG | `/knowledge-compiler`'s "Compared with RAG" section | — |
| 3. Why Searchable Files Are Not a Current World | Locked hero line + lede on `/` | — |
| 4. What Is a Compiled World? | Glossary row on `/knowledge-compiler` ("COMPILED WORLD" definition) | A quantified example (fact count, object count) — none published |
| 5. Source Grounding for AI Agents | `/evidence` mechanism + locator model | Full locator coverage — only PDF page+region is implemented; the other 7 (spreadsheet cell, slide shape, etc.) are model, not shipped |
| 6. Temporal Knowledge for Agents | `/evidence` "Version binding" section | Measured recompile precision — `unproven` per research notes |
| 7. Incremental Recompilation Explained | Architecture description in `/evidence` and CLAUDE.md protected-core language | A production-measured "work avoided" number — none published (benchmark family exists, no record) |
| 8. Evidence, Identity, Authority, and Time | CLAUDE.md protected-core module names (`akc_cir.identity`, `.reconciler`, `.world_state`) | Any per-module accuracy/precision number — all uncalibrated (`CalibrationTable.calibrated = False`). **[2026-09-11]** Identity in particular: nothing dedupes two identical uploads (`CLM-048`), so "the same thing named twice becomes one thing" is not a sentence this tier may write |

## Tier B — benchmark / research (10)

| Item | Can truthfully cite today | Cannot claim yet |
|---|---|---|
| 9. State of Document Intelligence 2026 | General framing only | No TAVONEL-measured benchmark row exists — `lib/benchmark-registry.records.json` is an empty array at `38d957d` |
| 10. OCR/VLM Model Benchmark | The 8-family taxonomy on `/benchmarks` | Any scored value for any family/metric |
| 11. Table Extraction Benchmark | Taxonomy entry "table" under document_reading family | A table extraction score — tables and formulas are explicitly not extracted (`no_table_or_formula_extraction` on all eleven live rows) |
| 12. Chart/Diagram Understanding Benchmark | — | No chart/diagram capability exists in the manifest at all |
| 13. Formula Extraction Benchmark | Taxonomy entry "formula" | No formula extraction exists (`no_table_or_formula_extraction`) |
| 14. Korean Document AI Benchmark | — | No Korean-specific benchmark run exists; HWP legacy binary has no row and the manifest's `defaultStatus` is UNSUPPORTED |
| 15. Office Document Fidelity Benchmark | `/sources`' own honesty: every Office format preserves page/paragraph/bbox only | Any native-fidelity number — no native Office reader exists yet |
| 16. Evidence Locator Benchmark | Locator model on `/evidence`; every live manifest row's `evidenceLocatorKinds` is `["pdf"]` | A measured evidence-binding-precision number — family exists in taxonomy, no record |
| 17. Cost vs Quality vs Latency | Pricing constants are real and citable: `PROCESSING_UNIT_USD = 0.01`, `STANDARD_UNITS_PER_PAGE = 4`, `MAX_UNITS_PER_PAGE = 6` (`lib/usage-pricing.ts:1-3`) | Any quality number to plot against them — none published. The ROI spec's rule holds: juxtapose two numbers, never print a computed saving |
| 18. Why One OCR Model Is Not Enough | The published "recovery changes the outcome" finding (`/research/notes`) | The specific magnitude/CI number — not printed on the public page, only "substantially" |
| — **[2026-09-11] new candidate** 19a. What a relation edge is, and what a contradiction candidate is not | `lib/compiler-contract.ts` `typed-dependencies` (state `demonstrated`): three live predicates, each carrying its evidence ids; the contradiction detector's numeric/polarity scope inside one topic and one temporal reference | Any accuracy figure for either predicate, and any suggestion that a `contradicts` edge is a resolved conflict |

## Tier C — practical (7)

| Item | Can truthfully cite today | Cannot claim yet |
|---|---|---|
| 19. Build Source-Grounded RAG | `/developers`' three-path model (MCP/API, package, Ask) | — |
| 20. How to Process SEC Filings for AI | `/explore`'s five Apple filings exist as a build-time fixture with per-document acquisition provenance | A written methodology article — doesn't exist yet as a Tier C post; and redistribution rights for the filing bytes are `unverified`, so a post may link to the official source and must not offer the bytes as a download |
| 21. How to Process PPTX Without Losing Images | Honest answer: today you cannot — PPTX is sanitize-to-PDF+OCR only, `visual: []` in the manifest | Any native-shape/embedded-image preservation claim |
| 22. How to Preserve Excel Cell Evidence | Honest answer: not preserved today (`page_count_not_defined_for_spreadsheets`, no cell/formula in `preserved`) | A cell-evidence feature to write a how-to about |
| 23. How to Update Knowledge When Sources Change | `/evidence` version-binding mechanism | Measured selective-recompile turnaround (p50/p95) — no record |
| 24. How to Give Enterprise Knowledge to MCP Agents | `/developers` MCP section, concrete and code-backed | **[2026-09-11]** That the reader can reach an active World on a self-serve plan: promote requires Team, sold through a conversation (`CLM-016`) |
| 25. How to Build a Verifiable Knowledge Package | `/developers` package contents list + `/evidence` verify-it-yourself steps | A verified public example — no signed public export package passes the published verifiers today (competitive-audit FD-49), so a how-to may describe the steps and may not claim a reader can verify the published sample |

## Tier D — trust/buyer (6)

| Item | Can truthfully cite today | Cannot claim yet |
|---|---|---|
| 26. TAVONEL Security Architecture | `/security` full page (boundary, controls, activation policy) | Any named certification (SOC2/ISO) — none exists or is claimed |
| 27. Data Flow and Isolation | `/security` "What holds what" + tenant isolation control | — |
| 28. AI Provider/Data Policy | `/security` "AI training" control + `activationPolicy.customerData.enabled = false` (`lib/activation-policy.ts:44`) | Cannot describe real-customer-data handling in the present tense yet — that path is gated off |
| 29. Retention and Deletion | `/security` retention control, links to `/privacy` | Specific retention *periods* — page defers to the privacy notice, doesn't quote numbers here |
| 30. Benchmark Methodology | `/benchmarks` qualification rules + receipt schema | A worked example receipt for a real run — none exists yet |
| 31. Reproducibility | `/reproducibility` exists and carries `robots: { index: false }` — it is in `llms.txt` and deliberately not in `app/sitemap.ts` ROUTES | That an independent replay has happened; the page's own copy says it has nothing to describe yet |
