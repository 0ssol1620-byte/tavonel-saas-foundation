# Selected revision frontend acceptance — 2026-09-30

This closes the explicitly open selected-revision frontend defect against the masterplan's review/correction and immutable publish/diff/restore requirements (UX12/UX13). It does not qualify the whole authenticated customer journey.

## Implemented behavior

- Artifact loading requires the requested collection and manifest. A generation counter prevents late candidate and active-pointer responses from replacing a newer selection.
- Evidence reads request that exact manifest, re-run when it changes, clear old models and ignore aborted responses. A mismatched response is refused. Activation requires matching source-bound evidence, retains the exact selected digest and current pointer CAS preconditions, and remains closed after failed reads.
- Review decisions shown in the queue belong to the selected manifest. Changing the selected artifact clears review/edit/activation reasons so old approval text cannot authorize another revision.
- Corrections move to their verified resulting candidate only after successful loading, retain the earlier immutable candidate, and add a history entry. A failed follow-up read keeps the user's correction input and does not announce success.
- Surface navigation retains the manifest; Back/Forward reload the artifact identity as well as the visible surface. Reload reads the pinned digest. Out-of-order history reads cannot replace the newer selection.
- Comparison reads verify both collection and requested digest, clear old comparison state, handle transport/authorization failures and expose no rollback from an unavailable or mismatched comparison. Valid comparisons still display actual field changes.

No backend route, ACL policy, storage contract or Core engine was changed. Current-source promotion and restore checks are retained in the production handlers.

## Qualification and limits

The local production build passed (153 routes), TypeScript and app/components/lib ESLint passed. Full hermetic unit regression: 404 files / 5,874 tests passed, zero failures/skips under the normal Windows token. An initial restricted-token run had three existing symlink/Python subprocess permission failures; these were reproduced as environment restrictions, rerun without changing assertions, and the full normal-token run passed. Current-source promotion/restore contracts passed 35 tests; relevant review/diff/discovery and environment rechecks passed 70 tests (overlapping, not additive).

The affected Chromium browser suites exercise synthetic signed-in sessions and HTTP route fixtures at 1440/390/360 pixels, with zero retries. New cases cover correction to another manifest, exact evidence, stale activation refusal, Back/Forward/reload, mismatched evidence, positive comparison, wrong-version/403/network comparison refusal, and a delayed read settling after a newer history selection. Existing source-preview, keyboard, interruption and review-required gates remain exercised. Actual desktop and mobile screenshots were inspected after the PDF canvas became ready; selected evidence and its page/bbox overlay render, with no horizontal overflow. The PDF is an explicit deterministic renderer fixture, not customer evidence.

These browser fixtures do not certify GoTrue login/session renewal, Next cookies, actual object-storage ACLs or customer documents. The separate real Core HTTP and PostgreSQL/JWT harnesses qualify their own boundaries, not these browser mocks. The bounded selected-revision acceptance is verified; full UX12/UX13 remain partial pending the joined real session/storage/browser path and broader quality/provenance acceptance. Their global disposition now moves from not newly assessed to assessed-partial, rather than falsely marking them complete.

Local evidence: `task/desktop-revision-full-unit-final.json`, `task/desktop-revision-browser-qualified.log`, `task/desktop-revision-race-final.log`, `task/desktop-revision-final-build.log`, `task/desktop-revision-acl.log`, and the screenshot attachments in the local Playwright report.
