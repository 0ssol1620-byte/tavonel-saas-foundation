"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import styles from "./api-try-it.module.css";

/*
  A try-it, bounded to the three routes that take no credential (G3-008).

  The audit's finding was "no interactive API reference and no try-it anywhere", and the obvious
  answer -- a console with a key field -- is the wrong one. A key field on a public page is a
  credential-handling surface: it invites a live key to be pasted into a browser tab, kept in
  component state, and probably into localStorage the first time somebody finds retyping it
  annoying. Building that to demonstrate an API is a poor trade.

  These three carry no tenant, no document and no credential, and between them they answer the
  three questions an evaluator asks before writing any code: what can this deployment read, what
  is actually open here, and what does an answer look like. Same-origin fetch, so there is no CORS
  story and no proxy: the page is served from the origin it is calling.

  What it deliberately does not do: no request builder, no parameter editor, no history, no
  saved state. It is a GET and a <pre>. A reader who wants to change the request has curl, and
  the curl is on the page above it.
*/

export type TryItRoute = { path: string; label: string; note: string };

type Result = { status: number; ms: number; body: string; digest: string | null } | { error: string };

export function ApiTryIt({ routes }: { routes: TryItRoute[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});

  async function run(path: string) {
    setActive(path);
    setPending(path);
    const started = performance.now();
    try {
      const response = await fetch(path, { headers: { accept: "application/json" } });
      const text = await response.text();
      let body = text;
      try {
        // Pretty-print where it is JSON; show it verbatim where it is not, rather than
        // reporting a parse failure the reader cannot act on.
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* Not JSON. The raw body is the honest thing to show. */
      }
      setResults((current) => ({
        ...current,
        [path]: {
          status: response.status,
          ms: Math.round(performance.now() - started),
          // Long payloads are truncated with the fact stated, never silently.
          body: body.length > 4000 ? `${body.slice(0, 4000)}\n\n… truncated at 4,000 characters. Fetch the URL for the whole body.` : body,
          digest: response.headers.get("content-digest"),
        },
      }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [path]: { error: error instanceof Error ? error.message : "The request did not complete." },
      }));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className={styles.tryIt} aria-labelledby="try-it-heading">
      <h2 id="try-it-heading" className={styles.heading}>Try it, with no key</h2>
      <p className={styles.lede}>
        Three unauthenticated reads, run from this page against this deployment. No signup, no
        credential, nothing that spends. The same three are a copy-pasteable curl recipe on{" "}
        <Link href={"/docs/integration-recipes" as Route}>Integration recipes</Link>.
      </p>
      <ul className={styles.routes}>
        {routes.map((route) => {
          const result = results[route.path];
          const open = active === route.path;
          return (
            <li key={route.path} className={styles.route}>
              <div className={styles.row}>
                <div>
                  <p className={styles.label}>{route.label}</p>
                  <code className={styles.path}>GET {route.path}</code>
                </div>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => run(route.path)}
                  disabled={pending === route.path}
                  aria-expanded={open}
                >
                  {pending === route.path ? "Running…" : result ? "Run again" : "Run"}
                </button>
              </div>
              <p className={styles.note}>{route.note}</p>
              {/*
                BQ-137. The live region is the one-line outcome, not the response body.

                `role="status"` was on the whole result block, and that block holds up to
                4,000 characters of JSON in a <pre>. A screen reader announced the entire
                body on every run, uninterruptibly, for a control whose news is "200, 143
                ms". The region is also mounted from the start rather than inserted with the
                result: a live region that appears at the same moment as its content is not
                reliably announced at all, which is the other half of the same bug.
              */}
              <p className={styles.announce} role="status">{announcement(route.label, pending === route.path, result)}</p>
              {result ? (
                <div className={styles.result}>
                  {"error" in result ? (
                    <p className={styles.failed}>The request did not complete: {result.error}</p>
                  ) : (
                    <>
                      <p className={styles.status}>
                        <code data-kind={result.status < 400 ? "ok" : "error"}>{result.status}</code>
                        <span>{result.ms} ms</span>
                        {result.digest ? <span className={styles.digest}>{result.digest}</span> : null}
                      </p>
                      <pre><code>{result.body}</code></pre>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What a run is worth saying out loud: the outcome, never the body it returned. */
function announcement(label: string, running: boolean, result: Result | undefined) {
  if (running) return `${label}: running.`;
  if (!result) return "";
  if ("error" in result) return `${label}: the request did not complete.`;
  return `${label}: ${result.status} in ${result.ms} ms.`;
}
