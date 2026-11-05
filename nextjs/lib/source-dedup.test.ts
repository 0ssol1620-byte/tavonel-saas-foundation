import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectExactDuplicatesAtIntake, sourceDedupMode } from "./source-dedup";

const { viewerAccess, alerted } = vi.hoisted(() => ({ viewerAccess: vi.fn(), alerted: vi.fn() }));
vi.mock("./connector-source-access", () => ({ checkConnectorSourceAccessForViewer: viewerAccess }));
vi.mock("./operations-p0", () => ({ deliverOperationsAlert: alerted }));

const WS = "pilot-b1b1b1b1b1b14b1b";
const A = "0a000000-0000-4000-8000-00000000000a";
const B = "0b000000-0000-4000-8000-00000000000b";
const D = "0d000000-0000-4000-8000-00000000000d";
const H = "0e000000-0000-4000-8000-00000000000e";
const VIEWER = "7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a";
const V = "a".repeat(64);
const STORE = { NEXT_PUBLIC_SUPABASE_URL: "https://store.example", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40) };
const input = (documentId: string, version = V, pageCount = 3) =>
  ({ documentId, versionKey: version, inputSha256: `sha256:${version}`, pageCount });

function answer(relations: unknown[], fingerprints = 1, newRelations = relations.length,
  sourceDigestReuseCandidateDocumentIds: string[] = [], sanitizedDigestReuseDocumentIds: string[] = []) {
  return new Response(JSON.stringify({ schemaVersion: "tavonel.source_fingerprints.v1", fingerprints, relations,
    newRelations, sourceDigestReuseCandidateDocumentIds, sanitizedDigestReuseDocumentIds }), { status: 200 });
}
const exact = (documentId: string, relatedDocumentId: string, matchedOn = ["sanitized_sha256", "source_sha256"]) =>
  ({ documentId, relatedDocumentId, kind: "exact_bytes", matchedOn });

