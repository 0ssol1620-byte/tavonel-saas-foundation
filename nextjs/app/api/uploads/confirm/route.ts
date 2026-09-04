import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { authorizeFoundationSessionProduct } from "@/lib/self-service-trial";
import { DOCUMENT_ID_PATTERN } from "@/lib/immutable-keys";
import { confirmFoundationIntake } from "@/lib/intake-admission";
import {
  headFoundationQuarantineObject,
  readFoundationQuarantineObject,
  readR2SignerEnv,
} from "@/lib/r2-synthetic-canary";
import { assessTrialSourceReuse } from "@/lib/trial-source-risk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > 1_024) {
    return NextResponse.json({ code: "UPLOAD_CONFIRM_REQUEST_TOO_LARGE" }, { status: 413, headers });
  }
  const auth = await authorizeFoundationRequest(request, "documents:intake", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers });

  let body: { documentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "UPLOAD_CONFIRM_BODY_INVALID" }, { status: 400, headers });
  }
  const documentId = typeof body.documentId === "string" ? body.documentId : "";
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    return NextResponse.json({ code: "UPLOAD_CONFIRM_BODY_INVALID" }, { status: 400, headers });
  }

  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers });
  const object = await headFoundationQuarantineObject(signer, auth.principal.workspaceKey, documentId);
  if (!object.ok) return NextResponse.json({ code: object.code }, { status: 503, headers });
  if (!object.exists) return NextResponse.json({ code: "QUARANTINE_OBJECT_NOT_FOUND" }, { status: 409, headers });

  // Exact-content reuse is evaluated only for free evaluation users. Paid customers and the
  // operator may legitimately ingest the same source in separate workspaces and are never
  // correlated by this abuse ledger. For a trial, do the bounded read before confirming intake:
  // confirmation is the hand-off to CDR/OCR, so a review-required source never consumes that
  // expensive path.
  const access = await authorizeFoundationSessionProduct(
    auth.principal.workspaceKey,
    auth.principal.userId,
    "observer",
  );
  if (!access.ok) return NextResponse.json({ code: access.code }, { status: access.status, headers });
  if (access.access.source === "trial") {
    const source = await readFoundationQuarantineObject(signer, auth.principal.workspaceKey, documentId);
    if (!source.ok) return NextResponse.json({ code: source.code }, { status: 503, headers });
    const assessed = await assessTrialSourceReuse({
      workspaceKey: auth.principal.workspaceKey,
      userId: auth.principal.userId,
      documentId,
      bytes: source.bytes,
    });
    if (!assessed.ok) {
      return NextResponse.json(
        { code: assessed.code },
        {
          status: assessed.code === "TRIAL_SOURCE_REVIEW_REQUIRED" ? 429 : 503,
          headers: {
            ...headers,
            ...(assessed.code === "TRIAL_SOURCE_REVIEW_REQUIRED" ? { "Retry-After": "86400" } : {}),
          },
        },
      );
    }
  }

  const confirmed = await confirmFoundationIntake({
    workspaceKey: auth.principal.workspaceKey,
    documentId,
    userId: auth.principal.userId,
  });
  if (!confirmed.ok) return NextResponse.json({ code: confirmed.code }, { status: 503, headers });
  return NextResponse.json({ code: "UPLOAD_CONFIRMED", result: confirmed.result }, { headers });
}
