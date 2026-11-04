import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectExactDuplicatesAtIntake, sourceDedupMode } from "./source-dedup";

const WS = "pilot-b1b1b1b1b1b14b1b";
const A = "0a000000-0000-4000-8000-00000000000a";
const B = "0b000000-0000-4000-8000-00000000000b";
const V = "a".repeat(64);
const STORE = { NEXT_PUBLIC_SUPABASE_URL: "https://store.example", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40) };
const input = (documentId: string, version = V) => ({ documentId, versionKey: version, inputSha256: `sha256:${version}` });

function answer(relations: unknown[], fingerprints = 1) {
  return new Response(JSON.stringify({ schemaVersion: "tavonel.source_fingerprints.v1", fingerprints, relations }), { status: 200 });
}
const exact = (documentId: string, relatedDocumentId: string, matchedOn = ["sanitized_sha256", "source_sha256"]) =>
  ({ documentId, relatedDocumentId, kind: "exact_bytes", matchedOn });

let lines: string[] = [];
function capture() {
  lines = [];
  vi.spyOn(console, "info").mockImplementation((line: string) => { lines.push(line); });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TAVONEL_LIBRARY_DEDUP", () => {
  it("is off unless set to shadow or on, and an unknown value is off and reported", () => {
    capture();
    expect(sourceDedupMode({})).toBe("off");
    expect(sourceDedupMode({ TAVONEL_LIBRARY_DEDUP: "off" })).toBe("off");
    expect(sourceDedupMode({ TAVONEL_LIBRARY_DEDUP: "shadow" })).toBe("shadow");
    expect(sourceDedupMode({ TAVONEL_LIBRARY_DEDUP: " on " })).toBe("on");
    expect(lines).toEqual([]);
    expect(sourceDedupMode({ TAVONEL_LIBRARY_DEDUP: "true" })).toBe("off");
    expect(lines.map((line) => JSON.parse(line).code)).toEqual(["TAVONEL_LIBRARY_DEDUP_INVALID"]);
  });

  it("off: the store is never called and nothing is returned", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE })).toBeNull();
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_LIBRARY_DEDUP: "off" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("exact-duplicate recording", () => {
  it("sends the workspace and each document's sanitized digest, and never a source digest", async () => {
    const fetcher = vi.fn(async () => answer([]));
    vi.stubGlobal("fetch", fetcher);
    await detectExactDuplicatesAtIntake(WS, [input(A.toUpperCase())], { ...STORE, TAVONEL_LIBRARY_DEDUP: "shadow" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://store.example/rest/v1/rpc/record_source_fingerprints");
    expect(JSON.parse(String(init.body))).toEqual({
      p_workspace_key: WS,
      p_fingerprints: [{ documentId: A, sourceVersionId: V, sanitizedSha256: `sha256:${V}` }],
    });
  });

  it("shadow: identical bytes are counted on the internal log and not shown to the workspace", async () => {
    capture();
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, A)])));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B)], { ...STORE, TAVONEL_LIBRARY_DEDUP: "shadow" })).toBeNull();
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "duplicate_detected", kind: "exact", mode: "shadow", documents: 1, relations: 1 },
    ]);
    expect(lines.join("")).not.toContain(B);
    expect(lines.join("")).not.toContain(WS);
  });

  it("on: the workspace is told which documents a source is an exact copy of", async () => {
    capture();
    const D = "0d000000-0000-4000-8000-00000000000d";
    vi.stubGlobal("fetch", vi.fn(async () => answer([exact(B, D, ["source_sha256"]), exact(B, A)], 1)));
    expect(await detectExactDuplicatesAtIntake(WS, [input(B)], { ...STORE, TAVONEL_LIBRARY_DEDUP: "on" })).toEqual([
      { documentId: B, kind: "exact", duplicateOfDocumentIds: [A, D] },
    ]);
  });

  it("on: a document with no copy gets no note", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer([])));
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_LIBRARY_DEDUP: "on" })).toEqual([]);
  });

  it.each([
    ["the store is unreachable", async () => { throw new TypeError("network"); }, "LIBRARY_DEDUP_STORE_UNREACHABLE"],
    ["the migration is absent", async () => new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 }), "LIBRARY_DEDUP_MIGRATION_ABSENT"],
    ["a recorded digest changed", async () => new Response(JSON.stringify({ message: "source_fingerprint_conflict" }), { status: 400 }), "SOURCE_FINGERPRINT_CONFLICT"],
    ["the answer covers a document nobody asked about", async () => answer([exact(B, A)]), "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer claims a scored kind", async () => answer([{ ...exact(A, B), kind: "near_duplicate" }]), "LIBRARY_DEDUP_RESPONSE_INVALID"],
    ["the answer counts the wrong number of fingerprints", async () => answer([], 2), "LIBRARY_DEDUP_RESPONSE_INVALID"],
  ])("fails visibly and changes nothing when %s", async (_name, fetcher, code) => {
    capture();
    vi.stubGlobal("fetch", vi.fn(fetcher));
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { ...STORE, TAVONEL_LIBRARY_DEDUP: "on" })).toBeNull();
    expect(lines.map((line) => JSON.parse(line))).toEqual([{ event: "duplicate_detection_failed", kind: "exact", mode: "on", code }]);
  });

  it("reports a missing store configuration instead of pretending to record", async () => {
    capture();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(await detectExactDuplicatesAtIntake(WS, [input(A)], { TAVONEL_LIBRARY_DEDUP: "shadow" })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(lines[0]!).code).toBe("LIBRARY_DEDUP_STORE_NOT_CONFIGURED");
  });
});

describe("migration 20261104120000", () => {
  const sql = readFileSync(resolve(import.meta.dirname, "../../supabase/migrations/20261104120000_source_fingerprints_exact_dedup.sql"), "utf8").replace(/\r\n/g, "\n");

  it("gives every new table RLS and a deny-all client policy, and the server only the RPC", () => {
    for (const table of ["source_fingerprints", "document_relations"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security;`);
      expect(sql).toContain(`create policy ${table}_no_client_access on public.${table}\n  as restrictive for all to anon, authenticated using (false) with check (false);`);
      expect(sql).toContain(`revoke all on public.${table} from public, anon, authenticated, service_role;`);
      expect(sql).not.toMatch(new RegExp(`grant [a-z, ]+ on public\\.${table}`));
    }
    expect(sql).toContain("grant execute on function public.record_source_fingerprints(text, jsonb) to service_role;");
  });

  it("matches only inside the caller's workspace and reads the source digest itself", () => {
    const body = /function public\.record_source_fingerprints[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(sql)?.[1] ?? "";
    expect(body).toContain("where o.workspace_key = p_workspace_key");
    expect(body).toContain("from public.foundation_intake_admissions a\n     where a.workspace_key = p_workspace_key and a.document_id = v_document_id;");
    expect(body).not.toMatch(/v_item->>'(content|source)Sha256'/);
  });
});
