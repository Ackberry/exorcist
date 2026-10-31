import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/** A lockfile larger than this is rejected instead of parsed. */
export const MAX_LOCKFILE_BYTES = 32 * 1024 * 1024;

/** A package.json larger than this is ignored. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface PackageScope {
  /** Real path of the scanned project. */
  scanRoot: string;
  /** Real directory dependency paths must stay inside. */
  boundary: string;
}

/**
 * How far a lockfile may point.
 *
 * A git checkout stops at the repository root, so a `file:` spec cannot walk
 * out to `~/.ssh`. With no `.git` above the project, the parent directory is
 * the boundary (local fixtures such as `../packages/widget`). That parent is
 * never the filesystem root or the home directory: those would make every
 * sibling, including credential files, a legal package root.
 */
export function packageScope(scanRoot: string): PackageScope {
  const realScan = realpathSync(scanRoot);
  return { scanRoot: realScan, boundary: findBoundary(realScan) };
}

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  if (rel === "..") return false;
  if (rel.startsWith(`..${sep}`)) return false;
  if (isAbsolute(rel)) return false;
  return true;
}

/** Credential directories and files a package root must not be. */
export function credentialRoots(home: string): string[] {
  return [
    join(home, ".ssh"),
    join(home, ".aws"),
    join(home, ".npm"),
    join(home, ".gnupg"),
    join(home, ".docker"),
    join(home, ".kube"),
    join(home, ".azure"),
    join(home, ".config", "gh"),
    join(home, ".config", "gcloud"),
    join(home, ".npmrc"),
    join(home, ".netrc"),
    join(home, ".git-credentials"),
    join(home, ".pypirc"),
    resolve("/etc"),
  ];
}

export function isSensitiveRealPath(
  real: string,
  home: string,
  markers: readonly string[],
): boolean {
  if (real === home || real === resolve("/")) return true;
  return markers.some((marker) => isInside(marker, real));
}

/**
 * True when this directory is a dependency Exorcist may read.
 * The real path has to stay inside the boundary, must not be an ancestor of
 * the project (that would walk the parent tree), and must not be a credential path.
 */
export function acceptPackageDir(scope: PackageScope, dir: string): boolean {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return false;
  }
  if (!isInside(scope.boundary, real)) return false;
  if (isInside(real, scope.scanRoot)) return false;
  if (liveCredential(real)) return false;
  return true;
}

/**
 * Lockfile key under the project. `..`, empty segments, and absolute keys are
 * rejected so `node_modules/../../.ssh` never becomes a package directory.
 */
export function containedJoin(root: string, key: string): string | null {
  if (key.includes("\0") || key.includes("\\")) return null;
  const parts = key.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return null;
  const resolved = resolve(root, key);
  if (!isInside(root, resolved)) return null;
  return resolved;
}

export type OwnedRead =
  | { ok: true; text: string }
  | { ok: false; reason: "missing" | "outside" | "large" | "unreadable" };

/**
 * Read a project file such as `package-lock.json`.
 * A symlink is followed only when its real path stays inside `root`.
 */
export function readOwnedFile(root: string, file: string, maxBytes: number): OwnedRead {
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
  } catch {
    return { ok: false, reason: "missing" };
  }
  let real: string;
  try {
    real = realpathSync(file);
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!isInside(rootReal, real)) return { ok: false, reason: "outside" };
  // Open once, then stat and read through that descriptor. Checking the path
  // and reading it again would let the name be repointed in between.
  let fd: number;
  try {
    fd = openSync(real, constants.O_RDONLY);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return { ok: false, reason: "unreadable" };
    if (info.size > maxBytes) return { ok: false, reason: "large" };
    return { ok: true, text: readFileSync(fd, "utf8") };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    closeSync(fd);
  }
}

/**
 * Read a regular file whose real path stays inside `root`.
 * The file itself must not be a symlink. A parent symlink is allowed only
 * when it is the package directory npm linked, and the file still resolves
 * inside that package.
 */
export function readFileInside(root: string, file: string, maxBytes: number): string | null {
  let rootReal: string;
  let real: string;
  try {
    rootReal = realpathSync(root);
    real = realpathSync(file);
  } catch {
    return null;
  }
  if (!isInside(rootReal, real)) return null;
  // O_NOFOLLOW refuses a symlink at the final component in the same call that
  // opens it, so the name cannot become a link after the check. Everything
  // after this reads the descriptor, never the path again.
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return null;
    if (info.size > maxBytes) return null;
    return readFileSync(fd, "utf8");
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function findBoundary(realScan: string): string {
  const root = resolve("/");
  const home = liveMarker(homedir());
  let dir = realScan;
  for (let i = 0; i < 32; i++) {
    if (dir === home || dir === root) break;
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const parent = dirname(realScan);
  if (parent === realScan || parent === root || parent === home) return realScan;
  return parent;
}

function liveCredential(real: string): boolean {
  const home = homedir();
  const homeReal = liveMarker(home);
  const markers = credentialRoots(home).map((marker) => liveMarker(marker));
  return isSensitiveRealPath(real, homeReal, markers);
}

function liveMarker(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
