import { NextResponse } from "next/server";
import { exportTrustRecord, readExportSignerEnv } from "@/lib/export-signing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET() {
  const signer = readExportSignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "EXPORT_SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json(exportTrustRecord(signer), { headers: NO_STORE });
}
