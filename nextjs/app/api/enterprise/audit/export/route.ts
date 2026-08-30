import { authorizeEnterpriseRequest } from "@/lib/enterprise-auth";
import { parseAuditWindow, serializeAuditExport } from "@/lib/enterprise-http";
import { listAuditEvents } from "@/lib/enterprise-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeEnterpriseRequest(request, "audit:export");
  if (!auth.ok) return Response.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  const window = parseAuditWindow(request.url);
  if (!window) return Response.json({ code: "AUDIT_EXPORT_WINDOW_INVALID" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const result = await listAuditEvents(auth.principal.organizationId, window.from, window.to);
  if (!result.ok) return Response.json({ code: result.code }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const filename = `tavonel-audit-${window.from.slice(0, 10)}-${window.to.slice(0, 10)}.${window.format}`;
  return new Response(serializeAuditExport(result.events, window.format), { headers: {
    "Cache-Control": "no-store",
    "Content-Type": window.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-TAVONEL-Export-Count": String(result.events.length),
  } });
}
