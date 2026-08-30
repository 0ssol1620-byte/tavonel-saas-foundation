import { NextResponse } from "next/server";
import { authorizeEnterpriseRequest } from "@/lib/enterprise-auth";
import { ENTERPRISE_NO_STORE } from "@/lib/enterprise-http";
import { getEnterpriseOverview } from "@/lib/enterprise-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeEnterpriseRequest(request, "organization:read");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: ENTERPRISE_NO_STORE });
  const result = await getEnterpriseOverview(auth.principal);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: ENTERPRISE_NO_STORE });
  return NextResponse.json({ code: "OK", ...result }, { headers: ENTERPRISE_NO_STORE });
}
