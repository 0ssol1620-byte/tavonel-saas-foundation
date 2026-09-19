import { test, expect, type Page } from "@playwright/test";
import { fixtureDocument, installFixtureSession, installWorkspaceRoutes, sseFrames } from "./fixtures/workspace-fixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const evidenceDir = process.env.DETAIL_AUDIT_DIR;
async function capture(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir, `${name}-${page.viewportSize()?.width}.png`), fullPage: true });
}
async function connectionErrors(page: Page, scope: string) {
  return page.locator(scope).evaluate(pair => {
    const a = pair.querySelector('[data-evidence-origin]')!.getBoundingClientRect();
    const b = pair.querySelector('.lv2-region')!.getBoundingClientRect();
    const path = pair.querySelector<SVGPathElement>('.lv2-evidence-connector path')!;
    const matrix = path.getScreenCTM()!;
    const p = path.getPointAtLength(0).matrixTransform(matrix);
    const q = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
    return { start: Math.hypot(p.x - a.right, p.y - a.top - a.height / 2), end: Math.hypot(q.x - b.left, q.y - b.top - b.height / 2) };
  });
}
for (const route of ["/", "/ko"]) test(`source connections have two real endpoints on ${route}`, async ({ page }) => {
  await page.goto(route);
  await page.locator('#proof').scrollIntoViewIfNeeded();
  for (const tab of await page.locator('#proof [role="tab"]').all()) {
    await tab.click();
    const pair = '#proof [role="tabpanel"]:not([hidden]) [data-evidence-pair]';
    if ((page.viewportSize()?.width ?? 0) >= 900) {
      await expect(page.locator(`${pair} [data-connected="true"]`)).toBeVisible();
      await expect.poll(async () => (await connectionErrors(page, pair)).start).toBeLessThan(2);
      await expect.poll(async () => (await connectionErrors(page, pair)).end).toBeLessThan(2);
    } else await expect(page.locator(`${pair} .lv2-evidence-connector`)).toBeHidden();
  }
  await page.locator('#evidence').scrollIntoViewIfNeeded();
  if ((page.viewportSize()?.width ?? 0) >= 1000) {
    await expect(page.locator('#evidence [data-connected="true"]')).toBeVisible();
    await expect.poll(async () => (await connectionErrors(page, '#evidence [data-evidence-pair]')).start).toBeLessThan(2);
    await expect.poll(async () => (await connectionErrors(page, '#evidence [data-evidence-pair]')).end).toBeLessThan(2);
  } else await expect(page.locator('#evidence .lv2-evidence-connector')).toBeHidden();
  await capture(page, route === '/' ? 'evidence-en' : 'evidence-ko');
});

