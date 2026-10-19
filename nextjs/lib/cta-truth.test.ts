import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

  S2 is reached by opening `activationPolicy.customerData` inside this file only. The header and
  the Home close keep the sample action in S2 too: the S2 hierarchy (UX F-5) is founder decision
  D-07 and waits for P2-37, so these rows pin today's code rather than the proposal. P2-37 updates
  the S2 rows when it sets that copy, citing D-07.
*/

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

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

async function header(korean: boolean): Promise<Action> {
  const { PublicSiteHeader } = await import("../components/public-site-chrome");
  const actions = anchors(block(render(PublicSiteHeader, { korean }), 'class="nav-actions"', "span"));
  return actions[actions.length - 1]!;
}

async function home(korean: boolean): Promise<{ primary: Action; secondary: Action; close: Action }> {
  const { default: LandingPage } = await import("../components/landing-v2/landing-page");
  const html = render(LandingPage, { korean });
  const [primary, secondary] = anchors(block(html, 'data-scene-actions="1"', "div"));
  const close = anchors(block(html, 'data-scene-next="start"', "a"))[0]!;
  return { primary: primary!, secondary: secondary!, close };
}

/** The four plan actions on /pricing, in card order: Evaluation, Developer, Team, Enterprise. */
async function pricing(): Promise<Action[]> {
  const { default: PricingPage } = await import("../app/pricing/page");
  const html = render(PricingPage as FunctionComponent<Record<string, unknown>>);
  return [...html.matchAll(/<div class="plan-action">/g)].map((match) =>
    anchors(block(html.slice(match.index), 'class="plan-action"', "div"))[0]!,
  );
}

