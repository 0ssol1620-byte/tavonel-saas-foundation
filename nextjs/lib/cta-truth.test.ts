import { readdirSync, readFileSync } from "node:fs";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { servedAvailability as served } from "./checkout-intent";

/*
  CTA truth, one table per commercial state (UX program 2026-10-17, lane P2-10: UX-PLAN §6.2 and
  §6.3, JOURNEY-MAP defects D-02 and D-07 / work items A2 and A5, PHASE1-CRITIC V20 and §3.1).

  Every surface that offers an action is rendered for real, in each of the three states, and the
  label and href of each action are read back out of the markup. Nothing here re-derives the
  answer from the same function the page calls: the expectations are literals.

    S0  account creation closed, customer data closed       (any launch gate dissents)
    S1  account creation open, customer data closed         (today: vercel.json + main's constant)
    S2  live commerce: every launch gate and customer data open

  Today is S1, not S0 (PHASE1-CRITIC V20): `/api/status/v2` reports `createAccount.enabled: true`.
  S0 and S1 must print the same actions, which is the point -- opening account creation does not
  open anything a buyer can act on with their own files.

  The S1 rows are main's labels and hrefs at 4c80bb30, byte for byte; this file passed every S0 and
  S1 row against main's components before P2-10 changed any of them. The one intended difference
  is the sign-in page's checkout-intent notice (JOURNEY-MAP D-02, A2): main promised "Checkout
  opens by itself once you are in" whatever `purchasePlan` said, and that sentence is now rendered
  only where a plan can actually be bought.

  S2 is reached by opening `activationPolicy.customerData` inside this file only. The Home close keeps
  the sample action in S2 too. The header's action is the start in every state (founder 2026-11-10):
  the access action while closed, Start free in S2.
*/

/* The route the header is rendered on. "/" everywhere except the self-link check below. */
const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

const policy = vi.hoisted(() => ({ customerDataOpen: false }));
vi.mock("./activation-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./activation-policy")>();
  return {
    ...actual,
    activationPolicy: {
      ...actual.activationPolicy,
      get customerData() {
        return { ...actual.activationPolicy.customerData, enabled: policy.customerDataOpen };
      },
    },
  };
});

type State = "S0" | "S1" | "S2";

/* `nextjs/vercel.json`'s three launch flags, a production runtime, and a configured auth client. */
const LIVE_ENV = {
  VERCEL_ENV: "production",
  COMMERCIAL_MODE: "live",
  TAVONEL_BILLING_LAUNCH_APPROVED: "true",
  ACCESS_MODE: "self_service",
  PADDLE_SANDBOX: "false",
  NEXT_PUBLIC_SUPABASE_URL: "https://cta-truth.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "cta-truth-anon",
} as const;

async function enter(state: State) {
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(LIVE_ENV)) vi.stubEnv(name, value);
  // S0: the account gate dissents. `readAccessMode` reads anything but self_service as pilot.
  if (state === "S0") vi.stubEnv("ACCESS_MODE", "pilot");
  policy.customerDataOpen = state === "S2";
  // Module-scope reads (pricing gates, prerendered actions) must see this state, not the last one.
  vi.resetModules();
}

afterAll(() => {
  vi.unstubAllEnvs();
  policy.customerDataOpen = false;
});

type Action = { href: string; label: string };

function decode(text: string) {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every anchor in a fragment, in document order, as the label a reader sees and its href. */
function anchors(html: string): Action[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, body]) => ({
    href: decode(/\bhref="([^"]*)"/.exec(attributes)?.[1] ?? ""),
    label: decode(body.replace(/<span aria-hidden="true">[\s\S]*?<\/span>/g, "")),
  }));
}

/** The markup from `marker` to the end of the element that opens there. */
function block(html: string, marker: string, tag: string): string {
  const start = html.indexOf(marker);
  expect(start, `marker ${marker} is rendered`).toBeGreaterThanOrEqual(0);
  const open = html.lastIndexOf(`<${tag}`, start);
  let depth = 0;
  const pattern = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  pattern.lastIndex = open;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    depth += match[0] === `</${tag}>` ? -1 : 1;
    if (depth === 0) return html.slice(open, match.index + match[0].length);
  }
  throw new Error(`unclosed <${tag}> at ${marker}`);
}

