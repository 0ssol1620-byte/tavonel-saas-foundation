import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { PublicPageShell } from "@/components/public-page-shell";
import { DocsCopyButton } from "@/components/docs-copy-button";
import { DocsSnippet } from "@/components/docs-snippet";
import { ApiTryIt, type TryItRoute } from "@/components/docs/api-try-it";
import { withMarks } from "@/components/docs/marks";
import { CodeTokens } from "@/components/docs/code-tokens";
import { PageToc, tocEntries } from "@/components/docs/page-toc";
import { API_VERSION } from "@/lib/api-version";
import { readApiReference, type ReferenceEndpoint } from "@/lib/api-reference";
import { snippetFor, SNIPPET_LANGUAGES } from "@/lib/docs-endpoints";
import styles from "@/components/docs/api-reference.module.css";

/*
  BA-184 retired this route to a 308, because what stood here was a stub: a hero, four one-line
  tiles, one curl command and two buttons, linked from the primary nav, the footer and
  /developers as "API reference". Growing a stub into a second reference would have produced two
  things to keep in step with one contract, so it was retired instead.

  G3-004 and G3-008 are the other half of that argument, and they change the answer. The
  objection was never "a reference page is wrong" -- it was "a hand-written second reference is
  wrong". This page is generated: every operation, parameter, schema, example and error code
  below is read out of /api/openapi in the same process, through the same route handler
  `lib/docs-endpoints.ts` already calls. There is no second copy to go stale, and
  `lib/openapi-completeness.test.ts` fails the build if the contract stops carrying what this
  page renders.

  Why not Scalar, Redoc or Stoplight: each is a dependency measured in hundreds of kilobytes of
  client JavaScript for a page whose content is static, and the script budget is a measurement
  rather than a number to raise. Plain React over the parsed JSON renders on the server, ships
  almost nothing, and inherits the site's own type and colour instead of arriving with its own.

  The try-it is deliberately small: the three routes that take no key. A console that asks a
  reader to paste a live credential into a public page is a credential-handling surface, and
  building one to demonstrate an API is a poor trade. These three prove the thing an evaluator
  actually wants proven -- that the deployment answers, and what it says about itself.
*/

export const metadata: Metadata = {
  title: "API reference — TAVONEL",
  description: "Every operation in the TAVONEL API, generated from the published OpenAPI contract: parameters, request and response schemas, examples, and the error codes each one returns.",
  alternates: { canonical: "/api" },
  openGraph: { url: "/api" },
};

/*
  The unauthenticated routes, and nothing else.

  Each is a GET carrying no tenant, no document and no credential, which is why it can be called
  from a browser at all. /reproducibility/sample-world is included because it is the one that
  shows the shape of an answer -- object, evidence, source version, page, region -- without
  anyone having compiled anything.
*/
const TRY_IT: TryItRoute[] = [
  {
    path: "/api/v1/capabilities",
    label: "What this deployment can read",
    note: "The same list the upload route validates against. A format absent from it is refused at upload rather than accepted and dropped.",
  },
  {
    path: "/api/status",
    label: "What is open right now",
    note: "The deployment's own state, including whether compiling your own files is open here.",
  },
  {
    path: "/reproducibility/sample-world",
    label: "The shape of an answer",
    note: "A deterministic product fixture, unsigned and labelled as such in its own disclosure field. Build against the shape; do not judge extraction from it.",
  },
];

const LANGUAGE_LABELS = { curl: "cURL", python: "Python", typescript: "TypeScript" } as const;

