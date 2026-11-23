import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  activityLine, activityNdjson, AgentAccessView, ConsentText, copyCredential, createOutcome, GrantActivity, readGrantList, revealAfter, TokenReveal, type Load,
} from "../components/workspace/agent-access-panel";
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
  type Extra = { token?: string | null; notice?: string | null; busy?: boolean; openActivity?: string | null };
  const view = (load: Load, extra: Extra = {}) => renderToStaticMarkup(createElement(AgentAccessView, {
    load, label: "", busy: extra.busy ?? false, notice: extra.notice ?? null, token: extra.token ?? null,
    onLabel: () => undefined, onCreate: () => undefined, onClose: () => undefined, onDisconnect: () => undefined, onRetry: () => undefined,
    openActivity: extra.openActivity ?? null, onActivity: () => undefined,
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
  it("the export is every listed row, in order, one JSON object per line (pages 1..n after Show more)", () => {
    const page1 = [row, { ...row, proposalId: "00000000-0000-4000-8000-000000000002" }];
    const page2 = [{ ...row, proposalId: "00000000-0000-4000-8000-000000000003", receiptAvailable: false }];
    const listed = [...page1, ...page2];
    const lines = activityNdjson(listed).split("\n");
    expect(lines.pop()).toBe("");
    expect(lines.map((line) => JSON.parse(line).proposalId)).toEqual(listed.map((r) => r.proposalId));
    expect(lines.map((line) => JSON.parse(line))).toEqual(listed);
  });
  it("source: the panel offers Activity per grant, with the export and Show more, and no localStorage", () => {
    const source = readFileSync(new URL("../components/workspace/agent-access-panel.tsx", import.meta.url), "utf8");
    // The export is the rows in state (every page shown), never a re-request that would hold only page 1.
    expect(source).not.toContain("format=ndjson");
    expect(source).toContain("activityNdjson(rows)");
    expect(source).toContain("Show more");
    expect(source).toMatch(/aria-expanded=\{openActivity === grant\.grantId\}/);
  });
});

/*
  WO-AN-8R: the Activity disclosure inside WO-REL-5's view. GrantActivity is the only reader of the activity route and reads
  once mounted (its "Reading activity" line, aria-busy, is what a mounted one renders first); these cases assert where it
  is and is not mounted, through the real AgentAccessView.
*/
describe("Agent access view with Activity (WO-AN-8R)", () => {
  const GRANT = { grantId: "29d42924-a3cc-4a09-b92d-9c86b58901a1", clientLabel: "Desk Agent", createdAt: "2026-11-17T12:00:00.000Z",
    expiresAt: null, revokedAt: null, lastUsedAt: null };
  const REVOKED = { ...GRANT, grantId: "5b0e8a4c-1f7e-4f43-9a52-3c1d2e4f5a6b", clientLabel: "Old Agent", revokedAt: "2026-11-19T08:00:00.000Z" };
  const view = (load: Load, busy: boolean, openActivity: string | null) => renderToStaticMarkup(createElement(AgentAccessView, {
    load, label: "", busy, notice: null, token: null, onLabel: () => undefined, onCreate: () => undefined, onClose: () => undefined,
    onDisconnect: () => undefined, onRetry: () => undefined, openActivity, onActivity: () => undefined,
  }));
  const mounted = (markup: string) => markup.includes("Reading activity");
  const activityButton = (markup: string, label: string) => markup.match(new RegExp(`<button[^>]*aria-label="Activity of “${label}”"[^>]*>`))?.[0];

  it("Activity open while a disconnect is in flight: Activity stays open and usable, only Disconnect waits", () => {
    const markup = view({ state: "ready", grants: [GRANT], truncated: false, creatable: true }, true, GRANT.grantId);
    expect(mounted(markup)).toBe(true);
    const button = activityButton(markup, "Desk Agent");
    expect(button).toContain('aria-expanded="true"');
    expect(button).not.toContain("disabled");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Disconnect “Desk Agent”"/);
  });

  it("Activity for a revoked grant is offered and opens; the revoked grant has no Disconnect, also when not creatable", () => {
    for (const creatable of [true, false]) {
      const closed = view({ state: "ready", grants: [GRANT, REVOKED], truncated: false, creatable }, false, null);
      expect(activityButton(closed, "Old Agent"), String(creatable)).toContain('aria-expanded="false"');
      expect(mounted(closed), String(creatable)).toBe(false);
      const open = view({ state: "ready", grants: [GRANT, REVOKED], truncated: false, creatable }, false, REVOKED.grantId);
      expect(activityButton(open, "Old Agent")).toContain('aria-expanded="true"');
      expect(activityButton(open, "Desk Agent")).toContain('aria-expanded="false"');
      expect(open.match(/Reading activity/g)).toHaveLength(1);
      expect(open).not.toContain("Disconnect “Old Agent”");
      expect(open).toContain("Disconnect “Desk Agent”");
    }
  });

  it("agent access off: no Activity is mounted (no read is made), even with an Activity id left open", () => {
    for (const openActivity of [null, GRANT.grantId]) {
      expect(view({ state: "ready", grants: [], truncated: false, creatable: false }, false, openActivity)).toBe("");
      expect(view({ state: "loading" }, false, openActivity)).toBe("");
      expect(mounted(view({ state: "unavailable" }, false, openActivity))).toBe(false);
    }
    // Not creatable but with a connection: Activity is offered (never gated, like Disconnect) and read only once opened.
    const markup = view({ state: "ready", grants: [GRANT], truncated: false, creatable: false }, false, null);
    expect(activityButton(markup, "Desk Agent")).toContain('aria-expanded="false"');
    expect(mounted(markup)).toBe(false);
  });
});
