import { describe, expect, it, vi } from "vitest";
import { listGoogleDriveLifecyclePage as read } from "./google-drive-lifecycle";

const source = { id: "file-1", name: "Report.pdf", version: "7", mimeType: "application/pdf", size: "1024" };
function provider(responses: unknown[]) {
  let index = 0;
  return vi.fn(async () => {
    if (index >= responses.length) throw new Error("Unexpected request");
    return Response.json(responses[index++]);
  }) as unknown as typeof fetch;
}
async function initial(fetcher: typeof fetch, driveId?: string) {
  return read({ accessToken: "test-only", cursor: null, fetcher, driveId });
}
describe("Google Drive lifecycle reader candidate", () => {
  it("accepts null terminal page tokens while still requiring the final change watermark", async () => {
    const fetcher = provider([{ startPageToken: "start" }, { files: [], nextPageToken: null },
      { changes: [], nextPageToken: null, newStartPageToken: "end" }]);
    let page = await initial(fetcher);
    page = await read({ accessToken: "test-only", cursor: page.cursor, fetcher });
    expect(page.complete).toBe(false);
    page = await read({ accessToken: "test-only", cursor: page.cursor, fetcher });
    expect(page.complete).toBe(true);
    expect(page.cursor).toMatch(/^tv-drive-v2:/);
  });
  it("checkpoints a watermark before snapshot, replays concurrent changes, and keeps the final polling token", async () => {
    const fetcher = provider([
      { startPageToken: "watermark-1" },
      { files: [source], nextPageToken: "snapshot-2" },
      { files: [] },
      { changes: [{ fileId: source.id, file: { ...source, name: "Renamed.pdf", version: "8" } }], nextPageToken: "change-2" },
      { changes: [{ fileId: source.id, removed: true, time: "2026-09-09T01:02:03Z" }], newStartPageToken: "watermark-2" },
      { changes: [], newStartPageToken: "watermark-3" },
    ]);
    let page = await initial(fetcher);
    expect(page.items).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(page.complete).toBe(false);
    const snapshot = page.cursor;
    page = await read({ accessToken: "test-only", cursor: snapshot, fetcher });
    expect(page.items[0]).toMatchObject({ nativeId: source.id, revision: "7" });
    page = await read({ accessToken: "test-only", cursor: page.cursor, fetcher });
    expect(page.complete).toBe(false);
    page = await read({ accessToken: "test-only", cursor: page.cursor, fetcher });
    expect(page.items[0]).toMatchObject({ nativeId: source.id, revision: "8", name: "Renamed.pdf" });
    page = await read({ accessToken: "test-only", cursor: page.cursor, fetcher });
    expect(page.items[0]).toMatchObject({ nativeId: source.id, kind: "deleted", removalReason: "removed_or_inaccessible", changedAt: "2026-09-09T01:02:03Z" });
    expect(page.items[0].revision.length).toBeLessThanOrEqual(512);
    expect(page.complete).toBe(true);
    page = await read({ accessToken: "test-only", cursor: page.cursor, fetcher });
    expect(page.complete).toBe(true);
    const calls = vi.mocked(fetcher).mock.calls.map(call => new URL(String(call[0])));
    expect(calls[0].pathname).toBe("/drive/v3/changes/startPageToken");
    expect(calls[2].searchParams.get("pageToken")).toBe("snapshot-2");
    expect(calls[3].searchParams.get("pageToken")).toBe("watermark-1");
    expect(calls[3].searchParams.get("includeRemoved")).toBe("true");
    expect(calls[5].searchParams.get("pageToken")).toBe("watermark-2");
  });
  it("retries a failed first snapshot with the same saved watermark", async () => {
    const fetcher = provider([{ startPageToken: "before-import" }, { incompleteSearch: true, files: [] }, { files: [] }]);
    const checkpoint = (await initial(fetcher)).cursor;
    await expect(read({ accessToken: "test-only", cursor: checkpoint, fetcher })).rejects.toThrow("DRIVE_SNAPSHOT_INCOMPLETE");
    const page = await read({ accessToken: "test-only", cursor: checkpoint, fetcher });
    expect(page.complete).toBe(false);
    expect(vi.mocked(fetcher).mock.calls.filter(call => String(call[0]).includes("startPageToken"))).toHaveLength(1);
  });
  it("binds a shared-drive cursor to the same drive and refuses legacy cursors without network I/O", async () => {
    const fetcher = provider([{ startPageToken: "start" }]);
    const checkpoint = (await initial(fetcher, "drive-one")).cursor;
    await expect(read({ accessToken: "test-only", cursor: checkpoint, driveId: "drive-two", fetcher })).rejects.toThrow("DRIVE_CURSOR_INVALID");
    await expect(read({ accessToken: "test-only", cursor: "legacy-page-token", fetcher })).rejects.toThrow("DRIVE_CURSOR_INVALID");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not coerce an array phase into a valid cursor or forward tokens to a redirect", async () => {
    const fetcher = vi.fn(async () => Response.redirect("https://attacker.example/", 302)) as unknown as typeof fetch;
    const cursor = "tv-drive-v2:" + Buffer.from(JSON.stringify({ phase: ["snapshot"], drive: null, start: "start", page: null })).toString("base64url");
    await expect(read({ accessToken: "test-only", cursor, fetcher })).rejects.toThrow("DRIVE_CURSOR_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(initial(fetcher)).rejects.toThrow("DRIVE_EGRESS_REFUSED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([null, [], { files: null }, { files: [], nextPageToken: "" }, { files: [{ ...source, version: undefined }] },
    { files: [{ ...source, size: true }] }, { files: [{ ...source, size: " " }] },
    { files: [{ ...source, modifiedTime: "not-a-date" }] }, { files: [{ ...source, trashed: true }] },
    { files: [], incompleteSearch: "false" }, { files: Array.from({ length: 26 }, () => source) },
  ])("refuses malformed snapshot rather than acknowledging it as empty: %j", async malformed => {
    const fetcher = provider([{ startPageToken: "start" }, malformed]);
    const checkpoint = (await initial(fetcher)).cursor;
    await expect(read({ accessToken: "test-only", cursor: checkpoint, fetcher })).rejects.toThrow();
  });
  it.each([
    { changes: [] },
    { changes: [], nextPageToken: "start" },
    { changes: [], nextPageToken: "next", newStartPageToken: "end" },
    { changes: [{ changeType: "drive", fileId: "drive-one" }], newStartPageToken: "end" },
    { changes: [{ fileId: "other", file: source }], newStartPageToken: "end" },
  ])("refuses an ambiguous or unhandled change page: %j", async malformed => {
    const fetcher = provider([{ startPageToken: "start" }, { files: [] }, malformed]);
    const first = await initial(fetcher);
    const snapshot = await read({ accessToken: "test-only", cursor: first.cursor, fetcher });
    await expect(read({ accessToken: "test-only", cursor: snapshot.cursor, fetcher })).rejects.toThrow();
  });
});
