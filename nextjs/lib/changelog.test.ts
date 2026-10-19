import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as feedRoute } from "@/app/changelog/feed.xml/route";
import {
  CHANGELOG,
  CHANGELOG_SURFACES,
  changelogEntryId,
  changelogEntryUpdatedAt,
  changelogEntries,
  changelogSections,
  changelogUpdatedAt,
} from "./changelog";
import channel from "../public/developer/channel.json";
import { GET as openApi } from "@/app/api/openapi/route";

/*
  A changelog is the one public page where a plausible line and a true one look identical.

  There is no receipt behind an entry the way there is behind a benchmark figure, so what can be
  checked is the shape: that every entry says which surface it touched, that a breaking change is
  called one and carries a migration, that the page and the feed are built from the same list,
  and that nothing here describes a release as coming. Whether an entry is true is a person's job
  and always will be.
*/

describe("every entry", () => {
  it.each(CHANGELOG.map((entry) => [entry.date, entry] as const))("%s says what it changed", (_date, entry) => {
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.title.length).toBeGreaterThan(10);
    expect(entry.surfaces.length, "an entry nobody owns is an entry nobody reads").toBeGreaterThan(0);
    for (const surface of entry.surfaces) expect(CHANGELOG_SURFACES).toContain(surface);
    expect(changelogSections(entry).length, "an entry with no added, improved or fixed").toBeGreaterThan(0);
  });

  it("gives a breaking change the migration that goes with it", () => {
    /*
      The rule that matters most here. A breaking change announced without the migration is worse
      than one announced late: the reader now knows they are broken and not what to do.
    */
    for (const entry of CHANGELOG) {
      if (!entry.breaking) continue;
      expect(entry.migration, `${entry.date} breaks something and does not say what to do`).toBeTruthy();
      expect(entry.migration!.length).toBeGreaterThan(40);
    }
  });

  it("keeps stable, unique permalinks when two releases share a date", () => {
    const ids = CHANGELOG.map(changelogEntryId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CHANGELOG.filter((entry) => entry.date === "2026-09-18").map(changelogEntryId))
      .toEqual(["2026-09-18", "2026-09-18-pricing"]);
    expect(CHANGELOG.find((entry) => entry.previousId === "2026-09-19")?.date).toBe("2026-09-20");
    expect(CHANGELOG.find((entry) => entry.previousId === "2026-09-19")?.releasedAt)
      .toBe("2026-09-19T22:41:11Z");
  });

  /*
    EN-0. The anchor said one date and the heading another: `#2026-09-14` opened on an entry
    headed 18 September, and the fragments ran 09-16, 09-14, 09-15 down the page. An anchor is
    now the date its entry shows, with a suffix when two releases share a date, and the fragment
    an entry was first published under is kept as `previousId` so an old link still lands on it.
  */
  /*
    docs/CHANGELOG_ENTRY_RULE.md: an entry is dated by the Asia/Seoul day of the production
    deployment that shipped it, and `releasedAt` is that deployment's UTC READY time. Every entry
    from the #143-#160 backfill on carries one (no entry without its READY date), and wherever an
    entry carries one, its date is that instant's Seoul calendar day.
  */
  it("dates an entry by the Seoul day of the deployment that shipped it", () => {
    const seoulDay = (instant: string) => new Date(Date.parse(instant) + 9 * 3_600_000).toISOString().slice(0, 10);
    for (const entry of CHANGELOG) {
      if (entry.date >= "2026-10-07") expect(entry.releasedAt, `${changelogEntryId(entry)} has no READY time`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      if (entry.releasedAt) expect(seoulDay(entry.releasedAt), changelogEntryId(entry)).toBe(entry.date);
    }
    // The planted pair: 23:32 in Seoul is still the 15th, and 15:00 UTC on the 15th is already the 16th there.
    expect(seoulDay("2026-10-15T14:32:11Z")).toBe("2026-10-15");
    expect(seoulDay("2026-10-15T15:00:00Z")).toBe("2026-10-16");
  });

  it("anchors every entry at the date it shows", () => {
    for (const entry of CHANGELOG) {
      const id = changelogEntryId(entry);
      expect(id === entry.date || id.startsWith(`${entry.date}-`), `#${id} is headed ${entry.date}`).toBe(true);
    }
  });

  it("keeps every fragment it has published resolving", () => {
    const anchors = CHANGELOG.flatMap((entry) => [changelogEntryId(entry), ...(entry.previousId ? [entry.previousId] : [])]);
    expect(new Set(anchors).size, "a previous fragment collides with a current anchor").toBe(anchors.length);
    for (const published of ["2026-09-23", "2026-09-19", "2026-09-16", "2026-09-14", "2026-09-15", "2026-09-03", "2026-09-02", "2026-09-01"]) {
      expect(anchors, `#${published} was published and no longer resolves`).toContain(published);
    }
  });

  it("promises nothing", () => {
    // Masterplan 14: an unbuilt feature is not a bullet, and a changelog is the easiest place
    // for one to become a claim about something a customer already has.
    const text = JSON.stringify(CHANGELOG).toLowerCase();
    for (const phrase of ["coming soon", "will be available", "we plan", "in the coming"]) {
      expect(text, phrase).not.toContain(phrase);
    }
    expect(text).not.toContain("release candidate");
    expect(text).not.toContain("pending merge");
    expect(text).not.toContain("not live today");
  });

  /*
    BA-105 / BA-106 / BA-107. A changelog is a record of what someone else can now do, or must
    now change. Three ways this one stopped being that, each with its own shape:

    An "Added" line ended on a capability that is not built and named the internal subsystem that
    would provide it. Two "Improved" lines were internal housekeeping -- one told every reader
    our pages had been misconfigured, the other spoke in search-index vocabulary. And the "Fixed"
    lines made each defect's implementation the subject, so the line advertised the defect: "no
    longer freezes the tab" advertises the freeze, and "abandoned with the reading already paid
    for" told a prospect we once charged for work we lost.

    None of that is catchable by reading the diff twice, so it is a check. Only the bullets are
    read: "not built" is legitimate in a migration note and "no longer" in a breaking change, and
    barring them everywhere would teach the next author to reword a true sentence.
  */
  it("speaks from the product rather than from the bug tracker", () => {
    const bullets = CHANGELOG.flatMap((entry) => [
      ...(entry.added ?? []), ...(entry.improved ?? []), ...(entry.fixed ?? []),
    ]);
    expect(bullets.length).toBeGreaterThan(5);

    const BARRED: Array<[string, RegExp]> = [
      ["an unbuilt capability as the end of an entry", /is not built|not offered|does not exist/i],
      ["an internal subsystem named as what is missing", /identity resolution|semantic diff|recovery policy/i],
      ["the defect as the subject", /\bno longer\b|instead of skipping|\bthrew on\b|being abandoned/i],
      ["our own misconfiguration reported as a feature", /instead of inheriting|declares its own canonical/i],
      ["search-index vocabulary", /out of the index|\bnoindex\b|\bcanonical\b/i],
    ];
    for (const [name, pattern] of BARRED) {
      const offenders = bullets.filter((bullet) => pattern.test(bullet));
      expect(offenders, `${name}: ${offenders.join(" | ")}`).toEqual([]);
    }
  });
});

