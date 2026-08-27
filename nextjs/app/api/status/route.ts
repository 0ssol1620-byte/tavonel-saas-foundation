import { NextResponse } from "next/server";
import { activationPolicy } from "@/lib/activation-policy";

export const dynamic = "force-dynamic";
export function GET() { return NextResponse.json({ mode: "foundation", activationPolicy, auth: "not_configured", billing: "sandbox_not_configured" }, { headers: { "Cache-Control": "no-store" } }); }
