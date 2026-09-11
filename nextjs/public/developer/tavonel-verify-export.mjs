/**
 * Verify a signed TAVONEL export archive, offline.
 *
 * This file is published as `tavonel-verify-export.mjs` on https://tavonel.com/developers and
 * pinned by sha256 in /developer/channel.json. The copy there is byte-identical to this one --
 * `lib/compiler-contract.test.ts` fails if it drifts -- which is why nothing here imports
 * anything but the Node standard library. A verifier a customer cannot run is not a verifier,
 * and `pnpm install` on a clean machine is not part of verifying a download.
 *
 *   node tavonel-verify-export.mjs --archive world.zip --trusted-fingerprint sha256:<64 hex>
 *
 * Exit 0 when the archive is intact and signed by the key whose fingerprint you passed in,
 * 1 otherwise. The fingerprint must come from somewhere other than the archive:
 * GET https://tavonel.com/api/export/trust publishes it.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 256;
const MANIFEST_PATH = "manifest/export-manifest.json";
const SIGNATURE_PATH = "signatures/export-manifest.ed25519.json";
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function fail(message) {
  process.stderr.write(`TAVONEL export verification failed: ${message}\n`);
  process.exitCode = 1;
}

function isSafePath(path) {
  return path.length > 0
    && path.length <= 240
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.includes("\0")
    && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function inspectCentralDirectory(archive) {
  const minimumEocd = 22;
  let eocd = -1;
  for (let offset = archive.byteLength - minimumEocd;
    offset >= Math.max(0, archive.byteLength - 65_557);
    offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0 || eocd + minimumEocd > archive.byteLength) throw new Error("ZIP end record is missing");
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const entriesOnDisk = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  const commentLength = archive.readUInt16LE(eocd + 20);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error("multi-disk ZIP is unsupported");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 is unsupported");
  }
  if (entryCount === 0 || entryCount > MAX_ENTRIES) throw new Error("archive entry count is invalid");
  if (eocd + minimumEocd + commentLength !== archive.byteLength) throw new Error("ZIP end record is malformed");
  const centralEnd = centralOffset + centralSize;
  if (centralEnd !== eocd || centralEnd > archive.byteLength) throw new Error("ZIP central directory bounds are invalid");

  const paths = new Set();
  const found = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralEnd || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP central directory entry is malformed");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const entryCommentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const recordLength = 46 + nameLength + extraLength + entryCommentLength;
    if (offset + recordLength > centralEnd || nameLength === 0) throw new Error("ZIP entry bounds are invalid");
    if ((flags & 1) !== 0) throw new Error("encrypted ZIP entries are unsupported");
    if (method !== 0 && method !== 8) throw new Error("ZIP compression method is unsupported");
    if (diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("ZIP64 or multi-disk entry is unsupported");
    }
    const localOffset = archive.readUInt32LE(offset + 42);
    const path = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!isSafePath(path) || paths.has(path)) throw new Error("ZIP entry path is unsafe or duplicated");
    paths.add(path);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("archive expands beyond 64 MiB verification limit");
    if (localOffset >= centralOffset) throw new Error("ZIP entry data lies outside the archive");
    found.push({ path, method, compressedSize, uncompressedSize, localOffset });
    offset += recordLength;
  }
  if (offset !== centralEnd) throw new Error("ZIP central directory has trailing data");
  return found;
}

/*
  Extraction, from node:zlib rather than a decoder dependency.

  The central directory above has already bounded everything this reads: the entry count, the
  per-entry sizes, the total expansion and every path. So this walk only has to locate each
  entry's bytes and inflate them, and it trusts the central directory's sizes over the local
  header's -- a streamed entry writes zeros there and defers the real numbers to a data
  descriptor after the payload.

  Stored (method 0) and deflate (method 8) are the only two methods a TAVONEL archive is built
  with, and the central-directory walk already refuses anything else.
*/
function extractEntries(archive, entries) {
  const files = Object.create(null);
  for (const entry of entries) {
    const header = entry.localOffset;
    if (header + 30 > archive.byteLength || archive.readUInt32LE(header) !== 0x04034b50) {
      throw new Error(`ZIP local header is malformed for ${entry.path}`);
    }
    const nameLength = archive.readUInt16LE(header + 26);
    const extraLength = archive.readUInt16LE(header + 28);
    const start = header + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > archive.byteLength) throw new Error(`ZIP entry data is truncated for ${entry.path}`);
    const raw = archive.subarray(start, end);
    const content = entry.method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
    if (content.byteLength !== entry.uncompressedSize) {
      throw new Error(`ZIP entry size disagrees with its directory record for ${entry.path}`);
    }
    files[entry.path] = content;
  }
  return files;
}

