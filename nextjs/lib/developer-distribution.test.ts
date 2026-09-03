import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GET as openApi } from "../app/api/openapi/route";

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
    expect(channel.version).toBe("2026.9.3.1");
    expect(channel.apiVersion).toBe(1);
    expect(cli).toContain(`DISTRIBUTION_VERSION = "${channel.version}"`);
    expect(mcp).toContain(`DISTRIBUTION_VERSION = "${channel.version}"`);
    const assetFiles = { cli: "tavonel-cli.mjs", mcp: "tavonel-mcp.mjs", sourceAgent: "tavonel-source-agent.py" } as const;
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
});
