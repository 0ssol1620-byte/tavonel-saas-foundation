import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PermanentReject } from "./errors";
import {
  assertFoundationOnlyTarget,
  evaluateHealth,
  isProdCdrUrl,
  looksLikeSyntheticCdr,
} from "./guards";

const SYNTHETIC_URL = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/v1/disarm";
const SYNTHETIC_HEALTH = "https://tavonel-cdr-synthetic-317850201666.asia-northeast3.run.app/health";
const PROD_URL = "https://tavonel-pdf-cdr-xxxxx.asia-northeast3.run.app/v1/disarm";
const FIXTURE_SECRET = "foundation-cdr-hmac-fixture-secret-ok";

describe("Foundation-only CDR target guards", () => {
  it("refuses a production tavonel-pdf-cdr URL", () => {
    assert.equal(isProdCdrUrl(PROD_URL), true);
    assert.equal(isProdCdrUrl(SYNTHETIC_URL), false);
    assert.equal(looksLikeSyntheticCdr(SYNTHETIC_URL, "tavonel_pdf_raster"), true);
    assert.equal(looksLikeSyntheticCdr(PROD_URL, "tavonel_pdf_raster"), false);
    assert.throws(() => assertFoundationOnlyTarget(PROD_URL, "tavonel-saas-foundation-quarantine"), PermanentReject);
    assert.throws(
      () => assertFoundationOnlyTarget(SYNTHETIC_URL, "tavonel-prod-quarantine"),
      PermanentReject,
    );
    assert.doesNotThrow(() => assertFoundationOnlyTarget(SYNTHETIC_URL, "tavonel-saas-foundation-quarantine"));
  });

  it("health is 200 for synthetic config and never echoes the HMAC", async () => {
    const fetched: string[] = [];
    const result = await evaluateHealth(
      {
        TAVONEL_CDR_HMAC: FIXTURE_SECRET,
        TAVONEL_CDR_URL: SYNTHETIC_URL,
        TAVONEL_CDR_HEALTH_URL: SYNTHETIC_HEALTH,
        TAVONEL_CDR_PROVIDER: "tavonel_pdf_raster",
        FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
      },
      async (input) => {
        fetched.push(String(input));
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      },
    );
    assert.equal(result.httpStatus, 200);
    assert.equal(result.body.status, "ok");
    assert.equal(result.body.hmacConfigured, true);
    assert.equal(JSON.stringify(result.body).includes(FIXTURE_SECRET), false);
    assert.deepEqual(fetched, [SYNTHETIC_HEALTH]);
    assert.equal(fetched.some((url) => url.includes("tavonel-pdf-cdr")), false);
  });

  it("health is 503 when the synthetic health fetch fails and does not call production", async () => {
    const result = await evaluateHealth(
      {
        TAVONEL_CDR_HMAC: FIXTURE_SECRET,
        TAVONEL_CDR_URL: SYNTHETIC_URL,
        TAVONEL_CDR_HEALTH_URL: SYNTHETIC_HEALTH,
        TAVONEL_CDR_PROVIDER: "tavonel_pdf_raster",
        FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
      },
      async () => {
        throw new Error("network down");
      },
    );
    assert.equal(result.httpStatus, 503);
    assert.equal(result.body.reason, "synthetic CDR health check failed");
  });

  it("health refuses a production CDR URL without fetching it", async () => {
    let fetched = 0;
    const result = await evaluateHealth(
      {
        TAVONEL_CDR_HMAC: FIXTURE_SECRET,
        TAVONEL_CDR_URL: PROD_URL,
        TAVONEL_CDR_HEALTH_URL: PROD_URL.replace("/v1/disarm", "/health"),
        TAVONEL_CDR_PROVIDER: "tavonel_pdf_raster",
        FOUNDATION_R2_BUCKET: "tavonel-saas-foundation-quarantine",
      },
      async () => {
        fetched += 1;
        return new Response("no", { status: 200 });
      },
    );
    assert.equal(result.httpStatus, 503);
    assert.equal(result.body.reason, "production CDR URL is refused");
    assert.equal(fetched, 0);
  });
});