function parseArguments(values) {
  const args = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value) return null;
    args.set(name.slice(2), value);
  }
  const archive = args.get("archive");
  const trustedFingerprint = args.get("trusted-fingerprint")?.toLowerCase();
  return archive && SHA256.test(trustedFingerprint ?? "") ? { archive, trustedFingerprint } : null;
}

const options = parseArguments(process.argv.slice(2));
if (!options) {
  // Named from argv so the published download and the repository script each print the command
  // the reader actually has, rather than one of them printing a path that does not exist there.
  fail(`usage: node ${basename(process.argv[1] ?? "verify-signed-export.mjs")} --archive <package.zip> --trusted-fingerprint sha256:<64 hex>`);
} else {
  try {
    const archivePath = resolve(options.archive);
    const archive = await readFile(archivePath);
    if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("archive exceeds 64 MiB verification limit");
    const entries = extractEntries(archive, inspectCentralDirectory(archive));
    const paths = Object.keys(entries);
    if (paths.length > MAX_ENTRIES) throw new Error("archive contains too many entries");
    if (!entries[MANIFEST_PATH] || !entries[SIGNATURE_PATH]) throw new Error("signed manifest files are missing");

    const manifestBytes = entries[MANIFEST_PATH];
    const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
    const receipt = JSON.parse(Buffer.from(entries[SIGNATURE_PATH]).toString("utf8"));
    if (manifest.schemaVersion !== "tavonel.signed_export_manifest.v1") throw new Error("manifest schema is unsupported");
    if (receipt.schemaVersion !== "tavonel.export_signature.v1" || receipt.algorithm !== "Ed25519") {
      throw new Error("signature schema or algorithm is unsupported");
    }
    const publicKeyDer = Buffer.from(receipt.publicKeySpkiDerBase64, "base64");
    if (publicKeyDer.toString("base64") !== receipt.publicKeySpkiDerBase64) throw new Error("public key is not canonical Base64");
    const fingerprint = digest(publicKeyDer);
    if (fingerprint !== receipt.publicKeySpkiSha256 || fingerprint !== options.trustedFingerprint) {
      throw new Error("public key fingerprint does not match the trusted fingerprint");
    }
    if (digest(manifestBytes) !== receipt.signedPayloadSha256) throw new Error("manifest digest does not match receipt");
    const signature = Buffer.from(receipt.signatureBase64, "base64");
    if (signature.byteLength !== 64 || signature.toString("base64") !== receipt.signatureBase64) {
      throw new Error("signature is not canonical Ed25519 bytes");
    }
    const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    if (publicKey.asymmetricKeyType !== "ed25519" || !verify(null, manifestBytes, publicKey, signature)) {
      throw new Error("Ed25519 signature verification failed");
    }
    if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > MAX_ENTRIES - 2) {
      throw new Error("signed file inventory is invalid");
    }
    const signedPaths = new Set();
    for (const file of manifest.files) {
      if (!file || typeof file.path !== "string" || signedPaths.has(file.path) || !entries[file.path]) {
        throw new Error("signed file inventory contains a duplicate or missing path");
      }
      if (!Number.isSafeInteger(file.sizeBytes) || entries[file.path].byteLength !== file.sizeBytes) {
        throw new Error(`size mismatch for ${file.path}`);
      }
      if (!SHA256.test(file.sha256) || digest(entries[file.path]) !== file.sha256) {
        throw new Error(`digest mismatch for ${file.path}`);
      }
      signedPaths.add(file.path);
    }
    const allowedPaths = new Set([...signedPaths, MANIFEST_PATH, SIGNATURE_PATH]);
    if (paths.some((path) => !allowedPaths.has(path))) throw new Error("archive contains an unsigned extra file");
    process.stdout.write(
      `${JSON.stringify({ ok: true, archive: basename(archivePath), collectionId: manifest.collectionId, keyId: receipt.keyId, fingerprint, filesVerified: signedPaths.size })}\n`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : "unknown verification error");
  }
}
