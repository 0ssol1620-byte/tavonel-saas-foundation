import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BUCKET = "tavonel-saas-foundation-quarantine";
const MAX_PDF_BYTES = 5 * 1024 * 1024;

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    values.set(key.slice(2), value);
    index += 1;
  }
  return values;
}

function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    }
    env[name] = value;
  }
  return env;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function encodePath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function encodeQuery(query) {
  return Object.keys(query)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`)
    .join("&");
}

function timestamp(now) {
  const amzDate = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(secretAccessKey, dateStamp) {
  const date = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const region = hmac(date, "auto");
  const service = hmac(region, "s3");
  return hmac(service, "aws4_request");
}

function presignPut(env, key, contentType, expiresInSeconds = 300, now = new Date()) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${BUCKET}/${encodePath(key)}`;
  const { amzDate, dateStamp } = timestamp(now);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "content-type;host",
  };
  const canonicalQuery = encodeQuery(query);
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    `content-type:${contentType}\nhost:${host}\n`,
    "content-type;host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(env.R2_SECRET_ACCESS_KEY, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

async function signedGet(env, key, query = {}, now = new Date()) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalUri = key ? `/${BUCKET}/${encodePath(key)}` : `/${BUCKET}`;
  const canonicalQuery = encodeQuery(query);
  const { amzDate, dateStamp } = timestamp(now);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const payloadHash = sha256Hex("");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(env.R2_SECRET_ACCESS_KEY, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const suffix = canonicalQuery ? `?${canonicalQuery}` : "";
  return fetch(`https://${host}${canonicalUri}${suffix}`, {
    headers: {
      authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });
}

function decodeXml(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function parseObjects(xml) {
  return xml
    .split(/<Contents>/iu)
    .slice(1)
    .flatMap((block) => {
      const key = /<Key>([^<]+)<\/Key>/iu.exec(block)?.[1];
      const size = Number(/<Size>([^<]+)<\/Size>/iu.exec(block)?.[1] ?? "0");
      return key ? [{ key: decodeXml(key), size }] : [];
    });
}

async function listDocumentObjects(env, prefix) {
  const response = await signedGet(env, "", {
    "list-type": "2",
    "max-keys": "20",
    prefix,
  });
  if (!response.ok) throw new Error(`R2 list failed with HTTP ${response.status}`);
  return parseObjects(await response.text()).filter((object) => object.key.startsWith(prefix));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function emit(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

const args = parseArgs(process.argv.slice(2));
const pdfPath = resolve(args.get("pdf") ?? "");
const envPath = resolve(args.get("env-file") ?? ".env.production.runtime");
const workspaceId = args.get("workspace-id") ?? "";
const timeoutSeconds = Number(args.get("timeout-seconds") ?? "1200");
const pollSeconds = Number(args.get("poll-seconds") ?? "10");
const documentId = args.get("document-id") ?? randomUUID();
const evidencePath = resolve(
  args.get("evidence") ?? `../docs/evidence/ocr/live-foundation-ocr-proof-${documentId}.json`,
);

if (!pdfPath || !workspaceId || !/^[A-Za-z0-9_-]{1,80}$/u.test(workspaceId)) {
  throw new Error("--pdf and a valid --workspace-id are required");
}
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || !Number.isFinite(pollSeconds) || pollSeconds < 1) {
  throw new Error("Polling values are invalid");
}

const env = { ...process.env, ...parseEnvFile(await readFile(envPath, "utf8")) };
for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
  if (!env[name]) throw new Error(`${name} is not configured`);
}
if (env.R2_BUCKET !== BUCKET) throw new Error("R2_BUCKET is not the Foundation quarantine bucket");

const pdf = await readFile(pdfPath);
if (pdf.length < 5 || pdf.length > MAX_PDF_BYTES || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
  throw new Error("Input must be a non-empty PDF no larger than 5 MiB");
}

const startedAt = new Date();
const sourceKey = `quarantine/${workspaceId}/${documentId}/source`;
const immutablePrefix = `immutable/${workspaceId}/${workspaceId}/${documentId}/`;
const inputSha256 = sha256Hex(pdf);
emit("qualified", { documentId, sourceKey, bytes: pdf.length, inputSha256 });

const uploadUrl = presignPut(env, sourceKey, "application/pdf");
const put = await fetch(uploadUrl, {
  method: "PUT",
  headers: { "content-type": "application/pdf" },
  body: pdf,
});
emit("quarantine_put", { status: put.status });
if (!put.ok) {
  const errorBody = await put.text();
  const errorCode = /<Code>([^<]+)<\/Code>/iu.exec(errorBody)?.[1] ?? "UNKNOWN";
  const errorMessage = /<Message>([^<]+)<\/Message>/iu.exec(errorBody)?.[1] ?? "R2 rejected the request";
  throw new Error(`Quarantine PUT failed with HTTP ${put.status}: ${errorCode}: ${errorMessage}`);
}

const deadline = Date.now() + timeoutSeconds * 1000;
let sanitized;
let ocr;
let objects = [];
while (Date.now() < deadline) {
  objects = await listDocumentObjects(env, immutablePrefix);
  sanitized = objects.find((object) => object.key.endsWith("/sanitized.pdf"));
  ocr = objects.find((object) => object.key.endsWith("/ocr.json"));
  emit("poll", {
    elapsedSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
    sanitized: Boolean(sanitized),
    ocr: Boolean(ocr),
  });
  if (sanitized && ocr) break;
  await sleep(pollSeconds * 1000);
}

let ocrSummary = null;
if (ocr) {
  const response = await signedGet(env, ocr.key);
  if (!response.ok) throw new Error(`ocr.json GET failed with HTTP ${response.status}`);
  const payload = await response.json();
  const text = typeof payload.text === "string" ? payload.text : "";
  const versionKey = sanitized?.key.split("/").at(-2) ?? "";
  ocrSummary = {
    status: payload.status,
    pageCount: payload.pageCount,
    inputSha256: payload.inputSha256,
    sourceImmutableKey: payload.sourceImmutableKey,
    textCharacters: text.length,
    textSha256: sha256Hex(text),
    matchesImmutableDigest: payload.inputSha256 === `sha256:${versionKey}`,
    matchesImmutableKey: payload.sourceImmutableKey === sanitized?.key,
  };
}

const complete = Boolean(
  sanitized
    && ocr
    && ocrSummary?.status === "ok"
    && ocrSummary.matchesImmutableDigest
    && ocrSummary.matchesImmutableKey,
);
const evidence = {
  schemaVersion: 1,
  complete,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  workspaceId,
  documentId,
  source: {
    filename: pdfPath.split(/[\\/]/u).at(-1),
    bytes: pdf.length,
    sha256: inputSha256,
    quarantineKey: sourceKey,
    putStatus: put.status,
  },
  immutable: sanitized ?? null,
  ocr: ocr ? { ...ocr, summary: ocrSummary } : null,
  observedObjects: objects,
  guardrails: {
    ocrGpuPolicyChanged: false,
    candidatePromotionChanged: false,
  },
};

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
emit(complete ? "complete" : "timeout", { evidencePath, complete });
if (!complete) process.exitCode = 2;
