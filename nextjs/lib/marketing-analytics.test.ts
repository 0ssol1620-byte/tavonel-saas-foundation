import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MARKETING_EVENTS, PUBLIC_MARKETING_PATHS, consentCopy, publicPageLocation, readConsent, referralOrigin } from "./marketing-analytics";

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
    for (const value of [null, "broken", '{}', '{"allowed":true,"expires":1}']) expect(readConsent({ getItem: () => value }, 2)).toBeNull();
    expect(readConsent({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(readConsent({ getItem: () => '{"allowed":false,"expires":10}' }, 2)).toBe(false);
    expect(readConsent({ getItem: () => '{"allowed":true,"expires":10}' }, 2)).toBe(true);
  });
  it("does not forward workspace, questions or arbitrary custom events", () => {
    for (const name of ["workspace_first_ask", "workspace_world_activated", "explore_ask_used", "user_email", "sign_up", "purchase"]) expect(MARKETING_EVENTS.has(name)).toBe(false);
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
    expect(KO.prompt).toContain("TAVONEL 개선에 도움을 주시겠습니까?");
    expect(consentCopy("/ko/anything-later")).toEqual(KO);
    for (const path of PUBLIC_MARKETING_PATHS) {
      if (path === "/ko") continue;
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
