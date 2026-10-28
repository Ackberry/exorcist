import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ResolverError } from "./errors.js";
import {
  acceptPackageDir,
  containedJoin,
  MAX_LOCKFILE_BYTES,
  MAX_MANIFEST_BYTES,
  type PackageScope,
  packageScope,
  readFileInside,
  readOwnedFile,
} from "./safe-read.js";
import type { InstalledPackage, PackageManifest } from "./types.js";

interface LockPackage {
  name?: string;
  version?: string;
  resolved?: string;
  link?: boolean;
  dev?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Read `package-lock.json` (lockfileVersion 2 or 3) and list installed packages.
 *
 * npm records a `file:` dependency twice: the source path holds the version, and
 * `node_modules/<name>` is a link with `resolved` pointing back at that path.
 * Only `node_modules/` keys are installed packages. Link entries borrow their
 * version from the target entry, then from package.json.
 *
 * When `node_modules` is missing, a `link: true` or `file:` spec is still
 * resolved so local fixtures can be read straight from the lockfile.
 * The real path has to stay inside the package boundary from `packageScope`.
 * A key that contains `..` is not a directory. Credential directories are not
 * package roots. See `src/safe-read.ts`.
 */
export function resolveInstalled(rootDir: string): InstalledPackage[] {
  const root = resolve(rootDir);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new ResolverError(`Target directory does not exist: ${root}`);
  }

  const lockPath = join(root, "package-lock.json");
  if (!existsSync(lockPath)) {
    throw new ResolverError(
      `No package-lock.json in ${root}. Run npm install there first. Exorcist does not read pnpm-lock.yaml or yarn.lock yet.`,
    );
  }

  const parsed = readJsonFile(root, lockPath);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ResolverError(`${lockPath} is not a JSON object.`);
  }

  const record = parsed as Record<string, unknown>;
  const version = record.lockfileVersion;
  if (version !== 2 && version !== 3) {
    throw new ResolverError(
      `Unsupported lockfileVersion ${String(version)} in ${lockPath}. Exorcist reads npm lockfileVersion 2 and 3.`,
    );
  }

  const packages = asLockMap(record.packages);
  if (packages === null) {
    throw new ResolverError(
      `${lockPath} has no packages map. lockfileVersion 2 and 3 require one.`,
    );
  }

  const scope = packageScope(root);
  const rootEntry = packages[""] ?? {};
  const directNames = new Set<string>([
    ...Object.keys(rootEntry.dependencies ?? {}),
    ...Object.keys(rootEntry.devDependencies ?? {}),
    ...Object.keys(rootEntry.optionalDependencies ?? {}),
  ]);
  const devNames = new Set(Object.keys(rootEntry.devDependencies ?? {}));
  const prodNames = new Set(Object.keys(rootEntry.dependencies ?? {}));

  const installed: InstalledPackage[] = [];
  for (const key of Object.keys(packages)) {
    if (!isInstalledKey(key)) continue;
    const entry = packages[key];
    if (!entry) continue;

    const target = lookupTarget(packages, entry.resolved);
    const keyName = nameFromKey(key);
    const directory = chooseDirectory(root, scope, key, entry.resolved);
    const manifest = readManifest(directory);
    const name = entry.name ?? target?.name ?? manifest?.name ?? keyName;
    const pkgVersion = entry.version ?? target?.version ?? manifest?.version;
    if (!pkgVersion) continue;

    const topLevel = isTopLevel(key);
    installed.push({
      name,
      version: pkgVersion,
      lockKey: key,
      path: directory,
      manifest,
      direct: topLevel && directNames.has(keyName),
      dev:
        entry.dev === true ||
        target?.dev === true ||
        (topLevel && devNames.has(keyName) && !prodNames.has(keyName)),
    });
  }

  return installed;
}