/* Every page rendered for the current state, so the self-serve scan reads all of their anchors. */
let rendered: string[] = [];

function render(component: FunctionComponent<Record<string, unknown>>, props: Record<string, unknown> = {}) {
  const html = renderToStaticMarkup(createElement(component, props));
  rendered.push(html);
  return html;
}

/* --------------------------------------------------------------------- the surfaces */

async function header(): Promise<Action> {
  const { PublicSiteHeader } = await import("../components/public-site-chrome");
  const actions = anchors(block(render(PublicSiteHeader, {}), 'class="nav-actions"', "span"));
  return actions[actions.length - 1]!;
}

/*
  V34 (decision 2, 2026-11-16). The shell's filled action reads "Create your World" in every state; where it
  goes is what `primaryCallToAction()` computes, so the label is the blueprint's and the gating stays ours.
  Read out of the rendered header, by its analytics hook, not recomputed.
*/
async function v34Header(): Promise<Action> {
  const { default: SiteHeader } = await import("../components/v34/shell/site-header");
  const html = render(SiteHeader as FunctionComponent<Record<string, unknown>>);
  const start = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].find(([, attributes]) => /data-analytics="header-start"/.test(attributes!));
  expect(start, "the V34 header renders the start action").toBeDefined();
  return anchors(start![0])[0]!;
}

async function home(korean: boolean): Promise<{ primary: Action; secondary: Action; close: Action }> {
  const { default: LandingPage } = await import("../components/landing-v2/landing-page");
  const html = render(LandingPage, { korean });
  const [primary, secondary] = anchors(block(html, 'data-scene-actions="1"', "div"));
  const close = anchors(block(html, 'data-scene-next="start"', "a"))[0]!;
  return { primary: primary!, secondary: secondary!, close };
}

/** The plan actions on /pricing, in card order: Evaluation (Free once open), Personal, Developer, Team, Business, Enterprise. */
async function pricing(): Promise<Action[]> {
  const { default: PricingPage } = await import("../app/pricing/page");
  const html = render(PricingPage as FunctionComponent<Record<string, unknown>>);
  return [...html.matchAll(/<div class="plan-action">/g)].map((match) =>
    anchors(block(html.slice(match.index), 'class="plan-action"', "div"))[0]!,
  );
}

/** /explore: the stage header's exit links, and the closing scene's primary action. */
async function explore(): Promise<{ exits: Action[]; close: Action }> {
  const { default: ExplorePage } = await import("../app/explore/page");
  const html = render(ExplorePage as FunctionComponent<Record<string, unknown>>);
  const exits = anchors(block(html, 'aria-label="TAVONEL"', "nav"));
  const close = anchors(block(html, 'data-primary="1"', "a"))[0]!;
  return { exits, close };
}

/*
  /login's notice for a reader who arrived with `?next=checkout&offer=personal`. The page passes
  `purchasePlan.enabled` from `/api/status/v2`; this passes the same field from the same builder, in
  the same environment. The availability is the one /login's server page hands its client (WO-CAT-2 L1),
  read from that page in this environment. The purchasable half of the notice is rendered in "the
  checkout-intent notice" and "/login promises a checkout only ..." below, through the catalog seam.
*/
async function login(): Promise<{ text: string; links: Action[] }> {
  const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
  const { default: LoginPage } = await import("../app/login/page");
  const purchaseOpen = (await status()).purchasePlan;
  const html = render(CheckoutIntentNotice as FunctionComponent<Record<string, unknown>>, {
    offer: "personal",
    purchaseOpen,
    availability: (LoginPage as () => { props: { availability: Record<string, string> } })().props.availability.personal,
  });
  return { text: decode(html), links: anchors(html) };
}

async function status() {
  const { readPublicStatusV2 } = await import("./public-status");
  const { isLiveCommerce } = await import("./commercial-state");
  const actions = readPublicStatusV2().availableActions;
  return {
    createAccount: actions.createAccount.enabled,
    purchasePlan: actions.purchasePlan.enabled,
    liveCommerce: isLiveCommerce(),
  };
}

