import { NextResponse } from "next/server";
import { COMPILE_MAX_DOCUMENTS } from "@/lib/compile-limits";
import { enqueueCompileJob, enqueueCorpusCompile, listWorkspaceCompileJobs } from "@/lib/compile-job-store";
import { CORPUS_MAX_DOCUMENTS, judgeCorpusSet, needsCorpusCompile } from "@/lib/corpus-batching";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

/*
  Start a compile, and hand back a receipt rather than a result.

  The old path had the browser wait for every document to finish reading and then call
  /api/collections/compile itself. That made the tab a required participant in a run the
  customer had already paid for: closing it abandoned the work with the reading already spent,
  and no record anywhere said a compile had been intended. Masterplan 6.3 puts the state
  machine on the server, so this endpoint's entire job is to write down the intent durably and
  return. The worker does the rest whether anyone is watching or not.
*/
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4_096) {
    return NextResponse.json({ code: "METADATA_ONLY_ENDPOINT" }, { status: 415, headers: HEADERS });
  }
  const auth = await authorizeFoundationRequest(request, "collections:compile", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });

  let body: { documentIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_JSON" }, { status: 400, headers: HEADERS });
  }
  if (!Array.isArray(body.documentIds)) {
    return NextResponse.json({ code: "DOCUMENT_IDS_REQUIRED" }, { status: 400, headers: HEADERS });
  }
  const documentIds = [...new Set(body.documentIds.filter((item): item is string => typeof item === "string"))];
  if (documentIds.some((id) => !DOCUMENT_ID_PATTERN.test(id))) {
    return NextResponse.json({ code: "DOCUMENT_SET_UNQUALIFIED" }, { status: 400, headers: HEADERS });
  }
  /*
    Two ceilings, and they are different numbers on purpose.

    COMPILE_MAX_DOCUMENTS is how many documents one compile carries: one Core request, one
    function invocation, one artifact. CORPUS_MAX_DOCUMENTS is how many a customer may submit,
    which is the archive intake ceiling, because dropping a 128-file ZIP and pressing Compile
    are the same action seen from two ends. Anything above the first is partitioned into parts
    below it rather than refused -- and the way to raise what a customer can compile is never
    to edit the first constant.
  */
  const verdict = judgeCorpusSet(documentIds.length);
  if (!verdict.ok) {
    return NextResponse.json(
      {
        code: verdict.code,
        message: verdict.message,
        maximumDocuments: CORPUS_MAX_DOCUMENTS,
        documentsPerCompile: COMPILE_MAX_DOCUMENTS,
      },
      { status: 400, headers: HEADERS },
    );
  }

  if (needsCorpusCompile(documentIds.length)) {
    const corpus = await enqueueCorpusCompile({
      workspaceKey: auth.principal.workspaceKey,
      createdByUserId: auth.principal.userId,
      documentIds,
    });
    if (!corpus.ok) {
      const status = corpus.code === "COMPILE_JOB_SCOPE_INVALID" ? 400 : 503;
      return NextResponse.json({ code: corpus.code }, { status, headers: HEADERS });
    }
    /*
      202 even when only some parts were written.

      The parts that exist are already being compiled, and reporting the whole submission as
      failed would tell the customer to start again over work that is running. `partsEnqueued`
      against `batchCount` says exactly how far it got, and resubmitting the same selection
      lands in the same corpus and fills in the rest.
    */
    return NextResponse.json({
      code: "COMPILE_CORPUS_ACCEPTED",
      corpusId: corpus.value.corpusId,
      batchCount: corpus.value.batchCount,
      partsEnqueued: corpus.value.parts.length,
      incompleteReason: corpus.value.incompleteReason,
      parts: corpus.value.parts,
      documentsTotal: documentIds.length,
      documentsPerCompile: COMPILE_MAX_DOCUMENTS,
    }, {
      status: 202,
      headers: { ...HEADERS, Location: `/api/compile-jobs/corpus/${corpus.value.corpusId}` },
    });
  }

  const enqueued = await enqueueCompileJob({
    workspaceKey: auth.principal.workspaceKey,
    createdByUserId: auth.principal.userId,
    documentIds,
  });
  if (!enqueued.ok) {
    const status = enqueued.code === "COMPILE_JOB_SCOPE_INVALID" ? 400 : 503;
    return NextResponse.json({ code: enqueued.code }, { status, headers: HEADERS });
  }

  /*
    202 whether or not this call is the one that created the row.

    Resubmitting the same document set returns the job that already exists, so a
    double-clicked button, a retried fetch and an at-least-once redelivery converge on one
    compile instead of three. The caller gets the same jobId either way and does not have to
    care which of them it was.
  */
  return NextResponse.json({
    code: "COMPILE_JOB_ACCEPTED",
    jobId: enqueued.value.jobId,
    state: enqueued.value.state,
    documentsTotal: documentIds.length,
  }, {
    status: 202,
    headers: { ...HEADERS, Location: `/api/compile-jobs/${enqueued.value.jobId}` },
  });
}

/** The workspace's recent compiles, so a returning tab can pick a run back up. */
export async function GET(request: Request) {
  const auth = await authorizeFoundationRequest(request, "collections:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: HEADERS });
  const jobs = await listWorkspaceCompileJobs(auth.principal.workspaceKey);
  if (!jobs.ok) return NextResponse.json({ code: jobs.code }, { status: 503, headers: HEADERS });
  return NextResponse.json({ code: "OK", jobs: jobs.value }, { headers: HEADERS });
}
