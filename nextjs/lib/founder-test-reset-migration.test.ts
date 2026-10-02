import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/20260920133000_founder_test_reset.sql"), "utf8");
const service = readFileSync(resolve(process.cwd(), "lib/founder-test-reset.ts"), "utf8");

function functionBody(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${escaped}\\b[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`,
    "i",
  ));
  expect(match, `function body missing: ${name}`).not.toBeNull();
  return match![1]!;
}

function selectedTables(body: string, valuePattern: string) {
  return new Set([...body.matchAll(new RegExp(
    `(?:select|union\\s+all\\s+select)\\s+'([a-z0-9_]+)'(?:\\s+table_name)?\\s*,\\s*${valuePattern}`,
    "gi",
  ))].map((match) => match[1]!));
}

describe("founder test reset migration", () => {
  it("pins the exact account and preserves identity, access, enterprise, billing and audit anchors", () => {
    expect(sql).toContain("target_email = '0ssol1620@gmail.com'");
    for (const preserved of ["auth.users", "public.profiles", "public.foundation_account_access_grants",
      "public.foundation_workspaces", "public.foundation_workspace_members", "public.enterprise_organizations",
      "public.enterprise_workspaces", "public.foundation_billing_accounts", "public.enterprise_audit_events"]) {
      expect(sql).not.toMatch(new RegExp(`delete\\s+from\\s+${preserved.replace(".", "\\.")}`, "i"));
    }
  });

  it("fails closed for holds and active work and exposes service-role-only phases", () => {
    expect(sql).toContain("legal_hold_enabled");
    expect(sql).toContain("'tavonel.source_legal_hold.v1'||pg_catalog.chr(10)||p_workspace_key");
    expect(sql).toContain("founder_test_reset_blocks_legal_hold");
    expect(sql).toContain("founder_test_reset_legal_hold_waits_for_finalize");
    expect(sql).toContain("before insert or update or delete on public.enterprise_governance_policies");
    expect(sql).toContain("founder_test_reset_legal_hold_state_invalid");
    expect(sql).toContain("count(*) from public.enterprise_governance_policies where organization_id=v_org) <> 1");
    expect(sql).toContain("founder_test_reset_blocks_workspace_organization_move");
    expect(sql).toContain("update of organization_id, workspace_key on public.enterprise_workspaces");
    expect(sql).toContain("array[old.workspace_key,new.workspace_key]");
    expect(sql).toContain("founder_test_reset_workspace_organization_change_refused");
    expect(sql).toContain("FOUNDER_AUTHORIZED_TEST_CONTENT_RESET");
    expect(sql).toContain("object_grace_override_days integer not null default 0");
    expect(sql).toContain("audit_evidence_disposition text not null default 'ARCHIVED'");
    expect(sql).toContain("foundation_operation_leases");
    expect(sql).toContain("state in ('queued','leased')");
    const assertions = functionBody("founder_test_reset_assertions");
    expect(assertions).toContain("'founder-test-reset:'||p_workspace_key");
    expect(assertions).toMatch(/perform 1 from public\.foundation_compile_jobs[\s\S]*state not in \('ready','failed','cancelled'\)[\s\S]*for update/i);
    expect(assertions).not.toMatch(/foundation_compile_jobs[\s\S]{0,200}updated_at/i);
    expect(sql).toContain("founder_test_reset_write_fenced");
    expect(sql).toContain("founder_reset_fence_intake");
    expect(sql).toContain("prepare_founder_test_reset");
    expect(sql).toContain("seal_founder_test_reset");
    expect(sql).toContain("finalize_founder_test_reset");
    expect(sql).toMatch(/revoke all on function[\s\S]*public\.prepare_founder_test_reset[\s\S]*from public, anon, authenticated/i);
  });

  it("deletes tenant content in dependency order without toggling any trigger", () => {
    expect(sql.indexOf("delete from public.foundation_retrieval_embeddings")).toBeLessThan(sql.indexOf("delete from public.foundation_retrieval_units"));
    expect(sql.indexOf("delete from public.foundation_world_transition_receipts")).toBeLessThan(sql.indexOf("delete from public.foundation_world_events"));
    expect(sql.indexOf("delete from public.sanitization_proofs")).toBeLessThan(sql.indexOf("delete from public.documents"));
    expect(sql).not.toMatch(/\b(?:disable|enable)\s+trigger\b/i);
    expect(sql).not.toMatch(/truncate/i);
  });

  it("archives immutable evidence, handles GPU reservation FKs, and proves both R2 roots empty", () => {
    expect(sql).toContain("founder_test_reset_evidence_archive");
    expect(sql).toContain("founder_test_reset_evidence_append_only");
    expect(sql.indexOf("archive_founder_test_reset_evidence(p_reset_id")).toBeLessThan(sql.indexOf("delete from public.gpu_job_reservations"));
    expect(sql.indexOf("delete from public.gpu_job_reservations")).toBeLessThan(sql.indexOf("delete from public.sanitization_proofs"));
    expect(service).toContain("RESET_OBJECTS_REMAIN_AFTER_DELETE");
    expect(service).toContain("drainFounderResetObjects(signer, workspaceKey, r2Keys, deleted)");
    expect(service).toContain("FOUNDER_TEST_RESET_R2_MANIFEST_DRIFT");
    expect(service).toContain("RESET_OBJECTS_REAPPEARED_AFTER_FINALIZE");
  });

  it("keeps DB writers fenced until exact-prefix verification reaches a terminal state", () => {
    expect(sql).toContain("'db_finalized_pending_object_verify', 'completed'");
    expect(sql).toContain("state in ('sealed','db_finalized_pending_object_verify')");
    expect(functionBody("finalize_founder_test_reset")).toContain("set state='db_finalized_pending_object_verify'");
    expect(functionBody("complete_founder_test_reset")).toContain("set state='completed'");
    expect(service).toContain('state === "db_finalized_pending_object_verify"');
    expect(service).toContain('rpc("complete_founder_test_reset"');
    expect(service).not.toContain('rpc("resume_founder_test_reset_object_verification"');
    expect(service).toContain('throw new Error("RESET_OBJECTS_REAPPEARED_AFTER_FINALIZE")');
    expect(sql).not.toContain("resume_founder_test_reset_object_verification");
    expect(sql).toMatch(/revoke all on function[\s\S]*finalize_founder_test_reset[\s\S]*complete_founder_test_reset[\s\S]*from public, anon, authenticated/i);
  });

  it("serializes every sealed write fence and covers OLD, NEW, UPDATE, and DELETE", () => {
    expect(sql).toContain("founder_test_reset_lock_workspaces(v_old,v_new)");
    expect(sql).toContain("founder_test_reset_lock_workspaces(v_old_ws,v_new_ws)");
    expect(sql).toContain("'founder-test-reset:'||v_workspace");
    expect(sql).toContain("workspace_key in (v_old,v_new)");
    expect(sql).toContain("workspace_key in (v_old_ws,v_new_ws)");
    const direct = new Set([...sql.matchAll(/before insert or update or delete on public\.([a-z0-9_]+)/gi)]
      .map((match) => match[1]!));
    const dynamicBlock = sql.match(/foreach v_table in array array\[([\s\S]*?)\]\s+loop/i)?.[1] ?? "";
    const dynamic = new Set([...dynamicBlock.matchAll(/'([a-z0-9_]+)'/gi)].map((match) => match[1]!));
    const fullyFenced = new Set([...direct, ...dynamic]);
    const deleted = new Set([...functionBody("finalize_founder_test_reset")
      .matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((match) => match[1]!));
    for (const table of deleted) {
      expect(fullyFenced, `sealed write fence missing ${table}`).toContain(table);
    }
    for (const table of ["foundation_operation_leases", "foundation_compute_reservations",
      "model_provider_spend_reservations"]) expect(fullyFenced).toContain(table);
  });

  it("counts and fingerprints every deleted table in the sealed manifest", () => {
    const finalize = functionBody("finalize_founder_test_reset");
    const deleted = new Set([...finalize.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)]
      .map((match) => match[1]!));
    const counted = selectedTables(functionBody("founder_test_reset_table_counts"), "count\\(\\*\\)");
    const fingerprinted = selectedTables(functionBody("founder_test_reset_rows_fingerprint"), "to_jsonb\\(x\\)::text");
    const archived = selectedTables(functionBody("archive_founder_test_reset_evidence"), "(?:x\\.[a-z0-9_]+(?:\\|\\|[^,]+)*|to_jsonb\\(x\\)::text)\\s*,\\s*to_jsonb\\(x\\)");
    expect(deleted.size).toBe(36);
    expect([...counted].sort()).toEqual([...deleted].sort());
    expect([...fingerprinted].sort()).toEqual([...deleted].sort());
    for (const table of archived) expect(deleted).toContain(table);
  });

  it("keeps append-only triggers active and deletes only archived rows within the sealed reset session", () => {
    const archive = functionBody("archive_founder_test_reset_evidence");
    const allowDelete = functionBody("founder_test_reset_archive_allows_delete");
    const rowDigest = functionBody("founder_test_reset_row_sha256");
    expect(rowDigest).toMatch(/extensions\.digest\(pg_catalog\.convert_to\(p_payload::text,\s*'UTF8'\),\s*'sha256'\)/i);
    expect(archive).toContain("public.founder_test_reset_row_sha256(payload)");
    expect(allowDelete).toContain("pg_catalog.current_setting('tavonel.founder_reset_id',true)");
    expect(allowDelete).toContain("v_sha := public.founder_test_reset_row_sha256(p_old)");
    expect(allowDelete).toContain("a.row_sha256=v_sha");
    expect(functionBody("finalize_founder_test_reset")).toContain("perform public.archive_founder_test_reset_evidence");
  });

  it("deletes OAuth envelopes only after target references and only when globally orphaned", () => {
    expect(functionBody("founder_test_reset_rows_fingerprint"))
      .toContain("founder_test_reset_orphan_oauth_secret_ids(p_workspace_key)");
    expect(functionBody("founder_test_reset_table_counts"))
      .toContain("founder_test_reset_orphan_oauth_secret_ids(p_workspace_key)");
    expect(sql.indexOf("delete from public.foundation_oauth_connections")).toBeLessThan(
      sql.indexOf("delete from public.foundation_oauth_secret_envelopes"));
    expect(sql).toMatch(/delete from public\.foundation_oauth_secret_envelopes[\s\S]*not exists\(select 1 from public\.foundation_oauth_connections/i);
    expect(sql).toMatch(/delete from public\.foundation_oauth_secret_envelopes[\s\S]*not exists\(select 1 from public\.foundation_oauth_authorizations/i);
    expect(sql).toContain("founder_test_reset_orphan_oauth_secret_ids(p_workspace_key)");
    expect(sql).toContain("c.workspace_key<>p_workspace_key");
    expect(sql).toContain("a.workspace_key<>p_workspace_key");
    expect(sql).toContain("founder_reset_fence_oauth_connections before insert or update or delete");
    expect(sql).toContain("founder_reset_fence_oauth_authorizations before insert or update or delete");
    expect(sql).toContain("guard_founder_test_reset_oauth_reference_write");
  });
});

describe("founder test reset covers the connection source inventory (20261002120000)", () => {
  const read = (name: string) => readFileSync(resolve(process.cwd(), `../supabase/migrations/${name}`), "utf8");
  const previous = read("20260927105000_founder_test_reset_deletion_failures_and_operator_holds.sql");
  const current = read("20261002120000_founder_test_reset_connection_inventory.sql");
  const inventoryMigration = read("20261002100000_connection_source_inventory_reconcile.sql");
  const INVENTORY = ["foundation_connection_inventory_heads", "foundation_connection_inventory_scans",
    "foundation_connection_inventory_pages", "foundation_connection_inventory_items"];
  const body = (source: string, name: string) => {
    const match = source.match(new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`, "i"));
    expect(match, `function body missing: ${name}`).not.toBeNull();
    return match![1]!;
  };
  const deletedIn = (finalize: string) => [...finalize.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]!);

  it("counts, fingerprints and deletes exactly the four inventory tables on top of 20260927105000", () => {
    const before = new Set(deletedIn(body(previous, "finalize_founder_test_reset")));
    const after = deletedIn(body(current, "finalize_founder_test_reset"));
    expect(before.size).toBe(37);
    expect(new Set(after).size).toBe(41);
    expect(after.filter((table) => !before.has(table)).sort()).toEqual([...INVENTORY].sort());
    expect([...selectedTables(body(current, "founder_test_reset_table_counts"), "count\\(\\*\\)")].sort())
      .toEqual([...new Set(after)].sort());
    expect([...selectedTables(body(current, "founder_test_reset_rows_fingerprint"), "to_jsonb\\(x\\)::text")].sort())
      .toEqual([...new Set(after)].sort());
  });

  it("keeps every replaced body identical apart from the added inventory lines", () => {
    for (const name of ["finalize_founder_test_reset", "founder_test_reset_table_counts", "founder_test_reset_rows_fingerprint"]) {
      const kept = body(current, name).split("\n")
        .filter((line) => !/foundation_connection_inventory_|^\s*-- 20261002120000|^\s*-- pages cascade/.test(line));
      expect(kept.join("\n"), name).toBe(body(previous, name));
    }
  });

  it("deletes the inventory ahead of the connection, head before scan, and archives none of it", () => {
    const finalize = body(current, "finalize_founder_test_reset");
    const at = (table: string) => finalize.indexOf(`delete from public.${table}`);
    for (const table of INVENTORY) expect(at(table)).toBeLessThan(at("foundation_connections"));
    expect(at("foundation_connection_inventory_heads")).toBeLessThan(at("foundation_connection_inventory_scans"));
    expect(at("foundation_connection_inventory_pages")).toBeLessThan(at("foundation_connection_inventory_scans"));
    expect(finalize.indexOf("set_config('tavonel.founder_reset_id'")).toBeLessThan(at("foundation_connection_inventory_items"));
    expect(current).not.toMatch(/function\s+public\.archive_founder_test_reset_evidence/i);
  });

  it("relies on the inventory migration's fence and changes no grant or search_path", () => {
    for (const table of ["foundation_connection_inventory_heads", "foundation_connection_inventory_scans"]) {
      expect(inventoryMigration).toContain(`create trigger founder_reset_fence before insert or update or delete on public.${table}`);
    }
    expect(current).not.toMatch(/^\s*(grant|revoke)\b/im);
    expect(current.match(/security definer set search_path = '' as \$\$/g)).toHaveLength(3);
    expect(current.match(/create or replace function/gi)).toHaveLength(3);
  });
});

