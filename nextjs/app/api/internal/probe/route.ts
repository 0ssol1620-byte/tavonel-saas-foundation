import { getVercelOidcToken } from "@vercel/functions/oidc";
import { NextResponse } from "next/server";
import { cdrIdentityToken } from "@/lib/cdr-workload-identity";
import { authorizeSyntheticCanary, readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { runSyntheticProbe } from "@/lib/synthetic-probe";
import { nextProbeHistory, readProbeHistory, writeProbeHistory } from "@/lib/synthetic-probe-store";

/*
  CROSS-LANE, deliberate red. This route exports POST, so `lib/route-classification.test.ts`
  requires an entry in `lib/security/route-classification.json` -- a file outside lane L10's
  ownership row (CA_LANE_CONTRACT_2026-09-11 §2), and rule 2 says a fix in a file this lane does
  not own is requested as a patch and not applied here. Until the orchestrator applies CROSS-LANE
  REQUEST 0 from `reports/CA_LANE_REPORT_ops.md` (the entry is quoted verbatim there), exactly one
  assertion is red on this branch:
    lib/route-classification.test.ts > classifies every route that exports a state-changing method
      expected [ 'app/api/internal/probe/route.ts' ] to deeply equal []
  Dropping POST would silence that test instead of classifying the route: the GET path writes the
  history object too, so this surface is state-changing whichever method reaches it.
*/
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/*
  Six sequential dependency checks at `PROBE_TIMEOUT_MS` each, plus one read and one write of the
  history object. Sixty seconds is the same wall clock the jobs cron declares, which is the
  cheapest number to reason about: no cron route in this deployment may outlive another.
*/
export const maxDuration = 60;

const HEADERS = { "Cache-Control": "no-store" };

/*
  Infrastructure authorization, not a user session -- the same reasoning as
  /api/internal/jobs/run, and deliberately the same two secrets so the Vercel cron that calls
  this one needs nothing new configured. `authorizeSyntheticCanary` is the existing constant-time
  Bearer comparison; a secret shorter than 32 characters is treated as absent rather than as a
  weak gate, and with neither configured the endpoint is closed instead of open.
*/
function authorized(request: Request): boolean {
  const presented = request.headers.get("authorization");
  return [process.env.FOUNDATION_WORKER_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 32)
    .some((secret) => authorizeSyntheticCanary(presented, secret));
}

/*
  One synthetic probe run, recorded.

  The response always carries the run, even when storing it failed: the requests were sent and
  their outcomes are a fact whether or not the object store kept them. The status code says
  whether /status will be able to see it.

  Nothing here reads or writes customer data. The one write is `synthetic/probe/history.json`,
  under the prefix reserved for exactly this.
*/
async function probe(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ code: "PROBE_NOT_AUTHORIZED" }, { status: 401, headers: HEADERS });
  }

  const run = await runSyntheticProbe({
    // Both only work on Vercel. Off Vercel the CDR row is `not_probed`, because the check is
    // gated on FOUNDATION_CDR_IDENTITY_ENABLED before either is called.
    cdrSubject: getVercelOidcToken,
    cdrMint: cdrIdentityToken,
  });

  const signer = readR2SignerEnv();
  if (!signer) {
    return NextResponse.json({ code: "PROBE_STORE_NOT_CONFIGURED", run }, { status: 503, headers: HEADERS });
  }

  /*
    Read before write, and refuse rather than clobber.

    The history is one object, so writing without reading would silently replace every stored run
    with this one. If the read fails -- unreachable, or an object that does not validate -- this
    run is reported and not stored, and /status shows the read failure. An operator deleting a
    corrupt `synthetic/probe/history.json` is a smaller problem than a probe that quietly
    destroyed its own history.
  */
  const previous = await readProbeHistory(signer);
  if (!previous.ok) {
    return NextResponse.json({ code: previous.code, run }, { status: 503, headers: HEADERS });
  }
  const written = await writeProbeHistory(signer, nextProbeHistory(previous.history, run));
  if (!written.ok) {
    return NextResponse.json({ code: written.code, run }, { status: 503, headers: HEADERS });
  }
  // A failed probe is not a failed request: the run was performed and recorded, which is what
  // this endpoint promises. A scheduler that saw 5xx here would retry a measurement.
  return NextResponse.json({ code: "PROBE_RECORDED", run }, { headers: HEADERS });
}

export const GET = probe;
export const POST = probe;
