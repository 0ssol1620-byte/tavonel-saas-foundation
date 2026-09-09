import { describe, expect, it } from "vitest";
import { listOAuthSourcePage } from "./connector-oauth-adapters";
import type { OAuthConnectorProvider } from "./connector-oauth";

const providers: OAuthConnectorProvider[] = ["google_drive", "dropbox", "microsoft_graph"];
async function read(provider: OAuthConnectorProvider, payload: unknown) {
  return listOAuthSourcePage({ provider, accessToken: "test", cursor: null,
    fetcher: async () => Response.json(payload) });
}

describe("provider listing integrity", () => {
  it.each(providers)("refuses broken JSON and non-object %s success bodies", async provider => {
    await expect(listOAuthSourcePage({ provider, accessToken: "test", cursor: null,
      fetcher: async () => new Response("{truncated") })).rejects.toThrow("OAUTH_SOURCE_PAGE_INVALID");
    for (const payload of [null, [], {}, { error: "unexpected" }]) {
      await expect(read(provider, payload)).rejects.toThrow("OAUTH_SOURCE_PAGE_INVALID");
    }
  });

  it.each([
    ["google_drive", { files: [null] }],
    ["google_drive", { files: [{ id: "missing-name-and-revision" }] }],
    ["dropbox", { entries: [null], cursor: "c", has_more: false }],
    ["dropbox", { entries: [{ ".tag": "unknown", name: "x", id: "id:x" }], cursor: "c", has_more: false }],
    ["microsoft_graph", { value: [null] }],
    ["microsoft_graph", { value: [{ id: "missing-revision" }] }],
  ] as const)("does not drop unqualified %s rows and announce success", async (provider, payload) => {
    await expect(read(provider, payload)).rejects.toThrow("OAUTH_SOURCE_PAGE_INVALID");
  });

  it("preserves a valid empty page as distinct from an invalid response", async () => {
    expect(await read("google_drive", { files: [] })).toEqual({ items: [], cursor: null, complete: true });
    expect(await read("google_drive", { files: [], nextPageToken: null })).toEqual({ items: [], cursor: null, complete: true });
    expect(await read("dropbox", { entries: [], cursor: "end", has_more: false }))
      .toEqual({ items: [], cursor: "end", complete: true });
  });

  it("does not interpret invalid Google continuation as the last page", async () => {
    for (const nextPageToken of ["", 12, "a".repeat(2049), "bad token"]) {
      await expect(read("google_drive", { files: [], nextPageToken })).rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    }
  });

  it("requires Dropbox completion evidence and a retained checkpoint", async () => {
    for (const has_more of [undefined, null, "false", 0]) {
      await expect(read("dropbox", { entries: [], cursor: "c", has_more })).rejects.toThrow("OAUTH_SOURCE_PAGE_INVALID");
    }
    await expect(read("dropbox", { entries: [], has_more: false })).rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
  });

  it("refuses explicit invalid Graph continuations rather than successful truncation", async () => {
    for (const next of [null, "", false, 0]) {
      await expect(read("microsoft_graph", { value: [], "@odata.nextLink": next }))
        .rejects.toThrow("OAUTH_SOURCE_CURSOR_INVALID");
    }
  });
});
