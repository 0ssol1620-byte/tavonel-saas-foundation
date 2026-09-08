import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanForSecrets } from "../scripts/secret-scan.mjs";

/*
  Blueprint 2026-09-08 §43, P-13/P-14: proof that the scanner catches what it claims to.

  A secret scanner nobody has fed a secret is a scanner that passes because it matches nothing.
  Every pattern below is seeded into a temporary tree and then found; the last block seeds the
  case a naive scanner gets wrong -- a real-looking key inside a directory it should have
  skipped -- because a scan that walks node_modules is a scan somebody switches off.

  The literals are assembled from pieces for the same reason the scanner's patterns are: this
  file is inside the tree the CI step scans, and a test that seeds a real-shaped literal into a
  checked-in file would fail the very job it is testing. Nothing here is a real credential.
*/

const FAKE = {
  openai: `sk${"-"}${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4"}`,
  stripeSecret: `sk${"_"}live${"_"}${"51H8kZaBcDeFgHiJkLmNoP"}`,
  stripePublishable: `pk${"_"}live${"_"}${"51H8kZaBcDeFgHiJkLmNoP"}`,
  aws: `AKIA${"IOSFODNN7EXAMPLE"}`,
  pem: `${"-".repeat(5)}BEGIN RSA PRIVATE KEY${"-".repeat(5)}`,
  jwt: `ey${"J"}${"hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"}.${"eyJzdWIiOiIxMjM0NTY3ODkwIn0"}.${"abc"}`,
};

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "secret-scan-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seed(relativePath: string, contents: string) {
  const path = join(root, relativePath);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

describe("what the scanner catches", () => {
  it.each([
    ["an OpenAI-shaped key", FAKE.openai, "openai-style-key"],
    ["a Stripe live secret key", FAKE.stripeSecret, "stripe-live-secret-key"],
    ["a Stripe live publishable key", FAKE.stripePublishable, "stripe-live-publishable-key"],
    ["an AWS access key id", FAKE.aws, "aws-access-key-id"],
    ["a PEM private-key block", FAKE.pem, "pem-private-key-block"],
    ["a JWT-shaped literal", FAKE.jwt, "jwt-shaped-literal"],
  ])("finds %s", (_name, literal, pattern) => {
    seed("lib/leak.ts", `export const value = "${literal}";\n`);
    const findings = scanForSecrets(root);
    expect(findings).toEqual([{ file: "lib/leak.ts", line: 1, pattern }]);
  });

  it("reports where the literal is and never what it is", () => {
    seed("app/route.ts", `const a = 1;\nconst key = "${FAKE.openai}";\n`);
    const [finding] = scanForSecrets(root);
    expect(finding).toEqual({ file: "app/route.ts", line: 2, pattern: "openai-style-key" });
    // The whole point: nothing in a finding can be pasted anywhere.
    expect(JSON.stringify(finding)).not.toContain(FAKE.openai);
  });

  it("finds every seeded literal in one pass, not only the first", () => {
    seed("a.ts", `${FAKE.openai}\n`);
    seed("nested/b.ts", `${FAKE.aws}\n`);
    seed("nested/deeper/c.ts", `${FAKE.pem}\n`);
    expect(scanForSecrets(root).map((finding) => finding.file).sort())
      .toEqual(["a.ts", "nested/b.ts", "nested/deeper/c.ts"]);
  });

  it("says nothing about a clean tree", () => {
    seed("lib/fine.ts", "export const greeting = \"hello\";\n");
    seed("README.md", "# A repository with no secrets in it\n");
    expect(scanForSecrets(root)).toEqual([]);
  });
});

describe("the NEXT_PUBLIC allowlist (P-14)", () => {
  it("accepts exactly the two variables that are designed to be public", () => {
    seed("lib/env.ts", [
      "const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;",
      "const paddle = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;",
    ].join("\n"));
    expect(scanForSecrets(root)).toEqual([]);
  });

  it("refuses a third sensitive-sounding public variable", () => {
    seed("lib/env.ts", `const oops = process.env.NEXT_PUBLIC_${"SERVICE_ROLE"}_KEY;\n`);
    expect(scanForSecrets(root)).toEqual([{
      file: "lib/env.ts",
      line: 1,
      pattern: `public-env-not-allowlisted:NEXT_PUBLIC_${"SERVICE_ROLE"}_KEY`,
    }]);
  });

  it("ignores a public variable whose name is not sensitive", () => {
    seed("lib/env.ts", "const site = process.env.NEXT_PUBLIC_SITE_URL;\n");
    expect(scanForSecrets(root)).toEqual([]);
  });
});

describe("what the scanner deliberately does not read", () => {
  it("skips installed dependencies, lockfiles and build output", () => {
    seed("node_modules/pkg/index.js", `${FAKE.openai}\n`);
    seed(".next/server/chunk.js", `${FAKE.aws}\n`);
    seed("pnpm-lock.yaml", `${FAKE.stripeSecret}\n`);
    expect(scanForSecrets(root)).toEqual([]);
  });

  it("skips binary formats it could only produce noise from", () => {
    seed("public/logo.svg", `<!-- ${FAKE.openai} -->\n`);
    seed("public/photo.png", `${FAKE.openai}\n`);
    expect(scanForSecrets(root)).toEqual([]);
  });

  it("still reads the file types a key actually gets pasted into", () => {
    seed(".github/workflows/deploy.yml", `      TOKEN: ${FAKE.openai}\n`);
    seed("supabase/migrations/0099_seed.sql", `-- ${FAKE.aws}\n`);
    seed("docs/runbook.md", `Use ${FAKE.stripeSecret} for testing\n`);
    expect(scanForSecrets(root).map((finding) => finding.file).sort()).toEqual([
      ".github/workflows/deploy.yml",
      "docs/runbook.md",
      "supabase/migrations/0099_seed.sql",
    ]);
  });
});

describe("the scanner over this repository", () => {
  it("finds nothing in nextjs/, including in this file", () => {
    // The scanner is inside the tree it scans and so is this test. If either one had to be
    // excluded to stay green, the exclusion would be the first place a real key could hide.
    expect(scanForSecrets(resolve(import.meta.dirname, ".."))).toEqual([]);
    // The walk takes ~250 ms on its own and the default 5 s budget is generous for it; it is
    // raised because this is synchronous disk work sharing a machine with the rest of the suite,
    // and a timeout here would read as a finding.
  }, 30_000);
});
