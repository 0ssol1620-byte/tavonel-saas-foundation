import { describe, expect, it, vi } from "vitest";
import { assertPublicResolution, assertSafeUrl, isRefusedIPv4, isRefusedIPv6, safeFetch } from "./safe-url";

/*
  Blueprint 2026-09-08 §38's hostile-URL table, run against the policy that is supposed to refuse
  it (S-71).

  The table is written as data rather than as prose because the interesting failure of an SSRF
  guard is never the case somebody thought of -- it is the spelling of 127.0.0.1 nobody thought
  of. Every row below is a real spelling seen in the wild, and the ones that look redundant
  (2130706433, 0x7f.0.0.1, [::ffff:127.0.0.1]) are the ones a hand-written check misses, because
  the WHATWG parser has already turned them into something else by the time the check runs.
*/

const OPEN: Parameters<typeof assertSafeUrl>[1] = {};

const HOSTILE: Array<[string, string, string]> = [
  ["the AWS/GCP metadata address", "https://169.254.169.254/latest/meta-data/", "EGRESS_ADDRESS_REFUSED"],
  ["metadata by decimal integer", "https://2852039166/latest/meta-data/", "EGRESS_ADDRESS_REFUSED"],
  ["loopback by name", "https://localhost/admin", "EGRESS_ADDRESS_REFUSED"],
  ["loopback by a subdomain of localhost", "https://api.localhost/admin", "EGRESS_ADDRESS_REFUSED"],
  ["loopback by address", "https://127.0.0.1/admin", "EGRESS_ADDRESS_REFUSED"],
  ["loopback by decimal integer", "https://2130706433/admin", "EGRESS_ADDRESS_REFUSED"],
  ["loopback by hexadecimal", "https://0x7f.0.0.1/admin", "EGRESS_ADDRESS_REFUSED"],
  ["loopback anywhere in 127/8", "https://127.99.12.3/admin", "EGRESS_ADDRESS_REFUSED"],
  ["the all-zeroes address", "https://0.0.0.0/", "EGRESS_ADDRESS_REFUSED"],
  ["RFC1918 class A", "https://10.1.2.3/internal", "EGRESS_ADDRESS_REFUSED"],
  ["RFC1918 class B", "https://172.16.5.9/internal", "EGRESS_ADDRESS_REFUSED"],
  ["RFC1918 class B upper bound", "https://172.31.255.255/internal", "EGRESS_ADDRESS_REFUSED"],
  ["RFC1918 class C", "https://192.168.0.10/internal", "EGRESS_ADDRESS_REFUSED"],
  ["carrier-grade NAT", "https://100.64.0.1/internal", "EGRESS_ADDRESS_REFUSED"],
  ["IPv6 loopback", "https://[::1]/admin", "EGRESS_ADDRESS_REFUSED"],
  ["IPv6 unspecified", "https://[::]/admin", "EGRESS_ADDRESS_REFUSED"],
  ["IPv6 link-local", "https://[fe80::1]/admin", "EGRESS_ADDRESS_REFUSED"],
  ["IPv6 unique-local", "https://[fd00::1]/admin", "EGRESS_ADDRESS_REFUSED"],
  ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/admin", "EGRESS_ADDRESS_REFUSED"],
  ["multicast", "https://239.255.255.250/", "EGRESS_ADDRESS_REFUSED"],
  ["plain http", "http://example.com/", "EGRESS_SCHEME_REFUSED"],
  ["a file URL", "file:///etc/passwd", "EGRESS_SCHEME_REFUSED"],
  ["a gopher URL", "gopher://example.com/", "EGRESS_SCHEME_REFUSED"],
  ["a data URL", "data:text/plain,hello", "EGRESS_SCHEME_REFUSED"],
  ["credentials smuggled into the authority", "https://graph.microsoft.com@attacker.test/v1.0/x", "EGRESS_CREDENTIALS_IN_URL"],
  ["an explicit non-default port", "https://example.com:8080/", "EGRESS_PORT_REFUSED"],
  ["the SSH port", "https://example.com:22/", "EGRESS_PORT_REFUSED"],
  ["nothing at all", "", "EGRESS_URL_MALFORMED"],
  ["a bare path", "/v1.0/me/drive", "EGRESS_URL_MALFORMED"],
  ["a protocol-relative URL", "//169.254.169.254/latest", "EGRESS_URL_MALFORMED"],
];

