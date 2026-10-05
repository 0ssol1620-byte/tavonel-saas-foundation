import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  slots: [] as Array<{ kind: "state" | "ref" | "effect"; value?: unknown; deps?: unknown[]; cleanup?: () => void }>,
  cursor: 0,
}));
const triage = vi.hoisted(() => ({
  stage: vi.fn(), preflight: vi.fn(), finalize: vi.fn(), quote: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = runtime.cursor++;
      const slot = runtime.slots[index] ?? { kind: "state" as const, value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      runtime.slots[index] = slot;
      return [slot.value, (next: unknown) => { slot!.value = typeof next === "function" ? (next as (previous: unknown) => unknown)(slot!.value) : next; }];
    },
    useRef(initial: unknown) {
      const index = runtime.cursor++;
      const slot = runtime.slots[index] ?? { kind: "ref" as const, value: { current: initial } };
      runtime.slots[index] = slot;
      return slot.value;
    },
    useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = runtime.cursor++;
      const slot = runtime.slots[index];
      const changed = !slot || !deps || !slot.deps || deps.length !== slot.deps.length
        || deps.some((value, depIndex) => !Object.is(value, slot!.deps![depIndex]));
      if (changed) {
        slot?.cleanup?.();
        const cleanup = effect();
        runtime.slots[index] = { kind: "effect", deps: deps ? [...deps] : undefined, cleanup: typeof cleanup === "function" ? cleanup : undefined };
      }
    },
  };
});

vi.mock("@/lib/intake-triage-client", () => ({
  stageTriage: triage.stage,
  approveAndSealTriage: triage.preflight,
  finalizeTriageReceipt: triage.finalize,
  quoteTriageProcessing: triage.quote,
  confirmLegacyFallback: vi.fn(),
  createLegacyFallbackGate: () => ({ markDisabled: vi.fn(), approveOnce: vi.fn(() => true) }),
}));

import IntakeTriageReview from "@/components/intake-triage-review";
import { uploadApprovedMember, type ApprovedUploadDeps } from "./intake-approval";
import type { TriageProcessingQuote, TriageReceiptReply, TriageUploadFile } from "./intake-triage-client";

