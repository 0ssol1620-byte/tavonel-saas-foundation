import { NextResponse } from "next/server";
import { COMPILE_MAX_DOCUMENTS } from "@/lib/compile-limits";
import {
  compileIdempotencyKey,
  enqueueCompileJob,
  enqueueCorpusCompile,
  listWorkspaceCompileJobs,
  type CompileJobFailure,
} from "@/lib/compile-job-store";
import { CORPUS_MAX_DOCUMENTS, judgeCorpusSet, needsCorpusCompile } from "@/lib/corpus-batching";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";
import { checkTrialCompileCapacity } from "@/lib/self-service-trial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "no-store" };

function enqueueFailureStatus(code: CompileJobFailure) {
  if (code === "COMPILE_JOB_SCOPE_INVALID") return 400;
  if (code === "COMPILE_JOB_SLOT_CONFLICT") return 409;
  return 503;
}

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

  // The evaluation includes one Compiled World. A retry of the exact same document set must
  // remain idempotent rather than becoming "World #2", so the capacity check is given the same
  // identity the enqueue function will use. The free file cap is three, therefore an evaluation
  // never reaches the corpus path below.
  if (auth.principal.accessSource === "trial") {
    const capacity = await checkTrialCompileCapacity(
      auth.principal.workspaceKey,
      auth.principal.userId,
      compileIdempotencyKey(auth.principal.workspaceKey, documentIds),
    );
    if (!capacity.ok) {
      return NextResponse.json({ code: capacity.code }, { status: 503, headers: HEADERS });
    }
    if (!capacity.allowed) {
      return NextResponse.json({ code: "TRIAL_WORLD_LIMIT_REACHED" }, { status: 402, headers: HEADERS });
    }
  }

  if (needsCorpusCompile(documentIds.length)) {
    const corpus = await enqueueCorpusCompile({
      workspaceKey: auth.principal.workspaceKey,
      createdByUserId: auth.principal.userId,
      documentIds,
    });
    if (!corpus.ok) {
      const status = enqueueFailureStatus(corpus.code);
      return NextResponse.json({ code: corpus.code }, { status, headers: HEADERS });
    }
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
    const status = enqueueFailureStatus(enqueued.code);
    return NextResponse.json({ code: enqueued.code }, { status, headers: HEADERS });
  }

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
