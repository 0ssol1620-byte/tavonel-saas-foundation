import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionBody, agentBadge, batchEligible, decisionLine, decisionProblem, deepLinkGone, listable, ProposalItem, receiptOffered, rowActions, saveAsFile } from "../components/change-proposals-panel";
import type { PublicProposal } from "./change-proposals";
import { PROMPT_INJECTION_FIXTURES } from "./prompt-injection.fixtures";

describe("proposal decision outcome message", () => {
  it("never says 'not saved' when the server may have changed the World (5xx, lost response)", () => {
    for (const status of [0, 500, 502, 503, 504]) {
      const message = decisionProblem(status);
      expect(message).toContain("could not be confirmed");
      expect(message).not.toContain("not saved");
    }
  });
  it("says 'not saved' only for a refusal made before any change", () => {
    expect(decisionProblem(400)).toBe("The decision was not saved. Try again.");
    expect(decisionProblem(404)).toBe("The decision was not saved. Try again.");
    expect(decisionProblem(403)).toBe("You can not decide on this proposal.");
    expect(decisionProblem(409)).toContain("can no longer be changed");
  });
  it("reports nothing on success", () => {
    expect(decisionProblem(200)).toBeNull();
  });
  it("asks for a second look when the preview changed under the click (WO-AN-6)", () => {
    expect(decisionProblem(409, "PROPOSAL_PREVIEW_CHANGED")).toBe("This suggestion changed since it was shown. Review it again.");
    expect(decisionProblem(409, "PROPOSAL_STALE")).toContain("can no longer be changed");
  });
});

const ID = "00000000-0000-4000-8000-000000000001";
const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";
const common = {
  proposalId: ID, state: "proposed", collectionId: null, previewDigest: `sha256:${"a".repeat(64)}`, resumable: false, evidenceIds: [],
  expiresAt: "2026-11-24T09:00:00.000Z", createdAt: "2026-11-17T09:00:00.000Z", decidedAt: null, proposer: { kind: "person" }, notes: [],
} as const;
const label = (over: Record<string, unknown> = {}) => ({
  ...common, actionType: "library_label",
  preview: { documentId: DOC_A, sourceVersionId: "b".repeat(64), labelKind: "doc_type", labelKey: "invoice", decision: "confirmed" }, ...over,
}) as unknown as PublicProposal;
const compile = (quote: { rechargeCredits: number; overageCredits: number }, over: Record<string, unknown> = {}) => ({
  ...common, actionType: "compile_plan",
  preview: { documentIds: [DOC_A, DOC_B], documentsTotal: 2, corpus: true, parts: 1, quote: { balanceRechargeCredits: 0, ...quote } }, ...over,
}) as unknown as PublicProposal;
const patchPreview = { collectionId: "collection-x", baseManifestDigest: `sha256:${"c".repeat(64)}`, objectId: "topic-1", kind: "Topic", before: "Billing", after: "Invoicing", evidenceId: "e1" };
const patch = (over: Record<string, unknown> = {}) => ({ ...common, actionType: "ontology_label_patch", preview: patchPreview, ...over }) as unknown as PublicProposal;
const html = (proposal: PublicProposal) => renderToStaticMarkup(createElement(ProposalItem, { proposal, disabled: false, onAct: () => undefined }));

