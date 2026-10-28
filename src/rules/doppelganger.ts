import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { InstalledPackage, Rule, Severity } from "../types.js";
import { POPULAR_PACKAGES } from "./popular-packages.js";

export { POPULAR_PACKAGES } from "./popular-packages.js";

/** Name length and excerpt caps. Distance 2 is only for names of length 8 or more. */
export const DOPPELGANGER_LIMITS = {
  minNameLength: 4,
  twoEditMinLength: 8,
  descriptionChars: 300,
  codeChars: 800,
  maxCodeBytes: 512 * 1024,
} as const;

const AFFIXES = new Set([
  "api",
  "helper",
  "helpers",
  "js",
  "lib",
  "module",
  "modules",
  "node",
  "npm",
  "official",
  "package",
  "pkg",
  "tool",
  "tools",
  "util",
  "utils",
]);

const NEAR_MISS = /^Near miss of (\S+)/;

export function readNearMiss(detail: string): string | null {
  const target = NEAR_MISS.exec(detail.trim())?.[1];
  return target ? target : null;
}

export interface PopularMatch {
  target: string;
  signal: string;
  severity: Severity;
}

interface TargetRow {
  name: string;
  collapsed: string;
  scope: string | null;
  base: string;
}

interface Corpus {
  exact: ReadonlySet<string>;
  targets: readonly TargetRow[];
}

interface Hit {
  target: string;
  signal: string;
  distance: number;
  rank: number;
  severity: Severity;
}

interface ParsedName {
  scope: string | null;
  base: string;
}

let cached: Corpus | null = null;

export function damerauLevenshtein(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  const width = bChars.length + 1;
  const dp = new Array<number>((aChars.length + 1) * width).fill(0);
  const at = (i: number, j: number): number => dp[i * width + j] ?? 0;
  const set = (i: number, j: number, value: number): void => {
    dp[i * width + j] = value;
  };
  for (let i = 0; i <= aChars.length; i++) set(i, 0, i);
  for (let j = 0; j <= bChars.length; j++) set(0, j, j);
  for (let i = 1; i <= aChars.length; i++) {
    const left = aChars[i - 1];
    for (let j = 1; j <= bChars.length; j++) {
      const right = bChars[j - 1];
      const cost = left !== undefined && left === right ? 0 : 1;
      let value = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && left === bChars[j - 2] && aChars[i - 2] === right) {
        value = Math.min(value, at(i - 2, j - 2) + 1);
      }
      set(i, j, value);
    }
  }
  return at(aChars.length, bChars.length);
}

/** Nearest popular name, or null for an exact popular name, a short name, or no signal. */
export function matchPopularName(
  name: string,
  popular: readonly string[] = POPULAR_PACKAGES,
): PopularMatch | null {
  const raw = name.trim().toLowerCase();
  if (raw.length < DOPPELGANGER_LIMITS.minNameLength) return null;
  const corpus = corpusFor(popular);
  if (corpus.exact.has(raw)) return null;

  const collapsed = collapse(raw);
  const parsed = parseName(raw);
  let best: Hit | null = null;
  for (const target of corpus.targets) {
    best = prefer(best, separatorHit(raw, collapsed, target));
    best = prefer(best, scopeHit(parsed, target));
    best = prefer(best, droppedScopeHit(raw, target));
    best = prefer(best, jsHit(raw, target));
    best = prefer(best, comboHit(raw, target));
    best = prefer(best, editHit(raw, target));
  }
  if (best === null) return null;
  return { target: best.target, signal: best.signal, severity: best.severity };
}

export const doppelgangerRule: Rule = {
  kind: "doppelganger",
  status: "active",
  description: "Package name that imitates a popular package.",
  scan(pkg) {
    const match = matchPopularName(pkg.name);
    if (!match) return [];
    const excerpt = packageExcerpt(pkg);
    return [
      {
        rule: "doppelganger",
        lockKey: pkg.lockKey,
        packageName: pkg.name,
        version: pkg.version,
        severity: match.severity,
        title: `name imitates ${match.target}`,
        detail: `Near miss of ${match.target} (${match.signal}). Swap ${pkg.name} for ${match.target}.`,
        evidence: excerpt.evidence,
        evidencePath: excerpt.evidencePath,
      },
    ];
  },
};

function separatorHit(raw: string, collapsed: string, target: TargetRow): Hit | null {
  if (collapsed.length < DOPPELGANGER_LIMITS.minNameLength) return null;
  if (collapsed !== target.collapsed || raw === target.name) return null;
  return makeHit(target.name, "separator swap", 1, 0);
}

function scopeHit(installed: ParsedName, target: TargetRow): Hit | null {
  if (!installed.scope || !target.scope || installed.base !== target.base) return null;
  if (installed.scope === target.scope || installed.scope.length < 3 || target.scope.length < 3) {
    return null;
  }
  if (damerauLevenshtein(installed.scope, target.scope) !== 1) return null;
  return makeHit(target.name, "scope typo", 1, 0);
}

function droppedScopeHit(raw: string, target: TargetRow): Hit | null {
  if (!target.scope || raw.startsWith("@")) return null;
  const forms = [
    `${target.scope}-${target.base}`,
    `${target.scope}_${target.base}`,
    `${target.scope}.${target.base}`,
    `${target.scope}${target.base}`,
  ];
  if (!forms.includes(raw)) return null;
  return makeHit(target.name, "dropped scope", 1, 1);
}

