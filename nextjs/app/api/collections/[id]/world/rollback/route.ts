import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { rollbackFoundationWorld } from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 2_048) {
    return NextResponse.json(
      { code: "ROLLBACK_METADATA_TOO_LARGE" },
      { status: 413, headers: NO_STORE }
    );
  }
  const user = await getRequestUser(request);
  if (!user)
    return NextResponse.json(
      { code: "AUTH_REQUIRED" },
      { status: 401, headers: NO_STORE }
    );
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "COLLECTION_ID_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  let body: {
    targetManifestDigest?: unknown;
    expectedCurrentManifest?: unknown;
    reason?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: "INVALID_JSON" },
      { status: 400, headers: NO_STORE }
    );
  }
  const targetManifestDigest =
    typeof body.targetManifestDigest === "string"
      ? body.targetManifestDigest
      : "";
  const expectedCurrentManifest =
    typeof body.expectedCurrentManifest === "string"
      ? body.expectedCurrentManifest
      : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (
    !SHA256.test(targetManifestDigest) ||
    !SHA256.test(expectedCurrentManifest) ||
    reason.length < 8 ||
    reason.length > 500
  ) {
    return NextResponse.json(
      { code: "WORLD_ROLLBACK_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  const { membership } = foundationPilotAccess(user.id);
  if (membership.role !== "owner" && membership.role !== "admin") {
    return NextResponse.json(
      { code: "ROLLBACK_ROLE_REQUIRED" },
      { status: 403, headers: NO_STORE }
    );
  }
  const rolledBack = await rollbackFoundationWorld({
    workspaceKey: membership.workspaceId,
    collectionId: id,
    targetManifestDigest,
    expectedCurrentManifest,
    actorUserId: user.id,
    reason,
  });
  if (!rolledBack.ok) {
    const status =
      rolledBack.code === "ACTIVE_WORLD_CONFLICT"
        ? 409
        : rolledBack.code === "ROLLBACK_TARGET_NOT_FOUND"
          ? 404
          : 503;
    return NextResponse.json(
      { code: rolledBack.code },
      { status, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    { code: "WORLD_ROLLED_BACK", world: rolledBack.result },
    { headers: NO_STORE }
  );
}