/* ------------------------------------------------------------------- the expectations */

const SAMPLE = { href: "/explore", label: "Open the compiled sample" };
const SAMPLE_KO = { href: "/explore", label: "컴파일된 샘플 열기" };

/*
  Main at 4c80bb30. S0 is the same table: the account gate opens no action a buyer can take.
  Founder 2026-11-10: the header's action is the visitor's start, not the public sample, and on Home the document
  entry is the hero's primary with the sample as its secondary link. Closed, the start is the access action.
*/
const CLOSED = {
  header: { href: "/contact", label: "Request access" },
  home: {
    primary: { href: "/evaluation", label: "Evaluate your documents" },
    secondary: SAMPLE,
    close: SAMPLE,
  },
  homeKo: {
    primary: { href: "/ko/evaluation", label: "내 문서 평가" },
    secondary: SAMPLE_KO,
    close: SAMPLE_KO,
  },
  pricing: [
    { href: "/explore", label: "Explore a Compiled World" },
    // Catalog v2 (PB-2026-11-V22, CAT-D1): DELIVERED is empty, so every paid plan is requested in every state.
    { href: "/contact?plan=Personal", label: "Request Personal access" },
    { href: "/contact?plan=Developer", label: "Request Developer access" },
    { href: "/contact?plan=Team", label: "Request Team access" },
    { href: "/contact?plan=Business", label: "Request Business access" },
    { href: "/contact?plan=Enterprise", label: "Scope an Enterprise pilot" },
  ],
  explore: {
    exits: [
      { href: "/product", label: "Product" },
      { href: "/pricing", label: "Pricing" },
      { href: "/contact", label: "Request access" },
    ],
    close: { href: "/contact", label: "Request access" },
  },
  /*
    The one row that is not main's (JOURNEY-MAP D-02, A2). Main rendered OPEN_INTENT below here
    too, promising a checkout that `purchasePlan: false` refuses. The closed notice says the plan
    is not sold online and offers the contact path `/pricing` itself offers for Personal.
  */
  login: {
    text: "Personal is not sold online today. Nothing is charged by signing in. Request Personal access",
    links: [{ href: "/contact?plan=Personal", label: "Request Personal access" }],
  },
} as const;

/*
  The notice rendered only where a plan can be bought. Conversion pass 2026-11-09 (funnel audit fix 8): it
  carries the deal from the billing catalog and the step before checkout, in place of main's "signed webhook".
*/
const OPEN_INTENT =
  "Personal is held for you. $29/month for 500 standard pages, with a full refund within 14 days if you have used fewer than 50 of them. Paddle is the merchant of record. Sign in and accept the processing terms, and checkout opens by itself. Nothing is charged by signing in.";

const V34_CLOSED = { href: "/contact", label: "Create your World" };

const TABLE = {
  S0: { ...CLOSED, v34Header: V34_CLOSED },
  S1: { ...CLOSED, v34Header: V34_CLOSED },
  S2: {
    ...CLOSED,
    v34Header: { href: "/login", label: "Create your World" },
    header: { href: "/login", label: "Start free" },
    home: { ...CLOSED.home, primary: { href: "/login", label: "Start free" } },
    homeKo: { ...CLOSED.homeKo, primary: { href: "/login", label: "사용 신청하기" } },
    // Live commerce opens the Free start. It opens no paid plan: the plans' capabilities are not delivered (CAT-D1).
    pricing: [{ href: "/login", label: "Start free" }, ...CLOSED.pricing.slice(1)],
    // /explore follows the switch too (JOURNEY-MAP D-07, A5).
    explore: {
      exits: [CLOSED.explore.exits[0], CLOSED.explore.exits[1], { href: "/login", label: "Start free" }],
      close: { href: "/login", label: "Start free — 3 files, no card" },
    },
  },
} as const;

/* UX-PLAN §6.3 rule 1: none of these may be offered before live commerce and founder-approved copy. */
const SELF_SERVE = /free|start with your files|sign up|trial|내 자료로 시작|사용 신청/i;

const STATES: State[] = ["S0", "S1", "S2"];

