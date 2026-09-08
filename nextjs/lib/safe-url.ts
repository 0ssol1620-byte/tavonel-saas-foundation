import { lookup } from "node:dns/promises";

/*
  The central egress policy (blueprint 2026-09-08 §38, S-71).

  Before this file there was no such policy: every outbound request built its own URL and
  trusted it, and only Microsoft Graph continuations were shape-checked. That is fine while
  every destination happens to be a constant, and it is a full SSRF the first time one is not
  -- which is a change nobody would think of as a security change.

  So the check lives in one place and every external destination goes through it. Two halves,
  and the split matters:

    * `assertSafeUrl` is synchronous and is the mandatory gate. It refuses a scheme that is not
      https, credentials in the URL, a non-default port, and any host that IS an address in a
      range a public service has no business reaching -- loopback, RFC1918, link-local
      (169.254.0.0/16, which is where 169.254.169.254 lives), CGNAT, and every IPv6 outside
      global unicast. The WHATWG parser has already normalised `http://2130706433/` and
      `http://0x7f.1/` to dotted-quad by the time it is asked, so the decimal, octal and hex
      spellings of 127.0.0.1 are the same string here.

    * `assertPublicResolution` is the DNS half, and `safeFetch` applies it only when the policy
      does NOT pin origins. A pinned origin is a stronger control than resolve-then-validate:
      `graph.microsoft.com` cannot be made to mean something else by a DNS answer, because the
      answer is never consulted for authorisation. An unpinned host can, so it is resolved and
      every address it resolves to is checked before the request is made. A policy with no
      origins is not "anything allowed" -- it is "anything that resolves publicly", which is
      the weakest thing this module will do and still not the default.

  Redirects are followed here rather than by fetch, because `redirect: "follow"` revalidates
  nothing: a pinned origin that answers 302 to http://169.254.169.254/ is a pinned origin that
  reaches the metadata service. Each hop is re-checked against the same policy.
*/

export type EgressPolicy = {
  /**
   * Exact origins (scheme + host + port) this call may reach, redirects included.
   *
   * Omitted means the host is resolved and every address checked instead. It never means
   * "any origin": there is no way to switch the address checks off.
   */
  origins?: readonly string[];
  /** Required path prefix, for an API whose surface is narrower than its origin. */
  pathPrefix?: string;
  maxUrlLength?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export type EgressRefusal =
  | "EGRESS_URL_MALFORMED"
  | "EGRESS_URL_TOO_LONG"
  | "EGRESS_SCHEME_REFUSED"
  | "EGRESS_CREDENTIALS_IN_URL"
  | "EGRESS_PORT_REFUSED"
  | "EGRESS_ADDRESS_REFUSED"
  | "EGRESS_ORIGIN_REFUSED"
  | "EGRESS_PATH_REFUSED"
  | "EGRESS_HOST_UNRESOLVED"
  | "EGRESS_REDIRECT_REFUSED"
  | "EGRESS_RESPONSE_TOO_LARGE"
  | "EGRESS_REQUEST_FAILED";

export type SafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; code: EgressRefusal };

const DEFAULT_MAX_URL_LENGTH = 4_096;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * An IPv4 address no outbound request from a public service should reach.
 *
 * Everything outside `a >= 224` is a named range; `a >= 224` sweeps multicast, the reserved
 * 240/4 block and 255.255.255.255 together, none of which is a destination.
 */
export function isRefusedIPv4(host: string) {
  if (!IPV4.test(host)) return false;
  const octets = host.split(".").map(Number);
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
}

/**
 * IPv6 by allowlist rather than by blocklist: only global unicast (2000::/3) is a destination.
 *
 * A blocklist has to enumerate `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8` and every
 * IPv4-mapped spelling of a private address -- and `::ffff:127.0.0.1` reaches this function as
 * `::ffff:7f00:1`, so the enumeration has to cover the compressed hex form too. Asking the
 * opposite question is one line and cannot be under-enumerated.
 */
export function isRefusedIPv6(host: string) {
  const first = Number.parseInt(host.replace(/^\[|\]$/g, "").split(":")[0] ?? "", 16);
  return !(first >= 0x2000 && first <= 0x3fff);
}

function refusedHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[")) return isRefusedIPv6(host);
  return isRefusedIPv4(host);
}

