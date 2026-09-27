/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { customerDeletionReceipt, inventoryCustomerSource } from "./customer-source-lifecycle";

const OBJECTS = {
  "pilot-acme01": [
    { key: "immutable/pilot-acme01/doc-1/v1/sanitized.pdf", sizeBytes: 20 },
    { key: "quarantine/pilot-acme01/doc-1/source", sizeBytes: 10 },
  ],
} as Record<string, { key: string; sizeBytes: number }[]>;

const list = vi.fn(async (workspaceKey: string) =>
  ({ ok: true as const, objects: OBJECTS[workspaceKey] ?? [] }));
const readLegalHold = vi.fn(async (): Promise<any> => "inactive");
const run = (workspaceKey = "pilot-acme01") =>
  inventoryCustomerSource({ workspaceKey, documentId: "doc-1", list, readLegalHold });

beforeEach(() => vi.clearAllMocks());

describe("customer source inventory", () => {
  it("lists only the caller's workspace, so another tenant's document is not found", async () => {
    await expect(run("pilot-other9")).resolves.toEqual({ ok: false, code: "NOT_FOUND", status: 404 });
    expect(list.mock.calls.every(([workspace]) => workspace === "pilot-other9")).toBe(true);
    expect(readLegalHold).not.toHaveBeenCalled();
  });

  it("is executable only with a readable inactive hold, and names the hold otherwise", async () => {
    expect(await run()).toMatchObject({ ok: true, inventory: { totalBytes: 30,
      deletion: { executable: true, blockedBy: [] } } });
    readLegalHold.mockResolvedValueOnce("active");
    expect((await run() as any).inventory.deletion).toEqual({ executable: false, blockedBy: ["SOURCE_LEGAL_HOLD_ACTIVE"] });
    readLegalHold.mockRejectedValueOnce(new Error("policy store down"));
    expect((await run() as any).inventory).toMatchObject({ legalHoldState: "unknown",
      deletion: { executable: false, blockedBy: ["SOURCE_LEGAL_HOLD_STATE_UNKNOWN"] } });
  });

  it("refuses a partial or racing listing instead of describing half a source", async () => {
    list.mockResolvedValueOnce({ ok: false, code: "SOURCE_INVENTORY_LIST_FAILED" } as any);
    await expect(run()).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_LIST_FAILED", status: 503 });

    list.mockResolvedValueOnce({ ok: true, objects: OBJECTS["pilot-acme01"]! })
      .mockResolvedValueOnce({ ok: false, code: "SOURCE_INVENTORY_OBJECT_OUT_OF_SCOPE" } as any);
    await expect(run()).resolves.toMatchObject({ ok: false, code: "SOURCE_INVENTORY_OBJECT_OUT_OF_SCOPE" });

    list.mockResolvedValueOnce({ ok: true, objects: OBJECTS["pilot-acme01"]!.slice(1) });
    await expect(run()).resolves.toEqual({ ok: false, code: "SOURCE_INVENTORY_CHANGED_DURING_SCAN", status: 409 });
    expect(readLegalHold).not.toHaveBeenCalled();
  });

  it("is idempotent: the same stored bytes give the same manifest digest, bound to the tenant", async () => {
    const first = (await run() as any).inventory.manifestSha256;
    expect((await run() as any).inventory.manifestSha256).toBe(first);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
    OBJECTS["pilot-other9"] = OBJECTS["pilot-acme01"]!;
    expect((await run("pilot-other9") as any).inventory.manifestSha256).not.toBe(first);
    delete OBJECTS["pilot-other9"];
  });
});

