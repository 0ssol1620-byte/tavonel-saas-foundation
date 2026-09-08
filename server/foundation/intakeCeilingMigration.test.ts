/**
 * The ceiling exists in four places, so the four have to agree.
 *
 * They did not. Migration 0048 raised the admission function's guard to 250 MiB and left the
 * column CHECK from 0008 at 5 MiB, so every upload between the two died on a raw constraint
 * violation the route reported as a bare 503 -- the published 250 MiB capability did not exist in
 * production at all. And the number 0048 wanted was never reachable anyway: the CDR worker reads
 * at most 5 MiB and the Cloud Run rasterizer at most 5 MiB and 80 pages, both in other trees, and
 * nothing in CI related any of them.
 *
 * The migration's own earlier test greps its SQL text, which is how a defect of exactly this shape
 * survived review: the text was right about itself and wrong about everything else. So this test
 * reads the *other* three sources -- the worker constant, the rasterizer constant, and the shared
 * module the route imports -- and asserts the SQL matches what they say. Executing the migration
 * is the F-1 lane's Postgres job; agreeing with reality is this one's.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROCESSING_CEILING, PROCESSING_CEILING_LIMITATIONS } from "../../shared/intakeCeiling";
import { CAPABILITY_MANIFEST } from "../../shared/capabilityManifest";

const root = join(import.meta.dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(join("supabase", "migrations", "0051_intake_ceiling_and_gate_evidence.sql"));

describe("intake ceiling", () => {
  it("is the smallest thing downstream will actually read", () => {
    const worker = read(join("quarantine-sidecar", "foundation-cdr-worker", "src", "keys.ts"));
    const rasterizer = read(join("quarantine-sidecar", "cdr-cloudrun", "app.py"));

    const workerMax = /MAX_SOURCE_BYTES = (\d+) \* 1024 \* 1024/.exec(worker)?.[1];
    const cdrMax = /MAX_INPUT_BYTES: Final = (\d+) \* 1024 \* 1024/.exec(rasterizer)?.[1];
    const cdrPages = /MAX_PAGES: Final = (\d+)/.exec(rasterizer)?.[1];
    expect(workerMax, "the worker no longer states a source ceiling").toBeDefined();
    expect(cdrMax, "the rasterizer no longer states an input ceiling").toBeDefined();
    expect(cdrPages, "the rasterizer no longer states a page ceiling").toBeDefined();

    expect(PROCESSING_CEILING.maxSourceBytes).toBe(
      Math.min(Number(workerMax) * 1024 * 1024, Number(cdrMax) * 1024 * 1024),
    );
    expect(PROCESSING_CEILING.maxSourcePages).toBe(Number(cdrPages));
  });

  it("is the same number the admission table and its function enforce", () => {
    const ceiling = String(PROCESSING_CEILING.maxSourceBytes);
    expect(migration).toContain(`check (requested_bytes between 1 and ${ceiling})`);
    expect(migration).toContain(`if p_requested_bytes > ${ceiling} then`);
    // The 0008 CHECK is dropped by name; leaving it in place is how 0048 broke production.
    expect(migration).toContain("drop constraint if exists foundation_intake_admissions_requested_bytes_check");
    // And the number 0048 guarded at is gone from the function this migration replaces.
    expect(migration).not.toContain("262144000");
  });

  it("is stated on the capability surface a customer reads before uploading", () => {
    expect(PROCESSING_CEILING_LIMITATIONS).toEqual([
      "at_most_5_mib_per_source",
      "at_most_80_pages_per_source",
    ]);
    const pdf = CAPABILITY_MANIFEST.entries.find((entry) => entry.mime === "application/pdf");
    for (const limitation of PROCESSING_CEILING_LIMITATIONS) {
      expect(pdf?.knownLimitations, "/sources does not disclose the live ceiling").toContain(limitation);
    }
    // Every tier that is accepted at upload meets the same processors, so every one says so.
    for (const entry of CAPABILITY_MANIFEST.entries) {
      if (entry.status === "UNSUPPORTED") continue;
      for (const limitation of PROCESSING_CEILING_LIMITATIONS) {
        expect(entry.knownLimitations, `${entry.mime} hides the processing ceiling`).toContain(limitation);
      }
    }
  });
});

describe("migration 0051", () => {
  it("gives the admitted object a digest and a terminal refusal", () => {
    expect(migration).toContain("add column if not exists source_sha256 text");
    expect(migration).toContain("foundation_intake_content_length_mismatch");
    expect(migration).toContain("foundation_intake_observed_mime_mismatch");
    expect(migration).toContain("foundation_intake_source_digest_conflict");
    expect(migration).toContain("create or replace function public.refuse_foundation_intake_admission");
    expect(migration).toContain("set state = 'rejected'");
  });

  it("replaces the confirm function rather than overloading it", () => {
    // Two candidates, one with a defaulted parameter, make a three-argument call ambiguous.
    expect(migration).toContain("drop function if exists public.confirm_foundation_intake_admission(text, uuid, uuid);");
    expect(migration).toContain("p_source_sha256 text default null");
  });

  it("ties a customer-data gate approval to the evidence it claims to rest on", () => {
    expect(migration).toContain("customer_data_gate_evidence_matches_count");
    expect(migration).toContain("jsonb_array_length(evidence) = 17");
    // All seventeen named, so seventeen copies of one precondition cannot pass the length check.
    const named = [...migration.matchAll(/@\.precondition == "([a-z_]+)"/g)].map(([, value]) => value);
    expect(new Set(named).size).toBe(17);
    expect(named).toContain("founder_approval_receipt_recorded");
  });

  it("keeps every write behind the service role", () => {
    expect(migration).toContain("revoke all on function public.refuse_foundation_intake_admission");
    expect(migration).toContain("grant execute on function public.refuse_foundation_intake_admission");
    expect(migration).toContain("revoke all on function public.confirm_foundation_intake_admission");
  });
});
