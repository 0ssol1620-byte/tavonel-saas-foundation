import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DeveloperScope } from "./developer-contracts";
import { authenticateDeveloperApiKey } from "./developer-store";

/*
  G11 REMOTE-MCP (DECISION-REGISTER S6-09, S6-10; SERVICE-DEFINITION §6 D; ENABLEMENT-GAP §4).

  The hosted MCP endpoint, contract stage of the ladder contract -> preview shadow -> canary.
  Everything here sits behind TAVONEL_REMOTE_MCP_ENABLED, which is unset in production, and every
  route that uses it answers 404 until the value is exactly "true".

  What it is, in one paragraph. The tools are the downloadable stdio bridge's own table
  (`public/developer/tavonel-mcp.mjs`), imported rather than copied, so the remote tool list
  cannot drift from the shipped one and inherits `assertReadOnly`. A tool call is dispatched
  in-process to the same /api/v1 route handler the bridge reaches over HTTP, carrying the same
  bearer, so tenant scoping, scopes, rate limits and the Ask concurrency guard are the existing
  ones. The bearer is an ordinary developer API key: the OAuth token endpoint mints a key scoped
  to the reads below and expiring with the token, so revocation, audit and the authorization
  epoch are the existing ones too. No table, no migration.

  Spec followed: MCP 2025-06-18 (Streamable HTTP transport; Authorization: RFC 9728 protected
  resource metadata, RFC 8414 authorization server metadata, RFC 7591 dynamic registration,
  OAuth 2.1 authorization code with PKCE S256, RFC 8707 resource indicators). Only the JSON
  response form of the transport is implemented: no SSE stream, no session id.
*/

type Env = Readonly<Record<string, string | undefined>>;

export function remoteMcpEnabled(env: Env = process.env): boolean {
  return env.TAVONEL_REMOTE_MCP_ENABLED === "true";
}

/** The bridge speaks 2025-06-18; 2025-03-26 is the transport's assumed version when the header is absent. */
export const REMOTE_MCP_PROTOCOL_VERSIONS: readonly string[] = ["2025-06-18", "2025-03-26"];

/**
 * The scope each bridge tool's request needs: the literal its route passes to
 * `authorizeFoundationRequest`. `lib/remote-mcp.test.ts` reads every route file and pins this.
 */
export const REMOTE_MCP_TOOL_SCOPES: Readonly<Record<string, DeveloperScope>> = {
  list_sources: "documents:read",
  list_worlds: "collections:read",
  get_world: "worlds:read",
  search_world: "ask:read",
  ask_world: "ask:read",
  get_object: "worlds:read",
  get_relation: "worlds:read",
  get_evidence: "worlds:read",
  download_package: "collections:download",
};

/** The only scopes a remote MCP token may hold. A key holding anything else is refused. */
export const REMOTE_MCP_SCOPES: readonly DeveloperScope[] = [...new Set(Object.values(REMOTE_MCP_TOOL_SCOPES))].sort();

export const REMOTE_MCP_CODE_TTL_SECONDS = 120;
export const REMOTE_MCP_TOKEN_TTL_SECONDS = 3600;

const HOST = /^[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?$/;

/**
 * The origin the client actually addressed: issuer, resource and redirect `iss` must equal the URL
 * it discovered them from (RFC 8414 §3.3). On Vercel the forwarded host is the routed domain;
 * `next start` reports `localhost` in `request.url` whatever the client used, so the Host header
 * is read first and the URL is the fallback for a request that carries none (unit tests).
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwarded = request.headers.get("x-forwarded-proto");
  const scheme = forwarded === "https" || forwarded === "http" ? forwarded : url.protocol.slice(0, -1);
  return host && HOST.test(host) ? `${scheme}://${host}` : url.origin;
}

export function remoteMcpUrls(origin: string) {
  return {
    issuer: origin,
    resource: `${origin}/api/mcp`,
    // RFC 9728 §3.1: the well-known segment goes between the host and the resource's path.
    resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/mcp`,
    authorization: `${origin}/oauth/authorize`,
    token: `${origin}/api/mcp/oauth/token`,
    registration: `${origin}/api/mcp/oauth/register`,
  };
}

/* --------------------------------------------------------------- public DTOs */

/** RFC 9728 document. Public. */
export type RemoteMcpResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  scopes_supported: DeveloperScope[];
  bearer_methods_supported: ["header"];
  resource_name: string;
};

/** RFC 8414 document. Public. */
export type RemoteMcpAuthorizationServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: ["code"];
  grant_types_supported: ["authorization_code"];
  code_challenge_methods_supported: ["S256"];
  token_endpoint_auth_methods_supported: ["none"];
  scopes_supported: DeveloperScope[];
  authorization_response_iss_parameter_supported: true;
};

