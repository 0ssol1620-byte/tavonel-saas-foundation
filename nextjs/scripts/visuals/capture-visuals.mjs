/**
 * W1-L7: capture the real product surfaces for nextjs/public/visuals and write MANIFEST.json.
 *
 * Usage (fixture build, never a deployment):
 *   PLAYWRIGHT_LOCAL_HTTP=1 NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=foundation-browser-e2e-anon-key pnpm exec next build
 *   pnpm start --hostname 127.0.0.1 --port <port>
 *   VISUALS_BASE_URL=http://127.0.0.1:<port> node scripts/visuals/capture-visuals.mjs
 *
 * Every image is a screenshot of the rendered DOM, cropped to the surface and re-encoded to WebP
 * (lossy, q80). Nothing is drawn on, recoloured or composited. The workspace surfaces read the
 * same labelled fixture the e2e suite uses (an unsigned local JWT and mocked /api routes; the
 * pipeline-board.spec.ts corpus); /explore and /dev/compile-stage need no session.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.VISUALS_BASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw Error("VISUALS_BASE_URL must be a loopback fixture server.");
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT = join(root, "public", "visuals");
// sharp is next's own image dependency; resolved through next so this script adds none.
const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json"))("sharp");
const TOKENS = process.env.VISUALS_TOKENS ?? "main app/tavonel.css";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const READING_PDF = Buffer.from("%PDF-1.4\n% pipeline-board reading fixture\n%%EOF\n", "ascii");
const READING_VERSION = sha(READING_PDF);
const READING_KEY = `w/doc-reading/${READING_VERSION}/sanitized.pdf`;
const ready = (id, size) => ({ documentId: id, versionKey: "v1", sanitizedKey: `w/${id}/v1/sanitized.pdf`, sanitizedSize: size, ocrJsonKey: `w/${id}/v1/ocr.json`, ocrJsonSize: 24_880, hasOcrJson: true, cdrReceiptKey: `w/${id}/v1/cdr-receipt.json`, ocrReviewKey: null, processingState: "ocr_ready" });
const DOCUMENTS = [
  ready("doc-read", 481_112),
  { documentId: "doc-reading", versionKey: READING_VERSION, sanitizedKey: READING_KEY, sanitizedSize: 2_204_004, ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: `w/doc-reading/${READING_VERSION}/cdr-receipt.json`, ocrReviewKey: null, processingState: "sanitized" },
  { documentId: "doc-held", versionKey: "v1", sanitizedKey: "w/doc-held/v1/sanitized.pdf", sanitizedSize: 903_211, ocrJsonKey: null, ocrJsonSize: null, hasOcrJson: false, cdrReceiptKey: "w/doc-held/v1/cdr-receipt.json", ocrReviewKey: "w/doc-held/v1/ocr-review.json", processingState: "operator_review", ocrReviewReasonCode: "OCR_LOW_TEXT_YIELD" },
  ready("doc-log", 312_640),
  ready("doc-notice", 128_004),
];
// Display names live only in the browser (lib/document-names.ts); these are the /dev/compile-stage harness file names.
const NAMES = { "doc-read": "Operations Manual r9.pdf", "doc-reading": "Services Agreement 2026.pdf", "doc-held": "scan_0140.jpg", "doc-log": "Employee Handbook 2026.pdf", "doc-notice": "Change Notice CN-2026-03.pdf" };
const FIXTURE = "e2e pipeline-board corpus (5 sources: 3 ready, 1 reading, 1 held for review), owner access, unsigned local JWT";

async function workspace(page) {
  const user = { id: "44444444-4444-4444-4444-444444444444", aud: "authenticated", role: "authenticated", email: "visuals@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${enc({ alg: "none", typ: "JWT" })}.${enc({ sub: user.id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
  await page.addInitScript(({ jwt, user, names }) => {
    localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "fixture", user }));
    localStorage.setItem("tavonel.document-names.v1", JSON.stringify(names));
  }, { jwt, user, names: NAMES });
  await page.route("https://test.supabase.co/**", (r) => r.fulfill({ json: user }));
  await page.route("**/api/access/bootstrap", (r) => r.fulfill({ json: { code: "ACCESS_READY", access: { source: "owner", accessPlan: "studio_access", billingExempt: true, expiresAt: null, limits: null, customerDataEnabled: true } } }));
  await page.route("**/api/compile-jobs", (r) => r.fulfill({ json: { code: "OK", jobs: [] } }));
  await page.route("**/api/connections", (r) => r.fulfill({ json: { connections: [] } }));
  await page.route("**/api/documents", (r) => r.fulfill({ json: { documents: DOCUMENTS } }));
  await page.route("**/api/documents/*/progress", (r) => r.fulfill({ json: { code: "OK", documentId: "doc-reading", versionKey: READING_VERSION, sourceImmutableKey: READING_KEY, sourceSha256: `sha256:${READING_VERSION}`, readUrl: "https://progress.r2.cloudflarestorage.com/progress.json" } }));
  await page.route("**/api/documents/doc-reading/source*", (r) => r.fulfill({ body: READING_PDF, contentType: "application/pdf" }));
  await page.route("https://progress.r2.cloudflarestorage.com/progress.json", (r) => r.fulfill({ json: {
    schemaVersion: "tavonel.ocr_progress.v1", sourceImmutableKey: READING_KEY, inputSha256: `sha256:${READING_VERSION}`,
    state: "reading", pagesRead: 4, pageCount: 11, regionsFound: 37,
    pages: [{ pageNumber1: 4, pageCount: 11, path: "raster", regionCount: 3, meanConfidence: 0.7412, boxes: [
      { bbox1000: [100, 120, 900, 165], confidence: 0.93, text: "Section 3 - Term and renewal", regionId: "ocr-p0004-l00001" },
      { bbox1000: [100, 200, 780, 245], confidence: 0.61, text: "The term of this agreement is one year from signature.", regionId: "ocr-p0004-l00002" },
      { bbox1000: [100, 280, 860, 325], confidence: 0.88, text: "", regionId: "ocr-p0004-l00003" },
    ] }],
  } }));
  await page.route("**/api/billing/status", (r) => r.fulfill({ json: { account: { accessPlan: null, subscriptionStatus: "inactive", creditBalance: 0, lifetimeCreditsPurchased: 0, lifetimeCreditsReversed: 0, billingHold: false, paddleCustomerId: null, subscriptionCancelAt: null, updatedAt: null } } }));
}

