import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SourceCapabilityTable from "../components/source-capability-table";
import {
  CAPABILITY_MANIFEST,
  CAPABILITY_TIER_LABEL,
  CAPABILITY_TIER_TOKEN,
  capabilityCensus,
  isAcceptedAtUpload,
  publicCapabilityRows,
  type CapabilityManifest,
} from "../../shared/capabilityManifest";
import { capabilityStatuses, type CapabilityStatus } from "../../shared/uskcEnums";

/*
  Gap #4 of the 2026-09-22 competitor visual audit, held at the two joints it can break at.

  The audit asks for the tier badge system to be driven by `shared/capabilityManifest.ts` alone
  and for nothing on the page to be coloured as though it were more capable than its manifest
  row. Those are two different failures and they fail in opposite directions, so both are checked
  rather than one standing in for the other:

    a badge with no manifest status behind it   -- a tier invented on the page
    a status rendered as a higher tier          -- a manifest row flattered by its chip

  The second is the one that costs money. A `verified` chip is the only thing on /sources that
  says a qualification receipt exists, no entry in this deployment has one, and the cheapest way
  to publish a claim nobody can support is a colour.

  `HIGHER_THAN` is ordered from the enum rather than typed out, so a seventh status cannot be
  added above `BEST_EFFORT` without this file having an opinion about it.
*/

/** The enum's own order, strongest first. A status may never render another's chip. */
const TIER_RANK = new Map<CapabilityStatus, number>(
  capabilityStatuses.map((status, index) => [status, index]),
);

const rows = publicCapabilityRows();

describe("/sources tier badges are the manifest's statuses and nothing else", () => {
  it("gives every status exactly one written tier and one colour token", () => {
    expect(Object.keys(CAPABILITY_TIER_LABEL).sort()).toEqual([...capabilityStatuses].sort());
    expect(Object.keys(CAPABILITY_TIER_TOKEN).sort()).toEqual([...capabilityStatuses].sort());
    // Two statuses sharing a written tier would make a badge ambiguous in the direction that
    // matters: a reader could not tell which of the two a row is in.
    expect(new Set(Object.values(CAPABILITY_TIER_LABEL)).size).toBe(capabilityStatuses.length);
  });

  it("renders each row's badge as its own status, never another's", () => {
    for (const entry of CAPABILITY_MANIFEST.entries) {
      const row = rows.find((candidate) => candidate.mime === entry.mime);
      expect(row, `${entry.mime} has no rendered row`).toBeDefined();
      expect(row!.tier).toBe(CAPABILITY_TIER_LABEL[entry.status]);
      expect(row!.tierToken).toBe(CAPABILITY_TIER_TOKEN[entry.status]);
    }
  });

  /*
    The inverse of the row above, and the one that is not implied by it.

    A row printing `CAPABILITY_TIER_LABEL[entry.status]` is correct by construction; what is not
    is the table those labels come out of. If `VERIFIED_NATIVE` and `BEST_EFFORT` ever pointed at
    the same colour token, every assertion above would still pass and every best-effort row would
    be painted as qualified.
  */
  it("never colours a status with a stronger status's token", () => {
    for (const status of capabilityStatuses) {
      const token = CAPABILITY_TIER_TOKEN[status];
      const strongerSharingTheToken = capabilityStatuses.filter(
        (other) => CAPABILITY_TIER_TOKEN[other] === token && TIER_RANK.get(other)! < TIER_RANK.get(status)!,
      );
      /*
        Sharing a token with a stronger status is allowed only where the two mean the same thing
        to a reader -- VERIFIED_NATIVE and VERIFIED_HYBRID both mean a receipt exists,
        BEST_EFFORT and METADATA_ONLY both mean nobody has qualified how well. What is barred is
        sharing across that line, which is what "looks more capable than the manifest row" is.
      */
      for (const stronger of strongerSharingTheToken) {
        const receiptSide = (value: CapabilityStatus) => value.startsWith("VERIFIED");
        expect(
          receiptSide(stronger),
          `${status} takes ${stronger}'s colour across the qualification line`,
        ).toBe(receiptSide(status));
      }
    }
  });

  it("paints no row as qualified while no row carries a receipt", () => {
    // The manifest's own honesty rule: a verified tier needs a receipt digest and a date.
    expect(capabilityCensus().qualified).toBe(0);
    expect(rows.filter((row) => row.tierToken === "verified")).toEqual([]);
  });

  it("sends no manifest identifier to the client with the badge", () => {
    const html = renderToStaticMarkup(createElement(SourceCapabilityTable, { rows }));
    for (const identifier of [...capabilityStatuses, "bbox1000", "no_table_or_formula_extraction"]) {
      expect(html, `the rendered table leaks "${identifier}"`).not.toContain(identifier);
    }
  });
});

/*
  The denominators, counted from the manifest rather than written.

  The audit's complaint is that the chips have no denominator: "best effort" with no count beside
  it could describe one format or twelve. Every figure the page prints is `capabilityCensus`,
  and each is checked against the manifest independently here rather than against the function
  that produced it -- a census that agreed with itself would be worth nothing.
*/
describe("/sources prints the denominators its badges are counted over", () => {
  const census = capabilityCensus();

  it("counts what the manifest accepts, converts and refuses", () => {
    const accepted = CAPABILITY_MANIFEST.entries.filter((entry) => isAcceptedAtUpload(entry.status));
    expect(census.total).toBe(CAPABILITY_MANIFEST.entries.length);
    expect(census.accepted).toBe(accepted.length);
    expect(census.omitted).toBe(CAPABILITY_MANIFEST.entries.length - accepted.length);
    expect(census.converted).toBe(
      accepted.filter((entry) => entry.knownLimitations.some((limit) => limit.startsWith("converted_")))
        .length,
    );
    // Accepted and omitted are the whole of the table, so a reader can check the split adds up.
    expect(census.accepted + census.omitted).toBe(census.total);
  });

  it("counts preserved fields as a set, not once per row", () => {
    // Three fields cross into the compile request, and every accepted format carries the same
    // three. Summing them would print 36 and mean nothing.
    expect(census.preserved).toBe(3);
    expect(census.preserved).toBeLessThanOrEqual(census.total);
  });

  it("moves with the manifest rather than with the page", () => {
    const entries = CAPABILITY_MANIFEST.entries.filter((entry) => entry.status !== "UNSUPPORTED");
    const narrowed = { ...CAPABILITY_MANIFEST, entries } as CapabilityManifest;
    expect(capabilityCensus(narrowed).omitted).toBe(0);
    expect(capabilityCensus(narrowed).accepted).toBe(entries.length);
  });
});
