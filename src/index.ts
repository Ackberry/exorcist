export { parseArgs } from "./args.js";
export { CliError, OracleError, ResolverError } from "./errors.js";
export { type HauntOptions, haunt } from "./haunt.js";
export {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  type OracleClient,
  ollamaClient,
  parseJudgment,
} from "./oracle.js";
export {
  npmRegistryClient,
  type Packument,
  prefetchPackuments,
  type RegistryClient,
} from "./registry.js";
export { renderMarkdown } from "./report.js";
export { resolveInstalled } from "./resolver.js";
export { rules } from "./rules/index.js";
export { runRules } from "./scanner.js";
export { hauntingScore, ruleFloor, SEVERITY_WEIGHTS } from "./scorer.js";
export type {
  Exorcism,
  Finding,
  GhostKind,
  HauntingReport,
  InstalledPackage,
  OracleJudgment,
  PackageHaunting,
  PackageManifest,
  QuietPackage,
  Rule,
  RuleStatus,
  Severity,
  Verdict,
} from "./types.js";
