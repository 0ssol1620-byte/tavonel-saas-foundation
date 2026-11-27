import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  WO-AN-RUM-1. Product measurement (D26) and field vitals (U19/U43): the switch, the consent gate,
  the strict public shapes, the registered-campaign filter and what reaches the database.
  The database half (no yes = no row, withdrawal deletes, counts-only read model) is
  supabase/tests/product_measurement.sql.
*/
const getRequestUser = vi.hoisted(() => vi.fn());
vi.mock("@/lib/foundation-pilot", () => ({ getRequestUser }));

import {
  FIELD_VITALS_BUCKET,
  fieldVitalsBucket,
  parseFieldVitalsBeacon,
  parseProductMeasurementRequest,
  recordProductMeasurement,
  registeredCampaign,
} from "./product-measurement";
import { POST as postFieldVitals } from "../app/api/field-vitals/route";
import { GET as getChoice, POST as postChoice } from "../app/api/product-measurement/route";

const ON = { NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED: "1", NEXT_PUBLIC_SUPABASE_URL: "https://db.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(40) };
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  getRequestUser.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  for (const [key, value] of Object.entries(ON)) vi.stubEnv(key, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const rpcCalls = () => fetchMock.mock.calls.map(([url, init]) => ({
  name: String(url).replace("https://db.example.invalid/rest/v1/rpc/", ""),
  args: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
}));
const beacon = (body: unknown, headers: Record<string, string> = {}) => new Request("https://tavonel.com/api/field-vitals", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "content-type": "text/plain;charset=UTF-8", "sec-fetch-site": "same-origin", ...headers },
});
const choiceRequest = (method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) =>
  new Request("https://tavonel.com/api/product-measurement", {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: "Bearer t", "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
  });

