import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/contact/route";
import { planIntentFrom } from "../components/contact-form";
import { BILLING_OFFERS } from "./billing-catalog";

const valid = {
  name: "Tavonel Buyer",
  email: "buyer@example.com",
  company: "Example Labs",
  topic: "sales",
  message: "We need to compile a large document collection into grounded knowledge.",
  website: "",
  startedAt: Date.now() - 5_000,
};

const deliveryEnv = [
  "AKC_RESEND_API_KEY",
  "AKC_CONTACT_FROM",
  "AKC_CONTACT_TO",
  "AKC_CONTACT_ALLOWED_ORIGINS",
] as const;

beforeEach(() => {
  // Vercel injects real Production/Preview environment variables while running prebuild.
  // These tests must start from a deterministic empty delivery posture and opt in explicitly.
  vi.stubEnv("NODE_ENV", "test");
  for (const key of deliveryEnv) vi.stubEnv(key, "");
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

  it("marks a Korean inquiry for the recipient without translating validated values", async () => {
    vi.stubEnv("AKC_RESEND_API_KEY", "secret-test-key");
    vi.stubEnv("AKC_CONTACT_FROM", "TAVONEL <no-reply@tavonel.com>");
    vi.stubEnv("AKC_CONTACT_TO", "hello@tavonel.com");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    expect((await POST(request({ ...valid, locale: "ko", volume: "Under 100" },
      "http://localhost:3000", "203.0.113.29"))).status).toBe(202);
    const [, options] = fetchMock.mock.calls[0]!;
    const payload = JSON.parse(String(options?.body)) as Record<string, string>;
    expect(payload.subject).toContain("[KO]");
    expect(payload.text).toContain("Language: ko");
    expect(payload.text).toContain("Under 100");
    expect(payload.html).toContain(">ko</td>");
  });

  /*
    Catalog v2 (WO-CAT-2 L3). A Request access link names its plan by label, `/contact?plan=<label>`, and the inquiry
    stores exactly that label: the form preselects it and the route delivers it. The 2026-11-10 mapping (Developer to
    "Starter", Team to "Pro") recorded a different plan than the one asked about, and Personal and Business were dropped.
    The labels come from the catalog, so every v2 label is driven through, not a sample of them.
  */
  describe("plan intent: the label a Request access link names is the label stored", () => {
    const deliver = () => {
      vi.stubEnv("AKC_RESEND_API_KEY", "secret-test-key");
      vi.stubEnv("AKC_CONTACT_FROM", "TAVONEL <no-reply@tavonel.com>");
      vi.stubEnv("AKC_CONTACT_TO", "hello@tavonel.com");
      return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    };
    /*
      What the form sends for `?plan=<value>`, and what the route then delivers. Each case has its own address and its
      own email domain, so the limiter (five per address and per domain) never counts another case's submission.
    */
    async function stored(value: string | null, caseId: string) {
      const fetchMock = deliver();
      const plan = planIntentFrom(value);
      const response = await POST(request({ ...valid, email: `buyer@plan-${caseId}.test`, plan }, "http://localhost:3000", `198.18.${caseId}`));
      expect(response.status, String(value)).toBe(202);
      const payload = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as Record<string, string>;
      return { plan, text: payload.text, html: payload.html };
    }

    const labels = [...Object.values(BILLING_OFFERS).filter((offer) => offer.status === "v2").map((offer) => offer.label), "Enterprise"];
    it("covers every v2 plan label and Enterprise", () => {
      expect(labels).toEqual(["Personal", "Developer", "Team", "Business", "Enterprise"]);
    });

    labels.forEach((label, index) => {
      it(`?plan=${label} is stored as ${label}`, async () => {
        const { plan, text, html } = await stored(label, `0.${index + 1}`);
        expect(plan).toBe(label);
        expect(text).toContain(`Plan: ${label}\n`);
        expect(html).toContain(`>${label}</td>`);
      });
    });

    // Not plan names any more: the form names no plan, and nothing is stored as one.
    ["Starter", "Pro"].forEach((retired, index) => {
      it(`?plan=${retired} preselects nothing and is stored as no plan`, async () => {
        const { plan, text } = await stored(retired, `1.${index + 1}`);
        expect(plan).toBe("");
        expect(text).not.toContain("Plan:");
        expect(text).not.toMatch(/Starter|\bPro\b/);
      });
    });

    it("refuses a plan name the form never sends, old or invented, rather than store it", async () => {
      deliver();
      for (const [index, plan] of ["Starter", "Pro", "Administrator", "personal", "Developer (2026-09 plan)"].entries()) {
        const response = await POST(request({ ...valid, email: `buyer@plan-2-${index}.test`, plan }, "http://localhost:3000", `198.18.2.${index + 1}`));
        expect(response.status, plan).toBe(400);
      }
    });

    it("the form maps only exact labels: case, padding and other parameters name no plan", () => {
      for (const value of [null, "", "personal", " Team", "PRO", "KQU", "Developer (2026-09 plan)", "Enterprise\n"]) {
        expect(planIntentFrom(value), String(value)).toBe("");
      }
    });
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

/*
  Blueprint 2026-09-08 §31 wants this limit durable and §30 wants it multi-dimensional. Only
  the second half is here: the store it would live in does not exist yet (see the ponytail note
  in the route for the migration it is blocked on), so what is asserted is what the
  process-local limiter actually promises -- both dimensions are consumed on every submission,
  so neither one address rotating its email nor one domain arriving from many addresses gets
  more than the window allows.

  Each case below uses its own address AND its own domain; a case that shared either with
  another would be counting somebody else's submissions.
*/
describe("contact rate limit", () => {
  it("stops a sixth submission from one address, however that address varies its email", async () => {
    const attempts: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await POST(request(
        { ...valid, email: `buyer@ip-case-${index}.test` },
        "http://localhost:3000",
        "198.51.100.10",
      ));
      attempts.push(response.status);
    }
    // 503 is the unconfigured delivery channel: what matters is that the request got that far.
    expect(attempts).toEqual([503, 503, 503, 503, 503, 429]);
  });

  it("stops a sixth submission to one email domain, however the source address varies", async () => {
    const attempts: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await POST(request(
        { ...valid, email: `buyer${index}@domain-case.test` },
        "http://localhost:3000",
        `198.51.100.${100 + index}`,
      ));
      attempts.push(response.status);
    }
    expect(attempts).toEqual([503, 503, 503, 503, 503, 429]);
  });

  it("keeps the raw address and email out of the limiter key", async () => {
    // Bucket keys are HMACs over a per-process salt, so the limiter retains nothing readable
    // about the submitter -- which is what makes this ledger safe to make durable later.
    const source = readFileSync(resolve(import.meta.dirname, "../app/api/contact/route.ts"), "utf8");
    expect(source).toMatch(/createHmac\("sha256", KEY_SALT\)/);
    expect(source).toMatch(/\[saltedKey\("ip", ip\), saltedKey\("domain", domain\)\]/);
  });
});

function request(body: unknown, origin = "http://localhost:3000", forwardedFor = "203.0.113.8") {
  return new Request("http://localhost:3000/api/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "X-Forwarded-For": forwardedFor },
    body: JSON.stringify(body),
  });
}
