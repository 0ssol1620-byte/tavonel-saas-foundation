import { afterEach, expect, it, vi } from "vitest";
import { readCustomerSourceScope } from "./customer-source-scope";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40) };
const WS = "pilot-abc123";
const doc = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
type Row = { workspace_key: string; document_id: string; confirmed_at?: string | null };
type Store = { connector_document_bindings: Row[]; foundation_intake_admissions: Row[] };

/** Minimal PostgREST stand-in: honors workspace_key=eq, document_id=in and exact count. */
function stubStore(store: Store, override?: (table: string, url: URL, rows: Row[]) => Response | undefined) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const table = url.pathname.replace("/rest/v1/", "") as keyof Store;
    const ws = url.searchParams.get("workspace_key")!.replace(/^eq\./, "");
    const ids = url.searchParams.get("document_id")!.replace(/^in\.\(|\)$/g, "").split(",");
    const rows = store[table].filter((r) => r.workspace_key === ws && ids.includes(r.document_id) &&
      (table !== "foundation_intake_admissions" || url.searchParams.get("confirmed_at") !== "not.is.null" || r.confirmed_at != null));
    return override?.(table, url, rows) ??
      new Response(JSON.stringify(rows), { headers: { "content-range": `0-${rows.length - 1}/${rows.length}` } });
  }));
  return calls;
}
const row = (id: string, workspace_key = WS): Row => ({ workspace_key, document_id: id, confirmed_at: "2026-09-30T00:00:00Z" });

afterEach(() => vi.unstubAllGlobals());

it("classifies admitted-only documents as direct_upload", async () => {
  stubStore({ connector_document_bindings: [], foundation_intake_admissions: [row(doc(1)), row(doc(2))] });
  expect(await readCustomerSourceScope(WS, [doc(1), doc(2)], ENV)).toEqual({ ok: true, scope: "direct_upload" });
});

it("classifies any connector binding as connector scope and skips intake when all are bound", async () => {
  const calls = stubStore({ connector_document_bindings: [row(doc(1))], foundation_intake_admissions: [] });
  expect(await readCustomerSourceScope(WS, [doc(1)], ENV)).toEqual({ ok: true, scope: "connector" });
  expect(calls.map((u) => u.pathname)).toEqual(["/rest/v1/connector_document_bindings"]);
});

it("treats a mixed set as connector scope when every document is accounted for", async () => {
  const calls = stubStore({ connector_document_bindings: [row(doc(1))], foundation_intake_admissions: [row(doc(2))] });
  expect(await readCustomerSourceScope(WS, [doc(1), doc(2)], ENV)).toEqual({ ok: true, scope: "connector" });
  // Intake is only asked about documents without a binding.
  expect(calls[1]!.searchParams.get("document_id")).toBe(`in.(${doc(2)})`);
});

