const playwrightPackage = process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { readFile } = await import("node:fs/promises");
const { expect, test } = "test" in playwrightModule ? playwrightModule : playwrightModule.default;

type Page = import("@playwright/test").Page;

/*
  The Library and the Proposals panel in Changes (WO-D30-4), driven against stateful mocks of
  /api/library/** and /api/proposals/**.

  Each mock behaves like the store it stands for: a decision changes what the next read returns, so
  the panel is held to what it shows after reading again, never to what it was told by a click.
  `executions` counts the writes that reached the executor (a library decision). A proposal that
  must not execute is asserted by that count, after the state in which an execution would have been
  made has been reached.
*/

const collectionId = "collection-cccccccccccccccccccccccccccccccc";
const digestC = `sha256:${"c".repeat(64)}`;
const VERSION = "a".repeat(64);
const DOC_A = "11111111-1111-4111-8111-111111111111";
const DOC_B = "22222222-2222-4222-8222-222222222222";
const DOC_C = "33333333-3333-4333-8333-333333333333";

function token() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "66666666-6666-4666-8666-666666666666", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;
}

async function installSession(page: Page) {
  await page.addInitScript(({ accessToken }: { accessToken: string }) => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem("sb-test-auth-token", JSON.stringify({
      access_token: accessToken, token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
      refresh_token: "e2e-refresh-token",
      user: {
        id: "66666666-6666-4666-8666-666666666666", aud: "authenticated", role: "authenticated",
        email: "proposals-e2e@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(),
      },
    }));
  }, { accessToken: token() });
}

const documentItem = (documentId: string) => ({
  documentId, versionKey: VERSION, sanitizedKey: null, sanitizedSize: null, ocrJsonKey: null, ocrJsonSize: null,
  hasOcrJson: false, cdrReceiptKey: null, ocrReviewKey: null, processingState: "sanitized",
});

async function mockWorkspace(page: Page, documents: string[]) {
  await page.route("**/api/compile-jobs", (route) => route.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/documents", (route) => route.fulfill({ json: { documents: documents.map(documentItem) } }));
  await page.route("**/api/access/bootstrap", (route) => route.fulfill({
    json: { access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null, customerDataEnabled: true } },
  }));
  await page.route("**/api/billing/status", (route) => route.fulfill({
    json: {
      account: {
        accessPlan: null, planCode: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0,
        lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null,
      },
    },
  }));
  await page.route("**/api/v1/reviews**", (route) => route.fulfill({ json: { code: "OK", decisions: [] } }));
  await page.route(`**/api/collections/${collectionId}`, (route) => route.fulfill({
    json: {
      candidatePromotion: false,
      artifactKey: `immutable/e2e/e2e/collections/${collectionId}/${"c".repeat(64)}/candidate-world.json`,
      artifact: {
        schemaVersion: "tavonel.collection_candidate.v1", collectionId, manifestDigest: digestC, lifecycle: "candidate",
        candidatePromotion: false, reviewReasons: [], sourceDocuments: [{ documentId: "manual-fp200" }],
        coreExecution: {
          status: "completed", runtime: "tavonel-python-core-v2", worldStateId: "world-revision-c",
          receipt: { requestId: "request-proposals-e2e", outputSha256: `sha256:${"d".repeat(64)}`, candidatePromotion: false },
        },
        directoryPlan: [{ path: "claims", kind: "claim", sourceIds: ["manual-fp200"] }],
        validation: { status: "passed", counts: { documents: 1, topics: 1, entities: 1, claims: 1, evidence: 1, relations: 1, packageFiles: 4 } },
        package: {
          roots: {},
          files: [
            { path: "ontology/knowledge.jsonld" },
            { path: "ontology/knowledge.ttl" },
            { path: "graph/nodes.csv" },
            { path: "graph/relationships.csv" },
          ],
        },
      },
    },
  }));
  await page.route(`**/api/collections/${collectionId}/world`, (route) => route.fulfill({
    json: {
      code: "OK",
      activeWorld: {
        collectionId, manifestDigest: digestC, revision: 1, updatedAt: "2026-09-04T09:00:00Z", worldStateId: "world-revision-c",
        candidateObjectKey: `immutable/e2e/e2e/collections/${collectionId}/${"c".repeat(64)}/candidate-world.json`,
        coreOutputSha256: `sha256:${"d".repeat(64)}`,
      },
      versions: [{ manifest_digest: digestC, world_state_id: "world-revision-c", lifecycle_status: "active", first_promoted_at: "2026-09-04T09:00:00Z", last_activated_at: "2026-09-04T09:00:00Z", activation_count: 1 }],
    },
  }));
}

