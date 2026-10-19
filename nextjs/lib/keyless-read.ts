/*
  One keyless GET, and the check its bytes can carry (EN-4).

  A response that sends `Content-Digest: sha-256=:<base64>:` has said what its own bytes hash to.
  This recomputes that hash over the bytes the browser received, with WebCrypto, and reports one
  of exactly three things: the header matches, the header does not match, or there is no header to
  check against. The comparison is the one the published recipe scripts make --
  `public/developer/tavonel-public-sample.py` and `tavonel-recipe-smoke.mjs` -- an exact match of
  the trimmed header against `sha-256=:<base64 of SHA-256(body)>:`. A header naming only another
  algorithm is a mismatch, not a pass, because this page cannot check it.

  It is loaded by `components/docs/api-try-it.tsx` on the first Run, not with the page, so the
  three routes that never press Run do not carry it (the §22 script budget).
*/

export type DigestCheck =
  | { state: "match"; value: string }
  | { state: "mismatch"; served: string; computed: string }
  | { state: "absent" };

export type KeylessRead =
  | { status: number; ms: number; bytes: number; body: string; digest: DigestCheck }
  | { error: string };

const BODY_LIMIT = 4_000;

export async function checkContentDigest(bytes: BufferSource, header: string | null): Promise<DigestCheck> {
  const served = header?.trim();
  if (!served) return { state: "absent" };
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const computed = `sha-256=:${btoa(String.fromCharCode(...hash))}:`;
  return computed === served ? { state: "match", value: computed } : { state: "mismatch", served, computed };
}

export async function runKeylessRead(path: string, fetchImpl: typeof fetch = fetch): Promise<KeylessRead> {
  const started = performance.now();
  try {
    const response = await fetchImpl(path, { headers: { accept: "application/json" } });
    // The bytes, not `text()`: a decoded and re-encoded string is not what the header describes.
    const bytes = await response.arrayBuffer();
    const ms = Math.round(performance.now() - started);
    const digest = await checkContentDigest(bytes, response.headers.get("content-digest"));
    let body = new TextDecoder().decode(bytes);
    try {
      // Pretty-printed where it is JSON; verbatim where it is not, rather than a parse failure.
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* Not JSON. The raw body is the honest thing to show. */
    }
    if (body.length > BODY_LIMIT) {
      // Long payloads are truncated with the fact stated, never silently.
      body = `${body.slice(0, BODY_LIMIT)}\n\n… truncated at 4,000 characters. Fetch the URL for the whole body.`;
    }
    return { status: response.status, ms, bytes: bytes.byteLength, body, digest };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The request did not complete." };
  }
}