it("fails closed on an unknown origin", async () => {
  stubStore({ connector_document_bindings: [row(doc(1))], foundation_intake_admissions: [] });
  expect(await readCustomerSourceScope(WS, [doc(1), doc(2)], ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
});

it("does not count evidence from another workspace", async () => {
  stubStore({ connector_document_bindings: [row(doc(1), "pilot-other")], foundation_intake_admissions: [row(doc(1), "pilot-other")] });
  expect(await readCustomerSourceScope(WS, [doc(1)], ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
});

it("reads in bounded batches and succeeds at the 2000 document ceiling", async () => {
  const ids = Array.from({ length: 2000 }, (_, i) => doc(i));
  const calls = stubStore({ connector_document_bindings: [], foundation_intake_admissions: ids.map((id) => row(id)) });
  expect(await readCustomerSourceScope(WS, ids, ENV)).toEqual({ ok: true, scope: "direct_upload" });
  expect(calls).toHaveLength(40);
  expect(Math.max(...calls.map((u) => u.href.length))).toBeLessThan(4_200);
  expect(calls.every((u) => u.searchParams.get("select") === "workspace_key,document_id")).toBe(true);
});

it("deduplicates repeated document ids", async () => {
  stubStore({ connector_document_bindings: [], foundation_intake_admissions: [row(doc(1))] });
  expect(await readCustomerSourceScope(WS, [doc(1), doc(1)], ENV)).toEqual({ ok: true, scope: "direct_upload" });
});

it.each([
  ["bad workspace", "../x", [doc(1)]],
  ["empty workspace", "", [doc(1)]],
  ["no documents", WS, []],
  ["too many documents", WS, Array.from({ length: 2001 }, (_, i) => doc(i))],
  ["non-uuid document", WS, ["doc-1"]],
  ["uppercase uuid", WS, ["ABCDEF00-0000-4000-8000-000000000001"]],
  ["filter injection", WS, [`${doc(1)}),workspace_key.neq.x`]],
  ["non-string document", WS, [1 as unknown as string]],
])("rejects %s without touching the store", async (_label, ws, ids) => {
  const calls = stubStore({ connector_document_bindings: [], foundation_intake_admissions: [] });
  expect(await readCustomerSourceScope(ws, ids, ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_INVALID" });
  expect(calls).toHaveLength(0);
});

it("is unavailable without admin configuration", async () => {
  const calls = stubStore({ connector_document_bindings: [], foundation_intake_admissions: [row(doc(1))] });
  expect(await readCustomerSourceScope(WS, [doc(1)], {})).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
  expect(calls).toHaveLength(0);
});

const json = (body: unknown, range: string | null) =>
  new Response(JSON.stringify(body), { headers: range === null ? {} : { "content-range": range } });

it.each<[string, string, (rows: Row[]) => Response]>([
  // No SELECT grant on foundation_intake_admissions today (0053) looks exactly like this.
  ["intake permission denied", "foundation_intake_admissions", () => new Response("{}", { status: 403 })],
  ["binding outage", "connector_document_bindings", () => new Response("{}", { status: 503 })],
  ["non-array body", "foundation_intake_admissions", () => json({ rows: [] }, "*/0")],
  ["non-json body", "foundation_intake_admissions", () => new Response("<html>", { headers: { "content-range": "*/0" } })],
  ["null row", "foundation_intake_admissions", () => json([null], "0-0/1")],
  ["foreign workspace row", "foundation_intake_admissions", () => json([row(doc(1), "pilot-other")], "0-0/1")],
  ["unrequested document row", "foundation_intake_admissions", () => json([row(doc(9))], "0-0/1")],
  ["duplicate row", "foundation_intake_admissions", (r) => json([...r, ...r], "0-1/2")],
  ["truncated result", "foundation_intake_admissions", () => json([], "*/1")],
  ["missing count", "foundation_intake_admissions", (r) => json(r, null)],
  ["truncated binding page", "connector_document_bindings", () => json([], "*/1")],
])("fails closed on %s", async (_label, table, respond) => {
  stubStore(
    { connector_document_bindings: [], foundation_intake_admissions: [row(doc(1))] },
    (t, _url, rows) => (t === table ? respond(rows) : undefined),
  );
  expect(await readCustomerSourceScope(WS, [doc(1)], ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
});

it("fails closed when the store throws", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network"); }));
  expect(await readCustomerSourceScope(WS, [doc(1)], ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
});

it("fails closed when a later batch fails after earlier ones succeed", async () => {
  const ids = Array.from({ length: 150 }, (_, i) => doc(i));
  let n = 0;
  stubStore({ connector_document_bindings: [], foundation_intake_admissions: ids.map((id) => row(id)) },
    (t) => (t === "foundation_intake_admissions" && ++n === 2 ? new Response("{}", { status: 500 }) : undefined));
  expect(await readCustomerSourceScope(WS, ids, ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
});

it("does not treat reserved but unconfirmed uploads as admitted", async () => {
  const calls = stubStore({ connector_document_bindings: [], foundation_intake_admissions: [{ ...row(doc(1)), confirmed_at: null }] });
  expect(await readCustomerSourceScope(WS, [doc(1)], ENV)).toEqual({ ok: false, code: "CUSTOMER_SOURCE_SCOPE_UNAVAILABLE" });
  expect(calls[1]!.searchParams.get("confirmed_at")).toBe("not.is.null");
});
