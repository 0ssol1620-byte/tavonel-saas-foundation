import { NextResponse } from "next/server";
import { foundationPilotAccess, getRequestUser } from "@/lib/foundation-pilot";
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
  const user = await getRequestUser(request);
  if (!user)
    return NextResponse.json(
      { code: "AUTH_REQUIRED" },
      { status: 401, headers: NO_STORE }
    );
  const { id } = await context.params;
  if (!COLLECTION_ID_PATTERN.test(id)) {
    return NextResponse.json(
      { code: "COLLECTION_ID_INVALID" },
      { status: 400, headers: NO_STORE }
    );
  }
  const access = foundationPilotAccess(user.id);
  if (!access) return NextResponse.json({ code: "PILOT_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  const { membership } = access;
  const active = await getFoundationActiveWorld(membership.workspaceId, id);
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
    membership.workspaceId,
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
