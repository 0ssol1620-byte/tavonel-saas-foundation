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
      schemaVersion: "tavonel.customer_source_deletion_receipt.v2",
      scope: "document_r2_objects_only", derivedArtifactsRetained: true,
      sourceObjectsPurgedAt: "2026-09-27T01:02:00Z",
    } });
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
});
