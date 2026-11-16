import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTemporal, resolveWorldAtKnownAt } from "./world-activation-history";
import { getWorldFreshness } from "./world-store";

/*
  WO-D18-2: typed time on World reads.

  The parser decides which clock a caller meant and refuses to guess; the resolver answers
  "which World had this workspace activated at T" from the append-only activation log, and
  answers nothing rather than something wrong when the log cannot be read.
*/

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const WORKSPACE = "pilot-acme01";
const COLLECTION = `collection-${"a".repeat(32)}`;
const digest = (n: number) => `sha256:${n.toString(16).padStart(64, "0")}`;

describe("parseTemporal", () => {
  it("accepts RFC 3339 with Z or a numeric offset and normalizes to UTC", () => {
    expect(parseTemporal({ known_at: "2026-11-16T09:30:00Z" }, NOW)).toEqual({ ok: true, knownAt: "2026-11-16T09:30:00.000Z" });
    expect(parseTemporal({ known_at: "2026-11-16T18:30:00+09:00" }, NOW)).toEqual({ ok: true, knownAt: "2026-11-16T09:30:00.000Z" });
    expect(parseTemporal({ known_at: "2026-11-16T04:30:00-05:00" }, NOW)).toEqual({ ok: true, knownAt: "2026-11-16T09:30:00.000Z" });
    expect(parseTemporal({ known_at: "2026-11-16T09:30:00.123456Z" }, NOW)).toEqual({ ok: true, knownAt: "2026-11-16T09:30:00.123Z" });
    expect(parseTemporal({ known_at: "2026-11-16T09:30:00.999Z" }, NOW)).toEqual({ ok: true, knownAt: "2026-11-16T09:30:00.999Z" });
  });

  it("treats absent and null as not sent, and returns no time", () => {
    expect(parseTemporal({}, NOW)).toEqual({ ok: true, knownAt: null });
    expect(parseTemporal({ known_at: null, valid_at: null, as_of: null }, NOW)).toEqual({ ok: true, knownAt: null });
  });

  it.each([
    ["a bare date", "2026-11-16"],
    ["a time with no offset", "2026-11-16T09:30:00"],
    ["garbage", "yesterday"],
    ["empty", ""],
    ["a space instead of T", "2026-11-16 09:30:00Z"],
    ["an impossible day", "2026-02-30T00:00:00Z"],
    ["an impossible hour", "2026-11-16T24:00:00Z"],
    ["an impossible offset", "2026-11-16T09:30:00+24:00"],
    ["a number", 1763285400],
    ["a repeated parameter", ["2026-11-16T09:30:00Z", "2026-11-16T09:31:00Z"]],
  ])("refuses known_at that is %s", (_name, value) => {
    expect(parseTemporal({ known_at: value }, NOW)).toEqual({ ok: false, code: "KNOWN_AT_INVALID", status: 400 });
  });

  it("refuses a known_at in the future and accepts exactly now", () => {
    expect(parseTemporal({ known_at: "2026-11-16T12:00:00.001Z" }, NOW)).toEqual({ ok: false, code: "KNOWN_AT_IN_FUTURE", status: 400 });
    expect(parseTemporal({ known_at: "2026-11-16T12:00:00.000Z" }, NOW).ok).toBe(true);
  });

  it("refuses as_of without choosing a clock for the caller", () => {
    expect(parseTemporal({ as_of: "2026-11-16T09:30:00Z" }, NOW)).toEqual({ ok: false, code: "AS_OF_AMBIGUOUS", status: 400 });
    expect(parseTemporal({ as_of: "2026-11-16T09:30:00Z", known_at: "2026-11-16T09:30:00Z" }, NOW)).toMatchObject({ code: "AS_OF_AMBIGUOUS" });
    expect(parseTemporal({ as_of: "" }, NOW)).toMatchObject({ code: "AS_OF_AMBIGUOUS" });
  });

  it("answers a well-formed valid_at with 422, and a malformed one with 400", () => {
    expect(parseTemporal({ valid_at: "2026-01-01T00:00:00Z" }, NOW)).toEqual({ ok: false, code: "VALID_TIME_NOT_RECORDED", status: 422 });
    expect(parseTemporal({ valid_at: "2026-01-01T00:00:00Z", known_at: "2026-11-16T09:30:00Z" }, NOW)).toMatchObject({ status: 422 });
    expect(parseTemporal({ valid_at: "2026-01-01" }, NOW)).toEqual({ ok: false, code: "VALID_AT_INVALID", status: 400 });
  });
});