/* ---- Library store ---- */

type Label = { state: "proposed" | "confirmed"; label: string };
type LibraryStore = {
  types: Record<string, Label | null>; // null = abstained
  rejected: Record<string, string[]>;
  executions: string[]; // decision names that reached the store
  lastRequests: { decision: string; sourceVersionId: string }[];
};

function libraryDocuments(store: LibraryStore, ids: string[]) {
  return ids.map((documentId) => {
    const type = store.types[documentId];
    return {
      documentId,
      documentType: type ? { label: type.label, state: type.state } : { label: null, state: "abstained" },
      topics: [],
      rejected: (store.rejected[documentId] ?? []).map((label) => ({ kind: "doc_type", label, state: "rejected_by_person" })),
      duplicates: [],
    };
  });
}

async function mockLibrary(page: Page, store: LibraryStore, ids: string[]) {
  await page.route("**/api/library?**", (route) => route.fulfill({
    json: { code: "OK", documents: libraryDocuments(store, ids), sourceVersions: Object.fromEntries(ids.map((id) => [id, VERSION])) },
  }));
  await page.route("**/api/library/decisions", async (route) => {
    const body = route.request().postDataJSON() as { documentId: string; labelKey: string; decision: string; sourceVersionId: string };
    store.lastRequests.push({ decision: body.decision, sourceVersionId: body.sourceVersionId });
    store.executions.push(body.decision);
    const current = store.types[body.documentId];
    if (body.decision === "confirmed" && current) store.types[body.documentId] = { ...current, state: "confirmed" };
    if (body.decision === "undo_confirmed" && current) store.types[body.documentId] = { ...current, state: "proposed" };
    await route.fulfill({ json: { code: "OK" } });
  });
}

/* ---- Proposal store ---- */

type ProposalState = "proposed" | "confirmed" | "executed" | "rejected" | "expired" | "stale" | "failed" | "undone" | "withdrawn";
type StoredProposal = {
  proposalId: string; state: ProposalState; createdAt: string; labelKey: string; documentId: string; keyed?: string;
  /** WO-AN-6: a compile proposal made by an agent; `digest` is what a confirmation must echo, `resumable` an old confirmed row of this viewer. */
  compile?: boolean; agent?: boolean; digest?: string; resumable?: boolean;
  /** WO-AN-10: a signed receipt is stored (set by the mock when an agent row executes, or by the case). */
  signed?: boolean;
};
type ProposalStore = {
  proposals: StoredProposal[];
  activeDigest: string;
  proposalDigest: string;
  executions: string[]; // proposal ids that reached the executor
  decisionCalls: number;
  /** For the lost-response case: record the outcome, then drop the response. */
  loseNextDecisionResponse: boolean;
  recordWhenLost: boolean;
  /** WO-AN-6: confirm bodies as received, a page size for "Show more", and ids the single read answers 404 for. */
  confirmBodies: Record<string, unknown>[];
  pageSize: number | null;
  missingIds: string[];
};

const proposal = (n: number, state: ProposalState, labelKey = "invoice"): StoredProposal => ({
  proposalId: `00000000-0000-4000-8000-00000000000${n}`, state, createdAt: `2026-11-1${n}T09:00:00.000Z`, labelKey, documentId: DOC_A,
});

const digestOf = (p: StoredProposal) => `sha256:${p.digest ?? "f".repeat(64)}`;
const toPublic = (p: StoredProposal) => ({
  proposalId: p.proposalId, state: p.state, collectionId, resumable: p.resumable ?? false,
  ...(p.compile
    ? { actionType: "compile_plan", preview: { documentIds: [DOC_A, DOC_B], documentsTotal: 2, corpus: true, parts: 1, quote: { rechargeCredits: 9, balanceRechargeCredits: 6, overageCredits: 3 } } }
    : { actionType: "library_label", preview: { documentId: p.documentId, sourceVersionId: VERSION, labelKind: "doc_type", labelKey: p.labelKey, decision: "confirmed" } }),
  previewDigest: p.state === "proposed" ? digestOf(p) : null,
  proposer: p.agent ? { kind: "agent", grantedBy: "owner@example.invalid", clientLabel: p.labelKey === "injected" ? "<img src=x onerror=alert(1)>" : "Desk Agent", clientLabelVerified: false } : { kind: "person" },
  notes: [],
  evidenceIds: ["evidence-1"], expiresAt: "2026-11-24T09:00:00.000Z", createdAt: p.createdAt,
  // WO-AN-10: an executed row says who decided (a person, never named) and whether a signed receipt is stored.
  ...(p.state === "executed" ? { decidedAt: "2026-11-18T09:30:00.000Z", youDecided: true, receiptAvailable: p.signed === true }
    : { decidedAt: null, youDecided: null, receiptAvailable: false }),
});

