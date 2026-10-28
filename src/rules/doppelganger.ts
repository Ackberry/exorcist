import { closeSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Finding, InstalledPackage, Rule, Severity } from "../types.js";
import { POPULAR_PACKAGES } from "./popular-packages.js";

export { POPULAR_PACKAGES } from "./popular-packages.js";

/**
 * Limits that keep the false-positive rate down.
 * A raw edit distance of 2 matches a large share of real npm names
 * (Scott Logic, 2018), so the second edit is only two insertions or deletions
 * on a long name. Keyboard substitution starts at length 6 so short names
 * such as nest/next are not treated as typos.
 */
export const DOPPELGANGER_LIMITS = {
  minNameLength: 4,
  minScopeLength: 3,
  minSubstitutionLength: 6,
  twoEditMinLength: 8,
  descriptionChars: 300,
  codeChars: 800,
  maxCodeBytes: 512 * 1024,
} as const;

const NEAR_MISS = /^Near miss of (\S+)/;

/** Squatter affixes. Real compounds such as express-session are not in this set. */
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

const HIGH_SIGNALS = new Set([
  "homoglyph",
  "separator swap",
  "one substitution",
  "one omitted character",
  "one extra character",
  "adjacent transposition",
  "scope typo",
  "dropped scope",
]);

/** The popular name named by a doppelganger finding, when the detail uses the stable prefix. */
export function readNearMiss(detail: string): string | null {
  const target = NEAR_MISS.exec(detail.trim())?.[1];
  return target && target.length > 0 ? target : null;
}

export interface PopularMatch {
  target: string;
  signal: string;
  severity: Severity;
}

interface PreparedTarget {
  name: string;
  folded: string;
  collapsed: string;
  scope: string | null;
  base: string;
}

interface Corpus {
  exact: ReadonlySet<string>;
  targets: readonly PreparedTarget[];
}

interface Hit {
  target: string;
  signal: string;
  distance: number;
  rank: number;
  severity: Severity;
}

const ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;

const NEIGHBORS = buildNeighbors();

/** Visual lookalikes folded before comparison. The original string is what we report. */
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "l",
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ѕ: "s",
  ј: "j",
};

let cachedCorpus: Corpus | null = null;

export function damerauLevenshtein(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  const m = aChars.length;
  const n = bChars.length;
  const width = n + 1;
  const dp = new Array<number>((m + 1) * width).fill(0);
  const at = (i: number, j: number): number => dp[i * width + j] ?? 0;
  const set = (i: number, j: number, value: number): void => {
    dp[i * width + j] = value;
  };
  for (let i = 0; i <= m; i++) set(i, 0, i);
  for (let j = 0; j <= n; j++) set(0, j, j);
  for (let i = 1; i <= m; i++) {
    const left = aChars[i - 1];
    for (let j = 1; j <= n; j++) {
      const right = bChars[j - 1];
      const cost = left !== undefined && left === right ? 0 : 1;
      let value = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && left === bChars[j - 2] && aChars[i - 2] === right) {
        value = Math.min(value, at(i - 2, j - 2) + 1);
      }
      set(i, j, value);
    }
  }
  return at(m, n);
}

/**
 * Nearest popular name, or null when the name is an exact popular package,
 * shorter than 4 characters, or not a near miss.
 */
export function matchPopularName(
  name: string,
  popular: readonly string[] = POPULAR_PACKAGES,
): PopularMatch | null {
  const raw = normalizeName(name);
  if (raw === "") return null;
  const corpus = corpusFor(popular);
  if (corpus.exact.has(raw)) return null;
  if (raw.length < DOPPELGANGER_LIMITS.minNameLength) return null;

  const folded = foldHomoglyphs(raw);
  const collapsed = collapseSeparators(folded);
  let best: Hit | null = null;

  for (const target of corpus.targets) {
    if (target.name === raw) continue;
    if (folded === target.folded && raw !== target.name) {
      best = prefer(best, makeHit(target.name, "homoglyph", 0, 0));
      continue;
    }
    if (
      collapsed.length >= DOPPELGANGER_LIMITS.minNameLength &&
      collapsed === target.collapsed &&
      folded !== target.folded
    ) {
      best = prefer(best, makeHit(target.name, "separator swap", 1, 1));
      continue;
    }
    best = prefer(best, editHit(folded, target));
    best = prefer(best, scopeHit(folded, target));
    best = prefer(best, droppedScopeHit(folded, target, corpus.exact));
    best = prefer(best, addedScopeHit(folded, target));
    best = prefer(best, wordSwapHit(folded, target.folded, target.name));
    best = prefer(best, affixHit(folded, target));
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
    const finding: Finding = {
      rule: "doppelganger",
      lockKey: pkg.lockKey,
      packageName: pkg.name,
      version: pkg.version,
      severity: match.severity,
      title: `name imitates ${match.target}`,
      detail: `Near miss of ${match.target} (${match.signal}). Swap ${pkg.name} for ${match.target}.`,
      evidence: excerpt.evidence,
      evidencePath: excerpt.evidencePath,
    };
    return [finding];
  },
};

