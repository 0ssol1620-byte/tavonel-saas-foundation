const playwrightPackage =
  process.env.PLAYWRIGHT_TEST_PACKAGE ?? "@playwright/test";
const playwrightModule = await import(playwrightPackage);
const { expect, test } =
  "test" in playwrightModule ? playwrightModule : playwrightModule.default;

test("publishes fail-closed P0 operating contracts", async ({ request }) => {
  const response = await request.get("/api/operations/p0");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  expect(body).toMatchObject({
    schemaVersion: "tavonel.operations_p0.v1",
    creditRelease: { outcome: "released", actualCredits: 0 },
    decisionGates: { candidatePromotionAutomatic: false },
  });
  expect(body.largeDocument.splitPartMaxBytes).toBe(5 * 1024 * 1024);
});

test("plans large PDF parts and rejects unsafe admission metadata", async ({
  request,
}) => {
  const valid = await request.post("/api/operations/p0/admission", {
    data: {
      workspaceKey: "ws_abcdefgh",
      documentId: "123e4567-e89b-42d3-a456-426614174000",
      fileName: "large.pdf",
      mimeType: "application/pdf",
      byteSize: 40 * 1024 * 1024,
      pageCount: 400,
      sourceSha256: `sha256:${"a".repeat(64)}`,
    },
  });
  expect(valid.status()).toBe(200);
  const plan = await valid.json();
  expect(plan.decision).toBe("split");
  expect(plan.parts.length).toBeGreaterThan(1);
  expect(plan.invariants.compileOnlyAfterAllPartsReady).toBe(true);

  const invalid = await request.post("/api/operations/p0/admission", {
    data: {
      workspaceKey: "ws_abcdefgh",
      documentId: "123e4567-e89b-42d3-a456-426614174000",
      fileName: "../escape.pdf",
      mimeType: "application/pdf",
      byteSize: 100,
      pageCount: 1,
      sourceSha256: `sha256:${"a".repeat(64)}`,
    },
  });
  expect(invalid.status()).toBe(422);
  expect(await invalid.json()).toEqual({
    ok: false,
    code: "FILE_NAME_INVALID",
  });
});

test("keeps credit release fail-closed without a signed settlement request", async ({
  request,
}) => {
  const response = await request.post("/api/operations/p0/credits/release", {
    data: {
      workspaceKey: "ws_abcdefgh",
      documentId: "123e4567-e89b-42d3-a456-426614174000",
      terminalState: "operator_review",
      reasonCode: "OCR_LOW_TEXT_YIELD",
    },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({
    code: "CREDIT_RELEASE_AUTH_INVALID",
  });
});
