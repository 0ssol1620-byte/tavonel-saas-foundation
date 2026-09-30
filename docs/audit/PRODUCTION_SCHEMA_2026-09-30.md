# Production schema rollout — 2026-09-30

Applied to Supabase project `tfcorhjkqcuisqhsjemz` under the founder's standing
implementation and deployment authorization. Each migration returned success;
the production migration ledger was read again afterward. Local filenames and
server-assigned versions differ intentionally.

| Local migration suffix | Production version |
| --- | --- |
| customer_source_deletion | 20260930001553 |
| source_deletion_purge_failures | 20260930001604 |
| source_deletion_derived_closure | 20260930001606 |
| founder_test_reset_deletion_failures_and_operator_holds | 20260930001610 |
| source_world_deletion_inventory | 20260930001612 |
| source_deletion_purge_backoff | 20260930001614 |
| compile_digest_immutability | 20260930001617 |
| compile_artifact_provenance | 20260930001619 |
| processing_terms_acceptance | 20260930001717 |
| processing_workspace_grant | 20260930001722 |
| billing_gate_enforcement | 20260930003548 |

Deletion migrations were qualified by the DB rehearsal on PR #121 at `a830d39`.
Terms and grant migrations were qualified by the DB rehearsal on PR #137 at
`677d9a1`. These additive schema changes precede the application deployment.
They do not constitute a customer-processing approval, a customer's terms
acceptance, a successful purge, or an activation of live billing. No customer
acceptance or release grant was inserted as part of these migrations.

The billing migration was subsequently qualified by the complete DB rehearsal
on PR #137 at `47146ca` and applied. It creates durable pause intent, reconciliation
and customer-notice storage; applying it does not itself call Paddle or charge.
