import { NextResponse } from "next/server";
import {
  authorizeOAuthVaultRequest,
  deleteOAuthVaultSecret,
  readOAuthVaultConfig,
  readOAuthVaultSecret,
  writeOAuthVaultSecret,
} from "@/lib/connector-oauth-vault";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function fail(code: string, status: number) {
  return NextResponse.json({ code }, { status, headers: HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const config = readOAuthVaultConfig();
  if (!config) return fail("OAUTH_SECRET_BROKER_UNAVAILABLE", 503);
  if (!authorizeOAuthVaultRequest(request.headers.get("authorization"), config)) return fail("OAUTH_SECRET_BROKER_DENIED", 401);
  const { operation } = await context.params;
  if (!new Set(["write", "read", "delete"]).has(operation)) return fail("OAUTH_SECRET_OPERATION_INVALID", 404);
  const raw = await request.text();
  if (!raw || raw.length > 100_000) return fail("OAUTH_SECRET_INPUT_INVALID", 400);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; }
  catch { return fail("OAUTH_SECRET_INPUT_INVALID", 400); }
  try {
    if (operation === "write") {
      if (typeof body.name !== "string" || typeof body.value !== "string") return fail("OAUTH_SECRET_INPUT_INVALID", 400);
      const reference = await writeOAuthVaultSecret(body.name, body.value, config.encryptionKey);
      return NextResponse.json({ reference }, { status: 201, headers: HEADERS });
    }
    if (typeof body.reference !== "string") return fail("OAUTH_SECRET_INPUT_INVALID", 400);
    if (operation === "read") {
      const value = await readOAuthVaultSecret(body.reference, config.encryptionKey);
      return NextResponse.json({ value }, { headers: HEADERS });
    }
    await deleteOAuthVaultSecret(body.reference);
    return new NextResponse(null, { status: 204, headers: HEADERS });
  } catch {
    return fail(`OAUTH_SECRET_${operation.toUpperCase()}_FAILED`, 503);
  }
}
