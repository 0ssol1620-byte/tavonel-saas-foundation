import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GET as feedRoute } from "@/app/changelog/feed.xml/route";
import {
  CHANGELOG,
  CHANGELOG_SURFACES,
  changelogEntries,
  changelogSections,
  changelogUpdatedAt,
} from "./changelog";

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

  it("has a unique date, because the date is the permalink", () => {
    const dates = CHANGELOG.map((entry) => entry.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("promises nothing", () => {
    // Masterplan 14: an unbuilt feature is not a bullet, and a changelog is the easiest place
    // for one to become a claim about something a customer already has.
    const text = JSON.stringify(CHANGELOG).toLowerCase();
    for (const phrase of ["coming soon", "will be available", "we plan", "in the coming"]) {
      expect(text, phrase).not.toContain(phrase);
    }
  });
});

describe("ordering and filtering", () => {
  it("lists the newest first", () => {
    const dates = changelogEntries().map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort().reverse());
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
      expect(xml, entry.date).toContain(`#${entry.date}`);
      expect(xml, entry.title).toContain(entry.title.replace(/&/g, "&amp;"));
    }
    expect(xml).toContain(`<updated>${changelogUpdatedAt()}T00:00:00Z</updated>`);
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
    expect(list).toContain("id={entry.date}");
    expect(list).toContain('href={`#${entry.date}`}');
    expect(list).toContain("changelog-breaking");
  });

  it("renders every entry on the server and hides the filtered ones", () => {
    // `hidden` rather than a filtered map: the page has its whole history without JavaScript,
    // and a permalink resolves whatever the filter happens to be set to.
    expect(list).toContain("hidden={surface !== null");
    expect(list).toContain("changelogEntries()");
  });
});
