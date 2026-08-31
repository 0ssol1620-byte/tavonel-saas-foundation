import { describe, expect, it, vi } from "vitest";
import { listOAuthSourcePage, OAUTH_SOURCE_PAGE_SIZE, oauthSourceDownloadRequest } from "./connector-oauth-adapters";

describe("OAuth source adapters", () => {
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

    const graphFetcher = vi.fn(async () => Response.json({ value: [] })) as unknown as typeof fetch;
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
