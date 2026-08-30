import { POST as createUploadCapability } from "../../../uploads/capability/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return createUploadCapability(request);
}
