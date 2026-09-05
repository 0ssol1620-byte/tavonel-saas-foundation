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
      posted.push({
        table: url.split("/rest/v1/")[1]?.split("?")[0] ?? "",
        prefer: new Headers(init.headers).get("Prefer"),
        body: JSON.parse(String(init.body)) as unknown,
      });
      return new Response(null, { status: 201 });
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
      return new Response(null, { status: 201 });
    }));
    expect(await recordSourceLedger(ledger()))
      .toMatchObject({ ok: false, code: "SOURCE_DOMAIN_STORE_WRITE_FAILED" });
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
