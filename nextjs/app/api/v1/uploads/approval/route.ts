import { GET as getUploadApproval, POST as createUploadApproval } from "@/app/api/uploads/approval/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keep the v1 methods explicit for the route inventory; the original handlers retain auth,
// validation, and all approval state transitions.
export async function GET(request: Request) {
  return getUploadApproval(request);
}

export async function POST(request: Request) {
  return createUploadApproval(request);
}
