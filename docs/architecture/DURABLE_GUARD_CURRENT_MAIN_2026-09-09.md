# Durable guard current-main reconciliation — 2026-09-09

Status: candidate qualification in progress; NOT production ready.

## Source binding

Existing guard branch head `97b584e2cec8da33e7fc07b41b5918ea8ce27658` was merged with Site main `5c20d119f46f` without conflicts. Integration commit: `812e607007d4996596134e095e87d6723b4d9d7f`.

This preserves premium craft and guided Explore entry changes alongside the durable operation guards. PR #43 remains draft. No production database or activation flags changed.

## Scanner test loader correction

The Vite SSR transform inserted imports before the scanner's hashbang (observed offset 347), making the transformed module invalid. Native Node import and syntax checking passed. Removed only that unnecessary hashbang: the non-executable script is invoked through `node scripts/secret-scan.mjs ..` by the package script. The scanner patterns and test assertions are unchanged.

Validation after correction: all 198 Next.js test files / 2,428 tests passed, including 16 scanner tests. The actual repository secret scan passed. TypeScript and ESLint passed in the build's precheck. Production build, root checks, browser QA and remote exact-commit CI remain separate gates.

## Production database observation

Read-only Supabase management observations at approximately 2026-09-09 21:46 KST, project `tfcorhjkqcuisqhsjemz` (`tavonel-saas-foundation`):

- Migration history ends at `20260908105830 audit_rpc_server_only_0054`.
- `public.foundation_operation_leases` and `public.foundation_contact_windows` do not exist.
- `pg_cron` is not installed.

This is evidence that migration 0055 and its maintenance setup remain outstanding. It is not a backup/restore receipt or authorization to migrate. The app must not be merged/deployed before the documented database rollout gates are satisfied.

## Remaining release gates

1. Complete and retain current candidate root/build/browser/security and exact-commit CI results.
2. Independent guard review, including the documented source ACL limitations.
3. Verify production backup/restore and old-build compatibility; approve and apply the reviewed additive migration and maintenance setup.
4. Observe an actual successful cleanup job and an authenticated scoped canary.
5. Merge/deploy only after those gates, then verify production behavior.

The global customer-data gate remains OFF. Router, provider qualification, real customer-path CDR and authenticated end-to-end product acceptance remain independent requirements.
