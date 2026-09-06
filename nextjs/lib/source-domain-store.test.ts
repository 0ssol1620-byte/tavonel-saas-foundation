import { afterEach, describe, expect, it, vi } from "vitest";
import {
  projectSourceLedger,
  readSourceVersion,
  recordSourceLedger,
  representationIdFor,
  representationKindForImmutableKey,
  sourceVersionIdFor,
  type RepresentationObservation,
  type SourceVersionObservation,
} from "./source-domain-store";

const WORKSPACE = "pilot-1234567890abcdef";
const DOCUMENT = "59d42924-a3cc-4a09-b92d-9c86b58901a1";
/** The bytes the customer uploaded. */
const UPLOADED = "a".repeat(64);
/** The CDR output, which is also the version key in the immutable layout. */
const SANITIZED = "b".repeat(64);
const OCR_DIGEST = `sha256:${"c".repeat(64)}`;
const OCR_RELEASE = `sha256:${"d".repeat(64)}`;
const QUARANTINE_KEY = `quarantine/${WORKSPACE}/${DOCUMENT}/source`;
const PREFIX = `immutable/${WORKSPACE}/${WORKSPACE}/${DOCUMENT}/${SANITIZED}`;

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://source-domain-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = `sb_secret_${"x".repeat(40)}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

/** Today's chain, as the pipeline actually produces it: upload -> CDR -> OCR. */
const observation: SourceVersionObservation = {
  workspaceId: WORKSPACE,
  documentId: DOCUMENT,
  declaredMimeType: "application/pdf",
  immutableObjectKey: QUARANTINE_KEY,
  contentSha256: `sha256:${UPLOADED}`,
  byteLength: 40_960,
  mimeType: "application/pdf",
  createdAt: "2026-09-06T00:00:00Z",
  observedAt: "2026-09-06T00:00:01Z",
};

const original: RepresentationObservation = {
  kind: "original",
  objectKey: QUARANTINE_KEY,
  contentSha256: `sha256:${UPLOADED}`,
  providerId: "foundation_r2_intake_v1",
  providerRevision: "0048_intake_size_and_experience_contract",
  lossy: false,
  derivedFromKind: null,
  createdAt: "2026-09-06T00:00:01Z",
};

const normalized: RepresentationObservation = {
  kind: "normalized",
  objectKey: `${PREFIX}/sanitized.pdf`,
  contentSha256: `sha256:${SANITIZED}`,
  providerId: "cdr_sanitizer_v1",
  providerRevision: "cdr-2026-08-29",
  lossy: true,
  derivedFromKind: "original",
  createdAt: "2026-09-06T00:00:02Z",
};

const ocr: RepresentationObservation = {
  kind: "ocr",
  objectKey: `${PREFIX}/ocr.json`,
  contentSha256: OCR_DIGEST,
  providerId: "foundation_ocr_gpu_v1",
  providerRevision: OCR_RELEASE,
  lossy: true,
  derivedFromKind: "normalized",
  createdAt: "2026-09-06T00:00:03Z",
};

const CHAIN = [original, normalized, ocr];

