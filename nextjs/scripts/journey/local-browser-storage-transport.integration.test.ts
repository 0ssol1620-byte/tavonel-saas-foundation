import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { presignFoundationQuarantinePut } from "../../lib/r2-presign";
import { FOUNDATION_R2_BUCKET } from "../../lib/r2-synthetic-canary";
import { guardedChromiumArgs, loopbackOnlyChromiumArgs, routeLocalStorageTransport, startLoopbackConnectGuard, storageHost } from "./local-next-browser-journey.mjs";
import { localS3TempRoot } from "./local-storage-journey.mjs";

const endpoint = process.env.TAVONEL_LOCAL_S3_ENDPOINT;
const env = { accountId: storageHost.split(".")[0], bucket: FOUNDATION_R2_BUCKET,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "" };
const hash = (body: string | Buffer) => createHash("sha256").update(body).digest("hex");
const hmac = (key: string | Buffer, body: string) => createHmac("sha256", key).update(body).digest();

// The *Ms fields are a per-request timeline at the listener, so a stalled PUT names the leg that stalled.
type Arrival = { method: string; url: string; host?: string; origin?: string; contentType?: string; contentLength?: string;
  preflightMethod?: string; preflightHeaders?: string; bodyBytes?: number; bodySha256?: string; forwardedHost?: string;
  bodyEndMs?: number; forwardedBodyMs?: number; upstreamStatus?: number; upstreamMs?: number; upstreamError?: string;
  responseMs?: number; responseComplete?: boolean };
type XhrResult = { status: number; error: boolean; text: string; uploaded: number; headersReceived: boolean; ms: number };
type Failure = { method: string; host: string; url: string; redirected: boolean; errorText?: string };

let root = "";
let browser: Browser | undefined;
let proxy: https.Server | undefined;
let guard: Awaited<ReturnType<typeof startLoopbackConnectGuard>> | undefined;
// A second live loopback TLS listener that only a redirect names; any TCP accept or request here is a confinement failure.
let second: https.Server | undefined;
let secondPort = 0;
let secondConnections = 0;
const secondArrivals: { method: string; url: string }[] = [];
let origin = "";
let proxyPort = 0;
let closedPort = 0;
let fault = false;
let redirectTo: string | undefined;
let upstreamErrors = 0;
const arrivals: Arrival[] = [];