function prefer(current: Hit | null, next: Hit | null): Hit | null {
  if (!next) return current;
  if (!current || better(next, current)) return next;
  return current;
}

function makeHit(target: string, signal: string, distance: number, rank: number): Hit {
  return {
    target,
    signal,
    distance,
    rank,
    severity: HIGH_SIGNALS.has(signal) ? "high" : "medium",
  };
}

function better(next: Hit, prev: Hit): boolean {
  if (next.distance !== prev.distance) return next.distance < prev.distance;
  if (next.rank !== prev.rank) return next.rank < prev.rank;
  if (next.severity !== prev.severity) return next.severity === "high";
  return next.target.localeCompare(prev.target) < 0;
}

function editHit(folded: string, target: PreparedTarget): Hit | null {
  if (folded.includes("/") || target.folded.includes("/")) return null;
  if (
    folded.length < DOPPELGANGER_LIMITS.minNameLength ||
    target.folded.length < DOPPELGANGER_LIMITS.minNameLength
  ) {
    return null;
  }
  const single = singleEditSignal(folded, target.folded);
  if (single) return makeHit(target.name, single, 1, 1);
  const longer = folded.length >= target.folded.length ? folded : target.folded;
  const shorter = folded.length >= target.folded.length ? target.folded : folded;
  const extras = extraCharCount(longer, shorter);
  if (
    extras === 2 &&
    shorter.length >= DOPPELGANGER_LIMITS.twoEditMinLength &&
    Math.abs(folded.length - target.folded.length) === 2
  ) {
    const signal =
      folded.length > target.folded.length ? "two extra characters" : "two omitted characters";
    return makeHit(target.name, signal, 2, 4);
  }
  return null;
}

function singleEditSignal(suspect: string, target: string): string | null {
  if (suspect === target) return null;
  if (suspect.length === target.length) {
    const diffs: number[] = [];
    for (let i = 0; i < suspect.length; i++) {
      if (suspect[i] !== target[i]) diffs.push(i);
    }
    if (diffs.length === 2) {
      const i = diffs[0];
      const j = diffs[1];
      if (i !== undefined && j === i + 1 && suspect[i] === target[j] && suspect[j] === target[i]) {
        return "adjacent transposition";
      }
      return null;
    }
    if (diffs.length === 1) {
      const i = diffs[0];
      if (i === undefined || suspect.length < DOPPELGANGER_LIMITS.minSubstitutionLength)
        return null;
      const left = suspect[i];
      const right = target[i];
      if (left && right && adjacentKeys(left, right)) return "one substitution";
      return null;
    }
    return null;
  }
  if (Math.abs(suspect.length - target.length) !== 1) return null;
  const longer = suspect.length > target.length ? suspect : target;
  const shorter = suspect.length > target.length ? target : suspect;
  if (shorter.length < DOPPELGANGER_LIMITS.minNameLength) return null;
  if (extraCharCount(longer, shorter) !== 1) return null;
  return suspect.length > target.length ? "one extra character" : "one omitted character";
}

function extraCharCount(longer: string, shorter: string): number | null {
  let s = 0;
  let extras = 0;
  for (let i = 0; i < longer.length; i++) {
    if (s < shorter.length && longer[i] === shorter[s]) s += 1;
    else extras += 1;
  }
  if (s !== shorter.length) return null;
  return extras;
}

