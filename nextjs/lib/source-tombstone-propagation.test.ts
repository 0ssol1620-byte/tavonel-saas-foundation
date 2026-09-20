import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "../supabase/migrations/20260920100000_source_tombstone_access_overlay.sql",
  "utf8",
);

describe("source tombstone serving overlay", () => {
  it("makes both logical-source and byte-version tombstones immediate access denials", () => {
    expect(migration).toMatch(/left join public\.source_versions sv\s+on sv\.source_version_id = b\.source_version_id/i);
    expect(migration).toMatch(/left join public\.sources s\s+on s\.source_id = b\.source_id/i);
    expect(migration).toMatch(/sv\.tombstoned is true/i);
    expect(migration).toMatch(/s\.tombstoned_at is not null/i);
  });

  it("preserves the existing suspension and connection-revocation denials", () => {
    expect(migration).toMatch(/public\.connector_source_suspensions/i);
    expect(migration).toMatch(/c\.status <> 'active'/i);
    expect(migration).toMatch(/c\.workspace_key <> b\.workspace_key/i);
    expect(migration).toMatch(/c\.provider <> b\.provider/i);
  });

  it("keeps the decision server-only and rejects malformed scopes", () => {
    expect(migration).toMatch(/CONNECTOR_AUTH_SCOPE_INVALID/);
    expect(migration).toMatch(/cardinality\(p_document_ids\) > 2000/i);
    expect(migration).toMatch(/revoke all on function public\.connector_documents_blocked\(text, text\[\]\)[\s\S]+public, anon, authenticated, service_role/i);
    expect(migration).toMatch(/grant execute on function public\.connector_documents_blocked\(text, text\[\]\)[\s\S]+to service_role/i);
  });
});
