import { describe, expect, it } from "vitest";
import {
  listOAuthSourcePage,
  OAUTH_SOURCE_PAGE_SIZE,
  oauthSourceDownloadRequest,
  type OAuthSourceItem,
  type OAuthSourcePage,
} from "./connector-oauth-adapters";
import type { OAuthConnectorProvider } from "./connector-oauth";

/*
  One contract, three providers.

  The per-adapter tests next door check what each provider's payload turns into, one provider
  at a time, one page at a time. What nothing checked is the property the sync worker actually
  depends on: that whatever the provider is, a listing paginates to an end, the cursor it hands
  back is the cursor that fetches the next page, and no page ever yields an item missing the
  fields the importer indexes on.

  That gap is not theoretical. `sync-worker.test.ts` mocks `listOAuthSourcePage` entirely, so
  the worker's ordering guarantees are tested against a stub that always behaves, and the
  adapters are tested against single hand-written payloads that always parse. A provider that
  returned `has_more: true` with no cursor -- Dropbox's own documented failure mode -- would sit
  between the two suites, and the worker would loop on page one forever.

  So this drives the real adapters through a fake provider that holds state across pages, and
  asserts the same things of all three. A provider added later fails here until it behaves like
  the others, which is the point of a contract test rather than three more example tests.

  What it deliberately does not do: reach a real Google, Dropbox or Microsoft account. Those
  need credentials, a consent screen and a person, and no amount of mocking substitutes for
  them -- real-account verification stays external QA and is recorded as such rather than
  quietly implied by a green suite here.
*/

const PROVIDERS: OAuthConnectorProvider[] = ["google_drive", "dropbox", "microsoft_graph"];

type Recorded = { url: string; init: RequestInit | undefined };

/**
 * A provider that answers three pages and then stops.
 *
 * Stateful rather than a fixed response: the point is that the cursor from page one is what
 * fetches page two, which a `vi.fn` returning a constant cannot demonstrate.
 */
