import { summarizeCspReport } from "@/lib/csp-report-only";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/*
  A public, unauthenticated endpoint the browser posts to, which makes it a free write into our
  logs for anyone who finds it. Three limits, in the order they cost least to apply:

  - 8 KB. A real report is a few hundred bytes; the cap is checked against the declared length
    before the body is read and against the body after, because Content-Length is attacker input.
  - At most 8 reports per POST. `application/reports+json` batches, and a batch is bounded.
  - Only the four sanitized fields in `summarizeCspReport` are logged, never the request body.

  There is no rate limit here. That belongs at the edge with the other public endpoints (§30),
  which is lane S1's, and this endpoint is not the one that makes it necessary.
*/
const MAX_BYTES = 8_192;
const MAX_REPORTS = 8;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BYTES) return new Response(null, { status: 413, headers: NO_STORE });

  const text = await request.text();
  if (text.length > MAX_BYTES) return new Response(null, { status: 413, headers: NO_STORE });

  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { return new Response(null, { status: 400, headers: NO_STORE }); }

  // `application/reports+json` sends an array of envelopes; `application/csp-report` sends one
  // object. Both arrive here and neither is trusted to be either.
  const entries = Array.isArray(payload) ? payload.slice(0, MAX_REPORTS) : [payload];
  let accepted = 0;
  for (const entry of entries) {
    const envelope = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const violation = summarizeCspReport(envelope?.body ?? envelope);
    if (!violation) continue;
    accepted += 1;
    console.warn(JSON.stringify({ event: "csp_violation", ...violation }));
  }
  // Nothing recognisable is a client error, not a silently swallowed success: a collector that
  // 204s on garbage cannot be distinguished from one that is wired up wrong.
  if (accepted === 0) return new Response(null, { status: 400, headers: NO_STORE });
  return new Response(null, { status: 204, headers: NO_STORE });
}
