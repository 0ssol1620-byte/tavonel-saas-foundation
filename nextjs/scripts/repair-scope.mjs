import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const sha = value => /^[0-9a-f]{40}$/i.test(value ?? '');
export const AUDITED_REPAIR_ANCHOR_SHA = '6401c3524b5294f3a395acede35e4632eb89c0fb';
export const TESTED_FULL_PASS_SHA = '6401c3524b5294f3a395acede35e4632eb89c0fb';
const pendingFullDebt = ['PR-base full CI', 'PR-base full Launch QA', 'Lighthouse', 'full release build and exact Foundation/Core pair'];
const databaseBaselineEvidence = {
  runId: 37172599535,
  commit: '6401c3524b5294f3a395acede35e4632eb89c0fb',
  pullRequestBaseSha: '7a7b4fed9e7d45ec596057f7f1cc5d0672465326',
  conclusion: 'success',
  pgTapPassedPerRun: 1333,
  pgTapRuns: 2,
  latestMigrationReplayed: false,
  latestMigrationReplayEvidence: 'not replayed by the recorded replay list',
};
const pairedPublicUiCandidatePaths = [
  'app/chrome-v2.css',
  'app/landing-v2.css',
  'app/paper-product.css',
  'components/landing-v2/hero-film-disclosure.tsx',
  'components/landing-v2/hero-film.tsx',
  'components/landing-v2/landing-page.tsx',
  'e2e/landing-hero-film-loading.spec.ts',
  'e2e/launch-qa-mobile-nav.spec.ts',
  'e2e/site-nav.spec.ts',
  'lib/one-path-contract.test.ts',
  'lib/site-nav-model.test.ts',
  'lib/site-navigation.ts',
].sort();
const baselineVitest = [
  'lib/docs-content.test.ts', 'lib/docs-highlight.test.ts', 'lib/docs-navigation.test.ts',
  'lib/retrieval-docs-parity.test.ts', 'lib/openapi-compile-jobs.test.ts',
  'lib/openapi-completeness.test.ts', 'lib/openapi-contract.test.ts',
  'lib/openapi-response-shape.test.ts', 'lib/openapi-routes.test.ts',
  'lib/route-classification.test.ts', 'lib/production-route-surface.test.ts',
];
const baselineAuth = ['lib/connector-contract.test.ts', 'lib/connector-oauth-route.test.ts'];
const docsContractTests = [
  'lib/docs-content.test.ts', 'lib/docs-highlight.test.ts', 'lib/docs-navigation.test.ts',
  'lib/retrieval-docs-parity.test.ts', 'lib/openapi-compile-jobs.test.ts',
  'lib/openapi-completeness.test.ts', 'lib/openapi-contract.test.ts',
  'lib/openapi-response-shape.test.ts', 'lib/openapi-routes.test.ts',
  'lib/developer-distribution.test.ts',
];
export const DOCS_PRICING_PREDECESSOR_SHA = '333688f096b2df59254e210b92d9491c7db6ac12';
export const DOCS_PRICING_FEATURE_PATHS = Object.freeze([
  'app/docs/page.tsx',
  'app/docs/[section]/page.tsx',
  'app/product-polish.css',
  'app/paper-product.css',
  'lib/docs-navigation.test.ts',
  'e2e/docs-reading-layout.spec.ts',
]);
const DOCS_PRICING_TRIGGER_PATHS = Object.freeze([
  'app/docs/page.tsx',
  'app/docs/[section]/page.tsx',
  'app/product-polish.css',
  'lib/docs-navigation.test.ts',
  'e2e/docs-reading-layout.spec.ts',
]);
const docsPricingBlobs = Object.freeze({
  'app/docs/page.tsx': { anchor: 'd4951fe8fab06a8fba30828e7e0d5a676bd9d07b', predecessor: 'd4951fe8fab06a8fba30828e7e0d5a676bd9d07b', candidate: '1dfcd722cdb72d9ac669677755c1a10cdd4694e5' },
  'app/docs/[section]/page.tsx': { anchor: '07d4543f24b06c410b8a13147c146a1c35d0033c', predecessor: '07d4543f24b06c410b8a13147c146a1c35d0033c', candidate: '39bd1adc6b57e00750d5a5ae7e3def42a1b3fda3' },
  'app/product-polish.css': { anchor: '645a73854ebd49d79f1b368d18ac62d424827efd', predecessor: '645a73854ebd49d79f1b368d18ac62d424827efd', candidate: '4d366bc7c5dc1740b997a228f16fe93c774f806c' },
  'app/paper-product.css': { anchor: 'ea81aa1a36afa673e905b8c9fd78fc58abc007fa', predecessor: '2191de5c2179e601c97154886534d8786e4ad405', candidate: '8d88c4fe255e984ac3336d7d5d19ff71151013c5' },
  'lib/docs-navigation.test.ts': { anchor: '27a19c495f128e42e802ea3fce13f00182c76726', predecessor: '27a19c495f128e42e802ea3fce13f00182c76726', candidate: '4b1bdbcd38336166528680b01e9f5477ca9132e8' },
  'e2e/docs-reading-layout.spec.ts': { anchor: 'ebe6a1e6ba37df99cc8139811c82584ed206a085', predecessor: 'ebe6a1e6ba37df99cc8139811c82584ed206a085', candidate: '7532c5a0d2b91f88f232ebcb80942c463742e2f5' },
});
// Final UI byte review and blob identities were supplied by the sole publishing root.
export const PUBLIC_EDITORIAL_PREDECESSOR_SHA = 'b1a69fc631ad381bd386a57f44aee2668b71a03d';
export const PUBLIC_EDITORIAL_SOURCE_BLOBS = Object.freeze({
  'app/chrome-v2.css': { predecessor: '3064d38ea14fd38bae953f72962ea2e79676e397', candidate: 'cc985994332d4b3b87a6fba5536322a3c67e97e4' },
  'app/docs/[section]/page.tsx': { predecessor: '39bd1adc6b57e00750d5a5ae7e3def42a1b3fda3', candidate: '0c79313a2cb99c63216dd51b6a5666f131444c2a' },
  'app/paper-product.css': { predecessor: '8d88c4fe255e984ac3336d7d5d19ff71151013c5', candidate: '71906f6260f209a4ac9883eb2844152762a5c2f2' },
  'components/docs/docs-toc.module.css': { predecessor: '595710a0c0b1136a3d1e3fb070cb798856e920b6', candidate: 'af1a86bea2ca75fb507722da7117335146f5fd18' },
  'components/landing-v2/landing-page.tsx': { predecessor: '35e91026f4444344a8011fe1bdf6a0a86c9553f2', candidate: '8eaad4eb13e76db17212130ccb9aefb6dcb7ea5a' },
  'components/mobile-primary-nav.tsx': { predecessor: '343da016d6e09c029dc24d019fa815d7fbedcc5b', candidate: '83fcb4cdd914b234dc51810051625dbbbf2e5705' },
  'components/pricing-page-client.tsx': { predecessor: 'eae460faaeee5c60966649c4124f631d0a0ffc1e', candidate: '146bc7154c8232f9a007f8638b0433f938268bb2' },
  'components/site-nav/desktop-primary-nav.tsx': { predecessor: 'ac8a85162913ccb7767077e660061771dc6598ce', candidate: '64a4196d57928460c1f6b40d62301a8e8df8f0c1' },
  'e2e/docs-reading-layout.spec.ts': { predecessor: '7532c5a0d2b91f88f232ebcb80942c463742e2f5', candidate: '43201c2258f36f68276883d526d22a0f13ca4941' },
  'e2e/landing-hero-mobile.spec.ts': { predecessor: 'd65421b0f2d0ff48bd5e3970388a9533562fd372', candidate: 'd60161508e446da423f35d00f81db5c45fb81e94' },
  'e2e/launch-qa-mobile-nav.spec.ts': { predecessor: 'ddc06f582de18fe14c2a52afd304a77721f1d004', candidate: 'fac602ce962b9daacf2c77b68d3823fe0cda7607' },
  'e2e/site-nav.spec.ts': { predecessor: '62ce6cfc6ba143b53eee2dd681956aba2fb4723c', candidate: 'da9c1b9b0750316f77f95fea1e875c89b90bd51d' },
  'lib/landing-v2-page.test.ts': { predecessor: '6b5f9f7e0c4f83fab07e023168d1ebeda31d7927', candidate: '0af2bc1b354cb6da5399e456d1d6c31f6adad9ec' },
  'lib/site-nav-model.test.ts': { predecessor: 'c9a62c98d6fae1b83a0c547224c137adc09213aa', candidate: 'dbbb591e363b75134eeef5fac892207dc9a747ca' },
  'lib/site-navigation.ts': { predecessor: 'c317e064948acf28e1c144cb93f1048623e44b2b', candidate: '4e0b2623c8149117b403fb43190fb3c3a856d97a' },
});
export const PUBLIC_EDITORIAL_FEATURE_PATHS = Object.freeze(Object.keys(PUBLIC_EDITORIAL_SOURCE_BLOBS).sort());
const PUBLIC_EDITORIAL_TRIGGER_PATHS = Object.freeze([
  'components/docs/docs-toc.module.css',
  'components/mobile-primary-nav.tsx',
  'components/pricing-page-client.tsx',
  'components/site-nav/desktop-primary-nav.tsx',
]);
const publicEditorialUnitTests = ['lib/docs-navigation.test.ts', 'lib/landing-v2-page.test.ts', 'lib/site-nav-model.test.ts'];
const publicEditorialBrowserTests = [
  'e2e/docs-reading-layout.spec.ts', 'e2e/landing-hero-mobile.spec.ts',
  'e2e/launch-qa-mobile-nav.spec.ts', 'e2e/site-nav.spec.ts',
];

// Root-reviewed legacy browser corrections; production UI and its existing bindings are unchanged.
export const LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA = 'e9bd49461fcb790d8110584551c16474ce387fa0';
export const LEGACY_PUBLIC_BROWSER_BLOBS = Object.freeze({
  'e2e/mobile-landing.spec.ts': { predecessor: '28460e5e01cc53f244be593254b4df6241d40857', candidate: '1ca9dd75cc6fa806ab853d9a25c3ab9f5bb8777e' },
  'e2e/site-chrome-v2.spec.ts': { predecessor: 'e6e82af9586c1916a472f0c519d4924682853a61', candidate: 'ba3c2da0b9acba965658768beec680f1673c079d' },
});
export const LEGACY_PUBLIC_BROWSER_PATHS = Object.freeze(Object.keys(LEGACY_PUBLIC_BROWSER_BLOBS).sort());

// Persisted-OCR storage safety only; no read-proof SQL or settlement producer admission.
export const PERSISTED_OCR_SAFETY_PREDECESSOR_SHA = 'e9bd49461fcb790d8110584551c16474ce387fa0';
export const PERSISTED_OCR_SAFETY_BLOBS = Object.freeze({
  'quarantine-sidecar/foundation-cdr-worker/src/ocr.ts': { predecessor: 'b39d1a08978df8d9a8f4ae8730926c7ad6cc62a6', candidate: '213c2f9803affc5748377bf95c77c108874b9f0d' },
  'quarantine-sidecar/foundation-cdr-worker/src/ocr.test.ts': { predecessor: '6276ebb6f4a555c22ad67e2f825bc2599648280f', candidate: '6352e2d99f91e819063573a7ebc90b1894fbe4d9' },
  'quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts': { predecessor: '151286bc74107bea316e1fc026e20258deeb7ef9', candidate: 'e12fac0d6f0c5e1a7cdcda002ca8124b24852934' },
  'quarantine-sidecar/foundation-cdr-worker/src/sanitize.test.ts': { predecessor: '35e0236299cff5fca045ff9d8fcfdf86bc4d53a8', candidate: 'db46bbe1e86834c834f7cd84e0c45b4ff4bcbe9d' },
});
export const PERSISTED_OCR_SAFETY_PATHS = Object.freeze(Object.keys(PERSISTED_OCR_SAFETY_BLOBS).sort());

export const WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA = '3a5be63e0901f9f1972f6793cac7891bf064af9e';
export const WORKSPACE_INTAKE_LAYOUT_BLOBS = Object.freeze({
  "app/workspace-no1.css": {
    "predecessor": "edee167dffaf655caac4bdf920de0600489364d4",
    "candidate": "6ed67aece36305aeab741d036306016e627aacb0"
  },
  "e2e/workspace-intake-layout.spec.ts": {
    "predecessor": null,
    "candidate": "a8fe356d750250e1dffca97fab39126a678ba029"
  },
  "e2e/workspace-intake-triage.spec.ts": {
    "predecessor": "108b6e76c78574c64b3ebbf4cb2035ee14df7f34",
    "candidate": "4362fe002fcd7be6fff0da4dd1a3401307a7ea14"
  },
  "lib/intake-triage-layout.test.ts": {
    "predecessor": null,
    "candidate": "c533f7e61aaf4fb0aed7524fd5960581bdb7e8c4"
  }
});
export const WORKSPACE_INTAKE_LAYOUT_PATHS = Object.freeze(Object.keys(WORKSPACE_INTAKE_LAYOUT_BLOBS).sort());
const WORKSPACE_INTAKE_LAYOUT_TRIGGER_PATHS = Object.freeze(WORKSPACE_INTAKE_LAYOUT_PATHS.filter(path => path !== 'e2e/workspace-intake-triage.spec.ts'));
export const WORKSPACE_INTAKE_LAYOUT_BROWSER_FILE = 'e2e/workspace-intake-layout.spec.ts';
export const WORKSPACE_INTAKE_LAYOUT_UNIT_FILES = Object.freeze([
  'lib/intake-triage-layout.test.ts', 'lib/workspace-mobile-layout.test.ts', 'lib/workspace-intake.test.ts',
  'components/intake-triage-review.interaction.test.ts', 'components/intake-triage-review.test.tsx',
]);

