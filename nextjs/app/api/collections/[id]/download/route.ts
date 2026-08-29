import { NextResponse } from "next/server";
import { buildCollectionZip, validateDownloadableCollectionArtifact } from "@/lib/collection-download";
import { loadPreferredCollectionCandidate } from "@/lib/collection-storage";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ code: "AUTH_REQUIRED" }, { status: 401, headers: NO_STORE });

  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json({ code: "COLLECTION_ID_INVALID" }, { status: 400, headers: NO_STORE });
  }
  const signer = readR2SignerEnv();
  if (!signer) return NextResponse.json({ code: "SIGNER_NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });

  const { membership } = foundationPilotAccess(user.id);
  const loaded = await loadPreferredCollectionCandidate(signer, membership.workspaceId, id);
  if (!loaded.ok) {
    return NextResponse.json(
      { code: loaded.code },
      { status: loaded.code === "NOT_FOUND" ? 404 : 503, headers: NO_STORE },
    );
  }
  const artifact = validateDownloadableCollectionArtifact(loaded.value.artifact, id);
  if (!artifact) {
    return NextResponse.json({ code: "COLLECTION_PACKAGE_INVALID" }, { status: 422, headers: NO_STORE });
  }

  const archive = buildCollectionZip(artifact);
  return new Response(archive, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tavonel-${id}.zip"`,
      "Content-Length": String(archive.byteLength),
      "X-Content-Type-Options": "nosniff",
      "X-Tavonel-Candidate-Promotion": "false",
    },
  });
}