function scopeHit(folded: string, target: PreparedTarget): Hit | null {
  const installed = parseName(folded);
  if (!installed.scope || !target.scope) return null;
  if (installed.base !== target.base) return null;
  if (installed.scope === target.scope) return null;
  if (
    installed.scope.length < DOPPELGANGER_LIMITS.minScopeLength ||
    target.scope.length < DOPPELGANGER_LIMITS.minScopeLength
  ) {
    return null;
  }
  if (damerauLevenshtein(installed.scope, target.scope) !== 1) return null;
  return makeHit(target.name, "scope typo", 1, 1);
}

function droppedScopeHit(
  folded: string,
  target: PreparedTarget,
  exact: ReadonlySet<string>,
): Hit | null {
  if (!target.scope || folded.startsWith("@")) return null;
  const joined = [
    `${target.scope}-${target.base}`,
    `${target.scope}_${target.base}`,
    `${target.scope}.${target.base}`,
    `${target.scope}${target.base}`,
  ];
  if (joined.includes(folded)) return makeHit(target.name, "dropped scope", 1, 2);
  if (
    folded === target.base &&
    target.base.length >= DOPPELGANGER_LIMITS.twoEditMinLength &&
    !exact.has(folded)
  ) {
    return makeHit(target.name, "unscoped copy", 2, 4);
  }
  return null;
}

function addedScopeHit(folded: string, target: PreparedTarget): Hit | null {
  const installed = parseName(folded);
  if (!installed.scope || target.scope) return null;
  if (installed.scope === "types") return null;
  if (installed.base !== target.name) return null;
  if (installed.base.length < DOPPELGANGER_LIMITS.minNameLength) return null;
  return makeHit(target.name, "added scope", 2, 4);
}

function wordSwapHit(folded: string, targetFolded: string, targetName: string): Hit | null {
  if (folded.startsWith("@") || targetFolded.startsWith("@")) return null;
  const left = tokens(folded);
  const right = tokens(targetFolded);
  if (left.length < 2 || left.length !== right.length) return null;
  if (left.some((token) => token.length < 2) || right.some((token) => token.length < 2))
    return null;
  if (left.join("\0") === right.join("\0")) return null;
  if ([...left].sort().join("\0") !== [...right].sort().join("\0")) return null;
  return makeHit(targetName, "swapped words", 1, 3);
}

function affixHit(folded: string, target: PreparedTarget): Hit | null {
  if (folded.startsWith("@") || target.scope) return null;
  const js = jsStem(folded);
  if (js === target.folded) return makeHit(target.name, "js suffix", 2, 3);
  const version = versionStem(folded);
  if (version === target.folded) return makeHit(target.name, "version suffix", 2, 3);
  const parts = folded.split(/[-_.]+/).filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  const left = parts[0];
  const right = parts[1];
  if (!left || !right) return null;
  if (left === target.folded && AFFIXES.has(right))
    return makeHit(target.name, "combosquat suffix", 2, 4);
  if (right === target.folded && AFFIXES.has(left))
    return makeHit(target.name, "combosquat prefix", 2, 4);
  return null;
}

function jsStem(name: string): string | null {
  if (name.endsWith(".js") || name.endsWith("-js") || name.endsWith("_js")) {
    const stem = name.slice(0, -3);
    return stem.length >= DOPPELGANGER_LIMITS.minNameLength ? stem : null;
  }
  if (name.endsWith("js")) {
    const stem = name.slice(0, -2);
    return stem.length >= DOPPELGANGER_LIMITS.minNameLength ? stem : null;
  }
  return null;
}

function versionStem(name: string): string | null {
  const stem = /^(.*?)[-_.]v?\d+(?:\.\d+){0,2}$/.exec(name)?.[1];
  if (!stem || stem.length < DOPPELGANGER_LIMITS.minNameLength || stem === name) return null;
  return stem;
}

function tokens(name: string): string[] {
  return name.split(/[-_.]+/).filter((part) => part.length > 0);
}

function parseName(name: string): { scope: string | null; base: string } {
  if (!name.startsWith("@")) return { scope: null, base: name };
  const slash = name.indexOf("/");
  if (slash <= 1 || slash === name.length - 1) return { scope: null, base: name };
  return { scope: name.slice(1, slash), base: name.slice(slash + 1) };
}