describe("customer deletion receipt", () => {
  const sha = (c: string) => `sha256:${c.repeat(64)}`;
  const base = {
    deletionId: sha("d"), workspaceKey: "pilot-acme01", documentId: "0d000000-0000-4000-8000-000000000001",
    reason: "customer_requested" as const, requestedAt: "2026-09-27T00:00:00Z", eligibleAt: "2026-09-27T00:15:00Z",
    requestManifestSha256: sha("a"), tombstoneReceiptId: sha("r"), inventoryManifestSha256: null,
    artifactCount: null, attestedAt: null, objects: [],
  };
  const object = (key: string, done: boolean) => ({ objectKey: key, objectSha256: sha("1"),
    purgedAt: done ? `2026-09-27T01:0${key.length % 10}:00Z` : null, receiptId: done ? sha("2") : null,
    objectAlreadyAbsent: done ? false : null });

  it("attests only source-object purging after every object has a receipt", () => {
    expect(customerDeletionReceipt(base)).toMatchObject({ state: "scheduled", payload: { sourceObjectsPurgedAt: null } });
    const attested = { ...base, inventoryManifestSha256: sha("m"), artifactCount: 2, attestedAt: "2026-09-27T00:20:00Z" };
    expect(customerDeletionReceipt({ ...attested, objects: [object("a", true), object("bb", false)] }).state).toBe("purging");
    expect(customerDeletionReceipt({ ...attested, objects: [object("a", true)] }).state).toBe("purging");
    const done = customerDeletionReceipt({ ...attested, objects: [object("a", true), object("bb", true)] });
    expect(done).toMatchObject({ state: "source_objects_purged", payload: {
      schemaVersion: "tavonel.customer_source_deletion_receipt.v4",
      scope: "document_r2_objects_and_exclusive_retrieval_rows", derivedArtifactsRetained: true,
      objectsRetainedUnderStorageLock: 0, derivedClosure: null,
      sourceObjectsPurgedAt: "2026-09-27T01:02:00Z",
    } });
  });

  it("reports the derived closure with what it erased and what it kept, never full deletion", () => {
    const derived = { receiptId: sha("c"), closedAt: "2026-09-27T00:30:00Z", retrievalUnitsErased: 3,
      retrievalEmbeddingsErased: 1, expiredOperationCacheRowsErased: 1, retrievalUnitsRetainedUnproven: 1,
      worldVersionsRetained: 1, retrievalUnitsRemaining: 1, unexpected: "dropped" };
    const receipt = customerDeletionReceipt({ ...base, derived });
    expect(receipt.state).toBe("scheduled");
    expect(receipt.payload.derivedArtifactsRetained).toBe(true);
    expect(receipt.payload.derivedClosure).toEqual({ receiptId: sha("c"), closedAt: "2026-09-27T00:30:00Z",
      retrievalUnitsErased: 3, retrievalEmbeddingsErased: 1, expiredOperationCacheRowsErased: 1,
      retrievalUnitsRetainedUnproven: 1, worldVersionsRetained: 1, retrievalUnitsRemaining: 1 });
  });

  it("reports a storage-lock refusal as retained, never as purging or purged", () => {
    const attested = { ...base, inventoryManifestSha256: sha("m"), artifactCount: 2, attestedAt: "2026-09-27T00:20:00Z" };
    const locked = { ...object("bb", false), purgeFailureCount: 3,
      lastPurgeFailureCode: "SOURCE_DELETE_OBJECT_LOCKED", lastPurgeFailureAt: "2026-09-27T02:00:00Z" };
    const receipt = customerDeletionReceipt({ ...attested, objects: [object("a", true), locked] });
    expect(receipt).toMatchObject({ state: "purge_blocked_by_storage_lock", payload: {
      objectsRetainedUnderStorageLock: 1, derivedArtifactsRetained: true, sourceObjectsPurgedAt: null,
    } });
    expect(receipt.payload.objects[1]).toMatchObject({ receiptId: null, purgeFailureCount: 3,
      lastPurgeFailureCode: "SOURCE_DELETE_OBJECT_LOCKED" });

    const transient = { ...locked, lastPurgeFailureCode: "SOURCE_DELETE_FAILED" };
    expect(customerDeletionReceipt({ ...attested, objects: [object("a", true), transient] }).state).toBe("purging");
  });
});

