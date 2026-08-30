import { NextResponse } from "next/server";
import { authorizeEnterpriseRequest } from "@/lib/enterprise-auth";
import { ENTERPRISE_NO_STORE } from "@/lib/enterprise-http";
import { readDashboard } from "@/lib/enterprise-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeEnterpriseRequest(request, "billing:read");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: ENTERPRISE_NO_STORE });
  const params = new URL(request.url).searchParams;
  const days = Math.min(366, Math.max(1, Number.parseInt(params.get("days") ?? "30", 10) || 30));
  const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const result = await readDashboard(auth.principal.organizationId, from);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: ENTERPRISE_NO_STORE });
  return NextResponse.json({ code: "OK", period: { from, days }, metrics: result.metrics, totals: result.totals }, { headers: ENTERPRISE_NO_STORE });
}