describe("proposal rows (WO-AN-6)", () => {
  it("confirm carries the preview digest the row rendered, and is not offered without one", () => {
    expect(actionBody(label(), "confirm")).toMatchObject({ decision: "confirm", previewDigest: `sha256:${"a".repeat(64)}` });
    expect(rowActions(label({ previewDigest: null }))).toEqual(["reject"]);
    expect(actionBody(label({ previewDigest: null }), "confirm")).toBeNull();
  });
  it("a withdrawn row has no buttons and says Withdrawn", () => {
    const markup = html(label({ state: "withdrawn", previewDigest: null }));
    expect(markup).toContain("Withdrawn");
    expect(markup).not.toContain("<button");
  });
  it("batch confirm is for label rows only, never a compile or a correction", () => {
    const rows = [label(), label({ proposalId: "x2" }), compile({ rechargeCredits: 1, overageCredits: 0 }), patch()];
    expect(batchEligible(rows).map((p) => p.actionType)).toEqual(["library_label", "library_label"]);
  });
  it("the agent badge names the grantor and marks the client name as not verified", () => {
    const proposer = { kind: "agent", grantedBy: "owner@example.invalid", clientLabel: "Desk Agent", clientLabelVerified: false } as const;
    expect(agentBadge(proposer)).toBe("Suggested by an agent connected by owner@example.invalid — client name “Desk Agent” (not verified)");
    expect(html(label({ proposer }))).toContain("(not verified)");
    expect(agentBadge({ kind: "person" })).toBeNull();
  });
  it("Finish is offered on this person's old confirmed row only", () => {
    expect(rowActions(label({ state: "confirmed", previewDigest: null, resumable: true }))).toEqual(["finish"]);
    expect(rowActions(label({ state: "confirmed", previewDigest: null, resumable: false }))).toEqual([]);
    expect(actionBody(label({ state: "confirmed", resumable: true }), "finish")).toMatchObject({ decision: "confirm" });
    expect(actionBody(label({ state: "confirmed", resumable: true }), "finish")).not.toHaveProperty("previewDigest");
    expect(html(label({ state: "confirmed", previewDigest: null, resumable: false }))).not.toContain("<button");
  });
  it("a compile row lists its document ids and the overage clause only when there is overage", () => {
    const withOverage = html(compile({ rechargeCredits: 7, overageCredits: 3 }));
    expect(withOverage).toContain(DOC_A);
    expect(withOverage).toContain(DOC_B);
    expect(withOverage).toContain("Re-charges up to 7 credits, of which up to 3 as overage");
    const without = html(compile({ rechargeCredits: 7, overageCredits: 0 }));
    expect(without).toContain("Re-charges up to 7 credits.");
    expect(without).not.toContain("overage");
    expect(html(compile({ rechargeCredits: 1, overageCredits: 0 }, { notes: ["approver_only"] })))
      .toContain("Only the person who approved these files at upload can start this compile.");
  });
  it("a correction row shows kind and before, after in quotes", () => {
    const markup = html(patch());
    expect(markup).toContain("<q><bdi>Billing</bdi></q>");
    expect(markup).toContain("<q><bdi>Invoicing</bdi></q>");
    expect(markup).toContain("cccccccccccc");
  });
  it("an injected label is text, never markup", () => {
    const markup = html(patch({ preview: { ...patchPreview, after: "<img src=x onerror=alert(1)>" } }));
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });
  it("every injection fixture, as a correction label or a topic key, is escaped text inside the preview element only (I-21)", () => {
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
    const count = (h: string, t: string) => h.split(t).length - 1;
    for (const { payload, id } of PROMPT_INJECTION_FIXTURES) {
      const e = esc(payload);
      const afterHtml = html(patch({ preview: { ...patchPreview, after: payload } }));
      expect(count(afterHtml, e), id).toBe(1);
      expect(afterHtml, id).toContain(`<q><bdi>${e}</bdi></q>`);
      const topicHtml = html(label({ preview: { documentId: DOC_A, sourceVersionId: "b".repeat(64), labelKind: "topic", labelKey: payload, decision: "confirmed" } }));
      expect(count(topicHtml, e), id).toBe(1);
      expect(topicHtml, id).toContain(`<strong><bdi>${e}</bdi></strong>`);
    }
  });
  it("a topic key is shown as stored; only the enumerated doc type has its underscores spelled as spaces", () => {
    const shown = (labelKind: string, labelKey: string) => html(label({ preview: { documentId: DOC_A, sourceVersionId: "b".repeat(64), labelKind, labelKey, decision: "confirmed" } }));
    expect(shown("topic", "tool_call")).toContain("<strong><bdi>tool_call</bdi></strong>");
    expect(shown("doc_type", "purchase_order")).toContain("<strong><bdi>purchase order</bdi></strong>");
  });
  it("the intro does not say that only a person confirms", () => {
    const src = readFileSync(new URL("../components/change-proposals-panel.tsx", import.meta.url), "utf8");
    expect(src).toContain("until it is confirmed in a signed-in session");
    expect(src).not.toContain("until a person confirms");
  });
  it("Undo is for an executed label change; a compile or a correction is not offered one", () => {
    expect(rowActions(label({ state: "executed", previewDigest: null }))).toEqual(["undo"]);
    expect(rowActions(compile({ rechargeCredits: 1, overageCredits: 0 }, { state: "executed", previewDigest: null }))).toEqual([]);
    expect(rowActions(patch({ state: "executed", previewDigest: null }))).toEqual([]);
  });
  it("every person-visible preview value and the client name sit in a <bdi>, so a bidi control cannot reorder what is confirmed (WO-AN-6B)", () => {
    const rlo = "\u202Egnp.exe";
    const proposer = { kind: "agent", grantedBy: "owner@example.invalid", clientLabel: rlo, clientLabelVerified: false } as const;
    expect(html(label({ proposer }))).toContain(`client name “<bdi>${rlo}</bdi>” (not verified)`);
    expect(html(label({ preview: { documentId: DOC_A, sourceVersionId: "b".repeat(64), labelKind: "topic", labelKey: rlo, decision: "confirmed" } })))
      .toContain(`<bdi>${rlo}</bdi>`);
    const markup = html(patch({ preview: { ...patchPreview, before: rlo, after: rlo } }));
    expect(markup.split(`<bdi>${rlo}</bdi>`).length - 1).toBe(2);
  });
  it("a compile row with nothing to re-charge says so, without 'up to 0' (WO-AN-6B)", () => {
    const markup = html(compile({ rechargeCredits: 0, overageCredits: 0 }));
    expect(markup).toContain("Re-charges no credits.");
    expect(markup).not.toContain("up to 0");
  });
  it("a row of an action type this build does not know is skipped; any other malformed row still refuses the page (WO-AN-6B)", () => {
    const unknown = label({ proposalId: "x9", actionType: "something_new" });
    expect(listable([label(), unknown])?.map((p) => p.proposalId)).toEqual([ID]);
    expect(listable([label(), label({ proposalId: "x8", state: "no_such_state" })])).toBeNull();
  });
  it("a deep-linked row whose read by id is 404 is gone; any other failure is not (WO-AN-6B)", () => {
    expect(deepLinkGone({ status: 404 })).toBe(true);
    expect(deepLinkGone({ status: 503 })).toBe(false);
    expect(deepLinkGone({ proposal: label() })).toBe(false);
  });
  it("Show more is disabled while its read is out (WO-AN-6B)", () => {
    const src = readFileSync(new URL("../components/change-proposals-panel.tsx", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("async function showMore()"), src.indexOf("// Deep link:"));
    expect(body).toMatch(/setBusy\("more"\)/);
    expect(body).toMatch(/finally \{\s*setBusy\(null\)/);
  });
  it("an executed agent-origin label change still offers Undo, so the flag never blocks a reversal (WO-AN-6B)", () => {
    const proposer = { kind: "agent", grantedBy: "owner@example.invalid", clientLabel: "Desk Agent", clientLabelVerified: false } as const;
    expect(rowActions(label({ state: "executed", previewDigest: null, proposer }))).toEqual(["undo"]);
  });
  it("the runbook says a reversal never waits on the flag", () => {
    const adr = readFileSync(new URL("../../docs/adr/0009-agent-proposals.md", import.meta.url), "utf8");
    expect(adr).toContain("The flag stops new effects, never a reversal: with it off, a person can still undo an executed agent-origin proposal.");
  });
  it("the runbook says what the kill switch covers and what a later grant is (WO-AN-6B)", () => {
    const adr = readFileSync(new URL("../../docs/adr/0009-agent-proposals.md", import.meta.url), "utf8");
    expect(adr).toContain("The kill switch disconnects every grant committed before it commits; a grant created afterwards is a new one, and the flag is what forbids new grants.");
  });
});

describe("proposal rows show the audit (WO-AN-10)", () => {
  const decided = (over: Record<string, unknown> = {}) =>
    label({ state: "executed", previewDigest: null, decidedAt: "2026-11-18T09:30:45.000Z", youDecided: true, receiptAvailable: true, ...over });

  it("says who confirmed and when, in UTC, and never names a person", () => {
    expect(decisionLine(decided())).toBe("Confirmed by you at 2026-11-18 09:30 UTC");
    expect(decisionLine(decided({ youDecided: false }))).toBe("Confirmed by another member of this workspace at 2026-11-18 09:30 UTC");
    expect(decisionLine(decided({ state: "rejected" }))).toBe("Rejected by you at 2026-11-18 09:30 UTC");
    expect(html(decided())).toContain("Confirmed by you at 2026-11-18 09:30 UTC");
  });
  it("says nothing it was not told: no decider, no time, a time that is not one, or an answer from an older server", () => {
    expect(decisionLine(decided({ youDecided: null }))).toBeNull();
    expect(decisionLine(decided({ decidedAt: null }))).toBeNull();
    expect(decisionLine(decided({ decidedAt: "not a time" }))).toBeNull();
    const { youDecided: _omitted, ...older } = decided();
    expect(decisionLine(older as unknown as PublicProposal)).toBeNull();
    expect(decisionLine(label({ youDecided: true, decidedAt: "2026-11-18T09:30:45.000Z" }))).toBeNull();
    for (const state of ["proposed", "expired", "stale", "withdrawn"]) expect(decisionLine(decided({ state })), state).toBeNull();
  });
  it("offers the signed receipt only where the server says one is stored, and never on a proposed row", () => {
    const withReceipt = (proposal: PublicProposal) => renderToStaticMarkup(createElement(ProposalItem, { proposal, disabled: false, onAct: () => undefined, onReceipt: () => undefined }));
    expect(withReceipt(decided())).toContain("Signed receipt");
    expect(withReceipt(decided({ state: "failed" }))).toContain("Signed receipt");
    expect(withReceipt(decided({ state: "undone" }))).toContain("Signed receipt");
    expect(withReceipt(decided({ receiptAvailable: false }))).not.toContain("Signed receipt");
    expect(withReceipt(label({ receiptAvailable: true }))).not.toContain("Signed receipt");
    expect(html(decided())).not.toContain("Signed receipt");
    expect(receiptOffered(decided({ receiptAvailable: undefined }))).toBe(false);
  });
});

describe("saveAsFile (WO-AN-10)", () => {
  const click = vi.fn();
  const anchor = { href: "", download: "", click };
  beforeEach(() => {
    click.mockClear();
    anchor.href = "";
    anchor.download = "";
    vi.stubGlobal("document", { createElement: () => anchor });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:test", revokeObjectURL: () => undefined }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the path with the session and hands the body to the browser under the given name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await saveAsFile("/api/proposals/x/receipt", "receipt-x.json")).toBe(true);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proposals/x/receipt");
    expect(anchor).toMatchObject({ href: "blob:test", download: "receipt-x.json" });
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("a refusal or a lost connection downloads nothing and says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(await saveAsFile("/api/proposals/x/receipt", "r.json")).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await saveAsFile("/api/proposals/x/receipt", "r.json")).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});
