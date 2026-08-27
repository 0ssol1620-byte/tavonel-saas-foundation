import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json") || !Number.isFinite(contentLength) || contentLength > 8_192) return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  if (!activationPolicy.customerIntake.enabled) return NextResponse.json({ code: "INTAKE_DISABLED", reason: activationPolicy.customerIntake.reason }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
  return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