// Exact draft producer admission only; live read-proof flags and release qualification are unchanged.
export const COMPLETED_READ_PRODUCER_PREDECESSOR_SHA = '3a5be63e0901f9f1972f6793cac7891bf064af9e';
export const COMPLETED_READ_PRODUCER_BLOBS = Object.freeze({
  "app/api/internal/billing/settle/route.ts": {
    "predecessor": "2b9482138ced2ab3f5d74e2114d3c80e906ad2d4",
    "candidate": "c28f52cf308a8f710fa8b36cc152fec7822d59c8"
  },
  "lib/api-error-codes.test.ts": {
    "predecessor": "fb90f50debb93c711b9221fe62795c6fae64717d",
    "candidate": "3ef4e339b5e5af6dec8cc35b88a33286a993de53"
  },
  "lib/api-error-codes.ts": {
    "predecessor": "c90c780fc1ef92edb6c1219072bae52b70c95701",
    "candidate": "d0176d03d13a77fededa51934b5b424f42f464fb"
  },
  "lib/completed-read-proof.test.ts": {
    "predecessor": null,
    "candidate": "d42dea32eecf1a5acf538d7d0e87ee0721f83387"
  },
  "lib/completed-read-proof.ts": {
    "predecessor": null,
    "candidate": "8d5d62808ee6230072f359fe3e363e8d1c4cc6ee"
  },
  "lib/settle-route.test.ts": {
    "predecessor": "12ac16062b03ceb610802b039a4aa31fb157e039",
    "candidate": "12e79edcffb48f66b31a7ad9e9df4d1adc6abb72"
  },
  "quarantine-sidecar/foundation-cdr-worker/package.json": {
    "predecessor": "27623f918991a17ddc309c94a43c48115100829e",
    "candidate": "ec993c4480d9022e2b4311663249648ff09c372e"
  },
  "quarantine-sidecar/foundation-cdr-worker/src/completed-read.test.ts": {
    "predecessor": null,
    "candidate": "c63531d46e12a817c567e00ee81a89b4aa706a9e"
  },
  "quarantine-sidecar/foundation-cdr-worker/src/index.ts": {
    "predecessor": "2f550323fd9b1a1afbaaec0f4601c12e2ff21fd8",
    "candidate": "07895d496c2510bcaca86ccf8f0305ee9ea4d1e6"
  },
  "quarantine-sidecar/foundation-cdr-worker/src/ocr.ts": {
    "predecessor": "213c2f9803affc5748377bf95c77c108874b9f0d",
    "candidate": "6048188b69a476e31e56d3132f478b14620230a3"
  },
  "quarantine-sidecar/foundation-cdr-worker/src/sanitize.ts": {
    "predecessor": "e12fac0d6f0c5e1a7cdcda002ca8124b24852934",
    "candidate": "c9805c4822ffa9e77de92b37dbb00cb63f5c604f"
  },
  "quarantine-sidecar/foundation-cdr-worker/src/settlement.ts": {
    "predecessor": "395b2b4d5ca2985e10562479e0c9a6763409f653",
    "candidate": "406fad13d8e7cacbc9401dea9cd96c1b36cd2a74"
  },
  "shared/completedReadReceipt.ts": {
    "predecessor": null,
    "candidate": "bab520000b177ee4cdfdc8c8f9dbde2a2d701b4e"
  },
  "supabase/drafts/migrations/20261005130000_foundation_completed_read_proof.sql": {
    "predecessor": null,
    "candidate": "563154f077e8a8f7e8a4fc03eea8bb9b3245ce2f"
  },
  "supabase/drafts/tests/foundation_completed_read_proof.sql": {
    "predecessor": null,
    "candidate": "9c143f743b4d960c6f5349ea6513b7375ecde058"
  }
});
export const COMPLETED_READ_PRODUCER_PATHS = Object.freeze(Object.keys(COMPLETED_READ_PRODUCER_BLOBS).sort());
const COMPLETED_READ_PRODUCER_TRIGGER_PATHS = Object.freeze(COMPLETED_READ_PRODUCER_PATHS.filter(path => COMPLETED_READ_PRODUCER_BLOBS[path].predecessor === null));
export const COMPLETED_READ_PRODUCER_UNIT_FILES = Object.freeze([
  'lib/api-error-codes.test.ts', 'lib/settle-route.test.ts', 'lib/completed-read-proof.test.ts',
  'lib/pgtap-fixtures.test.ts', 'lib/db-rehearsal-workflow.test.ts',
]);

export const PUBLIC_UI_REPAIR_PREDECESSOR_SHA = '3a5be63e0901f9f1972f6793cac7891bf064af9e';
export const PUBLIC_UI_REPAIR_BLOBS = Object.freeze({
  "app/paper-product.css": {
    "predecessor": "71906f6260f209a4ac9883eb2844152762a5c2f2",
    "candidate": "58761db3c41e01580f5f015544ce6d17a3900768"
  },
  "e2e/site-nav.spec.ts": {
    "predecessor": "da9c1b9b0750316f77f95fea1e875c89b90bd51d",
    "candidate": "ab36bbc3203687bd0eca10043207f6557aaec228"
  },
  "e2e/launch-qa-mobile-nav.spec.ts": {
    "predecessor": "fac602ce962b9daacf2c77b68d3823fe0cda7607",
    "candidate": "b3fbdaf6643fe3f5e781d76fd4f5bbf903694a43"
  },
  "e2e/premium-craft.spec.ts": {
    "predecessor": "bd4fa1cf1a21a1930143c9ffaf229a4cff24cceb",
    "candidate": "e1cc943ced58cb6a0a24f9ca2ad79a818f670281"
  }
});
export const PUBLIC_UI_REPAIR_PATHS = Object.freeze(Object.keys(PUBLIC_UI_REPAIR_BLOBS).sort());

export const MOBILE_NAV_CONTRAST_PREDECESSOR_SHA = '2ff7c521233064915123dfbccb7680716d39cc28';
export const MOBILE_NAV_CONTRAST_PATHS = Object.freeze([
  'app/chrome-v2.css',
  'e2e/launch-qa-mobile-nav.spec.ts',
]);
export const MOBILE_NAV_CONTRAST_BLOBS = Object.freeze({
  'app/chrome-v2.css': { anchor: 'a3edbd4aea405c1bca8b361576fb371c3fe48b65', predecessor: '6da83d43e0aff2e11517d9a7ea5c82ce73eab91a', candidate: '3064d38ea14fd38bae953f72962ea2e79676e397' },
  'e2e/launch-qa-mobile-nav.spec.ts': { anchor: 'e55517b0d48a1229217e4c23eb85935d02c75061', predecessor: '6c80d0156ac5eef02f4ea3ea50e6a448eafa86a5', candidate: 'ddc06f582de18fe14c2a52afd304a77721f1d004' },
});
const docsPricingUnitTests = ['lib/design-tokens.test.ts', 'lib/docs-navigation.test.ts'];
const docsPricingBrowserTests = [
  'e2e/contrast-zoom-audit.spec.ts',
  'e2e/docs-reading-layout.spec.ts',
  'e2e/launch-qa-mobile-nav.spec.ts',
  'e2e/marketing-consent.spec.ts',
  'e2e/premium-craft.spec.ts',
  'e2e/public-layout-balance.spec.ts',
  'e2e/site-nav.spec.ts',
];

export const GOOGLE_VIEWER_ACL_PREDECESSOR_SHA = '2ff7c521233064915123dfbccb7680716d39cc28';
export const GOOGLE_VIEWER_ACL_FEATURE_PATHS = Object.freeze([
  "app/api/collections/[id]/ask/route.ts",
  "app/api/collections/[id]/download/route.ts",
  "app/api/collections/[id]/promote/route.ts",
  "app/api/collections/[id]/route.ts",
  "app/api/documents/[id]/candidates/route.ts",
  "app/api/documents/[id]/lifecycle/route.ts",
  "app/api/documents/[id]/progress/route.test.ts",
  "app/api/documents/[id]/progress/route.ts",
  "app/api/documents/[id]/source/route.ts",
  "app/api/documents/route.ts",
  "app/api/v1/collections/[id]/retrieval-index/route.ts",
  "app/api/v1/oauth-connectors/authorize/route.ts",
  "app/api/v1/oauth-connectors/callback/[provider]/route.ts",
  "app/api/v1/oauth-connectors/viewer-links/revoke/route.ts",
  "app/workspace/google-drive-access/page.tsx",
  "lib/connector-oauth-callback-route.test.ts",
  "lib/connector-oauth-route.test.ts",
  "lib/connector-oauth-store.ts",
  "lib/connector-oauth.ts",
  "lib/connector-source-access.test.ts",
  "lib/connector-source-access.ts",
  "lib/customer-source-lifecycle-route.test.ts",
  "lib/document-derived-route-access.test.ts",
  "lib/document-source-route.test.ts",
  "lib/documents-route.test.ts",
  "lib/google-drive-acl-capture.test.ts",
  "lib/google-drive-acl-capture.ts",
  "lib/google-drive-viewer-principal.test.ts",
  "lib/google-drive-viewer-link-request.test.ts",
  "lib/google-drive-viewer-link-request.ts",
  "lib/google-drive-viewer-principal.ts",
  "lib/progress-route.test.ts",
  "lib/source-import.test.ts",
  "lib/source-import.ts",
  "lib/world-promotion-current-source.test.ts",
  "supabase/drafts/google-viewer-principal-boundary.sql",
  "supabase/tests/google_viewer_principal_boundary.sql",
]);
const GOOGLE_VIEWER_ACL_WORKSPACE_OVERLAP_PATHS = new Set([
  'app/api/documents/[id]/progress/route.test.ts',
  'app/api/documents/[id]/progress/route.ts',
]);
export const GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS = Object.freeze({
  "app/api/collections/[id]/ask/route.ts": "7162910f5cf7222b1f632251b362f179094b4dd5",
  "app/api/collections/[id]/download/route.ts": "95bfe77a274510176b35b87582a521dccaf45e68",
  "app/api/collections/[id]/promote/route.ts": "89b7104906069a8fdaec24e3f4101a032b54a121",
  "app/api/collections/[id]/route.ts": "611ba0ef7004357b236c5d7ca69baf770bd05c1c",
  "app/api/documents/[id]/candidates/route.ts": "b90ed727cf121f73ce8191dba683a4a94cd7de61",
  "app/api/documents/[id]/lifecycle/route.ts": "f13f805c8244062540cb0b3630ffc8661808dbfa",
  "app/api/documents/[id]/progress/route.test.ts": "54e35fd493a56857cdf6393167017538e826aa2e",
  "app/api/documents/[id]/progress/route.ts": "c2ab73f10f2590eec7118fe85aa98bd6d023a305",
  "app/api/documents/[id]/source/route.ts": "c5c98949fa0625c0e93c966541f8e08a2203d4ac",
  "app/api/documents/route.ts": "3d3318f72ff5989e8c6625a7638d35e35a8a6bcd",
  "app/api/v1/collections/[id]/retrieval-index/route.ts": "faff378dc4fba34e46c2d17a18fc4908682f4fe8",
  "app/api/v1/oauth-connectors/authorize/route.ts": "7ead0b651b754b49d316487bf3cdf6ece0cba00c",
  "app/api/v1/oauth-connectors/callback/[provider]/route.ts": "f52887c35339a6eea9eed54995f9ecf0de8a5f10",
  "app/api/v1/oauth-connectors/viewer-links/revoke/route.ts": null,
  "app/workspace/google-drive-access/page.tsx": null,
  "lib/connector-oauth-callback-route.test.ts": null,
  "lib/connector-oauth-route.test.ts": "abec86782e9ee19abd8b425a5881db3eabad16f2",
  "lib/connector-oauth-store.ts": "63cd31a4301c7b950b0c0674d4165ee414d72a31",
  "lib/connector-oauth.ts": "8ceb9c52ff6df1a355063cc696f582be88dac127",
  "lib/connector-source-access.test.ts": "8a7f1541b0f0bb03ea3a298fde9956d2eedd37a0",
  "lib/connector-source-access.ts": "48f50d153a5b2ba82fe904bd24aa040ff2074bf7",
  "lib/customer-source-lifecycle-route.test.ts": "05c953dd7fd3421710bc434ca6ed30f56cfe5f4b",
  "lib/document-derived-route-access.test.ts": "a6f7ce65406dd56d70557773a8566617496f0f96",
  "lib/document-source-route.test.ts": "becdaaac2ebdee81422a9724bc8a709d416f0879",
  "lib/documents-route.test.ts": "20e35588b914978bc9537996a0b9b851037cb12e",
  "lib/google-drive-acl-capture.test.ts": null,
  "lib/google-drive-acl-capture.ts": null,
  "lib/google-drive-viewer-principal.test.ts": null,
  "lib/google-drive-viewer-link-request.test.ts": null,
  "lib/google-drive-viewer-link-request.ts": null,
  "lib/google-drive-viewer-principal.ts": null,
  "lib/progress-route.test.ts": null,
  "lib/source-import.test.ts": "3fdc5429ee4564a8941636b701ee78e8efdff015",
  "lib/source-import.ts": "b444bc6e8126129fb839cdc672689a435039e555",
  "lib/world-promotion-current-source.test.ts": "b471b237577a1fa1a62edae5bcb2b34936384707",
  "supabase/drafts/google-viewer-principal-boundary.sql": null,
  "supabase/tests/google_viewer_principal_boundary.sql": null,
});
export const GOOGLE_VIEWER_ACL_FINAL_BLOBS = Object.freeze({
  "app/api/collections/[id]/ask/route.ts": "f4651addc6dfd569e05576f1a3e6700f1c793f51",
  "app/api/collections/[id]/download/route.ts": "69f2ddc6ac168b7dfce64acdcb3f9af6856253e6",
  "app/api/collections/[id]/promote/route.ts": "da71754822552b7299d4eb6b1d9d9009a71d8a41",
  "app/api/collections/[id]/route.ts": "5006034407d47b7cd389542c484e11ebb2bc8e25",
  "app/api/documents/[id]/candidates/route.ts": "601a35aa5467208a0461b95626053f16e8dec713",
  "app/api/documents/[id]/lifecycle/route.ts": "33ae42fcce99173238044e48d9f05b75bdaa9c99",
  "app/api/documents/[id]/progress/route.test.ts": "02d8c66affc97e502089b981265fc2d21e219cee",
  "app/api/documents/[id]/progress/route.ts": "c14b5d8940019ea84e3ca01e7fbfe73cb7c4d7b5",
  "app/api/documents/[id]/source/route.ts": "7156d279fb876547aefa8e74f32b9e1450582177",
  "app/api/documents/route.ts": "d9fa3ba6db0ccef3dd362b951dc2e03aae847433",
  "app/api/v1/collections/[id]/retrieval-index/route.ts": "9b9c1b89636c228d716ede877d302a526936819e",
  "app/api/v1/oauth-connectors/authorize/route.ts": "8dcd8bdbe2806e79c6d0795db4181531bfc4a842",
  "app/api/v1/oauth-connectors/callback/[provider]/route.ts": "b9fe645b0422b2c76c762b5cfc20093b40704d4c",
  "app/api/v1/oauth-connectors/viewer-links/revoke/route.ts": "49529f8e70f47de048e32e67656be96329b1c0e2",
  "app/workspace/google-drive-access/page.tsx": "c4d13bb27471e8648cf51b984c1f2107ec11ef21",
  "lib/connector-oauth-callback-route.test.ts": "669179d61004ea84ad81dde008be14bb6f826171",
  "lib/connector-oauth-route.test.ts": "f53031262d65b252524cf5c4f0d0424b8c1ebcf5",
  "lib/connector-oauth-store.ts": "85dd2efe233fc7f555e914addacc494567b6afc9",
  "lib/connector-oauth.ts": "f8fe20c15764678ef9922ca5d3b8f6fd069b959e",
  "lib/connector-source-access.test.ts": "13e1d781ebbbf7cba116c03a919e311d0a5a749e",
  "lib/connector-source-access.ts": "9b82ed3c9d2927e33967cf0f7106abc0587822e8",
  "lib/customer-source-lifecycle-route.test.ts": "3c8dc8a105ca4fdbb309692db8aa81d85a551ab3",
  "lib/document-derived-route-access.test.ts": "1d482d67c4e8e375ac262e79333a10b77d7a5064",
  "lib/document-source-route.test.ts": "6b9512f82b6f8c2e0295b2f928864fc4709528e8",
  "lib/documents-route.test.ts": "77150f40f3df8d413929c906c564e2e259551fa3",
  "lib/google-drive-acl-capture.test.ts": "3d10ea3a345bd5a7acaa1a5726ad93b152fa1fa5",
  "lib/google-drive-acl-capture.ts": "489500dd94fce18950e2f1845e442a6bbe4b9404",
  "lib/google-drive-viewer-principal.test.ts": "311bdfd3cae11a40eed9c1bec15b8e4851a26b99",
  "lib/google-drive-viewer-link-request.test.ts": "980bbb2a5bb00a5933358bfab5a0c96a4012384b",
  "lib/google-drive-viewer-link-request.ts": "01d25fbdaf50da048e8387ec219c0cbd85878f87",
  "lib/google-drive-viewer-principal.ts": "5a4e86b55cd315293f42b41d251591df74c09ded",
  "lib/progress-route.test.ts": "4a5721cc5b4a6aa528926c47be23b92eefddd40c",
  "lib/source-import.test.ts": "9af2a5b273af28b9d7409ba98cb47821e9a9a85f",
  "lib/source-import.ts": "60a0e089a27d0d90e9acff21c0f13bf0d76ee3df",
  "lib/world-promotion-current-source.test.ts": "cf4053ec354b045acfd3d3508778143ee0e7a4a9",
  "supabase/drafts/google-viewer-principal-boundary.sql": "d1cb532b646742cade16407e64da07dcda0499f2",
  "supabase/tests/google_viewer_principal_boundary.sql": "144d3262ee2f2208fe96281283bcb8f0dc0aab9d",
});
export const GOOGLE_VIEWER_ACL_UNIT_TESTS = Object.freeze([
  "app/api/documents/[id]/progress/route.test.ts",
  "lib/connector-oauth-callback-route.test.ts",
  "lib/connector-oauth-route.test.ts",
  "lib/connector-oauth-store.test.ts",
  "lib/connector-oauth.test.ts",
  "lib/connector-source-access.test.ts",
  "lib/connector-source-identity.test.ts",
  "lib/customer-source-lifecycle-route.test.ts",
  "lib/document-derived-route-access.test.ts",
  "lib/document-source-route.test.ts",
  "lib/documents-route.test.ts",
  "lib/google-drive-acl-capture.test.ts",
  "lib/google-drive-viewer-principal.test.ts",
  "lib/google-drive-viewer-link-request.test.ts",
  "lib/progress-route.test.ts",
  "lib/source-import.test.ts",
  "lib/world-promotion-current-source.test.ts",
]);

