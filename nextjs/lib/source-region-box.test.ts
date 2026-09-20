import { expect, it } from "vitest";
import { isSourceRegionBox } from "./source-region-box";
it.each([[NaN, 0, 10, 10], [0, 0, Infinity, 10], [-1, 0, 10, 10], [0, 0, 1001, 10], [10, 0, 1, 10], [0, 10, 10, 1], [0, 0, 0, 10], [0, 0, 10], [0, 0, 10, 10, 20]])("refuses invalid source geometry %j", (...box) => { expect(isSourceRegionBox(box)).toBe(false); });
it("keeps full-page and fractional source coordinates unchanged", () => {
  expect(isSourceRegionBox([0, 0, 1000, 1000])).toBe(true);
  expect(isSourceRegionBox([30.2, 291, 971, 380])).toBe(true);
});
