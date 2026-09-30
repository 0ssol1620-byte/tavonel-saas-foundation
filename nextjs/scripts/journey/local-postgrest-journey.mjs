/** Actual PostgREST JWT/HTTP boundary, started only against the caller's disposable cluster. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { qualifyNextBrowser } from "./local-next-browser-journey.mjs";

export async function qualifyPostgrest({ executable, root, env, port, sql, check, owner, outsider, admin, workspace, artifacts }) {
  const binarySha256 = createHash("sha256").update(readFileSync(executable)).digest("hex");
  if (process.platform === "win32") assert.equal(binarySha256,
    "c4155000dfb0befb59215b65d61a621bbaea1515f36a6e758fc504c7ca0dcbee",
    "Use the official checksum-qualified PostgREST 16.4 Windows binary");
  const version = execFileSync(executable, ["--version"], { env, encoding: "utf8", windowsHide: true }).trim();
  assert.match(version, /^PostgREST 16\./, "Use the qualified official PostgREST 16 runtime");
  const jwtSecret = randomBytes(48).toString("hex"), dbPassword = randomBytes(32).toString("hex");
  const audience = "tavonel-local-synthetic";
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  // Only this fresh cluster is modified. The authenticator cannot inherit application rights.
  sql(`create role journey_authenticator login noinherit nocreatedb nocreaterole nosuperuser password ${quote(dbPassword)};
    grant anon,authenticated,service_role to journey_authenticator;
    create or replace function auth.uid() returns uuid language sql stable as $fn$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $fn$;
    create or replace function auth.role() returns text language sql stable as $fn$
      select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','anon');
    $fn$;`);
  const httpPort = await new Promise(resolve => {
    const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => {
      const selected = socket.address().port; socket.close(() => resolve(selected));
    });
  });
  const config = path.join(root, "postgrest.conf");
  writeFileSync(config, `db-uri = "postgresql://journey_authenticator:${dbPassword}@127.0.0.1:${port}/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 2
server-host = "127.0.0.1"
server-port = ${httpPort}
jwt-secret = "${jwtSecret}"
jwt-aud = "${audience}"
log-level = "error"
`, { mode: 0o600 });
  const child = spawn(executable, [config], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise(resolve => child.once("close", resolve));
  let diagnostics = "";
  child.stderr.on("data", part => { diagnostics = (diagnostics + part).slice(-4000); });
  child.on("error", error => { diagnostics = error.message; });
  const base = `http://127.0.0.1:${httpPort}`;
  function token(subject, role = "authenticated", overrides = {}, secret = jwtSecret) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: subject, role, aud: audience, iat: now, exp: now + 600, ...overrides })).toString("base64url");
    return `${header}.${payload}.${createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")}`;
  }
  const ownerToken = token(owner), outsiderToken = token(outsider), adminToken = token(admin);
  const serviceToken = token(owner, "service_role");
  async function request(resource, bearer, body, method = body === undefined ? "GET" : "POST") {
    const response = await fetch(`${base}/${resource}`, { method, redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), "content-type": "application/json", prefer: "return=representation" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text();
    return { status: response.status, body: raw ? JSON.parse(raw) : null };
  }
  const rpc = (name, body, bearer = serviceToken) => request(`rpc/${name}`, bearer, body);
  const digest = letter => `sha256:${letter.repeat(64)}`;
  const fake = letter => ({ collectionId: `collection-${"c".repeat(32)}`, manifestDigest: digest(letter),
    coreExecution: { worldStateId: `synthetic_http_${letter}`, receipt: { outputSha256: digest("f") } } });
  const worlds = artifacts ?? [fake("a"), fake("b")];
  function transition(artifact, revision, current, action = "activate", actor = admin) {
    return { p_operation_id: randomUUID(), p_action: action, p_workspace_key: workspace, p_collection_id: artifact.collectionId,
      p_target_manifest_digest: artifact.manifestDigest,
      p_candidate_object_key: action === "activate" ? `immutable/${workspace}/${workspace}/collections/${artifact.collectionId}/${artifact.manifestDigest.slice(7)}/candidate-world.json` : null,
      p_world_state_id: action === "activate" ? artifact.coreExecution.worldStateId : null,
      p_core_output_sha256: action === "activate" ? artifact.coreExecution.receipt.outputSha256 : null,
      p_expected_current_state: revision === 0 ? "empty" : "active", p_expected_current_revision: revision,
      p_expected_current_manifest_digest: current, p_actor_user_id: actor, p_reason: "Synthetic JWT HTTP human review accepted" };
  }
  const activeResource = `foundation_active_worlds?workspace_key=eq.${workspace}&collection_id=eq.${worlds[0].collectionId}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error(`PostgREST exited before readiness: ${diagnostics}`);
      try { const response = await request("profiles?select=id", ownerToken); ready = response.status === 200; } catch { /* bounded startup retry */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Actual PostgREST never became ready: ${diagnostics}`);
    check("actual JWT HTTP request reaches own RLS profile", await request("profiles?select=id", ownerToken), { status: 200, body: [{ id: owner }] });
    check("another valid JWT reaches only its own profile", await request("profiles?select=id", outsiderToken), { status: 200, body: [{ id: outsider }] });
    check("HTTP cross-tenant profile read is empty", await request(`profiles?select=id&id=eq.${outsider}`, ownerToken), { status: 200, body: [] });
    check("HTTP cross-tenant profile update affects no rows", await request(`profiles?id=eq.${outsider}`, ownerToken, { display_name: "forbidden" }, "PATCH"), { status: 200, body: [] });
    check("anonymous Data API cannot read profiles", (await request("profiles?select=id")).status, 401);
    for (const [name, bearer] of [
      ["wrong JWT signature", token(owner, "authenticated", {}, "wrong-ephemeral-key")],
      ["expired JWT", token(owner, "authenticated", { exp: Math.floor(Date.now()/1000)-120 })],
      ["future JWT nbf", token(owner, "authenticated", { nbf: Math.floor(Date.now()/1000)+120 })],
      ["wrong JWT audience", token(owner, "authenticated", { aud: "other-synthetic-audience" })],
      ["unsigned alg-none JWT", `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: owner, role: "authenticated", aud: audience })).toString("base64url")}.`],
    ]) check(`${name} is refused by real PostgREST`, (await request("profiles?select=id", bearer)).status, 401);
    check("signed JWT cannot assume ungranted postgres role", (await request("profiles?select=id", token(owner, "postgres"))).status, 403);
    const current = (await request(activeResource, serviceToken)).body[0];
    const before = current?.revision ?? 0;
    const publish = transition(current ? worlds[1] : worlds[0], before, current?.manifest_digest ?? null);
    check("browser JWT cannot invoke publication RPC", (await rpc("transition_foundation_world_atomic", publish, adminToken)).status, 403);
    check("browser JWT cannot bypass lifecycle API by reading pointers", (await request(activeResource, adminToken)).status, 403);
    check("browser metadata cannot elevate JWT database role", (await rpc("transition_foundation_world_atomic", publish,
      token(admin, "authenticated", { user_metadata: { role: "service_role", workspace_role: "owner" } }))).status, 403);
    const first = await rpc("transition_foundation_world_atomic", publish);
    check("server JWT publishes through actual HTTP and SQL", first.status, 200);
    check("HTTP publication advances exact revision", first.body.revision, before + 1);
    const replay = await rpc("transition_foundation_world_atomic", publish);
    check("HTTP lost-reply replay retains receipt and reports replay", replay, { status: 200, body: { ...first.body, status: "replayed" } });
    const blockedForeign = await rpc("transition_foundation_world_atomic", { ...publish, p_operation_id: randomUUID(), p_actor_user_id: outsider });
    check("HTTP server mutation rechecks actor tenant membership", blockedForeign.body.message, "world_transition_forbidden");
    check("HTTP foreign mutation is an actual refusal", blockedForeign.status >= 400, true);
    const revoked = await rpc("revoke_foundation_workspace_member", { p_workspace_key: workspace, p_actor_user_id: owner, p_subject_user_id: admin, p_request_id: "synthetic-http-revoke" });
    check("membership revoke executes via actual HTTP RPC", revoked.status, 200);
    check("membership revocation does not pretend to revoke JWT identity", (await request("profiles?select=id", adminToken)).status, 200);
    const refusedReplay = await rpc("transition_foundation_world_atomic", publish);
    check("valid cached JWT does not revive revoked publication rights", refusedReplay.body.message, "world_transition_forbidden");
    check("revoked HTTP publication is an actual refusal", refusedReplay.status >= 400, true);
    const restoredToken = `sha256:${randomBytes(32).toString("hex")}`;
    const invitation = await rpc("create_foundation_workspace_invite", { p_workspace_key: workspace, p_actor_user_id: owner,
      p_invitee_email: "admin@journey.invalid", p_role: "admin", p_token_hash: restoredToken,
      p_idempotency_key: randomUUID().replaceAll("-", "_"), p_expires_at: new Date(Date.now()+3_600_000).toISOString(), p_request_id: "synthetic-http-invite" });
    check("restore invitation executes via actual HTTP RPC", invitation.status, 200);
    const accepted = await rpc("accept_foundation_workspace_invite", { p_actor_user_id: admin, p_token_hash: restoredToken, p_request_id: "synthetic-http-accept" });
    check("member restore executes via actual HTTP RPC", accepted.status, 200);
    const stale = await rpc("transition_foundation_world_atomic", publish);
    check("HTTP restore does not revive old authority receipt", stale.body.message, "world_transition_authorization_changed");
    check("stale HTTP authority is an actual refusal", stale.status >= 400, true);
    const publishedDigest = publish.p_target_manifest_digest;
    if (!current) {
      const update = await rpc("transition_foundation_world_atomic", transition(worlds[1], before+1, publishedDigest));
      check("HTTP second revision publishes", update.status, 200);
    }
    const revision = before + (current ? 1 : 2);
    const rollback = await rpc("transition_foundation_world_atomic", transition(worlds[0], revision, worlds[1].manifestDigest, "rollback"));
    check("restored member performs historical restore via real HTTP", rollback.status, 200);
    check("HTTP historical restore commits exact next revision", rollback.body.revision, revision+1);
    const pointer = await request(activeResource, serviceToken);
    check("actual HTTP active pointer reads the restored manifest", pointer.body[0].manifest_digest, worlds[0].manifestDigest);
    const racers = await Promise.all([1, 2].map(() => rpc("transition_foundation_world_atomic", transition(worlds[1], revision+1, worlds[0].manifestDigest))));
    check("two HTTP publication requests have exactly one winner", racers.filter(result => result.status === 200).length, 1);
    check("concurrent HTTP loser is a named CAS refusal", racers.filter(result => result.status !== 200).map(result => result.body.message), ["world_transition_compare_and_swap_conflict"]);
    check("concurrent HTTP publication advances one SQL revision", (await request(activeResource, serviceToken)).body[0].revision, revision+2);
    let nextBrowser;
    if (process.env.TAVONEL_LOCAL_NEXT_BROWSER === "1") {
      assert.ok(artifacts, "Next qualification requires real Core artifacts");
      nextBrowser = await qualifyNextBrowser({ root, env, base, token, owner, admin, workspace, artifacts, serviceToken, sql, check, rpc });
    }
    return { version, binarySha256, jwtVerifiedByActualService: true, syntheticIssuerOnly: true,
      realCoreArtifacts: Boolean(artifacts), goTrueSessionServiceVerified: false, storageServiceVerified: Boolean(nextBrowser), nextBrowser };
  } finally {
    if (child.exitCode === null) child.kill();
    await closed;
  }
}