describe("field vitals: the public beacon", () => {
  it("accepts a listed public path with bounded numbers, and nothing else", () => {
    expect(parseFieldVitalsBeacon({ path: "/", lcp: 1800, inp: 120, cls: 0.02 })).not.toBeNull();
    expect(parseFieldVitalsBeacon({ path: "/pricing", cls: 0 })).not.toBeNull();
    for (const refused of [
      { path: "/workspace", lcp: 1 },            // not a listed public page
      { path: "/?utm_source=x", lcp: 1 },        // a query is not a path
      { path: "/", lcp: 1, user: "a" },          // an unknown key refuses the whole beacon
      { path: "/", lcp: -1 }, { path: "/", lcp: Number.NaN }, { path: "/", inp: 120_001 }, { path: "/", cls: 101 },
      { path: "/", lcp: "1800" },                // a string is not a number
      { path: "/" },                             // no metric: nothing measured is not a zero
      null, [], "x",
    ]) expect(parseFieldVitalsBeacon(refused), JSON.stringify(refused)).toBeNull();
  });

  it("buckets on the thresholds' edges, CLS in thousandths", () => {
    expect(FIELD_VITALS_BUCKET).toEqual({ lcp: 250, inp: 25, cls: 25 });
    expect([fieldVitalsBucket("lcp", 2499), fieldVitalsBucket("lcp", 2500), fieldVitalsBucket("lcp", 1e6)]).toEqual([9, 10, 39]);
    expect([fieldVitalsBucket("inp", 199), fieldVitalsBucket("inp", 200)]).toEqual([7, 8]);
    expect([fieldVitalsBucket("cls", 0.075), fieldVitalsBucket("cls", 0.099), fieldVitalsBucket("cls", 0.1)]).toEqual([3, 3, 4]);
  });

  it("the route is off unless the analytics switch is exactly 1, and then calls nothing", async () => {
    for (const value of ["", "true", "0", " 1"]) {
      vi.stubEnv("NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED", value);
      expect((await postFieldVitals(beacon({ path: "/", lcp: 1 }))).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses cross-site, foreign-origin, wrong-type, oversized and malformed posts before any store call", async () => {
    expect((await postFieldVitals(beacon({ path: "/", lcp: 1 }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await postFieldVitals(beacon({ path: "/", lcp: 1 }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await postFieldVitals(beacon({ path: "/", lcp: 1 }, { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect((await postFieldVitals(beacon(JSON.stringify({ path: "/", lcp: 1, pad: "x".repeat(300) })))).status).toBe(413);
    expect((await postFieldVitals(beacon({ path: "/workspace", lcp: 1 }))).status).toBe(400);
    expect((await postFieldVitals(beacon("{"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stores buckets, never the raw values or the path's query, and says 503 when the store fails", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await postFieldVitals(beacon({ path: "/pricing", lcp: 2600, cls: 0.1 }, { origin: "https://tavonel.com" }));
    expect(response.status).toBe(204);
    expect(rpcCalls()).toEqual([{ name: "record_field_vitals", args: { p_path: "/pricing", p_lcp: 10, p_inp: null, p_cls: 4 } }]);
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    expect((await postFieldVitals(beacon({ path: "/", inp: 80 }))).status).toBe(503);
  });
});

describe("product measurement: the user's choice", () => {
  it("parses strictly", () => {
    expect(parseProductMeasurementRequest({ allowed: true })).toEqual({ allowed: true });
    expect(parseProductMeasurementRequest({ allowed: true, utm_campaign: "d35_dev_mcp_en_us", utm_content: "ad_1" })).not.toBeNull();
    for (const refused of [{ allowed: "yes" }, {}, { allowed: true, email: "a@b.c" }, { allowed: true, utm_campaign: "x".repeat(121) },
      { allowed: true, utm_term: "x" }, null, []]) {
      expect(parseProductMeasurementRequest(refused), JSON.stringify(refused)).toBeNull();
    }
  });

  it("keeps a campaign label only when we registered it, and only with a yes", () => {
    expect(registeredCampaign({ allowed: true, utm_campaign: "d35_dev_mcp_en_us", utm_content: "ad_1" })).toEqual({ campaign: "d35_dev_mcp_en_us", content: "ad_1" });
    expect(registeredCampaign({ allowed: true, utm_campaign: "jane.doe@example.com", utm_content: "ad_1" })).toEqual({ campaign: null, content: null });
    expect(registeredCampaign({ allowed: true, utm_campaign: "d35_dev_mcp_en_us", utm_content: "Jane Doe" })).toEqual({ campaign: "d35_dev_mcp_en_us", content: null });
    expect(registeredCampaign({ allowed: false, utm_campaign: "d35_dev_mcp_en_us" })).toEqual({ campaign: null, content: null });
  });

  it("is off unless the switch is exactly 1: 404, and no record call from the routes that witness a fact", async () => {
    vi.stubEnv("NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED", "true");
    getRequestUser.mockResolvedValue({ id: "u1" });
    expect((await getChoice(choiceRequest("GET"))).status).toBe(404);
    expect((await postChoice(choiceRequest("POST", { allowed: true }))).status).toBe(404);
    await recordProductMeasurement("u1", ["first_agent_read"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getRequestUser).not.toHaveBeenCalled();
  });

  it("needs the caller's own session, and returns the choice and nothing else", async () => {
    getRequestUser.mockResolvedValue(null);
    expect((await getChoice(choiceRequest("GET"))).status).toBe(401);
    expect((await postChoice(choiceRequest("POST", { allowed: true }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();

    getRequestUser.mockResolvedValue({ id: "u1", email: "person@example.invalid" });
    fetchMock.mockResolvedValueOnce(new Response("null", { status: 200 }));
    expect(await (await getChoice(choiceRequest("GET"))).json()).toEqual({ choice: "undecided" });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ allowed: true, decided_at: "2026-11-27T00:00:00Z" }), { status: 200 }));
    expect(await (await getChoice(choiceRequest("GET"))).json()).toEqual({ choice: "allowed" });
    expect(rpcCalls().map((call) => call.args)).toEqual([{ p_user_id: "u1" }, { p_user_id: "u1" }]);
  });

  it("sends the registered label with a yes, nothing with a no, and refuses cross-site or malformed posts", async () => {
    getRequestUser.mockResolvedValue({ id: "u1" });
    fetchMock.mockImplementation(async (_url, init: RequestInit) =>
      new Response(JSON.stringify({ allowed: JSON.parse(String(init.body)).p_allowed, decided_at: "2026-11-27T00:00:00Z" }), { status: 200 }));
    expect(await (await postChoice(choiceRequest("POST", { allowed: true, utm_campaign: "d35_dev_mcp_en_us", utm_content: "ad_1" }))).json()).toEqual({ choice: "allowed" });
    expect(await (await postChoice(choiceRequest("POST", { allowed: true, utm_campaign: "someone_else" }))).json()).toEqual({ choice: "allowed" });
    expect(await (await postChoice(choiceRequest("POST", { allowed: false, utm_campaign: "d35_dev_mcp_en_us" }))).json()).toEqual({ choice: "declined" });
    expect(rpcCalls().map((call) => call.args)).toEqual([
      { p_user_id: "u1", p_allowed: true, p_version: "product-measurement-v1", p_campaign: "d35_dev_mcp_en_us", p_campaign_content: "ad_1" },
      { p_user_id: "u1", p_allowed: true, p_version: "product-measurement-v1", p_campaign: null, p_campaign_content: null },
      { p_user_id: "u1", p_allowed: false, p_version: "product-measurement-v1", p_campaign: null, p_campaign_content: null },
    ]);
    fetchMock.mockClear();
    expect((await postChoice(choiceRequest("POST", { allowed: true }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await postChoice(choiceRequest("POST", { allowed: "yes" }))).status).toBe(400);
    expect((await postChoice(choiceRequest("POST", { allowed: true }, { "content-type": "text/plain" }))).status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed: a store failure or an unreadable body is 503, never 'undecided'", async () => {
    getRequestUser.mockResolvedValue({ id: "u1" });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect((await getChoice(choiceRequest("GET"))).status).toBe(503);
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect((await getChoice(choiceRequest("GET"))).status).toBe(503);
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect((await postChoice(choiceRequest("POST", { allowed: true }))).status).toBe(503);
  });

  it("records the named facts only, and a failed record never throws or logs an identifier", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify("recorded"), { status: 200 }));
    await recordProductMeasurement("u1", ["first_agent_read", "active_day", "active_day"]);
    expect(rpcCalls()).toEqual([{ name: "record_product_measurement", args: { p_user_id: "u1", p_events: ["first_agent_read", "active_day"] } }]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error("down"));
    await expect(recordProductMeasurement("u1", ["active_day"])).resolves.toBeUndefined();
    expect(info.mock.calls.map(([line]) => line)).toEqual([JSON.stringify({ event: "product_measurement_dropped", reason: "store_error" })]);
    info.mockRestore();
  });

  it("is called from the routes that witness the facts, with no content passed", () => {
    const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
    const calls = (path: string) => [...read(path).matchAll(/recordProductMeasurement\(([^;]+)\);/g)].map((match) => match[1].replace(/\s+/g, " "));
    expect(calls("app/api/collections/[id]/promote/route.ts")).toEqual([
      'user.id, expectedCurrentManifest !== null ? ["first_verified_record", "active_day"] : ["first_verified_record"]',
    ]);
    expect(calls("app/api/collections/[id]/ask/route.ts")).toEqual([
      'auth.principal.userId, auth.principal.kind === "api-key" ? ["first_agent_read", "active_day"] : ["active_day"]',
    ]);
    expect(calls("app/api/collections/[id]/download/route.ts")).toEqual(['auth.principal.userId, ["first_agent_read", "active_day"]']);
    expect(calls("app/api/collections/[id]/search/route.ts")).toEqual([
      'auth.principal.userId, ["first_agent_read", "active_day"]', 'auth.principal.userId, ["first_agent_read", "active_day"]',
    ]);
  });
});

describe("field vitals: the browser reporter", () => {
  type Listener = () => void;
  function browser(consent: unknown, entryTypes: string[]) {
    const observers: { type: string; callback: (list: { getEntries(): unknown[] }) => void }[] = [];
    const listeners: Listener[] = [];
    const sent: string[] = [];
    class FakeObserver {
      static supportedEntryTypes = entryTypes;
      constructor(private readonly callback: (list: { getEntries(): unknown[] }) => void) {}
      observe(options: { type: string }) { observers.push({ type: options.type, callback: this.callback }); }
    }
    const document = { visibilityState: "visible" };
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    vi.stubGlobal("navigator", { sendBeacon: (url: string, body: string) => { sent.push(`${url} ${body}`); return true; } });
    vi.stubGlobal("document", document);
    vi.stubGlobal("location", { pathname: "/pricing" });
    vi.stubGlobal("localStorage", { getItem: () => (consent === undefined ? null : JSON.stringify(consent)) });
    vi.stubGlobal("addEventListener", (_type: string, listener: Listener) => listeners.push(listener));
    vi.stubGlobal("performance", { getEntriesByType: () => [{ name: "https://tavonel.com/?utm_campaign=d35_dev_mcp_en_us" }] });
    const emit = (type: string, entries: unknown[]) => observers.filter((o) => o.type === type).forEach((o) => o.callback({ getEntries: () => entries }));
    const hide = () => { document.visibilityState = "hidden"; listeners.forEach((listener) => listener()); };
    return { emit, hide, sent };
  }
  const yes = { allowed: true, expires: Date.now() + 86_400_000 };

  beforeEach(() => { vi.resetModules(); });

  it("sends once, on hide, the loaded document's path and rounded numbers -- never the query", async () => {
    const page = browser(yes, ["largest-contentful-paint", "layout-shift", "event"]);
    const { observeFieldVitals } = await import("./field-vitals");
    observeFieldVitals();
    observeFieldVitals(); // a second call (client navigation) adds no second reporter
    page.emit("largest-contentful-paint", [{ startTime: 1234.6 }]);
    page.emit("layout-shift", [{ startTime: 100, value: 0.05, hadRecentInput: false }, { startTime: 300, value: 0.0312, hadRecentInput: false }]);
    page.emit("event", [{ interactionId: 7, duration: 96 }, { interactionId: 0, duration: 400 }]);
    page.hide();
    page.hide();
    expect(page.sent).toEqual(['/api/field-vitals {"path":"/","cls":0.081,"lcp":1235,"inp":96}']);
  });

  it("sends nothing without a stored yes, and leaves out what this browser cannot observe", async () => {
    for (const consent of [undefined, { allowed: false, expires: Date.now() + 86_400_000 }, { allowed: true, expires: 1 }]) {
      vi.resetModules();
      const page = browser(consent, ["largest-contentful-paint", "layout-shift"]);
      (await import("./field-vitals")).observeFieldVitals();
      page.emit("largest-contentful-paint", [{ startTime: 900 }]);
      page.hide();
      expect(page.sent, JSON.stringify(consent)).toEqual([]);
    }
    vi.resetModules();
    const safari = browser(yes, ["largest-contentful-paint"]);
    (await import("./field-vitals")).observeFieldVitals();
    safari.emit("largest-contentful-paint", [{ startTime: 900 }]);
    safari.hide();
    expect(safari.sent).toEqual(['/api/field-vitals {"path":"/","lcp":900}']);
  });
});
