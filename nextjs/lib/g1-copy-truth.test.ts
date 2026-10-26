import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "../public/developer/tavonel-mcp.mjs";
import { BILLING_OFFERS } from "./billing-catalog";
import { DOCS_SECTIONS } from "./docs-content";
import { DEVELOPER_FILES } from "./mcp-tools";
import { readPublicOperations } from "./operations";
import { readPublicStatusV2 } from "./public-status";

/*
  G1-COPY (DECISION-REGISTER-2026-10-17 S6-17 + S6-16, lane column [G1]; SERVICE-DEFINITION §4.4).

  The site says what the code does. One test per public sentence: each one failed on main
  ed4a1583, where the sentence still promised more than the code behind it, and each binds the
  corrected sentence to the code fact that makes it true rather than to a typed copy of itself.
  Numbering follows the register's S6-17 list; the four lane items after it are D-01, D-33, N-5
  and the D-07 pricing deletion.
*/

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** Rendered prose only: comments say why a sentence went, and must not count as the sentence. */
const copy = (path: string) => read(path)
  // A JSX comment's body cannot contain "*/" (the same fix as copy-trust-guard's prose(), review N2).
  .replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ")
  .replace(/\s+/g, " ");

/** Every string a docs section renders, its summary included. */
function docsText(slug: string): string {
  const section = DOCS_SECTIONS.find((candidate) => candidate.slug === slug);
  if (!section) throw new Error(`no docs section ${slug}`);
  const strings: string[] = [section.summary];
  const walk = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(section.blocks);
  return strings.join("\n");
}

const integrations = () => copy("app/integrations/page.tsx");
const agent = read("public/developer/tavonel-source-agent.py");

afterEach(() => vi.unstubAllEnvs());

describe("G1-COPY: /integrations", () => {
  it("1. states that compiling your own sources is set up with us, not that five systems connect today", () => {
    const page = integrations();
    expect(page).toContain("Compiling your own sources is set up with us.");
    expect(page).not.toMatch(/connects? today/i);
  });

  it("2. says each import is started and nothing compiles until a compile is started", () => {
    const page = integrations();
    expect(page).not.toContain("discovers and imports");
    expect(page).toContain("start each import yourself");
    expect(page).toContain("nothing is compiled until you start the compile");
  });

  it("3. (S6-16) names the resident --watch mode the source agent has, and promises no unattended operation", () => {
    // The code fact the sentence rests on.
    expect(agent).toContain('value.add_argument("--watch"');
    expect(agent).toContain('value.add_argument("--poll-seconds"');
    const page = integrations();
    expect(page).not.toContain("has no internal timer");
    expect(page).toContain("With --watch it stays resident");
    expect(page).toContain("it is not an unattended service");
  });

  it("3b. (S6-16, same fold) names the bounded retry the agent performs instead of denying it", () => {
    expect(agent).toContain('value.add_argument("--retry-limit"');
    expect(agent).toContain("except RetryableAgentError:");
    const page = integrations();
    expect(page).not.toContain("There is no retry inside the agent");
    expect(page).toContain("--retry-limit");
  });
});

