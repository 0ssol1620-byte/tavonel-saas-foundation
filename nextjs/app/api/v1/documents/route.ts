import { GET as listDocuments } from "../../documents/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return listDocuments(request);
}
