# TAVONEL — One-path product UX implementation

Status: implementation candidate. Not a production release. Date: 2026-09-12 (KST).

## Scope and authority

The user approved implementing the one-path product plan: add files or connect a supported source, let the existing pipeline prepare knowledge, review only the necessary decisions, explicitly approve activation, and choose how to use the result with AI. The four approved films are reused, not regenerated. No image-generation service was used.

Base: `f100dce219e1e30fb1b76b029c191adc9d40a004` (`agent/source-first-experience-20260912`, PR #65).
Implementation branch: `agent/one-path-product-ux-20260912`.
Working directory: `C:\Users\yspow\work\tavonel-worktrees\one-path`.

## Implemented

### Public experience

- Shared desktop and mobile entry navigation is `How it works`, `Connect`, `Pricing`. Other destinations remain reachable through existing footer, documentation and context links. Existing routes, canonicals and legal pages are not physically deleted.
- English landing has five customer-oriented sections. The original four-film player is in the first section, before the real Apple source sample. Repetitive job cards, the technical hero strip, background world canvas and instrument navigation were removed from this entry page.
- One state-controlled primary start action is retained. The public sample remains a separate, clearly labelled secondary action. Pilot, live commerce and signed-in entry destinations retain their existing authority model.
- Actual original-source proof remains below the film. The film is clearly labelled as a directed recreation, not a screen recording; the published corpus is not described as a new customer processing run.
- Local files/folders/ZIP, available connected sources, and assisted private imports are distinguished. Unsupported universal or zero-setup connector claims were not introduced. Cost/selection confirmation remains before processing.
- Korean entry uses the same film-first composition with localized copy; catalog-derived plan limits and English-documentation disclosure remain.

### Films

- The four original MP4 assets are byte-identical to the base commit. `nextjs/lib/locked-film-assets.json` records their digests, and tests enforce them.
- The player uses the approved encoded films on the new home rather than recreating the desktop canvas. Existing low-motion, Save-Data, explicit play/pause, manual stage selection and keyboard controls remain.
- Stage captions now match what the actual cuts depict: files, organization, source updates, and AI use.
- Hidden document playback and decode/network failures now stop playback; failures leave a usable poster and explanation instead of a blank frame.
- An actual desktop overflow caused by the old full-viewport player width was diagnosed and corrected with a container-bound width. No overflow-hiding rule substitutes for correct geometry.

### Workspace

- The primary rail is Home, Knowledge, Use with AI, More. Review, Changes, graph, Connections, Developer tools, Activity and Settings remain under More, with existing trial restrictions retained.
- Empty-state guidance is compact and does not automatically expand the detailed setup checklist. Source intake and its automatic durable compile path are unchanged.
- Status wording distinguishes loading, preparation, review and published knowledge. A pending-review indicator is tied to a genuinely unapproved candidate rather than any compiled candidate.
- AI setup is organized by destination: assistant, application, local files. Protocol/package details are available on demand.
- Opening a guide or receiving ZIP bytes no longer marks an external AI connection as successful. The existing UI has no authenticated external-consumer receipt, so that success state remains false. This does not constitute implementation or qualification of every external consumer.
- Existing upload preflight, actual cost approval, CDR, observed progress, source access, review, human activation, rollback and billing checks remain.

### Parent-candidate repair

- Reproduced three TypeScript errors against PDF.js 6 in the original-source viewer. Removed the obsolete `isEvalSupported` option and used the loading task's supported `destroy()` lifecycle. Digest matching, page-count checks and rendering bounds remain enforced.

## Repository preservation

The original film-research clone at `C:\Users\yspow\work\tavonel-saas-foundation` remained on its existing local main (`2a84545`). A fresh remote fetch established that it was 612 commits behind `origin/main=152cc36`; a previously cached 'up-to-date' report was not the current remote state.

Safe film/OCR work and audit artifacts were copied into `.chatgpt2codex/recovery/one-path-20260912` under that original clone. The manifest records **2,420 copied files / 4,447,833,661 bytes**, verifies each copied file's SHA-256, and includes a binary working patch, refs and status. Unclassified/private directories were not copied or deleted. The original dirty files were not reset, cleaned or overwritten.

No old D: repository or branch was deleted. A merged branch does not prove that a dirty worktree or untracked research data can be removed. Other concurrently visible `tfinal` worktrees are outside this implementation's ownership and were not changed.

## Verification and evidence boundaries

- Baseline PDF.js errors were reproduced before the fix.
- Strict TypeScript/ESLint passed after the implementation changes.
- The complete isolated unit suite passed **3,813 / 3,813** at original test timeouts. No safety test was skipped. The original presentation assertions were updated for the expressly approved new navigation and copy, and new asset-preservation/one-path tests were added.
- An intermediate rerun was invalidated by package links pointing into a different active D: checkout. This worktree's dependency folder was preserved, then the exact lockfile was reinstalled with an explicit local virtual store and copied package contents. React, React DOM, Next and Vitest resolution were verified inside this worktree before the passing complete run.
- Production-mode browser builds use `test.supabase.co` and the repository's dummy anonymous test key. **Never upload these `.next` artifacts to production.** Production must rebuild from the tested source with its legitimate deployment configuration.
- Initial browser run: 17 passed, 5 failed. Failures remain recorded, including film-width/tablet-position findings. The corrected rerun is recorded in the separate verification receipt; do not infer it from this document.
- New browser tests cover eight widths, actual film selection/playback, low-motion controls, failure posters, Korean entry, and loopback-only workspace fixtures. Existing original-PDF, consent, API security and billing tests are included in the selected rerun. This selected set is not the entire historical browser matrix or a live customer/provider qualification.

Local detailed logs and screenshots are under `.chatgpt2codex/` in this worktree. They are not uploaded wholesale. `ONE_PATH_VERIFICATION_2026-09-12.json` is the shareable bounded result receipt when produced.

## Release boundaries / remaining work

1. PR #63 remains a migration-dependent draft. Its production migration ledger, backup/rollback conditions, candidate-manifest RPC compatibility and paid-account expiry transition must be reconciled and verified before application release. Do not bypass that dependency by directly merging this child into main.
2. Reconcile the parent #63 → #64 → #65 stack on exact tested heads. This child repairs a parent source issue but does not retroactively make the parent CI green.
3. Run the complete release browser/CI matrix after integration. Historical tests that still require retired hero cards, menu groups or five original workspace rail items need explicit contract reconciliation, not skips or weakened security checks.
4. Complete real authenticated customer intake, provider permission/revision lifecycle and external-AI consumption checks under legitimate authorization. Fixture success is not live qualification.
5. Old repository retirement and remote branch deletion remain gated by per-worktree dirty/untracked preservation and ownership checks. This implementation isolates and inventories; it does not claim all old clones were removed.
6. Product/integrations/docs/trust route consolidation beyond their simplified entry navigation is a separate remaining content pass. Legal disclosures, pricing numbers, supported formats and access controls must not be removed merely to shorten a page.

No production database, API processing implementation, feature gate, billing rule, dependency lockfile or original film asset is changed by this candidate. No paid GPU/model run, customer-data activation, administrative merge bypass or production deployment is included.

## 2026-09-13 release-qualification closure

The implementation above has now completed the local web/product release-qualification program. The authoritative bounded receipt is `docs/brand/ONE_PATH_RELEASE_VERIFICATION_2026-09-13.json`; the older 2026-09-12 receipt remains historical evidence and is not overwritten.

The final true production-CSP build (`d1LyLoftS-z5Or_MQc2_w`) passed the full 3,820-test unit/contract suite, TypeScript, ESLint, the Chromium/Firefox/WebKit launch gates, the reconciled One-Path public and workspace matrices, live-commerce Product QA closure, developer clean-install and recipe smoke, a clean secret scan, 142/142 internal-link validation, `git diff --check`, and the CI-equivalent Lighthouse launch budgets. The two sign-in routes remain measure-only for Lighthouse SEO and are recorded as such in the receipt.

This is **local release qualification, not deployment**. These uncommitted changes have not been pushed or exercised by remote CI on their exact final state, no production deployment was performed, and live authenticated customer/provider/external-AI E2E plus physical-device qualification remain explicit external follow-ups. Search Console/index submission and Router empirical calibration/shadow/canary also remain separate master-blueprint tracks.
