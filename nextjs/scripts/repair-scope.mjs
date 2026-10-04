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
  'supabase/drafts/compile-job-viewer-authority.sql': '8c92051793c312b3c245d352c6a71d0e30c272ce',
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
  return path.startsWith('supabase/') ? path : `nextjs/${path}`;
}

export function verifyWorkspaceSourceScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, googleViewerAclVerification = null, exec = execFileSync }) {
  const featurePaths = [...new Set(changedPaths.map(normalizePath).filter(path => WORKSPACE_SOURCE_FEATURE_PATHS.includes(path)))].sort();
  const reasons = [];
  if (repairAnchorSha !== AUDITED_REPAIR_ANCHOR_SHA) reasons.push('source feature is not anchored to the audited 6401 baseline');
  if (JSON.stringify(featurePaths) !== JSON.stringify([...WORKSPACE_SOURCE_FEATURE_PATHS].sort())) reasons.push('workspace source feature path set differs from reviewed candidate');
  const pageBase = readPathBlob(repairAnchorSha, 'app/workspace/page.tsx', repoRoot, exec);
  const pageResult = readPathBlob(headSha, 'app/workspace/page.tsx', repoRoot, exec);
  if (pageBase !== reviewedWorkspacePageBlobs.base || pageResult !== reviewedWorkspacePageBlobs.result) reasons.push('workspace page blob pair differs from reviewed candidate');
  const browserBlob = readPathBlob(headSha, WORKSPACE_SOURCE_BROWSER_FILE, repoRoot, exec);
  if (browserBlob !== reviewedWorkspaceBrowserBlob) reasons.push('workspace browser test blob differs from reviewed candidate');
  const featureBlobVariants = googleViewerAclVerification?.eligible
    ? [WORKSPACE_SOURCE_FEATURE_BLOBS, { ...WORKSPACE_SOURCE_FEATURE_BLOBS, ...WORKSPACE_SOURCE_ACL_VARIANT_BLOBS }]
    : [WORKSPACE_SOURCE_FEATURE_BLOBS];
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
  if (scopedConfigBlob !== reviewedScopedConfigBlob) reasons.push('repair-only Vitest config blob differs from reviewed candidate');
  const globalConfigBase = readPathBlob(repairAnchorSha, 'vitest.config.ts', repoRoot, exec);
  const globalConfigHead = readPathBlob(headSha, 'vitest.config.ts', repoRoot, exec);
  if (globalConfigBase !== reviewedScopedConfigGlobalBlob || globalConfigHead !== reviewedScopedConfigGlobalBlob) reasons.push('global Vitest config changed from the reviewed blob');
  return { eligible: reasons.length === 0, reasons, featurePaths, pageBase, pageResult, browserBlob, scopedConfigBlob, globalConfigBase, globalConfigHead };
}

export function verifyDocsPricingScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
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
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected.candidate)
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`Docs/pricing candidate blobs differ from reviewed patch: ${candidateMismatches.join(', ')}`);
  return { eligible: reasons.length === 0, reasons, featurePaths, anchorMismatches, predecessorMismatches, candidateMismatches };
}

export function verifyMobileNavContrastEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
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
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected.candidate)
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`mobile navigation candidate blobs differ from reviewed patch: ${candidateMismatches.join(', ')}`);
  return { eligible: reasons.length === 0, reasons, featurePaths, anchorMismatches, predecessorMismatches, candidateMismatches };
}

export function verifyGoogleViewerAclScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot, exec = execFileSync }) {
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
    .filter(([path, expected]) => readPathBlob(headSha, path, repoRoot, exec) !== expected)
    .map(([path]) => path);
  if (candidateMismatches.length) reasons.push(`Google Viewer ACL candidate blobs differ from reviewed patch: ${candidateMismatches.join(', ')}`);
  const registeredAclMigration = changedPaths.map(normalizePath)
    .filter(path => /^supabase\/migrations\/[^/]*google[^/]*viewer[^/]*\.sql$/i.test(path));
  if (registeredAclMigration.length) reasons.push('Google Viewer ACL SQL must remain an unregistered draft during this phase');
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

export function buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest, changedPaths, workspaceSourceVerification = null, docsPricingVerification = null, mobileNavVerification = null, googleViewerAclVerification = null, asyncCompileJobAuthorityVerification = null }) {
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

  const mobileNavContrastChanged = paths.some(path => MOBILE_NAV_CONTRAST_PATHS.includes(path));
  if (mobileNavContrastChanged) {
    groups.add('mobile-nav-contrast');
    if (!mobileNavVerification?.eligible) {
      broader = true;
      qualificationReasons.add('mobile navigation contrast candidate did not match its exact reviewed CSS/test blob policy');
    }
  }

  const googleViewerAclChanged = paths.some(path =>
    GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path) && !GOOGLE_VIEWER_ACL_WORKSPACE_OVERLAP_PATHS.has(path));
  if (googleViewerAclChanged) {
    groups.add('google-viewer-acl');
    for (const file of GOOGLE_VIEWER_ACL_UNIT_TESTS) unitFiles.add(file);
    if (!googleViewerAclVerification?.eligible) {
      broader = true;
      qualificationReasons.add('Google Viewer ACL candidate did not match its exact reviewed predecessor/blob/path policy');
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
    if (GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path)) {
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
      if (!reviewedBrowserFiles.has(path)) {
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
    asyncCompileJobAuthoritySelection: asyncCompileJobAuthorityChanged
      ? { unitFiles: [...ASYNC_COMPILE_JOB_AUTHORITY_UNIT_TESTS], evidence: asyncCompileJobAuthorityVerification, sqlStatus: 'unregistered-draft-pending-disposable-pgtap' }
      : null,
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
    requirePublicUiScreenshots: pairedPublicUiCandidatePaths.every(path => paths.includes(path)),
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
  const googleViewerAclRelevant = changedPaths.map(normalizePath).some(path => GOOGLE_VIEWER_ACL_FEATURE_PATHS.includes(path));
  const googleViewerAclVerification = googleViewerAclRelevant
    ? verifyGoogleViewerAclScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const asyncCompileJobAuthorityRelevant = changedPaths.map(normalizePath).some(path => ASYNC_COMPILE_JOB_AUTHORITY_PATHS.includes(path));
  const asyncCompileJobAuthorityVerification = asyncCompileJobAuthorityRelevant
    ? verifyAsyncCompileJobAuthorityScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const workspaceSourceVerification = verifyWorkspaceSourceScopeEvidence({
    repairAnchorSha, headSha, changedPaths, repoRoot, googleViewerAclVerification,
  });
  const docsPricingChanged = changedPaths.map(normalizePath).some(path => DOCS_PRICING_TRIGGER_PATHS.includes(path));
  const docsPricingVerification = docsPricingChanged
    ? verifyDocsPricingScopeEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const mobileNavContrastChanged = changedPaths.map(normalizePath).some(path => MOBILE_NAV_CONTRAST_PATHS.includes(path));
  const mobileNavVerification = mobileNavContrastChanged
    ? verifyMobileNavContrastEvidence({ repairAnchorSha, headSha, changedPaths, repoRoot })
    : null;
  const plan = buildRepairPlan({ pullRequestBaseSha, repairAnchorSha, headSha, pullRequest: process.env.PR_NUMBER, changedPaths, workspaceSourceVerification, docsPricingVerification, mobileNavVerification, googleViewerAclVerification, asyncCompileJobAuthorityVerification });
  writeFileSync('repair-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    const values = {
      broader: String(plan.runFullHermeticVitest),
      unit: String(plan.unitFiles.length > 0),
      browser: String(plan.runDetailIntegrity || plan.browserFiles.length > 0),
      public_ui_capture: String(plan.requirePublicUiScreenshots),
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
