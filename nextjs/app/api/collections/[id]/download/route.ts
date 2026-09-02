import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { buildSignedCollectionZip, validateReviewableCollectionArtifact } from "@/lib/collection-download";
import { readExportSignerEnv } from "@/lib/export-signing";
import { loadPreferredCollectionCandidate } from "@/lib/collection-storage";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const signed = buildSignedCollectionZip(artifact, exportSigner);
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
