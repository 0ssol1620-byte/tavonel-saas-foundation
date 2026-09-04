import { NextResponse } from "next/server";
import { runCollectionCompile } from "@/lib/collection-compile-run";
import { COMPILE_MAX_DOCUMENTS, judgeCompileSet } from "@/lib/compile-limits";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/*
  Compile a set of read documents, synchronously.

  This is a paid/owner primitive, not the customer's orchestration. A free evaluation must use
  /api/compile-jobs, where the one-World cap, idempotency and resumable lifecycle are enforced
  before work is enqueued. Keeping this primitive outside the trial also prevents a caller from
  bypassing that cap with repeated synchronous requests.
*/
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4_096) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  const auth = await authorizeFoundationRequest(request, "collections:compile", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  if (auth.principal.accessSource === "trial") {
    return NextResponse.json({ code: "TRIAL_DURABLE_COMPILE_REQUIRED" }, { status: 402, headers: { "Cache-Control": "no-store" } });
  }

  let body: { documentIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!Array.isArray(body.documentIds)) {
    return NextResponse.json({ code: "DOCUMENT_IDS_REQUIRED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const documentIds = [...new Set(body.documentIds.filter((item): item is string => typeof item === "string"))];
  if (documentIds.some((id) => !DOCUMENT_ID_PATTERN.test(id))) {
    return NextResponse.json({ code: "DOCUMENT_SET_UNQUALIFIED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const verdict = judgeCompileSet(documentIds.length);
  if (!verdict.ok) {
    return NextResponse.json(
      { code: verdict.code, message: verdict.message, maximumDocuments: COMPILE_MAX_DOCUMENTS },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const run = await runCollectionCompile(auth.principal.workspaceKey, documentIds);
  if (!run.ok) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (run.retryAfterSeconds) headers["Retry-After"] = String(run.retryAfterSeconds);
    return NextResponse.json({ code: run.code, ...run.payload }, { status: run.status, headers });
  }
  return NextResponse.json(run.payload, { headers: { "Cache-Control": "no-store" } });
}