// Independent header-signed read-back; the PUT under test uses only the production presigner.
async function readBack(uri: string) {
  const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const headers: Record<string, string> = { host: storageHost, "x-amz-content-sha256": hash(""), "x-amz-date": date };
  const names = Object.keys(headers).sort();
  const canonical = ["GET", uri, "", names.map(name => `${name}:${headers[name]}\n`).join(""), names.join(";"), hash("")].join("\n");
  const scope = `${date.slice(0, 8)}/auto/s3/aws4_request`;
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.secretAccessKey}`, date.slice(0, 8)), "auto"), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${env.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return fetch(`${endpoint}${uri}`, { headers, signal: AbortSignal.timeout(5000) });
}

async function expectNotStored(uri: string) {
  const stored = await readBack(uri);
  expect(stored.status).toBe(404); await stored.text();
}

function sign(body: Buffer, contentType: string) {
  const signed = presignFoundationQuarantinePut(env, { key: `quarantine/browser-transport/${randomUUID()}/source.bin`,
    contentType, contentLength: body.length, expiresInSeconds: 300 });
  if (!signed.ok) throw new Error(`Production signer refused fixture: ${signed.code}`);
  return { uploadUrl: signed.uploadUrl, target: new URL(signed.uploadUrl), contentType };
}

// Passed as source text so the transpiler cannot inject helpers into the page function.
// A cross-origin PUT with a non-safelisted content type is always preflighted, so the upload listeners do not change
// the CORS mode. Only the signed content-type is set: no unsigned custom header is sent to storage.
// headersReceived is set only by a real HEADERS_RECEIVED state; error/timeout steps jump straight to DONE.
const browserPut = `({ url, contentType, body }) => new Promise(resolve => {
  const xhr = new XMLHttpRequest();
  const started = performance.now();
  let uploaded = -1;
  let headersReceived = false;
  const done = (error, text) => resolve({ status: xhr.status, error, text, uploaded, headersReceived, ms: Math.round(performance.now() - started) });
  xhr.open("PUT", url);
  xhr.timeout = 15000;
  xhr.setRequestHeader("content-type", contentType);
  xhr.upload.onprogress = event => { uploaded = event.loaded; };
  xhr.upload.onload = event => { uploaded = event.loaded; };
  xhr.onreadystatechange = () => { if (xhr.readyState === 2) headersReceived = true; };
  xhr.onload = () => done(false, xhr.responseText);
  xhr.onerror = () => done(true, "");
  xhr.ontimeout = () => done(true, "timeout");
  xhr.send(new Uint8Array(body));
})`;
const put = (page: Page, url: string, contentType: string, body: Buffer) =>
  page.evaluate(`(${browserPut})(${JSON.stringify({ url, contentType, body: [...body] })})`) as Promise<XhrResult>;

// Diagnostics and assertion diffs carry the signed path but no query value (credential scope, signature, expiry).
// Exactness of the signed query is asserted as a boolean instead, so a failure never prints it.
const redact = (url: string) => url.replace(/([?&][^=&#]*=)[^&#]*/g, "$1<redacted>");
const view = (arrival: Arrival, signedPath?: string) => ({ ...arrival, url: redact(arrival.url),
  ...(signedPath === undefined ? {} : { exactSignedUrl: arrival.url === signedPath }) });
// The S3 response body may echo the canonical request and access key, so only its error code and size are reported.
const xhrView = ({ text, ...result }: XhrResult) => ({ ...result, timedOut: text === "timeout", textLength: text.length,
  s3Code: /<Code>([^<]*)<\/Code>/.exec(text)?.[1] });
const transcript = (result: XhrResult, before: number, browserLog: string[]) => JSON.stringify({
  xhr: xhrView(result), listener: arrivals.slice(before).map(arrival => view(arrival)), browser: browserLog }, null, 1);

async function harnessPage(routed: boolean, onBlocked?: (url: string) => void) {
  const context: BrowserContext = await browser!.newContext({ ignoreHTTPSErrors: true });
  // What Chromium itself reports, so a missing listener arrival can be told apart from a request never issued.
  const browserLog: string[] = [];
  const failures: Failure[] = [];
  context.on("request", request => { browserLog.push(`request ${request.method()} ${redact(request.url())}`); });
  context.on("response", response => { browserLog.push(`response ${response.status()} ${response.request().method()} ${redact(response.url())}`); });
  context.on("requestfailed", request => {
    const url = request.url();
    const failure: Failure = { method: request.method(), host: new URL(url).host, url: redact(url),
      redirected: request.redirectedFrom() !== null, errorText: request.failure()?.errorText };
    failures.push(failure);
    browserLog.push(`failed ${failure.method} ${failure.url}${failure.redirected ? " (redirect hop)" : ""}: ${failure.errorText}`);
  });
  if (routed) await routeLocalStorageTransport(context, origin, onBlocked);
  const page = await context.newPage();
  await page.goto(`${origin}/__harness`, { waitUntil: "domcontentloaded" });
  return { context, page, browserLog, failures };
}

// Decision logic only, against recorded route calls; the Chromium suite below is the transport evidence.
type RouteCall = [string, ...unknown[]];
function installWithRecorder(local: string, onBlocked?: (url: string) => void) {
  let handler: ((route: unknown) => unknown) | undefined;
  const installed: unknown[] = [];
  const context = { route: (pattern: string, next: (route: unknown) => unknown) => { installed.push(pattern); handler = next; return Promise.resolve(); } };
  routeLocalStorageTransport(context as unknown as BrowserContext, local, onBlocked);
  return {
    installed,
    async visit(url: string) {
      const calls: RouteCall[] = [];
      await handler!({
        request: () => ({ url: () => url }),
        continue: async (...args: unknown[]) => { calls.push(["continue", ...args]); },
        abort: async () => { calls.push(["abort"]); },
        fulfill: async () => { calls.push(["fulfill"]); },
        fetch: async () => { calls.push(["fetch"]); },
      });
      return calls;
    },
  };
}

describe("local storage transport helper guards", () => {
  it.each([
    "https://localhost:8443", "https://example.com", "https://203.0.113.7:8443", "http://127.0.0.1:8443",
    "https://user:secret@127.0.0.1:8443", "https://127.0.0.1:8443/path", "https://127.0.0.1:8443/?q=1", "https://127.0.0.1:8443/#h",
    "https://127.0.0.1:8443?", "https://127.1:8443", "https://127.0.0.1.:8443", "https://[::1]:8443", "127.0.0.1:8443", "not a url", "",
  ])("refuses origin %j before installing a route", bad => {
    const installed: unknown[] = [];
    const context = { route: (...args: unknown[]) => { installed.push(args); return Promise.resolve(); } };
    expect(() => routeLocalStorageTransport(context as unknown as BrowserContext, bad)).toThrow(TypeError);
    expect(installed).toHaveLength(0);
  });

  it("continues only the exact local origin and rewrites only default-port HTTPS storage URLs", async () => {
    const blocked: string[] = [];
    const recorder = installWithRecorder("https://127.0.0.1:8443/", url => { blocked.push(url); });
    expect(recorder.installed).toEqual(["**/*"]);
    expect(await recorder.visit("https://127.0.0.1:8443/__harness?x=1")).toEqual([["continue"]]);
    const signed = `https://${storageHost}/bucket/key%20a.bin?X-Amz-Signature=ab%2Fcd&X-Amz-Expires=300`;
    // Chromium itself sends the rewritten request; the helper never fetches or fulfills on the browser's behalf.
    expect(await recorder.visit(signed)).toEqual([
      ["continue", { url: "https://127.0.0.1:8443/bucket/key%20a.bin?X-Amz-Signature=ab%2Fcd&X-Amz-Expires=300" }],
    ]);
    const refused = [`https://${storageHost}:8443/bucket/key`, `http://${storageHost}/bucket/key`, "https://127.0.0.1:9443/bucket/key",
      "http://127.0.0.1:8443/bucket/key", "https://localhost:8443/bucket/key", `https://${storageHost}.evil.example/bucket/key`];
    for (const url of refused) expect(await recorder.visit(url)).toEqual([["abort"]]);
    expect(blocked).toEqual(refused);
  });

  it("exports a fail-closed resolver that admits only localhost and 127.0.0.1", () => {
    expect([...loopbackOnlyChromiumArgs]).toEqual(["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1"]);
    expect(loopbackOnlyChromiumArgs.join(" ")).not.toContain(storageHost);
  });
});

