import { describe, expect, it, vi } from "vitest";
import { cdrIdentityToken, CDR_IDENTITY_AUDIENCE } from "./cdr-workload-identity";

const config = { providerResource: "projects/317850201666/locations/global/workloadIdentityPools/cdr-pool/providers/vercel-prod",
  serviceAccount: "cdr-invoker@tavonel-saas-foundation.iam.gserviceaccount.com" };
const subject = "synthetic.subject.signature";
const exchange = { access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 300,
  issued_token_type: "urn:ietf:params:oauth:token-type:access_token" };

describe("CDR workload identity", () => {
  it("exchanges only at fixed Google endpoints and requests the exact CDR audience", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(exchange))
      .mockResolvedValueOnce(Response.json({ token: "synthetic.id.signature" }));
    expect(await cdrIdentityToken(config, subject, fetcher)).toBe("synthetic.id.signature");
    expect(fetcher.mock.calls[0][0]).toBe("https://sts.googleapis.com/v1/token");
    const first = fetcher.mock.calls[0][1]!;
    expect(first.redirect).toBe("error"); expect(first.cache).toBe("no-store");
    expect(first.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(first.body as string)).toMatchObject({ subjectToken: subject,
      audience: `//iam.googleapis.com/${config.providerResource}` });
    expect(fetcher.mock.calls[1][0]).toBe(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.serviceAccount}:generateIdToken`);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ audience: CDR_IDENTITY_AUDIENCE, includeEmail: true });
  });
  it.each([
    { ...config, providerResource: config.providerResource.replace("317850201666", "999999999999") },
    { ...config, serviceAccount: "other@other-project.iam.gserviceaccount.com" },
    { ...config, providerResource: config.providerResource + "?redirect=https://example.invalid" },
  ])("rejects out-of-project configuration before any call", async bad => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(cdrIdentityToken(bad, subject, fetcher)).rejects.toThrow("CDR_IDENTITY_CONFIG_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{}, { ...exchange, token_type: "wrong" }, { ...exchange, expires_in: 0 },
    { ...exchange, access_token: "token\r\nheader" }])("refuses malformed exchange before impersonation", async value => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(value));
    await expect(cdrIdentityToken(config, subject, fetcher)).rejects.toThrow("CDR_IDENTITY_UNAVAILABLE");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("redacts upstream errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`secret=${subject}`));
    await expect(cdrIdentityToken(config, subject, fetcher)).rejects.toThrow(/^CDR_IDENTITY_UNAVAILABLE$/);
  });
  it.each([401, 403, 500])("refuses IAM HTTP %s without exposing response text", async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(exchange))
      .mockResolvedValueOnce(new Response(`credential=${subject}`, { status }));
    await expect(cdrIdentityToken(config, subject, fetcher)).rejects.toThrow(/^CDR_IDENTITY_UNAVAILABLE$/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([null, "short", "bad\r\nheader.token.value"]) ("refuses malformed ID token %s", async token => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(exchange))
      .mockResolvedValueOnce(Response.json({ token }));
    await expect(cdrIdentityToken(config, subject, fetcher)).rejects.toThrow(/^CDR_IDENTITY_UNAVAILABLE$/);
  });
  it("cancels unbounded token output", async () => {
    let canceled = false;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(4096)); }, cancel() { canceled = true; },
    })));
    await expect(cdrIdentityToken(config, subject, fetcher)).rejects.toThrow("CDR_IDENTITY_UNAVAILABLE");
    expect(canceled).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