describe("customer source deletion migration", () => {
  const sql = readFileSync("../supabase/migrations/20260927102000_customer_source_deletion.sql", "utf8");
  const fn = (name: string) => sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`))?.[0] ?? "";

  it("gives upload tombstones an explicit document and never a connector's shape", () => {
    expect(sql).toMatch(/reason = 'customer_requested'[\s\S]+document_id is not null and source_id = document_id::text[\s\S]+requested_by_user_id is not null/);
    expect(fn("source_deletion_document_ids")).toMatch(/when t\.document_id is not null then array\[t\.document_id\]/);
    for (const name of ["source_deletion_inventory_candidate", "attest_source_deletion_inventory"]) {
      expect(fn(name)).toMatch(/v_document_ids := public\.source_deletion_document_ids\(v_tombstone\.deletion_id\)/);
      expect(fn(name)).not.toMatch(/from public\.connector_document_bindings b/);
    }
    expect(fn("attest_source_deletion_inventory")).toMatch(/SOURCE_DELETION_INVENTORY_EMPTY/);
  });

  it("preserves connector ACL admission when extending the shared serving deny", () => {
    expect(fn("connector_documents_blocked")).toMatch(/public\.source_version_acl_admits\(b\.workspace_key, b\.source_version_id, b\.provider, '\[\]'::jsonb\)/);
    expect(fn("connector_documents_blocked")).toMatch(/source_deletion_tombstones t/);
  });

  it("serializes enterprise hold scope changes with object deletion", () => {
    const guard = fn("guard_enterprise_workspace_source_hold_transition");
    expect(guard).toMatch(/tavonel\.source_legal_hold\.v1/);
    expect(guard).toMatch(/SOURCE_DELETION_IN_PROGRESS/);
    expect(guard).toMatch(/source_legal_hold_state\(v_workspace_key\)[\s\S]+SOURCE_LEGAL_HOLD_ACTIVE_OR_UNKNOWN/);
    expect(guard).toMatch(/old\.workspace_key is distinct from new\.workspace_key[\s\S]+ENTERPRISE_WORKSPACE_KEY_IMMUTABLE/);
    expect(sql).toMatch(/before insert or update or delete on public\.enterprise_workspaces/);
  });

  it("does not replay superseded inventory definitions after the upload migration", () => {
    const rehearsal = readFileSync("../.github/workflows/db-rehearsal.yml", "utf8");
    const replay = rehearsal.split("- name: Apply the repair migrations a second time and re-run the suite")[1] ?? "";
    expect(replay).not.toMatch(/supabase\/migrations\/20260921110000_\*\.sql/);
    expect(replay).not.toMatch(/supabase\/migrations\/20260921120000_\*\.sql/);
    expect(replay).not.toMatch(/supabase\/migrations\/005\[2345\]_\*\.sql/);
    expect(replay).toContain("supabase/migrations/005[245]_*.sql");
  });

  it("re-checks membership, ownership and legal hold under the hold lock before writing", () => {
    const request = fn("request_customer_source_deletion");
    expect(request.indexOf("lock_upload_source_deletion")).toBeLessThan(request.indexOf("foundation_workspace_members"));
    expect(request).toMatch(/m\.role in \('owner', 'admin'\)/);
    expect(request).toMatch(/foundation_intake_admissions\s+where workspace_key = p_workspace_key and document_id = p_document_id/);
    expect(request).toMatch(/SOURCE_LEGAL_HOLD_ACTIVE[\s\S]+SOURCE_LEGAL_HOLD_STATE_UNKNOWN/);
    expect(request).toMatch(/CUSTOMER_SOURCE_CONNECTOR_BOUND/);
    expect(request).toMatch(/v_admission\.expires_at \+ interval '15 minutes'/);
    expect(fn("lock_upload_source_deletion")).toMatch(/tavonel\.source_deletion\.v1[\s\S]+foundation-intake:[\s\S]+tavonel\.source_legal_hold\.v1/);
  });

  it("refuses to re-admit a deleted upload and keeps the unchecked RPCs off every API role", () => {
    for (const name of ["reserve_foundation_intake_admission", "confirm_foundation_intake_admission"]) {
      expect(sql).toMatch(new RegExp(`alter function public\\.${name}\\([^)]*\\)\\s+rename to ${name}_unchecked`));
      expect(fn(name)).toMatch(/foundation-intake:[\s\S]+source_deletion_tombstones[\s\S]+foundation_intake_source_deleted/);
    }
    expect(sql).toMatch(/revoke all on function public\.reserve_foundation_intake_admission_unchecked[\s\S]+from public, anon, authenticated, service_role;/);
  });

  it("tombstones only the exact reviewed retention candidate", () => {
    const exact = fn("request_retention_expired_source_deletion_exact");
    expect(exact).toMatch(/lock_upload_source_deletion\(p_workspace_key, p_document_id\)/);
    expect(exact).toMatch(/document_id = p_document_id[\s\S]+created_at = p_expected_created_at[\s\S]+retention_days = p_expected_retention_days[\s\S]+deleted_object_grace_days = p_expected_grace_days/);
    expect(exact).toMatch(/if not found then return pg_catalog\.jsonb_build_object\('status', 'changed'\)/);
    expect(sql).toMatch(/revoke all on function public\.request_retention_expired_source_deletion\(text\) from service_role/);
  });
});

describe("source deletion purge failure migration", () => {
  const sql = readFileSync("../supabase/migrations/20260927103000_source_deletion_purge_failures.sql", "utf8");
  const fn = (name: string) => sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`))?.[0] ?? "";

  it("binds each purge failure to one attested object and the claim that attempted it", () => {
    expect(sql).toMatch(/check \(\(stage = 'inventory' and object_key is null\) or \(stage = 'purge' and object_key is not null\)\)/);
    expect(sql).toMatch(/foreign key \(deletion_id, object_key\) references public\.source_deletion_objects\(deletion_id, object_key\)/);
    const record = fn("record_source_deletion_purge_failure");
    expect(record.indexOf("pg_advisory_xact_lock")).toBeLessThan(record.indexOf("for update"));
    expect(record).toMatch(/purged_at is not null then raise exception 'SOURCE_DELETION_ALREADY_PURGED'/);
    expect(record).toMatch(/purge_claim_id is distinct from p_claim_id then raise exception 'SOURCE_DELETION_LEASE_INVALID'/);
    // Evidence only: it must never touch the object row, the claim, or a receipt.
    expect(record).not.toMatch(/update public\.|delete from|source_deletion_receipts/);
  });

  it("reports failures only for objects still waiting for their receipt and stays service-only", () => {
    const status = fn("customer_source_deletion_status");
    expect(status).toMatch(/'lastPurgeFailureCode', case when r\.receipt_id is null then f\.last_code end/);
    expect(status).toMatch(/w\.stage = 'purge' and w\.object_key = o\.object_key/);
    expect(sql).toMatch(/record_source_deletion_purge_failure\(text, text, uuid, text\),[\s\S]+from public, anon, authenticated;/);
    expect(sql).not.toMatch(/grant [^;]+ to (anon|authenticated)/);
  });
});

