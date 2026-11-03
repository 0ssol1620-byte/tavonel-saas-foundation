-- D-05 (20261027120000): a production refusal that names no surface reads the rows committed while it
-- waited on the scope lock, so the guard refuses it outside READ COMMITTED (refusal_requires_read_committed).
-- The isolation level can only be set before the transaction's first query, so it is the first statement.
begin;
set transaction isolation level serializable;
select plan(3);

select is(current_setting('transaction_isolation'), 'serializable', 'this transaction runs at SERIALIZABLE');
select throws_ok($$
  insert into public.customer_data_release_decisions (scope, release_revision, allowed, missing, evaluated_at,
    operator_actor, decision_reason)
  values ('direct_upload', repeat('6', 40), false, array['founder_approval_receipt_recorded'], now(),
    'founder:sql-editor', 'revision refused') $$,
  'P0001', 'refusal_requires_read_committed',
  'a refusal that names no surface is refused outside READ COMMITTED');
select lives_ok($$
  insert into public.customer_data_release_decisions (scope, release_revision, allowed, missing, evaluated_at,
    operator_actor, decision_reason, gate_surface_sha256)
  values ('direct_upload', repeat('6', 40), false, array['founder_approval_receipt_recorded'], now(),
    'founder:sql-editor', 'revision refused', 'sha256:' || repeat('5', 64)) $$,
  'a refusal naming its surface reads nothing it could miss, so it is recorded at any isolation level');

select * from finish();
rollback;
