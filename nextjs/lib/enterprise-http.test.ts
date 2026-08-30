import { describe, expect, it } from "vitest";
import { parseAuditWindow, serializeAuditExport } from "./enterprise-http";

describe("enterprise audit export", () => {
  it("bounds exports to one year", () => {
    expect(parseAuditWindow("https://tavonel.com/api?from=2025-01-01&to=2026-08-30")).toBeNull();
    expect(parseAuditWindow("https://tavonel.com/api?from=2026-08-01&to=2026-08-30&format=csv")).toMatchObject({ format: "csv" });
  });

  it("escapes CSV and emits one JSON object per line", () => {
    const events = [{ event_id: "evt-1", action: "policy,updated", details: { signed: true } }];
    expect(serializeAuditExport(events, "jsonl")).toBe(`${JSON.stringify(events[0])}\n`);
    expect(serializeAuditExport(events, "csv")).toContain('"policy,updated"');
  });
});
