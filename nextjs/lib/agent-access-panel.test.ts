import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentText, revealAfter, TokenReveal } from "../components/workspace/agent-access-panel";
import { AGENT_PROPOSAL_CONSENT } from "./agent-consent";

// A made-up value that only has the shape of a credential; no real one is used anywhere.
const FAKE = "tvnl_agt_TEST-ONLY-NOT-A-CREDENTIAL";

describe("Agent access panel (WO-AN-6)", () => {
  it("shows the credential once and clears it on close", () => {
    const shown = revealAfter(null, { type: "created", token: FAKE });
    expect(shown).toBe(FAKE);
    const markup = renderToStaticMarkup(createElement(TokenReveal, { token: shown, onClose: () => undefined }));
    expect(markup).toContain(FAKE);
    expect(markup).toContain("It will not be shown again.");
    const closed = revealAfter(shown, { type: "close" });
    expect(closed).toBeNull();
    expect(renderToStaticMarkup(createElement(TokenReveal, { token: closed, onClose: () => undefined }))).toBe("");
  });

  it("the consent text is exactly the sentences of lib/agent-consent, with the label in quotes and marked unverified", () => {
    const markup = renderToStaticMarkup(createElement(ConsentText, { label: "Desk Agent" }));
    const text = (value: string) => value.replace(/&/g, "&amp;");
    for (const sentence of [AGENT_PROPOSAL_CONSENT.sees("Desk Agent"), AGENT_PROPOSAL_CONSENT.suggests, AGENT_PROPOSAL_CONSENT.cannotChange,
      AGENT_PROPOSAL_CONSENT.cannotReach, AGENT_PROPOSAL_CONSENT.disconnect, AGENT_PROPOSAL_CONSENT.securityNote]) {
      expect(markup).toContain(text(sentence));
    }
    expect(markup).toContain("(name not verified)");
  });

  it("source: the client panel reaches no Node built-in and keeps the credential out of storage", () => {
    const source = readFileSync(new URL("../components/workspace/agent-access-panel.tsx", import.meta.url), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports).toContain("@/lib/agent-consent");
    expect(imports.filter((specifier) => /^@\/lib\/agent-access(\/|$)/.test(specifier) || /^(node:|crypto$|fs$)/.test(specifier))).toEqual([]);
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
