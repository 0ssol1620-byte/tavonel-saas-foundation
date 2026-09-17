/** Public-sample presentation only. Not an upload or customer-document policy. */
export type SourceRect = readonly [number, number, number, number];
export type SourceIdentity = { sourceId: string; digest: string; sourceVersionId: string; page: number };
export function sameSourcePage(a: SourceIdentity, b: SourceIdentity): boolean {
  return a.sourceId === b.sourceId && a.digest === b.digest && a.sourceVersionId === b.sourceVersionId && a.page === b.page;
}
export function validSourceRect(rect: readonly number[]): rect is SourceRect {
  return rect.length === 4 && rect.every(Number.isFinite) && rect[0] >= 0 && rect[1] >= 0
    && rect[2] <= 1000 && rect[3] <= 1000 && rect[0] < rect[2] && rect[1] < rect[3];
}
export function sourceRectStyle(rect: SourceRect) {
  if (!validSourceRect(rect)) return null;
  return { left: `${rect[0] / 10}%`, top: `${rect[1] / 10}%`,
    width: `${(rect[2] - rect[0]) / 10}%`, height: `${(rect[3] - rect[1]) / 10}%` };
}
export function publicPdfPath(href: string): string | null {
  const path = href.split('#', 1)[0];
  return /^\/explore-sample\/[a-z0-9][a-z0-9-]*\.pdf$/.test(path) ? path : null;
}
export function sourceScale(pageWidth: number, pageHeight: number, containerWidth: number, containerHeight: number, zoom: number) {
  if (![pageWidth, pageHeight, containerWidth, containerHeight, zoom].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid page geometry');
  const fit = Math.min((containerWidth - 32) / pageWidth, (containerHeight - 32) / pageHeight);
  return Math.max(0.1, fit) * Math.min(4, Math.max(1, zoom));
}
export function boundedPixelRatio(width: number, height: number, deviceRatio: number): number {
  return Math.max(0.25, Math.min(deviceRatio || 1, 2, Math.sqrt(5_000_000 / (width * height))));
}