describe("G1-COPY: developer docs and files", () => {
  it("4. describes the CLI without an upload it does not have", () => {
    const cli = read("public/developer/tavonel-cli.mjs");
    expect(cli).not.toMatch(/node tavonel-cli\.mjs upload/);
    const purpose = DEVELOPER_FILES.find((entry) => entry.key === "cli")!.purpose;
    expect(purpose).not.toMatch(/upload/i);
    expect(purpose).toBe("The read and compile path from a terminal.");
  });

  it("5. documents the capability fields the upload route returns: uploadUrl and expiresInSeconds", () => {
    const route = read("app/api/uploads/capability/route.ts");
    expect(route).toContain("uploadUrl: signed.uploadUrl, expiresInSeconds: 300");
    const upload = docsText("upload");
    for (const absent of ["url, method, headers and expiresAt", "capability.url", "capability.headers", "capability.method", "capability[\"url\"]", "capability[\"headers\"]", "expiresAt in the capability response"]) {
      expect(upload, absent).not.toContain(absent);
    }
    for (const field of ["uploadUrl", "expiresInSeconds", "declaredMimeType", "contentLength"]) {
      expect(upload, field).toContain(field);
    }
  });

  it("6. reads the fingerprint from the trust v2 record the route serves, at every place it is fetched", () => {
    const v2Path = ".activeKeyId as $id | .keys[] | select(.keyId == $id) | .publicKeySpkiSha256";
    const readme = read("public/developer/README.md");
    const places = [docsText("quickstart"), docsText("cli"), docsText("integration-recipes"), readme];
    for (const text of places) {
      expect(text).not.toContain("jq -r .publicKeySpkiSha256");
      expect(text).not.toContain("jq '{keyId, publicKeySpkiSha256}'");
    }
    expect(docsText("quickstart")).toContain(v2Path);
    expect(docsText("cli")).toContain(v2Path);
    expect(readme).toContain(v2Path);
    expect(docsText("integration-recipes")).toContain("jq '{activeKeyId, keys: [.keys[] | {keyId, status, publicKeySpkiSha256}]}'");
    // The record those paths read: activeKeyId plus keys[], with the fingerprint per key.
    const signing = read("lib/export-signing.ts");
    expect(signing).toContain('schemaVersion: "tavonel.export_trust.v2"');
    expect(signing).toMatch(/activeKeyId: string;\s*keys: ExportTrustKey\[\];/);
  });

  it("10. says /developers reads the current active revision", () => {
    const page = copy("app/developers/page.tsx");
    expect(page).toContain("Always the current active revision");
    expect(page).not.toContain("Always the current revision");
  });

  it("12. points download_package at the verifier the channel publishes", () => {
    const tool = (TOOLS as Array<{ name: string; description: string }>).find((entry) => entry.name === "download_package")!;
    expect(tool.description).not.toContain("scripts/verify-signed-export.mjs");
    expect(tool.description).toContain("tavonel-verify-export.mjs");
    const channel = JSON.parse(read("public/developer/channel.json")) as { assets: Record<string, { url: string }> };
    expect(channel.assets.verifyExport.url.endsWith("/tavonel-verify-export.mjs")).toBe(true);
    expect(read("public/developer/tavonel-mcp.mjs")).not.toContain("node scripts/verify-signed-export.mjs");
  });

  it("N-5. leads /docs/quickstart without the word verified", () => {
    const summary = DOCS_SECTIONS.find((section) => section.slug === "quickstart")!.summary;
    expect(summary).not.toMatch(/verified/i);
    expect(summary).toBe("From an API key to an evidence-bound answer, with the one step no key can take.");
  });

  /*
    Review B1 (2026-10-19). /llms.txt, which /docs links as the site index for AI agents, is a
    hand-kept copy of the docs summaries and the page descriptions, so N-5 and S6-17 #1 were only
    half done while it still said "verified" and "connect today". This binds its quickstart line to
    the summary the page renders and keeps the connector tense out of the whole file.
  */
  it("N-5 / S6-17 #1. llms.txt repeats the quickstart summary and says nothing connects today", () => {
    const llms = read("public/llms.txt");
    const summary = DOCS_SECTIONS.find((section) => section.slug === "quickstart")!.summary;
    const prefix = "- [Quickstart](https://tavonel.com/docs/quickstart): ";
    const line = llms.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
    expect(line, "llms.txt lists the quickstart").toBeDefined();
    const description = line!.slice(prefix.length);
    expect(description).not.toMatch(/verified/i);
    expect(description).toBe(summary);
    expect(llms).not.toMatch(/connects? today/i);
  });
});

describe("G1-COPY: /status and /api/readyz", () => {
  it("7. computes the billing row from the purchasable state /api/status reports, not from the launch flag alone", () => {
    // Every billing check configured and the live-charge flag on, while the customer-data gate is closed.
    for (const [name, value] of Object.entries({
      COMMERCIAL_MODE: "live", PADDLE_SANDBOX: "false", TAVONEL_BILLING_LAUNCH_APPROVED: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://tenant.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
      VERCEL_ENV: "production", PADDLE_WEBHOOK_SECRET: "configured-webhook-secret",
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: `live_${"a".repeat(30)}`, PADDLE_API_KEY: `pdl_live_${"a".repeat(30)}`,
      SUPABASE_SERVICE_ROLE_KEY: "a".repeat(32), FOUNDATION_BILLING_HMAC: "a".repeat(32),
      FOUNDATION_BILLING_SETTLEMENT_HMAC: "a".repeat(32),
      PADDLE_PRICE_OBSERVER_ACCESS: `pri_${"a".repeat(26)}`, PADDLE_PRICE_STUDIO_ACCESS: `pri_${"b".repeat(26)}`,
    })) vi.stubEnv(name, value);

    const purchasable = readPublicStatusV2().availableActions.purchasePlan.enabled;
    const operations = readPublicOperations();
    expect(purchasable).toBe(false);
    expect(operations.readiness.billingConfigured).toBe(true);
    expect(operations.readiness.billingLive).toBe(purchasable);
    expect(operations.components.billing.state).toBe("disabled");
    expect(operations.components.billing.detail).not.toBe("Paddle live checkout");
    // The launch flag is on here, so the row may not say approval is what it waits for.
    expect(operations.components.billing.detail).toBe("Paddle live checkout configured; checkout is closed and no plan can be bought");
  });
});

