import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { actionBody, agentBadge, batchEligible, decisionProblem, ProposalItem, rowActions } from "../components/change-proposals-panel";
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
    expect(markup).toContain("<q>Billing</q>");
    expect(markup).toContain("<q>Invoicing</q>");
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
      expect(afterHtml, id).toContain(`<q>${e}</q>`);
      const topicHtml = html(label({ preview: { documentId: DOC_A, sourceVersionId: "b".repeat(64), labelKind: "topic", labelKey: payload, decision: "confirmed" } }));
      expect(count(topicHtml, e), id).toBe(1);
      expect(topicHtml, id).toContain(`<strong>${e}</strong>`);
    }
  });
  it("a topic key is shown as stored; only the enumerated doc type has its underscores spelled as spaces", () => {
    const shown = (labelKind: string, labelKey: string) => html(label({ preview: { documentId: DOC_A, sourceVersionId: "b".repeat(64), labelKind, labelKey, decision: "confirmed" } }));
    expect(shown("topic", "tool_call")).toContain("<strong>tool_call</strong>");
    expect(shown("doc_type", "purchase_order")).toContain("<strong>purchase order</strong>");
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
  it("the runbook says a reversal never waits on the flag", () => {
    const adr = readFileSync(new URL("../../docs/adr/0009-agent-proposals.md", import.meta.url), "utf8");
    expect(adr).toContain("The flag stops new effects, never a reversal: with it off, a person can still undo an executed agent-origin proposal.");
  });
});
