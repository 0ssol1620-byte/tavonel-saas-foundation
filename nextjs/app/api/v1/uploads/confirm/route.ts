import { POST as confirmApprovedMember } from "@/app/api/uploads/confirm/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Auth, approval binding, object verification, and confirmation stay in the handler.
export async function POST(request: Request) {
  return confirmApprovedMember(request);
}
