import { describe, expect, it } from "vitest";
import { BILLING_OFFERS } from "./billing-catalog";
import { CONNECTION_PLANS, workspaceSourceChoices } from "./workspace-source-choices";

const PRODUCTION = [
  { provider: "google_drive", configured: true },
  { provider: "dropbox", configured: false },
  { provider: "microsoft_graph", configured: false },
];

describe("workspace home connector chips", () => {
  it("lists only configured OAuth providers, then the local source agent sources", () => {
    for (const source of ["owner", "paid"] as const) {
      expect(workspaceSourceChoices(source, PRODUCTION)).toEqual({ kind: "choices", choices: [
        { name: "Google Drive", availability: "Read-only" },
        { name: "File server", availability: "Local source agent" },
        { name: "Amazon S3", availability: "Local source agent" },
        { name: "Cloudflare R2", availability: "Local source agent" },
        { name: "MinIO", availability: "Local source agent" },
      ] });
    }
  });

  it("names Dropbox and OneDrive once their OAuth apps exist, and never an unknown provider", () => {
    const result = workspaceSourceChoices("paid", [
      { provider: "dropbox", configured: true },
      { provider: "microsoft_graph", configured: true },
      { provider: "box", configured: true },
    ]);
    expect(result.kind === "choices" && result.choices.map((c) => c.name).slice(0, 3))
      .toEqual(["Dropbox", "OneDrive / SharePoint", "File server"]);
  });

  it("offers no OAuth chip when the provider list could not be read", () => {
    const result = workspaceSourceChoices("paid", []);
    expect(result.kind === "choices" && result.choices.every((c) => c.availability === "Local source agent")).toBe(true);
  });

  it("answers a free evaluation and a workspace with no plan before the click", () => {
    expect(workspaceSourceChoices("trial", PRODUCTION)).toEqual({ kind: "plan_required" });
    expect(workspaceSourceChoices("unentitled", PRODUCTION)).toEqual({ kind: "plan_required" });
  });

  it("names the connection plans from the catalog the pricing page renders", () => {
    expect(CONNECTION_PLANS).toBe(`${BILLING_OFFERS.observer_access.label} and ${BILLING_OFFERS.studio_access.label}`);
  });

  it("shows nothing while access is still being checked", () => {
    expect(workspaceSourceChoices(null, PRODUCTION)).toEqual({ kind: "pending" });
  });
});
