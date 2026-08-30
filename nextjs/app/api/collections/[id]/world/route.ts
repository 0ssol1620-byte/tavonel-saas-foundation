import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { COLLECTION_ID_PATTERN } from "@/lib/immutable-keys";
import {
  getFoundationActiveWorld,
  listFoundationWorldVersions,
} from "@/lib/world-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "COLLECTION_ID_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  const active = await getFoundationActiveWorld(auth.principal.workspaceKey, id);
  if (!active.ok) {
    return NextResponse.json(
      { code: active.code },
      {
        status: active.code === "ACTIVE_WORLD_NOT_FOUND" ? 404 : 503,
        headers: NO_STORE,
      }
    );
  }
  const versions = await listFoundationWorldVersions(
    auth.principal.workspaceKey,
    id
  );
  if (!versions.ok)
    return NextResponse.json(
      { code: versions.code },
      { status: 503, headers: NO_STORE }
    );
  return NextResponse.json(
    { code: "OK", activeWorld: active.world, versions: versions.versions },
    { headers: NO_STORE }
  );
}
