import { NextResponse } from "next/server";
import { isServiceReady, readPublicOperations } from "@/lib/operations";
export const dynamic = "force-dynamic";
export function GET() { const ready=isServiceReady(); return NextResponse.json({ ready, ...readPublicOperations() }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } }); }