export const GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA = '1e1d46ad428aa04081bef359d7dd8012d0d87834';
export const GOOGLE_DRIVE_ACL_REFRESH_BOUNDARY_PATH = 'supabase/drafts/google-viewer-principal-boundary.sql';
export const GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS = new Set([
  'lib/google-drive-acl-capture.ts',
  GOOGLE_DRIVE_ACL_REFRESH_BOUNDARY_PATH,
]);
export const GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS = Object.freeze({
  'app/api/internal/jobs/acl-refresh/route.ts': { predecessor: null, candidate: '515550b2e3f1a233d7e556556d5f82f3e43d33d3' },
  'app/api/internal/jobs/run/route.ts': { predecessor: '9fa4e666ad79ea2f63f2bc4c06993f3e926dd170', candidate: '5f3f522a774ba2b8cae70e3b9e741e3f80863f48' },
  'lib/acl-refresh-core.d.mts': { predecessor: null, candidate: 'fb5beb635d6a1e96a2dd4de16ad5862990e22ca4' },
  'lib/acl-refresh-core.mjs': { predecessor: null, candidate: '642e86e62797e38b23fe5642068360d7315e6f2a' },
  'lib/acl-refresh-core.test.mjs': { predecessor: null, candidate: 'ead351a2e2fc6bd80e9f21b4f0c8ec52d648bf3e' },
  'lib/google-drive-acl-capture.ts': { predecessor: '489500dd94fce18950e2f1845e442a6bbe4b9404', candidate: 'd0889c42500f2904a8f222ca62db9478391420bd' },
  'lib/google-drive-acl-refresh.test.ts': { predecessor: null, candidate: '090a8710d9641d80169899961c07b07dad002939' },
  'lib/google-drive-acl-refresh.ts': { predecessor: null, candidate: '86103ec8da2facb984b464cf50245567cbd014df' },
  'lib/internal-worker-auth.test.ts': { predecessor: null, candidate: '47a08a84b671f59a8d8078cd109d7f1fc9fe7cec' },
  'lib/internal-worker-auth.ts': { predecessor: null, candidate: 'e0bea7bc42b4e843acd5fbfc1b10744afb5f5516' },
  'lib/safe-url.test.ts': { predecessor: '02de32e66e9aa6a7aa57d1f8a5effcc3f4b2a03e', candidate: '7b744f4529b2d3ee8bbe5f99488478e639dd3edf' },
  'lib/safe-url.ts': { predecessor: '9ad9392b05ccb854a084c61dd125774ff8bf4cdd', candidate: 'ba3e960af889be0ee33d37105040fe98988ab4f9' },
  'supabase/drafts/google-drive-acl-refresh/README.md': { predecessor: null, candidate: 'c5fe1c4c5efa74ff4b001c111f4c6f11d2257412' },
  'supabase/drafts/google-drive-acl-refresh/queue.sql': { predecessor: null, candidate: '61b9f81e6c0254d344f2761ed0a9551a6cebfea7' },
  'supabase/drafts/google-drive-acl-refresh/tests/google_drive_acl_refresh_queue.sql': { predecessor: null, candidate: 'd2c721a0499c18a9b494e4abcd9ed06c2857d615' },
  'supabase/drafts/google-viewer-principal-boundary.sql': { predecessor: 'd1cb532b646742cade16407e64da07dcda0499f2', candidate: '3a38a855d1c37bd23784fe5a98f4edfda4dd0f95' },
});
export const GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS = Object.freeze(Object.keys(GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS).sort());
export const GOOGLE_DRIVE_ACL_REFRESH_TRIGGER_PATHS = Object.freeze(
  GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS.filter(path => !GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path)),
);
export const GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS = Object.freeze([
  'lib/acl-refresh-core.test.mjs',
  'lib/google-drive-acl-capture.test.ts',
  'lib/google-drive-acl-refresh.test.ts',
  'lib/google-drive-viewer-principal.test.ts',
  'lib/internal-worker-auth.test.ts',
  'lib/pgtap-fixtures.test.ts',
  'lib/safe-url.test.ts',
]);

export const ASYNC_COMPILE_JOB_AUTHORITY_PREDECESSOR_SHA = '2ff7c521233064915123dfbccb7680716d39cc28';
export const ASYNC_COMPILE_JOB_AUTHORITY_PATHS = Object.freeze([
  'app/api/compile-jobs/route.test.ts',
  'app/api/compile-jobs/route.ts',
  'lib/collection-compile-run.test.ts',
  'lib/collection-compile-run.ts',
  'lib/compile-job-authority.test.ts',
  'lib/compile-job-authority.ts',
  'lib/compile-job-idempotency.test.ts',
  'lib/compile-job-scheduling.test.ts',
  'lib/compile-job-store.ts',
  'lib/compile-job-worker.test.ts',
  'lib/compile-job-worker.ts',
  'lib/global-collection-compile.test.ts',
  'supabase/drafts/compile-job-viewer-authority.sql',
  'supabase/tests/compile_job_viewer_authority.sql',
]);
export const ASYNC_COMPILE_JOB_AUTHORITY_FINAL_BLOBS = Object.freeze({
  'app/api/compile-jobs/route.test.ts': 'b84a3f05f74fb49d8e3875087b8d41bc63e7dd02',
  'app/api/compile-jobs/route.ts': '6ffd4fb95cbb19f3cd63f01b12edb59ed29a53ba',
  'lib/collection-compile-run.test.ts': '0d454d42e5c6ac26934dcc07a03efde1cd5ca46f',
  'lib/collection-compile-run.ts': '710abfb3a948cf3b6e879c02fe687d92d38686bf',
  'lib/compile-job-authority.test.ts': '36cd1e1fe75cb4cbc75637c4367d88a7a58549a8',
  'lib/compile-job-authority.ts': 'fe3ef33065230b435a6051b81d0ed3f31f4a3149',
  'lib/compile-job-idempotency.test.ts': '454ae57c0526dcdff847fd61472e843988766bab',
  'lib/compile-job-scheduling.test.ts': 'c50cbc627e6f7a7e85a805c0648ca704aaeb096b',
  'lib/compile-job-store.ts': '30afb87e0c69168be4f36569f5e669ab63fd5440',
  'lib/compile-job-worker.test.ts': '16dc3c13c73dae9af9224a42fc6b1d9b34667ce6',
  'lib/compile-job-worker.ts': 'f065033ce7306bda0c0d6fa2d0cc29084f74b544',
  'lib/global-collection-compile.test.ts': '046898a4ebdfed502722661915afbb7634ad21c4',
  'supabase/drafts/compile-job-viewer-authority.sql': 'f9221eda0a1eb1d1df578b6ec3aeed9ba187319c',
  'supabase/tests/compile_job_viewer_authority.sql': 'b2c9e95a51273b14cf809b83d6f96f964eddb2be',
});
export const ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS = Object.freeze([
  'app/api/compile-jobs/route.test.ts',
  'lib/collection-compile-run.test.ts',
  'lib/compile-job-authority.test.ts',
  'lib/compile-job-idempotency.test.ts',
  'lib/compile-job-migration.test.ts',
  'lib/compile-job-scheduling.test.ts',
  'lib/global-collection-compile.test.ts',
  'lib/compile-job-worker.test.ts',
  'lib/connector-source-access.test.ts',
  'lib/connector-source-identity.test.ts',
  'lib/google-drive-viewer-link-request.test.ts',
  'lib/google-drive-viewer-principal.test.ts',
]);

