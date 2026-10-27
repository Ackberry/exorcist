import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { Finding, InstalledPackage, Rule, ScanContext } from "../types.js";

/**
 * Caps for the project walk. One file past the cap is not read, so an import
 * that lives only in a skipped file can look unused.
 */
export const PHANTOM_LIMITS = {
  maxFiles: 300,
  maxFileBytes: 512 * 1024,
  maxDepth: 8,
} as const;

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"]);

/** Build output. Dot-directories are skipped separately, which covers `.git` and `.next`. */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage", "build"]);

/**
 * A package whose bin is one of these is not "used" just because a script
 * starts the runtime. `node src/app.js` is not a use of a package named `node`.
 */
const SHELL_COMMANDS = new Set([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "sh",
  "bash",
  "zsh",
  "cmd",
  "echo",
  "cd",
  "cp",
  "mv",
  "rm",
  "ls",
  "cat",
  "env",
  "true",
  "false",
  "test",
  "exit",
]);

interface ProjectUsage {
  /** Package names seen in import / export / require specifiers. */
  packages: Set<string>;
  /** Shell tokens from the root package.json scripts. */
  commands: Set<string>;
  /** Spec strings from the root manifest, for evidence. */
  declared: Map<string, string>;
}

const usageByContext = new WeakMap<ScanContext, ProjectUsage | null>();

export const phantomRule: Rule = {
  kind: "phantom",
  status: "active",
  description: "Direct dependency the project never imports or names in a script.",
  scan(pkg, ctx) {
    if (!pkg.direct) return [];
    const usage = loadUsage(ctx);
    if (!usage) return [];
    if (isReferenced(usage, pkg)) return [];
    return [makeFinding(pkg, usage)];
  },
};

function loadUsage(ctx: ScanContext): ProjectUsage | null {
  const cached = usageByContext.get(ctx);
  if (cached !== undefined) return cached;
  let usage: ProjectUsage | null;
  try {
    usage = collectUsage(ctx.rootDir);
  } catch {
    usage = null;
  }
  usageByContext.set(ctx, usage);
  return usage;
}

