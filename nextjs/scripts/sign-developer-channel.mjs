#!/usr/bin/env node
/*
  WO-LOC-3: signs public/developer/channel.json with the dedicated developer-channel key.

    TAVONEL_CHANNEL_SIGNING_KEY=<pkcs8 DER, base64> node scripts/sign-developer-channel.mjs [channel-dir]

  Node built-ins only. The key comes from the environment and nowhere else, and is never printed. The
  signature is the house v2 object (lib/export-signing.ts) under tavonel.signed_developer_channel.v1, over
  the canonical JSON of channel.json (sorted keys, no whitespace). Refuses, writing nothing, when the key
  is absent or malformed, when it is not the active key of channel-trust.json, outside that key's window,
  or when any asset's bytes in the directory differ from the digest channel.json names.
*/
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCOPE = "tavonel.signed_developer_channel.v1";
const KEY_ENV = "TAVONEL_CHANNEL_SIGNING_KEY";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/* Same function as verifyChannel's in public/developer/tavonel-cli.mjs. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}

function refuse(code, detail) {
  console.error(`sign-developer-channel: ${code}: ${detail}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return refuse("CHANNEL_FILE_UNREADABLE", path);
  }
}

const directory = resolve(process.argv[2] ?? fileURLToPath(new URL("../public/developer/", import.meta.url)));
const encodedKey = process.env[KEY_ENV]?.trim() ?? "";
if (!encodedKey) refuse("CHANNEL_SIGNING_KEY_MISSING", `${KEY_ENV} is not set`);

let privateKey;
try {
  const der = Buffer.from(encodedKey, "base64");
  if (der.toString("base64") !== encodedKey) throw new Error("not canonical base64");
  privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
} catch {
  refuse("CHANNEL_SIGNING_KEY_INVALID", `${KEY_ENV} is not a base64 PKCS#8 DER private key`);
}
if (privateKey.asymmetricKeyType !== "ed25519") refuse("CHANNEL_SIGNING_KEY_INVALID", `${KEY_ENV} is not an Ed25519 key`);
const publicKey = createPublicKey(privateKey);
const publicDer = publicKey.export({ format: "der", type: "spki" });

const trust = readJson(join(directory, "channel-trust.json"));
const active = trust?.schemaVersion === "tavonel.export_trust.v2" && Array.isArray(trust.keys)
  ? trust.keys.filter((key) => key?.keyId === trust.activeKeyId && key?.status === "active")
  : [];
if (active.length !== 1) refuse("CHANNEL_TRUST_INVALID", "channel-trust.json must name exactly one active key");
const key = active[0];
if (key.algorithm !== "Ed25519" || !Number.isSafeInteger(key.keyVersion) || key.keyVersion < 1
  || key.publicKeySpkiSha256 !== sha256(publicDer) || key.publicKeySpkiDerBase64 !== publicDer.toString("base64")) {
  refuse("CHANNEL_SIGNING_KEY_NOT_TRUSTED", `${KEY_ENV} is not the active key in channel-trust.json`);
}
const now = Date.now();
const notBefore = instant(key.notBefore);
const expires = instant(key.expiresAt);
if (notBefore === null || expires === null || now < notBefore || now >= expires) {
  refuse("CHANNEL_SIGNING_KEY_OUT_OF_WINDOW", "now is outside the active key's notBefore..expiresAt");
}

const channel = readJson(join(directory, "channel.json"));
if (channel === null || typeof channel !== "object" || channel.assets === null || typeof channel.assets !== "object"
  || Object.keys(channel.assets).length === 0) refuse("CHANNEL_JSON_INVALID", "channel.json has no assets");
for (const [name, asset] of Object.entries(channel.assets)) {
  const url = URL.canParse(asset?.url) ? new URL(asset.url) : null;
  const file = url?.protocol === "https:" ? /^\/developer\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(url.pathname)?.[1] : undefined;
  if (!file || ["channel.json", "channel.json.sig", "channel-trust.json"].includes(file)) refuse("CHANNEL_ASSET_INVALID", name);
  let bytes;
  try {
    bytes = readFileSync(join(directory, file));
  } catch {
    refuse("CHANNEL_ASSET_MISSING", file);
  }
  if (sha256(bytes) !== asset.sha256) refuse("CHANNEL_ASSET_MISMATCH", `${file} does not match the digest channel.json names`);
}

const payload = Buffer.from(canonicalJson(channel), "utf8");
const fields = {
  schemaVersion: "tavonel.export_signature.v2",
  algorithm: "Ed25519",
  signatureScope: SCOPE,
  keyId: key.keyId,
  keyVersion: key.keyVersion,
  issuedAt: new Date(now).toISOString(),
  expiresAt: key.expiresAt,
  signedPayloadSha256: sha256(payload),
};
const signedBytes = Buffer.concat([Buffer.from(`${JSON.stringify(fields)}\n`, "utf8"), payload]);
const signature = sign(null, signedBytes, privateKey);
if (!verify(null, signedBytes, publicKey, signature)) refuse("CHANNEL_SIGNATURE_SELF_CHECK_FAILED", "the signature does not verify");

const output = join(directory, "channel.json.sig");
writeFileSync(output, `${JSON.stringify({
  ...fields,
  publicKeySpkiDerBase64: publicDer.toString("base64"),
  publicKeySpkiSha256: sha256(publicDer),
  signatureBase64: signature.toString("base64"),
}, null, 2)}\n`);
console.log(`signed channel ${channel.version} with ${key.keyId} v${key.keyVersion}; wrote ${output}`);
