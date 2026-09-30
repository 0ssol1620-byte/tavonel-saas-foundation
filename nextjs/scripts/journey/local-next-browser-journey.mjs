/** Actual Next/browser + actual S3/PostgREST; /auth/v1/user is explicitly a synthetic identity adapter. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withLocalStorage } from "./local-storage-journey.mjs";

const hash = body => createHash("sha256").update(body).digest("hex");
const hmac = (key, body) => createHmac("sha256", key).update(body).digest();
const storageHost = "00000000000000000000000000000000.r2.cloudflarestorage.com";
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}

export async function qualifyNextBrowser({ root, env, base, token, owner, admin, workspace, artifacts, serviceToken, sql, check, rpc }) {
  assert.ok(process.env.TAVONEL_LOCAL_SEAWEED_EXE, "Next qualification requires the qualified local S3 executable");
  return withLocalStorage(process.env.TAVONEL_LOCAL_SEAWEED_EXE, async storage => {
    const nextRoot = path.resolve(import.meta.dirname, "../..");
    const nextPort = await freePort();
    const passphrase = randomBytes(32).toString("hex");
    // Creates local files only. Never imports a certificate or changes a trust store.
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
    `], { env: { ...env, TAVONEL_TLS_ROOT: root, TAVONEL_TLS_PASSWORD: passphrase }, windowsHide: true, timeout: 15_000 });
    const hits = { syntheticIdentity: 0, actualRest: 0, actualS3: 0 };
    let dropNextRestoreResponse = false;
    let droppedRestoreResponses = 0;
    const proxy = https.createServer({ pfx: readFileSync(path.join(root, "fixture.pfx")), passphrase }, async (request, response) => {
      try {
        if (request.url.startsWith("/auth/v1/user")) {
          hits.syntheticIdentity++;
          const verified = await fetch(`${base}/profiles?select=id`, { headers: { authorization: request.headers.authorization ?? "" }, signal: AbortSignal.timeout(5000) });
          const profiles = await verified.json();
          if (!verified.ok || !profiles[0]?.id) { response.writeHead(401, { "content-type": "application/json" }); response.end(JSON.stringify({ code: "synthetic_session_invalid", message: "Synthetic JWT refused by actual PostgREST" })); return; }
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ id: profiles[0].id, aud: "authenticated", role: "authenticated", email: "owner@journey.invalid", app_metadata: { provider: "synthetic" }, user_metadata: {}, created_at: "2026-09-30T00:00:00Z" })); return;
        }
        if (request.url.startsWith("/auth/")) { response.writeHead(501); response.end("Synthetic adapter does not implement login/refresh"); return; }
        const isStorage = request.headers.host === storageHost || request.url.startsWith(`/${storage.env.S3_BUCKET}/`);
        const isRest = request.url.startsWith("/rest/v1/");
        if (isStorage) hits.actualS3++;
        if (isRest) hits.actualRest++;
        const target = new URL(isStorage ? storage.endpoint : isRest ? base : `http://127.0.0.1:${nextPort}`);
        const forwarded = http.request({ hostname: target.hostname, port: target.port, path: isRest ? request.url.slice("/rest/v1".length) : request.url,
          method: request.method, headers: isStorage ? { ...request.headers, host: storageHost } : request.headers }, upstream => {
            // One explicit local network fault: let the real handler commit, then lose its response.
            if (dropNextRestoreResponse && !isRest && !isStorage && request.method === "POST" && request.url.endsWith("/world/rollback") && upstream.statusCode === 200) {
              dropNextRestoreResponse = false; droppedRestoreResponses++; upstream.resume(); upstream.once("end", () => response.destroy()); return;
            }
            response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
          });
        forwarded.on("error", () => { response.writeHead(502); response.end("Local upstream unavailable"); });
        request.pipe(forwarded);
      } catch { response.writeHead(502); response.end("Local synthetic identity adapter unavailable"); }
    });
    await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const origin = `https://127.0.0.1:${proxy.address().port}`;
    const preload = path.join(root, "r2-loopback-transport.cjs");
    writeFileSync(preload, `const original=globalThis.fetch;globalThis.fetch=(input,init)=>{if(typeof input==='string'){const u=new URL(input);if(u.hostname===${JSON.stringify(storageHost)})return original(${JSON.stringify(origin)}+u.pathname+u.search,init);}return original(input,init);};`);
    let child, browser;
    try {
    // Fixtures remain actual Core outputs; no fabricated package/receipt is admitted.
    for (const artifact of artifacts) {
      const key = `immutable/${workspace}/${workspace}/collections/${artifact.collectionId}/${artifact.manifestDigest.slice(7)}/candidate-world.json`;
      const body = `${JSON.stringify(artifact)}\n`;
      const uri = `/${storage.env.S3_BUCKET}/${key}`;
      const date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const headers = { host: storageHost, "x-amz-content-sha256": hash(body), "x-amz-date": date };
      const names = Object.keys(headers).sort();
      const canonical = ["PUT", uri, "", names.map(name => `${name}:${headers[name]}\n`).join(""), names.join(";"), hash(body)].join("\n");
      const scope = `${date.slice(0,8)}/auto/s3/aws4_request`;
      const keyBytes = hmac(hmac(hmac(hmac(`AWS4${storage.env.AWS_SECRET_ACCESS_KEY}`, date.slice(0,8)), "auto"), "s3"), "aws4_request");
      const signature = createHmac("sha256", keyBytes).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${storage.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
      const result = await fetch(`${storage.endpoint}${uri}`, { method: "PUT", headers, body, signal: AbortSignal.timeout(5000) });
      check("actual S3 admits real Core revision fixture", result.status, 200); await result.text();
    }
    sql(`insert into public.foundation_account_access_grants(user_id,grant_kind,billing_exempt,trial_exempt) values ('${owner}','owner',true,true) on conflict(user_id) do update set active=true,billing_exempt=true,trial_exempt=true`);
    const nextEnv = { ...env, NEXT_TELEMETRY_DISABLED: "1", FOUNDATION_PILOT_USER_IDS: owner,
      NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: token(owner, "anon"), SUPABASE_SERVICE_ROLE_KEY: serviceToken,
      R2_ACCOUNT_ID: storageHost.split(".")[0], R2_BUCKET: storage.env.S3_BUCKET, R2_ACCESS_KEY_ID: storage.env.AWS_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: storage.env.AWS_SECRET_ACCESS_KEY, NODE_EXTRA_CA_CERTS: path.join(root, "fixture.pem"),
      NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, PLAYWRIGHT_LOCAL_HTTP: "1" };
    child = spawn(process.execPath, [path.join(nextRoot, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(nextPort)],
      { cwd: nextRoot, env: nextEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostics = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", part => { diagnostics = (diagnostics + part).slice(-8000); });
    child.on("error", error => { diagnostics += String(error); });
      let ready = false;
      for (let i=0; i<180; i++) {
        if (child.exitCode !== null) throw new Error(`Owned Next exited: ${diagnostics}`);
        try { const r=await fetch(`http://127.0.0.1:${nextPort}/api/collections/${artifacts[0].collectionId}/world`, { signal: AbortSignal.timeout(1000) }); await r.text(); if(r.status===401) {ready=true;break;} } catch { /* bounded compile/start retry */ }
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      assert.ok(ready, `Owned Next did not become ready: ${diagnostics}`);
      const { chromium } = await import(pathToFileURL(path.join(nextRoot, "node_modules/@playwright/test/index.mjs")).href);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.route("**/*", route => { const u=new URL(route.request().url()); return u.hostname==="127.0.0.1" ? route.continue() : route.abort(); });
      const page = await context.newPage();
      await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const request = (resource, bearer, body) => page.evaluate(async ({ resource, bearer, body }) => {
        const response = await fetch(resource, { method: body ? "POST" : "GET", headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json() };
      }, { resource, bearer, body });
      const worldPath = `/api/collections/${artifacts[0].collectionId}/world`;
      await context.addCookies([{ name: "tvnl_device", value: "synthetic-risk-cookie-is-not-authentication", url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
      check("actual browser unauthenticated Next request is refused", (await request(worldPath)).status, 401);
      check("actual browser invalid synthetic JWT is refused", (await request(worldPath, token(owner,"authenticated",{},"invalid-local-key"))).status,401);
      check("actual browser expired synthetic JWT is refused", (await request(worldPath, token(owner,"authenticated",{exp:Math.floor(Date.now()/1000)-120}))).status,401);
      const active = await request(worldPath,token(owner));
      check("actual browser valid synthetic session reads SQL active world",active.status,200);
      check("actual Next world response is not cacheable",active.cache,"no-store");
      for (const artifact of artifacts) {
        const read = await request(`/api/collections/${artifact.collectionId}?manifest=${encodeURIComponent(artifact.manifestDigest)}`,token(owner));
        assert.equal(read.status,200,`Actual exact revision response: ${JSON.stringify(read)}; gateway ${JSON.stringify(hits)}; Next ${diagnostics}`);
        check("browser exact revision reads actual Core artifact through Next and S3",read.status,200);
        check("browser exact revision retains Core receipt binding",read.body.artifact.coreExecution.receipt.outputSha256,artifact.coreExecution.receipt.outputSha256);
        check("browser exact revision retains selected manifest",read.body.artifact.manifestDigest,artifact.manifestDigest);
      }
      const rollbackBody = { operationId: randomUUID(), targetManifestDigest: artifacts[0].manifestDigest,
        expectedCurrentManifest: active.body.activeWorld.manifestDigest, expectedCurrentRevision: active.body.activeWorld.revision,
        reason: "Synthetic browser human review restores retained revision" };
      const rollbackPath = `${worldPath}/rollback`;
      dropNextRestoreResponse = true;
      const interrupted = await request(rollbackPath,token(owner),rollbackBody).then(delivered=>({delivered}),()=>({networkFailure:true}));
      check("actual committed restore response is deliberately interrupted before browser delivery",droppedRestoreResponses,1);
      // Chromium may retry a reset connection automatically; that retry must be a durable replay.
      if(interrupted.delivered) check("browser transport retry after dropped reply receives durable replay",interrupted.delivered.body.world.status,"replayed");
      const afterInterrupt = await request(worldPath,token(owner));
      check("interrupted browser reply does not interrupt committed SQL restore",afterInterrupt.body.activeWorld.revision,active.body.activeWorld.revision+1);
      const restored = await request(rollbackPath, token(owner), rollbackBody);
      assert.equal(restored.status,200,`Actual browser restore: ${JSON.stringify(restored)}`);
      check("actual browser historical restore applies through Next S3 and SQL", restored.body.code, "WORLD_ROLLED_BACK");
      check("browser restore advances exactly one publication revision",restored.body.world.revision,active.body.activeWorld.revision+1);
      const replayed = await request(rollbackPath,token(owner),rollbackBody);
      check("actual browser lost-response replay retains publication revision",replayed.body.world.revision,restored.body.world.revision);
      check("actual browser lost-response replay returns durable receipt",replayed.body.world.status,"replayed");
      const stale = await request(rollbackPath,token(owner),{...rollbackBody, operationId:randomUUID(), targetManifestDigest:artifacts[1].manifestDigest});
      check("actual browser stale publication request is refused",stale.status,409);
      check("actual browser stale publication returns CAS conflict",stale.body.code,"ACTIVE_WORLD_CONFLICT");
      // Atomic fixture setup, not a claim of a product ownership-transfer API: retain exactly one owner.
      sql(`begin; update public.foundation_workspace_members set role='admin' where workspace_key='${workspace}' and user_id='${owner}';
        update public.foundation_workspace_members set role='owner' where workspace_key='${workspace}' and user_id='${admin}'; commit;`);
      const revoked=await rpc("revoke_foundation_workspace_member",{p_workspace_key:workspace,p_actor_user_id:admin,p_subject_user_id:owner,p_request_id:"synthetic-next-revoke"});
      check("actual SQL RPC revokes browser fixture membership",revoked.status,200);
      const refused=await request(worldPath,token(owner));
      check("valid synthetic JWT after membership revoke is refused by actual Next",refused.status,403);
      check("revoked browser principal gets membership refusal",refused.body.code,"WORKSPACE_MEMBERSHIP_REQUIRED");
      const revokedMutation = await request(rollbackPath,token(owner),{...rollbackBody,operationId:randomUUID()});
      check("actual browser revoked membership cannot replay restore authority",revokedMutation.status,403);
      check("browser path traversed actual PostgREST",hits.actualRest>0,true);
      check("browser path traversed actual signed S3",hits.actualS3>=2,true);
      return { actualNextHttpBrowserVerified:true, syntheticIdentityAdapterOnly:true, goTrueLoginVerified:false, hits,
        nextVersion:JSON.parse(readFileSync(path.join(nextRoot,"node_modules/next/package.json"),"utf8")).version,
        nextMode:"development", browserVersion:browser.version(),
        harnessSha256:hash(readFileSync(import.meta.filename)),
        selectedRevisionApiVerified:true, selectedRevisionUiVerified:false, coreArtifactsFromActualHttp:true,
        historicalRestoreBrowserVerified:true, stalePublicationBrowserVerified:true, revokedMembershipBrowserVerified:true,
        committedResponseLossRecoveryVerified:true, browserAutomaticallyRetriedResponseLoss:Boolean(interrupted.delivered), interruptedSignInVerified:false };
    } finally {
      try {
        if(browser) await browser.close();
      } finally {
        try {
          if(child?.exitCode===null) {
            if(process.platform==="win32") execFileSync("taskkill",["/PID",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
            else child.kill();
          }
        } finally { proxy.closeAllConnections(); await new Promise(resolve=>proxy.close(resolve)); }
      }
    }
  });
}
