import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { DOCUMENT_ID_PATTERN, groupImmutableDocuments } from "@/lib/immutable-keys";
import { presignWorkspaceSanitizedPdfGet } from "@/lib/r2-presign";
import { listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const READ_CAPABILITY_SECONDS = 120;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  if (!DOCUMENT_ID_PATTERN.test(id)) return NextResponse.json({ code: "UNQUALIFIED_DOCUMENT" }, { status: 400 });
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403 });
  const productAccess = await authorizeFoundationProduct(access.membership.workspaceId, user.id, "observer");
  if (!productAccess.ok) return NextResponse.json({ code: productAccess.code }, { status: productAccess.status });
  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503 });
  const listed = await listImmutableWorkspaceObjects(signer, access.membership.workspaceId);
  if (!listed.ok) return NextResponse.json({ code: listed.code }, { status: 503 });
  const version = new URL(request.url).searchParams.get("version");
  const candidates = groupImmutableDocuments(access.membership.workspaceId, listed.objects)
    .filter((item) => item.documentId === id && item.sanitizedKey);
  const match = (version ? candidates.find((item) => item.versionKey === version) : candidates[0]) ?? null;
  if (!match?.sanitizedKey) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });
  const signed = presignWorkspaceSanitizedPdfGet(signer, {
    workspaceId: access.membership.workspaceId,
    key: match.sanitizedKey,
    expiresInSeconds: READ_CAPABILITY_SECONDS,
  });
  if (!signed.ok) return NextResponse.json({ code: signed.code }, { status: 400 });
  return NextResponse.json({ code: "OK", documentId: id, versionKey: match.versionKey, readUrl: signed.readUrl, expiresInSeconds: READ_CAPABILITY_SECONDS }, { headers: { "Cache-Control": "no-store" } });
}
