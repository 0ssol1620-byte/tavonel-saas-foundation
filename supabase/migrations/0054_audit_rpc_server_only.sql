-- 0054 — the enterprise audit log stops accepting entries from the browser.
--
-- Finding R-3 / gap matrix L-4 (USKC_DB_QUALIFICATION_CONTRACT_2026-09-06, Layer A results;
-- reproduced in CI run 34018684241, tenant_rls_matrix.sql test 43): an organization `viewer` --
-- the lowest role there is -- can append `compile.complete` to its own organization's audit log.
-- 0014:187-219 gates `append_enterprise_audit_event` on `organization:read`, which a viewer holds,
-- and `p_action` is free text. An auditor reading that log cannot tell a system event from one a
-- read-only member typed. The acceptance test the gap matrix wrote for L-4 is "read-only member
-- appends system action -> refused", and until now it was held as a pgTAP todo.
--
-- Repair: `execute` is revoked from `authenticated` (and restated for `anon` and `public`, which
-- 0014:350 already covered). The audit log becomes server-only: the service role appends it on the
-- server's own authority, which is the D1-03 path, and the function's two internal guards
-- (`enterprise_audit_actor_invalid`, `enterprise_access_denied`) stay exactly as they are.
--
-- NO CONSTRAINED CLIENT WRAPPER IS ADDED, because no browser path calls this RPC. The check was a
-- grep for `append_enterprise_audit_event` across every .ts/.tsx/.mjs/.js file in the repository:
-- zero hits outside supabase/migrations and supabase/tests. Nothing in nextjs/, server/, client/,
-- shared/ or workers/ reaches it by `.rpc(...)` or by `/rest/v1/rpc/...`. Writing a wrapper for a
-- caller that does not exist would ship an unused, user-writable path into the audit log -- the
-- opposite of the finding. If a browser feature later needs to record a user action, it arrives
-- with its own migration, its own allowlist of user actions and `details->>'source' = 'user'`
-- stamped by the function rather than by the caller.
--
-- Re-runnable: `revoke` on a privilege already absent is a no-op, and no data is touched.

begin;

revoke execute on function public.append_enterprise_audit_event(uuid, text, text, text, text, uuid, text, text, jsonb)
  from public, anon, authenticated;

commit;
