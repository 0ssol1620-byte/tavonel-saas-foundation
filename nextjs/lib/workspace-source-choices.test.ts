import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthProviderAvailability } from "@/components/connections-panel";
import { WORKSPACE_SOURCE_CHOICES, WorkspaceSourceChoices, type WorkspaceAccessSource } from "@/components/workspace/source-choices";
import { OAUTH_CONNECTOR_PROVIDERS, type OAuthConnectorProvider } from "./connector-oauth";
import { configuredOAuthProviders } from "./connector-oauth-secrets";

/*
  WO-REL-4 closing round (review follow-up B3): the workspace's source tiles, rendered. A tile for an OAuth
  provider is shown only where the server says the provider is configured; a trial sees the paid-plan condition.
*/
const tiles = (html: string) => [...html.matchAll(/<button[^>]*><span>([^<]+)<\/span><small>([^<]+)<\/small><\/button>/g)].map((m) => [m[1], m[2]]);
const render = (accessSource: WorkspaceAccessSource, providers?: readonly OAuthConnectorProvider[]) => {
  const choices = createElement(WorkspaceSourceChoices, { accessSource, onChoose: () => undefined });
  const tree: ReactNode = providers === undefined ? choices : createElement(OAuthProviderAvailability, { providers }, choices);
  return tiles(renderToStaticMarkup(tree));
};
const OAUTH_NAMES = WORKSPACE_SOURCE_CHOICES.filter((choice) => choice.provider !== null).map((choice) => choice.name);

describe("workspace source tiles", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("names one tile per OAuth provider the server can configure", () => {
    expect(WORKSPACE_SOURCE_CHOICES.flatMap((choice) => (choice.provider ? [choice.provider] : [])).sort()).toEqual([...OAUTH_CONNECTOR_PROVIDERS].sort());
  });

  it("shows no Dropbox, OneDrive or Google Drive tile where no provider is configured, and keeps the local folder", () => {
    // The server fact itself, for a deployment with no provider client or secret broker.
    const none = configuredOAuthProviders({});
    expect(none).toEqual([]);
    for (const rendered of [render("paid", none), render("paid")]) {
      const names = rendered.map(([name]) => name);
      for (const name of OAUTH_NAMES) expect(names).not.toContain(name);
      expect(names).toContain("Local folder");
      expect(rendered.find(([name]) => name === "Local folder")![1]).toBe("Command-line agent");
    }
  });

  it("shows exactly the configured providers' tiles", () => {
    const names = render("owner", ["google_drive"]).map(([name]) => name);
    expect(names).toContain("Google Drive");
    expect(names).not.toContain("Dropbox");
    expect(names).not.toContain("OneDrive");
  });

  it("shows the paid-plan condition on every tile for a trial or an unentitled workspace, and the setup state otherwise", () => {
    for (const accessSource of ["trial", "unentitled"] as const) {
      const rendered = render(accessSource, OAUTH_CONNECTOR_PROVIDERS);
      expect(rendered.length).toBe(WORKSPACE_SOURCE_CHOICES.length);
      for (const [, state] of rendered) expect(state, accessSource).toBe("Paid plan");
    }
    for (const accessSource of ["owner", "paid", null] as const) {
      for (const [, state] of render(accessSource, OAUTH_CONNECTOR_PROVIDERS)) expect(state, String(accessSource)).not.toBe("Paid plan");
    }
  });

  it("follows the workspace layout's server read of the provider env", async () => {
    vi.stubEnv("TAVONEL_OAUTH_GOOGLE_DRIVE_CLIENT_ID", "");
    vi.resetModules();
    const [{ default: WorkspaceLayout }, sourceChoices] = await Promise.all([
      import("../app/workspace/layout"),
      import("@/components/workspace/source-choices"),
    ]);
    const html = renderToStaticMarkup(createElement(WorkspaceLayout, null, createElement(sourceChoices.WorkspaceSourceChoices, { accessSource: "paid", onChoose: () => undefined })));
    const names = tiles(html).map(([name]) => name);
    expect(names).toContain("Local folder");
    for (const name of OAUTH_NAMES) expect(names).not.toContain(name);
  });
});
