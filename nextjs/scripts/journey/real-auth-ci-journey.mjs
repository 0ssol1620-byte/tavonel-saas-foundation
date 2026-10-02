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
import { authGatewayService, currentSourceObjects, validateDisposableAuthStack, validateExpiredProviderJwt } from "./real-auth-ci-contract.mjs";
import { withLocalStorage } from "./local-storage-journey.mjs";
import { qualifySourceRevisions } from "./source-revision-journey.mjs";
import { stopOwnedChild } from "./stop-owned-child.mjs";

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
const report = { kind: "genuine-local-gotrue-next-browser", success: false, assertions: [], goTrueExecuted: false, hydratedReviewPublishVerified: false, consumerTransportVerified: false, sourceRevisionLineageVerified: false,
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
// A second, concurrent session on the same disposable database (used for lock qualification).
function sqlAsync(statement) {
  return new Promise(resolve => {
    const child = spawn("psql", [stack.db, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { env, windowsHide: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", part => { stdout += part; });
    child.stderr.on("data", part => { stderr += part; });
    child.once("error", error => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(error) }); });
    child.once("close", code => { clearTimeout(timer); resolve({ code, stdout: stdout.trim(), stderr }); });
  });
}
const fixtures = ["initial", "updated"].map(name => {
  const raw = readFileSync(path.join(import.meta.dirname, "real-auth-fixtures", `${name}.json`));
  const fixture = JSON.parse(raw); assert.equal(fixture.syntheticOnly, true); assert.equal(fixture.workspace, workspace);
  report[`${name}FixtureSha256`] = createHash("sha256").update(raw).digest("hex"); return fixture.artifact;
});
const hash = body => createHash("sha256").update(body).digest("hex");
const hmac = (key, body) => createHmac("sha256", key).update(body).digest();
// The promote route admits a candidate only when its bound source versions are current in storage.
const currentSources = currentSourceObjects(fixtures[1], workspace);
let userCreated = false;
// The consumer-proof API key secret: process memory and owned child environments only, never reported or written.
let consumerSecret = "";
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
  // Review decisions reference the workspace billing account; this disposable row carries no provider customer or subscription.
  sql(`insert into public.foundation_billing_accounts(workspace_key,user_id) values ('${workspace}','${owner}') on conflict (workspace_key) do nothing`);
  await withLocalStorage(process.env.TAVONEL_LOCAL_SEAWEED_EXE, async storage => {
    async function putObject(key, body) {
      const uri = `/${storage.env.S3_BUCKET}/${key}`, date = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const headers = { host, "x-amz-content-sha256": hash(body), "x-amz-date": date }, names = Object.keys(headers).sort();
      const canonical = ["PUT",uri,"",names.map(name=>`${name}:${headers[name]}\n`).join(""),names.join(";"),hash(body)].join("\n");
      const scope = `${date.slice(0,8)}/auto/s3/aws4_request`;
      const signing = hmac(hmac(hmac(hmac(`AWS4${storage.env.AWS_SECRET_ACCESS_KEY}`,date.slice(0,8)),"auto"),"s3"),"aws4_request");
      const signature = createHmac("sha256",signing).update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`).digest("hex");
      headers.authorization = `AWS4-HMAC-SHA256 Credential=${storage.env.AWS_ACCESS_KEY_ID}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
      const stored = await fetch(`${storage.endpoint}${uri}`,{method:"PUT",headers,body,signal:AbortSignal.timeout(8000)});
      await stored.text(); return stored.status;
    }
    for (const artifact of fixtures) {
      const key = `immutable/${workspace}/${workspace}/collections/${artifact.collectionId}/${artifact.manifestDigest.slice(7)}/candidate-world.json`;
      check("actual S3 stores unchanged Core-produced Auth UI fixture",await putObject(key,`${JSON.stringify(artifact)}\n`),200);
      // Only the initial revision is prepared through SQL. The updated one stays a candidate for the hydrated UI to publish.
      if (artifact !== fixtures[0]) continue;
      const activated = await api("/rest/v1/rpc/transition_foundation_world_atomic", {
        p_operation_id:randomUUID(),p_action:"activate",p_workspace_key:workspace,p_collection_id:artifact.collectionId,
        p_target_manifest_digest:artifact.manifestDigest,p_candidate_object_key:key,p_world_state_id:artifact.coreExecution.worldStateId,
        p_core_output_sha256:artifact.coreExecution.receipt.outputSha256,p_expected_current_state:"empty",
        p_expected_current_revision:0,p_expected_current_manifest_digest:null,p_actor_user_id:owner,p_reason:"Synthetic real Auth CI fixture publication",
      });
      check("actual SQL publication prepares the initial active Auth UI revision",activated.status,200);
    }
    for (const source of currentSources) check("actual S3 stores the hash-bound current source version",await putObject(source.key,source.body),200);
    execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",path.join(root,"key.pem"),"-out",path.join(root,"cert.pem"),"-days","1","-subj","/CN=localhost","-addext",`subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:${host}`],{env,stdio:"ignore",timeout:15_000});
    const gateway = https.createServer({key:readFileSync(path.join(root,"key.pem")),cert:readFileSync(path.join(root,"cert.pem"))},(request,response)=>{
      const service=authGatewayService(request.url,storage.env.S3_BUCKET);
      const isS3=service==="s3";
      const target=new URL(isS3?storage.endpoint:service==="supabase"?stack.api:"http://127.0.0.1:3100");
      const upstream=http.request({hostname:target.hostname,port:target.port,path:request.url,method:request.method,headers:isS3?{...request.headers,host}:request.headers},result=>{response.writeHead(result.statusCode,result.headers);result.pipe(response);});
      upstream.on("error",()=>{response.writeHead(502);response.end("Owned local upstream unavailable");}); request.pipe(upstream);
    });
    await new Promise(resolve=>gateway.listen(54443,"127.0.0.1",resolve));
    let child,browser,page;
    const redact = value => [password,stack.anon,stack.service,storage.env.AWS_SECRET_ACCESS_KEY,consumerSecret].filter(Boolean).reduce((text,secret)=>text.replaceAll(secret,"[redacted]"),String(value)).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,"[redacted JWT]").replace(/tvnl_live_[A-Za-z0-9_-]+/g,"[redacted API key]");
    // Diagnostics only: bounded server output and browser events, attached to the ledger on failure. They decide nothing.
    const serverTail=[],browserEvents=[];
    const keep=(list,line,limit)=>{list.push(redact(line).slice(0,500));if(list.length>limit)list.shift();};
    try {
      const preload=path.join(root,"transport.cjs");
      writeFileSync(preload,`const os=require('node:os');const cpus=os.cpus;os.cpus=()=>cpus().slice(0,2);os.availableParallelism=()=>2;const f=globalThis.fetch;globalThis.fetch=(input,init)=>{if(typeof input==='string'){const u=new URL(input);if(u.hostname===${JSON.stringify(host)})return f(${JSON.stringify(origin)}+u.pathname+u.search,init);}return f(input,init);};`);
      const nextEnv={...env,NODE_ENV:"production",NEXT_TELEMETRY_DISABLED:"1",NODE_OPTIONS:`--max-old-space-size=2048 --require ${JSON.stringify(preload)}`,NODE_EXTRA_CA_CERTS:path.join(root,"cert.pem"),
        FOUNDATION_PILOT_USER_IDS:owner,NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:stack.anon,SUPABASE_SERVICE_ROLE_KEY:stack.service,
        R2_ACCOUNT_ID:host.split(".")[0],R2_BUCKET:storage.env.S3_BUCKET,R2_ACCESS_KEY_ID:storage.env.AWS_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY:storage.env.AWS_SECRET_ACCESS_KEY};
      // The workflow runs unchanged check/test gates first; build is still a real optimized Next build.
      execFileSync(process.execPath,[path.join(nextRoot,"node_modules/next/dist/bin/next"),"build"],{cwd:nextRoot,env:nextEnv,stdio:"inherit",timeout:480_000});
      child=spawn(process.execPath,[path.join(nextRoot,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port","3100"],{cwd:nextRoot,env:nextEnv,stdio:["ignore","pipe","pipe"]});
      for(const [stream,label] of [[child.stdout,"out"],[child.stderr,"err"]]) {stream.setEncoding("utf8");stream.on("data",chunk=>{for(const line of chunk.split("\n"))if(line.trim())keep(serverTail,`${label}: ${line}`,200);});}
      for(let i=0;i<120;i++) { if(child.exitCode!==null) throw new Error("Owned production Next exited"); try { const r=await fetch("http://127.0.0.1:3100/api/status",{signal:AbortSignal.timeout(500)});await r.text();if(r.ok)break; } catch {} await new Promise(r=>setTimeout(r,250)); }
      const {chromium,expect}=await import(pathToFileURL(path.join(nextRoot,"node_modules/@playwright/test/index.mjs")).href);
      browser=await chromium.launch({headless:true});
      const context=await browser.newContext({ignoreHTTPSErrors:true});
      await context.route("**/*",route=>new URL(route.request().url()).hostname==="127.0.0.1"?route.continue():route.abort());
      page=await context.newPage();
      const at=()=>new Date().toISOString().slice(11,23),where=url=>{try{return new URL(url).pathname;}catch{return "?";}};
      page.on("console",message=>{if(["error","warning"].includes(message.type()))keep(browserEvents,`${at()} console.${message.type()}: ${message.text()}`,200);});
      page.on("pageerror",error=>keep(browserEvents,`${at()} pageerror: ${error.message}`,200));
      page.on("requestfailed",request=>keep(browserEvents,`${at()} requestfailed ${request.method()} ${where(request.url())}: ${request.failure()?.errorText??"?"}`,200));
      page.on("framenavigated",frame=>{if(frame===page.mainFrame())keep(browserEvents,`${at()} navigated ${where(frame.url())}`,200);});
      page.on("response",response=>{const p=where(response.url());if(/^\/(api\/(collections|v1\/world|access)|auth\/v1\/(token|user))/.test(p))keep(browserEvents,`${at()} ${response.request().method()} ${p} ${response.status()}`,200);});
      report.stage="callback-without-session";
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
      // The app's live client owns this browser session. With this stack's jwt_expiry of 60s, below
      // auth-js's 90s EXPIRY_MARGIN_MS, it refreshes on every page load and 30s tick, so the journey's
      // own copy goes stale. Rotating out-of-band while that client runs raced it (run 36868958092:
      // AuthRefreshDiscardedError, then /login). Detach the app first -- a same-origin static document
      // runs no client -- and rotate the refresh token the browser currently holds.
      await page.waitForLoadState("networkidle");
      await page.goto(`${origin}/llms.txt`);
      const held=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??"null"),storageKey);
      check("browser holds an actual provider session before out-of-band rotation",typeof held?.refresh_token==="string"&&held.user?.id===owner,true);
      session=held;
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
      report.stage="selected-revision-ui";
      await inspect(0,url=>page.goto(url));await inspect(0,()=>page.reload());await inspect(1,url=>page.goto(url));await inspect(0,()=>page.goBack(),false);
      report.selectedRevisionUiVerified=true;
      // Hydrated review and publication: the reviewed production-control driver clicks; Next, SQL and S3 decide.
      report.stage="hydrated-review-publish";
      const {acceptEvidenceThroughUi,activateCandidateThroughUi}=await import(pathToFileURL(path.join(nextRoot,"e2e/support/workspace-review-actions.ts")).href);
      const [published,candidate]=fixtures;
      const scope=`workspace_key='${workspace}' and collection_id='${candidate.collectionId}'`;
      check("candidate is not active before the hydrated publication",sql(`select manifest_digest||'@'||revision from public.foundation_active_worlds where ${scope}`),`${published.manifestDigest}@1`);
      await page.goto(`${origin}/workspace/review?collection=${candidate.collectionId}&manifest=${encodeURIComponent(candidate.manifestDigest)}`);
      await expect(page.getByRole("button",{name:"Accept",exact:true})).toBeVisible({timeout:30_000});
      const accepted=await acceptEvidenceThroughUi(page,candidate.collectionId,candidate.manifestDigest);
      check("actual Next records the hydrated evidence acceptance",accepted.status(),201);
      check("actual SQL retains the accept decision for the exact reviewed revision",
        sql(`select count(*) from public.foundation_review_decisions where ${scope} and manifest_digest='${candidate.manifestDigest}' and action='accept' and actor_user_id='${owner}'`),"1");
      const activated=await activateCandidateThroughUi(page,{collectionId:candidate.collectionId,manifestDigest:candidate.manifestDigest,
        expectedCurrentManifest:published.manifestDigest,expectedCurrentRevision:1},"Reviewed the exact updated payment-terms revision.");
      check("actual Next publishes the reviewed candidate through the hydrated control",activated.status(),200);
      check("publication reply names the active World",(await activated.json()).code,"WORLD_ACTIVE");
      check("actual SQL moves the active pointer to the reviewed revision",sql(`select manifest_digest||'@'||revision from public.foundation_active_worlds where ${scope}`),`${candidate.manifestDigest}@2`);
      check("actual SQL retains the previous revision as superseded",sql(`select lifecycle_status from public.foundation_world_versions where ${scope} and manifest_digest='${published.manifestDigest}'`),"superseded");
      await inspect(1,url=>page.goto(url));
      report.hydratedReviewPublishVerified=true;
      // Consumer transport proof, strictly reads after the human-gated activation above. Actual local
      // GoTrue session + production-mode Next + the shipped MCP stdio server and CLI, over synthetic
      // source/compiler fixtures. Not production identity or data, retrieval quality, or Core qualification.
      report.stage="consumer-transport-proof";
      const consumer={kind:"actual-local-auth-application-consumer-transport",
        basis:"actual local GoTrue Auth + production-mode Next application + direct HTTPS API, shipped MCP stdio JSON-RPC and shipped CLI child process over synthetic source/compiler fixtures",
        productionIdentity:false,productionData:false,retrievalQualityMeasured:false,coreQualified:false,
        readOnlyAfterHumanGatedActivation:true,promotionOrRollbackFromConsumers:false,
        apiKeyIssuedBy:"POST /api/developer/keys with the GoTrue owner session under the existing explicit owner grant",
        apiKeySecretPersisted:false,apiKeySecretReported:false};
      report.consumerTransport=consumer;
      check("consumer proof is labelled local Auth + application + transport over synthetic fixtures only",
        [consumer.productionIdentity,consumer.productionData,consumer.retrievalQualityMeasured,consumer.coreQualified,consumer.readOnlyAfterHumanGatedActivation],[false,false,false,false,true]);
      const consumerOrigin=new URL(origin);
      check("consumer transports address only the exact loopback origin",[consumerOrigin.protocol,consumerOrigin.hostname,consumerOrigin.origin],["https:","127.0.0.1",origin]);
      const consumerCa=readFileSync(path.join(root,"cert.pem"));
      // Direct production-mode Next API through the owned gateway, trusting only the run's local certificate.
      const appRequest=(resource,bearer,body)=>new Promise((resolve,reject)=>{
        const url=new URL(resource,origin);
        if(url.origin!==origin) return reject(new Error("Consumer request left the exact loopback origin"));
        const payload=body===undefined?null:JSON.stringify(body);
        const request=https.request(url,{method:payload?"POST":"GET",ca:consumerCa,timeout:60_000,headers:{authorization:`Bearer ${bearer}`,accept:"application/vnd.tavonel.v1+json",
          ...(payload?{"content-type":"application/json","content-length":Buffer.byteLength(payload)}:{})}},response=>{
          let text="";response.setEncoding("utf8");response.on("data",part=>{text+=part;});
          response.on("end",()=>{let json=null;try{json=JSON.parse(text);}catch{}resolve({status:response.statusCode,body:json});});
        });
        request.on("timeout",()=>request.destroy(new Error("Loopback consumer request timed out")));request.on("error",reject);request.end(payload??undefined);
      });
      // Shipped consumer artifacts as owned child processes; the key travels only in their environment.
      const runConsumer=async (script,args,input="",childEnv=consumerEnv)=>{
        const owned=spawn(process.execPath,[script,...args],{cwd:root,env:childEnv,stdio:["pipe","pipe","pipe"],windowsHide:true});
        let stdout="",stderr="",timer;
        owned.stdout.setEncoding("utf8").on("data",part=>{stdout+=part;});owned.stderr.setEncoding("utf8").on("data",part=>{stderr+=part;});
        const closed=new Promise((resolve,reject)=>{owned.once("error",reject);owned.once("close",(code,signal)=>resolve({code,signal}));});
        owned.stdin.on("error",()=>{});owned.stdin.end(input);
        try {
          const exit=await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),90_000);})]);
          if(!exit){await stopOwnedChild(owned);throw new Error(`Owned consumer process timed out: ${path.basename(script)}`);}
          return {...exit,stdout,stderr:redact(stderr).slice(0,2000)};
        } finally {clearTimeout(timer);}
      };
      // Test-only egress guard, loaded only into the owned MCP/CLI children (never the Next server or browser):
      // every fetch must target exactly the loopback origin, is rejected before native fetch otherwise, and
      // cannot follow a redirect. The preload holds no secret; the native-call counter backs the preflight below.
      const fetchGuard=path.join(root,"consumer-fetch-guard.cjs");
      writeFileSync(fetchGuard,`'use strict';const allowed=${JSON.stringify(origin)};const nativeFetch=globalThis.fetch;
if(typeof nativeFetch!=='function')throw new Error('consumer fetch guard: native fetch unavailable');
const state={nativeCalls:0};Object.defineProperty(globalThis,Symbol.for('tavonel.consumerFetchGuard'),{value:state});
const guarded=function fetch(input,init){let target;
  try{target=new URL(typeof input==='string'||input instanceof URL?input:input&&typeof input.url==='string'?input.url:'');}
  catch{return Promise.reject(new TypeError('consumer fetch guard: unparseable request URL'));}
  if(target.origin!==allowed||target.username||target.password)return Promise.reject(new TypeError('consumer fetch guard: blocked non-loopback origin'));
  state.nativeCalls++;return nativeFetch(input,{...init,redirect:'error'});};
Object.defineProperty(globalThis,'fetch',{value:guarded,writable:false,configurable:false,enumerable:false});
`);
      const guardOptions=`--require ${JSON.stringify(fetchGuard)}`;
      // Bounded preflight: an owned child without the key attempts a reserved .invalid host; the guard must
      // reject it with zero native fetch calls, so no DNS lookup or connection is ever attempted.
      const egressProbe=path.join(root,"consumer-egress-probe.cjs");
      writeFileSync(egressProbe,`'use strict';const state=globalThis[Symbol.for('tavonel.consumerFetchGuard')];
(async()=>{let blocked=false;
  if(state&&state.nativeCalls===0&&Object.getOwnPropertyDescriptor(globalThis,'fetch')?.writable===false&&!('TAVONEL_API_KEY' in process.env)){
    try{await fetch('https://consumer-egress-probe.invalid/api/v1/collections',{redirect:'follow',signal:AbortSignal.timeout(5000)});}
    catch(error){blocked=error instanceof TypeError&&error.message==='consumer fetch guard: blocked non-loopback origin';}
    blocked=blocked&&state.nativeCalls===0;}
  process.stdout.write(JSON.stringify({blocked}));})();
`);
      const probeEnv={...env,NODE_OPTIONS:guardOptions,NODE_EXTRA_CA_CERTS:path.join(root,"cert.pem")};
      check("egress preflight child environment carries no API key or base URL",Object.keys(probeEnv).some(key=>/^TAVONEL_/i.test(key)),false);
      const egress=await runConsumer(egressProbe,[],"",probeEnv);
      consumer.nonLoopbackFetchBlockedBeforeNetwork=egress.code===0&&egress.stdout.trim()==='{"blocked":true}';
      check("owned consumer child rejects a non-loopback fetch before any native request",consumer.nonLoopbackFetchBlockedBeforeNetwork,true);
      const scopes=["ask:read","collections:read","worlds:read"];
      const question="What are the synthetic company's payment terms?";
      const activePointer=()=>sql(`select manifest_digest||'@'||revision from public.foundation_active_worlds where ${scope}`);
      const versionStates=()=>sql(`select string_agg(manifest_digest||'='||lifecycle_status,',' order by manifest_digest) from public.foundation_world_versions where ${scope}`);
      const pointerBefore=activePointer(),versionsBefore=versionStates();
      check("consumer proof starts from the human-activated revision",pointerBefore,`${candidate.manifestDigest}@2`);
      const ownerLogin=await login();check("fresh actual GoTrue owner session for the consumer proof",ownerLogin.status,200);
      const ownerToken=ownerLogin.body.access_token;
      const whoami=await api("/auth/v1/user",null,ownerToken);
      check("actual GoTrue resolves the consumer-proof session to the fixture owner",[whoami.status,whoami.body?.id,whoami.body?.email],[200,owner,email]);
      const issued=await appRequest("/api/developer/keys",ownerToken,{name:"real-auth-ci-consumer-read",scopes,expiresInDays:1});
      check("normal developer key route issues a key under the explicit owner grant",[issued.status,issued.body?.code],[201,"CREATED"]);
      consumerSecret=typeof issued.body.token==="string"?issued.body.token:"";delete issued.body.token;
      check("developer key route returns a scoped TAVONEL key",/^tvnl_live_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(consumerSecret),true);
      const keyId=String(issued.body.key?.keyId??"");
      check("issued key metadata names a key id and exactly the read-only scopes",[/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(keyId),[...(issued.body.key?.scopes??[])].sort()],[true,scopes]);
      check("actual SQL binds the issued key to the GoTrue owner and synthetic workspace",
        sql(`select workspace_key||'|'||created_by||'|'||array_to_string(array(select unnest(scopes) order by 1),',')||'|'||(revoked_at is null)||'|'||(expires_at is not null) from public.foundation_api_keys where key_id='${keyId}'`),
        `${workspace}|${owner}|${scopes.join(",")}|true|true`);
      check("exactly one developer key exists for the synthetic workspace",sql(`select count(*) from public.foundation_api_keys where workspace_key='${workspace}'`),"1");
      check("actual SQL audits the key issuance by the GoTrue owner",sql(`select count(*) from public.foundation_developer_audit_events where workspace_key='${workspace}' and action='api_key_created' and target_id='${keyId}' and actor_user_id='${owner}'`),"1");
      const listedKeys=await appRequest("/api/developer/keys",ownerToken);
      check("owner session lists the issued key without its secret",[listedKeys.status,listedKeys.body?.keys?.some(key=>key.keyId===keyId),JSON.stringify(listedKeys.body).includes(consumerSecret)],[200,true,false]);
      // Per-key, per-scope request counters written by the key-authenticated path itself.
      const keyUse=()=>sql(`select coalesce(string_agg(scope||'='||total,',' order by scope),'') from (select scope,sum(request_count) total from public.foundation_api_rate_windows where key_id='${keyId}' and workspace_key='${workspace}' group by scope) used`);
      const usedBy=count=>scopes.map(name=>`${name}=${count}`).join(",");
      check("issued key is unused before consumer reads",keyUse(),"");
      const worldsOf=body=>body?.collections;
      const worldOf=body=>({world:body?.model?.world,evidence:body?.model?.evidence});
      const answerOf=body=>({code:body?.code,retrievalPath:body?.retrievalPath,answerMode:body?.answerMode,activeWorld:body?.activeWorld,
        status:body?.status,answer:body?.answer,reason:body?.reason,citations:body?.citations,receipt:body?.receipt});
      const directReads=async (bearer,label)=>{
        const listed=await appRequest("/api/v1/collections?limit=50",bearer);
        const world=await appRequest(`/api/v1/world/${candidate.collectionId}`,bearer);
        const asked=await appRequest(`/api/v1/collections/${candidate.collectionId}/ask`,bearer,{question});
        check(`${label} reads list_worlds, get_world and ask_world through production Next`,[[listed.status,listed.body?.code],[world.status,world.body?.code],[asked.status,asked.body?.code]],
          [[200,"COLLECTIONS_LISTED"],[200,"OK"],[200,"GROUNDED_ANSWER"]]);
        return {worlds:worldsOf(listed.body),world:worldOf(world.body),answer:answerOf(asked.body)};
      };
      const ownerReads=await directReads(ownerToken,"GoTrue owner session");
      check("owner-session reads do not consume the issued key",keyUse(),"");
      check("active World list names exactly the human-activated revision",ownerReads.worlds?.map(({collectionId,manifestDigest,revision})=>({collectionId,manifestDigest,revision})),
        [{collectionId:candidate.collectionId,manifestDigest:candidate.manifestDigest,revision:2}]);
      check("World read model is the active activated revision",ownerReads.world.world,{id:candidate.collectionId,manifestDigest:candidate.manifestDigest,status:"active",revision:{state:"read",value:2}});
      check("ask is bound to the active activated revision",[ownerReads.answer.activeWorld?.manifestDigest,ownerReads.answer.activeWorld?.revision],[candidate.manifestDigest,2]);
      check("grounded answer cites region-bound evidence of the active revision only",[(ownerReads.answer.citations?.length??0)>0,/45 days/.test(ownerReads.answer.answer??""),/30 days/.test(ownerReads.answer.answer??""),
        (ownerReads.answer.citations??[]).every(item=>typeof item.evidenceId==="string"&&typeof item.sourceVersionId==="string"&&item.pageNumber1>=1&&Array.isArray(item.bbox1000))],[true,true,false,true]);
      const keyReads=await directReads(consumerSecret,"direct API key");
      check("direct API key reads are attributed to exactly the issued key",keyUse(),usedBy(1));
      const consumerEnv={...env,TAVONEL_BASE_URL:origin,TAVONEL_API_KEY:consumerSecret,NODE_EXTRA_CA_CERTS:path.join(root,"cert.pem"),NODE_OPTIONS:guardOptions};
      check("shipped MCP/CLI children use the exact loopback origin, the generated local certificate and the egress guard",
        [consumerEnv.TAVONEL_BASE_URL,consumerEnv.NODE_EXTRA_CA_CERTS,consumerEnv.NODE_OPTIONS],[origin,path.join(root,"cert.pem"),guardOptions]);
      const frames=[
        {jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"tavonel-real-auth-ci",version:"1"}}},
        {jsonrpc:"2.0",method:"notifications/initialized"},
        {jsonrpc:"2.0",id:2,method:"tools/list",params:{}},
        {jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"list_worlds",arguments:{limit:50}}},
        {jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"get_world",arguments:{collectionId:candidate.collectionId}}},
        {jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"ask_world",arguments:{collectionId:candidate.collectionId,question}}},
      ];
      const mcp=await runConsumer(path.join(nextRoot,"public/developer/tavonel-mcp.mjs"),[],`${frames.map(frame=>JSON.stringify(frame)).join("\n")}\n`);
      if(mcp.code!==0) throw new Error(`Shipped MCP stdio server exited ${mcp.code}/${mcp.signal}: ${mcp.stderr}`);
      const replies=new Map(mcp.stdout.trim().split("\n").filter(Boolean).map(line=>{const frame=JSON.parse(line);return [frame.id,frame];}));
      check("actual MCP stdio handshake identifies the read-only server",replies.get(1)?.result?.serverInfo?.name,"tavonel-readonly");
      const toolNames=(replies.get(2)?.result?.tools??[]).map(item=>item.name);
      check("MCP exposes the exercised read tools and no promotion, rollback, upload or compile tool",
        [["list_worlds","get_world","ask_world"].every(name=>toolNames.includes(name)),toolNames.some(name=>/promot|rollback|upload|compile/.test(name))],[true,false]);
      const toolResult=id=>{const result=replies.get(id)?.result;
        if(result?.isError!==false) throw new Error(`MCP tools/call ${id} failed: ${redact(result?.content?.[0]?.text??"no reply").slice(0,500)}`);
        return JSON.parse(result.content[0].text);};
      const mcpReads={worlds:worldsOf(toolResult(3)),world:worldOf(toolResult(4)),answer:answerOf(toolResult(5))};
      check("MCP stdio reads are attributed to exactly the issued key",keyUse(),usedBy(2));
      const cliJson=async args=>{
        const run=await runConsumer(path.join(nextRoot,"public/developer/tavonel-cli.mjs"),args);
        if(run.code!==0) throw new Error(`Shipped CLI ${args[0]} exited ${run.code}/${run.signal}: ${run.stderr}`);
        return JSON.parse(run.stdout);
      };
      const cliReads={worlds:worldsOf(await cliJson(["list_worlds","--limit","50"])),world:worldOf(await cliJson(["get_world",candidate.collectionId])),
        answer:answerOf(await cliJson(["ask_world",candidate.collectionId,question]))};
      check("CLI process reads are attributed to exactly the issued key",keyUse(),usedBy(3));
      for(const [label,reads] of [["direct API key",keyReads],["MCP stdio",mcpReads],["CLI process",cliReads]]) {
        check(`${label} lists the same active Worlds as the GoTrue owner session`,reads.worlds,ownerReads.worlds);
        check(`${label} reads the same active World model and evidence as the GoTrue owner session`,reads.world,ownerReads.world);
        check(`${label} receives the same answer and citations as the GoTrue owner session`,reads.answer,ownerReads.answer);
      }
      check("consumer reads leave the human-activated pointer unchanged",activePointer(),pointerBefore);
      check("consumer reads create, promote and roll back no World version",versionStates(),versionsBefore);
      Object.assign(consumer,{transports:["direct-api-gotrue-session","direct-api-key","mcp-stdio-json-rpc","cli-child-process"],
        principal:{goTrueUserIsFixtureOwner:true,keyBoundToFixtureOwner:true,keyBoundToFixtureWorkspace:true,apiKeyScopes:scopes,keyRequestsByScope:usedBy(3)},
        activeManifestDigest:candidate.manifestDigest,activeRevision:2,askCode:ownerReads.answer.code,askRetrievalPath:ownerReads.answer.retrievalPath,
        citationEvidenceIds:ownerReads.answer.citations.map(item=>item.evidenceId),mcpServerVersion:replies.get(1).result.serverInfo.version});
      report.consumerTransportVerified=true;
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
      const expired=await api("/auth/v1/user",null,session.access_token);validateExpiredProviderJwt(expired);check("naturally expired provider JWT is refused with actual expiry error",true,true);
      const downstream=await page.evaluate(async ({token,collection})=>{const r=await fetch(`/api/collections/${collection}/world`,{headers:{authorization:`Bearer ${token}`}});return r.status;},{token:session.access_token,collection:fixtures[0].collectionId});
      check("actual Next refuses naturally expired provider JWT",downstream,401);
      await context.clearCookies();await context.addCookies([{name:"tvnl_device",value:"expired-fixture-risk-cookie",url:origin,expires:Math.floor(Date.now()/1000)-60,httpOnly:true,secure:true}]);
      check("browser does not retain expired trial-risk cookie",(await context.cookies()).some(cookie=>cookie.name==="tvnl_device"),false);
      await page.evaluate(()=>localStorage.clear());await page.goto(`${origin}/auth/callback`);
      await expect(page.getByRole("heading",{name:"Sign-in did not complete."})).toBeVisible();
      check("expired-cookie-only browser cannot establish an app session",true,true);
      report.browserVersion=browser.version();report.nextMode="production";
    } catch (error) {
      report.failure={name:error.name,message:redact(error.message).slice(0,4000)};
      if(page) {
        report.failure.visibleHeadings=await page.getByRole("heading").allTextContents().then(items=>items.map(redact)).catch(()=>[]);
        report.failure.pagePath=(()=>{try{return new URL(page.url()).pathname;}catch{return "?";}})();
        report.failure.liveRegions=await page.locator('[role="status"],[role="alert"],[aria-live]').allTextContents().then(items=>items.map(text=>redact(text.trim()).slice(0,500)).filter(Boolean)).catch(()=>[]);
      }
      report.failure.browserEvents=browserEvents.slice(-80);report.failure.serverTail=serverTail.slice(-80);
      console.error("Real Auth primary failure:",JSON.stringify(report.failure));
      throw error;
    } finally {
      try { if(browser)await browser.close(); } finally {
        try {
          if(child) await stopOwnedChild(child);
        } finally {gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));}
      }
    }
  });
  // Continuous connector revisions through this stack's actual gateway/PostgREST/PostgreSQL. Synthetic governed workspace only.
  report.stage="source-revision-lineage";
  const lineage=await qualifySourceRevisions({base:`${stack.api}/rest/v1`,serviceKey:stack.service,sql,sqlAsync,asService:statement=>`set role service_role; ${statement}`,
    check,actor:owner,foreignWorkspace:workspace,root,env});
  report.sourceRevisionLineageVerified=lineage.actualServiceVerified;
  report.success=true;
} finally {
  if(userCreated) await api(`/auth/v1/admin/users/${owner}`,null,stack.service,"DELETE").catch(()=>{});
  const serialized=JSON.stringify(report,null,2);
  writeFileSync(output,(consumerSecret?serialized.replaceAll(consumerSecret,"[redacted]"):serialized).replace(/tvnl_live_[A-Za-z0-9_-]+/g,"[redacted API key]"));
  consumerSecret="";
  assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.ok(path.basename(root).startsWith("tavonel-real-auth-"));rmSync(root,{recursive:true,force:true});
}