function fakeProvider(provider: OAuthConnectorProvider, pages = 3) {
  const calls: Recorded[] = [];
  let served = 0;

  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    served += 1;
    const last = served >= pages;
    const index = served;

    if (provider === "google_drive") {
      return Response.json({
        nextPageToken: last ? undefined : `google-page-${index + 1}`,
        files: [
          { id: `file-${index}`, name: `Report ${index}.pdf`, mimeType: "application/pdf", size: String(1024 * index), modifiedTime: "2026-08-30T00:00:00Z", md5Checksum: `md5-${index}` },
          { id: `folder-${index}`, name: `Folder ${index}`, mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-08-30T00:00:00Z", version: `v${index}` },
        ],
      });
    }
    if (provider === "dropbox") {
      return Response.json({
        cursor: `dropbox-page-${index + 1}`,
        has_more: !last,
        entries: [
          { ".tag": "file", id: `id:file-${index}`, name: `Report ${index}.pdf`, path_lower: `/report-${index}.pdf`, rev: `rev-${index}`, size: 1024 * index, server_modified: "2026-08-30T00:00:00Z" },
          { ".tag": "deleted", id: `id:gone-${index}`, name: `Gone ${index}.pdf`, path_lower: `/gone-${index}.pdf` },
        ],
      });
    }
    return Response.json({
      [last ? "@odata.deltaLink" : "@odata.nextLink"]: `https://graph.microsoft.com/v1.0/me/drive/root/delta?token=page-${index + 1}`,
      value: [
        { id: `item-${index}`, name: `Report ${index}.pdf`, eTag: `etag-${index}`, size: 1024 * index, lastModifiedDateTime: "2026-08-30T00:00:00Z", file: { mimeType: "application/pdf" } },
        { id: `gone-${index}`, name: `Gone ${index}.pdf`, deleted: { state: "deleted" } },
      ],
    });
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

/** Walk a provider to the end, the way the sync worker would across invocations. */
async function drain(provider: OAuthConnectorProvider, fetcher: typeof fetch, limit = 10) {
  const pages: OAuthSourcePage[] = [];
  let cursor: string | null = null;
  for (let turn = 0; turn < limit; turn += 1) {
    const page: OAuthSourcePage = await listOAuthSourcePage({ provider, accessToken: "access-token-value", cursor, fetcher });
    pages.push(page);
    if (page.complete) return pages;
    // The contract the worker relies on: not complete means there is a cursor to come back with.
    expect(page.cursor, `${provider} said there was more and gave nothing to resume from`).toBeTruthy();
    cursor = page.cursor;
  }
  throw new Error(`${provider} did not terminate within ${limit} pages`);
}

describe.each(PROVIDERS)("connector contract: %s", (provider) => {
  it("paginates to an end and stops", async () => {
    const { fetcher } = fakeProvider(provider);
    const pages = await drain(provider, fetcher);
    expect(pages).toHaveLength(3);
    expect(pages.at(-1)!.complete).toBe(true);
  });

  it("resumes with the cursor it handed back", async () => {
    const { fetcher, calls } = fakeProvider(provider);
    await drain(provider, fetcher);
    // Page two's request has to carry something page one produced. Every provider expresses
    // that differently -- a query parameter, a POST body, a whole continuation URL -- so the
    // assertion is on the presence of the value rather than on where it was put.
    const second = `${calls[1].url} ${String(calls[1].init?.body ?? "")}`;
    expect(second).toContain("2");
    expect(calls).toHaveLength(3);
  });

  it("asks for a bounded page, so one turn cannot pull an unbounded listing", async () => {
    const { fetcher, calls } = fakeProvider(provider, 1);
    await listOAuthSourcePage({ provider, accessToken: "access-token-value", cursor: null, fetcher });
    const first = `${calls[0].url} ${String(calls[0].init?.body ?? "")}`;
    expect(first).toContain(String(OAUTH_SOURCE_PAGE_SIZE));
  });

  it("returns items the importer can index", async () => {
    const { fetcher } = fakeProvider(provider);
    const items = (await drain(provider, fetcher)).flatMap((page) => page.items);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.nativeId, JSON.stringify(item)).toBeTruthy();
      expect(item.name, JSON.stringify(item)).toBeTruthy();
      // Revision is what makes a re-sync incremental. An item without one would be
      // re-downloaded on every pass, or worse, treated as unchanged forever.
      expect(item.revision, JSON.stringify(item)).toBeTruthy();
      expect(["file", "folder", "deleted"]).toContain(item.kind);
      if (item.sizeBytes !== null) expect(item.sizeBytes).toBeGreaterThanOrEqual(0);
    }
  });

  it("surfaces deletions rather than dropping them", async () => {
    /*
      A connector that silently omits deleted entries leaves the World asserting a source that
      no longer exists, which is the failure that matters most for a system whose whole claim
      is that an answer can be traced back to something real.
    */
    const { fetcher } = fakeProvider(provider);
    const items = (await drain(provider, fetcher)).flatMap((page) => page.items);
    if (provider === "google_drive") {
      // Drive's list endpoint filters trashed files rather than reporting them; deletions
      // arrive as absence. Asserting a `deleted` item here would be asserting a behaviour the
      // provider does not have.
      expect(items.some((item) => item.kind === "deleted")).toBe(false);
      return;
    }
    expect(items.some((item) => item.kind === "deleted")).toBe(true);
  });

  it("never puts the access token in what it returns", async () => {
    const { fetcher } = fakeProvider(provider);
    const pages = await drain(provider, fetcher);
    expect(JSON.stringify(pages)).not.toContain("access-token-value");
  });

  it("fails with a stable code when the provider refuses", async () => {
    const refusing = (async () => Response.json({ error: "nope" }, { status: 403 })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider, accessToken: "access-token-value", cursor: null, fetcher: refusing }))
      .rejects.toThrow("OAUTH_SOURCE_LIST_FAILED");
  });

  it("survives a payload that is nothing like the documented shape", async () => {
    /*
      Every provider response is untrusted input. The adapters may drop what they cannot read;
      what they may not do is emit an item with a missing field, or throw something the worker
      has no branch for.
    */
    const hostile = (async () => Response.json({
      files: [null, 42, { id: "", name: "x" }, { id: "a".repeat(9_999), name: "y", md5Checksum: "z" }, { __proto__: { polluted: true }, id: "ok", name: "ok", md5Checksum: "r" }],
      entries: [null, "string", { ".tag": "unknown", id: "u", name: "u" }, { ".tag": "file", name: "no id" }],
      value: [null, { name: "no id" }, { id: "b".repeat(9_999), name: "y", eTag: "e" }],
      cursor: null,
      has_more: false,
      nextPageToken: null,
    })) as unknown as typeof fetch;
    const page = await listOAuthSourcePage({ provider, accessToken: "access-token-value", cursor: null, fetcher: hostile });
    expect(page.complete).toBe(true);
    for (const item of page.items satisfies OAuthSourceItem[]) {
      expect(item.nativeId.length).toBeGreaterThan(0);
      expect(item.nativeId.length).toBeLessThanOrEqual(1_024);
      expect(item.revision.length).toBeGreaterThan(0);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses a cursor that did not come from the provider", async () => {
    // Only Microsoft's cursor is a URL, and it is the only one that can be pointed elsewhere.
    // The others are opaque tokens the provider echoes, so the equivalent guard is that they
    // are never interpolated into a host.
    const { fetcher, calls } = fakeProvider(provider, 1);
    if (provider === "microsoft_graph") {
      await expect(listOAuthSourcePage({ provider, accessToken: "a", cursor: "https://attacker.test/v1.0/me/drive/root/delta" }))
        .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
      return;
    }
    await listOAuthSourcePage({ provider, accessToken: "a", cursor: "https://attacker.test/steal", fetcher });
    expect(calls[0].url.startsWith("https://attacker.test")).toBe(false);
  });

  it("downloads only from the provider's own origin", async () => {
    const request = oauthSourceDownloadRequest({ provider, nativeId: "item-1", mimeType: "application/pdf", target: {} });
    const origin = new URL(request.url).origin;
    expect([
      "https://www.googleapis.com",
      "https://content.dropboxapi.com",
      "https://graph.microsoft.com",
    ]).toContain(origin);
    expect(JSON.stringify(request)).not.toContain("access-token-value");
  });
});

describe("the failure the contract exists to catch", () => {
  it("refuses a Dropbox page that says there is more and gives nothing to resume from", async () => {
    /*
      Dropbox's documented shape allows `has_more: true` alongside a cursor; a response with the
      first and not the second is malformed, and the adapter has to say so rather than return
      `{ complete: false, cursor: null }`. The worker's loop would then re-list page one on
      every invocation, forever, reporting progress each time.
    */
    const broken = (async () => Response.json({ entries: [], cursor: null, has_more: true })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "dropbox", accessToken: "a", cursor: null, fetcher: broken }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
  });

  it("refuses a Microsoft continuation that points off the provider", async () => {
    const broken = (async () => Response.json({ value: [], "@odata.nextLink": "https://attacker.test/v1.0/next" })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "a", cursor: null, fetcher: broken }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
  });

  it("rejects a target that tries to smuggle a path out of the configured root", async () => {
    await expect(listOAuthSourcePage({ provider: "dropbox", accessToken: "a", cursor: null, target: { rootPath: "../../etc " } }))
      .rejects.toThrow("OAUTH_SOURCE_INPUT_INVALID");
  });
});