function corpusFor(popular: readonly string[]): Corpus {
  if (popular === POPULAR_PACKAGES && cachedCorpus) return cachedCorpus;
  const exact = new Set<string>();
  const targets: PreparedTarget[] = [];
  for (const entry of popular) {
    const name = normalizeName(entry);
    if (name === "" || exact.has(name)) continue;
    exact.add(name);
    const parsed = parseName(name);
    if (parsed.base.length < DOPPELGANGER_LIMITS.minNameLength) continue;
    const folded = foldHomoglyphs(name);
    const foldedParsed = parseName(folded);
    targets.push({
      name,
      folded,
      collapsed: collapseSeparators(folded),
      scope: foldedParsed.scope,
      base: foldedParsed.base,
    });
  }
  const built = { exact, targets };
  if (popular === POPULAR_PACKAGES) cachedCorpus = built;
  return built;
}

function normalizeName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

function foldHomoglyphs(name: string): string {
  let out = "";
  for (const char of name) out += HOMOGLYPHS[char] ?? char;
  return out;
}

function collapseSeparators(name: string): string {
  return name.replaceAll(/[-_.]+/g, "");
}

function adjacentKeys(a: string, b: string): boolean {
  if (a === b) return false;
  return NEIGHBORS.get(a)?.has(b) ?? false;
}

function buildNeighbors(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string): void => {
    if (a === b) return;
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };
  for (let r = 0; r < ROWS.length; r++) {
    const row = ROWS[r] ?? "";
    for (let c = 0; c < row.length; c++) {
      const key = row[c];
      if (!key) continue;
      const left = row[c - 1];
      const right = row[c + 1];
      if (left) add(key, left);
      if (right) add(key, right);
      const above = ROWS[r - 1];
      const below = ROWS[r + 1];
      const aboveKey = above?.[c];
      const aboveLeft = above?.[c - 1];
      const belowKey = below?.[c];
      const belowLeft = below?.[c - 1];
      if (aboveKey) add(key, aboveKey);
      if (aboveLeft) add(key, aboveLeft);
      if (belowKey) add(key, belowKey);
      if (belowLeft) add(key, belowLeft);
    }
  }
  return map;
}

function packageExcerpt(pkg: InstalledPackage): { evidence: string; evidencePath: string | null } {
  const lines: string[] = [];
  const description = pkg.manifest?.description?.trim();
  if (description) {
    lines.push(`description: ${clip(description, DOPPELGANGER_LIMITS.descriptionChars)}`);
  }
  const code = readCodeSummary(pkg);
  if (code) lines.push(`code (${code.file}):\n${code.text}`);
  if (lines.length === 0) {
    return {
      evidence: "No description or entry file was on disk. The name is the signal.",
      evidencePath: null,
    };
  }
  return {
    evidence: lines.join("\n\n"),
    evidencePath: code?.file ?? "package.json",
  };
}

function readCodeSummary(pkg: InstalledPackage): { file: string; text: string } | null {
  if (!pkg.path) return null;
  const relatives: string[] = [];
  const main = pkg.manifest?.main?.trim();
  if (main) relatives.push(main);
  relatives.push("index.js", "index.mjs", "index.cjs", "index.ts");
  const seen = new Set<string>();
  for (const rel of relatives) {
    const portable = rel.replaceAll("\\", "/");
    if (seen.has(portable)) continue;
    seen.add(portable);
    const full = insidePackage(pkg.path, portable);
    if (!full) continue;
    const text = readHead(full, DOPPELGANGER_LIMITS.codeChars);
    if (text) return { file: portable, text };
  }
  return null;
}

function insidePackage(root: string, rel: string): string | null {
  if (rel === "" || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) return null;
  const full = resolve(root, rel);
  const back = relative(root, full);
  if (back.startsWith("..") || isAbsolute(back)) return null;
  return full;
}

function readHead(file: string, maxChars: number): string | null {
  let fd: number | null = null;
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size === 0 || info.size > DOPPELGANGER_LIMITS.maxCodeBytes)
      return null;
    fd = openSync(file, "r");
    const buf = Buffer.alloc(Math.min(info.size, 8192));
    const n = readSync(fd, buf, 0, buf.length, 0);
    let text = buf.subarray(0, n).toString("utf8");
    if (text.includes("\0")) return null;
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.trim();
    if (text === "") return null;
    return clip(text, maxChars);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // The descriptor may already be closed.
      }
    }
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated`;
}
