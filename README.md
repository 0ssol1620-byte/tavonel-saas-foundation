# TAVONEL

**The Knowledge Compiler for Enterprise AI.**

TAVONEL compiles fragmented organizational documents into a Compiled World: a versioned,
evidence-bound knowledge structure that an AI system can query, cite and trust — instead of a
pile of chunks a vector search happens to return. This repository is the Product Platform: the
public website, the signed-in workspace, auth, billing and the connector/upload control plane.
The compiler's design boundary (identity, semantic diff, dependency graph, recompilation,
equivalence) is owned by a separate Core Engine repository — but which of that boundary this
repository actually calls, versus runs itself, depends on which compile path a deployment has
configured. See [Architecture](#architecture) for exactly which path does what.

This README describes what the code in this repository actually does, as of the commit it ships
with. Where a capability is designed but not yet live in this deployment, it is labelled
**Direction** rather than described as shipped — the same vocabulary the product itself uses
(`nextjs/lib/claim-state.ts`, `nextjs/lib/capabilities.ts`).

---

## What is a Knowledge Compiler?

A search index returns passages that are lexically or semantically similar to a query. A
Knowledge Compiler instead resolves documents into a world of typed, identified objects — claims,
entities, topics — connected by typed relations, where every object carries the exact source
version, page and region it was derived from, and where a change to a source produces a new,
versioned world rather than a silent rewrite of the old answer.

The distinction this project is built around, and refuses to regress out of: not a PDF converter,
not a generic RAG builder, not a graph viewer, not an OCR API wrapper, not an "upload PDF → chat"
service. The product is the combination — evidence provenance, stable identity, semantic lineage,
temporal integrity, a dependency graph, incremental recompilation, fail-closed validation, and
interoperable output — not any single piece of it.

## Architecture

Two canonical authorities are the intended design boundary, kept deliberately separate because
compiler semantics and product/control-plane concerns have different release, security and
scaling boundaries (full statement in
[`docs/CANONICAL_RESPONSIBILITY.md`](docs/CANONICAL_RESPONSIBILITY.md)):

| Authority | Repository | Owns |
|---|---|---|
| **Core Engine** | `ai-knowledge-compiler` | CIR/Knowledge IR, parser and evidence contracts, stable identity, semantic/structural/temporal diff, typed dependency graph, impact analysis, selective recompilation, full-rebuild equivalence, world validation |
| **Product Platform** | *this repository* | Next.js product and marketing site, auth/workspaces/tenants, billing/credits/entitlements, upload and connector control plane, candidate persistence, active-world pointer, public API/MCP |

That table is the target boundary. What the committed code in this repository actually calls for
a compile is narrower, and it depends on which of two paths a deployment has configured. In
`nextjs/lib/collection-compile-run.ts`, lines 61-62 read the two environments —
`const coreV2 = readProductCoreV2Env();` and `const coreV1 = coreV2 ? null : readCoreRuntimeEnv();`
— and the branch that acts on them is `if (coreV2) {` at line 98 with a plain `} else {` at line
122 that dispatches on `coreV1`:

- **`FOUNDATION_CORE_V2_URL` configured** — `dispatchProductCoreV2`
  (`nextjs/lib/core-runtime-v2.ts`) makes an HMAC-signed HTTP call to that URL and relays back the
  artifact and receipt it returns, including the receipt's `equivalence` field (same file, line
  104: `"passed" | "failed" | "not_run"`). This is the path the table above describes: a genuinely
  separate Core service this repository does not contain.
- **`FOUNDATION_CORE_V2_URL` unset** — `collection-compile-run.ts` falls back to
  `readCoreRuntimeEnv` / `dispatchCoreCompile` (`nextjs/lib/core-runtime.ts`), which HTTP-calls
  `FOUNDATION_CORE_URL/v1/compile`. On this repository's own `nextjs/core-runtime/vercel.json`,
  that exact route (`POST /v1/compile`) is served by `nextjs/core-runtime/api/compile.ts` — the
  route's `dest` is written `/core-runtime/api/compile.ts` because that deployment's root
  directory is `nextjs/`, not the repository root. Its own second import line pulls
  `compileCollectionCandidate` straight from `nextjs/lib/collection-compiler.ts`, the same
  TypeScript compiler that builds the `/explore` sample and that the Compiler Contract table below
  names as the thing that keys entity identity. The result is labelled `runtime:
  "tavonel-foundation-core-deterministic-v1"` (`nextjs/lib/core-runtime.ts` line 17) — a label
  `nextjs/lib/explore-sample.test.ts` refuses to attach to the sample (line 88 asserts the sample's
  runtime does not contain `foundation-core-deterministic`), on the ground its own comment states
  at lines 84-85: it "would be a Core execution claim with no Core execution behind it." So on this
  fallback path, the "Core worker" the platform calls is this repository's own compiler, deployed
  as a second Vercel function rather than reached as a separate service.
