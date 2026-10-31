import { readdirSync } from "node:fs";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { readFileInside } from "../safe-read.js";
import type { Finding, InstalledPackage, Rule, Severity } from "../types.js";

const INSTALL_HOOKS = ["preinstall", "install", "postinstall"] as const;

/** Caps so one huge dependency cannot dominate a scan. */
export const POLTERGEIST_LIMITS = {
  maxFiles: 40,
  maxFileBytes: 512 * 1024,
  maxDepth: 6,
  wholeFileChars: 2_500,
} as const;

const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "coverage", "build", ".next"]);

interface Signal {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  pattern: RegExp;
}

const CODE_SIGNALS: readonly Signal[] = [
  {
    id: "child_process",
    severity: "high",
    title: "spawns child processes",
    detail:
      "The code imports node:child_process or calls execSync, spawnSync, execFileSync, or fork.",
    pattern:
      /require\s*\(\s*['"](?:node:)?child_process['"]\s*\)|from\s+['"](?:node:)?child_process['"]|\b(?:execSync|spawnSync|execFileSync|fork)\s*\(/,
  },
  {
    id: "network",
    severity: "high",
    title: "makes a network call",
    detail: "The code imports a network API or calls fetch, http, or https.",
    pattern:
      /require\s*\(\s*['"](?:node:)?(?:http|https|net|dns|tls|axios|node-fetch|undici|got)['"]\s*\)|from\s+['"](?:node:)?(?:http|https|net|dns|tls|axios|node-fetch|undici|got)['"]|\bfetch\s*\(|\bhttps?\.(?:request|get)\s*\(|\bnet\.connect\s*\(/,
  },
  {
    id: "env",
    severity: "medium",
    title: "reads process.env",
    detail: "The code reads process.env.",
    pattern: /\bprocess\.env\b/,
  },
  {
    id: "ssh",
    severity: "critical",
    title: "touches an SSH path",
    detail: "The code mentions ~/.ssh or a .ssh path.",
    pattern: /~\/\.ssh\b|\.ssh\/|['"]\.ssh['"]/,
  },
  {
    id: "npmrc",
    severity: "critical",
    title: "touches an npmrc",
    detail: "The code mentions .npmrc, which is where npm keeps auth tokens.",
    pattern: /\.npmrc\b/,
  },
  {
    id: "eval",
    severity: "high",
    title: "uses eval or the Function constructor",
    detail: "The code calls eval, new Function, or Function as a plain call.",
    // Function("return this")() runs a string the same way new Function does.
    // The new is optional in JavaScript, so it is optional here too.
    pattern: /\beval\s*\(|\b(?:new\s+)?Function\s*\(/,
  },
  {
    id: "base64",
    severity: "medium",
    title: "contains a base64 payload",
    detail: "The code decodes base64 or contains a long base64-looking literal.",
    pattern:
      /Buffer\.from\s*\([\s\S]{0,120}?['"]base64['"]\s*\)|\.toString\s*\(\s*['"]base64['"]\s*\)|\batob\s*\(|\bbtoa\s*\(|['"][A-Za-z0-9+/]{40,}={0,2}['"]/,
  },
  {
    id: "obfuscation",
    severity: "high",
    title: "hides names behind escapes",
    detail:
      "The code spells identifiers or URLs as escape sequences or character codes, which keeps the other signals from reading them.",
    // Measured against 3,192 files in this repository's own node_modules: a run
    // of five hex escapes, an obfuscator name, and fromCharCode with four or
    // more arguments each matched nothing. Four hex escapes matched five files,
    // and runs of \uNNNN stayed common at every threshold (emoji-regex and the
    // like), so neither is used here.
    pattern:
      /(?:\\x[0-9a-fA-F]{2}){5,}|\b_0x[0-9a-f]{4,}\b|String\.fromCharCode\s*\(\s*\d+\s*(?:,\s*\d+\s*){3,}\)/,
  },
];

export const poltergeistRule: Rule = {
  kind: "poltergeist",
  status: "active",
  description:
    "Install scripts, child processes, network calls, process.env, ~/.ssh, .npmrc, eval, base64 payloads, and escaped names.",
  scan(pkg) {
    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const hook of INSTALL_HOOKS) {
      const command = pkg.manifest?.scripts?.[hook]?.trim();
      if (!command) continue;
      const article = hook === "install" ? "an" : "a";
      findings.push(
        makeFinding(pkg, {
          severity: "critical",
          title: `runs ${article} ${hook} script`,
          detail: `npm runs this ${hook} command when the package is installed.`,
          evidence: clip(command, POLTERGEIST_LIMITS.wholeFileChars),
          evidencePath: "package.json",
        }),
      );
      collectSignals(pkg, command, "package.json", findings, seen);
    }

    if (pkg.path) {
      for (const file of listSourceFiles(pkg.path)) {
        const evidencePath = portableRelative(pkg.path, file);
        if (!evidencePath) continue;
        const source = readFileInside(pkg.path, file, POLTERGEIST_LIMITS.maxFileBytes);
        if (source === null) continue;
        collectSignals(pkg, source, evidencePath, findings, seen);
      }
    }

    return findings;
  },
};

function collectSignals(
  pkg: InstalledPackage,
  source: string,
  evidencePath: string,
  findings: Finding[],
  seen: Set<string>,
): void {
  for (const signal of CODE_SIGNALS) {
    if (seen.has(signal.id)) continue;
    const index = source.search(signal.pattern);
    if (index === -1) continue;
    seen.add(signal.id);
    findings.push(
      makeFinding(pkg, {
        severity: signal.severity,
        title: signal.title,
        detail: signal.detail,
        evidence: evidenceFor(source, index),
        evidencePath,
      }),
    );
  }
}

function makeFinding(
  pkg: InstalledPackage,
  fields: Pick<Finding, "severity" | "title" | "detail" | "evidence" | "evidencePath">,
): Finding {
  return {
    rule: "poltergeist",
    lockKey: pkg.lockKey,
    packageName: pkg.name,
    version: pkg.version,
    ...fields,
  };
}

function evidenceFor(source: string, matchIndex: number): string {
  const line = lineAt(source, matchIndex);
  if (source.length <= POLTERGEIST_LIMITS.wholeFileChars) {
    const body = source.trim();
    if (body === line || body.startsWith(`${line}\n`) || body.startsWith(`${line}\r`)) return body;
    return `${line}\n\n${body}`;
  }
  const start = Math.max(0, matchIndex - 400);
  const end = Math.min(source.length, matchIndex + 1_600);
  const prefix = start > 0 ? "/* … */\n" : "";
  const suffix = end < source.length ? "\n/* … */" : "";
  return `${line}\n\n${prefix}${source.slice(start, end).trim()}${suffix}`;
}

function lineAt(source: string, index: number): string {
  const start = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end === -1 ? source.length : end).trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n/* … */`;
}

function portableRelative(root: string, file: string): string | null {
  const relativePath = relative(root, file);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return relativePath.split(sep).join("/");
}

function readDirents(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

function listSourceFiles(root: string): string[] {
  const found: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

  while (queue.length > 0 && found.length < POLTERGEIST_LIMITS.maxFiles) {
    const current = queue.shift();
    if (!current) break;
    const entries = readDirents(current.dir);
    if (!entries) continue;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (found.length >= POLTERGEIST_LIMITS.maxFiles) break;
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) continue;
      const full = join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (current.depth < POLTERGEIST_LIMITS.maxDepth) {
          queue.push({ dir: full, depth: current.depth + 1 });
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".d.ts")) continue;
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
      found.push(full);
    }
  }

  return found;
}
