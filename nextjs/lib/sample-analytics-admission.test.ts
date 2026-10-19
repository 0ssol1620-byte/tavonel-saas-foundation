import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONSENT_KEY, PUBLIC_MARKETING_PATHS, marketingEventPayload, publicPageLocation, readConsent } from "./marketing-analytics";

/*
  UX08: the public sample's funnel events, as they reach the consented Google relay.

  Three things are asserted against the real modules: a stored choice is only a choice while it
  has a finite expiry, the relay forwards an allowlisted name and a canonical location and nothing
  from the event's detail, and a `*Once` event emits once while a deliberate repeat emits twice.
  The only stand-in is the Vercel SDK's `track`, so nothing here contacts a collector -- and
  nothing here is evidence about a live visitor, a browser or the vendor.
*/

const trackMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/analytics", () => ({ track: trackMock }));

const DAY = 24 * 60 * 60 * 1000;

function stored(value: string | null) {
  return { getItem: (key: string) => (key === CONSENT_KEY ? value : null) };
}

describe("sample marketing admission: a stored choice", () => {
  const now = 1_800_000_000_000;

  it("sample marketing admission: refuses an expiry that parses to Infinity", () => {
    for (const value of [
      '{"allowed":true,"expires":1e309}',
      '{"allowed":false,"expires":1e309}',
      '{"allowed":true,"expires":-1e309}',
    ]) expect(readConsent(stored(value), now), value).toBeNull();
  });

  it("sample marketing admission: keeps an ordinary allow or refusal and drops an expired one", () => {
    const expires = now + 180 * DAY;
    expect(readConsent(stored(JSON.stringify({ allowed: true, expires })), now)).toBe(true);
    expect(readConsent(stored(JSON.stringify({ allowed: false, expires })), now)).toBe(false);
    expect(readConsent(stored(JSON.stringify({ allowed: true, expires: now })), now)).toBeNull();
    expect(readConsent(stored(JSON.stringify({ allowed: true, expires: now - 1 })), now)).toBeNull();
  });

  it("sample marketing admission: fails closed on malformed or unreadable storage", () => {
    for (const value of [null, "", "broken", "null", "[]", "{}", '{"allowed":"yes","expires":9999999999999}', '{"allowed":true,"expires":"9999999999999"}', '{"allowed":true}']) {
      expect(readConsent(stored(value), now), String(value)).toBeNull();
    }
    expect(readConsent({ getItem: () => { throw new Error("blocked"); } }, now)).toBeNull();
  });
});

describe("sample marketing admission: the relay payload", () => {
  const SAMPLE_EVENTS = ["source_open", "explore_evidence_opened", "explore_entered"];

  it("sample marketing admission: forwards nothing without an explicit allow", () => {
    for (const consent of [null, false]) {
      for (const event of SAMPLE_EVENTS) expect(marketingEventPayload(consent, "/explore", { event })).toBeNull();
    }
    expect(marketingEventPayload(true, "/explore", { event: "explore_entered" })).not.toBeNull();
  });

  it("sample marketing admission: refuses private, unknown, URL-shaped and query-bearing paths", () => {
    for (const path of [
      "/workspace", "/workspace/sources", "/auth/callback", "/login", "/api/contact", "/docs/private-id",
      "/explore?q=secret", "/explore#token", "/explore/", "explore", "", "https://tavonel.com/explore",
      "https://other.example/explore", "/cookbooks/unlisted",
    ]) expect(marketingEventPayload(true, path, { event: "explore_entered" }), path).toBeNull();
  });

  it("sample marketing admission: accepts the three sample events by their exact names", () => {
    for (const event of SAMPLE_EVENTS) {
      expect(marketingEventPayload(true, "/explore", { event })).toEqual({
        name: event,
        params: { page_location: "https://tavonel.com/explore", page_title: "TAVONEL" },
      });
    }
  });

  it("sample marketing admission: refuses arbitrary, workspace and question event names", () => {
    for (const event of [
      "workspace_first_ask", "workspace_world_activated", "workspace_compile_started", "explore_ask_used",
      "question", "user_question", "custom_event", "Source_Open", " source_open", "source_open ", "",
      1, null, undefined, {}, ["source_open"],
    ]) expect(marketingEventPayload(true, "/explore", { event }), String(event)).toBeNull();
    for (const detail of [undefined, null, "source_open", 7, ["source_open"]]) {
      expect(marketingEventPayload(true, "/explore", detail), String(detail)).toBeNull();
    }
  });

  it("sample marketing admission: copies no field of the incoming detail, allowed-looking or not", () => {
    const detail = {
      event: "source_open",
      original: "ORIGINAL-SENTINEL",
      source: "SOURCE-SENTINEL.pdf",
      question: "QUESTION-SENTINEL what does clause 7 say",
      filename: "FILENAME-SENTINEL.docx",
      key: "KEY-SENTINEL",
      token: "TOKEN-SENTINEL",
      url: "https://evil.example/URL-SENTINEL?q=1",
      page_location: "https://evil.example/LOCATION-SENTINEL",
      page_title: "TITLE-SENTINEL",
      scene: "SCENE-SENTINEL",
      variant: "VARIANT-SENTINEL",
      act: "ACT-SENTINEL",
    };
    const before = JSON.stringify(detail);
    const payload = marketingEventPayload(true, "/explore", detail);

    expect(payload).toEqual({ name: "source_open", params: { page_location: "https://tavonel.com/explore", page_title: "TAVONEL" } });
    expect(Object.keys(payload!)).toEqual(["name", "params"]);
    expect(Object.keys(payload!.params)).toEqual(["page_location", "page_title"]);
    expect(JSON.stringify(payload)).not.toContain("SENTINEL");
    expect(JSON.stringify(payload)).not.toContain("evil.example");
    expect(payload!.params).not.toBe(detail);
    expect(JSON.stringify(detail)).toBe(before);
  });

  it("sample marketing admission: the location is the literal canonical href of a listed route", () => {
    for (const [path, href] of [
      ["/", "https://tavonel.com/"],
      ["/explore", "https://tavonel.com/explore"],
      ["/evidence", "https://tavonel.com/evidence"],
      ["/pricing", "https://tavonel.com/pricing"],
      ["/ko", "https://tavonel.com/ko"],
    ]) expect(marketingEventPayload(true, path, { event: "explore_entered" })?.params.page_location, path).toBe(href);
    for (const path of PUBLIC_MARKETING_PATHS) {
      expect(marketingEventPayload(true, path, { event: "source_open" })?.params.page_location, path).toBe(publicPageLocation(path));
    }
  });

  it("sample marketing admission: the consent listener decides through this helper", () => {
    // Wiring only. The functional claims are the assertions above, against the helper itself.
    const component = readFileSync(resolve(import.meta.dirname, "../components/marketing-consent.tsx"), "utf8");
    expect(component).toContain("marketingEventPayload(consent, window.location.pathname, (event as CustomEvent)?.detail)");
    expect(component).toContain('win.gtag?.("event", payload.name, payload.params)');
    expect(component).not.toContain("MARKETING_EVENTS.has(");
    expect(component).toContain('if (!ready || consent !== true || !location || window.location.hostname !== "tavonel.com") { disableAnalytics(); return; }');
    expect(component).toContain('window.addEventListener("tavonel:funnel", record);');
    expect(component).toContain('window.removeEventListener("tavonel:funnel", record);');
  });
});