async function mockProposals(page: Page, store: ProposalStore) {
  // The workspace inbox: newest first, a page at a time when the store sets a page size (cursor = offset).
  const list = (route: import("@playwright/test").Route) => {
    const sorted = [...store.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = Number(new URL(route.request().url()).searchParams.get("cursor") ?? "0");
    const size = store.pageSize ?? sorted.length;
    const next = offset + size < sorted.length ? String(offset + size) : null;
    return route.fulfill({ json: { code: "OK", proposals: sorted.slice(offset, offset + size).map(toPublic), nextCursor: next } });
  };
  await page.route("**/api/proposals?**", list);
  await page.route("**/api/proposals/*", (route) => {
    const id = route.request().url().split("/").pop()?.split("?")[0];
    const found = store.proposals.find((p) => p.proposalId === id);
    if (!found || store.missingIds.includes(id ?? "")) return route.fulfill({ status: 404, json: { code: "PROPOSAL_NOT_FOUND" } });
    return route.fulfill({ json: { code: "OK", proposal: toPublic(found) } });
  });
  await page.route("**/api/proposals", async (route) => {
    if (route.request().method() === "GET") return list(route);
    if (route.request().method() !== "POST") return route.fallback();
    const key = route.request().headers()["idempotency-key"];
    const existing = store.proposals.find((p) => p.keyed === key);
    if (existing) return route.fulfill({ json: { code: "OK", proposal: toPublic(existing), replayed: true } });
    const created = { ...proposal(store.proposals.length + 1, "proposed"), keyed: key };
    store.proposals.push(created);
    return route.fulfill({ status: 201, json: { code: "OK", proposal: toPublic(created), replayed: false } });
  });
  await page.route("**/api/proposals/*/decision", async (route) => {
    store.decisionCalls += 1;
    const id = route.request().url().split("/").slice(-2)[0];
    const target = store.proposals.find((p) => p.proposalId === id);
    const sent = route.request().postDataJSON() as { decision: "confirm" | "reject"; previewDigest?: string };
    const { decision } = sent;
    if (decision === "confirm") store.confirmBodies.push(sent);
    if (target?.state === "confirmed" && target.resumable && decision === "confirm") {
      target.state = "executed"; target.resumable = false; target.signed = target.agent === true; store.executions.push(id);
      return route.fulfill({ json: { code: "OK" } });
    }
    if (!target || target.state !== "proposed") return route.fulfill({ status: 409, json: { code: "PROPOSAL_NOT_DECIDABLE" } });
    if (decision === "confirm" && sent.previewDigest !== digestOf(target)) return route.fulfill({ status: 409, json: { code: "PROPOSAL_PREVIEW_CHANGED" } });
    if (store.proposalDigest !== store.activeDigest) {
      target.state = "stale"; // the active World moved: nothing is executed
      return route.fulfill({ status: 409, json: { code: "PROPOSAL_STALE" } });
    }
    if (decision === "reject") target.state = "rejected";
    else {
      if (!store.loseNextDecisionResponse || store.recordWhenLost) { target.state = "executed"; target.signed = target.agent === true; store.executions.push(id); }
    }
    if (store.loseNextDecisionResponse) { store.loseNextDecisionResponse = false; return route.abort("failed"); }
    return route.fulfill({ json: { code: "OK" } });
  });
  await page.route("**/api/proposals/*/undo", async (route) => {
    const id = route.request().url().split("/").slice(-2)[0];
    const target = store.proposals.find((p) => p.proposalId === id);
    if (!target || target.state !== "executed") return route.fulfill({ status: 409, json: { code: "PROPOSAL_NOT_DECIDABLE" } });
    target.state = "undone";
    return route.fulfill({ json: { code: "OK" } });
  });
}

const newProposalStore = (proposals: StoredProposal[]): ProposalStore => ({
  proposals, activeDigest: digestC, proposalDigest: digestC, executions: [], decisionCalls: 0, loseNextDecisionResponse: false, recordWhenLost: false,
  confirmBodies: [], pageSize: null, missingIds: [],
});
const newLibraryStore = (types: LibraryStore["types"]): LibraryStore => ({ types, rejected: {}, executions: [], lastRequests: [] });

/** Review screenshots: written only when WO_SHOTS_DIR is set, so a normal run leaves no files. */
async function shot(page: Page, name: string) {
  const dir = process.env.WO_SHOTS_DIR;
  const width = page.viewportSize()?.width;
  if (dir && (width === 390 || width === 1440)) await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openLibrary(page: Page, store: LibraryStore, ids: string[]) {
  await installSession(page);
  await mockWorkspace(page, ids);
  await mockLibrary(page, store, ids);
  await page.goto(`/workspace/sources?collection=${collectionId}`);
  const library = page.getByRole("region", { name: "Library" });
  await expect(library.getByRole("heading", { name: "Library", exact: true })).toBeVisible();
  return library;
}

async function openProposals(page: Page, store: ProposalStore, query = "") {
  await installSession(page);
  await mockWorkspace(page, [DOC_A]);
  await mockProposals(page, store);
  await page.goto(`/workspace/changes?collection=${collectionId}${query}`);
  const panel = page.getByRole("region", { name: "Proposals" });
  await expect(panel.getByRole("heading", { name: "Proposals", exact: true })).toBeVisible();
  return panel;
}

const group = (library: ReturnType<Page["locator"]>, id: string) => library.locator(`[data-group="${id}"]`);

test("Library keeps an abstained source in Unknown, visible, with no control to decide", async ({ page }) => {
  const store = newLibraryStore({ [DOC_A]: { state: "proposed", label: "invoice" }, [DOC_B]: null });
  const library = await openLibrary(page, store, [DOC_A, DOC_B]);

  const unknown = group(library, "unknown");
  await expect(unknown.getByRole("heading", { name: /Unknown/ })).toContainText("1");
  await expect(unknown.getByText("Source 222222")).toBeVisible();
  await expect(unknown.getByRole("listitem").filter({ hasText: /Type\s+Unknown/ })).toHaveCount(1);
  // Nothing to confirm on a label that was never proposed.
  await expect(unknown.getByRole("button")).toHaveCount(0);
  await expect(group(library, "proposed").getByText("Source 111111")).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("Library: Confirm moves a proposed type to Confirmed and Undo returns it to Proposed", async ({ page }) => {
  const store = newLibraryStore({ [DOC_A]: { state: "proposed", label: "invoice" } });
  const library = await openLibrary(page, store, [DOC_A]);

  const proposed = group(library, "proposed");
  await expect(proposed.getByText("Source 111111")).toBeVisible();
  await proposed.getByRole("button", { name: "Confirm type invoice" }).click();

  const confirmed = group(library, "confirmed");
  await expect(confirmed.getByText("Source 111111")).toBeVisible();
  await expect(proposed.getByText("Source 111111")).toHaveCount(0);
  expect(store.lastRequests.at(-1)).toEqual({ decision: "confirmed", sourceVersionId: VERSION });

  await confirmed.getByRole("button", { name: "Undo confirming type invoice" }).click();
  await expect(group(library, "proposed").getByText("Source 111111")).toBeVisible();
  await expect(group(library, "confirmed").getByText("Source 111111")).toHaveCount(0);
  expect(store.executions).toEqual(["confirmed", "undo_confirmed"]);
});

test("Proposals: Confirm executes once, shows Done, and Undo shows Undone with no further control", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed")]);
  const panel = await openProposals(page, store);

  const row = panel.getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row.locator("span").filter({ hasText: /^Proposed$/ })).toBeVisible();
  await expect(row).toContainText("Confirm type invoice on");
  expect(store.executions).toHaveLength(0);

  await row.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row.locator("span").filter({ hasText: /^Done$/ })).toBeVisible();
  await expect(row.getByRole("button", { name: "Confirm", exact: true })).toHaveCount(0);
  expect(store.executions).toHaveLength(1);

  await row.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row.locator("span").filter({ hasText: /^Undone$/ })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(store.executions).toHaveLength(1);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("Proposals: a proposal created twice with the same key is listed once", async ({ page }) => {
  const store = newProposalStore([]);
  const panel = await openProposals(page, store);
  await expect(panel.getByText("No proposals.")).toBeVisible();

  const replies = await page.evaluate(async (id: string) => {
    const send = () => fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-key-0001" }, body: JSON.stringify({ collectionId: id }) });
    const first = await (await send()).json();
    const second = await (await send()).json();
    return [first.replayed, second.replayed];
  }, collectionId);
  expect(replies).toEqual([false, true]);
  expect(store.proposals).toHaveLength(1);

  await page.goto(`/workspace/changes?collection=${collectionId}`);
  const reread = page.getByRole("region", { name: "Proposals" });
  await expect(reread.getByRole("listitem")).toHaveCount(1);
  await expect(reread.getByText("No proposals.")).toHaveCount(0);
});

test("Proposals: confirming after the active World moved shows Out of date and executes nothing", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed")]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await expect(row.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();

  store.activeDigest = `sha256:${"e".repeat(64)}`; // the World moved after the list was read
  await row.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(row.locator("span").filter({ hasText: /^Out of date$/ })).toBeVisible();
  await expect(panel.getByText("This proposal can no longer be changed.")).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(store.decisionCalls).toBe(1); // the click did reach the server, which refused it
  expect(store.executions).toHaveLength(0);
});

test("Proposals: an expired proposal says Expired and offers no button", async ({ page }) => {
  const store = newProposalStore([proposal(1, "expired")]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await expect(row.locator("span").filter({ hasText: /^Expired$/ })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(store.decisionCalls).toBe(0);
});

test("Proposals: Reject records Rejected, offers no Undo, and executes nothing", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed")]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await row.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(row.locator("span").filter({ hasText: /^Rejected$/ })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(store.executions).toHaveLength(0);
});

test("Proposals: a lost Confirm response is read again and never announces success", async ({ page }) => {
  // The store recorded the confirm, the response never arrived.
  const store = newProposalStore([proposal(1, "proposed")]);
  store.loseNextDecisionResponse = true;
  store.recordWhenLost = true;
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await row.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(panel.getByText("The response could not be confirmed.")).toBeVisible();
  // What it shows is what the store holds after the re-read, and no sentence claims the click worked.
  await expect(row.locator("span").filter({ hasText: /^Done$/ })).toBeVisible();
  await expect(panel).not.toContainText(/saved|succeeded|confirmed successfully/i);
  expect(store.executions).toHaveLength(1);
});

test("Proposals: a lost Confirm response that recorded nothing leaves the proposal Proposed", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed")]);
  store.loseNextDecisionResponse = true;
  store.recordWhenLost = false;
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await row.getByRole("button", { name: "Confirm", exact: true }).click();

  await expect(panel.getByText("The response could not be confirmed.")).toBeVisible();
  await expect(row.locator("span").filter({ hasText: /^Proposed$/ })).toBeVisible();
  await expect(row.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
  await expect(row.locator("span").filter({ hasText: /^Done$/ })).toHaveCount(0);
  expect(store.executions).toHaveLength(0);
});

test("Proposals: Confirm then Undo are reachable and operable from the keyboard alone", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed")]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");

  const confirm = row.getByRole("button", { name: "Confirm", exact: true });
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(row.getByRole("button", { name: "Reject", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");

  const undo = row.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await undo.focus();
  await expect(undo).toBeFocused();
  await page.keyboard.press("Space");
  await expect(row.locator("span").filter({ hasText: /^Undone$/ })).toBeVisible();
  expect(store.executions).toHaveLength(1);
});

test("Library and Proposals panels do not overflow the page at the project width", async ({ page }) => {
  const library = newLibraryStore({ [DOC_A]: { state: "proposed", label: "invoice" }, [DOC_B]: null, [DOC_C]: { state: "confirmed", label: "contract" } });
  const ids = [DOC_A, DOC_B, DOC_C];
  await openLibrary(page, library, ids);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  const store = newProposalStore([proposal(1, "proposed"), proposal(2, "executed", "purchase_order"), proposal(3, "expired")]);
  await mockProposals(page, store);
  await page.goto(`/workspace/changes?collection=${collectionId}`);
  const panel = page.getByRole("region", { name: "Proposals" });
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
});

/* ---- WO-AN-6: agent rows, deep link, Agent access ---- */

const FAKE_CREDENTIAL = "tvnl_agt_TEST-ONLY-NOT-A-CREDENTIAL";
const agentCompile = (n: number, state: ProposalState = "proposed"): StoredProposal => ({ ...proposal(n, state), compile: true, agent: true, digest: "1".repeat(64) });

test("Proposals: an agent compile row names who suggested it, lists the documents, confirms with its digest and ends Done", async ({ page }) => {
  const store = newProposalStore([agentCompile(1)]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");

  await expect(row).toContainText("Suggested by an agent connected by owner@example.invalid — client name “Desk Agent” (not verified)");
  await expect(row).toContainText(DOC_A);
  await expect(row).toContainText(DOC_B);
  await expect(row).toContainText("Re-charges up to 9 credits, of which up to 3 as overage");
  // A compile row is never part of a batch.
  await expect(panel.getByRole("button", { name: /Confirm all/ })).toHaveCount(0);
  await shot(page, "agent-compile-row");

  await row.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row.locator("span").filter({ hasText: /^Done$/ })).toBeVisible();
  expect(store.confirmBodies).toHaveLength(1);
  expect(store.confirmBodies[0]).toMatchObject({ decision: "confirm", previewDigest: `sha256:${"1".repeat(64)}` });
  expect(store.executions).toHaveLength(1);
  // No undo exists for a compile. An executed agent row offers its signed receipt (WO-AN-10), and nothing else.
  await expect(row.getByRole("button").filter({ hasNotText: "Signed receipt" })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Undo" })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("Proposals: a preview that changed since it was shown says so and the re-read shows the new one", async ({ page }) => {
  const store = newProposalStore([agentCompile(1)]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await expect(row.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();

  store.proposals[0]!.digest = "2".repeat(64); // the preview changed after the list was read
  await row.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(panel.getByText("This suggestion changed since it was shown. Review it again.")).toBeVisible();
  await expect(row.locator("span").filter({ hasText: /^Proposed$/ })).toBeVisible();
  expect(store.executions).toHaveLength(0);

  await row.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(row.locator("span").filter({ hasText: /^Done$/ })).toBeVisible();
  expect(store.confirmBodies.at(-1)).toMatchObject({ previewDigest: `sha256:${"2".repeat(64)}` });
});

test("Proposals: a withdrawn row says Withdrawn and offers nothing", async ({ page }) => {
  const store = newProposalStore([agentCompile(1, "withdrawn")]);
  const panel = await openProposals(page, store);
  const row = panel.getByRole("listitem");
  await expect(row.locator("span").filter({ hasText: /^Withdrawn$/ })).toBeVisible();
  await expect(row.getByRole("button")).toHaveCount(0);
  expect(store.decisionCalls).toBe(0);
});

test("Proposals: Finish appears on this person's old confirmed row only and runs it once", async ({ page }) => {
  const old = { ...proposal(1, "confirmed"), resumable: true };
  const store = newProposalStore([old, proposal(2, "confirmed")]);
  const panel = await openProposals(page, store);
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await expect(panel.getByRole("button", { name: "Finish", exact: true })).toHaveCount(1);

  await panel.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Finish", exact: true })).toHaveCount(0);
  expect(store.confirmBodies[0]).toMatchObject({ decision: "confirm" });
  expect(store.confirmBodies[0]).not.toHaveProperty("previewDigest");
  expect(store.executions).toHaveLength(1);
});

test("Proposals: Show more reads the next page with the cursor, and batch confirm covers label rows only", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed"), proposal(2, "proposed", "purchase_order"), agentCompile(3)]);
  store.pageSize = 2;
  const panel = await openProposals(page, store);
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("button", { name: "Show more" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  await expect(panel.getByRole("button", { name: "Show more" })).toHaveCount(0);

  await panel.getByRole("button", { name: /Confirm all label suggestions/ }).click();
  await expect(panel.locator("span").filter({ hasText: /^Done$/ })).toHaveCount(2);
  expect(store.executions).toHaveLength(2);
  expect(store.proposals.find((p) => p.compile)?.state).toBe("proposed");
});

test("Proposals: the deep link focuses a row that is not on the first page, and says so when it is gone", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed"), proposal(2, "proposed", "purchase_order"), agentCompile(3)]);
  store.pageSize = 1;
  const oldest = proposal(1, "proposed").proposalId;
  await openProposals(page, store, `&proposal=${oldest}`);
  await expect(page.locator(`#proposal-${oldest}`)).toBeFocused();

  const absent = newProposalStore([proposal(1, "proposed")]);
  await mockProposals(page, absent);
  await page.goto(`/workspace/changes?collection=${collectionId}&proposal=00000000-0000-4000-8000-0000000000aa`);
  await expect(page.getByText("This suggestion is not available.")).toBeVisible();
});

test("Proposals: the deep link focuses a row that is on the first page", async ({ page }) => {
  const store = newProposalStore([proposal(1, "proposed"), agentCompile(2)]);
  const target = agentCompile(2).proposalId;
  await openProposals(page, store, `&proposal=${target}`);
  await expect(page.locator(`#proposal-${target}`)).toBeFocused();
});

test("Proposals: an injected client name is shown as text", async ({ page }) => {
  const injected = { ...agentCompile(1), labelKey: "injected" };
  const store = newProposalStore([injected]);
  const panel = await openProposals(page, store);
  await expect(panel.getByRole("listitem")).toContainText("<img src=x onerror=alert(1)>");
  await expect(panel.locator("img")).toHaveCount(0);
  await expect(panel.locator("bdi").filter({ hasText: "<img src=x onerror=alert(1)>" })).toHaveCount(1);
});

type Grant = { grantId: string; clientLabel: string; createdAt: string; expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null };

async function openAgentAccess(page: Page, grants: Grant[]) {
  await installSession(page);
  await mockWorkspace(page, [DOC_A]);
  await page.route("**/api/developer/keys", (route) => route.fulfill({ json: { code: "OK", keys: [], remoteMcpKeys: [] } }));
  await page.route("**/api/agent-grants", async (route) => {
    if (route.request().method() === "POST") {
      const { clientLabel } = route.request().postDataJSON() as { clientLabel: string };
      const grant = { grantId: `00000000-0000-4000-8000-0000000000b${grants.length}`, clientLabel, createdAt: "2026-11-17T09:00:00.000Z", expiresAt: null, revokedAt: null, lastUsedAt: null };
      grants.unshift(grant);
      return route.fulfill({ status: 201, json: { code: "CREATED", grant, token: FAKE_CREDENTIAL } });
    }
    return route.fulfill({ json: { code: "OK", grants, truncated: false, creatable: true } });
  });
  await page.route("**/api/agent-grants/*", (route) => {
    const grant = grants.find((g) => route.request().url().endsWith(g.grantId));
    if (!grant || grant.revokedAt) return route.fulfill({ status: 404, json: { code: "NOT_FOUND" } });
    grant.revokedAt = "2026-11-17T10:00:00.000Z";
    return route.fulfill({ json: { code: "REVOKED", revokedAt: grant.revokedAt, keysRevoked: 1, proposalsWithdrawn: 0 } });
  });
  await page.goto("/workspace/developer");
  const panel = page.getByRole("region", { name: "Agent access" });
  await expect(panel.getByRole("heading", { name: "Agent access" })).toBeVisible();
  return panel;
}

test("Agent access: consent before Create, the credential once, then Disconnect", async ({ page }) => {
  const grants: Grant[] = [];
  const panel = await openAgentAccess(page, grants);
  await expect(panel.getByText("No agent is connected.")).toBeVisible();

  await panel.getByLabel("Client name").fill("Desk Agent");
  await expect(panel.getByText("“Desk Agent” will see the list of your documents", { exact: false })).toBeVisible();
  await expect(panel.getByText("Each suggestion waits in Changes until it is confirmed in a signed-in TAVONEL session.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Create connection" }).click();

  await expect(panel.getByText(FAKE_CREDENTIAL)).toBeVisible();
  await expect(panel.getByText("It will not be shown again.", { exact: false })).toBeVisible();
  await expect(panel.getByRole("status").filter({ hasText: "A credential was created." })).toHaveCount(1);
  await expect(panel.getByRole("status").filter({ hasText: FAKE_CREDENTIAL })).toHaveCount(0);
  await expect(panel.locator("[aria-live]").filter({ hasText: FAKE_CREDENTIAL })).toHaveCount(0);
  await expect(panel.getByRole("listitem")).toContainText("“Desk Agent”");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "agent-access-credential");

  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel.getByText(FAKE_CREDENTIAL)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(FAKE_CREDENTIAL)).toHaveCount(0);

  const reread = page.getByRole("region", { name: "Agent access" });
  await reread.getByRole("button", { name: "Disconnect “Desk Agent”" }).click();
  await expect(reread.getByRole("listitem")).toContainText("Disconnected");
  await expect(reread.getByRole("button", { name: /Disconnect “/ })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

/* ---- WO-AN-10: who confirmed, the signed receipt, per-grant activity ---- */

test("Proposals: a confirmed agent row says who confirmed and when, and its signed receipt downloads; an open row offers neither", async ({ page }) => {
  const store = newProposalStore([agentCompile(1), agentCompile(2)]);
  const receipts: string[] = [];
  await page.route("**/api/proposals/*/receipt", (route) => {
    receipts.push(route.request().url());
    return route.fulfill({ json: { payloadJson: "{}", signature: { keyId: "e2e" } }, headers: { "Cache-Control": "no-store" } });
  });
  const panel = await openProposals(page, store);
  const rows = panel.getByRole("listitem");
  const open = rows.filter({ hasText: "Suggested by an agent" }).first(); // newest first: proposal 2
  await open.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(open.locator("span").filter({ hasText: /^Done$/ })).toBeVisible();

  await expect(open).toContainText("Confirmed by you at 2026-11-18 09:30 UTC");
  await expect(rows.nth(1).getByRole("button", { name: "Signed receipt" })).toHaveCount(0);
  await expect(rows.nth(1)).not.toContainText("Confirmed by");
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "confirmed-receipt-row");

  const [download] = await Promise.all([page.waitForEvent("download"), open.getByRole("button", { name: "Signed receipt" }).click()]);
  expect(download.suggestedFilename()).toBe(`receipt-${store.proposals[1]!.proposalId}.json`);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toContain(`/api/proposals/${store.proposals[1]!.proposalId}/receipt`);
});

test("Proposals: a receipt that cannot be read says so and downloads nothing", async ({ page }) => {
  const store = newProposalStore([{ ...agentCompile(1, "executed"), signed: true }]);
  await page.route("**/api/proposals/*/receipt", (route) => route.fulfill({ status: 404, json: { code: "PROPOSAL_NOT_FOUND" } }));
  const panel = await openProposals(page, store);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await panel.getByRole("button", { name: "Signed receipt" }).click();
  await expect(panel.getByRole("status").filter({ hasText: "The receipt could not be downloaded." })).toBeVisible();
  expect(downloaded).toBe(false);
});

test("Agent access: Activity lists what this connection proposed, pages it, and exports the same rows", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const grantId = "00000000-0000-4000-8000-0000000000b0";
  const grants: Grant[] = [{ grantId, clientLabel: "Desk Agent", createdAt: "2026-11-17T09:00:00.000Z", expiresAt: null, revokedAt: null, lastUsedAt: null }];
  const all = Array.from({ length: 3 }, (_, index) => ({
    proposalId: `00000000-0000-4000-8000-00000000001${index}`, actionType: "library_label", state: index === 0 ? "executed" : "proposed",
    createdAt: `2026-11-18T09:0${index}:00.000Z`, decidedAt: index === 0 ? "2026-11-18T09:30:00.000Z" : null, receiptAvailable: index === 0,
  })).reverse();
  const requests: string[] = [];
  const panel = await openAgentAccess(page, grants);
  await page.route(`**/api/agent-grants/${grantId}/activity**`, (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const start = Number(url.searchParams.get("cursor") ?? "0");
    const rows = all.slice(start, start + 2);
    const next = start + 2 < all.length ? String(start + 2) : null;
    if (url.searchParams.get("format") === "ndjson") {
      return route.fulfill({ body: rows.map((row) => JSON.stringify(row)).join("\n") + "\n", contentType: "application/x-ndjson", headers: { "Cache-Control": "no-store" } });
    }
    return route.fulfill({ json: { code: "OK", activity: rows, nextCursor: next }, headers: { "Cache-Control": "no-store" } });
  });

  const activity = panel.getByRole("button", { name: "Activity of “Desk Agent”" });
  await expect(activity).toHaveAttribute("aria-expanded", "false");
  await activity.click();
  await expect(activity).toHaveAttribute("aria-expanded", "true");
  const list = panel.getByRole("list", { name: "Activity" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("proposed 2026-11-18 09:02 UTC");
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  await panel.getByRole("button", { name: "Show more" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("signed receipt stored");
  await expect(panel.getByRole("button", { name: "Show more" })).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);
  await shot(page, "agent-activity");

  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Export these rows" }).click()]);
  expect(download.suggestedFilename()).toBe(`agent-activity-${grantId}.ndjson`);
  // The file holds every listed row (pages 1 and 2), in the listed order, not just the first page.
  const exported = (await readFile((await download.path())!, "utf8")).trim().split("\n").map((line) => JSON.parse(line).proposalId);
  expect(exported).toEqual(all.map((r) => r.proposalId));

  await activity.click();
  await expect(list).toHaveCount(0);
});