describe("source ledger projection", () => {
  it("derives the same identifiers for the same observation, whatever order it arrives in", () => {
    const first = projectSourceLedger(observation, CHAIN);
    const second = projectSourceLedger(observation, [ocr, normalized, original]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.ledger).toEqual(second.ledger);
    expect(first.ledger.version.sourceVersionId).toBe(`${DOCUMENT}:${UPLOADED}`);
    expect(sourceVersionIdFor(DOCUMENT, `sha256:${UPLOADED}`)).toBe(`${DOCUMENT}:${UPLOADED}`);
    expect(first.ledger.source.sourceFamily).toBe("document");
  });

  it("orders parents before children and binds each child to its parent's id", () => {
    const projected = projectSourceLedger(observation, [ocr, normalized, original]);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const [one, two, three] = projected.ledger.representations;
    expect([one?.kind, two?.kind, three?.kind]).toEqual(["original", "normalized", "ocr"]);
    expect(two?.derivedFrom).toEqual([one?.representationId]);
    expect(three?.derivedFrom).toEqual([two?.representationId]);
    expect(one?.representationId).toBe(
      representationIdFor(`${DOCUMENT}:${UPLOADED}`, "original", QUARANTINE_KEY),
    );
    // The original keeps the uploaded bytes' digest; the sanitized PDF is a derived artifact.
    expect(one?.contentSha256).toBe(`sha256:${UPLOADED}`);
    expect(two?.contentSha256).toBe(`sha256:${SANITIZED}`);
  });

  it("classifies the two representation kinds the live key layout carries, and nothing else", () => {
    expect(representationKindForImmutableKey(WORKSPACE, `${PREFIX}/sanitized.pdf`)).toBe("normalized");
    expect(representationKindForImmutableKey(WORKSPACE, `${PREFIX}/ocr.json`)).toBe("ocr");
    expect(representationKindForImmutableKey(WORKSPACE, `${PREFIX}/cdr-receipt.json`)).toBeNull();
    expect(representationKindForImmutableKey(WORKSPACE, `immutable/other/other/${DOCUMENT}/x/ocr.json`)).toBeNull();
  });

  it("refuses a chain whose parent is not in the same observation", () => {
    expect(projectSourceLedger(observation, [normalized, ocr]))
      .toMatchObject({ ok: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("refuses two representations claiming the same role", () => {
    expect(projectSourceLedger(observation, [original, { ...original, objectKey: `${PREFIX}/other.pdf` }]))
      .toMatchObject({ ok: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("refuses an object key outside the workspace, in either position", () => {
    expect(projectSourceLedger({ ...observation, immutableObjectKey: "quarantine/other/x/source" }, []))
      .toMatchObject({ ok: false, code: "REPRESENTATION_OBJECT_KEY_OUT_OF_SCOPE" });
    expect(projectSourceLedger(observation, [{ ...original, objectKey: "immutable/other/other/x/y/sanitized.pdf" }]))
      .toMatchObject({ ok: false, code: "REPRESENTATION_OBJECT_KEY_OUT_OF_SCOPE" });
  });

  it("refuses an original whose digest is not the version's own bytes", () => {
    expect(projectSourceLedger(observation, [{ ...original, contentSha256: `sha256:${SANITIZED}` }]))
      .toMatchObject({ ok: false, code: "SOURCE_VERSION_DIGEST_CONFLICT" });
  });

  it("refuses an unrecorded provider revision rather than defaulting one", () => {
    expect(projectSourceLedger(observation, [{ ...original, providerRevision: "" }]))
      .toMatchObject({ ok: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("refuses two artifacts that derive from each other", () => {
    // Both parents resolve inside the observation, so neither one-hop check fires; the chain still
    // reaches no bytes. Projecting it would emit a lineage row before the row it points at.
    expect(projectSourceLedger(observation, [
      { ...normalized, derivedFromKind: "ocr" },
      { ...ocr, derivedFromKind: "normalized" },
    ])).toMatchObject({ ok: false, code: "REPRESENTATION_LINEAGE_BROKEN" });
  });

  it("emits a parent before its child whatever the kinds are", () => {
    // ocr -> visual is the reverse of the usual chain, and the order follows the chain, not a list
    // of kinds: the database refuses a lineage row that names a row not yet inserted.
    const visual: RepresentationObservation = {
      ...ocr,
      kind: "visual",
      objectKey: `${PREFIX}/ocr.json`,
      derivedFromKind: "ocr",
    };
    const scanned: RepresentationObservation = { ...ocr, derivedFromKind: "original" };
    const projected = projectSourceLedger(observation, [visual, scanned, original]);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.ledger.representations.map((item) => item.kind)).toEqual(["original", "ocr", "visual"]);
  });
});

describe("source ledger store", () => {
  function ledger() {
    const projected = projectSourceLedger(observation, CHAIN);
    if (!projected.ok) throw new Error(projected.code);
    return projected.ledger;
  }

  it("fails closed when the store is not configured", async () => {
    expect(await readSourceVersion("x")).toMatchObject({ ok: false, code: "SOURCE_DOMAIN_STORE_NOT_CONFIGURED" });
    expect(await recordSourceLedger(ledger()))
      .toMatchObject({ ok: false, code: "SOURCE_DOMAIN_STORE_NOT_CONFIGURED" });
  });

  it("writes source, version and representations parent-first, and never merges a duplicate", async () => {
    configure();
    const posted: Array<{ table: string; prefer: string | null; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method !== "POST") return Response.json([]);
      const body = JSON.parse(String(init.body)) as unknown;
      posted.push({
        table: url.split("/rest/v1/")[1]?.split("?")[0] ?? "",
        prefer: new Headers(init.headers).get("Prefer"),
        body,
      });
      // PostgREST with `return=representation` answers with the rows it actually inserted.
      return Response.json(body, { status: 201 });
    }));

    expect(await recordSourceLedger(ledger())).toEqual({ ok: true, value: "recorded" });
    expect(posted.map((item) => item.table)).toEqual([
      "sources",
      "source_versions",
      "source_representations",
      "source_representations",
      "source_representations",
    ]);
    for (const item of posted) expect(item.prefer).toContain("resolution=ignore-duplicates");
    expect(posted.some((item) => item.prefer?.includes("merge-duplicates"))).toBe(false);
    expect(posted.slice(2).map((item) => (item.body as Array<{ kind: string }>)[0]!.kind))
      .toEqual(["original", "normalized", "ocr"]);
  });

  it("refuses a second digest for a source version that is already stored, and writes nothing", async () => {
    configure();
    const writes: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(String(input));
        return new Response(null, { status: 201 });
      }
      return Response.json([{
        source_version_id: `${DOCUMENT}:${UPLOADED}`,
        source_id: DOCUMENT,
        immutable_object_key: QUARANTINE_KEY,
        content_sha256: `sha256:${"9".repeat(64)}`,
        byte_length: 40_960,
        mime_type: "application/pdf",
        observed_at: "2026-09-05T00:00:00Z",
        parent_version_id: null,
        tombstoned: false,
        security_classification: null,
      }]);
    }));

    expect(await recordSourceLedger(ledger()))
      .toMatchObject({ ok: false, code: "SOURCE_VERSION_DIGEST_CONFLICT" });
    expect(writes).toEqual([]);
  });

  it("never records a tombstoned source", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    const tombstoned = ledger();
    tombstoned.source.tombstonedAt = "2026-09-06T02:00:00Z";
    expect(await recordSourceLedger(tombstoned)).toMatchObject({ ok: false, code: "SOURCE_TOMBSTONED" });
  });

  it("reports a failed write rather than a partial success", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== "POST") return Response.json([]);
      if (String(input).includes("source_representations")) return new Response(null, { status: 500 });
      return Response.json(JSON.parse(String(init.body)) as unknown, { status: 201 });
    }));
    expect(await recordSourceLedger(ledger()))
      .toMatchObject({ ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED" });
  });

  /**
   * The duplicate-ignoring write is a no-op with a 201, so "the row was kept" and "the row I sent
   * was stored" are different statements. These three assert the second one is the one answered.
   */
  it("refuses a derived artifact already stored under a different digest, and never reports it recorded", async () => {
    configure();
    const requests: string[] = [];
    const scanned = ledger().representations[2]!;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const table = url.split("/rest/v1/")[1]?.split("?")[0] ?? "";
      requests.push(`${init?.method ?? "GET"} ${table}`);
      if (init?.method === "POST") {
        // The OCR key is taken by a row this caller cannot see; PostgREST keeps it and inserts none.
        const rows = JSON.parse(String(init.body)) as Array<{ kind?: string }>;
        return Response.json(rows[0]?.kind === "ocr" ? [] : rows, { status: 201 });
      }
      if (table === "source_representations") {
        return Response.json([{
          representation_id: scanned.representationId,
          source_version_id: scanned.sourceVersionId,
          kind: "ocr",
          provider_id: scanned.providerId,
          provider_revision: scanned.providerRevision,
          content_sha256: `sha256:${"e".repeat(64)}`,
          object_key: scanned.objectKey,
          lossy: true,
          derived_from: scanned.derivedFrom,
          created_at: "2026-09-06T00:00:03+00:00",
        }]);
      }
      return Response.json([]);
    }));

    expect(await recordSourceLedger(ledger())).toMatchObject({
      ok: false,
      code: "SOURCE_DOMAIN_STORE_CONFLICT",
      detail: expect.stringContaining("source_representations.content_sha256"),
    });
    // The stored row was read back; the answer is not derived from the status code alone.
    expect(requests).toContain("GET source_representations");
  });

  it("refuses a source id already stored for another tenant, and writes no version", async () => {
    configure();
    const requests: string[] = [];
    const source = ledger().source;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const table = String(input).split("/rest/v1/")[1]?.split("?")[0] ?? "";
      requests.push(`${init?.method ?? "GET"} ${table}`);
      if (init?.method === "POST") return Response.json([], { status: 201 });
      if (table === "sources") {
        return Response.json([{
          source_id: source.sourceId,
          tenant_id: "pilot-otherotherotherot",
          workspace_id: source.workspaceId,
          origin_kind: "upload",
          origin_provider: null,
          canonical_uri: null,
          source_family: "document",
          created_at: source.createdAt,
          tombstoned_at: null,
          tombstone_reason: null,
        }]);
      }
      return Response.json([]);
    }));

    expect(await recordSourceLedger(ledger())).toMatchObject({
      ok: false,
      code: "SOURCE_DOMAIN_STORE_CONFLICT",
      detail: expect.stringContaining("sources.tenant_id"),
    });
    expect(requests).not.toContain("POST source_versions");
  });

  it("records a redelivery whose stored rows agree, timestamp spelling included", async () => {
    configure();
    const stored = ledger();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const table = String(input).split("/rest/v1/")[1]?.split("?")[0] ?? "";
      // Every row is already there: nothing is inserted anywhere.
      if (init?.method === "POST") return Response.json([], { status: 201 });
      if (table === "sources") {
        return Response.json([{
          source_id: stored.source.sourceId,
          tenant_id: stored.source.tenantId,
          workspace_id: stored.source.workspaceId,
          origin_kind: "upload",
          origin_provider: null,
          canonical_uri: null,
          source_family: "document",
          // PostgREST returns a timestamptz normalised; the same instant, spelled differently.
          created_at: "2026-09-06T00:00:00+00:00",
          tombstoned_at: null,
          tombstone_reason: null,
        }]);
      }
      if (table === "source_versions") {
        return Response.json([{
          source_version_id: stored.version.sourceVersionId,
          source_id: stored.version.sourceId,
          immutable_object_key: stored.version.immutableObjectKey,
          content_sha256: stored.version.contentSha256,
          byte_length: stored.version.byteLength,
          mime_type: stored.version.mimeType,
          source_modified_at: null,
          observed_at: "2026-09-06T00:00:01+00:00",
          parent_version_id: null,
          tombstoned: false,
          security_classification: null,
        }]);
      }
      const rows = stored.representations.map((item) => ({
        representation_id: item.representationId,
        source_version_id: item.sourceVersionId,
        kind: item.kind,
        provider_id: item.providerId,
        provider_revision: item.providerRevision,
        content_sha256: item.contentSha256,
        object_key: item.objectKey,
        lossy: item.lossy,
        derived_from: item.derivedFrom,
        created_at: item.createdAt.replace("Z", "+00:00"),
      }));
      const wanted = String(input).split("representation_id=eq.")[1]?.split("&")[0] ?? "";
      return Response.json(rows.filter((row) => row.representation_id === decodeURIComponent(wanted)));
    }));

    expect(await recordSourceLedger(ledger())).toEqual({ ok: true, value: "recorded" });
  });

  it("reports a read failure rather than treating it as an absent row", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    expect(await readSourceVersion(`${DOCUMENT}:${UPLOADED}`))
      .toMatchObject({ ok: false, code: "SOURCE_DOMAIN_STORE_READ_FAILED" });
    expect(await recordSourceLedger(ledger()))
      .toMatchObject({ ok: false, code: "SOURCE_DOMAIN_STORE_READ_FAILED" });
  });

  it("reads a stored version back into the frozen shape", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{
      source_version_id: `${DOCUMENT}:${UPLOADED}`,
      source_id: DOCUMENT,
      immutable_object_key: QUARANTINE_KEY,
      content_sha256: `sha256:${UPLOADED}`,
      byte_length: 40_960,
      mime_type: "application/pdf",
      observed_at: "2026-09-06T00:00:01Z",
      parent_version_id: null,
      tombstoned: false,
      security_classification: null,
    }])));
    const stored = await readSourceVersion(`${DOCUMENT}:${UPLOADED}`);
    expect(stored).toMatchObject({ ok: true });
    if (!stored.ok) return;
    expect(stored.value?.parentVersionId).toBeUndefined();
    expect(stored.value?.contentSha256).toBe(`sha256:${UPLOADED}`);
  });
});
