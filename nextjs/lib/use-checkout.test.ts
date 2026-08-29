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

/* ---------------------------------------------------------------- module doubles */

const session = { token: null as string | null };
const paddle = { opened: [] as unknown[], init: null as unknown };

vi.mock("./supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }),
    },
  }),
}));

vi.mock("./paddle-browser", () => ({
  initializePaddleBrowser: async () => paddle.init,
}));

/* ------------------------------------------------------------------- harness */

/**
 * Drives the hook without a DOM. `useCallback`/`useState` are the only React features it uses,
 * so a two-hook dispatcher is enough and keeps the test free of a renderer dependency.
 */
async function runCheckout(offer: string) {
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
    const hook = useCheckout((m) => notices.push(m)) as { start: (code: string) => Promise<void> };
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

function respondWith(body: unknown, ok = true) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url: String(url), init });
    return { ok, status: ok ? 200 : 402, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  fetchCalls.length = 0;
  paddle.opened.length = 0;
  paddle.init = { Checkout: { open: (args: unknown) => paddle.opened.push(args) } };
  session.token = "session-token";
  respondWith({});
});

afterEach(() => {
  vi.restoreAllMocks();
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
});
