"use client";

import { useState } from "react";
import type { DigestCheck, KeylessRead } from "@/lib/keyless-read";
/*
  Why this file is in components/ and not components/docs/ (EN-FIX-1).

  Next orders a page's client imports by path, so the stylesheet of an island under components/docs/
  sorts after components/docs-search.tsx's. On /docs/quickstart that put this stylesheet second
  where /api and /developers have it first, and Next's loose CSS chunking, which starts its shared
  chunk from the module with the lowest summed position, then started it elsewhere: across the site
  pages loaded more stylesheets, /explore nine instead of main's seven, and /explore's Lighthouse LCP
  went over budget (3,095 ms against 3,000). Here it sorts first on all three mounts, as on main.
*/
import styles from "./docs/api-try-it.module.css";

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
  saved state. It is a GET and a <pre>. The heading, the copy and the terminal recipes around it
  are server-rendered by `keyless-try-it.tsx`, which is the one thing every page mounts, so this
  island carries only what has to run in the browser.

  EN-4. Each run now checks the response's own `Content-Digest` over the bytes received
  (`lib/keyless-read.ts`), and shows one of three outcomes. A mismatch withholds the body: bytes
  that are not the bytes the header describes are not shown as if they were an answer.
*/

export type TryItRoute = { path: string; label: string; note: string };

export function ApiTryIt({ routes }: { routes: readonly TryItRoute[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, KeylessRead>>({});

  async function run(path: string) {
    setActive(path);
    setPending(path);
    let result: KeylessRead;
    try {
      // Loaded on the first Run rather than with the page: the §22 script budget.
      const { runKeylessRead } = await import("@/lib/keyless-read");
      result = await runKeylessRead(path);
    } catch {
      result = { error: "the check itself did not load. Reload the page and run it again." };
    }
    setResults((current) => ({ ...current, [path]: result }));
    setPending(null);
  }

  return (
    <ul className={styles.routes}>
      {routes.map((route) => {
        const result = results[route.path];
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
                aria-expanded={active === route.path}
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
            {result ? <ReadResult result={result} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** One finished run. Exported for the render test of the three digest outcomes. */
export function ReadResult({ result }: { result: KeylessRead }) {
  if ("error" in result) {
    return (
      <div className={styles.result}>
        <p className={styles.failed}>The request did not complete: {result.error}</p>
      </div>
    );
  }
  return (
    <div className={styles.result}>
      <p className={styles.status}>
        <code data-kind={result.status < 400 ? "ok" : "error"}>{result.status}</code>
        <span>{result.ms} ms</span>
        <span>{result.bytes.toLocaleString("en-US")} bytes</span>
      </p>
      <Digest check={result.digest} bytes={result.bytes} />
      {result.digest.state === "mismatch" ? null : <pre><code>{result.body}</code></pre>}
    </div>
  );
}

function Digest({ check, bytes }: { check: DigestCheck; bytes: number }) {
  if (check.state === "match") {
    return (
      <p className={styles.digest} data-digest="match">
        Content-Digest matches the {bytes.toLocaleString("en-US")} bytes received:{" "}
        <code>{check.value}</code>
      </p>
    );
  }
  if (check.state === "absent") {
    return (
      <p className={styles.digest} data-digest="absent">
        No Content-Digest header on this response, so its bytes have nothing to be checked against.
      </p>
    );
  }
  return (
    <div className={styles.digest} data-digest="mismatch">
      <p>
        <strong>Content-Digest does not match these bytes.</strong> The body is withheld, because
        it is not the body the header describes.
      </p>
      <p>Served <code>{check.served}</code></p>
      <p>Computed <code>{check.computed}</code></p>
    </div>
  );
}

const DIGEST_SAID = { match: "digest matches", mismatch: "digest does not match", absent: "no digest header" } as const;

/** What a run is worth saying out loud: the outcome, never the body it returned. */
function announcement(label: string, running: boolean, result: KeylessRead | undefined) {
  if (running) return `${label}: running.`;
  if (!result) return "";
  if ("error" in result) return `${label}: the request did not complete.`;
  return `${label}: ${result.status} in ${result.ms} ms, ${DIGEST_SAID[result.digest.state]}.`;
}