/** surface, route, fixture, the element to crop to, an optional step before the shot, alt text. */
const SHOTS = [
  { name: "sources-board", surface: "Sources board", route: "/workspace/sources", fixture: FIXTURE, session: true, target: "#workspace-board",
    before: async (page) => { await page.getByRole("button", { name: /^All \d+/ }).first().click(); },
    alt: "The TAVONEL Sources board with five sources in mixed states: ready to compile, one being read page by page, and one held for review." },
  { name: "evidence-inspector", surface: "Evidence Inspector", route: "/explore?act=evidence", fixture: "public /explore sample World (SEC filings corpus, public/explore-sample)", target: "[data-world-act]",
    alt: "The TAVONEL evidence view: an answer, its citation, and the highlighted region on the source page with its source version." },
  { name: "compile-timeline", surface: "Compile timeline", route: "/dev/compile-stage", fixture: "dev harness: rows built by the production buildPipeline from fixture uploads", target: ".workspace-compile-block",
    alt: "The TAVONEL compile stage: each source's progress through sending, reading, review and compiled." },
  { name: "change-center", surface: "World diff / Change Center", route: "/explore?act=change", fixture: "public /explore sample World (SEC filings corpus, public/explore-sample)", target: "[data-world-act]",
    alt: "The TAVONEL change view: two revisions side by side and the objects the new revision reached." },
  { name: "use-with-ai", surface: "MCP: Use with AI", route: "/workspace/ask", fixture: FIXTURE, session: true, target: ".one-path-ai-options",
    alt: "The TAVONEL Use with AI panel: connecting the compiled knowledge to an assistant over MCP." },
];
const WIDTHS = [[1440, 900], [390, 844]];
const MAX_CSS_HEIGHT = { 1440: 1100, 390: 1400 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const captures = [];
const failures = [];
for (const shot of SHOTS) {
  for (const [width, height] of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      if (shot.session) await workspace(page);
      await page.goto(BASE + shot.route, { waitUntil: "networkidle" });
      const target = page.locator(shot.target).first();
      await target.waitFor({ state: "visible", timeout: 20_000 });
      if (shot.before) await shot.before(page);
      // Lazy rows and deferred images paint only once on screen (content-visibility, decode=async).
      await target.scrollIntoViewIfNeeded();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      const box = await target.boundingBox();
      if (!box || box.height < 40) throw Error(`target ${shot.target} has no box`);
      const clip = { x: Math.max(0, box.x), y: box.y + (await page.evaluate(() => window.scrollY)), width: Math.min(box.width, width), height: Math.min(box.height, MAX_CSS_HEIGHT[width]) };
      const png = await page.screenshot({ clip, fullPage: true, animations: "disabled" });
      const webp = await sharp(png).webp({ quality: 80, effort: 6 }).toBuffer();
      const meta = await sharp(webp).metadata();
      const file = `${shot.name}-${width}.webp`;
      writeFileSync(join(OUT, file), webp);
      captures.push({ file, surface: shot.surface, route: shot.route, fixture: shot.fixture, tokens: TOKENS, width, deviceScaleFactor: 2, pixelWidth: meta.width, pixelHeight: meta.height, bytes: webp.length, sha256: sha(webp), alt: shot.alt });
      console.log(`ok ${file} ${meta.width}x${meta.height} ${webp.length} B`);
    } catch (error) {
      failures.push({ surface: shot.surface, route: shot.route, width, reason: String(error.message ?? error).split("\n")[0] });
      console.log(`FAIL ${shot.name}-${width}: ${error.message}`);
    } finally {
      await context.close();
    }
  }
}
await browser.close();

const manifestPath = join(OUT, "MANIFEST.json");
let diagrams = [];
try { diagrams = JSON.parse(readFileSync(manifestPath, "utf8")).diagrams ?? []; } catch { /* first run */ }
writeFileSync(manifestPath, `${JSON.stringify({ schema: "tavonel.visuals.manifest.v1", generatedBy: "nextjs/scripts/visuals/capture-visuals.mjs", captures, diagrams, notCaptured: failures }, null, 2)}\n`);
console.log(`${captures.length} captures, ${failures.length} failures`);
