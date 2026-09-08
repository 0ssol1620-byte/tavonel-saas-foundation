import { NextResponse } from "next/server";
import { readCorpusParts } from "@/lib/compile-job-store";
import { CORPUS_ID_PATTERN, summariseCorpus } from "@/lib/corpus-batching";
import { authorizeFoundationRequest } from "@/lib/developer-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

/*
  One corpus, read as its parts.

  There is no corpus row and no corpus state machine. The summary is computed from the parts
  every time, so it cannot disagree with them -- a stored roll-up would need its own writer,
  its own ordering rules and its own answer to what happens when a part settles twice, and all
  three already exist correctly one level down.

  A client following a corpus can poll this, or open each part's own event stream. The parts
  are ordinary compile jobs; `/api/compile-jobs/{jobId}/events` works on them unchanged.
*/
export async function GET(request: Request, context: { params: Promise<{ corpusId: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  const { corpusId } = await context.params;
  if (!CORPUS_ID_PATTERN.test(corpusId)) {
    return NextResponse.json({ code: "CORPUS_ID_INVALID" }, { status: 400, headers: HEADERS });
  }

  const parts = await readCorpusParts(auth.principal.workspaceKey, corpusId);
  if (!parts.ok) {
    const status = parts.code === "COMPILE_JOB_NOT_FOUND" ? 404
      : parts.code === "COMPILE_JOB_SCOPE_INVALID" ? 400
        : 503;
    return NextResponse.json({ code: parts.code }, { status, headers: HEADERS });
  }

  const summary = summariseCorpus(corpusId, parts.value.map((part) => ({
    jobId: part.jobId,
    batchIndex: part.batchIndex ?? 0,
    state: part.state,
    collectionId: part.collectionId,
    documentsTotal: part.documentsTotal,
    documentsReady: part.documentsReady,
    errorCode: part.errorCode,
    /*
      The part count the row declares. It is the one input the summary cannot derive from the
      rows it was handed, and dropping it here is what let a corpus missing three parts report
      that all of its parts had compiled.
    */
    batchCount: part.batchCount,
  })));

  return NextResponse.json({ code: "OK", ...summary, parts: parts.value }, { headers: HEADERS });
}
