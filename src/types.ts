/** Ghost kinds. One rule module implements each. */
export type GhostKind = "poltergeist" | "doppelganger" | "revenant" | "phantom";

export type RuleStatus = "active" | "stub";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Verdict = "benign" | "suspicious" | "malicious";

/** What to do about a haunted package. Quiet packages do not get one. */
export type Exorcism = "pin" | "remove" | "swap";

export interface PackageManifest {
  name?: string;
  version?: string;
  description?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** One installed package from a lockfile `packages` entry under `node_modules/`. */
export interface InstalledPackage {
  name: string;
  version: string;
  /** Lockfile key, for example `node_modules/left-pad`. Unique within one lockfile. */
  lockKey: string;
  /** Directory that holds the package, or null when it is not on disk. */
  path: string | null;
  manifest: PackageManifest | null;
  /** True when this top-level package is listed in the root package's dependencies. */
  direct: boolean;
  dev: boolean;
}

export interface Finding {
  rule: GhostKind;
  lockKey: string;
  packageName: string;
  version: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: string | null;
  /** Path relative to the package root, or `package.json` for a script body. */
  evidencePath: string | null;
}

export interface ScanContext {
  rootDir: string;
  packages: readonly InstalledPackage[];
}

export interface Rule {
  kind: GhostKind;
  description: string;
  status: RuleStatus;
  scan(pkg: InstalledPackage, ctx: ScanContext): Finding[] | Promise<Finding[]>;
}

export interface OracleJudgment {
  verdict: Verdict;
  /** From 0 to 1. */
  confidence: number;
  /**
   * Gemma's risk score, from 0 to 100. The reported haunting score is at least
   * the rule floor; this field is the number the model returned.
   */
  score: number;
  /** Plain English: what the flagged code does. */
  summary: string;
  explanation: string;
  /**
   * Set only for a doppelganger call. True when the description, README, or code
   * claims the popular package's identity under a different name.
   */
  impersonating?: boolean;
  /** The popular package that question named. */
  impersonationOf?: string | null;
}

export interface OracleStatus {
  /** False when the user passed `--no-oracle`. */
  requested: boolean;
  /** True only when Ollama responded and the requested model is pulled. */
  available: boolean;
  model: string;
  endpoint: string;
  message: string;
}

export interface PackageHaunting {
  name: string;
  version: string;
  path: string | null;
  direct: boolean;
  dev: boolean;
  findings: readonly Finding[];
  judgment: OracleJudgment | null;
  /** Set when this package was sent to the oracle and the call failed. */
  oracleNote: string | null;
  /** 0 to 100. Higher means more haunted. */
  hauntingScore: number;
  exorcism: Exorcism;
  exorcismReason: string;
}

export interface QuietPackage {
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
}

export interface RuleRun {
  kind: GhostKind;
  description: string;
  status: RuleStatus;
  findings: number;
}

export interface HauntingReport {
  /** Absolute path of the scanned project. */
  target: string;
  scannedAt: string;
  packageCount: number;
  rules: readonly RuleRun[];
  hauntings: readonly PackageHaunting[];
  quiet: readonly QuietPackage[];
  oracle: OracleStatus;
}