// First response line from the guard for one raw proxy request.
function rawProxy(port: number, request: string) {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    const socket = net.connect(port, "127.0.0.1", () => { socket.write(request); });
    socket.setEncoding("latin1");
    socket.on("data", chunk => { text += chunk; if (text.includes("\r\n\r\n")) socket.destroy(); });
    socket.on("close", () => resolve(text.split("\r\n")[0]));
    socket.on("error", reject);
  });
}

describe("loopback CONNECT guard", () => {
  it.each([["127.0.0.1:0"], ["127.0.0.1:65536"], ["127.0.0.1:080"], ["127.0.0.2:8443"], ["127.1:8443"], ["[::1]:8443"], ["localhost"],
    [`${storageHost}:443`], ["example.com:443"], [" 127.0.0.1:8443"], ["https://127.0.0.1:8443"]])("refuses target %j at construction", async bad => {
    await expect(startLoopbackConnectGuard([bad])).rejects.toThrow(TypeError);
  });

  it("refuses an empty target list", async () => {
    await expect(startLoopbackConnectGuard([])).rejects.toThrow(TypeError);
  });

  it("tunnels only the exact listener port and refuses other targets and plain proxy traffic before connecting", async () => {
    let allowedConnections = 0;
    let otherConnections = 0;
    const held: net.Socket[] = [];
    const allowedServer = net.createServer(socket => { allowedConnections++; held.push(socket); });
    const otherServer = net.createServer(socket => { otherConnections++; held.push(socket); });
    await Promise.all([allowedServer, otherServer].map(server => new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))));
    const allowedPort = (allowedServer.address() as net.AddressInfo).port;
    const otherPort = (otherServer.address() as net.AddressInfo).port;
    const local = await startLoopbackConnectGuard([`127.0.0.1:${allowedPort}`, `localhost:${allowedPort}`]);
    try {
      expect(local.proxyServer).toBe(`http://127.0.0.1:${local.port}`);
      expect([...guardedChromiumArgs(local)]).toEqual([...loopbackOnlyChromiumArgs, `--proxy-server=http://127.0.0.1:${local.port}`, "--proxy-bypass-list=<-loopback>"]);
      const connect = (target: string) => rawProxy(local.port, `CONNECT ${target} HTTP/1.1\r\nhost: ${target}\r\n\r\n`);
      expect(await connect(`127.0.0.1:${allowedPort}`)).toBe("HTTP/1.1 200 Connection Established");
      expect(await connect(`localhost:${allowedPort}`)).toBe("HTTP/1.1 200 Connection Established");
      await expect.poll(() => allowedConnections).toBe(2);
      for (const target of [`127.0.0.1:${otherPort}`, `localhost:${otherPort}`, `${storageHost}:443`]) {
        expect(await connect(target)).toBe("HTTP/1.1 403 Forbidden");
      }
      expect(await rawProxy(local.port, `GET http://127.0.0.1:${allowedPort}/bucket/key?X-Amz-Signature=never-logged HTTP/1.1\r\nhost: 127.0.0.1:${allowedPort}\r\n\r\n`))
        .toBe("HTTP/1.1 405 Method Not Allowed");
      expect(otherConnections).toBe(0);
      expect(allowedConnections).toBe(2);
      expect(local.accepted).toEqual([{ kind: "connect", target: `127.0.0.1:${allowedPort}` }, { kind: "connect", target: `localhost:${allowedPort}` }]);
      expect(local.rejected).toEqual([{ kind: "connect", target: `127.0.0.1:${otherPort}` }, { kind: "connect", target: `localhost:${otherPort}` },
        { kind: "connect", target: `${storageHost}:443` }, { kind: "non-connect", method: "GET" }]);
      expect(JSON.stringify(local.rejected)).not.toContain("never-logged");
    } finally {
      await local.close();
      for (const socket of held) socket.destroy();
      await Promise.all([allowedServer, otherServer].map(server => new Promise(resolve => server.close(resolve))));
    }
  });
});

