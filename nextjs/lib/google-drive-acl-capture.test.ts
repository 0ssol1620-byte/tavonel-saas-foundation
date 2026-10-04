import { describe, expect, it } from "vitest";
import { captureGoogleDriveUserAcl } from "./google-drive-acl-capture";

describe("Google Drive ACL capture contract", () => {
  it("preserves Permission.id for exact user grants and never expands groups", async () => {
    const capture = await captureGoogleDriveUserAcl({ fileId: "file-1", accessToken: "synthetic-token", fetcher: async () =>
      Response.json({ permissions: [
        { id: "drive-user-permission-1", type: "user", role: "reader" },
        { id: "opaque-group-id", type: "group", role: "writer" },
        { id: "domain.example", type: "domain", role: "reader" },
      ] }) });
    expect(capture.principals).toEqual([{ kind: "user", principalId: "drive-user-permission-1", permission: "read" }]);
    expect(capture.snapshotSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects conflicting duplicate user permissions instead of choosing one", async () => {
    await expect(captureGoogleDriveUserAcl({ fileId: "file-1", accessToken: "synthetic-token", fetcher: async () =>
      Response.json({ permissions: [
        { id: "drive-user-permission-1", type: "user", role: "reader" },
        { id: "drive-user-permission-1", type: "user", role: "writer" },
      ] }) })).rejects.toThrow("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
  });

  it("does not return a partial snapshot when a later permission page fails", async () => {
    let calls = 0;
    const fetcher = async () => ++calls === 1
      ? Response.json({ permissions: [{ id: "permission-1", type: "user", role: "reader" }], nextPageToken: "next" })
      : Response.json({}, { status: 403 });
    await expect(captureGoogleDriveUserAcl({ fileId: "file-1", accessToken: "synthetic-token", fetcher }))
      .rejects.toThrow("GOOGLE_DRIVE_ACL_CAPTURE_INCOMPLETE");
  });
});
