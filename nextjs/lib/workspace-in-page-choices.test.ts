import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ActiveWorldPicker,
  activeWorldOpenOutcome,
  askWorldPanel,
  ConfirmDialogBody,
  discoverActiveWorlds,
  discoveryFailureCopy,
  discoveryOutcome,
  requestConfirm,
  type ActiveWorldDiscovery,
  type ConfirmRequest,
} from "@/components/workspace/in-page-choices";

/* WO-WS-1: the four states of Ask's World discovery, through the real loader with a stubbed fetch,
   and the in-page confirmation that replaced window.confirm. */

const id = (c: string) => `collection-${c.repeat(32)}`;
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const world = (c: string, updatedAt: string, revision = 1) => ({ collectionId: id(c), manifestDigest: digest(c), revision, updatedAt });

function listing(collections: unknown[], nextCursor: unknown = null, status = 200, code = "COLLECTIONS_LISTED") {
  return new Response(JSON.stringify({ code, collections, page: { limit: 50, cursor: null, nextCursor } }), { status });
}

function stub(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchImpl, calls };
}

describe("discoverActiveWorlds", () => {
  it("none: an empty listing is the only way to 'No active World yet'", async () => {
    const { fetchImpl, calls } = stub(listing([]));
    expect(await discoverActiveWorlds("tok", fetchImpl)).toEqual({ kind: "none" });
    expect(calls[0].url).toBe("/api/v1/collections?limit=50");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    // Bounded: a listing that never answers aborts into the thrown-fetch "failed" case below.
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("one: exactly one active World is returned for loading", async () => {
    const { fetchImpl } = stub(listing([world("a", "2026-11-20T10:00:00Z")]));
    expect(await discoverActiveWorlds("tok", fetchImpl)).toEqual({ kind: "one", world: world("a", "2026-11-20T10:00:00Z") });
  });

  it("several: every World is listed, most recently activated first, none chosen", async () => {
    const older = world("a", "2026-11-01T00:00:00Z");
    const newer = world("b", "2026-11-22T00:00:00Z", 3);
    const { fetchImpl } = stub(listing([older, newer]));
    const found = await discoverActiveWorlds("tok", fetchImpl);
    expect(found).toEqual({ kind: "several", worlds: [newer, older] });
  });

  it("follows every page before deciding, so a second page is never mistaken for 'only one'", async () => {
    const { fetchImpl, calls } = stub(listing([world("a", "2026-11-01T00:00:00Z")], id("a")), listing([world("b", "2026-11-02T00:00:00Z")]));
    const found = await discoverActiveWorlds("tok", fetchImpl);
    expect(found.kind).toBe("several");
    expect(calls[1].url).toBe(`/api/v1/collections?limit=50&cursor=${id("a")}`);
  });

  it("failed: a refused listing is 'could not check', with the server's code", async () => {
    const { fetchImpl } = stub(listing([], null, 503, "WORLD_STORE_READ_FAILED"));
    expect(await discoverActiveWorlds("tok", fetchImpl)).toEqual({ kind: "failed", code: "WORLD_STORE_READ_FAILED", status: 503 });
  });

  it("failed: carries the response status of a refusal, and none when no answer came back or an OK answer was malformed", async () => {
    for (const status of [401, 402, 403]) {
      expect(await discoverActiveWorlds("tok", stub(listing([], null, status, "AUTH_REQUIRED")).fetchImpl)).toEqual({ kind: "failed", code: "AUTH_REQUIRED", status });
    }
    expect(await discoverActiveWorlds("tok", stub(new Error("offline")).fetchImpl)).toEqual({ kind: "failed", code: null, status: null });
    // 200 with the wrong code: the server did not do what it said; not a refusal and not "200".
    expect(await discoverActiveWorlds("tok", stub(listing([], null, 200, "SOMETHING_ELSE")).fetchImpl)).toEqual({ kind: "failed", code: "SOMETHING_ELSE", status: null });
    expect(await discoverActiveWorlds("tok", stub(listing([null])).fetchImpl)).toEqual({ kind: "failed", code: "ACTIVE_WORLD_BINDING_INVALID", status: null });
  });

  it("failed: a thrown fetch, a non-JSON body or an unknown code shape never reads as 'none'", async () => {
    expect(await discoverActiveWorlds("tok", stub(new Error("offline")).fetchImpl)).toEqual({ kind: "failed", code: null, status: null });
    expect(await discoverActiveWorlds("tok", stub(new Response("<html>", { status: 200 })).fetchImpl)).toEqual({ kind: "failed", code: null, status: null });
    expect(await discoverActiveWorlds("tok", stub(listing([], null, 500, "<script>")).fetchImpl)).toEqual({ kind: "failed", code: null, status: 500 });
    expect(await discoverActiveWorlds("tok", stub(new Response(JSON.stringify({ code: "COLLECTIONS_LISTED" }))).fetchImpl).then((r) => r.kind)).toBe("failed");
  });

  it("failed: one malformed row fails the whole listing instead of being skipped", async () => {
    const good = world("a", "2026-11-01T00:00:00Z");
    for (const bad of [
      { ...world("b", "2026-11-02T00:00:00Z"), revision: Number.NaN },
      { ...world("b", "2026-11-02T00:00:00Z"), revision: 0 },
      { ...world("b", "2026-11-02T00:00:00Z"), revision: "2" },
      { ...world("b", "2026-11-02T00:00:00Z"), manifestDigest: "sha256:short" },
      { ...world("b", "2026-11-02T00:00:00Z"), collectionId: "collection-../x" },
      { ...world("b", "2026-11-02T00:00:00Z"), updatedAt: "not a date" },
      null,
      good, // the same World twice
    ]) {
      const found = await discoverActiveWorlds("tok", stub(listing([good, bad])).fetchImpl);
      expect(found).toEqual({ kind: "failed", code: "ACTIVE_WORLD_BINDING_INVALID", status: null });
    }
  });

  it("failed: a malformed cursor, a missing page object or an endless listing", async () => {
    expect(await discoverActiveWorlds("tok", stub(listing([world("a", "2026-11-01T00:00:00Z")], "../x")).fetchImpl))
      .toEqual({ kind: "failed", code: "WORLD_PAGE_CURSOR_INVALID", status: null });
    expect(await discoverActiveWorlds("tok", stub(new Response(JSON.stringify({ code: "COLLECTIONS_LISTED", collections: [] }))).fetchImpl))
      .toEqual({ kind: "failed", code: "WORLD_PAGE_CURSOR_INVALID", status: null });
    // Distinct ids per page so the cap, not the duplicate check, is what stops it.
    const distinct = Array.from({ length: 20 }, (_, n) => listing([{ ...world("a", "2026-11-01T00:00:00Z"), collectionId: `collection-${n.toString(16).padStart(32, "0")}` }], id("f")));
    const { fetchImpl, calls } = stub(...distinct);
    expect(await discoverActiveWorlds("tok", fetchImpl)).toEqual({ kind: "failed", code: "ACTIVE_WORLD_LIST_TOO_LONG", status: null });
    expect(calls).toHaveLength(20);
  });
});

describe("Ask's World panel reads what was observed, not what is missing now", () => {
  const loaded = { manifestDigest: digest("a") };

  it("an open that loaded the active World leaves discovery idle; one that did not is open-failed", () => {
    expect(activeWorldOpenOutcome(loaded)).toBe("idle");
    expect(activeWorldOpenOutcome(null)).toEqual({ kind: "open-failed" });
    expect(activeWorldOpenOutcome(undefined)).toEqual({ kind: "open-failed" });
  });

  it("after a successful open, clearing the loaded World (a new compile) is 'checking' until the listing answers again", () => {
    const afterOpen = activeWorldOpenOutcome(loaded);
    expect(askWorldPanel(loaded, afterOpen)).toBeNull();
    // A compile runs clearSelection(): activeWorld becomes null and the listing runs again. Nothing
    // failed to open, and nothing about the workspace has been checked yet.
    expect(askWorldPanel(null, afterOpen)).toBe("checking");
  });

  it("never says 'No active World yet' before a listing answered 'none'", () => {
    // WO-WS-3 item 1: the page is still starting (the document list loading), so no listing ran.
    expect(askWorldPanel(null, "idle")).toBe("checking");
    expect(askWorldPanel(null, { kind: "none" })).toBe("none");
  });

  it("each state names its own panel; only an observed open failure says 'could not be opened'", () => {
    const several = { kind: "several" as const, worlds: [world("a", "2026-11-01T00:00:00Z"), world("b", "2026-11-02T00:00:00Z")] };
    expect(askWorldPanel(null, "checking")).toBe("checking");
    expect(askWorldPanel(null, "opening")).toBe("opening");
    expect(askWorldPanel(null, several)).toBe(several);
    expect(askWorldPanel(null, { kind: "failed", code: "X", status: 503 })).toEqual({ kind: "failed", code: "X", status: 503 });
    expect(askWorldPanel(null, { kind: "open-failed" })).toEqual({ kind: "open-failed" });
    expect(askWorldPanel(null, { kind: "none" })).toBe("none");
    expect(askWorldPanel(null, "idle")).toBe("checking");
    expect(askWorldPanel(loaded, { kind: "open-failed" })).toBeNull();
  });
});

describe("what the page does with a listing", () => {
  const one = world("a", "2026-11-01T00:00:00Z");

  it("opens the only active World when the page holds no collection", () => {
    expect(discoveryOutcome({ kind: "one", world: one }, false)).toEqual({ open: one });
  });

  it("offers even a single World for a choice when a collection is already selected, so it is never replaced silently", () => {
    expect(discoveryOutcome({ kind: "one", world: one }, true)).toEqual({ show: { kind: "several", worlds: [one] } });
    const html = renderToStaticMarkup(createElement(ActiveWorldPicker, { worlds: [one], onChoose: () => undefined }));
    expect(html).toContain("This workspace has 1 active World.");
  });

  it("passes none, several and failed through unchanged, selected or not", () => {
    const passed: ActiveWorldDiscovery[] = [
      { kind: "none" },
      { kind: "several", worlds: [one, world("b", "2026-11-02T00:00:00Z")] },
      { kind: "failed", code: null, status: null },
    ];
    for (const found of passed) {
      expect(discoveryOutcome(found, false)).toEqual({ show: found });
      expect(discoveryOutcome(found, true)).toEqual({ show: found });
    }
  });

  it("through the real loader: a refused listing is worded as a refusal, an outage as an outage", async () => {
    for (const status of [401, 402, 403]) {
      const found = await discoverActiveWorlds("tok", stub(listing([], null, status, "NOT_A_KNOWN_CODE")).fetchImpl);
      if (found.kind !== "failed") throw new Error("expected failed");
      const copy = discoveryFailureCopy(found);
      expect(copy.title, String(status)).toBe("This session may not list the workspace's active Worlds.");
      expect(copy.sentence, String(status)).not.toMatch(/servers could not complete/);
    }
    const outage = await discoverActiveWorlds("tok", stub(listing([], null, 503, "NOT_A_KNOWN_CODE")).fetchImpl);
    if (outage.kind !== "failed") throw new Error("expected failed");
    expect(discoveryFailureCopy(outage)).toEqual({ title: "Active Worlds could not be checked.", sentence: "Our servers could not complete this. Nothing was changed. (Reference NOT_A_KNOWN_CODE.)" });
    const offline = await discoverActiveWorlds("tok", stub(new Error("offline")).fetchImpl);
    if (offline.kind !== "failed") throw new Error("expected failed");
    expect(discoveryFailureCopy(offline)).toEqual({ title: "Active Worlds could not be checked.", sentence: "Our servers could not complete this. Nothing was changed." });
  });
});

describe("ActiveWorldPicker", () => {
  it("lists every World in the order given and preselects none", () => {
    const worlds = [world("b", "2026-11-22T00:00:00Z", 3), world("a", "2026-11-01T00:00:00Z")];
    const html = renderToStaticMarkup(createElement(ActiveWorldPicker, { worlds, onChoose: () => undefined }));
    expect(html).toContain("This workspace has 2 active Worlds.");
    expect(html.indexOf(id("b"))).toBeLessThan(html.indexOf(id("a")));
    expect(html).toMatch(/<option value="" selected="">Choose an active World…<\/option>/);
    expect(html).toMatch(/<button type="submit" disabled="">Ask this World<\/button>/);
  });
});

type Node = ReactElement<Record<string, unknown> & { children?: unknown }>;
function buttons(node: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(node)) node.forEach((child) => buttons(child, found));
  else if (node && typeof node === "object" && "props" in node) {
    const element = node as Node;
    if (element.type === "button") found.push(element);
    buttons(element.props.children, found);
  }
  return found;
}

describe("in-page confirmation", () => {
  async function open(message = "Roll the active pointer back? No package bytes will be deleted or rewritten.", pending: { current: ConfirmRequest | null } = { current: null }) {
    let current: ConfirmRequest | null = null;
    const answer = requestConfirm(pending, (request) => { current = request; }, message, "Roll back the active pointer");
    const request = current as ConfirmRequest | null;
    if (!request) throw new Error("no request opened");
    const dialog = ConfirmDialogBody({ request, titleId: "t" }) as Node;
    return { answer, dialog, request, cleared: () => current === null };
  }

  it("shows the native dialog's text and puts the consequence on the confirm button", async () => {
    const { dialog } = await open();
    const html = renderToStaticMarkup(dialog);
    expect(html).toContain("Roll the active pointer back? No package bytes will be deleted or rewritten.");
    expect(buttons(dialog).map((b) => b.props.children)).toEqual(["Cancel", "Roll back the active pointer"]);
  });

  it("Cancel settles false and closes", async () => {
    const { answer, dialog, cleared } = await open();
    (buttons(dialog)[0].props.onClick as () => void)();
    await expect(answer).resolves.toBe(false);
    expect(cleared()).toBe(true);
  });

  it("Escape (the dialog's cancel event) settles false and is held from closing natively", async () => {
    const { answer, dialog } = await open();
    const preventDefault = vi.fn();
    (dialog.props.onCancel as (event: { preventDefault: () => void }) => void)({ preventDefault });
    await expect(answer).resolves.toBe(false);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("confirm settles true once; a second click cannot turn it into a cancel or act twice", async () => {
    const { answer, dialog } = await open();
    const [cancel, confirm] = buttons(dialog);
    (confirm.props.onClick as () => void)();
    (cancel.props.onClick as () => void)();
    await expect(answer).resolves.toBe(true);
  });

  it("a confirmation superseded by a second one settles false, and the second is its own request", async () => {
    const pending: { current: ConfirmRequest | null } = { current: null };
    const first = await open("First?", pending);
    const second = await open("Second?", pending);
    await expect(first.answer).resolves.toBe(false);
    expect(second.request.id).not.toBe(first.request.id);
    expect(pending.current).toBe(second.request);
    // The superseded request's late buttons cannot close or answer the one now open.
    (buttons(first.dialog)[1].props.onClick as () => void)();
    expect(pending.current).toBe(second.request);
    expect(second.cleared()).toBe(false);
    (buttons(second.dialog)[1].props.onClick as () => void)();
    await expect(second.answer).resolves.toBe(true);
    expect(pending.current).toBeNull();
  });
});

describe("page.tsx wiring the helpers cannot show", () => {
  const page = readFileSync(path.resolve(import.meta.dirname, "../app/workspace/page.tsx"), "utf8").replace(/\r\n/g, "\n");

  it("keys the dialog by request, so a superseding confirmation opens (and focuses) as a new dialog", () => {
    expect(page).toMatch(/<ConfirmDialog key=\{confirmRequest\.id\} request=\{confirmRequest\} \/>/);
  });

  it("every place that lets go of the selected collection re-checks the workspace (clearSelection), including Back to a URL without one", () => {
    // The class: a bare setCollectionResult(null) that leaves Ask's listing answer standing.
    const bare = [...page.matchAll(/setCollectionResult\(null\);\s*clearWorldState\(\);/g)];
    expect(bare.length, "only clearSelection itself pairs the two").toBe(1);
    const popstate = /const restoreRevision = \(\) => \{[\s\S]*?\n {4}\};/.exec(page)?.[0] ?? "";
    expect(popstate).toMatch(/else \{[^}]*clearSelection\(\);[^}]*\}/);
  });

  it("an integrity abstention (CITED_EVIDENCE_NOT_IN_PACKET) offers no 'add a source' or 'review' action", () => {
    const integrity = page.indexOf('askResult.reason === CITED_EVIDENCE_NOT_IN_PACKET ? (');
    const generic = page.indexOf(') : askResult.status === "abstained" ? (');
    expect(integrity).toBeGreaterThan(-1);
    expect(generic).toBeGreaterThan(integrity);
    const branch = page.slice(integrity, generic);
    expect(branch).not.toMatch(/<button/);
    expect(page).toMatch(/import \{[^}]*CITED_EVIDENCE_NOT_IN_PACKET[^}]*\} from "@\/lib\/workspace-ask-copy";/);
  });
});

describe("no native dialogs under app/workspace", () => {
  it("has no window.confirm / alert / prompt call in any source file", () => {
    const root = path.resolve(import.meta.dirname, "../app/workspace");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?|mjs)$/.test(name)) files.push(full);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => /(?<![\w$])(?:confirm|alert|prompt)\s*\(/.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });
});