/** RFC 7591 response. Public: holds only what the client itself sent. */
export type RemoteMcpClientRegistration = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: ["authorization_code"];
  response_types: ["code"];
  token_endpoint_auth_method: "none";
};

/** What the consent screen shows. Public: no workspace, user or key identifier. */
export type RemoteMcpConsentView = {
  client: { name: string; redirectOrigin: string };
  scopes: DeveloperScope[];
};

/** OAuth 2.1 token response. Public: the token and its lifetime, never the key id behind it. */
export type RemoteMcpTokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
};

export function resourceMetadata(origin: string): RemoteMcpResourceMetadata {
  const urls = remoteMcpUrls(origin);
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [...REMOTE_MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "TAVONEL Compiled World (read-only)",
  };
}

export function authorizationServerMetadata(origin: string): RemoteMcpAuthorizationServerMetadata {
  const urls = remoteMcpUrls(origin);
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorization,
    token_endpoint: urls.token,
    registration_endpoint: urls.registration,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...REMOTE_MCP_SCOPES],
    authorization_response_iss_parameter_supported: true,
  };
}

/* ------------------------------------------------------------ internal claims */

/** Internal. Sealed into the client id; only what the client registered. */
type ClientClaims = { v: 1; n: string; r: string[]; iat: number };

/** Internal. Sealed into the authorization code; never reaches the client in the clear. */
type CodeClaims = {
  v: 1;
  /** sha256 of the client id the code was issued to. */
  c: string;
  r: string;
  ch: string;
  s: DeveloperScope[];
  u: string;
  w: string;
  /** The workspace authorization revision at consent; the key RPC refuses a stale one. */
  a: number;
  exp: number;
  j: string;
};

/* -------------------------------------------------------------------- sealing */

const CLIENT_PREFIX = "tvmcp_client_";
const CODE_PREFIX = "tvmcp_code_";
const SEALED = /^[A-Za-z0-9_-]{40,4096}$/;

/** Null when the secret is missing or short: every OAuth route then refuses, never improvises. */
export function remoteMcpSealingKey(env: Env = process.env): Buffer | null {
  const secret = env.TAVONEL_REMOTE_MCP_SIGNING_SECRET?.trim() ?? "";
  return secret.length >= 32 ? createHash("sha256").update(`tavonel-remote-mcp-v1\0${secret}`).digest() : null;
}

