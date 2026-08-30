import { GET as listConnections, POST as createConnection } from "../../connections/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  return listConnections(request);
}

export function POST(request: Request) {
  return createConnection(request);
}
