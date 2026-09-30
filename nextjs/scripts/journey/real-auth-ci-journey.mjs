/** Hosted-runner-only genuine GoTrue qualification. No synthetic /auth endpoint or fabricated JWT. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateDisposableAuthStack } from "./real-auth-ci-contract.mjs";
import { withLocalStorage } from "./local-storage-journey.mjs";

const statusFile = realpathSync(process.env.TAVONEL_AUTH_STACK_STATUS ?? "");
const runnerTemp = realpathSync(process.env.RUNNER_TEMP ?? "");
assert.equal(path.dirname(statusFile), runnerTemp, "Only the workflow-generated local status file is accepted");
const stack = validateDisposableAuthStack(JSON.parse(readFileSync(statusFile, "utf8")), process.env);
assert.equal(process.platform, "linux", "Hosted qualification requires the existing Linux runner");
const nextRoot = path.resolve(import.meta.dirname, "../..");
const output = path.resolve(nextRoot, "output/real-auth-journey.json");
mkdirSync(path.dirname(output),{recursive:true});
const root = mkdtempSync(path.join(tmpdir(), "tavonel-real-auth-"));
const owner = "a1111111-1111-4111-8111-111111111111", workspace = "pilot-a111111111114111";
const origin = "https://127.0.0.1:54443", host = "00000000000000000000000000000000.r2.cloudflarestorage.com";
const email = "real-auth-owner@journey.invalid", password = randomBytes(32).toString("base64url");
const report = { kind: "genuine-local-gotrue-next-browser", success: false, assertions: [], goTrueExecuted: false,
  generatedAt:new Date().toISOString(),harnessSha256:createHash("sha256").update(readFileSync(import.meta.filename)).digest("hex"),
  googleOAuthVerified: false, productionAuthCookieUsed: false, productionSourceAdmissionVerified: false,
  foundationCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: nextRoot, encoding: "utf8" }).trim() };
function check(name, actual, expected) { assert.deepEqual(actual, expected, name); report.assertions.push(name); }
const allowed = new Set(["PATH", "HOME", "TMP", "TEMP", "SYSTEMROOT", "WINDIR"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
async function api(resource, body, bearer = stack.service, method = body ? "POST" : "GET") {
  const response = await fetch(`${stack.api}${resource}`, { method, headers: { apikey: stack.anon, authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function sql(statement) {
  return execFileSync("psql", [stack.db, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { env, encoding: "utf8", timeout: 10_000 }).trim();
}
const fixtures = ["initial", "updated"].map(name => {
  const raw = readFileSync(path.join(import.meta.dirname, "real-auth-fixtures", `${name}.json`));
  const fixture = JSON.parse(raw); assert.equal(fixture.syntheticOnly, true); assert.equal(fixture.workspace, workspace);
  report[`${name}FixtureSha256`] = createHash("sha256").update(raw).digest("hex"); return fixture.artifact;
});
const hash = body => createHash("sha256").update(body).digest("hex");
const hmac = (key, body) => createHmac("sha256", key).update(body).digest();
let userCreated = false;
try {
  const authContainers=execFileSync("docker",["ps","--format","{{.Names}}\t{{.Image}}"],{env,encoding:"utf8",timeout:10_000}).trim().split("\n")
    .map(line=>line.split("\t")).filter(([name,image])=>name.startsWith("supabase_auth_")&&/^(docker\.io\/)?supabase\/gotrue:/.test(image));
  assert.equal(authContainers.length,1,"Require exactly the official GoTrue container started by this fresh CI stack");
  report.authImageTag=authContainers[0][1];
  report.authImageId=execFileSync("docker",["inspect","--format","{{.Image}}",authContainers[0][0]],{env,encoding:"utf8",timeout:10_000}).trim();
  const created = await api("/auth/v1/admin/users", { id: owner, email, password, email_confirm: true });
  check("actual GoTrue admin creates only the fixed disposable fixture identity", created.status, 200);
  check("provider honors fixed fixture UUID", created.body.id, owner); userCreated = true;
  check("actual signup trigger provisions the fixture membership", sql(`select count(*) from public.foundation_workspace_members where workspace_key='${workspace}' and user_id='${owner}' and state='active'`), "1");
  sql(`insert into public.foundation_account_access_grants(user_id,grant_kind,billing_exempt,trial_exempt) values ('${owner}','owner',true,true)`);
  await withLocalStorage(process.env.TAVONEL_LOCAL_SEAWEED_EXE, async storage => {
    for (let i=0; i<fixtures.length; i++) {
      const artifact = fixtures[i], body = `${JSON.stringify(artifact)}\n`;
      const key = `immutable/${workspace}/${workspace}/collections/${artifact.collectionId}/${artifact.manifestDigest.slice(7)}/candidate-world.json`;
      const uri = `/${storage.env.S3_BUCKET}/${key}`, date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const headers = { host, "x-amz-content-sha256": hash(body), "x-amz-date": date }, names = Object.keys(headers).sort();
      const canonical = ["PUT",uri,"",names.map(name=>`${name}:${headers[name]}\n`).join(""),names.join(";"),hash(body)].join("\n");
      const scope = `${date.slice(0,8)}/auto/s3/aws4_request`;
      const signing = hmac(hmac(hmac(hmac(`AWS4${storage.env.AWS_SECRET_ACCESS_KEY}`,date.slice(0,8)),"auto"),"s3"),"aws4_request");
      const signature = createHmac("sha256",signing).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${storage.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
      const stored = await fetch(`${storage.endpoint}${uri}`,{method:"PUT",headers,body,signal:AbortSignal.timeout(8000)});
      check("actual S3 stores unchanged Core-produced Auth UI fixture",stored.status,200); await stored.text();
      const activated = await api("/rest/v1/rpc/transition_foundation_world_atomic", {
        p_operation_id:randomUUID(),p_action:"activate",p_workspace_key:workspace,p_collection_id:artifact.collectionId,
        p_target_manifest_digest:artifact.manifestDigest,p_candidate_object_key:key,p_world_state_id:artifact.coreExecution.worldStateId,
        p_core_output_sha256:artifact.coreExecution.receipt.outputSha256,p_expected_current_state:i===0?"empty":"active",
        p_expected_current_revision:i,p_expected_current_manifest_digest:i===0?null:fixtures[0].manifestDigest,p_actor_user_id:owner,p_reason:"Synthetic real Auth CI fixture publication",
      });
      check("actual SQL publication prepares retained and active Auth UI revisions",activated.status,200);
    }
    execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",path.join(root,"key.pem"),"-out",path.join(root,"cert.pem"),"-days","1","-subj","/CN=localhost","-addext",`subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:${host}`],{env,stdio:"ignore",timeout:15_000});
    const gateway = https.createServer({key:readFileSync(path.join(root,"key.pem")),cert:readFileSync(path.join(root,"cert.pem"))},(request,response)=>{
      const isS3=request.url.startsWith(`/${storage.env.S3_BUCKET}`);
      const target=new URL(isS3?storage.endpoint:request.url.startsWith("/auth/")||request.url.startsWith("/rest/")?stack.api:"http://127.0.0.1:3100");
      const upstream=http.request({hostname:target.hostname,port:target.port,path:request.url,method:request.method,headers:isS3?{...request.headers,host}:request.headers},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response);});
      upstream.on("error",()=>{response.writeHead(502);response.end("Owned local upstream unavailable");}); request.pipe(upstream);
    });
    await new Promise(resolve=>gateway.listen(54443,"127.0.0.1",resolve));
    let child,browser;
    try {
      const preload=path.join(root,"transport.cjs");
      writeFileSync(preload,`const os=require('node:os');const cpus=os.cpus;os.cpus=()=>cpus().slice(0,2);os.availableParallelism=()=>2;const f=globalThis.fetch;globalThis.fetch=(input,init)=>{if(typeof input==='string'){const u=new URL(input);if(u.hostname===${JSON.stringify(host)})return f(${JSON.stringify(origin)}+u.pathname+u.search,init);}return f(input,init);};`);
      const nextEnv={...env,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",NODE_OPTIONS:`--max-old-space-size=2048 --require ${JSON.stringify(preload)}`,NODE_EXTRA_CA_CERTS:path.join(root,"cert.pem"),
        FOUNDATION_PILOT_USER_IDS:owner,NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:stack.anon,SUPABASE_SERVICE_ROLE_KEY:stack.service,
        R2_ACCOUNT_ID:host.split(".")[0],R2_BUCKET:storage.env.S3_BUCKET,R2_ACCESS_KEY_ID:storage.env.AWS_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY:storage.env.AWS_SECRET_ACCESS_KEY};
      // The workflow runs unchanged check/test gates first; build is still a real optimized Next build.
      execFileSync(process.execPath,[path.join(nextRoot,"node_modules/next/dist/bin/next"),"build"],{cwd:nextRoot,env:nextEnv,stdio:"inherit",timeout:480_000});
      child=spawn(process.execPath,[path.join(nextRoot,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3100"],{cwd:nextRoot,env:nextEnv,stdio:["ignore","ignore","ignore"]});
      for(let i=0;i<120;i++) { if(child.exitCode!==null) throw new Error("Owned production Next exited"); try { const r=await fetch("http://127.0.0.1:3100/api/status",{signal:AbortSignal.timeout(500)});await r.text();if(r.ok)break; } catch {} await new Promise(r=>setTimeout(r,250)); }
      const {chromium,expect}=await import(pathToFileURL(path.join(nextRoot,"node_modules/@playwright/test/index.mjs")).href);
      browser=await chromium.launch({headless:true});
      const context=await browser.newContext({ignoreHTTPSErrors:true});
      await context.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
      const page=await context.newPage();
      await page.goto(`${origin}/auth/callback`); await expect(page.getByRole("heading",{name:"Sign-in did not complete."})).toBeVisible();
      check("actual callback without provider session fails visibly",true,true);
      const login=()=>page.evaluate(async ({email,password,anon})=>{const r=await fetch("/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:anon,"content-type":"application/json"},body:JSON.stringify({email,password})});return {status:r.status,body:await r.json()};},{email,password,anon:stack.anon});
      let session=(await login());check("genuine GoTrue password login through browser transport",session.status,200);session=session.body;
      session.expires_at ??= JSON.parse(Buffer.from(session.access_token.split(".")[1],"base64url").toString()).exp;
      report.goTrueExecuted=true;check("actual provider returns the fixture user",session.user.id,owner);
      const storageKey="sb-127-auth-token";
      await page.evaluate(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:storageKey,session});
      // Abort one actual bootstrap network hop. Never synthesize an auth or bootstrap response.
      await page.route("**/api/access/bootstrap",route=>route.abort("failed"));
      await page.goto(`${origin}/auth/callback`);await expect(page.getByRole("heading",{name:"Workspace access needs attention."})).toBeVisible();
      await expect(page.getByText("ACCESS_BOOTSTRAP_UNAVAILABLE",{exact:false})).toBeVisible();
      check("interrupted actual sign-in bootstrap is visible and retains real provider session",true,true);
      await page.unroute("**/api/access/bootstrap");
      await page.goto(`${origin}/auth/callback`);await page.waitForURL("**/workspace",{timeout:30_000});
      check("retry completes actual provider-session callback and bootstrap",true,true);
      const refresh=await api("/auth/v1/token?grant_type=refresh_token",{refresh_token:session.refresh_token},stack.anon);
      check("actual GoTrue refresh succeeds",refresh.status,200);
      check("actual GoTrue rotates refresh token",refresh.body.refresh_token!==session.refresh_token,true);session=refresh.body;
      session.expires_at ??= JSON.parse(Buffer.from(session.access_token.split(".")[1],"base64url").toString()).exp;
      await page.evaluate(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:storageKey,session});
      async function inspect(index,navigate,requireNetwork=true) {
        const artifact=fixtures[index];
        const modelResponse=requireNetwork?page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname===`/api/v1/world/${artifact.collectionId}`&&u.searchParams.get("manifest")===artifact.manifestDigest;}):null;
        await navigate(`${origin}/workspace/world?collection=${artifact.collectionId}&manifest=${encodeURIComponent(artifact.manifestDigest)}`);
        if(modelResponse) {const model=await modelResponse;check("actual selected-revision UI fetch succeeds",model.status(),200);
          check("actual selected-revision model is exact",(await model.json()).model.world.manifestDigest,artifact.manifestDigest);}
        check("selected-revision UI URL retains the exact manifest",new URL(page.url()).searchParams.get("manifest"),artifact.manifestDigest);
        const studio=page.locator('section[aria-labelledby="world-studio-title"]');
        await studio.getByRole("tab",{name:"Evidence",exact:true}).click();
        await expect(studio.getByText(index===0?/30 days/:/45 days/).first()).toBeVisible();
        await expect(studio.getByText(index===0?/45 days/:/30 days/)).toHaveCount(0);
        check("hydrated UI evidence belongs to selected revision",true,true);
      }
      await inspect(0,url=>page.goto(url));await inspect(0,()=>page.reload());await inspect(1,url=>page.goto(url));await inspect(0,()=>page.goBack(),false);
      report.selectedRevisionUiVerified=true;
      const fresh=await login();check("fresh provider session for logout observation",fresh.status,200);session=fresh.body;
      const claims=JSON.parse(Buffer.from(session.access_token.split(".")[1],"base64url").toString());
      assert.ok(claims.exp-Date.now()/1000>30&&claims.exp-Date.now()/1000<120,"The local CI config must use the 60-second test JWT lifetime");
      const logout=await api("/auth/v1/logout?scope=global",null,session.access_token,"POST");check("actual GoTrue global logout succeeds",logout.status,204);
      const revoked=await api("/auth/v1/token?grant_type=refresh_token",{refresh_token:session.refresh_token},stack.anon);
      check("logout revokes actual refresh token",revoked.status>=400&&revoked.status<500,true);
      const immediately=await api("/auth/v1/user",null,session.access_token);
      assert.ok([200,401,403].includes(immediately.status));report.logoutAccessTokenImmediatelyRefused=immediately.status!==200;
      const immediateNext=await page.evaluate(async ({token,collection})=>{const r=await fetch(`/api/collections/${collection}/world`,{headers:{authorization:`Bearer ${token}`}});return r.status;},{token:session.access_token,collection:fixtures[0].collectionId});
      assert.ok([200,401,403].includes(immediateNext));report.nextLogoutAccessTokenImmediatelyRefused=immediateNext!==200;
      // Supabase documents that already-issued JWTs may remain valid until expiry; record, never conceal, that boundary.
      while(Date.now()/1000<=claims.exp+2) await new Promise(resolve=>setTimeout(resolve,250));
      const expired=await api("/auth/v1/user",null,session.access_token);check("naturally expired provider JWT is refused",expired.status,401);
      const downstream=await page.evaluate(async ({token,collection})=>{const r=await fetch(`/api/collections/${collection}/world`,{headers:{authorization:`Bearer ${token}`}});return r.status;},{token:session.access_token,collection:fixtures[0].collectionId});
      check("actual Next refuses naturally expired provider JWT",downstream,401);
      await context.clearCookies();await context.addCookies([{name:"tvnl_device",value:"expired-fixture-risk-cookie",url:origin,expires:Math.floor(Date.now()/1000)-60,httpOnly:true,secure:true}]);
      check("browser does not retain expired trial-risk cookie",(await context.cookies()).some(cookie=>cookie.name==="tvnl_device"),false);
      await page.evaluate(()=>localStorage.clear());await page.goto(`${origin}/auth/callback`);
      await expect(page.getByRole("heading",{name:"Sign-in did not complete."})).toBeVisible();
      check("expired-cookie-only browser cannot establish an app session",true,true);
      report.browserVersion=browser.version();report.nextMode="production";
    } finally {
      try { if(browser)await browser.close(); } finally {
        try {
          if(child&&child.exitCode===null) {
            const closed=new Promise(resolve=>child.once("close",resolve));child.kill();
            let timer;try { await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Owned Next did not stop")),10_000);})]); } finally {clearTimeout(timer);}
          }
        } finally {gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
      }
    }
  });
  report.success=true;
} finally {
  if(userCreated) await api(`/auth/v1/admin/users/${owner}`,null,stack.service,"DELETE").catch(()=>{});
  writeFileSync(output,JSON.stringify(report,null,2));
  assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith("tavonel-real-auth-"));rmSync(root,{recursive:true,force:true});
}
