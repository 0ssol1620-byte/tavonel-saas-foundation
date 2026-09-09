import { NextResponse } from "next/server";
import { authorizeFoundationProduct } from "@/lib/billing-product-access";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { DOCUMENT_ID_PATTERN, groupImmutableDocuments } from "@/lib/immutable-keys";
import { getWorkspaceSanitizedPdf, listImmutableWorkspaceObjects } from "@/lib/r2-objects";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";
import { acquireWorkspaceOperation } from "@/lib/workspace-operation-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const maxDuration = 30;

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
  const sourceAccess = await checkConnectorSourceAccess(access.membership.workspaceId, [id]);
  if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
    status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503,
    headers: { "Cache-Control": "no-store" },
  });
  if (new URL(request.url).searchParams.get("format") !== "pdf") {
    const readUrl = `/api/documents/${encodeURIComponent(id)}/source?version=${encodeURIComponent(match.versionKey)}&format=pdf`;
    return NextResponse.json({ code: "OK", documentId: id, versionKey: match.versionKey, readUrl, requiresAuthorization: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const lease = await acquireWorkspaceOperation("export", access.membership.workspaceId);
  if (!lease.ok) return NextResponse.json({ code: lease.code }, {
    status: lease.status, headers: { "Cache-Control": "no-store", "Retry-After": "10" },
  });
  let streaming = false;
  let releasePromise: Promise<void> | null = null;
  const release = () => releasePromise ??= lease.replay ? Promise.resolve() : lease.release();
  try {
    const source = await getWorkspaceSanitizedPdf(signer, access.membership.workspaceId, match.sanitizedKey);
    if (!source.ok) return NextResponse.json({ code: source.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const currentUser = await getRequestUser(request);
    if (!currentUser || currentUser.id !== user.id) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401 });
    const currentAccess = await authorizeFoundationProduct(access.membership.workspaceId, user.id, "observer");
    if (!currentAccess.ok) return NextResponse.json({ code: currentAccess.code }, { status: currentAccess.status });
    const currentSource = await checkConnectorSourceAccess(access.membership.workspaceId, [id]);
    if (!currentSource.ok) return NextResponse.json({ code: currentSource.code }, {
      status: currentSource.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: { "Cache-Control": "no-store" },
    });
    // Streaming avoids the platform's buffered-response ceiling. Digest and authorization
    // checks above finish before any byte is released. Pull honors downstream backpressure.
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (offset >= source.bytes.byteLength) { await release(); controller.close(); return; }
        const end = Math.min(offset + 64 * 1024, source.bytes.byteLength);
        controller.enqueue(source.bytes.subarray(offset, end));
        offset = end;
      },
      async cancel() { offset = source.bytes.byteLength; await release(); },
    });
    const response = new Response(body, { headers: { "Content-Type": "application/pdf",
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
    streaming = true;
    return response;
  } finally {
    if (!streaming) await release();
  }
}
