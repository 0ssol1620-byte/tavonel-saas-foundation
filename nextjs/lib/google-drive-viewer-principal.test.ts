import { describe, expect, it, vi } from "vitest";
import { fetchGoogleDriveViewerPermissionId } from "./google-drive-viewer-principal";

describe("Google Drive viewer principal", () => {
  it("uses about.user.permissionId and ignores email and OIDC ids", async () => {
    const fetcher = vi.fn(async () => Response.json({ user: {
      permissionId: "opaque-drive-id", emailAddress: "viewer@example.invalid", id: "oidc-subject",
    } }));
    await expect(fetchGoogleDriveViewerPermissionId("synthetic-token", fetcher as typeof fetch)).resolves.toBe("opaque-drive-id");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://www.googleapis.com/drive/v3/about?fields=user%28permissionId%29");
  });

  it.each([{ user: { emailAddress: "viewer@example.invalid" } }, { user: { permissionId: "" } }, null])(
    "rejects missing permission IDs: %j", async (payload) => {
      await expect(fetchGoogleDriveViewerPermissionId("synthetic-token", async () => Response.json(payload) as Response))
        .rejects.toThrow("GOOGLE_DRIVE_VIEWER_IDENTITY_INVALID");
    },
  );
});
