import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GET as openApi } from "../app/api/openapi/route";
import { DEVELOPER_FILES, MCP_TOOL_NAMES } from "./mcp-tools";

const developerAsset = (name: string) => fileURLToPath(new URL(`../public/developer/${name}`, import.meta.url));

describe("developer distribution", () => {
  it("publishes a bounded API contract without decision endpoints", async () => {
    const response = openApi(new Request("https://tavonel.com/api/openapi"));
    const document = await response.json() as { paths: Record<string, unknown>; [key: string]: unknown };
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/documents"]).toBeTruthy();
    expect(document.paths["/connections"]).toBeTruthy();
    expect(document.paths["/connections/{id}"]).toBeTruthy();
    expect(document.paths["/connections/{id}/sync"]).toBeTruthy();
    expect(document.paths["/oauth-connectors/authorize"]).toBeTruthy();
    expect(document.paths["/developer/keys/{id}/rotate"]).toBeTruthy();
    expect(document["x-tavonel-api-version"]).toBe(1);
    expect(Object.keys(document.paths).some((path) => path.includes("promote") || path.includes("rollback"))).toBe(false);
    expect(document["x-tavonel-decision-gates"]).toEqual({ promotion: "browser-session-only", rollback: "browser-session-only", mcp: "read-only" });
  });

  it("publishes one version across CLI, MCP, and the update channel", () => {
    const channel = JSON.parse(readFileSync(developerAsset("channel.json"), "utf8")) as { version: string; apiVersion: number; assets: Record<string, { sha256: string }> };
    const cli = readFileSync(developerAsset("tavonel-cli.mjs"), "utf8");
    const mcp = readFileSync(developerAsset("tavonel-mcp.mjs"), "utf8");
    expect(channel.version).toBe("2026.9.20.1");
    expect(channel.apiVersion).toBe(1);
    expect(cli).toContain(`DISTRIBUTION_VERSION = "${channel.version}"`);
    expect(mcp).toContain(`DISTRIBUTION_VERSION = "${channel.version}"`);
    // Every asset the channel publishes, not a subset: an unchecked row is a digest that can
    // go stale silently, and a stale digest turns "verify before you run it" into a failure the
    // customer hits instead of the build.
    const assetFiles = {
      cli: "tavonel-cli.mjs",
      mcp: "tavonel-mcp.mjs",
      sourceAgent: "tavonel-source-agent.py",
      verifyExport: "tavonel-verify-export.mjs",
      verifyPackage: "tavonel-verify-package.mjs",
      verifyRoundtrip: "tavonel-verify-roundtrip.py",
      /*
        G3-017. /docs/integration-recipes told a reader to run these two and they lived in a
        private repository, so the page's verifiability claim -- "a recipe that has drifted from
        the product fails a check rather than a customer's afternoon" -- was unverifiable by the
        only person it was addressed to. They are pinned here like everything else. They carry no
        DISTRIBUTION_VERSION because neither is the CLI: the channel version names the CLI/MCP
        build, and these move on their own.
      */
      recipePublicSample: "tavonel-public-sample.py",
      recipeSmoke: "tavonel-recipe-smoke.mjs",
    } as const;
    expect(Object.keys(assetFiles).sort()).toEqual(Object.keys(channel.assets).sort());
    for (const [key, filename] of Object.entries(assetFiles)) {
      const digest = `sha256:${createHash("sha256").update(readFileSync(developerAsset(filename))).digest("hex")}`;
      expect(channel.assets[key].sha256).toBe(digest);
    }
  });

  it("completes a real MCP initialize and exposes read-only tools only", () => {
    const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    const child = spawnSync(process.execPath, [developerAsset("tavonel-mcp.mjs")], { input: `${message}\n`, encoding: "utf8", timeout: 5_000 });
    expect(child.status).toBe(0);
    const response = JSON.parse(child.stdout.trim()) as { result: { serverInfo: { name: string }; instructions: string } };
    expect(response.result.serverInfo.name).toBe("tavonel-readonly");
    expect(response.result.instructions).toContain("No tool can upload, compile, promote");
  });

  it("ships a CLI that can render help without credentials", () => {
    const child = spawnSync(process.execPath, [developerAsset("tavonel-cli.mjs"), "help"], { encoding: "utf8", timeout: 5_000 });
    expect(child.status).toBe(0);
    expect(child.stdout).toContain("node tavonel-cli.mjs documents");
    expect(child.stdout).toContain("node tavonel-cli.mjs connections");
  });

  it("reads the versioned public status contract without credentials", async () => {
    const status = {
      schemaVersion: "tavonel.public_status.v2",
      service: { name: "TAVONEL", state: "not_assessed", commercialMode: "pilot" },
      availableActions: {},
      checkedAt: "2026-09-20T00:00:00.000Z",
      evidenceFreshness: { basis: "configuration_snapshot", operationalProbe: "not_included" },
    };
    const server = createServer((request, response) => {
      if (request.url !== "/api/status/v2") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(status));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
    try {
      const child = spawn(process.execPath, [developerAsset("tavonel-cli.mjs"), "status"], {
        env: { ...process.env, TAVONEL_API_KEY: "", TAVONEL_BASE_URL: `http://127.0.0.1:${address.port}` },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });

      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual(status);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("labels archive and manifest digests independently after a download", async () => {
    const archive = Buffer.from("signed export bytes", "utf8");
    const archiveSha256 = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
    const manifestSha256 = `sha256:${"a".repeat(64)}`;
    const server = createServer((request, response) => {
      if (request.url !== "/api/v1/collections/collection-test/download") {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/zip",
        "content-length": String(archive.length),
        "x-tavonel-export-manifest-sha256": manifestSha256,
      });
      response.end(archive);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
    const directory = mkdtempSync(join(tmpdir(), "tavonel-cli-"));
    const output = join(directory, "candidate.zip");
    try {
      const child = spawn(process.execPath, [developerAsset("tavonel-cli.mjs"), "download", "collection-test", output], {
        env: { ...process.env, TAVONEL_API_KEY: "tvnl_live_test", TAVONEL_BASE_URL: `http://127.0.0.1:${address.port}` },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      const status = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(status, stderr).toBe(0);
      expect(readFileSync(output)).toEqual(archive);
      expect(stdout).toContain(`archive=${archiveSha256}`);
      expect(stdout).toContain(`manifest=${manifestSha256}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("ships a source agent with environment-only secrets and durable cursor ordering", () => {
    const source = readFileSync(developerAsset("tavonel-source-agent.py"), "utf8");
    expect(source).toContain('os.environ.get("TAVONEL_API_KEY", "")');
    expect(source).not.toContain('add_argument("--api-key"');
    expect(source).toContain("/api/v1/uploads/capability");
    expect(source).toContain("/sync");
    expect(source.indexOf("result = client.post(")).toBeLessThan(source.indexOf("write_state(args.state"));
    expect(source).toContain("os.replace(temp_name, path)");
    expect(source).toContain('parsed.hostname in {"localhost", "127.0.0.1", "::1"}');
  });

  /*
    G3-006 and G3-016: two counts that were wrong on three surfaces each.

    "Eight tools" stood on /developers, /docs/integration-recipes and the 3 September changelog
    entry while the server registers nine -- `list_worlds` shipped and was never announced, and
    the number propagated outward from the entry. "Five published files" stood three times
    against six in channel.json. Neither was a typo: both were a number typed once and copied,
    with nothing comparing it to the artifact. `lib/mcp-tools.ts` is now the one list every
    surface renders, and this is what binds it to the artifacts.
  */
  it("names exactly the tools the shipped MCP server registers", () => {
    const source = readFileSync(developerAsset("tavonel-mcp.mjs"), "utf8");
    const registered = [...source.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((match) => match[1]);
    expect(registered.length).toBeGreaterThan(0);
    expect(MCP_TOOL_NAMES).toEqual(registered);
    expect(registered.filter((name) => /^(create|update|delete|promote|rollback|write|set)_/.test(name))).toEqual([]);
  });

  it("names exactly the files the channel manifest pins", () => {
    const channel = JSON.parse(readFileSync(developerAsset("channel.json"), "utf8")) as { assets: Record<string, { url: string }> };
    expect(DEVELOPER_FILES.map((entry) => entry.key).sort()).toEqual(Object.keys(channel.assets).sort());
    for (const entry of DEVELOPER_FILES) {
      expect(channel.assets[entry.key]!.url, entry.key).toBe(`https://tavonel.com/developer/${entry.file}`);
    }
  });

  it("publishes two recipe scripts that cannot spend, write or authenticate", () => {
    const smoke = readFileSync(developerAsset("tavonel-recipe-smoke.mjs"), "utf8");
    expect(smoke).not.toMatch(/method:s*"(POST|PUT|PATCH|DELETE)"/);
    expect(smoke).not.toContain("TAVONEL_API_KEY");
    const sample = readFileSync(developerAsset("tavonel-public-sample.py"), "utf8");
    expect(sample).not.toContain("TAVONEL_API_KEY");
    // Stdlib only: the recipe's own claim is that it needs nothing installed.
    const imports = [...sample.matchAll(/^(?:import|from) ([a-z_.0-9]+)/gm)].map((match) => match[1].split(".")[0]);
    expect([...new Set(imports)].sort()).toEqual(["__future__", "argparse", "base64", "hashlib", "json", "sys", "urllib"]);
  });
});