/** The synchronous gate. Every outbound URL passes through it, redirect targets included. */
export function assertSafeUrl(value: unknown, policy: EgressPolicy = {}): SafeUrlResult {
  if (typeof value !== "string" || value.length === 0) return { ok: false, code: "EGRESS_URL_MALFORMED" };
  if (value.length > (policy.maxUrlLength ?? DEFAULT_MAX_URL_LENGTH)) return { ok: false, code: "EGRESS_URL_TOO_LONG" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: "EGRESS_URL_MALFORMED" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "EGRESS_SCHEME_REFUSED" };
  if (url.username || url.password) return { ok: false, code: "EGRESS_CREDENTIALS_IN_URL" };
  // `port` is empty for the scheme's default. Anything else is a deliberate choice, and the
  // only reason to make it against an external API is to reach something that is not that API.
  if (url.port !== "") return { ok: false, code: "EGRESS_PORT_REFUSED" };
  if (refusedHost(url.hostname)) return { ok: false, code: "EGRESS_ADDRESS_REFUSED" };
  if (policy.origins && !policy.origins.includes(url.origin)) return { ok: false, code: "EGRESS_ORIGIN_REFUSED" };
  if (policy.pathPrefix && !url.pathname.startsWith(policy.pathPrefix)) return { ok: false, code: "EGRESS_PATH_REFUSED" };
  return { ok: true, url };
}

/**
 * The DNS half: resolve the host and check every address it answers with.
 *
 * `all: true` matters. Checking one address and connecting to another is the rebinding attack
 * with an extra step, and a host that answers with a public address and a loopback address is
 * refused on the loopback one.
 */
export type HostResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<Array<{ address: string; family: number }>>;

const systemResolver = lookup as unknown as HostResolver;

export async function assertPublicResolution(
  hostname: string,
  resolver: HostResolver = systemResolver,
): Promise<{ ok: true } | { ok: false; code: EgressRefusal }> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname.replace(/^\[|\]$/g, ""), { all: true, verbatim: true });
  } catch {
    return { ok: false, code: "EGRESS_HOST_UNRESOLVED" };
  }
  if (addresses.length === 0) return { ok: false, code: "EGRESS_HOST_UNRESOLVED" };
  const refused = addresses.some(({ address, family }) =>
    family === 6 ? isRefusedIPv6(address) : isRefusedIPv4(address) || !IPV4.test(address));
  return refused ? { ok: false, code: "EGRESS_ADDRESS_REFUSED" } : { ok: true };
}

/**
 * A bounded read.
 *
 * `Content-Length` is the sender's claim, so it is used to refuse early and never to decide the
 * read is finished. The stream is counted as it arrives and the read is abandoned the moment it
 * passes the ceiling, which is the only version of this that a lying or chunked sender cannot
 * walk past.
 */
async function readBounded(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const body = response.body;
  if (!body) return await response.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

export type SafeFetchResult =
  | { ok: true; status: number; headers: Headers; text: string; url: string }
  | { ok: false; code: EgressRefusal };

/**
 * Fetch through the policy: validate, follow redirects by hand, revalidate each hop, read
 * bounded, and give up on a clock.
 *
 * The caller gets text rather than a `Response` deliberately: a returned body that has not been
 * read yet is a size ceiling nobody applied.
 */
export async function safeFetch(
  value: string,
  init: RequestInit,
  policy: EgressPolicy = {},
  fetcher: typeof fetch = fetch,
): Promise<SafeFetchResult> {
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = policy.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  let target = value;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = assertSafeUrl(target, policy);
    if (!checked.ok) return { ok: false, code: hop === 0 ? checked.code : "EGRESS_REDIRECT_REFUSED" };
    if (!policy.origins) {
      const resolved = await assertPublicResolution(checked.url.hostname);
      if (!resolved.ok) return { ok: false, code: resolved.code };
    }
    let response: Response;
    try {
      response = await fetcher(checked.url.toString(), {
        ...init,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(policy.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, code: "EGRESS_REQUEST_FAILED" };
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, code: "EGRESS_REDIRECT_REFUSED" };
      target = new URL(location, checked.url).toString();
      continue;
    }
    const text = await readBounded(response, maxResponseBytes).catch(() => null);
    if (text === null) return { ok: false, code: "EGRESS_RESPONSE_TOO_LARGE" };
    return { ok: true, status: response.status, headers: response.headers, text, url: checked.url.toString() };
  }
  return { ok: false, code: "EGRESS_REDIRECT_REFUSED" };
}