describe("ordering and filtering", () => {
  it("lists the newest first", () => {
    const dates = changelogEntries().map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
    // Two releases on one calendar date: the later deployment is the newer entry.
    const times = changelogEntries().map(changelogEntryUpdatedAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  /*
    EN-0 / ENABLEMENT-GAP 2.12. The developer channel at /developer/channel.json moved to a version
    the changelog never named, so the one release a reader is told to pin had no entry. This reads
    the served manifest, so the next channel bump fails here until it has an entry of its own.
  */
  it("has an entry for the developer channel version tavonel.com serves", () => {
    const entry = CHANGELOG.find((candidate) => candidate.version === channel.version);
    expect(entry, `channel.json ${channel.version} has no changelog entry`).toBeDefined();
    expect(entry!.surfaces).toContain("Developer tools");
    // A deployment cannot be recorded before the release it shipped was cut.
    expect(changelogEntryUpdatedAt(entry!) >= channel.releasedAt).toBe(true);
  });

  /*
    EN-5. The same rule for the API contract. /api/openapi serves info.version, and a contract
    version no entry names is a contract change nobody was told about. It is read from the served
    document rather than from API_VERSION, so the check follows whatever the route publishes.
  */
  it("has an entry for the API contract version /api/openapi serves", async () => {
    const response = await openApi(new Request("https://tavonel.com/api/openapi"));
    const { info } = (await response.json()) as { info: { version: string } };
    const entry = CHANGELOG.find((candidate) => candidate.apiVersion === info.version);
    expect(entry, `OpenAPI info.version ${info.version} has no changelog entry`).toBeDefined();
    expect(entry!.surfaces).toContain("API");
  });

  it("filters to one surface without losing an entry that touches two", () => {
    const api = changelogEntries("API");
    expect(api.length).toBeGreaterThan(0);
    for (const entry of api) expect(entry.surfaces).toContain("API");
    const developer = changelogEntries("Developer tools");
    // The MCP release touches both, so it has to appear under both.
    expect(developer.some((entry) => api.includes(entry))).toBe(true);
  });

  it("does not mutate the exported list while sorting it", () => {
    const before = CHANGELOG.map((entry) => entry.date);
    changelogEntries();
    expect(CHANGELOG.map((entry) => entry.date)).toEqual(before);
  });
});

describe("the feed", () => {
  it("carries every entry the page carries", async () => {
    /*
      A feed that has fallen behind the page is worse than no feed: a subscriber believes they
      have seen everything. Both read `CHANGELOG`, and this is what holds that true.
    */
    const xml = await feedRoute().text();
    for (const entry of CHANGELOG) {
      expect(xml, changelogEntryId(entry)).toContain(`#${changelogEntryId(entry)}`);
      expect(xml, entry.title).toContain(entry.title.replace(/&/g, "&amp;"));
      expect(xml, entry.date).toContain(`<updated>${changelogEntryUpdatedAt(entry)}</updated>`);
    }
    expect(xml).toContain(`<updated>${changelogUpdatedAt()}</updated>`);
  });

  it("dates itself by its newest entry", async () => {
    const newest = CHANGELOG.map(changelogEntryUpdatedAt).sort().at(-1);
    expect(changelogUpdatedAt()).toBe(newest);
    const xml = await feedRoute().text();
    expect(xml.slice(0, xml.indexOf("<entry>"))).toContain(`<updated>${newest}</updated>`);
    // The feed's own date is not older than the developer release it carries.
    expect(changelogUpdatedAt() >= channel.releasedAt).toBe(true);
  });

  it("keeps the Atom id an entry was first published under", async () => {
    // A feed reader keys an entry by its id; a new id would be a second copy of the same release.
    const xml = await feedRoute().text();
    const moved = CHANGELOG.filter((candidate) => candidate.previousId);
    expect(moved.length).toBeGreaterThan(0);
    for (const entry of moved) {
      expect(xml).toContain(`<id>https://tavonel.com/changelog#${entry.previousId}</id>`);
      expect(xml).toContain(`<link rel="alternate" href="https://tavonel.com/changelog#${changelogEntryId(entry)}"/>`);
    }
  });

  it("is well-formed Atom with an escaped body", async () => {
    const response = feedRoute();
    expect(response.headers.get("content-type")).toContain("application/atom+xml");
    const xml = await response.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect((xml.match(/<entry>/g) ?? []).length).toBe(CHANGELOG.length);
    expect((xml.match(/<entry>/g) ?? []).length).toBe((xml.match(/<\/entry>/g) ?? []).length);
    // Every "<" left in the body would break a parser that is stricter than a browser.
    const content = xml.slice(xml.indexOf("<content"), xml.indexOf("</content>"));
    expect(content).not.toMatch(/<(?!\/?content)/);
  });

  it("says the breaking change in the feed too", async () => {
    // Somebody who only reads the feed is the person most likely to be broken by one.
    const xml = await feedRoute().text();
    expect(xml).toContain("Breaking change:");
  });
});

describe("the page that renders it", () => {
  const page = readFileSync(resolve(import.meta.dirname, "../app/changelog/page.tsx"), "utf8");
  const list = readFileSync(resolve(import.meta.dirname, "../components/changelog-list.tsx"), "utf8");

  it("carries the furniture 13.3 asked for", () => {
    expect(page).toContain("/changelog/feed.xml");
    expect(page).toContain('types: { "application/atom+xml"');
    expect(list).toContain("changelog-filter");
    expect(list).toContain("id={changelogEntryId(entry)}");
    expect(list).toContain('href={`#${changelogEntryId(entry)}`}');
    expect(list, "a previously published fragment must still land on its entry").toContain("id={entry.previousId}");
    expect(list).toContain("changelog-breaking");
    expect(list, "an entry that moved the contract prints the version it moved to").toContain("entry.apiVersion");
  });

  it("renders every entry on the server and hides the filtered ones", () => {
    // `hidden` rather than a filtered map: the page has its whole history without JavaScript,
    // and a permalink resolves whatever the filter happens to be set to.
    expect(list).toContain("hidden={surface !== null");
    // Every entry, unfiltered, from the server: the page hands the list the whole history.
    expect(page).toContain("<ChangelogList entries={changelogEntries()} />");
  });

  /*
    Phase 4 follow-ups (e). The client island read `changelogEntries()` itself, which put the
    whole CHANGELOG array into its script: /changelog sat 1,419 B under the §22 ratchet, and the
    #143-#160 backfill alone is larger than that. The data now arrives as a prop.
  */
  it("keeps the history out of the client island's script", () => {
    expect(list).toContain('"use client"');
    expect(list).not.toMatch(/\bchangelogEntries\b|\bCHANGELOG\b(?!_)/);
  });
});
