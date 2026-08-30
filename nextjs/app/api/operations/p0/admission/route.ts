import { NextResponse } from "next/server";
import {
  planLargeDocumentAdmission,
  type LargeDocumentAdmissionInput,
} from "@/lib/operations-p0";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 4_096) {
    return NextResponse.json(
      { code: "ADMISSION_REQUEST_TOO_LARGE" },
      { status: 413, headers }
    );
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 4_096) {
    return NextResponse.json(
      { code: "ADMISSION_REQUEST_TOO_LARGE" },
      { status: 413, headers }
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { code: "ADMISSION_BODY_INVALID" },
      { status: 400, headers }
    );
  }
  const input = body as Record<string, unknown>;
  const result = planLargeDocumentAdmission({
    workspaceKey:
      typeof input.workspaceKey === "string" ? input.workspaceKey : "",
    documentId: typeof input.documentId === "string" ? input.documentId : "",
    fileName: typeof input.fileName === "string" ? input.fileName : "",
    mimeType: typeof input.mimeType === "string" ? input.mimeType : "",
    byteSize: typeof input.byteSize === "number" ? input.byteSize : Number.NaN,
    pageCount:
      typeof input.pageCount === "number" ? input.pageCount : Number.NaN,
    sourceSha256:
      typeof input.sourceSha256 === "string" ? input.sourceSha256 : "",
  } satisfies LargeDocumentAdmissionInput);
  return NextResponse.json(result, { status: result.ok ? 200 : 422, headers });
}
