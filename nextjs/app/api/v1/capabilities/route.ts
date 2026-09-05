import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { CAPABILITY_MANIFEST } from "../../../../../shared/capabilityManifest";

/*
  The capability manifest, served.

  Public and unauthenticated on purpose: it is the same list `/sources` prints and the same list
  the upload route validates against, it carries no tenant, no workspace and no document, and an
  integrator deciding whether to send us a file should not need a key to find out that we will
  refuse it.

  `contentSha256` is over the manifest exactly as serialized below, so a caller can pin the
  answer it built against and notice when the deployment's capabilities changed. It is a digest
  of the payload, not a qualification receipt -- a format's receipt lives in its own entry, and
  is null everywhere until a qualification run produces one.
*/
export const dynamic = "force-static";
export const runtime = "nodejs";

export function GET() {
  const body = JSON.stringify(CAPABILITY_MANIFEST);
  const contentSha256 = `sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`;

  return NextResponse.json(
    { ...CAPABILITY_MANIFEST, contentSha256 },
    {
      headers: {
        // The manifest changes with a deployment, never between two requests to one.
        "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
        ETag: `"${contentSha256}"`,
      },
    },
  );
}
