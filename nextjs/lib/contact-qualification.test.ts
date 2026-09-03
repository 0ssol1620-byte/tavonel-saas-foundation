import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseQualification, QUALIFICATION, qualificationLines } from "./contact-qualification";

/*
  The contact form is an unauthenticated write to an outbound channel.

  That is the whole reason these are closed lists. Anyone on the internet can make this endpoint
  compose an email to an internal mailbox, so the fields it adds must be values chosen here
  rather than values a submitter typed -- and the parser has to refuse anything else outright
  rather than dropping it, because a message that arrives with one field silently missing reads
  exactly like a message from someone who left it blank.

  What this cannot check: whether the questions are the right questions. Masterplan 13.4 named
  them, and the first test holds the list to that.
*/

const answers = { volume: ["Under 100"], sources: ["Digital PDFs", "Office documents"] };

describe("the questions masterplan 13.4 asked for", () => {
  it("asks all of them", () => {
    expect(QUALIFICATION.map((field) => field.name)).toEqual([
      "volume", "sources", "output", "timeline", "deployment", "region",
    ]);
  });

  it("keeps every one of them optional", () => {
    // A visitor who only wants to ask a question should not face a qualification questionnaire.
    expect(parseQualification({})).toEqual({});
    const form = readFileSync(resolve(import.meta.dirname, "../components/contact-form.tsx"), "utf8");
    expect(form).toContain('<option value="">No answer</option>');
    expect(form).not.toMatch(/name=\{field\.name\}[^>]*required/);
  });

  it("offers no field a document could be pasted into", () => {
    /*
      The page's one instruction to the visitor is not to paste customer documents. A free-text
      qualification field would be an invitation to do exactly that, next to the sentence asking
      them not to.
    */
    for (const field of QUALIFICATION) {
      expect(field.options.length, field.name).toBeGreaterThan(2);
      for (const option of field.options) expect(option.length, option).toBeLessThanOrEqual(48);
    }
  });
});

describe("what reaches the mailbox", () => {
  it("accepts the answers the form can produce", () => {
    expect(parseQualification(answers)).toEqual(answers);
  });

  it("ignores the fields that are not its business", () => {
    // name, email, message and the honeypot are parsed elsewhere; this must not claim them.
    expect(parseQualification({ ...answers, name: "Someone", website: "spam" })).toEqual(answers);
  });

  it("refuses an option this form never offered", () => {
    expect(parseQualification({ volume: ["Under 100"], region: ["Antarctica"] })).toBeNull();
  });

  it("refuses free text smuggled into a closed field", () => {
    expect(parseQualification({ output: ["<script>alert(1)</script>"] })).toBeNull();
    expect(parseQualification({ timeline: ["Exploring\nBcc: elsewhere@example.test"] })).toBeNull();
  });

  it("refuses two answers to a question that has one", () => {
    expect(parseQualification({ volume: ["Under 100", "More than 10,000"] })).toBeNull();
  });

  it("keeps every box a visitor ticked", () => {
    // The bug this rule exists for lived in the client: `Object.fromEntries` over a FormData
    // keeps the last value of a repeated name, so four ticked boxes were reported as one.
    const parsed = parseQualification({ sources: ["Scanned PDFs", "Digital PDFs", "Office documents"] });
    expect(parsed!.sources).toHaveLength(3);
  });

  it("reports the answered questions in the order they were asked", () => {
    const lines = qualificationLines({ region: ["Korea"], volume: ["Under 100"] });
    expect(lines.map((line) => line.label)).toEqual(["Estimated document volume", "Data region requirement"]);
    expect(lines[1].value).toBe("Korea");
  });

  it("says nothing about a question nobody answered", () => {
    expect(qualificationLines({})).toEqual([]);
    expect(qualificationLines({ volume: [] })).toEqual([]);
  });
});

describe("the page around the form", () => {
  const page = readFileSync(resolve(import.meta.dirname, "../app/contact/page.tsx"), "utf8");

  it("routes support and security past the general queue", () => {
    // A vulnerability report waiting behind a pricing question is the one queue it must not
    // be in, which is why 13.4 asks for the direct routes.
    expect(page).toContain("support@tavonel.com");
    expect(page).toContain("security@tavonel.com");
  });

  it("drops the sentence about our own address policy", () => {
    expect(page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")).not.toContain("Personal mailbox addresses are never published");
  });

  it("promises no response time nobody has committed to", () => {
    /*
      13.4 asks for an expected response time. What that number is, is a commitment the founder
      makes, not one this page can invent -- so the page says what is true about the routing and
      the traceability file records the number as still owed.
    */
    expect(page).not.toMatch(/within (?:one|two|\d+) (?:business )?(?:hour|day|week)/i);
  });
});