type Event = { event_id: string; workspace_key: string; collection_id: string; to_manifest_digest: string; created_at: string; action: string };

/** A store that honours exactly the filters the resolver is allowed to send, and records what it saw. */
function fakeStore(events: Event[]) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(String(input));
    const q = url.searchParams;
    const eq = (name: string) => q.get(name)?.replace(/^eq\./, "");
    const lte = Date.parse(q.get("created_at")!.replace(/^lte\./, ""));
    const rows = events
      .filter((e) => e.workspace_key === eq("workspace_key") && e.collection_id === eq("collection_id") && Date.parse(e.created_at) <= lte)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.event_id.localeCompare(a.event_id))
      .slice(0, Number(q.get("limit")));
    return new Response(JSON.stringify(rows.map(({ to_manifest_digest, created_at, action }) => ({ to_manifest_digest, created_at, action }))), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { urls, fetchMock };
}

const at = (iso: string, to: number, action = "promote", workspace = WORKSPACE, collection = COLLECTION, id = iso): Event => ({
  event_id: id, workspace_key: workspace, collection_id: collection, to_manifest_digest: digest(to), created_at: iso.replace("Z", "+00:00"), action,
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k".repeat(40));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveWorldAtKnownAt", () => {
  it("picks the latest event at or before T across promote, promote, rollback", async () => {
    fakeStore([
      at("2026-11-01T00:00:00.000Z", 1),
      at("2026-11-05T00:00:00.000Z", 2),
      at("2026-11-09T00:00:00.000Z", 1, "rollback"),
    ]);
    const resolve = (iso: string) => resolveWorldAtKnownAt(WORKSPACE, COLLECTION, iso);
    expect(await resolve("2026-11-03T00:00:00.000Z")).toMatchObject({ ok: true, manifestDigest: digest(1) });
    expect(await resolve("2026-11-05T00:00:00.000Z")).toMatchObject({ ok: true, manifestDigest: digest(2), activatedAt: "2026-11-05T00:00:00.000Z" });
    expect(await resolve("2026-11-08T23:59:59.999Z")).toMatchObject({ ok: true, manifestDigest: digest(2) });
    expect(await resolve("2026-11-16T00:00:00.000Z")).toMatchObject({ ok: true, manifestDigest: digest(1), activatedAt: "2026-11-09T00:00:00.000Z" });
  });

  it("answers 404 for a time before the first activation, never the first World", async () => {
    fakeStore([at("2026-11-01T00:00:00.000Z", 1)]);
    expect(await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-10-31T23:59:59.999Z")).toEqual({
      ok: false, code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION", status: 404,
    });
  });

  it("always sends both exact filters from its arguments, and reads one row", async () => {
    const { urls } = fakeStore([
      at("2026-11-01T00:00:00.000Z", 1),
      at("2026-11-01T00:00:00.000Z", 9, "promote", "pilot-other01"),
      at("2026-11-01T00:00:00.000Z", 8, "promote", WORKSPACE, `collection-${"b".repeat(32)}`),
    ]);
    const result = await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-11-02T00:00:00.000Z");
    expect(result).toMatchObject({ ok: true, manifestDigest: digest(1) });
    expect(urls).toHaveLength(1);
    const q = new URL(urls[0]!).searchParams;
    expect(new URL(urls[0]!).pathname).toBe("/rest/v1/foundation_world_events");
    expect(q.get("workspace_key")).toBe(`eq.${WORKSPACE}`);
    expect(q.get("collection_id")).toBe(`eq.${COLLECTION}`);
    expect(q.get("created_at")).toBe("lte.2026-11-02T00:00:00.000Z");
    expect(q.get("order")).toBe("created_at.desc,event_id.desc");
    expect(q.get("limit")).toBe("1");
    expect(q.get("select")).toBe("to_manifest_digest,created_at,action");
  });

  it("refuses unsafe keys before any request is built", async () => {
    const { fetchMock } = fakeStore([]);
    expect(await resolveWorldAtKnownAt("bad key&x=1", COLLECTION, "2026-11-02T00:00:00.000Z")).toMatchObject({ ok: false, code: "WORLD_ID_INVALID" });
    expect(await resolveWorldAtKnownAt(WORKSPACE, "collection-x", "2026-11-02T00:00:00.000Z")).toMatchObject({ ok: false, code: "WORLD_ID_INVALID" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a 503, never 'no history', when the store is unconfigured, errors, throws or returns a bad row", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-11-02T00:00:00.000Z")).toEqual({ ok: false, code: "WORLD_STORE_NOT_CONFIGURED", status: 503 });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    expect(await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-11-02T00:00:00.000Z")).toEqual({ ok: false, code: "WORLD_STORE_READ_FAILED", status: 503 });

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-11-02T00:00:00.000Z")).toEqual({ ok: false, code: "WORLD_STORE_READ_FAILED", status: 503 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ to_manifest_digest: "not-a-digest", created_at: "2026-11-01T00:00:00+00:00", action: "promote" }]), { status: 200 })));
    expect(await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-11-02T00:00:00.000Z")).toEqual({ ok: false, code: "WORLD_STORE_READ_FAILED", status: 503 });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "not a list" }), { status: 200 })));
    expect(await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, "2026-11-02T00:00:00.000Z")).toEqual({ ok: false, code: "WORLD_STORE_READ_FAILED", status: 503 });
  });

  it("never serves a World activated after T, over 200 random event sequences", async () => {
    // Deterministic LCG so a failure reproduces.
    let seed = 20261116;
    const rand = (n: number) => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed % n; };
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    for (let round = 0; round < 200; round += 1) {
      const count = 1 + rand(8);
      const events: Event[] = Array.from({ length: count }, (_, index) => {
        const iso = new Date(base + rand(30) * 86_400_000 + rand(3) * 1000).toISOString();
        return at(iso, 1 + rand(3), index === 0 || rand(2) === 0 ? "promote" : "rollback", WORKSPACE, COLLECTION, `e${String(index).padStart(3, "0")}`);
      });
      fakeStore(events);
      const t = base + rand(32) * 86_400_000 + rand(4) * 1000;
      const result = await resolveWorldAtKnownAt(WORKSPACE, COLLECTION, new Date(t).toISOString());
      const eligible = events.filter((e) => Date.parse(e.created_at) <= t);
      if (eligible.length === 0) {
        expect(result).toMatchObject({ ok: false, code: "KNOWN_AT_BEFORE_FIRST_ACTIVATION" });
        continue;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      // The activating event is not after T, and no eligible event is later than it.
      const latest = Math.max(...eligible.map((e) => Date.parse(e.created_at)));
      expect(Date.parse(result.activatedAt)).toBeLessThanOrEqual(t);
      expect(Date.parse(result.activatedAt)).toBe(latest);
      expect(eligible.some((e) => Date.parse(e.created_at) === latest && e.to_manifest_digest === result.manifestDigest)).toBe(true);
    }
  });
});

describe("the freshness a past World is served with", () => {
  // The lens route re-reads freshness with no candidate hint for a World that was activated and
  // replaced. This is the real getWorldFreshness over a faked store: with the pointer on the newer
  // World, the old digest handed in as a hint reads as a candidate awaiting activation (the defect),
  // and the same read with no hint does not.
  const OLD = digest(1);
  const ACTIVE = digest(2);
  function store() {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("foundation_active_worlds")) return new Response(JSON.stringify([{ manifest_digest: ACTIVE }]));
      if (url.includes("foundation_world_versions")) return new Response(JSON.stringify([
        { manifest_digest: ACTIVE, last_activated_at: "2026-11-12T00:00:00+00:00", created_at: "2026-11-12T00:00:00+00:00" },
        { manifest_digest: OLD, last_activated_at: "2026-11-02T00:00:00+00:00", created_at: "2026-11-02T00:00:00+00:00" },
      ]));
      return new Response(JSON.stringify([]));
    }));
  }

  it("reports the old digest as a candidate only when it is handed in as a hint", async () => {
    store();
    const hinted = await getWorldFreshness(WORKSPACE, COLLECTION, { candidateManifestDigest: OLD });
    expect(hinted).toMatchObject({ candidateAwaitingActivation: true, candidateManifestDigest: OLD });
    const present = await getWorldFreshness(WORKSPACE, COLLECTION);
    expect(present).toMatchObject({ activeManifestDigest: ACTIVE, candidateAwaitingActivation: false, candidateManifestDigest: null });
  });
});