export const INTAKE_TRIAGE_PREDECESSOR_SHA = '8944cbfb0335f3120c71dc823b4106da5de4a6af';
export const INTAKE_TRIAGE_REPAIR_CONFIG_BLOB = '6ae26121a08e403d45a05387901ce59c41cc0f12';
export const INTAKE_TRIAGE_SOURCE_BLOBS = Object.freeze({
  'app/api/uploads/approval/route.ts': {
    predecessor: "cc645ca51f92610f52ab6e957e0485323ff9da56",
    candidate: "a5943ee40741cf114a61a85286056d977e2fd886"
  },
  'app/api/uploads/capability/route.ts': {
    predecessor: "419f132a6916bd67796dfbeebc5e3d5e1ff62f72",
    candidate: "c242d9756d1761da98767b71dacf0710a2ff755a"
  },
  'app/api/uploads/confirm/route.ts': {
    predecessor: "5e5e08ef67a3c98dccff62531833db697bca235f",
    candidate: "97911e0dcd98d1bccb839af8e1fa70120079cf10"
  },
  'app/api/v1/uploads/quote/route.ts': {
    predecessor: "8a47fbcdbb04e4111c33e1da6ee67701fc34ef8c",
    candidate: "b57ea6ebaf1c0ff7f1e0679bd23e033ee9a56941"
  },
  'app/api/v1/uploads/triage/complete/route.ts': {
    predecessor: null,
    candidate: "8ad45c0212028d2d6e6eb1b1c8b27f83ca36446c"
  },
  'app/api/v1/uploads/triage/preflight/route.ts': {
    predecessor: null,
    candidate: "dc52896a81b97c988ac252345fdf7396df5d69a5"
  },
  'app/api/v1/uploads/triage/receipt/route.ts': {
    predecessor: null,
    candidate: "3e1e3ca0209a0979793bb49d91283a9c8f43966b"
  },
  'app/api/v1/uploads/triage/stage/route.ts': {
    predecessor: null,
    candidate: "2045df8d8f3633d9651b6a9aec8c8ecdb8958032"
  },
  'app/workspace/page.tsx': {
    predecessor: "922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0",
    candidate: "e9df90d1ef58006e4268d703917fed84be1bd5e8"
  },
  'components/intake-triage-review.interaction.test.ts': {
    predecessor: null,
    candidate: "4dd927224df839b7c9ef1624e0cbd47ad8bd3b04"
  },
  'components/intake-triage-review.test.tsx': {
    predecessor: null,
    candidate: "be27ee739c48ea0286f4d5b71f0f414fa3b336c6"
  },
  'components/intake-triage-review.tsx': {
    predecessor: null,
    candidate: "a77d49c5cb58563de34523888b5523245b022ec5"
  },
  'e2e/workspace-intake-triage.spec.ts': {
    predecessor: null,
    candidate: "108b6e76c78574c64b3ebbf4cb2035ee14df7f34"
  },
  'lib/compute-reservation.ts': {
    predecessor: "792885c3b366b6df91f0583e9599540cc7f0509a",
    candidate: "8f5fdb40d2fb3f5002cdd60518338c8ef1f63162"
  },
  'lib/compute-reservation.test.ts': {
    predecessor: "79f42356c585d438b5c58a916f48e47dbb09ab44",
    candidate: "f07e2e8620fe5041a3f99098a9d1accf689219f3"
  },
  'lib/intake-approval-route.test.ts': {
    predecessor: "ab16bdf3128e8e8064c39ee96e566947e11cee79",
    candidate: "a344ab60131bd87bb6028429511e912cbcf237a1"
  },
  'lib/intake-approval.test.ts': {
    predecessor: "34732cf5c4b487538f3d46b7b50e277b3fc162ea",
    candidate: "ac9efef5f367b46ede67094025bc333a6ddd4211"
  },
  'lib/intake-approval.ts': {
    predecessor: "dd1d0368828d460baa3a0a0ada15f0f00a85294b",
    candidate: "dfecbfa78f8553faa5f003f8f7c567d543b3c13c"
  },
  'lib/intake-capability-sealed-version.test.ts': {
    predecessor: null,
    candidate: "b7f65405feb0645f1cf5b1f484df4d527ed25368"
  },
  'lib/intake-rollout-compatibility.test.ts': {
    predecessor: null,
    candidate: "c43b494636a3bcd7c3dc2694bf661a0a999f8933"
  },
  'lib/intake-rollout-compile-compatibility.test.ts': {
    predecessor: null,
    candidate: "265da87b43235ca030963094aa176fa9ef58a7b1"
  },
  'lib/intake-rollout-server-db-mismatch.test.ts': {
    predecessor: null,
    candidate: "9dd44a2518ed2296977591e811a25493db843677"
  },
  'lib/intake-seal-fencing.test.ts': {
    predecessor: null,
    candidate: "df633d73c8879499265652f5212c007ac2b6e3ce"
  },
  'lib/intake-seal-fencing.ts': {
    predecessor: null,
    candidate: "d61863b965ed352c7e9b11d0c6b9e593d0470dff"
  },
  'lib/intake-triage-client.test.ts': {
    predecessor: null,
    candidate: "436177dc3c61d6b8e9019a859990daa1eb88da60"
  },
  'lib/intake-triage-client.ts': {
    predecessor: null,
    candidate: "ea1e3f2c436291fa32940622bd5909587ed35945"
  },
  'lib/intake-triage-paid-flow.test.ts': {
    predecessor: null,
    candidate: "0b21721aa3d86fb3aa943833b7a83fd27f235cb6"
  },
  'lib/intake-triage-rollout.ts': {
    predecessor: null,
    candidate: "3d15512574d4ef3e8e47c3b9dbe3cd77c20cef4c"
  },
  'lib/intake-triage-processing-quote.test.ts': {
    predecessor: null,
    candidate: "741222388918067eb1d081f734d7045df8ecf11a"
  },
  'lib/intake-triage-routes.test.ts': {
    predecessor: null,
    candidate: "553ae50234b2ad8857f0481d25b298dc6276c619"
  },
  'lib/intake-triage-server.test.ts': {
    predecessor: null,
    candidate: "715990a34255c5662cd611bd6a32ba3c40a2bb17"
  },
  'lib/intake-triage-server.ts': {
    predecessor: null,
    candidate: "f51bdeecd6e44c98f4eef108736ac8272e5b8df5"
  },
  'lib/intake-triage-stream.test.ts': {
    predecessor: null,
    candidate: "9faa5dc727171697b4efc376942f5dc0f002e2e8"
  },
  'lib/intake-triage-stream.ts': {
    predecessor: null,
    candidate: "8dc95cc99754fafbdaaac0a0f325a3691525a21d"
  },
  'lib/intake-triage.test.ts': {
    predecessor: null,
    candidate: "f5042559265429b6713737289009c544636a1ac8"
  },
  'lib/intake-triage.ts': {
    predecessor: null,
    candidate: "03860a9ef328ef70bd41de089af4216e06ae2164"
  },
  'lib/r2-presign.ts': {
    predecessor: "5a2ec86af6a631f26f416f0b023c7a9270b6250a",
    candidate: "cce02d44c7b13fab1fd352c02659ae1caf347ee8"
  },
  'lib/r2-synthetic-canary.ts': {
    predecessor: "a935209ccdd54a98f5e3889699f796f5f8fc78e4",
    candidate: "2c8a781c2a0e00c6870c88a82bcf4364a01c9871"
  },
  'lib/r2-triage-seal.test.ts': {
    predecessor: null,
    candidate: "35c3944c0ab700f6815d31c7eb1ca8e4e6679897"
  },
  'playwright.config.ts': {
    predecessor: "d963db6f7f32b730fd16031549b3335ddbce65bc",
    candidate: "714b979d42627a61aa32610880bd7dcd248e1a0a"
  },
  'supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql': {
    predecessor: null,
    candidate: "5894d007544fc4584e4aca4896a7cc10fb8083ab"
  },
  'supabase/drafts/tests/foundation_intake_triage_binding.sql': {
    predecessor: null,
    candidate: "dd65bbee72aafa7f0439827bfdc1df83aa842a53"
  }
});
export const INTAKE_TRIAGE_FEATURE_PATHS = Object.freeze(Object.keys(INTAKE_TRIAGE_SOURCE_BLOBS).sort());
export const INTAKE_TRIAGE_TRIGGER_PATHS = Object.freeze([
  'app/api/v1/uploads/triage/complete/route.ts',
  'app/api/v1/uploads/triage/preflight/route.ts',
  'app/api/v1/uploads/triage/receipt/route.ts',
  'app/api/v1/uploads/triage/stage/route.ts',
  'components/intake-triage-review.interaction.test.ts',
  'components/intake-triage-review.test.tsx',
  'components/intake-triage-review.tsx',
  'e2e/workspace-intake-triage.spec.ts',
  'lib/intake-triage-client.ts',
  'lib/intake-triage-paid-flow.test.ts',
  'lib/intake-triage-rollout.ts',
  'lib/intake-triage-processing-quote.test.ts',
  'lib/intake-triage-routes.test.ts',
  'lib/intake-triage-server.ts',
  'lib/intake-triage-stream.test.ts',
  'lib/intake-triage-stream.ts',
  'lib/intake-triage.test.ts',
  'lib/intake-triage.ts',
  'supabase/drafts/migrations/20261004120000_foundation_intake_triage_v3.sql',
  'supabase/drafts/tests/foundation_intake_triage_binding.sql',
]);
export const INTAKE_TRIAGE_UNIT_TESTS = Object.freeze([
  'components/intake-triage-review.interaction.test.ts',
  'components/intake-triage-review.test.tsx',
  'lib/intake-approval-route.test.ts',
  'lib/intake-approval.test.ts',
  'lib/compute-reservation.test.ts',
  'lib/intake-triage-paid-flow.test.ts',
  'lib/intake-capability-sealed-version.test.ts',
  'lib/intake-rollout-compatibility.test.ts',
  'lib/intake-rollout-compile-compatibility.test.ts',
  'lib/intake-rollout-server-db-mismatch.test.ts',
  'lib/intake-seal-fencing.test.ts',
  'lib/intake-triage-client.test.ts',
  'lib/intake-triage-processing-quote.test.ts',
  'lib/intake-triage-routes.test.ts',
  'lib/intake-triage-server.test.ts',
  'lib/intake-triage-stream.test.ts',
  'lib/intake-triage.test.ts',
  'lib/r2-triage-seal.test.ts',
]);
export const INTAKE_TRIAGE_EXISTING_REGRESSION_TESTS = Object.freeze([
  'lib/api-error-codes.test.ts',
  'lib/customer-data-admission-routes.test.ts',
  'lib/intake-approval-route.test.ts',
  'lib/intake-approval.test.ts',
  'lib/upload-confirm-route.test.ts',
  'lib/upload-release-route.test.ts',
  'lib/source-intake.test.ts',
  'lib/compute-reservation.test.ts',
  'lib/r2-presign.test.ts',
  'lib/r2-synthetic-canary.test.ts',
]);
export const INTAKE_TRIAGE_BROWSER_FILE = 'e2e/workspace-intake-triage.spec.ts';


const uploadTests = [
  'lib/api-error-codes.test.ts', 'lib/customer-data-admission-routes.test.ts',
  'lib/intake-approval-route.test.ts', 'lib/intake-approval.test.ts',
  'lib/upload-confirm-route.test.ts', 'lib/upload-release-route.test.ts',
];
const siteNavigationTests = ['lib/one-path-contract.test.ts', 'lib/site-nav-model.test.ts'];
const responsiveNavigationBrowsers = ['e2e/site-nav.spec.ts', 'e2e/launch-qa-mobile-nav.spec.ts'];
const landingLegacyRegressionTests = [
  'lib/brand-copy.test.ts',
  'lib/landing-v2-traceability.test.ts',
  'lib/visual-refinement.test.ts',
];
const sharedVisualRegressionTest = 'lib/visual-refinement.test.ts';
export const WORKSPACE_SOURCE_UNIT_FILES = Object.freeze([
  'app/api/documents/[id]/progress/route.test.ts',
  'components/compile-stage.test.tsx',
  'lib/compile-stage-view.test.ts',
  'lib/connector-source-access.test.ts',
  'lib/connector-source-identity.test.ts',
  'lib/document-derived-route-access.test.ts',
  'lib/document-source-route.test.ts',
  'lib/ocr-progress.test.ts',
  'lib/production-hardening.test.ts',
  'lib/progress-poll.test.ts',
  'lib/r2-progress-capability.test.ts',
  'lib/r2-source-pdf.test.ts',
  'lib/source-version-guard.test.ts',
  'lib/workspace-compile-floor-and-ceiling.test.ts',
]);
export const WORKSPACE_SOURCE_BROWSER_FILE = 'e2e/workspace-source-observation.spec.ts';
export const WORKSPACE_SOURCE_FEATURE_PATHS = Object.freeze([
  'app/api/documents/[id]/progress/route.test.ts',
  'app/api/documents/[id]/progress/route.ts',
  'app/dev/compile-stage/page.tsx',
  'app/workspace/page.tsx',
  'components/compile-stage.module.css',
  'components/compile-stage.test.tsx',
  'components/compile-stage.tsx',
  'e2e/workspace-source-observation.spec.ts',
  'lib/ocr-progress.test.ts',
  'lib/ocr-progress.ts',
  'lib/compile-stage-view.test.ts',
  'lib/progress-poll.test.ts',
]);
export const WORKSPACE_SOURCE_REPAIR_CONFIG = 'vitest.repair-scope.config.ts';
export const WORKSPACE_SOURCE_FEATURE_BLOBS = Object.freeze({
  'app/api/documents/[id]/progress/route.test.ts': '54e35fd493a56857cdf6393167017538e826aa2e',
  'app/api/documents/[id]/progress/route.ts': 'c2ab73f10f2590eec7118fe85aa98bd6d023a305',
  'app/dev/compile-stage/page.tsx': '65fe16411e0fee1e026f40e82dd9d96fda6ad294',
  'app/workspace/page.tsx': '922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0',
  'components/compile-stage.module.css': 'f5d3855553275a1b58105c3362e4dfdedadbe740',
  'components/compile-stage.test.tsx': 'c8f82fc84db149c855052417a5e6abcf98b37a0e',
  'components/compile-stage.tsx': 'fb8c4a9020afab4ee9496e2133588e8ebf446e55',
  'e2e/workspace-source-observation.spec.ts': 'b3d630da8751062dfbb24c0cd80d82c665ae2311',
  'lib/ocr-progress.test.ts': '766e4ca5fcde9156f5d60e99d5397ac6206ce40a',
  'lib/ocr-progress.ts': 'ddd83aea6ad50b3b4b4a1c4d1f5c3a09d752e0cf',
  'lib/compile-stage-view.test.ts': '505bd18cd58dff06294998715e95e09fc312ea3b',
  'lib/progress-poll.test.ts': '2145bf161cf7db871fa55180d7ec02e06729e16c',
});
const WORKSPACE_SOURCE_ACL_VARIANT_BLOBS = Object.freeze({
  'app/api/documents/[id]/progress/route.test.ts': GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.test.ts'],
  'app/api/documents/[id]/progress/route.ts': GOOGLE_VIEWER_ACL_FINAL_BLOBS['app/api/documents/[id]/progress/route.ts'],
});
export const WORKSPACE_SOURCE_FIXTURE_PATCH_SHA256 = '0acc6b5613e65d183ab0688c2d02c76eff7353d8161e50025fe49e35fb010b6c';
export const WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS = Object.freeze({
  'app/dev/compile-stage/page.tsx': '15325287c9cbe9c367093d724828f02729db4119',
  'lib/compile-stage-view.test.ts': '0d35f28062e1f8c76bcd7bf24798ed739ced876d',
  'lib/progress-poll.test.ts': '52092bd8be3470c5cb7f8a675a1b4fc409969bf3',
});
const reviewedWorkspacePageBlobs = Object.freeze({
  base: '3e4c6b5f9227cbbff7238c28bcd8d25770006eb3',
  result: '922c4f2b676661bfbcfcaabf1b7cc27cd6461ee0',
});
const reviewedWorkspaceBrowserBlob = 'b3d630da8751062dfbb24c0cd80d82c665ae2311';
const reviewedScopedConfigBlob = 'f2065bec72452aa1c80b29afb2768339b7397db8';
const reviewedScopedConfigGlobalBlob = '91bb009bae9930952594c8fb8164b714a43e8686';
const reviewedBrowserFiles = new Set([
  'e2e/contrast-zoom-audit.spec.ts',
  'e2e/docs-reading-layout.spec.ts',
  'e2e/premium-craft.spec.ts',
  'e2e/public-layout-balance.spec.ts',
  'e2e/detail-integrity.spec.ts',
  'e2e/failure-states-audit.spec.ts',
  WORKSPACE_SOURCE_BROWSER_FILE,
  'e2e/site-nav.spec.ts',
  'e2e/launch-qa-mobile-nav.spec.ts',
  'e2e/landing-hero-mobile.spec.ts',
  'e2e/landing-hero-film-loading.spec.ts',
  'e2e/marketing-consent.spec.ts',
]);

