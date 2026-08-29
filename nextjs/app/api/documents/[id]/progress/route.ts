import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { DOCUMENT_ID_PATTERN, groupImmutableDocuments } from "@/lib/immutable-keys";
import { presignWorkspaceProgressGet } from "@/lib/r2-presign";
import { listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Long enough to poll a read to its end, short enough that a leaked URL is worth little. */
const READ_CAPABILITY_SECONDS = 120;

/**
 * A capability to read one document's progress object -- not the progress itself.
 *
 * This endpoint returns a URL and nothing else. That is the whole point: the workspace page says
 * the application server never carries file bytes, and streaming the reading through here would
 * quietly make that untrue. The browser fetches the object directly from the bucket, exactly the
 * way it PUT the original file, and this server only decides whether it may.
 *
 * The decision has three parts and all three are required: the caller is signed in, the pilot and
 * product gates admit them, and the key belongs to a document that is genuinely in their own
 * workspace listing. The signer then refuses anything that is not a progress object inside that
 * workspace prefix, so even a mistake here cannot widen what the URL reaches.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "UNQUALIFIED_DOCUMENT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { membership } = access;
  const productAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "observer");
  if (!productAccess.ok) return NextResponse.json({ code: productAccess.code }, { status: productAccess.status, headers: { "Cache-Control": "no-store" } });
  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const listed = await listImmutableWorkspaceObjects(signer, membership.workspaceId);
  if (!listed.ok) {
    return NextResponse.json({ code: listed.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // The key is derived from the workspace's own listing, never from anything the caller sent.
  const match = groupImmutableDocuments(membership.workspaceId, listed.objects).find(
    (item) => item.documentId === id && item.sanitizedKey,
  );
  if (!match?.sanitizedKey) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const progressKey = `${match.sanitizedKey.slice(0, -"/sanitized.pdf".length)}/ocr-progress.json`;
  const signed = presignWorkspaceProgressGet(signer, {
    workspaceId: membership.workspaceId,
    key: progressKey,
    expiresInSeconds: READ_CAPABILITY_SECONDS,
  });
  if (!signed.ok) {
    return NextResponse.json({ code: signed.code }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    {
      code: "OK",
      documentId: id,
      readUrl: signed.readUrl,
      expiresInSeconds: READ_CAPABILITY_SECONDS,
      // Said plainly, because the object is mutable and the rest of this workspace is not.
      note: "Progress is a live view, not evidence. ocr.json remains the immutable record.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
