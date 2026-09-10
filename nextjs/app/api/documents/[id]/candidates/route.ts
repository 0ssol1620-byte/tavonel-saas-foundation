import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { DOCUMENT_ID_PATTERN, groupImmutableDocuments, isOcrJsonKey, selectCurrentDocumentVersions } from "@/lib/immutable-keys";
import { getWorkspaceOcrJson, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const selected = selectCurrentDocumentVersions(groupImmutableDocuments(membership.workspaceId, listed.objects)
    .filter((item) => item.documentId === id));
  if (selected.ambiguousDocumentIds.includes(id)) {
    return NextResponse.json({ code: "SOURCE_VERSION_AMBIGUOUS" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  const match = selected.documents.find(
    (item) => item.documentId === id && item.ocrJsonKey,
  );
  if (!match?.ocrJsonKey || !isOcrJsonKey(membership.workspaceId, match.ocrJsonKey)) {
    return NextResponse.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const sourceAccess = await checkConnectorSourceAccess(membership.workspaceId, [id]);
  if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
    status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
    headers: { "Cache-Control": "no-store" },
  });
  const fetched = await getWorkspaceOcrJson(signer, membership.workspaceId, match.ocrJsonKey);
  if (!fetched.ok) {
    return NextResponse.json({ code: fetched.code }, { status: fetched.code === "NOT_FOUND" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  }
  const currentAccess = await checkConnectorSourceAccess(membership.workspaceId, [id]);
  if (!currentAccess.ok) return NextResponse.json({ code: currentAccess.code }, {
    status: currentAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
    headers: { "Cache-Control": "no-store" },
  });
  const currentUser = await getRequestUser(request);
  if (!currentUser || currentUser.id !== user.id) {
    return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const currentProductAccess = await authorizeFoundationProduct(membership.workspaceId, user.id, "observer");
  if (!currentProductAccess.ok) return NextResponse.json({ code: currentProductAccess.code }, {
    status: currentProductAccess.status,
    headers: { "Cache-Control": "no-store" },
  });
  return NextResponse.json(
    {
      code: "OK",
      documentId: id,
      ocrJsonKey: match.ocrJsonKey,
      candidatePromotion: false,
      candidates: fetched.json,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
