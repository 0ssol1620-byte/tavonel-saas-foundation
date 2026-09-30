import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProcessingConsentPanel, {
  acceptanceBody,
  createTermsAcceptor,
  fetchProcessingTerms,
  ProcessingTermsForm,
  termsSubmitErrorSentence,
  type ProcessingTermsOffer,
} from "../components/processing-consent-panel";

const TERMS = { path: "/policy/TAVONEL_SELF_SERVICE_TERMS_2026-09-30.md", sha256: `sha256:${"a".repeat(64)}` };
const PROCESSING = { path: "/policy/TAVONEL_PROCESSING_ADDENDUM_2026-09-30.md", sha256: `sha256:${"b".repeat(64)}` };
const offer: ProcessingTermsOffer = { version: "2026-09-30", terms: TERMS, processing: PROCESSING };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const receipt = {
  acceptanceId: "5f2b8a4e-2c1d-4b7a-9e3f-0a1b2c3d4e5f", scope: "direct_upload", termsVersion: "2026-09-30",
  terms: TERMS, processing: PROCESSING, acceptedAt: "2026-09-30T10:00:00.000Z", idempotentReplay: false,
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("processing consent panel", () => {
  it("offers only a review action until asked, and fetches nothing on render", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = renderToStaticMarkup(createElement(ProcessingConsentPanel, { getToken: async () => "t", onAccepted() {} }));
    expect(html).toMatch(/<button type="button" class="btn ghost" aria-expanded="false"[^>]*>Review processing terms<\/button>/);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("/contact");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never pre-ticks the agreement and cannot submit until the owner ticks it", () => {
    const render = (agreed: boolean, submitting = false) => renderToStaticMarkup(createElement(ProcessingTermsForm, {
      offer, agreed, submitting, error: null, onAgreedChange() {}, onSubmit() {},
    }));
    const unticked = render(false);
    expect(unticked).toMatch(/<label[^>]*><input type="checkbox"(?![^>]*checked)[^>]*\/>/);
    expect(unticked).toMatch(/<button type="submit" class="btn" disabled="">Accept terms<\/button>/);
    expect(unticked).toContain(`href="${TERMS.path}"`);
    expect(unticked).toContain(`href="${PROCESSING.path}"`);
    // Agreement to the published text only: no data-owner approval is asserted on the owner's behalf.
    expect(unticked).not.toMatch(/authori[sz]ed|permission|consent of|data owner/i);
    expect(unticked).not.toMatch(/upload(s)? (is|are) (ready|open)/i);

    expect(render(true)).toMatch(/<button type="submit" class="btn">Accept terms<\/button>/);
    expect(render(true, true)).toMatch(/<button type="submit" class="btn" disabled="">Recording agreement…<\/button>/);
  });
});

describe("fetchProcessingTerms", () => {
  it("parses the published offer", async () => {
    const fetchImpl = vi.fn(async () => json({ ...offer, scopes: ["direct_upload", "connector"] }));
    await expect(fetchProcessingTerms(fetchImpl)).resolves.toEqual({ ok: true, offer });
  });

  it.each([
    ["an unavailable offer", async () => json({ code: "PROCESSING_TERMS_UNAVAILABLE" }, 503), "PROCESSING_TERMS_UNAVAILABLE", 503],
    ["a network failure", async () => { throw new TypeError("offline"); }, "NETWORK_ERROR", 0],
    ["an offer without direct upload", async () => json({ ...offer, scopes: ["connector"] }), "PROCESSING_TERMS_UNAVAILABLE", 200],
    ["a document outside /policy", async () => json({ ...offer, terms: { ...TERMS, path: "https://evil.test/t" }, scopes: ["direct_upload"] }), "PROCESSING_TERMS_UNAVAILABLE", 200],
  ])("reports %s as a failure", async (_label, impl, code, status) => {
    await expect(fetchProcessingTerms(vi.fn(impl) as unknown as typeof fetch)).resolves.toEqual({ ok: false, code, status });
  });
});

describe("createTermsAcceptor", () => {
  it("posts the exact offer for direct_upload with the bearer session", async () => {
    const fetchImpl = vi.fn(async () => json({ code: "PROCESSING_TERMS_ACCEPTED", receipt }, 201));
    const result = await createTermsAcceptor(fetchImpl)(offer, async () => "session-token");
    expect(result).toEqual({ ok: true, receipt: { acceptanceId: receipt.acceptanceId, acceptedAt: receipt.acceptedAt, idempotentReplay: false } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/access/processing-terms");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer session-token", "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({
      accepted: true, version: "2026-09-30", terms: TERMS, processing: PROCESSING, scope: "direct_upload",
    });
    expect(Object.keys(acceptanceBody({ ...offer, extra: 1 } as ProcessingTermsOffer))).toEqual(["accepted", "version", "terms", "processing", "scope"]);
  });

  it("joins a duplicate submit instead of posting twice", async () => {
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    const accept = createTermsAcceptor(fetchImpl);
    const first = accept(offer, async () => "t");
    const second = accept(offer, async () => "t");
    expect(second).toBe(first);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    release(json({ code: "PROCESSING_TERMS_ACCEPTED", receipt }, 201));
    await first;
    // Once settled, a later deliberate submit is a new request.
    const third = accept(offer, async () => "t");
    expect(third).not.toBe(first);
  });

  it("does not post without a session", async () => {
    const fetchImpl = vi.fn();
    await expect(createTermsAcceptor(fetchImpl)(offer, async () => null)).resolves.toEqual({ ok: false, code: "AUTH_REQUIRED", status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [json({ code: "PROCESSING_TERMS_OFFER_CHANGED" }, 409), "PROCESSING_TERMS_OFFER_CHANGED", 409],
    [json({ code: "WORKSPACE_OWNER_REQUIRED" }, 403), "WORKSPACE_OWNER_REQUIRED", 403],
    [json({ code: "PROCESSING_TERMS_ACCEPTED", receipt: { ...receipt, scope: "connector" } }, 201), "PROCESSING_TERMS_STORE_INVALID", 201],
  ])("surfaces refusal %#", async (response, code, status) => {
    await expect(createTermsAcceptor(vi.fn(async () => response))(offer, async () => "t")).resolves.toEqual({ ok: false, code, status });
  });

  it("claims nothing was recorded only for an explicit refusal", () => {
    for (const status of [0, 201, 500, 503]) {
      const sentence = termsSubmitErrorSentence({ ok: false, code: "NETWORK_ERROR", status });
      expect(sentence).not.toContain("Nothing was recorded");
      expect(sentence).toContain("could not confirm");
      expect(sentence).toContain("safely try again");
    }
    for (const [code, status] of [["WORKSPACE_OWNER_REQUIRED", 403], ["PROCESSING_TERMS_OFFER_CHANGED", 409], ["AUTH_REQUIRED", 401]] as const) {
      const sentence = termsSubmitErrorSentence({ ok: false, code, status });
      expect(sentence).toContain("Nothing was recorded");
      expect(sentence).not.toContain(code);
    }
  });
});

describe("workspace integration", () => {
  const page = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
  it("replaces the closed Home intake's contact CTA with the terms review and keeps the public example", () => {
    expect(page).toMatch(/<ProcessingConsentPanel getToken=\{getAuthToken\} onAccepted=\{refreshAccess\}>\s*<Link className="btn" href="\/explore">Explore a compiled World<\/Link>/);
    expect(page).not.toContain('<Link className="btn ghost" href="/contact">Request source access</Link>');
    expect(page).not.toContain("arrange source access with us");
    expect(page).toContain('sourcePending === "terms_acceptance_required" || sourcePending === "legacy"');
  });
});