function collectUsage(rootDir: string): ProjectUsage {
  const usage: ProjectUsage = {
    packages: new Set(),
    commands: new Set(),
    declared: new Map(),
  };
  readRootManifest(rootDir, usage);
  for (const file of listProjectFiles(rootDir)) {
    let source: string;
    try {
      const info = statSync(file);
      if (!info.isFile() || info.size > PHANTOM_LIMITS.maxFileBytes) continue;
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    try {
      for (const specifier of collectSpecifiers(source)) {
        const name = packageNameFromSpecifier(specifier);
        if (name) usage.packages.add(name);
      }
    } catch {
      // A confused lexer on one file should not abort the scan.
    }
  }
  return usage;
}

function readRootManifest(rootDir: string, usage: ProjectUsage): void {
  let text: string;
  try {
    text = readFileSync(join(rootDir, "package.json"), "utf8");
  } catch {
    return;
  }
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  addDeclared(usage, parsed.dependencies);
  addDeclared(usage, parsed.devDependencies);
  addDeclared(usage, parsed.optionalDependencies);
  if (!isRecord(parsed.scripts)) return;
  for (const value of Object.values(parsed.scripts)) {
    if (typeof value !== "string") continue;
    for (const token of scriptTokens(value)) usage.commands.add(token);
  }
}

function addDeclared(usage: ProjectUsage, value: unknown): void {
  if (!isRecord(value)) return;
  for (const [name, spec] of Object.entries(value)) {
    if (typeof spec === "string" && !usage.declared.has(name)) usage.declared.set(name, spec);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenced(usage: ProjectUsage, pkg: InstalledPackage): boolean {
  if (usage.packages.has(pkg.name)) return true;
  const bins = binNames(pkg).filter((name) => name.length >= 2 && !SHELL_COMMANDS.has(name));
  for (const token of usage.commands) {
    if (tokenUsesPackage(token, pkg.name)) return true;
    for (const bin of bins) {
      if (token === bin || token.endsWith(`/${bin}`)) return true;
    }
  }
  return false;
}

function tokenUsesPackage(token: string, name: string): boolean {
  if (token === name) return true;
  if (token.startsWith(`${name}/`)) return true;
  if (token.startsWith(`${name}@`)) return true;
  const marker = `/node_modules/${name}`;
  return token.endsWith(marker) || token.includes(`${marker}/`);
}

function binNames(pkg: InstalledPackage): string[] {
  if (!pkg.path) return [];
  let text: string;
  try {
    text = readFileSync(join(pkg.path, "package.json"), "utf8");
  } catch {
    return [];
  }
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    const parsed = JSON.parse(stripped) as unknown;
    if (!isRecord(parsed)) return [];
    return namesFromBin(parsed.bin, pkg.name);
  } catch {
    return [];
  }
}

function namesFromBin(bin: unknown, packageName: string): string[] {
  if (typeof bin === "string") {
    const slash = packageName.lastIndexOf("/");
    const unscoped = slash === -1 ? packageName : packageName.slice(slash + 1);
    return unscoped ? [unscoped] : [];
  }
  if (!isRecord(bin)) return [];
  return Object.keys(bin);
}

function scriptTokens(script: string): string[] {
  const tokens: string[] = [];
  for (const part of script.split(/[\s;&|<>()`'"\\]+/)) {
    if (part) tokens.push(part);
  }
  return tokens;
}

function makeFinding(pkg: InstalledPackage, usage: ProjectUsage): Finding {
  const spec = usage.declared.get(pkg.name);
  const detail = pkg.dev
    ? "Declared as a devDependency and never imported, required, or named by a package.json script or bin. Severity is low: a config file this rule does not read can still reference a dev tool."
    : "Declared as a direct dependency and never imported, required, or named by a package.json script or bin. Install scripts still run.";
  return {
    rule: "phantom",
    lockKey: pkg.lockKey,
    packageName: pkg.name,
    version: pkg.version,
    severity: pkg.dev ? "low" : "medium",
    title: "installed but never imported",
    detail,
    evidence: spec ? `"${pkg.name}": "${spec}"` : null,
    evidencePath: spec ? "package.json" : null,
  };
}

/**
 * Package name from a module specifier.
 * `pkg/sub` and `@scope/pkg/sub` collapse to the package. Relative paths,
 * absolute paths, and `node:` built-ins are not packages.
 */
export function packageNameFromSpecifier(specifier: string): string | null {
  const hash = specifier.trim().split("#")[0] ?? "";
  const bare = hash.split("?")[0] ?? "";
  if (!bare || bare.startsWith(".") || bare.startsWith("/") || bare.startsWith("\\")) return null;
  if (bare.includes(":")) return null;
  if (bare.startsWith("@")) {
    const parts = bare.split("/");
    const scope = parts[0];
    const name = parts[1];
    if (!scope || scope === "@" || !name) return null;
    return `${scope}/${name}`;
  }
  const name = bare.split("/")[0];
  return name || null;
}

/**
 * Module specifiers from `import` / `export ... from` / `import()` / `require()`.
 *
 * This is a lexer, not a parser. Comments and ordinary strings are skipped, so a
 * package named only there is not a use. Limits: a regex literal that contains
 * `//` or `/*` can hide the rest of a line or block; `require(variable)` and
 * `import(variable)` are not resolved; `obj.require("pkg")` is ignored.
 */
export function collectSpecifiers(source: string): string[] {
  const found: string[] = [];
  scanCode(source, 0, source.length, found, false);
  return found;
}

function scanCode(
  source: string,
  start: number,
  end: number,
  found: string[],
  stopOnBrace: boolean,
): number {
  let i = start;
  while (i < end) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      i = indexOfNewline(source, i, end);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlock(source, i, end);
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipPlainString(source, i, end);
      continue;
    }
    if (c === "`") {
      i = scanTemplate(source, i, end, found);
      continue;
    }
    if (stopOnBrace && c === "}") return i + 1;
    if (c !== undefined && isIdentStart(c.charCodeAt(0))) {
      const identStart = i;
      i = skipIdent(source, i, end);
      if (isPropertyAccess(source, identStart)) continue;
      const word = source.slice(identStart, i);
      if (word === "require") {
        const spec = readRequire(source, i, end);
        if (spec) found.push(spec);
      } else if (word === "import") {
        const spec = readImport(source, i, end);
        if (spec) found.push(spec);
      } else if (word === "export") {
        const spec = readFrom(source, i, end);
        if (spec) found.push(spec);
      }
      continue;
    }
    i++;
  }
  return i;
}

function scanTemplate(source: string, i: number, end: number, found: string[]): number {
  i++;
  while (i < end) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    if (c === "$" && source[i + 1] === "{") {
      i = scanCode(source, i + 2, end, found, true);
      continue;
    }
    i++;
  }
  return i;
}

function readRequire(source: string, i: number, end: number): string | null {
  i = skipSpaceAndComments(source, i, end);
  if (source.startsWith(".resolve", i) && !isIdentPart(source.charCodeAt(i + ".resolve".length))) {
    i = skipSpaceAndComments(source, i + ".resolve".length, end);
  }
  if (source[i] !== "(") return null;
  i = skipSpaceAndComments(source, i + 1, end);
  return readQuoted(source, i, end);
}

function readImport(source: string, i: number, end: number): string | null {
  i = skipSpaceAndComments(source, i, end);
  if (source[i] === "(") {
    i = skipSpaceAndComments(source, i + 1, end);
    return readQuoted(source, i, end);
  }
  if (source[i] === ".") return null;
  const direct = readQuoted(source, i, end);
  if (direct !== null) return direct;
  return readFrom(source, i, end);
}

function readFrom(source: string, i: number, end: number): string | null {
  const stop = Math.min(end, i + 800);
  let depth = 0;
  while (i < stop) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      i = indexOfNewline(source, i, stop);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlock(source, i, stop);
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      i = skipString(source, i, stop);
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (depth === 0 && (c === "\n" || c === "\r")) {
      const next = skipSpaceAndComments(source, i + 1, stop);
      if (!isWord(source, next, stop, "from")) return null;
      i = next;
      continue;
    }
    if (depth === 0 && c === ";") return null;
    if (depth === 0 && isWord(source, i, stop, "from")) {
      const after = skipSpaceAndComments(source, i + 4, stop);
      const spec = readQuoted(source, after, stop);
      if (spec !== null) return spec;
    }
    i++;
  }
  return null;
}

function readQuoted(source: string, i: number, end: number): string | null {
  const quote = source[i];
  if (quote !== "'" && quote !== '"' && quote !== "`") return null;
  i++;
  let value = "";
  while (i < end) {
    const c = source[i];
    if (c === "\\") {
      const next = source[i + 1];
      if (next === undefined) return null;
      value += next;
      i += 2;
      continue;
    }
    if (c === quote) return value;
    if (quote === "`" && c === "$" && source[i + 1] === "{") return null;
    if ((quote === "'" || quote === '"') && (c === "\n" || c === "\r")) return null;
    if (c === undefined) return null;
    value += c;
    i++;
  }
  return null;
}

function skipString(source: string, i: number, end: number): number {
  if (source[i] === "`") return skipTemplate(source, i, end);
  return skipPlainString(source, i, end);
}

function skipPlainString(source: string, i: number, end: number): number {
  const quote = source[i];
  i++;
  while (i < end) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === quote) return i + 1;
    if (source[i] === "\n" || source[i] === "\r") return i;
    i++;
  }
  return i;
}

