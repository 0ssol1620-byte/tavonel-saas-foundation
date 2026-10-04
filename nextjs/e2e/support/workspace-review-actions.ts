import { expect, type Page } from "@playwright/test";

/** Uses production controls only. The caller owns identity, fixtures and service readiness. */
export async function acceptEvidenceThroughUi(page: Page, collectionId: string, manifestDigest: string) {
  const request = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/reviews");
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v1/reviews");
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ collectionId, manifestDigest, action: "accept" });
  return response;
}

export async function activateCandidateThroughUi(page: Page, selection: {
  collectionId: string; manifestDigest: string; expectedCurrentManifest: string | null; expectedCurrentRevision: number;
}, reason: string) {
  await page.getByLabel("Human review record").fill(reason);
  const pathname = `/api/collections/${selection.collectionId}/promote`;
  const request = page.waitForRequest(request => request.method() === "POST" && new URL(request.url()).pathname === pathname);
  const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === pathname);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Activate reviewed candidate", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ manifestDigest: selection.manifestDigest,
    expectedCurrentManifest: selection.expectedCurrentManifest, expectedCurrentRevision: selection.expectedCurrentRevision, reason });
  return response;
}
