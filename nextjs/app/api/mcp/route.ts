import { NextResponse } from "next/server";
import { assertReadOnly, createClient, createServer } from "@/public/developer/tavonel-mcp.mjs";
import {
  REMOTE_MCP_PROTOCOL_VERSIONS,
  REMOTE_MCP_TOOL_SCOPES,
  bearerChallenge,
  checkBearer,
  remoteMcpEnabled,
  requestOrigin,
} from "@/lib/remote-mcp";
import { GET as listSources } from "../v1/documents/route";
import { GET as listWorlds } from "../v1/collections/route";
import { GET as getWorld } from "../v1/world/[id]/route";
import { GET as getLens } from "../v1/world/[id]/[lens]/route";
import { POST as searchWorld } from "../v1/collections/[id]/search/route";
import { POST as askWorld } from "../v1/collections/[id]/ask/route";
import { GET as downloadPackage } from "../v1/collections/[id]/download/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/*
  POST /api/mcp -- the remote MCP endpoint (G11, contract stage). See lib/remote-mcp.ts.

  The bridge's own server answers every message; this file is the transport around it. The
  bridge refuses to start with a write tool in its table, and so does this route.
*/
assertReadOnly();

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 65_536;
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

/**
 * The bridge's HTTP client, pointed at the route handlers in this process instead of the network.
 *
 * Closed set: exactly the seven requests the bridge's table makes. Anything else is refused, so
 * the dispatcher is a second read-only gate behind `assertReadOnly`.
 */
async function dispatch(url: string, init: RequestInit): Promise<Response> {
  const { pathname } = new URL(url);
  const request = new Request(url, init);
  const method = request.method;
  let match: RegExpExecArray | null;
  if (method === "GET" && pathname === "/api/v1/documents") return listSources(request);
  if (method === "GET" && pathname === "/api/v1/collections") return listWorlds(request);
  if (method === "GET" && (match = /^\/api\/v1\/world\/([^/]+)$/.exec(pathname))) return getWorld(request, params({ id: match[1]! }));
  if (method === "GET" && (match = /^\/api\/v1\/world\/([^/]+)\/(objects|relations|evidence)$/.exec(pathname))) {
    return getLens(request, params({ id: match[1]!, lens: match[2]! }));
  }
  if (method === "POST" && (match = /^\/api\/v1\/collections\/([^/]+)\/search$/.exec(pathname))) return searchWorld(request, params({ id: match[1]! }));
  if (method === "POST" && (match = /^\/api\/v1\/collections\/([^/]+)\/ask$/.exec(pathname))) return askWorld(request, params({ id: match[1]! }));
  if (method === "GET" && (match = /^\/api\/v1\/collections\/([^/]+)\/download$/.exec(pathname))) return downloadPackage(request, params({ id: match[1]! }));
  return NextResponse.json({ code: "REMOTE_MCP_REQUEST_REFUSED" }, { status: 500 });
}

function rpcError(status: number, id: unknown, code: number, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });
}

export async function POST(request: Request) {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  const origin = requestOrigin(request);
  // Streamable HTTP: servers MUST validate Origin. Server-side clients send none.
  const from = request.headers.get("origin");
  if (from !== null && from !== origin) return rpcError(403, null, -32000, "MCP_ORIGIN_REFUSED");
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !REMOTE_MCP_PROTOCOL_VERSIONS.includes(version)) return rpcError(400, null, -32600, "MCP_PROTOCOL_VERSION_UNSUPPORTED");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY) return rpcError(413, null, -32600, "REQUEST_TOO_LARGE");
  const text = await request.text();
  if (text.length > MAX_BODY) return rpcError(413, null, -32600, "REQUEST_TOO_LARGE");
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return rpcError(400, null, -32700, "Parse error");
  }
  // 2025-06-18 removed JSON-RPC batching from the transport; one message per POST.
  if (!message || typeof message !== "object" || Array.isArray(message) || (message as { jsonrpc?: unknown }).jsonrpc !== "2.0") {
    return rpcError(400, null, -32600, "Invalid Request");
  }
  const { id, method, params: rpcParams } = message as { id?: unknown; method?: unknown; params?: { name?: unknown } };

  const bearer = await checkBearer(request.headers.get("authorization"));
  if (bearer.kind === "rejected") {
    return rpcError(401, id, -32001, "AUTH_INVALID", {
      "WWW-Authenticate": bearerChallenge(origin, { error: "invalid_token", description: bearer.description }),
    });
  }
  // A notification or a response: accepted, nothing to answer.
  if (typeof method !== "string" || id === undefined || id === null) return new NextResponse(null, { status: 202 });

  if (method === "tools/call") {
    if (bearer.kind === "anonymous") return rpcError(401, id, -32001, "AUTH_REQUIRED", { "WWW-Authenticate": bearerChallenge(origin) });
    const scope = typeof rpcParams?.name === "string" ? REMOTE_MCP_TOOL_SCOPES[rpcParams.name] : undefined;
    if (scope && !bearer.scopes.includes(scope)) {
      return rpcError(403, id, -32001, "API_SCOPE_REQUIRED", {
        "WWW-Authenticate": bearerChallenge(origin, { error: "insufficient_scope", description: `This tool needs ${scope}.`, scope }),
      });
    }
  }

  const handle = createServer({
    call: createClient({ baseUrl: origin, apiKey: bearer.kind === "principal" ? bearer.token : "", fetcher: dispatch as typeof fetch }),
  });
  return NextResponse.json(await handle(message), { headers: NO_STORE });
}

/* The JSON response form only: no server-initiated SSE stream (Streamable HTTP allows 405). */
export function GET() {
  if (!remoteMcpEnabled()) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
