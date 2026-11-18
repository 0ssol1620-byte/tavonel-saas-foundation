import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activityLine, ConsentText, copyCredential, GrantActivity, createOutcome, revealAfter, TokenReveal } from "../components/workspace/agent-access-panel";
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

  it("the credential is outside every live region; only the notice that one was created is announced (WO-AN-6B)", () => {
    const markup = renderToStaticMarkup(createElement(TokenReveal, { token: FAKE, onClose: () => undefined }));
    const announced = [...markup.matchAll(/<(\w+)[^>]*(?:role="(?:status|alert|log)"|aria-live=)[^>]*>(.*?)<\/\1>/g)];
    expect(announced.map((m) => m[2])).toEqual(["A credential was created."]);
    const outside = markup.replace(announced[0][0], "");
    expect(outside).toContain(FAKE);
    expect(outside).not.toMatch(/role="(?:status|alert|log)"|aria-live=/);
  });

  it("a browser without a clipboard, or one that refuses, reports a failed copy and never throws (WO-AN-6B)", async () => {
    expect(await copyCredential(FAKE)).toBe("failed");
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: write } });
    expect(await copyCredential(FAKE)).toBe("done");
    expect(write).toHaveBeenCalledWith(FAKE);
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    expect(await copyCredential(FAKE)).toBe("failed");
    vi.unstubAllGlobals();
  });

  it("a 2xx without a token is unconfirmed, never shown as created and never as refused (WO-AN-6B)", () => {
    expect(createOutcome(true, 201, { code: "CREATED" })).toEqual({ kind: "unconfirmed" });
    expect(createOutcome(true, 201, null)).toEqual({ kind: "unconfirmed" });
    expect(createOutcome(true, 201, { token: FAKE })).toEqual({ kind: "created", token: FAKE });
    expect(createOutcome(false, 402, { token: FAKE })).toEqual({ kind: "refused", notice: "Agent access is not part of a free evaluation." });
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

describe("Agent access activity (WO-AN-10)", () => {
  const row = { proposalId: "00000000-0000-4000-8000-000000000001", actionType: "library_label", state: "executed",
    createdAt: "2026-11-18T09:00:00.000Z", decidedAt: "2026-11-18T09:30:45.000Z", receiptAvailable: true } as const;

  it("a line carries type, state, both times in UTC and whether a signed receipt is stored, and nothing else", () => {
    expect(activityLine(row)).toBe("Label · Done · proposed 2026-11-18 09:00 UTC · decided 2026-11-18 09:30 UTC · signed receipt stored");
    expect(activityLine({ ...row, state: "proposed", decidedAt: null, receiptAvailable: false })).toBe("Label · Proposed · proposed 2026-11-18 09:00 UTC");
    expect(activityLine({ ...row, actionType: "compile_plan", state: "failed" })).toContain("Compile · Failed");
  });
  it("an action type or state this build does not know is shown plainly, never as markup", () => {
    expect(activityLine({ ...row, actionType: "<img>" as never, state: "later" as never })).toContain("Change · later");
    expect(renderToStaticMarkup(createElement(GrantActivity, { grantId: row.proposalId }))).toContain("Reading activity");
  });
  it("source: the panel offers Activity per grant, with the export and Show more, and no localStorage", () => {
    const source = readFileSync(new URL("../components/workspace/agent-access-panel.tsx", import.meta.url), "utf8");
    expect(source).toContain("?format=ndjson");
    expect(source).toContain("Show more");
    expect(source).toMatch(/aria-expanded=\{openActivity === grant\.grantId\}/);
  });
});
