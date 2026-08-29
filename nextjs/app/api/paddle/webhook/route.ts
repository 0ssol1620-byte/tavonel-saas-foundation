import { NextResponse } from "next/server";
import { applyFoundationBillingAction } from "@/lib/billing-store";
import { parsePaddleBillingAction } from "@/lib/paddle-billing-event";
import { verifyPaddleSignature } from "@/lib/paddle-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ code: "BILLING_NOT_CONFIGURED" }, { status: 503, headers });
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 512 * 1024) {
    return NextResponse.json({ code: "WEBHOOK_TOO_LARGE" }, { status: 413, headers });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 512 * 1024) {
    return NextResponse.json({ code: "WEBHOOK_TOO_LARGE" }, { status: 413, headers });
  }
  if (!verifyPaddleSignature(rawBody, request.headers.get("paddle-signature"), secret)) {
    return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401, headers });
  }
  const action = parsePaddleBillingAction(rawBody);
  if (!action) return NextResponse.json({ code: "EVENT_ENVELOPE_INVALID" }, { status: 200, headers });
  if (action.action === "ignored") {
    return NextResponse.json({ code: "EVENT_IGNORED", eventId: action.eventId, reason: action.reason }, { status: 200, headers });
  }
  const applied = await applyFoundationBillingAction(action);
  if (!applied.ok) return NextResponse.json({ code: applied.code }, { status: 503, headers });
  return NextResponse.json({ code: "EVENT_APPLIED", eventId: action.eventId, result: applied.result }, { status: 200, headers });
}