/* Each state re-imports module trees after a reset; under the full suite's load that exceeds 5 s. */
const RENDER_TIMEOUT = 180_000;

describe("each environment is the state it is named for", () => {
  it.each([
    ["S0", { createAccount: false, purchasePlan: false, liveCommerce: false }],
    ["S1", { createAccount: true, purchasePlan: false, liveCommerce: false }],
    ["S2", { createAccount: true, purchasePlan: true, liveCommerce: true }],
  ] as const)("%s", async (state, expected) => {
    await enter(state);
    expect(await status()).toEqual(expected);
  }, RENDER_TIMEOUT);
});

/** One render of every surface per state: a module reset re-imports the whole page tree. */
async function surfaces(state: State) {
  await enter(state);
  rendered = [];
  const seen = {
    header: await header(),
    v34Header: await v34Header(),
    home: await home(false),
    homeKo: await home(true),
    pricing: await pricing(),
    explore: await explore(),
    login: await login(),
  };
  return { ...seen, labels: rendered.flatMap(anchors).map((action) => action.label) };
}

describe.each(STATES)("CTA truth in %s", (state) => {
  const expected = TABLE[state];
  let seen: Awaited<ReturnType<typeof surfaces>>;
  beforeAll(async () => { seen = await surfaces(state); }, RENDER_TIMEOUT);

  it("header filled action", () => {
    expect(seen.header).toEqual(expected.header);
  });

  it("V34 header filled action: the label is Create your World, the destination is the computed start", () => {
    expect(seen.v34Header).toEqual(expected.v34Header);
  });

  /*
    An action may not point at its own page (PR #235 review R1/R2, S2). The browser test of this ran only where the start
    is /contact, and CI's width projects serve live commerce, where the start is /login and /login has no public header,
    so it was skipped in every run. Here it runs in every state: on the start's own route the header keeps Sign in and
    offers no start. The header test above, on "/", is its failure path -- the same render there does carry the start.
  */
  it("the header offers no start on the start's own page", async () => {
    const { PublicSiteHeader } = await import("../components/public-site-chrome");
    for (const start of [expected.header]) {
      nav.path = start.href;
      try {
        const html = renderToStaticMarkup(createElement(PublicSiteHeader, {}));
        const actions = anchors(block(html, 'class="nav-actions"', "span"));
        expect(html, `${start.href}: no header start`).not.toContain('data-analytics="header-start"');
        expect(actions.map((action) => action.label), `${start.href}: the start goes`).not.toContain(start.label);
        expect(actions.at(-1), `${start.href}: Sign in stays, last`).toEqual({ href: "/login", label: "Sign in" });
      } finally {
        nav.path = "/";
      }
    }
  }, RENDER_TIMEOUT);

  it("Home hero primary, hero secondary and close", () => {
    expect(seen.home).toEqual(expected.home);
    expect(seen.homeKo).toEqual(expected.homeKo);
  });

  it("/pricing plan actions", () => {
    expect(seen.pricing).toEqual(expected.pricing);
  });

  it("/ko redirects with a 308 to its English path", () => {
    const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
    expect(config).toContain('{ source: "/ko", destination: "/", permanent: true }');
    expect(config).toContain('{ source: "/ko/:path*", destination: "/:path*", permanent: true }');
  });

  it("/explore exits and close", () => {
    expect(seen.explore).toEqual(expected.explore);
  });

  it("/login checkout-intent notice", () => {
    expect(seen.login).toEqual(expected.login);
  });

  if (state === "S2") {
    // The scan below is only worth its zero if it can see a self-serve label when one is offered.
    it("offers the self-serve labels the scan looks for", () => {
      expect(seen.labels.filter((label) => SELF_SERVE.test(label))).toEqual(
        expect.arrayContaining(["Start free", "사용 신청하기"]),
      );
    });
  } else {
    it("offers no self-serve label and promises no checkout anywhere it renders", () => {
      expect(seen.labels.length, "the scan read the pages' anchors").toBeGreaterThan(100);
      expect(seen.labels.filter((label) => SELF_SERVE.test(label))).toEqual([]);
      expect(SELF_SERVE.test(seen.login.text)).toBe(false);
      expect(seen.login.text).not.toContain("Checkout opens by itself");
    });
  }
});