describe.skipIf(!endpoint)("actual Chromium XHR through the browser storage transport to actual disposable S3", () => {
  beforeAll(async () => {
    if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error("Only a loopback disposable S3 endpoint is accepted");
    if (!env.accessKeyId || !env.secretAccessKey) throw new Error("Missing ephemeral fixture keys");
    const s3Port = Number(new URL(endpoint).port);
    root = mkdtempSync(path.join(localS3TempRoot(), "tavonel-browser-transport-"));
    const passphrase = randomBytes(32).toString("hex");
    // Creates local files only. Never imports a certificate or changes a trust store.
    const tlsEnv = { ...process.env, TAVONEL_TLS_ROOT: root, TAVONEL_TLS_PASSWORD: passphrase };
    if (process.platform === "win32") {
      execFileSync(process.env.TAVONEL_LOCAL_POWERSHELL ?? "pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", `
        $rsa=[System.Security.Cryptography.RSA]::Create(2048)
        $req=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $san.AddDnsName('localhost'); $san.AddDnsName('00000000000000000000000000000000.r2.cloudflarestorage.com'); $san.AddIpAddress([System.Net.IPAddress]::Loopback)
        $req.CertificateExtensions.Add($san.Build())
        $cert=$req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddHours(2))
        [System.IO.File]::WriteAllBytes([System.IO.Path]::Combine($env:TAVONEL_TLS_ROOT,'fixture.pfx'),$cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$env:TAVONEL_TLS_PASSWORD))
        [System.IO.File]::WriteAllText([System.IO.Path]::Combine($env:TAVONEL_TLS_ROOT,'fixture.pem'),$cert.ExportCertificatePem())
        $cert.Dispose(); $rsa.Dispose()
      `], { env: tlsEnv, windowsHide: true, timeout: 15_000 });
    } else {
      // Same RSA-2048/SHA-256 self-signed fixture and SAN set via OpenSSL. `req -days` cannot express the two-hour
      // window, so this one is valid for one day. The key touches disk only passphrase-encrypted and is removed once in the PFX.
      const key = path.join(root, "fixture.key");
      const openssl = (...args: string[]) => execFileSync("openssl", args, { env: tlsEnv, timeout: 15_000 });
      openssl("req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "1", "-subj", "/CN=localhost",
        "-addext", `subjectAltName=DNS:localhost,DNS:${storageHost},IP:127.0.0.1`,
        "-keyout", key, "-passout", "env:TAVONEL_TLS_PASSWORD", "-out", path.join(root, "fixture.pem"));
      openssl("pkcs12", "-export", "-inkey", key, "-passin", "env:TAVONEL_TLS_PASSWORD", "-in", path.join(root, "fixture.pem"),
        "-out", path.join(root, "fixture.pfx"), "-passout", "env:TAVONEL_TLS_PASSWORD");
      rmSync(key);
    }
    // A loopback port with no listener: the controlled upstream fault is a real refused connection.
    const reserved = net.createServer();
    await new Promise<void>(resolve => reserved.listen(0, "127.0.0.1", resolve));
    closedPort = (reserved.address() as net.AddressInfo).port;
    await new Promise(resolve => reserved.close(resolve));
    proxy = https.createServer({ pfx: readFileSync(path.join(root, "fixture.pfx")), passphrase }, (request, response) => {
      const arrival: Arrival = { method: request.method ?? "", url: request.url ?? "", host: request.headers.host, origin: request.headers.origin,
        contentType: request.headers["content-type"], contentLength: request.headers["content-length"] };
      arrivals.push(arrival);
      const started = Date.now();
      const elapsed = () => Date.now() - started;
      response.on("close", () => { arrival.responseMs = elapsed(); arrival.responseComplete = response.writableFinished; });
      // CORS response headers exist only for this disposable harness; S3's own CORS is not under test.
      const cors: Record<string, string> = request.headers.origin
        ? { "access-control-allow-origin": request.headers.origin, "access-control-expose-headers": "etag", vary: "origin" } : {};
      if (request.method === "GET" && request.url === "/__harness") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end("<!doctype html><title>Local storage transport harness</title>"); return;
      }
      if (request.method === "OPTIONS") {
        arrival.preflightMethod = request.headers["access-control-request-method"];
        arrival.preflightHeaders = request.headers["access-control-request-headers"];
        response.writeHead(204, { ...cors, "access-control-allow-methods": "PUT", "access-control-allow-headers": "content-type", "access-control-max-age": "0" });
        response.end(); return;
      }
      const digest = createHash("sha256");
      let bytes = 0;
      request.on("data", (chunk: Buffer) => { digest.update(chunk); bytes += chunk.length; });
      request.on("end", () => { arrival.bodyBytes = bytes; arrival.bodySha256 = digest.digest("hex"); arrival.bodyEndMs = elapsed(); });
      if (redirectTo) {
        // A real redirect from the local listener; only the browser's resolver decides whether its target is reachable.
        request.resume();
        response.writeHead(307, { ...cors, location: redirectTo, "cache-control": "no-store" });
        response.end(); return;
      }
      // Pass-through: unchanged method, path+query, headers and streamed body; only the signed Host is restored.
      const forwarded = http.request({ hostname: "127.0.0.1", port: fault ? closedPort : s3Port, path: request.url, method: request.method,
        headers: { ...request.headers, host: storageHost }, agent: false }, upstream => {
          arrival.upstreamStatus = upstream.statusCode; arrival.upstreamMs = elapsed();
          const headers = Object.fromEntries(Object.entries(upstream.headers).filter(([name]) => !name.startsWith("access-control-")));
          response.writeHead(upstream.statusCode!, { ...headers, ...cors }); upstream.pipe(response);
        });
      arrival.forwardedHost = String(forwarded.getHeader("host"));
      // No synthesized status: an unreachable upstream becomes a dropped browser connection.
      forwarded.on("finish", () => { arrival.forwardedBodyMs = elapsed(); });
      forwarded.on("error", error => { arrival.upstreamError = (error as NodeJS.ErrnoException).code ?? error.message; upstreamErrors++; response.destroy(); });
      request.pipe(forwarded);
    });
    await new Promise<void>(resolve => proxy!.listen(0, "127.0.0.1", resolve));
    proxyPort = (proxy.address() as net.AddressInfo).port;
    origin = `https://127.0.0.1:${proxyPort}`;
    second = https.createServer({ pfx: readFileSync(path.join(root, "fixture.pfx")), passphrase }, (request, response) => {
      secondArrivals.push({ method: request.method ?? "", url: redact(request.url ?? "") });
      request.resume(); response.writeHead(418); response.end();
    });
    second.on("connection", () => { secondConnections++; });
    await new Promise<void>(resolve => second!.listen(0, "127.0.0.1", resolve));
    secondPort = (second.address() as net.AddressInfo).port;
    // localhost is admitted only for the CORS test's second origin on the same listener port.
    guard = await startLoopbackConnectGuard([`127.0.0.1:${proxyPort}`, `localhost:${proxyPort}`]);
    const nextRoot = path.resolve(import.meta.dirname, "../..");
    const { chromium } = await import(pathToFileURL(path.join(nextRoot, "node_modules/@playwright/test/index.mjs")).href);
    // Same guarded launch as the Next runner: the fail-closed resolver plus every connection, loopback included, through
    // the CONNECT guard, which covers redirect hops that routing never sees. The redirect tests below depend on it.
    browser = await chromium.launch({ headless: true, args: [...guardedChromiumArgs(guard)] });
  }, 60_000);

  afterAll(async () => {
    try {
      if (browser) await browser.close();
    } finally {
      try {
        if (guard) await guard.close();
      } finally {
        try {
          if (second) { second.closeAllConnections(); await new Promise(resolve => second!.close(resolve)); }
        } finally {
          try {
            if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy!.close(resolve)); }
          } finally { if (root) rmSync(root, { recursive: true, force: true }); }
        }
      }
    }
  });

  // Network path, stated exactly: Chromium issues the XHR; the helper continues it with only the URL rewritten to the
  // local listener, so Chromium's own network stack uploads the body; the listener relays it to actual S3 with the
  // signed Host restored. Playwright answers this context's preflight itself; the next test proves a Chromium-network preflight.
  it("delivers a Chromium XHR's signed PUT unchanged over Chromium's network and actual S3 stores the exact bytes", async () => {
    const body = Buffer.concat([Buffer.from("TAVONEL synthetic browser transport fixture. Not customer data.\n"), randomBytes(4096)]);
    const signed = sign(body, "application/pdf");
    const signedPath = signed.target.pathname + signed.target.search;
    const { context, page, browserLog } = await harnessPage(true);
    try {
      const before = arrivals.length;
      const result = await put(page, signed.uploadUrl, signed.contentType, body);
      const evidence = transcript(result, before, browserLog);
      expect(xhrView(result), evidence).toMatchObject({ error: false, status: 200 });
      const puts = arrivals.slice(before).filter(arrival => arrival.method === "PUT").map(arrival => view(arrival, signedPath));
      expect(puts, evidence).toHaveLength(1);
      expect(puts[0], evidence).toMatchObject({ method: "PUT", url: redact(signedPath), exactSignedUrl: true, host: `127.0.0.1:${proxyPort}`,
        contentType: "application/pdf", contentLength: String(body.length), bodyBytes: body.length, bodySha256: hash(body),
        forwardedHost: storageHost, origin, upstreamStatus: 200 });
      const stored = await readBack(signed.target.pathname);
      expect(stored.status).toBe(200);
      expect(Buffer.from(await stored.arrayBuffer()).equals(body)).toBe(true);
    } finally { await context.close(); }
  });

  // Playwright answers CORS preflights itself while routing is enabled, so the preflight that must
  // reach the proxy is proven from an unrouted context against a second loopback origin.
  it("answers an actual Chromium CORS preflight before the signed cross-origin PUT", async () => {
    const body = randomBytes(2048);
    const signed = sign(body, "application/octet-stream");
    const signedPath = signed.target.pathname + signed.target.search;
    const { context, page, browserLog } = await harnessPage(false);
    try {
      const before = arrivals.length;
      const result = await put(page, `https://localhost:${proxyPort}${signedPath}`, signed.contentType, body);
      const evidence = transcript(result, before, browserLog);
      expect(xhrView(result), evidence).toMatchObject({ error: false, status: 200 });
      const seen = arrivals.slice(before).map(arrival => view(arrival, signedPath));
      expect(seen.map(arrival => arrival.method), evidence).toEqual(["OPTIONS", "PUT"]);
      expect(seen[0], evidence).toMatchObject({ method: "OPTIONS", url: redact(signedPath), exactSignedUrl: true, host: `localhost:${proxyPort}`,
        origin, preflightMethod: "PUT", preflightHeaders: "content-type" });
      expect(seen[1], evidence).toMatchObject({ method: "PUT", url: redact(signedPath), exactSignedUrl: true, host: `localhost:${proxyPort}`, origin,
        contentType: "application/octet-stream", contentLength: String(body.length), bodyBytes: body.length, bodySha256: hash(body),
        forwardedHost: storageHost, upstreamStatus: 200 });
      const stored = await readBack(signed.target.pathname);
      expect(stored.status).toBe(200);
      expect(Buffer.from(await stored.arrayBuffer()).equals(body)).toBe(true);
    } finally { await context.close(); }
  });

  it("delivers a mutated X-Amz-Signature unchanged and actual S3 refuses it", async () => {
    const body = randomBytes(1024);
    const signed = sign(body, "application/octet-stream");
    const signature = signed.target.searchParams.get("X-Amz-Signature")!;
    const mutated = signed.uploadUrl.replace(`X-Amz-Signature=${signature}`, `X-Amz-Signature=${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`);
    const target = new URL(mutated);
    const signedPath = target.pathname + target.search;
    const { context, page, browserLog } = await harnessPage(true);
    try {
      const before = arrivals.length;
      const result = await put(page, mutated, signed.contentType, body);
      const evidence = transcript(result, before, browserLog);
      expect(xhrView(result), evidence).toMatchObject({ error: false, status: 403, s3Code: "SignatureDoesNotMatch" });
      expect(arrivals.slice(before).filter(arrival => arrival.method === "PUT").map(arrival => view(arrival, signedPath)), evidence).toMatchObject([{
        method: "PUT", url: redact(signedPath), exactSignedUrl: true, host: `127.0.0.1:${proxyPort}`, origin, contentType: "application/octet-stream",
        contentLength: String(body.length), bodyBytes: body.length, bodySha256: hash(body), forwardedHost: storageHost, upstreamStatus: 403 }]);
    } finally { await context.close(); }
    await expectNotStored(signed.target.pathname);
  });

  it("reports XHR failure when the local upstream is unreachable", async () => {
    const body = randomBytes(512);
    const signed = sign(body, "application/octet-stream");
    const { context, page, browserLog } = await harnessPage(true);
    const errorsBefore = upstreamErrors;
    fault = true;
    try {
      const before = arrivals.length;
      const result = await put(page, signed.uploadUrl, signed.contentType, body);
      const evidence = transcript(result, before, browserLog);
      expect(xhrView(result), evidence).toMatchObject({ error: true, status: 0 });
      expect(upstreamErrors, evidence).toBeGreaterThan(errorsBefore);
    } finally { fault = false; await context.close(); }
    await expectNotStored(signed.target.pathname);
  });

  // The helper rewrote only the initial signed URL to loopback. The listener then redirects to the external signed
  // storage hostname; Playwright does not run routes for redirect hops, so neither the helper nor onBlocked sees that
  // hop. Through an HTTP proxy Chromium does not resolve the target itself: the hop reaches the CONNECT guard as the
  // exact storage host:443, which is refused before any connection. The resolver rules stay as a second layer.
  it("fails a listener redirect to the external storage hostname at the CONNECT guard", async () => {
    const body = randomBytes(768);
    const signed = sign(body, "application/octet-stream");
    const signedPath = signed.target.pathname + signed.target.search;
    const notified: string[] = [];
    const { context, page, browserLog, failures } = await harnessPage(true, url => { notified.push(redact(url)); });
    redirectTo = `https://${storageHost}${signedPath}`;
    try {
      const before = arrivals.length;
      const rejectedBefore = guard!.rejected.length;
      const result = await put(page, signed.uploadUrl, signed.contentType, body);
      const evidence = () => `${transcript(result, before, browserLog)}\nfailures ${JSON.stringify(failures)}\nguard ${JSON.stringify(guard!.rejected.slice(rejectedBefore))}`;
      expect(xhrView(result), evidence()).toMatchObject({ error: true, status: 0 });
      await expect.poll(() => guard!.rejected.slice(rejectedBefore).some(entry => entry.kind === "connect" && entry.target === `${storageHost}:443`),
        { timeout: 5000, message: evidence() }).toBe(true);
      // requestfailed may be delivered after the page's XHR settles.
      await expect.poll(() => failures.some(failure => failure.host === storageHost && /ERR_TUNNEL_CONNECTION_FAILED/.test(failure.errorText ?? "")),
        { timeout: 5000, message: evidence() }).toBe(true);
      const seen = arrivals.slice(before).map(arrival => view(arrival, signedPath));
      // Exactly the initial rewritten PUT reached the listener; the redirect hop never arrived under any Host.
      expect(seen.filter(arrival => arrival.method === "PUT"), evidence()).toMatchObject([{ url: redact(signedPath), exactSignedUrl: true,
        host: `127.0.0.1:${proxyPort}` }]);
      expect(seen.filter(arrival => arrival.host !== `127.0.0.1:${proxyPort}`), evidence()).toEqual([]);
      expect(notified, evidence()).toEqual([]);
    } finally { redirectTo = undefined; await context.close(); }
    await expectNotStored(signed.target.pathname);
  });

  // The resolver admits 127.0.0.1 on every port and routes never see redirect hops, so a redirect to a second live
  // loopback TLS listener is stopped only by the CONNECT guard's exact host:port allowlist.
  it("fails a listener redirect to another live loopback TLS port at the CONNECT guard", async () => {
    const body = randomBytes(640);
    const signed = sign(body, "application/octet-stream");
    const signedPath = signed.target.pathname + signed.target.search;
    const target = `127.0.0.1:${secondPort}`;
    const notified: string[] = [];
    const { context, page, browserLog, failures } = await harnessPage(true, url => { notified.push(redact(url)); });
    redirectTo = `https://${target}${signedPath}`;
    try {
      const before = arrivals.length;
      const rejectedBefore = guard!.rejected.length;
      const acceptedBefore = guard!.accepted.length;
      const connectionsBefore = secondConnections;
      const result = await put(page, signed.uploadUrl, signed.contentType, body);
      const evidence = () => `${transcript(result, before, browserLog)}\nfailures ${JSON.stringify(failures)}\nguard ${JSON.stringify({
        rejected: guard!.rejected.slice(rejectedBefore), accepted: guard!.accepted.slice(acceptedBefore) })}\nsecond ${JSON.stringify(secondArrivals)}`;
      expect(xhrView(result), evidence()).toMatchObject({ error: true, status: 0 });
      await expect.poll(() => guard!.rejected.slice(rejectedBefore).some(entry => entry.kind === "connect" && entry.target === target),
        { timeout: 5000, message: evidence() }).toBe(true);
      expect(guard!.accepted.slice(acceptedBefore).filter(entry => entry.target === target), evidence()).toEqual([]);
      // Refused before connecting: the second listener never accepted a TCP connection, so no signed request reached it.
      expect(secondConnections - connectionsBefore, evidence()).toBe(0);
      expect(secondArrivals, evidence()).toEqual([]);
      const seen = arrivals.slice(before).map(arrival => view(arrival, signedPath));
      expect(seen.filter(arrival => arrival.method === "PUT"), evidence()).toMatchObject([{ url: redact(signedPath), exactSignedUrl: true,
        host: `127.0.0.1:${proxyPort}` }]);
      expect(notified, evidence()).toEqual([]);
    } finally { redirectTo = undefined; await context.close(); }
    await expectNotStored(signed.target.pathname);
  });

  it("aborts nonallowed hosts, ports and loopback origins before any network traffic", async () => {
    const body = randomBytes(256);
    const signed = sign(body, "application/octet-stream");
    const aborted: string[] = [];
    const { context, page } = await harnessPage(true, url => { aborted.push(url); });
    try {
      const before = arrivals.length;
      const pathAndQuery = `${signed.target.pathname}${signed.target.search}`;
      // localhost reaches this proxy if not aborted, so silence at the listener proves no traffic.
      const blocked = [`https://localhost:${proxyPort}${pathAndQuery}`, `https://127.0.0.1:${closedPort}${pathAndQuery}`, `https://${storageHost}:8443${pathAndQuery}`];
      for (const url of blocked) expect(xhrView(await put(page, url, signed.contentType, body)), redact(url)).toMatchObject({ error: true, status: 0 });
      expect(arrivals.slice(before).map(arrival => view(arrival))).toEqual([]);
      for (const url of blocked) expect(aborted.includes(url), `${redact(url)} not in ${JSON.stringify(aborted.map(redact))}`).toBe(true);
    } finally { await context.close(); }
    await expectNotStored(signed.target.pathname);
  });
});
