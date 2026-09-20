import { NextResponse } from "next/server";
import { exportTrustRecord, readExportSignerEnv, readExportTrustStoreEnv } from "@/lib/export-signing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export function GET() {
  const signer = readExportSignerEnv();
  if (!signer) {
    const configured = [
      process.env.TAVONEL_EXPORT_SIGNING_KEY_ID,
      process.env.TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64,
      process.env.TAVONEL_EXPORT_SIGNING_TRUST_STORE_JSON,
    ].some((value) => value !== undefined);
    return NextResponse.json(
      { code: configured ? "EXPORT_SIGNER_INVALID" : "EXPORT_SIGNER_NOT_CONFIGURED" },
      { status: 503, headers: NO_STORE },
    );
  }
  return NextResponse.json(readExportTrustStoreEnv() ?? exportTrustRecord(signer), { headers: NO_STORE });
}
