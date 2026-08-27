import { NextResponse } from "next/server";
import { verifyPaddleSignature } from "@/lib/paddle-webhook";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ code: "BILLING_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const rawBody = await request.text();
  if (!verifyPaddleSignature(rawBody, request.headers.get("paddle-signature"), secret)) return NextResponse.json({ code: "INVALID_SIGNATURE" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ code: "ENTITLEMENT_STORE_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