describe("the hostile-URL table", () => {
  it.each(HOSTILE)("refuses %s", (_name, url, code) => {
    expect(assertSafeUrl(url, OPEN)).toEqual({ ok: false, code });
  });

  it("still allows an ordinary public https URL", () => {
    const result = assertSafeUrl("https://graph.microsoft.com/v1.0/me/drive/root/delta", OPEN);
    expect(result.ok).toBe(true);
  });

  it("refuses a URL longer than the policy allows before parsing it", () => {
    const long = `https://example.com/${"a".repeat(5_000)}`;
    expect(assertSafeUrl(long, { maxUrlLength: 4_096 })).toEqual({ ok: false, code: "EGRESS_URL_TOO_LONG" });
  });

  it("refuses a value that is not a string at all", () => {
    expect(assertSafeUrl(null, OPEN)).toEqual({ ok: false, code: "EGRESS_URL_MALFORMED" });
    expect(assertSafeUrl({ toString: () => "https://example.com/" }, OPEN))
      .toEqual({ ok: false, code: "EGRESS_URL_MALFORMED" });
  });
});

describe("the origin pin", () => {
  const policy = { origins: ["https://graph.microsoft.com"], pathPrefix: "/v1.0/" };

  it("accepts the pinned origin under the pinned prefix", () => {
    expect(assertSafeUrl("https://graph.microsoft.com/v1.0/me/drive", policy).ok).toBe(true);
  });

  it("refuses a look-alike host that merely ends with the pinned one", () => {
    expect(assertSafeUrl("https://evil-graph.microsoft.com.attacker.test/v1.0/me", policy))
      .toEqual({ ok: false, code: "EGRESS_ORIGIN_REFUSED" });
  });

  it("refuses the pinned origin outside the pinned path prefix", () => {
    expect(assertSafeUrl("https://graph.microsoft.com/beta/me/drive", policy))
      .toEqual({ ok: false, code: "EGRESS_PATH_REFUSED" });
  });

  it("checks the address before the origin, so a pin can never re-admit a refused address", () => {
    expect(assertSafeUrl("https://127.0.0.1/v1.0/me", { origins: ["https://127.0.0.1"] }))
      .toEqual({ ok: false, code: "EGRESS_ADDRESS_REFUSED" });
  });
});

describe("resolve-then-validate", () => {
  it("refuses a public name that resolves to a loopback address", async () => {
    const resolver = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicResolution("rebind.attacker.test", resolver))
      .resolves.toEqual({ ok: false, code: "EGRESS_ADDRESS_REFUSED" });
  });

  it("refuses when any one answer is private, not only when all of them are", async () => {
    const resolver = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    await expect(assertPublicResolution("mixed.attacker.test", resolver))
      .resolves.toEqual({ ok: false, code: "EGRESS_ADDRESS_REFUSED" });
  });

  it("refuses an IPv6 answer outside global unicast", async () => {
    const resolver = vi.fn(async () => [{ address: "fe80::1", family: 6 }]);
    await expect(assertPublicResolution("v6.attacker.test", resolver))
      .resolves.toEqual({ ok: false, code: "EGRESS_ADDRESS_REFUSED" });
  });

  it("fails closed when the name does not resolve, rather than proceeding", async () => {
    const resolver = vi.fn(async () => { throw new Error("ENOTFOUND"); });
    await expect(assertPublicResolution("nowhere.attacker.test", resolver))
      .resolves.toEqual({ ok: false, code: "EGRESS_HOST_UNRESOLVED" });
  });

  it("fails closed on an empty answer", async () => {
    const resolver = vi.fn(async () => []);
    await expect(assertPublicResolution("empty.attacker.test", resolver))
      .resolves.toEqual({ ok: false, code: "EGRESS_HOST_UNRESOLVED" });
  });

  it("allows a name that resolves only to public addresses", async () => {
    const resolver = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800::1", family: 6 }]);
    await expect(assertPublicResolution("example.com", resolver)).resolves.toEqual({ ok: true });
  });
});