- **Diff, on either path** — `nextjs/lib/world-version-diff.ts` computes the structural diff
  between two compiled World read models entirely in this repository; it is not a call to either
  Core path.
- **What stays outside this repository on both paths** — dependency-graph impact analysis, and the
  *computation* of full-rebuild equivalence: `nextjs/lib/core-runtime-v2.ts` only relays an `equivalence`
  value an external response already produced; nothing committed here computes one. The
  `CANDIDATE → ACTIVE` promotion decision is also Product-only, made after checking manifest
  digest, validation receipt, equivalence status and an explicit promotion policy; Core cannot
  mutate Product's databases or active-world pointer on either path.

Inside this repository, two application surfaces exist side by side, at different stages of the
same convergence (`docs/REPO_CONVERGENCE_MATRIX.md`, `docs/PRODUCT_CONVERGENCE_AUDIT_2026-08-28.md`):

- **`nextjs/`** — the Next.js App Router package Vercel deploys as the live product
  (`nextjs/vercel.json`: `framework: nextjs`, region `icn1`). This is the public website,
  `/login`, and the signed-in workspace. Its own [`nextjs/README.md`](nextjs/README.md) documents
  required environment variables, the fail-closed pilot allowlist, and the billing and
  export-signing configuration in full — read it before changing anything under `nextjs/app` or
  `nextjs/components`.
- **`client/` / `server/` / `shared/`** — the earlier Vite + Express application this platform is
  converging out of. `shared/` holds cross-surface contracts
  (`shared/productCoreCompileEnvelope.ts`, `shared/candidateWorldContract.ts`,
  `shared/productCoreFieldMap.ts`) that both surfaces depend on.

Supporting services: `workers/` (OCR dispatch, CPU and GPU), `quarantine-sidecar/` (content-disarm
services), `retrieval-runtime/` (a Python retrieval service), `supabase/` (schema migrations and
RLS policy tests). None of these accept customer document bytes without the quarantine and
admission checks described in `docs/CANONICAL_RESPONSIBILITY.md`.

## Compiler Contract

Eight properties a compile is expected to hold. The right-hand column says what this repository
actually does about each one *today* — which is not the same for all eight, and the differences
are the point. Each entry states its own standing rather than picking from a badge set, but the
load-bearing words are the product's own (`nextjs/lib/claim-state.ts`,
`nextjs/lib/capabilities.ts`):

- **Demonstrated** — built and shown on a declared sample, not a production qualification. There
  is exactly one such sample here: the FP-200 documents committed under
  `nextjs/public/explore-sample/`, compiled at build time and pinned by `EXPLORE_SAMPLE_DIGEST` in
  `nextjs/lib/explore-sample.ts`, checked by `nextjs/lib/explore-sample.test.ts`, and shown at
  `/explore` under an `INTERACTIVE SAMPLE` label. One limit applies to everything that sample can
  support: it is compiled by *this repository's* TypeScript compiler at build time, not by the
  Core runtime — `nextjs/lib/explore-sample.ts` says so in its own execution record.
- **Described** — the property is explained on a product page. That is prose about the design,
  not a running demonstration of it.
- **Research frontier / Direction** — an active research direction that is not a shipped
  capability here.

No clause below is claimed as qualified, and none is claimed as a production capability.

**No count from that sample is quoted in this file, deliberately.**
`nextjs/lib/explore-sample.test.ts` asserts the per-row facts — a real page number, an in-bounds
box, an excerpt that is a literal slice of the extracted text, the source file's sha256, and that
every Claim and Document object the page shows carries at least one evidence reference. It
asserts no totals. A total printed here would therefore be a hand-typed number on a public
surface, which this project's own rule forbids, and it would silently go stale the first time a
document is added to or removed from the sample. The counts are rendered from the compiled world
itself at `/explore`; read them there. What the clauses below cite instead is the compiler's own
source, `nextjs/lib/collection-compiler.ts`, which decides the shape of any sample it is given
and does not change when the sample does.