describe("the checkout-intent notice", () => {
  it("promises nothing before the deployment has answered", async () => {
    const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
    for (const availability of ["purchasable", "request_access", "retired"] as const) {
      expect(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "personal", purchaseOpen: null, availability: served(availability) }))).toBe("");
    }
  }, RENDER_TIMEOUT);

  it("names the plan it was reached for, closed or open", async () => {
    const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
    const closed = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "team", purchaseOpen: false, availability: served("request_access") })));
    expect(closed).toBe("Team is not sold online today. Nothing is charged by signing in. Request Team access");
    // B-07 / CLM-023: a plan the server computed as request_access is not sold online even where the
    // deployment's purchase action is open, and the checkout it would promise answers 403 BILLING_OFFER_CONTACT_REQUIRED.
    const open = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "team", purchaseOpen: true, availability: served("request_access") })));
    expect(open).toBe("Team is not sold online today. Nothing is charged by signing in. Request Team access");
    expect(open).not.toContain("Checkout opens by itself");
    // The one plan the server says is purchasable, with the deployment's purchase action open, is held for the reader.
    const personal = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "personal", purchaseOpen: true, availability: served("purchasable") })));
    expect(personal).toBe(OPEN_INTENT);
    // Failure path: purchasable but the deployment's purchase action is closed promises nothing.
    const shut = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "personal", purchaseOpen: false, availability: served("purchasable") })));
    expect(shut).toBe("Personal is not sold online today. Nothing is charged by signing in. Request Personal access");
  }, RENDER_TIMEOUT);

  it("names no retired plan: a retired code in the address gets a sentence without its label", async () => {
    const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
    for (const offer of ["observer_access", "studio_access"] as const) {
      const text = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer, purchaseOpen: true, availability: served("retired") })));
      expect(text).toBe("That plan is not sold online. Nothing is charged by signing in. Request access");
      expect(text).not.toMatch(/2026-09|Developer|Team/);
    }
  }, RENDER_TIMEOUT);
});

