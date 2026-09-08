import { describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/csp-report/route";
import { middleware } from "@/middleware";
import { CSP_REPORT_PATH, cspReportOnly, generateCspNonce, summarizeCspReport } from "@/lib/csp-report-only";

const NONCE = /script-src 'nonce-([A-Za-z0-9+/=]{24})' 'strict-dynamic'/;

describe("§41 Phase 1 report-only CSP", () => {
  it("mints a fresh nonce on every response", () => {
    const first = middleware().headers.get("Content-Security-Policy-Report-Only") ?? "";
    const second = middleware().headers.get("Content-Security-Policy-Report-Only") ?? "";
    const a = first.match(NONCE)?.[1];
    const b = second.match(NONCE)?.[1];
    expect(a, "report-only script-src must carry a nonce").toBeTruthy();
    expect(b).toBeTruthy();
    expect(a, "a nonce reused across responses is not a nonce").not.toEqual(b);
  });

  it("names the collector in both the legacy and the current reporting directive", () => {
    const response = middleware();
    const policy = response.headers.get("Content-Security-Policy-Report-Only") ?? "";
    expect(policy).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(policy).toContain("report-to csp-endpoint");
    expect(response.headers.get("Reporting-Endpoints")).toBe(`csp-endpoint="${CSP_REPORT_PATH}"`);
  });

  it("never enforces: the report-only policy is only ever on the report-only header", () => {
    const response = middleware();
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("drops 'unsafe-inline' from script-src while keeping the checkout allowlist", () => {
    const policy = cspReportOnly(generateCspNonce());
    const scriptSrc = policy.split("; ").find((directive) => directive.startsWith("script-src "))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("https://*.paddle.com");
    // Styles are explicitly out of scope for this phase; the report would be unreadable otherwise.
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe("violation report sanitization", () => {
  it("keeps only path, directive, origin and disposition from a legacy report", () => {
    expect(summarizeCspReport({
      "csp-report": {
        "document-uri": "https://tavonel.com/workspace/world?token=secret#frag",
        "violated-directive": "script-src-elem 'nonce-abc'",
        "blocked-uri": "https://evil.example/steal.js?doc=confidential",
        "script-sample": "const customerName = 'Jane Doe'",
        disposition: "report",
      },
    })).toEqual({
      documentPath: "/workspace/world",
      directive: "script-src-elem",
      blockedSource: "https://evil.example",
      disposition: "report",
    });
  });

  it("reads the reports+json shape and reports inline as inline", () => {
    expect(summarizeCspReport({
      documentURL: "https://tavonel.com/security",
      effectiveDirective: "script-src",
      blockedURL: "inline",
      disposition: "report",
    })).toEqual({
      documentPath: "/security",
      directive: "script-src",
      blockedSource: "inline",
      disposition: "report",
    });
  });

  it("refuses anything that is not a violation report", () => {
    expect(summarizeCspReport(null)).toBeNull();
    expect(summarizeCspReport("not an object")).toBeNull();
    expect(summarizeCspReport({ hello: "world" })).toBeNull();
  });
});

function report(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://tavonel.com/api/csp-report", {
    method: "POST",
    headers: { "Content-Type": "application/csp-report", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VIOLATION = {
  "csp-report": {
    "document-uri": "https://tavonel.com/",
    "effective-directive": "script-src",
    "blocked-uri": "inline",
    disposition: "report",
  },
};

describe("/api/csp-report collector", () => {
  it("logs one structured line per violation and nothing from the body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await POST(report(VIOLATION));
    expect(response.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warn.mock.calls[0]![0] as string);
    expect(logged).toEqual({
      event: "csp_violation",
      documentPath: "/",
      directive: "script-src",
      blockedSource: "inline",
      disposition: "report",
    });
    warn.mockRestore();
  });

  it("caps a batch and refuses an oversized or unparseable body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const batch = Array.from({ length: 40 }, () => ({ body: VIOLATION["csp-report"] }));
    expect((await POST(report(batch))).status).toBe(204);
    expect(warn, "a batch must not be able to write an unbounded number of log lines").toHaveBeenCalledTimes(8);
    warn.mockRestore();

    expect((await POST(report("{"))).status).toBe(400);
    expect((await POST(report({ hello: "world" }))).status).toBe(400);
    expect((await POST(report(VIOLATION, { "content-length": "999999" }))).status).toBe(413);
    expect((await POST(report({ padding: "x".repeat(9000), ...VIOLATION }))).status).toBe(413);
  });
});
