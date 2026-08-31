import { NextResponse } from "next/server";
import { authorizeFoundationRequest } from "@/lib/developer-auth";
import { loadWorldReadModel } from "@/lib/world-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "no-store" };
const LENSES = new Set(["objects", "relations", "evidence", "history", "files", "review"]);

export async function GET(request: Request, context: { params: Promise<{ id: string; lens: string }> }) {
  const auth = await authorizeFoundationRequest(request, "worlds:read", "observer");
  if (!auth.ok) return NextResponse.json({ code: auth.code }, { status: auth.status, headers: NO_STORE });
  const { id, lens } = await context.params;
  if (!LENSES.has(lens)) return NextResponse.json({ code: "WORLD_LENS_NOT_FOUND" }, { status: 404, headers: NO_STORE });
  const loaded = await loadWorldReadModel(auth.principal.workspaceKey, id);
  if (!loaded.ok) return NextResponse.json({ code: loaded.code }, { status: loaded.status, headers: NO_STORE });
  const payload = lens === "files"
    ? { files: loaded.model.files, signature: loaded.model.signature }
    : { [lens]: loaded.model[lens as keyof Pick<typeof loaded.model, "objects" | "relations" | "evidence" | "history" | "review">] };
  return NextResponse.json({ code: "OK", world: loaded.model.world, contract: loaded.model.contract, ...payload }, { headers: NO_STORE });
}
