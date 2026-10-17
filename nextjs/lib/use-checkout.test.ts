/**
 * The checkout guarantees, checked.
 *
 * `use-checkout.ts` declares four guarantees in its header comment: a session token is required
 * first, the server owns the price allow-list, a partial response is a failure, and only a signed
 * webhook moves an entitlement. Until now nothing verified any of them -- the same shape as the
 * banned-phrase list, which was a comment saying "nothing should drift toward this" and checked
 * nothing. This is the more expensive version of that mistake, because this is the path that moves
 * money.
 *
 * The hook is exercised through React's own test renderer rather than by reimplementing it, so
 * these assertions hold against the code that actually runs.
 */

/* eslint-disable react-hooks/rules-of-hooks -- this file drives the hook deliberately, from a
   test harness rather than a component, in order to assert on the real implementation. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failureSentence } from "./workspace-failure-copy";
import { ENTITLEMENT_PENDING_SENTENCE, type BillingStatusAccount, type EntitlementWaitResult } from "./entitlement-wait";

/* ---------------------------------------------------------------- module doubles */

const session = { token: null as string | null };
type PaddleEvent = { name: string };
const paddle = { opened: [] as unknown[], init: null as unknown, eventCallback: null as null | ((event: PaddleEvent) => void) };

vi.mock("./supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }),
    },
  }),
}));

vi.mock("./paddle-browser", () => ({
  initializePaddleBrowser: async (options: { eventCallback?: (event: PaddleEvent) => void }) => {
    paddle.eventCallback = options.eventCallback ?? null;
    return paddle.init;
  },
}));

/* ------------------------------------------------------------------- harness */

/**
 * Drives the hook without a DOM. `useCallback`/`useState` are the only React features it uses,
 * so a two-hook dispatcher is enough and keeps the test free of a renderer dependency.
 */
async function runCheckout(offer: string, onEntitlement?: (wait: EntitlementWaitResult) => void) {
  const notices: string[] = [];
  const React = await import("react");
  const states: unknown[] = [];
  let cursor = 0;

  const dispatcher = {
    useState: (initial: unknown) => {
      const at = cursor++;
      if (states.length <= at) states[at] = initial;
      return [states[at], (next: unknown) => { states[at] = next; }];
    },
    useCallback: (fn: unknown) => { cursor++; return fn; },
  };

  const internals = (React as unknown as Record<string, { H?: unknown; ReactCurrentDispatcher?: { current: unknown } }>)[
    "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE"
  ] ?? (React as unknown as Record<string, { ReactCurrentDispatcher?: { current: unknown } }>)[
    "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"
  ];

  const { useCheckout } = await import("./use-checkout");

  const previous = internals?.H ?? internals?.ReactCurrentDispatcher?.current;
  if (internals && "H" in internals) internals.H = dispatcher;
  else if (internals?.ReactCurrentDispatcher) internals.ReactCurrentDispatcher.current = dispatcher;

  let start: (code: string) => Promise<void>;
  try {
    const hook = useCheckout((m) => notices.push(m), onEntitlement) as { start: (code: string) => Promise<void> };
    start = hook.start;
  } finally {
    if (internals && "H" in internals) internals.H = previous;
    else if (internals?.ReactCurrentDispatcher) internals.ReactCurrentDispatcher.current = previous;
  }

  await start(offer);
  return notices;
}

/* ---------------------------------------------------------------------- tests */

const fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function respondWith(body: unknown, ok = true, status = ok ? 200 : 402) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return { ok, status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

/**
 * The page the overlay opens over: the `lang` the nearest ancestor of `#main` carries and the
 * `color-scheme` `#main` computes to. Only the three DOM reads `use-checkout` makes exist.
 */
const page = { lang: "en", scheme: "dark" };

beforeEach(() => {
  fetchCalls.length = 0;
  paddle.opened.length = 0;
  paddle.eventCallback = null;
  paddle.init = { Checkout: { open: (args: unknown) => paddle.opened.push(args) } };
  session.token = "session-token";
  page.lang = "en";
  page.scheme = "dark";
  const main = { closest: (selector: string) => (selector === "[lang]" ? { getAttribute: () => page.lang } : null) };
  vi.stubGlobal("document", { getElementById: (id: string) => (id === "main" ? main : null), documentElement: main });
  vi.stubGlobal("getComputedStyle", () => ({ colorScheme: page.scheme }));
  respondWith({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("checkout", () => {
  it("asks the server for nothing until there is a session", async () => {
    session.token = null;
    const notices = await runCheckout("credit_starter");

    expect(fetchCalls).toHaveLength(0);
    expect(paddle.opened).toHaveLength(0);
    expect(notices.join(" ")).toMatch(/sign in/i);
  });

  it("sends an offer code and never a price", async () => {
    respondWith({
      clientToken: "ct", environment: "sandbox",
      offer: { priceId: "pri_123", label: "Starter" }, customData: { u: "1" },
    });

    await runCheckout("credit_starter");

    expect(fetchCalls).toHaveLength(1);
    const body = JSON.parse(String(fetchCalls[0].init.body));
    expect(body).toEqual({ offerCode: "credit_starter" });
    // The allow-list belongs to the server. A client that can name a price can name any price.
    expect(JSON.stringify(body)).not.toMatch(/pri_|price|amount|\$/i);
  });

  it("carries the session as a bearer token", async () => {
    respondWith({ clientToken: "ct", environment: "sandbox", offer: { priceId: "p" }, customData: {} });
    await runCheckout("credit_starter");
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer session-token");
  });

  for (const [missing, body] of [
    ["clientToken", { environment: "sandbox", offer: { priceId: "p" }, customData: {} }],
    ["environment", { clientToken: "ct", offer: { priceId: "p" }, customData: {} }],
    ["priceId", { clientToken: "ct", environment: "sandbox", offer: {}, customData: {} }],
    ["customData", { clientToken: "ct", environment: "sandbox", offer: { priceId: "p" } }],
  ] as const) {
    it(`refuses to open when the response is missing ${missing}`, async () => {
      respondWith(body);
      const notices = await runCheckout("credit_starter");

      // A partial response is a failure, not something to route around.
      expect(paddle.opened).toHaveLength(0);
      expect(notices.join(" ")).toMatch(/unavailable/i);
    });
  }

  it("refuses to open on a non-ok response even when the body looks complete", async () => {
    respondWith({ clientToken: "ct", environment: "sandbox", offer: { priceId: "p" }, customData: {} }, false);
    await runCheckout("credit_starter");
    expect(paddle.opened).toHaveLength(0);
  });

  it("changes no entitlement when Paddle fails to initialize", async () => {
    paddle.init = null;
    respondWith({ clientToken: "ct", environment: "sandbox", offer: { priceId: "p" }, customData: {} });
    const notices = await runCheckout("credit_starter");
    expect(paddle.opened).toHaveLength(0);
    expect(notices.join(" ")).toMatch(/could not initialize/i);
  });

  it("never tells the user that access is live", async () => {
    respondWith({
      clientToken: "ct", environment: "sandbox",
      offer: { priceId: "pri_123", label: "Starter" }, customData: { u: "1" },
    });

    const notices = await runCheckout("credit_starter");
    const said = notices.join(" ").toLowerCase();

    expect(paddle.opened).toHaveLength(1);
    // Opening a checkout grants nothing. Only a signed, idempotently persisted webhook does.
    expect(said).toMatch(/webhook/);
    expect(said).not.toMatch(/access (is )?(now |now\b)?(live|active|granted|enabled)/);
    expect(said).not.toMatch(/credits (added|granted|available now)/);
  });

  it("labels production checkout as live without claiming an entitlement", async () => {
    respondWith({
      clientToken: "ct", environment: "production",
      offer: { priceId: "pri_123", label: "Starter" }, customData: { u: "1" },
    });

    const notices = await runCheckout("credit_starter");
    const said = notices.join(" ").toLowerCase();

    expect(paddle.opened).toHaveLength(1);
    expect(said).toMatch(/live checkout opened/);
    expect(said).toMatch(/webhook/);
    expect(said).not.toMatch(/sandbox checkout opened/);
  });
});

/*
  Journey A1, U1 (JOURNEY-MAP-2026-10-17 D-03). `/api/billing/checkout` refuses with six codes a
  customer can meet, and the hook used to print each one raw: "Checkout is unavailable
  (BILLING_LAUNCH_PENDING)." Each now reads as the sentence the failure-copy table holds for it.
*/
describe("checkout refusals", () => {
  const REFUSALS = [
    ["BILLING_LAUNCH_PENDING", 503],
    ["CUSTOMER_DATA_NOT_ENABLED_FOR_WORKSPACE", 403],
    ["PROCESSING_QUALIFICATION_NOT_BILLABLE", 403],
    ["BILLING_OFFER_CONTACT_REQUIRED", 403],
    ["PILOT_ACCESS_REQUIRED", 403],
    ["BILLING_NOT_CONFIGURED", 503],
  ] as const;

  for (const [code, status] of REFUSALS) {
    it(`turns ${code} into a sentence with no raw code`, async () => {
      respondWith({ code }, false, status);
      const notices = await runCheckout("observer_access");

      expect(paddle.opened).toHaveLength(0);
      expect(notices).toEqual([`Checkout is unavailable. ${failureSentence(code, status)}`]);
      expect(notices[0]).not.toContain(code);
      expect(notices[0]).not.toContain("Reference");
      expect(notices[0], "no parenthetical code or status").not.toMatch(/\([A-Z0-9_]+\)|\(\d{3}\)/);
    });
  }

  it("still names a code it has no sentence for, as a reference rather than dropping it", async () => {
    respondWith({ code: "BILLING_OFFER_INVALID" }, false, 400);
    const notices = await runCheckout("observer_access");

    expect(paddle.opened).toHaveLength(0);
    expect(notices[0]).toBe("Checkout is unavailable. This request was refused. (Reference BILLING_OFFER_INVALID.)");
  });

  it("says nothing was opened or charged when an ok response is incomplete", async () => {
    respondWith({ code: "CHECKOUT_READY", environment: "sandbox", offer: { priceId: "p" }, customData: {} });
    const notices = await runCheckout("observer_access");

    expect(paddle.opened).toHaveLength(0);
    expect(notices[0]).toMatch(/nothing was opened or charged/);
    expect(notices[0]).not.toContain("CHECKOUT_READY");
  });
});

/*
  Journey A11 (D-09). The overlay was always `theme: "dark", locale: "en"`. It follows the page now:
  the `lang` above `#main` and the `color-scheme` `#main` computes to.
*/
describe("checkout overlay look", () => {
  const ready = { clientToken: "ct", environment: "sandbox", offer: { priceId: "pri_1" }, customData: { u: "1" } };
  const settingsOf = (opened: unknown) => (opened as { settings: Record<string, string> }).settings;

  for (const [where, lang, scheme, expected] of [
    ["/ko on a paper page", "ko", "light", { displayMode: "overlay", theme: "light", locale: "ko" }],
    ["/pricing on a paper page", "en", "light", { displayMode: "overlay", theme: "light", locale: "en" }],
    ["the dark workspace", "en", "dark", { displayMode: "overlay", theme: "dark", locale: "en" }],
    ["a ko-KR page", "ko-KR", "dark", { displayMode: "overlay", theme: "dark", locale: "ko" }],
    ["a page that declares no scheme", "en", "normal", { displayMode: "overlay", theme: "light", locale: "en" }],
  ] as const) {
    it(`matches ${where}`, async () => {
      page.lang = lang;
      page.scheme = scheme;
      respondWith(ready);
      await runCheckout("observer_access");

      expect(paddle.opened).toHaveLength(1);
      expect(settingsOf(paddle.opened[0])).toEqual(expected);
    });
  }

  it("sends only the two languages the site is written in", async () => {
    page.lang = "ja";
    respondWith(ready);
    await runCheckout("observer_access");

    expect(settingsOf(paddle.opened[0]).locale).toBe("en");
  });

  it("opens nothing when the page cannot be read, and says no entitlement changed", async () => {
    vi.stubGlobal("getComputedStyle", () => { throw new Error("no layout"); });
    respondWith(ready);
    const notices = await runCheckout("observer_access");

    expect(paddle.opened).toHaveLength(0);
    expect(notices.join(" ")).toMatch(/could not be opened\. No entitlement was changed/);
  });
});


/*
  Journey A4, U7 wiring (JOURNEY-MAP-2026-10-17 D-04). After `checkout.completed` the hook reads
  /api/billing/status again within the caps of `entitlement-wait.ts` and ends in a stated outcome.
  Nothing is read before Paddle reports the payment.
*/
describe("waiting for the entitlement after checkout", () => {
  const ready = { clientToken: "ct", environment: "sandbox", offer: { priceId: "pri_1", label: "Developer" }, customData: { u: "1" } };
  const inactive = {
    accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0,
    billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null,
  } satisfies BillingStatusAccount;
  const active = { ...inactive, accessPlan: "observer_access", subscriptionStatus: "active", creditBalance: 2_000, paddleCustomerId: "ctm_1" };

  /** The checkout POST answers `ready`; each billing-status read takes the next answer, the last one repeating. */
  function serve(statusAnswers: Array<{ ok: boolean; status: number; body: unknown }>) {
    let reads = 0;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url) !== "/api/billing/status") return { ok: true, status: 200, json: async () => ready } as unknown as Response;
      const answer = statusAnswers[Math.min(reads++, statusAnswers.length - 1)];
      return { ok: answer.ok, status: answer.status, json: async () => answer.body } as unknown as Response;
    }) as unknown as typeof fetch;
  }
  const statusReads = () => fetchCalls.filter((call) => call.url === "/api/billing/status");

  async function completeCheckout(statusAnswers: Parameters<typeof serve>[0]) {
    serve(statusAnswers);
    const settled: EntitlementWaitResult[] = [];
    const notices = await runCheckout("observer_access", (wait) => settled.push(wait));
    expect(paddle.opened).toHaveLength(1);
    vi.useFakeTimers();
    paddle.eventCallback?.({ name: "checkout.completed" });
    await vi.advanceTimersByTimeAsync(120_000);
    return { notices, settled };
  }

  it("reads nothing before Paddle reports the payment, and nothing on other Paddle events", async () => {
    serve([{ ok: true, status: 200, body: { account: active } }]);
    await runCheckout("observer_access");
    vi.useFakeTimers();
    paddle.eventCallback?.({ name: "checkout.closed" });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(statusReads()).toHaveLength(0);
  });

  it("stops reading once the plan is active, says so and hands the account to the page", async () => {
    const { notices, settled } = await completeCheckout([
      { ok: true, status: 200, body: { account: inactive } },
      { ok: true, status: 200, body: { account: active } },
    ]);

    expect(statusReads()).toHaveLength(2);
    expect((statusReads()[0].init.headers as Record<string, string>).authorization).toBe("Bearer session-token");
    expect(notices.at(-2)).toMatch(/remain pending until the signed webhook is persisted/);
    expect(notices.at(-1)).toBe("Developer access is active. The signed webhook was persisted.");
    expect(settled).toEqual([{ outcome: "active", account: active }]);
  });

  it("ends in the pending sentence when the webhook never arrives, after five reads", async () => {
    const { notices, settled } = await completeCheckout([{ ok: true, status: 200, body: { account: inactive } }]);

    expect(statusReads()).toHaveLength(5);
    expect(notices.at(-1)).toBe(ENTITLEMENT_PENDING_SENTENCE);
    expect(notices.join(" ")).not.toMatch(/access is active/i);
    expect(settled).toEqual([{ outcome: "pending", account: inactive }]);
  });

  it("does not take a refused status read for an arrival", async () => {
    const { notices, settled } = await completeCheckout([{ ok: false, status: 503, body: { code: "BILLING_STORE_UNAVAILABLE", account: active } }]);

    expect(statusReads()).toHaveLength(5);
    expect(notices.at(-1)).toBe(ENTITLEMENT_PENDING_SENTENCE);
    expect(settled).toEqual([{ outcome: "pending", account: null }]);
  });
});