/** /ko/pricing: the intro's access action, then each card's action in card order. */
async function koPricing(): Promise<{ intro: Action; cards: Action[] }> {
  const { default: KoreanPricingPage } = await import("../app/ko/pricing/page");
  const { pricingPlanId } = await import("../components/pricing-plan-overview");
  const html = render(KoreanPricingPage as FunctionComponent<Record<string, unknown>>);
  const cards = [0, 1, 2, 3].map((index) => {
    const [action] = anchors(block(html, `id="${pricingPlanId(index)}"`, "article")).slice(-1);
    return action!;
  });
  const intro = anchors(block(html, 'id="ko-pricing-title"', "div")).find((action) => action.href !== "/explore")!;
  return { intro, cards };
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
  /login's notice for a reader who arrived with `?next=checkout&offer=observer_access`. The page
  passes `purchasePlan.enabled` from `/api/status/v2`; this passes the same field from the same
  builder, in the same environment.
*/
async function login(): Promise<{ text: string; links: Action[] }> {
  const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
  const purchaseOpen = (await status()).purchasePlan;
  const html = render(CheckoutIntentNotice as FunctionComponent<Record<string, unknown>>, {
    offer: "observer_access",
    purchaseOpen,
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

/* Main at 4c80bb30. S0 is the same table: the account gate opens no action a buyer can take. */
const CLOSED = {
  header: SAMPLE,
  headerKo: SAMPLE_KO,
  home: {
    primary: SAMPLE,
    secondary: { href: "/evaluation", label: "Bring your own documents" },
    close: SAMPLE,
  },
  homeKo: {
    primary: SAMPLE_KO,
    secondary: { href: "/ko/evaluation", label: "내 문서 가져오기" },
    close: SAMPLE_KO,
  },
  pricing: [
    { href: "/explore", label: "Explore a Compiled World" },
    { href: "/contact?plan=Developer", label: "Request Developer access" },
    { href: "/contact?plan=Team", label: "Talk to us about Team" },
    { href: "/contact?plan=Enterprise", label: "Scope an Enterprise pilot" },
  ],
  koPricing: {
    intro: { href: "/ko/contact", label: "도입 상담하기" },
    cards: [
      { href: "/explore", label: "공개 World 살펴보기 (영문)" },
      { href: "/ko/contact?plan=Developer", label: "Developer 도입 상담" },
      { href: "/ko/contact?plan=Team", label: "Team 도입 상담" },
      { href: "/ko/contact?plan=Enterprise", label: "Enterprise 도입 상담" },
    ],
  },
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
    is not sold online and offers the contact path `/pricing` itself offers for Developer.
  */
  login: {
    text: "Developer is not sold online today. Nothing is charged by signing in. Request Developer access",
    links: [{ href: "/contact?plan=Developer", label: "Request Developer access" }],
  },
} as const;

/* Main's notice at 4c80bb30, word for word, now rendered only where a plan can be bought. */
const OPEN_INTENT =
  "Developer is held for you. Checkout opens by itself once you are in. Nothing is charged by signing in, and access changes only after a signed webhook is persisted.";

const TABLE = {
  S0: CLOSED,
  S1: CLOSED,
  S2: {
    ...CLOSED,
    home: { ...CLOSED.home, secondary: { href: "/login", label: "Start with your files" } },
    homeKo: { ...CLOSED.homeKo, secondary: { href: "/login", label: "내 자료로 시작하기" } },
    pricing: [
      { href: "/login", label: "Start free evaluation" },
      { href: "/login?next=checkout&offer=observer_access", label: "Get Developer access, via sign-in" },
      { href: "/contact?plan=Team", label: "Talk to us about Team" },
      { href: "/contact?plan=Enterprise", label: "Scope an Enterprise pilot" },
    ],
    /*
      /ko/pricing and /explore follow the switch now (JOURNEY-MAP D-07, A5). The Korean labels are
      the site's existing strings, not new pricing copy: the founder sets the S2 Korean pricing
      wording with D-07, in P2-37, before the switch moves.
    */
    koPricing: {
      intro: { href: "/login", label: "내 자료로 시작하기" },
      cards: [
        CLOSED.koPricing.cards[0],
        { href: "/login?next=checkout&offer=observer_access", label: "Developer · 내 자료로 시작하기" },
        CLOSED.koPricing.cards[2],
        CLOSED.koPricing.cards[3],
      ],
    },
    explore: {
      exits: [CLOSED.explore.exits[0], CLOSED.explore.exits[1], { href: "/login", label: "Start with your files" }],
      close: { href: "/login", label: "Start with your files" },
    },
    login: { text: OPEN_INTENT, links: [] },
  },
} as const;

/* UX-PLAN §6.3 rule 1: none of these may be offered before live commerce and founder-approved copy. */
const SELF_SERVE = /free|start with your files|sign up|trial|내 자료로 시작/i;

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
    header: await header(false),
    headerKo: await header(true),
    home: await home(false),
    homeKo: await home(true),
    pricing: await pricing(),
    koPricing: await koPricing(),
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
    expect(seen.headerKo).toEqual(expected.headerKo);
  });

  it("Home hero primary, hero secondary and close", () => {
    expect(seen.home).toEqual(expected.home);
    expect(seen.homeKo).toEqual(expected.homeKo);
  });

  it("/pricing plan actions", () => {
    expect(seen.pricing).toEqual(expected.pricing);
  });

  it("/ko/pricing actions", () => {
    expect(seen.koPricing).toEqual(expected.koPricing);
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
        expect.arrayContaining(["Start with your files", "Start free evaluation", "내 자료로 시작하기"]),
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
    expect(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "observer_access", purchaseOpen: null }))).toBe("");
  }, RENDER_TIMEOUT);

  it("names the plan it was reached for, closed or open", async () => {
    const { default: CheckoutIntentNotice } = await import("../components/checkout-intent-notice");
    const closed = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "studio_access", purchaseOpen: false })));
    expect(closed).toBe("Team is not sold online today. Nothing is charged by signing in. Request Team access");
    // B-07 / CLM-023: Team's saleChannel is "contact", so an open deployment still does not sell it
    // online, and the checkout it would promise answers 403 BILLING_OFFER_CONTACT_REQUIRED.
    const open = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "studio_access", purchaseOpen: true })));
    expect(open).toBe("Team is not sold online today. Nothing is charged by signing in. Request Team access");
    expect(open).not.toContain("Checkout opens by itself");
    const developer = decode(renderToStaticMarkup(createElement(CheckoutIntentNotice, { offer: "observer_access", purchaseOpen: true })));
    expect(developer).toBe(OPEN_INTENT);
  }, RENDER_TIMEOUT);
});
