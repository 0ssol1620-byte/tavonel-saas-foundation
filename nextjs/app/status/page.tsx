import type { Metadata } from "next";
import PolicyLayout from "@/components/policy-layout";
import { readPublicOperations } from "@/lib/operations";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { NOT_RUN, buildProbeSection } from "@/lib/status-probe";
import { readProbeHistory } from "@/lib/synthetic-probe-store";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  // Each page declares its own address. Without this every route inherited the root
  // canonical ("/"), so a crawler was told 22 distinct pages were all the homepage.
  alternates: { canonical: "/status" },
  openGraph: { url: "/status" },
  title: "Service status — TAVONEL",
  description: "Component-by-component state of the active TAVONEL deployment, the last synthetic probe result, and the addresses to report service impact and security issues to.",
};
/*
  A named month, because 08/09/2026 is two different dates.

  `toLocaleString("en-GB")` printed "08/09/2026, 11:34:40" -- day-first, which a US or Korean
  reader reads month-first, turning today's live check into a month-old one or the reverse.
  RESOLVED A-6 says /status may not show a misleading state, and a freshness stamp a reader can
  misdate by four weeks is exactly that. Naming the month removes the ambiguity in every locale
  without changing the value or the timezone.
*/
const CHECKED_AT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** A timestamp or the literal NOT RUN. Never an empty cell: an absence has to read as one. */
function stamp(iso: string | null) {
  return iso ? `${CHECKED_AT.format(new Date(iso))} KST` : NOT_RUN;
}

/*
  §77: this page states its scope, because it cannot state uptime.

  Every row in the first list comes from `readPublicOperations`, which reads this deployment's own
  configuration and activation gates at render time. Not one of them sends a request through the
  component it describes, so "operational" there means configured and open, not reachable. Before
  that sentence a reader had "Last checked ... from the active production deployment" and no way
  to tell the difference -- which is the exact shape §77 warns about, a page that can keep saying
  operational through an outage.

  O02 adds the other half rather than replacing the sentence. The second list is the last
  synthetic probe: results of requests actually sent through the dependencies, on a schedule, with
  no customer data. The two lists are deliberately not merged and are not styled alike, because
  the one thing a reader must not do is take a configuration row for a proof of work. Read
  together they say: this is wired, and this is what happened last time something tried it.
*/
export default async function StatusPage() {
  const status = readPublicOperations();
  const signer = readR2SignerEnv();
  const probe = buildProbeSection(
    signer ? await readProbeHistory(signer) : { ok: false as const, code: "PROBE_STORE_NOT_CONFIGURED" },
  );
  return <PolicyLayout label="SERVICE STATUS" title="TAVONEL service status" intro={<>Read {CHECKED_AT.format(new Date(status.generatedAt))} KST from the active production deployment. Each row below is that deployment&rsquo;s own configuration and activation state at the moment this page rendered, not an uptime probe: &ldquo;operational&rdquo; means a component is configured and its gate is open, not that a request has just succeeded through it. The synthetic probe section further down is the separate question of whether a request recently did. Report an outage you are seeing rather than waiting for it to appear here.</>}>
    <h3>Configuration and activation state</h3>
    <div className="status-list">{Object.entries(status.components).map(([key, value]) => <article key={key} data-state={value.state}><span>{value.state.replaceAll("_", " ")}</span><h3>{key.replaceAll("_", " ")}</h3><p>{value.detail}</p></article>)}</div>

    <h3>Last successful synthetic probe</h3>
    <p><strong>{stamp(probe.lastSuccessfulAt)}</strong>{probe.lastSuccessfulAt ? null : <> &mdash; no stored run has passed. This is not a statement that the service is down; it is the absence of a probe result.</>}</p>
    <p>
      Most recent run of any outcome: <strong>{stamp(probe.lastRunAt)}</strong>
      {probe.lastRunOk === null ? null : probe.lastRunOk ? " (passed)" : " (did not pass)"}. {probe.window.sentence}
      {probe.unavailable ? " The rows below are therefore NOT RUN rather than green." : null}
    </p>
    <p>Unlike the rows above, each row here is the outcome of a request this deployment sent through the dependency on a schedule, carrying no customer data. A row marked &ldquo;not probed&rdquo; is neither a pass nor a failure: nothing was sent, and the reason is given.</p>
    {/*
      The word in the badge is the state; `data-state` only picks a colour, and it is picked from
      the vocabulary `tavonel.css` already styles. `failed` now has its own rule there, so it is
      passed through rather than borrowing `closed` -- a request that came back wrong and a
      capability deliberately switched off are different facts and no longer look identical. An
      absence still borrows `not_configured` (muted), because an unstyled value would inherit
      the green of `operational`, and a failed probe rendered green is worse than no probe.
    */}
    <div className="status-list">{probe.rows.map((row) => <article key={row.name} data-state={row.state === "operational" ? "operational" : row.state === "failed" ? "failed" : "not_configured"}><span>{row.state}</span><h3>{row.label}</h3><p>{row.detail}</p></article>)}</div>
    <p>End-to-end fixture run: {probe.fixtureE2E}</p>

    <h3>Incident contact</h3><p>Report service impact to support@tavonel.com and security issues to security@tavonel.com. Do not include document contents in email.</p>
  </PolicyLayout>;
}
