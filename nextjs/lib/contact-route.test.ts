import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/contact/route";

const valid = {
  name: "Tavonel Buyer",
  email: "buyer@example.com",
  company: "Example Labs",
  topic: "sales",
  message: "We need to compile a large document collection into grounded knowledge.",
  website: "",
  startedAt: Date.now() - 5_000,
};

beforeEach(() => {
  // Vercel Preview builds run unit tests with NODE_ENV=production. These route tests exercise
  // the local/default posture unless a case explicitly opts into production below.
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("contact route", () => {
  it("fails closed without delivery configuration", async () => {
    expect((await POST(request(valid))).status).toBe(503);
  });

  it("accepts bot-shaped submissions without sending", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect((await POST(request({ ...valid, website: "spam.test" }))).status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("escapes inquiry content before sending through Resend", async () => {
    vi.stubEnv("AKC_RESEND_API_KEY", "secret-test-key");
    vi.stubEnv("AKC_CONTACT_FROM", "TAVONEL <no-reply@tavonel.com>");
    vi.stubEnv("AKC_CONTACT_TO", "hello@tavonel.com");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    expect((await POST(request({ ...valid, message: "<script>alert(1)</script> Please review our document workflow." }))).status).toBe(202);
    const [, options] = fetchMock.mock.calls[0]!;
    const payload = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(payload.reply_to).toBe(valid.email);
    expect(payload.html).toContain("&lt;script&gt;");
    expect(payload.html).not.toContain("<script>");
    expect(JSON.stringify(payload)).not.toContain("secret-test-key");
  });

  it("rejects cross-origin submissions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AKC_CONTACT_ALLOWED_ORIGINS", "https://tavonel.com");
    expect((await POST(request(valid, "https://attacker.test"))).status).toBe(403);
  });

  it("accepts local development origins", async () => {
    expect((await POST(request(valid, "http://127.0.0.1:3200"))).status).toBe(503);
  });

  it("rejects oversized requests before parsing", async () => {
    const oversized = request(valid);
    oversized.headers.set("content-length", "16385");
    expect((await POST(oversized)).status).toBe(413);
  });
});

function request(body: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": "203.0.113.8" },
    body: JSON.stringify(body),
  });
}
