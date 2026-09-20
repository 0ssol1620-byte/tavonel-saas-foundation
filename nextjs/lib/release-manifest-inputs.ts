import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

const COMMIT = /^[a-f0-9]{40}$/;

export type ReleaseFile = {
  path: string;
  gitMode: string | null;
};

export function requireReleaseManifestOutputPolicy(allowIncomplete: boolean, outputRequested: boolean) {
  if (allowIncomplete && outputRequested) {
    throw new Error("Incomplete release manifests are inspection-only and cannot be written to a file");
  }
}

function isWithin(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ""
    && !pathFromRoot.startsWith(`..${sep}`)
    && pathFromRoot !== ".."
    && !isAbsolute(pathFromRoot);
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function ensureOutputDirectory(requestedParent: string) {
  const root = parse(requestedParent).root;
  let current = root;
  for (const segment of relative(root, requestedParent).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) throw new Error(`Release output path may not contain symbolic links: ${current}`);
      if (!stats.isDirectory()) throw new Error(`Release output parent component is not a directory: ${current}`);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      mkdirSync(current, { mode: 0o700 });
      const created = lstatSync(current);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error(`Release output parent changed during creation: ${current}`);
      }
    }
  }
  return realpathSync(current);
}

export function requireReleaseCommit(
  checkoutCommit: string,
  commitClaims: ReadonlyArray<{ source: string; value: string | undefined }>,
) {
  const normalizedHead = checkoutCommit.trim().toLowerCase();
  if (!COMMIT.test(normalizedHead)) {
    throw new Error("Checkout HEAD is not a full commit SHA");
  }

  const supplied = commitClaims
    .map(({ source, value }) => ({ source, value: value?.trim().toLowerCase() ?? "" }))
    .filter(({ value }) => value.length > 0);
  if (supplied.length === 0) {
    throw new Error("A trusted release commit SHA is required");
  }
  for (const claim of supplied) {
    if (!COMMIT.test(claim.value)) {
      throw new Error(`${claim.source} is not a full commit SHA`);
    }
    if (claim.value !== normalizedHead) {
      throw new Error(`${claim.source} does not match checkout HEAD (${normalizedHead})`);
    }
  }
  return normalizedHead;
}

function resolveReleaseFile(repositoryRoot: string, file: ReleaseFile) {
  if (!file.path || isAbsolute(file.path) || file.path.includes("\\")) {
    throw new Error(`Release input is not a repository-relative Git path: ${file.path}`);
  }
  const segments = file.path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Release input contains an unsafe path segment: ${file.path}`);
  }
  if (file.gitMode && file.gitMode !== "100644" && file.gitMode !== "100755") {
    throw new Error(`Release input is not a regular Git file (${file.gitMode}): ${file.path}`);
  }

  const canonicalRoot = realpathSync(repositoryRoot);
  let current = canonicalRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Release inputs may not contain symbolic links: ${file.path}`);
    }
  }
  const canonicalFile = realpathSync(current);
  if (!isWithin(canonicalRoot, canonicalFile)) {
    throw new Error(`Release input resolves outside the repository: ${file.path}`);
  }
  return { canonicalFile, canonicalRoot };
}

export function digestReleaseFiles(repositoryRoot: string, name: string, files: readonly ReleaseFile[]) {
  if (files.length === 0) throw new Error(`Refusing to digest empty required artifact set: ${name}`);
  const unique = new Map<string, ReleaseFile>();
  for (const file of files) {
    if (unique.has(file.path)) throw new Error(`Duplicate release input in ${name}: ${file.path}`);
    unique.set(file.path, file);
  }

  const hash = createHash("sha256");
  const sortedFiles = [...unique.values()].sort((left, right) => (
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  ));
  for (const file of sortedFiles) {
    const { canonicalFile } = resolveReleaseFile(repositoryRoot, file);
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    const descriptor = openSync(canonicalFile, constants.O_RDONLY | noFollow);
    try {
      const before = fstatSync(descriptor, { bigint: true });
      if (!before.isFile()) throw new Error(`Release input is not a regular file: ${file.path}`);
      hash.update(file.path);
      hash.update("\0");
      hash.update(String(before.size));
      hash.update("\0");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytesRead = 0;
      while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = fstatSync(descriptor, { bigint: true });
      if (
        before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs
      ) {
        throw new Error(`Release input changed while being read: ${file.path}`);
      }
      if (realpathSync(canonicalFile) !== canonicalFile) {
        throw new Error(`Release input changed while being read: ${file.path}`);
      }
      hash.update("\0");
    } finally {
      closeSync(descriptor);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

export function writeReleaseManifest(repositoryRoot: string, requestedOutput: string, contents: string) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const absoluteOutput = isAbsolute(requestedOutput)
    ? resolve(requestedOutput)
    : resolve(repositoryRoot, requestedOutput);
  const canonicalParent = ensureOutputDirectory(dirname(absoluteOutput));
  if (canonicalParent === canonicalRoot || isWithin(canonicalRoot, canonicalParent)) {
    throw new Error("Release manifest output must be outside the repository");
  }

  const canonicalOutput = resolve(canonicalParent, basename(absoluteOutput));
  let outputExists = false;
  try {
    lstatSync(canonicalOutput);
    outputExists = true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  if (outputExists) {
    throw new Error("Release manifest output already exists; refusing to follow or overwrite it");
  }
  const temporaryOutput = resolve(
    canonicalParent,
    `.${basename(canonicalOutput)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const descriptor = openSync(
    temporaryOutput,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
    0o600,
  );
  let temporaryExists = true;
  try {
    const openedOutput = realpathSync(temporaryOutput);
    const openedParent = dirname(openedOutput);
    if (
      openedParent !== canonicalParent
      || openedParent === canonicalRoot
      || isWithin(canonicalRoot, openedParent)
    ) {
      throw new Error("Release manifest output parent changed during creation");
    }
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    linkSync(temporaryOutput, canonicalOutput);
    unlinkSync(temporaryOutput);
    temporaryExists = false;
  } finally {
    try {
      closeSync(descriptor);
    } catch (error) {
      if (errorCode(error) !== "EBADF") throw error;
    }
    if (temporaryExists) {
      try {
        unlinkSync(temporaryOutput);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
}