let info: string[] = [];
let errors: string[] = [];
beforeEach(() => {
  info = [];
  errors = [];
  vi.spyOn(console, "info").mockImplementation((line: string) => { info.push(line); });
  vi.spyOn(console, "error").mockImplementation((line: string) => { errors.push(line); });
  viewerAccess.mockImplementation(async (_ws: string, ids: string[]) =>
    ids.includes(H) ? { ok: false, code: "CONNECTOR_SOURCE_ACCESS_DENIED" } : { ok: true });
  alerted.mockResolvedValue({ ok: true, code: "ALERT_DELIVERED", dedupeKey: "x" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  viewerAccess.mockReset();
  alerted.mockReset();
});
const parsed = (lines: string[]) => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("TAVONEL_SOURCE_DEDUP_MODE", () => {
  it("is off unless set to shadow or on, and an unknown value is off and reported as an error", () => {
    expect(sourceDedupMode({})).toBe("off");
    expect(sourceDedupMode({ TAVONEL_SOURCE_DEDUP_MODE: "off" })).toBe("off");
    expect(sourceDedupMode({ TAVONEL_SOURCE_DEDUP_MODE: "shadow" })).toBe("shadow");
    expect(sourceDedupMode({ TAVONEL_SOURCE_DEDUP_MODE: " on " })).toBe("on");
    expect(errors).toEqual([]);
    expect(sourceDedupMode({ TAVONEL_SOURCE_DEDUP_MODE: "true" })).toBe("off");
    expect(parsed(errors).map((line) => line.code)).toEqual(["TAVONEL_SOURCE_DEDUP_MODE_INVALID"]);
  });

  it("the earlier name is not read: TAVONEL_LIBRARY_DEDUP=on is off", () => {
    expect(sourceDedupMode({ TAVONEL_LIBRARY_DEDUP: "on" })).toBe("off");
  });

  it("off: the store is never called and nothing is returned", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE })).toBeNull();
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "off" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("exact-duplicate recording", () => {
  it("sends the workspace and each document's sanitized digest, and never a source digest", async () => {
    const fetcher = vi.fn(async () => answer([]));
    vi.stubGlobal("fetch", fetcher);
    await detectExactDuplicatesAtIntake(WS, [input(A.toUpperCase())], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "shadow" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://store.example/rest/v1/rpc/record_source_fingerprints");
    expect(JSON.parse(String(init.body))).toEqual({
      p_workspace_key: WS,
      p_fingerprints: [{ documentId: A, sourceVersionId: V, sanitizedSha256: `sha256:${V}` }],
    });
  });

  it("shadow: new pairs are counted, reuse is split into an unverified source-digest candidate and a sanitized-digest fact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, A), exact(D, A, ["source_sha256"])], 2, 2, [B, D], [B])));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B, V, 7), input(D, V, 4)],
      { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "shadow" }, VIEWER)).toBeNull();
    expect(parsed(info)).toEqual([{
      event: "duplicate_detected", kind: "exact", mode: "shadow", newPairs: 2,
      ocrReuseCandidateDocuments_cdrDeterminismNotVerified: 2, ocrReuseCandidatePages_cdrDeterminismNotVerified: 11,
      sanitizedDigestReuseDocuments: 1, sanitizedDigestReusePages: 7,
    }]);
    expect(info.join("")).not.toContain(B);
    expect(info.join("")).not.toContain(WS);
    expect(viewerAccess).not.toHaveBeenCalled();
  });

  it("shadow: a re-compile of a known pair adds nothing and logs nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, A)], 1, 0)));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "shadow" })).toBeNull();
    expect(info).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("on: names the copies the viewer may read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, D, ["source_sha256"]), exact(B, A)], 1)));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER)).toEqual([
      { documentId: B, kind: "exact", duplicateOfDocumentIds: [A, D] },
    ]);
    expect(viewerAccess.mock.calls.map(([ws, ids, viewer]) => [ws, ids, viewer]).sort())
      .toEqual([[WS, [A], VIEWER], [WS, [D], VIEWER]]);
  });

  it("on: a copy the viewer may not read (connector ACL, paused or deleted source) is never named", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, H), exact(B, A), exact(D, H)], 2)));
    const notes = await detectExactDuplicatesAtIntake(WS, [input(B), input(D)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER);
    expect(notes).toEqual([{ documentId: B, kind: "exact", duplicateOfDocumentIds: [A] }]);
    expect(JSON.stringify(notes)).not.toContain(H);
  });

  it("on: an access check that cannot answer hides the copy rather than naming it", async () => {
    viewerAccess.mockResolvedValue({ ok: false, code: "CONNECTOR_SOURCE_ACCESS_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, A)])));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER)).toEqual([]);
  });

  it("on: with no authenticated viewer nothing is named and no access check runs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, A)])));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" })).toEqual([]);
    expect(viewerAccess).not.toHaveBeenCalled();
  });

  it("on: a document with no copy gets no note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([])));
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER)).toEqual([]);
  });

  it("a changed source digest is an integrity fault: its own error event and an operations page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "source_fingerprint_conflict" }), { status: 400 })));
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "shadow" })).toBeNull();
    expect(parsed(errors)).toEqual([
      { event: "source_fingerprint_integrity_fault", kind: "exact", mode: "shadow", code: "SOURCE_FINGERPRINT_CONFLICT" },
    ]);
    expect(info).toEqual([]);
    expect(alerted).toHaveBeenCalledOnce();
    expect(alerted.mock.calls[0]![0]).toMatchObject({ kind: "incident", severity: "critical", service: "supabase" });
    expect(alerted.mock.calls[0]![0].summary).toContain(WS);
  });

  it("an alert receiver that fails does not break the compile path", async () => {
    alerted.mockRejectedValue(new Error("receiver down"));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "source_fingerprint_conflict" }), { status: 400 })));
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER)).toBeNull();
  });

  it.each([
    ["the store is unreachable", async () => { throw new TypeError("network"); }, "LIBRARY_DEDUP_STORE_UNREACHABLE"],
    ["the migration is absent", async () => new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }), "LIBRARY_DEDUP_MIGRATION_ABSENT"],
    ["the answer covers a document nobody asked about", async () => answer([exact(B, A)]), "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer claims a scored kind", async () => answer([{ ...exact(A, B), kind: "near_duplicate" }]), "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer counts the wrong number of fingerprints", async () => answer([], 2), "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer has no new-pair count", async () => new Response(JSON.stringify({
      schemaVersion: "tavonel.source_fingerprints.v1", fingerprints: 1, relations: [],
      sourceDigestReuseCandidateDocumentIds: [], sanitizedDigestReuseDocumentIds: [] }), { status: 200 }),
    "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer has no sanitized-digest reuse list", async () => new Response(JSON.stringify({
      schemaVersion: "tavonel.source_fingerprints.v1", fingerprints: 1, relations: [], newRelations: 0,
      sourceDigestReuseCandidateDocumentIds: [] }), { status: 200 }),
    "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer reports a reuse candidate for a document nobody asked about", async () => answer([], 1, 0, [B]), "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer reports a sanitized reuse for a document nobody asked about", async () => answer([], 1, 0, [], [B]), "LIBRARY_DEDUP_RESPONSE_INVALID"],
  ])("fails visibly as an error and changes nothing when %s", async (_name, fetcher, code) => {
    vi.stubGlobal("fetch", vi.fn(fetcher));
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_SOURCE_DEDUP_MODE: "on" }, VIEWER)).toBeNull();
    expect(parsed(errors)).toEqual([{ event: "duplicate_detection_failed", kind: "exact", mode: "on", code }]);
    expect(alerted).not.toHaveBeenCalled();
  });

  it("reports a missing store configuration instead of pretending to record", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { TAVONEL_SOURCE_DEDUP_MODE: "shadow" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(parsed(errors)[0]!.code).toBe("LIBRARY_DEDUP_STORE_NOT_CONFIGURED");
  });
});

