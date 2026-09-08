import { NextResponse } from "next/server";

import { isAllowedFormOrigin } from "@/lib/public-form-origin";
import { parseOptInRequest, RESEARCH_UPDATES_TABLE_MIGRATED } from "@/lib/research-updates";
import { readSupabaseAdminConfig } from "@/lib/supabase-admin";

export const runtime = "nodejs";

/*
  The Research Updates opt-in, refusing every request on purpose.

  Two things this route needs do not exist: `foundation_research_updates` (a migration, founder
  item) and the privacy wording that says what the address is used for (legal, founder item).
  Until both land it answers 503 and stores nothing, and there is deliberately no form anywhere
  on the site pointing at it -- a form that accepts an address and drops it tells the person they
  subscribed, which is worse than not offering one.

  What is built is the shape: origin, content type, size and closed-shape validation, then the
  same fail-closed answer the contact route gives when its delivery channel is unconfigured. The
  double opt-in state machine and its rules live in `lib/research-updates.ts` and are tested
  there; this route deliberately does not call it yet, because a decision it cannot persist is a
  decision it should not make.

  ponytail: no rate limit here, because there is nothing behind the gate to spend. The contact
  route's per-process limiter is one dimension short of durable and its own note names the RPC
  that would fix it; this route takes that RPC when it takes the table, and must not be enabled
  before it has one. `lib/research-updates-route.test.ts` fails if the gate opens.
*/
export async function POST(request: Request) {
  if (!isAllowedFormOrigin(request)) return error("This request origin is not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return error("Only JSON requests are accepted.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return error("The request is too large.", 413);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return error("Check the request format and try again.", 400);
  }

  if (!parseOptInRequest(raw)) return error("Check the required fields and input lengths.", 400);

  // Fail closed on the two preconditions separately, so an operator reading a 503 can tell a
  // missing service-role credential from a missing table.
  if (!readSupabaseAdminConfig()) {
    return error("Research updates are not available on this deployment.", 503);
  }
  if (!RESEARCH_UPDATES_TABLE_MIGRATED) {
    return error("Research updates are not open yet. Nothing was stored.", 503);
  }

  /*
    Reached only if somebody opens the gate. There is still no store behind it, so this stays a
    refusal: answering 202 here would be exactly the failure the gate exists to prevent, an
    address accepted and dropped.
  */
  return error("Research updates are not open yet. Nothing was stored.", 503);
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
