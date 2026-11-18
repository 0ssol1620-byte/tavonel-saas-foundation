import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AgentAccessView, ConsentText, copyCredential, createOutcome, readGrantList, revealAfter, TokenReveal, type Load } from "../components/workspace/agent-access-panel";
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

  /*
    WO-REL-5 (release review R3 B1). The offer is rendered only when GET /api/agent-grants answered creatable: true;
    the list and Disconnect are rendered whatever it answered. Each state goes through the view the panel renders.
  */
  const GRANT = { grantId: "29d42924-a3cc-4a09-b92d-9c86b58901a1", clientLabel: "Desk Agent", createdAt: "2026-11-17T12:00:00.000Z",
    expiresAt: null, revokedAt: null, lastUsedAt: null };
  const view = (load: Load, extra: { token?: string | null; notice?: string | null } = {}) => renderToStaticMarkup(createElement(AgentAccessView, {
    load, label: "", busy: false, notice: extra.notice ?? null, token: extra.token ?? null,
    onLabel: () => undefined, onCreate: () => undefined, onClose: () => undefined, onDisconnect: () => undefined, onRetry: () => undefined,
  }));
  const offer = ["Connect an agent that suggests changes.", "Create connection", "Client name", AGENT_PROPOSAL_CONSENT.suggests.replace(/&/g, "&amp;")];

  it("creatable: the offer, the consent and the form render, with the list and Disconnect", () => {
    const markup = view({ state: "ready", grants: [GRANT], truncated: false, creatable: true });
    for (const text of offer) expect(markup, text).toContain(text);
    expect(markup).toContain("Disconnect “Desk Agent”");
  });

  it("not creatable, with connections: no offer, no consent, no form; the list and Disconnect still render", () => {
    const markup = view({ state: "ready", grants: [GRANT], truncated: false, creatable: false });
    for (const text of offer) expect(markup, text).not.toContain(text);
    expect(markup).not.toMatch(/<form|<input/);
    expect(markup).toContain("Disconnect “Desk Agent”");
    expect(markup).toContain("Connected agents");
  });

  it("not creatable, no connection: nothing renders; creatable with none renders the offer and the empty list", () => {
    expect(view({ state: "ready", grants: [], truncated: false, creatable: false })).toBe("");
    const markup = view({ state: "ready", grants: [], truncated: false, creatable: true });
    expect(markup).toContain("Create connection");
    expect(markup).toContain("No agent is connected.");
  });

  it("a read in flight renders nothing; a failed read offers nothing and says it could not be read", () => {
    expect(view({ state: "loading" })).toBe("");
    const markup = view({ state: "unavailable" });
    for (const text of offer) expect(markup, text).not.toContain(text);
    expect(markup).toContain("Connections could not be read.");
  });

  it("a credential just created is still shown when the next read says not creatable", () => {
    const markup = view({ state: "ready", grants: [], truncated: false, creatable: false }, { token: FAKE });
    expect(markup).toContain(FAKE);
    expect(markup).not.toContain("Create connection");
  });

  it("readGrantList: creatable is true only when the server sent true; a missing or odd value offers nothing", () => {
    const grants = [GRANT];
    expect(readGrantList(true, { grants, creatable: true })).toEqual({ state: "ready", grants, truncated: false, creatable: true });
    for (const creatable of [undefined, false, "true", 1, null, {}]) {
      expect(readGrantList(true, { grants, creatable }), String(creatable)).toEqual({ state: "ready", grants, truncated: false, creatable: false });
    }
    expect(readGrantList(false, { grants, creatable: true })).toEqual({ state: "unavailable" });
    expect(readGrantList(true, { grants: [{}], creatable: true })).toEqual({ state: "unavailable" });
    expect(readGrantList(true, null)).toEqual({ state: "unavailable" });
  });
});
