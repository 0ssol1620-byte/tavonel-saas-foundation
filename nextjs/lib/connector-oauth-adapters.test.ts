import { describe, expect, it, vi } from "vitest";
import { listOAuthSourcePage, OAUTH_SOURCE_PAGE_SIZE, oauthSourceDownloadRequest } from "./connector-oauth-adapters";

describe("OAuth source adapters", () => {
  it("keeps the selected shared drive on the first and following pages", async () => {
    const fetcher = vi.fn(async () => Response.json({ files: [], nextPageToken: null }));
    for (const cursor of [null, "next-page"]) {
      await listOAuthSourcePage({ provider: "google_drive", accessToken: "test", cursor,
        target: { driveId: "shared-drive_1" }, fetcher });
    }
    for (const call of fetcher.mock.calls as unknown as Array<[string]>) {
      const url = new URL(String(call[0]));
      expect(url.searchParams.get("driveId")).toBe("shared-drive_1");
      expect(url.searchParams.get("corpora")).toBe("drive");
      expect(url.searchParams.get("supportsAllDrives")).toBe("true");
      expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
      expect(url.searchParams.get("fields")).toContain("incompleteSearch");
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses unsupported Google path/site selections before any all-files request", async () => {
    const fetcher = vi.fn();
    for (const target of [{ rootPath: "/Research" }, { siteId: "site-one" }, { driveId: "" }, { driveId: "drive/other" }]) {
      await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "test", cursor: null, target, fetcher }))
        .rejects.toThrow("OAUTH_SOURCE_TARGET_UNSUPPORTED");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not present an incomplete Drive search or repeated page as finished work", async () => {
    await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "test", cursor: null,
      fetcher: async () => Response.json({ files: [], incompleteSearch: true }) })).rejects.toThrow("OAUTH_SOURCE_PAGE_INVALID");
    await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "test", cursor: "same",
      fetcher: async () => Response.json({ files: [], nextPageToken: "same" }) })).rejects.toThrow("OAUTH_SOURCE_CURSOR_STALLED");
  });

  it("normalizes Google Drive files and preserves bounded pagination", async () => {
    const fetcher = vi.fn(async () => Response.json({
      nextPageToken: "next-google-page",
      files: [{ id: "file-1", name: "Paper.pdf", mimeType: "application/pdf", size: "1024", modifiedTime: "2026-08-30T00:00:00Z", md5Checksum: "abc" }],
    })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "access", cursor: null, fetcher })).resolves.toEqual({
      items: [{ nativeId: "file-1", name: "Paper.pdf", revision: "abc", mimeType: "application/pdf", sizeBytes: 1024, modifiedAt: "2026-08-30T00:00:00Z", kind: "file" }],
      cursor: "next-google-page",
      complete: false,
    });
    const requestUrl = new URL(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(requestUrl.searchParams.get("pageSize")).toBe(String(OAUTH_SOURCE_PAGE_SIZE));
  });

  it("bounds first-page Dropbox and Microsoft listings to the worker admission rate", async () => {
    const dropboxFetcher = vi.fn(async () => Response.json({ entries: [], cursor: "dropbox-cursor", has_more: false })) as unknown as typeof fetch;
    await listOAuthSourcePage({ provider: "dropbox", accessToken: "access", cursor: null, fetcher: dropboxFetcher });
    const dropboxBody = JSON.parse(String((dropboxFetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    expect(dropboxBody.limit).toBe(OAUTH_SOURCE_PAGE_SIZE);

    const graphFetcher = vi.fn(async () => Response.json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/drive/root/delta?$deltatoken=end" })) as unknown as typeof fetch;
    await listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "access", cursor: null, fetcher: graphFetcher });
    const graphUrl = new URL(String((graphFetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(graphUrl.searchParams.get("$top")).toBe(String(OAUTH_SOURCE_PAGE_SIZE));
  });

  it("uses Dropbox continuation cursors without accepting credentials in target config", async () => {
    const fetcher = vi.fn(async () => Response.json({ entries: [{ ".tag": "deleted", id: "id:gone", name: "gone.pdf", path_lower: "/gone.pdf" }], cursor: "dropbox-cursor", has_more: false })) as unknown as typeof fetch;
    const result = await listOAuthSourcePage({ provider: "dropbox", accessToken: "access", cursor: "prior-cursor", target: { rootPath: "/Research" }, fetcher });
    expect(result.items[0]).toMatchObject({ nativeId: "id:gone", kind: "deleted" });
    const body = JSON.parse(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    expect(body).toEqual({ cursor: "prior-cursor" });
  });

  it("accepts only graph.microsoft.com delta links", async () => {
    await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "access", cursor: "https://attacker.test/v1.0/delta" }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    const fetcher = vi.fn(async () => Response.json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?$deltatoken=opaque" })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "access", cursor: null, target: { driveId: "drive-1" }, fetcher })).resolves.toMatchObject({ complete: true });
  });

  it("exports supported native Google files and addresses SharePoint drives explicitly", () => {
    expect(oauthSourceDownloadRequest({ provider: "google_drive", nativeId: "doc-1", mimeType: "application/vnd.google-apps.document" }).url)
      .toContain("/export?mimeType=application%2Fpdf");
    expect(() => oauthSourceDownloadRequest({ provider: "google_drive", nativeId: "form-1", mimeType: "application/vnd.google-apps.form" }))
      .toThrow("OAUTH_SOURCE_NATIVE_TYPE_UNSUPPORTED");
    expect(oauthSourceDownloadRequest({ provider: "microsoft_graph", nativeId: "item-1", target: { driveId: "sharepoint-drive" } }).url)
      .toContain("/drives/sharepoint-drive/items/item-1/content");
  });
});

/*
  Blueprint 2026-09-08 section 38, S-71/S-72: where a connector may go.

  The origins were already constants; nothing checked the URL built from them, and a redirect off
  one was followed without a word. Graph was the only provider whose continuation was shape-checked
  at all -- which reads as "Graph is the risky one" and is not why: Graph continues with a URL and
  the other two continue with an opaque token, so the check has to differ in shape while being the
  same policy underneath.

  One refusal per provider, plus the assertion that matters most for the opaque two: a hostile
  continuation does not move the request, it is refused before one is made.
*/
describe("connector egress policy", () => {
  const METADATA = "http://169.254.169.254/latest/meta-data/";

  it("refuses a Microsoft Graph continuation that points anywhere but Graph", async () => {
    for (const hostile of [METADATA, "https://graph.microsoft.com.attacker.test/v1.0/me", "https://graph.microsoft.com:8443/v1.0/me", "https://graph.microsoft.com/beta/me"]) {
      await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "access", cursor: hostile }))
        .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    }
  });

  it("refuses a Graph delta link in the response body that points off Graph", async () => {
    const fetcher = vi.fn(async () => Response.json({ value: [], "@odata.nextLink": METADATA })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "microsoft_graph", accessToken: "access", cursor: null, fetcher }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
  });

  it("refuses a Google Drive page token that is a smuggled URL, without making the request", async () => {
    const fetcher = vi.fn(async () => Response.json({ files: [] })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "access", cursor: METADATA, fetcher }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a Dropbox cursor that is a smuggled URL, without making the request", async () => {
    const fetcher = vi.fn(async () => Response.json({ entries: [], has_more: false })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "dropbox", accessToken: "access", cursor: METADATA, fetcher }))
      .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps a legitimate opaque token in the parameter it belongs in, never in the destination", async () => {
    const drive = vi.fn(async () => Response.json({ files: [] })) as unknown as typeof fetch;
    await listOAuthSourcePage({ provider: "google_drive", accessToken: "access", cursor: "~!!~AI9FV7QoPage2", fetcher: drive });
    const url = new URL(String((drive as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]));
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.searchParams.get("pageToken")).toBe("~!!~AI9FV7QoPage2");
  });

  it("refuses a redirect off the provider origin instead of following it", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: METADATA } })) as unknown as typeof fetch;
    await expect(listOAuthSourcePage({ provider: "google_drive", accessToken: "access", cursor: null, fetcher }))
      .rejects.toThrow(/OAUTH_SOURCE_EGRESS_REFUSED/);
    // One hop attempted, and the metadata address was never requested.
    expect((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("pins each provider download to that provider origin", () => {
    expect(oauthSourceDownloadRequest({ provider: "microsoft_graph", nativeId: "item-1", target: { siteId: "site,123" } }).url)
      .toBe("https://graph.microsoft.com/v1.0/sites/site%2C123/drive/items/item-1/content");
    expect(() => oauthSourceDownloadRequest({ provider: "dropbox", nativeId: "id:file-1" })).toThrow("SOURCE_REVISION_UNQUALIFIED");
    expect(oauthSourceDownloadRequest({ provider: "google_drive", nativeId: "file-1" }).url)
      .toContain("https://www.googleapis.com/drive/v3/files/file-1");
    expect(oauthSourceDownloadRequest({ provider: "dropbox", nativeId: "file-1", revision: "a1c10ce0dd78" }).url)
      .toBe("https://content.dropboxapi.com/2/files/download");
    expect(oauthSourceDownloadRequest({ provider: "microsoft_graph", nativeId: "file-1" }).url)
      .toContain("https://graph.microsoft.com/v1.0/me/drive/items/file-1/content");
  });
});
