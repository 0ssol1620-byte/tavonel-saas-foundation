import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COOKBOOKS } from "./cookbook-content";
import { CONSENT_KEY, MARKETING_EVENTS, NAV_OPEN_EVENT, PUBLIC_MARKETING_PATHS, consentCopy, consentSurface, publicPageLocation, readConsent, referralOrigin, vercelBeforeSend } from "./marketing-analytics";
import { trackFunnel, type FunnelEvent } from "./funnel-events";

// P2-07: the Vercel SDK is the only stand-in. Nothing here contacts a collector or is evidence
// about a live visitor; it is the decision in code, counted at the two calls that would send.
const trackMock = vi.hoisted(() => vi.fn());
const analyticsMock = vi.hoisted(() => vi.fn((_props: { beforeSend?: unknown }) => null));
vi.mock("@vercel/analytics", () => ({ track: trackMock }));
vi.mock("@vercel/analytics/next", () => ({ Analytics: analyticsMock }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const { default: MarketingConsent } = await import("../components/marketing-consent");
const { default: VercelCollector, relayToVercel } = await import("../components/vercel-collector");

describe("public marketing analytics boundary", () => {
  it("refuses private, unknown and user-supplied URLs", () => {
    for (const path of ["/workspace", "/workspace/sources", "/auth/callback", "/login", "/api/contact", "/docs/private-id", "/?email=person@example.com", "https://other.example/"]) expect(publicPageLocation(path)).toBeNull();
    expect(publicPageLocation("/pricing")).toBe("https://tavonel.com/pricing");
  });
  it("retains referral origins, never paths, search terms or tokens", () => {
    expect(referralOrigin("https://example.com/private/file?q=secret#token")).toBe("https://example.com");
    expect(referralOrigin("javascript:secret")).toBe("");
    expect(referralOrigin("")).toBe("");
  });
  it("fails closed on absent, invalid, expired or unavailable consent", () => {
    for (const value of [null, "broken", '{}', '{"allowed":true,"expires":1}', '{"allowed":true,"expires":1e309}']) expect(readConsent({ getItem: () => value }, 2)).toBeNull();
    expect(readConsent({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(readConsent({ getItem: () => '{"allowed":false,"expires":10}' }, 2)).toBe(false);
    expect(readConsent({ getItem: () => '{"allowed":true,"expires":10}' }, 2)).toBe(true);
  });
  it("does not forward workspace, questions or arbitrary custom events", () => {
    for (const name of ["workspace_first_ask", "workspace_world_activated", "explore_ask_used", "user_email", "sign_up", "purchase"]) expect(MARKETING_EVENTS.has(name)).toBe(false);
  });

  /*
    BA-211: a cookbook that is promoted has to arrive on the measured set with its promotion.

    The decision (see the comment beside the set) is that a draft is measured nowhere, because a
    draft is linked from nowhere and carries `noindex`. That is only defensible while it stays
    true, and the day someone flips `publication` to `approved` is the day the page appears in the
    sitemap and in a menu with nothing to notice that it is measured by nothing -- which is the
    gap `/ko`, `/solutions` and `/trust` each fell into before this campaign found them.
  */
  it("measures an approved cookbook and leaves a draft alone", () => {
    for (const cookbook of COOKBOOKS) {
      const path = `/cookbooks/${cookbook.slug}`;
      if (cookbook.publication === "approved") {
        expect(publicPageLocation(path), `${path} is approved and measured nowhere`).toBe(`https://tavonel.com${path}`);
      } else {
        expect(publicPageLocation(path), `${path} is a draft and must not be measured`).toBeNull();
      }
    }
    // The premise of the decision, asserted: today every one of them is a draft.
    expect(COOKBOOKS.filter((cookbook) => cookbook.publication === "approved")).toEqual([]);
  });
});

/*
  BA-245: which layer the consent banner is allowed to be.

  The bug was not visible in any unit: the phone menu and the banner were each correct on their
  own and wrong together, and the only place that can be stated is the rule about the two. So the
  rule is a function, and these are its four refusals -- the state of the page, not the pixels.
*/
describe("what the consent surface renders", () => {
  const asked = { measured: true, ready: true, consent: null, editing: false, navOpen: false };

  it("asks once the page is measured and local storage has been read", () => {
    expect(consentSurface(asked)).toBe("prompt");
    expect(consentSurface({ ...asked, consent: true })).toBe("settings");
    expect(consentSurface({ ...asked, consent: false })).toBe("settings");
    expect(consentSurface({ ...asked, consent: true, editing: true })).toBe("prompt");
  });

  it("shows nothing while the phone menu is open, whatever the reader has answered", () => {
    for (const consent of [null, true, false]) {
      expect(consentSurface({ ...asked, consent, navOpen: true }), `consent ${consent}`).toBe("nothing");
    }
    // Including mid-edit: the reopened panel is still under a menu that covers the page.
    expect(consentSurface({ ...asked, consent: true, editing: true, navOpen: true })).toBe("nothing");
  });

  it("shows nothing before storage is read, and nothing on a page that is not measured", () => {
    expect(consentSurface({ ...asked, ready: false })).toBe("nothing");
    expect(consentSurface({ ...asked, measured: false })).toBe("nothing");
    // A workspace route is both: never measured, so never asked.
    expect(publicPageLocation("/workspace")).toBeNull();
  });

  it("is the name both components agree on, spelled once", () => {
    expect(NAV_OPEN_EVENT).toBe("tavonel:nav");
    for (const file of ["../components/marketing-consent.tsx", "../components/mobile-primary-nav.tsx"]) {
      const source = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(source, `${file} must use the constant, not the literal`).toContain("NAV_OPEN_EVENT");
      expect(source, `${file} spells the event itself`).not.toContain('"tavonel:nav"');
    }
  });
});

/*
  The consent prompt in the language of the page, which is stage-A open risk 5.

  Making `/ko` a measured page is what made it show this banner, and it showed the English one --
  a privacy choice presented in a language the page exists because the reader does not read. The
  test that matters is not that a Korean string exists somewhere; it is that every *other* public
  page still gets the English one, because a locale selector that is too eager is the same defect
  pointed the other way.
*/
describe("the consent banner speaks the page's language", () => {
  const EN = consentCopy("/");
  const KO = consentCopy("/ko");

  it("is Korean on the Korean subtree and English on every other public page", () => {
    expect(KO.prompt).not.toBe(EN.prompt);
    /*
      BA-256 replaced the request with a statement, so the pinned Korean sentence is the new one.

      Pinned more tightly than before, not less: the whole sentence rather than its opening
      clause, plus the rule the change was made for -- a consent prompt in either language states
      what happens and does not ask the reader for a favour. `?` in the prompt is that failure in
      one character.
    */
    expect(KO.prompt).toBe(
      "Google Analytics 쿠키는 공개 페이지의 방문과 클릭을 측정하며, 워크스페이스 내용은 제외합니다.",
    );
    for (const copy of [EN, KO]) {
      expect(copy.prompt, "a consent prompt states, it does not ask").not.toContain("?");
    }
    expect(consentCopy("/ko/anything-later")).toEqual(KO);
    for (const path of PUBLIC_MARKETING_PATHS) {
      if (path === "/ko" || path.startsWith("/ko/")) {
        expect(consentCopy(path), `${path} must keep the Korean banner`).toEqual(KO);
        continue;
      }
      expect(consentCopy(path), `${path} must keep the English banner`).toEqual(EN);
    }
    // A prefix match that was too loose would take these with it.
    for (const near of ["/", "/knowledge-compiler", "/korea", "/docs/ko", "/kotlin"]) {
      expect(consentCopy(near), `${near} is not the Korean subtree`).toEqual(EN);
    }
  });

  it("offers the same two choices, and translates no claim", () => {
    for (const copy of [EN, KO]) {
      for (const field of ["region", "prompt", "privacy", "refuse", "allow", "settings"] as const) {
        expect(copy[field].trim().length, field).toBeGreaterThan(1);
      }
      // Both name the vendor and the exclusion; neither adds a claim the other does not make.
      expect(copy.prompt).toContain("Google Analytics");
      expect(copy.prompt.toLowerCase()).toMatch(/cookies|쿠키/);
      expect(copy.prompt.toLowerCase()).toMatch(/workspace|워크스페이스/);
    }
  });

  it("is the only source of those strings: the component renders the copy, not its words", () => {
    const component = readFileSync(resolve(import.meta.dirname, "../components/marketing-consent.tsx"), "utf8");
    expect(component).toContain("const copy = consentCopy(pathname);");
    expect(component).toContain("aria-label={copy.region}");
    for (const word of [EN.prompt, EN.refuse, EN.allow, EN.settings, KO.prompt]) {
      expect(component, "a string written into the component cannot be translated").not.toContain(word);
    }
  });
});

/*
  P2-07 (ANALYTICS-ACTIVATION-2026-10-17 §4.4 G1-G2, §5 steps 1-2): the Vercel collector on the
  Google tag's terms.

  /privacy says nothing in the analytics rows is set before you choose and that a refusal sends no
  analytics request, and the Vercel row is one of those rows. With the collector mounted at the
  root behind the build flag alone, turning the flag on would have made that sentence false. So
  every case below runs with the flag ON: the flag is necessary, and never sufficient.
*/
describe("P2-07: the Vercel collector waits for consent on a public page", () => {
  const FLAG = "NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED";
  const HOME = "https://tavonel.com/";
  const later = () => Date.now() + 180 * 24 * 60 * 60 * 1000;
  const yes = () => JSON.stringify({ allowed: true, expires: later() });

  beforeEach(() => {
    trackMock.mockClear();
    analyticsMock.mockClear();
    vi.stubEnv(FLAG, "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function renders(props: { ready: boolean; consent: boolean | null; location: string | null }) {
    renderToStaticMarkup(createElement(VercelCollector, props));
    return analyticsMock.mock.calls.length;
  }

  /*
    One page: `trackFunnel` dispatching on it and the relay listening exactly as MarketingConsent's
    effect wires it, for one stored answer on one pathname. "throw" is storage that refuses to be
    read. Returns the unsubscribe, or undefined when nothing listens, and a way to navigate.
  */
  function page(stored: string | null, pathname: string) {
    const target = new EventTarget();
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => null, setItem: () => {} },
      dispatchEvent: (event: Event) => target.dispatchEvent(event),
    });
    const consent = readConsent({
      getItem: (key: string) => {
        if (stored === "throw") throw new Error("SecurityError");
        return key === CONSENT_KEY ? stored : null;
      },
    });
    let current = pathname;
    const stop = relayToVercel({ ready: true, consent, location: publicPageLocation(pathname) }, target, () => current);
    return { stop, navigate: (next: string) => { current = next; } };
  }

  it("renders no <Analytics> before a stored yes, with the flag on", () => {
    expect(renderToStaticMarkup(createElement(MarketingConsent)), "the first paint holds nothing").toBe("");
    for (const state of [
      { ready: false, consent: true, location: HOME }, // storage not read yet
      { ready: true, consent: null, location: HOME }, // not answered
      { ready: true, consent: false, location: HOME }, // refused
      { ready: true, consent: true, location: null }, // yes, but on an unlisted page (workspace, login)
    ]) expect(renders(state), JSON.stringify(state)).toBe(0);
    expect(analyticsMock).not.toHaveBeenCalled();
  });

  it("renders it once after a yes on a listed page, with the path gate attached", () => {
    expect(renders({ ready: true, consent: true, location: HOME })).toBe(1);
    expect(analyticsMock.mock.calls[0][0].beforeSend).toBe(vercelBeforeSend);
  });

  it("still needs the flag: a yes without it renders nothing", () => {
    for (const value of ["", "0", "true"]) {
      vi.stubEnv(FLAG, value);
      expect(renders({ ready: true, consent: true, location: HOME }), JSON.stringify(value)).toBe(0);
    }
  });

  it("calls track() zero times before a yes, after a refusal, or when storage cannot be read", () => {
    for (const stored of [null, JSON.stringify({ allowed: false, expires: later() }), JSON.stringify({ allowed: true, expires: 1 }), "broken", "throw"]) {
      expect(page(stored, "/").stop, `${stored}: nothing listens`).toBeUndefined();
      trackFunnel("hero_primary_click");
      trackFunnel("cta_clicked", { cta: "explore", scene: "hero" });
    }
    expect(relayToVercel({ ready: false, consent: true, location: HOME }, new EventTarget(), () => "/"), "storage not read yet").toBeUndefined();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("never calls track() from trackFunnel itself: a yes with the flag off sends nothing", () => {
    vi.stubEnv(FLAG, "");
    expect(page(yes(), "/").stop).toBeUndefined();
    trackFunnel("hero_primary_click");
    expect(trackMock).not.toHaveBeenCalled();
    const funnel = readFileSync(resolve(import.meta.dirname, "funnel-events.ts"), "utf8");
    expect(funnel, "the funnel module reaches no collector of its own").not.toContain("@vercel/analytics");
  });

  it("after a yes on a listed page, sends the marketing name with allowlisted properties only", () => {
    const { stop } = page(yes(), "/");
    trackFunnel("hero_primary_click");
    trackFunnel("cta_clicked", { cta: "explore", scene: "hero" });
    // Any script can dispatch this event: unlisted keys and non-strings are dropped, a throwing
    // detail is dropped, and nothing of the detail but allowlisted string states is forwarded.
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "cta_clicked", cta: "start", question: "Q-SENTINEL", collectionId: "C-SENTINEL", scene: 3 } }));
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { get event() { throw new Error("hostile"); } } }));
    window.dispatchEvent(new CustomEvent("tavonel:funnel", { detail: { event: "cta_clicked", get cta() { throw new Error("hostile"); } } }));
    expect(trackMock.mock.calls).toEqual([
      ["hero_primary_click", undefined],
      ["cta_clicked", { cta: "explore", scene: "hero" }],
      ["cta_clicked", { cta: "start" }],
    ]);
    stop!();
    trackFunnel("hero_primary_click");
    expect(trackMock, "an unsubscribed relay sends nothing").toHaveBeenCalledTimes(3);
  });

  it("sends no workspace, sign-in, checkout or question event, on any path, even after a yes", () => {
    const privateNames: FunnelEvent[] = [
      "workspace_first_source_added", "workspace_compile_started", "workspace_compile_failed", "workspace_candidate_ready",
      "workspace_review_required", "workspace_world_activated", "workspace_first_ask", "workspace_ai_connect_opened",
      "signed_in", "login_reached_with_intent", "checkout_opened", "checkout_completed", "source_filter_changed", "explore_ask_used",
    ];
    for (const pathname of ["/workspace", "/workspace/sources", "/login", "/auth/callback"]) {
      expect(page(yes(), pathname).stop, `${pathname}: nothing listens`).toBeUndefined();
      for (const name of privateNames) trackFunnel(name, { status: "ok" });
    }
    // Listening on a public page: a private name is refused there too, and after a client-side
    // navigation into the workspace (the listener can outlive the page it was installed on) a
    // marketing name is refused as well.
    const { navigate } = page(yes(), "/");
    for (const name of privateNames) trackFunnel(name, { status: "ok" });
    navigate("/workspace");
    trackFunnel("hero_primary_click");
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("vercelBeforeSend drops private and unlisted pages and strips the query from a listed one", () => {
    for (const url of [
      "https://tavonel.com/workspace", "https://tavonel.com/workspace/sources?id=7", "https://tavonel.com/login",
      "https://tavonel.com/login?offer=team", "https://tavonel.com/auth/callback#access_token=x", "https://tavonel.com/api/contact",
      "https://tavonel.com/cookbooks/unlisted", "https://tavonel.com/pricing/", "/evaluation", "not a url", "",
    ]) {
      expect(vercelBeforeSend({ type: "pageview", url }), url).toBeNull();
      expect(vercelBeforeSend({ type: "event", url }), url).toBeNull();
    }
    const event = { type: "pageview" as const, url: "https://tavonel.com/evaluation?utm_source=x&email=a%40b.example#form" };
    expect(vercelBeforeSend(event)).toEqual({ type: "pageview", url: "https://tavonel.com/evaluation" });
    expect(event.url, "the incoming event is not mutated").toContain("?utm_source");
    expect(vercelBeforeSend({ type: "event", url: "https://tavonel.com/ko/evaluation?ref=home" })).toEqual({ type: "event", url: "https://tavonel.com/ko/evaluation" });
    expect(vercelBeforeSend({ type: "pageview", url: "https://tavonel.com/arena?x=1" })).toEqual({ type: "pageview", url: "https://tavonel.com/arena" });
    // A preview keeps its own host: Vercel separates environments, and the preview check reads it.
    expect(vercelBeforeSend({ type: "pageview", url: "https://tavonel-git-x.vercel.app/?q=1" })).toEqual({ type: "pageview", url: "https://tavonel-git-x.vercel.app/" });
  });

  it("is mounted by the consent component only, and a withdrawal also unloads it", () => {
    const layout = readFileSync(resolve(import.meta.dirname, "../app/layout.tsx"), "utf8");
    expect(layout, "the root layout mounts no collector of its own").not.toContain("<Analytics");
    expect(layout).not.toContain("@vercel/analytics");
    expect(layout).not.toContain("vercel-collector");
    const consent = readFileSync(resolve(import.meta.dirname, "../components/marketing-consent.tsx"), "utf8");
    expect(consent).toContain('if (!allowed && (document.getElementById("tavonel-google-tag") || (window as AnalyticsWindow).va)) window.location.reload();');
    // Fetched only once it may run, and never statically: a static import of the SDK put it in
    // every page's script and broke the §22 ratchet (P2-07's receipt).
    expect(consent).toContain('const VercelCollector = lazy(() => import("@/components/vercel-collector")');
    expect(consent).toContain('{process.env.NEXT_PUBLIC_TAVONEL_ANALYTICS_ENABLED === "1" && ready && consent === true && location');
    expect(consent, "the consent component imports none of the Vercel SDK").not.toContain("@vercel/analytics");
    const collector = readFileSync(resolve(import.meta.dirname, "../components/vercel-collector.tsx"), "utf8");
    expect(collector).toContain("useEffect(() => relayToVercel({ ready, consent, location }, window, () => window.location.pathname), [consent, location, ready]);");
  });

  it("admits the two public click names G3 adds, and not the question one", () => {
    for (const name of ["cta_clicked", "explore_object_selected"]) expect(MARKETING_EVENTS.has(name), name).toBe(true);
    expect(MARKETING_EVENTS.has("explore_ask_used")).toBe(false);
  });
});