/*
  Catalog v2 (PB-2026-11-V22, WO-CAT-2). /pricing buys exactly what the server computed as `purchasable` and
  requests everything else. The seam is the one the checkout route test uses: the catalog module with
  `planAvailability` handed a delivered set (here every capability, or none) -- and a v2 price env, which is
  the other half of the gate. Nothing in the page reads either.
*/
describe("catalog v2: /pricing buys only what the server computed as purchasable", () => {
  const PRICE = `pri_${"a".repeat(26)}`;
  afterEach(() => {
    vi.doUnmock("@/lib/billing-catalog");
  });

  async function pricingHtml({ delivered, personalPrice }: { delivered: boolean; personalPrice: boolean }) {
    await enter("S2");
    vi.doMock("@/lib/billing-catalog", async (original) => {
      const catalog = await original<typeof import("./billing-catalog")>();
      const all = new Set(Object.values(catalog.BILLING_OFFERS).flatMap((offer) => offer.requires));
      return {
        ...catalog,
        planAvailability: (code: never, configured: never) =>
          catalog.planAvailability(code, configured, delivered ? all : new Set()),
      };
    });
    if (personalPrice) vi.stubEnv("PADDLE_PRICE_PERSONAL", PRICE);
    const { default: PricingPage } = await import("../app/pricing/page");
    return renderToStaticMarkup(createElement(PricingPage as FunctionComponent<Record<string, unknown>>));
  }

  const planActions = (html: string) => anchors(block(html, 'class="plans"', "div")).filter((action) => /^(Buy|Request) /.test(action.label));
  const offers = (html: string) => {
    const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]!));
    return ld.flatMap((doc) => (doc["@graph"] ?? []) as Array<{ "@type": string; name?: string; availability?: string }>).filter((node) => node["@type"] === "Offer");
  };

  it("with a delivered line and a configured price, exactly one Buy link: Personal", async () => {
    const html = await pricingHtml({ delivered: true, personalPrice: true });
    const actions = planActions(html);
    expect(actions.filter((action) => action.label.startsWith("Buy"))).toEqual([
      { href: "/login?next=checkout&offer=personal", label: "Buy Personal — $29/month" },
    ]);
    // The other three paid plans have no price env here, so they stay requests.
    expect(actions.filter((action) => action.label.startsWith("Request")).map((action) => action.label)).toEqual([
      "Request Developer access", "Request Team access", "Request Business access",
    ]);
    // JSON-LD names exactly the plan that can be bought.
    expect(offers(html).map((node) => [node.name, node.availability])).toEqual([["Personal", "https://schema.org/InStock"]]);
  }, RENDER_TIMEOUT);

  it("removing the price env flips Personal to Request access: no Buy link, no Offer", async () => {
    const html = await pricingHtml({ delivered: true, personalPrice: false });
    expect(planActions(html).map((action) => action.label)).toEqual([
      "Request Personal access", "Request Developer access", "Request Team access", "Request Business access",
    ]);
    expect(offers(html)).toEqual([]);
  }, RENDER_TIMEOUT);

  it("a configured price does not open a plan whose line is not delivered", async () => {
    const html = await pricingHtml({ delivered: false, personalPrice: true });
    expect(planActions(html).some((action) => action.label.startsWith("Buy"))).toBe(false);
    expect(html).not.toContain("Buy Personal");
    expect(offers(html)).toEqual([]);
  }, RENDER_TIMEOUT);

  it("no body renders an overage figure next to a Buy action, and no plan card names automation, SSO, an SLA or federation", async () => {
    for (const personalPrice of [true, false]) {
      const html = await pricingHtml({ delivered: true, personalPrice });
      const start = html.indexOf('id="pricing-overage-title"');
      expect(start, "the overage table is rendered").toBeGreaterThan(0);
      const overage = html.slice(start, html.indexOf("</table>", start));
      for (const rate of ["$0.04 / unit", "$0.006 / unit", "$0.20 / GB-month", "$15 / seat-month"]) expect(decode(overage)).toContain(rate);
      expect(decode(overage), "the overage rows offer Request access and nothing to buy").not.toMatch(/\bBuy\b/);
      expect(decode(overage)).toContain("Request access");
      expect(decode(block(html, 'class="plans"', "div"))).not.toMatch(/automation|\bSSO\b|\bSLA\b|federation/i);
      // WO-CAT-2 N4: KQU is defined in its own row, so the unit is never shown undefined.
      const kquRow = [...overage.matchAll(/<tr\b[\s\S]*?<\/tr>/g)].map((row) => decode(row[0])).find((row) => row.startsWith("KQU"));
      expect(kquRow).toContain("A KQU is one bounded knowledge retrieval request.");
      // N6: a meter is not a plan. Every overage row's Request access goes to the contact page with no plan named.
      expect(anchors(overage)).toEqual(Array.from({ length: 4 }, () => ({ href: "/contact", label: "Request access" })));
    }
  }, RENDER_TIMEOUT);

  /*
    WO-CAT-2 N6. No rendered link names a plan the contact form would not keep as given (the L3 allow-list, read through
    the form's own `planIntentFrom`): on /pricing in every state of the seam, and in /login's notice for every offer.
  */
  it("no rendered link carries a plan value outside the contact form's allow-list", async () => {
    const { planIntentFrom } = await import("../components/contact-form");
    const planValues = (html: string) => anchors(html).flatMap(({ href }) =>
      href.includes("?") ? new URLSearchParams(href.slice(href.indexOf("?") + 1)).getAll("plan") : []);
    const seen: string[] = [];
    for (const seam of [{ delivered: true, personalPrice: true }, { delivered: true, personalPrice: false }, { delivered: false, personalPrice: false }]) {
      seen.push(...planValues(await pricingHtml(seam)));
    }
    const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
    const { BILLING_OFFERS } = await import("./billing-catalog");
    for (const offer of Object.keys(BILLING_OFFERS) as Array<keyof typeof BILLING_OFFERS>) {
      // The availability the server gives each offer while no plan is sold: a retired offer is always "retired".
      const availability = served(BILLING_OFFERS[offer].status === "retired" ? "retired" : "request_access");
      seen.push(...planValues(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer, purchaseOpen: false, availability }))));
    }
    expect(seen.length, "the rule reads links that name a plan").toBeGreaterThan(0);
    expect(seen.filter((plan) => planIntentFrom(plan) !== plan)).toEqual([]);
    // Failure path: the values the overage rows used to carry are refused by the form.
    for (const meter of ["PCU", "KQU", "Storage", "Extra seat"]) expect(planIntentFrom(meter)).toBe("");
  }, RENDER_TIMEOUT);

  it("reads no price environment in the browser modules that render the plans and the checkout notice", () => {
    for (const path of ["../components/pricing-page-client.tsx", "../components/checkout-intent-notice.tsx", "../app/login/login-client.tsx", "../app/workspace/page.tsx"]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8"), path).not.toMatch(/process\.env|PADDLE_PRICE_/);
    }
  });

  /*
    WO-CAT-2 L4, N3: the class, not the four files. No browser module may resolve a plan's availability, or stand in
    for the server's answer with one of its own. How each source is told apart, and by what:
      - an offer code, a string literal, or a `PlanAvailability` constant: by the TYPE. `checkoutSellable` and
        `decideCheckoutResume` take only a `ServedAvailability` (or, for the workspace's hold, null: no answer, which
        claims nothing), so `tsc --noEmit` refuses them (the @ts-expect-error lines in checkout-intent.test.ts);
      - the server's own resolvers or brand (`planAvailability`, `readConfiguredBillingOffers`, `servedAvailability`)
        called in the browser: by this test, a call of any of them is a violation;
      - a cast that manufactures the brand: by this test, `as ServedAvailability` anywhere in a browser module, and
        any type escape (`as never`, `as any`, `as unknown`) in a browser module that calls either function;
      - a prop: allowed, because its type is `ServedAvailability` and only a server page can make one.
    What it cannot tell apart: a value typed `any` reaches the brand without a cast. That is how a route response
    arrives (`response.json()`), which the rule allows, but a browser module that read `any` from somewhere else
    (storage, an untyped parse) would pass too; neither the type nor this test traces data flow. No browser module
    does that today; the type escape rule above catches the explicit forms. Every "use client" module in the tree is
    read, plus the intent notice, which carries no directive and renders inside /login's client.
  */
  describe("no browser module resolves a plan's availability itself", () => {
    const root = new URL("../", import.meta.url);
    const walk = (dir: string): string[] => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? (entry.name === "node_modules" ? [] : walk(`${dir}${entry.name}/`))
        : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [`${dir}${entry.name}`] : []);
    const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const browserModules = ["app/", "components/", "lib/"].flatMap(walk)
      .filter((path) => /^\s*["']use client["']/.test(readFileSync(new URL(path, root), "utf8")))
      .concat("components/checkout-intent-notice.tsx");
    const violations = (path: string, source: string) => {
      const decides = /\b(?:checkoutSellable|decideCheckoutResume)\(/.test(source);
      return [
        ...["planAvailability", "readConfiguredBillingOffers", "servedAvailability"]
          .filter((name) => new RegExp(`\\b${name}\\(`).test(source)).map((name) => `${path}: calls ${name}`),
        ...[...source.matchAll(/\bas\s+ServedAvailability\b|<ServedAvailability>/g)].map((match) => `${path}: casts (${match[0]})`),
        ...(decides ? [...source.matchAll(/\bas\s+(?:never|any|unknown)\b/g)].map((match) => `${path}: type escape beside an availability decision (${match[0]})`) : []),
      ];
    };

    it("reads the modules it guards", () => {
      for (const path of ["app/login/login-client.tsx", "app/workspace/page.tsx", "components/pricing-page-client.tsx", "components/checkout-intent-notice.tsx"]) {
        expect(browserModules, path).toContain(path);
      }
    });

    it("finds no call that resolves availability in the browser", () => {
      expect(browserModules.flatMap((path) => violations(path, code(readFileSync(new URL(path, root), "utf8"))))).toEqual([]);
    });

    it("catches each shape the rule exists for (failure path)", () => {
      expect(violations("x.tsx", "const a = planAvailability(code);")).toEqual(["x.tsx: calls planAvailability"]);
      expect(violations("x.tsx", "readConfiguredBillingOffers()")).toEqual(["x.tsx: calls readConfiguredBillingOffers"]);
      // A client-side constant standing in for the server's answer, made the two ways the type leaves open.
      expect(violations("x.tsx", 'decideCheckoutResume(servedAvailability("purchasable"), purchaseOpen, resumeAccess)')).toEqual([
        "x.tsx: calls servedAvailability",
      ]);
      expect(violations("x.tsx", 'const HOLD = "purchasable" as ServedAvailability; decideCheckoutResume(HOLD, true, null)')).toEqual([
        "x.tsx: casts (as ServedAvailability)",
      ]);
      expect(violations("x.tsx", 'checkoutSellable("purchasable" as never, purchaseOpen)')).toEqual([
        "x.tsx: type escape beside an availability decision (as never)",
      ]);
      // What a browser module may pass: a prop, or (the workspace's hold) nothing.
      expect(violations("x.tsx", "checkoutSellable(availability[intent], purchaseOpen)")).toEqual([]);
      expect(violations("x.tsx", "decideCheckoutResume(null, purchaseOpen, resumeAccess)")).toEqual([]);
    });
  });
});

