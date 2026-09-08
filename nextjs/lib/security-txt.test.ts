import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  §48. `security.txt` is served, not rendered, so this is the only thing standing between the
  published file and a finder who cannot reach anyone.

  It is a static file rather than a route because the only dynamic part is `Expires`, and a route
  computing "now + one year" would make the field meaningless: RFC 9116 wants the date to be a
  commitment someone re-affirms, not one that renews itself while nobody is looking. The cost is
  that this test goes red before the file expires, which is the reminder.
*/
const file = readFileSync(resolve(import.meta.dirname, "../public/.well-known/security.txt"), "utf8");
const fields = new Map(
  file.split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const;
    }),
);

describe("security.txt", () => {
  it("names a security address the site already publishes", () => {
    expect(fields.get("Contact")).toBe("mailto:security@tavonel.com");
    const contactPage = readFileSync(resolve(import.meta.dirname, "../app/contact/page.tsx"), "utf8");
    expect(contactPage, "security.txt must not be the only place this address exists").toContain("security@tavonel.com");
  });

  it("expires, in the future, within a year", () => {
    const expires = new Date(fields.get("Expires") ?? "");
    expect(Number.isFinite(expires.getTime())).toBe(true);
    const days = (expires.getTime() - Date.now()) / 86_400_000;
    expect(days, "an expired security.txt is an invalid one — re-affirm the file and move the date").toBeGreaterThan(0);
    expect(days, "RFC 9116 asks for less than a year").toBeLessThanOrEqual(366);
  });

  it("declares its canonical location and the languages a report may be written in", () => {
    expect(fields.get("Canonical")).toBe("https://tavonel.com/.well-known/security.txt");
    expect(fields.get("Preferred-Languages")).toBe("en, ko");
  });

  it("promises nothing that is not operationally real", () => {
    // A bounty, an SLA or a PGP key we cannot honour turns a disclosure file into a claim.
    for (const field of ["Policy", "Encryption", "Acknowledgments", "Hiring"]) {
      expect(fields.has(field), `${field} implies a process this deployment does not have`).toBe(false);
    }
    // Field lines only. The comment block says these things are absent, and saying so is the
    // opposite of claiming them.
    const declared = [...fields].map(([key, value]) => `${key}: ${value}`).join("\n").toLowerCase();
    expect(declared).not.toMatch(/bounty|reward|sla|within \d+ (hour|day)/);
  });
});
