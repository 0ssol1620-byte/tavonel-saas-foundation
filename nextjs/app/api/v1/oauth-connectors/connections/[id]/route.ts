import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { deleteOAuthSecret, readOAuthSecretBrokerConfig } from "@/lib/connector-oauth-secrets";
import { getOAuthConnectionSecretReference, revokeOAuthConnection } from "@/lib/connector-oauth-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFoundationSession(request, "studio");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ code: "OAUTH_CONNECTION_ID_INVALID" }, { status: 400, headers: HEADERS });
  const broker = readOAuthSecretBrokerConfig();
  if (!broker) return NextResponse.json({ code: "OAUTH_SECRET_BROKER_NOT_CONFIGURED" }, { status: 503, headers: HEADERS });
  const reference = await getOAuthConnectionSecretReference(auth.principal.workspaceKey, id);
  if (!reference.ok) return NextResponse.json({ code: reference.code }, { status: reference.code === "OAUTH_CONNECTION_NOT_FOUND" ? 404 : 503, headers: HEADERS });
  try { await deleteOAuthSecret(broker, reference.refreshTokenReference); }
  catch { return NextResponse.json({ code: "OAUTH_SECRET_REVOCATION_FAILED" }, { status: 503, headers: HEADERS }); }
  const result = await revokeOAuthConnection(auth.principal.workspaceKey, auth.principal.userId, id);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: result.code === "OAUTH_CONNECTION_NOT_FOUND" ? 404 : 503, headers: HEADERS });
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