describe("G1-COPY: /pricing (D-07, C3 deletion only)", () => {
  it("8. deletes the unsupported qualifier 'verified' and nothing else from the included-pages bullet", () => {
    for (const offer of Object.values(BILLING_OFFERS)) {
      for (const feature of offer.features) expect(feature).not.toMatch(/verified/i);
      expect(offer.features).toContain(`${offer.includedPages.toLocaleString("en-US")} standard pages`);
    }
    const registry = readFileSync(new URL("../../docs/gtm/CLAIMS_REGISTRY.yaml", import.meta.url), "utf8");
    for (const id of ["CLM-022", "CLM-023"]) {
      const claim = registry.split(`claimId: ${id}`)[1]!.split("\n")[1]!;
      expect(claim, id).not.toMatch(/verified/i);
      expect(claim, id).toContain("standard pages");
    }
  });

  it("9. keeps 'Ask grounded in the public World' as it is (no single qualifier to delete, C3)", () => {
    expect(copy("components/pricing-page-client.tsx")).toContain("Ask grounded in the public World");
  });
});

describe("G1-COPY: Home promise A (D-01 / P2-30)", () => {
  /*
    FINAL-SPEC 2026-10-26 D-2 (founder veto open) replaced the D-01 support sentence with its binding half alone.
    What this pin keeps: the support line still states the page-and-region binding in both languages, names no
    format list, no "every" and no figure, and the intake sentence and the headline constant are unchanged.
  */
  it("D-01 / FINAL-SPEC D-2. carries the page-and-region support line in both languages, and keeps the intake sentence", () => {
    const home = read("components/landing-v2/landing-page.tsx");
    expect(home).toContain('support: "Each statement keeps its source page and region."');
    expect(home).toContain('support: "각 진술에 원문 페이지와 영역이 남습니다."');
    expect(home).not.toContain("TAVONEL reads your PDFs");
    expect(home).toContain('intake: "We arrange intake for your own sources with you."');
    expect(home).toContain('intake: "내 자료의 연결과 컴파일은 상담 후 함께 설정합니다."');
    expect(read("lib/site-navigation.ts")).toContain('headline: "Turn documents into context your AI can cite."');
  });
});

describe("G1-COPY: Korean measurement and HWP wording on /sources (D-33 / P2-33)", () => {
  const sentence = "한국어 문서 품질은 아직 측정하지 않았습니다.";

  it("D-33. publishes the Korean not-measured sentence and the HWP/HWPX wording on /sources, in Korean markup", () => {
    const sources = copy("app/sources/page.tsx");
    expect(sources).toContain(`lang="ko"`);
    expect(sources).toContain(sentence);
    expect(sources).toContain("HWP/HWPX: 지원하지 않음 · 측정 안 함");
  });

  // Review N3: the two sentences are a public claim, so the registry entry that backs them must stay.
  it("D-33. binds the /sources sentences to CLM-050 in the claims registry", () => {
    const registry = readFileSync(new URL("../../docs/gtm/CLAIMS_REGISTRY.yaml", import.meta.url), "utf8");
    const entry = registry.split("claimId: CLM-050")[1]?.split("claimId:")[0];
    expect(entry, "CLAIMS_REGISTRY carries CLM-050").toBeDefined();
    expect(entry).toContain(sentence);
    expect(entry).toContain("HWP/HWPX: 지원하지 않음 · 측정 안 함");
    expect(entry).toContain('surface: "/sources"');
  });

  it("D-33. keeps it off the Korean home, which is a first-impression surface (C1)", () => {
    for (const file of ["app/ko/page.tsx", "lib/landing-v2-copy.ts", "components/landing-v2/landing-page.tsx"]) {
      expect(read(file), file).not.toContain("측정하지 않았습니다");
      expect(read(file), file).not.toContain("측정 안 함");
    }
  });
});

/*
  FOLLOW-UPS review NB-7 (2026-10-19). The README served at /developer/README.md showed the MCP args as a Windows machine
  path. It now carries the placeholder /docs/mcp and the snippets use. The README is not a channel asset (channel.json pins
  no README url), so its bytes moving reissues no digest. Kept here, not in developer-distribution.test.ts: that suite is
  shared by several owners and a change to it is refused by the affected selector on purpose.
*/
describe("FOLLOW-UPS NB-7: the developer README's MCP args", () => {
  it("shows the placeholder the docs use, not a machine path, on every args line", () => {
    const readme = read("public/developer/README.md");
    const args = readme.split("\n").filter((line) => line.includes('"args"'));
    expect(args.length).toBeGreaterThan(0);
    for (const line of args) {
      expect(line).toContain('"args": ["/absolute/path/to/tavonel-mcp.mjs"]');
      expect(line).not.toMatch(/\b[A-Za-z]:[\\/]|\/Users\/|\/home\//);
    }
    const channel = JSON.parse(read("public/developer/channel.json")) as { assets: Record<string, { url: string }> };
    expect(Object.values(channel.assets).map((asset) => asset.url)).not.toContain("https://tavonel.com/developer/README.md");
  });
});