describe("sample marketing admission: once means once, and only for once events", () => {
  type FakeEvent = { type: string; detail: unknown };
  let dispatched: FakeEvent[];
  let session: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    trackMock.mockClear();
    dispatched = [];
    session = new Map();
    vi.stubGlobal("CustomEvent", class {
      readonly type: string;
      readonly detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => session.get(key) ?? null,
        setItem: (key: string, value: string) => { session.set(key, value); },
      },
      dispatchEvent: (event: FakeEvent) => { dispatched.push(event); return true; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function funnelRecords() {
    return dispatched.filter((event) => event.type === "tavonel:funnel");
  }
  function sessionLog(): unknown[] {
    return JSON.parse(session.get("tavonel.funnel-log") ?? "[]");
  }

  /*
    P2-07 (ANALYTICS-ACTIVATION-2026-10-17 §4.4 G2, §5 step 2): `trackFunnel` no longer calls the
    Vercel `track()` itself. Both collectors are fed from the `tavonel:funnel` record, through the
    consented relays (the Vercel one is `components/vercel-collector.tsx`, counted in
    `lib/marketing-analytics.test.ts`).
    So "one collector call" is now "one record, which the relay admits once": the direct call
    count is pinned at zero, and the record count is what these cases measure.
  */
  it("sample marketing admission: a repeated trackFunnelOnce emits one record and one relayed event", async () => {
    const { trackFunnelOnce } = await import("./funnel-events");
    trackFunnelOnce("explore_entered");
    trackFunnelOnce("explore_entered");
    trackFunnelOnce("explore_entered");

    expect(trackMock).not.toHaveBeenCalled();
    expect(funnelRecords()).toHaveLength(1);
    expect(sessionLog()).toHaveLength(1);
    const relayed = funnelRecords().map((event) => marketingEventPayload(true, "/explore", event.detail)).filter(Boolean);
    expect(relayed).toEqual([{ name: "explore_entered", params: { page_location: "https://tavonel.com/explore", page_title: "TAVONEL" } }]);
  });

  it("sample marketing admission: two deliberate evidence opens are two records", async () => {
    const { trackFunnel } = await import("./funnel-events");
    trackFunnel("explore_evidence_opened");
    trackFunnel("explore_evidence_opened");

    expect(trackMock).not.toHaveBeenCalled();
    expect(funnelRecords()).toHaveLength(2);
    expect(sessionLog()).toHaveLength(2);
    const relayed = funnelRecords().map((event) => marketingEventPayload(true, "/explore", event.detail)).filter(Boolean);
    expect(relayed).toHaveLength(2);
  });
});
