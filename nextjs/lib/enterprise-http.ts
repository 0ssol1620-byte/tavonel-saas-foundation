export const ENTERPRISE_NO_STORE = { "Cache-Control": "no-store" };

export function enterpriseRequestId(request: Request) {
  const supplied = request.headers.get("x-request-id")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : crypto.randomUUID();
}

export async function readEnterpriseJson(request: Request, maximumBytes = 16_384) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maximumBytes) return { ok: false as const, code: "REQUEST_TOO_LARGE", status: 413 };
  const text = await request.text();
  if (text.length > maximumBytes) return { ok: false as const, code: "REQUEST_TOO_LARGE", status: 413 };
  try { return { ok: true as const, value: JSON.parse(text) as unknown }; }
  catch { return { ok: false as const, code: "INVALID_JSON", status: 400 }; }
}

export function parseAuditWindow(url: string, now = new Date()) {
  const params = new URL(url).searchParams;
  const to = params.get("to") ? new Date(params.get("to")!) : now;
  const from = params.get("from") ? new Date(params.get("from")!) : new Date(to.getTime() - 30 * 86_400_000);
  const format: "jsonl" | "csv" = params.get("format") === "csv" ? "csv" : "jsonl";
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() - from.getTime() > 366 * 86_400_000) return null;
  return { from: from.toISOString(), to: to.toISOString(), format };
}

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export function serializeAuditExport(events: readonly Record<string, unknown>[], format: "jsonl" | "csv") {
  if (format === "jsonl") return events.map((event) => JSON.stringify(event)).join("\n") + (events.length ? "\n" : "");
  const keys = ["event_id", "occurred_at", "workspace_key", "action", "target_type", "target_id", "actor_user_id", "actor_kind", "outcome", "request_id", "details"];
  return [keys.join(","), ...events.map((event) => keys.map((key) => csvCell(event[key])).join(","))].join("\n") + "\n";
}
