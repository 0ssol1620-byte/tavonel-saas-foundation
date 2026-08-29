import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { unzipSync } from "fflate";

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
    const path = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!isSafePath(path) || paths.has(path)) throw new Error("ZIP entry path is unsafe or duplicated");
    paths.add(path);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("archive expands beyond 64 MiB verification limit");
    offset += recordLength;
  }
  if (offset !== centralEnd) throw new Error("ZIP central directory has trailing data");
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
  fail("usage: pnpm verify:export -- --archive <package.zip> --trusted-fingerprint sha256:<64 hex>");
} else {
  try {
    const archivePath = resolve(options.archive);
    const archive = await readFile(archivePath);
    if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("archive exceeds 64 MiB verification limit");
    inspectCentralDirectory(archive);
    const entries = unzipSync(archive);
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