describe("safeFetch", () => {
  const pinned = { origins: ["https://api.example.com"] };

  it("revalidates a redirect instead of following it", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      if (String(url).startsWith("https://api.example.com")) {
        return new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data/" } });
      }
      return Response.json({ secret: "leaked" });
    });
    const result = await safeFetch("https://api.example.com/v1/list", {}, pinned, fetcher as never);
    expect(result).toEqual({ ok: false, code: "EGRESS_REDIRECT_REFUSED" });
    // The second request was never made: the refusal happened before the fetcher was called again.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to another public origin when the origin is pinned", async () => {
    const fetcher = vi.fn(async () =>
      new Response(null, { status: 301, headers: { location: "https://exfil.attacker.test/collect" } }));
    await expect(safeFetch("https://api.example.com/v1/list", {}, pinned, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_REDIRECT_REFUSED" });
  });

  it("gives up after the redirect hop limit rather than looping", async () => {
    const fetcher = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://api.example.com/v1/again" } }));
    await expect(safeFetch("https://api.example.com/v1/list", {}, { ...pinned, maxRedirects: 2 }, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_REDIRECT_REFUSED" });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refuses a redirect that names no destination", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(safeFetch("https://api.example.com/v1/list", {}, pinned, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_REDIRECT_REFUSED" });
  });

  it("refuses a body larger than the ceiling even when Content-Length lies about it", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(4_096), { headers: { "content-length": "3" } }));
    await expect(safeFetch("https://api.example.com/v1/list", {}, { ...pinned, maxResponseBytes: 1_024 }, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_RESPONSE_TOO_LARGE" });
  });

  it("refuses early on an honest oversized Content-Length", async () => {
    const fetcher = vi.fn(async () => new Response("body", { headers: { "content-length": "99999999" } }));
    await expect(safeFetch("https://api.example.com/v1/list", {}, { ...pinned, maxResponseBytes: 1_024 }, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_RESPONSE_TOO_LARGE" });
  });

  it("turns a transport failure into a refusal rather than an exception", async () => {
    const fetcher = vi.fn(async () => { throw new Error("ECONNRESET"); });
    await expect(safeFetch("https://api.example.com/v1/list", {}, pinned, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_REQUEST_FAILED" });
  });

  it("returns the body when everything holds", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const result = await safeFetch("https://api.example.com/v1/list", {}, pinned, fetcher as never);
    expect(result).toMatchObject({ ok: true, status: 200, text: '{"ok":true}' });
  });

  it("never reaches the network when the first URL is already refused", async () => {
    const fetcher = vi.fn(async () => Response.json({}));
    await expect(safeFetch("https://169.254.169.254/latest", {}, {}, fetcher as never))
      .resolves.toEqual({ ok: false, code: "EGRESS_ADDRESS_REFUSED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("the address predicates on their own", () => {
  it("treats a hostname that is not an address as not an address", () => {
    expect(isRefusedIPv4("graph.microsoft.com")).toBe(false);
    expect(isRefusedIPv4("127.0.0.1.attacker.test")).toBe(false);
  });

  it("refuses an octet out of range rather than reading it as a name", () => {
    expect(isRefusedIPv4("999.1.1.1")).toBe(true);
  });

  it("admits only global unicast IPv6", () => {
    expect(isRefusedIPv6("2606:4700:4700::1111")).toBe(false);
    expect(isRefusedIPv6("[2606:4700::1]")).toBe(false);
    expect(isRefusedIPv6("::1")).toBe(true);
    expect(isRefusedIPv6("ff02::1")).toBe(true);
    expect(isRefusedIPv6("fc00::1")).toBe(true);
  });
});
