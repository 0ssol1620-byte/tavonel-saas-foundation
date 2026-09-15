import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import PolicyLayout from "@/components/policy-layout";
import { CHANGELOG } from "@/lib/changelog";
import { readPublicOperations } from "@/lib/operations";
import { readR2SignerEnv } from "@/lib/r2-synthetic-canary";
import { NOT_RUN, buildProbeSection } from "@/lib/status-probe";
import { SUPPORT_ACKNOWLEDGEMENT } from "@/lib/support-targets";
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
  day: "2-digit", month: "long", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

/*
  G2-013. The date the incident record starts, derived rather than typed.

  An incident history that says "none" without saying "since when" is not a record, it is a
  reassurance: the same sentence is true of a service that launched this morning and of one that
  has run for three years. The earliest release this repository has recorded is the earliest date
  anything about this service was public, so it is the date the claim is bounded by, and it moves
  on its own when the changelog does.
*/
const RECORD_STARTS = CHANGELOG.reduce(
  (earliest, entry) => (entry.date < earliest ? entry.date : earliest),
  CHANGELOG[0]!.date,
);

const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", day: "numeric", month: "long", year: "numeric" });

/** A timestamp or the not-yet-reported badge. Never an empty cell: an absence has to read as one. */
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
/*
  BA-135. The display name for each component, beside the key rather than derived from it.

  The page rendered `key.replaceAll("_", " ")`, and the keys in `lib/operations.ts` are
  camelCase with no underscores in them -- so the transform was a no-op and the heading on the
  public status page was the repository's own object key, capitalized by CSS into
  "DocumentPipeline". `lib/site-navigation.ts` already named "the repository folder structure
  showing through as UI" as a thing to stop doing.

  A key with no label here renders the key, which is visible and wrong rather than blank and
  wrong; `operations.test.ts` holds that every component has a state, and this map is checked
  against the same object below.
*/
/*
  BA-134(d). Until a check reports, the six rows were six identical grey cards each saying nothing
  had happened -- the largest thing on the page, and all of it an absence. One line replaces them,
  naming what will report, and the page opens on the configuration rows that are green.
*/
const DEPENDENCIES_SENTENCE = "the document sanitizer, GPU OCR, the compiler core, object storage, the database and billing.";

const COMPONENT_LABEL: Record<string, string> = {
  website: "Website",
  authentication: "Authentication",
  documentPipeline: "Document pipeline",
  billing: "Billing",
  export: "Export",
};

export default async function StatusPage() {
  const status = readPublicOperations();
  const signer = readR2SignerEnv();
  const probe = buildProbeSection(
    signer ? await readProbeHistory(signer) : { ok: false as const, code: "PROBE_STORE_NOT_CONFIGURED" },
  );
  return <PolicyLayout group="SERVICE" label="LIVE CONFIGURATION AND ACTIVATION" title="TAVONEL service status" intro={<>Each row below is TAVONEL&rsquo;s live configuration and activation state, read {CHECKED_AT.format(new Date(status.generatedAt))} KST when this page rendered: &ldquo;operational&rdquo; means a component is configured and its gate is open. Whether a request recently succeeded through one is the separate question the scheduled checks answer further down. Report an outage you are seeing rather than waiting for it to appear here.</>}>
    <h3>Configuration and activation state</h3>
    <div className="status-list">{Object.entries(status.components).map(([key, value]) => <article key={key} data-state={value.state}><span>{value.state.replaceAll("_", " ")}</span><h3>{COMPONENT_LABEL[key] ?? key}</h3><p>{value.detail}</p></article>)}</div>

    <h3>Scheduled dependency checks</h3>
    <p>Each check here is a request this deployment sent through the dependency on a schedule, carrying no customer data, and it reports what came back. A row marked &ldquo;not probed&rdquo; is neither a pass nor a failure: nothing was sent, and the reason is given.</p>
    <p>
      Last check that passed: <strong>{stamp(probe.lastSuccessfulAt)}</strong>. Most recent check
      of any outcome: <strong>{stamp(probe.lastRunAt)}</strong>
      {probe.lastRunOk === null ? null : probe.lastRunOk ? " (passed)" : " (did not pass)"}.{" "}
      {probe.window.sentence}
    </p>
    {/*
      The word in the badge is the state; `data-state` only picks a colour, and it is picked from
      the vocabulary `tavonel.css` already styles. `failed` now has its own rule there, so it is
      passed through rather than borrowing `closed` -- a request that came back wrong and a
      capability deliberately switched off are different facts and no longer look identical. An
      absence still borrows `not_configured` (muted), because an unstyled value would inherit
      the green of `operational`, and a failed probe rendered green is worse than no probe.
    */}
    {probe.rows.every((row) => row.state === NOT_RUN)
      ? <p>Scheduled dependency checks begin reporting here with the next run: {DEPENDENCIES_SENTENCE}</p>
      : <div className="status-list">{probe.rows.map((row) => <article key={row.name} data-state={row.state === "operational" ? "operational" : row.state === "failed" ? "failed" : "not_configured"}><span>{row.state}</span><h3>{row.label}</h3><p>{row.detail}</p></article>)}</div>}
    <p>Full pipeline check: {probe.fixtureE2E}</p>

    {/*
      G2-013. What a buyer expects from a status page and did not get: an incident record, and a
      way to be told without coming back to look.

      What is deliberately absent is an uptime percentage. The probe history holds twenty stored
      runs of a check that does not carry a document through the pipeline, and a 30- or 90-day
      figure computed from that would be a number about the prober rather than about the service.
      The run window is already stated above in the terms it can actually support.

      The subscribe path is the feed that already exists and already resolves, plus the address a
      person reads. Neither is a new promise: an announcement list nobody has built would be.
    */}
    <h3>Incident history</h3>
    <p>
      No incident has been recorded since {DAY.format(new Date(`${RECORD_STARTS}T00:00:00+09:00`))},
      the first release recorded in the changelog. When one occurs it is published here with what
      happened, what it affected and what changed afterwards, and it stays published. What is
      published is a customer-facing record: never a log location, a request id, a digest or
      another customer&rsquo;s name.
    </p>
    <p>
      This page is served by the same deployment it reports on, so an outage that takes the site
      down takes this page with it. That is why the line above asks you to report what you are
      seeing rather than wait for it to appear here.
    </p>

    <h3>Getting told without coming back</h3>
    <p>
      Releases and the changes that come with them are published on the{" "}
      <Link href={"/changelog" as Route}>changelog</Link>, which has an{" "}
      <a href="/changelog/feed.xml">Atom feed</a> any reader can subscribe to. For an incident
      affecting your workspace, email support@tavonel.com and you will be replied to directly;
      there is no announcement list, and saying otherwise would be describing one that does not
      exist.
    </p>

    <h3>Incident contact</h3><p>Report service impact to support@tavonel.com and security issues to security@tavonel.com. Do not include document contents in email.</p>
    {/* The support target, imported rather than written: /contact prints the same constant. */}
    <p>{SUPPORT_ACKNOWLEDGEMENT}</p>
  </PolicyLayout>;
}
