/** A drawable source region must be finite, ordered and fully inside the original page. */
export function isSourceRegionBox(value: readonly number[]): value is readonly [number, number, number, number] {
  return value.length === 4 && value.every(n => Number.isFinite(n) && n >= 0 && n <= 1000) &&
    value[0] < value[2] && value[1] < value[3];
}
