/**
 * Journey A7 (JOURNEY-MAP-2026-10-17 §8.1, T1): a fake Paddle and a network fence for the
 * self-serve journey spec.
 *
 * Nothing here talks to Paddle, Supabase, Google or an object store. `fakePaddle` fulfils the
 * one script URL `lib/paddle-browser.ts` loads with a labelled stand-in that records what the
 * product asked of it; the fence records -- and aborts -- every request that would otherwise
 * leave the machine, so a journey that quietly reached a real host fails instead of passing.
 */

import type { BrowserContext, Page } from "@playwright/test";

/** The script `lib/paddle-browser.ts` appends. Same URL, so the shipped CSP is what is exercised. */
export const PADDLE_SCRIPT_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";

/** The fixture object store host. The shipped connect-src admits `*.r2.cloudflarestorage.com`. */
export const FIXTURE_R2_ORIGIN = "https://quarantine.fixture.r2.cloudflarestorage.com";

/** The fixture billing portal. `customer-portal.paddle.com/cpl_*` is the shape Paddle returns. */
export const FIXTURE_PORTAL_URL = "https://customer-portal.paddle.com/cpl_fixture_journey";

/*
  Public, configuration-only reads the local server may answer itself. Every other `/api/**`
  request that no spec route fulfilled is answered here with 404 MOCK_UNHANDLED, so the local
  server is never asked to verify the fixture token against the (non-existent) e2e Supabase
  project -- a lookup the browser fence could not see.
*/
const LOCAL_PUBLIC_READS = new Set(["/api/status", "/api/status/v2"]);

/**
 * Records and aborts every request bound for anywhere but the local test server.
 *
 * Installed on the context, so it runs after every page route: a host a spec replaced on purpose
 * (provider stub, Paddle script, fixture R2, portal stub) is fulfilled before it gets here, and
 * anything that reaches the fence is by definition a request nothing was meant to send.
 * WebSockets are fenced the same way.
 */
export async function installNetworkFence(context: BrowserContext, baseURL: string, records: string[] = []): Promise<string[]> {
  const local = new URL(baseURL).origin;
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === local) {
      if (url.pathname.startsWith("/api/") && !LOCAL_PUBLIC_READS.has(url.pathname)) {
        return route.fulfill({ status: 404, json: { code: "MOCK_UNHANDLED" } });
      }
      return route.fallback();
    }
    records.push(`${request.method()} ${url.origin}${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (socket) => {
    if (new URL(socket.url()).origin.replace(/^ws/, "http") === local) {
      socket.connectToServer();
      return;
    }
    records.push(`WS ${socket.url()}`);
    void socket.close();
  });
  return records;
}

/*
  The stand-in `window.Paddle`. It implements exactly the surface `lib/paddle-browser.ts` types --
  Environment.set, Initialize, Checkout.open -- and records each call. `eventCallback` is kept so a
  spec can play Paddle's side of the overlay (`emitPaddleEvent`); nothing is charged, and no event
  arrives unless a spec sends it.
*/
const FAKE_PADDLE_SCRIPT = `(() => {
  const state = { environments: [], initialized: [], opened: [], callback: null };
  Object.defineProperty(window, "__fakePaddle", { value: state });
  window.Paddle = {
    Environment: { set(environment) { state.environments.push(environment); } },
    Initialize(options) {
      state.initialized.push({ token: options.token });
      state.callback = typeof options.eventCallback === "function" ? options.eventCallback : null;
    },
    Checkout: { open(options) { state.opened.push(JSON.parse(JSON.stringify(options))); } },
  };
})();`;

export type FakePaddleCalls = {
  environments: string[];
  initialized: Array<{ token: string }>;
  opened: Array<{
    items: Array<{ priceId: string; quantity: number }>;
    customer?: { email: string };
    customData: Record<string, string>;
    settings: { displayMode: string; theme: string; locale: string };
  }>;
};

/** Serves the fake Paddle at the real script URL. `loads()` counts how often the page fetched it. */
export async function installFakePaddle(page: Page): Promise<{ loads: () => number }> {
  let loads = 0;
  await page.route(PADDLE_SCRIPT_URL, (route) => {
    loads += 1;
    return route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: FAKE_PADDLE_SCRIPT });
  });
  return { loads: () => loads };
}

/** What the page asked of Paddle so far; null when the script was never loaded. */
export function paddleCalls(page: Page): Promise<FakePaddleCalls | null> {
  return page.evaluate(() => {
    const state = (window as unknown as { __fakePaddle?: FakePaddleCalls }).__fakePaddle;
    return state ? { environments: state.environments, initialized: state.initialized, opened: state.opened } : null;
  });
}

/** Plays Paddle's side of the overlay: delivers one event to the callback the page registered. */
export function emitPaddleEvent(page: Page, name: string): Promise<boolean> {
  return page.evaluate((eventName) => {
    const state = (window as unknown as { __fakePaddle?: { callback: ((event: { name: string }) => void) | null } }).__fakePaddle;
    if (!state?.callback) return false;
    state.callback({ name: eventName });
    return true;
  }, name);
}

/** A labelled sandbox `CHECKOUT_READY`, in the shape `app/api/billing/checkout/route.ts` returns. */
export const SANDBOX_CHECKOUT_READY = {
  code: "CHECKOUT_READY",
  environment: "sandbox",
  clientToken: "test_fixture_journey_client_token",
  offer: { code: "observer_access", kind: "subscription", label: "Developer", priceId: "pri_01journeyfixture0000000000", credits: 2_000 },
  customer: { email: "audit-e2e@example.invalid" },
  customData: { tavonel_binding: "fixture-binding-not-signed", tavonel_offer: "observer_access" },
} as const;

/** The billing portal stub page a `PORTAL_READY` URL lands on. */
export async function installPortalStub(page: Page): Promise<string[]> {
  const visits: string[] = [];
  await page.route("https://customer-portal.paddle.com/**", (route) => {
    visits.push(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>portal stub</title><main>billing portal stub: no real account is shown here</main>",
    });
  });
  return visits;
}