export function normalizePath(raw) {
  // Brackets are allowed for literal Next route segments such as [id] and [...slug].
  // Other shell syntax, controls, backslashes, and non-ASCII path spellings fail closed.
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_./\[\]-]+$/.test(raw)) {
    throw new Error(`Unsupported changed path encoding: ${JSON.stringify(raw)}`);
  }
  const path = raw.startsWith('nextjs/') ? raw.slice('nextjs/'.length) : raw;
  if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe changed path: ${JSON.stringify(raw)}`);
  }
  return path;
}

export function parseNulPaths(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  if (!text) return [];
  if (!text.endsWith('\0')) throw new Error('Git filename output was not NUL terminated.');
  return text.slice(0, -1).split('\0');
}

export function collectChangedPaths({ repairAnchorSha, headSha, repoRoot, exec = execFileSync }) {
  if (!sha(repairAnchorSha) || !sha(headSha)) throw new Error('Repair scope requires exact anchor and head SHAs.');
  const options = { cwd: repoRoot, stdio: 'pipe', shell: false };
  exec('git', ['merge-base', '--is-ancestor', repairAnchorSha, headSha], options);
  const diff = exec('git', ['diff', '--name-only', '-z', `${repairAnchorSha}..${headSha}`], { ...options, encoding: null });
  return parseNulPaths(diff);
}

function readPathBlob(revision, path, repoRoot, exec) {
  try {
    return exec('git', ['rev-parse', `${revision}:${selectorRepositoryPath(path)}`], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', shell: false }).trim();
  } catch {
    return null;
  }
}

export function selectorRepositoryPath(rawPath) {
  const path = normalizePath(rawPath);
  if (PERSISTED_OCR_SAFETY_PATHS.includes(path) || (COMPLETED_READ_PRODUCER_PATHS.includes(path) && (path.startsWith('quarantine-sidecar/') || path === 'shared/completedReadReceipt.ts'))) return path;
  return path.startsWith('supabase/') ? path : `nextjs/${path}`;
}

export function verifyWorkspaceSourceScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, googleViewerAclVerification = null, intakeTriageVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => WORKSPACE_SOURCE_FEATURE_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('source feature is not anchored to the audited 6401 baseline');
  if (JSON.stringify(featurePaths) !== JSON.stringify([...WORKSPACE_SOURCE_FEATURE_PATHS].sort())) reasons.push('workspace source feature path set differs from reviewed candidate');
  const pageBase = readPathBlob(repairAnchorSha, 'app/workspace/page.tsx', repoRoot, exec);
  const pageResult = readPathBlob(headSha, 'app/workspace/page.tsx', repoRoot, exec);
  const acceptedPageResults = [reviewedWorkspacePageBlobs.result];
  if (intakeTriageVerification?.eligible) acceptedPageResults.push(INTAKE_TRIAGE_SOURCE_BLOBS['app/workspace/page.tsx'].candidate);
  if (pageBase !== reviewedWorkspacePageBlobs.base || !acceptedPageResults.includes(pageResult)) reasons.push('workspace page blob pair differs from reviewed candidate');
  const browserBlob = readPathBlob(headSha, WORKSPACE_SOURCE_BROWSER_FILE, repoRoot, exec);
  if (browserBlob !== reviewedWorkspaceBrowserBlob) reasons.push('workspace browser test blob differs from reviewed candidate');
  const featureBlobVariants = googleViewerAclVerification?.eligible
    ? [WORKSPACE_SOURCE_FEATURE_BLOBS, { ...WORKSPACE_SOURCE_FEATURE_BLOBS, ...WORKSPACE_SOURCE_ACL_VARIANT_BLOBS }]
    : [WORKSPACE_SOURCE_FEATURE_BLOBS];
  if (intakeTriageVerification?.eligible) {
    featureBlobVariants.push({ ...WORKSPACE_SOURCE_FEATURE_BLOBS, 'app/workspace/page.tsx': INTAKE_TRIAGE_SOURCE_BLOBS['app/workspace/page.tsx'].candidate });
  }
  if (googleViewerAclVerification?.eligible && intakeTriageVerification?.eligible) {
    featureBlobVariants.push({
      ...WORKSPACE_SOURCE_FEATURE_BLOBS,
      ...WORKSPACE_SOURCE_ACL_VARIANT_BLOBS,
      'app/workspace/page.tsx': INTAKE_TRIAGE_SOURCE_BLOBS['app/workspace/page.tsx'].candidate,
    });
  }
  const featureBlobMismatches = featureBlobVariants.map(variant => Object.entries(variant)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected)
    .map(([path]) => path));
  if (featureBlobMismatches.every(mismatches => mismatches.length > 0)) {
    reasons.push(`workspace source feature blobs differ from reviewed candidates: ${[...new Set(featureBlobMismatches.flat())].join(', ')}`);
  }
  const fixtureBaseBlobMismatches = Object.entries(WORKSPACE_SOURCE_FIXTURE_BASE_BLOBS)
    .filter(([path, expected]) => readPathBlob(repairAnchorSha, path, repoRoot, exec) !== expected)
    .map(([path]) => path);
  if (fixtureBaseBlobMismatches.length) reasons.push(`workspace source fixture preimages differ from reviewed patch: ${fixtureBaseBlobMismatches.join(', ')}`);
  const scopedConfigBlob = readPathBlob(headSha, WORKSPACE_SOURCE_REPAIR_CONFIG, repoRoot, exec);
  const acceptedScopedConfigBlobs = [reviewedScopedConfigBlob];
  if (intakeTriageVerification?.eligible) acceptedScopedConfigBlobs.push(INTAKE_TRIAGE_REPAIR_CONFIG_BLOB);
  if (!acceptedScopedConfigBlobs.includes(scopedConfigBlob)) reasons.push('repair-only Vitest config blob differs from reviewed candidate');
  const globalConfigBase = readPathBlob(repairAnchorSha, 'vitest.config.ts', repoRoot, exec);
  const globalConfigHead = readPathBlob(headSha, 'vitest.config.ts', repoRoot, exec);
  if (globalConfigBase !== reviewedScopedConfigGlobalBlob || globalConfigHead !== reviewedScopedConfigGlobalBlob) reasons.push('global Vitest config changed from the reviewed blob');
  return { eligible: reasons.length === 0, reasons, featurePaths, pageBase, pageResult, browserBlob, scopedConfigBlob, globalConfigBase, globalConfigHead };
}

export function verifyPublicEditorialScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, publicUiRepairVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => PUBLIC_EDITORIAL_FEATURE_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('public editorial UI is not anchored to the authenticated 6401 baseline');
  if (headSha === PUBLIC_EDITORIAL_PREDECESSOR_SHA) reasons.push('public editorial UI head is not newer than its exact predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(PUBLIC_EDITORIAL_FEATURE_PATHS)) reasons.push('public editorial UI path set differs from the reviewed 15-file stack');
  try {
    exec('git', ['merge-base', '--is-ancestor', PUBLIC_EDITORIAL_PREDECESSOR_SHA, headSha], { cwd: repoRoot, stdio: 'pipe', shell: false });
  } catch { reasons.push('public editorial UI predecessor is not an ancestor of the candidate head'); }
  const predecessorMismatches = Object.entries(PUBLIC_EDITORIAL_SOURCE_BLOBS)
    .filter(([path, expected]) => readPathBlob(PUBLIC_EDITORIAL_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push('public editorial UI preimages differ from the exact base: ' + predecessorMismatches.join(', '));
  const candidateMismatches = Object.entries(PUBLIC_EDITORIAL_SOURCE_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !==
      (publicUiRepairVerification?.eligible && Object.hasOwn(PUBLIC_UI_REPAIR_BLOBS, path)
        ? PUBLIC_UI_REPAIR_BLOBS[path].candidate : expected.candidate))
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push('public editorial UI candidates differ from the root-reviewed stack: ' + candidateMismatches.join(', '));
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches };
}

export function verifyPersistedOcrSafetyScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, completedReadProducerVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => PERSISTED_OCR_SAFETY_PATHS.includes(path)))].sort();
  const reasons = [];
  if (changedPaths.some(path => path.startsWith('nextjs/quarantine-sidecar/'))) reasons.push('persisted OCR worker paths must use root repository ownership');
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('persisted OCR safety is not anchored to the authenticated 6401 baseline');
  if (headSha === PERSISTED_OCR_SAFETY_PREDECESSOR_SHA) reasons.push('persisted OCR safety head is not newer than its exact predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(PERSISTED_OCR_SAFETY_PATHS)) reasons.push('persisted OCR safety path set differs from the reviewed four-file patch');
  try {
    exec('git', ['merge-base', '--is-ancestor', PERSISTED_OCR_SAFETY_PREDECESSOR_SHA, headSha], { cwd: repoRoot, stdio: 'pipe', shell: false });
  } catch { reasons.push('persisted OCR safety predecessor is not an ancestor of the candidate head'); }
  const predecessorMismatches = Object.entries(PERSISTED_OCR_SAFETY_BLOBS)
    .filter(([path, expected]) => readPathBlob(PERSISTED_OCR_SAFETY_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push('persisted OCR safety preimages differ from the reviewed predecessor: ' + predecessorMismatches.join(', '));
  const candidateMismatches = Object.entries(PERSISTED_OCR_SAFETY_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !==
      (completedReadProducerVerification?.eligible && Object.hasOwn(COMPLETED_READ_PRODUCER_BLOBS, path)
        ? COMPLETED_READ_PRODUCER_BLOBS[path].candidate : expected.candidate))
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push('persisted OCR safety candidates differ from the root-reviewed patch: ' + candidateMismatches.join(', '));
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches };
}

export function verifyLegacyPublicBrowserScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => LEGACY_PUBLIC_BROWSER_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('legacy public browser corrections are not anchored to the authenticated 6401 baseline');
  if (headSha === LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA) reasons.push('legacy public browser head is not newer than its exact predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(LEGACY_PUBLIC_BROWSER_PATHS)) reasons.push('legacy public browser path set differs from the reviewed two-test patch');
  try {
    exec('git', ['merge-base', '--is-ancestor', LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA, headSha], { cwd: repoRoot, stdio: 'pipe', shell: false });
  } catch { reasons.push('legacy public browser predecessor is not an ancestor of the candidate head'); }
  const predecessorMismatches = Object.entries(LEGACY_PUBLIC_BROWSER_BLOBS)
    .filter(([path, expected]) => readPathBlob(LEGACY_PUBLIC_BROWSER_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push('legacy public browser preimages differ from the reviewed predecessor: ' + predecessorMismatches.join(', '));
  const candidateMismatches = Object.entries(LEGACY_PUBLIC_BROWSER_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected.candidate)
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push('legacy public browser candidates differ from the root-reviewed corrections: ' + candidateMismatches.join(', '));
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches };
}

export function verifyDocsPricingScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, publicEditorialVerification = null, publicUiRepairVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => DOCS_PRICING_FEATURE_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('Docs/pricing candidate is not anchored to the authenticated 6401 baseline');
  if (JSON.stringify(featurePaths) !== JSON.stringify([...DOCS_PRICING_FEATURE_PATHS].sort())) reasons.push('Docs/pricing path set differs from the exact reviewed six-file patch');
  if (headSha === DOCS_PRICING_PREDECESSOR_SHA) reasons.push('Docs/pricing candidate head is not newer than its reviewed predecessor');
  const anchorMismatches = Object.entries(docsPricingBlobs)
    .filter(([path, expected]) => readPathBlob(repairAnchorSha, path, repoRoot, exec) !== expected.anchor)
    .map(([path]) => path);
  if (anchorMismatches.length) reasons.push(`Docs/pricing anchor blobs differ from reviewed preimages: ${anchorMismatches.join(', ')}`);
  const predecessorMismatches = Object.entries(docsPricingBlobs)
    .filter(([path, expected]) => readPathBlob(DOCS_PRICING_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push(`Docs/pricing predecessor blobs differ from reviewed preimages: ${predecessorMismatches.join(', ')}`);
  const candidateMismatches = Object.entries(docsPricingBlobs)
    .filter(([path, expected]) => {
      const actual = readPathBlob(headSha, path, repoRoot, exec);
      const exactEditorialVariant = publicEditorialVerification?.eligible &&
        actual === (publicUiRepairVerification?.eligible && Object.hasOwn(PUBLIC_UI_REPAIR_BLOBS, path)
          ? PUBLIC_UI_REPAIR_BLOBS[path].candidate : PUBLIC_EDITORIAL_SOURCE_BLOBS[path]?.candidate);
      return actual !== expected.candidate && !exactEditorialVariant;
    })
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`Docs/pricing candidate blobs differ from reviewed patch: ${candidateMismatches.join(', ')}`);
  return { eligible: reasons.length === 0, reasons, featurePaths, anchorMismatches, predecessorMismatches, candidateMismatches };
}

export function verifyMobileNavContrastEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, publicEditorialVerification = null, publicUiRepairVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => MOBILE_NAV_CONTRAST_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('mobile navigation contrast fix is not anchored to the authenticated 6401 baseline');
  if (JSON.stringify(featurePaths) !== JSON.stringify([...MOBILE_NAV_CONTRAST_PATHS].sort())) reasons.push('mobile navigation contrast path set differs from the reviewed CSS/test pair');
  if (headSha === MOBILE_NAV_CONTRAST_PREDECESSOR_SHA) reasons.push('mobile navigation contrast candidate head is not newer than its reviewed predecessor');
  const anchorMismatches = Object.entries(MOBILE_NAV_CONTRAST_BLOBS)
    .filter(([path, expected]) => readPathBlob(repairAnchorSha, path, repoRoot, exec) !== expected.anchor)
    .map(([path]) => path);
  if (anchorMismatches.length) reasons.push(`mobile navigation anchor blobs differ from reviewed preimages: ${anchorMismatches.join(', ')}`);
  const predecessorMismatches = Object.entries(MOBILE_NAV_CONTRAST_BLOBS)
    .filter(([path, expected]) => readPathBlob(MOBILE_NAV_CONTRAST_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push(`mobile navigation predecessor blobs differ from reviewed preimages: ${predecessorMismatches.join(', ')}`);
  const candidateMismatches = Object.entries(MOBILE_NAV_CONTRAST_BLOBS)
    .filter(([path, expected]) => {
      const actual = readPathBlob(headSha, path, repoRoot, exec);
      const exactEditorialVariant = publicEditorialVerification?.eligible &&
        actual === (publicUiRepairVerification?.eligible && Object.hasOwn(PUBLIC_UI_REPAIR_BLOBS, path)
          ? PUBLIC_UI_REPAIR_BLOBS[path].candidate : PUBLIC_EDITORIAL_SOURCE_BLOBS[path]?.candidate);
      return actual !== expected.candidate && !exactEditorialVariant;
    })
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`mobile navigation candidate blobs differ from reviewed patch: ${candidateMismatches.join(', ')}`);
  return { eligible: reasons.length === 0, reasons, featurePaths, anchorMismatches, predecessorMismatches, candidateMismatches };
}

export function verifyGoogleViewerAclScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, googleDriveAclRefreshVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path)))].sort();
  const expectedPaths = [...GOOGLE_VIEWER_ACL_FEATURE_PATHS].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('Google Viewer ACL candidate is not anchored to the authenticated 6401 baseline');
  if (headSha === GOOGLE_VIEWER_ACL_PREDECESSOR_SHA) reasons.push('Google Viewer ACL candidate head is not newer than its reviewed predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(expectedPaths)) reasons.push('Google Viewer ACL path set differs from the exact reviewed Google Viewer ACL patch');
  try {
    exec('git', ['merge-base', '--is-ancestor', GOOGLE_VIEWER_ACL_PREDECESSOR_SHA, headSha], {
      cwd: repoRoot, stdio: 'pipe', shell: false,
    });
  } catch {
    reasons.push('Google Viewer ACL predecessor is not an ancestor of the candidate head');
  }
  const predecessorMismatches = Object.entries(GOOGLE_VIEWER_ACL_PREIMAGE_BLOBS)
    .filter(([path, expected]) => readPathBlob(GOOGLE_VIEWER_ACL_PREDECESSOR_SHA, path, repoRoot, exec) !== expected)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push(`Google Viewer ACL predecessor blobs differ from reviewed preimages: ${predecessorMismatches.join(', ')}`);
  const candidateMismatches = Object.entries(GOOGLE_VIEWER_ACL_FINAL_BLOBS)
    .filter(([path, expected]) => {
      const actual = readPathBlob(headSha, path, repoRoot, exec);
      const exactRefreshVariant = googleDriveAclRefreshVerification?.eligible &&
        GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path) &&
        actual === GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS[path]?.candidate;
      return actual !== expected && !exactRefreshVariant;
    })
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`Google Viewer ACL candidate blobs differ from reviewed patch: ${candidateMismatches.join(', ')}`);
  const registeredAclMigration = changedPaths.map(normalizePath)
    .filter(path => /^supabase\/migrations\/[^/]*google[^/]*viewer[^/]*\.sql$/i.test(path));
  if (registeredAclMigration.length) reasons.push('Google Viewer ACL SQL must remain an unregistered draft during this phase');
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches };
}

export function verifyGoogleDriveAclRefreshScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS.includes(path)))].sort();
  const expectedPaths = [...GOOGLE_DRIVE_ACL_REFRESH_FEATURE_PATHS].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('Google Drive ACL refresh is not anchored to the authenticated 6401 baseline');
  if (headSha === GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA) reasons.push('Google Drive ACL refresh head is not newer than its exact predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(expectedPaths)) reasons.push('Google Drive ACL refresh path set differs from the exact reviewed patch chain');
  try {
    exec('git', ['merge-base', '--is-ancestor', GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA, headSha], { cwd: repoRoot, stdio: 'pipe', shell: false });
  } catch { reasons.push('Google Drive ACL refresh predecessor is not an ancestor of the candidate head'); }
  const predecessorMismatches = Object.entries(GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS)
    .filter(([path, expected]) => readPathBlob(GOOGLE_DRIVE_ACL_REFRESH_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push('Google Drive ACL refresh preimages differ from the reviewed predecessor: ' + predecessorMismatches.join(', '));
  const candidateMismatches = Object.entries(GOOGLE_DRIVE_ACL_REFRESH_SOURCE_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected.candidate)
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push('Google Drive ACL refresh candidates differ from the reviewed patch chain: ' + candidateMismatches.join(', '));
  const registeredArtifacts = changedPaths.map(normalizePath).filter(path => /^supabase\/migrations\/[^/]*google_drive_acl_refresh_queue\.sql$/i.test(path) || path === 'supabase/tests/google_drive_acl_refresh_queue.sql');
  if (registeredArtifacts.length) reasons.push('Google Drive ACL refresh SQL must remain an unregistered draft');
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches };
}

export function verifyAsyncCompileJobAuthorityScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => ASYNC_COMPILE_JOB_AUTHORITY_PATHS.includes(path)))].sort();
  const expectedPaths = [...ASYNC_COMPILE_JOB_AUTHORITY_PATHS].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('async compile-job authority is not anchored to the authenticated 6401 baseline');
  if (headSha === ASYNC_COMPILE_JOB_AUTHORITY_PREDECESSOR_SHA) reasons.push('async compile-job authority candidate head is not newer than its reviewed predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(expectedPaths)) reasons.push('async compile-job authority path set differs from the exact reviewed patch chain');
  try {
    exec('git', ['merge-base', '--is-ancestor', ASYNC_COMPILE_JOB_AUTHORITY_PREDECESSOR_SHA, headSha], {
      cwd: repoRoot, stdio: 'pipe', shell: false,
    });
  } catch {
    reasons.push('async compile-job authority predecessor is not an ancestor of the candidate head');
  }
  const candidateMismatches = Object.entries(ASYNC_COMPILE_JOB_AUTHORITY_FINAL_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected)
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`async compile-job authority candidate blobs differ from the reviewed patch chain: ${candidateMismatches.join(', ')}`);
  const registeredMigrations = changedPaths.map(normalizePath)
    .filter(path => /^supabase\/migrations\/[^/]*compile[_-]job[^/]*viewer[^/]*authority[^/]*\.sql$/i.test(path));
  if (registeredMigrations.length) reasons.push('async compile-job authority SQL must remain an unregistered draft for disposable rehearsal');
  return { eligible: reasons.length === 0, reasons, featurePaths, candidateMismatches, registeredMigrations };
}

function verifyExactSourceStack({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }, predecessor, blobs) {
  const expectedPaths = Object.keys(blobs).sort();
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => expectedPaths.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('source stack is not anchored to the authenticated 6401 baseline');
  if (headSha === predecessor) reasons.push('source stack head equals its predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(expectedPaths)) reasons.push('source stack is incomplete');
  if (changedPaths.some(raw => raw.startsWith('nextjs/') && expectedPaths.includes(normalizePath(raw)) && selectorRepositoryPath(raw) === normalizePath(raw))) reasons.push('source stack has incorrect root path ownership');
  try { exec('git', ['merge-base', '--is-ancestor', predecessor, headSha], { cwd: repoRoot, stdio: 'pipe', shell: false }); }
  catch { reasons.push('exact source predecessor is not an ancestor'); }
  const predecessorMismatches = expectedPaths.filter(path => readPathBlob(predecessor, path, repoRoot, exec) !== blobs[path].predecessor);
  const candidateMismatches = expectedPaths.filter(path => readPathBlob(headSha, path, repoRoot, exec) !== blobs[path].candidate);
  if (predecessorMismatches.length) reasons.push('source preimages differ from the exact predecessor');
  if (candidateMismatches.length) reasons.push('source candidates differ from the exact reviewed stack');
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches };
}

export function verifyPublicUiRepairScopeEvidence(args) {
  const result = verifyExactSourceStack(args, PUBLIC_UI_REPAIR_PREDECESSOR_SHA, PUBLIC_UI_REPAIR_BLOBS);
  const changedFromPredecessor = PUBLIC_UI_REPAIR_PATHS.filter(path => readPathBlob(args.headSha, path, args.repoRoot, args.exec ?? execFileSync) !== PUBLIC_UI_REPAIR_BLOBS[path].predecessor);
  return { ...result, changedFromPredecessor };
}

export function verifyCompletedReadProducerScopeEvidence(args) {
  const result = verifyExactSourceStack(args, COMPLETED_READ_PRODUCER_PREDECESSOR_SHA, COMPLETED_READ_PRODUCER_BLOBS);
  if (args.changedPaths.map(normalizePath).some(path => /^supabase\/migrations\/[^/]*completed[_-]read[_-]proof[^/]*\.sql$/i.test(path))) result.reasons.push('completed-read SQL is a draft, not a production migration');
  return { ...result, eligible: result.reasons.length === 0 };
}

export function verifyWorkspaceIntakeLayoutScopeEvidence(args) {
  return verifyExactSourceStack(args, WORKSPACE_INTAKE_LAYOUT_PREDECESSOR_SHA, WORKSPACE_INTAKE_LAYOUT_BLOBS);
}

export function verifyIntakeTriageScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, workspaceIntakeLayoutVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => INTAKE_TRIAGE_FEATURE_PATHS.includes(path)))].sort();
  const expectedPaths = [...INTAKE_TRIAGE_FEATURE_PATHS].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('intake triage is not anchored to the authenticated 6401 full-pass baseline');
  if (headSha === INTAKE_TRIAGE_PREDECESSOR_SHA) reasons.push('intake triage head is not newer than its exact reviewed predecessor');
  if (JSON.stringify(featurePaths) !== JSON.stringify(expectedPaths)) reasons.push('intake triage path set differs from the exact reviewed 39-file candidate');
  try {
    exec('git', ['merge-base', '--is-ancestor', INTAKE_TRIAGE_PREDECESSOR_SHA, headSha], { cwd: repoRoot, stdio: 'pipe', shell: false });
  } catch { reasons.push('intake triage predecessor is not an ancestor of the candidate head'); }
  const predecessorMismatches = Object.entries(INTAKE_TRIAGE_SOURCE_BLOBS)
    .filter(([path, expected]) => readPathBlob(INTAKE_TRIAGE_PREDECESSOR_SHA, path, repoRoot, exec) !== expected.predecessor)
    .map(([path]) => path);
  if (predecessorMismatches.length) reasons.push('intake triage predecessor blobs differ from reviewed preimages: ' + predecessorMismatches.join(', '));
  const candidateMismatches = Object.entries(INTAKE_TRIAGE_SOURCE_BLOBS)
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !==
      (workspaceIntakeLayoutVerification?.eligible && path === INTAKE_TRIAGE_BROWSER_FILE
        ? WORKSPACE_INTAKE_LAYOUT_BLOBS[path].candidate : expected.candidate))
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push('intake triage candidate blobs differ from reviewed patch: ' + candidateMismatches.join(', '));
  const registeredMigrations = changedPaths.map(normalizePath)
    .filter(path => /^supabase\/migrations\/[^/]*intake[_-]triage[^/]*\.sql$/i.test(path));
  if (registeredMigrations.length) reasons.push('intake triage SQL must remain an unregistered draft for disposable rehearsal');
  return { eligible: reasons.length === 0, reasons, featurePaths, predecessorMismatches, candidateMismatches, registeredMigrations };
}

export function buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest, changedPaths, workspaceSourceVerification = null, docsPricingVerification = null, mobileNavVerification = null, googleViewerAclVerification = null, googleDriveAclRefreshVerification = null, asyncCompileJobAuthorityVerification = null, intakeTriageVerification = null, publicEditorialVerification = null, legacyPublicBrowserVerification = null, persistedOcrSafetyVerification = null, workspaceIntakeLayoutVerification = null, completedReadProducerVerification = null, publicUiRepairVerification = null }) {
  if (!sha(pullRequestBaseSha) || !sha(repairAnchorSha) || !sha(headSha)) {
    throw new Error('Repair scope requires exact PR base, audited anchor, and head SHAs.');
  }
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) throw new Error('Repair scope anchor is not the authenticated 6401 full-pass anchor.');
  const paths = [...new Set(changedPaths.map(normalizePath))].sort();
  const groups = new Set();
  const unitFiles = new Set();
  const browserFiles = new Set();
  const unknownPaths = [];
  const qualificationReasons = new Set(['selector/workflow qualification has not yet been rerun on this head']);
  let broader = false;
  let workflowConfigChanged = false;
  let selectorChanged = false;
  let runDetailIntegrity = false;
  let databaseEvidenceInvalidated = false;

  const publicUiRepairChanged = Boolean(publicUiRepairVerification?.changedFromPredecessor?.length);
  if (publicUiRepairChanged) {
    groups.add('public-ui-browser-repair');
    for (const file of ['e2e/site-nav.spec.ts', 'e2e/launch-qa-mobile-nav.spec.ts', 'e2e/premium-craft.spec.ts']) browserFiles.add(file);
    if (!publicUiRepairVerification?.eligible) {
      broader = true;
      qualificationReasons.add('public UI repair did not match its complete exact four-file stack');
    }
  }

  const completedReadProducerChanged = paths.some(path => COMPLETED_READ_PRODUCER_TRIGGER_PATHS.includes(path));
  if (completedReadProducerChanged) {
    groups.add('completed-read-producer-draft');
    groups.add('database-contract');
    databaseEvidenceInvalidated = true;
    for (const file of COMPLETED_READ_PRODUCER_UNIT_FILES) unitFiles.add(file);
    if (!completedReadProducerVerification?.eligible) {
      broader = true;
      qualificationReasons.add('completed-read producer draft did not match its complete exact fifteen-file source stack');
    }
  }

  const workspaceIntakeLayoutChanged = paths.some(path => WORKSPACE_INTAKE_LAYOUT_TRIGGER_PATHS.includes(path));
  if (workspaceIntakeLayoutChanged) {
    groups.add('workspace-intake-layout');
    for (const file of WORKSPACE_INTAKE_LAYOUT_UNIT_FILES) unitFiles.add(file);
    browserFiles.add(WORKSPACE_INTAKE_LAYOUT_BROWSER_FILE);
    browserFiles.add(INTAKE_TRIAGE_BROWSER_FILE);
    if (!workspaceIntakeLayoutVerification?.eligible) {
      broader = true;
      qualificationReasons.add('workspace intake layout did not match its complete exact four-file source stack');
    }
  }

  const persistedOcrSafetyChanged = paths.some(path => PERSISTED_OCR_SAFETY_PATHS.includes(path));
  if (persistedOcrSafetyChanged) {
    groups.add('persisted-ocr-safety');
    if (!persistedOcrSafetyVerification?.eligible) {
      broader = true;
      qualificationReasons.add('persisted OCR safety did not match its exact reviewed predecessor/blob/path policy');
    }
  }

  const legacyPublicBrowserChanged = paths.some(path => LEGACY_PUBLIC_BROWSER_PATHS.includes(path));
  if (legacyPublicBrowserChanged) {
    groups.add('legacy-public-browser-contracts');
    for (const file of LEGACY_PUBLIC_BROWSER_PATHS) browserFiles.add(file);
    if (!legacyPublicBrowserVerification?.eligible) {
      broader = true;
      qualificationReasons.add('legacy public browser corrections did not match their exact reviewed predecessor/blob/path policy');
    }
  }

  const publicEditorialChanged = paths.some(path => PUBLIC_EDITORIAL_TRIGGER_PATHS.includes(path));
  if (publicEditorialChanged) {
    groups.add('public-editorial-ui');
    for (const file of publicEditorialUnitTests) unitFiles.add(file);
    for (const file of publicEditorialBrowserTests) browserFiles.add(file);
    if (!publicEditorialVerification?.eligible) {
      broader = true;
      qualificationReasons.add('public editorial UI did not match its exact reviewed predecessor/blob/path policy');
    }
  }

  const mobileNavContrastChanged = paths.some(path => MOBILE_NAV_CONTRAST_PATHS.includes(path));
  if (mobileNavContrastChanged) {
    groups.add('mobile-nav-contrast');
    if (!mobileNavVerification?.eligible) {
      broader = true;
      qualificationReasons.add('mobile navigation contrast candidate did not match its exact reviewed CSS/test blob policy');
    }
  }

  const googleViewerAclChanged = paths.some(path =>
    GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path) &&
    !GOOGLE_VIEWER_ACL_WORKSPACE_OVERLAP_PATHS.has(path) &&
    !(googleDriveAclRefreshVerification?.eligible && GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path)));
  if (googleViewerAclChanged) {
    groups.add('google-viewer-acl');
    for (const file of GOOGLE_VIEWER_ACL_UNIT_TESTS) unitFiles.add(file);
    if (!googleViewerAclVerification?.eligible) {
      broader = true;
      qualificationReasons.add('Google Viewer ACL candidate did not match its exact reviewed predecessor/blob/path policy');
    }
  }
  const googleDriveAclRefreshChanged = paths.some(path => GOOGLE_DRIVE_ACL_REFRESH_TRIGGER_PATHS.includes(path));
  if (googleDriveAclRefreshChanged) {
    groups.add('google-drive-acl-refresh');
    groups.add('database-contract');
    for (const file of GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS) unitFiles.add(file);
    unitFiles.add('lib/pgtap-fixtures.test.ts');
    databaseEvidenceInvalidated = true;
    if (!googleDriveAclRefreshVerification?.eligible) {
      broader = true;
      qualificationReasons.add('Google Drive ACL refresh candidate did not match its exact predecessor/blob/path policy');
    }
  }
  const intakeTriageChanged = paths.some(path => INTAKE_TRIAGE_TRIGGER_PATHS.includes(path));
  if (intakeTriageChanged) {
    groups.add('intake-triage');
    groups.add('database-contract');
    for (const file of INTAKE_TRIAGE_UNIT_TESTS) unitFiles.add(file);
    for (const file of INTAKE_TRIAGE_EXISTING_REGRESSION_TESTS) unitFiles.add(file);
    unitFiles.add('lib/pgtap-fixtures.test.ts');
    browserFiles.add(INTAKE_TRIAGE_BROWSER_FILE);
    databaseEvidenceInvalidated = true;
    if (!intakeTriageVerification?.eligible) {
      broader = true;
      qualificationReasons.add('intake triage candidate did not match its exact reviewed predecessor/blob/path policy');
    }
  }

  const asyncCompileJobAuthorityChanged = paths.some(path => ASYNC_COMPILE_JOB_AUTHORITY_PATHS.includes(path));
  if (asyncCompileJobAuthorityChanged) {
    groups.add('async-compile-job-authority');
    for (const file of ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS) unitFiles.add(file);
    if (!asyncCompileJobAuthorityVerification?.eligible) {
      broader = true;
      qualificationReasons.add('async compile-job authority candidate did not match its exact reviewed predecessor/blob/path policy');
    }
  }
  const docsPricingChanged = paths.some(path => DOCS_PRICING_TRIGGER_PATHS.includes(path));
  if (docsPricingChanged) {
    groups.add('docs-pricing-layout');
    for (const file of docsPricingUnitTests) unitFiles.add(file);
    for (const file of docsPricingBrowserTests) browserFiles.add(file);
    if (!docsPricingVerification?.eligible) {
      broader = true;
      qualificationReasons.add('Docs/pricing candidate did not match its exact reviewed six-file/blob policy');
    }
  }
  const workspaceSourceChanged = paths.some(path => WORKSPACE_SOURCE_FEATURE_PATHS.includes(path));
  const workspaceScopedConfigChanged = paths.includes(WORKSPACE_SOURCE_REPAIR_CONFIG);
  if (workspaceSourceChanged || workspaceScopedConfigChanged) {
    groups.add('workspace-source-observation');
    for (const file of WORKSPACE_SOURCE_UNIT_FILES) unitFiles.add(file);
    browserFiles.add(WORKSPACE_SOURCE_BROWSER_FILE);
    if (!workspaceSourceVerification?.eligible) {
      broader = true;
      qualificationReasons.add('workspace source candidate did not match its exact reviewed blob/path policy');
    }
  }
  for (const path of paths) {
    let matched = false;
    if (completedReadProducerVerification?.eligible && COMPLETED_READ_PRODUCER_PATHS.includes(path)) continue;
    if (workspaceIntakeLayoutVerification?.eligible && WORKSPACE_INTAKE_LAYOUT_PATHS.includes(path)) continue;
    if (persistedOcrSafetyVerification?.eligible && PERSISTED_OCR_SAFETY_PATHS.includes(path)) matched = true;
    if (publicEditorialChanged && PUBLIC_EDITORIAL_TRIGGER_PATHS.includes(path)) matched = true;
    if (intakeTriageChanged && INTAKE_TRIAGE_FEATURE_PATHS.includes(path)) continue;
    if (/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/i.test(path)) {
      groups.add('workflow-static');
      workflowConfigChanged = true;
      matched = true;
    }
    if (/^scripts\/(?:repair-scope|repair-scope-gate|repair-test-report|run-repair-check|verify-repair-workflows|ci-repair-evidence)(\.test)?\.mjs$|^scripts\/fixtures\/(?:current-foundation-residual-workflow-paths\.json|ci-repair-evidence-policy\.json|ci-repair-evidence-source\.json)$/i.test(path) || path === 'vitest.repair-scope.async.config.ts') {
      groups.add('selector-config');
      qualificationReasons.add('selector changed');
      selectorChanged = true;
      matched = true;
    }
    if (path === WORKSPACE_SOURCE_REPAIR_CONFIG) {
      groups.add('workspace-source-observation');
      matched = true;
    }
    if (WORKSPACE_SOURCE_FEATURE_PATHS.includes(path)) {
      groups.add('workspace-source-observation');
      matched = true;
    }

    if (DOCS_PRICING_TRIGGER_PATHS.includes(path)) {
      groups.add('docs-pricing-layout');
      matched = true;
    }
    if (GOOGLE_DRIVE_ACL_REFRESH_TRIGGER_PATHS.includes(path) ||
      (googleDriveAclRefreshVerification?.eligible && GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path))) {
      groups.add('google-drive-acl-refresh');
      matched = true;
    }
    if (GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path) &&
      !(googleDriveAclRefreshVerification?.eligible && GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path))) {
      groups.add('google-viewer-acl');
      matched = true;
    }
    if (ASYNC_COMPILE_JOB_AUTHORITY_PATHS.includes(path)) {
      groups.add('async-compile-job-authority');
      matched = true;
    }
    if (path === 'supabase/drafts/google-viewer-principal-boundary.sql' ||
      path === 'supabase/tests/google_viewer_principal_boundary.sql' ||
      path === 'supabase/drafts/compile-job-viewer-authority.sql' ||
      path === 'supabase/tests/compile_job_viewer_authority.sql') {
      groups.add('database-contract');
      if (path.startsWith('supabase/drafts/compile-job-') || path === 'supabase/tests/compile_job_viewer_authority.sql') {
        groups.add('async-compile-job-authority');
      }
      unitFiles.add('lib/pgtap-fixtures.test.ts');
      databaseEvidenceInvalidated = true;
      matched = true;
    }
    if (path === 'app/api/openapi/route.ts') {
      groups.add('openapi');
      for (const file of baselineVitest.filter(file => /openapi|docs|retrieval/.test(file))) unitFiles.add(file);
      matched = true;
    }
    if (path === 'lib/docs-content.ts') {
      groups.add('docs');
      for (const file of baselineVitest.filter(file => /docs|retrieval/.test(file))) unitFiles.add(file);
      matched = true;
    }
    // These two exact contract readers feed the API reference and documentation examples.
    // Keep this mapping explicit: other lib production files remain unknown and fail closed.
    if (path === 'lib/api-reference.ts' || path === 'lib/docs-endpoints.ts') {
      groups.add('docs');
      groups.add('openapi');
      for (const file of docsContractTests) unitFiles.add(file);
      matched = true;
    }
    if (/^app\/api\/v1\/uploads\/(approval(?:\/cancel)?|confirm|release)\/route\.ts$/i.test(path)) {
      groups.add('alias-auth'); groups.add('upload-intake');
      for (const file of [...baselineAuth, ...uploadTests]) unitFiles.add(file);
      matched = true;
    }
    // Known intake residuals have direct route, contract, and error-code suites.
    if (/^app\/api\/uploads\/(approval|confirm)\/route\.ts$/i.test(path)) {
      groups.add('upload-intake');
      for (const file of uploadTests) unitFiles.add(file);
      matched = true;
    }
    if (path === 'app/api/uploads/capability/route.ts') {
      groups.add('upload-intake');
      for (const file of [...uploadTests, 'lib/source-intake.test.ts']) unitFiles.add(file);
      matched = true;
    }
    if (path === 'app/workspace/page.tsx') {
      groups.add('workspace-ui');
      browserFiles.add('e2e/failure-states-audit.spec.ts');
      matched = true;
    }
    if (['app/chrome-v2.css', 'app/paper-product.css', 'lib/site-navigation.ts'].includes(path)) {
      groups.add('site-chrome');
      for (const file of siteNavigationTests) unitFiles.add(file);
      unitFiles.add(sharedVisualRegressionTest);
      if (path === 'app/paper-product.css') unitFiles.add('lib/landing-v2-page.test.ts');
      for (const file of responsiveNavigationBrowsers) browserFiles.add(file);
      matched = true;
    }
    if (['components/marketing-consent.module.css', 'components/marketing-consent.tsx'].includes(path)) {
      groups.add('marketing-consent');
      unitFiles.add('lib/marketing-analytics.test.ts');
      browserFiles.add('e2e/marketing-consent.spec.ts');
      matched = true;
    }
    if (path === 'components/compile-stage-player.tsx') {
      groups.add('film-motion-control');
      unitFiles.add('lib/film-motion-control.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'docs/LANDING_V2_2026-09-19.md') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-traceability.test.ts');
      matched = true;
    }
    if (['app/landing-v2.css', 'components/landing-v2/landing-page.tsx',
      'components/landing-v2/hero-film.tsx', 'components/landing-v2/hero-film-disclosure.tsx'].includes(path)) {
      for (const file of landingLegacyRegressionTests) unitFiles.add(file);
    }
    if (path === 'app/landing-v2.css') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/landing-v2-tokens.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'components/landing-v2/landing-page.tsx') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/landing-v2-page.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'components/landing-v2/hero-film.tsx') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/film-motion-control.test.ts');
      browserFiles.add('e2e/landing-hero-mobile.spec.ts');
      matched = true;
    }
    if (path === 'components/landing-v2/hero-film-disclosure.tsx') {
      groups.add('landing-film-continuity');
      unitFiles.add('lib/landing-v2-recompile.test.ts');
      unitFiles.add('lib/film-motion-control.test.ts');
      matched = true;
    }
    if (/^e2e\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.spec\.ts$/i.test(path)) {
      groups.add('browser-regression');
      browserFiles.add(path);
      if (!reviewedBrowserFiles.has(path) && !(legacyPublicBrowserVerification?.eligible && LEGACY_PUBLIC_BROWSER_PATHS.includes(path))) {
        groups.add('unknown');
        unknownPaths.push(path);
        broader = true;
      }
      if (path === 'e2e/detail-integrity.spec.ts') {
        groups.add('detail-integrity');
        runDetailIntegrity = true;
      }
      matched = true;
    }
    if (/^lib\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.ts$/i.test(path)) {
      groups.add('unit-regression');
      unitFiles.add(path);
      matched = true;
    }
    if (/^lib\/api-error-codes\.ts$/i.test(path)) {
      groups.add('api-error-contract'); unitFiles.add('lib/api-error-codes.test.ts'); matched = true;
    }
    if (/^lib\/(intake-approval|upload-confirm-route|upload-release-route)\.ts$/i.test(path)) {
      groups.add('upload-intake'); for (const file of uploadTests) unitFiles.add(file); matched = true;
    }
    if (/^supabase\/(migrations|tests)\/[A-Za-z0-9_.-]+\.sql$/i.test(path)) {
      groups.add('database-contract');
      unitFiles.add('lib/pgtap-fixtures.test.ts');
      databaseEvidenceInvalidated = true;
      matched = true;
    }

    // Shared identity, billing, parser/schema, lockfile/toolchain, and unknown paths
    // require the hermetic broader unit run. Workflow edits only add release debt
    // and use the dedicated static checker; they do not fan out all 6k tests.
    if (/(^|\/)(auth|billing|middleware|session|entitlement)(\/|\.)|(^|\/)(auth|billing)[^/]*\.(ts|tsx)$/i.test(path)) {
      groups.add('shared-auth-billing'); broader = true; matched = true;
    }
    if (/(^|\/)(schema|schemas|parser|parsers|compiler)(\/|\.)|openapi\.(json|ya?ml)$/i.test(path)) {
      groups.add('schema-parser'); broader = true; matched = true;
      if (/(^|\/)(schema|schemas)(\/|\.)|\.sql$/i.test(path)) databaseEvidenceInvalidated = true;
    }
    if (/(^|\/)(pnpm-lock\.yaml|package\.json|pnpm-workspace\.yaml|tsconfig[^/]*\.json|vitest\.config\.[^/]+)$/i.test(path)) {
      groups.add('toolchain'); broader = true; matched = true;
    }
    if (!matched) { groups.add('unknown'); unknownPaths.push(path); broader = true; }
  }

  if (workflowConfigChanged) qualificationReasons.add('workflow config changed; full CI/Launch still required on ready_for_review');
  const plan = {
    schemaVersion: 1,
    repository: '0ssol1620-byte/tavonel-saas-foundation',
    pullRequest: Number(pullRequest),
    pullRequestBaseSha,
    repairAnchorSha,
    headSha,
    selector: 'foundation-repair-anchor-6401-v2',
    source: 'authenticated full-pass anchor tree diff; PR-base release debt tracked separately',
    changedPaths: paths,
    groups: [...groups].sort(),
    workspaceSourceSelection: workspaceSourceChanged || workspaceScopedConfigChanged
      ? { unitFiles: [...WORKSPACE_SOURCE_UNIT_FILES], browserFiles: [WORKSPACE_SOURCE_BROWSER_FILE], evidence: workspaceSourceVerification }
      : null,
    docsPricingSelection: docsPricingChanged
      ? { unitFiles: docsPricingUnitTests, browserFiles: docsPricingBrowserTests, evidence: docsPricingVerification }
      : null,
    googleViewerAclSelection: googleViewerAclChanged
      ? { unitFiles: [...GOOGLE_VIEWER_ACL_UNIT_TESTS], evidence: googleViewerAclVerification, sqlStatus: 'unregistered-draft-pending-disposable-pgtap' }
      : null,
    googleDriveAclRefreshSelection: googleDriveAclRefreshChanged
      ? { unitFiles: [...new Set([...GOOGLE_DRIVE_ACL_REFRESH_UNIT_TESTS, 'lib/pgtap-fixtures.test.ts'])].sort(), evidence: googleDriveAclRefreshVerification, sqlStatus: 'unregistered-draft-pending-disposable-pgtap' }
      : null,
    asyncCompileJobAuthoritySelection: asyncCompileJobAuthorityChanged
      ? { unitFiles: [...ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS], evidence: asyncCompileJobAuthorityVerification, sqlStatus: 'unregistered-draft-pending-disposable-pgtap' }
      : null,
    intakeTriageSelection: intakeTriageChanged
      ? { unitFiles: [...new Set([...INTAKE_TRIAGE_UNIT_TESTS, ...INTAKE_TRIAGE_EXISTING_REGRESSION_TESTS, 'lib/pgtap-fixtures.test.ts'])].sort(), browserFiles: [INTAKE_TRIAGE_BROWSER_FILE], evidence: intakeTriageVerification, sqlStatus: 'unregistered-draft-pending-disposable-pgtap' }
      : null,
    publicEditorialSelection: publicEditorialChanged
      ? { unitFiles: publicEditorialUnitTests, browserFiles: publicEditorialBrowserTests, evidence: publicEditorialVerification }
      : null,
    legacyPublicBrowserSelection: legacyPublicBrowserChanged
      ? { browserFiles: [...LEGACY_PUBLIC_BROWSER_PATHS], evidence: legacyPublicBrowserVerification }
      : null,
    persistedOcrSafetySelection: persistedOcrSafetyChanged
      ? { evidence: persistedOcrSafetyVerification, verification: completedReadProducerVerification?.eligible
        ? 'normal worker npm test retains all eight safety suites and adds the ninth producer suite, plus tsc --noEmit; source admission is not runtime qualification'
        : 'normal eight-file worker npm test plus tsc --noEmit; source admission is not runtime qualification' }
      : null,
    publicUiRepairSelection: publicUiRepairChanged ? { evidence: publicUiRepairVerification, browserFiles: ['e2e/site-nav.spec.ts', 'e2e/launch-qa-mobile-nav.spec.ts', 'e2e/premium-craft.spec.ts'], screenshots: 'existing six paired public PNGs remain required' } : null,
    workspaceIntakeLayoutSelection: workspaceIntakeLayoutChanged
      ? { evidence: workspaceIntakeLayoutVerification, unitFiles: [...WORKSPACE_INTAKE_LAYOUT_UNIT_FILES], browserFiles: [WORKSPACE_INTAKE_LAYOUT_BROWSER_FILE, INTAKE_TRIAGE_BROWSER_FILE], capture: 'four exact synthetic mounted preflight artifacts; isolated setContent geometry is not a mounted capture' }
      : null,
    requireWorkspaceIntakeCapture: workspaceIntakeLayoutChanged && Boolean(workspaceIntakeLayoutVerification?.eligible),
    completedReadProducerSelection: completedReadProducerChanged
      ? { evidence: completedReadProducerVerification, unitFiles: [...COMPLETED_READ_PRODUCER_UNIT_FILES], worker: 'normal npm test includes the ninth completed-read producer suite, plus tsc --noEmit', sqlStatus: 'unregistered-draft-pending-disposable-pgtap', qualification: 'source admission only; no database execution, atomicity or race result claimed' }
      : null,
    runCdrWorkerChecks: persistedOcrSafetyChanged || completedReadProducerChanged,
    unknownPaths,
    unitFiles: broader ? [] : [...unitFiles].sort(),
    browserFiles: [...browserFiles].sort(),
    runDetailIntegrity,
    runWorkflowStaticGate: workflowConfigChanged || selectorChanged,
    runFullHermeticVitest: broader,
    runScriptContracts: broader,
    runDatabaseRehearsal: false,
    deferredGroups: groups.has('database-contract') ? ['database-contract'] : [],
    databaseRehearsalStatus: databaseEvidenceInvalidated
      ? 'invalidated-pending-rehearsal'
      : 'baseline-pgtap-passed-latest-migration-not-replayed-37172599535',
    requirePublicUiScreenshots: publicEditorialChanged || pairedPublicUiCandidatePaths.every(path => paths.includes(path)),
    broaderQualificationRequired: broader || workflowConfigChanged,
    fullQualification: 'pending',
    qualificationReasons: [...qualificationReasons],
    pendingFullDebt,
    pendingQualificationDebt: databaseEvidenceInvalidated ? ['database-contract'] : [],
    databaseBaselineEvidence,
    testedBaseline: {
      commit: TESTED_FULL_PASS_SHA,
      repairRunId: 37172599524,
      artifactId: 11291413396,
      artifactDigest: 'sha256:7a7714a0d711840f25155d2d70af321699bb48f1cb7a29b8ef132d8446bacbfd',
      scope: 'unit-regression and script-contract evidence only; release qualification remains pending',
    },
  };
  return plan;
}

if (process.env.RUN_REPAIR_SCOPE === '1') {
  const pullRequestBaseSha = process.env.PR_BASE_SHA;
  const repairAnchorSha = process.env.REPAIR_ANCHOR_SHA;
  const headSha = process.env.REPAIR_HEAD_SHA;
  if (!sha(pullRequestBaseSha) || !sha(headSha)) throw new Error('Repair scope requires exact 40-character PR-base/head SHAs.');
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) throw new Error('Repair scope must use the authenticated 6401 full-pass anchor.');
  const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (checkoutHead !== headSha) throw new Error(`checkout SHA ${checkoutHead} does not equal PR head ${headSha}`);
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const changedPaths = collectChangedPaths({ repairAnchorSha, headSha, repoRoot });
  const googleDriveAclRefreshRelevant = changedPaths.map(normalizePath).some(path => GOOGLE_DRIVE_ACL_REFRESH_TRIGGER_PATHS.includes(path));
  const googleDriveAclRefreshVerification = googleDriveAclRefreshRelevant
    ? verifyGoogleDriveAclRefreshScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const googleViewerAclRelevant = changedPaths.map(normalizePath).some(path =>
    GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path) &&
    !(googleDriveAclRefreshVerification?.eligible && GOOGLE_DRIVE_ACL_REFRESH_ACL_OVERLAP_PATHS.has(path)));
  const googleViewerAclVerification = googleViewerAclRelevant
    ? verifyGoogleViewerAclScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, googleDriveAclRefreshVerification })
    : null;
  const asyncCompileJobAuthorityRelevant = changedPaths.map(normalizePath).some(path => ASYNC_COMPILE_JOB_AUTHORITY_PATHS.includes(path));
  const asyncCompileJobAuthorityVerification = asyncCompileJobAuthorityRelevant
    ? verifyAsyncCompileJobAuthorityScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const completedReadProducerVerification = changedPaths.map(normalizePath).some(path => COMPLETED_READ_PRODUCER_TRIGGER_PATHS.includes(path))
    ? verifyCompletedReadProducerScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot }) : null;
  const workspaceIntakeLayoutVerification = changedPaths.map(normalizePath).some(path => WORKSPACE_INTAKE_LAYOUT_TRIGGER_PATHS.includes(path))
    ? verifyWorkspaceIntakeLayoutScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot }) : null;
  const intakeTriageRelevant = changedPaths.map(normalizePath).some(path => INTAKE_TRIAGE_TRIGGER_PATHS.includes(path));
  const intakeTriageVerification = intakeTriageRelevant
    ? verifyIntakeTriageScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, workspaceIntakeLayoutVerification })
    : null;
  const workspaceSourceVerification = verifyWorkspaceSourceScopeEvidence({
    repairAnchorSha, headSha, changedPaths, repoRoot, googleViewerAclVerification, intakeTriageVerification,
  });
  const publicUiRepairVerification = verifyPublicUiRepairScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot });
  const publicEditorialRelevant = changedPaths.map(normalizePath).some(path => PUBLIC_EDITORIAL_TRIGGER_PATHS.includes(path));
  const publicEditorialVerification = publicEditorialRelevant
    ? verifyPublicEditorialScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, publicUiRepairVerification })
    : null;
  const docsPricingChanged = changedPaths.map(normalizePath).some(path => DOCS_PRICING_TRIGGER_PATHS.includes(path));
  const docsPricingVerification = docsPricingChanged
    ? verifyDocsPricingScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, publicEditorialVerification, publicUiRepairVerification })
    : null;
  const mobileNavContrastChanged = changedPaths.map(normalizePath).some(path => MOBILE_NAV_CONTRAST_PATHS.includes(path));
  const mobileNavVerification = mobileNavContrastChanged
    ? verifyMobileNavContrastEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, publicEditorialVerification, publicUiRepairVerification })
    : null;
  const legacyPublicBrowserRelevant = changedPaths.map(normalizePath).some(path => LEGACY_PUBLIC_BROWSER_PATHS.includes(path));
  const legacyPublicBrowserVerification = legacyPublicBrowserRelevant
    ? verifyLegacyPublicBrowserScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const persistedOcrSafetyRelevant = changedPaths.map(normalizePath).some(path => PERSISTED_OCR_SAFETY_PATHS.includes(path));
  const persistedOcrSafetyVerification = persistedOcrSafetyRelevant
    ? verifyPersistedOcrSafetyScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, completedReadProducerVerification })
    : null;
  const plan = buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest: process.env.PR_NUMBER, changedPaths, workspaceSourceVerification, docsPricingVerification, mobileNavVerification, googleViewerAclVerification, googleDriveAclRefreshVerification, asyncCompileJobAuthorityVerification, intakeTriageVerification, publicEditorialVerification, legacyPublicBrowserVerification, persistedOcrSafetyVerification, workspaceIntakeLayoutVerification, completedReadProducerVerification, publicUiRepairVerification });
  writeFileSync('repair-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const values = {
      broader: String(plan.runFullHermeticVitest),
      unit: String(plan.unitFiles.length > 0),
      cdr_worker: String(plan.runCdrWorkerChecks),
      browser: String(plan.runDetailIntegrity || plan.browserFiles.length > 0),
      public_ui_capture: String(plan.requirePublicUiScreenshots),
      workspace_intake_capture: String(plan.requireWorkspaceIntakeCapture),
      workflow_static: String(plan.runWorkflowStaticGate),
      selector_tests: String(plan.groups.includes('selector-config')),
      head: headSha,
      groups: plan.groups.join(', '),
    };
    for (const [key, value] of Object.entries(values)) writeFileSync(output, `${key}=${value}\n`, { flag: 'a' });
  }
  console.log(`Repair scope: ${plan.source}`);
  console.log(`Exact head ${headSha}; repair anchor ${repairAnchorSha}; PR base ${pullRequestBaseSha}; PR ${plan.pullRequest}`);
  console.log(`Groups: ${plan.groups.join(', ')}`);
  console.log(`Changed paths (${changedPaths.length}):\n${plan.changedPaths.map(p => `  ${p}`).join('\n')}`);
  console.log(`Broader suite: ${plan.runFullHermeticVitest}; full qualification: ${plan.fullQualification}`);
}
