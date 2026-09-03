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

  This is a primitive now, not the customer's orchestration. A browser that calls it has to
  stay open until it answers, which is the exact dependency masterplan 6.3 removes -- so the
  workspace goes through POST /api/compile-jobs instead, and the durable worker calls the same
  compile this route calls (`runCollectionCompile`, shared so the two cannot drift apart).

  It stays public because the API contract published it and because a developer with their own
  scheduler has a legitimate reason to drive one compile and wait for it.
*/
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4_096) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: { "Cache-Control": "no-store" } });
  }
  /*
    Compiling a world is the product, not a Team upgrade.

    This route required "studio" while upload and OCR required only "observer", so a Developer
    subscriber could buy 500 compile pages, spend them on reading documents, and then be told
    the compile step needed a different plan. Collaboration is what Team sells; the compiler
    itself belongs to every paid plan.
  */
  const auth = await authorizeFoundationRequest(request, "collections:compile", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
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
  // Shared with the workspace so a selection cannot be accepted by the UI and refused here.
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