/*
  WO-CAT-2 L1. /login's availability is computed by its server page and handed to the client, the same answer /pricing
  renders. With the test seam opening Personal (every capability delivered, its price configured), the page hands
  "purchasable" down and the heading promises the checkout; removing the price takes the promise away again.
*/
describe("catalog v2: /login promises a checkout only for what the server computed as purchasable", () => {
  const PRICE = `pri_${"b".repeat(26)}`;
  afterEach(() => {
    vi.doUnmock("@/lib/billing-catalog");
  });

  async function loginAvailability({ delivered, personalPrice }: { delivered: boolean; personalPrice: boolean }) {
    await enter("S2");
    vi.doMock("@/lib/billing-catalog", async (original) => {
      const catalog = await original<typeof import("./billing-catalog")>();
      const all = new Set(Object.values(catalog.BILLING_OFFERS).flatMap((offer) => offer.requires));
      return {
        ...catalog,
        planAvailability: (code: never, configured: never) => catalog.planAvailability(code, configured, delivered ? all : new Set()),
      };
    });
    if (personalPrice) vi.stubEnv("PADDLE_PRICE_PERSONAL", PRICE);
    const { default: LoginPage } = await import("../app/login/page");
    const element = (LoginPage as () => { props: { availability: Record<string, string> } })();
    return element.props.availability;
  }

  const heading = async (availability: Record<string, string>, purchaseOpen: boolean | null) => {
    const { loginHeading } = await import("../app/login/login-client");
    return loginHeading({ intent: "personal", availability: availability as never, purchaseOpen, signedIn: false, recipe: null });
  };

  it("a purchasable Personal: 'One step before checkout.' and the held-for-you notice", async () => {
    const availability = await loginAvailability({ delivered: true, personalPrice: true });
    expect(availability.personal).toBe("purchasable");
    expect(availability.team).toBe("request_access");
    expect(availability.observer_access).toBe("retired");
    expect(await heading(availability, true)).toBe("One step before checkout.");
    const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
    const notice = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "personal", purchaseOpen: true, availability: availability.personal as never })));
    expect(notice).toContain("Personal is held for you.");
    // Purchase closed or not yet answered: no promise, whatever the plan.
    expect(await heading(availability, false)).toBe("Sign in to TAVONEL.");
    expect(await heading(availability, null)).toBe("Sign in to TAVONEL.");
  }, RENDER_TIMEOUT);

  it("the same page with no Personal price, or nothing delivered: a request, never the promise", async () => {
    for (const seam of [{ delivered: true, personalPrice: false }, { delivered: false, personalPrice: true }]) {
      const availability = await loginAvailability(seam);
      expect(availability.personal, JSON.stringify(seam)).toBe("request_access");
      expect(await heading(availability, true), JSON.stringify(seam)).toBe("Sign in to TAVONEL.");
    }
  }, RENDER_TIMEOUT);
});
