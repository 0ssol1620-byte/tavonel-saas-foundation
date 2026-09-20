import { NextResponse } from "next/server";
import { readPublicStatusV2 } from "@/lib/public-status";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(readPublicStatusV2(), {
    headers: {
      "Cache-Control": "no-store",
      Deprecation: "false",
    },
  });
}