// AES-256-GCM, the purpose bound as additional data so a client id can never open as a code.
function seal(purpose: string, claims: object, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal(purpose: string, token: string, key: Buffer): Record<string, unknown> | null {
  if (!SEALED.test(token)) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    const value: unknown = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/* ---------------------------------------------------------------- registration */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** https, or http on a loopback host (RFC 8252 §7.3). No fragment, no userinfo. */
export function acceptableRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
}

function clientName(value: unknown): string {
  // Self-asserted by whoever registered it, shown on a consent screen and in the key list.
  const name = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim() : "";
  return name.slice(0, 48) || "Unnamed MCP client";
}

export function registerClient(
  body: unknown,
  key: Buffer,
  now = Date.now(),
): { ok: true; registration: RemoteMcpClientRegistration } | { ok: false; error: string; error_description: string } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!input) return { ok: false, error: "invalid_client_metadata", error_description: "The registration body is not a JSON object." };
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(acceptableRedirectUri)) {
    return { ok: false, error: "invalid_redirect_uri", error_description: "One to five redirect URIs, each https or http on a loopback host, with no fragment." };
  }
  if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== "none") {
    return { ok: false, error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none) are registered." };
  }
  if (input.response_types !== undefined && !(Array.isArray(input.response_types) && input.response_types.every((type) => type === "code"))) {
    return { ok: false, error: "invalid_client_metadata", error_description: "Only the code response type is supported." };
  }
  const claims: ClientClaims = { v: 1, n: clientName(input.client_name), r: [...new Set(uris as string[])], iat: Math.floor(now / 1000) };
  return {
    ok: true,
    registration: {
      client_id: `${CLIENT_PREFIX}${seal("client", claims, key)}`,
      client_id_issued_at: claims.iat,
      client_name: claims.n,
      redirect_uris: claims.r,
      // RFC 7591 §3.2.1: the server answers with the values it will actually use.
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

function openClient(clientId: unknown, key: Buffer): ClientClaims | null {
  if (typeof clientId !== "string" || !clientId.startsWith(CLIENT_PREFIX)) return null;
  const claims = unseal("client", clientId.slice(CLIENT_PREFIX.length), key);
  if (!claims || claims.v !== 1 || typeof claims.n !== "string" || !Array.isArray(claims.r) || !claims.r.every(acceptableRedirectUri)) return null;
  return claims as ClientClaims;
}

/* --------------------------------------------------------- authorization step */

export type AuthorizationParameters = Partial<Record<
  "response_type" | "client_id" | "redirect_uri" | "code_challenge" | "code_challenge_method" | "state" | "scope" | "resource",
  string
>>;

type ValidRequest = { clientId: string; client: ClientClaims; redirectUri: string; codeChallenge: string; scopes: DeveloperScope[]; state: string | null };

export type AuthorizationCheck =
  | { ok: true; request: ValidRequest; view: RemoteMcpConsentView }
  /** The client or its redirect URI did not verify: never redirect, say so on the page. */
  | { ok: false; redirectTo: null; error: string; description: string }
  /** The client verified and the request did not: OAuth sends the error back to the client. */
  | { ok: false; redirectTo: string; error: string; description: string };

const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

function redirectWith(redirectUri: string, origin: string, params: Record<string, string | null>) {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) if (value !== null) url.searchParams.set(name, value);
  // RFC 9207: name the issuer so a client talking to several servers can tell responses apart.
  url.searchParams.set("iss", remoteMcpUrls(origin).issuer);
  return url.toString();
}

const sameResource = (value: string, origin: string) => value.replace(/\/$/, "") === remoteMcpUrls(origin).resource;

export function checkAuthorizationRequest(params: AuthorizationParameters, key: Buffer, origin: string): AuthorizationCheck {
  const client = openClient(params.client_id, key);
  if (!client) return { ok: false, redirectTo: null, error: "invalid_client", description: "This client is not registered with this server." };
  const redirectUri = params.redirect_uri ?? "";
  if (!client.r.includes(redirectUri)) {
    return { ok: false, redirectTo: null, error: "invalid_request", description: "The redirect URI is not one this client registered." };
  }
  const state = typeof params.state === "string" && params.state.length > 0 ? params.state.slice(0, 512) : null;
  const refuse = (error: string, description: string): AuthorizationCheck => ({
    ok: false,
    redirectTo: redirectWith(redirectUri, origin, { error, error_description: description, state }),
    error,
    description,
  });
  if (params.response_type !== "code") return refuse("unsupported_response_type", "Only response_type=code is supported.");
  if (params.code_challenge_method !== "S256" || !PKCE_CHALLENGE.test(params.code_challenge ?? "")) {
    return refuse("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  if (params.resource !== undefined && !sameResource(params.resource, origin)) {
    return refuse("invalid_target", "The resource is not this server's MCP endpoint.");
  }
  const requested = (params.scope ?? "").split(" ").filter(Boolean);
  if (requested.some((scope) => !(REMOTE_MCP_SCOPES as readonly string[]).includes(scope))) {
    return refuse("invalid_scope", "Only the read-only MCP scopes can be granted.");
  }
  const scopes = requested.length > 0 ? [...new Set(requested)].sort() as DeveloperScope[] : [...REMOTE_MCP_SCOPES];
  return {
    ok: true,
    request: { clientId: params.client_id!, client, redirectUri, codeChallenge: params.code_challenge!, scopes, state },
    view: { client: { name: client.n, redirectOrigin: new URL(redirectUri).origin }, scopes },
  };
}

export function denialRedirect(request: ValidRequest, origin: string) {
  return redirectWith(request.redirectUri, origin, { error: "access_denied", error_description: "The workspace member declined.", state: request.state });
}

export function issueAuthorizationCode(
  request: ValidRequest,
  principal: { userId: string; workspaceKey: string; authorizationRevision: number },
  key: Buffer,
  origin: string,
  now = Date.now(),
) {
  const claims: CodeClaims = {
    v: 1,
    c: sha256(request.clientId),
    r: request.redirectUri,
    ch: request.codeChallenge,
    s: request.scopes,
    u: principal.userId,
    w: principal.workspaceKey,
    a: principal.authorizationRevision,
    exp: Math.floor(now / 1000) + REMOTE_MCP_CODE_TTL_SECONDS,
    j: randomBytes(16).toString("base64url"),
  };
  return redirectWith(request.redirectUri, origin, { code: `${CODE_PREFIX}${seal("code", claims, key)}`, state: request.state });
}

/* ----------------------------------------------------------------- token step */

export type TokenGrant = {
  /** Internal: the identity the key is minted for. */
  userId: string;
  workspaceKey: string;
  authorizationRevision: number;
  scopes: DeveloperScope[];
  clientName: string;
  /** The code's single-use marker, written into the key name. */
  codeId: string;
};

export type TokenCheck = { ok: true; grant: TokenGrant } | { ok: false; status: 400 | 401; error: string; error_description: string };

export function checkTokenRequest(form: URLSearchParams, key: Buffer, origin: string, now = Date.now()): TokenCheck {
  const bad = (error: string, error_description: string, status: 400 | 401 = 400): TokenCheck => ({ ok: false, status, error, error_description });
  if (form.get("grant_type") !== "authorization_code") return bad("unsupported_grant_type", "Only authorization_code is supported.");
  const clientId = form.get("client_id") ?? "";
  const client = openClient(clientId, key);
  if (!client) return bad("invalid_client", "The client is not registered with this server.", 401);
  const code = form.get("code") ?? "";
  const claims = code.startsWith(CODE_PREFIX) ? unseal("code", code.slice(CODE_PREFIX.length), key) : null;
  if (!claims || claims.v !== 1 || typeof claims.exp !== "number" || typeof claims.ch !== "string" || typeof claims.c !== "string"
    || typeof claims.r !== "string" || typeof claims.u !== "string" || typeof claims.w !== "string" || typeof claims.j !== "string"
    || !Number.isSafeInteger(claims.a) || !Array.isArray(claims.s)) {
    return bad("invalid_grant", "The authorization code is not valid.");
  }
  if (claims.exp <= Math.floor(now / 1000)) return bad("invalid_grant", "The authorization code has expired.");
  if (!sameText(claims.c, sha256(clientId))) return bad("invalid_grant", "The authorization code was issued to another client.");
  const redirectUri = form.get("redirect_uri");
  if (redirectUri !== null && redirectUri !== claims.r) return bad("invalid_grant", "The redirect URI does not match the authorization request.");
  const resource = form.get("resource");
  if (resource !== null && !sameResource(resource, origin)) return bad("invalid_target", "The resource is not this server's MCP endpoint.");
  const verifier = form.get("code_verifier") ?? "";
  if (!PKCE_VERIFIER.test(verifier) || !sameText(sha256(verifier), claims.ch)) return bad("invalid_grant", "The PKCE verifier does not match.");
  const scopes = (claims.s as unknown[]).filter((scope): scope is DeveloperScope => (REMOTE_MCP_SCOPES as readonly unknown[]).includes(scope));
  if (scopes.length !== claims.s.length || scopes.length === 0) return bad("invalid_grant", "The authorization code carries a scope this server does not grant.");
  return {
    ok: true,
    grant: { userId: claims.u, workspaceKey: claims.w, authorizationRevision: Number(claims.a), scopes, clientName: client.n, codeId: claims.j },
  };
}

/** The key name carries the code id, which is how a second redemption of one code is recognised. */
export const keyNameFor = (grant: TokenGrant) => `MCP: ${grant.clientName} #${grant.codeId}`;
export const codeIdMarker = (codeId: string) => ` #${codeId}`;

/* ------------------------------------------------------------- bearer at /mcp */

export type BearerCheck =
  | { kind: "anonymous" }
  | { kind: "principal"; token: string; scopes: readonly DeveloperScope[] }
  | { kind: "rejected"; description: string };

/**
 * Authenticates the bearer without spending a rate-limit unit; the route a tool reaches spends it.
 *
 * Absent: anonymous, which may initialize and list tools (exactly what the stdio bridge answers
 * with no key) and nothing else. Present: it must be a live developer key holding only read-only
 * MCP scopes. A key that can write is refused here even though no tool would use the write, so a
 * remote MCP credential is read-only by construction rather than by the tool list alone.
 */
export async function checkBearer(authorization: string | null): Promise<BearerCheck> {
  if (authorization === null || authorization === "") return { kind: "anonymous" };
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token.startsWith("tvnl_live_")) return { kind: "rejected", description: "The bearer is not a TAVONEL access token." };
  const authenticated = await authenticateDeveloperApiKey(token);
  if (!authenticated.ok) {
    return { kind: "rejected", description: authenticated.code === "API_KEY_EXPIRED" ? "The access token has expired." : "The access token is not valid." };
  }
  const scopes = authenticated.principal.scopes;
  if (scopes.some((scope) => !(REMOTE_MCP_SCOPES as readonly string[]).includes(scope))) {
    return { kind: "rejected", description: "The access token carries a write scope; the remote MCP endpoint accepts read-only tokens." };
  }
  return { kind: "principal", token, scopes };
}

/** RFC 6750 §3 challenge, with the RFC 9728 pointer MCP clients start discovery from. */
export function bearerChallenge(origin: string, error?: { error: string; description: string; scope?: string }) {
  const parts = [`resource_metadata="${remoteMcpUrls(origin).resourceMetadata}"`];
  if (error) {
    parts.push(`error="${error.error}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
    if (error.scope) parts.push(`scope="${error.scope}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}