describe("migrations 20261104090500 and 20261104091000", () => {
  const read = (name: string) => readFileSync(resolve(import.meta.dirname, `../../supabase/migrations/${name}`), "utf8").replace(/\r\n/g, "\n");
  const sql = read("20261104090500_source_fingerprints_exact_dedup.sql");
  const reset = read("20261104091000_founder_test_reset_source_fingerprints.sql");

  it("gives every new table RLS and a deny-all client policy, and the server only the RPC", () => {
    for (const table of ["source_fingerprints", "document_relations"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`create policy ${table}_no_client_access on public.${table}\n  as restrictive for all to anon, authenticated using (false) with check (false);`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated, service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${table}`));
    }
    expect(sql).toContain("grant execute on function public.record_source_fingerprints(text, jsonb) to service_role;");
  });

  it("matches only inside the caller's workspace, reads the source digest itself, and answers for the given versions", () => {
    const body = /function public\.record_source_fingerprints[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql)?.[1] ?? "";
    expect(body).toContain("where o.workspace_key = p_workspace_key");
    expect(body).toContain("from public.foundation_intake_admissions a\n     where a.workspace_key = p_workspace_key and a.document_id = v_document_id;");
    expect(body).not.toMatch(/v_item->>'(content|source)Sha256'/);
    expect(body).toContain("on c.document_id = r.document_id and c.source_version_id = r.source_version_id");
    expect(body).toContain("rf.fingerprint_version = 'exact:v1'");
  });

  it("the founder test reset counts, fingerprints, deletes and fences both tables", () => {
    for (const table of ["source_fingerprints", "document_relations"]) {
      expect(reset).toContain(`union all select '${table}',count(*) from public.${table} where workspace_key=p_workspace_key`);
      expect(reset).toContain(`union all select '${table}',to_jsonb(x)::text from public.${table} x where workspace_key=p_workspace_key`);
      expect(reset).toContain(`delete from public.${table} where workspace_key=p_workspace_key;`);
      expect(reset).toContain(`create trigger founder_reset_fence before insert or update or delete on public.${table}\n`);
    }
  });
});
