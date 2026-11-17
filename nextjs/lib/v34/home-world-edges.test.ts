import { describe, expect, it } from "vitest";
import { GET } from "@/app/v34/world-layers.svg/route";

/*
  WO-CI-5b. The Home hero draws the public reference corpus as a static SVG (`/v34/world-layers.svg`, the LCP image)
  before any script runs. detail-integrity.spec.ts guarded the Landing V2 source diagram with "every drawn connection
  has two real endpoints"; this is the same promise for the V34 drawing. It reads the bytes the server answers with,
  not the layout code that produced them, so a line whose end is not on a record fails here whatever made it.
*/

type Circle = { id: string; cx: number; cy: number };
type Line = { a: string; b: string; x1: number; y1: number; x2: number; y2: number };

const num = (value: string | undefined) => Number(value);

/** Every line of the drawing that does not start and end on a drawn record, with the reason. */
function danglingEdges(svg: string): string[] {
  const circles = new Map<string, Circle>();
  for (const m of svg.matchAll(/<circle cx="([^"]*)" cy="([^"]*)"[^>]*data-id="([^"]*)"/g)) {
    circles.set(m[3]!, { id: m[3]!, cx: num(m[1]), cy: num(m[2]) });
  }
  const lines: Line[] = [...svg.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)" data-a="([^"]*)" data-b="([^"]*)"/g)]
    .map((m) => ({ x1: num(m[1]), y1: num(m[2]), x2: num(m[3]), y2: num(m[4]), a: m[5]!, b: m[6]! }));
  const problems: string[] = [];
  for (const line of lines) {
    const from = circles.get(line.a);
    const to = circles.get(line.b);
    if (!from) problems.push(`${line.a} -> ${line.b}: no record ${line.a}`);
    if (!to) problems.push(`${line.a} -> ${line.b}: no record ${line.b}`);
    if (from && (from.cx !== line.x1 || from.cy !== line.y1)) problems.push(`${line.a} -> ${line.b}: starts off ${line.a}`);
    if (to && (to.cx !== line.x2 || to.cy !== line.y2)) problems.push(`${line.a} -> ${line.b}: ends off ${line.b}`);
  }
  return problems;
}

describe("the static World drawing", () => {
  it("draws every relationship from one drawn record to another, on the records' own centres", async () => {
    const svg = await GET(new Request("http://localhost/v34/world-layers.svg")).text();
    const edges = Number(/data-edge-count="(\d+)"/.exec(svg)![1]);
    expect(edges).toBeGreaterThan(0);
    expect([...svg.matchAll(/<line /g)]).toHaveLength(edges);
    expect(danglingEdges(svg)).toEqual([]);
  });

  it("is able to fail: a record removed, and a line moved off its record, are each reported", async () => {
    const svg = await GET(new Request("http://localhost/v34/world-layers.svg")).text();
    const firstCircle = /<circle [^>]*data-id="([^"]*)"[^>]*\/>/.exec(svg)!;
    const withoutRecord = svg.replace(firstCircle[0], "");
    const reported = danglingEdges(withoutRecord);
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.every((line) => line.includes(firstCircle[1]!))).toBe(true);

    const firstLine = /<line x1="([^"]*)"/.exec(svg)!;
    const moved = svg.replace(firstLine[0], `<line x1="${Number(firstLine[1]) + 5}"`);
    expect(danglingEdges(moved)).toHaveLength(1);
  });
});
