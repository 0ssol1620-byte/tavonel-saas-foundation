/** Resolve the viewer identity exposed by Drive ACL Permission resources. */
export async function fetchGoogleDriveViewerPermissionId(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  if (typeof accessToken !== "string" || accessToken.length < 1 || accessToken.length > 8_192) {
    throw new Error("GOOGLE_DRIVE_VIEWER_IDENTITY_INVALID");
  }
  const url = "https://www.googleapis.com/drive/v3/about?fields=user%28permissionId%29";
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("GOOGLE_DRIVE_VIEWER_IDENTITY_LOOKUP_FAILED");
  }
  if (!response.ok) throw new Error("GOOGLE_DRIVE_VIEWER_IDENTITY_LOOKUP_FAILED");
  const payload: unknown = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("GOOGLE_DRIVE_VIEWER_IDENTITY_INVALID");
  }
  const user = (payload as Record<string, unknown>).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    throw new Error("GOOGLE_DRIVE_VIEWER_IDENTITY_INVALID");
  }
  const permissionId = (user as Record<string, unknown>).permissionId;
  if (typeof permissionId !== "string" || permissionId.length < 1 || permissionId.length > 512 || /[\u0000-\u001f\u007f]/.test(permissionId)) {
    throw new Error("GOOGLE_DRIVE_VIEWER_IDENTITY_INVALID");
  }
  return permissionId;
}