function skipTemplate(source: string, i: number, end: number): number {
  i++;
  while (i < end) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "`") return i + 1;
    if (c === "$" && source[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < end && depth > 0) {
        const d = source[i];
        if (d === "/" && source[i + 1] === "/") {
          i = indexOfNewline(source, i, end);
          continue;
        }
        if (d === "/" && source[i + 1] === "*") {
          i = skipBlock(source, i, end);
          continue;
        }
        if (d === "'" || d === '"' || d === "`") {
          i = skipString(source, i, end);
          continue;
        }
        if (d === "{") depth++;
        else if (d === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

function skipSpaceAndComments(source: string, i: number, end: number): number {
  while (i < end) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f") {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      i = indexOfNewline(source, i, end);
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlock(source, i, end);
      continue;
    }
    break;
  }
  return i;
}

function isWord(source: string, i: number, end: number, word: string): boolean {
  if (!source.startsWith(word, i)) return false;
  const before = i > 0 ? source.charCodeAt(i - 1) : Number.NaN;
  if (isIdentPart(before)) return false;
  const after = i + word.length;
  if (after < end && isIdentPart(source.charCodeAt(after))) return false;
  return true;
}

function isPropertyAccess(source: string, identStart: number): boolean {
  let j = identStart - 1;
  while (j >= 0) {
    const c = source[j];
    if (c !== " " && c !== "\t") return c === ".";
    j--;
  }
  return false;
}

function isIdentStart(char: number): boolean {
  return (char >= 65 && char <= 90) || (char >= 97 && char <= 122) || char === 95 || char === 36;
}

function isIdentPart(char: number): boolean {
  return isIdentStart(char) || (char >= 48 && char <= 57);
}

function skipIdent(source: string, i: number, end: number): number {
  i++;
  while (i < end) {
    const c = source[i];
    if (c === undefined || !isIdentPart(c.charCodeAt(0))) break;
    i++;
  }
  return i;
}

function indexOfNewline(source: string, i: number, end: number): number {
  const next = source.indexOf("\n", i);
  if (next === -1 || next >= end) return end;
  return next + 1;
}

function skipBlock(source: string, i: number, end: number): number {
  const next = source.indexOf("*/", i + 2);
  if (next === -1 || next >= end) return end;
  return next + 2;
}

function listProjectFiles(root: string): string[] {
  const found: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  while (queue.length > 0 && found.length < PHANTOM_LIMITS.maxFiles) {
    const current = queue.shift();
    if (!current) break;
    const entries = readDirents(current.dir);
    if (!entries) continue;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= PHANTOM_LIMITS.maxFiles) break;
      const full = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) continue;
        if (current.depth < PHANTOM_LIMITS.maxDepth) {
          queue.push({ dir: full, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      found.push(full);
    }
  }

  return found;
}

function readDirents(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}