| Clause | What it means | What this repository does about it today |
|---|---|---|
| Evidence-preserving | A claim without a supporting source region is not emitted | **Demonstrated.** `nextjs/lib/explore-sample.test.ts` asserts that every Claim and Document object the page shows carries at least one evidence reference, and binds each evidence row to a real page number, an in-bounds box, an excerpt that is a literal slice of the extracted source text, and the source file's sha256. The compiler creates a claim's `supported_by` edge in the same step that creates the claim (`nextjs/lib/collection-compiler.ts`), so an evidence-free claim is not a state it can reach. Described at `/evidence` |
| Stable semantic identity | The same real-world thing keeps one identity across document revisions | **Not demonstrated.** What the sample shows is label equality, not identity resolution: `nextjs/lib/collection-compiler.ts` keys an entity node on `stableId("entity", label.toLowerCase())` and reuses that node for every later document carrying the same label — so `FP-200` is one node every document in the sample points at, and so, by the identical rule, is the bare word `The`. That limit is measured rather than asserted. `nextjs/lib/entity-extraction-eval.json` is a reviewed evaluation of the extractor against this corpus, and `nextjs/lib/entity-extraction-quality.test.ts` asserts against it that the identity case `EXACT_STRING_ACROSS_DOCUMENTS` holds while `SURFACE_VARIANT` and `CROSS_PART` do not, alongside the extractor's measured precision as an equality rather than a floor. Resolving two *different* surface forms to the same thing, and holding that decision across a source revision, is Core Engine work and is not exercised here. Described at `/product/compiled-world` (OBJECTS); named as an unsolved problem at `/research` ("Semantic identity") |
| Typed dependencies | Relations are typed (supports, supersedes, depends on, contradicts), not generic edges | **Partly demonstrated, in a narrower vocabulary than this clause describes.** Relations are typed and each carries the evidence that justifies it, but `nextjs/lib/collection-compiler.ts` constructs exactly three predicates and declares them as its whole ontology: `discusses_topic` and `mentions_entity` (document → object) and `supported_by` (claim → evidence). It builds no claim-to-claim edge at all, so nothing here shows a `supersedes` or a `contradicts` — where the sample's own documents supersede one another they say so in prose that no edge represents. Described at `/product/compiled-world` (RELATIONS) |
| Temporal integrity | A world is versioned; an old answer stays traceable to what its sources said at the time | **Described** at `/product/compiled-world` (VERSIONS); listed as an open problem at `/research` ("Temporal integrity"). No public artifact on this deployment shows a past answer being re-resolved against an older world version |
| Selective recompilation | A source change invalidates only the world it actually touches, not the whole corpus | **Direction**, verbatim from `nextjs/lib/capabilities.ts`: "Demonstrated above on fixture data. Not offered as a shipped capability in this deployment" |
| Full-rebuild equivalence | A selective rebuild is checked against a full rebuild before it is trusted | **Not shown here.** A Core Engine property; this repository publishes no equivalence receipt — see [Reproducibility](#reproducibility) |
| Multi-model verification | Model output is checked against the source, so the contract survives swapping any one model | **Research frontier.** Nothing in this repository checks one model's output against another's, or against the source, at any point in a compile. Where the phrase appears it appears as an open problem: it is on the list at `/research`, a page whose stated subject is "The open problems in compiling documents into evidence-bound, versioned knowledge, and how we work on them." |
| Portable World | The world leaves as a signed, hash-verifiable package, not a vendor lock-in | **Implemented and unit-tested**, not demonstrated on a public artifact: `nextjs/lib/export-signing.ts` and `nextjs/lib/collection-download.ts` with their own tests, an offline verifier (`pnpm verify:export`), and `/api/export/trust` publishing the verification key. That endpoint is fail-closed — with no signer configured it returns `503 EXPORT_SIGNER_NOT_CONFIGURED` rather than an unsigned answer — so whether a given deployment serves a key depends on its environment. Described at `/product/compiled-world` (PACKAGE) |

A dedicated Compiler Contract page belongs at `/product/continuous-knowledge`, and whether that
route renders at any given commit is a question for the route rather than for this file. What
does not change with it: a product page describes the design, and this table describes how much
of that design this repository actually *shows*. Where a page and this table seem to disagree,
this table is the narrower and more conservative statement, deliberately.

## Compiled World

*The sections from here to [Open Formats](#open-formats) describe the design. The Compiler
Contract table above is the one that says how much of that design this repository currently
shows, and it is the one to read if the two ever seem to disagree.*

The output of a compile. Objects (entities, topics, claims) with stable identity; typed relations
between them; evidence binding every claim to a document version, page and region; versions, so a
compile produces a candidate and a person activates it while the version it replaced stays intact
and readable; and projections — ontology, graph, retrieval corpus, directory and validation
artifacts — all reading the same world. Detail: `/product/compiled-world`.

## Evidence Model

Every source is stored as an immutable object under a content hash; a later revision is a new
version, never an overwrite. Reading produces page- and region-bound regions, so a qualified claim
keeps the exact box it was drawn from rather than a paraphrased snippet. Objects, relations and
claims belong to a world version, so an answer given last month stays traceable to what was true
then. Review decisions (accept/reject/change a candidate) write an append-only record of who
decided, when, and on what — nothing beyond that. Detail: `/evidence`.

## Identity

Stable semantic identity — deciding that a mention in one document and a mention in another are
the same real-world thing — is treated as the hardest part of compilation, not a solved
preprocessing step: merge too eagerly and the world is wrong, merge too little and it is useless.
Whether that keying runs as a call to a separate Core Engine service or as this repository's own
`nextjs/lib/collection-compiler.ts` depends on which compile path a deployment has configured —
see [Architecture](#architecture) for exactly which. Neither path resolves *different* surface
forms to one identity today; what `collection-compiler.ts` actually does is measured and named as
a limit in the Compiler Contract table above ("Stable semantic identity"). See `/research`
("Semantic identity") for the open problem as currently described to the public.

## Temporal Integrity

Worlds are versioned, not overwritten in place. A source revision produces a new world version;
the version it replaced stays intact and queryable, so a past answer can still be traced to
exactly what the sources said when it was given. See `/product/compiled-world` (VERSIONS) and
`/research` ("Temporal integrity").

## Selective Recompilation

**Direction.** Working out which part of a world a source change actually invalidates, so a
corpus update does not force recompiling everything, is an active research area
(`/research`, "Selective recompilation") and is demonstrated on fixture data. It is explicitly
labelled **Direction**, not a shipped production capability, in `nextjs/lib/capabilities.ts` —
"Demonstrated above on fixture data. Not offered as a shipped capability in this deployment."

## Equivalence

Before a selectively-rebuilt world is trusted, it is expected to be checked against a full
rebuild of the same sources. **This repository publishes no equivalence receipt, and there is no
artifact here to point at.** Equivalence verification is Core Engine work; until a receipt exists
and is wired in, it is a design property of the compiler, not a claim this site makes.

`/reproducibility` states precisely what *is* public today: a digest proves the bytes a fixture
was built from are the bytes it claims; it does not by itself prove semantic quality, and no
independent reproduction receipt is currently registered on this deployment.

## Open Formats

Exported today, per [`nextjs/README.md`](nextjs/README.md): **Markdown, JSON, JSON-LD, Turtle,
CSV, JSON Lines**, plus a signed file inventory and the public verification key an export was
signed with (`GET /api/collections/[id]/download`, verified offline with `pnpm verify:export`).
An OpenAPI v1 schema is published at `/openapi.json` and an MCP server ships as a downloadable
stdio binary from `/developers`.

**Direction**, not yet exported: RDF, OWL 2, SHACL, PROV-O and OpenLineage adapters. Clearing an
export format is a licensing question as much as an engineering one — an adapter is not added
until both are settled.

## API / MCP

- **REST** — versioned endpoints under `nextjs/app/api/v1`, bearer-token authenticated, documented
  with a request in cURL, Python and TypeScript per endpoint at `/docs`. Machine-readable contract
  at `/openapi.json`.
- **MCP** — eight read-only stdio tools (`list_sources`, `get_world`, `search_world`,
  `ask_world`, `get_object`, `get_relation`, `get_evidence`, `download_package`) over the same
  World a human sees. No write tool exists, and the server refuses to start if one is added; both
  the exact tool list and the read-only refusal are asserted by `nextjs/lib/mcp-server.test.ts`.
  Download from `/developers`.
- **CLI** — a Node.js 20+ client with an immutable version and update check, downloadable from
  `/developers`.
- **Source agent** — a local-first SMB/NFS/SFTP/S3-compatible connector agent, same page.

Every downloadable artifact's version and SHA-256 are published at `/developer/channel.json` for
independent verification before running anything downloaded from this site.

## Benchmarks

This repository publishes no Knowledge Compilation Benchmark result and no comparative
performance number. That is a statement about what is committed here, not about which routes
happen to render: a `/benchmarks` route may publish the evaluation protocol and the metric
definitions — the content of a benchmark — without any qualified record existing, and a page
describing a protocol is not a score.

A number reaches a public surface in this repository only after a frozen evaluation protocol, a
published denominator, a same-condition run, and a receipt whose every digest is computed over
the bytes it names. None of that exists yet, so there is nothing here to quote and nothing here
to compare against. Publishing a benchmark or a competitor comparison is an owner decision
(`.github/CODEOWNERS`), and a vendor's own reported number is never restated here as reproduced.
The public evidence surfaces today are `/research` and `/reproducibility`.

## Reproducibility

`/reproducibility` (currently `noindex`, reachable by direct link) publishes frozen, byte-pinned
public fixture PDFs and a downloadable manifest, so a claim about those specific bytes can be
independently rechecked. It is explicit about what a fixture digest does and does not establish:
it proves input identity and a declared processing boundary; it does not represent a customer
result, a human-approved World, or an independently reproduced benchmark score. No independent
reproduction receipt is currently registered.

## Security

Reporting process, scope and disclosure timeline: [`SECURITY.md`](SECURITY.md). In short: report
privately to `security@tavonel.com`, do not open a public issue, and do not exceed the minimum
access needed to demonstrate an issue. Only the production deployment at `tavonel.com` is in
scope.

## Development

Requirements: Node 22, pnpm 10.34.4 (`corepack enable` or `npm i -g pnpm@10.34.4`).

```bash
git clone https://github.com/0ssol1620-byte/tavonel-saas-foundation.git
cd tavonel-saas-foundation

# root workspace (client/server) — donor app, converging into nextjs/
pnpm install --frozen-lockfile
pnpm check   # tsc --noEmit
pnpm test    # vitest run
pnpm build

# the live product package
cd nextjs
pnpm install --frozen-lockfile
pnpm check   # tsc --noEmit + eslint
pnpm test    # vitest run
pnpm build   # runs `prebuild` (check + test) first, then next build
pnpm test:e2e  # Playwright — builds and serves the app itself
```

`nextjs/README.md` documents every environment variable a real deployment needs and which of them
must never reach a browser bundle. Nothing in `nextjs/` accepts document bytes, enables live
payment, or promotes a candidate world to active without the checks that file describes.

CI (`.github/workflows/ci.yml`) runs `pnpm check && pnpm test && pnpm build` for both the root
workspace and `nextjs/` on every pull request and every push to `main`.
`.github/workflows/launch-qa.yml` runs the Playwright launch suite across Chromium, Firefox and
WebKit, enforces Lighthouse performance budgets as a separate job, and closes with an aggregate
job that fails unless all four succeeded. `.github/workflows/codeql.yml` runs CodeQL static
analysis on every pull request, every push to `main`, and weekly on a schedule.

Pull requests are opened against `main` and reviewed by the owners in
[`.github/CODEOWNERS`](.github/CODEOWNERS); use
[`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) to confirm the gates above
before requesting review. Repository governance (branch protection, required checks, tagging) is
described in [`docs/GITHUB_GOVERNANCE_2026-09-05.md`](docs/GITHUB_GOVERNANCE_2026-09-05.md) — none
of it is enabled yet, and enabling it is an owner action (`.github/CODEOWNERS`).

## Release Policy

See [`RELEASE_POLICY.md`](RELEASE_POLICY.md).

## License

Two facts about this repository's licensing disagree, and this section states both rather than
resolving one in the other's favor:

1. **No LICENSE file is published.** `git ls-files | grep -i '^LICENSE'` returns nothing, in this
   repository and on the public GitHub mirror. Absent a LICENSE file, the default under copyright
   law is all rights reserved — reading this code, including the parts that are public, would not
   by itself grant a right to copy, modify, redistribute or commercially reuse it.
2. **The repository's own tracked root `package.json` declares `"license": "MIT"`** (line 5) — a
   permissive grant, committed on `origin/main` and shipped with every clone, every
   `npm install`/`pnpm install`, and every dependency-graph or license scanner that reads this
   repository (this repository is public: `visibility: public`).

Those are not the same claim, and a visitor who checks only one of them will reach the wrong
answer about the other. This file does not pick a side: whether the correct fix is to add a
LICENSE file that matches `package.json`, to correct `package.json` to have no declared license,
or to publish a different license entirely, is an owner decision that has not been made
(`.github/CODEOWNERS`). Do not add a LICENSE file and do not edit `package.json` to resolve this
disagreement until that decision is made.
