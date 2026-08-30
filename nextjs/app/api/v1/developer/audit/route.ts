import { NextResponse } from "next/server";
import { requireFoundationSession } from "@/lib/developer-auth";
import { listDeveloperAuditEvents } from "@/lib/developer-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-TAVONEL-API-Version": "1" };

export async function GET(request: Request) {
  const auth = await requireFoundationSession(request, "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? "100");
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) return NextResponse.json({ code: "AUDIT_LIMIT_INVALID" }, { status: 400, headers: HEADERS });
  const result = await listDeveloperAuditEvents(auth.principal.workspaceKey, rawLimit);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: HEADERS });
  return NextResponse.json({ code: "OK", apiVersion: 1, events: result.events }, { headers: HEADERS });
}
