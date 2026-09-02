import { GET as getOpenApi } from "@/app/api/openapi/route";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json");
  return getOpenApi(new Request(new URL("/api/openapi", request.url), { headers }));
}
