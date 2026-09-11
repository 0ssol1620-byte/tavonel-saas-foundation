import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUPPORT_ACKNOWLEDGEMENT } from "./support-targets";

/*
  O06. The first published support target, and the two ways it can go wrong.

  It can go wrong by drifting: the sentence lands on `/status` and on `/contact`, and the day one
  of them is edited by hand the site publishes two different targets and nobody finds out from a
  failing build. So both pages have to render the constant, not a copy of its words.

  It can go wrong by growing. An acknowledgement target is a thing one person can keep; a
  resolution time depends on the bug, and "we will fix it within N hours" is the sentence a lane
  writes when it wants the page to sound stronger. The second half of this file is a ban list on
  exactly that edit -- see `docs/policy/SUPPORT_TARGETS.md` for why an unmet published target is
  worse than a published absence.
*/
const read = (path: string) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
const SURFACES = ["app/status/page.tsx", "app/contact/page.tsx"] as const;

describe("the published support target", () => {
  it("is an acknowledgement within one business day, KST", () => {
    expect(SUPPORT_ACKNOWLEDGEMENT).toContain("within 1 business day (KST)");
    expect(SUPPORT_ACKNOWLEDGEMENT).toContain("support@tavonel.com");
  });

  /*
    The provenance label, pinned in the constant rather than on the pages.

    Every other value the 2026-09-11 delegation produced carries this label where it is stated --
    the DPA's three commitments, the 72-hour incident window, the pentest sequencing -- and this
    one did not, so a reader met the only delegated commitment on the site that read as settled.
    It is asserted on the string, not on the two pages, because both pages render the constant and
    a label the pages carried separately could be edited off one of them.
  */
  it("says whose decision it is, and that the founder has not confirmed it", () => {
    expect(SUPPORT_ACKNOWLEDGEMENT).toContain("a delegated decision pending the founder's confirmation");
    expect(SUPPORT_ACKNOWLEDGEMENT, "the log entry a reader can look up").toContain("FD-09");
    expect(SUPPORT_ACKNOWLEDGEMENT, "and never the phrasing the decision log bans")
      .not.toMatch(/the founder (decided|has decided|set)/i);
  });

  it.each(SURFACES)("%s renders the constant", (surface) => {
    const source = read(surface);
    expect(source, `${surface} must import the target`).toContain('from "@/lib/support-targets"');
    expect(source, `${surface} must render it`).toContain("{SUPPORT_ACKNOWLEDGEMENT}");
  });

  /*
    The failure path that matters. A page that pastes the words instead of importing them passes
    the check above as long as the import is still there for something else, so the words
    themselves are barred from the page source.
  */
  it.each(SURFACES)("%s does not carry a second copy of the wording", (surface) => {
    expect(read(surface)).not.toContain("1 business day");
  });

  it("commits to no resolution time, and to no clock it has no rota for", () => {
    const copy = SUPPORT_ACKNOWLEDGEMENT.toLowerCase();
    expect(copy).toContain("no resolution time is committed");
    for (const overclaim of [
      "resolved within",
      "resolution within",
      "24/7",
      "around the clock",
      "guaranteed",
      "priority support",
      "dedicated",
      "sla",
    ]) {
      expect(copy, `"${overclaim}" is a commitment one person with no rota cannot keep`)
        .not.toContain(overclaim);
    }
    // One business day and 24 hours differ by a weekend, and the weekend is when the promise breaks.
    expect(copy, "an hour count is the version of this target that fails on a Saturday")
      .not.toMatch(/\b\d+\s*hours?\b/);
  });
});
