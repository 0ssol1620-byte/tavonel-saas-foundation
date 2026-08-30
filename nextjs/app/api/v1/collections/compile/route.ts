import { POST as compileCollection } from "../../../collections/compile/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export function POST(request: Request) {
  return compileCollection(request);
}
