import { NextResponse } from "next/server";
import { getRequestUser, foundationWorkspaceId } from "@/lib/foundation-pilot";
import { executeFounderTestReset, FOUNDER_TEST_RESET_EMAIL, prepareFounderTestReset } from "@/lib/founder-test-reset";
import { requireWorkspaceMembership, revalidateWorkspaceMembership } from "@/lib/workspace-membership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const HEADERS = { "Cache-Control": "no-store" };

function statusFor(code: string) {
  if (code.includes("AUTH_REQUIRED")) return 401;
  if (code.includes("FORBIDDEN") || code.includes("OWNER") || code.includes("LEGAL_HOLD")) return 403;
  if (code.includes("DIGEST_REQUIRED")) return 400;
  if (code.includes("CHANGED") || code.includes("DRIFT") || code.includes("ACTIVE_WORK")
    || code.includes("NEW_DATABASE_CONTENT")) return 409;
  return 503;
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user?.id) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: HEADERS });
  if (user.email?.trim().toLowerCase() !== FOUNDER_TEST_RESET_EMAIL) {
    return NextResponse.json({ code: "FOUNDER_TEST_RESET_ACCOUNT_FORBIDDEN" }, { status: 403, headers: HEADERS });
  }
  const workspaceKey = foundationWorkspaceId(user.id);
  const auth = await requireWorkspaceMembership(request, workspaceKey, ["owner"]);
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const body = await request.json().catch(() => null) as { mode?: unknown; resetId?: unknown; manifestDigest?: unknown } | null;
  if (body?.mode !== "dry-run" && body?.mode !== "execute") {
    return NextResponse.json({ code: "FOUNDER_TEST_RESET_MODE_INVALID" }, { status: 400, headers: HEADERS });
  }
  try {
    if (body.mode === "dry-run") {
      const result = await prepareFounderTestReset(user);
      const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner"]);
      if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: HEADERS });
      return NextResponse.json({ code: "OK", dryRun: true, ...result }, { headers: HEADERS });
    }
    if (typeof body.resetId !== "string" || typeof body.manifestDigest !== "string") {
      throw new Error("FOUNDER_TEST_RESET_DIGEST_REQUIRED");
    }
    const current = await revalidateWorkspaceMembership(request, auth.principal, ["owner"]);
    if (!current.ok) return NextResponse.json({ code: current.code }, { status: current.status, headers: HEADERS });
    const result = await executeFounderTestReset(user, body.resetId, body.manifestDigest);
    return NextResponse.json({ code: "OK", dryRun: false, ...result }, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : "FOUNDER_TEST_RESET_FAILED";
    return NextResponse.json({ code }, { status: statusFor(code), headers: HEADERS });
  }
}