const hash = `sha256:${"a".repeat(64)}`;
const triageReceiptId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const documentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileKey = "fk_12345678";
const batch = {
  kind: "ready" as const, batchId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  staged: [{ index: 0, stageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", relativePath: "source.pdf", requestedBytes: 1024, uploadUrl: "https://stage.invalid/put" }],
};
const review = [{ fileKey, relativePath: "source.pdf", choice: null, disposition: "include", unknowns: { encryption: "clear" } }];
const estimate: TriageReceiptReply["estimate"] = {
  currency: "USD", initial: { minimum: 0.02, maximum: 0.04 }, incremental: { minimum: 0, maximum: 0 },
  customerChargeCoverage: {
    policy: "published_page_admission_once", scope: "entire_affected_source_version_set", pricingFingerprint: hash,
    sourceVersions: [{ fileKey, revision: null, contentSha256: hash, mode: "new_read" }],
  },
  operatorCost: { status: "not_priced", unavailableProviders: [] }, basis: "test", assumptions: [],
};
const receipt = {
  code: "TRIAGE_RECEIPT_READY",
  receipt: {
    receiptId: triageReceiptId, triageVersion: "tavonel-intake-triage-v1", inventoryDigest: hash,
    inventory: { inventoryDigest: hash, pricingFingerprint: hash, selectedFileKeys: [fileKey] },
    estimate, approvalReady: true, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  review, approvalBlockers: [], estimate, quote: { estimatedUsd: 0.02, maximumUsd: 0.04 },
} as TriageReceiptReply;
const processingQuote: TriageProcessingQuote = {
  triageReceiptId, clientManifestDigest: hash, pricingFingerprint: hash,
  quote: { maximumPages: 1, reservedCredits: 2, maximumCredits: 4, estimatedUsd: 0.02, maximumUsd: 0.04 },
  files: [{ fileKey }],
};
const sourceFile = { name: "source.pdf", type: "application/pdf", size: 1024 } as File;
const files = [{ file: sourceFile, relativePath: "source.pdf", mimeType: "application/pdf" }] as TriageUploadFile[];

function baseProps(overrides: Partial<Parameters<typeof IntakeTriageReview>[0]> = {}) {
  return {
    files, getToken: async () => "token", onLegacyFallback: vi.fn(), onProcessingApproval: vi.fn(),
    initialEstimate: { minimumUsd: 0.02, maximumUsd: 0.04 }, selectionRevision: "selection-1", ...overrides,
  };
}

function expand(node: unknown): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (typeof node !== "object" || !("type" in node)) return [];
  const element = node as { type: unknown; props: Record<string, unknown> };
  if (typeof element.type === "function") return expand((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  return [element, ...expand(element.props.children)];
}

function mount(props: ReturnType<typeof baseProps>) {
  let currentProps = props;
  const render = () => { runtime.cursor = 0; return expand(IntakeTriageReview(currentProps)); };
  let tree = render();
  const button = (name: string) => {
    const found = tree.find((node) => node.type === "button" && String(node.props.children).includes(name));
    if (!found) throw new Error(`button not found: ${name}`);
    return found;
  };
  return {
    button,
    rerender(nextProps = currentProps) { currentProps = nextProps; tree = render(); },
    async click(name: string) { const handler = button(name).props.onClick as (() => unknown); handler(); await settle(); tree = render(); },
    selectInclude() {
      const selector = tree.find((node) => node.type === "select");
      if (!selector) throw new Error("review select not found");
      (selector.props.onChange as (event: unknown) => void)({ target: { value: "include" } });
      tree = render();
    },
    checkConsent() {
      const checkbox = tree.find((node) => node.type === "input" && node.props.type === "checkbox");
      if (!checkbox) throw new Error("consent checkbox not found");
      (checkbox.props.onChange as (event: unknown) => void)({ target: { checked: true } });
      tree = render();
    },
    nodes: () => tree,
    rerenderNow: () => { tree = render(); },
  };
}

async function settle() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function reachReadyReceipt(view: ReturnType<typeof mount>) {
  await view.click("Review sources before processing");
  await view.click("Approve bounded source preflight");
  view.selectInclude();
  await view.click("Save choices and show estimate");
}

function paidCapability() {
  return {
    code: "TRIAGE_OBJECT_READY", uploadUrl: null, documentId, triageReceiptId,
    contentSha256: hash, objectVersion: "sealed-etag-v1", declaredMimeType: "application/pdf", contentLength: 1024,
    computeReservation: { reservedCredits: 2, maximumCredits: 4,
      quote: { approvedMaxPages: 1, pageBasis: "measured", estimatedUsd: 0.02, maximumUsd: 0.04 } },
  };
}

beforeEach(() => {
  runtime.slots = []; runtime.cursor = 0;
  triage.stage.mockReset().mockResolvedValue(batch);
  triage.preflight.mockReset().mockResolvedValue({ approvalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", review });
  triage.finalize.mockReset().mockResolvedValue(receipt);
  triage.quote.mockReset().mockResolvedValue(processingQuote);
});
afterEach(() => { runtime.slots.forEach((slot) => slot.cleanup?.()); });

describe("triage paid-processing interaction", () => {
  it("keeps the exact receipt and quote available for reconciliation after an uncertain approval", async () => {
    const approve = vi.fn().mockResolvedValue("uncertain");
    const view = mount(baseProps({ onProcessingApproval: approve }));
    await reachReadyReceipt(view);
    await view.click("Get full-processing quote");
    view.checkConsent();
    await view.click("Approve maximum and process sources");

    expect(approve).toHaveBeenCalledTimes(1);
    expect(view.nodes().some((node) => node.type === "input" && node.props.type === "checkbox" && node.props.checked === true)).toBe(true);
    expect(view.nodes().some((node) => node.type === "p" && String(node.props.children).includes("Current server quote"))).toBe(true);
    expect(view.button("Check saved approval / retry same approval")).toBeDefined();
    expect(view.nodes().some((node) => node.type === "button" && String(node.props.children).includes("Review sources before processing"))).toBe(false);
  });

  it("requires an explicit maximum-price consent, deduplicates double clicks, then confirms the sealed object without PUT", async () => {
    const deferredApproval: { release: (() => void) | null } = { release: null };
    let putCalled = false;
    const requests: string[] = [];
    const deps: ApprovedUploadDeps = {
      token: async () => "token",
      fetch: async (input) => {
        const path = String(input); requests.push(path);
        if (path.endsWith("/api/uploads/capability")) return new Response(JSON.stringify(paidCapability()), { status: 200 });
        if (path.endsWith("/api/uploads/confirm")) return new Response(JSON.stringify({ code: "UPLOAD_CONFIRMED", approvedFile: { fileState: "confirmed", documentId } }), { status: 200 });
        throw new Error(`unexpected request ${path}`);
      },
      put: async () => { putCalled = true; return { ok: true, sourceSha256: hash }; },
    };
    const approve = vi.fn(async (quote: TriageProcessingQuote) => {
      await new Promise<void>((resolve) => { deferredApproval.release = resolve; });
      expect(quote.quote.maximumCredits / 100).toBe(quote.quote.maximumUsd);
      const result = await uploadApprovedMember({
        attempt: { attemptKey: "att_0123456789abcdef0123456789abcdef", scopeDigest: hash,
          pricingFingerprint: hash, triageReceiptId: quote.triageReceiptId },
        member: { fileKey, originalFilename: "source.pdf", contentSha256: hash, byteLength: 1024, mimeType: "application/pdf",
          approvedPageBasis: "measured", approvedMaxPages: 1, approvedReservedCredits: 2, approvedMaximumCredits: 4 },
      }, deps);
      expect(result).toMatchObject({ status: "confirmed", documentId });
      return "completed" as const;
    });
    const view = mount(baseProps({ onProcessingApproval: approve }));
    await reachReadyReceipt(view);
    await view.click("Get full-processing quote");
    expect(view.button("Approve maximum and process sources").props.disabled).toBe(true);
    view.checkConsent();
    const action = view.button("Approve maximum and process sources").props.onClick as () => void;
    action(); action();
    await settle();
    expect(approve).toHaveBeenCalledTimes(1);
    expect(deferredApproval.release).not.toBeNull();
    expect(putCalled).toBe(false);
    expect(requests).toEqual([]);
    deferredApproval.release?.();
    await settle();
    view.rerenderNow();
    expect(requests).toEqual(["/api/uploads/capability", "/api/uploads/confirm"]);
    expect(putCalled).toBe(false);
  });

  it("drops a quote that resolves after Clear changes the selection revision", async () => {
    const deferredQuote: { resolve: ((value: TriageProcessingQuote) => void) | null; signal: AbortSignal | null } = { resolve: null, signal: null };
    triage.quote.mockImplementation((_receipt, _token, _fetcher, signal) => {
      deferredQuote.signal = signal as AbortSignal;
      return new Promise<TriageProcessingQuote>((resolve) => { deferredQuote.resolve = resolve; });
    });
    const props = baseProps();
    const view = mount(props);
    await reachReadyReceipt(view);
    const quoteClick = view.button("Get full-processing quote").props.onClick as () => void;
    quoteClick();
    await settle();
    const changed = baseProps({ selectionRevision: "selection-cleared" });
    view.rerender(changed);
    const delayed = deferredQuote.resolve;
    if (!delayed) throw new Error("quote did not start");
    delayed(processingQuote);
    await settle();
    view.rerenderNow();
    expect(view.button("Review sources before processing")).toBeDefined();
    expect(view.nodes().some((node) => node.type === "input" && node.props.type === "checkbox")).toBe(false);
    expect(deferredQuote.signal).toBeInstanceOf(AbortSignal);
    expect(deferredQuote.signal?.aborted).toBe(true);
  });

  it("resets stale quote and receipt state after a definitive 409 outcome so sources can be reviewed again", async () => {
    const approve = vi.fn().mockResolvedValue("stale");
    const view = mount(baseProps({ onProcessingApproval: approve }));
    await reachReadyReceipt(view);
    await view.click("Get full-processing quote");
    view.checkConsent();
    await view.click("Approve maximum and process sources");
    expect(approve).toHaveBeenCalledTimes(1);
    expect(view.button("Review sources before processing")).toBeDefined();
    expect(view.nodes().some((node) => node.type === "input" && node.props.type === "checkbox")).toBe(false);
  });
});
