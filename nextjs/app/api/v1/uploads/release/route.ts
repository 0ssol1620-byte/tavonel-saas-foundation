import { POST as releaseApprovedMember } from "@/app/api/uploads/release/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Auth, approval binding, storage verification, and release stay in the handler.
export async function POST(request: Request) {
  return releaseApprovedMember(request);
}