function jsHit(raw: string, target: TargetRow): Hit | null {
  if (raw.startsWith("@") || target.scope) return null;
  const stem =
    raw.endsWith(".js") || raw.endsWith("-js") || raw.endsWith("_js")
      ? raw.slice(0, -3)
      : raw.endsWith("js")
        ? raw.slice(0, -2)
        : null;
  if (!stem || stem.length < DOPPELGANGER_LIMITS.minNameLength || stem !== target.name) return null;
  return makeHit(target.name, "js suffix", 2, 2);
}

function comboHit(raw: string, target: TargetRow): Hit | null {
  if (raw.startsWith("@") || target.scope) return null;
  const parts = raw.split(/[-_.]+/).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  const left = parts[0];
  const right = parts[1];
  if (!left || !right) return null;
  if (left === target.name && AFFIXES.has(right))
    return makeHit(target.name, "combosquat suffix", 2, 3);
  if (right === target.name && AFFIXES.has(left))
    return makeHit(target.name, "combosquat prefix", 2, 3);
  return null;
}

function editHit(raw: string, target: TargetRow): Hit | null {
  if (raw.includes("/") || target.name.includes("/")) return null;
  if (Math.abs(raw.length - target.name.length) > 2) return null;
  const distance = damerauLevenshtein(raw, target.name);
  const limit =
    raw.length >= DOPPELGANGER_LIMITS.twoEditMinLength &&
    target.name.length >= DOPPELGANGER_LIMITS.twoEditMinLength
      ? 2
      : 1;
  if (distance < 1 || distance > limit) return null;
  if (distance === 2) return makeHit(target.name, "two edits", 2, 4);
  if (raw.length === target.name.length && isAdjacentSwap(raw, target.name)) {
    return makeHit(target.name, "adjacent transposition", 1, 1);
  }
  if (raw.length === target.name.length) return makeHit(target.name, "one substitution", 1, 1);
  const signal = raw.length > target.name.length ? "one extra character" : "one omitted character";
  return makeHit(target.name, signal, 1, 1);
}

function isAdjacentSwap(a: string, b: string): boolean {
  let first = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (first === -1) first = i;
    else if (i === first + 1 && a[first] === b[i] && a[i] === b[first]) return true;
    else return false;
  }
  return false;
}

function makeHit(target: string, signal: string, distance: number, rank: number): Hit {
  const medium =
    signal === "js suffix" || signal.startsWith("combosquat") || signal === "two edits";
  return { target, signal, distance, rank, severity: medium ? "medium" : "high" };
}

function prefer(current: Hit | null, next: Hit | null): Hit | null {
  if (!next) return current;
  if (!current) return next;
  if (next.distance !== current.distance) return next.distance < current.distance ? next : current;
  if (next.rank !== current.rank) return next.rank < current.rank ? next : current;
  return next.target.localeCompare(current.target) < 0 ? next : current;
}

function corpusFor(popular: readonly string[]): Corpus {
  if (popular === POPULAR_PACKAGES && cached) return cached;
  const exact = new Set<string>();
  const targets: TargetRow[] = [];
  for (const entry of popular) {
    const name = entry.trim().toLowerCase();
    if (name === "" || exact.has(name)) continue;
    exact.add(name);
    const parsed = parseName(name);
    if (parsed.base.length < DOPPELGANGER_LIMITS.minNameLength) continue;
    targets.push({ name, collapsed: collapse(name), scope: parsed.scope, base: parsed.base });
  }
  const built = { exact, targets };
  if (popular === POPULAR_PACKAGES) cached = built;
  return built;
}

function parseName(name: string): ParsedName {
  if (!name.startsWith("@")) return { scope: null, base: name };
  const slash = name.indexOf("/");
  if (slash <= 1 || slash === name.length - 1) return { scope: null, base: name };
  return { scope: name.slice(1, slash), base: name.slice(slash + 1) };
}

function collapse(name: string): string {
  return name.replaceAll(/[-_.]+/g, "");
}

function packageExcerpt(pkg: InstalledPackage): { evidence: string; evidencePath: string | null } {
  const description = pkg.manifest?.description?.trim();
  const code = pkg.path ? readEntry(pkg.path, pkg.manifest?.main) : null;
  const lines = [
    description ? `description: ${clip(description, DOPPELGANGER_LIMITS.descriptionChars)}` : "",
    code ? `code (${code.file}):\n${code.text}` : "",
  ].filter((line) => line !== "");
  if (lines.length === 0) {
    return {
      evidence: "No description or entry file was on disk. The name is the signal.",
      evidencePath: null,
    };
  }
  return { evidence: lines.join("\n\n"), evidencePath: code?.file ?? "package.json" };
}

function readEntry(root: string, main: string | undefined): { file: string; text: string } | null {
  for (const rel of [main?.trim(), "index.js", "index.mjs", "index.cjs", "index.ts"]) {
    if (!rel || rel.startsWith("/") || rel.includes("..") || /^[a-zA-Z]:/.test(rel)) continue;
    const portable = rel.replaceAll("\\", "/");
    const full = resolve(root, portable);
    if (relative(root, full).startsWith("..") || isAbsolute(relative(root, full))) continue;
    try {
      const info = statSync(full);
      if (!info.isFile() || info.size === 0 || info.size > DOPPELGANGER_LIMITS.maxCodeBytes)
        continue;
      const text = readFileSync(full, "utf8")
        .replace(/^\uFEFF/, "")
        .trim();
      if (text === "" || text.includes("\0")) continue;
      return { file: portable, text: clip(text, DOPPELGANGER_LIMITS.codeChars) };
    } catch {
      // The entry file is missing or unreadable.
    }
  }
  return null;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… truncated`;
}