function readJsonFile(root: string, file: string): unknown {
  const read = readOwnedFile(root, file, MAX_LOCKFILE_BYTES);
  if (!read.ok) {
    if (read.reason === "outside") {
      throw new ResolverError(
        `${file} points outside ${root}. Exorcist will not follow that path.`,
      );
    }
    if (read.reason === "large") {
      throw new ResolverError(`${file} is larger than ${MAX_LOCKFILE_BYTES} bytes.`);
    }
    throw new ResolverError(`Could not read ${file}.`);
  }
  const text = read.text;
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    throw new ResolverError(`${file} is not valid JSON.`);
  }
}

function asLockMap(value: unknown): Record<string, LockPackage> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const map: Record<string, LockPackage> = Object.create(null) as Record<string, LockPackage>;
  for (const [key, entry] of Object.entries(value)) {
    const parsed = asLockPackage(entry);
    if (parsed) map[key] = parsed;
  }
  return map;
}

function asLockPackage(value: unknown): LockPackage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    name: asString(record.name),
    version: asString(record.version),
    resolved: asString(record.resolved),
    link: record.link === true,
    dev: record.dev === true,
    dependencies: asStringRecord(record.dependencies),
    devDependencies: asStringRecord(record.devDependencies),
    optionalDependencies: asStringRecord(record.optionalDependencies),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") record[key] = entry;
  }
  return record;
}

function isInstalledKey(key: string): boolean {
  const parts = key.split("/");
  const index = parts.lastIndexOf("node_modules");
  return index !== -1 && index < parts.length - 1;
}

function isTopLevel(key: string): boolean {
  const parts = key.split("/");
  const first = parts.indexOf("node_modules");
  const last = parts.lastIndexOf("node_modules");
  return first !== -1 && first === last;
}

function nameFromKey(key: string): string {
  const parts = key.split("/");
  const index = parts.lastIndexOf("node_modules");
  return parts.slice(index + 1).join("/");
}

function lookupTarget(
  packages: Record<string, LockPackage>,
  resolved: string | undefined,
): LockPackage | undefined {
  if (!resolved) return undefined;
  const direct = packages[resolved];
  if (direct) return direct;
  if (resolved.startsWith("file:")) {
    return packages[resolved.slice("file:".length)];
  }
  return undefined;
}

function chooseDirectory(
  rootDir: string,
  scope: PackageScope,
  key: string,
  resolved: string | undefined,
): string | null {
  const candidates = [containedJoin(rootDir, key), linkedDirectory(rootDir, resolved)];
  let fallback: string | null = null;
  for (const dir of candidates) {
    if (dir === null || !acceptPackageDir(scope, dir)) continue;
    if (fallback === null) fallback = dir;
    if (existsSync(join(dir, "package.json"))) return dir;
  }
  return fallback;
}

function linkedDirectory(rootDir: string, resolved: string | undefined): string | null {
  if (!resolved) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(resolved) && !resolved.toLowerCase().startsWith("file:")) {
    return null;
  }
  return resolveLink(rootDir, resolved);
}

function resolveLink(rootDir: string, resolved: string): string {
  if (
    resolved.toLowerCase().startsWith("file:") &&
    resolved.slice("file:".length).startsWith("//")
  ) {
    try {
      return fileURLToPath(resolved);
    } catch {
      return resolve(rootDir, resolved.slice("file:".length));
    }
  }
  const spec = resolved.toLowerCase().startsWith("file:")
    ? resolved.slice("file:".length)
    : resolved;
  return resolve(rootDir, spec);
}

function readManifest(dir: string | null): PackageManifest | null {
  if (!dir) return null;
  const text = readFileInside(dir, join(dir, "package.json"), MAX_MANIFEST_BYTES);
  if (text === null) return null;
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return asManifest(JSON.parse(stripped) as unknown);
  } catch {
    return null;
  }
}

function asManifest(value: unknown): PackageManifest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    name: asString(record.name),
    version: asString(record.version),
    description: asString(record.description),
    main: asString(record.main),
    scripts: asStringRecord(record.scripts),
    dependencies: asStringRecord(record.dependencies),
    devDependencies: asStringRecord(record.devDependencies),
  };
}
