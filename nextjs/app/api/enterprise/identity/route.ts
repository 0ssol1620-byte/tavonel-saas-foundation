import { NextResponse } from "next/server";
import { authorizeEnterpriseRequest } from "@/lib/enterprise-auth";
import { parseEnterpriseIdentityInput } from "@/lib/enterprise-contracts";
import { ENTERPRISE_NO_STORE, enterpriseRequestId, readEnterpriseJson } from "@/lib/enterprise-http";
import { listIdentityConfigs, putIdentityConfig } from "@/lib/enterprise-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeEnterpriseRequest(request, "identity:read");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: ENTERPRISE_NO_STORE });
  const result = await listIdentityConfigs(auth.principal.organizationId);
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: ENTERPRISE_NO_STORE });
  return NextResponse.json({ code: "OK", configs: result.configs }, { headers: ENTERPRISE_NO_STORE });
}

export async function PUT(request: Request) {
  const auth = await authorizeEnterpriseRequest(request, "identity:write");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: ENTERPRISE_NO_STORE });
  const body = await readEnterpriseJson(request);
  if (!body.ok) return NextResponse.json({ code: body.code }, { status: body.status, headers: ENTERPRISE_NO_STORE });
  const input = parseEnterpriseIdentityInput(body.value);
  if (!input) return NextResponse.json({ code: "ENTERPRISE_IDENTITY_INPUT_INVALID" }, { status: 400, headers: ENTERPRISE_NO_STORE });
  const result = await putIdentityConfig(auth.principal, input, enterpriseRequestId(request));
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers: ENTERPRISE_NO_STORE });
  return NextResponse.json({ code: "CONFIGURED", effectiveStatus: result.effectiveStatus, activation: "PROVIDER_VERIFICATION_REQUIRED" }, { headers: ENTERPRISE_NO_STORE });
}
