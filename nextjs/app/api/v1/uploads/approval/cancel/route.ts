import { POST as cancelApprovedMember } from "@/app/api/uploads/approval/cancel/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// fileKey identifies the triggering member; whole-set cancellation stays in the handler with auth and caller scoping.
export async function POST(request: Request) {
  return cancelApprovedMember(request);
}