describe("founder test reset keeps its archived-row DELETE allowance in every guard (20261002140000)", () => {
  const directory = resolve(process.cwd(), "../supabase/migrations");
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  const read = (name: string) => readFileSync(resolve(directory, name), "utf8");
  const ALLOWANCE = "if tg_op='DELETE' and public.founder_test_reset_archive_allows_delete(tg_table_name,to_jsonb(old)) then return old; end if;";
  const bodies = (source: string, name: string) => [...source.matchAll(new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${name}\\(\\)[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`, "gi"))]
    .map((match) => match[1]!);
  const latest = (name: string) => {
    const file = files.filter((candidate) => bodies(read(candidate), name).length > 0).at(-1);
    expect(file, `no definition of ${name}`).toBeDefined();
    return { file: file!, body: bodies(read(file!), name).at(-1)! };
  };

  // Every BEFORE DELETE guard on a table finalize_founder_test_reset deletes archived rows from. A later
  // replacement that drops the first line makes finalize fail after R2 has been purged.
  it.each([
    "reject_foundation_job_event_mutation", "reject_foundation_compile_event_mutation",
    "prevent_foundation_world_transition_receipt_mutation", "prevent_source_deletion_evidence_mutation",
    "guard_connector_document_binding", "guard_connector_source_suspension",
  ])("the live definition of %s starts with the reset allowance", (name) => {
    const { body } = latest(name);
    expect(body.replace(/^\s*begin\s*/i, "").split("\n")[0]!.trim()).toBe(ALLOWANCE);
  });

  it("restores the allowance on top of the 20261001150000 write boundary and changes nothing else", () => {
    const fix = latest("guard_connector_document_binding");
    expect(fix.file).toBe("20261002140000_connector_binding_guard_reset_allowance.sql");
    const boundary = bodies(read("20261001150000_connector_binding_write_boundary.sql"), "guard_connector_document_binding");
    expect(boundary).toHaveLength(1);
    expect(fix.body.replace(`  ${ALLOWANCE}\n`, "")).toBe(boundary[0]);
    expect(fix.body).toContain("raise exception 'CONNECTOR_BINDING_WRITE_PATH'");
    const migration = read(fix.file);
    expect(migration).toContain("create or replace function public.guard_connector_document_binding() returns trigger\nlanguage plpgsql set search_path = '' as $$");
    expect(migration).not.toMatch(/^\s*(grant|revoke|alter)\b/im);
    // The guard stays invoker; only the three reset functions it also replaces are security definer.
    expect(migration.match(/security definer set search_path = '' as \$\$/g)).toHaveLength(3);
    expect(migration.match(/create or replace function/gi)).toHaveLength(4);
  });

  const FIX = "20261002140000_connector_binding_guard_reset_allowance.sql";
  const TIE = "connector_binding_tie_resolutions";
  const RESET = ["finalize_founder_test_reset", "founder_test_reset_table_counts", "founder_test_reset_rows_fingerprint"];
  const deletedIn = (finalize: string) => [...finalize.matchAll(/delete\s+from\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]!);
  const resetBody = (file: string, name: string) => {
    const match = read(file).match(new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\bas\\s+\\$\\$([\\s\\S]*?)\\$\\$\\s*;`, "i"));
    expect(match, `function body missing: ${name}`).not.toBeNull();
    return match![1]!;
  };

  it("is the live definition of every reset function it replaces", () => {
    for (const name of RESET) {
      const file = files.filter((candidate) => new RegExp(`function\\s+public\\.${name}\\(`, "i").test(read(candidate))).at(-1);
      expect(file, name).toBe(FIX);
    }
  });

  it("counts, fingerprints and deletes exactly the tie resolutions on top of 20261002120000", () => {
    const previous = "20261002120000_founder_test_reset_connection_inventory.sql";
    const before = new Set(deletedIn(resetBody(previous, "finalize_founder_test_reset")));
    const after = deletedIn(resetBody(FIX, "finalize_founder_test_reset"));
    expect(before.size).toBe(41);
    expect(new Set(after).size).toBe(42);
    expect(after.filter((table) => !before.has(table))).toEqual([TIE]);
    expect([...selectedTables(resetBody(FIX, "founder_test_reset_table_counts"), "count\\(\\*\\)")].sort())
      .toEqual([...new Set(after)].sort());
    expect([...selectedTables(resetBody(FIX, "founder_test_reset_rows_fingerprint"), "to_jsonb\\(x\\)::text")].sort())
      .toEqual([...new Set(after)].sort());
    for (const name of RESET) {
      const kept = resetBody(FIX, name).split("\n").filter((line) => !line.includes(TIE) && !/^\s*-- 20261002140000/.test(line));
      expect(kept.join("\n"), name).toBe(resetBody(previous, name));
    }
  });

  it("deletes the tie resolutions inside the reset session, ahead of the bindings, behind the reset fence", () => {
    const finalize = resetBody(FIX, "finalize_founder_test_reset");
    const at = (table: string) => finalize.indexOf(`delete from public.${table} where workspace_key=p_workspace_key;`);
    expect(at(TIE)).toBeGreaterThan(finalize.indexOf("set_config('tavonel.founder_reset_id'"));
    expect(at(TIE)).toBeLessThan(at("connector_document_bindings"));
    expect(read(FIX)).toContain(`create trigger founder_reset_fence before insert or update or delete on public.${TIE}\n`
      + "  for each row execute function public.guard_founder_test_reset_workspace_write();");
    expect(read(FIX)).not.toMatch(/function\s+public\.archive_founder_test_reset_evidence/i);
  });
});