function Operation({ endpoint }: { endpoint: ReferenceEndpoint }) {
  return (
    <article className={styles.operation} id={endpoint.operationId}>
      <header className={styles.signature}>
        <b data-method={endpoint.method}>{endpoint.method}</b>
        <code>{endpoint.path}</code>
        {endpoint.scope
          ? <em>Scope <code>{endpoint.scope}</code></em>
          : <em>{endpoint.auth === "session" ? "Browser session only" : "No key required"}</em>}
      </header>
      <h3 className={styles.summary}>{endpoint.summary}</h3>
      {endpoint.description ? <p className={styles.prose}>{withMarks(endpoint.description)}</p> : null}

      {endpoint.parameters.length > 0 ? (
        <>
          <p className={styles.label}>Parameters</p>
          <div className="table-scroll">
          <table className="docs-table">
            <thead><tr><th>Name</th><th>In</th><th>Required</th><th>Shape</th></tr></thead>
            <tbody>
              {endpoint.parameters.map((parameter) => (
                <tr key={`${parameter.in}-${parameter.name}`}>
                  <td data-label="Name"><code>{parameter.name}</code></td>
                  <td data-label="In">{parameter.in}</td>
                  <td data-label="Required">{parameter.required ? "yes" : "no"}</td>
                  <td data-label="Shape">
                    <code>{parameter.shape}</code>
                    {parameter.description ? <> {withMarks(parameter.description)}</> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : null}

      {/*
        pages-24. The reference stays one page; the examples stop being unskippable.

        All 33 operations rendered every request snippet in three languages and every response
        body open at once: 81,960px tall at 1440, 100,576 CSS px at 412 -- about 110 phone screens
        -- 282 `<pre>` blocks and 7,161 DOM nodes, all painted, with the in-page index as the only
        way through. What a reader scans is the signature, the summary, the parameters and the
        status codes; the payloads are what they open when they have found the operation they
        came for. So the reference content stays in place and visible, and only the examples go
        behind a disclosure.

        The `id` stays on the `<article>`, not inside a `<details>`: an index link lands on the
        operation's own header, which is never collapsed, so every anchor still arrives somewhere
        legible whatever the browser does with a fragment inside a closed disclosure.
      */}
      <details className={styles.examples}>
        <summary className={styles.label}>Request</summary>
        <DocsSnippet
          snippets={SNIPPET_LANGUAGES.map((language) => ({
            language,
            label: LANGUAGE_LABELS[language],
            body: snippetFor(endpoint, language),
          }))}
        />
      </details>

      <p className={styles.label}>Responses</p>
      {endpoint.responses.map((response) => (
        <div className={styles.response} key={response.status}>
          <p className={styles.status}>
            <code data-kind={response.status.startsWith("2") ? "ok" : "error"}>{response.status}</code>
            <span>{withMarks(response.description)}</span>
          </p>
          {response.codes.length > 0 ? (
            <p className={styles.codes}>
              {response.codes.map((code) => <code key={code}>{code}</code>)}
            </p>
          ) : null}
          {response.example ? (
            <details className={styles.examples}>
              <summary className={styles.label}>Example response</summary>
              <figure className="docs-code">
                {/* The caption names the status rather than repeating the summary above it. */}
                <figcaption><span>{response.status}</span><DocsCopyButton value={response.example} /></figcaption>
                <pre tabIndex={0} role="group" aria-label={`Example ${response.status} response`}><code><CodeTokens body={response.example} /></code></pre>
              </figure>
            </details>
          ) : null}
          {response.bestEffort ? (
            <p className="fine">
              This schema names the fields a caller can rely on and is not closed. The handler
              composes the payload from a store row the contract does not own, so listing every
              field here would be transcribing a shape that can move — it is marked{" "}
              <code>x-tavonel-status: best-effort</code> in the document rather than closed on
              fields nobody verified.
            </p>
          ) : null}
        </div>
      ))}
    </article>
  );
}

export default async function ApiReferencePage() {
  const reference = await readApiReference();

  /*
    BQ-100 / BQ-101. The group list is what goes beside the heading on a reference route.

    Two things turn on it. The decision splits `.body` by surface -- a reference route puts
    navigation in the title column, every other route collapses to one measure -- and the collapse
    in `app/product-polish.css` is written as the condition (an H1 alone in that column), so this
    list is both the navigation the decision asks for and what keeps the rule off this page. That
    matters more here than anywhere: `styles.full` spans `1 / -1`, so a collapsed grid would take
    thirty-three operation groups, their parameter tables and their request examples down to one
    72ch column.

    The groups also get ids from the same list, which is the "heading ids and a generated TOC"
    half of BQ-101. The per-endpoint index below stays where it is: it is one entry per operation
    and it needs the full width, which is the column it is already in.
  */
  const groups = tocEntries(reference.groups.map((group) => group.name));

  return (
    <PublicPageShell>
      <section className="scene doc"><div className="shell"><div className="body">
        <div className="stack">
          <h1 className="document-title">Every operation, from the contract itself.</h1>
          <PageToc entries={groups} />
        </div>
        <div className="stack">
          <p className="lede">
            {reference.operationCount} operations in {reference.groups.length} groups, rendered
            from the OpenAPI document this deployment serves at{" "}
            <a href="/api/openapi">/api/openapi</a>. Nothing here is written beside the contract:
            if an operation is on this page, the contract publishes it, and a build where the two
            disagree does not ship.
          </p>

          <p className="fine">
            Base URL <code>{reference.server}</code>. The compile routes carry their own,{" "}
            <code>{reference.unversionedServer}</code>, declared per path in the document so a
            generated client resolves each operation against the right one. Send a key as{" "}
            <code>Authorization: Bearer tvnl_live_…</code>; keys are created in the workspace
            under Developers and the plaintext is shown once. Activation and rollback are absent
            from this page because they are absent from the contract — they are browser-session
            decisions, and no scope grants them.
          </p>

        </div>

        {/*
          The reference itself is a third grid child spanning both columns.

          `.body` is the two-column editorial grid every document page uses: a title rail and a
          reading column. That composition is right for a page that is an argument, and wrong for
          one that is eighty thousand pixels of operation-by-operation reference — it would leave
          a 480px rail empty for the whole scroll, and squeeze every request example, parameter
          table and response body into 800px to do it. The header keeps the composition; below it
          the reference spends the width.
        */}
        <div className={styles.full}>
          <ApiTryIt routes={TRY_IT} />

          <nav className={styles.index} aria-label="Operations by group">
            {reference.groups.map((group) => (
              <div key={group.name}>
                <p className={styles.groupName}>{group.name}</p>
                <ul>
                  {group.endpoints.map((endpoint) => (
                    <li key={endpoint.operationId}>
                      <a className={styles.indexLink} href={`#${endpoint.operationId}`}>
                        <b data-method={endpoint.method}>{endpoint.method}</b>
                        <span>{endpoint.summary}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          {reference.groups.map((group, index) => (
            <div className={styles.group} key={group.name}>
              <h2 id={groups[index].id}>{group.name}</h2>
              <p className={styles.prose}>{group.description}</p>
              {group.endpoints.map((endpoint) => (
                <Operation endpoint={endpoint} key={endpoint.operationId} />
              ))}
            </div>
          ))}

          <h2>Error codes</h2>
          <p className={styles.prose}>
            Every failure carries a stable machine code alongside the status. Branch on the code:
            the status says what kind of problem it is, and the code says which one. Each response
            above names the codes it can carry; the full catalogue, with what to do about every
            one of them, is on <Link href={"/docs/errors" as Route}>the Errors page</Link> and in
            the contract under <code>x-tavonel-error-catalogue</code>.
          </p>

          <p className="fine">
            Concepts, worked flows and the quickstart are in{" "}
            <Link href="/docs">the documentation</Link>; this page is the operation-by-operation
            reference. API version {API_VERSION} · support window and deprecation policy on{" "}
            <Link href={"/docs/changelog" as Route}>Versioning and changes</Link>.
          </p>
        </div>
      </div></div></section>
    </PublicPageShell>
  );
}
