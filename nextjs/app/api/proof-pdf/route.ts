import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PUBLIC_PROOF_URL = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const PUBLIC_PROOF_SHA256 = "3df79d34abbca99308e79cb94461c1893582604d68329a41fd4bec1885e6adb4";
const PUBLIC_PROOF_BYTES = 13_264;

export async function GET() {
  try {
    // This fixed public fixture is the only byte response Vercel serves. The route
    // accepts no URL or customer input and is not part of the quarantine data path.
    const response = await fetch(PUBLIC_PROOF_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return NextResponse.json({ code: "PUBLIC_PROOF_UNAVAILABLE" }, { status: 502 });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== PUBLIC_PROOF_BYTES || digest !== PUBLIC_PROOF_SHA256 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return NextResponse.json({ code: "PUBLIC_PROOF_DIGEST_MISMATCH" }, { status: 502 });
    }
    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Content-Disposition": 'inline; filename="w3c-dummy.pdf"',
        "Content-Length": String(bytes.length),
        "Content-Type": "application/pdf",
        "X-Tavonel-Proof-SHA256": digest,
      },
    });
  } catch {
    return NextResponse.json({ code: "PUBLIC_PROOF_UNAVAILABLE" }, { status: 502 });
  }
}
