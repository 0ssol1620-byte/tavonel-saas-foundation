import { NextResponse } from "next/server";
import { readBoundedJson } from "@/lib/enterprise-http";
import { getRequestUser } from "@/lib/foundation-pilot";
import {
  parseProductMeasurementRequest,
  productMeasurementEnabled,
  readProductMeasurementChoice,
  setProductMeasurementChoice,
  type ProductMeasurementChoice,
} from "@/lib/product-measurement";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const reply = (body: ProductMeasurementChoice | { code: string }, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// WO-AN-RUM-1: the signed-in user's own product-measurement choice. Reads and writes only the caller's row.
export async function GET(request: Request) {
  if (!productMeasurementEnabled()) return new NextResponse(null, { status: 404 });
  const user = await getRequestUser(request);
  if (!user) return reply({ code: "AUTH_REQUIRED" }, 401);
  const read = await readProductMeasurementChoice(user.id);
  return read.ok ? reply({ choice: read.choice }) : reply({ code: "PRODUCT_MEASUREMENT_UNAVAILABLE" }, 503);
}

export async function POST(request: Request) {
  if (!productMeasurementEnabled()) return new NextResponse(null, { status: 404 });
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return reply({ code: "CROSS_SITE_REQUEST_REJECTED" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return reply({ code: "UNSUPPORTED_MEDIA_TYPE" }, 415);
  }
  const user = await getRequestUser(request);
  if (!user) return reply({ code: "AUTH_REQUIRED" }, 401);
  const body = await readBoundedJson(request, 1_024);
  if (!body.ok) return reply({ code: body.code }, body.status);
  const parsed = parseProductMeasurementRequest(body.value);
  if (!parsed) return reply({ code: "PRODUCT_MEASUREMENT_REQUEST_INVALID" }, 400);
  const saved = await setProductMeasurementChoice(user.id, parsed);
  return saved.ok ? reply({ choice: saved.choice }) : reply({ code: "PRODUCT_MEASUREMENT_UNAVAILABLE" }, 503);
}
