import { describe, expect, it } from "vitest";
import { AREAS, CHANGE } from "./demo-world";
import { WORLD_SEED, buildWorldGraph, nodeBudget } from "./world-graph";

const graph = buildWorldGraph(360);
const count = (state: string) => graph.nodes.filter((node) => node.state === state).length;

describe("world graph", () => {
  it("marks exactly the changed origins the page claims", () => {
    expect(count("changed")).toBe(CHANGE.changed);
  });

  it("reaches exactly the affected count, level by level", () => {
    expect(count("affected")).toBe(CHANGE.affected);
    for (let level = 0; level < CHANGE.levels.length; level += 1) {
      const atLevel = graph.nodes.filter((node) => node.depth === level + 1).length;
      expect(atLevel).toBe(CHANGE.levels[level]);
    }
  });

  it("holds exactly one node, and never one the wavefront already claimed", () => {
    expect(count("held")).toBe(CHANGE.held);
    const held = graph.nodes.find((node) => node.state === "held");
    expect(held?.depth).toBe(-1);
  });

  it("starts every origin in Contracts & Policy", () => {
    for (const node of graph.nodes.filter((n) => n.depth === 0)) expect(node.area).toBe(0);
  });

  it("proves Engineering, Product and Customers are unreachable from the change", () => {
    const names: string[] = AREAS.map((area) => area.name);
    for (const name of ["Engineering", "Product", "Customers"]) {
      expect(graph.reachByArea[names.indexOf(name)]).toBe(0);
    }
  });

  it("does reach the four areas the copy names", () => {
    const names: string[] = AREAS.map((area) => area.name);
    for (const name of ["Finance", "Operations", "Legal", "Support"]) {
      expect(graph.reachByArea[names.indexOf(name)]).toBeGreaterThan(0);
    }
  });

  it("is identical on every device for a given size", () => {
    const again = buildWorldGraph(360, WORLD_SEED);
    expect(again.nodes.map((node) => [node.x, node.y, node.state])).toEqual(
      graph.nodes.map((node) => [node.x, node.y, node.state]),
    );
  });

  it("holds its claims at both ends of the node budget", () => {
    for (const total of [190, 560]) {
      const g = buildWorldGraph(total);
      expect(g.nodes.filter((node) => node.state === "changed").length).toBe(CHANGE.changed);
      expect(g.nodes.filter((node) => node.state === "affected").length).toBe(CHANGE.affected);
      expect(g.nodes.filter((node) => node.state === "held").length).toBe(CHANGE.held);
    }
  });

  it("clamps the node budget at both extremes", () => {
    expect(nodeBudget(320, 480)).toBe(190);
    expect(nodeBudget(3840, 2160)).toBe(560);
    expect(nodeBudget(1440, 900)).toBeGreaterThan(190);
  });
});
