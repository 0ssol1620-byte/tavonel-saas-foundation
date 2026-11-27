import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/enterprise-http";
import { requestOrigin } from "@/lib/remote-mcp";
import { parseFieldVitalsBeacon, productMeasurementEnabled, recordFieldVitals } from "@/lib/product-measurement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const refuse = (code: string, status: number) => NextResponse.json({ code }, { status, headers: NO_STORE });

/*
  WO-AN-RUM-1: one page load's field vitals from a browser that allowed analytics
  (lib/field-vitals.ts). Unauthenticated by design and grants nothing: same-origin only, 256 bytes,
  a listed public path and three bounded numbers, added to daily counters with no identifier. The
  request is never logged; a refusal says which rule refused it and nothing about the body.
*/
export async function POST(request: Request) {
  if (!productMeasurementEnabled()) return new NextResponse(null, { status: 404 });
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return refuse("CROSS_SITE_REQUEST_REJECTED", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin(request)) return refuse("CROSS_SITE_REQUEST_REJECTED", 403);
  // sendBeacon sends a string as text/plain; nothing here rides a credential, so the type is a shape check only.
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json") && !type.startsWith("text/plain")) {
    return refuse("UNSUPPORTED_MEDIA_TYPE", 415);
  }
  const body = await readBoundedJson(request, 256);
  if (!body.ok) return refuse(body.code, body.status);
  const beacon = parseFieldVitalsBeacon(body.value);
  if (!beacon) return refuse("FIELD_VITALS_INVALID", 400);
  return await recordFieldVitals(beacon)
    ? new NextResponse(null, { status: 204, headers: NO_STORE })
    : refuse("FIELD_VITALS_UNAVAILABLE", 503);
}
