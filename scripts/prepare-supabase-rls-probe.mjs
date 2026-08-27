import { writeFile } from "node:fs/promises";

const [projectId, outputPath] = process.argv.slice(2);
if (!projectId || !outputPath) throw new Error("Usage: node prepare-supabase-rls-probe.mjs <project-id> <output-path>");

const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";
const workspaceA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const documentA = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const documentB = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const proofA = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const query = `
begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '${userA}', 'authenticated', 'authenticated', 'tenant-a@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '${userB}', 'authenticated', 'authenticated', 'tenant-b@example.invalid', '$2a$10$fixture', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.workspaces (id, owner_id, name, slug) values
  ('${workspaceA}', '${userA}', 'Tenant A qualification', 'tenant-a-qualification'),
  ('${workspaceB}', '${userB}', 'Tenant B qualification', 'tenant-b-qualification');
insert into public.workspace_memberships (workspace_id, user_id, role) values
  ('${workspaceA}', '${userA}', 'owner'),
  ('${workspaceB}', '${userB}', 'owner');
insert into public.workspace_entitlements (workspace_id, status, source, upload_bytes_limit, document_limit) values
  ('${workspaceA}', 'active', 'manual', 1000, 2),
  ('${workspaceB}', 'active', 'manual', 1000, 2);
insert into public.plans (id, code, name, upload_bytes_limit, document_limit, max_document_bytes) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'fixture', 'Fixture', 1000, 2, 1000);
insert into public.documents (id, workspace_id, created_by, original_filename, declared_mime_type, quarantine_object_key, state) values
  ('${documentA}', '${workspaceA}', '${userA}', 'a.pdf', 'application/pdf', 'quarantine/tenant-a/a/source', 'quarantined'),
  ('${documentB}', '${workspaceB}', '${userB}', 'b.pdf', 'application/pdf', 'quarantine/tenant-b/b/source', 'quarantined');
insert into public.sanitization_proofs (id, document_id, input_sha256, output_sha256, output_mime_type, sanitizer_version, immutable_object_key) values
  ('${proofA}', '${documentA}', repeat('a', 64), repeat('b', 64), 'application/pdf', 'fixture', 'canonical/tenant-a/a/proof');
insert into public.knowledge_graph_candidates (workspace_id, document_id, sanitization_proof_id) values
  ('${workspaceA}', '${documentA}', '${proofA}');
insert into public.paddle_customers (paddle_customer_id, user_id, email) values
  ('ctm_fixture_a', '${userA}', 'tenant-a@example.invalid'),
  ('ctm_fixture_b', '${userB}', 'tenant-b@example.invalid');
insert into public.paddle_subscriptions (paddle_subscription_id, workspace_id, paddle_customer_id, status, occurred_at) values
  ('sub_fixture_a', '${workspaceA}', 'ctm_fixture_a', 'active', now()),
  ('sub_fixture_b', '${workspaceB}', 'ctm_fixture_b', 'active', now());
insert into public.billing_events (paddle_event_id, event_type, occurred_at) values ('evt_fixture_a', 'subscription.updated', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '${userA}', true);

do $$
begin
  if (select count(*) from public.profiles where id = '${userA}') <> 1 then raise exception 'self profile allow failed'; end if;
  if (select count(*) from public.profiles where id = '${userB}') <> 0 then raise exception 'cross profile deny failed'; end if;
  if (select count(*) from public.workspaces where id = '${workspaceA}') <> 1 then raise exception 'workspace allow failed'; end if;
  if (select count(*) from public.workspaces where id = '${workspaceB}') <> 0 then raise exception 'workspace deny failed'; end if;
  if (select count(*) from public.workspace_memberships where workspace_id = '${workspaceA}') <> 1 then raise exception 'membership allow failed'; end if;
  if (select count(*) from public.workspace_memberships where workspace_id = '${workspaceB}') <> 0 then raise exception 'membership deny failed'; end if;
  if (select count(*) from public.plans) <> 1 then raise exception 'plan read allow failed'; end if;
  if (select count(*) from public.workspace_entitlements where workspace_id = '${workspaceA}') <> 1 then raise exception 'entitlement allow failed'; end if;
  if (select count(*) from public.workspace_entitlements where workspace_id = '${workspaceB}') <> 0 then raise exception 'entitlement deny failed'; end if;
  if (select count(*) from public.documents where id = '${documentA}') <> 1 then raise exception 'document allow failed'; end if;
  if (select count(*) from public.documents where id = '${documentB}') <> 0 then raise exception 'document deny failed'; end if;
  if (select count(*) from public.sanitization_proofs where document_id = '${documentA}') <> 1 then raise exception 'proof allow failed'; end if;
  if (select count(*) from public.knowledge_graph_candidates where workspace_id = '${workspaceA}') <> 1 then raise exception 'candidate allow failed'; end if;
  if (select count(*) from public.knowledge_graph_candidates where workspace_id = '${workspaceB}') <> 0 then raise exception 'candidate deny failed'; end if;
  if (select count(*) from public.paddle_customers where paddle_customer_id = 'ctm_fixture_a') <> 1 then raise exception 'customer allow failed'; end if;
  if (select count(*) from public.paddle_customers where paddle_customer_id = 'ctm_fixture_b') <> 0 then raise exception 'customer deny failed'; end if;
  if (select count(*) from public.paddle_subscriptions where workspace_id = '${workspaceA}') <> 1 then raise exception 'subscription allow failed'; end if;
  if (select count(*) from public.paddle_subscriptions where workspace_id = '${workspaceB}') <> 0 then raise exception 'subscription deny failed'; end if;
  if has_table_privilege('authenticated', 'public.billing_events', 'select') then raise exception 'billing ledger must be unreadable'; end if;
  if has_table_privilege('authenticated', 'public.documents', 'insert') then raise exception 'browser document insert must be denied'; end if;
  if has_table_privilege('authenticated', 'public.workspace_entitlements', 'update') then raise exception 'browser entitlement update must be denied'; end if;
  if has_table_privilege('authenticated', 'public.knowledge_graph_candidates', 'update') then raise exception 'browser candidate promotion must be denied'; end if;
end $$;

reset role;
rollback;
select true as rls_matrix_passed, 'transaction_rolled_back' as persistence, 0 as persisted_fixture_rows limit 1;
`;

await writeFile(outputPath, JSON.stringify({ project_id: projectId, query }, null, 2));