describe("source deletion derived closure migration", () => {
  const sql = readFileSync("../supabase/migrations/20260927104000_source_deletion_derived_closure.sql", "utf8");
  const fn = (name: string) => sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]+?\\n\\$\\$;`))?.[0] ?? "";
  const close = fn("close_source_deletion_derived");

  it("erases only single-chunk retrieval units and expired cache rows", () => {
    expect(fn("source_deletion_exclusive_unit_types")).toMatch(/array\['section', 'claim', 'entity'\]/);
    const deletes = close.match(/delete from public\.\w+/g);
    expect(deletes).toEqual(["delete from public.foundation_retrieval_units", "delete from public.foundation_operation_leases"]);
    expect(close).toMatch(/u\.unit_type = any\(public\.source_deletion_exclusive_unit_types\(\)\);\s+get diagnostics v_units/);
    expect(close).toMatch(/l\.expires_at <= pg_catalog\.clock_timestamp\(\)/);
    // World, compile and provenance rows are never touched.
    expect(close).not.toMatch(/(delete from|update) public\.(foundation_world|foundation_active_worlds|foundation_retrieval_compile_runs|source_deletion_objects)/);
  });

  it("runs only after eligibility and attestation, outside a retrieval compile, under an inactive hold", () => {
    expect(close).toMatch(/t\.eligible_at <= pg_catalog\.clock_timestamp\(\)[\s\S]+source_deletion_inventory_attestations[\s\S]+source_legal_hold_state\(t\.workspace_key\) = 'inactive'/);
    expect(close).toMatch(/status in \('pending', 'running'\)/);
    const lock = close.indexOf("tavonel.source_legal_hold.v1");
    expect(lock).toBeGreaterThan(close.indexOf("hashtextextended(v_tombstone.deletion_id, 0)"));
    expect(close.indexOf("<> 'inactive'", lock)).toBeLessThan(close.indexOf("delete from"));
  });

  it("records one append-only receipt and keeps the closure off browser roles", () => {
    expect(sql).toMatch(/source_deletion_receipts_derived_once_idx\s+on public\.source_deletion_receipts \(deletion_id\) where action = 'derived_purged'/);
    expect(close).toMatch(/insert into public\.source_deletion_receipts[\s\S]+'derived_purged'/);
    expect(fn("customer_source_deletion_status")).toMatch(/'retrievalUnitsRemaining', \(select pg_catalog\.count/);
    expect(sql).not.toMatch(/grant [^;]+ to (anon|authenticated)/);
  });
});
