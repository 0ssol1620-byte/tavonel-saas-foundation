import { NextResponse } from "next/server";
import { authorizeFoundationRequest, revalidateFoundationAuthorization } from "@/lib/developer-auth";
import { buildSignedCollectionZip, validateReviewableCollectionArtifact } from "@/lib/collection-download";
import { readExportSignerEnv } from "@/lib/export-signing";
import { loadPreferredCollectionCandidate } from "@/lib/collection-storage";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { WORKSPACE_EXPORT_CONCURRENCY } from "@/lib/workspace-cost-guard";
import { acquireWorkspaceOperation } from "@/lib/workspace-operation-guard";
import { collectionSourceDocumentIds } from "@/lib/collection-source-access";
import { checkConnectorSourceAccess } from "@/lib/connector-source-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/*
 * A signed export builds a zip of the whole package and signs it, and nothing bounded either
 * half (blueprint §32, S-22): no `maxDuration`, so a large package ran until the platform's own
 * default gave up, and no concurrency guard, so one workspace could start as many builds at once
 * as it could open connections.
 *
 * The two belong together. A concurrency cap without a deadline is a queue that fills and never
 * drains; a deadline without a cap only makes each of the unbounded builds fail separately.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeFoundationRequest(request, "collections:download", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });

  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });

  // Taken after the cheap refusals and before the first expensive one: a malformed id or an
  // unconfigured signer costs nothing and must not consume a workspace's export slot.
  const lease = await acquireWorkspaceOperation("export", auth.principal.workspaceKey);
  if (!lease.ok) {
    return NextResponse.json(
      { code: lease.code, concurrencyLimit: WORKSPACE_EXPORT_CONCURRENCY },
      { status: lease.status, headers: { ...NO_STORE, "Retry-After": "10" } },
    );
  }
  let signed: ReturnType<typeof buildSignedCollectionZip>;
  let documentIds: string[];
  try {
    const manifestDigest = new URL(request.url).searchParams.get("manifest") ?? undefined;
    const loaded = await loadPreferredCollectionCandidate(
      signer,
      auth.principal.workspaceKey,
      id,
      manifestDigest,
    );
    if (!loaded.ok) {
      return NextResponse.json(
        { code: loaded.code },
        { status: loaded.code === "NOT_FOUND" ? 404 : 503, headers: NO_STORE },
      );
    }
    const artifact = validateReviewableCollectionArtifact(loaded.value.artifact, id);
    if (!artifact) {
      return NextResponse.json({ code: "COLLECTION_PACKAGE_INVALID" }, { status: 422, headers: NO_STORE });
    }
    const sourceIds = collectionSourceDocumentIds(artifact);
    if (!sourceIds) return NextResponse.json({ code: "COLLECTION_SOURCE_BINDING_INVALID" }, { status: 422, headers: NO_STORE });
    documentIds = sourceIds;
    const sourceAccess = await checkConnectorSourceAccess(auth.principal.workspaceKey, documentIds);
    if (!sourceAccess.ok) return NextResponse.json({ code: sourceAccess.code }, {
      status: sourceAccess.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: NO_STORE,
    });

    const exportSigner = readExportSignerEnv();
    if (!exportSigner) {
      const configured = Boolean(
        process.env.TAVONEL_EXPORT_SIGNING_KEY_ID ||
        process.env.TAVONEL_EXPORT_SIGNING_PRIVATE_KEY_PKCS8_DER_B64,
      );
      return NextResponse.json(
        { code: configured ? "EXPORT_SIGNER_INVALID" : "EXPORT_SIGNER_NOT_CONFIGURED" },
        { status: 503, headers: NO_STORE },
      );
    }
    signed = buildSignedCollectionZip(artifact, exportSigner);
  } finally {
    // Finish the potentially remote cleanup before the final authorization check.
    // The complete archive is now in memory and no longer occupies a build slot.
    if (!lease.replay) await lease.release();
  }
  const authorizedNow = await revalidateFoundationAuthorization(
    request, auth.principal, "collections:download", "observer",
  );
  if (!authorizedNow.ok) return NextResponse.json({ code: authorizedNow.code }, {
    status: authorizedNow.status, headers: NO_STORE,
  });
  const sourceAccessNow = await checkConnectorSourceAccess(auth.principal.workspaceKey, documentIds);
  if (!sourceAccessNow.ok) return NextResponse.json({ code: sourceAccessNow.code }, {
    status: sourceAccessNow.code === "CONNECTOR_SOURCE_ACCESS_DENIED" ? 403 : 503, headers: NO_STORE,
  });
  return new Response(signed.archive, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="tavonel-${id}.zip"`,
        "Content-Length": String(signed.archive.byteLength),
        "X-Content-Type-Options": "nosniff",
        "X-Tavonel-Candidate-Promotion": "false",
        "X-Tavonel-Export-Manifest-Sha256": signed.signature.signedPayloadSha256,
        "X-Tavonel-Export-Key-Id": signed.signature.keyId,
      },
  });
}
