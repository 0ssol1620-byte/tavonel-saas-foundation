import { gzipSync } from "node:zlib";
import { publicCorpusIdsSha256, readPublicCorpus } from "@/lib/v34/public-corpus";
import { renderStaticSvg } from "@/lib/v34/world-geometry";

/*
  The static overview of the public reference corpus: the pre-hydration image of the home hero and
  /world, and the last fallback when neither WebGL nor Canvas2D is available. Drawn from the same
  layout and projection as the two live renderers, so all 567 records and 1,513 relationships are
  in it. Rendered from the hash-verified corpus; nothing is typed in.

  It is the home page's LCP element, and `next start` does not compress app-route responses
  (WO-CI-1: 195,532 B on the wire, ~20 KB gzipped). So the handler renders once per server, keeps a
  gzip copy beside it, and negotiates. It is not `force-static`: a prerendered response cannot see
  the request's Accept-Encoding and is served uncompressed. The Cache-Control value is the one the
  prerender carried. Only gzip is offered; a header that does not plainly accept gzip gets identity.
*/

let memo: { identity: Uint8Array<ArrayBuffer>; gzip: Uint8Array<ArrayBuffer> } | null = null;

function bodies() {
  if (memo) return memo;
  const corpus = readPublicCorpus();
  const identity = new TextEncoder().encode(renderStaticSvg(corpus, { idsSha: publicCorpusIdsSha256(corpus) }));
  memo = { identity, gzip: new Uint8Array(gzipSync(identity)) };
  return memo;
}

const QVALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/*
  True only when the header names `gzip` and every `gzip` entry carries no qvalue or a well-formed,
  non-zero one (RFC 9110 §12.4.2, §12.5.3). A malformed qvalue, or a `gzip` that is also refused,
  means identity. `*` is not read as gzip. Not exported: a route module may export only handlers
  and route config.
*/
function acceptsGzip(header: string | null): boolean {
  if (!header) return false;
  let accepted = false;
  for (const entry of header.split(",")) {
    const [coding, ...params] = entry.split(";").map((part) => part.trim());
    if (coding?.toLowerCase() !== "gzip") continue;
    const q = params.find((param) => /^q\s*=/i.test(param));
    if (q !== undefined) {
      const value = q.slice(q.indexOf("=") + 1).trim();
      if (!QVALUE.test(value) || Number(value) === 0) return false;
    }
    accepted = true;
  }
  return accepted;
}

export function GET(request: Request) {
  const { identity, gzip } = bodies();
  const gzipped = acceptsGzip(request.headers.get("accept-encoding"));
  const body = gzipped ? gzip : identity;
  const headers: Record<string, string> = {
    "content-type": "image/svg+xml",
    "cache-control": "s-maxage=31536000",
    vary: "Accept-Encoding",
    "content-length": String(body.byteLength),
  };
  if (gzipped) headers["content-encoding"] = "gzip";
  return new Response(body, { headers });
}
