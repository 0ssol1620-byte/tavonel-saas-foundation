import { NextResponse } from "next/server";
import { authorizeSyntheticCanary, readR2SignerEnv, runSyntheticR2Canary } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = process.env.FOUNDATION_CANARY_TOKEN;
  if (!authorizeSyntheticCanary(request.headers.get("authorization"), token)) {
    return NextResponse.json({ code: "CANARY_LOCKED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const env = readR2SignerEnv();
  if (!env) {
    return NextResponse.json({ code: "R2_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const result = await runSyntheticR2Canary(env);
  return NextResponse.json(result, { status: result.ok ? 200 : 502, headers: { "Cache-Control": "no-store" } });
}
