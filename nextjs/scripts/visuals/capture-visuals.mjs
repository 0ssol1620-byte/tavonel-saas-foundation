/**
 * W1-L7: capture the real product surfaces for nextjs/public/visuals and write MANIFEST.json.
 *
 * The committed captures are of this branch rebased on main 6c7d3e9d (design C, #183, merged),
 * built as is: no CSS overlay, no patch. TOKENS records that build in MANIFEST. Procedure (fixture
 * build on loopback, never a deployment; one build at a time, `rm -rf .next` first):
 *   PLAYWRIGHT_LOCAL_HTTP=1 NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=foundation-browser-e2e-anon-key pnpm exec next build
 *   pnpm start --hostname 127.0.0.1 --port <port>
 *   VISUALS_TOKENS=main@<sha> VISUALS_BASE_URL=http://127.0.0.1:<port> node scripts/visuals/capture-visuals.mjs
 *   VISUALS_WRITE_MANIFEST=1 pnpm exec vitest run lib/visuals-diagrams.test.ts   # diagram rows
 * Re-take them whenever the captured surfaces' CSS changes on main: a capture of CSS that is not in
 * production is not a real product capture.
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
const TOKENS = process.env.VISUALS_TOKENS ?? "main@6c7d3e9d";

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
    // A region whose read text overflows its panel would put a product layout bug in a marketing asset: step to the next region.
    before: async (page) => {
      for (let tries = 0; tries < 8 && (await overflowing(page.locator("[data-world-act]").first())) > 0; tries += 1) {
        await page.getByRole("button", { name: /^Next/ }).first().click();
        await page.waitForTimeout(600);
      }
    },
    alt: "The TAVONEL evidence view on the public SEC sample: a source object from a filing beside its source page, with the supporting region highlighted and the text the compiler read from that region." },
  { name: "compile-timeline", surface: "Compile timeline", route: "/dev/compile-stage", fixture: "dev harness: rows built by the production buildPipeline from fixture uploads", target: ".workspace-compile-block",
    alt: "The TAVONEL compile stage at its first step: the steps Source, Read, Organize and Review & activate, with five sources listed and one marked for review." },
  { name: "change-center", surface: "World diff / Change Center", route: "/explore?act=change", fixture: "public /explore sample World (SEC filings corpus, public/explore-sample)", target: "[data-world-act]",
    alt: "The TAVONEL change view on the public SEC sample: the annual 10-K World and the filings that arrived after it, each shown with its filing date and a source page excerpt." },
  { name: "use-with-ai", surface: "MCP: Use with AI", route: "/workspace/ask", fixture: FIXTURE, session: true, target: ".one-path-ai-options",
    alt: "The TAVONEL Use with AI panel: a choice of AI assistant, my application or local files, with the assistant tab pointing to the MCP setup guide." },
];
// 390x900: tall enough that the phone Sources board fits between the sticky top bar and the fixed bottom nav.
const WIDTHS = [[1440, 900], [390, 900]];

/**
 * Elements inside root whose content is wider than their box and not clipped on purpose: text
 * running out of a button, or a panel that has turned into a sideways scroller. Either one in a
 * marketing capture shows a layout defect, so the capture steps on or refuses.
 */
const overflowing = (root) => root.evaluate((el) => [...el.querySelectorAll("*")].filter((node) => {
  const cs = getComputedStyle(node);
  return cs.display !== "inline" && cs.display !== "none" && cs.overflowX !== "hidden" && cs.overflowX !== "clip"
    && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1;
}).length);
/** Height of bars pinned to the bottom of the viewport (the phone workspace nav); a crop stops above them. */
const bottomBars = (page) => page.evaluate(() => Math.max(0, ...[...document.querySelectorAll("body *")].map((node) => {
  const cs = getComputedStyle(node); const r = node.getBoundingClientRect();
  return (cs.position === "fixed" || cs.position === "sticky") && r.height > 0 && r.bottom >= innerHeight - 1 && r.top > innerHeight / 2 ? innerHeight - r.top : 0;
})));
const MAX_CSS_HEIGHT = { 1440: 1100, 390: 1400 };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const captures = [];
const failures = [];
// VISUALS_ONLY=<name> re-shoots one surface for inspection and leaves MANIFEST alone.
const ONLY = process.env.VISUALS_ONLY;
for (const shot of SHOTS.filter((candidate) => !ONLY || candidate.name === ONLY)) {
  for (const [width, height] of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    // A returning visitor who already declined analytics: the consent sheet is not part of the surface, and no analytics loads.
    await page.addInitScript(() => localStorage.setItem("tavonel.analytics-consent.v1", JSON.stringify({ allowed: false, expires: Date.now() + 86_400_000 })));
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
      if (await overflowing(target)) throw Error(`target ${shot.target} has text overflowing its box; not captured`);
      // A fixed bottom bar (the phone workspace nav) is painted where the viewport is, over the surface.
      // Put the surface's top just under any sticky top bar, and end the crop where the bottom bar starts.
      const bar = await bottomBars(page);
      if (bar > 0) {
        await target.evaluate((el) => {
          const under = Math.max(0, ...[...document.querySelectorAll("body *")].map((node) => {
            const cs = getComputedStyle(node); const r = node.getBoundingClientRect();
            return (cs.position === "fixed" || cs.position === "sticky") && r.height > 0 && r.top <= 1 && r.bottom < innerHeight / 3 ? r.bottom : 0;
          }));
          window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - under);
        });
        await page.waitForTimeout(400);
      } else {
        // Hidden fixed chrome (the skip link sits just above the viewport) lands inside a full-page
        // crop taken from mid-page. From the top of the document it stays outside every crop.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
      }
      const box = await target.boundingBox();
      if (!box || box.height < 40) throw Error(`target ${shot.target} has no box`);
      const [scrollY, innerHeight] = await page.evaluate(() => [window.scrollY, window.innerHeight]);
      const top = box.y + scrollY;
      const barTop = bar > 0 ? scrollY + innerHeight - bar : Infinity;
      const clip = { x: Math.max(0, box.x), y: top, width: Math.min(box.width, width), height: Math.min(box.height, MAX_CSS_HEIGHT[width], barTop - top) };
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

if (ONLY) process.exit(failures.length ? 1 : 0);
const manifestPath = join(OUT, "MANIFEST.json");
// Diagram rows (diagrams, diagramsShared) are measured by lib/visuals-diagrams.test.ts; this run replaces capture rows only.
let previous = {};
try { previous = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { /* first run */ }
writeFileSync(manifestPath, `${JSON.stringify({ ...previous, schema: "tavonel.visuals.manifest.v1", generatedBy: "nextjs/scripts/visuals/capture-visuals.mjs", captures, notCaptured: failures }, null, 2)}\n`);
console.log(`${captures.length} captures, ${failures.length} failures`);
