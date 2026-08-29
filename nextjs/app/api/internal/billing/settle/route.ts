import { NextResponse } from "next/server";
import { settleFoundationCompute } from "@/lib/compute-reservation";
import { verifyComputeSettlementRequest } from "@/lib/compute-settlement-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 2_048) {
    return NextResponse.json({ code: "SETTLEMENT_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 2_048) {
    return NextResponse.json({ code: "SETTLEMENT_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  if (!verifyComputeSettlementRequest(rawBody, request.headers, process.env.FOUNDATION_BILLING_SETTLEMENT_HMAC)) {
    return NextResponse.json({ code: "SETTLEMENT_AUTH_INVALID" }, { status: 401, headers });
  }
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { body = null; }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ code: "SETTLEMENT_BODY_INVALID" }, { status: 400, headers });
  }
  const input = body as Record<string, unknown>;
  const result = await settleFoundationCompute({
    workspaceKey: typeof input.workspaceKey === "string" ? input.workspaceKey : "",
    documentId: typeof input.documentId === "string" ? input.documentId : "",
    outcome: input.outcome as "settled" | "operator_review" | "released",
    actualCredits: typeof input.actualCredits === "number" ? input.actualCredits : Number.NaN,
    reasonCode: typeof input.reasonCode === "string" ? input.reasonCode : "",
  });
  if (!result.ok) return NextResponse.json({ code: result.code }, { status: 503, headers });
  return NextResponse.json({ code: "SETTLEMENT_APPLIED", result: result.result }, { headers });
}