test('a returned inventory does not mount a pretend live canvas', async ({ page }) => {
  await installFixtureSession(page);
  const ready = Array.from({ length: 31 }, (_, i) => fixtureDocument(`ready-source-${i}`));
  const held = Array.from({ length: 44 }, (_, i) => ({ ...fixtureDocument(`held-source-${i}`), hasOcrJson: false, ocrJsonKey: null, processingState: 'operator_review' }));
  await installWorkspaceRoutes(page, { documents: [...ready, ...held] });
  await page.goto('/workspace');
  await expect(page.getByRole('heading', { name: '31 sources are ready to compile.' })).toBeVisible();
  await expect(page.locator('.compile-stage')).toHaveCount(0);
  await expect(page.getByText('31 ready · 0 being read · 44 need review · No active World')).toBeVisible();
  await expect(page.locator('.workspace-intake')).toBeVisible();
  await capture(page, 'workspace-31-ready-44-held');
  await page.getByRole('button', { name: 'Search workspace commands' }).click();
  const dialog = page.getByRole('dialog', { name: 'Workspace command palette' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 900) + 1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

for (const state of ['ready', 'review_required', 'failed', 'cancelled']) test(`a ${state} job without a result shows an explanation, not an empty frame`, async ({ page }) => {
  await installFixtureSession(page);
  const jobId = `cjob-${'b'.repeat(32)}`;
  const document = fixtureDocument();
  const job = { jobId, state, documentsTotal: 1, documentsReady: 1, collectionId: null, documentIds: [document.documentId], blocked: [], blockedResolution: null, errorCode: state === 'failed' ? 'TEST_RUN_FAILURE' : null };
  await installWorkspaceRoutes(page, { documents: [document], jobs: [job] });
  await page.route(`**/api/compile-jobs/${jobId}/events**`, route => route.fulfill({ contentType: 'text/event-stream', body: sseFrames([{ ...job, sequence: 1, eventType: 'state_changed' }]) }));
  await page.goto('/workspace');
  const stage = page.locator('.compile-stage');
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute('data-visual', 'none');
  await expect(stage.locator('canvas')).toHaveCount(0);
  await expect(stage.locator('[role="status"] p')).not.toBeEmpty();
  await expect(stage).not.toHaveAttribute('data-tone', 'ready');
  expect((await stage.boundingBox())!.height).toBeLessThan(260);
  await capture(page, `workspace-${state}-no-result`);
});

test('every page declares the same versioned brand icon with working fallbacks', async ({ page, request }) => {
  for (const route of ['/', '/ko', '/workspace', '/pricing', '/docs/quickstart']) {
    await page.goto(route);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/brand/locus-v2.svg');
  }
  for (const route of ['/brand/locus-v2.svg', '/brand/locus-v2-32.png', '/brand/locus-v2.ico', '/favicon.ico', '/icon.svg']) {
    expect((await request.get(route)).status(), route).toBe(200);
  }
});

async function installObservedReading(page: Page) {
  const document = { ...fixtureDocument(), hasOcrJson: false, ocrJsonKey: null, processingState: 'sanitized' };
  await installFixtureSession(page);
  await installWorkspaceRoutes(page, { documents: [document] });
  await page.route(`**/api/documents/${document.documentId}/progress`, route => route.fulfill({ json: { readUrl: '/fixture-reading-progress' } }));
  await page.route('**/fixture-reading-progress', route => route.fulfill({ json: {
    schemaVersion: 'tavonel.ocr_progress.v1', state: 'reading', pagesRead: 1, pageCount: 2, regionsFound: 1,
    pages: [{ pageNumber1: 1, pageCount: 2, path: 'page-1', regionCount: 1, meanConfidence: 1,
      boxes: [{ bbox1000: [50, 60, 800, 180], confidence: 1, text: 'Received fixture source text', regionId: 'region-1' }] }],
  } }));
}

test('the canvas paints received content and resizes when its container changes', async ({ page }) => {
  await installObservedReading(page);
  await page.goto('/workspace');
  const canvas = page.locator('.compile-stage-canvas');
  await expect(page.locator('.compile-stage')).toHaveAttribute('data-visual', 'structure');
  await expect(canvas).toBeVisible();
  const before = await canvas.evaluate(c => (c as HTMLCanvasElement).width);
  await page.locator('.workspace-compile-block').evaluate(element => { (element as HTMLElement).style.width = '80%'; });
  await expect.poll(() => canvas.evaluate(c => (c as HTMLCanvasElement).width)).toBeLessThan(before);
  const painted = await canvas.evaluate(c => {
    const image = (c as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height).data;
    const colors = new Set<string>(); for (let i = 0; i < image.length; i += 16) colors.add(`${image[i]},${image[i + 1]},${image[i + 2]}`);
    return colors.size;
  });
  expect(painted).toBeGreaterThan(10);
  await capture(page, 'workspace-observed-reading');
});

test('unavailable canvas leaves visible text and accessible run information', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null }); });
  await installObservedReading(page);
  await page.goto('/workspace');
  await expect(page.locator('.compile-stage')).toHaveAttribute('data-visual', 'structure');
  await expect(page.locator('.compile-stage-canvas')).toBeHidden();
  await expect(page.locator('.compile-stage-summary')).toContainText('The visual is unavailable in this browser');
  await expect(page.locator('.compile-stage-status')).toBeVisible();
});

test('source endpoints stay attached after a width change, without a page reload', async ({ page }) => {
  await page.goto('/');
  for (const width of [1440, 1024, 768, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('#evidence').scrollIntoViewIfNeeded();
    if (width >= 1000) {
      await expect(page.locator('#evidence [data-connected="true"]')).toBeVisible();
      await expect.poll(async () => (await connectionErrors(page, '#evidence [data-evidence-pair]')).end).toBeLessThan(2);
    } else await expect(page.locator('#evidence .lv2-evidence-connector')).toBeHidden();
  }
});
